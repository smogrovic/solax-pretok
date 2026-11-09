// Nabíjení auta pro jinou appku: VT/NT ze sítě po dnech a GET /api/auto/nabijeni s klíčem.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('nabíjení auta');

const CODE_DNY = between('// ---------- Odkud co bralo', '// ---------- Sauna ----------');
const CODE_API = between('// ---------- Nabíjení auta pro jinou appku', '// ---------- Nabíjení auta pro Moje finance');
const CENIK_SRC = between('const CENIK = {', 'function spotrebaPredMesic(');

function dny(nt) {
  const state = { wbDays: [], poolDays: [], usageDays: [] };
  let dnes = '2026-11-09';
  const api = new Function('state', 'pragueDateString', 'pruneHistory', 'hdoNizky',
    CODE_DNY + '\n; return { recordWbDay, recordGridSplit };')(state, () => dnes, () => {}, () => nt.v);
  return { api, state, den: d => { dnes = d; } };
}

nadpis('1) Ze sítě podle tarifu');
{
  const nt = { v: true };
  const h = dny(nt);
  h.api.recordWbDay(10000, 4000, 1);          // 10 kW, ze sítě 4 kW, nízký tarif
  nt.v = false;
  h.api.recordWbDay(10000, 2000, 0.5);        // vysoký tarif: ze sítě 1 kWh
  const r = h.state.wbDays[0];
  check('síť celkem a v NT', [r.grid, r.gridNt, r.pv].join(' '), '5000 4000 10000');
  // Den, který odebíral ještě bez měření tarifu, zůstane bez gridNt
  const s = dny({ v: null });
  s.api.recordWbDay(5000, 5000, 1);
  s.state.wbDays[0].gridNt = undefined; delete s.state.wbDays[0].gridNt;
  const t = dny({ v: true });
  t.state.wbDays.push({ d: '2026-11-09', grid: 3000, pv: 0 });
  t.api.recordWbDay(5000, 5000, 1);
  check('rozběhnutý den bez měření tarifu zůstane odhadem', 'gridNt' in t.state.wbDays[0], false);
}

const HOD = 3600000;
function build(o = {}) {
  const routy = {};
  const state = { wbDays: o.dny || [] };
  const api = new Function('state', 'app', 'process', 'pragueDateString', 'safeEqual', 'pragueTime',
    CENIK_SRC + '\n' + CODE_API + '\n; return { autoNabijeniDny, CENIK, HDO_VT_PODIL };')(
    state, { get: (c, f) => { routy[c] = f; } }, { env: { AUTO_KLIC: o.klic === undefined ? 'tajny-klic' : o.klic } },
    at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(at === undefined ? new Date() : new Date(at)),
    (a, b) => a === b, () => ({ hour: 0, minute: 0 }));
  const volej = (query, klic) => {
    let out, kod = 200;
    const res = { setHeader() {}, json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    routy['/api/auto/nabijeni']({ query: query || {}, get: h => (h === 'X-Klic' ? klic : undefined) }, res);
    return { kod, out };
  };
  return { api, volej, state };
}

nadpis('2) Cena po dnech');
{
  const { api } = build({ dny: [
    { d: '2026-10-01', grid: 10000, pv: 20000, gridNt: 8000 },
    { d: '2026-10-02', grid: 6000, pv: 0 },
    { d: '2026-10-03', grid: 0, pv: 0 },
    { d: '2026-09-30', grid: 0, pv: 5000, gridNt: 0 }] });
  const d = api.autoNabijeniDny('2026-09-01', '2026-10-31', Date.UTC(2026, 10, 9));
  check('jen dny s nabíjením, seřazené', d.map(x => x.d).join(), '2026-09-30,2026-10-01,2026-10-02');
  const r = d[1];
  check('kWh z FVE a ze sítě, VT/NT', [r.kwh, r.fveKwh, r.sitKwh, r.sitVtKwh, r.sitNtKwh].join(' '), '30 20 10 2 8');
  check('  cena = VT × 4,33 + NT × 3,42, FVE zdarma', r.cenaKc, Math.round((2 * api.CENIK.vt + 8 * api.CENIK.nt) * 100) / 100);
  check('  změřený tarif bez příznaku odhadu', 'odhadTarifu' in r, false);
  const o = d[2];
  check('starší den: tarif podle podílu času a příznak', [o.sitVtKwh, o.odhadTarifu].join(' '), [Math.round(6000 * api.HDO_VT_PODIL / 10) / 100, true].join(' '));
  check('jen z FVE = 0 Kč', d[0].cenaKc, 0);
}

nadpis('3) Adresa s klíčem');
{
  const dnes = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date());
  const h = build({ dny: [{ d: '2026-10-05', grid: 1000, pv: 1000, gridNt: 1000 }, { d: dnes, grid: 0, pv: 2000, gridNt: 0 }] });
  check('bez klíče 401', h.volej({}, undefined).kod, 401);
  check('špatný klíč 401', h.volej({}, 'jiny').kod, 401);
  const r = h.volej({ od: '2026-10-01', do: dnes }, 'tajny-klic');
  check('správný klíč: dny i ceník', [r.kod, r.out.dny.length, r.out.mena, r.out.cenik.fveKcKwh].join(' '), '200 2 CZK 0');
  check('  dnešek označený jako neúplný', r.out.dny[1].neuplny, true);
  check('  výchozí: posledních 31 dní', h.volej({}, 'tajny-klic').out.od < dnes, true);
  check('od po do → 400', h.volej({ od: '2026-10-05', do: '2026-10-01' }, 'tajny-klic').kod, 400);
  check('víc než 400 dní → 400', h.volej({ od: '2024-01-01', do: '2026-10-01' }, 'tajny-klic').kod, 400);
  check('nesmyslné datum se ignoruje', h.volej({ od: 'x' }, 'tajny-klic').kod, 200);
  check('bez AUTO_KLIC na serveru adresa nefunguje (503)', build({ klic: '' }).volej({}, '').kod, 503);
}
konec();
