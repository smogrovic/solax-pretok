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

    res.json({
      fveKw,
      feedinKw,
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
    throw Object.assign(new Error(`Shelly API HTTP ${response.status}`), { status: 502 });
  }

  const data = await response.json();

  if (!data.isok) {
    throw Object.assign(new Error('Shelly API vrátilo chybu.'), { status: 502 });
  }

  const status = data.data?.device_status;
  const online = data.data?.online;

  // Gen1 relé má klíč "relays": [{ ison: true/false }], Gen2+/Gen3 má "switch:0": { output: true/false }
  let isOn = null;
  if (status?.relays && Array.isArray(status.relays) && status.relays.length > 0) {
    isOn = status.relays[0].ison;
  } else if (status?.['switch:0']) {
    isOn = status['switch:0'].output;
  }

  return { online: !!online, isOn };
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

app.post('/api/shelly/set', async (req, res) => {
  if (!SHELLY_AUTH_KEY || !SHELLY_SERVER_URI || !SHELLY_DEVICE_ID) {
    return res.status(500).json({ error: 'Server není nakonfigurován (chybí SHELLY_AUTH_KEY / SHELLY_SERVER_URI / SHELLY_DEVICE_ID).' });
  }

  const { turn } = req.body || {};
  if (turn !== 'on' && turn !== 'off') {
    return res.status(400).json({ error: 'Parametr turn musí být "on" nebo "off".' });
  }

  try {
    const url = `https://${SHELLY_SERVER_URI}/device/relay/control`;
    const body = new URLSearchParams({
      id: SHELLY_DEVICE_ID,
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
      return res.status(502).json({ error: `Shelly API HTTP ${response.status}` });
    }

    const data = await response.json();

    if (!data.isok) {
      return res.status(502).json({ error: 'Shelly API odmítlo příkaz.' });
    }

    res.json({ success: true, turn });
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'Shelly API neodpovědělo včas.' : err.message;
    res.status(502).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
});
