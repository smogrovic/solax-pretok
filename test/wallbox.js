// Ověření: režim wallboxu podle tří fází dne (ráno / den / noc), zimy a ručního přepnutí.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('wallbox');

const H = 3600000;
const CODE = between('// ---------- Řízení režimu wallboxu', 'let wbPrevStatus');

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
  for (let i = 0; i < 12 * 48; i++) {
    const t = base + i * 1800000;
    const c = pClock(t);
    if (pDate(t) === dateStr && c.hour === h && c.minute === m) return t;
  }
  throw new Error('nenalezeno ' + dateStr + ' ' + hhmm);
}
const dnes = hhmm => pragueAt(DNES, hhmm);
const WEEKDAY = ms => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'short' }).format(ms);
function denVTydnu(short, hhmm) {
  for (let i = 0; i < 8; i++) {
    const t = Date.now() + i * 24 * H;
    if (WEEKDAY(t) === short) return pragueAt(pDate(t), hhmm);
  }
  throw new Error('den nenalezen: ' + short);
}

// odhad/vyrobeno → „zbývá vyrobit"; pv = aktuální výkon FVE
function build({ nowAt = '08:00', pv = 0.5, odhad = 20, vyrobeno = 5, auto = true, mode = 'on',
                 pocasi = true, rucne = null, stav = 1 } = {}) {
  let now = typeof nowAt === 'number' ? nowAt : dnes(nowAt);
  const logs = [];
  const state = {
    wbAuto: auto, wbMorning: rucne || { need: null, until: 0 }, autoMode: mode, wbManualUntil: 0,
    wallbox: { status: stav },
    infigy: { pvPower: pv, forecastPv: odhad, fetchedAt: new Date(now).toISOString() },
    solax: { yieldToday: vyrobeno, fveKw: pv, fetchedAt: new Date(now).toISOString() }
  };
  const weatherCache = { data: null };
  const setDay = den => {
    weatherCache.data = pocasi
      ? { sys: { sunrise: Math.floor(pragueAt(den, '05:00') / 1000), sunset: Math.floor(pragueAt(den, '20:30') / 1000) } }
      : null;
  };
  setDay(pDate(now));
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  const api = new Function(
    'state', 'weatherCache', 'pragueTime', 'pragueDateString', 'addLog', 'formatKwLog',
    'broadcast', 'isWinter', 'wbSwitchPayload', 'Date',
    CODE + '\n; return { ecWallboxTarget, wbFaze, wbRanoSkoncilo, wbMorningNeed, wbMorningManual,'
         + ' wbMorningTargetMs, wbDefaultNeedFor, wbZbyvaVyrobit, wbEveningMs, wbPvKw, wbCarReady,'
         + ' wbManualHeld, setWbManualHold, clearWbManualHold,'
         + ' WB_MANUAL_HOLD_MS, WB_RANO_OD_HOUR, WB_RANO_DO_HOUR, WB_RANO_KONEC_KW, WB_DEN_FAST_KWH };'
  )(
    state, weatherCache,
    at => pClock(at === undefined ? now : at),
    at => pDate(at === undefined ? now : at),
    m => logs.push(m),
    w => (w / 1000).toFixed(1).replace('.', ',') + ' kW',
    () => {},
    () => state.autoMode === 'winter',
    () => ({}),
    FakeDate
  );
  const setPv = kw => {
    state.infigy = { ...state.infigy, pvPower: kw, fetchedAt: new Date(now).toISOString() };
    state.solax = { ...state.solax, fveKw: kw, fetchedAt: new Date(now).toISOString() };
  };
  return {
    api, state, logs, setPv,
    setNow: t => { now = t; setDay(pDate(now)); },
    setVyrobeno: kwh => { state.solax = { ...state.solax, yieldToday: kwh }; },
    get now() { return now; }
  };
}

nadpis('1) Meze');
{
  const h = build();
  check('ráno začíná ve 3:00', h.api.WB_RANO_OD_HOUR, 3);
  check('  a končí nejpozději v 10:00', h.api.WB_RANO_DO_HOUR, 10);
  check('  nebo při 3,5 kW z FVE', h.api.WB_RANO_KONEC_KW, 3.5);
  check('přes den se jede naplno od 10 kWh, co zbývá vyrobit', h.api.WB_DEN_FAST_KWH, 10);
  check('ruční režim drží 3 h', h.api.WB_MANUAL_HOLD_MS / H, 3);
}

nadpis('2) Ráno: 3:00 → 10:00 nebo 3,5 kW');
{
  const rucne = { need: true, until: Date.now() + 24 * H };
  check('ve 2:00 se jen přebytek (GREEN)', build({ nowAt: '02:00', rucne }).api.ecWallboxTarget(), 'green');
  check('ve 3:00 už FAST', build({ nowAt: '03:00', rucne }).api.ecWallboxTarget(), 'fast');
  check('v 7:00 pořád FAST', build({ nowAt: '07:00', rucne }).api.ecWallboxTarget(), 'fast');
  const h = build({ nowAt: '07:00', pv: 3.6, rucne });
  check('  ale při 3,6 kW z FVE ráno končí', h.api.wbFaze(), 'den');
  check('  a je o tom řádek v logu', /konec ranního dobíjení/.test(h.logs.join('|')), 'true');
  const p = build({ nowAt: '07:00', pv: 3.4, rucne });
  check('3,4 kW ráno ještě neukončí', p.api.wbFaze(), 'rano');
  const d = build({ nowAt: '10:30', pv: 0.2, rucne });
  check('po 10:00 je den i bez slunce', d.api.wbFaze(), 'den');
}
{
  const rucne = { need: false, until: Date.now() + 24 * H };
  check('„nepotřebuju" jede ráno GREEN', build({ nowAt: '05:00', rucne }).api.ecWallboxTarget(), 'green');
  check('  i ve 3:00', build({ nowAt: '03:30', rucne }).api.ecWallboxTarget(), 'green');
}
{
  const h = build({ nowAt: '05:00', pv: 3.6, rucne: { need: true, until: Date.now() + 24 * H } });
  h.api.wbRanoSkoncilo();          // západka se zavře
  h.setPv(0.3);                    // mrak
  check('jednou skončené ráno se nevrací', h.api.wbFaze(), 'den');
}

nadpis('3) Den: rozhoduje, kolik zbývá vyrobit');
{
  check('zbývá 15 kWh → FAST', build({ nowAt: '11:00', odhad: 20, vyrobeno: 5 }).api.ecWallboxTarget(), 'fast');
  check('zbývá přesně 10 → FAST', build({ nowAt: '11:00', odhad: 20, vyrobeno: 10 }).api.ecWallboxTarget(), 'fast');
  check('zbývá 9,9 → ECO', build({ nowAt: '11:00', odhad: 20, vyrobeno: 10.1 }).api.ecWallboxTarget(), 'eco');
  check('vyrobeno víc než odhad → ECO', build({ nowAt: '15:00', odhad: 20, vyrobeno: 25 }).api.ecWallboxTarget(), 'eco');
  const h = build({ nowAt: '11:00', odhad: 20, vyrobeno: 5 });
  check('  a jak se den nasytí, přepne to na ECO', (h.setVyrobeno(14), h.api.ecWallboxTarget()), 'eco');
}
{
  const h = build({ nowAt: '11:00' });
  h.state.infigy = { ...h.state.infigy, forecastPv: undefined };
  check('bez odhadu výroby se jede ECO', h.api.ecWallboxTarget(), 'eco');
  check('  a appka to ví', h.api.wbZbyvaVyrobit(), 'null');
}

nadpis('4) Večer a noc');
{
  check('v 19:00 je ještě den (západ 20:30)', build({ nowAt: '19:00' }).api.wbFaze(), 'den');
  check('v 19:30 (západ − 1 h) už večer → GREEN', build({ nowAt: '19:30' }).api.ecWallboxTarget(), 'green');
  check('  ve 20:00 taky', build({ nowAt: '20:00' }).api.ecWallboxTarget(), 'green');
  check('ve 22:00 GREEN', build({ nowAt: '22:00' }).api.ecWallboxTarget(), 'green');
  check('bez počasí se večer počítá od 20:00', build({ nowAt: '20:30', pocasi: false }).api.wbFaze(), 'noc');
  check('  a v 19:00 je pořád den', build({ nowAt: '19:00', pocasi: false }).api.wbFaze(), 'den');
}

nadpis('5) Zima, pevné FAST a ruční režim');
{
  check('v zimě pořád FAST', build({ nowAt: '13:00', mode: 'winter', odhad: 5, vyrobeno: 5 }).api.ecWallboxTarget(), 'fast');
  check('  i v noci', build({ nowAt: '23:00', mode: 'winter' }).api.ecWallboxTarget(), 'fast');
  check('pevné FAST přebije všechno', build({ nowAt: '13:00', auto: false, odhad: 5, vyrobeno: 5 }).api.ecWallboxTarget(), 'fast');
}
{
  const h = build({ nowAt: '13:00' });
  check('bez zásahu odklad neběží', h.api.wbManualHeld(), 'false');
  h.api.setWbManualHold();
  check('po ručním přepnutí drží', h.api.wbManualHeld(), 'true');
  h.setNow(dnes('13:00') + 2 * H + 59 * 60000);
  check('  po 2:59 pořád', h.api.wbManualHeld(), 'true');
  h.setNow(dnes('13:00') + 3 * H + 60000);
  check('  po 3:01 už ne', h.api.wbManualHeld(), 'false');
}

nadpis('6) „Ráno auto potřebuju" — dny a ruční přepnutí');
{
  const stredaRano = denVTydnu('Wed', '06:00');
  const sobotaRano = denVTydnu('Sat', '06:00');
  check('pracovní den = potřebuju', build({ nowAt: stredaRano }).api.wbMorningNeed(), 'true');
  check('víkend = nepotřebuju', build({ nowAt: sobotaRano }).api.wbMorningNeed(), 'false');
  const h = build({ nowAt: '13:00' });
  const cil = h.api.wbMorningTargetMs();
  check('ruční přepnutí platí do nejbližší 10:00', pClock(cil).hour, 10);
  check('  a je to zítřek', pDate(cil) !== DNES, 'true');
  const rano = build({ nowAt: '06:00' });
  check('ráno se týká dneška', pDate(rano.api.wbMorningTargetMs()), DNES);
}
{
  const h = build({ nowAt: '06:00', rucne: { need: false, until: dnes('10:00') } });
  check('ruční „nepotřebuju" platí', h.api.wbMorningNeed(), 'false');
  h.setNow(dnes('11:00'));
  check('  po 10:00 už rozhoduje zase den v týdnu', h.api.wbMorningManual(), 'false');
}

konec();
