// Ověření: měsíční spotřeba sauny, bazénu a wallboxu — sčítání, přelom měsíce, strop.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('měsíce');

const H = 3600000;
const CODE = between('// ---------- Spotřeba po měsících', 'function emptyWh()');

function build(mesic = '2026-08') {
  const state = { months: [] };
  let m = mesic;
  const api = new Function('state', 'pragueDateString',
    CODE + '\n; return { recordMonth, pragueMonthString, MONTHS_MAX, MONTH_KEYS };'
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
