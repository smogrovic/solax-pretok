const express = require('express');
const path = require('path');

const app = express();
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

const shellyCache = new Map();
const CACHE_TTL_MS = 5000; // 5s cache, ať se nezahlcuje Shelly cloud při rychlém refreshi

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/solax', async (req, res) => {
  if (!SOLAX_TOKEN_ID || !SOLAX_SN) {
    return res.status(500).json({ error: 'Server není nakonfigurován (chybí SOLAX_TOKEN_ID / SOLAX_SN).' });
  }

  try {
    const url = `${SOLAX_URL}?tokenId=${encodeURIComponent(SOLAX_TOKEN_ID)}&sn=${encodeURIComponent(SOLAX_SN)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      return res.status(502).json({ error: `Solax API HTTP ${response.status}` });
    }

    const data = await response.json();

    if (!data.success) {
      return res.status(502).json({ error: data.exception || 'Solax API vrátilo chybu.' });
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
    // (pokud baterie vybíjí, batPower je záporné, takže odečtení záporného číslo spotřebu zvýší - správně)
    const houseKw = Math.max(0, (dc1 + dc2 + dc3 + dc4 - batPower - (r.feedinpower || 0)) / 1000);
    const batterySoc = typeof r.soc === 'number' ? r.soc : null;

    res.json({
      fveKw,
      feedinKw,
      houseKw,
      batterySoc,
      batPowerKw: batPower / 1000,
      uploadTime: r.uploadTime,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'Solax API neodpovědělo včas.' : err.message;
    res.status(502).json({ error: message });
  }
});

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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    // Pokud máme starší cache, raději vrátíme ji než tvrdou chybu (typicky při rate limitu 429)
    if (cached) return cached.value;
    throw Object.assign(new Error(`Shelly API HTTP ${response.status}`), { status: 502 });
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

function registerStatusEndpoint(path, serverUri, deviceId) {
  app.get(path, async (req, res) => {
    try {
      const result = await fetchShellyStatus(serverUri, deviceId);
      res.json({ ...result, fetchedAt: new Date().toISOString() });
    } catch (err) {
      const status = err.status || 502;
      const message = err.name === 'TimeoutError' ? 'Shelly API neodpovědělo včas.' : err.message;
      res.status(status).json({ error: message });
    }
  });
}

registerStatusEndpoint('/api/shelly', SHELLY_SERVER_URI, SHELLY_DEVICE_ID);
registerStatusEndpoint('/api/pool', POOL_SERVER_URI, POOL_DEVICE_ID);
registerStatusEndpoint('/api/solinator', SOLINATOR_SERVER_URI, SOLINATOR_DEVICE_ID);

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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });

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

function registerSetEndpoint(path, serverUri, deviceId) {
  app.post(path, async (req, res) => {
    const { turn } = req.body || {};
    if (turn !== 'on' && turn !== 'off') {
      return res.status(400).json({ error: 'Parametr turn musí být "on" nebo "off".' });
    }
    try {
      await setShellyState(serverUri, deviceId, turn);
      res.json({ success: true, turn });
    } catch (err) {
      const status = err.status || 502;
      const message = err.name === 'TimeoutError' ? 'Shelly API neodpovědělo včas.' : err.message;
      res.status(status).json({ error: message });
    }
  });
}

registerSetEndpoint('/api/shelly/set', SHELLY_SERVER_URI, SHELLY_DEVICE_ID);
registerSetEndpoint('/api/pool/set', POOL_SERVER_URI, POOL_DEVICE_ID);
registerSetEndpoint('/api/solinator/set', SOLINATOR_SERVER_URI, SOLINATOR_DEVICE_ID);

app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
});
