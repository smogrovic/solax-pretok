// Ověření: trvalé úložiště (Upstash). Balení dat, whitelist cest, přímé hodnoty
// a hlavně pojistka „bez načtení se neukládá" — ta chrání čtyři dny historie.
const zlib = require('zlib');
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('úložiště');

const CODE = between('// ---------- Trvalé úložiště', '// ---------- Keep-alive a start');

// Server si to bere z modulu; tady to nasypeme dovnitř jako parametry.
function build({ env = {}, state: st, kv = {} } = {}) {
  const puvodni = { ...process.env };
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'STORE_PREFIX']) delete process.env[k];
  Object.assign(process.env, env);

  const state = st || vzorovyStav();
  const pushSubscriptions = new Map();
  const volani = [];                 // co odešlo na „Upstash"
  const posty = [];                  // co se poslalo do vlastních /restore endpointů
  const timery = [];

  const fakeFetch = async (url, init = {}) => {
    if (String(url).includes('127.0.0.1')) {
      posty.push({ cesta: String(url).replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), telo: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    volani.push({ url: String(url), init });
    if (kv.chyba) throw new Error('síť');
    if (String(url).includes('/set/')) { kv.hodnota = init.body; return { ok: true, json: async () => ({ result: 'OK' }) }; }
    return { ok: true, json: async () => ({ result: kv.hodnota === undefined ? null : kv.hodnota }) };
  };

  const api = new Function(
    'state', 'zlib', 'fetch', 'pushSubscriptions', 'relayTimers', 'blindTimers',
    'airconTimers', 'fmtPragueTime', 'broadcast', 'console', 'setInterval', 'process', 'AbortController',
    CODE + `\n; return { storeEnabled, storeSnapshot, storeApplyPrimo, storeEncode, storeDecode,
      storeSave, storeLoad, storeStart, storeOtisk, storePayload, STORE_POSTS, STORE_KEY,
      nactenoFlag: () => storeLoaded };`
  )(state, zlib, fakeFetch, pushSubscriptions, [], [], [],
    () => '12:00', () => {}, { log() {}, error() {} },
    (fn, ms) => { timery.push({ fn, ms }); return 0; }, process, AbortController);

  process.env = puvodni;
  return { api, state, kv, volani, posty, pushSubscriptions, timery };
}

function vzorovyStav() {
  const t = Date.now() - 60000;
  return {
    autoMode: 'winter',
    tempAutoOn: 23, tempAutoOnRooms: { obyvak: 24 },
    tempAutoWinter: 21, tempAutoWinterRooms: { obyvak: 20 },
    saunaLimitW: 700, saunaHoldMin: 45,
    poolForce: { until: 0 },
    history: [{ t, kw: 1.2, soc: 80, pv: 3 }],
    wallboxHistory: [{ t, w: 3400 }],
    boilerHistory: [{ t, b1: 55, b2: 48 }],
    airconHistory: [{ t, temps: {}, sens: { obyvak: 23 } }],
    wbModeHistory: [{ t, mode: 'eco' }],
    log: [{ t, msg: 'něco' }],
    timeline: { shelly: [], pool: [{ from: t, to: t + 1000 }], solinator: [], wallbox: [], wbPlugged: [], sauna: [] },
    pvDays: [{ d: '2026-08-30', fcAm: 20, fcPm: 22, actual: 21 }],
    wbDays: [{ d: '2026-08-30', grid: 100, pv: 900 }],
    saunaDays: [{ d: '2026-08-30', wh: 8000, ms: 7200000 }],
    months: [{ m: '2026-08', sauna: 40000, pool: 12000, wb: 300000 }],
    solinator: { date: '2026-08-31', bonusMs: 3600000, boostMs: 0, carryMs: 0, disabledUntil: 0 },
    runtime: { date: '2026-08-31', ms: { shelly: 1, pool: 2, solinator: 3 }, wh: { feed: 4 }, yesterday: null },
    wbDayType: { manual: 'weekend', until: Date.now() + 3600000 },
    wbAuto: false,
    tempAuto: { obyvak: true, loznice: false, elenka: false, miky: false },
    manualHold: {},
    assistantLog: []
  };
}

const UPSTASH = { UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io/', UPSTASH_REDIS_REST_TOKEN: 'tok' };

nadpis('1) Zapnutí');
{
  check('bez proměnných je úložiště vypnuté', build().api.storeEnabled, false);
  check('se samotnou URL taky', build({ env: { UPSTASH_REDIS_REST_URL: 'https://x' } }).api.storeEnabled, false);
  check('s URL i tokenem se zapne', build({ env: UPSTASH }).api.storeEnabled, true);
  check('klíč má výchozí prefix', build({ env: UPSTASH }).api.STORE_KEY, 'solax:state');
  check('  a dá se přepsat',
    build({ env: { ...UPSTASH, STORE_PREFIX: 'chata' } }).api.STORE_KEY, 'chata:state');
}

nadpis('2) Balení');
{
  const h = build({ env: UPSTASH });
  const snap = h.api.storeSnapshot();
  const chybi = h.api.STORE_POSTS.filter(c => !(c in snap.posts));
  check('každá cesta ze seznamu má svoje tělo', chybi.join(',') || 'žádná', 'žádná');
  const navic = Object.keys(snap.posts).filter(c => !h.api.STORE_POSTS.includes(c));
  check('a nic navíc se neukládá', navic.join(',') || 'nic', 'nic');
  check('historie jde jako points', snap.posts['/api/history/restore'].points.length, 1);
  check('log jako entries', snap.posts['/api/log/restore'].entries.length, 1);
  check('runtime nese datum', snap.posts['/api/runtime/restore'].date, '2026-08-31');
  check('zimní režim se ukládá', snap.posts['/api/automation/restore'].mode, 'winter');
  check('meze sauny taky', snap.posts['/api/sauna/limits/restore'].holdMin, 45);
  check('časovače mají razítko', typeof snap.posts['/api/timers/restore'].savedAt, 'number');
  check('přepínač wallboxu jde mimo endpointy', snap.primo.wbAuto, false);
}
{
  const h = build({ env: UPSTASH });
  const txt = h.api.storeEncode(h.api.storeSnapshot());
  check('zabalené má značku formátu', txt.slice(0, 4), 'gz1:');
  const zpet = h.api.storeDecode(txt);
  check('a rozbalí se zpátky', zpet.posts['/api/months/restore'].months[0].sauna, 40000);
  check('gzip se vejde do zlomku původního', txt.length < JSON.stringify(h.api.storeSnapshot()).length, true);
  check('rozbité se tváří jako prázdno', h.api.storeDecode('gz1:xxx'), null);
  check('prázdný řetězec taky', h.api.storeDecode(''), null);
  check('a null taky', h.api.storeDecode(null), null);
  check('holé JSON bez značky projde', h.api.storeDecode('{"v":1}').v, 1);
  check('pole není platná záloha', h.api.storeDecode('[1,2]'), null);
}

nadpis('3) Ukládání');
{
  const h = build({ env: UPSTASH });
  (async () => {
    check('bez načtení se NEUKLÁDÁ', await h.api.storeSave(), false);
    check('  a nic neodešlo', h.volani.length, 0);
    await h.api.storeLoad(3000);
    check('načtení prázdného klíče projde', h.api.nactenoFlag(), true);
    check('teď už se uloží', await h.api.storeSave(), true);
    check('  a v úložišti něco je', typeof h.kv.hodnota, 'string');
    check('beze změny se podruhé neposílá', await h.api.storeSave(), false);
    check('  razítko časovačů se do porovnání nepočítá',
      h.api.storeOtisk(h.api.storeSnapshot()).includes('savedAt'), false);
    check('  ale ukládá se s ním', h.api.storeSnapshot().posts['/api/timers/restore'].savedAt > 0, true);
    h.state.months[0].sauna = 41000;
    check('po změně zase ano', await h.api.storeSave(), true);
  })();
}
{
  const h = build({ env: UPSTASH, kv: { chyba: true } });
  (async () => {
    await h.api.storeLoad(3000);
    check('když načtení selže, ukládání zůstane zamčené', h.api.nactenoFlag(), false);
    check('  a záloha se nepřepíše', await h.api.storeSave(), false);
  })();
}
{
  const h = build({});
  (async () => {
    check('vypnuté úložiště neukládá', await h.api.storeSave(), false);
    await h.api.storeLoad(3000);
    check('  ani nenačítá', h.volani.length, 0);
  })();
}

nadpis('4) Obnova');
{
  // Uložíme jeden stav a nalijeme ho do druhého, prázdného
  const zdroj = build({ env: UPSTASH });
  const kv = zdroj.kv;
  const cil = build({ env: UPSTASH, kv, state: prazdnyStav() });
  (async () => {
    await zdroj.api.storeLoad(3000);
    await zdroj.api.storeSave();
    await cil.api.storeLoad(3111);
    const cesty = cil.posty.map(p => p.cesta);
    check('obnoví se všechny série', cesty.length, cil.api.STORE_POSTS.length);
    check('režim automatiky jde první', cesty[0], '/api/automation/restore');
    check('typ dne wallboxu poslední', cesty[cesty.length - 1], '/api/wallbox/daytype/restore');
    check('runtime až po historii',
      cesty.indexOf('/api/runtime/restore') > cesty.indexOf('/api/history/restore'), true);
    const hist = cil.posty.find(p => p.cesta === '/api/history/restore');
    check('historie dorazila v celku', hist.telo.points.length, 1);
    check('  a se stejnými čísly', hist.telo.points[0].kw, 1.2);
    check('přímé hodnoty se přenesou', cil.state.wbAuto, false);
    check('  včetně přepínačů klimatizace', cil.state.tempAuto.obyvak, true);
  })();
}
{
  // Podvržená záloha nesmí serveru poslat POST kamkoli
  const kv = {};
  const zly = build({ env: UPSTASH, kv });
  (async () => {
    kv.hodnota = zly.api.storeEncode({
      posts: { '/api/pool/set': { on: true }, '/api/history/restore': { points: [] } }
    });
    await zly.api.storeLoad(3000);
    const cesty = zly.posty.map(p => p.cesta);
    check('cizí cesta se zahodí', cesty.includes('/api/pool/set'), false);
    check('  a povolená projde', cesty.includes('/api/history/restore'), true);
  })();
}

nadpis('5) Přímé hodnoty');
{
  const h = build({ env: UPSTASH, state: prazdnyStav() });
  const now = Date.now();
  h.api.storeApplyPrimo({
    wbAuto: false,
    tempAuto: { loznice: true, cizi: true },
    manualHold: { pool: now + 3600000, stary: now - 1000, daleky: now + 48 * 3600000 },
    assistantLog: [{ t: now - 1000, text: 'zapnuto' }, { t: now - 40 * 3600000, text: 'staré' }],
    push: [{ endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } },
           { endpoint: 'http://nezabezpecene/2', keys: {} },
           { endpoint: 'https://push.example/3' }]
  });
  check('přepínač wallboxu se převezme', h.state.wbAuto, false);
  check('přepínač pokoje taky', h.state.tempAuto.loznice, true);
  check('cizí pokoj se ignoruje', 'cizi' in h.state.tempAuto, false);
  check('platný ruční zásah se vrátí', h.state.manualHold.pool > now, true);
  check('  prošlý ne', 'stary' in h.state.manualHold, false);
  check('  a nesmyslně daleký taky ne', 'daleky' in h.state.manualHold, false);
  check('log asistenta se ořízne na 24 h', h.state.assistantLog.length, 1);
  check('push se vrátí jen přes https s klíči', h.pushSubscriptions.size, 1);
  check('  a je to ten správný', h.pushSubscriptions.has('https://push.example/1'), true);
}
{
  const h = build({ env: UPSTASH, state: prazdnyStav() });
  h.state.assistantLog = [{ t: Date.now(), text: 'živé' }];
  h.api.storeApplyPrimo({ assistantLog: [{ t: Date.now() - 1000, text: 'ze zálohy' }] });
  check('rozjetý log asistenta záloha nepřebije', h.state.assistantLog[0].text, 'živé');
  h.api.storeApplyPrimo(null);
  check('prázdná záloha nic nerozbije', h.state.wbAuto, true);
}

nadpis('6) Plánování');
{
  const h = build({ env: UPSTASH });
  h.api.storeStart();
  check('ukládá se po deseti minutách', h.timery[0] && h.timery[0].ms, 10 * 60 * 1000);
  const v = build({});
  v.api.storeStart();
  check('vypnuté úložiště žádný časovač nezakládá', v.timery.length, 0);
}

function prazdnyStav() {
  return {
    autoMode: 'on', tempAutoOn: 22, tempAutoOnRooms: { obyvak: 22 },
    tempAutoWinter: 21, tempAutoWinterRooms: { obyvak: 21 },
    saunaLimitW: 500, saunaHoldMin: 30, poolForce: { until: 0 },
    history: [], wallboxHistory: [], boilerHistory: [], airconHistory: [],
    wbModeHistory: [], log: [], timeline: {}, pvDays: [], wbDays: [], saunaDays: [],
    months: [], solinator: {}, runtime: { date: '', ms: {}, wh: {}, yesterday: null },
    wbDayType: { manual: null, until: 0 }, wbAuto: true,
    tempAuto: { obyvak: false, loznice: false, elenka: false, miky: false },
    manualHold: {}, assistantLog: []
  };
}

setTimeout(konec, 200);   // asynchronní bloky výš musí doběhnout
