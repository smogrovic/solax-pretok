// Ověření: odkud šla spotřeba (kromě auta) a řada odběru okruhů pro graf.
// Klíčové je, že se nic nepočítá dvakrát: ze sítě si první bere auto a co zbyde,
// jde na barák — obě karty dohromady musí dát celý odběr ze sítě.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('spotřeba');

const CODE_DNY = between('// ---------- Odkud šla spotřeba', '// ---------- Sauna ----------');
const CODE_PICK = between('// Špička kbelíku', 'const LOG_MAX_AGE_MS');
const CODE_THIN = between('const THIN_AFTER_MS', '// Špička kbelíku');

function build(den = '2026-08-31') {
  const state = { usageDays: [], usageHistory: [] };
  let dnes = den;
  const api = new Function('state', 'pragueDateString', 'pruneHistory',
    CODE_DNY + '\n; return { recordUsageDay, recordUsagePoint, USAGE_DAYS_MAX };'
  )(state, () => dnes, () => {});
  return { api, state, setDen: d => { dnes = d; } };
}

const pick = new Function(CODE_THIN + '\n' + CODE_PICK
  + '\n; return { thinPoints, PICK_MAX_USAGE, PICK_LAST, usageSoucet };')();

nadpis('1) Dělení spotřeby');
{
  const h = build();
  h.api.recordUsageDay(2000, 0, 1);           // 2 kW hodinu, ze sítě nic
  check('založí se den', h.state.usageDays.length, 1);
  check('  všechno z FVE', Math.round(h.state.usageDays[0].pv), 2000);
  check('  ze sítě nic', Math.round(h.state.usageDays[0].grid), 0);
}
{
  const h = build();
  h.api.recordUsageDay(3000, 1200, 1);        // barák 3 kW, ze sítě 1,2 kW
  check('ze sítě jde jen zbylý import', Math.round(h.state.usageDays[0].grid), 1200);
  check('  zbytek z FVE', Math.round(h.state.usageDays[0].pv), 1800);
  check('  součet sedne na spotřebu',
    Math.round(h.state.usageDays[0].grid + h.state.usageDays[0].pv), 3000);
}
{
  // Ze sítě se dobíjí baterie: import je vyšší než spotřeba baráku
  const h = build();
  h.api.recordUsageDay(1000, 5000, 1);
  check('„ze sítě" nepřeroste spotřebu', Math.round(h.state.usageDays[0].grid), 1000);
  check('  a z FVE nezbude minus', Math.round(h.state.usageDays[0].pv), 0);
}
{
  const h = build();
  h.api.recordUsageDay(0, 1000, 1);
  check('nulová spotřeba den nezaloží', h.state.usageDays.length, 0);
  h.api.recordUsageDay(2000, 500, 0);
  check('nulový čas taky ne', h.state.usageDays.length, 0);
  h.api.recordUsageDay(-500, 0, 1);
  check('záporná spotřeba taky ne', h.state.usageDays.length, 0);
}

nadpis('2) Auto má na síti přednost');
{
  // Tak to počítá updateRuntimes: recordWbDay dostane celý import, spotřeba zbytek
  const h = build();
  const importW = 5000, wbW = 3000;
  const autoZeSite = Math.min(wbW, importW);        // 3000 → autu
  h.api.recordUsageDay(4000, importW - autoZeSite, 1);
  check('baráku zůstane import po autu', Math.round(h.state.usageDays[0].grid), 2000);
  check('  a zbytek je z FVE', Math.round(h.state.usageDays[0].pv), 2000);
  check('auto + barák = celý import', autoZeSite + Math.round(h.state.usageDays[0].grid), importW);
}
{
  // Auto bere víc, než jde ze sítě → na barák z importu nezbyde nic
  const h = build();
  const importW = 1500, wbW = 7000;
  h.api.recordUsageDay(3000, importW - Math.min(wbW, importW), 1);
  check('když auto spolkne celý import', Math.round(h.state.usageDays[0].grid), 0);
  check('  barák jede z FVE', Math.round(h.state.usageDays[0].pv), 3000);
}

nadpis('3) Dny');
{
  const h = build('2026-08-31');
  h.api.recordUsageDay(2000, 1000, 1);
  h.setDen('2026-09-01');
  h.api.recordUsageDay(1000, 0, 1);
  check('přelom dne zakládá nový záznam', h.state.usageDays.length, 2);
  check('  včerejšek zůstal', Math.round(h.state.usageDays[0].grid), 1000);
  check('  dnešek je zvlášť', Math.round(h.state.usageDays[1].pv), 1000);
}
{
  const h = build();
  for (let i = 1; i <= 20; i++) {
    h.setDen('2026-08-' + String(i).padStart(2, '0'));
    h.api.recordUsageDay(1000, 0, 1);
  }
  check('drží se 14 dní', h.state.usageDays.length, h.api.USAGE_DAYS_MAX);
  check('  a to ty poslední', h.state.usageDays[h.state.usageDays.length - 1].d, '2026-08-20');
}

nadpis('4) Řada odběru okruhů');
{
  const h = build();
  h.api.recordUsagePoint(400, 2000, 1500);
  check('vzorek se uloží', h.state.usageHistory.length, 1);
  check('  s bazénem', h.state.usageHistory[0].pool, 400);
  h.api.recordUsagePoint(400, 2000, 1500);
  check('do 30 s se druhý nepřidá', h.state.usageHistory.length, 1);
}
{
  const h = build();
  h.api.recordUsagePoint(null, null, null);
  check('samé nully vzorek nezaloží', h.state.usageHistory.length, 0);
  h.api.recordUsagePoint(null, 2000, null);
  check('jeden zdroj stačí', h.state.usageHistory.length, 1);
  check('  a mlčící zůstane null', h.state.usageHistory[0].pool, null);
}

nadpis('5) Prořídění drží špičku');
{
  const now = 4 * 24 * 3600000;   // „teď" daleko od nuly, ať jsou body starší než den
  const stare = t => now - 2 * 24 * 3600000 + t;
  const body = [
    { t: stare(0), pool: 0, b1: 0, b2: 0 },
    { t: stare(60000), pool: 400, b1: 3000, b2: 0 },   // špička
    { t: stare(120000), pool: 0, b1: 0, b2: 0 }
  ];
  const out = pick.thinPoints(body, pick.PICK_MAX_USAGE, now);
  check('z kbelíku zůstane jeden vzorek', out.length, 1);
  check('  a je to ten se špičkou', out[0].b1, 3000);
  const posledni = pick.thinPoints(body, pick.PICK_LAST, now);
  check('PICK_LAST by špičku zahodil', posledni[0].b1, 0);
  check('součet bere všechny okruhy', pick.usageSoucet({ pool: 1, b1: 2, b2: 3 }), 6);
  check('  a chybějící okruh nedělá NaN', pick.usageSoucet({ b1: 2 }), 2);
  check('  ani null', pick.usageSoucet({ pool: null, b1: 2, b2: null }), 2);
}
{
  const now = 4 * 24 * 3600000;
  const cerstve = [{ t: now - 1000, pool: 1, b1: 1, b2: 1 }, { t: now, pool: 2, b1: 2, b2: 2 }];
  check('mladší než den se neprořeďuje',
    pick.thinPoints(cerstve, pick.PICK_MAX_USAGE, now).length, 2);
}

konec();
