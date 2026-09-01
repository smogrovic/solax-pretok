// Ověření: sauna sráží bazén a solinátor, drží je 30 min po dotopení, počítá denní
// spotřebu a po dvou hodinách topení upozorní.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('sauna');

const MIN = 60000, H = 60 * MIN;

// Kus serveru se saunou (konstanty bereme z hlavičky souboru)
const KONST = between('const SAUNA_DEVICE_ID', 'const SAUNA_DAYS_MAX = 7;') + '\nconst SAUNA_DAYS_MAX = 7;';
const CODE = KONST + '\n'
  + fn('function saunaLimitW() { return state.saunaLimitW; }').replace(/^.*$/m, m => m) + '\n'
  + 'function saunaHoldMs() { return state.saunaHoldMin * 60000; }\n'
  + fn('function saunaTopi() {') + '\n'
  + fn('function saunaBlokuje() {') + '\n'
  + fn('function saunaPayload() {') + '\n'
  + fn('function updateSauna(powerW) {') + '\n'
  + fn('function checkSaunaForgotten() {') + '\n'
  + fn('function recordSaunaDay(w, dtH) {');

// K sauně patří i to, co na ni reaguje: vypínání relé a udržovací ON
const CODE2 = CODE + '\n'
  + fn('async function enforceSaunaOff() {') + '\n'
  + 'const RELAY_AUTO_OFF_MS = 15 * 60 * 1000;\n'
  + between('const KEEPALIVE_KEYS', 'async function sendKeepalive') + '\n'
  + fn('async function sendKeepalive() {');

function build({ prah = 500, drzeni = 30, pool = false, solinator = false } = {}) {
  let now = Date.UTC(2026, 6, 15, 14, 0, 0);
  const log = [], pushes = [], broadcasts = [], povely = [];
  const state = {
    sauna: { powerW: null, fetchedAt: null, since: 0, alertAt: 0, error: null },
    saunaLimitW: prah,
    saunaHoldMin: drzeni,
    saunaBlockUntil: 0,
    saunaDays: [],
    devices: {
      pool: pool === null ? { online: true, isOn: null } : { online: true, isOn: pool },
      solinator: solinator === null ? { online: true, isOn: null } : { online: true, isOn: solinator },
      shelly: { online: true, isOn: true }
    }
  };
  const env = { SAUNA_DEVICE_ID: 'abc', SAUNA_ON_W: String(prah) };
  const api = new Function(
    'process', 'state', 'SHELLY_AUTH_KEY', 'SHELLY_SERVER_URI', 'cerstve', 'addLog',
    'sendPushToAll', 'broadcast', 'pragueDateString', 'fmtDur', 'autoSet', 'DEVICES',
    'setShellyState', 'Date',
    CODE2 + '\n; return { saunaTopi, saunaBlokuje, saunaPayload, updateSauna, recordSaunaDay,'
          + ' enforceSaunaOff, sendKeepalive, noteCmd, lastCmd, saunaLimitW, saunaHoldMs,'
          + ' SAUNA_ON_W, SAUNA_HOLD_MIN, SAUNA_ALERT_MS, SAUNA_ALERT_AGAIN_MS, SAUNA_DAYS_MAX, saunaEnabled };'
  )(
    { env }, state, 'key', 'shelly-x.cloud',
    ts => !!ts && now - new Date(ts).getTime() <= 10 * MIN,
    m => log.push(m),
    (t, b) => pushes.push(t + ' — ' + b),
    (ev, d) => broadcasts.push(ev),
    () => '2026-07-15',
    ms => `${Math.floor(ms / H)}:${String(Math.round((ms % H) / MIN)).padStart(2, '0')}`,
    async (key, turn, duvod, opts) => {
      povely.push({ key, turn, duvod, force: !!(opts && opts.force) });
      state.devices[key] = { ...state.devices[key], isOn: turn === 'on' };
      return true;
    },
    { pool: { serverUri: 'u', deviceId: 'p' }, solinator: { serverUri: 'u', deviceId: 's' },
      shelly: { serverUri: 'u', deviceId: 'b' } },
    async (uri, id, turn) => { povely.push({ key: 'keepalive_' + id, turn }); },
    class extends Date {
      constructor(...a) { super(...(a.length ? a : [now])); }
      static now() { return now; }
    }
  );
  return {
    api, state, log, pushes, broadcasts, povely,
    posun: min => { now += min * MIN; },
    get now() { return now; }
  };
}

(async () => {
nadpis('1) Práh a semafor');
{
  const h = build();
  check('výchozí práh je 500 W', h.api.SAUNA_ON_W, 500);
  check('výchozí okno po dotopení je 30 min', h.api.SAUNA_HOLD_MIN, 30);
  h.api.updateSauna(120);
  check('malý odběr saunu nezapne', h.api.saunaTopi(), 'false');
  check('  a nic neblokuje', h.api.saunaBlokuje(), 'false');
  h.api.updateSauna(6000);
  check('6 kW = topí', h.api.saunaTopi(), 'true');
  check('  a blokuje bazén se solinátorem', h.api.saunaBlokuje(), 'true');
  check('  do logu se to zapíše', /Sauna: topí .* bazén a solinátor jdou dolů/.test(h.log.join('|')), 'true');
  check('  appka se to dozví hned', h.broadcasts.includes('sauna'), 'true');
  h.api.updateSauna(500);
  check('přesně na prahu ještě netopí', h.api.saunaTopi(), 'false');
}
{
  const h = build({ prah: 2000 });
  h.api.updateSauna(1500);
  check('práh jde nastavit z prostředí', h.api.saunaTopi(), 'false');
  h.api.updateSauna(2500);
  check('  nad ním se topí', h.api.saunaTopi(), 'true');
}

nadpis('2) Po dotopení se drží ještě půl hodiny');
{
  const h = build();
  h.api.updateSauna(6000);
  h.posun(10); h.api.updateSauna(50);
  check('deset minut po poklesu pořád drží', h.api.saunaBlokuje(), 'true');
  check('  ale netopí', h.api.saunaTopi(), 'false');
  h.posun(19); h.api.updateSauna(50);
  check('po 29 min ještě drží', h.api.saunaBlokuje(), 'true');
  h.posun(2); h.api.updateSauna(50);
  check('po 31 min je konec', h.api.saunaBlokuje(), 'false');
  check('  a je o tom řádek v logu', /dotopeno/.test(h.log.join('|')), 'true');
  check('  topení se uzavřelo', h.state.sauna.since, 0);
}
{
  const h = build();
  h.api.updateSauna(6000);
  h.posun(15); h.api.updateSauna(80);    // termostat vypnul mezi nátopy
  h.posun(5); h.api.updateSauna(6000);   // a zase zatopil
  check('nátop mezi pauzami okno prodlouží', h.api.saunaBlokuje(), 'true');
  h.posun(25); h.api.updateSauna(0);
  check('  a počítá se od posledního nátopu', h.api.saunaBlokuje(), 'true');
  check('  topení pořád běží (jedno sezení)', h.state.sauna.since > 0, 'true');
}

nadpis('3) Hlídání zapomenuté sauny');
{
  const h = build();
  h.api.updateSauna(6000);
  h.posun(119); h.api.updateSauna(6000);
  check('po 1:59 se ještě mlčí', h.pushes.length, 0);
  h.posun(2); h.api.updateSauna(6000);
  check('po dvou hodinách přijde hláška', h.pushes.length, 1);
  check('  a je o saune', /Sauna pořád topí/.test(h.pushes[0]), 'true');
  h.posun(60); h.api.updateSauna(6000);
  check('za hodinu se neopakuje', h.pushes.length, 1);
  h.posun(301); h.api.updateSauna(6000);
  check('připomínka po šesti hodinách', h.pushes.length, 2);
  h.posun(31); h.api.updateSauna(0);
  check('po dotopení je klid', h.state.sauna.alertAt, 0);
  h.api.updateSauna(6000);
  h.posun(121); h.api.updateSauna(6000);
  check('další topení hlídá znovu od nuly', h.pushes.length, 3);
}

nadpis('4) Denní spotřeba');
{
  const h = build();
  h.api.recordSaunaDay(6000, 0.1);          // 6 kW po 6 min
  h.api.recordSaunaDay(6000, 0.1);
  const den = h.state.saunaDays[0];
  check('sčítá se kWh', Math.round(den.wh), 1200);
  check('  i doba topení (min)', Math.round(den.ms / MIN), 12);
  h.api.recordSaunaDay(100, 0.1);           // klidový odběr pod prahem
  check('klidový odběr se počítá do kWh', Math.round(h.state.saunaDays[0].wh), 1210);
  check('  ale ne do doby topení', Math.round(h.state.saunaDays[0].ms / MIN), 12);
  check('drží se sedm dní', h.api.SAUNA_DAYS_MAX, 7);
  for (let i = 0; i < 9; i++) h.state.saunaDays.push({ d: '2026-07-0' + i, wh: 1, ms: 1 });
  h.api.recordSaunaDay(1000, 0.1);
  check('  starší dny vypadnou', h.state.saunaDays.length, 7);
}

nadpis('5) Vypínání relé a udržovací ON');
{
  const h = build({ pool: true, solinator: true });
  h.api.updateSauna(6000);
  await h.api.enforceSaunaOff();
  const off = h.povely.filter(p => p.turn === 'off');
  check('bazén i solinátor dostanou OFF', off.map(p => p.key).join(','), 'pool,solinator');
  check('  a jde to natvrdo (přebije ruční zásah)', off.every(p => p.force), 'true');
  check('  s důvodem v logu', off[0].duvod, 'sauna topí');
}
{
  const h = build({ pool: null, solinator: false });   // stav bazénu neznámý
  h.api.updateSauna(6000);
  await h.api.enforceSaunaOff();
  check('neznámý stav se taky srazí', h.povely.some(p => p.key === 'pool' && p.turn === 'off'), 'true');
  check('  ale co je prokazatelně vypnuté, se neřeší', h.povely.some(p => p.key === 'solinator'), 'false');
}
{
  const h = build({ pool: true, solinator: true });
  h.api.updateSauna(20);                 // sauna netopí
  await h.api.sendKeepalive();
  const ka = h.povely.filter(p => p.key.startsWith('keepalive_'));
  check('bez sauny chodí udržovací ON normálně', ka.length >= 2, 'true');
}
{
  const h = build({ pool: true, solinator: true });
  h.state.devices.pool.isOn = true;      // appka si ještě myslí, že bazén běží
  h.state.devices.solinator.isOn = true;
  h.api.updateSauna(6000);               // skript je zrovna shodil, appka to neví
  h.povely.length = 0;
  await h.api.sendKeepalive();
  const ka = h.povely.filter(p => p.key.startsWith('keepalive_'));
  check('během sauny se udržovací ON neposílá', ka.map(p => p.key).join(','), 'keepalive_b');
  check('  (bojler ho dostane dál)', ka.length, 1);
}

nadpis('6) Nastavitelné meze');
{
  const h = build({ prah: 2500, drzeni: 45 });
  h.api.updateSauna(2000);
  check('pod nastaveným prahem netopí', h.api.saunaTopi(), 'false');
  h.api.updateSauna(3000);
  check('nad ním topí', h.api.saunaTopi(), 'true');
  h.posun(40); h.api.updateSauna(0);
  check('okno drží 45 min podle nastavení', h.api.saunaBlokuje(), 'true');
  h.posun(6); h.api.updateSauna(0);
  check('  a pak skončí', h.api.saunaBlokuje(), 'false');
  check('meze jdou do appky', `${h.api.saunaPayload().limitW}/${h.api.saunaPayload().holdMin}`, '2500/45');
}
{
  const h = build();
  h.state.saunaLimitW = 1200;            // přenastaveno za běhu z appky
  h.api.updateSauna(1000);
  check('změna prahu platí hned', h.api.saunaTopi(), 'false');
  h.api.recordSaunaDay(1000, 1);
  check('  a počítá se podle ní i doba topení', h.state.saunaDays[0].ms, 0);
}

nadpis('7) Když měřák mlčí');
{
  const h = build();
  h.api.updateSauna(6000);
  h.api.updateSauna(null);
  check('bez dat se netvrdí, že topí', h.api.saunaTopi(), 'false');
  check('  ale blokace z posledního nátopu doběhne', h.api.saunaBlokuje(), 'true');
  check('  a je o tom chyba ve stavu', /neodpověděl/.test(h.state.sauna.error), 'true');
  h.posun(31); h.api.updateSauna(null);
  check('po půl hodině se bazén může vrátit', h.api.saunaBlokuje(), 'false');
}

konec();
})();
