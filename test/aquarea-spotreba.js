// Spotřeba tepelného čerpadla (Aquarea) z Comfort Cloudu: dotaz přes common/transfer,
// rozbor dnů, slučování, měsíční součty do spotřeby po měsících, payload a obnova.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('aquarea-spotreba');

const CODE = ['const MONTHS_MAX = 13;', "const MONTH_TC = ['tc', 'tcTopeni', 'tcVoda'];", fn('function spotrebaPredMesic('),
  fn('function pragueTime('), fn('function pragueDateString('),
  between('// ---------- Spotřeba tepelného čerpadla (Aquarea)', "app.post('/api/aircon/set'")].join('\n');

// Odpověď jako v referenční integraci: jeden záznam za den, -255 = ještě nic
const ODPOVED = {
  dateString: '2026-10', energyShowing: 1,
  historyDataList: [
    { dataTime: '20261014', heatConsumption: 7.25, coolConsumption: -255, tankConsumption: 1.9, outdoorTemp: 8 },
    { dataTime: '20261013', heatConsumption: 6.4, coolConsumption: 0, tankConsumption: 2.1, outdoorTemp: 9 },
    { dataTime: '20261015', heatConsumption: '3.1', coolConsumption: 0, tankConsumption: 0.8 },
    { dataTime: '20261016', heatConsumption: -255, coolConsumption: -255, tankConsumption: -255 },
    { dataTime: 'nesmysl', heatConsumption: 1 },
    null
  ]
};

function build(o = {}) {
  const routy = { get: {}, post: {} }, zpravy = [], logy = [], dotazy = [];
  let ulozeno = 0;
  const state = o.state || { aircon: { aquarea: [{ guid: 'GW-TAJNE-1' }] }, months: [], tcSpotreba: { dny: [], ts: 0, chyba: null } };
  const pccApiFetch = o.fetch || (async (cesta, opts) => {
    dotazy.push({ cesta, telo: JSON.parse(opts.body) });
    if (o.chyba) throw new Error(o.chyba + ' GW-TAJNE-1');
    return o.odpoved || ODPOVED;
  });
  const api = new Function('app', 'requireAuth', 'broadcast', 'addLog', 'pccQueued', 'pccApiFetch', 'state', 'panasonicEnabled', 'storeUlozBrzy',
    CODE + '\n; return { tcPosunPrahy, tcSpotrebaTelo, tcOdmitnuti, aquareaSpotrebaRozeber, tcSpotrebaSluc, tcMesice, tcSpotrebaPayload,'
      + ' aquareaSpotrebaNacti, tcMesiceKNacteni, tcSpotrebaPoll, tcHistorieDotahni, aquareaHodinyRozeber, tcHodinySluc, tcHodinyPoll, tcSpotrebaHodinyTelo };')(
    { get: (c, h) => { routy.get[c] = h; }, post: (c, h) => { routy.post[c] = h; } },
    (req, res) => { if (!o.zamceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    (u, d) => zpravy.push(u), t => logy.push(t), f => f(), pccApiFetch, state, o.vypnuto ? false : true, () => { ulozeno++; });
  const volej = async (metoda, cesta, body) => {
    let out, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    await routy[metoda][cesta]({ body }, res);
    return { out, kod };
  };
  return { api, routy, zpravy, logy, dotazy, state, volej, ulozeno: () => ulozeno };
}

(async () => {
  nadpis('Dotaz');
  {
    const h = build();
    const t = h.api.tcSpotrebaTelo('GW-1', '2026-11-02');
    check('apiName a metoda', t.apiName + ' ' + t.requestMethod, '/remote/v1/api/consumption POST');
    check('tělo: gwid, dataMode 1, datum bez pomlček, zimní posun', JSON.stringify(t.bodyParam),
      '{"gwid":"GW-1","dataMode":1,"date":"20261102","osTimezone":"+01:00"}');
    check('letní posun', h.api.tcPosunPrahy('2026-07-15'), '+02:00');
    check('den změny času (25. 10.) = zimní', h.api.tcPosunPrahy('2026-10-25'), '+01:00');
    await h.api.aquareaSpotrebaNacti('GW-1', '2026-10-15');
    check('jde přes common/transfer', h.dotazy[0].cesta, '/remote/v1/app/common/transfer');
    check('  s tělem dotazu', h.dotazy[0].telo.bodyParam.date, '20261015');
    check('odmítnutí v message', h.api.tcOdmitnuti({ message: [{ errorCode: 'E1', errorMessage: 'Adapter offline' }] }),
      'Aquarea odmítla dotaz na spotřebu (E1): Adapter offline');
    check('  běžná odpověď není odmítnutí', h.api.tcOdmitnuti(ODPOVED), null);
    const h2 = build({ odpoved: { message: { errorCode: 'E2', errorMessage: 'x' } } });
    let chyba = null;
    try { await h2.api.aquareaSpotrebaNacti('GW-1', '2026-10-15'); } catch (e) { chyba = e.message; }
    check('  odmítnutí je chyba', chyba, 'Aquarea odmítla dotaz na spotřebu (E2): x');
  }
  {
    const h = build();
    const den = ms => new Date(ms);
    check('běžný den: jen tento měsíc', h.api.tcMesiceKNacteni(Date.UTC(2026, 10, 12, 10)).join(' '), '2026-11-12');
    check('do 5. dne i minulý měsíc', h.api.tcMesiceKNacteni(Date.UTC(2026, 10, 2, 10)).join(' '), '2026-10-31 2026-11-02');
    check('  leden → prosinec', h.api.tcMesiceKNacteni(Date.UTC(2027, 0, 3, 10))[0], '2026-12-31');
    check('  6. den už ne', h.api.tcMesiceKNacteni(Date.UTC(2026, 10, 6, 10)).length, 1);
    void den;
  }

  nadpis('Rozbor a slučování');
  {
    const h = build();
    const dny = h.api.aquareaSpotrebaRozeber(ODPOVED);
    check('dny seřazené, prázdné a nesmysly vynechané', dny.map(d => d.d).join(' '), '2026-10-13 2026-10-14 2026-10-15');
    check('-255 = neznámo, text = číslo', JSON.stringify(dny[1]) + ' ' + dny[2].topeni, '{"d":"2026-10-14","topeni":7.25,"voda":1.9,"chlazeni":null,"venku":8} 3.1');
    check('  bez venkovní teploty pole chybí', 'venku' in dny[2], false);
    check('bez seznamu nic', h.api.aquareaSpotrebaRozeber({}).length + h.api.aquareaSpotrebaRozeber(null).length, 0);
    check('záporné = neznámo', h.api.aquareaSpotrebaRozeber({ historyDataList: [{ dataTime: '20261001', heatConsumption: -3 }] }).length, 0);
    h.api.tcSpotrebaSluc(dny, '2026-10-20');
    h.api.tcSpotrebaSluc([{ d: '2026-10-15', topeni: 9, voda: 1, chlazeni: 0 }, { d: '2026-10-21', topeni: 1, voda: 1, chlazeni: 0 }], '2026-10-20');
    check('stejný den se přepíše, budoucí se nebere', h.state.tcSpotreba.dny.map(d => d.d + ':' + d.topeni).join(' '),
      '2026-10-13:6.4 2026-10-14:7.25 2026-10-15:9');
  }

  nadpis('Měsíce');
  {
    const st = { aircon: { aquarea: [] }, months: [{ m: '2026-10', sauna: 0, pool: 0, wb: 0, dum: 300000 }],
      tcSpotreba: { dny: [{ d: '2026-09-30', topeni: 1, voda: 0.5, chlazeni: null }, { d: '2026-10-01', topeni: 6, voda: 2, chlazeni: 0.5 },
        { d: '2026-10-02', topeni: 4, voda: 1, chlazeni: null }], ts: 0, chyba: null } };
    const h = build({ state: st });
    check('změna se hlásí', h.api.tcMesice(), true);
    const r = st.months.find(x => x.m === '2026-10');
    check('říjen: celkem, topení, voda (Wh)', [r.tc, r.tcTopeni, r.tcVoda].join(' '), '13500 10000 3000');
    check('  dům zůstal', r.dum, 300000);
    check('září se založí', st.months.map(x => x.m).join(' '), '2026-09 2026-10');
    check('opakovaně nic nezdvojí', [h.api.tcMesice(), r.tc].join(' '), 'false 13500');
    // Plná řada: měsíc starší než nejstarší se nezakládá
    const plna = Array.from({ length: 13 }, (_, i) => ({ m: `2027-${String(i % 12 + 1).padStart(2, '0')}`.replace('2027-01', i === 12 ? '2028-01' : '2027-01'), sauna: 0, pool: 0, wb: 0, dum: 0 }));
    const h2 = build({ state: { aircon: {}, months: plna, tcSpotreba: { dny: [{ d: '2026-05-01', topeni: 1, voda: 0, chlazeni: 0 }] } } });
    h2.api.tcMesice();
    check('do plné řady se starý měsíc nevnutí', h2.state.months.length + ' ' + h2.state.months.some(x => x.m === '2026-05'), '13 false');
  }

  nadpis('Payload');
  {
    const st = { aircon: {}, months: [], tcSpotreba: { dny: [
      { d: '2026-10-31', topeni: 10, voda: 2, chlazeni: null },
      { d: '2026-11-01', topeni: 8.25, voda: 1.5, chlazeni: null },
      { d: '2026-11-02', topeni: 2, voda: 0.5, chlazeni: null }], ts: 5, chyba: null } };
    const h = build({ state: st });
    const p = h.api.tcSpotrebaPayload(Date.UTC(2026, 10, 2, 12));
    check('dnes', JSON.stringify(p.dnes), '{"topeni":2,"voda":0.5,"celkem":2.5}');
    check('včera', p.vcera.celkem, 9.75);
    check('tento měsíc', JSON.stringify(p.mesic), '{"topeni":10.25,"voda":2,"celkem":12.25}');
    check('minulý měsíc', p.minulyMesic.celkem, 12);
    check('dny, razítko, chyba', [p.dny.length, p.ts, p.chyba].join(' '), '3 5 ');
    const prazdny = build({ state: { aircon: {}, months: [], tcSpotreba: { dny: [], ts: 0, chyba: null } } }).api.tcSpotrebaPayload();
    check('bez dat všude null', [prazdny.dnes, prazdny.vcera, prazdny.mesic].join(','), ',,');
  }

  nadpis('Načítání');
  {
    const h = build();
    await h.api.tcSpotrebaPoll();
    check('načetlo se a uložilo (i po dotažení historie)', [h.state.tcSpotreba.dny.length > 0, h.state.tcSpotreba.ts > 0, h.ulozeno()].join(' '), 'true true 2');
    check('poslalo spotřebu i měsíce', [h.zpravy.includes('tcSpotreba'), h.zpravy.includes('months')].join(' '), 'true true');
    check('  dotazovalo se na guid čerpadla', h.dotazy[0].telo.bodyParam.gwid, 'GW-TAJNE-1');

    const e = build({ chyba: 'HTTP 500' });
    e.state.tcSpotreba.dny.push({ d: '2026-10-01', topeni: 1, voda: 1, chlazeni: 0 });
    await e.api.tcSpotrebaPoll();
    check('chyba: data zůstanou, chyba bez GUID', [e.state.tcSpotreba.dny.length, e.state.tcSpotreba.chyba].join(' '), '1 HTTP 500 …');
    check('  zaloguje se jednou', (await e.api.tcSpotrebaPoll(), e.logy.length), 1);

    const bez = build({ state: { aircon: { aquarea: [] }, months: [], tcSpotreba: { dny: [], ts: 0, chyba: null } } });
    await bez.api.tcSpotrebaPoll();
    check('bez čerpadla se neptá', bez.dotazy.length, 0);
    const vyp = build({ vypnuto: true });
    await vyp.api.tcSpotrebaPoll();
    check('bez Comfort Cloudu se neptá', vyp.dotazy.length, 0);
  }

  nadpis('Starší měsíce (jednou)');
  {
    // Cloud má data jen do srpna 2026, dál prázdno
    const h = build({ fetch: async (c, o) => {
      const d = JSON.parse(o.body).bodyParam.date;
      h.dotazy.push(d);
      return d >= '20260801' ? { historyDataList: [{ dataTime: d.slice(0, 6) + '10', heatConsumption: 1, tankConsumption: 1, coolConsumption: 0, outdoorTemp: 5 }] } : {};
    } });
    await h.api.tcHistorieDotahni('GW-1', Date.UTC(2026, 10, 2, 12));
    check('od předminulého měsíce dozadu, po 2 prázdných konec', h.dotazy.join(' '), '20260915 20260815 20260715 20260615');
    check('  dny uložené, příznak hotovo', h.state.tcSpotreba.dny.map(d => d.d).join(' ') + ' ' + h.state.tcSpotreba.historie, '2026-08-10 2026-09-10 true');
    const plne = build();
    await plne.api.tcHistorieDotahni('GW-1', Date.UTC(2025, 3, 10, 12));
    check('  nejdál do ledna 2025', plne.dotazy.map(d => d.telo.bodyParam.date).join(' '), '20250215 20250115');
    const p = build();
    await p.api.tcSpotrebaPoll();
    const pocet = p.dotazy.length;
    await p.api.tcSpotrebaPoll();
    check('  podruhé už se historie netahá', p.dotazy.length - pocet <= 2, true);
  }

  nadpis('Hodinová spotřeba (pokus)');
  {
    const h = build();
    check('dotaz s dataMode 0 pro daný den', JSON.stringify(h.api.tcSpotrebaHodinyTelo('G', '2026-11-08').bodyParam),
      JSON.stringify({ gwid: 'G', dataMode: 0, date: '20261108', osTimezone: '+01:00' }));
    const dlouhe = { historyDataList: [
      { dataTime: '2026110800', heatConsumption: 0.8, tankConsumption: -255 },
      { dataTime: '2026110801', heatConsumption: '1.2', tankConsumption: 0.3 },
      { dataTime: '2026110701', heatConsumption: 5 },                          // jiný den
      { dataTime: '2026110802', heatConsumption: -255, tankConsumption: -255 }  // ještě nic
    ] };
    check('rozbor hodin (YYYYMMDDHH)', JSON.stringify(h.api.aquareaHodinyRozeber(dlouhe, '2026-11-08')),
      JSON.stringify([{ k: '2026-11-08 00', topeni: 0.8, voda: null }, { k: '2026-11-08 01', topeni: 1.2, voda: 0.3 }]));
    check('  krátký čas (HH)', h.api.aquareaHodinyRozeber({ historyDataList: [{ dataTime: '7', heatConsumption: 1 }] }, '2026-11-08')[0].k, '2026-11-08 07');
    check('  bez času jen při 24 položkách', [
      h.api.aquareaHodinyRozeber({ historyDataList: Array.from({ length: 24 }, (_, i) => ({ heatConsumption: i === 5 ? 1 : -255 })) }, '2026-11-08').map(x => x.k).join(),
      h.api.aquareaHodinyRozeber({ historyDataList: [{ heatConsumption: 1 }] }, '2026-11-08').length].join(' '), '2026-11-08 05 0');
    check('  denní data (YYYYMMDD) se za hodiny nevydávají', h.api.aquareaHodinyRozeber(ODPOVED, '2026-10-14').length, 0);
    const now = Date.UTC(2026, 10, 8, 12);
    h.state.tcSpotreba.hodiny = [{ k: '2026-09-01 00', topeni: 1, voda: 1 }, { k: '2026-11-08 00', topeni: 0.1, voda: null }];
    h.api.tcHodinySluc([{ k: '2026-11-08 00', topeni: 0.8, voda: null }], now);
    check('slučování: novější přepíše, starší 40 dní pryč', JSON.stringify(h.state.tcSpotreba.hodiny), JSON.stringify([{ k: '2026-11-08 00', topeni: 0.8, voda: null }]));

    const p = build({ odpoved: dlouhe });
    p.state.tcSpotreba.hodiny = [];
    check('poll: včera i dnes, uloží (každému dni jeho hodiny)', await p.api.tcHodinyPoll('G', Date.UTC(2026, 10, 8, 10)) + ' ' + p.state.tcSpotreba.hodiny.map(x => x.k).join(), '3 2026-11-07 01,2026-11-08 00,2026-11-08 01');
    check('  příznak, že cloud hodiny dává', p.state.tcSpotreba.hodinyOk, true);
    const pred = p.dotazy.length;
    await p.api.tcHodinyPoll('G', Date.UTC(2026, 10, 8, 11));
    check('  příště už jen dnešek', p.dotazy.length - pred, 1);
    const den = build();
    await den.api.tcSpotrebaPoll();
    check('denní načítání jde dál, i když hodiny nic nedají', [den.state.tcSpotreba.dny.length > 0, (den.state.tcSpotreba.hodiny || []).length, !!den.state.tcSpotreba.chyba].join(' '), 'true 0 false');
    const pad = build({ fetch: async (c, o) => { if (JSON.parse(o.body).bodyParam.dataMode === 0) throw new Error('x'); return ODPOVED; } });
    await pad.api.tcSpotrebaPoll();
    check('  chyba hodin denní data neshodí ani nezaloguje', JSON.stringify([pad.state.tcSpotreba.dny.length > 0, pad.state.tcSpotreba.chyba, pad.logy.length]), '[true,null,0]');
  }

  nadpis('Diagnostika a obnova');
  {
    const h = build();
    const { out } = await h.volej('get', '/api/aquarea/spotreba/diagnostika');
    check('diagnostika: tvar a první záznamy', [out.ok, out.klice.join(','), out.zaznamu, out.prvni.length].join(' '),
      'true dateString,energyShowing,historyDataList 6 3');
    check('  bez GUID', JSON.stringify(out).includes('GW-TAJNE'), false);
    check('  ukáže i hodinový pokus', [out.hodinove.zaznamu, out.hodinove.rozebrano.length].join(' '), '6 0');
    const e = build({ chyba: 'pád' });
    const d2 = (await e.volej('get', '/api/aquarea/spotreba/diagnostika')).out;
    check('  chyba bez GUID', [d2.ok, d2.chyba].join(' '), 'false pád …');
    const z = build({ zamceno: true });
    check('  zamčená', (await z.volej('get', '/api/aquarea/spotreba/diagnostika')).kod, 401);

    const r = build();
    r.state.tcSpotreba.dny.push({ d: '2026-10-02', topeni: 9, voda: 9, chlazeni: null });
    const o = await r.volej('post', '/api/aquarea/spotreba/restore', { ts: 7, dny: [
      { d: '2026-10-01', topeni: 5, voda: 1, chlazeni: null },
      { d: '2026-10-02', topeni: 1, voda: 1, chlazeni: null },
      { d: '2099-01-01', topeni: 1, voda: 1 },
      { d: '2026-10-03', topeni: 'x', voda: 1 },
      { d: '2026-10-04', topeni: 9999, voda: 1 },
      { d: '2026-10-05' }, { d: '2026-10-06', topeni: 1, voda: 0, venku: 4.5 }, { d: '2026-10-07', topeni: 1, voda: 0, venku: 99 }], historie: true });
    check('obnova: přidá jen nové platné dny', [o.out.pridano, r.state.tcSpotreba.dny.map(d => d.d + ':' + d.topeni).join(' ')].join(' | '),
      '3 | 2026-10-01:5 2026-10-02:9 2026-10-06:1 2026-10-07:1');
    check('  venku jen rozumné, příznak historie', [r.state.tcSpotreba.dny[2].venku, 'venku' in r.state.tcSpotreba.dny[3], r.state.tcSpotreba.historie].join(' '), '4.5 false true');
    check('  razítko a měsíce', [r.state.tcSpotreba.ts, r.state.months[0].tc].join(' '), '7 26000');
    check('  bez dny = 400', (await r.volej('post', '/api/aquarea/spotreba/restore', {})).kod, 400);
    r.state.tcSpotreba.hodiny = [{ k: '2099-01-01 05', topeni: 0.5, voda: 0 }];
    await r.volej('post', '/api/aquarea/spotreba/restore', { dny: [], hodiny: [
      { k: '2099-01-01 05', topeni: 9, voda: 0 }, { k: '2099-01-01 06', topeni: 0.4, voda: null },
      { k: 'nesmysl', topeni: 1, voda: 1 }, { k: '2099-01-01 07', topeni: 99, voda: 0 }] });
    check('obnova hodin: jen platné nové, uložené nepřepíše', JSON.stringify(r.state.tcSpotreba.hodiny),
      JSON.stringify([{ k: '2099-01-01 05', topeni: 0.5, voda: 0 }, { k: '2099-01-01 06', topeni: 0.4, voda: null }]));
  }
  konec();
})();
