// Ověření: pevná tlačítka na Asistentovi a přepínač „nejsme doma".
//
// Tlačítka schválně NEJDOU přes jazykový model — jsou to pokaždé tytéž kroky, takže
// je dělá kód. Tahle sada je tu proto, aby se ty kroky nedaly tiše přeházet.
//
// „Nejsme doma" má dvě pasti: patnáctiminutový odklad (odjezdové kroky nesmí odbavit
// dřív, ale ani se opakovat dokola) a nezávislost na hlavním vypínači automatiky —
// zamčený dům se nesmí ztratit kvůli poloze jezdce.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('asistent');

const MIN = 60000;
const CODE = between('// ---------- Tlačítka na Asistentovi (scény) a „nejsme doma" ----------',
                     '// ---------- Trvalé úložiště');

function build({ poZapadu = false, nuki = true, tahoma = true, klimy = [], svetla = [],
                 zamekSelze = false, huum = true, dvere = true,
                 saunaSelze = false, saunaNejede = false, svetloSelze = false,
                 pergolaSelze = false, releSelze = null } = {}) {
  const akce = [];
  const logy = [];
  const routy = {};
  const state = {
    weather: { sunsetMs: poZapadu ? 1000 : 9e15 },
    devices: {},
    aircon: { devices: klimy.map(n => ({ name: n, guid: n, power: true })) },
    away: { since: 0 },
    assistantLog: [],
    huum: { doorClosed: dvere }
  };
  for (const k of ['lightDole', 'lightNahore', 'lightBazen', 'lightNocni', 'obeh']) {
    state.devices[k] = { online: true, isOn: svetla.includes(k) };
  }

  const api = new Function(
    'state', 'app', 'requireAuth', 'addLog', 'addAssistantLog', 'broadcast', 'fmtPragueTime',
    'assistantControlBlinds', 'assistantSetRelay', 'assistantSetAircon', 'actuateRelay',
    'autoSet', 'nukiLock', 'nukiOtevri', 'nukiEnabled', 'tahomaEnabled', 'LIGHT_KEYS', 'ZALUZIE_ZAVRENO',
    'huumEnabled', 'huumPovel', 'huumOverStav', 'huumSvetlo',
    'assistantSetTerasaLight', 'DEVICE_LABELS',
    CODE + '\n; return { SCENY, SCENA_FN, poZapaduSlunce, awayOn, awayActive, awayPayload,'
         + ' enforceAway, AWAY_DELAY_MS };'
  )(
    state,
    { post: (cesta, fn) => { routy[cesta] = fn; } },
    () => true,
    m => logy.push(m),
    m => logy.push('asistent: ' + m),
    () => {},
    ts => new Date(ts).toISOString().slice(11, 16),
    async ({ target, action, orientation }) => {
      akce.push(`zaluzie:${target}:${action}${orientation === undefined ? '' : ':' + orientation}`);
      return `Žaluzie ${target}: ${action}.`;
    },
    async (co, on) => { akce.push(`rele:${co}:${on ? 'on' : 'off'}`); return `${co}: ${on ? 'zap' : 'vyp'}.`; },
    async ({ room, power }) => { akce.push(`klima:${room}:${power}`); return `${room}: ${power}.`; },
    async (key, on, duvod) => {
      if (releSelze === key) throw new Error('Shelly nereaguje');
      akce.push(`${key}:${on ? 'on' : 'off'} (${duvod})`);
      state.devices[key].isOn = on;
    },
    async (key, turn, duvod) => { akce.push(`auto:${key}:${turn} (${duvod})`); state.devices[key].isOn = turn === 'on'; return true; },
    async () => { if (zamekSelze) throw new Error('Nuki HTTP 503'); akce.push('zamek:lock'); return 'Zamčeno.'; },
    async () => { akce.push('zamek:otevri'); return 'Dveře otevřeny.'; },
    nuki, tahoma,
    ['lightDole', 'lightNahore', 'lightBazen', 'lightNocni'],
    100,                      // zavřeno; konstanta bydlí v bloku rozvrhu žaluzií
    huum,
    async (cesta, telo) => {
      if (saunaSelze) throw new Error('HUUM API HTTP 503');
      akce.push(`huum:${cesta}:${(telo || {}).targetTemperature}`);
    },
    async () => (saunaNejede ? { heating: false } : { heating: true }),
    async on => {
      if (svetloSelze) throw new Error('HUUM neřekl, jestli světlo svítí.');
      akce.push(`huumsvetlo:${on ? 'on' : 'off'}`);
    },
    async on => {
      if (pergolaSelze) throw new Error('TaHoma HTTP 503');
      akce.push(`pergola:${on ? 'on' : 'off'}`);
    },
    { lightDole: 'Zahrada dole', lightNahore: 'Zahrada nahoře',
      lightBazen: 'Světlo bazén', lightNocni: 'Noční světla' }
  );
  return { api, state, akce, logy, routy };
}

const volej = (routy, cesta, telo) => {
  let out = null, kod = 200;
  const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
  return Promise.resolve(routy[cesta]({ body: telo }, res)).then(() => ({ out, kod }));
};

(async () => {

nadpis('1) Seznam tlačítek');
{
  const h = build();
  check('je jich pět', h.api.SCENY.length, 5);
  check('  a v tomhle pořadí', h.api.SCENY.map(s => s.key).join(','), 'sauna,zahrada,zamkni,sprcha,otevri');
  check('každé má popisek', h.api.SCENY.every(s => s.label && s.label.length > 3), true);
  // Tlačítko bez obsluhy by v appce svítilo a nic nedělalo
  check('a každé má co dělat', h.api.SCENY.every(s => typeof h.api.SCENA_FN[s.key] === 'function'), true);
}

nadpis('2) Zapni saunu');
{
  // Ve dne se venku svítit nemá — je světlo a stejně se to zapomene zhasnout
  const h = build({ poZapadu: false });
  const reply = await h.api.SCENA_FN.sauna();
  check('zapne saunu na 80 °C', h.akce[0], 'huum:start:80');
  check('  a rozsvítí v ní', h.akce[1], 'huumsvetlo:on');
  check('  vytáhne žaluzie v ložnici', h.akce[2], 'zaluzie:ložnice:up');
  check('  a zahradu dole nechá být', /nezapadlo slunce/.test(reply), true);
  check('  řekne, na kolik topí', /Sauna topí na 80 °C/.test(reply), true);
  check('  i že v sauně svítí', /Světlo v sauně svítí/.test(reply), true);
  check('a je to v logu', h.logy.some(t => /zapnuta na 80 °C \(tlačítko\)/.test(t)), true);
}
{
  const h = build({ poZapadu: true });
  await h.api.SCENA_FN.sauna();
  check('po západu rozsvítí i zahradu dole', h.akce.join(' | '),
    'huum:start:80 | huumsvetlo:on | zaluzie:ložnice:up | lightDole:on (tlačítko sauna)');
}
{
  // Dveře jsou pojistka v jednotce. Zkoušet to naslepo by skončilo mlhavou
  // chybou z cloudu, ze které by nebylo poznat, co je špatně.
  const h = build({ dvere: false });
  const reply = await h.api.SCENA_FN.sauna();
  check('s otevřenými dveřmi se sauna nezapne',
    h.akce.some(a => a.startsWith('huum:')), false);
  check('  a řekne se proč', /otevřené dveře/.test(reply), true);
  check('  ale žaluzie se stejně vytáhnou', h.akce.join(' | '), 'zaluzie:ložnice:up');
}
{
  const h = build({ huum: false });
  const reply = await h.api.SCENA_FN.sauna();
  check('bez nastavených kamen to řekne', /nejsou nastavená/.test(reply), true);
  check('  a zbytek scény proběhne', h.akce.join(' | '), 'zaluzie:ložnice:up');
}
{
  // Každý krok stojí sám za sebe: výpadek jednoho nesmí sebrat ostatní
  const h = build({ poZapadu: true, saunaSelze: true });
  const reply = await h.api.SCENA_FN.sauna();
  check('když sauna selže, řekne se to', /nepodařilo zapnout/.test(reply), true);
  check('  ale světlo, žaluzie i zahrada jedou dál', h.akce.join(' | '),
    'huumsvetlo:on | zaluzie:ložnice:up | lightDole:on (tlačítko sauna)');
}
{
  // „Přijato" není „topí" — kamna se nemusí rozjet a scéna to nesmí zamlčet
  const h = build({ saunaNejede: true });
  const reply = await h.api.SCENA_FN.sauna();
  check('nerozjetá kamna se nezamlčí', /zatím nerozjela/.test(reply), true);
  check('  a netvrdí se, že topí', /Sauna topí/.test(reply), false);
}
{
  const h = build({ svetloSelze: true });
  const reply = await h.api.SCENA_FN.sauna();
  check('když selže světlo, řekne se to', /Světlo v sauně se nepodařilo/.test(reply), true);
  check('  ale zatopeno je', /Sauna topí na 80 °C/.test(reply), true);
}
{
  const h = build({ poZapadu: true });
  check('sauna má popisek o sauně', h.api.SCENY[0].label, 'Zapni saunu');
  check('  a je první v řadě', typeof h.api.SCENA_FN.sauna, 'function');
}

nadpis('3) Ostatní tlačítka');
{
  const h = build({ svetla: ['lightDole', 'lightNahore', 'lightBazen', 'lightNocni'] });
  const reply = await h.api.SCENA_FN.zahrada();
  check('Zahrada OFF zhasne zahradu, bazén, pergolu i saunu', h.akce.join(' | '),
    'lightNahore:off (tlačítko Zahrada OFF) | lightDole:off (tlačítko Zahrada OFF) | '
    + 'lightBazen:off (tlačítko Zahrada OFF) | pergola:off | huumsvetlo:off');
  // Tohle je ta kontrola, která odliší novou scénu od staré „zhasni všechna světla":
  // noční světla svítí schválně a tohle tlačítko se mačká při odchodu ze zahrady
  check('  a noční světla nechá svítit', h.state.devices.lightNocni.isOn, true);
  check('  a řekne to', /Noční světla zůstala/.test(reply), true);
  check('  i co zhaslo', /Zhasnuto: Zahrada nahoře, Zahrada dole, Světlo bazén, pergola, sauna/.test(reply), true);
}
{
  // Pergola visí na TaHomě, sauna na cloudu HUUM — výpadek jednoho nesmí sebrat zbytek
  const h = build({ pergolaSelze: true });
  const reply = await h.api.SCENA_FN.zahrada();
  check('když selže pergola, zbytek zhasne', h.akce.join(' | '),
    'lightNahore:off (tlačítko Zahrada OFF) | lightDole:off (tlačítko Zahrada OFF) | '
    + 'lightBazen:off (tlačítko Zahrada OFF) | huumsvetlo:off');
  check('  a řekne se to', /Pergolu se nepodařilo zhasnout/.test(reply), true);
}
{
  const h = build({ svetloSelze: true });
  const reply = await h.api.SCENA_FN.zahrada();
  check('když selže sauna, zbytek zhasne',
    h.akce.filter(a => a.startsWith('light') || a.startsWith('pergola')).length, 4);
  check('  a řekne se to', /Světlo v sauně se nepodařilo zhasnout/.test(reply), true);
}
{
  const h = build({ releSelze: 'lightDole' });
  const reply = await h.api.SCENA_FN.zahrada();
  check('když nereaguje relé, ostatní jdou dál',
    h.akce.join(' | ').includes('lightBazen:off'), true);
  check('  a pojmenuje se, které', /Zahrada dole se nepodařilo zhasnout/.test(reply), true);
  check('  a do seznamu zhasnutých se nedostane', /Zhasnuto: Zahrada nahoře, Světlo bazén/.test(reply), true);
}
{
  // Bez nastavených kamen se sauna mlčky přeskočí — u vypínací scény je hláška
  // o nenastavení jen šum
  const h = build({ huum: false });
  const reply = await h.api.SCENA_FN.zahrada();
  check('bez HUUM se sauna přeskočí', h.akce.some(a => a.startsWith('huumsvetlo')), false);
  check('  a nic se o tom nepíše', /HUUM|sauně/.test(reply), false);
  check('  ale zbytek zhasne', h.akce.length, 4);
}
{
  const h = build();
  const reply = await h.api.SCENA_FN.zamkni();
  check('zamkni zamkne', h.akce.join(','), 'zamek:lock');
  check('  a odpoví', reply, 'Zamčeno.');
}
{
  const h = build({ nuki: false });
  check('bez Nuki to řekne', await h.api.SCENA_FN.zamkni(), 'Zámek není nastavený.');
}
{
  // Otevřít, ne jen odemknout — západku stáhne jiný povel než zamykání
  const h = build();
  const reply = await h.api.SCENA_FN.otevri();
  check('otevři dveře sáhne na zámek', h.akce.join(','), 'zamek:otevri');
  check('  a odpoví', reply, 'Dveře otevřeny.');
  const bez = build({ nuki: false });
  check('  bez Nuki to řekne taky', await bez.api.SCENA_FN.otevri(), 'Zámek není nastavený.');
}
{
  const h = build();
  const reply = await h.api.SCENA_FN.sprcha();
  check('sprcha sepne oběhové čerpadlo', h.akce.join(','), 'obeh:on (jdu do sprchy)');
  check('  a řekne, že se vypne samo', /vypne samo/.test(reply), true);
}
{
  const h = build();
  const { out, kod } = await volej(h.routy, '/api/scene', { scene: 'nesmysl' });
  check('neznámé tlačítko se odmítne', kod, 400);
  check('  a nic neudělá', h.akce.length, 0);
}
{
  const h = build();
  await volej(h.routy, '/api/scene', { scene: 'sprcha' });
  check('stisk se zapíše do výpisu asistenta',
    h.logy.some(l => /asistent: Jdu do sprchy/.test(l)), true);
}

nadpis('4) Nejsme doma — odpočet');
{
  const h = build();
  check('na začátku jsme doma', h.api.awayOn(), false);
  const { out } = await volej(h.routy, '/api/away', { away: true });
  check('zaškrtnutí se uloží', h.api.awayOn(), true);
  check('  ale ještě neplatí', h.api.awayActive(), false);
  check('  a appce se řekne kdy', out.awayAt - out.awaySince, 15 * MIN);
  await h.api.enforceAway();
  check('do patnácti minut se nic nestane', h.akce.length, 0);
}
{
  const h = build({ klimy: ['Obývák'], svetla: ['lightDole'] });
  await volej(h.routy, '/api/away', { away: true });
  h.state.away.since -= 16 * MIN;         // uplynul odklad
  check('po patnácti minutách už platí', h.api.awayActive(), true);
  await h.api.enforceAway();
  // Zatáhnout a zaklopit do zavřeno (100 %) jde jedním povelem — zřetězené by si
  // pohyb přerušily a žaluzie by zůstaly zataženy s otevřenými lamelami
  check('zamkne, zhasne, vypne klimu a zatáhne', h.akce.join(' | '),
    'zamek:lock | rele:všechna světla:off | klima:Obývák:off | zaluzie:vše:down:100');
  const kroku = h.akce.length;
  await h.api.enforceAway();
  check('  a podruhé už se odjezd neopakuje', h.akce.length > kroku, true);
  check('  (jen se drží světla dole)', h.akce.slice(kroku).join(','), 'auto:lightDole:off (nejsme doma)');
}
{
  // Kdyby někdo doma rozsvítil (nebo to udělal časovač), zhasne se to znovu
  const h = build({ svetla: [] });
  await volej(h.routy, '/api/away', { away: true });
  h.state.away.since -= 16 * MIN;
  await h.api.enforceAway();            // odjezdové kroky
  h.state.devices.lightNocni.isOn = true;
  const pred = h.akce.length;
  await h.api.enforceAway();
  check('rozsvícené světlo se během nepřítomnosti zhasne',
    h.akce.slice(pred).join(','), 'auto:lightNocni:off (nejsme doma)');
}
{
  const h = build({ klimy: ['Obývák'] });
  await volej(h.routy, '/api/away', { away: true });
  h.state.away.since -= 16 * MIN;
  await h.api.enforceAway();
  await volej(h.routy, '/api/away', { away: false });
  check('odškrtnutím se vrátíme domů', h.api.awayOn(), false);
  const pred = h.akce.length;
  await h.api.enforceAway();
  check('  a už se nic nedrží', h.akce.length, pred);
}
{
  // Nic se nevrací zpátky: rozsvítit a vytáhnout žaluzie si člověk umí sám,
  // horší by bylo, kdyby appka po návratu v noci rozsvítila celý barák
  const h = build({ svetla: ['lightDole'] });
  await volej(h.routy, '/api/away', { away: true });
  await volej(h.routy, '/api/away', { away: false });
  check('návratem se nic nezapíná', h.akce.length, 0);
}

nadpis('5) Bojler se v nepřítomnosti nezapíná');
{
  // Automatika bojleru má vlastní řetěz podmínek (přebytek, SOC, nádrž, předpověď)
  // a vlastní sadu nemá. Tady se hlídá aspoň to, na čem záleží: než se sáhne na
  // zapnutí, musí se zeptat, jestli nejsme pryč. Teplá voda nikomu nechybí, když
  // nikdo není doma.
  const BOJLER = fn('async function runBoilerAutomation(now, prague, weather, totalW, soc, reserveW) {');
  const iAway = BOJLER.indexOf('awayActive()');
  const iOn = BOJLER.indexOf("autoSet('shelly', 'on'");
  check('bojler se ptá, jestli jsme doma', iAway >= 0, true);
  check('  a ptá se PŘED zapnutím', iAway >= 0 && iAway < iOn, true);
  // Co už topí, se nechá dojet — vypínat vyhřátou nádrž je zbytečné cvakání
  check('  vypínat kvůli tomu nezačne', /awayActive\(\)[^]{0,120}autoSet\('shelly', 'off'/.test(BOJLER), false);
}

nadpis('6) Nejsme doma — obnova po restartu');
{
  const h = build();
  const kdysi = Date.now() - 20 * MIN;
  await volej(h.routy, '/api/away/restore', { since: kdysi });
  check('stav ze zálohy se převezme', h.api.awayOn(), true);
  // Odpočet se nesmí natáhnout znovu — nasazení uprostřed odchodu by ho jinak shodilo
  check('  a odpočet se nepočítá znovu', h.api.awayActive(), true);
}
{
  const h = build();
  await volej(h.routy, '/api/away/restore', { since: Date.now() + 60 * MIN });
  check('čas z budoucnosti se nebere', h.api.awayOn(), false);
  await volej(h.routy, '/api/away/restore', {});
  check('prázdné tělo taky nic', h.api.awayOn(), false);
}
{
  const h = build();
  await volej(h.routy, '/api/away', { away: true });
  const kdy = h.state.away.since;
  await volej(h.routy, '/api/away/restore', { since: Date.now() - 60 * MIN });
  check('záloha nepřepíše čerstvější zaškrtnutí', h.state.away.since, kdy);
}

konec();

})().catch(err => {
  // Bez tohohle by spadlá scéna sadu tiše ukončila: summary by se nevypsal,
  // návratový kód by byl nula a „0 chyb" by znamenalo „nic se nespustilo".
  check('sada doběhla bez výjimky', err && err.stack, '(nic)');
  konec();
});
