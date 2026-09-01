// Ověření: auto, které se v noci nedobilo, má přes den přednost před baterkou.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('wallbox — přednost auta');

const H = 3600000;
const CODE = between('const EC = {', 'let wbPrevStatus');

const pDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(t);
const pClock = t => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t);
  const get = x => Number(p.find(q => q.type === x).value);
  return { hour: get('hour') % 24, minute: get('minute') };
};
const DNES = pDate(Date.now());
function pragueAt(dateStr, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const base = Math.floor((Date.now() - 24 * H) / 1800000) * 1800000;
  for (let i = 0; i < 10 * 48; i++) {
    const t = base + i * 1800000;
    const c = pClock(t);
    if (pDate(t) === dateStr && c.hour === h && c.minute === m) return t;
  }
  throw new Error('nenalezeno ' + dateStr + ' ' + hhmm);
}
const dnes = hhmm => pragueAt(DNES, hhmm);

// stav: 0 nepřipojeno · 1 připraveno · 2 nabíjí · 3 dokončeno
function build({ nowAt = '09:00', pv = 0.5, stav = 1, auto = true, mode = 'on', soc = 60 } = {}) {
  let now = typeof nowAt === 'number' ? nowAt : dnes(nowAt);
  const logs = [];
  const state = {
    wbAuto: auto, wbMorning: { need: null, until: 0 }, autoMode: mode, wbManualUntil: 0,
    wallbox: { status: stav },
    infigy: { pvPower: pv, forecastPv: 20, fetchedAt: new Date(now).toISOString() },
    solax: { yieldToday: 5, batterySoc: soc, fveKw: pv, fetchedAt: new Date(now).toISOString() }
  };
  const weatherCache = { data: null };
  const setDay = den => {
    weatherCache.data = { sys: {
      sunrise: Math.floor(pragueAt(den, '05:00') / 1000),
      sunset: Math.floor(pragueAt(den, '20:30') / 1000)
    } };
  };
  setDay(pDate(now));
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  const api = new Function(
    'state', 'weatherCache', 'pragueTime', 'pragueDateString', 'addLog', 'formatKwLog', 'broadcast',
    'isWinter', 'wbSwitchPayload', 'BATTERY_KWH', 'CAR_MAX_KW', 'Date',
    CODE + '\n; return { ecWallboxTarget, wbUpdateEcoGate, wbUpdatePrio, wbPrioOn, wbUpdateBatFast,'
         + ' WB_PRIO_PV_KW, WB_PRIO_HITS, WB_PRIO_MIN_SOC, wbBatteryFastCheck };'
  )(
    state, weatherCache,
    at => pClock(at === undefined ? now : at),
    at => pDate(at === undefined ? now : at),
    m => logs.push(m),
    w => (w / 1000).toFixed(1).replace('.', ',') + ' kW',
    () => {},
    () => state.autoMode === 'winter',
    () => ({}),
    11.6, 3.4, FakeDate
  );
  const setPv = kw => {
    state.infigy = { ...state.infigy, pvPower: kw, fetchedAt: new Date(now).toISOString() };
  };
  const cyklus = () => { api.wbUpdateEcoGate(); api.wbUpdatePrio(); api.wbUpdateBatFast(); };
  return {
    api, state, logs, setPv, cyklus,
    dvakrat: () => { cyklus(); cyklus(); },
    setNow: t => { now = t; setDay(pDate(now)); },
    get now() { return now; }
  };
}

nadpis('1) Práh a rozjezd');
{
  const h = build();
  check('přednost se spouští od 3 kW', h.api.WB_PRIO_PV_KW, 3);
  check('  a chce dvě měření po sobě', h.api.WB_PRIO_HITS, 2);
  h.setPv(2.6); h.dvakrat();
  check('2,6 kW otevře jen ECO okno, ne přednost', h.api.ecWallboxTarget(), 'eco');
  h.setPv(3.1); h.cyklus();
  check('  první měření nad 3 kW ještě ne', h.api.ecWallboxTarget(), 'eco');
  h.cyklus();
  check('  druhé v řadě → FAST', h.api.ecWallboxTarget(), 'fast');
  check('  a je o tom řádek v logu', /auto má přednost \(FAST\), baterka až po něm/.test(h.logs.join('|')), 'true');
}
{
  const h = build({ pv: 3.1 });
  h.cyklus(); h.setPv(1); h.cyklus(); h.setPv(3.1); h.cyklus();
  // Ani ECO okno se neotevře — obě branky chtějí měření po sobě
  check('měření musí být po sobě (3,1 · 1 · 3,1)', h.api.ecWallboxTarget(), 'green');
}

nadpis('2) Komu přednost patří');
{
  const h = build({ pv: 4, stav: 3 });     // auto hlásí dokončeno
  h.dvakrat();
  check('dobité auto přednost nedostane', h.api.ecWallboxTarget(), 'eco');
  check('  a západka zůstává zavřená', h.api.wbPrioOn(), 'false');
}
{
  const h = build({ pv: 4, stav: 0 });     // nepřipojeno
  h.dvakrat();
  check('bez auta u nabíječky se nic nemění', h.api.ecWallboxTarget(), 'eco');
}
{
  const h = build({ pv: 4, stav: 2 });     // nabíjí se
  h.dvakrat();
  check('auto, které se nabíjí, přednost má', h.api.ecWallboxTarget(), 'fast');
  h.state.wallbox.status = 3;              // dobito
  h.cyklus();
  check('  jakmile je dobité, přednost končí', h.api.ecWallboxTarget(), 'eco');
  h.state.wallbox.status = 1;
  h.setPv(5); h.dvakrat();
  check('  a už se dnes nevrátí', h.api.ecWallboxTarget(), 'eco');
}

nadpis('3) Kdy přednost nezačíná');
{
  // Západ 20:30 → konec okna 19:30; 3:15 před tím je 16:15
  const h = build({ nowAt: '17:00', pv: 4, stav: 1 });
  h.dvakrat();
  check('pozdě odpoledne přednost nenaskočí', h.api.ecWallboxTarget() !== 'fast', 'true');
  const brzy = build({ nowAt: '15:30', pv: 4, stav: 1 });
  brzy.dvakrat();
  check('  ještě v 15:30 (víc než 3:15 do konce) ano', brzy.api.ecWallboxTarget(), 'fast');
}
{
  const h = build({ nowAt: '13:00', pv: 4, stav: 1 });
  h.dvakrat();
  check('odpoledne s dost času přednost jede', h.api.ecWallboxTarget(), 'fast');
  h.setNow(dnes('17:00'));
  h.setPv(4);
  h.cyklus();
  check('  a rozjetá přednost se pozdějc nepřeruší', h.api.wbPrioOn(), 'true');
}
{
  check('práh baterky je 20 %', build().api.WB_PRIO_MIN_SOC, 20);
  const h = build({ pv: 4, stav: 1, soc: 15 });
  h.dvakrat();
  check('s prázdnou baterkou přednost nezačne', h.api.ecWallboxTarget(), 'eco');
  const ok = build({ pv: 4, stav: 1, soc: 21 });
  ok.dvakrat();
  check('  nad 20 % ano', ok.api.ecWallboxTarget(), 'fast');
}
{
  const h = build({ pv: 4, stav: 1, soc: 60 });
  h.dvakrat();
  check('rozjetá přednost jede dál', h.api.ecWallboxTarget(), 'fast');
  h.state.solax = { ...h.state.solax, batterySoc: 12 };
  h.cyklus();
  check('  i když baterka mezitím spadla', h.api.ecWallboxTarget(), 'fast');
}

nadpis('4) Ráno, večer a ostatní režimy');
{
  const h = build({ nowAt: '05:30', pv: 4, stav: 1 });   // ještě noc (východ 5:00 → konec noci 6:00)
  h.dvakrat();
  check('v noci přednost nehraje (jede noční větev)', ['fast', 'green'].includes(h.api.ecWallboxTarget()), 'true');
}
{
  const h = build({ nowAt: '07:00', pv: 0.4, stav: 1 });
  h.dvakrat();
  check('ráno bez výroby se dál čeká v GREEN', h.api.ecWallboxTarget(), 'green');
  h.setPv(3.2); h.dvakrat();
  check('  jakmile FVE dá 3 kW, jde se na FAST', h.api.ecWallboxTarget(), 'fast');
}
{
  const h = build({ nowAt: '20:00', pv: 4, stav: 1 });   // po západu − 1 h
  h.dvakrat();
  check('večer má přednost večerní větev', h.api.ecWallboxTarget() !== 'eco', 'true');
}
{
  const z = build({ pv: 4, stav: 1, mode: 'winter' });
  z.dvakrat();
  check('v zimě jede FAST tak jako tak', z.api.ecWallboxTarget(), 'fast');
  const m = build({ pv: 4, stav: 1, auto: false });
  m.dvakrat();
  check('pevné FAST přebije všechno', m.api.ecWallboxTarget(), 'fast');
}
{
  const h = build({ pv: 4, stav: 1 });
  h.dvakrat();
  check('odpoledne FAST', h.api.ecWallboxTarget(), 'fast');
  h.setNow(dnes('09:00') + 24 * H);
  check('  přes půlnoc se západka nuluje', h.api.wbPrioOn(), 'false');
  h.setPv(4);            // data musí být čerstvá i v novém dni
  h.dvakrat();
  check('  a nový den se rozjede znovu', h.api.ecWallboxTarget(), 'fast');
}

konec();
