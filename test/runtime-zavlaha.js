// Ostrý běh celého řetězu závlahy: falešný modul ↔ most ↔ opravdový server.
//
// Mezi appkou a ventily jsou tři švy a každý mluví jinak: modul šifrovaným hexem,
// most JSONem, server frontou úkolů. Sady nad jednotlivými díly je ověřují každou
// zvlášť — a přesně tak vznikla díra u rozvrhu žaluzií: kód byl v pořádku, cesta
// do appky ne. Tady se tedy pouští skutečný server, skutečný most a jen modul je
// podstrčený (ten je v domácí síti a odsud na něj není vidět).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('závlaha naostro');

const Z = require('../public/nas/zavlaha-test.js');
const M = require('../public/nas/zavlaha-most.js');

const SERVER = path.join(__dirname, '..', 'server.js');
const PORT = 3895;          // server
const MODUL_PORT = 3894;    // podstrčený ovladač
const HESLO = 'heslo-jen-pro-test';

// Ovladač ESP-TM2 s osmi zónami, který zrovna nic nezalévá
const ODPOVEDI = {
  '02': '82000A0201',       // model a verze
  '0300': '8300FF000000',   // zóny 1–8
  '3F00': 'BF0000000000',   // neběží nic (mění se za běhu, viz běžíZóna)
  '48': 'C801',             // zavlažování zapnuté
  '3E': 'BE01',             // čidlo hlásí déšť
  '36': 'B6000000',         // žádný odklad
  '3900030A': '0139',       // pusť zónu 3 na 10 min → potvrzeno
  '40': '0140'              // zastav → potvrzeno
};

const pauza = ms => new Promise(ok => setTimeout(ok, ms));
let srv = null;
let modul = null;
const videno = [];

// Ať po sobě sada uklidí i tehdy, když spadne uprostřed
function uklid() {
  if (srv) { try { srv.kill(); } catch {} srv = null; }
  if (modul) { try { modul.close(); } catch {} modul = null; }
}
process.on('exit', uklid);

const spat = (cesta, metoda = 'GET', telo) => new Promise((ok, chyba) => {
  const data = telo === undefined ? null : JSON.stringify(telo);
  const req = http.request({
    host: '127.0.0.1', port: PORT, path: cesta, method: metoda,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
  }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ status: r.statusCode, body: b })); });
  req.on('error', chyba);
  req.end(data);
});

async function pockejNaServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await spat('/healthz')).status === 200) return true; } catch {}
    await pauza(250);
  }
  return false;
}

function snapshot() {
  return new Promise((ok, chyba) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/stream' }, r => {
      let b = '';
      r.on('data', d => {
        b += d;
        const kon = b.indexOf('\n\n');
        if (kon > 0) {
          req.destroy();
          const radek = b.slice(0, kon).split('\n').find(x => x.startsWith('data: '));
          ok(JSON.parse(radek.slice(6)));
        }
      });
    });
    req.on('error', chyba);
  });
}

// Modul mluví šifrovaně; kdyby most zabalil tělo jinak, tohle se nerozluští
// a sada spadne přesně tam, kde má.
function spustModul() {
  return new Promise(ok => {
    modul = http.createServer((req, res) => {
      const kusy = [];
      req.on('data', d => kusy.push(d));
      req.on('end', () => {
        let telo;
        try {
          telo = JSON.parse(Z.desifruj(Buffer.concat(kusy), HESLO));
        } catch (e) {
          res.writeHead(400).end();
          return;
        }
        videno.push(telo.params.data);
        const hex = ODPOVEDI[telo.params.data] || '000000';
        const out = Z.zasifruj(JSON.stringify({ id: telo.id, jsonrpc: '2.0', result: { data: hex } }), HESLO);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(out);
      });
    });
    modul.listen(MODUL_PORT, '127.0.0.1', ok);
  });
}

(async () => {
  await spustModul();
  srv = fork(SERVER, { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  if (!await pockejNaServer()) throw new Error('server nenaskočil');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zavlaha-naostro-'));
  const cfg = path.join(dir, 'zavlaha.config.json');
  fs.writeFileSync(cfg, JSON.stringify({
    ip: `127.0.0.1:${MODUL_PORT}`, heslo: HESLO, appka: `http://127.0.0.1:${PORT}`
  }));
  const nastaveni = M.nactiNastaveni(cfg).nastaveni;
  const pamet = { model: null, zony: [] };

  nadpis('1) Než se most ozve');
  const prvni = await snapshot();
  check('závlaha je ve snapshotu', !!prvni.zavlaha, true);
  const prazdno = prvni.zavlaha || {};
  check('appka o závlaze nic neví', prazdno.stav, null);
  check('a ví, že neví', prazdno.zive, false);
  // Bez mostu se nesmí dát nic spustit — povel by jen ležel ve frontě
  check('ovládání je zamčené', (await spat('/api/zavlaha/spust', 'POST', { zona: 1, minut: 5 })).status, 503);

  nadpis('2) Most se ozve');
  check('kolo doběhne', await M.kolo(nastaveni, pamet, () => {}), true);
  // Náhrada musí mít celý tvar, jinak by chybějící pole sadu utnulo bez verdiktu
  const po = (await snapshot()).zavlaha || { stav: { zony: [], bezi: [] }, nazvy: {} };
  check('ovladač dorazil do appky', po.stav.model, 'ESP-TM2');
  check('  a všech osm zón', po.stav.zony.join(','), '1,2,3,4,5,6,7,8');
  check('  a že nic neběží', po.stav.bezi.length, 0);
  check('  a déšť z čidla', po.stav.destak, true);
  check('most je naživu', po.zive, true);
  check('zóny mají jména', po.nazvy['1'], 'Trávník dole');

  nadpis('3) Povel z appky až k ventilu');
  const objednavka = await spat('/api/zavlaha/spust', 'POST', { zona: 3, minut: 10 });
  check('appka povel přijme', objednavka.status, 200);
  check('  a řekne to jménem zóny', JSON.parse(objednavka.body).message,
    'Trávník nahoře B: pouštím na 10 min.');
  check('povel čeká na most', ((await snapshot()).zavlaha || {}).ceka, 1);

  videno.length = 0;
  check('další kolo doběhne', await M.kolo(nastaveni, pamet, () => {}), true);
  // Tohle je ten nejdůležitější řádek celé sady: povel prošel appkou, frontou,
  // mostem, šifrováním — a k modulu dorazil jako správný hex
  check('k modulu dorazil správný povel', videno.includes('3900030A'), true);
  check('fronta je prázdná', ((await snapshot()).zavlaha || {}).ceka, 0);
  check('a stav se po povelu hlásí znovu', videno.filter(d => d === '3F00').length, 2);

  nadpis('4) Zastavení');
  check('appka zastavení přijme', (await spat('/api/zavlaha/stop', 'POST', {})).status, 200);
  videno.length = 0;
  await M.kolo(nastaveni, pamet, () => {});
  check('k modulu dorazilo zastavení', videno.includes('40'), true);

  nadpis('5) Přejmenování přežije do appky');
  check('přejmenování projde', (await spat('/api/zavlaha/nazvy', 'POST', { nazvy: { 8: 'Záhon u plotu' } })).status, 200);
  check('a je vidět v appce', (((await snapshot()).zavlaha || {}).nazvy || {})['8'], 'Záhon u plotu');

  nadpis('6) Schovaná zóna');
  // Osmá zóna není do ničeho zapojená, takže je schovaná rovnou
  check('osmička je schovaná', (((await snapshot()).zavlaha || {}).skryte || []).join(','), '8');
  check('a nejde pustit', (await spat('/api/zavlaha/spust', 'POST', { zona: 8, minut: 5 })).status, 400);
  check('vrácení projde', (await spat('/api/zavlaha/skryt', 'POST', { zona: 8, skryt: false })).status, 200);
  check('a v appce zmizí ze schovaných', (((await snapshot()).zavlaha || {}).skryte || []).length, 0);
  check('teď už jde pustit', (await spat('/api/zavlaha/spust', 'POST', { zona: 8, minut: 5 })).status, 200);
  await spat('/api/zavlaha/stop', 'POST', {});
  await M.kolo(nastaveni, pamet, () => {});

  nadpis('7) Naměřený čas doteče do appky');
  // Zóna 2 se rozeběhne a dvě kola po sobě ji most nahlásí jako běžící
  ODPOVEDI['3F00'] = 'BF0002000000';
  await M.kolo(nastaveni, pamet, () => {});
  await pauza(1200);
  await M.kolo(nastaveni, pamet, () => {});
  const dny = ((await snapshot()).zavlaha || {}).dny || [];
  check('vznikl dnešní záznam', dny.length, 1);
  const zona2 = dny.length ? (dny[0].zony || {})['2'] : 0;
  check('a zóna 2 má naměřeno přes vteřinu', zona2 >= 1000, true);
  // Ostatní zóny neběžely, takže nesmí mít nic
  check('ostatní zóny nic nemají', Object.keys(dny.length ? dny[0].zony : {}).join(','), '2');

  fs.rmSync(dir, { recursive: true, force: true });
  uklid();
  await pauza(200);
  konec();
})().catch(err => {
  uklid();
  console.error('závlaha naostro: ' + err.message);
  process.exit(1);
});
