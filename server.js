const express = require('express');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');

const app = express();
app.set('trust proxy', 1); // Render běží za proxy — ať req.ip je skutečná IP klienta
const PORT = process.env.PORT || 3000;

const SOLAX_TOKEN_ID = process.env.SOLAX_TOKEN_ID;
const SOLAX_SN = process.env.SOLAX_SN;
const SOLAX_URL = 'https://global.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do';

const SHELLY_AUTH_KEY = process.env.SHELLY_AUTH_KEY;
const SHELLY_SERVER_URI = process.env.SHELLY_SERVER_URI; // e.g. shelly-133-eu.shelly.cloud
const SHELLY_DEVICE_ID = process.env.SHELLY_DEVICE_ID; // bojler

const POOL_SERVER_URI = process.env.POOL_SERVER_URI || SHELLY_SERVER_URI;
const POOL_DEVICE_ID = process.env.POOL_DEVICE_ID;

const SOLINATOR_SERVER_URI = process.env.SOLINATOR_SERVER_URI || SHELLY_SERVER_URI;
const SOLINATOR_DEVICE_ID = process.env.SOLINATOR_DEVICE_ID;

const POOL_PM_IDS = ['54320470d17c', '5432046cb538', '543204702434'];

const LIGHT_ZAHRADA_DOLE_ID   = '34b7dacb5f6c';
const LIGHT_ZAHRADA_NAHORE_ID = '34b7daca6dc8';
const LIGHT_BAZEN_ID          = '34b7daca4150';
const LIGHT_NOCNI_ID          = 'dcda0cea454c';

// Všechna relé, která obchází centrální poller; klíče odpovídají zařízením ve frontendu
const DEVICES = {
  shelly:      { apiPath: '/api/shelly',              serverUri: SHELLY_SERVER_URI,    deviceId: SHELLY_DEVICE_ID },
  pool:        { apiPath: '/api/pool',                serverUri: POOL_SERVER_URI,      deviceId: POOL_DEVICE_ID },
  solinator:   { apiPath: '/api/solinator',           serverUri: SOLINATOR_SERVER_URI, deviceId: SOLINATOR_DEVICE_ID },
  lightDole:   { apiPath: '/api/light/zahradadole',   serverUri: SHELLY_SERVER_URI,    deviceId: LIGHT_ZAHRADA_DOLE_ID },
  lightNahore: { apiPath: '/api/light/zahradanahore', serverUri: SHELLY_SERVER_URI,    deviceId: LIGHT_ZAHRADA_NAHORE_ID },
  lightBazen:  { apiPath: '/api/light/bazen',         serverUri: SHELLY_SERVER_URI,    deviceId: LIGHT_BAZEN_ID },
  lightNocni:  { apiPath: '/api/light/nocni',         serverUri: SHELLY_SERVER_URI,    deviceId: LIGHT_NOCNI_ID }
};

const shellyCache = new Map();
const CACHE_TTL_MS = 5000; // 5s cache, ať se nezahlcuje Shelly cloud při rychlém sledu dotazů

// Globální fronta: každý dotaz i příkaz na Shelly cloud jde po jednom
// s minimálně sekundovým rozestupem — poller, automatika ani ruční
// přepnutí se tak nikdy nepotkají a nenarazí na rate limit
let shellyQueueTail = Promise.resolve();
let lastShellyCallTs = 0;

function shellyQueued(fn) {
  const run = shellyQueueTail.then(async () => {
    const wait = lastShellyCallTs + SHELLY_GAP_MS - Date.now();
    if (wait > 0) await delay(wait);
    try {
      return await fn();
    } finally {
      lastShellyCallTs = Date.now();
    }
  });
  shellyQueueTail = run.catch(() => {}); // fronta pokračuje i po chybě
  return run;
}

const POLL_INTERVAL_MS = 2 * 60 * 1000; // jak často poller obchází Solax i Shelly
const SHELLY_GAP_MS = 1000;             // rozestup mezi dotazy na Shelly cloud (rate limit)
const HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Centrální stav — jediný zdroj pravdy pro všechny připojené klienty
const DEVICE_LABELS = {
  shelly: 'Bojler',
  pool: 'Bazén',
  solinator: 'Solinátor',
  lightDole: 'Zahrada dole',
  lightNahore: 'Zahrada nahoře',
  lightBazen: 'Světlo bazén',
  lightNocni: 'Noční světla'
};

const state = {
  solax: null,       // poslední úspěšná data ze střídače
  devices: {},       // key -> { online, isOn, powerW, fetchedAt }
  poolPowerW: null,  // součet 3 PM měření bazénu
  history: [],       // { t, kw } — přetok za posledních 24 h
  log: [],           // { t, msg } — záznamy zapínání/vypínání za 24 h
  autoEnabled: true, // hlavní vypínač automatiky (stránka Přehled)
  weather: null,     // { tempC, sunsetMs, fetchedAt } pro zobrazení v appce
  runtime: { date: '', ms: { shelly: 0, pool: 0, solinator: 0 }, lastTs: Date.now() }, // dnešní doba běhu
  timeline: { shelly: [], pool: [], solinator: [], wallbox: [] }, // segmenty { from, to } zapnutí za 48 h
  aircon: { devices: [], error: null }, // Panasonic klimatizace
  wallbox: { power: null, energy: null, mode: null, status: null, error: null }, // Solax EV charger
  wallboxHistory: [], // { t, w } — výkon nabíječky za posledních 24 h
  infigy: { error: null }, // data z Infigy (teplota bojleru atd.)
  tempAuto: { loznice: false, elenka: false, miky: false }, // teplotní automatika klimatizace (zap/vyp per pokoj)
  assistantLog: []   // { t, text } — co asistent provedl, za 24 h
};

const TIMELINE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const TIMELINE_GAP_MS = 6 * 60 * 1000; // vzorky ~2 min od sebe → menší díra = pořád jeden běh

function mergeSegments(segs) {
  segs.sort((a, b) => a.from - b.from);
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && s.from - last.to <= TIMELINE_GAP_MS) {
      if (s.to > last.to) last.to = s.to;
    } else {
      out.push({ from: s.from, to: s.to });
    }
  }
  return out;
}

function pruneTimeline() {
  const cutoff = Date.now() - TIMELINE_MAX_AGE_MS;
  for (const k of Object.keys(state.timeline)) {
    state.timeline[k] = state.timeline[k].filter(s => s.to >= cutoff);
    for (const s of state.timeline[k]) {
      if (s.from < cutoff) s.from = cutoff;
    }
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---------- SSE stream pro živé aktualizace ----------

const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

function pruneHistory() {
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  while (state.history.length && state.history[0].t < cutoff) state.history.shift();
  while (state.log.length && state.log[0].t < cutoff) state.log.shift();
  while (state.wallboxHistory.length && state.wallboxHistory[0].t < cutoff) state.wallboxHistory.shift();
}

function addLog(msg) {
  const entry = { t: Date.now(), msg };
  state.log.push(entry);
  pruneHistory();
  broadcast('log', { entry });
}

function addAssistantLog(text) {
  if (!text) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  state.assistantLog = state.assistantLog.filter(e => e.t >= cutoff);
  state.assistantLog.push({ t: Date.now(), text });
  if (state.assistantLog.length > 30) state.assistantLog = state.assistantLog.slice(-30);
  broadcast('assistantLog', { log: state.assistantLog });
}

function snapshot() {
  pruneHistory();
  return {
    solax: state.solax,
    devices: state.devices,
    poolPowerW: state.poolPowerW,
    history: state.history,
    log: state.log,
    autoEnabled: state.autoEnabled,
    weather: state.weather,
    runtime: { date: state.runtime.date, ms: state.runtime.ms },
    timeline: state.timeline,
    blindsEnabled: tahomaEnabled,
    blindTimers,
    relayTimers,
    aircon: state.aircon,
    airconEnabled: panasonicEnabled,
    airconTimers,
    tempAuto: state.tempAuto,
    wallbox: state.wallbox,
    wallboxEnabled,
    wallboxHistory: state.wallboxHistory,
    infigy: state.infigy,
    infigyEnabled,
    assistantEnabled: !!process.env.ANTHROPIC_API_KEY,
    assistantLog: state.assistantLog,
    nukiEnabled,
    pushEnabled,
    lockEnabled
  };
}

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Heartbeat, ať spojení nezabije proxy kvůli nečinnosti
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}, 25000);

// ---------- Solax ----------

async function fetchSolax() {
  if (!SOLAX_TOKEN_ID || !SOLAX_SN) {
    throw Object.assign(new Error('Server není nakonfigurován (chybí SOLAX_TOKEN_ID / SOLAX_SN).'), { status: 500 });
  }

  const url = `${SOLAX_URL}?tokenId=${encodeURIComponent(SOLAX_TOKEN_ID)}&sn=${encodeURIComponent(SOLAX_SN)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!response.ok) {
    throw Object.assign(new Error(`Solax API HTTP ${response.status}`), { status: 502 });
  }

  const data = await response.json();

  if (!data.success) {
    throw Object.assign(new Error(data.exception || 'Solax API vrátilo chybu.'), { status: 502 });
  }

  const r = data.result;
  const dc1 = typeof r.powerdc1 === 'number' ? r.powerdc1 : 0;
  const dc2 = typeof r.powerdc2 === 'number' ? r.powerdc2 : 0;
  const dc3 = typeof r.powerdc3 === 'number' ? r.powerdc3 : 0;
  const dc4 = typeof r.powerdc4 === 'number' ? r.powerdc4 : 0;
  const fveKw = (dc1 + dc2 + dc3 + dc4) / 1000;
  const feedinKw = (r.feedinpower || 0) / 1000;

  // batPower: kladné = baterie se nabíjí (odebírá výkon), záporné = baterie se vybíjí (dodává výkon)
  const batPower = typeof r.batPower === 'number' ? r.batPower : 0;
  // Spotřeba domu = výroba FVE - výkon spotřebovaný na nabíjení baterie - přetok do sítě
  // (pokud baterie vybíjí, batPower je záporné, takže odečtení záporného čísla spotřebu zvýší - správně)
  // Wallbox odečteme, ať v "spotřebě domu" nefiguruje nabíjení auta
  const wallboxW = (state.wallbox && typeof state.wallbox.power === 'number') ? state.wallbox.power : 0;
  const houseKw = Math.max(0, (dc1 + dc2 + dc3 + dc4 - batPower - (r.feedinpower || 0) - wallboxW) / 1000);
  const batterySoc = typeof r.soc === 'number' ? r.soc : null;

  return {
    fveKw,
    feedinKw,
    houseKw,
    wallboxKw: wallboxW / 1000,
    batterySoc,
    batPowerKw: batPower / 1000,
    yieldToday: typeof r.yieldtoday === 'number' ? r.yieldtoday : null, // skutečná výroba FVE za dnešek (kWh)
    uploadTime: r.uploadTime,
    fetchedAt: new Date().toISOString()
  };
}

app.get('/api/solax', async (req, res) => {
  try {
    const data = await fetchSolax();
    res.json(data);
  } catch (err) {
    const status = err.status || 502;
    const message = err.name === 'TimeoutError' ? 'Solax API neodpovědělo včas.' : err.message;
    res.status(status).json({ error: message });
  }
});

async function pollSolax() {
  try {
    const data = await fetchSolax();
    state.solax = data;

    // Bod do historie přidáváme max. jednou za 30 s (ruční refresh nemá plnit graf duplicitami)
    let historyPoint = null;
    const last = state.history[state.history.length - 1];
    if (!last || Date.now() - last.t > 30000) {
      historyPoint = { t: Date.now(), kw: data.feedinKw };
      state.history.push(historyPoint);
      pruneHistory();
    }

    checkBatteryFull(data.batterySoc);
    broadcast('solax', { solax: state.solax, historyPoint });
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'Solax API neodpovědělo včas.' : err.message;
    broadcast('solaxError', { error: message });
  }
}

// ---------- Shelly ----------

async function fetchShellyStatus(serverUri, deviceId) {
  if (!SHELLY_AUTH_KEY || !serverUri || !deviceId) {
    throw Object.assign(new Error('Server není nakonfigurován pro toto zařízení.'), { status: 500 });
  }

  const cacheKey = deviceId;
  const cached = shellyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  const url = `https://${serverUri}/device/status`;
  const body = new URLSearchParams({
    id: deviceId,
    auth_key: SHELLY_AUTH_KEY
  });

  const response = await shellyQueued(() => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  }));

  if (!response.ok) {
    // Pokud máme starší cache, raději vrátíme ji než tvrdou chybu (typicky při rate limitu 429)
    if (cached) return cached.value;
    // 429 propouštíme dál, ať volající ví, že má počkat a zkusit to znovu
    const status = response.status === 429 ? 429 : 502;
    throw Object.assign(new Error(`Shelly API HTTP ${response.status}`), { status });
  }

  const data = await response.json();

  if (!data.isok) {
    if (cached) return cached.value;
    throw Object.assign(new Error('Shelly API vrátilo chybu.'), { status: 502 });
  }

  const status = data.data?.device_status;
  const online = data.data?.online;

  // Gen1 relé má klíč "relays": [{ ison: true/false }], Gen2+/Gen3 má "switch:0": { output: true/false }
  let isOn = null;
  let powerW = null;
  if (status?.relays && Array.isArray(status.relays) && status.relays.length > 0) {
    isOn = status.relays[0].ison;
    if (typeof status.relays[0].power === 'number') powerW = status.relays[0].power;
  } else if (status?.['switch:0']) {
    isOn = status['switch:0'].output;
    if (typeof status['switch:0'].apower === 'number') powerW = status['switch:0'].apower;
  }

  const result = { online: !!online, isOn, powerW };
  shellyCache.set(cacheKey, { value: result, ts: Date.now() });
  return result;
}

async function fetchShellyPowerW(deviceId) {
  const cacheKey = 'pm_' + deviceId;
  const cached = shellyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  try {
    const url = `https://${SHELLY_SERVER_URI}/device/status`;
    const body = new URLSearchParams({ id: deviceId, auth_key: SHELLY_AUTH_KEY });
    const response = await shellyQueued(() => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000)
    }));
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.isok) return null;
    const status = data.data?.device_status;
    let powerW = null;
    if (typeof status?.['switch:0']?.apower === 'number') powerW = status['switch:0'].apower;
    else if (typeof status?.['pm1:0']?.apower === 'number') powerW = status['pm1:0'].apower;
    else if (typeof status?.['em:0']?.act_power === 'number') powerW = status['em:0'].act_power;
    else if (status?.meters?.[0] && typeof status.meters[0].power === 'number') powerW = status.meters[0].power;

    shellyCache.set(cacheKey, { value: powerW, ts: Date.now() });
    return powerW;
  } catch {
    return null;
  }
}

async function pollDevice(key) {
  const dev = DEVICES[key];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const status = await fetchShellyStatus(dev.serverUri, dev.deviceId);
      state.devices[key] = { ...status, fetchedAt: new Date().toISOString() };
      break;
    } catch (err) {
      if (err.status === 429 && attempt === 0) {
        await delay(2500);
        continue;
      }
      state.devices[key] = { online: false, isOn: null, powerW: null, fetchedAt: new Date().toISOString() };
      break;
    }
  }
  broadcast('device', { key, status: state.devices[key] });
}

let shellyPollRunning = false;

async function pollShelly() {
  if (shellyPollRunning) return;
  shellyPollRunning = true;
  try {
    // Rozestupy mezi dotazy hlídá globální fronta shellyQueued
    for (const key of Object.keys(DEVICES)) {
      await pollDevice(key);
    }

    const powers = [];
    for (let i = 0; i < POOL_PM_IDS.length; i++) {
      powers.push(await fetchShellyPowerW(POOL_PM_IDS[i]));
    }
    const valid = powers.filter(p => typeof p === 'number');
    state.poolPowerW = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) : null;
    broadcast('poolPower', { totalPowerW: state.poolPowerW });

    updateRuntimes();
  } finally {
    shellyPollRunning = false;
  }
}

// Dnešní doba běhu bojleru/bazénu/solinátoru; nuluje se o pražské půlnoci
function updateRuntimes() {
  const today = pragueDateString();
  const now = Date.now();
  const dt = Math.min(now - state.runtime.lastTs, 10 * 60 * 1000);
  if (state.runtime.date !== today) {
    state.runtime.date = today;
    state.runtime.ms = { shelly: 0, pool: 0, solinator: 0 };
  }
  for (const k of Object.keys(state.runtime.ms)) {
    if (state.devices[k] && state.devices[k].isOn === true) {
      state.runtime.ms[k] += dt;
      // Časová osa: prodloužíme běžící segment, nebo začneme nový
      const segs = state.timeline[k];
      const last = segs[segs.length - 1];
      if (last && now - last.to <= TIMELINE_GAP_MS) {
        last.to = now;
      } else {
        segs.push({ from: now, to: now });
      }
    }
  }
  // Wallbox: aktivní kdykoli výkon > 0 W (nepočítá se do doby běhu relé)
  const wbW = state.wallbox && typeof state.wallbox.power === 'number' ? state.wallbox.power : 0;
  if (wbW > 0) {
    const segs = state.timeline.wallbox;
    const last = segs[segs.length - 1];
    if (last && now - last.to <= TIMELINE_GAP_MS) {
      last.to = now;
    } else {
      segs.push({ from: now, to: now });
    }
  }
  state.runtime.lastTs = now;
  pruneTimeline();
  broadcast('runtime', { runtime: { date: state.runtime.date, ms: state.runtime.ms } });
  broadcast('timeline', { timeline: state.timeline });
}

// ---------- REST endpointy (stav se servíruje z centrálního stavu) ----------

function registerStatusEndpoint(key) {
  const dev = DEVICES[key];
  app.get(dev.apiPath, async (req, res) => {
    if (state.devices[key]) {
      return res.json(state.devices[key]);
    }
    try {
      const result = await fetchShellyStatus(dev.serverUri, dev.deviceId);
      res.json({ ...result, fetchedAt: new Date().toISOString() });
    } catch (err) {
      const status = err.status || 502;
      const message = err.name === 'TimeoutError' ? 'Shelly API neodpovědělo včas.' : err.message;
      res.status(status).json({ error: message });
    }
  });
}

async function setShellyState(serverUri, deviceId, turn) {
  if (!SHELLY_AUTH_KEY || !serverUri || !deviceId) {
    throw Object.assign(new Error('Server není nakonfigurován pro toto zařízení.'), { status: 500 });
  }

  const url = `https://${serverUri}/device/relay/control`;
  const body = new URLSearchParams({
    id: deviceId,
    auth_key: SHELLY_AUTH_KEY,
    channel: '0',
    turn
  });

  // Shelly Cloud občas příkaz přechodně odmítne (401 při throttlu, 429, 5xx).
  // Manuální i asistentův příkaz jdou stejnou cestou — pár pokusů s odstupem
  // to spolehlivě dotáhne, místo aby to asistent rovnou vzdal.
  const TRANSIENT = [401, 408, 429, 500, 502, 503, 504];
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await delay(1200 * attempt);
    let response;
    try {
      response = await shellyQueued(() => fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10000)
      }));
    } catch (err) {
      lastErr = Object.assign(new Error(err.name === 'TimeoutError' ? 'Shelly API neodpovědělo včas.' : err.message), { status: 502 });
      continue; // síťová chyba/timeout — zkusit znovu
    }

    if (response.ok) {
      const data = await response.json();
      if (data.isok) {
        // Po úspěšném přepnutí zneplatníme cache, ať se hned ukáže nový stav
        shellyCache.delete(deviceId);
        return;
      }
      lastErr = Object.assign(new Error('Shelly API odmítlo příkaz.'), { status: 502 });
      continue; // isok=false bývá taky přechodné — zkusit znovu
    }

    lastErr = Object.assign(new Error(`Shelly API HTTP ${response.status}`), { status: 502 });
    if (!TRANSIENT.includes(response.status)) break; // trvalá chyba — nemá smysl opakovat
  }
  throw lastErr;
}

function registerSetEndpoint(key) {
  const dev = DEVICES[key];
  app.post(dev.apiPath + '/set', async (req, res) => {
    if (!requireAuth(req, res)) return;
    const { turn } = req.body || {};
    if (turn !== 'on' && turn !== 'off') {
      return res.status(400).json({ error: 'Parametr turn musí být "on" nebo "off".' });
    }
    try {
      await setShellyState(dev.serverUri, dev.deviceId, turn);

      // Optimistická aktualizace, ať klienti vidí nový stav okamžitě
      const prev = state.devices[key] || {};
      state.devices[key] = { ...prev, online: true, isOn: turn === 'on', fetchedAt: new Date().toISOString() };
      broadcast('device', { key, status: state.devices[key] });
      addLog(`${DEVICE_LABELS[key]}: ${turn === 'on' ? 'zapnuto' : 'vypnuto'} ručně`);

      res.json({ success: true, turn });

      // Za chvíli ověříme skutečný stav ze Shelly cloudu
      setTimeout(() => { pollDevice(key); }, 1500);
    } catch (err) {
      const status = err.status || 502;
      const message = err.name === 'TimeoutError' ? 'Shelly API neodpovědělo včas.' : err.message;
      res.status(status).json({ error: message });
    }
  });
}

for (const key of Object.keys(DEVICES)) {
  registerStatusEndpoint(key);
  registerSetEndpoint(key);
}

app.get('/api/pool/power', (req, res) => {
  res.json({ totalPowerW: state.poolPowerW });
});

// Obnova historie grafu po restartu/deployi: klient pošle svou kopii z localStorage
// a server si doplní body, které mu chybí
app.post('/api/history/restore', (req, res) => {
  const points = req.body && Array.isArray(req.body.points) ? req.body.points : null;
  if (!points) return res.status(400).json({ error: 'Chybí points.' });

  const now = Date.now();
  const cutoff = now - HISTORY_MAX_AGE_MS;
  const clean = points
    .filter(p => p && typeof p.t === 'number' && typeof p.kw === 'number'
      && p.t >= cutoff && p.t <= now && p.kw > -100 && p.kw < 100)
    .slice(0, 2000);
  if (!clean.length) return res.json({ added: 0 });

  const before = state.history.length;
  const all = state.history.concat(clean).sort((a, b) => a.t - b.t);
  const merged = [];
  for (const p of all) {
    if (!merged.length || p.t - merged[merged.length - 1].t > 30000) merged.push(p);
  }
  state.history = merged;
  pruneHistory();
  const added = state.history.length - before;
  if (added > 0) broadcast('history', { history: state.history });
  res.json({ added });
});

// Obnova historie výkonu wallboxu po restartu/deployi — stejný princip jako u přetoku
app.post('/api/wallbox-history/restore', (req, res) => {
  const points = req.body && Array.isArray(req.body.points) ? req.body.points : null;
  if (!points) return res.status(400).json({ error: 'Chybí points.' });

  const now = Date.now();
  const cutoff = now - HISTORY_MAX_AGE_MS;
  const clean = points
    .filter(p => p && typeof p.t === 'number' && typeof p.w === 'number'
      && p.t >= cutoff && p.t <= now && p.w >= 0 && p.w < 100000)
    .slice(0, 2000);
  if (!clean.length) return res.json({ added: 0 });

  const before = state.wallboxHistory.length;
  const all = state.wallboxHistory.concat(clean).sort((a, b) => a.t - b.t);
  const merged = [];
  for (const p of all) {
    if (!merged.length || p.t - merged[merged.length - 1].t > 30000) merged.push(p);
  }
  state.wallboxHistory = merged;
  pruneHistory();
  const added = state.wallboxHistory.length - before;
  if (added > 0) broadcast('wallboxHistory', { history: state.wallboxHistory });
  res.json({ added });
});

// Obnova logu po restartu/deployi — stejný princip jako u historie grafu
app.post('/api/log/restore', (req, res) => {
  const entries = req.body && Array.isArray(req.body.entries) ? req.body.entries : null;
  if (!entries) return res.status(400).json({ error: 'Chybí entries.' });

  const now = Date.now();
  const cutoff = now - HISTORY_MAX_AGE_MS;
  const clean = entries
    .filter(e => e && typeof e.t === 'number' && typeof e.msg === 'string'
      && e.msg.length > 0 && e.msg.length <= 300 && e.t >= cutoff && e.t <= now)
    .slice(0, 1000);
  if (!clean.length) return res.json({ added: 0 });

  const before = state.log.length;
  const seen = new Set();
  const merged = [];
  for (const e of state.log.concat(clean)) {
    const key = e.t + '|' + e.msg;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ t: e.t, msg: e.msg });
    }
  }
  merged.sort((a, b) => a.t - b.t);
  state.log = merged;
  pruneHistory();
  const added = state.log.length - before;
  if (added > 0) broadcast('logAll', { log: state.log });
  res.json({ added });
});

// Obnova dnešní doby běhu po restartu/deployi — klient pošle svou kopii,
// server si vezme vyšší hodnoty (jen pro dnešní pražské datum)
app.post('/api/runtime/restore', (req, res) => {
  const { date, ms } = req.body || {};
  if (typeof date !== 'string' || !ms || typeof ms !== 'object') {
    return res.status(400).json({ error: 'Chybí date/ms.' });
  }
  if (date !== pragueDateString()) return res.json({ ok: false });

  if (state.runtime.date !== date) {
    state.runtime.date = date;
    state.runtime.ms = { shelly: 0, pool: 0, solinator: 0 };
  }
  let changed = false;
  for (const k of Object.keys(state.runtime.ms)) {
    const v = Number(ms[k]);
    if (Number.isFinite(v) && v > state.runtime.ms[k] && v <= 24 * 60 * 60 * 1000) {
      state.runtime.ms[k] = v;
      changed = true;
    }
  }
  if (changed) {
    broadcast('runtime', { runtime: { date: state.runtime.date, ms: state.runtime.ms } });
  }
  res.json({ ok: true });
});

// Obnova časové osy po restartu/deployi — sloučení segmentů z telefonu
app.post('/api/timeline/restore', (req, res) => {
  const tl = req.body && req.body.timeline;
  if (!tl || typeof tl !== 'object') {
    return res.status(400).json({ error: 'Chybí timeline.' });
  }
  const now = Date.now();
  const cutoff = now - TIMELINE_MAX_AGE_MS;
  let changed = false;
  // Klíče: pevná zařízení + dynamické klimatizace (ac_<guid>)
  const validKey = k => /^(shelly|pool|solinator|wallbox|ac_[\w+/=.:-]{1,64})$/.test(k);
  const keys = new Set([...Object.keys(state.timeline), ...Object.keys(tl).filter(validKey)]);
  for (const k of Array.from(keys).slice(0, 16)) {
    if (!state.timeline[k]) state.timeline[k] = [];
    const incoming = Array.isArray(tl[k]) ? tl[k] : [];
    const clean = incoming
      .filter(s => s && typeof s.from === 'number' && typeof s.to === 'number'
        && s.to > s.from && s.to <= now && s.to >= cutoff)
      .slice(0, 500)
      .map(s => ({ from: Math.max(s.from, cutoff), to: s.to }));
    if (!clean.length) continue;
    const before = JSON.stringify(state.timeline[k]);
    state.timeline[k] = mergeSegments(state.timeline[k].concat(clean));
    if (JSON.stringify(state.timeline[k]) !== before) changed = true;
  }
  if (changed) {
    pruneTimeline();
    broadcast('timeline', { timeline: state.timeline });
  }
  res.json({ ok: true });
});

// Hlavní vypínač automatiky (vyžaduje odemčení stejně jako ovládání relé)
app.post('/api/automation', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Parametr enabled musí být true/false.' });
  }
  if (state.autoEnabled !== enabled) {
    state.autoEnabled = enabled;
    addLog(`Automatika: ${enabled ? 'zapnuta' : 'vypnuta'} ručně`);
    broadcast('automation', { enabled });
  }
  res.json({ enabled: state.autoEnabled });
});

// Teplotní automatika klimatizace — přepínač per pokoj (ložnice/elenka/miky)
app.post('/api/tempauto', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { key, enabled } = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(state.tempAuto, key) || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Neplatný požadavek.' });
  }
  if (state.tempAuto[key] !== enabled) {
    state.tempAuto[key] = enabled;
    const rule = TEMP_AUTO_RULES.find(r => r.key === key);
    addLog(`Teplotní automatika ${rule ? rule.room : key}: ${enabled ? 'zapnuta' : 'vypnuta'}`);
    broadcast('tempAuto', { tempAuto: state.tempAuto });
    if (enabled) {
      delete tempAutoOffAt[key]; // ruční zapnutí automatiky ruší 30min blokaci
      if (panasonicEnabled) setTimeout(pollAircon, 500); // hned vyhodnotit
    }
  }
  res.json({ tempAuto: state.tempAuto });
});

// Ruční refresh z appky: Solax hned, Shelly cyklus na pozadí (chráněný zámkem)
app.post('/api/refresh', async (req, res) => {
  pollShelly();
  await pollSolax();
  res.json({ ok: true });
});

// ---------- Zámek ovládání (PIN) ----------

// Zamykání appky je vypnuté (na přání) — appka jede vždy odemčená, nezávisle na APP_PIN.
const APP_PIN = process.env.APP_PIN;
const lockEnabled = false;
// Token je odvozený z PINu — přežije restart serveru a při změně PINu přestane platit
const UNLOCK_TOKEN = lockEnabled
  ? crypto.createHmac('sha256', APP_PIN).update('solax-unlock-v1').digest('hex')
  : null;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Ochrana proti hádání PINu: max 10 pokusů za 15 minut na IP
const unlockAttempts = new Map();
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function registerFailedAttempt(ip) {
  const rec = unlockAttempts.get(ip);
  if (!rec || Date.now() > rec.resetAt) {
    unlockAttempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
  } else {
    rec.count++;
  }
}

function tooManyAttempts(ip) {
  const rec = unlockAttempts.get(ip);
  return !!rec && Date.now() <= rec.resetAt && rec.count >= ATTEMPT_LIMIT;
}

app.post('/api/unlock', (req, res) => {
  if (!lockEnabled) return res.json({ token: null, lockEnabled: false });
  if (tooManyAttempts(req.ip)) {
    return res.status(429).json({ error: 'Příliš mnoho pokusů, zkus to za chvíli.' });
  }
  const { pin } = req.body || {};
  if (typeof pin === 'string' && safeEqual(pin, APP_PIN)) {
    unlockAttempts.delete(req.ip);
    return res.json({ token: UNLOCK_TOKEN, lockEnabled: true });
  }
  registerFailedAttempt(req.ip);
  res.status(401).json({ error: 'Nesprávný kód.' });
});

app.post('/api/unlock/check', (req, res) => {
  const { token } = req.body || {};
  const valid = !lockEnabled || (typeof token === 'string' && token.length > 0 && safeEqual(token, UNLOCK_TOKEN));
  res.json({ valid, lockEnabled });
});

function requireAuth(req, res) {
  if (!lockEnabled) return true;
  const token = req.get('X-Auth-Token');
  if (typeof token === 'string' && token.length > 0 && safeEqual(token, UNLOCK_TOKEN)) return true;
  res.status(401).json({ error: 'Ovládání je zamčené — odemkni appku kódem.' });
  return false;
}

// ---------- Push notifikace (plná baterie) ----------

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:smogrovic@gmail.com';
const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.log('Push notifikace vypnuty (chybí VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).');
}

// Subscriptions jsou jen v paměti — klient se proto při každém otevření appky přihlásí znovu
const pushSubscriptions = new Map();

app.get('/api/push/vapid-key', (req, res) => {
  if (!pushEnabled) {
    return res.status(503).json({ error: 'Push není na serveru nastaven (chybí VAPID klíče).' });
  }
  res.json({ key: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ error: 'Neplatná subscription.' });
  }
  pushSubscriptions.set(sub.endpoint, sub);
  res.json({ ok: true });
});

async function sendPushToAll(title, bodyText) {
  if (!pushEnabled) return;
  const payload = JSON.stringify({ title, body: bodyText });
  for (const [endpoint, sub] of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      // 404/410 = subscription už neplatí
      if (err.statusCode === 404 || err.statusCode === 410) {
        pushSubscriptions.delete(endpoint);
      }
    }
  }
}

// Notifikaci pošleme jednou při dosažení 99 %; znovu se odjistí, až baterie klesne pod 90 %
let batteryFullNotified = false;

function checkBatteryFull(soc) {
  if (typeof soc !== 'number') return;
  if (soc >= 99 && !batteryFullNotified) {
    batteryFullNotified = true;
    sendPushToAll('🔋 Baterie je plná', `Baterie je nabitá na ${Math.round(soc)} %.`);
  } else if (soc <= 90) {
    batteryFullNotified = false;
  }
}

// ---------- Automatika přebytků (nahrazuje skripty v Shelly aplikaci) ----------

const OWM_API_KEY = process.env.OWM_API_KEY;
const WEATHER_LAT = 49.765;
const WEATHER_LON = 14.688;
const AUTOMATION_INTERVAL_MS = 5 * 60 * 1000;

// Bazén: spíná při velkém přebytku (přetok do sítě + nabíjení baterie)
const POOL_ON_THRESHOLD_W = 1850;
const POOL_OFF_THRESHOLD_W = -200;
const POOL_MIN_RUN_MS = 30 * 60 * 1000;
// Bojler: rychlá ochrana při velkém odběru ze sítě
const BOILER_QUICK_OFF_W = -300;

const poolAuto = { overCount: 0, underCount: 0, lastOnTime: 0 };
const solinatorAuto = { done13: '', done15: '' };

let weatherCache = { ts: 0, data: null };

async function fetchWeather() {
  if (!OWM_API_KEY) return null;
  if (weatherCache.data && Date.now() - weatherCache.ts < 15 * 60 * 1000) {
    return weatherCache.data;
  }
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${WEATHER_LAT}&lon=${WEATHER_LON}&appid=${OWM_API_KEY}&units=metric`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return weatherCache.data;
    const data = await res.json();
    if (!data.sys || data.sys.sunset === undefined) return weatherCache.data;
    weatherCache = { ts: Date.now(), data };

    // Uložíme i pro zobrazení v appce (teplota venku + kdy automatika vypíná)
    const tempC = data.main && typeof data.main.temp === 'number' ? data.main.temp : null;
    state.weather = { tempC, sunsetMs: data.sys.sunset * 1000, fetchedAt: new Date().toISOString() };
    broadcast('weather', { weather: state.weather });

    return data;
  } catch {
    return weatherCache.data;
  }
}

// Server na Renderu běží v UTC — všechny časové podmínky počítáme v Europe/Prague
function pragueTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = type => Number(parts.find(p => p.type === type).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}

function pragueDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date());
}

function formatKwLog(w) {
  return (w / 1000).toFixed(1).replace('.', ',') + ' kW';
}

async function autoSet(key, turn, reason) {
  const dev = DEVICES[key];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await setShellyState(dev.serverUri, dev.deviceId, turn);
      state.devices[key] = { ...(state.devices[key] || {}), online: true, isOn: turn === 'on', fetchedAt: new Date().toISOString() };
      broadcast('device', { key, status: state.devices[key] });
      addLog(`${DEVICE_LABELS[key]}: ${turn === 'on' ? 'zapnuto' : 'vypnuto'} (${reason})`);
      return true;
    } catch (err) {
      if (attempt === 0) {
        await delay(2500);
        continue;
      }
      addLog(`${DEVICE_LABELS[key]}: příkaz automatiky selhal (${err.message})`);
      return false;
    }
  }
  return false;
}

async function runPoolAutomation(now, prague, weather, totalW, soc) {
  const pool = state.devices.pool;
  if (!pool || pool.isOn === null || pool.isOn === undefined) return; // stav neznámý → beze změny
  const isOn = pool.isOn;

  // Hodinu před západem slunce se vypíná natvrdo
  const sunsetMs = weather.sys.sunset * 1000;
  if (now >= sunsetMs - 3600000) {
    if (isOn) await autoSet('pool', 'off', 'západ slunce');
    poolAuto.overCount = 0;
    poolAuto.underCount = 0;
    return;
  }

  if (prague.hour < 8) return;

  // Fix po restartu serveru: bazén už běží, ale nemáme čas zapnutí
  if (poolAuto.lastOnTime === 0 && isOn) poolAuto.lastOnTime = now;

  // Ochrana baterie: čím později odpoledne, tím nabitější musí být
  let minSoc = 0;
  if (prague.hour >= 17) minSoc = 90;
  else if (prague.hour >= 16) minSoc = 85;
  else if (prague.hour >= 15) minSoc = 80;
  else if (prague.hour >= 14) minSoc = 70;
  else if (prague.hour >= 13) minSoc = 60;
  else if (prague.hour >= 12) minSoc = 50;

  if (typeof soc === 'number' && soc < minSoc) {
    if (isOn) await autoSet('pool', 'off', `nízké nabití baterie (${Math.round(soc)} %)`);
    poolAuto.overCount = 0;
    poolAuto.underCount = 0;
    return;
  }

  // Zapnutí: 2× po sobě nad prahem
  if (totalW > POOL_ON_THRESHOLD_W) {
    poolAuto.overCount++;
    if (poolAuto.overCount >= 2 && !isOn) {
      await autoSet('pool', 'on', `přetok ${formatKwLog(totalW)}`);
      poolAuto.lastOnTime = now;
      poolAuto.overCount = 0;
      poolAuto.underCount = 0;
      return;
    }
  } else {
    poolAuto.overCount = 0;
  }

  // Vypnutí: 3× po sobě pod prahem a minimálně 30 min běhu
  if (totalW < POOL_OFF_THRESHOLD_W) {
    poolAuto.underCount++;
  } else {
    poolAuto.underCount = 0;
  }

  if (poolAuto.underCount >= 3 && isOn && now - poolAuto.lastOnTime >= POOL_MIN_RUN_MS) {
    await autoSet('pool', 'off', `odběr ze sítě ${formatKwLog(totalW)}`);
    poolAuto.overCount = 0;
    poolAuto.underCount = 0;
  }
}

// Bojler si pamatuje svůj skutečný příkon (default 2 kW), aby se nezapínal
// při přebytku, který ho stejně neutáhne, a nevypínal kvůli jedinému výkyvu
const boilerAuto = { nominalW: 2000, underCount: 0, lastOnTime: 0 };
const BOILER_HARD_OFF_W = -1500;          // okamžité vypnutí při silném odběru
const BOILER_MIN_RUN_MS = 10 * 60 * 1000; // mírný deficit toleruje aspoň 10 min

async function runBoilerAutomation(now, prague, weather, totalW, soc) {
  const boiler = state.devices.shelly;
  if (!boiler || boiler.isOn === null || boiler.isOn === undefined) return;
  const isOn = boiler.isOn;

  // Zapamatujeme si reálný příkon topné spirály, když zrovna topí
  if (isOn && typeof boiler.powerW === 'number' && boiler.powerW > 500) {
    boilerAuto.nominalW = boiler.powerW;
  }
  // Fix po restartu serveru: bojler už topí, ale nemáme čas zapnutí
  if (boilerAuto.lastOnTime === 0 && isOn) boilerAuto.lastOnTime = now;

  const sunsetMs = weather.sys.sunset * 1000;
  if (now >= sunsetMs - 3600000 || prague.hour < 10) {
    if (isOn) await autoSet('shelly', 'off', prague.hour < 10 ? 'ráno' : 'západ slunce');
    boilerAuto.underCount = 0;
    return;
  }

  // Bojler smí topit jen když běží bazén
  const pool = state.devices.pool;
  if (!pool || pool.isOn === null || pool.isOn === undefined) return; // stav neznámý → beze změny
  if (!pool.isOn) {
    if (isOn) await autoSet('shelly', 'off', 'bazén neběží');
    boilerAuto.underCount = 0;
    return;
  }

  if (isOn) {
    if (totalW < BOILER_HARD_OFF_W) {
      // Silný odběr (něco velkého běží) → hned vypnout
      await autoSet('shelly', 'off', `odběr ze sítě ${formatKwLog(totalW)}`);
      boilerAuto.underCount = 0;
      return;
    }
    if (totalW < BOILER_QUICK_OFF_W) {
      // Mírný deficit: až 2× po sobě a po min. době běhu — jeden mrak bojler nevypne
      boilerAuto.underCount++;
      if (boilerAuto.underCount >= 2 && now - boilerAuto.lastOnTime >= BOILER_MIN_RUN_MS) {
        await autoSet('shelly', 'off', `odběr ze sítě ${formatKwLog(totalW)}`);
        boilerAuto.underCount = 0;
      }
      return;
    }
    boilerAuto.underCount = 0;
    return; // topí a vydělá si na sebe → drží stav
  }

  // Zapnutí: práh podle nabití baterie, ale vždy aspoň tolik,
  // aby přebytek skutečný příkon bojleru pokryl (s tolerancí 300 W)
  let socThreshold = 1400;
  if (typeof soc === 'number' && soc < 50) socThreshold = 2600;
  else if (typeof soc === 'number' && soc < 80) socThreshold = 2000;
  const threshold = Math.max(socThreshold, boilerAuto.nominalW - 300);

  if (totalW > threshold) {
    await autoSet('shelly', 'on', `přetok ${formatKwLog(totalW)}`);
    boilerAuto.lastOnTime = now;
    boilerAuto.underCount = 0;
  }
}

async function runSolinatorAutomation(now, prague, weather) {
  const sol = state.devices.solinator;
  const today = pragueDateString();

  // Večerní vypnutí hodinu před západem (ve původním skriptu chybělo, ale večer se vypíná všechno)
  const sunsetMs = weather.sys.sunset * 1000;
  if (now >= sunsetMs - 3600000) {
    if (sol && sol.isOn) await autoSet('solinator', 'off', 'západ slunce');
    return;
  }

  const temp = weather.main && typeof weather.main.temp === 'number' ? weather.main.temp : null;
  if (temp === null) return;

  // 13:00 → zapnout při venkovní teplotě nad 20 °C
  // Pravidlo se označí za hotové až po úspěchu — po selhání příkazu
  // (nebo neznámém stavu relé) se zopakuje v dalším 5min cyklu
  if (prague.hour === 13 && solinatorAuto.done13 !== today) {
    if (temp > 20) {
      if (sol && sol.isOn === true) {
        solinatorAuto.done13 = today; // už běží
      } else if (sol && sol.isOn === false) {
        if (await autoSet('solinator', 'on', `venku ${Math.round(temp)} °C`)) {
          solinatorAuto.done13 = today;
        }
      }
    } else {
      solinatorAuto.done13 = today;
      addLog(`Solinátor: nezapnut, venku jen ${Math.round(temp)} °C (limit 20 °C)`);
    }
  }

  // 15:00 → zapnout při venkovní teplotě nad 25 °C
  if (prague.hour === 15 && solinatorAuto.done15 !== today) {
    if (temp > 25) {
      if (sol && sol.isOn === true) {
        solinatorAuto.done15 = today;
      } else if (sol && sol.isOn === false) {
        if (await autoSet('solinator', 'on', `venku ${Math.round(temp)} °C`)) {
          solinatorAuto.done15 = today;
        }
      }
    } else {
      solinatorAuto.done15 = today;
      if (!(sol && sol.isOn)) {
        addLog(`Solinátor: nezapnut, venku jen ${Math.round(temp)} °C (limit 25 °C)`);
      }
    }
  }
}

let automationRunning = false;
let weatherProblemLogged = false;

async function runAutomation() {
  if (automationRunning) return;
  automationRunning = true;
  try {
    // Bez čerstvých dat ze střídače (max 10 min starých) nerozhodujeme
    if (!state.solax) return;
    if (Date.now() - new Date(state.solax.fetchedAt).getTime() > 10 * 60 * 1000) return;

    const weather = await fetchWeather();
    if (!weather) {
      if (!weatherProblemLogged) {
        weatherProblemLogged = true;
        addLog(OWM_API_KEY
          ? 'Automatika: počasí se nepodařilo načíst'
          : 'Automatika vypnuta — na serveru chybí OWM_API_KEY');
      }
      return;
    }
    weatherProblemLogged = false;

    // Hlavní vypínač: počasí se stahuje dál (kvůli zobrazení), ale zařízení nesaháme
    if (!state.autoEnabled) return;

    const now = Date.now();
    const prague = pragueTime();
    // "Přebytek" = přetok do sítě + výkon nabíjející baterii (stejně jako v původních skriptech)
    const totalW = Math.round((state.solax.feedinKw + state.solax.batPowerKw) * 1000);
    const soc = state.solax.batterySoc;

    await runPoolAutomation(now, prague, weather, totalW, soc);
    await runBoilerAutomation(now, prague, weather, totalW, soc);
    await runSolinatorAutomation(now, prague, weather);
  } catch (err) {
    console.error('Automatika:', err.message);
  } finally {
    automationRunning = false;
  }
}

setTimeout(runAutomation, 30000); // první běh až poté, co poller stihne načíst stavy
setInterval(runAutomation, AUTOMATION_INTERVAL_MS);

// ---------- TaHoma (Somfy rolety přes Overkiz cloud) ----------

const TAHOMA_EMAIL = process.env.TAHOMA_EMAIL;
const TAHOMA_PASSWORD = process.env.TAHOMA_PASSWORD;
const TAHOMA_BASE = 'https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI';
const tahomaEnabled = !!(TAHOMA_EMAIL && TAHOMA_PASSWORD);

let tahomaCookie = null;

async function tahomaLogin() {
  const body = new URLSearchParams({ userId: TAHOMA_EMAIL, userPassword: TAHOMA_PASSWORD });
  const res = await fetch(`${TAHOMA_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    throw Object.assign(new Error(`TaHoma přihlášení selhalo (HTTP ${res.status})`), { status: 502 });
  }
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/JSESSIONID=[^;]+/);
  if (!m) throw Object.assign(new Error('TaHoma nevrátila session cookie.'), { status: 502 });
  tahomaCookie = m[0];
}

async function tahomaFetch(path, options = {}, retried) {
  if (!tahomaEnabled) {
    throw Object.assign(new Error('TaHoma není nakonfigurována (chybí TAHOMA_EMAIL / TAHOMA_PASSWORD).'), { status: 500 });
  }
  if (!tahomaCookie) await tahomaLogin();
  const res = await fetch(`${TAHOMA_BASE}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: tahomaCookie },
    signal: AbortSignal.timeout(15000)
  });
  if (res.status === 401 && !retried) {
    tahomaCookie = null; // session vypršela → přihlásíme se znovu
    return tahomaFetch(path, options, true);
  }
  if (!res.ok) {
    throw Object.assign(new Error(`TaHoma API HTTP ${res.status}`), { status: 502 });
  }
  // Některé endpointy (refreshStates) vrací prázdné tělo
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let blindsCache = { ts: 0, list: [] };

async function getBlinds() {
  if (blindsCache.list.length && Date.now() - blindsCache.ts < 60 * 1000) {
    return blindsCache.list;
  }

  // Cloud drží stavy naposledy nahlášené bránou — když roletou pohnul ovladač
  // nebo sluneční automatika, jsou zastaralé. Požádáme o obnovu a chvíli počkáme.
  try {
    await tahomaFetch('/setup/devices/refreshStates', { method: 'POST' });
    await delay(1500);
  } catch {}

  const devices = await tahomaFetch('/setup/devices');

  // Názvy místností: strom míst z TaHomy → mapa placeOID -> label
  const placeMap = {};
  try {
    const flatten = place => {
      if (!place || !place.oid) return;
      placeMap[place.oid] = place.label;
      for (const sub of place.subPlaces || []) flatten(sub);
    };
    flatten(await tahomaFetch('/setup/places'));
  } catch {}

  // Bereme všechno, co umí jezdit (up/down/open/close/deploy) — rolety, screeny,
  // markýzy, pergoly… — a vylučujeme jen centrálu, ovladače a senzory
  const EXCLUDED_UI = ['Pod', 'ProtocolGateway', 'NetworkComponent', 'RemoteController',
    'ElectricitySensor', 'TemperatureSensor', 'LightSensor', 'HumiditySensor',
    'ContactSensor', 'OccupancySensor', 'Alarm', 'Siren'];
  const list = devices
    .map(d => {
      // RTS rolety umí up/down/stop/my, io open/close/stop, pergoly deploy/undeploy
      const cmds = new Set(((d.definition && d.definition.commands) || []).map(c => c.commandName));
      // Poloha a naklopení: io zařízení je hlásí ve states, RTS ne (jednosměrný protokol)
      const states = {};
      for (const s of d.states || []) states[s.name] = s.value;
      const closure = typeof states['core:ClosureState'] === 'number'
        ? states['core:ClosureState']
        : (typeof states['core:DeploymentState'] === 'number' ? states['core:DeploymentState'] : null);
      const orientation = typeof states['core:SlateOrientationState'] === 'number'
        ? states['core:SlateOrientationState']
        : null;
      const onState = states['core:OnOffState'] === 'on' ? true
        : (states['core:OnOffState'] === 'off' ? false : null);
      const commands = {
        up: cmds.has('up') ? 'up' : (cmds.has('open') ? 'open' : (cmds.has('deploy') ? 'deploy' : null)),
        down: cmds.has('down') ? 'down' : (cmds.has('close') ? 'close' : (cmds.has('undeploy') ? 'undeploy' : null)),
        stop: cmds.has('stop') ? 'stop' : (cmds.has('my') ? 'my' : null),
        my: cmds.has('my') ? 'my' : null,
        on: cmds.has('on') ? 'on' : null,
        off: cmds.has('off') ? 'off' : null,
        orientation: cmds.has('setOrientation') ? 'setOrientation' : null,
        closureOrientation: cmds.has('setClosureAndOrientation') ? 'setClosureAndOrientation' : null
      };
      // cover = jezdí nahoru/dolů; switch = spíná (světlo na terase apod.)
      // Světla jsou vždy spínač, i když umí up/down (stmívání) — v appce mají ON/OFF
      const type = (d.uiClass === 'Light' && commands.on && commands.off) ? 'switch'
        : ((commands.up && commands.down) ? 'cover'
        : ((commands.on && commands.off) ? 'switch' : null));
      return {
        deviceURL: d.deviceURL,
        label: d.label,
        uiClass: d.uiClass,
        type,
        room: placeMap[d.placeOID] || 'Ostatní',
        closure,
        orientation,
        onState,
        commands
      };
    })
    .filter(d => !EXCLUDED_UI.includes(d.uiClass) && d.type)
    .sort((a, b) => a.room.localeCompare(b.room, 'cs') || a.label.localeCompare(b.label, 'cs'));
  blindsCache = { ts: Date.now(), list };
  return list;
}

// Diagnostika: co všechno TaHoma vrací (typy a povely) — pro ladění filtru
app.get('/api/blinds/all', async (req, res) => {
  if (!tahomaEnabled) return res.json({ enabled: false });
  try {
    const devices = await tahomaFetch('/setup/devices');
    res.json(devices.map(d => ({
      label: d.label,
      uiClass: d.uiClass,
      controllableName: d.controllableName,
      commands: ((d.definition && d.definition.commands) || []).map(c => c.commandName),
      states: Object.fromEntries((d.states || [])
        .filter(s => s.name.startsWith('core:'))
        .map(s => [s.name, s.value]))
    })));
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

async function blindCommand(deviceURL, action, value) {
  const blinds = await getBlinds();
  const blind = blinds.find(b => b.deviceURL === deviceURL);
  if (!blind) throw Object.assign(new Error('Neznámá roleta.'), { status: 400 });
  const cmd = blind.commands[action];
  if (!cmd) throw Object.assign(new Error(`${blind.label}: povel není podporován.`), { status: 400 });

  let commandList = [{ name: cmd, parameters: action === 'orientation' ? [Math.round(value)] : [] }];
  if ((action === 'up' || action === 'down') && Number.isFinite(value) && blind.commands.closureOrientation) {
    // Žaluzie: jeden atomický povel „jeď do krajní polohy s tímto naklopením" —
    // jede kontinuálně (zřetězené up+setOrientation by pohyb hned přerušilo)
    const closure = action === 'down' ? 100 : 0;
    commandList = [{ name: blind.commands.closureOrientation, parameters: [closure, Math.round(value)] }];
  } else if (action === 'stop' && blind.commands.orientation && Number.isFinite(value)) {
    // Po zastavení v mezipoloze se žaluzie ještě naklopí na hodnotu z posuvníku
    commandList = [
      { name: cmd, parameters: [] },
      { name: blind.commands.orientation, parameters: [Math.round(value)] }
    ];
  }

  await tahomaFetch('/exec/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: `Šmogyho FVE: ${blind.label} ${action}`,
      actions: [{ deviceURL, commands: commandList }]
    })
  });
  // Zneplatníme cache, ať se po dojetí načte čerstvá poloha (jinak by /api/blinds
  // vracelo starý closure z 60s cache a ukazatel by se neaktualizoval)
  blindsCache = { ts: 0, list: [] };
  return blind;
}

app.get('/api/blinds', async (req, res) => {
  if (!tahomaEnabled) return res.json({ enabled: false, blinds: [] });
  try {
    const blinds = await getBlinds();
    res.json({
      enabled: true,
      blinds: blinds.map(b => ({
        deviceURL: b.deviceURL,
        label: b.label,
        room: b.room,
        type: b.type,
        uiClass: b.uiClass,
        closure: b.closure,
        orientation: b.orientation,
        onState: b.onState,
        hasStop: !!b.commands.stop,
        hasOrientation: !!b.commands.orientation
      }))
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

const BLIND_ACTION_LABELS = {
  up: 'nahoru', down: 'dolů', stop: 'stop', my: 'moje pozice',
  on: 'zapnuto', off: 'vypnuto', orientation: 'naklopení'
};

app.post('/api/blinds/command', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { deviceURL, action, value } = req.body || {};
  if (typeof deviceURL !== 'string' || !BLIND_ACTION_LABELS[action]) {
    return res.status(400).json({ error: 'Chybí deviceURL nebo neznámá action.' });
  }
  const movesWithTilt = ['up', 'down', 'stop'];
  let v = null;
  if (action === 'orientation' || (movesWithTilt.includes(action) && value !== undefined && value !== null)) {
    v = Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return res.status(400).json({ error: 'Naklopení musí být 0–100.' });
    }
  }
  try {
    // Ovládání rolet/žaluzií se do logu nezapisuje
    await blindCommand(deviceURL, action, v);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ---------- Časovače rolet (jednorázové vytažení/zatažení v daný čas) ----------

let blindTimers = [];
let blindTimerSeq = 1;

app.post('/api/blinds/timer', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { deviceURL, deviceURLs, time, action, orientation, label } = req.body || {};
  // Časovač může ovládat i skupinu rolet najednou (Miky/Elenka mají po dvou)
  const urls = Array.isArray(deviceURLs)
    ? deviceURLs.filter(u => typeof u === 'string' && u).slice(0, 20)
    : (typeof deviceURL === 'string' && deviceURL ? [deviceURL] : []);
  if (!urls.length || !/^\d{2}:\d{2}$/.test(time || '') || !['up', 'down'].includes(action)) {
    return res.status(400).json({ error: 'Chybí rolety, time (HH:MM) nebo action (up/down).' });
  }
  let tilt = null;
  if (orientation !== undefined && orientation !== null) {
    tilt = Number(orientation);
    if (!Number.isFinite(tilt) || tilt < 0 || tilt > 100) {
      return res.status(400).json({ error: 'Naklopení musí být 0–100.' });
    }
  }
  if (blindTimers.length >= 10) {
    return res.status(400).json({ error: 'Maximálně 10 časovačů.' });
  }
  let name = typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : '';
  if (!name) {
    try {
      const blind = (await getBlinds()).find(b => b.deviceURL === urls[0]);
      name = blind ? blind.label : 'Roleta';
      if (urls.length > 1) name += ` +${urls.length - 1}`;
    } catch {
      name = 'Roleta';
    }
  }
  const timer = { id: blindTimerSeq++, deviceURLs: urls, name, time, action, orientation: tilt };
  blindTimers.push(timer);
  blindTimers.sort((a, b) => a.time.localeCompare(b.time));
  addLog(`Časovač: ${name} ${action === 'up' ? 'vytáhnout' : 'zatáhnout'} v ${time}`);
  broadcast('blindTimers', { timers: blindTimers });
  res.json({ timers: blindTimers });
});

app.post('/api/blinds/timer/delete', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { id } = req.body || {};
  const timer = blindTimers.find(t => t.id === id);
  if (timer) {
    blindTimers = blindTimers.filter(t => t.id !== id);
    addLog(`Časovač zrušen: ${timer.name} v ${timer.time}`);
    broadcast('blindTimers', { timers: blindTimers });
  }
  res.json({ timers: blindTimers });
});

setInterval(async () => {
  if (!blindTimers.length) return;
  const p = pragueTime();
  const pad2 = n => String(n).padStart(2, '0');
  const current = `${pad2(p.hour)}:${pad2(p.minute)}`;
  const due = blindTimers.filter(t => t.time === current);
  if (!due.length) return;
  blindTimers = blindTimers.filter(t => t.time !== current);
  broadcast('blindTimers', { timers: blindTimers });
  for (const t of due) {
    let ok = 0;
    for (const url of t.deviceURLs || []) {
      try {
        await blindCommand(url, t.action, t.orientation);
        ok++;
      } catch (err) {
        addLog(`Časovač ${t.name}: roleta selhala (${err.message.slice(0, 100)})`);
      }
      await delay(500);
    }
    if (ok > 0) {
      addLog(`${t.name}: ${t.action === 'up' ? 'vytaženo' : 'zataženo'} (časovač ${t.time})`);
    }
  }
}, 30000);

// ---------- Časovače relé (bojler, bazén, solinátor, světla) ----------

let relayTimers = [];
let relayTimerSeq = 1;

async function actuateRelay(key, stateOn, reason) {
  const dev = DEVICES[key];
  await setShellyState(dev.serverUri, dev.deviceId, stateOn ? 'on' : 'off');
  const prev = state.devices[key] || {};
  state.devices[key] = { ...prev, online: true, isOn: stateOn, fetchedAt: new Date().toISOString() };
  broadcast('device', { key, status: state.devices[key] });
  addLog(`${DEVICE_LABELS[key]}: ${stateOn ? 'zapnuto' : 'vypnuto'}${reason ? ` (${reason})` : ''}`);
  setTimeout(() => pollDevice(key), 1500);
}

app.post('/api/relay/timer', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { key, time, action } = req.body || {};
  if (!DEVICES[key] || !/^\d{2}:\d{2}$/.test(time || '') || !['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'Chybí zařízení, time (HH:MM) nebo action (on/off).' });
  }
  if (relayTimers.length >= 10) {
    return res.status(400).json({ error: 'Maximálně 10 časovačů.' });
  }
  const timer = { id: relayTimerSeq++, key, name: DEVICE_LABELS[key], time, action };
  relayTimers.push(timer);
  relayTimers.sort((a, b) => a.time.localeCompare(b.time));
  addLog(`Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}`);
  broadcast('relayTimers', { timers: relayTimers });
  res.json({ timers: relayTimers });
});

app.post('/api/relay/timer/delete', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { id } = req.body || {};
  const timer = relayTimers.find(t => t.id === id);
  if (timer) {
    relayTimers = relayTimers.filter(t => t.id !== id);
    addLog(`Časovač zrušen: ${timer.name} v ${timer.time}`);
    broadcast('relayTimers', { timers: relayTimers });
  }
  res.json({ timers: relayTimers });
});

setInterval(async () => {
  if (!relayTimers.length) return;
  const p = pragueTime();
  const pad2 = n => String(n).padStart(2, '0');
  const current = `${pad2(p.hour)}:${pad2(p.minute)}`;
  const due = relayTimers.filter(t => t.time === current);
  if (!due.length) return;
  relayTimers = relayTimers.filter(t => t.time !== current);
  broadcast('relayTimers', { timers: relayTimers });
  for (const t of due) {
    try {
      await actuateRelay(t.key, t.action === 'on', `časovač ${t.time}`);
    } catch (err) {
      addLog(`Časovač ${t.name}: příkaz selhal (${err.message.slice(0, 100)})`);
    }
    await delay(500);
  }
}, 30000);

// ---------- Panasonic Comfort Cloud (klimatizace) ----------
// Neoficiální API appky Comfort Cloud — stejné používá Home Assistant a Homebridge.
// Přihlášení: Auth0 PKCE flow, pak accsmart.panasonic.com s podepsanými hlavičkami.

const PANASONIC_EMAIL = process.env.PANASONIC_EMAIL;
const PANASONIC_PASSWORD = process.env.PANASONIC_PASSWORD;
const panasonicEnabled = !!(PANASONIC_EMAIL && PANASONIC_PASSWORD);

const PCC_AUTH_BASE = 'https://authglb.digital.panasonic.com';
const PCC_ACC_BASE = 'https://accsmart.panasonic.com';
const PCC_CLIENT_ID = 'Xmy6xIYIitMxngjB2rHvlm6HSDNnaMJx';
const PCC_AUTH0_CLIENT = 'eyJuYW1lIjoiQXV0aDAuQW5kcm9pZCIsImVudiI6eyJhbmRyb2lkIjoiMzAifSwidmVyc2lvbiI6IjIuOS4zIn0=';
const PCC_REDIRECT_URI = 'panasonic-iot-cfc://authglb.digital.panasonic.com/android/com.panasonic.ACCsmart/callback';
const PCC_SCOPE = 'openid offline_access comfortcloud.control a2w.control';
const PCC_API_UA = 'okhttp/4.10.0';
const PCC_BROWSER_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36';
const PCC_INVALID_TEMP = 126;

const pcc = {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,
  scope: PCC_SCOPE,
  clientId: null,
  appVersion: process.env.PANASONIC_APP_VERSION || '1.21.0',
  appVersionTs: 0
};

// Jeden požadavek po druhém — Panasonic je citlivý na souběh
let pccQueueTail = Promise.resolve();
function pccQueued(fn) {
  const run = pccQueueTail.then(fn);
  pccQueueTail = run.catch(() => {});
  return run;
}

function pccRandomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function pccStoreCookies(res, jar) {
  let cookies = [];
  if (typeof res.headers.getSetCookie === 'function') {
    cookies = res.headers.getSetCookie();
  } else {
    const sc = res.headers.get('set-cookie');
    if (sc) cookies = sc.split(/,(?=[^;=]+=)/);
  }
  for (const c of cookies) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}

function pccCookieHeader(jar) {
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
}

function pccAbsUrl(location) {
  if (location.startsWith('http')) return location;
  return PCC_AUTH_BASE + (location.startsWith('/') ? '' : '/') + location;
}

function pccParam(url, name) {
  const q = (url.split('?')[1] || '').split('#')[0];
  return new URLSearchParams(q).get(name);
}

function pccDecodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function pccParseHiddenInputs(html) {
  const params = {};
  for (const tag of html.match(/<input[^>]*type="hidden"[^>]*>/g) || []) {
    const name = tag.match(/name="([^"]*)"/);
    const value = tag.match(/value="([^"]*)"/);
    if (name && name[1]) params[name[1]] = pccDecodeEntities(value ? value[1] : '');
  }
  return params;
}

// Aktuální verze appky z Play Store — API odmítá zastaralé verze (chyba 4106)
async function pccUpdateAppVersion(force) {
  if (!force && Date.now() - pcc.appVersionTs < 24 * 60 * 60 * 1000) return;
  try {
    const res = await fetch('https://play.google.com/store/apps/details?id=com.panasonic.ACCsmart', {
      signal: AbortSignal.timeout(15000)
    });
    const text = await res.text();
    const m = text.match(/\["(\d+\.\d+\.\d+)"\]/);
    if (m) pcc.appVersion = m[1];
    pcc.appVersionTs = Date.now();
  } catch {}
}

function pccApiHeaders(includeClientId = true) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} `
    + `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  const tsMs = String(Math.floor(now.getTime() / 1000) * 1000);
  const hash = crypto.createHash('sha256')
    .update('Comfort Cloud' + '521325fb2dd486bf4831b47644317fca' + tsMs + 'Bearer ' + pcc.accessToken)
    .digest('hex');
  const headers = {
    'content-type': 'application/json;charset=utf-8',
    'user-agent': 'G-RAC',
    'x-app-name': 'Comfort Cloud',
    'x-app-timestamp': ts,
    'x-app-type': '1',
    'x-app-version': pcc.appVersion,
    'x-cfc-api-key': hash.slice(0, 9) + 'cfc' + hash.slice(9),
    'x-user-authorization-v2': 'Bearer ' + pcc.accessToken
  };
  if (includeClientId && pcc.clientId) headers['x-client-id'] = pcc.clientId;
  return headers;
}

function pccSetTokens(tokenResponse) {
  pcc.accessToken = tokenResponse.access_token;
  if (tokenResponse.refresh_token) pcc.refreshToken = tokenResponse.refresh_token;
  if (tokenResponse.scope) pcc.scope = tokenResponse.scope;
  pcc.expiresAt = Date.now() + Math.max(60, (tokenResponse.expires_in || 3600) - 120) * 1000;
}

async function pccAuthenticate() {
  await pccUpdateAppVersion();
  const jar = new Map();
  const verifier = pccRandomString(43);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  // 1) authorize → 302 (nová session) nebo rovnou code
  const authorizeParams = new URLSearchParams({
    scope: PCC_SCOPE,
    audience: `https://digital.panasonic.com/${PCC_CLIENT_ID}/api/v1/`,
    protocol: 'oauth2',
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    auth0Client: PCC_AUTH0_CLIENT,
    client_id: PCC_CLIENT_ID,
    redirect_uri: PCC_REDIRECT_URI,
    state: pccRandomString(20)
  });
  let res = await fetch(`${PCC_AUTH_BASE}/authorize?${authorizeParams}`, {
    headers: { 'user-agent': PCC_API_UA },
    redirect: 'manual',
    signal: AbortSignal.timeout(20000)
  });
  pccStoreCookies(res, jar);
  if (res.status !== 302) throw new Error(`Panasonic authorize selhal (HTTP ${res.status})`);
  let location = res.headers.get('location') || '';
  let code;

  if (location.startsWith(PCC_REDIRECT_URI)) {
    code = pccParam(location, 'code');
  } else {
    // 2) přihlašovací stránka → _csrf cookie
    const state = pccParam(location, 'state');
    res = await fetch(pccAbsUrl(location), {
      headers: { 'user-agent': PCC_API_UA, cookie: pccCookieHeader(jar) },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000)
    });
    pccStoreCookies(res, jar);
    if (res.status !== 200) throw new Error(`Panasonic login page selhala (HTTP ${res.status})`);
    const csrf = jar.get('_csrf');
    if (!csrf) throw new Error('Panasonic nevrátil _csrf cookie.');

    // 3) jméno + heslo
    res = await fetch(`${PCC_AUTH_BASE}/usernamepassword/login`, {
      method: 'POST',
      headers: {
        'Auth0-Client': PCC_AUTH0_CLIENT,
        'user-agent': PCC_API_UA,
        'content-type': 'application/json',
        cookie: pccCookieHeader(jar)
      },
      body: JSON.stringify({
        client_id: PCC_CLIENT_ID,
        redirect_uri: PCC_REDIRECT_URI,
        tenant: 'pdpauthglb-a1',
        response_type: 'code',
        scope: PCC_SCOPE,
        audience: `https://digital.panasonic.com/${PCC_CLIENT_ID}/api/v1/`,
        _csrf: csrf,
        state,
        _intstate: 'deprecated',
        username: PANASONIC_EMAIL,
        password: PANASONIC_PASSWORD,
        lang: 'en',
        connection: 'PanasonicID-Authentication'
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000)
    });
    pccStoreCookies(res, jar);
    if (res.status !== 200) {
      throw new Error(`Panasonic přihlášení odmítnuto (HTTP ${res.status}) — zkontroluj PANASONIC_EMAIL/PASSWORD`);
    }

    // 4) callback s hodnotami ze skrytého formuláře
    const formParams = pccParseHiddenInputs(await res.text());
    if (formParams.mfa_token) {
      throw new Error('Panasonic vyžaduje 2FA potvrzení — přihlas se jednou v Comfort Cloud appce tímto účtem.');
    }
    res = await fetch(`${PCC_AUTH_BASE}/login/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': PCC_BROWSER_UA,
        cookie: pccCookieHeader(jar)
      },
      body: new URLSearchParams(formParams).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000)
    });
    pccStoreCookies(res, jar);
    if (res.status !== 302) throw new Error(`Panasonic callback selhal (HTTP ${res.status})`);

    // 5) poslední redirect nese autorizační kód
    res = await fetch(pccAbsUrl(res.headers.get('location') || ''), {
      headers: { 'user-agent': PCC_BROWSER_UA, cookie: pccCookieHeader(jar) },
      redirect: 'manual',
      signal: AbortSignal.timeout(20000)
    });
    pccStoreCookies(res, jar);
    if (res.status !== 302) throw new Error(`Panasonic redirect selhal (HTTP ${res.status})`);
    code = pccParam(res.headers.get('location') || '', 'code');
  }

  if (!code) throw new Error('Panasonic nevrátil autorizační kód.');

  // 6) výměna kódu za tokeny
  res = await fetch(`${PCC_AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Auth0-Client': PCC_AUTH0_CLIENT, 'user-agent': PCC_API_UA, 'content-type': 'application/json' },
    body: JSON.stringify({
      scope: 'openid',
      client_id: PCC_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: PCC_REDIRECT_URI,
      code_verifier: verifier
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`Panasonic token selhal (HTTP ${res.status})`);
  pccSetTokens(await res.json());

  // 7) přihlášení do ACC → x-client-id
  res = await fetch(`${PCC_ACC_BASE}/auth/v2/login`, {
    method: 'POST',
    headers: pccApiHeaders(false),
    body: JSON.stringify({ language: 0 }),
    signal: AbortSignal.timeout(20000)
  });
  if (res.status === 401 && (await res.clone().text()).includes('4106')) {
    await pccUpdateAppVersion(true);
    res = await fetch(`${PCC_ACC_BASE}/auth/v2/login`, {
      method: 'POST',
      headers: pccApiHeaders(false),
      body: JSON.stringify({ language: 0 }),
      signal: AbortSignal.timeout(20000)
    });
  }
  if (!res.ok) throw new Error(`Panasonic ACC login selhal (HTTP ${res.status})`);
  pcc.clientId = (await res.json()).clientId;
}

async function pccRefreshTokens() {
  const res = await fetch(`${PCC_AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Auth0-Client': PCC_AUTH0_CLIENT, 'user-agent': PCC_API_UA, 'content-type': 'application/json' },
    body: JSON.stringify({
      scope: pcc.scope,
      client_id: PCC_CLIENT_ID,
      refresh_token: pcc.refreshToken,
      grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`Panasonic refresh selhal (HTTP ${res.status})`);
  pccSetTokens(await res.json());
}

async function pccEnsureToken() {
  if (!panasonicEnabled) {
    throw Object.assign(new Error('Panasonic není nakonfigurován (chybí PANASONIC_EMAIL / PANASONIC_PASSWORD).'), { status: 500 });
  }
  if (pcc.accessToken && Date.now() < pcc.expiresAt) return;
  if (pcc.refreshToken) {
    try {
      await pccRefreshTokens();
      return;
    } catch (err) {
      console.error('Panasonic:', err.message);
    }
  }
  await pccAuthenticate();
}

async function pccApiFetch(path, options = {}) {
  await pccEnsureToken();
  const doFetch = () => fetch(PCC_ACC_BASE + path, {
    ...options,
    headers: { ...pccApiHeaders(), ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  let res = await doFetch();
  if (res.status === 401) {
    const text = await res.text();
    if (text.includes('4106')) {
      await pccUpdateAppVersion(true);
    } else {
      pcc.accessToken = null;
      await pccEnsureToken();
    }
    res = await doFetch();
  }
  if (!res.ok) {
    throw new Error(`Panasonic API HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  return res.json();
}

let pccDevCache = { ts: 0, list: [], aquarea: [] };

async function pccGetDevices() {
  if (pccDevCache.list.length && Date.now() - pccDevCache.ts < 10 * 60 * 1000) return pccDevCache;
  const groups = await pccApiFetch('/device/group');
  const list = [];
  const aquarea = [];
  for (const g of (groups && groups.groupList) || []) {
    // Skupina má buď deviceList, nebo (typicky u Aquarea) deviceIdList
    const groupDevices = ('deviceList' in g ? g.deviceList : g.deviceIdList) || [];
    for (const d of groupDevices) {
      if (!d || !d.deviceGuid) continue;
      // Klimatizace mají parameters; zařízení bez nich je Aquarea (tepelné čerpadlo)
      if (d.parameters) {
        list.push({ guid: d.deviceGuid, name: d.deviceName || d.deviceGuid });
      } else {
        // Stav Aquarey (nádrž, zóny) je rovnou v záznamu skupiny
        aquarea.push({ guid: d.deviceGuid, name: d.deviceName || 'Tepelné čerpadlo', ...pccAquareaFromGroup(d) });
      }
    }
  }
  pccDevCache = { ts: Date.now(), list, aquarea };
  return pccDevCache;
}

function aquaNum(v) {
  return typeof v === 'number' && v !== PCC_INVALID_TEMP && v !== 255 ? v : null;
}

function pccAquareaFromGroup(d) {
  const tankRaw = Array.isArray(d.tankStatus) ? d.tankStatus[0] : d.tankStatus;
  const zonesRaw = Array.isArray(d.zoneStatus) ? d.zoneStatus : [];
  const t = tankRaw || {};
  return {
    online: d.connectionStatus === undefined ? null : d.connectionStatus === 1 || d.connectionStatus === '1',
    tankTemp: aquaNum(t.temperatureNow !== undefined ? t.temperatureNow : t.temparatureNow),
    tankTarget: aquaNum(t.heatSet),
    tankOn: t.operationStatus === 1,
    zones: zonesRaw.map(z => ({
      name: z.zoneName || ('Zóna ' + (z.zoneId !== undefined ? z.zoneId : '')),
      temp: aquaNum(z.temperatureNow !== undefined ? z.temperatureNow : z.temparatureNow),
      target: aquaNum(z.heatSet),
      on: z.operationStatus === 1
    }))
  };
}

// Diagnostika: struktura skupin a zařízení z Comfort Cloudu (bez parametrů a celých GUID)
// + surové odpovědi Aquarea stavu pro ladění Tepelka
app.get('/api/aircon/debug', async (req, res) => {
  if (!panasonicEnabled) return res.json({ enabled: false });
  try {
    const groups = await pccQueued(() => pccApiFetch('/device/group'));
    const groupsOut = (groups.groupList || []).map(g => ({
      groupName: g.groupName,
      keys: Object.keys(g),
      devices: (('deviceList' in g ? g.deviceList : g.deviceIdList) || []).map(d => ({
        name: d.deviceName,
        guidPrefix: String(d.deviceGuid || '').slice(0, 10) + '…',
        deviceType: d.deviceType,
        hasParameters: !!d.parameters,
        keys: Object.keys(d)
      }))
    }));

    const aquaTests = [];
    for (const g of groups.groupList || []) {
      for (const d of (('deviceList' in g ? g.deviceList : g.deviceIdList) || [])) {
        if (!d || !d.deviceGuid || d.parameters) continue;
        for (const direct of [1, 0]) {
          try {
            const raw = await pccQueued(() => pccApiFetch('/remote/v1/app/common/transfer', {
              method: 'POST',
              body: JSON.stringify({
                apiName: `/remote/v1/api/devices?gwid=${d.deviceGuid}&deviceDirect=${direct}`,
                requestMethod: 'GET'
              })
            }));
            aquaTests.push({ device: d.deviceName, direct, data: raw });
          } catch (err) {
            aquaTests.push({ device: d.deviceName, direct, error: err.message });
          }
        }
      }
    }

    res.json({ groups: groupsOut, aquarea: aquaTests });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});


const PCC_MODES = { auto: 0, dry: 1, cool: 2, heat: 3, fan: 4 };
const PCC_MODE_NAMES = ['auto', 'dry', 'cool', 'heat', 'fan'];

function pccTemp(v) {
  return typeof v === 'number' && v !== PCC_INVALID_TEMP ? v : null;
}

async function pccGetStatus(guid) {
  const data = await pccApiFetch('/deviceStatus/' + encodeURIComponent(guid));
  const p = (data && data.parameters) || {};
  return {
    power: p.operate === 1,
    mode: PCC_MODE_NAMES[p.operationMode] || null,
    eco: typeof p.ecoMode === 'number' ? p.ecoMode : null, // 0 auto, 1 výkonný, 2 tichý
    targetTemp: pccTemp(p.temperatureSet),
    insideTemp: pccTemp(p.insideTemperature),
    outsideTemp: pccTemp(p.outTemperature)
  };
}

// Teplotní automatika: když teplota v pokoji stoupne na onTemp, zapne chlazení
// na coolTemp °C (tiše); vypne, až klesne pod offTemp °C (hystereze). Po vypnutí
// automatikou zůstane pokoj aspoň TEMP_AUTO_OFF_LOCKOUT_MS vypnutý (nezapne dřív).
const TEMP_AUTO_RULES = [
  { key: 'loznice', room: 'Ložnice', onTemp: 22, offTemp: 20.5, coolTemp: 20, quiet: true },
  { key: 'elenka', room: 'Elenka', onTemp: 22, offTemp: 20.5, coolTemp: 20, quiet: true },
  { key: 'miky', room: 'Miky', onTemp: 22, offTemp: 20.5, coolTemp: 20, quiet: true }
];
const TEMP_AUTO_OFF_LOCKOUT_MS = 30 * 60 * 1000; // po vypnutí drž vypnuté aspoň 30 min
const tempAutoOffAt = {}; // key -> čas posledního vypnutí automatikou

async function evaluateTempAuto(devices) {
  for (const rule of TEMP_AUTO_RULES) {
    if (!state.tempAuto[rule.key]) continue;
    const rn = cz(rule.room);
    const dev = (devices || []).find(d => cz(d.name).includes(rn) || rn.includes(cz(d.name)));
    if (!dev || typeof dev.insideTemp !== 'number') continue;
    let parameters = null, msg = null;
    const lockedUntil = (tempAutoOffAt[rule.key] || 0) + TEMP_AUTO_OFF_LOCKOUT_MS;
    if (dev.insideTemp >= rule.onTemp && dev.power !== true && Date.now() >= lockedUntil) {
      parameters = { operate: 1, operationMode: PCC_MODES.cool, temperatureSet: rule.coolTemp, ecoMode: rule.quiet ? 2 : 0 };
      msg = `${dev.name}: zapnuto chlazení ${rule.coolTemp} °C (v pokoji ${dev.insideTemp} °C)`;
    } else if (dev.insideTemp <= rule.offTemp && dev.power === true) {
      parameters = { operate: 0 };
      msg = `${dev.name}: vypnuto (v pokoji ${dev.insideTemp} °C)`;
    }
    if (!parameters) continue;
    try {
      await pccQueued(() => pccApiFetch('/deviceStatus/control', {
        method: 'POST', body: JSON.stringify({ deviceGuid: dev.guid, parameters })
      }));
      dev.power = parameters.operate === 1;
      if (parameters.operate === 0) tempAutoOffAt[rule.key] = Date.now(); // start 30min blokace
      if (parameters.temperatureSet !== undefined) dev.targetTemp = parameters.temperatureSet;
      if (parameters.operationMode !== undefined) dev.mode = 'cool';
      if (parameters.ecoMode !== undefined) dev.eco = parameters.ecoMode;
      addLog(`Teplotní automatika — ${msg}`);
      broadcast('aircon', { aircon: state.aircon });
    } catch (err) {
      addLog(`Teplotní automatika ${rule.room}: příkaz selhal (${err.message.slice(0, 100)})`);
    }
  }
}

let airconPollRunning = false;
let airconStatusLogged = false;

async function pollAircon() {
  if (!panasonicEnabled || airconPollRunning) return;
  airconPollRunning = true;
  try {
    // Skupiny čteme čerstvé — nesou i aktuální stav Aquarey (nádrž, zóny)
    pccDevCache.ts = 0;
    const { list: devices, aquarea } = await pccQueued(() => pccGetDevices());
    const out = [];
    for (const d of devices) {
      try {
        const status = await pccQueued(() => pccGetStatus(d.guid));
        out.push({ guid: d.guid, name: d.name, ...status });
      } catch {
        out.push({ guid: d.guid, name: d.name, power: null });
      }
      await delay(500);
    }

    // Časová osa: segmenty běhu klimatizací (dynamické klíče ac_<guid>)
    const nowTs = Date.now();
    for (const d of out) {
      const key = 'ac_' + d.guid;
      if (!state.timeline[key]) state.timeline[key] = [];
      if (d.power === true) {
        const segs = state.timeline[key];
        const last = segs[segs.length - 1];
        if (last && nowTs - last.to <= TIMELINE_GAP_MS) last.to = nowTs;
        else segs.push({ from: nowTs, to: nowTs });
      }
    }
    pruneTimeline();
    broadcast('timeline', { timeline: state.timeline });

    state.aircon = { devices: out, aquarea, error: null, fetchedAt: new Date().toISOString() };
    if (!airconStatusLogged) {
      airconStatusLogged = true;
      addLog(`Klima: připojeno k Panasonic (${out.length + aquaOut.length} zařízení)`);
    }
    broadcast('aircon', { aircon: state.aircon });

    // Teplotní automatika vyhodnotíme z čerstvých teplot
    await evaluateTempAuto(out);
  } catch (err) {
    state.aircon = { devices: state.aircon.devices || [], aquarea: state.aircon.aquarea || [], error: err.message };
    if (!airconStatusLogged) {
      airconStatusLogged = true;
      addLog('Klima: připojení k Panasonic selhalo — ' + err.message.slice(0, 140));
    }
    broadcast('aircon', { aircon: state.aircon });
  } finally {
    airconPollRunning = false;
  }
}

if (panasonicEnabled) {
  setTimeout(pollAircon, 15000);
  setInterval(pollAircon, 5 * 60 * 1000);
}

app.post('/api/aircon/set', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { guid, power, temperature, mode } = req.body || {};
  if (typeof guid !== 'string') return res.status(400).json({ error: 'Chybí guid.' });

  const parameters = {};
  const actions = [];
  if (power === 'on' || power === 'off') {
    parameters.operate = power === 'on' ? 1 : 0;
    actions.push(power === 'on' ? 'zapnuto' : 'vypnuto');
  }
  if (temperature !== undefined) {
    const t = Number(temperature);
    if (!Number.isFinite(t) || t < 8 || t > 32) return res.status(400).json({ error: 'Teplota musí být 8–32 °C.' });
    parameters.temperatureSet = t;
    // Změny teploty se do logu nezapisují
  }
  if (mode !== undefined) {
    if (PCC_MODES[mode] === undefined) return res.status(400).json({ error: 'Neznámý režim.' });
    parameters.operationMode = PCC_MODES[mode];
    actions.push(`režim ${mode}`);
  }
  const PCC_ECO = { auto: 0, powerful: 1, quiet: 2 };
  const eco = req.body && req.body.eco;
  if (eco !== undefined) {
    if (PCC_ECO[eco] === undefined) return res.status(400).json({ error: 'Neznámý eco režim.' });
    parameters.ecoMode = PCC_ECO[eco];
    // tichý/výkonný režim se do logu nezapisuje
  }
  if (!Object.keys(parameters).length) return res.status(400).json({ error: 'Žádný parametr ke změně.' });

  try {
    await pccQueued(() => pccApiFetch('/deviceStatus/control', {
      method: 'POST',
      body: JSON.stringify({ deviceGuid: guid, parameters })
    }));

    // Optimistická aktualizace, ověření proběhne příštím pollem
    const dev = state.aircon.devices.find(d => d.guid === guid);
    if (dev) {
      if (parameters.operate !== undefined) dev.power = parameters.operate === 1;
      if (parameters.temperatureSet !== undefined) dev.targetTemp = parameters.temperatureSet;
      if (parameters.operationMode !== undefined) dev.mode = mode;
      if (parameters.ecoMode !== undefined) dev.eco = parameters.ecoMode;
      broadcast('aircon', { aircon: state.aircon });
      if (actions.length) addLog(`${dev.name}: ${actions.join(', ')}`);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- Časovače klimatizací (jednorázové zapnutí/vypnutí v daný čas) ----------

let airconTimers = [];
let airconTimerSeq = 1;

app.post('/api/aircon/timer', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { guid, time, action, quiet } = req.body || {};
  if (typeof guid !== 'string' || !/^\d{2}:\d{2}$/.test(time || '') || !['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'Chybí guid, time (HH:MM) nebo action (on/off).' });
  }
  if (airconTimers.length >= 10) {
    return res.status(400).json({ error: 'Maximálně 10 časovačů.' });
  }
  const dev = state.aircon.devices.find(d => d.guid === guid);
  const timer = { id: airconTimerSeq++, guid, name: (dev && dev.name) || 'Klima', time, action, quiet: action === 'on' && !!quiet };
  airconTimers.push(timer);
  airconTimers.sort((a, b) => a.time.localeCompare(b.time));
  addLog(`Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}`);
  broadcast('airconTimers', { timers: airconTimers });
  res.json({ timers: airconTimers });
});

app.post('/api/aircon/timer/delete', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { id } = req.body || {};
  const timer = airconTimers.find(t => t.id === id);
  if (timer) {
    airconTimers = airconTimers.filter(t => t.id !== id);
    addLog(`Časovač zrušen: ${timer.name} v ${timer.time}`);
    broadcast('airconTimers', { timers: airconTimers });
  }
  res.json({ timers: airconTimers });
});

setInterval(async () => {
  if (!airconTimers.length) return;
  const p = pragueTime();
  const pad2 = n => String(n).padStart(2, '0');
  const current = `${pad2(p.hour)}:${pad2(p.minute)}`;
  const due = airconTimers.filter(t => t.time === current);
  if (!due.length) return;
  // Odebrat před vykonáním, ať se v rámci minuty nespustí dvakrát
  airconTimers = airconTimers.filter(t => t.time !== current);
  broadcast('airconTimers', { timers: airconTimers });
  for (const t of due) {
    try {
      const params = { operate: t.action === 'on' ? 1 : 0 };
      // Při zapnutí s tichým režimem rovnou nastavíme ecoMode = tichý (2)
      if (t.action === 'on' && t.quiet) params.ecoMode = 2;
      await pccQueued(() => pccApiFetch('/deviceStatus/control', {
        method: 'POST',
        body: JSON.stringify({ deviceGuid: t.guid, parameters: params })
      }));
      const dev = state.aircon.devices.find(d => d.guid === t.guid);
      if (dev) {
        dev.power = t.action === 'on';
        if (t.action === 'on' && t.quiet) dev.eco = 2;
        broadcast('aircon', { aircon: state.aircon });
      }
      addLog(`${t.name}: ${t.action === 'on' ? 'zapnuto' : 'vypnuto'}${t.action === 'on' && t.quiet ? ' (tichý)' : ''} (časovač ${t.time})`);
    } catch (err) {
      addLog(`Časovač ${t.name}: selhal (${err.message.slice(0, 100)})`);
    }
  }
}, 30000);

// ---------- Solax wallbox (EV charger přes SolaxCloud pileInfo/pileCmd) ----------

const WALLBOX_SN = process.env.WALLBOX_SN;
const wallboxEnabled = !!(WALLBOX_SN && SOLAX_TOKEN_ID);
const WB_HOST = 'https://www.solaxcloud.com';

const WB_MODES = { stop: 0, fast: 1, eco: 2, green: 3 };
const WB_MODE_NAMES = ['stop', 'fast', 'eco', 'green'];
const WB_MODE_LABELS = { stop: 'STOP', fast: 'FAST', eco: 'ECO', green: 'GREEN' };
// chargerStatus: 0 nepřipojeno (žádné auto), 1 nabíjí, 2 porucha, 3 připraven
const WB_STATUS_LABELS = { 0: 'Nepřipojeno', 1: 'Nabíjí', 2: 'Porucha', 3: 'Připraven' };

// Čtení stavu: getPileInfo (GET, tokenId + pileSn v query)
async function wbFetchStatus() {
  const url = `${WB_HOST}/proxyApp/proxy/api/getPileInfo?tokenId=${encodeURIComponent(SOLAX_TOKEN_ID)}&pileSn=${encodeURIComponent(WALLBOX_SN)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`getPileInfo HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.success === false || !data.result) {
    throw new Error((data && data.exception) || 'getPileInfo bez výsledku.');
  }
  return data.result;
}

function wbParseResult(r) {
  const num = v => (typeof v === 'number' ? v : null);
  return {
    power: num(r.chargingPower),
    energy: num(r.chargeEnergy),
    mode: WB_MODE_NAMES[r.chargingMode] || null,
    status: typeof r.chargerStatus === 'number' ? r.chargerStatus : null
  };
}

let wallboxPollRunning = false;

async function pollWallbox() {
  if (!wallboxEnabled || wallboxPollRunning) return;
  wallboxPollRunning = true;
  try {
    const result = await wbFetchStatus();
    state.wallbox = { ...wbParseResult(result), error: null, fetchedAt: new Date().toISOString() };
    broadcast('wallbox', { wallbox: state.wallbox });
    // Bod do historie výkonu (max. 1× za 30 s), ať máme graf za 24 h
    if (typeof state.wallbox.power === 'number') {
      const last = state.wallboxHistory[state.wallboxHistory.length - 1];
      if (!last || Date.now() - last.t > 30000) {
        const point = { t: Date.now(), w: state.wallbox.power };
        state.wallboxHistory.push(point);
        pruneHistory();
        broadcast('wallboxHistory', { point });
      }
    }
  } catch (err) {
    state.wallbox = { ...state.wallbox, error: err.message };
    broadcast('wallbox', { wallbox: state.wallbox });
  } finally {
    wallboxPollRunning = false;
  }
}

if (wallboxEnabled) {
  setTimeout(pollWallbox, 20000);
  setInterval(pollWallbox, 60 * 1000); // 1 dotaz/min — bezpečně pod limitem 10/min
}

// Přepnutí režimu: pileCmd (POST, rwType 2 = zápis, cmdType 1 = režim nabíjení)
async function wbSetMode(mode) {
  const res = await fetch(`${WB_HOST}/proxyApp/proxy/api/pileCmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenId: SOLAX_TOKEN_ID,
      rwType: '2',
      cmdType: '1',
      cmdValue: String(WB_MODES[mode]),
      sns: [WALLBOX_SN],
      callbackUrl: ''
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`pileCmd HTTP ${res.status}`);
  const data = await res.json();
  if (!data || data.success === false) {
    throw new Error((data && data.exception) || 'SolaxCloud příkaz odmítl.');
  }
  return data;
}

app.post('/api/wallbox/set', async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!wallboxEnabled) return res.status(500).json({ error: 'Wallbox není nakonfigurován (chybí WALLBOX_SN).' });
  const { mode } = req.body || {};
  if (WB_MODES[mode] === undefined) {
    return res.status(400).json({ error: 'Režim musí být stop/fast/eco/green.' });
  }
  try {
    await wbSetMode(mode);
    state.wallbox = { ...state.wallbox, mode };
    broadcast('wallbox', { wallbox: state.wallbox });
    addLog(`Wallbox: režim ${WB_MODE_LABELS[mode]}`);
    res.json({ success: true });
    // Po 3 s obnovíme stav, ať se ukáže potvrzený režim
    setTimeout(pollWallbox, 3000);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- AI asistent (Claude API, ovládání v přirozené řeči) ----------

const Anthropic = require('@anthropic-ai/sdk');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const assistantEnabled = !!ANTHROPIC_API_KEY;
const anthropic = assistantEnabled ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

function cz(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Relé: klíč DEVICES -> česká synonyma pro rozpoznání
const RELAY_ALIASES = {
  shelly: ['bojler'],
  pool: ['bazen', 'bazén', 'filtrace'],
  solinator: ['solinator', 'solinátor'],
  lightDole: ['zahrada dole', 'svetlo zahrada dole', 'dolni zahrada'],
  lightNahore: ['zahrada nahore', 'svetlo zahrada nahore', 'horni zahrada'],
  lightBazen: ['svetlo bazen', 'světlo bazén', 'bazenove svetlo'],
  lightNocni: ['nocni', 'noční', 'nocni svetla', 'noční světla']
};

function findRelayKey(name) {
  const n = cz(name);
  for (const [key, aliases] of Object.entries(RELAY_ALIASES)) {
    if (aliases.some(a => cz(a).includes(n) || n.includes(cz(a)))) return key;
    if (cz(DEVICE_LABELS[key]).includes(n) || n.includes(cz(DEVICE_LABELS[key]))) return key;
  }
  return null;
}

// Světlo u pergoly/terasy je TaHoma spínač (ne Shelly relé)
async function assistantSetTerasaLight(on) {
  const blinds = await getBlinds();
  const sw = blinds.find(b => b.type === 'switch' && (cz(b.label).includes('terasa') || cz(b.label).includes('pergola')));
  if (!sw) return 'Světlo u pergoly jsem nenašel.';
  await blindCommand(sw.deviceURL, on ? 'on' : 'off');
  addLog(`${sw.label}: ${on ? 'zapnuto' : 'vypnuto'} (asistent)`);
  return `${sw.label}: ${on ? 'rozsvíceno' : 'zhasnuto'}.`;
}

async function assistantSetRelay(name, stateOn) {
  const n = cz(name);
  // Skupina „všechna světla": všechna venkovní + noční + pergola
  if (n === 'svetla' || n.includes('vsechna svetla') || n.includes('vsechny svetla') || n.includes('vsechno svetla') || n.includes('vse svetla')) {
    for (const key of ['lightNahore', 'lightDole', 'lightBazen', 'lightNocni']) await actuateRelay(key, stateOn, 'asistent');
    try { await assistantSetTerasaLight(stateOn); } catch {}
    return `Všechna světla: ${stateOn ? 'rozsvíceno' : 'zhasnuto'}.`;
  }
  // Skupina „komplet venek": zahrada nahoře + dole + bazén + pergola
  if (n.includes('venek') || n.includes('venku') || n.includes('venkov')) {
    for (const key of ['lightNahore', 'lightDole', 'lightBazen']) await actuateRelay(key, stateOn, 'asistent');
    try { await assistantSetTerasaLight(stateOn); } catch {}
    return `Venek (zahrada, bazén, pergola): ${stateOn ? 'rozsvíceno' : 'zhasnuto'}.`;
  }
  // Skupina „zahrada": nahoře + dole (pokud není určeno dole/nahoře zvlášť)
  if (n.includes('zahrad') && !n.includes('dole') && !n.includes('nahor')) {
    for (const key of ['lightNahore', 'lightDole']) await actuateRelay(key, stateOn, 'asistent');
    return `Zahrada (nahoře i dole): ${stateOn ? 'rozsvíceno' : 'zhasnuto'}.`;
  }
  // Světlo u pergoly/terasy (TaHoma spínač)
  if (n.includes('terasa') || n.includes('pergola')) return assistantSetTerasaLight(stateOn);
  // Jednotlivé Shelly relé
  const key = findRelayKey(name);
  if (!key) return `Zařízení „${name}" neznám.`;
  await actuateRelay(key, stateOn, 'asistent');
  return `${DEVICE_LABELS[key]} ${stateOn ? 'zapnuto' : 'vypnuto'}.`;
}

function assistantAddRelayTimer({ device, time, action }) {
  const key = findRelayKey(device || '');
  if (!key) return `Zařízení „${device}" neznám.`;
  if (!/^\d{2}:\d{2}$/.test(time || '') || !['on', 'off'].includes(action)) return 'Neplatný čas nebo akce časovače.';
  if (relayTimers.length >= 10) return 'Je nastaveno maximum časovačů (10).';
  const timer = { id: relayTimerSeq++, key, name: DEVICE_LABELS[key], time, action };
  relayTimers.push(timer);
  relayTimers.sort((a, b) => a.time.localeCompare(b.time));
  addLog(`Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}`);
  broadcast('relayTimers', { timers: relayTimers });
  return `Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}.`;
}

function findAircon(room) {
  let n = cz(room);
  // Kuchyň je otevřeně spojená s obývákem — klima Obývák řeší i kuchyň
  if (n.includes('kuchyn')) n = 'obyvak';
  return (state.aircon.devices || []).find(d => cz(d.name).includes(n) || n.includes(cz(d.name)));
}

async function assistantSetAircon({ room, power, mode, temperature, quiet }) {
  const dev = findAircon(room);
  if (!dev) return `Klimatizaci „${room}" nenašel.`;
  const parameters = {};
  const done = [];
  const turningOn = power === 'on';
  if (power === 'on' || power === 'off') { parameters.operate = power === 'on' ? 1 : 0; done.push(power === 'on' ? 'zapnuto' : 'vypnuto'); }
  if (typeof temperature === 'number') {
    const t = Math.min(30, Math.max(16, temperature));
    parameters.temperatureSet = t; done.push(`${t} °C`);
  } else if (turningOn) {
    // Defaultně 22 °C, pokud teplotu neurčí
    parameters.temperatureSet = 22; done.push('22 °C');
  }
  if (mode && PCC_MODES[mode] !== undefined) { parameters.operationMode = PCC_MODES[mode]; done.push(`režim ${mode}`); }
  if (typeof quiet === 'boolean') { parameters.ecoMode = quiet ? 2 : 0; }
  else if (turningOn && cz(dev.name).includes('loznice')) {
    // Klima v ložnici defaultně v tichém režimu
    parameters.ecoMode = 2;
  }
  if (!Object.keys(parameters).length) return `U ${dev.name} nebylo co nastavit.`;
  await pccQueued(() => pccApiFetch('/deviceStatus/control', {
    method: 'POST', body: JSON.stringify({ deviceGuid: dev.guid, parameters })
  }));
  if (parameters.operate !== undefined) dev.power = parameters.operate === 1;
  if (parameters.temperatureSet !== undefined) dev.targetTemp = parameters.temperatureSet;
  if (parameters.operationMode !== undefined) dev.mode = mode;
  if (parameters.ecoMode !== undefined) dev.eco = parameters.ecoMode;
  broadcast('aircon', { aircon: state.aircon });
  if (parameters.operate !== undefined || parameters.operationMode !== undefined) {
    addLog(`${dev.name}: ${done.filter(x => !x.includes('°C')).join(', ') || 'nastaveno'} (asistent)`);
  }
  return `${dev.name}: ${done.join(', ')}.`;
}

// Vybere žaluzie podle cíle. Párování po slovech na štítek: cíl musí být
// podmnožinou štítku, takže "Obývák" chytne obě obývákové žaluzie ("Obývák
// Okno" + "Obývák Dveře"), "Kuchyň" jen kuchyňskou a "Obývák Dveře" jen tu
// jednu. Fallback na název pokoje pro místnosti bez popisného štítku.
function matchBlinds(covers, target) {
  const n = cz(target || '');
  if (['vse', 'vsechno', 'vsechny', 'cely dum'].some(a => n.includes(cz(a)))) return covers;
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  // 1) štítek obsahuje VŠECHNA slova cíle
  let m = covers.filter(b => { const lab = cz(b.label); return words.every(w => lab.includes(w)); });
  if (m.length) return m;
  // 2) cíl obsahuje celý štítek (např. „žaluzie obývák dveře")
  m = covers.filter(b => cz(b.label) && n.includes(cz(b.label)));
  if (m.length) return m;
  // 3) fallback na název pokoje
  return covers.filter(b => cz(b.room).includes(n) || n.includes(cz(b.room)));
}

async function assistantControlBlinds({ target, action, orientation }) {
  const blinds = await getBlinds();
  const covers = blinds.filter(b => b.type === 'cover');
  const matched = matchBlinds(covers, target);
  if (!matched.length) return `Žaluzie „${target}" nenašel.`;
  const tilt = typeof orientation === 'number' ? orientation : null;
  let ok = 0;
  for (const b of matched) {
    // Pergola má nahoru/dolů obráceně — prohodíme povel (stop zůstává)
    let act = action;
    if ((act === 'up' || act === 'down') && cz(b.label).includes('pergola')) {
      act = act === 'up' ? 'down' : 'up';
    }
    try { await blindCommand(b.deviceURL, act, tilt); ok++; } catch {}
    await delay(400);
  }
  const label = matched.length > 1 ? `${matched.length} žaluzií` : matched[0].label;
  const act = action === 'up' ? 'vytaženo' : (action === 'down' ? 'zataženo' : 'zastaveno');
  return `${label}: ${act}${tilt !== null ? `, naklopení ${tilt} %` : ''}.`;
}

async function assistantSetWallbox(mode) {
  if (!wallboxEnabled) return 'Wallbox není nastaven.';
  if (WB_MODES[mode] === undefined) return `Režim „${mode}" neznám.`;
  await wbSetMode(mode);
  state.wallbox = { ...state.wallbox, mode };
  broadcast('wallbox', { wallbox: state.wallbox });
  addLog(`Wallbox: režim ${WB_MODE_LABELS[mode]} (asistent)`);
  setTimeout(pollWallbox, 3000);
  return `Wallbox: režim ${WB_MODE_LABELS[mode]}.`;
}

function assistantAddAirconTimer({ room, time, action, quiet }) {
  if (!/^\d{2}:\d{2}$/.test(time || '') || !['on', 'off'].includes(action)) return 'Neplatný čas nebo akce časovače.';
  const dev = findAircon(room);
  const timer = { id: airconTimerSeq++, guid: dev ? dev.guid : room, name: dev ? dev.name : room, time, action, quiet: action === 'on' && !!quiet };
  airconTimers.push(timer);
  airconTimers.sort((a, b) => a.time.localeCompare(b.time));
  addLog(`Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}`);
  broadcast('airconTimers', { timers: airconTimers });
  return `Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}.`;
}

async function assistantAddBlindTimer({ target, time, action, orientation }) {
  if (!/^\d{2}:\d{2}$/.test(time || '') || !['up', 'down'].includes(action)) return 'Neplatný čas nebo akce časovače.';
  const blinds = await getBlinds();
  const covers = blinds.filter(b => b.type === 'cover');
  const matched = matchBlinds(covers, target);
  if (!matched.length) return `Žaluzie „${target}" nenašel.`;
  const tilt = typeof orientation === 'number' ? orientation : null;
  const name = matched.length > 1 ? `${matched[0].room} +${matched.length - 1}` : matched[0].label;
  const timer = { id: blindTimerSeq++, deviceURLs: matched.map(b => b.deviceURL), name, time, action, orientation: tilt };
  blindTimers.push(timer);
  blindTimers.sort((a, b) => a.time.localeCompare(b.time));
  addLog(`Časovač: ${name} ${action === 'up' ? 'vytáhnout' : 'zatáhnout'} v ${time}`);
  broadcast('blindTimers', { timers: blindTimers });
  return `Časovač: ${name} ${action === 'up' ? 'vytáhnout' : 'zatáhnout'} v ${time}.`;
}

const ASSISTANT_TOOLS = [
  {
    name: 'set_relay',
    description: 'Zapne/vypne spotřebiče a světla: bojler, bazén (filtrace), solinátor, jednotlivá světla (zahrada dole, zahrada nahoře, světlo bazén, noční světla, světlo terasa/pergola). Umí i skupiny: "zahrada" = obě zahradní světla; "komplet venek" = zahradní světla + bazén + pergola.',
    input_schema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Název zařízení nebo skupiny, např. "bojler", "zahrada dole", "světlo terasa", "zahrada" (obě zahradní), "komplet venek" (všechna venkovní světla vč. pergoly).' },
        state: { type: 'string', enum: ['on', 'off'], description: 'on = zapnout, off = vypnout.' }
      },
      required: ['device', 'state']
    }
  },
  {
    name: 'set_aircon',
    description: 'Nastaví klimatizaci v pokoji (Obývák, Ložnice, Miky, Elenka). Lze zapnout/vypnout, změnit režim, teplotu, tichý režim.',
    input_schema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Pokoj: obývák, ložnice, miky, elenka.' },
        power: { type: 'string', enum: ['on', 'off'] },
        mode: { type: 'string', enum: ['cool', 'heat', 'auto', 'dry', 'fan'], description: 'cool=chlazení, heat=topení, auto, dry=vysoušení, fan=ventilátor.' },
        temperature: { type: 'number', description: 'Cílová teplota 16–30 °C.' },
        quiet: { type: 'boolean', description: 'true = zapnout tichý režim.' }
      },
      required: ['room']
    }
  },
  {
    name: 'control_blinds',
    description: 'Ovládá žaluzie/rolety v pokoji (Obývák, Terasa, Garáž, Ložnice, Miky, Elenka, Hosté) nebo "vše" pro celý dům. Akce nahoru/dolů/stop, volitelně naklopení lamel 0–100 %.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Pokoj nebo "vše".' },
        action: { type: 'string', enum: ['up', 'down', 'stop'], description: 'up=vytáhnout/nahoru, down=zatáhnout/dolů, stop.' },
        orientation: { type: 'number', description: 'Naklopení lamel 0–100 % (nepovinné).' }
      },
      required: ['target', 'action']
    }
  },
  {
    name: 'set_wallbox',
    description: 'Nastaví režim nabíječky auta (wallbox): stop, fast (rychlý), eco, green (zelený – jen z přebytku FVE).',
    input_schema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['stop', 'fast', 'eco', 'green'] } },
      required: ['mode']
    }
  },
  {
    name: 'add_aircon_timer',
    description: 'Naplánuje jednorázový časovač pro klimatizaci na daný čas.',
    input_schema: {
      type: 'object',
      properties: {
        room: { type: 'string' },
        time: { type: 'string', description: 'Čas HH:MM (24h).' },
        action: { type: 'string', enum: ['on', 'off'] },
        quiet: { type: 'boolean' }
      },
      required: ['room', 'time', 'action']
    }
  },
  {
    name: 'add_blind_timer',
    description: 'Naplánuje jednorázový časovač pro žaluzie na daný čas.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Pokoj nebo "vše".' },
        time: { type: 'string', description: 'Čas HH:MM (24h).' },
        action: { type: 'string', enum: ['up', 'down'] },
        orientation: { type: 'number' }
      },
      required: ['target', 'time', 'action']
    }
  },
  {
    name: 'add_relay_timer',
    description: 'Naplánuje jednorázový časovač pro relé/světla (bojler, bazén, solinátor, zahrada dole, zahrada nahoře, světlo bazén, noční světla) na daný čas.',
    input_schema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Název zařízení, např. "bojler", "noční světla", "zahrada dole".' },
        time: { type: 'string', description: 'Čas HH:MM (24h).' },
        action: { type: 'string', enum: ['on', 'off'] }
      },
      required: ['device', 'time', 'action']
    }
  },
  {
    name: 'lock_house',
    description: 'Zamkne vchodové dveře domu (Nuki zámek) — např. "zamkni dům", "zamkni dveře".',
    input_schema: { type: 'object', properties: {} }
  }
];

async function runAssistantTool(name, input) {
  switch (name) {
    case 'set_relay': return assistantSetRelay(input.device, input.state === 'on');
    case 'set_aircon': return assistantSetAircon(input);
    case 'control_blinds': return assistantControlBlinds(input);
    case 'set_wallbox': return assistantSetWallbox(input.mode);
    case 'add_aircon_timer': return assistantAddAirconTimer(input);
    case 'add_blind_timer': return assistantAddBlindTimer(input);
    case 'add_relay_timer': return assistantAddRelayTimer(input);
    case 'lock_house': return nukiEnabled ? nukiLock() : 'Zámek není nastaven.';
    default: return `Neznámý nástroj ${name}.`;
  }
}

app.post('/api/assistant', async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!assistantEnabled) return res.status(503).json({ error: 'Asistent není nastaven (chybí ANTHROPIC_API_KEY).' });
  const text = (req.body && req.body.text || '').toString().slice(0, 500).trim();
  if (!text) return res.status(400).json({ error: 'Chybí text.' });

  const prague = pragueTime();
  const system = `Jsi hlasový asistent chytré domácnosti "Šmogyho FVE". Uživatel mluví česky. `
    + `Aktuální čas je ${String(prague.hour).padStart(2, '0')}:${String(prague.minute).padStart(2, '0')}. `
    + `Podle jeho pokynu zavolej správné nástroje a proveď akci. Můžeš zavolat i více nástrojů najednou (např. "zhasni všechna světla"). `
    + `Zařízení: bojler, bazén (filtrace), solinátor, světla (zahrada dole, zahrada nahoře, světlo bazén, noční světla), `
    + `klimatizace v pokojích Obývák/Ložnice/Miky/Elenka, žaluzie v pokojích Obývák/Terasa/Garáž/Ložnice/Miky/Elenka/Hosté, wallbox (nabíječka auta). `
    + `DŮLEŽITÉ – dispozice: Kuchyň je otevřeně spojená s Obývákem. Klimatizace "Obývák" chladí i topí i v kuchyni — ať uživatel řekne kuchyň nebo obývák, jde o stejnou klimatizaci (target "Obývák"). `
    + `Žaluzie: v obýváku jsou dvě se štítky "Obývák Okno" a "Obývák Dveře", kuchyňská žaluzie má štítek "Kuchyň". Pro obývák použij target "Obývák" (ovládne obě obývákové), pro kuchyň target "Kuchyň" (jen kuchyňskou), pro jednu konkrétní použij přesný štítek, např. "Obývák Dveře". `
    + `PERGOLA: Na terase je pergola (lamelová/markýzová střecha) — ovládáš ji jako žaluzii přes control_blinds, target "pergola". action "up" = otevřít/vytáhnout, "down" = zavřít/zatáhnout. Pergola má i vlastní SVĚTLO: "rozsviť/zhasni pergolu" nebo "světlo u pergoly" → set_relay device "světlo terasa" (NE zahradní světla!). Rozliš: "zatáhni/otevři pergolu" = žaluzie (control_blinds), "rozsviť pergolu" = světlo (set_relay). `
    + `SVĚTLA VENKU: "rozsviť/zhasni zahradu" → set_relay device "zahrada" (obě zahradní světla nahoře i dole). "rozsviť/zhasni komplet venek" (celý venek) → set_relay device "komplet venek" (zahrada nahoře + dole + světlo bazén + pergola). Platí i pro zhasínání. `
    + `Umíš taky zamknout dům/vchodové dveře (lock_house). `
    + `LOCKDOWN: Když uživatel řekne "lockdown" (nebo "zabezpeč dům", "odcházím a zabezpeč"), proveď najednou: zhasni všechna světla (set_relay device "všechna světla", state "off"), zatáhni všechny žaluzie (control_blinds target "vše", action "down") a zamkni dům (lock_house). `
    + `Jednej podle situace: když uživatel popíše stav (svítí slunce, je horko, je zima, je tma), sám zvol a proveď vhodnou akci. `
    + `Např. "svítí na mě slunce v kuchyni a je mi teplo" → zatáhni žaluzie v Obýváku a zapni chlazení klimatizace Obývák (třeba na 23 °C). `
    + `SPANÍ: Když uživatel řekne, že jde spát do nějakého pokoje, defaultně v tom pokoji zataženě žaluzie DOLŮ a nakloň lamely do zavření (control_blinds action "down", orientation 100). `
    + `Pokud neřekne jinak, u spaní NESAHEJ na noční světla ani na klimatizaci. `
    + `Výjimka: když jde spát konkrétně do LOŽNICE, navíc vypni noční světla (set_relay noční světla off). `
    + `PŘÍCHOD DOMŮ: Když uživatel řekne, že je/jsou doma (např. "jsem doma", "jsme doma", "přišel jsem domů"), proveď: `
    + `1) všechny žaluzie nakloň na 30 % (control_blinds target "vše", action "down", orientation 30), `
    + `2) pak žaluzii u dveří do obýváku vytáhni nahoru (control_blinds target "Obývák Dveře", action "up"), `
    + `3) zapni noční světla (set_relay noční světla on). `
    + `Nedoptávej se, pokud si dokážeš rozumně poradit — rovnou proveď akci. Zeptej se jen když je pokyn opravdu nejasný nebo zařízení vůbec neexistuje. `
    + `Po provedení odpověz jednou krátkou větou česky, co jsi udělal.`;

  try {
    const messages = [{ role: 'user', content: text }];
    let finalText = '';
    for (let step = 0; step < 4; step++) {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system,
        tools: ASSISTANT_TOOLS,
        messages
      });
      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      if (textBlocks) finalText = textBlocks;
      if (response.stop_reason !== 'tool_use' || !toolUses.length) break;

      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const tu of toolUses) {
        let out;
        try { out = await runAssistantTool(tu.name, tu.input || {}); }
        catch (err) { out = 'Chyba: ' + err.message; }
        addAssistantLog(String(out));
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out) });
      }
      messages.push({ role: 'user', content: results });
    }
    res.json({ reply: finalText || 'Hotovo.' });
  } catch (err) {
    console.error('Asistent:', err.message);
    res.status(502).json({ error: 'Asistent selhal: ' + err.message });
  }
});

// ---------- Infigy (řízení energie) — teplota bojleru atd. ----------
// Přihlášení jde přes Supabase (login → sb-auth-token cookie → /portal/enter
// vrátí portal cookie → socket.io /core/socket.io pošle 'store:snapshot').
// Heslo je jen z env; anon klíč a ID zařízení nejsou tajné (jsou i v appce).

const INFIGY_EMAIL = process.env.INFIGY_EMAIL;
const INFIGY_PASSWORD = process.env.INFIGY_PASSWORD;
const INFIGY_REF = process.env.INFIGY_SUPABASE_REF || 'jclxwzbylxakraflrdje';
const INFIGY_DEVICE_ID = process.env.INFIGY_DEVICE_ID || '100000003b293bd8';
const INFIGY_ANON = process.env.INFIGY_SUPABASE_ANON
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjbHh3emJ5bHhha3JhZmxyZGplIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NjY2MzYxMzgsImV4cCI6MTk4MjIxMjEzOH0.o9rDmjPAJhRKgM9Ddaw69jej0LEDntR9bPhxmRaY7ZY';
const infigyEnabled = !!(INFIGY_EMAIL && INFIGY_PASSWORD);

const INFIGY_UA = 'Mozilla/5.0 (compatible; SmogyFVE/1.0)';

async function infigyLogin() {
  const r = await fetch(`https://${INFIGY_REF}.supabase.co/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: INFIGY_ANON, Authorization: `Bearer ${INFIGY_ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: INFIGY_EMAIL, password: INFIGY_PASSWORD, gotrue_meta_security: {} }),
    signal: AbortSignal.timeout(15000)
  });
  const session = await r.json().catch(() => null);
  if (!r.ok || !session || !session.access_token) {
    throw new Error(`Infigy přihlášení selhalo (HTTP ${r.status}${session && session.error_description ? ': ' + session.error_description : ''}).`);
  }
  return session;
}

async function infigyPortalEnter(sbCookie) {
  const r = await fetch(`https://app.infigy.cz/portal/enter/${INFIGY_DEVICE_ID}?t=${Date.now()}`, {
    headers: { Cookie: sbCookie, 'User-Agent': INFIGY_UA }, redirect: 'manual', signal: AbortSignal.timeout(15000)
  });
  const cookies = (r.headers.getSetCookie && r.headers.getSetCookie()) || [];
  const portal = cookies.map(c => /^portal=([^;]+)/.exec(c)).find(Boolean);
  if (!portal) throw new Error(`Infigy: nepodařilo se otevřít portál zařízení (HTTP ${r.status}).`);
  return portal[1];
}

function infigyFetchSnapshot(cookieHeader) {
  const { io } = require('socket.io-client');
  return new Promise((resolve, reject) => {
    const socket = io('https://app.infigy.cz', {
      path: '/core/socket.io',
      extraHeaders: { Cookie: cookieHeader, 'User-Agent': INFIGY_UA },
      reconnection: false, timeout: 20000, forceNew: true
    });
    const done = (err, store) => {
      clearTimeout(timer);
      try { socket.disconnect(); } catch {}
      err ? reject(err) : resolve(store);
    };
    const timer = setTimeout(() => done(new Error('Infigy: snapshot nedorazil včas.')), 25000);
    socket.on('store:snapshot', (payload) => done(null, (payload && payload.store) || payload || {}));
    socket.on('connect_error', (e) => done(new Error('Infigy socket: ' + (e && e.message || e))));
    socket.on('error', (e) => done(new Error('Infigy socket chyba: ' + (e && e.message || e))));
  });
}

let infigyPollRunning = false;

async function pollInfigy() {
  if (!infigyEnabled || infigyPollRunning) return;
  infigyPollRunning = true;
  try {
    const session = await infigyLogin();
    const sbCookie = `sb-auth-token=${encodeURIComponent(JSON.stringify(session))}`;
    const portal = await infigyPortalEnter(sbCookie);
    const store = await infigyFetchSnapshot(`${sbCookie}; portal=${portal}`);
    const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const round1 = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : null);
    state.infigy = {
      hwTemp: round1(store.HW_TEMP),
      hwSetTemp: num(store.HW_SET_TEMP),
      hwCapacity: num(store.HW_CAPACITY),
      hwOn: !!store.HW_ON,
      hwHeat: !!store.HW_HEAT,
      hwEnergyTotal: round1(store.HW_ENERGY_PRODUCED_TOTAL),
      status: typeof store.STATUS_INFO === 'string' ? store.STATUS_INFO : null,
      spotPrice: num(store.SP_ACTUAL_PRICE),
      // Předpokládaná výroba FVE dnes (kWh)
      forecastPv: round1(store.SP_FORECAST_PV),
      // Wallbox z pohledu Infigy
      wbOn: !!store.WB_ON,
      wbPower: round1(store.WB_ACTUAL_POWER),
      wbState: num(store.WB_STATE),
      wbStateSolax: num(store.WB_STATE_SOLAX),
      wbMaxCurrent: num(store.WB_MAX_CURRENT),
      error: null,
      fetchedAt: new Date().toISOString()
    };
    broadcast('infigy', { infigy: state.infigy });
  } catch (err) {
    state.infigy = { ...state.infigy, error: err.message, fetchedAt: new Date().toISOString() };
    broadcast('infigy', { infigy: state.infigy });
  } finally {
    infigyPollRunning = false;
  }
}

if (infigyEnabled) {
  setTimeout(pollInfigy, 12000);
  setInterval(pollInfigy, 5 * 60 * 1000);
}

// ---------- Nuki zámek ----------
// Tajné údaje jen z env — nikdy v kódu/repu.

const NUKI_TOKEN = process.env.NUKI_TOKEN;
let nukiLockId = process.env.NUKI_SMARTLOCK_ID || null;
const nukiEnabled = !!NUKI_TOKEN;

// ---- Nuki Web API (oficiální) ----
async function nukiSmartlockId() {
  if (nukiLockId) return nukiLockId;
  const r = await fetch('https://api.nuki.io/smartlock', {
    headers: { Authorization: `Bearer ${NUKI_TOKEN}` }, signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`Nuki HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list) || !list.length) throw new Error('Nuki nevrátil žádný zámek.');
  nukiLockId = String(list[0].smartlockId);
  return nukiLockId;
}

async function nukiLock() {
  const id = await nukiSmartlockId();
  const r = await fetch(`https://api.nuki.io/smartlock/${id}/action/lock`, {
    method: 'POST', headers: { Authorization: `Bearer ${NUKI_TOKEN}` }, signal: AbortSignal.timeout(15000)
  });
  if (!r.ok && r.status !== 204) throw new Error(`Nuki HTTP ${r.status}`);
  return 'Zamčeno.';
}

app.post('/api/nuki/lock', async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!nukiEnabled) return res.status(503).json({ error: 'Nuki není nastaven.' });
  try {
    const msg = await nukiLock();
    addLog('Nuki: zamčeno (ručně)');
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- Keep-alive a start ----------

app.get('/healthz', (req, res) => res.send('ok'));

// Render free tier uspává službu po 15 min bez requestů — tím by zamrzla historie grafu.
// Self-ping přes veřejnou URL (Render ji dává v RENDER_EXTERNAL_URL) službu drží vzhůru.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    fetch(`${SELF_URL}/healthz`).catch(() => {});
  }, 10 * 60 * 1000);
}

pollSolax();
pollShelly();
setInterval(pollSolax, POLL_INTERVAL_MS);
setInterval(pollShelly, POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
});
