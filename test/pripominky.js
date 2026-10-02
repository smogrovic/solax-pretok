// Ověření: připomínky na serveru — odťuknutí a vrácení, přepínače popelnic,
// endpointy a obnova ze zálohy.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('připomínky');

const CODE = between('// ---------- Připomínky ----------', '// ---------- Spotřeba po měsících ----------');

function build() {
  const broadcasts = [], routy = {}, logy = [];
  const app = { post: (cesta, fn) => { routy[cesta] = fn; } };
  const state = {};
  const api = new Function('state', 'broadcast', 'app', 'addLog',
    CODE + '\n; state.pripominky = pripominkyVychozi();'
         + ' return { pripominkaHotovo, pripominkaZapnuto, pripominkaInterval, pripominkyObnov, pripominkyVychozi, pripominkyZima };'
  )(state, (e, d) => broadcasts.push({ e, d: JSON.parse(JSON.stringify(d)) }), app, t => logy.push(t));
  // Volání endpointu tak, jak by ho zavolal Express
  const zavolej = (vzor, params, body) => {
    let status = 200, json = null;
    const res = { status(s) { status = s; return res; }, json(j) { json = j; return res; } };
    routy[vzor]({ params, body }, res);
    return { status, json };
  };
  return { api, state, broadcasts, routy, zavolej, logy };
}

nadpis('1) Výchozí stav');
{
  const h = build();
  check('devět připomínek (i pes, sekačka, tráva a povlečení)', Object.keys(h.state.pripominky).join(','), 'kytky,vysavac,bio,popelnice,pesRano,pesVecer,sekacka,trava,povleceni');
  check('výchozí intervaly: kytky 7, vysavač 7, tráva 10, povlečení 28 dní',
    ['kytky', 'vysavac', 'trava', 'povleceni'].map(id => h.state.pripominky[id].dni).join(','), '7,7,10,28');
  check('sekačka má přepínač, výchozí zapnutý', h.state.pripominky.sekacka.zapnuto, true);
  check('nic není aktivované ručně', Object.values(h.state.pripominky).every(p => p.aktivovano === 0), true);
  check('nic neodťuknuto', Object.values(h.state.pripominky).every(p => p.hotovo === 0), true);
  check('BIO má přepínač zapnutý', h.state.pripominky.bio.zapnuto, true);
  check('přepínač mají všechny, výchozí zapnutý', Object.values(h.state.pripominky).every(p => p.zapnuto === true), true);
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
  r = h.zavolej('/api/pripominky/:id/aktivovat', { id: 'kytky' }, {});
  check('aktivovat → 200', r.status, 200);
  check('  a zapíše čas', h.state.pripominky.kytky.aktivovano > 0, true);
  check('aktivovat neznámou → 404', h.zavolej('/api/pripominky/:id/aktivovat', { id: 'kocka' }, {}).status, 404);
  r = h.zavolej('/api/pripominky/:id/hotovo', { id: 'pesRano' }, {});
  check('pes ráno jde odťuknout', r.status + ' ' + (h.state.pripominky.pesRano.hotovo > 0), '200 true');
  r = h.zavolej('/api/pripominky/:id/zapnuto', { id: 'bio' }, { zapnuto: false });
  check('vypnutí BIO → 200', r.status, 200);
  check('  a je vypnuté', h.state.pripominky.bio.zapnuto, false);
  r = h.zavolej('/api/pripominky/:id/zapnuto', { id: 'bio' }, { zapnuto: 'ne' });
  check('špatné tělo → 400', r.status, 400);
  check('  a nic se nezmění', h.state.pripominky.bio.zapnuto, false);
  r = h.zavolej('/api/pripominky/:id/zapnuto', { id: 'kytky' }, { zapnuto: false });
  check('kytky jdou vypnout taky', r.status + ' ' + h.state.pripominky.kytky.zapnuto, '200 false');
  r = h.zavolej('/api/pripominky/:id/zapnuto', { id: 'nesmysl' }, { zapnuto: false });
  check('neznámá připomínka → 404', r.status, 404);
}

nadpis('4) Obnova ze zálohy');
{
  const h = build();
  h.api.pripominkaHotovo('kytky', false, 9000);
  const r = h.zavolej('/api/pripominky/restore', {}, { pripominky: {
    kytky: { hotovo: 5000, aktivovano: 12000 },
    pesVecer: { hotovo: 4000 },
    vysavac: { hotovo: 7000, predtim: 3000 },
    bio: { hotovo: 'x', zapnuto: false },
    popelnice: { zapnuto: false },
    pes: { hotovo: 1 }
  } });
  check('restore → 200', r.status, 200);
  check('novější odťuknutí se nepřepíše', h.state.pripominky.kytky.hotovo, 9000);
  check('aktivace ze zálohy se vezme', h.state.pripominky.kytky.aktivovano, 12000);
  check('pes večer se obnoví taky', h.state.pripominky.pesVecer.hotovo, 4000);
  check('starší ze zálohy se vezme', h.state.pripominky.vysavac.hotovo, 7000);
  check('  i s předchozím', h.state.pripominky.vysavac.predtim, 3000);
  check('nečíslo se zahodí', h.state.pripominky.bio.hotovo, 0);
  check('  ale přepínač se vezme', h.state.pripominky.bio.zapnuto, false);
  check('přepínač běžné popelnice ze zálohy se vezme', h.state.pripominky.popelnice.zapnuto, false);
  check('bez přepínače v záloze zůstane zapnuto', h.state.pripominky.kytky.zapnuto, true);
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

nadpis('Interval a odťuknutí s datem');
{
  const h = build();
  check('kytky na 3 dny', h.api.pripominkaInterval('kytky', 3) + ' ' + h.state.pripominky.kytky.dni, 'true 3');
  check('  14 ano, 15 ne', h.api.pripominkaInterval('vysavac', 14) + ' ' + h.api.pripominkaInterval('vysavac', 15), 'true false');
  check('  2 ne', h.api.pripominkaInterval('trava', 2), false);
  check('povlečení po týdnech (7, 14, 21, 28)', [7, 14, 21, 28, 10, 35].map(d => h.api.pripominkaInterval('povleceni', d)).join(','),
    'true,true,true,true,false,false');
  check('popelnice interval nemá', h.api.pripominkaInterval('popelnice', 7), false);
  const r = h.zavolej('/api/pripominky/:id/interval', { id: 'kytky' }, { dni: 5 });
  check('endpoint interval', r.status + ' ' + h.state.pripominky.kytky.dni, '200 5');
  check('  mimo rozsah 400', h.zavolej('/api/pripominky/:id/interval', { id: 'kytky' }, { dni: 30 }).status, 400);
  check('  bez intervalu 404', h.zavolej('/api/pripominky/:id/interval', { id: 'bio' }, { dni: 5 }).status, 404);
  // „Udělal jsem to včera": datum z kalendáře v appce
  const ted = 100 * 86400000;
  h.api.pripominkaHotovo('povleceni', false, ted, ted - 86400000);
  check('odťuknuto včera', h.state.pripominky.povleceni.hotovo, ted - 86400000);
  h.api.pripominkaHotovo('kytky', false, ted, ted + 5000);
  check('  budoucnost neprojde (platí teď)', h.state.pripominky.kytky.hotovo, ted);
  h.api.pripominkaHotovo('trava', false, ted, ted - 90 * 86400000);
  check('  víc než 2 měsíce zpět neprojde (platí teď)', h.state.pripominky.trava.hotovo, ted);
  h.api.pripominkaHotovo('povleceni', true);
  check('  Zpět vrátí předchozí', h.state.pripominky.povleceni.hotovo, 0);
  // Aktivováno ráno, pak „hotovo včera" — aktivace se zruší, jinak by svítila dál
  h.state.pripominky.vysavac.aktivovano = ted - 3600000;
  h.api.pripominkaHotovo('vysavac', false, ted, ted - 86400000);
  check('odťuknutí s datem včera zruší ruční aktivaci', h.state.pripominky.vysavac.aktivovano + ' ' + h.state.pripominky.vysavac.hotovo, '0 ' + (ted - 86400000));
  h.api.pripominkaHotovo('vysavac', true);
  check('  Zpět vrátí aktivaci i předchozí hotovo', h.state.pripominky.vysavac.aktivovano, ted - 3600000);
  const z = h.zavolej('/api/pripominky/:id/hotovo', { id: 'vysavac' }, { kdy: Date.now() - 2 * 86400000 });
  check('endpoint hotovo bere datum', z.status + ' ' + (Math.abs(h.state.pripominky.vysavac.hotovo - (Date.now() - 2 * 86400000)) < 5000), '200 true');
  const o = build();
  o.api.pripominkyObnov({ pripominky: { kytky: { dni: 4 }, povleceni: { dni: 21 }, trava: { dni: 99 } } });
  check('interval přežije nasazení (záloha)', [o.state.pripominky.kytky.dni, o.state.pripominky.povleceni.dni, o.state.pripominky.trava.dni].join(','), '4,21,10');
}

nadpis('Zima vypne trávu a sekačku');
{
  const h = build();
  const z = id => h.state.pripominky[id];
  h.api.pripominkyZima(true);
  check('do zimy se tráva a sekačka vypnou', z('trava').zapnuto + ' ' + z('sekacka').zapnuto, 'false false');
  check('  s příznakem, že to byla zima', z('trava').zimaVypnulo + ' ' + z('sekacka').zimaVypnulo, 'true true');
  check('  ostatní zůstanou', Object.entries(h.state.pripominky).filter(([id]) => !['trava', 'sekacka'].includes(id)).every(([, p]) => p.zapnuto), true);
  check('  v Logu', h.logy.slice(-1)[0], 'Připomínky: posekat trávu, vysvobodit sekačku vypnuty na zimu');
  check('  a do appky', h.broadcasts.slice(-1)[0].e, 'pripominky');
  h.api.pripominkyZima(false);
  check('po zimě se zapnou zpátky', z('trava').zapnuto + ' ' + z('sekacka').zapnuto, 'true true');
  check('  příznak zmizí', 'zimaVypnulo' in z('trava'), false);
  check('  v Logu', h.logy.slice(-1)[0], 'Připomínky: posekat trávu, vysvobodit sekačku zapnuty po zimě');
}
{
  // Tráva vypnutá ručně už před zimou — po zimě zůstane vypnutá
  const h = build();
  const z = id => h.state.pripominky[id];
  h.api.pripominkaZapnuto('trava', false);
  h.api.pripominkyZima(true);
  check('ručně vypnutou zima neoznačí', 'zimaVypnulo' in z('trava'), false);
  h.api.pripominkyZima(false);
  check('  a po zimě zůstane vypnutá', z('trava').zapnuto, false);
  check('  sekačka se zapnula', z('sekacka').zapnuto, true);
}
{
  // Ruční zapnutí v zimě se respektuje
  const h = build();
  h.api.pripominkyZima(true);
  h.api.pripominkaZapnuto('trava', true);
  check('ruční zapnutí v zimě smaže příznak', 'zimaVypnulo' in h.state.pripominky.trava, false);
  const r = h.zavolej('/api/pripominky/restore', {}, { pripominky: { sekacka: { zapnuto: false, zimaVypnulo: true } } });
  check('obnova nese příznak zimy', r.status + ' ' + h.state.pripominky.sekacka.zimaVypnulo, '200 true');
}

{
  // Přepnutí hlavního jezdce do zimy a ze zimy přepínače opravdu přehodí
  const zima = [];
  const setAutoMode = new Function('state', 'pripominkyZima', 'addLog', 'broadcast', 'AUTO_MODE_LABELS',
    'automationPayload', 'thresholdPayload', 'wallboxEnabled', 'runAutomation', 'runEnergyControl',
    'let autoModeTouched = false;\n' + fn('function setAutoMode(mode, why) {') + '\n; return setAutoMode;')(
    { autoMode: 'on' }, z => zima.push(z), () => {}, () => {}, { on: 'zapnuta', off: 'vypnuta', winter: 'zima' },
    () => ({}), () => ({}), false, async () => {}, async () => {});
  setAutoMode('winter');
  setAutoMode('off');
  setAutoMode('on');
  setAutoMode('winter');
  setAutoMode('winter');
  check('jezdec: do zimy, ze zimy (i na vypnuto), mezi zapnuto/vypnuto nic', JSON.stringify(zima), '[true,false,true]');
}

konec();
