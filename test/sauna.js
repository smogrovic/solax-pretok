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
  + fn('function recordSaunaDay(w, dtH) {') + '\n'
  // Měření nahřívání visí na týchž hranách odběru, takže patří do téže sady
  + between('// ---------- Měření nahřívání sauny ----------',
            '// ---------- Připomínky ----------');

// K sauně patří i to, co na ni reaguje: vypínání relé a udržovací ON
const CODE2 = CODE + '\n'
  + fn('async function enforceSaunaOff() {') + '\n'
  + 'const RELAY_AUTO_OFF_MS = 15 * 60 * 1000;\n'
  + between('const KEEPALIVE_KEYS', 'async function sendKeepalive') + '\n'
  + fn('async function sendKeepalive() {');

function build({ prah = 500, drzeni = 30, pool = false, solinator = false,
                 venku = 8, huum = { temperature: 22, targetTemperature: 79 } } = {}) {
  let now = Date.UTC(2026, 6, 15, 14, 0, 0);
  const log = [], pushes = [], broadcasts = [], povely = [];
  const state = {
    sauna: { powerW: null, fetchedAt: null, since: 0, alertAt: 0, error: null },
    saunaLimitW: prah,
    saunaHoldMin: drzeni,
    saunaBlockUntil: 0,
    saunaDays: [],
    saunaNahrev: { bezici: null, zaznamy: [] },
    saunaZapnuto: { od: 0, naposledy: 0 },
    weather: { tempC: venku },
    huum: huum === null ? {} : huum,
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
          + ' SAUNA_ON_W, SAUNA_HOLD_MIN, SAUNA_ALERT_MS, SAUNA_ALERT_AGAIN_MS, SAUNA_DAYS_MAX, saunaEnabled,'
          + ' nahrevStart, nahrevVzorek, nahrevKonec, nahrevObnov, NAHREV_PRAHY, NAHREV_MAX,'
          + ' odhadNabehu, saunaOdhad, SAUNA_TERMOSTAT,'
          + ' NAHREV_BODU_MAX, NAHREV_STROP_MS, saunaZapnutoTopi, saunaZapnutoKontrola,'
          + ' saunaZapnutoObnov, SAUNA_ZAPNUTO_RESET_MS };'
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
  h.state.saunaLimitW = 1200;            // jiný práh za běhu
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

nadpis('Měření nahřívání');
{
  // Začátek se bere z odběru i ze stisku ON. Z odběru proto, že sauna jde pustit
  // i z appky HUUM nebo z panelu na kamnech — a odběr je fyzická pravda.
  const h = build({ venku: 8, huum: { temperature: 22, targetTemperature: 79 } });
  h.api.updateSauna(6000);
  const b = () => h.state.saunaNahrev.bezici;
  check('odběr nad prahem založí měření', !!b(), 'true');
  check('  s důvodem', b().duvod, 'odber');
  check('  s venkovní teplotou', b().venkuC, 8);
  check('  s teplotou v sauně', b().odC, 22);
  check('  a s cílem z kamen', b().cilC, 79);
  check('  teplota na startu je první bod', JSON.stringify(b().body), '[{"min":0,"c":22,"topi":true}]');

  // Vzorky chodí z dotazů na kamna, po dvou minutách
  h.posun(2); h.api.nahrevVzorek(31, h.now);
  h.posun(2); h.api.nahrevVzorek(45, h.now);
  check('vzorky se sbírají', b().body.length, 3);
  check('  s časem v minutách', b().body[2].min, 4);
  check('  a drží se nejvyšší teplota', b().maxC, 45);
  check('pod prahem se práh nezapíše', Object.keys(b().prahy).length, 0);

  h.posun(14); h.api.nahrevVzorek(61, h.now);
  check('nad 60 se práh zapíše', b().prahy[60].min, 18);
  check('  i se skutečnou teplotou', b().prahy[60].c, 61);
  // Práh se zapisuje při PRVNÍM vzorku nad hranicí — jinak by čas lezl nahoru
  // s každým dalším dotazem
  h.posun(2); h.api.nahrevVzorek(64, h.now);
  check('  a další vzorek s ním nehne', b().prahy[60].min, 18);

  // Dotazy chodí po dvou minutách, takže se dá práh přeskočit. Ze zapsané
  // teploty (c: 72 u prahu 70) je to poznat.
  h.posun(8); h.api.nahrevVzorek(72, h.now);
  check('přeskočený práh se zapíše taky', b().prahy[70].min, 28);
  check('  a je vidět, že se přeskočil', b().prahy[70].c, 72);

  h.posun(10); h.api.nahrevVzorek(79, h.now);
  check('cíl je práh navíc', b().prahy.cil && b().prahy.cil.min, 38);
  check('  a 80 se nezapsalo', b().prahy[80], 'undefined');
}
{
  // Stisk ON i odběr dorazí těsně po sobě — měření se nesmí založit dvakrát
  const h = build();
  h.api.nahrevStart('appka', h.now);
  const start = h.state.saunaNahrev.bezici.start;
  h.api.updateSauna(6000);
  check('appka a odběr nezaloží dvě měření', h.state.saunaNahrev.zaznamy.length, 0);
  check('  a drží se to první', h.state.saunaNahrev.bezici.start, start);
  check('  i s jeho důvodem', h.state.saunaNahrev.bezici.duvod, 'appka');
}
{
  // Konec je tam, kde končí `since` — tedy až doběhne okno po posledním nátopu
  const h = build({ drzeni: 30 });
  h.api.updateSauna(6000);
  h.posun(20); h.api.nahrevVzorek(65, h.now);
  h.api.updateSauna(50);
  check('pokles odběru měření hned neukončí', !!h.state.saunaNahrev.bezici, 'true');
  h.posun(31); h.api.updateSauna(50);
  check('po doběhnutí okna se zapíše', h.state.saunaNahrev.zaznamy.length, 1);
  check('  a běžící už není', h.state.saunaNahrev.bezici, 'null');
  const z = h.state.saunaNahrev.zaznamy[0];
  check('  má konec', typeof z.konec, 'number');
  check('  i prahy', z.prahy[60].c, 65);
  check('  a je to v logu', h.log.some(t => /nahřívání zapsáno/.test(t)), 'true');
}
{
  // Termostat u cílové teploty cykluje. Kdyby se měření zakládalo na každý
  // náběh odběru, byla by z jednoho použití sauny desítka falešných měření.
  const h = build({ drzeni: 30 });
  h.api.updateSauna(6000);
  h.posun(2); h.api.updateSauna(50);     // termostat vypnul
  h.posun(2); h.api.updateSauna(6000);   // a zase zapnul
  h.posun(2); h.api.updateSauna(50);
  h.posun(2); h.api.updateSauna(6000);
  check('cyklování termostatu nevyrobí další měření', h.state.saunaNahrev.zaznamy.length, 0);
  check('  pořád běží to jedno', !!h.state.saunaNahrev.bezici, 'true');
}
{
  // Krátké bliknutí odběru není nahřívání
  const h = build({ drzeni: 30, huum: {} });
  h.api.updateSauna(6000);
  h.posun(31); h.api.updateSauna(50);
  h.posun(31); h.api.updateSauna(50);
  check('bliknutí bez vzorků se nezapíše', h.state.saunaNahrev.zaznamy.length, 0);
}
{
  // Zapomenutá sauna by jinak sbírala vzorky do nekonečna
  const h = build();
  h.api.updateSauna(6000);
  h.posun(20); h.api.nahrevVzorek(65, h.now);
  h.posun(4 * 60 + 1); h.api.nahrevVzorek(70, h.now);
  check('po čtyřech hodinách se měření uzavře', h.state.saunaNahrev.zaznamy.length, 1);
  check('  a běžící končí', h.state.saunaNahrev.bezici, 'null');
  check('  pozdní vzorek se už nezapočítal',
    h.state.saunaNahrev.zaznamy[0].body.every(bd => bd.c < 70), 'true');
}
{
  const h = build();
  h.api.updateSauna(6000);
  for (let i = 0; i < h.api.NAHREV_BODU_MAX + 20; i++) {
    h.posun(1); h.api.nahrevVzorek(30 + i * 0.1, h.now);
  }
  check('vzorků se drží nejvýš strop',
    h.state.saunaNahrev.bezici.body.length, h.api.NAHREV_BODU_MAX);
}
{
  // Kamna můžou být nedostupná — měření se má založit i bez teplot
  const h = build({ venku: null, huum: {} });
  h.api.updateSauna(6000);
  const b = h.state.saunaNahrev.bezici;
  check('bez kamen se měření přesto založí', !!b, 'true');
  check('  teploty jsou prázdné, ne NaN', [b.venkuC, b.odC, b.cilC].join(','), ',,');
  check('  a křivka začíná prázdná', b.body.length, 0);
}
{
  // Starých měření se drží jen posledních pár — jinak by záloha rostla donekonečna
  const h = build({ drzeni: 1 });
  for (let i = 0; i < h.api.NAHREV_MAX + 5; i++) {
    h.api.updateSauna(6000);
    h.posun(1); h.api.nahrevVzorek(40 + i, h.now);
    h.posun(3); h.api.updateSauna(50);
  }
  check('drží se nejvýš čtyřicet měření',
    h.state.saunaNahrev.zaznamy.length, h.api.NAHREV_MAX);
  // Každé kolo má svou teplotu (40 + i), tak je poznat, která vypadla.
  // Nejstarších pět se mělo zahodit, takže první zbylé nese 45.
  check('  a vypadla ta nejstarší', h.state.saunaNahrev.zaznamy[0].body[1].c, 45);
  check('  poslední je ta nejnovější',
    h.state.saunaNahrev.zaznamy[h.api.NAHREV_MAX - 1].body[1].c, 40 + h.api.NAHREV_MAX + 4);
}
{
  // Po restartu uprostřed saunování (nasazení appky) server viděl odběr a založil
  // nové měření, jenže kamna už hřála na 72 °C. Takový záznam tvrdil „60 °C za
  // půl minuty“ — nezapisuje se.
  const h = build({ drzeni: 1, huum: { temperature: 72, targetTemperature: 76 } });
  h.api.updateSauna(6000);
  h.posun(2); h.api.nahrevVzorek(74, h.now);
  h.posun(3); h.api.updateSauna(50);
  check('teplý start se nezapíše', h.state.saunaNahrev.zaznamy.length, 0);
  check('  a v logu je proč', h.log.some(t => /zahozeno/.test(t)), 'true');
  // Studený start pořád ano (stejná délka, jen od 30 °C)
  const s = build({ drzeni: 1, huum: { temperature: 30, targetTemperature: 76 } });
  s.api.updateSauna(6000);
  s.posun(2); s.api.nahrevVzorek(34, s.now);
  s.posun(3); s.api.updateSauna(50);
  check('  studený ano', s.state.saunaNahrev.zaznamy.length, 1);
}

nadpis('Model náběhu');
{
  const h = build();
  const T = Date.UTC(2026, 8, 24, 16, 0, 0);
  const o = (v, s0, c) => h.api.odhadNabehu(v, s0, c, T);
  const blizko = (x, y) => x !== null && Math.abs(x - y) <= 1;
  check('venku 11,6, start 12, cíl 75 → ~59 min', blizko(o(11.6, 12, 75).minut, 59), 'true');
  check('venku −20, start −20, cíl 85 → ~105 min', blizko(o(-20, -20, 85).minut, 105), 'true');
  check('venku 0, start 0, cíl 85 → ~89 min', blizko(o(0, 0, 85).minut, 89), 'true');
  check('cíl 90 je nedosažitelný (termostat)', JSON.stringify(o(10, 20, 90)), '{"minut":null,"hotovoV":null,"dosazitelne":false}');
  check('cíl nad stropem taky, bez výjimky', o(-400, 20, 80).dosazitelne, 'false');
  check('cíl pod startem = hned', o(10, 70, 60).minut + ' ' + o(10, 70, 60).dosazitelne, '0 true');
  check('chybí venkovní teplota → null', o(null, 20, 80), 'null');
  check('chybí start → null', o(10, undefined, 80), 'null');
  check('hotovo v = teď + minuty, na minutu', o(11.6, 12, 75).hotovoV, T + Math.round(o(11.6, 12, 75).minut) * 60000);
  // Běžící topení: odhad na cíl z kamen, nebo na prahy, když cíl chybí
  const s = build({ venku: 10, huum: { temperature: 40, targetTemperature: 80, heating: true,
    fetchedAt: new Date(h.now).toISOString() } });
  const od = s.api.saunaOdhad(s.now);
  check('při topení odhad na cíl z kamen', od.cile.map(c => c.c).join(','), '80');
  check('  ze skutečné teploty v sauně', od.tStartC, 40);
  const bezCile = build({ venku: 10, huum: { temperature: 65, heating: true, fetchedAt: new Date(h.now).toISOString() } });
  check('bez cíle prahy 60/70/80/85, jen nedosažené',
    bezCile.api.saunaOdhad(bezCile.now).cile.map(c => c.c).join(','), '70,80,85');
  const netopi = build({ venku: 10, huum: { temperature: 20, heating: false, fetchedAt: new Date(h.now).toISOString() } });
  const n = netopi.api.saunaOdhad(netopi.now);
  check('když netopí, jen vstupy a model', n.cile.length + ' ' + n.tStartC + ' ' + n.venkuC + ' ' + n.model.tau, '0 20 10 57.7');
  const bezCidla = build({ venku: 10, huum: {} });
  check('bez teploty v sauně se bere venkovní', bezCidla.api.saunaOdhad(bezCidla.now).tStartC, 10);
}
{
  // Data pro přefitování: odC doplněné z prvního vzorku a u bodů, jestli topí
  const h = build({ huum: {} });
  h.api.updateSauna(6000);
  h.posun(2); h.api.nahrevVzorek(24, h.now);
  const b = h.state.saunaNahrev.bezici;
  check('chybějící odC se doplní z prvního vzorku', b.odC, 24);
  check('  bod nese, jestli kamna topí', b.body[0].topi, 'true');
  h.api.updateSauna(50);
  h.posun(2); h.api.nahrevVzorek(26, h.now);
  check('  i když netopí', b.body[1].topi, 'false');
}

nadpis('Měření nahřívání přežije nasazení');
{
  const h = build();
  const T = h.now;
  const zal = { start: T - 30 * 60000, duvod: 'appka', venkuC: 9, odC: 25, cilC: 80,
    prahy: { 60: { min: 24, c: 61 } }, body: [{ min: 0, c: 25 }, { min: 24, c: 61 }], maxC: 61 };
  const tepla = { start: T - 900000000, body: [{ min: 0.5, c: 72 }, { min: 2.5, c: 73 }], prahy: { 60: { min: 0.5, c: 72 } } };
  const studena = { start: T - 800000000, body: [{ min: 0, c: 20 }, { min: 30, c: 70 }], prahy: {} };
  check('obnova projde', h.api.nahrevObnov({ zaznamy: [tepla, studena], bezici: zal }, T), 'true');
  check('teplý záznam ze zálohy se vyřadí', h.state.saunaNahrev.zaznamy.length, 1);
  check('  studený zůstane', h.state.saunaNahrev.zaznamy[0].body[0].c, 20);
  check('rozběhnuté měření se vrátí', h.state.saunaNahrev.bezici && h.state.saunaNahrev.bezici.start, T - 30 * 60000);
  h.posun(2); h.api.nahrevVzorek(66, h.now);
  check('  a měří se dál od původního startu', h.state.saunaNahrev.bezici.body.slice(-1)[0].min, 32);
}
{
  // Server po startu uviděl odběr a založil vlastní měření dřív, než přišla záloha
  const h = build({ huum: { temperature: 64, targetTemperature: 80 } });
  const T = h.now;
  h.api.updateSauna(6000);
  h.posun(2); h.api.nahrevVzorek(71, h.now);
  const zal = { start: T - 30 * 60000, duvod: 'appka', venkuC: 9, odC: 25, cilC: 80,
    prahy: { 60: { min: 24, c: 61 } }, body: [{ min: 0, c: 25 }, { min: 24, c: 61 }], maxC: 61 };
  h.api.nahrevObnov({ zaznamy: [], bezici: zal }, h.now);
  const b = h.state.saunaNahrev.bezici;
  check('vyhraje dřívější měření ze zálohy', b.start, T - 30 * 60000);
  check('  s původní startovní teplotou', b.odC, 25);
  check('  vzorky nového se připojí s přepočtenými minutami', JSON.stringify(b.body.slice(-2)),
    '[{"min":30,"c":64},{"min":32,"c":71}]');
  check('  práh 60 zůstane z původního měření', b.prahy[60].min, 24);
  check('  práh 70 se doplní z nového', b.prahy[70].min, 32);
  check('  a maximum sedí', b.maxC, 71);
}
{
  const h = build();
  const stare = { start: h.now - 5 * 3600000, body: [{ min: 0, c: 25 }], prahy: {} };
  h.api.nahrevObnov({ zaznamy: [], bezici: stare }, h.now);
  check('měření starší než 4 h se neobnoví', h.state.saunaNahrev.bezici, 'null');
  check('bez zaznamy obnova neprojde', h.api.nahrevObnov({ bezici: stare }, h.now), 'false');
}

nadpis('Zapnuto v');
{
  const h = build({ drzeni: 30 });
  const z = () => h.state.saunaZapnuto;
  const start = h.now;
  h.api.updateSauna(6000);
  check('první topení zapíše čas', z().od, start);
  check('  a pošle se do appky', h.broadcasts.includes('saunaZapnuto'), 'true');

  // Termostat vypíná a zapíná, ale čas prvního zapnutí se nemění
  h.posun(10); h.api.updateSauna(50);
  h.posun(5);  h.api.updateSauna(6000);
  h.posun(20); h.api.updateSauna(50);
  h.posun(5);  h.api.updateSauna(6000);
  check('cyklování termostatu ho nepřepíše', z().od, start);
  const posledni = h.now;
  check('  ale poslední topení se posouvá', z().naposledy, posledni);

  // 3 h se počítají od POSLEDNÍHO topení, ne od prvního zapnutí
  h.posun(2 * 60 + 59); h.api.updateSauna(50);
  check('2 h 59 min po posledním topení ještě drží', z().od, start);
  h.posun(2); h.api.updateSauna(50);
  check('po 3 h zmizí', z().od, 0);
  check('  i s posledním topením', z().naposledy, 0);

  const znovu = h.now + 60000;
  h.posun(1); h.api.updateSauna(6000);
  check('další topení začne nové saunování', z().od, znovu);
}
{
  // Zapnutí z kamen i z měřáku se nezaloží dvakrát
  const h = build();
  const start = h.now;
  h.api.saunaZapnutoTopi(start);
  h.posun(2); h.api.updateSauna(6000);
  check('kamna a odběr nezaloží dvě saunování', h.state.saunaZapnuto.od, start);
}
{
  // Kontrola musí běžet i bez topení — jinak by ráno svítilo včerejší zapnutí
  const h = build();
  h.api.saunaZapnutoTopi(h.now);
  h.api.saunaZapnutoKontrola(h.now + h.api.SAUNA_ZAPNUTO_RESET_MS + 1);
  check('samotná kontrola po 3 h vynuluje', h.state.saunaZapnuto.od, 0);
}
{
  // Obnova po nasazení
  const h = build();
  const now = h.now;
  check('rozbité tělo se odmítne', h.api.saunaZapnutoObnov({}, now), false);
  h.api.saunaZapnutoObnov({ od: now - 5 * 3600000, naposledy: now - 4 * 3600000 }, now);
  check('vypršelé saunování se neobnoví', h.state.saunaZapnuto.od, 0);
  h.api.saunaZapnutoObnov({ od: now - 3600000, naposledy: now - 600000 }, now);
  check('běžící se obnoví', h.state.saunaZapnuto.od, now - 3600000);
  h.api.saunaZapnutoObnov({ od: now - 7200000, naposledy: now - 600000 }, now);
  check('  a když už server něco má, nepřepíše ho', h.state.saunaZapnuto.od, now - 3600000);
}

konec();
})().catch(err => {
  // Bez tohohle by výjimka sadu tiše ukončila: summary by se nevypsal, návratový
  // kód by byl nula a „0 chyb" by znamenalo „nic se nedoběhlo".
  check('sada doběhla bez výjimky', err && err.stack, '(nic)');
  konec();
});
