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
  timeline: { shelly: [], pool: [], solinator: [] } // segmenty { from, to } zapnutí za 48 h
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
}

function addLog(msg) {
  const entry = { t: Date.now(), msg };
  state.log.push(entry);
  pruneHistory();
  broadcast('log', { entry });
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
  const houseKw = Math.max(0, (dc1 + dc2 + dc3 + dc4 - batPower - (r.feedinpower || 0)) / 1000);
  const batterySoc = typeof r.soc === 'number' ? r.soc : null;

  return {
    fveKw,
    feedinKw,
    houseKw,
    batterySoc,
    batPowerKw: batPower / 1000,
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

  const response = await shellyQueued(() => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  }));

  if (!response.ok) {
    throw Object.assign(new Error(`Shelly API HTTP ${response.status}`), { status: 502 });
  }

  const data = await response.json();

  if (!data.isok) {
    throw Object.assign(new Error('Shelly API odmítlo příkaz.'), { status: 502 });
  }

  // Po úspěšném přepnutí zneplatníme cache pro toto zařízení, ať se hned ukáže nový stav
  shellyCache.delete(deviceId);
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
  for (const k of Object.keys(state.timeline)) {
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

// Ruční refresh z appky: Solax hned, Shelly cyklus na pozadí (chráněný zámkem)
app.post('/api/refresh', async (req, res) => {
  pollShelly();
  await pollSolax();
  res.json({ ok: true });
});

// ---------- Zámek ovládání (PIN) ----------

// Bez APP_PIN je ovládání odemčené jako dřív; s ním vyžadují /set endpointy token
const APP_PIN = process.env.APP_PIN;
const lockEnabled = !!APP_PIN;
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
  return res.json();
}

let blindsCache = { ts: 0, list: [] };

async function getBlinds() {
  if (blindsCache.list.length && Date.now() - blindsCache.ts < 60 * 1000) {
    return blindsCache.list;
  }
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
        orientation: cmds.has('setOrientation') ? 'setOrientation' : null
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
      commands: ((d.definition && d.definition.commands) || []).map(c => c.commandName)
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
  const parameters = action === 'orientation' ? [Math.round(value)] : [];
  await tahomaFetch('/exec/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: `Šmogyho FVE: ${blind.label} ${action}`,
      actions: [{ deviceURL, commands: [{ name: cmd, parameters }] }]
    })
  });
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
  let v = null;
  if (action === 'orientation') {
    v = Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return res.status(400).json({ error: 'Naklopení musí být 0–100.' });
    }
  }
  try {
    const blind = await blindCommand(deviceURL, action, v);
    const suffix = action === 'orientation' ? ` ${Math.round(v)} %` : '';
    addLog(`${blind.label}: ${BLIND_ACTION_LABELS[action]}${suffix}`);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
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
