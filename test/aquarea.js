// Tepelné čerpadlo (Panasonic Aquarea): čtení zón a nádrže ze skupiny Comfort Cloudu
// a povely z boxu na Klimě — režim, posun topení, teplota vody, ohřát hned.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('aquarea');

const CODE = ['const PCC_INVALID_TEMP = 126;', fn('function aquaNum('),
  between('function pccAquareaFromGroup(', '// Diagnostika: struktura skupin')].join('\n');

const GROUP = {
  deviceGuid: 'GW-1', deviceName: 'Aquarea', connectionStatus: 1, operationStatus: 1, operationMode: 1, forceDHW: 0,
  zoneStatus: [{ zoneId: 1, zoneName: 'House', temperatureNow: 34, heatSet: 2, heatMin: -5, heatMax: 5, operationStatus: 1 }],
  tankStatus: { temperatureNow: 48, heatSet: 50, heatMin: 40, heatMax: 60, operationStatus: 0 }
};

function build({ odemceno = true, chyba = null } = {}) {
  const routy = {}, zpravy = [], logy = [], povely = [];
  const pccDevCache = { ts: 123 };
  const api = new Function('app', 'requireAuth', 'broadcast', 'addLog', 'pccQueued', 'pccApiFetch', 'pccDevCache', 'state',
    CODE + '\n; return { pccAquareaFromGroup, aquareaRezim, aquareaTeloRezimu };')(
    { post: (c, h) => { routy[c] = h; } },
    (req, res) => { if (odemceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    (u, d) => zpravy.push(u), t => logy.push(t), f => f(),
    async (cesta, opts) => { povely.push({ cesta, telo: JSON.parse(opts.body) }); if (chyba) throw new Error(chyba); return {}; },
    pccDevCache, null);
  return { api, routy, zpravy, logy, povely, pccDevCache };
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

  nadpis('Povely');
  const pripravit = (o = {}) => {
    const h = build(o);
    const a = h.api.pccAquareaFromGroup(GROUP);
    const st = { aircon: { aquarea: [{ guid: 'GW-1', name: 'Aquarea', ...a }] } };
    // stav pro endpoint: state je parametr funkce → podvrhnout přes new Function znovu
    const routy = {};
    const api2 = new Function('app', 'requireAuth', 'broadcast', 'addLog', 'pccQueued', 'pccApiFetch', 'pccDevCache', 'state',
      CODE + '\n; return {};')({ post: (c, f) => { routy[c] = f; } },
      (req, res) => { if (!o.zamceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
      u => h.zpravy.push(u), t => h.logy.push(t), f => f(),
      async (cesta, opts) => { h.povely.push({ cesta, telo: JSON.parse(opts.body) }); if (o.chyba) throw new Error(o.chyba); return {}; },
      h.pccDevCache, st);
    const volej = async body => {
      let out, kod = 200;
      const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
      await routy['/api/aquarea']({ body: { guid: 'GW-1', ...body } }, res);
      return { out, kod };
    };
    return { ...h, st, volej, aq: st.aircon.aquarea[0] };
  };
  {
    const h = pripravit();
    const r = await h.volej({ rezim: 'oboji' });
    check('režim obojí: OK', r.kod, 200);
    check('  transfer na /remote/v1/api/devices', h.povely[0].cesta + ' ' + h.povely[0].telo.apiName + ' ' + h.povely[0].telo.requestMethod,
      '/remote/v1/app/common/transfer /remote/v1/api/devices POST');
    check('  kompletní stav: zóny, nádrž, zapnuto, topení', JSON.stringify(h.povely[0].telo.bodyParam),
      JSON.stringify({ gwid: 'GW-1', operationStatus: 1, zoneStatus: [{ zoneId: 1, operationStatus: 1 }], tankStatus: { operationStatus: 1 }, operationMode: 2 }));
    check('  stav hned upravený a poslaný appce', h.api.aquareaRezim(h.aq) + ' ' + h.zpravy.join(), 'oboji aircon');
    check('  log', h.logy.join(), 'Tepelné čerpadlo: topení + voda');
    check('  cache zneplatněná', h.pccDevCache.ts, 0);
    await h.volej({ rezim: 'voda' });
    check('režim voda: zóna 0, nádrž 1', JSON.stringify([h.povely[1].telo.bodyParam.zoneStatus, h.povely[1].telo.bodyParam.tankStatus]), '[[{"zoneId":1,"operationStatus":0}],{"operationStatus":1}]');
    await h.volej({ rezim: 'vypnuto' });
    check('vypnuto: vše 0, bez režimu', JSON.stringify(h.povely[2].telo.bodyParam),
      JSON.stringify({ gwid: 'GW-1', operationStatus: 0, zoneStatus: [{ zoneId: 1, operationStatus: 0 }], tankStatus: { operationStatus: 0 } }));
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
  konec();
})();
