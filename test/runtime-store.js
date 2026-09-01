// Ostrý běh: server uloží data do (falešného) Upstash, spadne jako při nasazení
// a po startu si je sám natáhne zpátky. Tohle je celý smysl úložiště — kdyby
// selhalo tohle, historie po deployi zase zmizí.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('úložiště naostro');

const SERVER = path.join(__dirname, '..', 'server.js');
const tmp = path.join(__dirname, '..', 'server_store_tmp.js');
fs.writeFileSync(tmp, fs.readFileSync(SERVER, 'utf8')
  .replace('const STORE_SAVE_MS = 10 * 60 * 1000;', 'const STORE_SAVE_MS = 800;'));

const KV = {};                     // falešný Upstash: jeden klíč, jako doopravdy
let setu = 0;
const upstash = http.createServer((req, res) => {
  let telo = '';
  req.on('data', d => { telo += d; });
  req.on('end', () => {
    const klic = decodeURIComponent(req.url.split('/').pop());
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/set/')) { KV[klic] = telo; setu++; res.end(JSON.stringify({ result: 'OK' })); }
    else res.end(JSON.stringify({ result: KV[klic] === undefined ? null : KV[klic] }));
  });
});

const ENV = {
  ...process.env,
  UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:3994',
  UPSTASH_REDIS_REST_TOKEN: 'tok',
  SOLAX_TOKEN_ID: '', SHELLY_AUTH_KEY: '', OWM_API_KEY: '', PANASONIC_USER: ''
};

const spat = (port, cesta, telo) => new Promise((ok, chyba) => {
  const data = telo === undefined ? null : JSON.stringify(telo);
  const req = http.request({ host: '127.0.0.1', port, path: cesta, method: data ? 'POST' : 'GET',
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
    r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ status: r.statusCode, body: b })); });
  req.on('error', chyba);
  if (data) req.write(data);
  req.end();
});

const pauza = ms => new Promise(ok => setTimeout(ok, ms));

async function pockejNaServer(port) {
  for (let i = 0; i < 60; i++) {
    try { if ((await spat(port, '/healthz')).status === 200) return true; } catch {}
    await pauza(250);
  }
  return false;
}

// Snapshot chodí jen po SSE — přečteme první událost a spojení zavřeme
function snapshot(port) {
  return new Promise((ok, chyba) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/stream' }, r => {
      let b = '';
      r.on('data', d => {
        b += d;
        const konecUdalosti = b.indexOf('\n\n');
        if (konecUdalosti > 0) {
          req.destroy();
          const radek = b.slice(0, konecUdalosti).split('\n').find(x => x.startsWith('data: '));
          try { ok(JSON.parse(radek.slice(6))); } catch (e) { chyba(e); }
        }
      });
    });
    req.on('error', () => {});
    setTimeout(() => { req.destroy(); chyba(new Error('snapshot nedorazil')); }, 5000);
  });
}

const uklid = () => { try { fs.unlinkSync(tmp); } catch {} };

(async () => {
  await new Promise(ok => upstash.listen(3994, ok));
  const T = Date.now() - 3 * 3600000;   // tři hodiny zpátky, ať to projde kontrolou stáří
  let a = null, b = null;
  try {
    nadpis('1) První běh: nastřádat a uložit');
    a = fork(tmp, { env: { ...ENV, PORT: '3995' }, stdio: 'ignore' });
    check('server naběhl', await pockejNaServer(3995), true);

    await spat(3995, '/api/history/restore', { points: [
      { t: T, kw: 2.5, soc: 70, pv: 4 }, { t: T + 600000, kw: 1.5, soc: 75, pv: 3 }] });
    await spat(3995, '/api/months/restore', { months: [{ m: '2026-07', sauna: 40000, pool: 12000, wb: 300000 }] });
    await spat(3995, '/api/sauna-days/restore', { saunaDays: [{ d: '2026-08-30', wh: 8000, ms: 7200000 }] });
    await spat(3995, '/api/log/restore', { entries: [{ t: T, msg: 'zkušební řádek' }] });
    await spat(3995, '/api/tempauto', { key: 'loznice', enabled: true });

    const prvni = await snapshot(3995);
    check('data jsou v prvním serveru', prvni.history.length, 2);
    check('  i měsíce', prvni.months.length, 1);
    check('  i přepínač klimatizace', prvni.tempAuto.loznice, true);

    for (let i = 0; i < 40 && !setu; i++) await pauza(100);
    check('záloha odešla do úložiště', setu > 0, true);
    check('  a klíč sedí', Object.keys(KV)[0], 'solax:state');
    check('  uloženo zabalené', String(KV['solax:state']).slice(0, 4), 'gz1:');

    nadpis('2) Nasazení: SIGTERM ještě jednou uloží');
    await spat(3995, '/api/pvdays/restore', { pvDays: [{ d: '2026-08-30', fcAm: 20, fcPm: 22, actual: 21 }] });
    const predVypnutim = setu;
    a.kill('SIGTERM');
    await new Promise(ok => a.on('exit', ok));
    a = null;
    check('při vypínání se uložilo znovu', setu > predVypnutim, true);

    nadpis('3) Druhý běh: všechno zpátky');
    b = fork(tmp, { env: { ...ENV, PORT: '3997' }, stdio: 'ignore' });
    check('nový server naběhl', await pockejNaServer(3997), true);
    await pauza(600);   // obnova běží hned po listen, tohle je jen rezerva

    const s = await snapshot(3997);
    check('historie přežila', s.history.length, 2);
    check('  se stejnými hodnotami', s.history.map(p => p.kw).join('/'), '2.5/1.5');
    check('měsíce přežily', s.months[0] && s.months[0].sauna, 40000);
    check('dny sauny přežily', s.saunaDays[0] && s.saunaDays[0].wh, 8000);
    check('výroba po dnech přežila', s.pvDays[0] && s.pvDays[0].actual, 21);
    check('log přežil', s.log.some(e => e.msg === 'zkušební řádek'), true);
    check('přepínač klimatizace přežil', s.tempAuto.loznice, true);
    check('nezaložil se prázdný stav', s.history.length > 0 && s.months.length > 0, true);
  } finally {
    if (a) a.kill('SIGKILL');
    if (b) b.kill('SIGKILL');
    upstash.close();
    uklid();
  }
  konec();
})().catch(err => { console.error(err); uklid(); process.exit(1); });
