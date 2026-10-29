// Tepelné čerpadlo (Panasonic Aquarea): čtení zón a nádrže ze skupiny Comfort Cloudu
// a povely z boxu na Klimě — režim, posun topení, teplota vody, ohřát hned.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('aquarea');

const CODE = ['const PCC_INVALID_TEMP = 126;', fn('function aquaNum('), fn('function pragueTime('), fn('function pragueDateString('),
  between('// Detail Aquarey jako integrace', '// Diagnostika: struktura skupin')].join('\n');

const GROUP = {
  deviceGuid: 'GW-1', deviceName: 'Aquarea', connectionStatus: 1, operationStatus: 1, operationMode: 1, forceDHW: 0,
  zoneStatus: [{ zoneId: 1, zoneName: 'House', temperatureNow: 34, heatSet: 2, heatMin: -5, heatMax: 5, operationStatus: 1 },
    { zoneId: 2, zoneName: 'Zone2', temperatureNow: 126, heatSet: 0, heatMin: -5, heatMax: 5, operationStatus: 1 }],
  tankStatus: { temperatureNow: 48, heatSet: 50, heatMin: 40, heatMax: 60, operationStatus: 0 }
};

// Celý blok s podvrženým Comfort Cloudem, stavem a „Nejsme doma"
function build(o = {}) {
  const routy = {}, zpravy = [], logy = [], povely = [];
  const pccDevCache = { ts: 123 };
  const state = o.state || { aircon: { aquarea: [] } };
  const pccApiFetch = o.fetch || (async (cesta, opts) => {
    povely.push({ cesta, telo: JSON.parse(opts.body) }); if (o.chyba) throw new Error(o.chyba); return {}; });
  const api = new Function('app', 'requireAuth', 'broadcast', 'addLog', 'pccQueued', 'pccApiFetch', 'pccDevCache', 'state', 'awayActive',
    CODE + '\n; return { pccAquareaFromGroup, aquareaRezim, aquareaTeloRezimu, pccAquareaDetail, aquareaProgramOver, aquareaProgramUsek,'
      + ' aquareaProgramKroky, runAquareaProgram, aquareaOdchodPlan, aquareaNavratPlan, aquareaKrokyProvest, aquareaProgramVychozi };')(
    { post: (c, h) => { routy[c] = h; } },
    (req, res) => { if (!o.zamceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    (u, d) => zpravy.push(u), t => logy.push(t), f => f(), pccApiFetch, pccDevCache, state, () => !!o.pryc);
  const volej = async (cesta, body) => {
    let out, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    await routy[cesta]({ body }, res);
    return { out, kod };
  };
  return { api, routy, zpravy, logy, povely, pccDevCache, state, volej };
}

(async () => {
  nadpis('Čtení ze skupiny');
  const h0 = build();
  const aq = h0.api.pccAquareaFromGroup(GROUP);
  check('zařízení: zapnuto, režim, ohřev vody', [aq.zapnuto, aq.rezimKod, aq.ohrevVody].join(' '), 'true 1 false');
  check('zóna: id, teplota, posun, rozsah, relativní', JSON.stringify([aq.zones[0].zoneId, aq.zones[0].temp, aq.zones[0].target, aq.zones[0].min, aq.zones[0].max, aq.zones[0].relativni]),
    '[1,34,2,-5,5,true]');
  check('nádrž: teplota, cíl, rozsah, zapnutá', [aq.tankTemp, aq.tankTarget, aq.tankMin, aq.tankMax, aq.tankOn].join(' '), '48 50 40 60 false');
  check('režim z toho, co je zapnuté', h0.api.aquareaRezim(aq), 'topeni');
  const abs = h0.api.pccAquareaFromGroup({ zoneStatus: [{ zoneId: 1, heatSet: 35 }], tankStatus: {} });
  check('bez rozsahu: 35 °C = absolutní cíl', abs.zones[0].relativni, false);
  check('  bez rozsahu: +3 = posun křivky', h0.api.pccAquareaFromGroup({ zoneStatus: [{ zoneId: 1, heatSet: 3 }] }).zones[0].relativni, true);
  check('  zóna bez id dostane pořadí', h0.api.pccAquareaFromGroup({ zoneStatus: [{ heatSet: 3 }] }).zones[0].zoneId, 1);

  check('zóna 2 se nepoužívá', aq.zones.map(z => z.zoneId + ':' + z.pouzita).join(' '), '1:true 2:false');
  {
    // Detail zařízení: deviceDirect=1, při chybě 0; status (objekt i pole)
    const volani = [];
    let odpovedi = [new Error('live nejde'), { status: [{ zoneStatus: [{ zoneId: 1, heatSet: 3 }] }] }];
    const h = build({ fetch: async (c, o) => {
      volani.push(JSON.parse(o.body).apiName); const r = odpovedi.shift(); if (r instanceof Error) throw r; return r; } });
    const det = h.api.pccAquareaDetail;
    const st = await det('GW-1');
    check('detail: živý, při chybě uložený', volani.join(' | '), '/remote/v1/api/devices?gwid=GW-1&deviceDirect=1 | /remote/v1/api/devices?gwid=GW-1&deviceDirect=0');
    check('  status z pole', JSON.stringify(st), '{"zoneStatus":[{"zoneId":1,"heatSet":3}]}');
    const slouceno = h.api.pccAquareaFromGroup({ connectionStatus: 1, zoneStatus: [{ zoneId: 1 }], ...st });
    check('  sloučení: cíl z detailu, spojení ze skupiny', slouceno.zones[0].target + ' ' + slouceno.online, '3 true');
    odpovedi = [new Error('x'), new Error('y')];
    check('  obojí selže → null', await det('GW-1'), null);
  }

  nadpis('Povely');
  const pripravit = (o = {}) => {
    const h = build(o);
    h.state.aircon = { aquarea: [{ guid: 'GW-1', name: 'Aquarea', ...h.api.pccAquareaFromGroup(GROUP) }] };
    const st = h.state;
    const volej = async body => h.volej('/api/aquarea', { guid: 'GW-1', ...body });
    return { ...h, st, volej, aq: st.aircon.aquarea[0] };
  };
  {
    const h = pripravit();
    const r = await h.volej({ rezim: 'oboji' });
    check('režim obojí: OK', r.kod, 200);
    check('  transfer na /remote/v1/api/devices', h.povely[0].cesta + ' ' + h.povely[0].telo.apiName + ' ' + h.povely[0].telo.requestMethod,
      '/remote/v1/app/common/transfer /remote/v1/api/devices POST');
    check('  kompletní stav: zóny, nádrž, zapnuto, topení', JSON.stringify(h.povely[0].telo.bodyParam),
      JSON.stringify({ gwid: 'GW-1', operationStatus: 1, zoneStatus: [{ zoneId: 1, operationStatus: 1 }, { zoneId: 2, operationStatus: 1 }], tankStatus: { operationStatus: 1 }, operationMode: 2 }));
    check('  stav hned upravený a poslaný appce', h.api.aquareaRezim(h.aq) + ' ' + h.zpravy.join(), 'oboji aircon');
    check('  log', h.logy.join(), 'Tepelné čerpadlo: topení + voda');
    check('  cache zneplatněná', h.pccDevCache.ts, 0);
    await h.volej({ rezim: 'voda' });
    check('režim voda: zóna 1 vyp., zóna 2 beze změny, nádrž 1', JSON.stringify([h.povely[1].telo.bodyParam.zoneStatus, h.povely[1].telo.bodyParam.tankStatus]),
      '[[{"zoneId":1,"operationStatus":0},{"zoneId":2,"operationStatus":1}],{"operationStatus":1}]');
    check('  zóna 2 ve stavu nezměněná', h.aq.zones[1].on, true);
    await h.volej({ rezim: 'vypnuto' });
    check('vypnuto: vše 0, bez režimu', JSON.stringify(h.povely[2].telo.bodyParam),
      JSON.stringify({ gwid: 'GW-1', operationStatus: 0, zoneStatus: [{ zoneId: 1, operationStatus: 0 }, { zoneId: 2, operationStatus: 1 }], tankStatus: { operationStatus: 0 } }));
    check('  appka ukáže vypnuto', h.api.aquareaRezim(h.aq), 'vypnuto');
    check('neznámý režim 400', (await h.volej({ rezim: 'turbo' })).kod, 400);
  }
  {
    const h = pripravit();
    const r = await h.volej({ zona: { zoneId: 1, heatSet: 4 } });
    check('posun topení +4', r.kod + ' ' + JSON.stringify(h.povely[0].telo.bodyParam), '200 {"gwid":"GW-1","zoneStatus":[{"zoneId":1,"heatSet":4}]}');
    check('  hned v appce, bez logu', h.aq.zones[0].target + ' ' + h.logy.length, '4 0');
    check('  +6 mimo rozsah', (await h.volej({ zona: { zoneId: 1, heatSet: 6 } })).out.error, 'Posun musí být -5 až +5 °C.');
    check('  půlstupně ne', (await h.volej({ zona: { zoneId: 1, heatSet: 1.5 } })).kod, 400);
    check('  neznámá zóna', (await h.volej({ zona: { zoneId: 9, heatSet: 1 } })).kod, 400);
    check('  zóna 2 se neovládá', (await h.volej({ zona: { zoneId: 2, heatSet: 1 } })).kod, 400);
    check('  nic dalšího neodešlo', h.povely.length, 1);
  }
  {
    const h = pripravit();
    check('voda 55 °C', (await h.volej({ nadrz: 55 })).kod + ' ' + JSON.stringify(h.povely[0].telo.bodyParam.tankStatus) + ' ' + h.aq.tankTarget, '200 {"heatSet":55} 55');
    check('  nad rozsahem nádrže', (await h.volej({ nadrz: 62 })).out.error, 'Teplota vody musí být 40–60 °C.');
    await h.volej({ ohrevVody: true });
    check('ohřát hned', JSON.stringify(h.povely[1].telo.bodyParam) + ' ' + h.aq.ohrevVody + ' | ' + h.logy.pop(), '{"gwid":"GW-1","forceDHW":1} true | Tepelné čerpadlo: ohřát vodu hned');
    check('bez akce 400', (await h.volej({})).kod, 400);
  }
  {
    const h = pripravit({ chyba: 'Panasonic API HTTP 500' });
    const r = await h.volej({ rezim: 'vypnuto' });
    check('chyba Panasonicu: 502 a stav beze změny', r.kod + ' ' + h.api.aquareaRezim(h.aq) + ' ' + h.zpravy.length, '502 topeni 0');
    const z = pripravit({ zamceno: true });
    check('zamčená appka 401', (await z.volej({ rezim: 'voda' })).kod + ' ' + z.povely.length, '401 0');
    check('neznámé čerpadlo 400', (await h.volej({ guid: 'JINE', rezim: 'voda' })).kod, 400);
  }
  nadpis('Program');
  {
    const h = build();
    const V = h.api.aquareaProgramVychozi();
    check('výchozí podle plánu z Panasonicu, vypnutý', JSON.stringify(V),
      JSON.stringify({ zapnuto: false, topeni: [{ od: '00:00', posun: 0 }, { od: '11:00', posun: 1 }, { od: '17:00', posun: 0 }],
        voda: [{ od: '00:00', teplota: 43 }, { od: '06:00', teplota: null }, { od: '09:00', teplota: 43 }] }));
    const over = p => h.api.aquareaProgramOver(p);
    check('ověření: seřadí', JSON.stringify(over({ ...V, topeni: [{ od: '11:00', posun: 1 }, { od: '00:00', posun: 0 }] }).program.topeni), '[{"od":"00:00","posun":0},{"od":"11:00","posun":1}]');
    check('  bez 00:00', over({ ...V, topeni: [{ od: '01:00', posun: 0 }] }).chyba, 'Topení: první úsek musí začínat v 00:00.');
    check('  čas po čtvrthodinách', over({ ...V, voda: [{ od: '00:00', teplota: 43 }, { od: '06:10', teplota: 43 }] }).chyba, 'Voda: čas musí být po čtvrthodinách (HH:MM).');
    check('  dvojí čas', over({ ...V, topeni: [{ od: '00:00', posun: 0 }, { od: '00:00', posun: 1 }] }).chyba, 'Topení: dva úseky ve stejný čas.');
    check('  posun ±5', !!over({ ...V, topeni: [{ od: '00:00', posun: 6 }] }).chyba + ' ' + !!over({ ...V, topeni: [{ od: '00:00', posun: 1.5 }] }).chyba, 'true true');
    check('  voda 40–60 nebo vyp.', !!over({ ...V, voda: [{ od: '00:00', teplota: 65 }] }).chyba + ' ' + over({ ...V, voda: [{ od: '00:00', teplota: null }] }).program.voda[0].teplota, 'true null');
    check('  nejvýš 12 úseků', !!over({ ...V, topeni: Array.from({ length: 13 }, (_, i) => ({ od: String(i).padStart(2, '0') + ':00', posun: 0 })) }).chyba, true);
    // Praha = UTC+1 (zimní čas 29. 10. 2026)
    const P = (hh, mm = 0) => Date.UTC(2026, 9, 29, hh - 1, mm);
    const us = t => { const u = h.api.aquareaProgramUsek(V, t); return u.topeni.posun + '/' + u.voda.teplota; };
    check('úsek: 5:59, 6:00, 10:59, 11:00, 17:00, 23:59', [us(P(5, 59)), us(P(6)), us(P(10, 59)), us(P(11)), us(P(17)), us(P(23, 59))].join(' '),
      '0/43 0/null 0/43 1/43 0/43 0/43');
    check('  klíč se mění se dnem i úsekem', h.api.aquareaProgramUsek(V, P(11)).klic + ' | ' + h.api.aquareaProgramUsek(V, P(23, 59) + 60000).klic,
      '2026-10-29 11:00 09:00 | 2026-10-30 00:00 00:00');
  }
  {
    // Kroky podle stavu čerpadla
    const h = build();
    const aqz = (topi, voda, posun = 0, tank = 43) => ({ guid: 'GW-1', tankOn: voda, tankTarget: tank, zapnuto: topi || voda,
      zones: [{ zoneId: 1, on: topi, target: posun, pouzita: true }, { zoneId: 2, on: false, pouzita: false }] });
    const k = (aq, t, v) => JSON.stringify(h.api.aquareaProgramKroky(aq, { topeni: { posun: t }, voda: { teplota: v } }));
    check('obojí, úsek +1/43: jen posun', k(aqz(true, true, 0), 1, 43), '[{"zona":{"zoneId":1,"heatSet":1}}]');
    check('topení vypnuté (léto): na topení nesahá', k(aqz(false, true, 0), 1, 43), '[]');
    check('voda vyp. při obojí → topení', k(aqz(true, true, 0), 0, null), '[{"rezim":"topeni"}]');
    check('voda vyp. když jen voda → vypnuto', k(aqz(false, true), 0, null), '[{"rezim":"vypnuto"}]');
    check('voda 43 při topení → obojí', k(aqz(true, false, 0, 43), 0, 43), '[{"rezim":"oboji"}]');
    check('voda 45 při vypnutém → voda + 45 °C', k(aqz(false, false, 0, 43), 0, 45), '[{"rezim":"voda"},{"nadrz":45}]');
  }
  {
    // Spouštění: jen při přechodu úseku, ne každý běh
    const h = build({ state: { aircon: { aquarea: [] }, aquareaProgram: null } });
    h.state.aircon.aquarea = [{ guid: 'GW-1', ...h.api.pccAquareaFromGroup(GROUP) }];   // topení +2, voda vyp.
    const P = (hh, mm = 0) => Date.UTC(2026, 9, 29, hh - 1, mm);
    h.state.aquareaProgram = { ...h.api.aquareaProgramVychozi(), zapnuto: false };
    await h.api.runAquareaProgram(P(11, 5));
    check('vypnutý program nic', h.povely.length, 0);
    h.state.aquareaProgram.zapnuto = true;
    await h.api.runAquareaProgram(P(11, 5));
    check('zapnutý v 11:05: obojí, voda 43 (bylo 50), posun +1', h.povely.map(p => JSON.stringify(p.telo.bodyParam.zoneStatus || p.telo.bodyParam.tankStatus)).join(' | '),
      '[{"zoneId":1,"operationStatus":1},{"zoneId":2,"operationStatus":1}] | {"heatSet":43} | [{"zoneId":1,"heatSet":1}]');
    check('  log', h.logy.pop(), 'Tepelné čerpadlo (program): topení + voda, voda 43 °C, topení +1 °C');
    // ruční změna uprostřed úseku se nepřepisuje
    h.state.aircon.aquarea[0].zones[0].target = 3;
    await h.api.runAquareaProgram(P(12));
    check('  ruční změna platí do dalšího úseku', h.povely.length + ' ' + h.state.aircon.aquarea[0].zones[0].target, '3 3');
    await h.api.runAquareaProgram(P(17));
    check('  v 17:00 zpátky na 0', JSON.stringify(h.povely[3].telo.bodyParam.zoneStatus) + ' ' + h.state.aircon.aquarea[0].zones[0].target, '[{"zoneId":1,"heatSet":0}] 0');
    const pryc = build({ pryc: true, state: { aircon: { aquarea: [{ guid: 'GW-1', ...h.api.pccAquareaFromGroup(GROUP) }] }, aquareaProgram: { ...h.api.aquareaProgramVychozi(), zapnuto: true } } });
    await pryc.api.runAquareaProgram(P(11));
    check('nejsme doma: program stojí', pryc.povely.length, 0);
    const chyba = build({ chyba: 'HTTP 500', state: { aircon: { aquarea: [{ guid: 'GW-1', ...h.api.pccAquareaFromGroup(GROUP) }] }, aquareaProgram: { ...h.api.aquareaProgramVychozi(), zapnuto: true } } });
    await chyba.api.runAquareaProgram(P(11));
    await chyba.api.runAquareaProgram(P(11, 5));
    check('chyba: zkusí se znovu při dalším běhu', chyba.povely.length + ' ' + /chyba/.test(chyba.logy[0]), '2 true');
  }
  {
    // Endpoint programu
    const h = build({ state: { aircon: { aquarea: [] }, aquareaProgram: null } });
    const V = h.api.aquareaProgramVychozi();
    const r = await h.volej('/api/aquarea/program', { program: { ...V, zapnuto: true, voda: [{ od: '00:00', teplota: 45 }] } });
    check('uložení programu', r.kod + ' ' + h.state.aquareaProgram.zapnuto + ' ' + h.state.aquareaProgram.voda[0].teplota + ' ' + h.zpravy.includes('aquareaProgram'), '200 true 45 true');
    check('  log zapnutí', h.logy.includes('Tepelné čerpadlo: program zapnut'), true);
    check('  chybný → 400', (await h.volej('/api/aquarea/program', { program: { ...V, topeni: [] } })).kod, 400);
    check('  záloha nepřepíše upravený', (await h.volej('/api/aquarea/program/restore', { program: V })).kod + ' ' + h.state.aquareaProgram.voda[0].teplota, '200 45');
    const z = build({ zamceno: true, state: { aircon: { aquarea: [] }, aquareaProgram: null } });
    check('  zamčeno 401', (await z.volej('/api/aquarea/program', { program: V })).kod, 401);
  }

  nadpis('Nejsme doma');
  {
    const h = build();
    const aqz = (topi, voda, posun) => ({ guid: 'GW-1', tankOn: voda, zapnuto: topi || voda,
      zones: [{ zoneId: 1, on: topi, target: posun, min: -5, max: 5, pouzita: true }] });
    const od = aq => JSON.stringify(h.api.aquareaOdchodPlan(aq));
    check('obojí → topení a −5, uloží obojí/+2', od(aqz(true, true, 2)), JSON.stringify({ pred: { guid: 'GW-1', rezim: 'oboji', posun: 2 }, kroky: [{ rezim: 'topeni' }, { zona: { zoneId: 1, heatSet: -5 } }] }));
    check('jen topení → −5', JSON.stringify(h.api.aquareaOdchodPlan(aqz(true, false, 0)).kroky), '[{"zona":{"zoneId":1,"heatSet":-5}}]');
    check('jen voda → vypnuto', JSON.stringify(h.api.aquareaOdchodPlan(aqz(false, true, 0)).kroky), '[{"rezim":"vypnuto"}]');
    check('vypnuto (léto bez vody) → nic', JSON.stringify(h.api.aquareaOdchodPlan(aqz(false, false, 0)).kroky), '[]');
    const nv = (pred, aq) => JSON.stringify(h.api.aquareaNavratPlan(pred, aq));
    check('návrat: obojí a posun zpátky', nv({ guid: 'GW-1', rezim: 'oboji', posun: 2 }, aqz(true, false, -5)), '[{"rezim":"oboji"},{"zona":{"zoneId":1,"heatSet":2}}]');
    check('návrat: voda', nv({ guid: 'GW-1', rezim: 'voda', posun: 0 }, aqz(false, false, 0)), '[{"rezim":"voda"}]');
    check('návrat: nic se nezměnilo → nic', nv({ guid: 'GW-1', rezim: 'topeni', posun: 0 }, aqz(true, false, 0)), '[]');
    // Provedení odchodu přes povely
    const p = build({ state: { aircon: { aquarea: [aqz(true, true, 2)] } } });
    const log = await p.api.aquareaKrokyProvest(p.state.aircon.aquarea[0], p.api.aquareaOdchodPlan(p.state.aircon.aquarea[0]).kroky);
    check('  provedení: dva povely, popis do logu', p.povely.length + ' | ' + log, '2 | tepelné čerpadlo: topení, topení -5 °C');
  }

  const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const runA = SRC.slice(SRC.indexOf('async function runAutomation('));
  check('program běží v každém běhu, před vypínačem automatiky', runA.indexOf('await runAquareaProgram();') > 0 && runA.indexOf('await runAquareaProgram();') < runA.indexOf('if (!autoRunning()) return'), true);
  const nav = SRC.slice(SRC.indexOf('async function awayNavrat('), SRC.indexOf("app.post('/api/away'"));
  check('návrat čerpadla před vypínačem automatiky', nav.indexOf('aquareaNavratPlan') > 0 && nav.indexOf('aquareaNavratPlan') < nav.indexOf('if (!autoRunning())'), true);
  check('odchod plánuje čerpadlo', /aquareaOdchodPlan\(aqOd\)[\s\S]{0,200}zkus\('tepelné čerpadlo'/.test(SRC), true);
  check('záloha: program a aquareaPred', SRC.includes("'/api/aquarea/program/restore',") && SRC.includes("'/api/aquarea/program/restore': { program: state.aquareaProgram }") && SRC.includes('aquareaPred: (state.away && state.away.aquareaPred) || null'), true);
  check('seznam zařízení bere u Aquarey detail', /const detail = await pccAquareaDetail\(d\.deviceGuid\);[\s\S]{0,200}pccAquareaFromGroup\(\{ \.\.\.d, \.\.\.\(detail \|\| \{\}\) \}\)/.test(SRC), true);
  konec();
})();
