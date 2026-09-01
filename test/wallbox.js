// Ověření: režim wallboxu podle typu dne, hodin a hystereze na přebytku.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('wallbox');

const MIN = 60000, H = 3600000;
const CODE = between('// ---------- Řízení režimu wallboxu', 'let wbPrevStatus');

const pDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(t);
const pClock = t => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t);
  const get = x => Number(p.find(q => q.type === x).value);
  return { hour: get('hour') % 24, minute: get('minute') };
};
const WEEKDAY = ms => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'short' }).format(ms);
function pragueAt(dateStr, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const base = Math.floor((Date.now() - 24 * H) / (15 * MIN)) * 15 * MIN;
  for (let i = 0; i < 12 * 96; i++) {
    const t = base + i * 15 * MIN;
    const c = pClock(t);
    if (pDate(t) === dateStr && c.hour === h && c.minute === m) return t;
  }
  throw new Error('nenalezeno ' + dateStr + ' ' + hhmm);
}
function denVTydnu(short, hhmm) {
  for (let i = 0; i < 8; i++) {
    const t = Date.now() + i * 24 * H;
    if (WEEKDAY(t) === short) return pragueAt(pDate(t), hhmm);
  }
  throw new Error('den nenalezen: ' + short);
}
const vsedni = hhmm => denVTydnu('Wed', hhmm);
const vikend = hhmm => denVTydnu('Sat', hhmm);

// prebytek = přetok + baterie (kW), wb = odběr wallboxu (W)
function build({ nowAt = vsedni('12:00'), prebytek = 0, wb = 0, auto = true, mode = 'on',
                 stari = 0, rucne = null } = {}) {
  let now = nowAt;
  const logs = [];
  const state = {
    wbAuto: auto, autoMode: mode, wbManualUntil: 0,
    wbDayType: rucne || { manual: null, until: 0 },
    wallbox: { status: 2, power: wb, fetchedAt: new Date(now).toISOString() },
    infigy: {},
    solax: { feedinKw: prebytek, batPowerKw: 0, fetchedAt: new Date(now - stari).toISOString() }
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  const api = new Function(
    'state', 'weatherCache', 'pragueTime', 'pragueDateString', 'addLog', 'formatKwLog',
    'broadcast', 'isWinter', 'wbSwitchPayload', 'cerstve', 'wallboxWatts', 'Date',
    CODE + '\n; return { ecWallboxTarget, wbFaze, wbDayType, wbDayTypeManual, wbDayTypeUntil,'
         + ' wbUpdateHyst, wbHystReset, wbPrebytekW, wbCarReady, wbManualHeld, setWbManualHold,'
         + ' clearWbManualHold, get hyst() { return wbHyst; },'
         + ' WB_PLAN, WB_HYST_UP_KW, WB_HYST_DOWN_KW, WB_HYST_MS, WB_MANUAL_HOLD_MS };'
  )(
    state, { data: null },
    at => pClock(at === undefined ? now : at),
    at => pDate(at === undefined ? now : at),
    m => logs.push(m),
    w => (w / 1000).toFixed(1).replace('.', ',') + ' kW',
    () => {},
    () => state.autoMode === 'winter',
    () => ({}),
    ts => !!ts && now - new Date(ts).getTime() <= 10 * MIN,
    () => (state.wallbox && typeof state.wallbox.power === 'number' ? state.wallbox.power : null),
    FakeDate
  );
  return {
    api, state, logs,
    setNow: t => { now = t; },
    posun: min => { now += min * MIN; state.solax = { ...state.solax, fetchedAt: new Date(now).toISOString() }; },
    setPrebytek: kw => { state.solax = { ...state.solax, feedinKw: kw, fetchedAt: new Date(now).toISOString() }; },
    setWb: w => { state.wallbox = { ...state.wallbox, power: w }; },
    get now() { return now; }
  };
}
// odsimuluje `min` minut v hysterezi po dvou minutách (jako cyklus na serveru)
function jed(h, min) {
  for (let i = 0; i < min / 2; i++) { h.posun(2); h.api.wbUpdateHyst(); }
}

nadpis('1) Meze a plán dne');
{
  const h = build();
  check('pracovní den: GREEN do 4:00, FAST do 7:00',
    `${h.api.WB_PLAN.weekday.green}/${h.api.WB_PLAN.weekday.fast}`, '4/7');
  check('víkend: GREEN do 8:00, FAST do 10:00',
    `${h.api.WB_PLAN.weekend.green}/${h.api.WB_PLAN.weekend.fast}`, '8/10');
  check('práh nahoru 3,5 kW', h.api.WB_HYST_UP_KW, 3.5);
  check('práh dolů 2,5 kW', h.api.WB_HYST_DOWN_KW, 2.5);
  check('a musí vydržet 10 min', h.api.WB_HYST_MS / MIN, 10);
}

nadpis('2) Pracovní den');
{
  check('0:30 → GREEN', build({ nowAt: vsedni('00:30') }).api.ecWallboxTarget(), 'green');
  check('3:45 → GREEN', build({ nowAt: vsedni('03:45') }).api.ecWallboxTarget(), 'green');
  check('4:00 → FAST', build({ nowAt: vsedni('04:00') }).api.ecWallboxTarget(), 'fast');
  check('6:45 → FAST', build({ nowAt: vsedni('06:45') }).api.ecWallboxTarget(), 'fast');
  check('7:00 → hystereze (vstupuje se z FASTu)', build({ nowAt: vsedni('07:00') }).api.wbFaze(), 'hyst');
  check('  a jede FAST', build({ nowAt: vsedni('07:00') }).api.ecWallboxTarget(), 'fast');
}

nadpis('3) Víkend');
{
  check('sobota 7:45 → GREEN', build({ nowAt: vikend('07:45') }).api.ecWallboxTarget(), 'green');
  check('sobota 8:00 → FAST', build({ nowAt: vikend('08:00') }).api.ecWallboxTarget(), 'fast');
  check('sobota 9:45 → FAST', build({ nowAt: vikend('09:45') }).api.ecWallboxTarget(), 'fast');
  check('sobota 10:00 → hystereze', build({ nowAt: vikend('10:00') }).api.wbFaze(), 'hyst');
  check('v sobotu ve 4:00 se NEnabíjí naplno', build({ nowAt: vikend('04:00') }).api.ecWallboxTarget(), 'green');
}

nadpis('4) Hystereze dolů (FAST → ECO)');
{
  const h = build({ nowAt: vsedni('12:00'), prebytek: 2.0 });
  check('začíná se na FASTu', h.api.ecWallboxTarget(), 'fast');
  jed(h, 8);
  check('po 8 min pod prahem ještě FAST', h.api.ecWallboxTarget(), 'fast');
  jed(h, 4);
  check('po 12 min už ECO', h.api.ecWallboxTarget(), 'eco');
  check('  a je o tom řádek v logu', /přes 10 min → ECO/.test(h.logs.join('|')), 'true');
}
{
  const h = build({ nowAt: vsedni('12:00'), prebytek: 2.0 });
  jed(h, 6);
  h.setPrebytek(3.0);      // mrak přešel, jsme v pásmu 2,5–3,5
  jed(h, 10);
  check('pásmo 2,5–3,5 kW odpočet ruší', h.api.ecWallboxTarget(), 'fast');
}

nadpis('5) Hystereze nahoru (ECO → FAST)');
{
  const h = build({ nowAt: vsedni('12:00'), prebytek: 2.0 });
  jed(h, 12);
  check('nejdřív spadneme na ECO', h.api.ecWallboxTarget(), 'eco');
  h.setPrebytek(3.6);
  jed(h, 8);
  check('po 8 min nad prahem ještě ECO', h.api.ecWallboxTarget(), 'eco');
  jed(h, 4);
  check('po 12 min FAST', h.api.ecWallboxTarget(), 'fast');
  check('  a je o tom řádek v logu', /přes 10 min → FAST/.test(h.logs.join('|')), 'true');
}

nadpis('6) Přebytek se počítá PŘED autem');
{
  const h = build({ nowAt: vsedni('12:00'), prebytek: 0.5, wb: 3400 });
  check('přetok 0,5 kW + auto 3,4 kW = 3,9 kW', h.api.wbPrebytekW(), 3900);
  jed(h, 12);
  check('  takže FAST zůstává (auto si svůj přebytek nesežere)', h.api.ecWallboxTarget(), 'fast');
  h.setWb(0);
  h.setPrebytek(0.5);
  jed(h, 12);
  check('bez auta a s 0,5 kW se spadne na ECO', h.api.ecWallboxTarget(), 'eco');
}
{
  const h = build({ nowAt: vsedni('12:00'), prebytek: 1.0, stari: 20 * MIN });
  check('stará data ze střídače = neznámý přebytek', h.api.wbPrebytekW(), 'null');
  for (let i = 0; i < 10; i++) { h.state.solax = { ...h.state.solax, fetchedAt: new Date(h.now - 20 * MIN).toISOString() }; h.api.wbUpdateHyst(); h.setNow(h.now + 2 * MIN); }
  check('  a režim se nemění', h.api.ecWallboxTarget(), 'fast');
}

nadpis('7) Typ dne a ruční přepnutí');
{
  check('ve všední den je pracovní', build({ nowAt: vsedni('12:00') }).api.wbDayType(), 'weekday');
  check('v sobotu víkend', build({ nowAt: vikend('12:00') }).api.wbDayType(), 'weekend');
  const h = build({ nowAt: vsedni('20:00') });
  const until = h.api.wbDayTypeUntil();
  check('ruční volba platí do zítřejších 12:00', pClock(until).hour, 12);
  check('  a je to zítřek', pDate(until) !== pDate(h.now), 'true');
}
{
  const rucne = { manual: 'weekend', until: vsedni('20:00') + 16 * H };
  const h = build({ nowAt: vsedni('20:00'), rucne });
  check('ruční víkend přebije kalendář', h.api.wbDayType(), 'weekend');
  h.setNow(vsedni('20:00') + 8 * H);            // druhý den ve 4:00
  check('  a platí i další den ráno (GREEN místo FASTu)', h.api.ecWallboxTarget(), 'green');
  h.setNow(vsedni('20:00') + 17 * H);           // druhý den ve 13:00, po vypršení
  check('  po zítřejší 12:00 zase rozhoduje kalendář', h.api.wbDayTypeManual(), 'false');
}

nadpis('8) Zima, pevné FAST, ruční režim');
{
  check('v zimě pořád FAST', build({ nowAt: vsedni('01:00'), mode: 'winter' }).api.ecWallboxTarget(), 'fast');
  check('pevné FAST přebije všechno', build({ nowAt: vsedni('01:00'), auto: false }).api.ecWallboxTarget(), 'fast');
  const h = build({ nowAt: vsedni('12:00') });
  h.api.setWbManualHold();
  check('ruční režim drží 3 h', h.api.WB_MANUAL_HOLD_MS / H, 3);
  check('  a je aktivní', h.api.wbManualHeld(), 'true');
  h.setNow(vsedni('12:00') + 3 * H + MIN);
  check('  po třech hodinách padá', h.api.wbManualHeld(), 'false');
}

konec();
