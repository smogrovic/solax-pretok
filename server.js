// Na Renderu jdou proměnné z prostředí; na NASu/lokálně z volitelného .env souboru
try { require('dotenv').config(); } catch {}

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

// Teplotní čidla (Shelly H&T) — jen ke čtení, proto stranou od DEVICES: nemají ON/OFF
// endpointy ani stav relé. Klíč pokoje je stejný jako v TEMP_AUTO_RULES.
const TEMP_SENSORS = {
  obyvak: { deviceId: process.env.SHELLY_TEMP_OBYVAK_ID || '08927250b96c', serverUri: SHELLY_SERVER_URI }
};
// Jak dlouhé ticho čidla stojí za zmínku v logu. NEurčuje platnost dat — podle čidla se
// jede dál i po delším tichu, protože ticho znamená stabilní teplotu.
const SENSOR_SILENCE_LOG_MS = 6 * 60 * 60 * 1000;
const SENSOR_LOW_BATTERY = 15;

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
  // Tlačítko „+24 h": bazén jede natvrdo do tohohle času, bez ohledu na přebytek,
  // okno, SOC i zimní režim. Sčítá se po 24 h do stropu 72 h.
  poolForce: { until: 0 },
  history: [],       // { t, kw } — přetok za posledních 24 h
  log: [],           // { t, msg } — záznamy zapínání/vypínání za 24 h
  // Hlavní přepínač automatiky (jezdec na stránce Asistent): vypnuto / zapnuto / zima.
  // Zima = bazén a solinátor spí, bojler se odpojí od bazénu, wallbox jede pořád FAST
  // a klimatizace drží teplotu v režimu AUTO.
  autoMode: 'on',
  manualHold: {},    // key -> dokdy (ms) má ruční zásah přednost před automatikou
  weather: null,     // { tempC, sunsetMs, fetchedAt } pro zobrazení v appce
  // dnešní doba běhu (ms) + denní energie (Wh) + snapshot včerejška
  runtime: {
    date: '',
    ms: { shelly: 0, pool: 0, solinator: 0 },
    wh: { feed: 0, import: 0, wb: 0, b1: 0, b2: 0 },
    yesterday: null, // { ms:{...}, wh:{...} }
    lastTs: Date.now()
  },
  timeline: { shelly: [], pool: [], solinator: [], wallbox: [] }, // segmenty { from, to } zapnutí za 48 h
  aircon: { devices: [], error: null }, // Panasonic klimatizace
  wallbox: { power: null, energy: null, mode: null, status: null, error: null }, // Solax EV charger
  wallboxHistory: [], // { t, w } — výkon nabíječky za posledních 24 h
  wbAuto: true,       // režim wallboxu: true = automatika (green/fast), false = pevně FAST
  // Ruční přepnutí „ráno auto (ne)potřebuju" pro nejbližší ráno; need null = jede se
  // podle dne v týdnu (pracovní den ano, víkend ne)
  wbMorning: { need: null, until: 0 },
  wbModeHistory: [],  // { t, mode } — kdy byl jaký režim (za 48 h)
  wbLastTarget: null, // poslední režim nastavený automatikou (aby zbytečně necvakal dokola)
  infigy: { error: null }, // data z Infigy (teplota bojleru atd.)
  boilerHistory: [],  // { t, b1, b2 } — teploty bojlerů za posledních 24 h
  tempAuto: { obyvak: false, loznice: false, elenka: false, miky: false }, // teplotní automatika klimatizace (zap/vyp per pokoj)
  tempAutoOn: 22,    // společná spínací teplota (18–25 °C, jezdec v appce) — Ložnice, Elenka, Miky
  // Pokoje s vlastní mezí. Obývák se řídí podle Shelly čidla v obytné zóně, které ukazuje
  // níž než čidla v klimatizacích, takže jedna společná hodnota by u něj znamenala něco jiného.
  tempAutoOnRooms: { obyvak: 22 },
  // Zimní režim klimatizace drží CÍLOVOU teplotu (ne spínací mez jako v létě), proto
  // vlastní čísla: zapne se při rozdílu 2 °C na kteroukoli stranu, vypne do 1 °C.
  tempAutoWinter: 21,
  tempAutoWinterRooms: { obyvak: 21 },
  // Solinátor jede na denní rozpočet hodin: cíl = základ + bonus za teplotu + boost.
  // Odběhnutý čas se bere z state.runtime.ms.solinator (nuluje se o pražské půlnoci).
  // carryMs je JEN informativní: kolik z boostMs pochází z přenosu předchozího dne.
  // Do výpočtu cíle nevstupuje (ten je základ + bonusMs + boostMs), slouží k rozpisu v appce.
  // bonusTempC/bonusSrc ('fc' = předpověď, 'now' = naměřeno) drží DŮVOD přirážky,
  // ať appka nepíše k číslu teplotu dopočítanou o hodiny později
  solinator: { date: '', bonusMs: 0, bonusTempC: null, bonusSrc: null, bonusFloored: false, boostMs: 0, carryMs: 0, disabledUntil: 0 },
  pvDays: [],        // { d, fcAm, fcPm, actual } — denní odhad vs. skutečná výroba (graf za 10 dní)
  assistantLog: [],  // { t, text } — co asistent provedl, za 24 h
  sensors: {},       // pokoj -> { tempC, humidity, battery, online, reportedAt, fetchedAt } (Shelly H&T)
  // teploty v pokojích za 24 h pro graf: temps = podle guid klimatizace, sens = Shelly čidla
  airconHistory: []  // { t, temps: { guid: °C }, sens: { pokoj: °C } }
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

app.use(express.static(path.join(__dirname, 'public'), {
  // HTML a service worker nikdy necachovat, ať se po deployi appka vždy načte čerstvá
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
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

// level: 'error' se v appce vykreslí tučně červeně. Chybové záznamy si navíc drží
// `tEnd` — dokud výpadek trvá, neroste počet řádků, jen se posouvá konec rozsahu.
function addLog(msg, level) {
  const entry = { t: Date.now(), msg };
  if (level) entry.level = level;
  state.log.push(entry);
  pruneHistory();
  broadcast('log', { entry });
  return entry;
}

function addAssistantLog(text) {
  if (!text) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  state.assistantLog = state.assistantLog.filter(e => e.t >= cutoff);
  state.assistantLog.push({ t: Date.now(), text });
  if (state.assistantLog.length > 30) state.assistantLog = state.assistantLog.slice(-30);
  broadcast('assistantLog', { log: state.assistantLog });
}

// Jede automatika vůbec, a jede v zimním režimu? Zbytek kódu se ptá jen přes tyhle dvě.
const AUTO_MODES = ['off', 'on', 'winter'];
function autoRunning() { return state.autoMode !== 'off'; }
function isWinter() { return state.autoMode === 'winter'; }

function snapshot() {
  pruneHistory();
  return {
    solax: state.solax,
    devices: state.devices,
    poolPowerW: state.poolPowerW,
    poolForce: state.poolForce,
    history: state.history,
    log: state.log,
    autoMode: state.autoMode,
    autoEnabled: autoRunning(),   // starší klienti čtou jen tohle
    manualHold: state.manualHold,
    weather: state.weather,
    runtime: runtimePayload(),
    pvDays: state.pvDays,
    timeline: state.timeline,
    blindsEnabled: tahomaEnabled,
    blindTimers,
    relayTimers,
    aircon: state.aircon,
    airconEnabled: panasonicEnabled,
    airconTimers,
    tempAuto: state.tempAuto,
    ...thresholdPayload(),
    solinator: state.solinator,
    solinatorPlan: solinatorPlan(),
    wallbox: state.wallbox,
    wallboxEnabled,
    wallboxHistory: state.wallboxHistory,
    ...wbSwitchPayload(),
    wbModeHistory: state.wbModeHistory,
    infigy: state.infigy,
    infigyEnabled,
    boilerHistory: state.boilerHistory,
    assistantEnabled: !!process.env.ANTHROPIC_API_KEY,
    assistantLog: state.assistantLog,
    nukiEnabled,
    pushEnabled,
    lockEnabled,
    sensors: state.sensors,
    airconHistory: state.airconHistory
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
  const inf = state.infigy || {};
  // Odběry, které mají vlastní dlaždici — měříme je zvlášť a odečteme, ať nejsou ve
  // "spotřebě domu" započítané dvakrát (Bojler 1 = Shelly, Bojler 2 = Infigy, bazén, wallbox)
  const wallboxW = (state.wallbox && typeof state.wallbox.power === 'number') ? state.wallbox.power : 0;
  const boiler1W = (state.devices.shelly && typeof state.devices.shelly.powerW === 'number') ? state.devices.shelly.powerW : 0;
  const boiler2W = (typeof inf.hwPower === 'number') ? inf.hwPower * 1000 : 0;
  const poolW = (typeof state.poolPowerW === 'number') ? state.poolPowerW : 0;

  // Spotřeba domu (zbytek baráku) = výroba − do baterie − přetok − oba bojlery − bazén − wallbox.
  // Výrobu a tok baterie bereme přednostně z Infigy (shodné s dlaždicemi, živější), přetok ze Solaxu.
  const pvW = (typeof inf.pvPower === 'number') ? inf.pvPower * 1000 : (dc1 + dc2 + dc3 + dc4);
  const chargeW = (typeof inf.batteryPower === 'number') ? (-inf.batteryPower * 1000) : batPower; // kladné = nabíjení
  const wallboxSubW = (typeof inf.wbPower === 'number') ? inf.wbPower * 1000 : wallboxW;
  const houseKw = Math.max(0, (pvW - chargeW - (r.feedinpower || 0) - wallboxSubW - boiler1W - boiler2W - poolW) / 1000);
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
      historyPoint = { t: Date.now(), kw: data.feedinKw, soc: data.batterySoc };
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

  // Teplota/vlhkost/baterie — hlásí je H&T čidlo. POZOR: `temperature:0` posílá i relé,
  // ale to je jeho VNITŘNÍ teplota. Jako teplotu v pokoji to smí vzít jen volající,
  // který ví, že jde o čidlo z TEMP_SENSORS (viz pollSensor).
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const tempC = num(status?.['temperature:0']?.tC) ?? num(status?.tmp?.value);
  const humidity = num(status?.['humidity:0']?.rh) ?? num(status?.hum?.value);
  const battery = num(status?.['devicepower:0']?.battery?.percent) ?? num(status?.bat?.value);
  // Cloud přikládá čas poslední aktualizace ve tvaru "2026-08-10 19:30:29" (UTC)
  const updatedRaw = status?._updated;
  const updatedTs = typeof updatedRaw === 'string' ? Date.parse(updatedRaw.replace(' ', 'T') + 'Z') : NaN;

  const result = {
    online: !!online, isOn, powerW,
    tempC, humidity, battery,
    updatedAt: Number.isFinite(updatedTs) ? updatedTs : null
  };
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

// Teplotní čidlo. Na rozdíl od relé se neukládá stav zapnutí — jen naměřené hodnoty.
async function pollSensor(room) {
  const cfg = TEMP_SENSORS[room];
  const prev = state.sensors[room] || {};
  try {
    const s = await fetchShellyStatus(cfg.serverUri, cfg.deviceId);
    // Kdy čidlo naposledy hlásilo. Cloud dává `_updated`; když ne, bereme poslední chvíli,
    // kdy bylo online — bateriové čidlo cloud během spánku hlásí jako offline, takže
    // pouhé `online:false` ještě neznamená, že je hodnota k zahození.
    const reportedAt = s.updatedAt || (s.online ? Date.now() : (prev.reportedAt || null));
    state.sensors[room] = {
      tempC: s.tempC, humidity: s.humidity, battery: s.battery,
      online: s.online, reportedAt, fetchedAt: Date.now()
    };
    checkSensorBattery(room, s.battery);
  } catch {
    // Výpadek dotazu není výpadek čidla — poslední známou hodnotu si necháme
    // a jede se dál podle ní (viz sensorTempC).
    state.sensors[room] = { ...prev, online: false, fetchedAt: Date.now() };
  }
  broadcast('sensor', { room, sensor: state.sensors[room] });
}

// Poslední známá teplota z čidla — BEZ ohledu na stáří. Čidlo hlásí jen při změně
// teploty, takže při stabilní teplotě mlčí a „stará" hodnota je ta správná. Kdyby se po
// pár hodinách ticha sáhlo po čidle v klimatizaci (u stropu, ukazuje o ~2 °C víc),
// klimatizace by naskočila bez důvodu. Nepřidávej sem kontrolu stáří.
// null = čidlo nehlásilo ještě nikdy (čerstvý start serveru).
function sensorTempC(room) {
  const s = state.sensors[room];
  return s && typeof s.tempC === 'number' ? s.tempC : null;
}

const sensorBatteryWarned = {};
function checkSensorBattery(room, battery) {
  if (typeof battery !== 'number') return;
  if (battery <= SENSOR_LOW_BATTERY && !sensorBatteryWarned[room]) {
    sensorBatteryWarned[room] = true;
    const label = (TEMP_AUTO_RULES.find(r => r.key === room) || {}).room || room;
    addLog(`Čidlo ${label}: slabá baterie (${Math.round(battery)} %)`);
    sendPushToAll('Slabá baterie čidla', `Teplotní čidlo ${label} hlásí ${Math.round(battery)} %.`);
  } else if (battery > SENSOR_LOW_BATTERY + 10) {
    sensorBatteryWarned[room] = false;   // po výměně/nabití se upozornění zase natáhne
  }
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
    for (const room of Object.keys(TEMP_SENSORS)) {
      await pollSensor(room);
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

// ---------- Denní odhad výroby vs. skutečnost (graf „jak se odhad trefil") ----------
// Zapisuje se PRŮBĚŽNĚ, ne až o půlnoci — kdyby se server v noci restartoval,
// dokončený den je už uložený.
const PV_DAYS_MAX = 14;

function recordPvDay() {
  const d = pragueDateString();
  let rec = state.pvDays.find(r => r.d === d);
  if (!rec) { rec = { d, fcAm: null, fcPm: null, actual: null }; state.pvDays.push(rec); }
  const fc = state.infigy && typeof state.infigy.forecastPv === 'number' ? state.infigy.forecastPv : null;
  const act = state.solax && typeof state.solax.yieldToday === 'number' ? state.solax.yieldToday : null;
  if (fc !== null && fc > 0) {
    // Ranní odhad: první hodnota po 7:00, dál se nepřepisuje (poctivá předpověď dne dopředu)
    if (rec.fcAm === null && pragueTime().hour >= 7) rec.fcAm = fc;
    rec.fcPm = fc; // Večerní odhad: poslední viděná hodnota dne
  }
  // Maximum chrání před restartem serveru, po kterém Solax krátce hlásí 0
  if (act !== null) rec.actual = Math.max(rec.actual || 0, act);
  if (state.pvDays.length > PV_DAYS_MAX) {
    state.pvDays.sort((a, b) => a.d.localeCompare(b.d));
    state.pvDays = state.pvDays.slice(-PV_DAYS_MAX);
  }
}

function emptyWh() { return { feed: 0, import: 0, wb: 0, b1: 0, b2: 0 }; }
function runtimePayload() {
  return { date: state.runtime.date, ms: state.runtime.ms, wh: state.runtime.wh, yesterday: state.runtime.yesterday };
}

// Dnešní doba běhu + denní energie; o pražské půlnoci se dnešek uloží jako včerejšek a vynuluje
function updateRuntimes() {
  const today = pragueDateString();
  const now = Date.now();
  const dt = Math.min(now - state.runtime.lastTs, 10 * 60 * 1000);
  if (state.runtime.date !== today) {
    if (state.runtime.date) state.runtime.yesterday = { ms: state.runtime.ms, wh: state.runtime.wh };
    state.runtime.date = today;
    state.runtime.ms = { shelly: 0, pool: 0, solinator: 0 };
    state.runtime.wh = emptyWh();
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
  // Wallbox: aktivní kdykoli výkon > 0 (nepočítá se do doby běhu relé).
  // Výkon bereme přednostně z Infigy (živější — Solax často hlásí 0 i při nabíjení).
  const wbW = (state.infigy && typeof state.infigy.wbPower === 'number')
    ? state.infigy.wbPower * 1000
    : (state.wallbox && typeof state.wallbox.power === 'number' ? state.wallbox.power : 0);
  if (wbW > 0) {
    const segs = state.timeline.wallbox;
    const last = segs[segs.length - 1];
    if (last && now - last.to <= TIMELINE_GAP_MS) {
      last.to = now;
    } else {
      segs.push({ from: now, to: now });
    }
  }
  // Denní energie (Wh): přetok/odběr ze sítě, wallbox, oba bojlery
  const dtH = dt / 3600000;
  const wh = state.runtime.wh;
  const feedKw = state.solax && typeof state.solax.feedinKw === 'number' ? state.solax.feedinKw : 0;
  if (feedKw >= 0) wh.feed += feedKw * 1000 * dtH; else wh.import += -feedKw * 1000 * dtH;
  const wbKw = (state.infigy && typeof state.infigy.wbPower === 'number') ? state.infigy.wbPower
    : (state.wallbox && typeof state.wallbox.power === 'number' ? state.wallbox.power / 1000 : 0);
  wh.wb += Math.max(0, wbKw) * 1000 * dtH;
  const b1W = (state.devices.shelly && typeof state.devices.shelly.powerW === 'number') ? state.devices.shelly.powerW : 0;
  wh.b1 += Math.max(0, b1W) * dtH;
  const b2Kw = (state.infigy && typeof state.infigy.hwPower === 'number') ? state.infigy.hwPower : 0;
  wh.b2 += Math.max(0, b2Kw) * 1000 * dtH;

  state.runtime.lastTs = now;
  recordPvDay();
  pruneTimeline();
  broadcast('runtime', { runtime: runtimePayload() });
  broadcast('timeline', { timeline: state.timeline });
  broadcast('pvDays', { pvDays: state.pvDays });
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
      setManualHold(key);   // automatika to půl hodiny nepřebije
      // Vypnout bazén ručně a nechat ho +24 h za dvě minuty zase rozsvítit by bylo horší
      // než kdyby tlačítko nefungovalo vůbec — OFF je novější rozhodnutí, tak override padá
      const zrusenoForce = key === 'pool' && turn === 'off' && poolForceActive();
      if (zrusenoForce) clearPoolForce();
      addLog(`${DEVICE_LABELS[key]}: ${turn === 'on' ? 'zapnuto' : 'vypnuto'} ručně`
        + (AUTOMATED_KEYS.includes(key) ? ` (automatika převezme v ${fmtPragueTime(state.manualHold[key])})` : '')
        + (zrusenoForce ? ' · zrušeno +24 h' : ''));

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

// Obnova historie teplot bojlerů po restartu/deployi (klient drží zálohu v localStorage)
// Historie teplot v pokojích ze zálohy v telefonu — po deployi server startuje s prázdnou
app.post('/api/aircon-history/restore', (req, res) => {
  const points = req.body && Array.isArray(req.body.points) ? req.body.points : null;
  if (!points) return res.status(400).json({ error: 'Chybí points.' });

  const now = Date.now();
  const cutoff = now - AIRCON_HISTORY_MAX_AGE_MS;
  // Teploty v pokoji: cokoli mimo tenhle rozsah je zjevně nesmysl, ne data
  const okMap = m => m && typeof m === 'object' && !Array.isArray(m)
    && Object.values(m).every(v => typeof v === 'number' && v > -30 && v < 60);
  const clean = points
    .filter(p => p && typeof p.t === 'number' && p.t >= cutoff && p.t <= now
      && okMap(p.temps || {}) && okMap(p.sens || {})
      && (Object.keys(p.temps || {}).length || Object.keys(p.sens || {}).length))
    .map(p => ({ t: p.t, temps: p.temps || {}, sens: p.sens || {} }))
    .slice(0, 2000);
  if (!clean.length) return res.json({ added: 0 });

  const before = state.airconHistory.length;
  const all = state.airconHistory.concat(clean).sort((a, b) => a.t - b.t);
  const merged = [];
  for (const p of all) {
    if (!merged.length || p.t - merged[merged.length - 1].t > 30000) merged.push(p);
  }
  state.airconHistory = merged.filter(p => p.t >= cutoff);
  const added = state.airconHistory.length - before;
  if (added > 0) broadcast('airconHistory', { history: state.airconHistory });
  res.json({ added });
});

app.post('/api/boiler-history/restore', (req, res) => {
  const points = req.body && Array.isArray(req.body.points) ? req.body.points : null;
  if (!points) return res.status(400).json({ error: 'Chybí points.' });

  const now = Date.now();
  const cutoff = now - HISTORY_MAX_AGE_MS;
  const okTemp = v => v === null || (typeof v === 'number' && v > -60 && v < 150);
  const clean = points
    .filter(p => p && typeof p.t === 'number' && p.t >= cutoff && p.t <= now && okTemp(p.b1) && okTemp(p.b2)
      && (typeof p.b1 === 'number' || typeof p.b2 === 'number'))
    .map(p => ({ t: p.t, b1: typeof p.b1 === 'number' ? p.b1 : null, b2: typeof p.b2 === 'number' ? p.b2 : null }))
    .slice(0, 2000);
  if (!clean.length) return res.json({ added: 0 });

  const before = state.boilerHistory.length;
  const all = state.boilerHistory.concat(clean).sort((a, b) => a.t - b.t);
  const merged = [];
  for (const p of all) {
    if (!merged.length || p.t - merged[merged.length - 1].t > 30000) merged.push(p);
  }
  state.boilerHistory = merged.filter(p => p.t >= now - HISTORY_MAX_AGE_MS);
  const added = state.boilerHistory.length - before;
  if (added > 0) broadcast('boilerHistory', { history: state.boilerHistory });
  res.json({ added });
});

// Obnova historie režimů wallboxu po restartu/deployi (jen změny nastaveného režimu)
app.post('/api/wb-mode-history/restore', (req, res) => {
  const entries = req.body && Array.isArray(req.body.entries) ? req.body.entries : null;
  if (!entries) return res.status(400).json({ error: 'Chybí entries.' });

  const now = Date.now();
  const cutoff = now - TIMELINE_MAX_AGE_MS;
  const validModes = ['stop', 'fast', 'eco', 'green'];
  const clean = entries
    .filter(e => e && typeof e.t === 'number' && validModes.includes(e.mode) && e.t >= cutoff && e.t <= now)
    .slice(0, 1000);
  if (!clean.length) return res.json({ added: 0 });

  const before = state.wbModeHistory.length;
  const all = state.wbModeHistory.concat(clean).sort((a, b) => a.t - b.t);
  const merged = [];
  for (const e of all) {
    const last = merged[merged.length - 1];
    if (!last || last.mode !== e.mode) merged.push({ t: e.t, mode: e.mode }); // po sobě jdoucí stejné sloučíme
  }
  state.wbModeHistory = merged.filter(e => e.t >= now - TIMELINE_MAX_AGE_MS);
  const added = state.wbModeHistory.length - before;
  if (added > 0) broadcast('wbModeHistory', { history: state.wbModeHistory });
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
  const { date, ms, wh, yesterday } = req.body || {};
  if (typeof date !== 'string' || !ms || typeof ms !== 'object') {
    return res.status(400).json({ error: 'Chybí date/ms.' });
  }
  let changed = false;
  // Včerejšek: když ho po deployi nemáme a telefon ho má, převezmeme
  if (yesterday && typeof yesterday === 'object' && !state.runtime.yesterday) {
    state.runtime.yesterday = yesterday;
    changed = true;
  }
  if (date === pragueDateString()) {
    if (state.runtime.date !== date) {
      state.runtime.date = date;
      state.runtime.ms = { shelly: 0, pool: 0, solinator: 0 };
      state.runtime.wh = emptyWh();
    }
    for (const k of Object.keys(state.runtime.ms)) {
      const v = Number(ms[k]);
      if (Number.isFinite(v) && v > state.runtime.ms[k] && v <= 24 * 60 * 60 * 1000) { state.runtime.ms[k] = v; changed = true; }
    }
    if (wh && typeof wh === 'object') {
      for (const k of Object.keys(state.runtime.wh)) {
        const v = Number(wh[k]);
        if (Number.isFinite(v) && v > state.runtime.wh[k] && v <= 500000) { state.runtime.wh[k] = v; changed = true; }
      }
    }
  }
  if (changed) {
    broadcast('runtime', { runtime: runtimePayload() });
    // Odhad na zítřek stojí na odběhnutém čase — po deployi je na serveru nula a bez
    // tohohle by se do dalšího dne tvářil jako dluh čas, který se dnes dávno odběhl
    broadcastSolinator();
  }
  res.json({ ok: true });
});

// Obnova denní historie výroby po deployi — telefon drží zálohu.
// Doplňujeme jen chybějící (živé hodnoty serveru nepřepisujeme), u výroby bereme vyšší.
app.post('/api/pvdays/restore', (req, res) => {
  const days = req.body && Array.isArray(req.body.pvDays) ? req.body.pvDays : null;
  if (!days) return res.status(400).json({ error: 'Chybí pvDays.' });
  const num = v => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 200 ? v : null);
  let changed = false;
  for (const inc of days.slice(0, PV_DAYS_MAX)) {
    if (!inc || typeof inc.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(inc.d)) continue;
    const am = num(inc.fcAm), pm = num(inc.fcPm), ac = num(inc.actual);
    if (am === null && pm === null && ac === null) continue; // samé nesmysly → nezakládat prázdný den
    let rec = state.pvDays.find(r => r.d === inc.d);
    if (!rec) { rec = { d: inc.d, fcAm: null, fcPm: null, actual: null }; state.pvDays.push(rec); changed = true; }
    if (rec.fcAm === null && am !== null) { rec.fcAm = am; changed = true; }
    if (rec.fcPm === null && pm !== null) { rec.fcPm = pm; changed = true; }
    if (ac !== null && ac > (rec.actual || 0)) { rec.actual = ac; changed = true; }
  }
  if (changed) {
    state.pvDays.sort((a, b) => a.d.localeCompare(b.d));
    state.pvDays = state.pvDays.slice(-PV_DAYS_MAX);
    broadcast('pvDays', { pvDays: state.pvDays });
  }
  res.json({ ok: true, days: state.pvDays.length });
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

const AUTO_MODE_LABELS = { off: 'vypnuta', on: 'zapnuta', winter: 'zimní režim' };

function automationPayload() {
  return { autoMode: state.autoMode, enabled: autoRunning() };
}
// Sáhl někdo na režim od startu procesu? Pak už ho telefon obnovou nepřebije.
let autoModeTouched = false;
function setAutoMode(mode, why) {
  autoModeTouched = true;
  if (state.autoMode === mode) return;
  state.autoMode = mode;
  addLog(`Automatika: ${AUTO_MODE_LABELS[mode]}${why ? ` (${why})` : ''}`);
  broadcast('automation', automationPayload());
  broadcast('tempAutoOn', thresholdPayload());   // appka přepne na zimní jezdec
  if (wallboxEnabled) broadcast('wbAuto', wbSwitchPayload());
  // Ať se přepnutí projeví hned — hlavně cesta do zimy, kde má bazén zhasnout
  state.wbLastTarget = null;
  runAutomation().catch(() => {});
  runEnergyControl().catch(() => {});
}

// Hlavní přepínač automatiky (vyžaduje odemčení stejně jako ovládání relé).
// Bere `mode` (vypnuto/zapnuto/zima) i staré `enabled` — kvůli asistentovi a starším klientům.
app.post('/api/automation', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { mode, enabled } = req.body || {};
  let next;
  if (mode !== undefined) {
    if (!AUTO_MODES.includes(mode)) {
      return res.status(400).json({ error: 'Parametr mode musí být off, on nebo winter.' });
    }
    next = mode;
  } else if (typeof enabled === 'boolean') {
    // Zapnutí ze starého klienta nesmí shodit zimu na obyčejné „on"
    next = enabled ? (isWinter() ? 'winter' : 'on') : 'off';
  } else {
    return res.status(400).json({ error: 'Chybí mode (off/on/winter).' });
  }
  setAutoMode(next, 'ručně');
  res.json(automationPayload());
});

// Obnova po deployi: zimní režim je nastavení na měsíce, po restartu by se jinak vrátil
// na „zapnuto" a spustil bazén. Telefon drží zálohu a nabídne ji, dokud na režim
// od startu procesu nikdo nesáhl.
app.post('/api/automation/restore', (req, res) => {
  const { mode } = req.body || {};
  if (AUTO_MODES.includes(mode) && !autoModeTouched) {
    if (state.autoMode !== mode) {
      state.autoMode = mode;
      addLog(`Automatika: ${AUTO_MODE_LABELS[mode]} (obnoveno z telefonu)`);
      broadcast('automation', automationPayload());
    }
    autoModeTouched = true;   // ať druhý telefon se starší zálohou první nepřebije
  }
  res.json(automationPayload());
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
      delete tempAutoOffAt[key]; // ruční zapnutí automatiky ruší blokaci minimálního klidu
      if (panasonicEnabled) setTimeout(pollAircon, 500); // hned vyhodnotit
    } else if (panasonicEnabled && rule) {
      // Vypnutí přepínače = vypnout i klimatizaci, ne ji nechat běžet v aktuálním stavu
      tempAutoTurnOff(rule);
    }
  }
  res.json({ tempAuto: state.tempAuto });
});

function thresholdPayload() {
  return {
    tempAutoOn: state.tempAutoOn,
    tempAutoOnRooms: state.tempAutoOnRooms,
    tempAutoWinter: state.tempAutoWinter,
    tempAutoWinterRooms: state.tempAutoWinterRooms,
    // Meze jezdců posílá server, ať je appka nemá napsané zvlášť a nenabídne hodnotu,
    // kterou by pak endpoint odmítl
    tempAutoLimits: {
      shared: tempAutoLimits(),
      rooms: Object.fromEntries(Object.keys(state.tempAutoOnRooms).map(k => [k, tempAutoLimits(k)]))
    },
    tempAutoWinterLimits: { min: TEMP_AUTO_WINTER_MIN, max: TEMP_AUTO_WINTER_MAX }
  };
}
// Rozsah je per pokoj — obývák má vlastní (22–26 °C), zbytek společný (18–25 °C)
const validThreshold = (t, roomKey) => {
  const { min, max } = tempAutoLimits(roomKey);
  return Number.isInteger(t) && t >= min && t <= max;
};
// Zimní cíl má jeden rozsah pro všechny pokoje
const validWinterTarget = t =>
  Number.isInteger(t) && t >= TEMP_AUTO_WINTER_MIN && t <= TEMP_AUTO_WINTER_MAX;

// Spínací teplota. Bez `key` jde o společnou mez (Ložnice, Elenka, Miky),
// s `key` o mez pokoje, který má vlastní jezdec (obývák).
// S `winter: true` se nastavuje zimní CÍLOVÁ teplota, ne letní spínací mez.
app.post('/api/tempauto/threshold', (req, res) => {
  if (!requireAuth(req, res)) return;
  const temp = Number(req.body && req.body.temp);
  const key = req.body && req.body.key;
  const winter = !!(req.body && req.body.winter);
  const rooms = winter ? state.tempAutoWinterRooms : state.tempAutoOnRooms;
  if (key !== undefined && !Object.prototype.hasOwnProperty.call(rooms, key)) {
    return res.status(400).json({ error: 'Tenhle pokoj nemá vlastní mez.' });
  }
  if (winter ? !validWinterTarget(temp) : !validThreshold(temp, key)) {
    const { min, max } = winter
      ? { min: TEMP_AUTO_WINTER_MIN, max: TEMP_AUTO_WINTER_MAX }
      : tempAutoLimits(key);
    return res.status(400).json({ error: `Teplota musí být celé číslo ${min}–${max} °C.` });
  }
  const current = key !== undefined ? rooms[key] : (winter ? state.tempAutoWinter : state.tempAutoOn);
  if (current !== temp) {
    if (key !== undefined) rooms[key] = temp;
    else if (winter) state.tempAutoWinter = temp;
    else state.tempAutoOn = temp;
    const rule = key !== undefined ? TEMP_AUTO_RULES.find(r => r.key === key) : null;
    const kde = `Teplotní automatika${rule ? ' ' + rule.room : ''}`;
    if (winter) {
      addLog(`${kde}: zima — držet na ${temp} °C`
        + ` (zapnout při rozdílu ${TEMP_AUTO_WINTER_ON_DIFF} °C, vypnout do ${TEMP_AUTO_WINTER_OFF_DIFF} °C)`);
    } else {
      const l = tempAutoLevels(key);
      addLog(`${kde}: spínat při ${l.onTemp} °C (vypínat při ${l.offTemp} °C)`);
    }
    broadcast('tempAutoOn', thresholdPayload());
    if (panasonicEnabled) setTimeout(pollAircon, 500); // hned přehodnotit podle nové meze
  }
  res.json(thresholdPayload());
});

// Obnova nastavených mezí po deployi (telefon drží zálohu) — jen hodnoty, ne přepínače
app.post('/api/tempauto/restore', (req, res) => {
  const b = req.body || {};
  let changed = false;
  const temp = Number(b.tempAutoOn);
  if (validThreshold(temp) && state.tempAutoOn !== temp) {
    state.tempAutoOn = temp; changed = true;
  }
  const rooms = b.tempAutoOnRooms;
  if (rooms && typeof rooms === 'object') {
    for (const key of Object.keys(state.tempAutoOnRooms)) {
      const v = Number(rooms[key]);
      if (validThreshold(v, key) && state.tempAutoOnRooms[key] !== v) {
        state.tempAutoOnRooms[key] = v; changed = true;
      }
    }
  }
  const zima = Number(b.tempAutoWinter);
  if (validWinterTarget(zima) && state.tempAutoWinter !== zima) {
    state.tempAutoWinter = zima; changed = true;
  }
  const zimaRooms = b.tempAutoWinterRooms;
  if (zimaRooms && typeof zimaRooms === 'object') {
    for (const key of Object.keys(state.tempAutoWinterRooms)) {
      const v = Number(zimaRooms[key]);
      if (validWinterTarget(v) && state.tempAutoWinterRooms[key] !== v) {
        state.tempAutoWinterRooms[key] = v; changed = true;
      }
    }
  }
  if (changed) broadcast('tempAutoOn', thresholdPayload());
  res.json(thresholdPayload());
});

// Ruční refresh z appky („Aktualizovat"): vynutí načtení VŠECH zdrojů.
// Dlouhé pollery (Shelly fronta 1 dotaz/s, Panasonic po zařízeních, Infigy socket)
// běží na pozadí a do appky se propíšou přes SSE, jak dorazí — tlačítko na ně nečeká.
app.post('/api/refresh', async (req, res) => {
  pollShelly();
  if (panasonicEnabled) pollAircon();   // Panasonic klimatizace + tepelné čerpadlo
  if (infigyEnabled) pollInfigy();      // Infigy (bojler 2, výroba, baterie, wallbox)
  blindsCache = { ts: 0, list: [] };    // rolety se přečtou čerstvé při dalším dotazu
  weatherCache.ts = 0;                  // vynuť čerstvé počasí (jinak drží cache)

  const jobs = [pollSolax(), fetchWeather()];
  if (wallboxEnabled) jobs.push(pollWallbox());
  await Promise.allSettled(jobs);
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

// ---------- Hlídače a notifikace ----------
// Každá hláška se pošle jednou a odjistí se, teprve až stav pomine (jako u plné baterie),
// takže telefon nespamuje opakovaně tím samým.

const SERVER_START_TS = Date.now();
const GARAGE_OPEN_ALERT_MS = 10 * 60 * 1000; // garáž otevřená déle → hláška
const OUTAGE_ALERT_MS = 30 * 60 * 1000;      // zdroj dat neodpovídá déle → hláška

const notif = {
  garageOpenSince: 0,
  garageNotified: false,
  carDoneNotified: false,
  boilerHotNotified: false,
  outage: {} // klíč zdroje -> už nahlášeno
};

// Garáž otevřená moc dlouho. Rolety se čtou jen na vyžádání, tak si je doptáme sami.
async function checkGarageOpen() {
  if (!tahomaEnabled || !pushEnabled) return;
  try {
    const blinds = await getBlinds();
    const garage = blinds.find(b => b.uiClass === 'GarageDoor'
      || cz(b.label).includes('garaz') || cz(b.room).includes('garaz'));
    if (!garage || typeof garage.closure !== 'number') return;
    if (garage.closure >= 50) { // zavřeno → odjistit
      notif.garageOpenSince = 0;
      notif.garageNotified = false;
      return;
    }
    if (!notif.garageOpenSince) notif.garageOpenSince = Date.now();
    const openMs = Date.now() - notif.garageOpenSince;
    if (openMs >= GARAGE_OPEN_ALERT_MS && !notif.garageNotified) {
      notif.garageNotified = true;
      const mins = Math.round(openMs / 60000);
      addLog(`Garáž je otevřená ${mins} min`);
      sendPushToAll('🚪 Garáž je otevřená', `Garáž je otevřená už ${mins} min.`);
    }
  } catch {}
}

// Auto dobito — stav wallboxu přešel na „Dokončeno"
function checkCarCharged(status) {
  if (typeof status !== 'number') return;
  if (status === 3 && !notif.carDoneNotified) {
    notif.carDoneNotified = true;
    addLog('Wallbox: nabíjení auta dokončeno');
    sendPushToAll('🔌 Auto je dobité', 'Nabíjení auta je dokončeno.');
  } else if (status === 0 || status === 1) {
    notif.carDoneNotified = false; // odpojeno/připraveno → odjistit
  }
}

// Výpadek zdroje dat — dnes by to skončilo jen v logu, který nikdo nečte
function checkOutages() {
  if (!pushEnabled) return;
  const now = Date.now();
  // Po startu serveru dáme integracím čas naběhnout, ať nehlásíme planý poplach
  if (now - SERVER_START_TS < OUTAGE_ALERT_MS) return;
  const sources = [
    { key: 'solax', label: 'Solax', on: true, ts: state.solax && state.solax.fetchedAt },
    { key: 'infigy', label: 'Infigy', on: infigyEnabled, ts: state.infigy && state.infigy.fetchedAt },
    { key: 'aircon', label: 'Klimatizace', on: panasonicEnabled, ts: state.aircon && state.aircon.fetchedAt }
  ];
  for (const s of sources) {
    if (!s.on) continue;
    const age = s.ts ? now - new Date(s.ts).getTime() : Infinity;
    if (age > OUTAGE_ALERT_MS) {
      if (!notif.outage[s.key]) {
        notif.outage[s.key] = true;
        // Do logu se nepíše — to řeší logOutages(), tohle je jen push po půl hodině
        sendPushToAll('⚠️ Výpadek dat', `${s.label} neodpovídá déle než 30 min — automatika může jet naslepo.`);
      }
    } else if (notif.outage[s.key]) {
      notif.outage[s.key] = false;
    }
  }
}

// ---------- Výpadky dat v logu (červeně, jeden řádek na výpadek) ----------
// Zdroj bereme za vypadlý, když jsou jeho data starší než DVA jeho dotazovací cykly —
// jeden pomalý dotaz tak poplach nedělá. Dokud výpadek trvá, NEPŘIBÝVÁ řádek: posouvá se
// jen `tEnd` toho stávajícího, takže v logu je „11:15–12:10" místo dvanácti řádků.
const OUTAGE_LOG_FACTOR = 2;
const outageLog = {};   // key -> záznam v state.log, který se zrovna prodlužuje

function outageSources() {
  const inf = state.infigy || {};
  return [
    { key: 'solax', label: 'Solax', on: true, every: POLL_INTERVAL_MS, ts: state.solax && state.solax.fetchedAt },
    { key: 'shelly', label: 'Shelly', on: true, every: POLL_INTERVAL_MS, ts: shellyNewestFetchedAt() },
    { key: 'wallbox', label: 'Wallbox', on: wallboxEnabled, every: POLL_INTERVAL_MS, ts: state.wallbox && state.wallbox.fetchedAt },
    { key: 'infigy', label: 'Infigy', on: infigyEnabled, every: 5 * 60 * 1000, ts: inf.fetchedAt },
    { key: 'aircon', label: 'Klimatizace', on: panasonicEnabled, every: 5 * 60 * 1000, ts: state.aircon && state.aircon.fetchedAt },
    { key: 'weather', label: 'Počasí', on: !!OWM_API_KEY, every: 5 * 60 * 1000, ts: state.weather && state.weather.fetchedAt }
  ];
}
// Shelly nemá jedno společné razítko — bereme nejčerstvější ze všech relé
function shellyNewestFetchedAt() {
  let best = 0;
  for (const d of Object.values(state.devices || {})) {
    const t = d && d.fetchedAt ? new Date(d.fetchedAt).getTime() : 0;
    if (t > best) best = t;
  }
  return best || null;
}

function logOutages() {
  const now = Date.now();
  // Po startu dáme integracím čas naběhnout, ať nehlásíme planý poplach
  if (now - SERVER_START_TS < 5 * 60 * 1000) return;
  for (const s of outageSources()) {
    if (!s.on) continue;
    const ts = typeof s.ts === 'number' ? s.ts : (s.ts ? new Date(s.ts).getTime() : 0);
    const stale = !ts || now - ts > s.every * OUTAGE_LOG_FACTOR;
    if (stale) {
      if (outageLog[s.key]) {
        // Výpadek pokračuje — jen posuneme konec rozsahu, nový řádek nepřibývá
        outageLog[s.key].tEnd = now;
        broadcast('logUpdate', { entry: outageLog[s.key] });
      } else {
        outageLog[s.key] = addLog(`${s.label}: nedorazila data`, 'error');
      }
    } else if (outageLog[s.key]) {
      outageLog[s.key] = null;
      addLog(`${s.label}: data znovu naskočila`);
    }
  }
}

// Hlídače pouštíme po 5 min (garáž si musí doptat TaHomu, proto ne častěji)
setTimeout(() => { checkGarageOpen(); checkOutages(); logOutages(); }, 60000);
setInterval(() => { checkGarageOpen(); checkOutages(); logOutages(); }, 5 * 60 * 1000);

// ---------- Automatika přebytků (nahrazuje skripty v Shelly aplikaci) ----------

const OWM_API_KEY = process.env.OWM_API_KEY;
// Na západu slunce visí vypínání bazénu i solinátoru, takže po přenosu appky jinam
// se souřadnice musí dát změnit. Výchozí hodnoty = původní místo.
const WEATHER_LAT = Number(process.env.WEATHER_LAT) || 49.765;
const WEATHER_LON = Number(process.env.WEATHER_LON) || 14.688;
const AUTOMATION_INTERVAL_MS = 5 * 60 * 1000;

// Bazén: spíná při velkém přebytku (přetok do sítě + nabíjení baterie)
const POOL_ON_THRESHOLD_W = 1850;
const POOL_OFF_THRESHOLD_W = -200;
const POOL_MIN_RUN_MS = 30 * 60 * 1000;

// Auto má přednost, ale rezervujeme mu headroom (do 3,4 kW) JEN když se reálně rozjíždí
// (přidává výkon oproti minule). Když jede ustáleně, klesá nebo stojí, rezerva = 0 —
// takže bazén/bojler dostanou přebytek NAD tím, co si auto reálně bere, a neblokujeme je
// zbytečně, když auto víc nechce (např. dobíjí na 1,4 kW a už se nerozjede). Volá se
// 1× za automatický cyklus (jinak by se wbPrevDraw přepsal mezi bazénem a bojlerem).
const CAR_MAX_KW = 3.4;
let wbPrevDraw = 0;
function carReserveW() {
  const st = state.wallbox && typeof state.wallbox.status === 'number' ? state.wallbox.status : null;
  if (st !== 1 && st !== 2) { wbPrevDraw = 0; return 0; } // odpojeno/dokončeno → bez rezervy
  const draw = (state.infigy && typeof state.infigy.wbPower === 'number')
    ? state.infigy.wbPower
    : (state.wallbox && typeof state.wallbox.power === 'number' ? state.wallbox.power / 1000 : 0);
  const ramping = draw > wbPrevDraw + 0.3; // auto ještě přidává výkon (rozjíždí se)
  wbPrevDraw = draw;
  return ramping ? Math.round(Math.max(0, CAR_MAX_KW - draw) * 1000) : 0;
}

const poolAuto = { overCount: 0, underCount: 0, lastOnTime: 0 };
// ---------- Solinátor: denní rozpočet hodin ----------
// Místo spouštění v přesné hodiny (kde se pravidlo při jakékoli překážce ztratilo)
// si appka počítá, kolik hodin má solinátor za den celkem odběhnout, a podle toho
// ho sama zapíná i vypíná. Boost i přenos do dalšího dne jsou pak jen číslo navíc.
const SOLINATOR_START_HOUR = 11;              // dřív nezapínáme
const HARD_OFF_HOUR = 20;                     // záložní mez, když není počasí (jinak západ − 1 h)
const SOLINATOR_BASE_MS = 1 * 3600000;        // základ každý den
const SOLINATOR_BONUS_WARM_MS = 1 * 3600000;  // + nad 20 °C
const SOLINATOR_BONUS_HOT_MS = 2 * 3600000;   // + nad 25 °C (celkem, ne navíc k teplému)
const SOLINATOR_MAX_MS = 8 * 3600000;         // strop ručního boostu (tlačítka po hodině)
// Strop přenosu na další den, na obě strany (dluh i namačkané ubrání). Musí být tak
// nízko, aby se denní cíl (1 + 2 + dluh = 6 h) vešel do okna 11:00 → západ − 1 h
// (v létě ~7,5 h). Jinak zůstane nesplněný zbytek i po dokonalém dni, přenese se,
// a dluh se donekonečna obnovuje sám.
const SOLINATOR_CARRY_MAX_MS = 3 * 3600000;
// Strop zákazu: −1 den se dá namačkat, ale dál než tři dny dopředu ne
const SOLINATOR_DISABLE_MAX_MS = 3 * 24 * 3600000;

// Kolik z boostMs je přenos ze včerejška (zbytek je namačkaný ručně). Ořez drží obě
// čísla v jednom směru, aby rozpis v appce vždycky sedl i po opačném stisku.
function solinatorCarryPart(boostMs, carryMs) {
  return boostMs >= 0
    ? Math.min(Math.max(carryMs, 0), boostMs)
    : Math.max(Math.min(carryMs, 0), boostMs);
}

// Čas (a datum, když nejde o dnešek) v pražském čase — do logu a hlášek
function fmtPragueTime(ts) {
  return new Date(ts).toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

// Kolik má solinátor dnes celkem odběhnout. boostMs může být i záporný (tlačítko −1 h
// ubírá i ze základu a přirážky), pod nulu ale cíl nikdy nejde.
function solinatorRawTargetMs() {
  return SOLINATOR_BASE_MS + state.solinator.bonusMs + state.solinator.boostMs;
}
function solinatorTargetMs() {
  return Math.max(0, solinatorRawTargetMs());
}

// O kolik se tlačítky ubralo víc, než dnešek unesl (záporné číslo, jinak 0). Tohle jediné
// se přenáší na další den — dokud má dnešek z čeho ubírat, minus zůstane na něm.
function solinatorOverdraftMs() {
  return Math.min(0, solinatorRawTargetMs());
}

// Kolik dnes už odběhl (měří updateRuntimes, nuluje se o pražské půlnoci)
function solinatorRanMs() {
  return (state.runtime && state.runtime.ms && state.runtime.ms.solinator) || 0;
}

// Přelom dne: nedoběhnutý zbytek se přenese do boostu dalšího dne, teplotní bonus se nuluje.
// Přenáší se i namačkané ubrání (záporný boost) — kdo večer zmáčkne −2 h, chce míň
// chlorovat i zítra. Přenese se ale jen ručně namačkaná část, ne to, co samo přišlo
// ze včerejška; jinak by jedno −1 h tiše ubíralo napořád.
// Při aktivním zákazu se nepřenáší nic — „nechloruj" nemá vyrábět dluh.
// Samotné pravidlo přenosu. Používá ho přelom dne i odhad na zítřek — jen s jiným
// „nedoběhnutým zbytkem" (skutečným vs. očekávaným), ať se ta dvě místa nerozejdou.
// Dopředu jde buď nedoběhnutý zbytek, nebo to, co se dnes už nedalo ubrat. Obojí
// najednou nastat nemůže: když se přeubralo, je dnešní cíl nula a není co nedoběhnout.
function solinatorCarryFor(unmet, disabled) {
  if (disabled) return 0;
  const over = solinatorOverdraftMs();
  return over < 0
    ? Math.max(-SOLINATOR_CARRY_MAX_MS, over)
    : Math.min(SOLINATOR_CARRY_MAX_MS, Math.max(0, unmet));
}

function solinatorRollDay(today) {
  if (state.solinator.date === today) return;
  if (state.solinator.date) {
    const unmet = Math.max(0, solinatorTargetMs() - solinatorRanMs());
    const carry = solinatorCarryFor(unmet, Date.now() < state.solinator.disabledUntil);
    state.solinator.boostMs = carry;
    state.solinator.carryMs = carry;   // kolik z boostMs je přenos (jen pro rozpis)
    // Psát skutečně přenesenou hodnotu, ne tu před ořezem
    if (carry > 0) {
      addLog(`Solinátor: ${fmtDur(carry)} se přenáší na dnešek`
        + (unmet > carry ? ` (${fmtDur(unmet - carry)} propadá)` : ''));
    } else if (carry < 0) {
      addLog(`Solinátor: dnešek zkrácen o ${fmtDur(-carry)} (namačkáno včera)`);
    }
  }
  state.solinator.date = today;
  state.solinator.bonusMs = 0;
  state.solinator.bonusTempC = null;
  state.solinator.bonusSrc = null;
  state.solinator.bonusFloored = false;
}

// Zimní přelom dne: den se jen přepíše, nic se nepřenáší a nikde se o tom nepíše.
// Po návratu ze zimy tak solinátor začíná s čistým štítem.
function solinatorFreezeDay(today) {
  const s = state.solinator;
  if (s.date === today && !s.bonusMs && !s.boostMs && !s.carryMs) return;
  s.date = today;
  s.bonusMs = 0;
  s.bonusTempC = null;
  s.bonusSrc = null;
  s.bonusFloored = false;
  s.boostMs = 0;
  s.carryMs = 0;
  broadcastSolinator();
}

// Odhad, kolik solinátor pojede zítra — ať je po stisku boostu hned vidět, co to
// s dalším dnem udělá. Přenos se počítá stejným pravidlem jako o půlnoci, jen
// s odhadem, kolik se do konce dnešního okna ještě stihne odběhnout.
// (Přechody letního času posunou hranice o hodinu; na odhad to nevadí.)
function solinatorPlan() {
  const now = Date.now();
  const prague = pragueTime();
  const minutesIn = prague.hour * 3600000 + prague.minute * 60000;
  const hoursMs = h => h * 3600000;

  // Konec dnešního okna: hodina před západem, bez počasí záložní HARD_OFF_HOUR
  const sunset = state.weather && typeof state.weather.sunsetMs === 'number' ? state.weather.sunsetMs : null;
  const cutoff = sunset !== null ? sunset - hoursMs(1) : now - minutesIn + hoursMs(HARD_OFF_HOUR);
  const start = Math.max(now, now - minutesIn + hoursMs(SOLINATOR_START_HOUR));
  const windowLeft = Math.max(0, cutoff - start);

  const target = solinatorTargetMs();
  const ran = solinatorRanMs();
  const expectedRan = ran + Math.min(Math.max(0, target - ran), windowLeft);
  const carryMs = solinatorCarryFor(target - expectedRan, now < state.solinator.disabledUntil);

  const maxTempC = forecastTomorrowTemp();
  const bonusMs = maxTempC === null ? null
    : (maxTempC > 25 ? SOLINATOR_BONUS_HOT_MS : (maxTempC > 20 ? SOLINATOR_BONUS_WARM_MS : 0));

  // Zákaz platný ještě zítra v poledne = zítra se neběží vůbec
  const disabled = state.solinator.disabledUntil > now - minutesIn + hoursMs(24 + SOLINATOR_START_HOUR);
  const targetMs = disabled ? 0 : Math.max(0, SOLINATOR_BASE_MS + (bonusMs || 0) + carryMs);

  return { date: pragueDateString(now + hoursMs(24)), targetMs, bonusMs, carryMs, maxTempC, disabled };
}

// ---------- Korekce prahů podle předpovědi výroby (Infigy SP_FORECAST_PV) ----------
// Neptáme se „kolik se dnes ještě vyrobí" (to večer klesá k nule i po skvělém dni),
// ale „kolik zbyde, až se nabije baterie" — to se samo přizpůsobuje denní době:
//   volny = (odhad výroby − už vyrobeno) − (kolik chybí do plné baterie)
// Silný den → pustíme bazén/bojler dřív. Slabý den → přednost má nabití baterie.
const BATTERY_KWH = Number(process.env.BATTERY_KWH) || 11.6;
const FC_STRONG_KWH = 15;   // volný přebytek nad tímto = silný den
const FC_WEAK_KWH = 5;      // volný přebytek pod tímto = slabý den
const FC_SOC_NO_TIGHTEN = 85; // nad tímto SOC už neutahujeme (baterie je skoro plná)

// Vrátí { band, volny } — band: 'strong' | 'weak' | null (normální/bez dat)
function forecastBand(soc) {
  const forecast = state.infigy && typeof state.infigy.forecastPv === 'number' ? state.infigy.forecastPv : null;
  const produced = state.solax && typeof state.solax.yieldToday === 'number' ? state.solax.yieldToday : null;
  if (forecast === null || produced === null || typeof soc !== 'number') return { band: null, volny: null };
  const zbyva = forecast - produced;                       // kolik se dnes ještě vyrobí (kWh)
  const potreba = ((100 - soc) / 100) * BATTERY_KWH;       // kolik chybí do plné baterie (kWh)
  const volny = Math.round((zbyva - potreba) * 10) / 10;   // co zbyde na bojler a bazén
  if (volny >= FC_STRONG_KWH) return { band: 'strong', volny };
  // Utahujeme jen když má baterie ještě co dohánět — u skoro plné není co chránit
  if (volny <= FC_WEAK_KWH && soc < FC_SOC_NO_TIGHTEN) return { band: 'weak', volny };
  return { band: null, volny };
}

function forecastLabel(band) {
  return band === 'strong' ? 'silný den' : (band === 'weak' ? 'slabý den' : null);
}

let weatherCache = { ts: 0, data: null };

async function fetchWeather() {
  if (!OWM_API_KEY) return null;
  // Cache 5 min — ať i venkovní teplota (a časy slunce) jsou nejvýš 5 min staré
  if (weatherCache.data && Date.now() - weatherCache.ts < 5 * 60 * 1000) {
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

// Předpověď — podle ní se nastaví dnešní čas solinátoru a odhadne zítřejší. Zajímá nás
// nejvyšší teplota v okně, kdy solinátor vůbec jezdí (11:00 → 20:00), protože přirážka
// za teplo patří k němu. Dotaz nejvýš jednou za hodinu, výpadek nevadí — pak se jede
// podle aktuální teploty jako dřív.
//
// POZOR na past: OpenWeather posílá sloty po 3 h a JEN DOPŘEDU, uplynulé z odpovědi
// zmizí. Kdybychom denní maximum skládali pokaždé znovu jen z toho, co v odpovědi je,
// scvrkávalo by se během dne samo — ráno 26 °C (slot ve 14:00), večer už jen 16 °C
// (zbylý slot ve 20:00). Proto se drží JEDNOTLIVÉ SLOTY: co v odpovědi je, se přepíše
// (budoucnost se smí revidovat), co z ní vypadlo, si podrží poslední známou hodnotu.
let forecastCache = { ts: 0, slots: {} };   // 'YYYY-MM-DD' -> { '14': 26.1, '17': 24 }
const FORECAST_TTL_MS = 60 * 60 * 1000;

function forecastMaxFor(dateStr) {
  const den = forecastCache.slots[dateStr];
  if (!den) return null;
  const hodnoty = Object.values(den).filter(v => typeof v === 'number');
  return hodnoty.length ? Math.max(...hodnoty) : null;
}
function forecastTodayTemp() { return forecastMaxFor(pragueDateString()); }
function forecastTomorrowTemp() { return forecastMaxFor(pragueDateString(Date.now() + 24 * 3600000)); }

async function refreshForecast() {
  if (!OWM_API_KEY) return;
  const tomorrow = pragueDateString(Date.now() + 24 * 3600000);
  // Po půlnoci se sice „dnešek" posune, ale ten už v předpovědi stejně je — hlídáme
  // jen to, aby v cache byl zítřek a aby nebyla starší než hodinu
  if (forecastCache.slots[tomorrow] !== undefined && Date.now() - forecastCache.ts < FORECAST_TTL_MS) return;
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${WEATHER_LAT}&lon=${WEATHER_LON}&appid=${OWM_API_KEY}&units=metric`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.list)) return;
    // Staré dny zahodit, ať mapa neroste; zbytek si necháme i pro sloty mimo odpověď
    const dnes = pragueDateString();
    const slots = {};
    for (const d of Object.keys(forecastCache.slots)) {
      if (d >= dnes) slots[d] = { ...forecastCache.slots[d] };
    }
    for (const slot of data.list) {
      const t = slot && slot.main && slot.main.temp;
      if (typeof t !== 'number' || typeof slot.dt !== 'number') continue;
      const ms = slot.dt * 1000;
      const hour = pragueTime(ms).hour;
      if (hour < SOLINATOR_START_HOUR || hour > HARD_OFF_HOUR) continue;
      const d = pragueDateString(ms);
      if (d < dnes) continue;              // minulé dny nezajímají (OWM je sice neposílá)
      if (!slots[d]) slots[d] = {};
      slots[d][String(hour)] = t;
    }
    forecastCache = { ts: Date.now(), slots };
  } catch {
    // necháme starou hodnotu; když žádná není, jede se podle aktuální teploty
  }
}

// Server na Renderu běží v UTC — všechny časové podmínky počítáme v Europe/Prague.
// Bez argumentu platí pro teď, s časem v ms pro ten okamžik (předpověď po slotech).
function pragueTime(at) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(at === undefined ? new Date() : new Date(at));
  const get = type => Number(parts.find(p => p.type === type).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}

function pragueDateString(at) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' })
    .format(at === undefined ? new Date() : new Date(at));
}

// Čas časovače HH:MM — kontroluje i rozsah. Samotný formát nestačí: „25:99" by prošlo,
// ale takový časovač by se nikdy netrefil do reálného času a tiše by nikdy nespustil.
function validTimerTime(t) {
  if (typeof t !== 'string' || !/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function formatKwLog(w) {
  return (w / 1000).toFixed(1).replace('.', ',') + ' kW';
}

// Automatika posílá „on" jen když vidí vypnuto a „off" jen když vidí zapnuto, takže dva
// stejné povely po sobě vždycky znamenají, že relé neposlechlo. Log se tím dřív zaplavil
// desítkami stejných řádků — teď se zapíše první povel a pak už jen jedno upozornění,
// že zařízení nereaguje. Posílat povel se nepřestane.
const autoRepeat = new Map();   // key -> { turn, n, warned }
const AUTO_REPEAT_WARN = 6;     // ~30 min při pětiminutovém cyklu

function logAutoSet(key, turn, reason) {
  const label = DEVICE_LABELS[key];
  const word = turn === 'on' ? 'zapnuto' : 'vypnuto';
  const prev = autoRepeat.get(key);
  if (!prev || prev.turn !== turn) {
    autoRepeat.set(key, { turn, n: 1, warned: false });
    addLog(`${label}: ${word} (${reason})`);
    return;
  }
  prev.n++;
  if (prev.n >= AUTO_REPEAT_WARN && !prev.warned) {
    prev.warned = true;
    addLog(`${label}: nereaguje na povel „${word}" (${prev.n}× za sebou)`);
  }
}

// Ruční zásah má na půl hodiny přednost před automatikou. Bez toho by appka zapnutí
// tlačítkem do pěti minut zase shodila (solinátor kvůli rozpočtu, bojler kvůli přebytku)
// a nedalo by se nic pustit „natruc". Po vypršení automatika převezme řízení a když
// podmínky nesedí, vypne to — proto je to jen odklad, ne trvalé vyřazení.
const MANUAL_HOLD_MS = 30 * 60 * 1000;
// Zařízení, do kterých automatika mluví — jen u nich má odklad co odkládat
const AUTOMATED_KEYS = ['shelly', 'pool', 'solinator'];

function setManualHold(key) {
  if (!state.manualHold) state.manualHold = {};
  state.manualHold[key] = Date.now() + MANUAL_HOLD_MS;
  broadcast('manualHold', { manualHold: state.manualHold });
}
function clearManualHold(key) {
  if (!state.manualHold || !state.manualHold[key]) return;
  delete state.manualHold[key];
  broadcast('manualHold', { manualHold: state.manualHold });
}
function manualHeld(key) {
  return Date.now() < ((state.manualHold || {})[key] || 0);
}

// force = tvrdá pojistka (přehřátá nádrž), kterou ruční zásah přebít nesmí
async function autoSet(key, turn, reason, { force = false } = {}) {
  const dev = DEVICES[key];
  if (!force && manualHeld(key)) return false;   // ruční zásah drží, automatika počká
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await setShellyState(dev.serverUri, dev.deviceId, turn);
      state.devices[key] = { ...(state.devices[key] || {}), online: true, isOn: turn === 'on', fetchedAt: new Date().toISOString() };
      broadcast('device', { key, status: state.devices[key] });
      logAutoSet(key, turn, reason);
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

// Bazén (podle samostatného Shelly skriptu): zapíná z přetoku (2× nad 1850 W),
// vypíná 3× pod −200 W po min. 30 min běhu, s ochranou baterie podle hodiny a SOC.
async function runPoolAutomation(now, prague, weather, totalW, soc, reserveW) {
  if (isWinter()) return;                 // v zimě bazén spí (vypíná ho enforceWinterOff)
  if (poolForceActive()) return;          // +24 h jede bez ohledu na přebytek, okno i SOC
  const pool = state.devices.pool;
  if (!pool || pool.isOn === null || pool.isOn === undefined) return; // stav neznámý → beze změny
  const isOn = pool.isOn;

  // Hodinu před západem slunce se vypíná natvrdo
  if (afterSunsetCutoff(now, prague, weather)) {
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

  // Korekce podle předpovědi: silný den → pustíme dřív, slabý → přednost baterii
  const fc = forecastBand(soc);
  if (fc.band === 'strong') minSoc -= 15;
  else if (fc.band === 'weak') minSoc += 10;
  minSoc = Math.max(0, Math.min(95, minSoc));

  if (typeof soc === 'number' && soc < minSoc) {
    if (isOn) await autoSet('pool', 'off', `nízké nabití baterie (${Math.round(soc)} %)`);
    poolAuto.overCount = 0;
    poolAuto.underCount = 0;
    return;
  }

  // Zapnutí: 2× po sobě nad prahem (+ rezerva na auto — bazén jen z přebytku nad autem)
  if (totalW > POOL_ON_THRESHOLD_W + reserveW) {
    poolAuto.overCount++;
    if (poolAuto.overCount >= 2 && !isOn) {
      const why = forecastLabel(fc.band);
      await autoSet('pool', 'on', `přetok ${formatKwLog(totalW)}`
        + (why ? ` · ${why} (volný přebytek ${fc.volny} kWh, SOC práh ${minSoc} %)` : ''));
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
    // Počítadla nulujeme jen když povel opravdu odešel. Když ho zdrží ruční zásah,
    // zůstanou naplněná a bazén se vypne hned prvním cyklem po vypršení odkladu.
    if (await autoSet('pool', 'off', `odběr ze sítě ${formatKwLog(totalW)}`)) {
      poolAuto.overCount = 0;
      poolAuto.underCount = 0;
    }
  }
}

// Bojler (podle samostatného Shelly skriptu): topí jen ve dne, jen když běží bazén,
// z dostatečného přetoku podle nabití baterie. Nad 70 °C v nádrži vždy vypne.
async function runBoilerAutomation(now, prague, weather, totalW, soc, reserveW) {
  const boiler = state.devices.shelly;
  if (!boiler || boiler.isOn === null || boiler.isOn === undefined) return;
  const isOn = boiler.isOn;

  // Ochrana: nad 70 °C v nádrži (Aquarea) vždy vypnout — má přednost
  const aq = (state.aircon && state.aircon.aquarea || [])[0];
  const tankTemp = aq && typeof aq.tankTemp === 'number' ? aq.tankTemp : null;
  if (tankTemp !== null && tankTemp >= 70) {
    // Jediná mez, kterou ruční zapnutí nepřebije — přehřátou nádrž nikdo „natruc" netopí
    if (isOn) await autoSet('shelly', 'off', `nádrž ${Math.round(tankTemp)} °C (nad 70)`, { force: true });
    if (!notif.boilerHotNotified) { // hláška jednou, odjistí se pod 65 °C
      notif.boilerHotNotified = true;
      sendPushToAll('🔥 Bojler 1 je vyhřátý', `Nádrž má ${Math.round(tankTemp)} °C — topení vypnuto.`);
    }
    return;
  }
  if (tankTemp !== null && tankTemp < 65) notif.boilerHotNotified = false;

  // Hodinu před západem slunce nebo ráno před 10:00 → vypnout natvrdo
  const sunsetMs = weather.sys.sunset * 1000;
  if (now >= sunsetMs - 3600000 || prague.hour < 10) {
    if (isOn) await autoSet('shelly', 'off', prague.hour < 10 ? 'ráno' : 'západ slunce');
    return;
  }

  // Bojler smí topit jen když běží bazén — bazén je levný ukazatel, že je opravdový
  // přebytek. V zimě ale bazén nejede vůbec, takže by se bojler nikdy nezapnul; tam se
  // rozhoduje jen podle přebytku (prahy níž zůstávají stejné).
  if (!isWinter()) {
    const pool = state.devices.pool;
    if (!pool || pool.isOn === null || pool.isOn === undefined) return; // stav neznámý → beze změny
    if (!pool.isOn) {
      if (isOn) await autoSet('shelly', 'off', 'bazén neběží');
      return;
    }
  }

  // Rychlá ochrana: odběr ze sítě pod −300 W → vypnout
  if (totalW < -300) {
    if (isOn) await autoSet('shelly', 'off', `odběr ze sítě ${formatKwLog(totalW)}`);
    return;
  }

  // Dynamický práh přetoku podle nabití baterie
  let threshold = 1400;
  if (typeof soc === 'number' && soc < 50) threshold = 2600;
  else if (typeof soc === 'number' && soc < 80) threshold = 2000;
  // Korekce podle předpovědi: silný den → pustíme dřív, slabý → přednost baterii
  const fc = forecastBand(soc);
  if (fc.band === 'strong') threshold -= 400;
  else if (fc.band === 'weak') threshold += 400;
  threshold = Math.max(500, threshold);
  // Rezerva na auto se přičítá AŽ NAKONEC — auto si tak drží přednost i v silný den
  threshold += reserveW;

  // Zapnutí (jinak drží stav)
  if (totalW > threshold && !isOn) {
    const why = forecastLabel(fc.band);
    await autoSet('shelly', 'on', `přetok ${formatKwLog(totalW)}`
      + (why ? ` · ${why} (volný přebytek ${fc.volny} kWh, práh ${formatKwLog(threshold)})` : ''));
  }
}

// Konec dne pro spotřebiče, které mají jet jen za světla: hodina před západem.
// Bez počasí (výpadek OWM) padáme na pevnou hodinu — ať nikdy nezůstane bez meze.
function afterSunsetCutoff(now, prague, weather) {
  if (weather && weather.sys && typeof weather.sys.sunset === 'number') {
    return now >= weather.sys.sunset * 1000 - 3600000;
  }
  return prague.hour >= HARD_OFF_HOUR;
}

function outsideSolinatorWindow(now, prague, weather) {
  return prague.hour < SOLINATOR_START_HOUR || afterSunsetCutoff(now, prague, weather);
}

// Pojistka pro bazén: po západu musí být vypnutý i tehdy, když střídač nehlásí data
// a hlavní automatika se kvůli tomu vůbec neprovede (v noci spí → bazén by jel do rána).
// Normální rozhodování bazénu zůstává v runPoolAutomation.
async function enforcePoolOffWindow(now, prague, weather) {
  if (isWinter()) return;                 // v zimě to řeší enforceWinterOff
  if (poolForceActive()) return;          // západ slunce +24 h nepřebije
  const pool = state.devices.pool;
  if (!pool || pool.isOn !== true) return;
  if (!afterSunsetCutoff(now, prague, weather)) return;
  await autoSet('pool', 'off', 'západ slunce');
  poolAuto.overCount = 0;
  poolAuto.underCount = 0;
}

// Zima: bazén i solinátor spí. Vypíná se běžným autoSet (bez `force`), takže půlhodinový
// odklad po ručním zásahu platí i tady — filtraci si na chvíli pustíš, když zazimováváš.
async function enforceWinterOff() {
  if (!isWinter()) return;
  for (const key of ['pool', 'solinator']) {
    // Bazén puštěný natvrdo tlačítkem +24 h běží i v zimě; solinátor spí dál
    if (key === 'pool' && poolForceActive()) continue;
    const dev = state.devices[key];
    if (dev && dev.isOn === true) await autoSet(key, 'off', 'zimní režim');
  }
  poolAuto.overCount = 0;
  poolAuto.underCount = 0;
}

// ---------- Bazén natvrdo (tlačítko +24 h) ----------
const POOL_FORCE_STEP_MS = 24 * 3600000;
const POOL_FORCE_MAX_MS = 72 * 3600000;

function poolForceActive() { return Date.now() < ((state.poolForce && state.poolForce.until) || 0); }
function poolForceLeftMs() { return Math.max(0, ((state.poolForce && state.poolForce.until) || 0) - Date.now()); }
function poolForcePayload() { return { poolForce: { until: poolForceActive() ? state.poolForce.until : 0 } }; }
function clearPoolForce() {
  if (!state.poolForce.until) return;
  state.poolForce.until = 0;
  broadcast('poolForce', poolForcePayload());
}

// Drží bazén zapnutý. Patří do časové části runAutomation — v noci střídač spí a bez
// jeho dat by se sem řízení vůbec nedostalo. `force` proto, že +24 h je novější
// rozhodnutí než případný půlhodinový odklad po dřívějším ručním vypnutí.
async function enforcePoolForce() {
  if (!poolForceActive()) return;
  const pool = state.devices.pool;
  if (pool && pool.isOn !== true) await autoSet('pool', 'on', 'ruční +24 h', { force: true });
}

// Přirážka za teplo se bere z NEJVYŠŠÍ dnešní teploty podle předpovědi, takže dnešní čas
// je hotový hned ráno a nečeká se, až se venku doopravdy oteplí. Aktuální teplota slouží
// jako pojistka, kdyby bylo tepleji, než se čekalo.
// Dokud se dnes nic neodběhlo, smí přirážka i klesnout (dopolední předpověď se upřesňuje).
// Jakmile solinátor začne běžet, už jen roste — jinak by cíl spadl pod odběhnutý čas
// a solinátor by se vypnul předčasně.
function applyTempBonus(weather) {
  const nowTemp = weather && weather.main && typeof weather.main.temp === 'number' ? weather.main.temp : null;
  const fcTemp = forecastTodayTemp();
  if (nowTemp === null && fcTemp === null) return;
  const temp = Math.max(nowTemp === null ? -Infinity : nowTemp, fcTemp === null ? -Infinity : fcTemp);
  const bonus = temp > 25 ? SOLINATOR_BONUS_HOT_MS : (temp > 20 ? SOLINATOR_BONUS_WARM_MS : 0);
  // Přirážka smí klesnout, když se předpověď zpřesní dolů — ale ne tak, aby cíl spadl
  // pod už odběhnutý čas; to by solinátor uprostřed běhu vypnulo. Cíl je
  // max(0, základ + přirážka + boost), takže při ran > 0 je dno ran − základ − boost.
  let next = bonus;
  if (next < state.solinator.bonusMs) {
    const ran = solinatorRanMs();
    // Math.min proti současné přirážce: kdyby odběhnutý čas cíl přerostl, vyšlo by dno
    // nad ni a přirážku by to omylem ZVEDLO. Při ran = 0 neomezuje nic — jinak by velké
    // záporné ubrání (cíl je stejně 0) vyrobilo nesmyslné dno.
    const dno = ran > 0 ? ran - SOLINATOR_BASE_MS - state.solinator.boostMs : -Infinity;
    next = Math.max(next, Math.min(state.solinator.bonusMs, dno));
  }
  if (next === state.solinator.bonusMs) return;
  // Když je ubráno pod nulu, přirážka napřed umaže to „přeubráno" a cíl se zvedne
  // až z toho, co zbyde — o dorovnávání se starat nemusíme
  state.solinator.bonusMs = next;
  // Podrželo dno přirážku nad tím, co by teplota dala? Pak by popisek v rozpisu ukazoval
  // nižší teplotu, než k přirážce sedí — appka to musí umět dovysvětlit.
  state.solinator.bonusFloored = next > bonus;
  // Uložíme i DŮVOD. Rozhodnout může předpověď i naměřená teplota, a appka bez toho
  // psala k přirážce živě dopočítanou předpověď — vedle poctivých +2 h pak svítilo
  // scvrklých 16 °C, protože z odpovědi OWM mezitím vypadly polední sloty.
  const zPredpovedi = fcTemp !== null && fcTemp >= (nowTemp === null ? -Infinity : nowTemp);
  state.solinator.bonusTempC = zPredpovedi ? fcTemp : nowTemp;
  state.solinator.bonusSrc = zPredpovedi ? 'fc' : 'now';
  const zdroj = zPredpovedi
    ? `dnes až ${Math.round(fcTemp)} °C (předpověď)`
    : `venku ${Math.round(nowTemp)} °C`;
  addLog(`Solinátor: ${zdroj} → dnešní cíl ${fmtDur(solinatorTargetMs())}`);
}

async function runSolinatorAutomation(now, prague, weather) {
  const sol = state.devices.solinator;
  const isOn = sol && sol.isOn;              // null = stav neznámý (Shelly nedostupné)
  const today = pragueDateString();

  // Zima: rozpočet se vůbec nepočítá. Kdyby se počítal, přenášel by se každý den
  // nesplněný cíl (strop 3 h) — log by se přes zimu zaplnil hláškami o přenosu a na jaře
  // by první den začal se třemi hodinami dluhu. Vypnutí řeší enforceWinterOff.
  if (isWinter()) {
    solinatorFreezeDay(today);
    return;
  }

  // Přelom dne: nedoběhnutý zbytek se přenese do dnešního boostu
  solinatorRollDay(today);
  // Předpověď (dotaz nejvýš jednou za hodinu). Je tu nahoře schválně: dnešní cíl i
  // odhad na zítřek se mají znát od rána, ne až od poledne.
  await refreshForecast();
  applyTempBonus(weather);
  broadcastSolinator();

  // −1d/−2d: úplně zakázáno (ať klesne chlor) — rozpočet se ten den vůbec neřeší
  if (now < state.solinator.disabledUntil) {
    if (isOn === true) await autoSet('solinator', 'off', 'solinátor dočasně vypnut (vysoký chlor)');
    return;
  }

  // Povolené okno: od 11:00 do hodiny před západem. Mimo něj solinátor NIKDY nejede —
  // vypínáme natvrdo, ne jen "return". Jinak by cokoliv, co jede o půlnoci, jelo dál
  // až do poledne: večerní mez se totiž po půlnoci zase rozpojí (západ už je zítřejší)
  // a odběhnutý čas se o půlnoci nuluje, takže ani rozpočet by to nezastavil.
  if (outsideSolinatorWindow(now, prague, weather)) {
    if (isOn === true) await autoSet('solinator', 'off', 'mimo denní okno');
    return;
  }

  const target = solinatorTargetMs();
  const ran = solinatorRanMs();

  // Rozpočet naplněn → vypnout (řídíme i vypnutí, časovač v relé je jen pojistka)
  if (ran >= target) {
    if (isOn === true) await autoSet('solinator', 'off', `hotovo ${fmtDur(ran)} z ${fmtDur(target)}`);
    return;
  }

  // Zbývá odběhnout
  if (isOn === false) {
    await autoSet('solinator', 'on', `zbývá ${fmtDur(target - ran)} z ${fmtDur(target)}`);
  }
}

// Solinátor: podle měření chloru — boost (+2h/+4h) při nízkém, vypnutí (−1d/−2d) při vysokém
// Plán na zítřek se posílá spolu se stavem, ať se řádek přepíše hned po stisku tlačítka
function broadcastSolinator() {
  broadcast('solinator', { solinator: state.solinator, solinatorPlan: solinatorPlan() });
}

// Sdílená logika (používají ji endpointy i asistent). Stav se nastaví hned (synchronně),
// povel do relé odletí na pozadí — ať endpoint odpovídá už aktuálním stavem.
// Večerní vypnutí (hodinu před západem) z posledních dat o počasí; null = neznáme
// Boost jen zvýší dnešní cíl — kdy se odběhne, si už řídí rozpočtová smyčka.
// Co se do dnešního večera nevejde, se při přelomu dne přenese na další den.
// Kladné hodiny přidávají, záporné ubírají — i ze základu a přirážky. Cíl pod nulu
// nejde, ale ubírat se dá i dál: co dnešek nespolkne, se přenese na zítřek.
// Mačkat jde opakovaně, hodiny se sčítají. Do logu se boost nepíše — mačká se po
// hodině a zaplavilo by to všechno ostatní.
function solinatorBoost(hours) {
  solinatorRollDay(pragueDateString());
  const before = state.solinator.boostMs;
  state.solinator.boostMs = Math.max(-SOLINATOR_MAX_MS,
    Math.min(SOLINATOR_MAX_MS, before + hours * 3600000));
  const delta = state.solinator.boostMs - before;
  if (delta === 0) return state.solinator;   // už na dorazu
  state.solinator.carryMs = solinatorCarryPart(state.solinator.boostMs, state.solinator.carryMs);
  // Ubrat hodinu nesmí zrušit „vypnuto na den", přidat ano
  if (delta > 0) state.solinator.disabledUntil = 0;
  broadcastSolinator();
  return state.solinator;
}

// Dny se sčítají (−1 den jde namačkat), dál než tři dny dopředu ale ne
function solinatorDisable(days) {
  solinatorRollDay(pragueDateString());
  const now = Date.now();
  const from = Math.max(now, state.solinator.disabledUntil || 0);
  state.solinator.disabledUntil = Math.min(
    now + SOLINATOR_DISABLE_MAX_MS,
    from + days * 24 * 3600000
  );
  // Zákaz ruší i boost — jinak by si appka protiřečila („vypni na dva dny"
  // a zároveň „ještě dlužíme hodiny navíc")
  state.solinator.boostMs = 0;
  state.solinator.carryMs = 0;
  // Po namačkání víc dnů je „na 1 den" matoucí — píšeme, dokdy to nakonec platí
  addLog(`Solinátor: vypnut do ${fmtPragueTime(state.solinator.disabledUntil)} (vysoký chlor)`);
  broadcastSolinator();
  const sol = state.devices.solinator;
  // „−1 den" je novější rozhodnutí než dřívější ruční zapnutí, tak ho odklad nedrží
  clearManualHold('solinator');
  if (sol && sol.isOn) autoSet('solinator', 'off', 'vypnut (vysoký chlor)').catch(() => {});
  return state.solinator;
}

function solinatorClear() {
  solinatorRollDay(pragueDateString());
  state.solinator.boostMs = 0;
  state.solinator.carryMs = 0;
  state.solinator.disabledUntil = 0;
  addLog('Solinátor: boost i vypnutí zrušeno');
  broadcastSolinator();
  return state.solinator;
}

app.post('/api/solinator/boost', (req, res) => {
  if (!requireAuth(req, res)) return;
  const hours = Number(req.body && req.body.hours);
  // Celé hodiny, kladné i záporné, nanejvýš osm — appka posílá ±1
  if (!Number.isInteger(hours) || hours === 0 || Math.abs(hours) > 8) {
    return res.status(400).json({ error: 'hours musí být celé číslo −8 až 8 (bez nuly).' });
  }
  res.json({ solinator: solinatorBoost(hours), solinatorPlan: solinatorPlan() });
});

// Bazén natvrdo: +24 h se sčítá do stropu 72 h. Strop se počítá od TEĎ, ne od
// posledního stisku — jinak by se dalo mačkáním doplazit dál, než na kolik je limit.
app.post('/api/pool/force', (req, res) => {
  if (!requireAuth(req, res)) return;
  const hours = Number(req.body && req.body.hours);
  if (!Number.isInteger(hours) || hours <= 0 || hours > 72) {
    return res.status(400).json({ error: 'hours musí být celé číslo 1 až 72.' });
  }
  const now = Date.now();
  const from = Math.max(now, state.poolForce.until || 0);
  state.poolForce.until = Math.min(from + hours * 3600000, now + POOL_FORCE_MAX_MS);
  clearManualHold('pool');   // +24 h je novější rozhodnutí než dřívější ruční vypnutí
  addLog(`Bazén: +${hours} h natvrdo (do ${fmtPragueTime(state.poolForce.until)})`);
  broadcast('poolForce', poolForcePayload());
  res.json(poolForcePayload());
  runAutomation().catch(() => {});   // ať se rozsvítí hned, ne až za pět minut
});

app.post('/api/pool/force/clear', (req, res) => {
  if (!requireAuth(req, res)) return;
  if (poolForceActive()) {
    clearPoolForce();
    addLog('Bazén: +24 h zrušeno, jede zase automatika');
  } else {
    clearPoolForce();
  }
  res.json(poolForcePayload());
  runAutomation().catch(() => {});   // automatika ho podle podmínek klidně hned vypne
});

// Až 72 h je na paměťový stav Renderu věčnost — telefon drží zálohu a po deployi ji vrátí
app.post('/api/pool/force/restore', (req, res) => {
  const until = Number(req.body && req.body.until);
  if (Number.isFinite(until) && until > Date.now() && until > (state.poolForce.until || 0)
      && until <= Date.now() + POOL_FORCE_MAX_MS) {
    state.poolForce.until = until;
    addLog(`Bazén: +24 h obnoveno z telefonu (do ${fmtPragueTime(until)})`);
    broadcast('poolForce', poolForcePayload());
    runAutomation().catch(() => {});
  }
  res.json(poolForcePayload());
});

app.post('/api/solinator/disable', (req, res) => {
  if (!requireAuth(req, res)) return;
  const days = Number(req.body && req.body.days);
  if (![1, 2].includes(days)) return res.status(400).json({ error: 'days musí být 1 nebo 2.' });
  res.json({ solinator: solinatorDisable(days), solinatorPlan: solinatorPlan() });
});

app.post('/api/solinator/clear', (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json({ solinator: solinatorClear(), solinatorPlan: solinatorPlan() });
});

// Obnova stavu solinátoru po deployi (telefon drží zálohu). Přebíráme jen hodnoty
// pro dnešní den a jen když jsou dál od nuly — server po restartu startuje s nulami.
// U boostu a přenosu se porovnává velikost, ať se neztratí ani namačkané ubrání.
app.post('/api/solinator/restore', (req, res) => {
  const now = Date.now();
  const b = req.body || {};
  let changed = false;
  const du = Number(b.disabledUntil);
  if (Number.isFinite(du) && du > now && du > (state.solinator.disabledUntil || 0)) {
    state.solinator.disabledUntil = du; changed = true;
  }
  // Rozpočet dává smysl jen pro tentýž den — jinak by se dnešek naplnil včerejškem
  if (b.date === pragueDateString()) {
    if (!state.solinator.date) state.solinator.date = b.date;
    for (const k of ['bonusMs', 'boostMs', 'carryMs']) {
      const v = Number(b[k]);
      if (!Number.isFinite(v) || v === 0 || Math.abs(v) > SOLINATOR_MAX_MS) continue;
      // Přirážka za teplotu je vždy kladná, boost a přenos můžou jít i do minusu
      if (k === 'bonusMs' ? v > state.solinator[k] : Math.abs(v) > Math.abs(state.solinator[k])) {
        state.solinator[k] = v; changed = true;
        // S přirážkou se vrátí i důvod, jinak by po deployi popisek zase neseděl
        if (k === 'bonusMs') {
          state.solinator.bonusTempC = Number.isFinite(Number(b.bonusTempC)) ? Number(b.bonusTempC) : null;
          state.solinator.bonusSrc = b.bonusSrc === 'fc' || b.bonusSrc === 'now' ? b.bonusSrc : null;
          state.solinator.bonusFloored = !!b.bonusFloored;
        }
      }
    }
  }
  if (changed) broadcastSolinator();
  res.json({ ok: true, solinator: state.solinator, solinatorPlan: solinatorPlan() });
});

let automationRunning = false;
let weatherProblemLogged = false;

async function runAutomation() {
  if (automationRunning) return;
  automationRunning = true;
  try {
    const weather = await fetchWeather();
    if (!weather) {
      if (!weatherProblemLogged) {
        weatherProblemLogged = true;
        // Bazén a bojler bez času západu nerozhodujeme; solinátor jede dál na náhradní mez 20:00
        addLog(OWM_API_KEY
          ? 'Automatika: počasí se nepodařilo načíst — bazén a bojler stojí, solinátor jede do 20:00'
          : 'Automatika bez počasí — na serveru chybí OWM_API_KEY');
      }
    } else {
      weatherProblemLogged = false;
    }

    // Hlavní vypínač: počasí se stahuje dál (kvůli zobrazení), ale zařízení nesaháme
    if (!autoRunning()) return;

    const now = Date.now();
    const prague = pragueTime();

    // Nejdřív to, co se řídí jen časem — solinátor střídač vůbec nepotřebuje a vypnutí
    // po západu se nesmí ztratit, když střídač v noci spí a jeho data zestárnou.
    // Zimní vypnutí patří sem ze stejného důvodu: v noci střídač spí a bazén by jinak
    // zůstal běžet do rána.
    await enforceWinterOff();
    await enforcePoolForce();
    await runSolinatorAutomation(now, prague, weather);
    await enforcePoolOffWindow(now, prague, weather);

    // Zbytek se rozhoduje podle přebytku → bez čerstvých dat ze střídače (a bez
    // počasí kvůli západu) nerozhodujeme
    if (!weather) return;
    if (!state.solax) return;
    if (Date.now() - new Date(state.solax.fetchedAt).getTime() > 10 * 60 * 1000) return;

    // "Přebytek" = přetok do sítě + výkon nabíjející baterii (feed + bat)
    const totalW = Math.round((state.solax.feedinKw + state.solax.batPowerKw) * 1000);
    const soc = state.solax.batterySoc;
    const reserveW = carReserveW(); // rezerva na auto — spočítá se jednou za cyklus

    await runPoolAutomation(now, prague, weather, totalW, soc, reserveW);
    await runBoilerAutomation(now, prague, weather, totalW, soc, reserveW);
  } catch (err) {
    console.error('Automatika:', err.message);
  } finally {
    automationRunning = false;
  }
}

// První běh až poté, co Shelly poller (start ve 20 s, ~9 dotazů po 1 s) načte stavy
scheduleEvery(runAutomation, AUTOMATION_INTERVAL_MS, 110000); // offset 110 s

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
        closureOrientation: cmds.has('setClosureAndOrientation') ? 'setClosureAndOrientation' : null,
        // Jízda do konkrétní polohy (0 % = vytaženo, 100 % = zataženo)
        closure: cmds.has('setClosure') ? 'setClosure'
          : (cmds.has('setPosition') ? 'setPosition'
          : (cmds.has('setDeployment') ? 'setDeployment' : null))
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

async function tahomaExec(label, deviceURL, commands) {
  const out = await tahomaFetch('/exec/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, actions: [{ deviceURL, commands }] })
  });
  return out && out.execId ? out.execId : null;
}

// Počká, až běh dojede (zmizí z /exec/current). Když se dotaz nepovede nebo to trvá
// moc dlouho, radši se pokračuje dál — poslat druhý povel se zpožděním je pořád lepší
// než ho zahodit.
const EXEC_WAIT_MAX_MS = 90 * 1000;
async function waitForExec(execId) {
  if (!execId) { await delay(5000); return; }
  const until = Date.now() + EXEC_WAIT_MAX_MS;
  while (Date.now() < until) {
    await delay(2000);
    try {
      const running = await tahomaFetch('/exec/current');
      if (!Array.isArray(running) || !running.some(e => e && e.id === execId)) return;
    } catch {
      return; // nevíme → nečekáme donekonečna
    }
  }
}

// action: up / down / stop / on / off / orientation / closure
// value:  u 'orientation' a 'closure' cílová hodnota, u pohybů cílové naklopení
// tilt:   naklopení k akci 'closure' (u ostatních akcí ho nese už `value`)
async function blindCommand(deviceURL, action, value, tilt) {
  const blinds = await getBlinds();
  const blind = blinds.find(b => b.deviceURL === deviceURL);
  if (!blind) throw Object.assign(new Error('Neznámá roleta.'), { status: 400 });
  const cmd = blind.commands[action];
  if (!cmd) throw Object.assign(new Error(`${blind.label}: povel není podporován.`), { status: 400 });

  const label = `SMG home: ${blind.label} ${action}`;
  const num = v => Math.round(Math.min(100, Math.max(0, v)));

  if (action === 'closure') {
    // Zatažení na konkrétní %. Když je zadané i naklopení, musí se to udělat tak, aby
    // se ty dva povely nevyrušily — buď jedním atomickým povelem, nebo až po dojetí.
    const hasTilt = Number.isFinite(tilt) && blind.commands.orientation;
    if (hasTilt && blind.commands.closureOrientation) {
      await tahomaExec(label, deviceURL, [
        { name: blind.commands.closureOrientation, parameters: [num(value), num(tilt)] }
      ]);
    } else {
      const execId = await tahomaExec(label, deviceURL, [{ name: cmd, parameters: [num(value)] }]);
      if (hasTilt) {
        // Zřetězit hned by pohyb přerušilo — počkáme, až žaluzie dojede
        await waitForExec(execId);
        await tahomaExec(label + ' tilt', deviceURL, [
          { name: blind.commands.orientation, parameters: [num(tilt)] }
        ]);
      }
    }
    blindsCache = { ts: 0, list: [] };
    return blind;
  }

  let commandList = [{ name: cmd, parameters: action === 'orientation' ? [num(value)] : [] }];
  if ((action === 'up' || action === 'down') && Number.isFinite(value) && blind.commands.closureOrientation) {
    // Žaluzie: jeden atomický povel „jeď do krajní polohy s tímto naklopením" —
    // jede kontinuálně (zřetězené up+setOrientation by pohyb hned přerušilo)
    const closure = action === 'down' ? 100 : 0;
    commandList = [{ name: blind.commands.closureOrientation, parameters: [closure, num(value)] }];
  } else if (action === 'stop' && blind.commands.orientation && Number.isFinite(value)) {
    // Po zastavení v mezipoloze se žaluzie ještě naklopí na hodnotu z posuvníku
    commandList = [
      { name: cmd, parameters: [] },
      { name: blind.commands.orientation, parameters: [num(value)] }
    ];
  }

  await tahomaExec(label, deviceURL, commandList);
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
        hasOrientation: !!b.commands.orientation,
        hasClosure: !!b.commands.closure
      }))
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

const BLIND_ACTION_LABELS = {
  up: 'nahoru', down: 'dolů', stop: 'stop', my: 'moje pozice',
  on: 'zapnuto', off: 'vypnuto', orientation: 'naklopení', closure: 'zatažení'
};

app.post('/api/blinds/command', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { deviceURL, action, value, tilt } = req.body || {};
  if (typeof deviceURL !== 'string' || !BLIND_ACTION_LABELS[action]) {
    return res.status(400).json({ error: 'Chybí deviceURL nebo neznámá action.' });
  }
  const pct = (v, what) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw Object.assign(new Error(`${what} musí být 0–100.`), { status: 400 });
    }
    return n;
  };
  const movesWithTilt = ['up', 'down', 'stop'];
  let v = null, t = null;
  try {
    if (action === 'closure') {
      v = pct(value, 'Zatažení');
      if (tilt !== undefined && tilt !== null) t = pct(tilt, 'Naklopení');
    } else if (action === 'orientation' || (movesWithTilt.includes(action) && value !== undefined && value !== null)) {
      v = pct(value, 'Naklopení');
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    // Ovládání rolet/žaluzií se do logu nezapisuje
    await blindCommand(deviceURL, action, v, t);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// ---------- Časovače žaluzií (jednorázové vytažení/zatažení v daný čas) ----------

let blindTimers = [];
let blindTimerSeq = 1;

app.post('/api/blinds/timer', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const { deviceURL, deviceURLs, time, action, orientation, label } = req.body || {};
  // Časovač může ovládat i skupinu rolet najednou (Miky/Elenka mají po dvou)
  const urls = Array.isArray(deviceURLs)
    ? deviceURLs.filter(u => typeof u === 'string' && u).slice(0, 20)
    : (typeof deviceURL === 'string' && deviceURL ? [deviceURL] : []);
  if (!urls.length || !validTimerTime(time) || !['up', 'down', 'tilt'].includes(action)) {
    return res.status(400).json({ error: 'Chybí rolety, time (HH:MM) nebo action (up/down/tilt).' });
  }
  let tilt = null;
  if (orientation !== undefined && orientation !== null) {
    tilt = Number(orientation);
    if (!Number.isFinite(tilt) || tilt < 0 || tilt > 100) {
      return res.status(400).json({ error: 'Naklopení musí být 0–100.' });
    }
  }
  // "tilt" = jen naklopení lamel (nehýbe roletou nahoru/dolů) → naklopení je povinné
  if (action === 'tilt' && tilt === null) {
    return res.status(400).json({ error: 'Pro naklopení zadej hodnotu naklopení 0–100.' });
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
  const actWord = action === 'up' ? 'vytáhnout' : (action === 'down' ? 'zatáhnout' : `naklopit na ${tilt} %`);
  addLog(`Časovač: ${name} ${actWord} v ${time}`);
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
    // "tilt" = jen naklopení lamel → posíláme orientation (nehýbe roletou nahoru/dolů)
    const cmd = t.action === 'tilt' ? 'orientation' : t.action;
    for (const url of t.deviceURLs || []) {
      try {
        await blindCommand(url, cmd, t.orientation);
        ok++;
      } catch (err) {
        addLog(`Časovač ${t.name}: roleta selhala (${err.message.slice(0, 100)})`);
      }
      await delay(500);
    }
    if (ok > 0) {
      const done = t.action === 'up' ? 'vytaženo' : (t.action === 'down' ? 'zataženo' : `naklopeno na ${t.orientation} %`);
      addLog(`${t.name}: ${done} (časovač ${t.time})`);
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
  setManualHold(key);   // časovač i asistent jsou tvoje rozhodnutí, ne automatika
  addLog(`${DEVICE_LABELS[key]}: ${stateOn ? 'zapnuto' : 'vypnuto'}${reason ? ` (${reason})` : ''}`);
  setTimeout(() => pollDevice(key), 1500);
}

app.post('/api/relay/timer', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { key, time, action } = req.body || {};
  if (!DEVICES[key] || !validTimerTime(time) || !['on', 'off'].includes(action)) {
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
// na coolTemp °C; vypne, až klesne pod offTemp °C (hystereze). Mezi přepnutími platí
// minimální doba chodu i klidu (TEMP_AUTO_MIN_ON_MS / TEMP_AUTO_MIN_OFF_MS).
const TEMP_AUTO_RULES = [
  // Obývák je denní místnost — nemá smysl ho brzdit tichým režimem, ať chladí naplno
  { key: 'obyvak', room: 'Obývák', quiet: false },
  { key: 'loznice', room: 'Ložnice', quiet: true },
  { key: 'elenka', room: 'Elenka', quiet: true },
  { key: 'miky', room: 'Miky', quiet: true }
];

// Spínací teplota je jedna společná pro všechny pokoje (jezdec v appce, 18–25 °C).
// Poslední stav zapnutí, který o klimatizaci víme — buď z pollu, nebo protože jsme ho sami
// nastavili. Slouží k rozpoznání změny, kterou udělal někdo jiný (dálkový ovladač, appka
// Panasonic): poller ji pak zapíše do logu.
const airconLastPower = new Map(); // guid -> true/false

// Jediná cesta, kudy jdou povely do klimatizace. Díky tomu si vlastní akci zapamatujeme
// a poller ji nehlásí jako zásah zvenčí.
async function pccControl(guid, parameters) {
  await pccQueued(() => pccApiFetch('/deviceStatus/control', {
    method: 'POST',
    body: JSON.stringify({ deviceGuid: guid, parameters })
  }));
  if (parameters.operate !== undefined) airconLastPower.set(guid, parameters.operate === 1);
}

// Zapíše do logu změnu zapnutí, kterou appka neudělala — dálkový ovladač, appka Panasonic,
// nebo náš povel neprošel. Vlastní akce se sem nedostanou, ty si pamatuje pccControl.
function noteAirconExternalChanges(devices) {
  for (const d of devices) {
    if (typeof d.power !== 'boolean') continue;   // stav neznámý → nehádat
    const prev = airconLastPower.get(d.guid);
    // Poprvé po startu jen zapamatovat, ať se nehlásí „změna" proti prázdnu
    if (prev !== undefined && prev !== d.power) {
      addLog(`${d.name}: ${d.power ? 'zapnuto' : 'vypnuto'} (mimo appku)`);
      tempAutoDisableByHand(d.name, 'zásah mimo appku');
    }
    airconLastPower.set(d.guid, d.power);
  }
}

// Odvozené hodnoty drží stejné rozestupy jako původní napevno psané pravidlo (22/20,5/20):
//   vypnout  = zapnout − 1 °C
//   chladit na = zapnout − 2 °C  (o kus pod vypínací mezí, ať klima opravdu dochladí)
const TEMP_AUTO_ON_MIN = 18;
const TEMP_AUTO_ON_MAX = 25;
// Obývák má vlastní rozsah jezdce a strop chlazení: i při vysoké mezi se má dochladit
// pořádně, ne jen o dva stupně (26 → 22, ne 26 → 24)
const TEMP_AUTO_ROOM_LIMITS = { obyvak: { min: 22, max: 26, coolMax: 22 } };
function tempAutoLimits(roomKey) {
  return TEMP_AUTO_ROOM_LIMITS[roomKey]
    || { min: TEMP_AUTO_ON_MIN, max: TEMP_AUTO_ON_MAX, coolMax: null };
}
function tempAutoLevels(roomKey) {
  const own = roomKey !== undefined ? state.tempAutoOnRooms[roomKey] : undefined;
  const onTemp = own !== undefined ? own : state.tempAutoOn;
  const { coolMax } = tempAutoLimits(roomKey);
  const coolTemp = coolMax === null ? onTemp - 2 : Math.min(coolMax, onTemp - 2);
  return { onTemp, offTemp: onTemp - 1, coolTemp };
}
// Zima: jezdec je CÍLOVÁ teplota, ne spínací mez. Zapne se při rozdílu 2 °C na
// kteroukoli stranu (topení i chlazení — o to se v režimu AUTO postará jednotka),
// vypne, jakmile je pokoj do 1 °C od cíle. Rozsah je pro všechny pokoje stejný:
// cílová teplota znamená totéž bez ohledu na to, kde se měří.
const TEMP_AUTO_WINTER_MIN = 18;
const TEMP_AUTO_WINTER_MAX = 24;
const TEMP_AUTO_WINTER_ON_DIFF = 2;
const TEMP_AUTO_WINTER_OFF_DIFF = 1;
function tempAutoWinterTarget(roomKey) {
  const own = roomKey !== undefined ? state.tempAutoWinterRooms[roomKey] : undefined;
  return own !== undefined ? own : state.tempAutoWinter;
}
// Minimální doby chodu i klidu — ať kompresor necyklu je po pár minutách
const TEMP_AUTO_MIN_OFF_MS = 20 * 60 * 1000; // po vypnutí drž vypnuté aspoň 20 min
const TEMP_AUTO_MIN_ON_MS = 20 * 60 * 1000;  // po zapnutí nech běžet aspoň 20 min
const tempAutoOffAt = {}; // key -> čas posledního vypnutí automatikou
const tempAutoOnAt = {};  // key -> čas posledního zapnutí automatikou

// Vypnutí přepínače teplotní automatiky vypne i samotnou klimatizaci —
// jinak by v pokoji zůstala běžet v tom stavu, v jakém ji automatika nechala.
async function tempAutoTurnOff(rule) {
  const dev = findAircon(rule.room);
  if (!dev || dev.power !== true) return; // nenašli jsme ji, nebo už je vypnutá
  try {
    await pccControl(dev.guid, { operate: 0 });
    dev.power = false;
    addLog(`${dev.name}: vypnuto (teplotní automatika vypnuta)`);
    broadcast('aircon', { aircon: state.aircon });
  } catch (err) {
    addLog(`Teplotní automatika ${rule.room}: vypnutí klimatizace selhalo (${err.message.slice(0, 100)})`);
  }
}

// Podle čeho se v pokoji rozhoduje: přednost má Shelly čidlo (měří v obytné zóně),
// náhradou je čidlo v klimatizaci (u stropu, ukazuje víc). Přepnutí zdroje se zapisuje
// jen při změně — jinak by to při každém cyklu přidalo řádek do logu.
// Ticho čidla není chyba (hlásí jen při změně), ale dlouhé ticho může znamenat i vybitou
// baterku — zapíše se proto jednou při změně stavu, ne každý cyklus.
const sensorStateLogged = {};
function noteSensorState(roomKey) {
  const s = state.sensors[roomKey];
  const st = !s || typeof s.tempC !== 'number' ? 'bez dat'
    : (s.reportedAt && Date.now() - s.reportedAt > SENSOR_SILENCE_LOG_MS ? 'ticho' : 'ok');
  if (sensorStateLogged[roomKey] === st) return;
  const first = sensorStateLogged[roomKey] === undefined;
  sensorStateLogged[roomKey] = st;
  if (first && st === 'ok') return;   // běžný start, není co hlásit
  const label = (TEMP_AUTO_RULES.find(r => r.key === roomKey) || {}).room || roomKey;
  if (st === 'ticho') addLog(`Čidlo ${label}: nehlásí přes 6 h — jede se dál podle poslední hodnoty`);
  else if (st === 'bez dat') addLog(`Čidlo ${label}: zatím nehlásí, automatika pokoj přeskakuje`);
  else addLog(`Čidlo ${label}: zase hlásí`);
}

// Pokoj s čidlem se řídí VÝHRADNĚ podle něj — žádný náhradní zdroj. Pokoje bez čidla
// jedou podle čidla v klimatizaci.
function roomTemp(roomKey, dev) {
  if (TEMP_SENSORS[roomKey]) {
    noteSensorState(roomKey);
    return { temp: sensorTempC(roomKey), source: 'čidlo' };
  }
  return { temp: dev && typeof dev.insideTemp === 'number' ? dev.insideTemp : null, source: 'klimatizace' };
}

// Teploty v pokojích pro graf na stránce Klima. Bere jen to, co poll právě přinesl —
// žádné dotazy navíc. Vzorek po 5 min stačí, tak často se teploty stejně obnovují.
const AIRCON_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
function recordAirconTemps(devices) {
  const now = Date.now();
  const temps = {};
  for (const d of devices || []) {
    if (typeof d.insideTemp === 'number') temps[d.guid] = d.insideTemp;
  }
  const sens = {};
  for (const room of Object.keys(TEMP_SENSORS)) {
    const s = state.sensors[room];
    if (s && typeof s.tempC === 'number') sens[room] = s.tempC;
  }
  if (!Object.keys(temps).length && !Object.keys(sens).length) return;
  state.airconHistory.push({ t: now, temps, sens });
  state.airconHistory = state.airconHistory.filter(x => now - x.t <= AIRCON_HISTORY_MAX_AGE_MS);
  broadcast('airconHistory', { history: state.airconHistory });
}

// Zásah do klimatizace od člověka (tlačítka v appce, dálkový ovladač, časovač,
// asistent) shodí přepínač
// teplotní automatiky toho pokoje — ať automatika nepřepíše, co si člověk právě nastavil.
//
// POZOR: na rozdíl od ručního vypnutí přepínače tady klimatizací NEHÝBEME. Vypnutí
// přepínače jinak klimatizaci zhasne (viz /api/tempauto) — což by tady bylo obráceně:
// zapneš ji ručně a appka by ti ji hned zase vypnula.
function tempAutoDisableByHand(deviceName, why) {
  const n = cz(deviceName || '');
  if (!n) return;
  const rule = TEMP_AUTO_RULES.find(r => n.includes(cz(r.room)) || cz(r.room).includes(n));
  if (!rule || !state.tempAuto[rule.key]) return;
  state.tempAuto[rule.key] = false;
  addLog(`Teplotní automatika ${rule.room}: vypnuta (${why})`);
  broadcast('tempAuto', { tempAuto: state.tempAuto });
}

async function evaluateTempAuto(devices) {
  for (const rule of TEMP_AUTO_RULES) {
    if (!state.tempAuto[rule.key]) continue;
    // Mez se bere per pokoj — obývák má vlastní, zbytek společnou
    const { onTemp, offTemp, coolTemp } = tempAutoLevels(rule.key);
    const rn = cz(rule.room);
    const dev = (devices || []).find(d => cz(d.name).includes(rn) || rn.includes(cz(d.name)));
    if (!dev) continue;
    const { temp, source } = roomTemp(rule.key, dev);
    if (typeof temp !== 'number') continue;
    const src = TEMP_SENSORS[rule.key] ? ` (${source})` : '';
    // Po restartu nevíme, jak dlouho už jednotka běží. Bereme to, jako by se právě zapnula —
    // nechat ji chvíli běžet navíc je menší zlo než ji po pár minutách zase shodit.
    if (dev.power === true && !tempAutoOnAt[rule.key]) tempAutoOnAt[rule.key] = Date.now();

    let parameters = null, msg = null;
    const now = Date.now();
    const canTurnOn = now >= (tempAutoOffAt[rule.key] || 0) + TEMP_AUTO_MIN_OFF_MS;
    const canTurnOff = now >= (tempAutoOnAt[rule.key] || 0) + TEMP_AUTO_MIN_ON_MS;
    if (isWinter()) {
      // Zima: pásmo kolem cílové teploty, jednotka si v AUTO topení i chlazení řídí sama
      const cil = tempAutoWinterTarget(rule.key);
      const rozdil = Math.abs(temp - cil);
      if (rozdil >= TEMP_AUTO_WINTER_ON_DIFF && dev.power !== true && canTurnOn) {
        parameters = { operate: 1, operationMode: PCC_MODES.auto, temperatureSet: cil, ecoMode: rule.quiet ? 2 : 0 };
        msg = `${dev.name}: zapnuto AUTO na ${cil} °C (v pokoji ${temp} °C${src})`;
      } else if (rozdil <= TEMP_AUTO_WINTER_OFF_DIFF && dev.power === true && canTurnOff) {
        parameters = { operate: 0 };
        msg = `${dev.name}: vypnuto (v pokoji ${temp} °C${src}, cíl ${cil} °C)`;
      }
    } else if (temp >= onTemp && dev.power !== true && canTurnOn) {
      parameters = { operate: 1, operationMode: PCC_MODES.cool, temperatureSet: coolTemp, ecoMode: rule.quiet ? 2 : 0 };
      msg = `${dev.name}: zapnuto chlazení ${coolTemp} °C (v pokoji ${temp} °C${src}, mez ${onTemp} °C)`;
    } else if (temp <= offTemp && dev.power === true && canTurnOff) {
      parameters = { operate: 0 };
      msg = `${dev.name}: vypnuto (v pokoji ${temp} °C${src})`;
    }
    if (!parameters) continue;
    try {
      await pccControl(dev.guid, parameters);
      dev.power = parameters.operate === 1;
      // Start minimální doby klidu, resp. chodu
      if (parameters.operate === 0) { tempAutoOffAt[rule.key] = Date.now(); delete tempAutoOnAt[rule.key]; }
      else tempAutoOnAt[rule.key] = Date.now();
      if (parameters.temperatureSet !== undefined) dev.targetTemp = parameters.temperatureSet;
      if (parameters.operationMode !== undefined) dev.mode = isWinter() ? 'auto' : 'cool';
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

    noteAirconExternalChanges(out);
    recordAirconTemps(out);

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
  // Panasonic (klimatizace + nádrž TČ = bojler 1) zůstává na 5 min — Comfort Cloud
  // je na četnost dotazů citlivý a bojlery mají mít 5 min tak jako tak
  scheduleEvery(pollAircon, 5 * 60 * 1000, 80000); // offset 80 s
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
    await pccControl(guid, parameters);

    // Optimistická aktualizace, ověření proběhne příštím pollem
    const dev = state.aircon.devices.find(d => d.guid === guid);
    if (dev) {
      if (parameters.operate !== undefined) dev.power = parameters.operate === 1;
      if (parameters.temperatureSet !== undefined) dev.targetTemp = parameters.temperatureSet;
      if (parameters.operationMode !== undefined) dev.mode = mode;
      if (parameters.ecoMode !== undefined) dev.eco = parameters.ecoMode;
      broadcast('aircon', { aircon: state.aircon });
      if (actions.length) addLog(`${dev.name}: ${actions.join(', ')}`);
      tempAutoDisableByHand(dev.name, 'ruční ovládání');
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
  if (typeof guid !== 'string' || !validTimerTime(time) || !['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'Chybí guid, time (HH:MM) nebo action (on/off).' });
  }
  if (airconTimers.length >= 10) {
    return res.status(400).json({ error: 'Maximálně 10 časovačů.' });
  }
  // guid "all" = hromadný časovač; ukládá se jako JEDEN záznam (ne N samostatných),
  // ať se nevyčerpá limit 10 časovačů a seznam zůstane přehledný
  const dev = state.aircon.devices.find(d => d.guid === guid);
  const name = guid === 'all' ? 'Všechny klimatizace' : ((dev && dev.name) || 'Klima');
  const timer = { id: airconTimerSeq++, guid, name, time, action, quiet: action === 'on' && !!quiet };
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
    const params = { operate: t.action === 'on' ? 1 : 0 };
    // Při zapnutí s tichým režimem rovnou nastavíme ecoMode = tichý (2)
    if (t.action === 'on' && t.quiet) params.ecoMode = 2;
    // „all" = obejít všechny jednotky; pccQueued je serializuje, takže na Panasonic
    // nepřijde nával naráz
    const targets = t.guid === 'all'
      ? (state.aircon.devices || []).map(d => d.guid)
      : [t.guid];
    let ok = 0;
    for (const guid of targets) {
      try {
        await pccControl(guid, params);
        const dev = state.aircon.devices.find(d => d.guid === guid);
        if (dev) {
          dev.power = t.action === 'on';
          if (t.action === 'on' && t.quiet) dev.eco = 2;
          // Časovač je taky pokyn od člověka — jinak by automatika po nočním vypnutí
          // klimatizaci hned zase nahodila. Jméno bereme z jednotky, ne z časovače:
          // hromadný časovač se jmenuje „Všechny klimatizace" a na pokoj by nesedl.
          tempAutoDisableByHand(dev.name, `časovač ${t.time}`);
        }
        ok++;
      } catch (err) {
        addLog(`Časovač ${t.name}: selhal (${err.message.slice(0, 100)})`);
      }
    }
    if (ok > 0) {
      broadcast('aircon', { aircon: state.aircon });
      addLog(`${t.name}: ${t.action === 'on' ? 'zapnuto' : 'vypnuto'}${t.action === 'on' && t.quiet ? ' (tichý)' : ''} (časovač ${t.time})`);
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
// chargerStatus (Solax): 0 nepřipojeno, 1 připraveno, 2 nabíjí, 3 dokončeno, 4 porucha, 5 nedostupné
const WB_STATUS_LABELS = { 0: 'Nepřipojeno', 1: 'Připraveno', 2: 'Nabíjí', 3: 'Dokončeno', 4: 'Porucha', 5: 'Nedostupné' };

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

// Zaznamená změnu režimu wallboxu do historie (pro graf „kdy jaký režim")
function recordWbMode(mode) {
  if (!mode) return;
  const last = state.wbModeHistory[state.wbModeHistory.length - 1];
  if (last && last.mode === mode) return; // beze změny
  const cutoff = Date.now() - TIMELINE_MAX_AGE_MS;
  state.wbModeHistory = state.wbModeHistory.filter(e => e.t >= cutoff);
  state.wbModeHistory.push({ t: Date.now(), mode });
  broadcast('wbModeHistory', { history: state.wbModeHistory });
}

let wallboxPollRunning = false;

async function pollWallbox() {
  if (!wallboxEnabled || wallboxPollRunning) return;
  wallboxPollRunning = true;
  try {
    const result = await wbFetchStatus();
    state.wallbox = { ...wbParseResult(result), error: null, fetchedAt: new Date().toISOString() };
    checkCarCharged(state.wallbox.status); // notifikace „auto dobito"
    // Do grafu režimů NEzaznamenáváme skutečný stav nabíječky (ta se sama dá do STOP,
    // když auto není připojené / je dobito). Zaznamenáváme jen změny NASTAVENÉHO režimu
    // (viz runEnergyControl a /api/wallbox/set), ať čára FAST/ECO/GREEN běží dál i přes STOP.
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
  // Wallbox sjednocen na 2 min jako ostatní dlaždice diagramu (limit je 10 dotazů/min)
  scheduleEvery(pollWallbox, POLL_INTERVAL_MS, 40000); // offset 40 s
}

// Přepnutí režimu: pileCmd (POST, rwType 2 = zápis, cmdType 1 = režim nabíjení)
async function wbSetMode(mode) {
  // tokenId musí být v URL (a pro jistotu i v hlavičce) — jinak Solax hlásí „token is empty!"
  const url = `${WB_HOST}/proxyApp/proxy/api/pileCmd?tokenId=${encodeURIComponent(SOLAX_TOKEN_ID)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', tokenId: SOLAX_TOKEN_ID, token: SOLAX_TOKEN_ID },
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
    state.wbLastTarget = null;
    recordWbMode(mode);
    broadcast('wallbox', { wallbox: state.wallbox });
    setWbManualHold();   // automatika ho 3 h nepřepíše
    addLog(`Wallbox: režim ${WB_MODE_LABELS[mode]} ručně`
      + ` (automatika převezme v ${fmtPragueTime(state.wbManualUntil)})`);
    res.json({ success: true });
    // Po 3 s obnovíme stav, ať se ukáže potvrzený režim
    setTimeout(pollWallbox, 3000);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- Řízení režimu wallboxu (den ECO, noc FAST/GREEN) ----------
// V režimu AUTO má den pět fází:
//   večer    (od západu − 1 h do půlnoci)                     GREEN — jen přebytek
//   noc      (půlnoc → WB_NIGHT_FAST_HOUR)                    GREEN
//   dobíjení (3:00 → konec noci = východ + 1 h, nejpozd. 8:00) FAST, když auto ráno
//                                                             potřebuju, jinak GREEN
//   čekání   (konec noci → otevření denního okna)             GREEN — jen přebytek
//   den      (okno otevřené → západ − 1 h)                    ECO
// FAST schválně nezačíná hned po západu: večer se baterka hodí baráku, a do rána se
// auto stihne dobít i tak. Za celou noc se tedy ze sítě bere jen mezi 3:00 a ránem.
// Denní okno se NEOTEVÍRÁ podle hodin: čeká se, až FVE reálně vyrábí (2× po sobě nad
// prahem), nejpozději se otevře ve WB_ECO_FALLBACK_HOUR. ECO má totiž pevné minimum
// 6 A, takže při slabém slunci dobírá ze sítě — a to je přesně to, čemu se ráno vyhýbáme.
// Po konci noci se už FAST nevrací (bralo by ze sítě ještě víc než ECO).
// Výchozí stav „ráno auto potřebuju" dává den v týdnu toho rána (pracovní den ano,
// víkend ne), ruční přepnutí platí na jedno ráno.
// Bazén a bojler se řídí samostatně (runPoolAutomation / runBoilerAutomation).
//
// MIMO KÓD (ručně v appce střídače/wallboxu):
//  - Wallbox: ECO i GREEN na 6 A  (nejnižší možný proud — určuje, při jakém přebytku
//    se nabíjení vůbec rozjede; víc = rozjede se později a ECO si víc dobírá ze sítě)
//  - Střídač: "Battery charge EVC" = Enable  (jinak si auto z baterky nevezme; týká se
//    jen FAST, GREEN z baterky nebere)
//  - Střídač: Min SOC nízko (např. 10 %)     (aby se baterka večer skoro vyprázdnila)
const EC = {
  SUN_ECO_AFTER_SUNRISE_S: 3600,  // hodinu po východu slunce → nejdřív může začít den
  SUN_FAST_BEFORE_SUNSET_S: 3600  // hodinu před západem slunce → FAST
};

// Otevření denního (ECO) okna podle skutečné výroby
const WB_ECO_PV_KW = 2.5;         // výroba, která pokryje 6 A do auta i běžný barák
const WB_ECO_PV_HITS = 2;         // 2× po sobě, ať okno neotevře jeden pruh slunce
const WB_ECO_FALLBACK_HOUR = 10;  // zataženo celý den → v 10:00 se otevře stejně
// Noční FAST nezačíná hned po západu, ale až ve 3:00. Večer je baterka potřeba pro
// barák; do rána se auto stihne dobít i tak (3:00 → konec noci jsou nejmíň 3 hodiny).
const WB_NIGHT_FAST_HOUR = 3;
const WB_PV_MAX_AGE_MS = 15 * 60 * 1000; // starší data o výrobě neberem

let wbControlRunning = false;

// Nejdřívější možný začátek denního okna ze slunečních dat (samotné otevření řídí branka)
function wbEcoStartMs(w) {
  return w.sys.sunrise * 1000 + EC.SUN_ECO_AFTER_SUNRISE_S * 1000;
}

// Pražská celá hodina toho dne, do kterého spadá `ms`
function wbHourOnDayOf(ms, hour) {
  const p = pragueTime(ms);
  return ms - (p.hour * 3600000 + p.minute * 60000) + hour * 3600000;
}
const WB_MORNING_LATEST_HOUR = 8;
const wbEightOnDayOf = ms => wbHourOnDayOf(ms, WB_MORNING_LATEST_HOUR);

// Konec dnešní noci: východ + 1 h, nejpozději v 8:00 (v zimě se slunce nedočkáme).
// Od té chvíle se nikdy nejede FAST — buď je otevřené denní okno (ECO), nebo se na
// jeho otevření čeká v GREEN.
function wbNightEndMs(w, at = Date.now()) {
  const eight = wbEightOnDayOf(at);
  return w && w.sys && w.sys.sunrise !== undefined ? Math.min(wbEcoStartMs(w), eight) : eight;
}

// Ráno, kterého se rozhodnutí „potřebuju/nepotřebuju" týká: nejbližší konec noci.
// Bez dat o počasí se jede rovnou podle 8:00.
function wbMorningTargetMs() {
  const now = Date.now();
  const w = weatherCache.data;
  let next;
  if (w && w.sys && w.sys.sunrise !== undefined) {
    const eco = wbEcoStartMs(w);
    next = eco > now ? eco : eco + 24 * 3600000;
  } else {
    const eight = wbEightOnDayOf(now);
    next = eight > now ? eight : eight + 24 * 3600000;
  }
  return Math.min(next, wbEightOnDayOf(next));
}

// Výchozí stav podle dne v týdnu toho rána: v pracovní den se ráno jede (dobít naplno),
// o víkendu ne (počká se na slunce).
function wbDefaultNeedFor(ms) {
  const den = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'short' }).format(ms);
  return den !== 'Sat' && den !== 'Sun';
}

// Platí ruční přepnutí pro nejbližší ráno? Jinak rozhoduje den v týdnu.
function wbMorningManual() {
  const m = state.wbMorning || {};
  return typeof m.need === 'boolean' && Date.now() < (m.until || 0);
}
function wbMorningNeed() {
  return wbMorningManual() ? !!state.wbMorning.need : wbDefaultNeedFor(wbMorningTargetMs());
}

// Aktuální výroba FVE v kW — přednostně z Infigy (živější), jinak ze Solaxu. Stará
// data neberem: kdyby střídač vypadl, radši se na ECO čeká do záložní hodiny.
function wbPvKw() {
  const now = Date.now();
  const fresh = ts => ts && now - new Date(ts).getTime() <= WB_PV_MAX_AGE_MS;
  const inf = state.infigy || {};
  if (typeof inf.pvPower === 'number' && fresh(inf.fetchedAt)) return inf.pvPower;
  const s = state.solax;
  if (s && typeof s.fveKw === 'number' && fresh(s.fetchedAt)) return s.fveKw;
  return null;
}

// Branka denního okna. Otevře ji až skutečná výroba (WB_ECO_PV_HITS měření po sobě
// nad prahem) a pak zůstane otevřená do večera — ať režim wallboxu nebliká podle mraků.
let wbEcoGate = { date: '', open: false, hits: 0 };

function wbEcoGateOpen() {
  if (wbEcoGate.open && wbEcoGate.date === pragueDateString()) return true;
  return pragueTime().hour >= WB_ECO_FALLBACK_HOUR;
}

// Volá se jednou za cyklus (jinak by se počítadlo posunulo víckrát za stejná data)
function wbUpdateEcoGate() {
  const today = pragueDateString();
  if (wbEcoGate.date !== today) wbEcoGate = { date: today, open: false, hits: 0 };
  if (wbEcoGate.open) return;
  const pv = wbPvKw();
  if (pv === null) { wbEcoGate.hits = 0; return; }
  wbEcoGate.hits = pv >= WB_ECO_PV_KW ? wbEcoGate.hits + 1 : 0;
  if (wbEcoGate.hits >= WB_ECO_PV_HITS) {
    wbEcoGate.open = true;
    addLog(`Wallbox: FVE dává ${formatKwLog(pv * 1000)} → denní okno ECO`);
  }
}

// Cílový režim wallboxu (jen v AUTO; v FAST režimu pevně FAST)
function ecWallboxTarget() {
  if (!state.wbAuto) return 'fast';
  // Zima: čekat na 2,5 kW z FVE nemá smysl a záloha v 10:00 by ECO otvírala každý den
  // ze sítě. Radši rovnou FAST — ranní přepínač ani branka denního okna se neuplatní.
  if (isWinter()) return 'fast';
  const w = weatherCache.data;
  if (!w || !w.sys || w.sys.sunrise === undefined || w.sys.sunset === undefined) return null; // bez dat neměníme
  const now = Date.now();
  const eveningStart = w.sys.sunset * 1000 - EC.SUN_FAST_BEFORE_SUNSET_S * 1000;
  const nightEnd = wbNightEndMs(w, now);
  // Pořadí podmínek: večer musí vyhrát nad denní větví (konec noci je to už dávno za námi)
  if (now >= eveningStart || now < nightEnd) {
    if (!wbMorningNeed()) return 'green';   // čeká se na slunce, celou noc jen přebytek
    // FAST až od 3:00. Podmínka `now < nightEnd` je podstatná: bez ní by 3:00 téhož dne
    // platila i večer ve 21:00 a FAST by naskočil přesně tam, odkud ho odsouváme.
    const fastFrom = wbHourOnDayOf(now, WB_NIGHT_FAST_HOUR);
    return now < nightEnd && now >= fastFrom ? 'fast' : 'green';
  }
  // Přes den: ECO až od chvíle, kdy FVE opravdu vyrábí. Do té doby GREEN — z přebytku
  // se nabíjí taky, jen se nic nedobírá ze sítě ani z baterky.
  return wbEcoGateOpen() ? 'eco' : 'green';
}

// Ruční přepnutí režimu wallboxu drží 3 hodiny. Bez toho by ho automatika přepsala do
// dvou minut (ruční zásah nuluje wbLastTarget) — a v zimě, kde je cíl pořád FAST, by
// ruční ECO/GREEN nešlo nastavit vůbec. Relé mají svůj odklad v manualHold; wallbox
// není v DEVICES, tak má vlastní razítko.
const WB_MANUAL_HOLD_MS = 3 * 60 * 60 * 1000;
function wbManualHeld() { return Date.now() < (state.wbManualUntil || 0); }
function setWbManualHold() {
  state.wbManualUntil = Date.now() + WB_MANUAL_HOLD_MS;
  broadcast('wbAuto', wbSwitchPayload());
}
function clearWbManualHold() {
  if (!state.wbManualUntil) return;
  state.wbManualUntil = 0;
  broadcast('wbAuto', wbSwitchPayload());
}

// Čeká se teď na rozjezd výroby? (jen pro nápovědu v appce)
function wbWaitingForSun() {
  if (!state.wbAuto || isWinter()) return false;
  const w = weatherCache.data;
  if (!w || !w.sys || w.sys.sunrise === undefined || w.sys.sunset === undefined) return false;
  const now = Date.now();
  const eveningStart = w.sys.sunset * 1000 - EC.SUN_FAST_BEFORE_SUNSET_S * 1000;
  return now >= wbNightEndMs(w, now) && now < eveningStart && !wbEcoGateOpen();
}

let wbPrevStatus = null;
let wbPrevMorningState = null;  // ať se přepínač i nápověda v appce samy přepnou

async function runEnergyControl() {
  if (!wallboxEnabled || wbControlRunning) return;
  if (!autoRunning()) return; // hlavní vypínač automatiky
  wbControlRunning = true;
  try {
    // Když se auto právě PŘIPOJILO (odpojeno/dokončeno → připraveno/nabíjí), vynutíme
    // znovunastavení režimu. V STOP/idle totiž wallbox nemusí dřív nastavený režim držet,
    // takže by po připojení nebyl "ready" ve správném režimu.
    const st = state.wallbox && typeof state.wallbox.status === 'number' ? state.wallbox.status : null;
    const carReady = st === 1 || st === 2; // připraveno / nabíjí
    const wasReady = wbPrevStatus === 1 || wbPrevStatus === 2;
    if (carReady && !wasReady) state.wbLastTarget = null; // auto se připojilo → přenastav režim
    wbPrevStatus = st;

    // Branka denního okna se posouvá jen tady, jednou za cyklus
    wbUpdateEcoGate();

    // Ranní rozhodnutí i čekání na slunce se mění samy (vypršením, přelomem do víkendu,
    // rozjezdem výroby) — dej vědět appce, ať přepínač a nápověda sedí
    const morningState = `${wbMorningNeed()}|${wbWaitingForSun()}`;
    if (wbPrevMorningState !== morningState) {
      if (wbPrevMorningState !== null) broadcast('wbAuto', wbSwitchPayload());
      wbPrevMorningState = morningState;
    }

    const target = ecWallboxTarget();
    if (wbManualHeld()) return;   // ruční režim drží, automatika ho nepřepisuje
    if (target && state.wbLastTarget !== target) {
      await wbSetMode(target);
      state.wbLastTarget = target;
      state.wallbox = { ...state.wallbox, mode: target };
      recordWbMode(target);
      broadcast('wallbox', { wallbox: state.wallbox });
      addLog(`Wallbox: režim ${WB_MODE_LABELS[target]} (${state.wbAuto ? 'automatika' : 'FAST'})`);
    }
  } catch (err) {
    addLog(`Wallbox automatika: ${err.message.slice(0, 120)}`);
  } finally {
    wbControlRunning = false;
  }
}

// Do appky chodí oba přepínače pohromadě — patří k sobě. Ranní rozhodnutí posílá server
// rovnou vyhodnocené (appka neví, kdy se otevírá okno ani jaký je výchozí stav dne).
function wbSwitchPayload() {
  return {
    wbAuto: state.wbAuto,
    wbMorningNeed: wbMorningNeed(),
    wbMorningUntil: wbMorningTargetMs(),
    wbMorningManual: wbMorningManual(),
    // Čekání na rozjezd výroby — appka z toho skládá nápovědu
    wbWaitingForSun: wbWaitingForSun(),
    wbPvKw: wbPvKw(),
    wbEcoPvKw: WB_ECO_PV_KW,
    wbEcoFallbackHour: WB_ECO_FALLBACK_HOUR,
    wbNightFastHour: WB_NIGHT_FAST_HOUR,
    // Zima jede pořád FAST; ruční režim drží 3 h — appka z obojího skládá nápovědu
    wbWinter: isWinter(),
    wbManualUntil: wbManualHeld() ? state.wbManualUntil : 0
  };
}

app.post('/api/wallbox/auto', async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!wallboxEnabled) return res.status(500).json({ error: 'Wallbox není nakonfigurován.' });
  const { auto } = req.body || {};
  if (typeof auto !== 'boolean') return res.status(400).json({ error: 'auto musí být true/false.' });
  state.wbAuto = auto;
  // Přepnutí celého wallboxu je novější rozhodnutí než dřívější ruční režim — odklad padá
  state.wbManualUntil = 0;
  broadcast('wbAuto', wbSwitchPayload());
  addLog(`Wallbox: přepnuto na ${auto ? 'AUTO' : 'FAST'}`);
  res.json(wbSwitchPayload());
  state.wbLastTarget = null; // ruční přepnutí = vynuť okamžité nastavení
  runEnergyControl();
});

// „Ráno auto potřebuju" → v noci FAST, „nepotřebuju" → GREEN (jen z přebytku, rozjede se
// ráno se sluncem). Ruční přepnutí platí jen na nejbližší ráno, pak zase rozhoduje den
// v týdnu (pracovní den = potřebuju, víkend = ne).
app.post('/api/wallbox/morning', async (req, res) => {
  if (!requireAuth(req, res)) return;
  if (!wallboxEnabled) return res.status(500).json({ error: 'Wallbox není nakonfigurován.' });
  const { need } = req.body || {};
  if (typeof need !== 'boolean') return res.status(400).json({ error: 'need musí být true/false.' });
  const until = wbMorningTargetMs();
  state.wbMorning = { need, until };
  broadcast('wbAuto', wbSwitchPayload());
  addLog(`Wallbox: ráno auto ${need ? 'potřebuju → v noci se dobije naplno' : 'nepotřebuju → jen z přebytku'}`
    + ` (do ${fmtPragueTime(until)})`);
  res.json(wbSwitchPayload());
  state.wbLastTarget = null; // vynuť okamžité přepnutí režimu
  runEnergyControl();
});

// Obnova po deployi/uspání služby — telefon drží zálohu ručního přepnutí. Bereme jen to,
// co ještě platí (razítko v budoucnu), ať se večerní rozhodnutí neztratí.
app.post('/api/wallbox/morning/restore', (req, res) => {
  const b = req.body || {};
  const until = Number(b.until);
  if (typeof b.need === 'boolean' && Number.isFinite(until) && until > Date.now() && !wbMorningManual()) {
    state.wbMorning = { need: b.need, until };
    broadcast('wbAuto', wbSwitchPayload());
    state.wbLastTarget = null;
    runEnergyControl();
  }
  res.json(wbSwitchPayload());
});

if (wallboxEnabled) {
  // Nedělá dotazy na data, jen občas přepne režim wallboxu — 2 min stačí
  scheduleEvery(runEnergyControl, POLL_INTERVAL_MS, 50000); // offset 50 s
}

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
  if (!validTimerTime(time) || !['on', 'off'].includes(action)) return 'Neplatný čas nebo akce časovače.';
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
  await pccControl(dev.guid, parameters);
  if (parameters.operate !== undefined) dev.power = parameters.operate === 1;
  if (parameters.temperatureSet !== undefined) dev.targetTemp = parameters.temperatureSet;
  if (parameters.operationMode !== undefined) dev.mode = mode;
  if (parameters.ecoMode !== undefined) dev.eco = parameters.ecoMode;
  broadcast('aircon', { aircon: state.aircon });
  tempAutoDisableByHand(dev.name, 'pokyn asistentovi');
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
  state.wbLastTarget = null;
  broadcast('wallbox', { wallbox: state.wallbox });
  setWbManualHold();   // i pokyn asistentovi je ruční zásah
  addLog(`Wallbox: režim ${WB_MODE_LABELS[mode]} (asistent)`);
  setTimeout(pollWallbox, 3000);
  return `Wallbox: režim ${WB_MODE_LABELS[mode]}.`;
}

// Přepnutí wallboxu mezi automatikou (ECO/FAST dle slunce) a pevným FAST
function assistantSetWallboxAuto(auto) {
  if (!wallboxEnabled) return 'Wallbox není nastaven.';
  state.wbAuto = !!auto;
  state.wbManualUntil = 0;   // novější rozhodnutí ruší odklad ručního režimu
  broadcast('wbAuto', wbSwitchPayload());
  addLog(`Wallbox: přepnuto na ${state.wbAuto ? 'AUTO' : 'FAST'} (asistent)`);
  state.wbLastTarget = null; // vynuť okamžité nastavení režimu
  runEnergyControl();
  return `Wallbox: ${state.wbAuto ? 'automatika (ECO ve dne, FAST v noci)' : 'pevně FAST'}.`;
}

// Solinátor podle chloru: boost při nízkém, vypnutí na dny při vysokém
function assistantSetSolinator({ action, hours, days }) {
  const fmt = fmtPragueTime;
  if (action === 'boost') {
    const n = Math.round(Number(hours));
    const h = Number.isFinite(n) && n !== 0 ? Math.max(-8, Math.min(8, n)) : 2;
    const s = solinatorBoost(h);
    const ran = solinatorRanMs(), target = solinatorTargetMs();
    return `Solinátor má dnes odběhnout ${fmtDur(target)}, zatím ${fmtDur(ran)}.`
      + ` Zbývá ${fmtDur(Math.max(0, target - ran))}; co se do večera nevejde, přejde na další den.`;
  }
  if (action === 'disable') {
    const d = [1, 2].includes(Number(days)) ? Number(days) : 1;
    const s = solinatorDisable(d);
    // Dny se sčítají, takže hlásíme výsledný konec, ne zadaný počet
    return `Solinátor vypnutý do ${fmt(s.disabledUntil)}.`;
  }
  if (action === 'clear') {
    solinatorClear();
    return 'Solinátor: boost i vypnutí zrušeno, jede podle běžné automatiky.';
  }
  return 'U solinátoru neznám tuhle akci (boost / disable / clear).';
}

function assistantAddAirconTimer({ room, time, action, quiet }) {
  if (!validTimerTime(time) || !['on', 'off'].includes(action)) return 'Neplatný čas nebo akce časovače.';
  const dev = findAircon(room);
  const timer = { id: airconTimerSeq++, guid: dev ? dev.guid : room, name: dev ? dev.name : room, time, action, quiet: action === 'on' && !!quiet };
  airconTimers.push(timer);
  airconTimers.sort((a, b) => a.time.localeCompare(b.time));
  addLog(`Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}`);
  broadcast('airconTimers', { timers: airconTimers });
  return `Časovač: ${timer.name} ${action === 'on' ? 'zapnout' : 'vypnout'} v ${time}.`;
}

async function assistantAddBlindTimer({ target, time, action, orientation }) {
  if (!validTimerTime(time) || !['up', 'down'].includes(action)) return 'Neplatný čas nebo akce časovače.';
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
    name: 'set_wallbox_auto',
    description: 'Přepne nabíječku auta mezi automatikou a pevným rychlým nabíjením. auto=true → automatika (ECO ve dne z přebytku, FAST v noci), auto=false → pořád FAST.',
    input_schema: {
      type: 'object',
      properties: { auto: { type: 'boolean', description: 'true = automatika, false = pevně FAST.' } },
      required: ['auto']
    }
  },
  {
    name: 'set_solinator',
    description: 'Řídí solinátor bazénu podle naměřeného chloru. action "boost" = přidá hodiny navíc při NÍZKÉM chloru, se zápornými hodinami naopak ubere z dnešního plánu (relé se samo po hodině vypne, appka ho zapíná znovu). action "disable" = při VYSOKÉM chloru úplně zakáže spouštění na dny dopředu, aby chlor klesl. action "clear" = zruší boost i zákaz.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['boost', 'disable', 'clear'] },
        hours: { type: 'number', description: 'Jen pro boost: kolik hodin přidat (−8 až 8; záporné ubere).' },
        days: { type: 'number', enum: [1, 2], description: 'Jen pro disable: 1 nebo 2 dny (sčítá se, nejvýš tři dny dopředu).' }
      },
      required: ['action']
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
    case 'set_wallbox_auto': return assistantSetWallboxAuto(input.auto);
    case 'set_solinator': return assistantSetSolinator(input);
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
  const system = `Jsi hlasový asistent chytré domácnosti "SMG home". Uživatel mluví česky. `
    + `Aktuální čas je ${String(prague.hour).padStart(2, '0')}:${String(prague.minute).padStart(2, '0')}. `
    + `Podle jeho pokynu zavolej správné nástroje a proveď akci. Můžeš zavolat i více nástrojů najednou (např. "zhasni všechna světla"). `
    + `Zařízení: bojler, bazén (filtrace), solinátor, světla (zahrada dole, zahrada nahoře, světlo bazén, noční světla), `
    + `klimatizace v pokojích Obývák/Ložnice/Miky/Elenka, žaluzie v pokojích Obývák/Terasa/Garáž/Ložnice/Miky/Elenka/Hosté, wallbox (nabíječka auta). `
    + `DŮLEŽITÉ – dispozice: Kuchyň je otevřeně spojená s Obývákem. Klimatizace "Obývák" chladí i topí i v kuchyni — ať uživatel řekne kuchyň nebo obývák, jde o stejnou klimatizaci (target "Obývák"). `
    + `Žaluzie: v obýváku jsou dvě se štítky "Obývák Okno" a "Obývák Dveře", kuchyňská žaluzie má štítek "Kuchyň". Pro obývák použij target "Obývák" (ovládne obě obývákové), pro kuchyň target "Kuchyň" (jen kuchyňskou), pro jednu konkrétní použij přesný štítek, např. "Obývák Dveře". `
    + `PERGOLA: Na terase je pergola (lamelová/markýzová střecha) — ovládáš ji jako žaluzii přes control_blinds, target "pergola". action "up" = otevřít/vytáhnout, "down" = zavřít/zatáhnout. Pergola má i vlastní SVĚTLO: "rozsviť/zhasni pergolu" nebo "světlo u pergoly" → set_relay device "světlo terasa" (NE zahradní světla!). Rozliš: "zatáhni/otevři pergolu" = žaluzie (control_blinds), "rozsviť pergolu" = světlo (set_relay). `
    + `SVĚTLA VENKU: "rozsviť/zhasni zahradu" → set_relay device "zahrada" (obě zahradní světla nahoře i dole). "rozsviť/zhasni komplet venek" (celý venek) → set_relay device "komplet venek" (zahrada nahoře + dole + světlo bazén + pergola). Platí i pro zhasínání. `
    + `Umíš taky zamknout dům/vchodové dveře (lock_house). `
    + `SOLINÁTOR A CHLOR: Když uživatel řekne, že je v bazénu MÁLO chloru (nebo „pusť solinátor o hodinu/dvě víc"), zavolej set_solinator action "boost" s hours podle zadání. `
    + `„Ať dnes běží o hodinu míň" → stejný nástroj se zápornými hours (−1). `
    + `Když řekne, že je chloru MOC (nebo „vypni solinátor na den/dva"), zavolej set_solinator action "disable" s days 1 nebo 2. `
    + `„Zruš boost / ať jede solinátor normálně" → set_solinator action "clear". Když neurčí počet, zvol 2 hodiny resp. 1 den. `
    + `WALLBOX: „dej wallbox na automatiku" → set_wallbox_auto auto=true; „nabíjej pořád rychle / natvrdo fast" → set_wallbox_auto auto=false. `
    + `Konkrétní režim (stop/eco/fast/green) nastav přes set_wallbox. `
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
      hwPower: round1(store.HW_ACTUAL_POWER), // aktuální odběr bojleru 2 (kW)
      // FVE data z Infigy (na porovnání se Solaxem) — vše v kW / %
      pvPower: round1(store.PV_ACTUAL_POWER),            // výroba FVE
      batteryPower: round1(store.PV_ACTUAL_POWER_BATTERY), // tok baterie (záporné = nabíjení)
      homePower: round1(store.HOME_ACTUAL_POWER),        // spotřeba domu
      soc: round1(store.PV_ACTUAL_SOC),                  // nabití baterie (%)
      // Přetok Infigy pro tento systém neposílá (nemá elektroměr sítě) — nedopočítáváme ho,
      // dopočet z „PV + baterie − dům" byl zavádějící, když dům občas lagne na 0.
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
  // Infigy zůstává na 5 min — každý dotaz je login + portál + socket (trvá i 25 s)
  // a po přesunu diagramu na Solax z něj bereme jen bojler 2 (ten má mít 5 min)
  scheduleEvery(pollInfigy, 5 * 60 * 1000, 60000); // offset 60 s
}

// ---------- Historie teplot bojlerů (graf na stránce FVE) ----------
// Bojler 1 = nádrž tepelného čerpadla (Panasonic Aquarea), Bojler 2 = Infigy (HW_TEMP)
function recordBoilerTemps() {
  const aq = (state.aircon && state.aircon.aquarea || [])[0];
  const b1 = aq && typeof aq.tankTemp === 'number' ? aq.tankTemp : null;
  const b2 = state.infigy && typeof state.infigy.hwTemp === 'number' ? state.infigy.hwTemp : null;
  if (b1 === null && b2 === null) return; // ještě nemáme co ukládat
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  state.boilerHistory = state.boilerHistory.filter(p => p.t >= cutoff);
  const point = { t: Date.now(), b1, b2 };
  state.boilerHistory.push(point);
  broadcast('boilerHistory', { point });
}

// Vzorkujeme po 5 min — stejně jako se obnovují teploty samotné (Panasonic + Infigy),
// častější zápis by jen kopíroval tu samou hodnotu. Nedělá žádné dotazy, čte jen stav.
scheduleEvery(recordBoilerTemps, 5 * 60 * 1000, 100000); // offset 100 s

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

// ---------- Rozvrh dotazů ----------
// Kdyby všechny pollery měly setInterval spuštěný v čase 0, pálily by dotazy
// naráz každé dvě minuty. Každý proto startuje s vlastním offsetem, který si
// pak drží natrvalo — dotazy tak zůstanou rozprostřené a nepotkají se.
function scheduleEvery(fn, intervalMs, offsetMs) {
  setTimeout(() => { fn(); setInterval(fn, intervalMs); }, offsetMs);
}

pollSolax();                                             //   0 s — hned po startu
scheduleEvery(pollSolax, POLL_INTERVAL_MS, POLL_INTERVAL_MS);
scheduleEvery(pollShelly, POLL_INTERVAL_MS, 20000);      //  20 s (uvnitř má frontu 1 dotaz/s)

app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
});
