// Ověření: měsíční spotřeba sauny, bazénu a wallboxu — sčítání, přelom měsíce, strop.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('měsíce');

const H = 3600000;
const CODE = between('// ---------- Spotřeba po měsících', 'function emptyWh()');

function build(mesic = '2026-08') {
  const state = { months: [] };
  let m = mesic;
  const api = new Function('state', 'pragueDateString',
    CODE + '\n; return { recordMonth, recordMonthSplit, pragueMonthString, MONTHS_MAX,'
         + ' MONTH_KEYS, MONTH_CELKEM, MONTH_SPLIT };'
  )(state, () => m + '-15');
  return { api, state, setMesic: x => { m = x; } };
}

nadpis('1) Sčítání');
{
  const h = build();
  h.api.recordMonth('sauna', 6000, 0.5);      // 6 kW půl hodiny
  h.api.recordMonth('sauna', 6000, 0.5);
  check('založí se měsíc', h.state.months.length, 1);
  check('  se správným klíčem', h.state.months[0].m, '2026-08');
  check('  a sečte kWh', Math.round(h.state.months[0].sauna), 6000);
  h.api.recordMonth('pool', 800, 1);
  h.api.recordMonth('wb', 3400, 2);
  check('bazén i wallbox mají svoje sloupce',
    `${Math.round(h.state.months[0].pool)}/${Math.round(h.state.months[0].wb)}`, '800/6800');
  check('  a sauna zůstala', Math.round(h.state.months[0].sauna), 6000);
}
{
  const h = build();
  h.api.recordMonth('sauna', 0, 1);
  check('nulový odběr měsíc nezaloží', h.state.months.length, 0);
  h.api.recordMonth('sauna', 500, 0);
  check('nulový čas taky ne', h.state.months.length, 0);
  h.api.recordMonth('nesmysl', 500, 1);
  check('cizí klíč se ignoruje', h.state.months.length, 0);
}

nadpis('1b) Rozpad na síť a FVE');
{
  const h = build();
  h.api.recordMonthSplit('pool', 2000, 800, 1);     // bazén 2 kW hodinu, z toho 0,8 ze sítě
  const r = h.state.months[0];
  check('celkem se sečte', Math.round(r.pool), 2000);
  check('  ze sítě zvlášť', Math.round(r.poolGrid), 800);
  check('  a zbytek jako FVE', Math.round(r.poolPv), 1200);
  check('rozpad sedne na celek', Math.round(r.poolGrid + r.poolPv), Math.round(r.pool));
}
{
  // Dokonale solární měsíc: ze sítě nula. Klíč MUSÍ vzniknout, jinak by appka nulu
  // ukázala jako „neznámo" — a to je něco jiného.
  const h = build();
  h.api.recordMonthSplit('wb', 3000, 0, 1);
  const r = h.state.months[0];
  check('nulový odběr ze sítě není neznámo', typeof r.wbGrid, 'number');
  check('  a je to nula', r.wbGrid, 0);
  check('  všechno z FVE', Math.round(r.wbPv), 3000);
}
{
  // Měsíce z doby před rozpadem klíče nemají a mít nemají — appka je pozná
  const h = build();
  h.api.recordMonth('pool', 2000, 1);
  check('samotný celkem rozpad nevymyslí', typeof h.state.months[0].poolGrid, 'undefined');
}
{
  const h = build();
  h.api.recordMonthSplit('dum', 1000, 5000, 1);
  check('„ze sítě" nepřeroste spotřebu', Math.round(h.state.months[0].dumGrid), 1000);
  check('  a z FVE nezbude minus', Math.round(h.state.months[0].dumPv), 0);
  h.api.recordMonthSplit('sauna', 1000, 100, 1);
  check('sauna rozpad nemá', typeof h.state.months[0].saunaGrid, 'undefined');
  check('  a celkem se jí nezmění', h.state.months[0].sauna, 0);
}
{
  const h = build();
  check('MONTH_KEYS nese celky i rozpady', h.api.MONTH_KEYS.join(','),
    'sauna,pool,wb,dum,poolGrid,poolPv,wbGrid,wbPv,dumGrid,dumPv');
}

nadpis('2) Přelom měsíce');
{
  const h = build('2026-08');
  h.api.recordMonth('wb', 1000, 1);
  h.setMesic('2026-09');
  h.api.recordMonth('wb', 2000, 1);
  check('nový měsíc je zvlášť', h.state.months.map(r => r.m).join(','), '2026-08,2026-09');
  check('  starý zůstal beze změny', Math.round(h.state.months[0].wb), 1000);
  check('  nový má svoje', Math.round(h.state.months[1].wb), 2000);
}

nadpis('3) Kolik se drží');
{
  const h = build();
  check('strop je 13 měsíců', h.api.MONTHS_MAX, 13);
  for (let i = 1; i <= 15; i++) {
    h.setMesic(`2026-${String(i).padStart(2, '0')}`.replace('2026-13', '2027-01').replace('2026-14', '2027-02').replace('2026-15', '2027-03'));
    h.api.recordMonth('pool', 1000, 1);
  }
  check('  starší měsíce vypadnou', h.state.months.length, 13);
  check('  a zůstane ten poslední', h.state.months[h.state.months.length - 1].m, '2027-03');
}

konec();
