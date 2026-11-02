// Týdenní report: v neděli ve 20:00 jedna notifikace za týden pondělí–neděle
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('týdenní report');

const CODE = [fn('function pragueTime('), fn('function pragueDateString('),
  "const CENIK = { vt: 4, nt: 2 }; const HDO_VT_PODIL = 0.5;",
  between('// ---------- Týdenní report (neděle večer) ----------', '// Odkud se běžící měsíc skládá')].join('\n');

const NEDELE = '2026-11-08';
const T = (d, h) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h - 1);   // Praha v zimě
const dny = (od, n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 9, od + i)).toISOString().slice(0, 10));

function build(o = {}) {
  const pushe = [];
  let ulozeno = 0;
  // Tento týden 2.–8. 11., minulý 26. 10.–1. 11.
  const ted = dny(33, 7), loni = dny(26, 7);
  const state = o.state || {
    usageDays: [...loni.map(d => ({ d, grid: 20000, pv: 10000 })), ...ted.map(d => ({ d, grid: 24000, pv: 9000 }))],
    poolDays: ted.map(d => ({ d, grid: 0, pv: 0 })),
    wbDays: [{ d: ted[2], grid: 14000, pv: 1000 }],
    pvDays: ted.map(d => ({ d, actual: 10 })),
    saunaDays: [{ d: ted[5], wh: 12000 }],
    tcSpotreba: { dny: ted.map(d => ({ d, topeni: 10, voda: 2 })) }
  };
  const api = new Function('state', 'sendPushToAll', 'storeUlozBrzy',
    CODE + '\n; return { tydenDny, tydenSouhrn, tydenText, tydenReportTik };')(
    state, async (t, b) => pushe.push(t + ' | ' + b), () => { ulozeno++; });
  return { api, state, pushe, ulozeno: () => ulozeno };
}

(async () => {
  nadpis('Týden');
  const h = build();
  check('pondělí až neděle', h.api.tydenDny(NEDELE).join(' '), '2026-11-02 2026-11-03 2026-11-04 2026-11-05 2026-11-06 2026-11-07 2026-11-08');
  const s = h.api.tydenSouhrn(h.api.tydenDny(NEDELE));
  check('součty: celkem, ze sítě, z FVE, auto, výroba', [s.celkem, s.sit, s.zFve, s.auto, s.vyroba].join(' '), '246 182 64 15 70');
  check('  TČ a sauna', [s.tcTopeni, s.tcVoda, s.sauna].join(' '), '70 14 12');
  const r = h.api.tydenText(NEDELE);
  check('nadpis', r.titul, '📊 Týden 2. 11. – 8. 11.');
  check('text', r.text, 'Spotřeba 246 kWh (+17 % proti minulému týdnu) · ze sítě 182 kWh, z FVE 64 kWh · '
    + 'výroba FVE 70 kWh, ušetřeno ~190 Kč · auto 15 kWh, TČ 84 kWh (topení 70 kWh, voda 14 kWh), sauna 12 kWh.');

  nadpis('Kdy se posílá');
  check('v neděli před 20:00 ne', await h.api.tydenReportTik(T(NEDELE, 19)), false);
  check('v sobotu ne', await h.api.tydenReportTik(T('2026-11-07', 21)), false);
  check('v neděli ve 20:00 ano', await h.api.tydenReportTik(T(NEDELE, 20)), true);
  check('  jedna notifikace s nadpisem', h.pushe.length + ' ' + h.pushe[0].split(' | ')[0], '1 📊 Týden 2. 11. – 8. 11.');
  check('  a uloží se, že odešel', [h.state.tydenReport, h.ulozeno()].join(' '), NEDELE + ' 1');
  check('podruhé ten den už ne', await h.api.tydenReportTik(T(NEDELE, 21)), false);
  const prazdny = build({ state: { usageDays: [], poolDays: [], wbDays: [], pvDays: [], saunaDays: [], tcSpotreba: { dny: [] } } });
  check('bez dat nic, ale už to nezkouší', [await prazdny.api.tydenReportTik(T(NEDELE, 20)), prazdny.pushe.length, prazdny.state.tydenReport].join(' '), 'false 0 ' + NEDELE);
  const bezMinula = build();
  bezMinula.state.usageDays = bezMinula.state.usageDays.filter(x => x.d >= '2026-11-02');
  check('bez minulého týdne bez srovnání', /proti minulému/.test(bezMinula.api.tydenText(NEDELE).text), false);

  nadpis('Zapojení');
  const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  check('plánuje se po startu', /scheduleEvery\(\(\) => tydenReportTik\(\)/.test(SRC), true);
  check('odeslání přežije nasazení (záloha)', /tydenReport: state\.tydenReport \|\| null/.test(SRC) && /p\.tydenReport/.test(SRC), true);
  konec();
})();
