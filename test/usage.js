// Ověření: odkud šla spotřeba (kromě auta) a prořeďování dlouhých časových řad.
// Klíčové je, že se nic nepočítá dvakrát: ze sítě si první bere auto a co zbyde,
// jde na barák — obě karty dohromady musí dát celý odběr ze sítě.
const { LINES, between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('spotřeba');

const CODE_DNY = between('// ---------- Odkud co bralo', '// ---------- Sauna ----------');
const CODE_PICK = between('// Špička kbelíku', 'const LOG_MAX_AGE_MS');
const CODE_THIN = between('const THIN_AFTER_MS', '// Špička kbelíku');

function build(den = '2026-08-31') {
  const state = { wbDays: [], poolDays: [], usageDays: [] };
  let dnes = den;
  const api = new Function('state', 'pragueDateString', 'pruneHistory',
    CODE_DNY + '\n; return { recordGridSplit, recordWbDay, recordPoolDay, recordUsageDay,'
             + ' USAGE_DAYS_MAX, DEN_MAX };'
  )(state, () => dnes, () => {});
  return { api, state, setDen: d => { dnes = d; } };
}

// Součet Wh v jedné denní řadě
const soucet = pole => pole.reduce((a, r) => a + r.grid + r.pv, 0);
const zeSite = pole => pole.reduce((a, r) => a + r.grid, 0);

const pick = new Function(CODE_THIN + '\n' + CODE_PICK
  + '\n; return { thinPoints, PICK_MAX_KW, PICK_LAST };')();

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

nadpis('1b) Řetěz auto → bazén → dům');
// Pořadí je pravidlo, ne náhoda: auto i bazén se pouštějí schválně, takže když teče
// proud ze sítě, je to kvůli nim. Zásada, na které to stojí: součet tří podílů se
// vždycky rovná odběru ze sítě, aby se karty daly sečíst a nic nepočítalo dvakrát.
{
  const h = build();
  // import 5 kW, auto 3 kW, bazén 1,5 kW, celá spotřeba kromě auta 4 kW
  h.api.recordGridSplit({ wbW: 3000, poolW: 1500, loadW: 4000, importW: 5000, dtH: 1 });
  check('auto si vezme svoje', Math.round(zeSite(h.state.wbDays)), 3000);
  check('bazén dostane, co zbylo po autě', Math.round(zeSite(h.state.poolDays)), 1500);
  check('dům zbytek', Math.round(zeSite(h.state.usageDays)), 500);
  check('součet podílů sedne na import',
    Math.round(zeSite(h.state.wbDays) + zeSite(h.state.poolDays) + zeSite(h.state.usageDays)), 5000);
  // Dům je spotřeba KROMĚ auta a KROMĚ bazénu — jinak by se bazén počítal dvakrát
  check('dům je bez bazénu', Math.round(soucet(h.state.usageDays)), 2500);
  check('  a bazén má svoje celé', Math.round(soucet(h.state.poolDays)), 1500);
}
{
  // Málo importu: na dům nezbyde nic, ale jeho spotřeba se pořád zapíše jako z FVE
  const h = build();
  h.api.recordGridSplit({ wbW: 3000, poolW: 1500, loadW: 4000, importW: 3200, dtH: 1 });
  check('auto vezme skoro celý import', Math.round(zeSite(h.state.wbDays)), 3000);
  check('bazén jen zbytek', Math.round(zeSite(h.state.poolDays)), 200);
  check('na dům nezbylo nic', Math.round(zeSite(h.state.usageDays)), 0);
  check('  ale spotřeba domu se zapíše jako z FVE', Math.round(h.state.usageDays[0].pv), 2500);
  check('součet podílů sedne na import',
    Math.round(zeSite(h.state.wbDays) + zeSite(h.state.poolDays) + zeSite(h.state.usageDays)), 3200);
}
{
  // Přetok: ze sítě nejde nic, všechno je z FVE
  const h = build();
  h.api.recordGridSplit({ wbW: 2000, poolW: 1000, loadW: 3000, importW: 0, dtH: 1 });
  check('bez importu nikdo nebere ze sítě',
    zeSite(h.state.wbDays) + zeSite(h.state.poolDays) + zeSite(h.state.usageDays), 0);
  check('  a všechno je z FVE', Math.round(soucet(h.state.wbDays) + soucet(h.state.poolDays)), 3000);
}
{
  // Bazén měří Shelly, spotřebu hlásí střídač — dvě různá měření se můžou rozejít
  const h = build();
  h.api.recordGridSplit({ wbW: 0, poolW: 3000, loadW: 2000, importW: 1000, dtH: 1 });
  check('dům nikdy nejde do minusu', h.state.usageDays.length, 0);
  check('  a bazén se zapíše celý', Math.round(soucet(h.state.poolDays)), 3000);
}
{
  const h = build();
  h.api.recordGridSplit({ wbW: 0, poolW: 0, loadW: 2000, importW: 500, dtH: 1 });
  check('bez auta i bazénu bere dům celý zbytek', Math.round(zeSite(h.state.usageDays)), 500);
  check('  a jejich dny se nezaloží', h.state.wbDays.length + h.state.poolDays.length, 0);
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

nadpis('4) Prořídění drží špičku');
{
  // Kbelík si z každého úseku nechává JEDEN vzorek. U přetoku a odběru rozhoduje
  // špička (PICK_MAX_KW) — jinak by z grafu zmizely krátké zlomy; u teplot, které
  // se mění pomalu, stačí poslední hodnota (PICK_LAST). Na tuhle dvojici se váže
  // celá historie FVE i bojlerů, takže ať to nikdo nepřehodí nedopatřením.
  const now = 4 * 24 * 3600000;   // „teď" daleko od nuly, ať jsou body starší než den
  const stare = t => now - 2 * 24 * 3600000 + t;
  const body = [
    { t: stare(0), kw: 0 },
    { t: stare(60000), kw: 3.2 },        // špička
    { t: stare(120000), kw: 0 }
  ];
  const out = pick.thinPoints(body, pick.PICK_MAX_KW, now);
  check('z kbelíku zůstane jeden vzorek', out.length, 1);
  check('  a je to ten se špičkou', out[0].kw, 3.2);
  check('PICK_LAST by špičku zahodil', pick.thinPoints(body, pick.PICK_LAST, now)[0].kw, 0);
  // Odběr ze sítě je záporný — rozhodovat musí velikost, ne znaménko
  const import_ = [
    { t: stare(0), kw: 0 },
    { t: stare(60000), kw: -4.5 },
    { t: stare(120000), kw: 0 }
  ];
  check('  a u odběru rozhoduje velikost, ne znaménko',
    pick.thinPoints(import_, pick.PICK_MAX_KW, now)[0].kw, -4.5);
}
{
  const now = 4 * 24 * 3600000;
  const cerstve = [{ t: now - 1000, kw: 1 }, { t: now, kw: 2 }];
  check('mladší než den se neprořeďuje',
    pick.thinPoints(cerstve, pick.PICK_MAX_KW, now).length, 2);
}

nadpis('5) Mrtvá řada odběru okruhů je pryč');
{
  // Panel „Bazén a bojlery (kW)" z grafu na FVE zmizel a s ním i řada, kterou
  // kreslil. Kdyby se sběr vrátil, tekla by data do stavu, do zálohy na Upstashi
  // i do telefonu, aniž by je kdokoli četl — a nikdo by si toho nevšiml.
  const zdroj = LINES.join('\n');
  check('server nesbírá vzorky odběru', /recordUsagePoint/.test(zdroj), false);
  check('  ani je nedrží ve stavu', /state\.usageHistory/.test(zdroj), false);
  check('  ani neposílá přes SSE', /broadcast\('usageHistory'/.test(zdroj), false);
  check('  a endpoint pro obnovu nemá', /usage-history\/restore/.test(zdroj), false);
  // Denní rozpad na síť a FVE je jiná řada a zůstat musí
  check('denní rozpad spotřeby domu zůstal', /function recordUsageDay/.test(zdroj), true);
}

konec();
