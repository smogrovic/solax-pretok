// Ověření: připomínky na serveru — odťuknutí a vrácení, přepínače popelnic,
// endpointy a obnova ze zálohy.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('připomínky');

const CODE = between('// ---------- Připomínky ----------', '// ---------- Spotřeba po měsících ----------');

function build() {
  const broadcasts = [], routy = {};
  const app = { post: (cesta, fn) => { routy[cesta] = fn; } };
  const state = {};
  const api = new Function('state', 'broadcast', 'app',
    CODE + '\n; state.pripominky = pripominkyVychozi();'
         + ' return { pripominkaHotovo, pripominkaZapnuto, pripominkyObnov, pripominkyVychozi };'
  )(state, (e, d) => broadcasts.push({ e, d: JSON.parse(JSON.stringify(d)) }), app);
  // Volání endpointu tak, jak by ho zavolal Express
  const zavolej = (vzor, params, body) => {
    let status = 200, json = null;
    const res = { status(s) { status = s; return res; }, json(j) { json = j; return res; } };
    routy[vzor]({ params, body }, res);
    return { status, json };
  };
  return { api, state, broadcasts, routy, zavolej };
}

nadpis('1) Výchozí stav');
{
  const h = build();
  check('čtyři připomínky', Object.keys(h.state.pripominky).join(','), 'kytky,vysavac,bio,popelnice');
  check('nic neodťuknuto', Object.values(h.state.pripominky).every(p => p.hotovo === 0), true);
  check('popelnice mají přepínač zapnutý', h.state.pripominky.bio.zapnuto && h.state.pripominky.popelnice.zapnuto, true);
  check('kytky přepínač nemají', 'zapnuto' in h.state.pripominky.kytky, false);
}

nadpis('2) Odťuknutí a vrácení');
{
  const h = build();
  h.api.pripominkaHotovo('kytky', false, 1000);
  check('uloží čas', h.state.pripominky.kytky.hotovo, 1000);
  check('  a pošle stav do appek', h.broadcasts.pop().d.pripominky.kytky.hotovo, 1000);
  h.api.pripominkaHotovo('kytky', false, 5000);
  check('další odťuknutí', h.state.pripominky.kytky.hotovo, 5000);
  h.api.pripominkaHotovo('kytky', true);
  check('Zpět vrátí předchozí čas', h.state.pripominky.kytky.hotovo, 1000);
  check('neznámé id neprojde', h.api.pripominkaHotovo('pes', false, 1), false);
}

nadpis('3) Endpointy');
{
  const h = build();
  let r = h.zavolej('/api/pripominky/:id/hotovo', { id: 'vysavac' }, {});
  check('hotovo → 200', r.status, 200);
  check('  a vrátí stav', r.json.pripominky.vysavac.hotovo > 0, true);
  r = h.zavolej('/api/pripominky/:id/hotovo', { id: 'vysavac' }, { zpet: true });
  check('zpet vrátí na nulu', h.state.pripominky.vysavac.hotovo, 0);
  r = h.zavolej('/api/pripominky/:id/hotovo', { id: 'nic' }, {});
  check('neznámá připomínka → 404', r.status, 404);
  r = h.zavolej('/api/pripominky/:id/zapnuto', { id: 'bio' }, { zapnuto: false });
  check('vypnutí BIO → 200', r.status, 200);
  check('  a je vypnuté', h.state.pripominky.bio.zapnuto, false);
  r = h.zavolej('/api/pripominky/:id/zapnuto', { id: 'bio' }, { zapnuto: 'ne' });
  check('špatné tělo → 400', r.status, 400);
  check('  a nic se nezmění', h.state.pripominky.bio.zapnuto, false);
  r = h.zavolej('/api/pripominky/:id/zapnuto', { id: 'kytky' }, { zapnuto: false });
  check('kytky přepínač nemají → 404', r.status, 404);
}

nadpis('4) Obnova ze zálohy');
{
  const h = build();
  h.api.pripominkaHotovo('kytky', false, 9000);
  const r = h.zavolej('/api/pripominky/restore', {}, { pripominky: {
    kytky: { hotovo: 5000 },
    vysavac: { hotovo: 7000, predtim: 3000 },
    bio: { hotovo: 'x', zapnuto: false },
    popelnice: { zapnuto: 'ano' },
    pes: { hotovo: 1 }
  } });
  check('restore → 200', r.status, 200);
  check('novější odťuknutí se nepřepíše', h.state.pripominky.kytky.hotovo, 9000);
  check('starší ze zálohy se vezme', h.state.pripominky.vysavac.hotovo, 7000);
  check('  i s předchozím', h.state.pripominky.vysavac.predtim, 3000);
  check('nečíslo se zahodí', h.state.pripominky.bio.hotovo, 0);
  check('  ale přepínač se vezme', h.state.pripominky.bio.zapnuto, false);
  check('neplatný přepínač se zahodí', h.state.pripominky.popelnice.zapnuto, true);
  check('cizí id se nezaloží', 'pes' in h.state.pripominky, false);
  check('prázdné tělo → 400', h.zavolej('/api/pripominky/restore', {}, {}).status, 400);
}

nadpis('5) Záloha a stream');
{
  const fs = require('fs');
  const zdroj = fs.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const posty = zdroj.slice(zdroj.indexOf('const STORE_POSTS'), zdroj.indexOf('];', zdroj.indexOf('const STORE_POSTS')));
  check('restore je v seznamu záloh', posty.includes("'/api/pripominky/restore'"), true);
  check('  i ve snímku zálohy',
    zdroj.includes("'/api/pripominky/restore': { pripominky: state.pripominky }"), true);
  check('stav jde v úvodním snímku streamu', /\n    pripominky: state\.pripominky,\n/.test(zdroj), true);
}

konec();
