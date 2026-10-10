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
    CODE + '\n; state.pripominky = pripominkyVychozi(); state.nakup = []; state.oznameni = null;'
         + ' return { pripominkaHotovo, pripominkaZapnuto, pripominkaInterval, pripominkyObnov, pripominkyVychozi, pripominkyZima,'
         + ' pripominkaVlastniVytvor, pripominkaVlastniSmaz, pripominkyUklid, PRIPOMINKY_VLASTNI_MAX,'
         + ' nakupPridej, nakupSmaz, nakupObnov, NAKUP_MAX, oznameniNastav, oznameniZrus, oznameniObnov };'
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

nadpis('V) Vlastní připomínky');
{
  const h = build();
  const DEN = 86400000;
  const r = h.zavolej('/api/pripominky/vlastni', {}, { nazev: '  Vyměnit filtr ', ikona: '🔧', typ: 'opak', dni: 30 });
  check('opakovaná se vytvoří', r.status, 200);
  const id = r.json.id;
  check('  id vlastní', /^v_[a-z0-9]{8}$/.test(id), true);
  const p = h.state.pripominky[id];
  check('  název oříznutý', p.vlastni.nazev, 'Vyměnit filtr');
  check('  ikona i interval', p.vlastni.ikona + ' ' + p.dni, '🔧 30');
  check('  zapnutá, neodťuknutá', p.zapnuto === true && p.hotovo === 0, true);
  check('  appka se dozví', h.broadcasts.some(b => b.e === 'pripominky' && b.d.pripominky[id]), true);
  check('interval jde změnit v rozsahu 1–365', h.api.pripominkaInterval(id, 365), true);
  check('  mimo rozsah ne', h.api.pripominkaInterval(id, 366), false);
  check('přepínač jde i u vlastní', h.zavolej('/api/pripominky/:id/zapnuto', { id }, { zapnuto: false }).status, 200);
  check('  a vypne ji', h.state.pripominky[id].zapnuto, false);
  check('hotovo funguje', h.api.pripominkaHotovo(id, false, 1000), true);

  const j = h.zavolej('/api/pripominky/vlastni', {}, { nazev: 'Zubař', typ: 'jednou', datum: '2026-10-20' });
  check('jednorázová se vytvoří', h.state.pripominky[j.json.id].vlastni.datum, '2026-10-20');
  check('  bez intervalu', 'dni' in h.state.pripominky[j.json.id], false);
  check('  ikona bez zadání 📌', h.state.pripominky[j.json.id].vlastni.ikona, '📌');

  const spatne = [
    [{ nazev: '', typ: 'opak', dni: 5 }, 'prázdný název'],
    [{ nazev: 'x'.repeat(41), typ: 'opak', dni: 5 }, 'dlouhý název'],
    [{ nazev: 'a', typ: 'opak', dni: 0 }, 'nulový interval'],
    [{ nazev: 'a', typ: 'opak', dni: 2.5 }, 'necelý interval'],
    [{ nazev: 'a', typ: 'jednou', datum: '2026-02-30' }, 'neexistující den'],
    [{ nazev: 'a', typ: 'jednou', datum: '20.10.2026' }, 'jiný formát data'],
    [{ nazev: 'a', typ: 'jednou', datum: '2031-01-01' }, 'víc než dva roky dopředu'],
    [{ nazev: 'a', typ: 'jindy' }, 'neznámý typ']
  ];
  for (const [b, co] of spatne) check('odmítne: ' + co, h.zavolej('/api/pripominky/vlastni', {}, b).status, 400);

  check('pevnou smazat nejde', h.zavolej('/api/pripominky/:id/smazat', { id: 'kytky' }, {}).status, 404);
  check('  ani nesmysl', h.zavolej('/api/pripominky/:id/smazat', { id: '__proto__' }, {}).status, 404);
  check('hotovo na __proto__ neprojde', h.zavolej('/api/pripominky/:id/hotovo', { id: '__proto__' }, {}).status, 404);
  check('vlastní smazat jde', h.zavolej('/api/pripominky/:id/smazat', { id }, {}).status, 200);
  check('  a je pryč', id in h.state.pripominky, false);

  const h2 = build();
  for (let i = 0; i < h2.api.PRIPOMINKY_VLASTNI_MAX; i++) h2.api.pripominkaVlastniVytvor({ nazev: 'p' + i, typ: 'opak', dni: 3 });
  check('nejvýš 20 vlastních', !!h2.api.pripominkaVlastniVytvor({ nazev: 'navíc', typ: 'opak', dni: 3 }).chyba, true);

  // Úklid: hotová jednorázová po dvou dnech zmizí, opakovaná ne
  const h3 = build();
  const T = Date.UTC(2026, 9, 10, 12);
  const a = h3.api.pripominkaVlastniVytvor({ nazev: 'jednou', typ: 'jednou', datum: '2026-10-10' }, T).id;
  const o = h3.api.pripominkaVlastniVytvor({ nazev: 'opak', typ: 'opak', dni: 3 }, T).id;
  h3.api.pripominkaHotovo(a, false, T);
  h3.api.pripominkaHotovo(o, false, T);
  h3.api.pripominkyUklid(T + DEN);
  check('hotová jednorázová den po — ještě drží (Zpět)', a in h3.state.pripominky, true);
  h3.api.pripominkyUklid(T + 3 * DEN);
  check('  po dvou dnech zmizí', a in h3.state.pripominky, false);
  check('opakovaná zůstává', o in h3.state.pripominky, true);

  // Obnova po nasazení: chybějící vlastní se převezmou, nesmysl ne
  const h4 = build();
  h4.api.pripominkyObnov({ pripominky: {
    v_abcd1234: { vlastni: { nazev: 'Filtr', ikona: '🔧', typ: 'opak' }, dni: 30, zapnuto: false, hotovo: 5000 },
    v_zzzz9999: { vlastni: { nazev: '', typ: 'opak' }, dni: 30 },
    v_xxxx0000: { vlastni: { nazev: 'zlý', typ: 'opak' }, dni: 9999 },
    jinyklic: { vlastni: { nazev: 'cizí', typ: 'opak' }, dni: 3 }
  } });
  check('obnova převezme platnou vlastní', JSON.stringify(h4.state.pripominky.v_abcd1234 && [h4.state.pripominky.v_abcd1234.dni, h4.state.pripominky.v_abcd1234.zapnuto, h4.state.pripominky.v_abcd1234.hotovo]), '[30,false,5000]');
  check('  neplatné ne', ['v_zzzz9999', 'v_xxxx0000', 'jinyklic'].some(k => k in h4.state.pripominky), false);
  h4.api.pripominkaHotovo('v_abcd1234', false, 9000);
  h4.api.pripominkyObnov({ pripominky: { v_abcd1234: { vlastni: { nazev: 'Filtr', typ: 'opak' }, dni: 30, hotovo: 6000 } } });
  check('  novější odťuknutí serveru vyhraje', h4.state.pripominky.v_abcd1234.hotovo, 9000);
}

nadpis('N) Nákupní seznam');
{
  const h = build();
  const r = h.zavolej('/api/nakup', {}, { text: '  mléko   polotučné ' });
  check('přidá položku', r.status, 200);
  check('  text učesaný', h.state.nakup[0].text, 'mléko polotučné');
  check('  appka se dozví', h.broadcasts.some(b => b.e === 'nakup' && b.d.nakup.length === 1), true);
  check('prázdné nejde', h.zavolej('/api/nakup', {}, { text: '   ' }).status, 400);
  h.zavolej('/api/nakup', {}, { text: 'x'.repeat(200) });
  check('dlouhý text se ořízne', h.state.nakup[1].text.length, 80);
  const smazana = { ...h.state.nakup[0] };
  check('smazání', h.zavolej('/api/nakup/:id/smazat', { id: smazana.id }, {}).status, 200);
  check('  je pryč', h.state.nakup.some(x => x.id === smazana.id), false);
  check('  podruhé 404', h.zavolej('/api/nakup/:id/smazat', { id: smazana.id }, {}).status, 404);
  h.zavolej('/api/nakup', {}, { text: smazana.text, id: smazana.id, t: smazana.t });
  check('Zpět vrátí na původní místo', h.state.nakup[0].id + ' ' + h.state.nakup[0].text, smazana.id + ' mléko polotučné');
  h.zavolej('/api/nakup', {}, { text: smazana.text, id: smazana.id, t: smazana.t });
  check('  dvojí Zpět nezdvojí', h.state.nakup.filter(x => x.id === smazana.id).length, 1);
  while (h.state.nakup.length < h.api.NAKUP_MAX) h.api.nakupPridej({ text: 'p' + h.state.nakup.length });
  check('nejvýš 50', h.zavolej('/api/nakup', {}, { text: 'navíc' }).status, 400);

  const h2 = build();
  h2.api.nakupObnov({ nakup: [{ id: 'n_aaaa1111', text: 'chleba', t: 5 }, { id: 'zly', text: 'x', t: 1 }, { id: 'n_bbbb2222', text: '', t: 2 }] });
  check('obnova do prázdného, jen platné', h2.state.nakup.map(x => x.text).join(','), 'chleba');
  h2.api.nakupObnov({ nakup: [{ id: 'n_cccc3333', text: 'máslo', t: 9 }] });
  check('  do neprázdného nic', h2.state.nakup.length, 1);
}

nadpis('O) Upozornění pro všechny');
{
  const h = build();
  check('prázdné nejde', h.zavolej('/api/oznameni', {}, { text: '  ' }).status, 400);
  check('moc dlouhé nejde', h.zavolej('/api/oznameni', {}, { text: 'x'.repeat(201) }).status, 400);
  check('nastaví se', h.zavolej('/api/oznameni', {}, { text: ' Večeře v 18:00! ' }).status, 200);
  const o = h.state.oznameni;
  check('  text', o.text, 'Večeře v 18:00!');
  check('  appka se dozví', h.broadcasts.some(b => b.e === 'oznameni' && b.d.oznameni && b.d.oznameni.id === o.id), true);
  h.zavolej('/api/oznameni/zrusit', {}, { id: 'o_jine' });
  check('cizí id neodklikne', !!h.state.oznameni, true);
  h.zavolej('/api/oznameni/zrusit', {}, { id: o.id });
  check('správné id odklikne', h.state.oznameni, 'null');
  check('  všem', h.broadcasts.some(b => b.e === 'oznameni' && b.d.oznameni === null), true);

  const h2 = build();
  h2.api.oznameniObnov({ id: 'o_abc', text: 'Ze zálohy', od: 1000 });
  check('obnova ze zálohy', h2.state.oznameni && h2.state.oznameni.text, 'Ze zálohy');
  const h3 = build();
  h3.api.oznameniObnov({ id: 'zle id', text: 'x', od: 1 });
  check('  nesmysl ne', h3.state.oznameni, 'null');
}

konec();
