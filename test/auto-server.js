// Auto VW na straně appky: stav od mostu na NASu (procenta, dojezd, nabíjení).
//
// Co se hlídá: z mostu se bere jen to, co má tvar; mlčící most appka přizná;
// chyba z cloudu nepřepíše poslední známá procenta; do Logu jen začátek a konec
// nabíjení a potíž s přihlášením.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('auto (appka)');

const CODE = between('// ---------- Auto VW (most na NASu) ----------',
                     '// ---------- Sekačka Anthbot (cloud) ----------');

function build() {
  const logy = [], zpravy = [], routy = {};
  const api = new Function('app', 'addLog', 'broadcast',
    CODE + '\n; return { autoZive, autoPayload, autoOcisti, autoZmena, AUTO_TICHO_MS,'
         + ' get kdy() { return autoKdy; }, set kdy(v) { autoKdy = v; } };'
  )({ post: (c, fn) => { routy['POST ' + c] = fn; } }, t => logy.push(t), (typ, data) => zpravy.push({ typ, data }));
  const volej = telo => {
    let out = null, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    routy['POST /api/auto/stav']({ body: telo }, res);
    return { out, kod };
  };
  return { api, logy, zpravy, volej };
}

const STAV = { soc: 78, dojezdKm: 320, nabijeni: 'off', nabiji: false, cilSoc: 80, vykonKw: null,
  hotovoV: null, zmerenoV: '2026-09-29T08:00:00+00:00', model: 'ID.4' };

nadpis('1) Hlášení mostu');
{
  const h = build();
  check('bez hlášení most nežije', h.api.autoZive(), false);
  check('hlášení projde', h.volej(STAV).kod, 200);
  const p = h.api.autoPayload();
  check('  procenta, dojezd, cíl', [p.stav.soc, p.stav.dojezdKm, p.stav.cilSoc].join(','), '78,320,80');
  check('  čas měření jako ISO', p.stav.zmerenoV, '2026-09-29T08:00:00.000Z');
  check('  most žije a jde to do appky', p.zive + ' ' + h.zpravy.pop().typ, 'true auto');
  check('nesmysl neprojde', h.volej(null).kod + ' ' + h.volej([1]).kod, '400 400');
  const d = h.api.autoOcisti({ soc: 150, dojezdKm: 'x', nabiji: 'ano', hotovoV: 'včera', heslo: 'tajne' });
  check('mimo rozsah a nesmysly se zahodí', [d.soc, d.dojezdKm, d.nabiji, d.hotovoV].join(','), ',,,');
  check('  a cizí pole se nepřevezmou', 'heslo' in d, false);
  h.api.kdy = Date.now() - h.api.AUTO_TICHO_MS - 1;
  check('35 min ticha = most mlčí', h.api.autoZive(), false);
  h.volej(STAV);
  check('  a když se ozve, řekne se to', h.logy.includes('Auto: most na NASu se zase ozývá'), true);
}

nadpis('2) Log a chyby');
{
  const h = build();
  h.volej(STAV);
  check('první hlášení Log nezaplní', h.logy.length, 0);
  h.volej({ ...STAV, nabijeni: 'charging', nabiji: true, soc: 54 });
  check('začátek nabíjení do Logu', h.logy.slice(-1)[0], 'Auto: nabíjí se (54 %)');
  h.volej({ ...STAV, nabijeni: 'charging', nabiji: true, soc: 60 });
  check('  průběh ne', h.logy.length, 1);
  h.volej({ ...STAV, soc: 80 });
  check('konec nabíjení do Logu', h.logy.slice(-1)[0], 'Auto: nabíjení skončilo (80 %)');
  h.volej({ chyba: 'VW odmítl přihlášení — zkontroluj heslo v auto.config.json.' });
  check('chyba přihlášení do Logu', /VW odmítl přihlášení/.test(h.logy.slice(-1)[0]), true);
  const p = h.api.autoPayload().stav;
  check('  poslední procenta zůstanou', p.soc + ' ' + !!p.chyba, '80 true');
  const pred = h.logy.length;
  h.volej({ chyba: 'VW odmítl přihlášení — zkontroluj heslo v auto.config.json.' });
  check('  stejná chyba podruhé Log nezaplní', h.logy.length, pred);
  h.volej(STAV);
  check('úspěšné čtení chybu smaže', h.api.autoPayload().stav.chyba, null);
}

konec();
