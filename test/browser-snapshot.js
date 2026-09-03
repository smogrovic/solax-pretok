// Ostrý průchod applySnapshot(): tahle sada měla chytit chybu, kdy jedna výjimka
// uprostřed utnula zbytek snapshotu a grafy zůstaly prázdné. Staví plný falešný
// snapshot, pustí SKUTEČNOU applySnapshot a kontroluje, že všechno dojelo.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
// Cokoli spolkne bezpecne() se tady sesbírá — pro tuhle sadu je to chyba
const RENDER_CHYBY = [];
const puvodniError = console.error;
console.error = (...a) => { RENDER_CHYBY.push(a.map(String).join(' ')); puvodniError(...a); };
window.addEventListener('error', e => RENDER_CHYBY.push('error: ' + e.message));
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
try { localStorage.clear(); } catch {}

const T = Date.now(), MIN = 60000;
function rada(od, krok, fn) {
  const out = [];
  for (let t = T - od; t <= T; t += krok) out.push(fn(t));
  return out;
}
const SNAP = {
  solax: { fveKw: 3.2, feedinKw: 1.1, batterySoc: 78, batPowerKw: 0.4, yieldToday: 12.3, fetchedAt: new Date().toISOString() },
  devices: {}, poolPowerW: 420, poolPowerAt: T, poolForce: { until: 0 },
  history: rada(26 * 3600000, 2 * MIN, t => ({ t, kw: 1.2, soc: 70, pv: 3 })),
  wallboxHistory: rada(26 * 3600000, 2 * MIN, t => ({ t, w: 3400 })),
  boilerHistory: rada(26 * 3600000, 5 * MIN, t => ({ t, b1: 48, b2: 52 })),
  airconHistory: rada(6 * 3600000, 10 * MIN, t => ({ t, temps: {}, sens: { obyvak: 23 } })),
  wbModeHistory: [{ t: T - 8 * 3600000, mode: 'green' }, { t: T - 3 * 3600000, mode: 'fast' }],
  log: [{ t: T - MIN, msg: 'zkušební řádek' }],
  timeline: { shelly: [], pool: [{ from: T - 2 * 3600000, to: T - 3600000 }], solinator: [],
              wallbox: [], wbPlugged: [{ from: T - 5 * 3600000, to: T }], sauna: [] },
  autoMode: 'on', manualHold: {},
  weather: { tempC: 18, sunsetMs: T + 3 * 3600000, fetchedAt: new Date().toISOString() },
  runtime: { date: new Date().toISOString().slice(0, 10), ms: { shelly: 1000, pool: 2000, solinator: 3000 },
             wh: { feed: 100, import: 50, wb: 4000, b1: 10, b2: 20 }, yesterday: null },
  aircon: { devices: [], error: null }, sensors: { obyvak: { tempC: 23.4, humidity: 45, battery: 90, reportedAt: T } },
  wallbox: { power: 3400, energy: 12, mode: 'green', status: 2, error: null },
  wbAuto: true, wbDayType: 'weekday', wbDayTypeManual: false, wbDayTypeUntil: 0,
  wbPlan: { green: 4, fast: 7 }, wbFaze: 'hyst', wbHystMode: 'fast', wbHystUpKw: 3.5,
  wbHystDownKw: 2.5, wbPrebytekW: 3800, wbCarReady: true, wbWinter: false,
  wbManualUntil: 0, wbTarget: 'fast',
  sauna: { powerW: 20, fetchedAt: new Date().toISOString(), topi: false, since: 0, blockUntil: 0, limitW: 500, holdMin: 30 },
  saunaDays: [{ d: '2026-08-30', wh: 8000, ms: 7200000 }],
  months: [{ m: '2026-07', sauna: 40000, pool: 12000, wb: 300000 }],
  pvDays: [{ d: '2026-08-30', fcAm: 20, fcPm: 22, actual: 21 }],
  wbDays: [{ d: '2026-08-30', grid: 100, pv: 900 }],
  usageDays: [{ d: new Date().toISOString().slice(0, 10), grid: 4000, pv: 9000 }],
  usageHistory: rada(26 * 3600000, 2 * MIN, t => ({ t, pool: 420, b1: 2000, b2: null })),
  solinator: { date: '', bonusMs: 0, boostMs: 0, carryMs: 0, disabledUntil: 0 },
  solinatorPlan: null, assistantLog: [{ t: T - MIN, text: 'zapnul jsem bazén' }],
  blindTimers: [], relayTimers: [], airconTimers: [],
  tempAuto: { obyvak: false, loznice: false, elenka: false, miky: false },
  tempAutoOn: 22, tempAutoOnRooms: { obyvak: 22 }, tempAutoWinter: 21, tempAutoWinterRooms: { obyvak: 21 },
  store: { enabled: true, loadedAt: T - 3600000, savedAt: T - MIN, error: null }
};

setTimeout(() => {
 try {
  applySnapshot(SNAP);
  check('applySnapshot proběhla bez chyby v renderu', RENDER_CHYBY.join(' | ') || 'nic', 'nic');

  // Přesně ty série, které dřív spadly pod useknutou applySnapshot
  check('historie přetoku se načetla', history.length > 100, true);
  check('historie wallboxu se načetla', wallboxHistory.length > 100, true);
  check('historie bojlerů se načetla', boilerHistory.length > 100, true);
  check('historie režimů wallboxu se načetla', wbModeHistoryData.length, 2);
  check('časová osa se načetla', (timelineData.wbPlugged || []).length, 1);
  check('měsíce se načetly', monthsData.length, 1);
  check('dny sauny se načetly', saunaDaysData.length, 1);
  check('odhad výroby se načetl', pvDaysData.length, 1);
  check('odkud auto bralo se načetlo', wbDaysData.length, 1);
  check('odběr okruhů se načetl', usageHistory.length > 100, true);
  check('odkud šla spotřeba se načetla', usageDaysData.length, 1);
  check('doba běhu se načetla', runtimeData && runtimeData.date === SNAP.runtime.date, true);

  // A že se to i vykreslilo
  check('graf FVE má výšku', fveChartCanvas.style.height !== '', true);
  check('graf wallboxu má výšku', wbChartCanvas.style.height !== '', true);
  check('součty pod grafem FVE jsou vyplněné', /kWh/.test(document.getElementById('feedinTotal').textContent), true);
  check('karta spotřeby má 7 dní + součet',
    document.querySelectorAll('#usageSrcList .wbsrc-row').length, 8);

  // bezpecne() smí spolknout jen jeden render, zbytek musí doběhnout
  RENDER_CHYBY.length = 0;
  const puvodni = renderWallbox;
  window.renderWallbox = () => { throw new Error('naschvál'); };
  bezpecne(window.renderWallbox);
  check('bezpecne() výjimku odchytí', RENDER_CHYBY.length, 1);
 } catch (e) {
  R.push('CHYBA  sada spadla: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]);
 }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (snapshot)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'snapshot.html');
fs.writeFileSync(out, v);
console.log(out);
