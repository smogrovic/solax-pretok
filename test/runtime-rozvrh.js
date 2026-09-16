// Ostrý běh: nastartuje se doopravdy server a zkontroluje se, že předvyplněný
// rozvrh žaluzií opravdu dojede až do appky.
//
// Tohle vzniklo z konkrétní stížnosti: „nevidím tam ten rozvrh". Pravidla byla
// v kódu, sada je ověřovala, ale nikdo neověřoval CESTU — že jsou i ve snapshotu,
// kterým se appka po připojení plní. Kontrola nad vlastní funkcí by tu díru
// neviděla, protože snapshot se skládá o tři tisíce řádků jinde.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('rozvrh naostro');

const SERVER = path.join(__dirname, '..', 'server.js');
const PORT = 3897;

const spat = (cesta, metoda = 'GET') => new Promise((ok, chyba) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: cesta, method: metoda },
    r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ status: r.statusCode, body: b })); });
  req.on('error', chyba);
  req.end();
});

const pauza = ms => new Promise(ok => setTimeout(ok, ms));

async function pockejNaServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await spat('/healthz')).status === 200) return true; } catch {}
    await pauza(250);
  }
  return false;
}

// Snapshot chodí jen po SSE — přečteme první událost a spojení zavřeme
function snapshot() {
  return new Promise((ok, chyba) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/stream' }, r => {
      let b = '';
      r.on('data', d => {
        b += d;
        const konec = b.indexOf('\n\n');
        if (konec > 0) {
          req.destroy();
          const radek = b.slice(0, konec).split('\n').find(x => x.startsWith('data: '));
          try { ok(JSON.parse(radek.slice(6))); } catch (e) { chyba(e); }
        }
      });
    });
    req.on('error', () => {});
    setTimeout(() => { req.destroy(); chyba(new Error('snapshot nedorazil')); }, 5000);
  });
}

(async () => {
  const srv = fork(SERVER, [], {
    env: { ...process.env, PORT: String(PORT),
           SOLAX_TOKEN_ID: '', SHELLY_AUTH_KEY: '', OWM_API_KEY: '', PANASONIC_USER: '',
           UPSTASH_REDIS_REST_URL: '', TAHOMA_USER: '' },
    stdio: 'ignore'
  });
  const bezi = await pockejNaServer();
  check('server naběhl', bezi, true);

  nadpis('1) Rozvrh je vidět hned po startu');
  const cesta = JSON.parse((await spat('/api/blinds/schedule')).body);
  check('cesta vrátí sedm skupin', cesta.rules.length, 7);
  // Razítko nula je schválně: první záloha z telefonu (savedAt > 0) rozvrh přebije,
  // takže se vlastní úpravy nasazením neztratí
  check('  s razítkem nula', cesta.savedAt, 0);

  const snap = await snapshot();
  check('a jsou i ve snapshotu', (snap.blindRules || []).length, 7);
  check('  i s kroky', snap.blindRules[0].kroky.length, 2);
  check('  a s časem', snap.blindRules[0].kdy.cas, '06:40');
  check('zpoždění po západu je ve snapshotu taky', snap.zapadDelayMin, 20);
  check('prázdniny taky', typeof snap.prazdniny, 'object');
  check('  a zatím nejsou', snap.prazdniny.zitra, false);

  nadpis('2) Tlačítko „nahrát doporučený rozvrh"');
  // Ať se rozvrh dá vrátit bez ohledu na to, co ho vymazalo
  await spat('/api/blinds/schedule/default', 'POST');
  const po = JSON.parse((await spat('/api/blinds/schedule')).body);
  check('nahraje sedm skupin', po.rules.length, 7);
  // Bez razítka by je stará záloha z telefonu hned zase přepsala
  check('  a dá jim razítko', po.savedAt > 0, true);
  const snap2 = await snapshot();
  check('a v appce jsou taky', (snap2.blindRules || []).length, 7);
  // Pořadí je chronologické, ne podle toho, jak pravidla vznikla. Bez počasí
  // (server tu jede bez klíče k předpovědi) se u slunce sáhne po odhadu.
  check('  a v pořadí, jak se odehrají',
    snap2.blindRules.map(p => p.nazev).join(' → '),
    'Ráno pokoje → Dopoledne → Ráno → Pokoje → Po západu → Ložnice po západu → Garáž');

  srv.kill();
  await pauza(200);
  konec();
})().catch(err => {
  console.error('rozvrh naostro: ' + err.message);
  process.exit(1);
});
