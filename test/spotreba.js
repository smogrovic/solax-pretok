// Stránka Spotřeba: měsíce z ručně vedené tabulky + samy skládané další měsíce
// (počítadla elektroměru, výroba po dnech, měřené okruhy), obnova po nasazení.
const path = require('path');
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('spotreba');

const CODE = [fn('function pragueTime('), fn('function pragueDateString('), fn('function pragueMonthString('),
  between('// ---------- Stránka Spotřeba (měsíční tabulka)', 'function emptyWh()')].join('\n');
const HISTORIE = require('../data/spotreba-historie.json').mesice;

function build(o = {}) {
  const routy = {}, zpravy = [];
  const state = Object.assign({ months: [], solax: null, siteDny: [], pvDays: [], runtime: { date: '', wh: {} } }, o.state || {});
  const api = new Function('require', 'state', 'cerstve', 'app', 'broadcast', 'fetch', 'WEATHER_LAT', 'WEATHER_LON',
    CODE + '\n; return { spotrebaVzorek, spotrebaPoStartu, spotrebaMesic, spotrebaPayload, spotrebaPredMesic, SPOTREBA_HISTORIE,'
      + ' hdoNizky, HDO_VT_PODIL, CENIK, spotrebaTeplotyRozeber, spotrebaTeplotyNacti };')(
    p => require(path.join(__dirname, '..', p)), state, () => o.cerstve !== false,
    { post: (c, h) => { routy[c] = h; }, get: (c, h) => { routy[c] = h; } }, u => zpravy.push(u),
    o.fetch || (async () => { throw new Error('bez sítě'); }), 49.7, 14.6);
  const volej = (cesta, body) => {
    let out, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    routy[cesta]({ body }, res);
    return { out, kod };
  };
  return { api, state, zpravy, volej, routy };
}
const T = (d, h = 12) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h - 1);   // Praha v zimě

(async () => {
nadpis('Ručně vedená tabulka');
{
  check('21 měsíců, únor 2025 – říjen 2026', HISTORIE.length + ' ' + HISTORIE[0].m + ' ' + HISTORIE[HISTORIE.length - 1].m, '21 2025-02 2026-10');
  const chyby = HISTORIE.filter(r => Math.abs(r.bazen + r.sauna + r.auto + r.tcTopeni + r.voda + r.zbytek - r.celkova) > 2
    || Math.abs(r.tcVoda + r.b1 + r.b2 - r.voda) > 2);
  check('  každý řádek sedí (součet dílů = celková, voda = TČ + bojlery)', chyby.map(r => r.m).join(','), '');
  const s12 = k => HISTORIE.slice(-12).reduce((a, r) => a + r[k], 0);
  check('  12 měsíců jako v tabulce', [s12('celkova'), s12('tcTopeni'), s12('zbytek'), s12('sit'), s12('pretok')].join(' '), '18024 3352 6992 8841 1549');
  const h = build();
  check('server ji načte', h.api.SPOTREBA_HISTORIE.length, 21);
  check('předchozí měsíc i přes rok', h.api.spotrebaPredMesic('2026-01'), '2025-12');
}

nadpis('Po startu (první nasazení uprostřed měsíce)');
{
  const h = build({ state: {
    months: [{ m: '2026-11', sauna: 0, pool: 1000, wb: 15000, dum: 50000 }],
    siteDny: [{ d: '2026-10-31', imp: 9e9, feed: 0, b1: 0, b2: 0 }, { d: '2026-11-01', imp: 44000, feed: 100, b1: 2000, b2: 500 },
      { d: '2026-11-02', imp: 7e9, feed: 0, b1: 0, b2: 0 }],
    runtime: { date: '2026-11-02', wh: { import: 8000, feed: 50, b1: 1000, b2: 0 } },
    pvDays: [{ d: '2026-10-31', actual: 9 }, { d: '2026-11-01', actual: 3.5 }, { d: '2026-11-02', actual: 1.2 }]
  } });
  h.api.spotrebaPoStartu(T('2026-11-02'));
  const r = h.state.months[0];
  check('síť a bojlery z denní řady + dneška', [r.imp, r.feed, r.b1, r.b2].join(' '), '52000 150 3000 500');
  check('  výroba po dnech z řady FVE', JSON.stringify(h.state.spotreba.pv['2026-11']), '{"01":3.5,"02":1.2}');
  r.imp = 60000;
  h.state.siteDny[1].imp = 99000;
  h.api.spotrebaPoStartu(T('2026-11-02'));
  check('  podruhé už nic nepřičte', r.imp, 60000);
  const nova = build({ state: { months: [{ m: '2026-11', sauna: 0, pool: 0, wb: 0, dum: 0, imp: 90000 }],
    siteDny: [{ d: '2026-11-01', imp: 44000, feed: 0, b1: 0, b2: 0 }] } });
  nova.api.spotrebaPoStartu(T('2026-11-02'));
  check('  co měsíc nasčítal sám, se nesníží', nova.state.months[0].imp, 90000);
  const pozdeji = build({ state: { months: [{ m: '2026-11', sauna: 0, pool: 0, wb: 0, dum: 0 }],
    siteDny: [{ d: '2026-11-01', imp: 44000, feed: 0, b1: 0, b2: 0 }] } });
  pozdeji.volej('/api/spotreba/restore', { citace: {}, pv: {}, doplneno: '2026-11' });
  pozdeji.api.spotrebaPoStartu(T('2026-11-02'));
  check('  příznak ze zálohy: doplněný měsíc se nedoplňuje znovu', pozdeji.state.months[0].imp, undefined);
  const bez = build();
  bez.api.spotrebaPoStartu(T('2026-11-02'));
  check('  měsíc bez záznamu se založí', bez.state.months.map(x => x.m + ':' + x.imp).join(), '2026-11:0');
}

nadpis('Počítadla elektroměru');
{
  const st = { months: [{ m: '2026-11', sauna: 0, pool: 0, wb: 0, dum: 0, imp: 52000, feed: 150 }],
    solax: { fetchedAt: 'x', yieldToday: 1.2, citace: { imp: 10052, feed: 3000.15 } } };
  const h = build({ state: st });
  h.api.spotrebaVzorek(T('2026-11-02'));
  const c = h.state.spotreba.citace['2026-11'];
  check('první čtení uprostřed měsíce: začátek dopočtený ze vzorků', [c.od.imp, Math.round(c.od.feed * 100) / 100, c.odhad].join(' '), '10000 3000 true');
  st.solax.citace = { imp: 10060, feed: 3001 };
  st.solax.yieldToday = 0.5;
  h.api.spotrebaVzorek(T('2026-11-02', 15));
  check('  další čtení posune jen konec', [c.od.imp, c.do.imp].join(' '), '10000 10060');
  check('  výroba dne drží maximum', h.state.spotreba.pv['2026-11']['02'], 1.2);
  // Přelom měsíce: navazuje přesně na konec minulého
  st.solax.citace = { imp: 10060, feed: 3001 };
  h.api.spotrebaVzorek(T('2026-11-30', 23));
  st.solax.citace = { imp: 10070, feed: 3001 };
  h.api.spotrebaVzorek(T('2026-12-01', 1));
  const pros = h.state.spotreba.citace['2026-12'];
  check('nový měsíc navazuje na konec minulého', [pros.od.imp, pros.odhad].join(' '), '10060 false');
  // Vynulované počítadlo
  st.solax.citace = { imp: 5, feed: 1 };
  h.api.spotrebaVzorek(T('2026-12-01', 3));
  check('vynulované počítadlo začne znovu', h.state.spotreba.citace['2026-12'].od.imp, 5);
  const bez = build({ state: { solax: { fetchedAt: 'x', yieldToday: 2, citace: null } } });
  bez.api.spotrebaVzorek(T('2026-11-02'));
  check('bez počítadel jen výroba', Object.keys(bez.state.spotreba.citace).length + ' ' + bez.state.spotreba.pv['2026-11']['02'], '0 2');
  const stare = build({ cerstve: false, state: { solax: { fetchedAt: 'x', yieldToday: 2, citace: { imp: 1, feed: 1 } } } });
  stare.api.spotrebaVzorek(T('2026-11-02'));
  check('se starými daty nic', JSON.stringify(stare.state.spotreba || {}), '{"citace":{},"pv":{}}');
  const mezera = build({ state: { months: [], solax: { fetchedAt: 'x', citace: { imp: 50, feed: 5 } },
    spotreba: { citace: { '2026-11': { od: { imp: 1, feed: 1 }, do: { imp: 40, feed: 4 }, doTs: T('2026-11-29') } }, pv: {} } } });
  mezera.api.spotrebaVzorek(T('2026-12-01', 3));
  check('po dlouhé mezeře se začátek dopočítá', mezera.state.spotreba.citace['2026-12'].odhad, true);
}

nadpis('Měsíc');
{
  const st = {
    months: [{ m: '2026-11', sauna: 85000, pool: 38000, wb: 303000, dum: 1000000, tc: 179000, tcTopeni: 121000, tcVoda: 58000,
      b1: 88000, b2: 50000, imp: 700000, feed: 30000 }],
    spotreba: { citace: { '2026-11': { od: { imp: 1000, feed: 500 }, do: { imp: 1804, feed: 535 }, odhad: false } },
      pv: { '2026-11': { '01': 400, '02': 262 } } }
  };
  const h = build({ state: st });
  const r = h.api.spotrebaMesic('2026-11', '2026-12-05');
  check('síť a přetok z počítadel', [r.sit, r.pretok, r.zdroj.site].join(' '), '804 35 citace');
  check('celková = výroba + síť − přetok', [r.vyroba, r.celkova, r.zdroj.celkem].join(' '), '662 1431 vyroba');
  check('okruhy, voda, zbytek jako v tabulce', [r.bazen, r.sauna, r.auto, r.tcTopeni, r.tcVoda, r.b1, r.b2, r.voda, r.zbytek].join(' '),
    '38 85 303 121 58 88 50 196 688');
  check('  uzavřený měsíc neběží', !!r.bezi, false);
  check('  běžící ano', h.api.spotrebaMesic('2026-11', '2026-11-20').bezi, true);
  delete st.spotreba.citace['2026-11'];
  const v = h.api.spotrebaMesic('2026-11', '2026-12-05');
  check('bez počítadel ze vzorků', [v.sit, v.pretok, v.zdroj.site, v.celkova].join(' '), '700 30 vzorky 1332');
  st.spotreba.pv = {};
  const o = h.api.spotrebaMesic('2026-11', '2026-12-05');
  check('bez výroby součet okruhů (dům + měřené)', [o.celkova, o.zdroj.celkem].join(' '), '1564 okruhy');
  check('  zbytek nikdy záporný', h.api.spotrebaMesic('2026-11', '2026-12-05').zbytek >= 0, true);
  check('neznámý měsíc', h.api.spotrebaMesic('2020-01'), null);
}

nadpis('Tarif D56d');
{
  const h = build();
  const v = (hod, min = 0) => h.api.hdoNizky(Date.UTC(2026, 10, 2, hod - 1, min));   // Praha v zimě = UTC+1
  check('NT v noci, VT jen 8–9, 12–13, 15–16, 19–20', [v(3), v(8), v(8, 59), v(9), v(12, 30), v(14), v(15, 10), v(19, 30), v(23, 59)].join(' '),
    'true false false true false true false false true');
  check('VT podle času = 4 h z 24', Math.round(h.api.HDO_VT_PODIL * 1000) / 1000, 0.167);
  check('ceník s DPH, POZE 0, měsíčně stálá + jistič 3×25 A + infrastruktura', [h.api.CENIK.vt, h.api.CENIK.nt, h.api.CENIK.mesicne.toFixed(2)].join(' '), '4.32625 3.42394 850.47');
  const st = build({ state: { months: [{ m: '2026-11', sauna: 0, pool: 0, wb: 0, dum: 0, imp: 100000, impVt: 25000, impNt: 75000 }] } });
  check('podíl VT z měřeného odběru', st.api.spotrebaMesic('2026-11', '2026-11-20').vtPodil, 0.25);
  check('  bez rozdělení není', 'vtPodil' in build({ state: { months: [{ m: '2026-11', sauna: 0, pool: 0, wb: 0, dum: 0 }] } }).api.spotrebaMesic('2026-11'), false);
}

nadpis('Payload');
{
  const h = build({ state: { months: [{ m: '2026-09', sauna: 1, pool: 0, wb: 0, dum: 0 }, { m: '2026-11', sauna: 0, pool: 0, wb: 0, dum: 5000 }] } });
  const p = h.api.spotrebaPayload(T('2026-11-15'));
  check('ruční měsíce + samy skládané po nich', [p.mesice.length, p.rucneDo, p.mesice[20].rucne, p.mesice[21].m, p.mesice[21].samo].join(' '),
    '22 2026-10 true 2026-11 true');
  check('  měsíc v ruční tabulce se ze serveru nebere', p.mesice.filter(r => r.m === '2026-09').length, 1);
  check('  ceník a podíl VT podle času', [p.cenik.nazev, p.cenik.vtPodilCas].join(' '), 'ČEZ D56d, jistič 3×25 A 0.167');
  check('  zálohy 4 500 Kč a vyúčtování od září', [p.cenik.zaloha, p.cenik.obdobiOd].join(' '), '4500 9');
  const t = build({ state: { months: [], tcSpotreba: { dny: [{ d: '2026-10-01', venku: 8 }, { d: '2026-10-02', venku: 5 }, { d: '2025-01-03', venku: -2.35 }, { d: '2025-01-04' }] } } });
  const pt = t.api.spotrebaPayload(T('2026-11-15'));
  check('venkovní teplota měsíce i k ručním měsícům', [pt.mesice.find(r => r.m === '2026-10').venku, 'venku' in pt.mesice.find(r => r.m === '2025-02')].join(' '), '6.5 false');
}

nadpis('Venkovní teplota z archivu');
{
  const h = build();
  const r = h.api.spotrebaTeplotyRozeber({ daily: { time: ['2025-01-30', '2025-01-31', '2025-02-01', 'x', '2025-02-02'], temperature_2m_mean: [-2, 1, 3.5, 9, null] } });
  check('rozbor po měsících (součet a počet dní)', JSON.stringify(r), '{"2025-01":{"s":-1,"n":2},"2025-02":{"s":3.5,"n":1}}');
  let url = '';
  const n = build({ state: { months: [], tcSpotreba: { dny: [{ d: '2026-10-01', venku: 15 }, { d: '2025-02-10', venku: 7 }] } },
    fetch: async u => { url = u; return { ok: true, json: async () => ({ daily: { time: ['2025-02-01', '2025-02-02'], temperature_2m_mean: [1, 2] } }) }; } });
  check('stáhne se a uloží', await n.api.spotrebaTeplotyNacti(T('2026-11-02')), true);
  check('  dotaz: od ledna 2025 do včerejška, denní průměr', /start_date=2025-01-01&end_date=2026-11-01&daily=temperature_2m_mean/.test(url) && /latitude=49.7&longitude=14.6/.test(url), true);
  const p = n.api.spotrebaPayload(T('2026-11-02'));
  check('  archiv má přednost, jinak teplota z TČ', [p.mesice.find(x => x.m === '2025-02').venku, p.mesice.find(x => x.m === '2026-10').venku].join(' '), '1.5 15');
  const chyba = build({ fetch: async () => ({ ok: false, status: 500 }) });
  let e = null;
  try { await chyba.api.spotrebaTeplotyNacti(); } catch (x) { e = x.message; }
  check('  chyba serveru', e, 'Open-Meteo HTTP 500');
  const o = build();
  o.volej('/api/spotreba/restore', { citace: {}, pv: {}, teploty: { '2025-03': { s: 120, n: 31 }, '2025-04': { s: 'x', n: 3 }, bad: { s: 1, n: 1 } } });
  check('  obnova teplot ze zálohy', JSON.stringify(o.state.spotreba.teploty), '{"2025-03":{"s":120,"n":31}}');
}

nadpis('Obnova');
{
  const h = build();
  const { out } = h.volej('/api/spotreba/restore', {
    citace: { '2026-11': { od: { imp: 1, feed: 2 }, do: { imp: 3, feed: 4 }, doTs: 9, odhad: true }, spatne: { od: { imp: 1, feed: 1 } },
      '2026-12': { od: { imp: -1, feed: 0 } } },
    pv: { '2026-11': { '01': 3.5, '02': 'x', '03': 9999, 'xx': 1 } }
  });
  check('obnoví počítadla a platné dny výroby', [out.ok, JSON.stringify(h.state.spotreba.citace), JSON.stringify(h.state.spotreba.pv)].join(' | '),
    'true | {"2026-11":{"od":{"imp":1,"feed":2},"odhad":true,"do":{"imp":3,"feed":4},"doTs":9}} | {"2026-11":{"01":3.5}}');
  h.volej('/api/spotreba/restore', { citace: { '2026-11': { od: { imp: 100, feed: 100 } } }, pv: { '2026-11': { '01': 2 } } });
  check('  co server má, nepřepíše (výroba bere větší)', [h.state.spotreba.citace['2026-11'].od.imp, h.state.spotreba.pv['2026-11']['01']].join(' '), '1 3.5');
  check('  pošle tabulku do appky', h.zpravy.includes('spotreba'), true);
}
})().then(konec);
