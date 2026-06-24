const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const SOLAX_TOKEN_ID = process.env.SOLAX_TOKEN_ID;
const SOLAX_SN = process.env.SOLAX_SN;
const SOLAX_URL = 'https://global.solaxcloud.com/proxyApp/proxy/api/getRealtimeInfo.do';

app.use(express.static(path.join(__dirname, 'public')));

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

app.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}`);
});
