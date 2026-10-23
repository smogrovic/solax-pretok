// Počasí na dnešek pro kalendář na iPadu: sloty po 3 h z předpovědi OWM,
// které se drží i po vypadnutí z odpovědi, a souhrn min/max/srážky.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('počasí dnes');

const CODE = [
  between('// ---------- Počasí na dnešek (kalendář na iPadu) ----------', '// Server na Renderu běží v UTC'),
  fn('function pragueTime('), fn('function pragueDateString(')
].join('\n');

function build(weather) {
  const state = { weather }, zpravy = [];
  const api = new Function('state', 'broadcast',
    CODE + '\n; return { pocasiPopis, pocasiSlotyUloz, pocasiDnes, pocasiDnesObnov };')(
    state, (u, d) => zpravy.push({ u, d }));
  return { api, state, zpravy };
}

// 23. 10. 2026 v Praze (UTC+2): sloty OWM jsou v UTC po 3 h
const H = 3600000;
const T = h => Date.UTC(2026, 9, 23, h - 2, 0, 0);   // h = pražská hodina
const slot = (h, temp, x = {}) => ({ dt: T(h) / 1000, main: { temp, feels_like: temp - 2 }, clouds: { all: x.clouds ?? 50 },
  weather: [{ id: x.kod ?? 800, icon: x.icon ?? '01d', description: 'jasno' }], pop: x.pop ?? 0, ...(x.rain ? { rain: { '3h': x.rain } } : {}) });

nadpis('Popis z odpovědi OWM');
{
  const { api } = build(null);
  check('pocitová, oblačnost, kód, noc, popis',
    JSON.stringify(api.pocasiPopis({ main: { feels_like: 3.2 }, clouds: { all: 75 }, weather: [{ id: 803, icon: '04n', description: 'oblačno' }] })),
    JSON.stringify({ pocitC: 3.2, oblacnost: 75, kod: 803, noc: true, popis: 'oblačno' }));
  check('chybějící pole = null', JSON.stringify(api.pocasiPopis({})), JSON.stringify({ pocitC: null, oblacnost: null, kod: null, noc: false, popis: null }));
}

nadpis('Souhrn na dnešek');
{
  const { api } = build({ tempC: 6, pocitC: 3, oblacnost: 40, kod: 801, noc: false, popis: 'skoro jasno', sunriseMs: T(7), sunsetMs: T(17) });
  api.pocasiSlotyUloz([slot(5, 2), slot(8, 4), slot(11, 9, { pop: 0.2 }), slot(14, 12, { pop: 0.7, rain: 1.6, kod: 500 }),
    slot(17, 10, { pop: 0.4, rain: 0.8 }), slot(20, 7), slot(23, 5, { icon: '01n' }), slot(26, 1)], '2026-10-23');
  const p = api.pocasiDnes(T(7) + 30 * 60000);
  check('teď z aktuálního počasí', p.ted.tempC + ' ' + p.ted.pocitC + ' ' + p.ted.popis, '6 3 skoro jasno');
  check('min/max z dnešních slotů (zítřek ne)', p.minC + ' / ' + p.maxC, '2 / 12');
  check('hodiny od běžícího slotu, jen dnes', p.hodiny.map(h => new Date(h.t).getUTCHours() + 2).join(','), '5,8,11,14,17,20,23');
  check('srážky: max pravděpodobnost, součet, od kdy', JSON.stringify([p.srazky.pop, p.srazky.mm, p.srazky.od === T(14)]), '[70,2.4,true]');
  check('noc z ikony', p.hodiny[6].noc, true);
  check('slunce', p.vychodMs === T(7) && p.zapadMs === T(17), true);
  // Odpoledne: ranní sloty už v odpovědi nejsou, ale drží se → minimum zůstává
  api.pocasiSlotyUloz([slot(17, 10), slot(20, 7), slot(23, 5)], '2026-10-23');
  const p2 = api.pocasiDnes(T(16));
  check('vypadlé sloty se drží (min se nemění)', p2.minC, 2);
  check('  hodiny jen od teď', p2.hodiny.map(h => new Date(h.t).getUTCHours() + 2).join(','), '14,17,20,23');
  {
    // 12 hodinových slotů → do appky jde nejvýš 8
    const b = build({ tempC: 1 });
    b.api.pocasiSlotyUloz(Array.from({ length: 12 }, (_, i) => ({ ...slot(0, 1), dt: (T(0) + i * H) / 1000 })), '2026-10-23');
    check('nejvýš 8 hodin', b.api.pocasiDnes(T(0)).hodiny.length, 8);
  }
  // Nový den: včerejšek zmizí
  api.pocasiSlotyUloz([], '2026-10-24');
  check('nový den: včerejšek pryč, zítřejší slot z minula platí', JSON.stringify([api.pocasiDnes(T(24 + 7)).hodiny.length, api.pocasiDnes(T(24 + 7)).minC, api.pocasiDnes(T(24 + 7)).maxC]), '[0,1,6]');
}
{
  // Drží se jen dnešek a zítřek — pozítří z dnešní odpovědi nepočká
  const { api } = build({ tempC: 4 });
  api.pocasiSlotyUloz([slot(8, 5), slot(48 + 8, -30)], '2026-10-23');
  api.pocasiSlotyUloz([], '2026-10-25');
  check('pozítří se neukládá', api.pocasiDnes(T(48 + 7)).minC, 4);
}
{
  const { api } = build(null);
  check('bez dat null', api.pocasiDnes(T(7)), null);
  const b = build({ tempC: 5 });
  b.api.pocasiDnesObnov();
  check('obnova pošle appce', b.zpravy[0].u + ' ' + b.state.pocasiDnes.ted.tempC, 'pocasiDnes 5');
  check('  bez slotů: srážky neznámé', JSON.stringify(b.state.pocasiDnes.srazky), '{"pop":null,"mm":0,"od":null}');
}
konec();
