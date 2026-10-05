// Závlaha, sekačka a vysavač mají v logu jeden řádek na den: další stavy se k němu
// připisují s časem. Obnova ze zálohy v telefonu ho nesmí zdvojit.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('log po dnech');

const CODE = [
  fn('function pragueTime(at) {'),
  fn('function pragueDateString(at) {'),
  fn('function addLog(msg, level, at, sk) {'),
  between('const LOG_DEN_SKUPINY', 'function addAssistantLog(text) {'),
  between("app.post('/api/log/restore'", '// Obnova dnešní doby běhu')
].join('\n');

function build() {
  const state = { log: [] };
  const zpravy = [];
  const routy = {};
  const api = new Function('state', 'broadcast', 'pruneHistory', 'app', 'logZastaraly',
    'LOG_MAX_AGE_MS', 'LOG_MAX_ENTRIES',
    CODE + '\n; return { addLog, addLogDen, LOG_DEN_MAX_ZNAKU };'
  )(state, (u, d) => zpravy.push({ u, d: JSON.parse(JSON.stringify(d)) }), () => {},
    { post: (c, f) => { routy[c] = f; } }, () => false, 7 * 86400000, 500);
  const obnov = entries => {
    let out = null;
    const res = { json: v => { out = v; return res; }, status: () => res };
    routy['/api/log/restore']({ body: { entries } }, res);
    return out;
  };
  return { state, zpravy, api, obnov };
}

// 2026-10-05 v Praze (CEST, UTC+2)
const H = (h, m = 0, den = 5) => Date.UTC(2026, 9, den, h - 2, m);

nadpis('1) Jeden řádek na den a zařízení');
{
  const { state, zpravy, api } = build();
  api.addLogDen('sekacka', 'Sekačka: seká', H(9, 2));
  api.addLogDen('sekacka', 'Sekačka: nabíjí', H(10, 40));
  api.addLogDen('sekacka', 'Sekačka: v doku', H(13, 10));
  check('tři stavy = jeden řádek', state.log.length, 1);
  check('  text nese časy', state.log[0].msg, 'Sekačka: 9:02 seká · 10:40 nabíjí · 13:10 v doku');
  check('  začátek zůstává', state.log[0].t, H(9, 2));
  check('  konec rozsahu se posouvá', state.log[0].tEnd, H(13, 10));
  check('  skupina je u řádku', state.log[0].sk, 'sekacka');
  check('první zpráva appce už nese skupinu', zpravy[0].u + ' ' + zpravy[0].d.entry.sk, 'log sekacka');
  check('další jdou jako přepis', zpravy.slice(1).map(z => z.u).join(','), 'logUpdate,logUpdate');

  api.addLogDen('zavlaha', 'Závlaha: běží Trávník', H(6));
  check('jiné zařízení má svůj řádek', state.log.length, 2);
  api.addLog('Sekačka: zaseklá', 'error', H(14));
  api.addLogDen('sekacka', 'Sekačka: seká', H(15));
  check('chyba je zvlášť a řádek dne pokračuje', state.log.length, 3);
  check('  pokračování', /15:00 seká$/.test(state.log.find(e => e.sk === 'sekacka').msg), true);

  api.addLogDen('sekacka', 'Sekačka: seká', H(9, 0, 6));
  check('nový den = nový řádek', state.log.filter(e => e.sk === 'sekacka').length, 2);
  check('  od začátku', state.log[state.log.length - 1].msg, 'Sekačka: 9:00 seká');
  // Hlášení se zpožděným časem (ze včerejška) se nesmí připsat k dnešnímu řádku
  const { state: s3, api: a3 } = build();
  a3.addLogDen('sekacka', 'Sekačka: seká', H(9, 0, 6));
  a3.addLogDen('sekacka', 'Sekačka: v doku', H(22, 0, 5));
  check('starší den se nepřipíše k novějšímu', s3.log.length, 2);
}

nadpis('2) Dlouhý den se ořízne zepředu');
{
  const { state, api } = build();
  for (let i = 0; i < 60; i++) api.addLogDen('vysavac', 'Vysavač: stav ' + i, H(8, i));
  const e = state.log[0];
  check('pořád jeden řádek', state.log.length, 1);
  check('nepřeteče limit', e.msg.length <= api.LOG_DEN_MAX_ZNAKU, true);
  check('nejnovější stav je na konci', /8:59 stav 59$/.test(e.msg), true);
  check('ořez je vidět', e.msg.startsWith('Vysavač: … · '), true);
  check('nejstarší vypadl', /8:00 stav 0 /.test(e.msg), false);
}

nadpis('3) Obnova ze zálohy řádek nezdvojí');
{
  const { state, api, obnov } = build();
  const ted = Date.now();
  api.addLogDen('zavlaha', 'Závlaha: běží Trávník', ted - 60000);
  api.addLogDen('zavlaha', 'Závlaha: doběhlo', ted - 1000);
  const t = state.log[0].t;
  // Telefon si pamatuje starší verzi téhož řádku
  obnov([{ t, msg: 'Závlaha: běží Trávník', sk: 'zavlaha' }]);
  check('starší verze se nepřidá', state.log.length, 1);
  check('  text zůstal novější', /doběhlo/.test(state.log[0].msg), true);

  const { state: s2, obnov: obnov2, api: api2 } = build();
  obnov2([{ t: ted - 5000, msg: 'Sekačka: 9:00 seká', sk: 'sekacka', tEnd: ted - 4000 }]);
  check('po restartu se skupina obnoví', s2.log[0].sk, 'sekacka');
  api2.addLogDen('sekacka', 'Sekačka: nabíjí', ted);
  check('  a řádek dne pokračuje', s2.log.length, 1);
  obnov2([{ t: ted - 5000, msg: 'X', sk: 'cizi' }]);
  check('neznámá skupina se nepřevezme', s2.log.some(e => e.sk === 'cizi'), false);
}

nadpis('4) Appka řádek pozná podle skupiny');
{
  const HTML = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
  check('logUpdate hledá podle sk', /d\.entry\.sk \? x\.sk === d\.entry\.sk : x\.msg === d\.entry\.msg/.test(HTML), true);
}

konec();
