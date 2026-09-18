// Závlaha na straně appky: fronta povelů pro most a stav, který most hlásí.
//
// Tři pasti, kvůli kterým tahle sada existuje:
//  * Most se ozývá po vteřinách, ale appka o něm nemá jak vědět, když přestane.
//    Jediné, co má, je čas posledního hlášení — a podle něj musí přiznat, že
//    stav už nemusí platit, místo aby ho ukazovala jako živý.
//  * Povel čeká ve frontě, dokud si pro něj most nepřijde. Kdyby se tam válel
//    dlouho, pustil by zónu, na kterou už nikdo nečeká.
//  * „Zastavit" musí vyhodit i to, co ve frontě ještě stojí. Jinak by se hned
//    po zastavení rozjela zóna objednaná o vteřinu dřív.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('závlaha (appka)');

const CODE = between('// ---------- Závlaha Rain Bird (most na NASu) ----------',
                     '// ---------- Sekačka Anthbot (cloud) ----------');

const MIN = 60000;

function build() {
  const logy = [];
  const state = { zavlahaDny: [] };
  const zpravy = [];
  const routy = {};
  const api = new Function(
    'state', 'app', 'requireAuth', 'addLog', 'broadcast', 'pragueDateString', 'scheduleEvery',
    CODE + '\n; return { zavlahaZive, zavlahaNazev, zavlahaPayload, zavlahaCisloZony,'
         + ' zavlahaMinuty, zavlahaOcisti, zavlahaZony, zavlahaZarad, zavlahaVyzvedni,'
         + ' zavlahaZmena, zavlahaPrejmenuj, zavlahaSeznam, ZAVLAHA_MINUT_MAX,'
         + ' zavlahaSkryta, zavlahaSchovej, zavlahaZapisBeh, ZAVLAHA_DNU_MAX,'
         + ' zavlahaKroky, zavlahaPlanStart, zavlahaPlanTik, zavlahaPlanHlidej,'
         + ' zavlahaPlanPayload, ZAVLAHA_SERIE_MAX, ZAVLAHA_SERIE_MINUT_MAX, ZAVLAHA_ROZJEZD_MS,'
         + ' get plan() { return zavlahaPlan; }, set plan(v) { zavlahaPlan = v; },'
         + ' get volba() { return zavlahaVolbaMinut; },'
         + ' ZAVLAHA_MEZERA_MAX_MS, ZAVLAHA_SKRYTE_VYCHOZI,'
         + ' get skryte() { return zavlahaSkryte; }, set skryte(v) { zavlahaSkryte = v; },'
         + ' ZAVLAHA_TICHO_MS, ZAVLAHA_UKOL_PLATI_MS, ZAVLAHA_FRONTA_MAX,'
         + ' ZAVLAHA_NAZVY_VYCHOZI,'
         + ' get fronta() { return zavlahaFronta; }, set fronta(v) { zavlahaFronta = v; },'
         + ' get stav() { return zavlahaStav; }, set stav(v) { zavlahaStav = v; },'
         + ' get kdy() { return zavlahaKdy; }, set kdy(v) { zavlahaKdy = v; },'
         + ' get nazvy() { return zavlahaNazvy; } };'
  )(
    state,
    { get: (c, f) => { routy['GET ' + c] = f; }, post: (c, f) => { routy['POST ' + c] = f; } },
    () => true,
    (m, level) => logy.push((level === 'error' ? 'CHYBA ' : '') + m),
    (udalost, data) => zpravy.push({ udalost, data }),
    at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date(at === undefined ? Date.now() : at)),
    () => {}
  );
  return { api, state, logy, zpravy, routy };
}

const volej = (h, cesta, telo) => {
  let out = null, kod = 200;
  const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
  return Promise.resolve(h.routy[cesta]({ body: telo }, res)).then(() => ({ out, kod }));
};

const STAV = { model: 'ESP-TM2', zony: [1, 2, 3, 4, 5, 6, 7, 8], bezi: [], zavlazuje: true, destak: true, odklad: 0 };

(async () => {

nadpis('1) Čísla zón a minuty');
{
  const h = build();
  check('zóna 1 projde', h.api.zavlahaCisloZony(1), 1);
  check('zóna jako text projde', h.api.zavlahaCisloZony('8'), 8);
  check('zóna 0 neprojde', h.api.zavlahaCisloZony(0), null);
  check('zóna 33 neprojde', h.api.zavlahaCisloZony(33), null);
  check('půlka zóny neprojde', h.api.zavlahaCisloZony(2.5), null);
  check('nesmysl neprojde', h.api.zavlahaCisloZony('zahrada'), null);
  check('1 minuta projde', h.api.zavlahaMinuty(1), 1);
  check('0 minut neprojde', h.api.zavlahaMinuty(0), null);
  check('mez projde', h.api.zavlahaMinuty(h.api.ZAVLAHA_MINUT_MAX), h.api.ZAVLAHA_MINUT_MAX);
  check('nad mez neprojde', h.api.zavlahaMinuty(h.api.ZAVLAHA_MINUT_MAX + 1), null);
}

nadpis('2) Seznam zón z hlášení');
{
  const h = build();
  check('projde tak, jak přišel', h.api.zavlahaZony([1, 2, 3]).join(','), '1,2,3');
  check('seřadí se', h.api.zavlahaZony([5, 1, 3]).join(','), '1,3,5');
  check('duplicity se vyhodí', h.api.zavlahaZony([2, 2, 1]).join(','), '1,2');
  check('nesmysly se vyhodí', h.api.zavlahaZony([1, 0, 99, 'x', 3]).join(','), '1,3');
  check('nepole je prázdno', h.api.zavlahaZony('1,2').length, 0);
  check('nic je prázdno', h.api.zavlahaZony(undefined).length, 0);
}

nadpis('3) Hlášení mostu');
{
  const h = build();
  const s = h.api.zavlahaOcisti(STAV);
  check('projde celé', JSON.stringify(s.zony), '[1,2,3,4,5,6,7,8]');
  check('model se nese', s.model, 'ESP-TM2');
  check('čidlo je pravda/nepravda', s.destak, true);
  // Bez seznamu zón to není hlášení, ale šum — takový stav by v appce jen matl
  check('bez zón se hlášení zahodí', h.api.zavlahaOcisti({ ...STAV, zony: [] }), null);
  check('nic se zahodí', h.api.zavlahaOcisti(null), null);
  check('text se zahodí', h.api.zavlahaOcisti('bezva'), null);
  check('zápor v odkladu se nebere', h.api.zavlahaOcisti({ ...STAV, odklad: -3 }).odklad, 0);
  check('nesmyslný odklad se nebere', h.api.zavlahaOcisti({ ...STAV, odklad: 99 }).odklad, 0);
  check('rozumný odklad projde', h.api.zavlahaOcisti({ ...STAV, odklad: 5 }).odklad, 5);
  check('dlouhý model se ořízne', h.api.zavlahaOcisti({ ...STAV, model: 'x'.repeat(80) }).model.length, 40);
  check('běžící zóny se pročistí', h.api.zavlahaOcisti({ ...STAV, bezi: [3, 3, 99] }).bezi.join(','), '3');
}

nadpis('4) Je most naživu?');
{
  const h = build();
  check('bez hlášení není', h.api.zavlahaZive(), false);
  h.api.kdy = 1000000;
  check('čerstvé hlášení je živé', h.api.zavlahaZive(1000000 + MIN), true);
  check('těsně pod mezí ještě žije', h.api.zavlahaZive(1000000 + h.api.ZAVLAHA_TICHO_MS - 1), true);
  check('za mezí už ne', h.api.zavlahaZive(1000000 + h.api.ZAVLAHA_TICHO_MS), false);
}

nadpis('5) Jména zón');
{
  const h = build();
  check('zóna 1 má jméno', h.api.zavlahaNazev(1), 'Trávník dole');
  check('zóna 7 má jméno', h.api.zavlahaNazev(7), 'Dopouštění retenčky');
  // Osmá zóna v ovladači je, ale nikdo neřekl, co zalévá — ať se nevydává za jinou
  check('nepojmenovaná zóna je Zóna N', h.api.zavlahaNazev(8), 'Zóna 8');
  check('výchozích jmen je sedm', Object.keys(h.api.ZAVLAHA_NAZVY_VYCHOZI).length, 7);
  check('seznam se skládá jmény', h.api.zavlahaSeznam([1, 8]), 'Trávník dole, Zóna 8');

  check('přejmenování projde', h.api.zavlahaPrejmenuj({ 8: 'Záhon u plotu' }), true);
  check('a drží', h.api.zavlahaNazev(8), 'Záhon u plotu');
  check('stejné jméno není změna', h.api.zavlahaPrejmenuj({ 8: 'Záhon u plotu' }), false);
  check('mezery se oříznou', h.api.zavlahaPrejmenuj({ 8: '  Plot  ' }) && h.api.zavlahaNazev(8), 'Plot');
  check('dlouhé jméno se ořízne', h.api.zavlahaPrejmenuj({ 8: 'j'.repeat(50) }) && h.api.zavlahaNazev(8).length, 30);
  check('prázdné jméno vrátí Zónu N', h.api.zavlahaPrejmenuj({ 8: '' }) && h.api.zavlahaNazev(8), 'Zóna 8');
  check('neznámá zóna se ignoruje', h.api.zavlahaPrejmenuj({ 99: 'Měsíc' }), false);
  check('nic se ignoruje', h.api.zavlahaPrejmenuj(null), false);
  check('jméno zóny 1 zůstalo', h.api.zavlahaNazev(1), 'Trávník dole');
}

nadpis('6) Fronta povelů');
{
  const h = build();
  h.api.zavlahaZarad({ typ: 'spust', zona: 1, minut: 5 });
  h.api.zavlahaZarad({ typ: 'spust', zona: 2, minut: 5 });
  check('povely se řadí za sebe', h.api.fronta.length, 2);
  check('zařazení se pošle do appky', h.zpravy[h.zpravy.length - 1].udalost, 'zavlaha');

  // Zastavit znamená zastavit — ne zastavit a hned zas pustit, co stálo ve frontě
  h.api.zavlahaZarad({ typ: 'stop' });
  check('stop vyhodí, co čekalo', h.api.fronta.length, 1);
  check('a zůstane jen stop', h.api.fronta[0].typ, 'stop');

  const h2 = build();
  for (let i = 0; i < 10; i++) h2.api.zavlahaZarad({ typ: 'spust', zona: 1, minut: i + 1 });
  check('fronta se nenafoukne', h2.api.fronta.length, h2.api.ZAVLAHA_FRONTA_MAX);
  check('a zůstanou ty poslední', h2.api.fronta[h2.api.ZAVLAHA_FRONTA_MAX - 1].minut, 10);
}

nadpis('7) Vyzvednutí fronty');
{
  const h = build();
  const ted = 5000000;
  h.api.fronta = [
    { typ: 'spust', zona: 1, minut: 5, at: ted - h.api.ZAVLAHA_UKOL_PLATI_MS - 1 },
    { typ: 'spust', zona: 2, minut: 5, at: ted - 1000 }
  ];
  const ukoly = h.api.zavlahaVyzvedni(ted);
  // Starý povel je nebezpečnější než žádný: nikdo u zahrady nestojí a ona se rozjede
  check('starý povel se zahodí', ukoly.length, 1);
  check('a zůstane ten čerstvý', ukoly[0].zona, 2);
  check('fronta se vyprázdní', h.api.fronta.length, 0);
  check('po vyzvednutí je prázdno', h.api.zavlahaVyzvedni(ted).length, 0);
}

nadpis('8) Co se píše do logu');
{
  const h = build();
  check('první hlášení se zapíše', h.api.zavlahaZmena(null, STAV).startsWith('Závlaha: most na NASu se ozval'), true);
  // Most se ozývá každých pár vteřin — bez tohohle by log byl k ničemu
  check('stejný stav se nezapisuje', h.api.zavlahaZmena(STAV, STAV), '');
  check('rozjetá zóna se zapíše', h.api.zavlahaZmena(STAV, { ...STAV, bezi: [1] }),
    'Závlaha: běží Trávník dole');
  check('doběhnutí se zapíše', h.api.zavlahaZmena({ ...STAV, bezi: [1] }, STAV), 'Závlaha: doběhlo');
  check('déšť se zapíše', h.api.zavlahaZmena({ ...STAV, destak: false }, STAV),
    'Závlaha: dešťové čidlo hlásí déšť');
  check('sucho se zapíše', h.api.zavlahaZmena(STAV, { ...STAV, destak: false }),
    'Závlaha: dešťové čidlo je suché');
  check('vypnutí zavlažování se zapíše', h.api.zavlahaZmena(STAV, { ...STAV, zavlazuje: false }),
    'Závlaha: zavlažování vypnuto');
}

nadpis('9) Endpoint pro most');
{
  const h = build();
  const prazdny = await volej(h, 'POST /api/zavlaha/stav', { zony: [] });
  check('hlášení bez zón se odmítne', prazdny.kod, 400);
  check('a stav zůstane prázdný', h.api.stav, null);

  const prvni = await volej(h, 'POST /api/zavlaha/stav', STAV);
  check('hlášení projde', prvni.out.ok, true);
  check('bez čekajících úkolů', prvni.out.ukoly.length, 0);
  check('stav se uloží', h.api.stav.zony.length, 8);
  check('most je naživu', h.api.zavlahaZive(), true);
  check('do logu se to zapsalo', h.logy[0].startsWith('Závlaha: most na NASu se ozval'), true);

  h.api.zavlahaZarad({ typ: 'spust', zona: 3, minut: 10 });
  const druhy = await volej(h, 'POST /api/zavlaha/stav', STAV);
  check('most si odveze úkol', druhy.out.ukoly.length, 1);
  check('a je to ten správný', druhy.out.ukoly[0].zona, 3);
  const treti = await volej(h, 'POST /api/zavlaha/stav', STAV);
  check('podruhé už ho nedostane', treti.out.ukoly.length, 0);
}

nadpis('10) Ovládání z appky');
{
  const h = build();
  const mrtvy = await volej(h, 'POST /api/zavlaha/spust', { zona: 1, minut: 10 });
  // Bez mostu by povel jen tiše ležel ve frontě a člověk by čekal na vodu
  check('bez mostu se nespouští', mrtvy.kod, 503);
  check('a řekne se proč', mrtvy.out.error.includes('Most na NASu se neozývá'), true);
  check('nic se nezařadilo', h.api.fronta.length, 0);

  await volej(h, 'POST /api/zavlaha/stav', STAV);
  const ok = await volej(h, 'POST /api/zavlaha/spust', { zona: 3, minut: 10 });
  check('s mostem to projde', ok.out.success, true);
  check('hláška mluví jménem zóny', ok.out.message, 'Trávník nahoře B: pouštím na 10 min.');
  check('povel čeká ve frontě', h.api.fronta.length, 1);
  check('do logu se to zapsalo', h.logy[h.logy.length - 1], 'Závlaha: Trávník nahoře B na 10 min (ručně)');

  const zona0 = await volej(h, 'POST /api/zavlaha/spust', { zona: 0, minut: 10 });
  check('zóna mimo rozsah se odmítne', zona0.kod, 400);
  const dlouho = await volej(h, 'POST /api/zavlaha/spust', { zona: 1, minut: 999 });
  check('příliš dlouho se odmítne', dlouho.kod, 400);
  check('a řekne se mez', dlouho.out.error.includes(String(h.api.ZAVLAHA_MINUT_MAX)), true);
  check('ve frontě pořád jen ten platný', h.api.fronta.length, 1);

  const stop = await volej(h, 'POST /api/zavlaha/stop', {});
  check('zastavení projde', stop.out.success, true);
  check('a vyhodí čekající povel', h.api.fronta.length, 1);
  check('zůstane jen stop', h.api.fronta[0].typ, 'stop');

  const h2 = build();
  const stopBezMostu = await volej(h2, 'POST /api/zavlaha/stop', {});
  check('zastavení bez mostu se odmítne', stopBezMostu.kod, 503);
}

nadpis('11) Přejmenování přes endpoint');
{
  const h = build();
  const ok = await volej(h, 'POST /api/zavlaha/nazvy', { nazvy: { 8: 'Záhon u plotu' } });
  check('přejmenování projde', ok.out.success, true);
  check('a drží', h.api.nazvy[8], 'Záhon u plotu');
  check('pošle se to do appky', h.zpravy[h.zpravy.length - 1].udalost, 'zavlaha');

  const nic = await volej(h, 'POST /api/zavlaha/nazvy', { nazvy: { 99: 'Měsíc' } });
  check('nesmysl se odmítne', nic.kod, 400);

  const obnova = await volej(h, 'POST /api/zavlaha/zony/restore', { nazvy: { 2: 'Trávník A' } });
  check('obnova projde', obnova.out.ok, true);
  check('a jméno naskočí', h.api.nazvy[2], 'Trávník A');
  // Obnova po nasazení nesmí spadnout na prázdnu — ta chodí, když se nic neuložilo
  check('prázdná obnova nespadne', (await volej(h, 'POST /api/zavlaha/zony/restore', {})).out.ok, true);
  check('a jména zůstanou', h.api.nazvy[2], 'Trávník A');
}

nadpis('12) Co se posílá do appky');
{
  const h = build();
  const p = h.api.zavlahaPayload();
  check('bez mostu je stav prázdný', p.stav, null);
  check('a není živý', p.zive, false);
  check('mez minut se posílá', p.minutMax, h.api.ZAVLAHA_MINUT_MAX);
  check('jména se posílají', p.nazvy[1], 'Trávník dole');

  await volej(h, 'POST /api/zavlaha/stav', { ...STAV, bezi: [5] });
  const p2 = h.api.zavlahaPayload();
  check('se stavem je živý', p2.zive, true);
  check('běžící zóna se posílá', p2.stav.bezi.join(','), '5');
  check('čas hlášení se posílá', p2.kdy > 0, true);
  h.api.zavlahaZarad({ typ: 'stop' });
  check('čekající povel je vidět', h.api.zavlahaPayload().ceka, 1);
}

nadpis('13) Schování zón');
{
  const h = build();
  // Osmá zóna v ovladači je, ale není do ničeho zapojená
  check('osmička je schovaná rovnou', h.api.skryte.join(','), '8');
  check('výchozí seznam není prázdný', h.api.ZAVLAHA_SKRYTE_VYCHOZI.length, 1);
  check('schovaná se pozná', h.api.zavlahaSkryta(8), true);
  check('ostatní schované nejsou', h.api.zavlahaSkryta(3), false);

  check('schování projde', h.api.zavlahaSchovej(3, true), true);
  check('a drží', h.api.zavlahaSkryta(3), true);
  check('seznam je seřazený', h.api.skryte.join(','), '3,8');
  check('podruhé už to není změna', h.api.zavlahaSchovej(3, true), false);
  check('vrácení projde', h.api.zavlahaSchovej(3, false), true);
  check('a zóna je zpátky', h.api.zavlahaSkryta(3), false);
  check('vrátit nevrácené není změna', h.api.zavlahaSchovej(3, false), false);
  check('zóna mimo rozsah se ignoruje', h.api.zavlahaSchovej(99, true), false);
  check('nesmysl se ignoruje', h.api.zavlahaSchovej('zahrada', true), false);
  check('schované jsou v payloadu', h.api.zavlahaPayload().skryte.join(','), '8');
}

nadpis('14) Schovanou zónu nejde pustit');
{
  const h = build();
  await volej(h, 'POST /api/zavlaha/stav', STAV);
  const schovana = await volej(h, 'POST /api/zavlaha/spust', { zona: 8, minut: 10 });
  // Bez tohohle by schování zónu jen přestalo kreslit, ale povel by prošel dál
  check('schovaná zóna se odmítne', schovana.kod, 400);
  check('a řekne se proč', schovana.out.error, 'Zóna 8 je schovaná.');
  check('nic se nezařadilo', h.api.fronta.length, 0);

  const ok = await volej(h, 'POST /api/zavlaha/spust', { zona: 3, minut: 10 });
  check('viditelná projde', ok.out.success, true);

  const endpoint = await volej(h, 'POST /api/zavlaha/skryt', { zona: 8, skryt: false });
  check('vrácení přes endpoint projde', endpoint.out.success, true);
  check('a zóna jde pustit', (await volej(h, 'POST /api/zavlaha/spust', { zona: 8, minut: 5 })).out.success, true);
  check('dvojí vrácení se odmítne', (await volej(h, 'POST /api/zavlaha/skryt', { zona: 8, skryt: false })).kod, 400);
  check('neznámá zóna se odmítne', (await volej(h, 'POST /api/zavlaha/skryt', { zona: 99, skryt: true })).kod, 400);
}

nadpis('15) Kolik která zóna běžela');
{
  const h = build();
  const T = Date.UTC(2026, 8, 17, 10, 0);
  const MIN = 60000;

  // Bez předchozího hlášení není co počítat
  check('bez hlášení se nic nepřipíše', h.api.zavlahaZapisBeh(T), 0);

  h.api.stav = { model: 'x', zony: [1, 2, 3], bezi: [3], zavlazuje: true, destak: false, odklad: 0 };
  h.api.kdy = T;
  check('připíše se uplynulý čas', h.api.zavlahaZapisBeh(T + MIN), MIN);
  check('a sedne na správnou zónu', h.state.zavlahaDny[0].zony[3], MIN);
  check('ostatní zóny nic nedostanou', h.state.zavlahaDny[0].zony[1], undefined);

  // Účtuje se zónám z PŘEDCHOZÍHO hlášení — jen o tom období server něco ví
  h.api.kdy = T + MIN;
  check('další minuta se přičte', h.api.zavlahaZapisBeh(T + 2 * MIN), MIN);
  check('a součet sedí', h.state.zavlahaDny[0].zony[3], 2 * MIN);

  // Dlouhá mezera = výpadek mostu nebo restart Renderu. Ten čas nikdo neměřil.
  h.api.kdy = T;
  check('dlouhá mezera se zahodí', h.api.zavlahaZapisBeh(T + h.api.ZAVLAHA_MEZERA_MAX_MS + 1), 0);
  check('a nic nepřibude', h.state.zavlahaDny[0].zony[3], 2 * MIN);
  check('mezera na hraně ještě projde', h.api.zavlahaZapisBeh(T + h.api.ZAVLAHA_MEZERA_MAX_MS), h.api.ZAVLAHA_MEZERA_MAX_MS);

  // Čas pozpátku (přenastavené hodiny) by jinak součty snížil
  h.api.kdy = T + MIN;
  check('čas pozpátku se zahodí', h.api.zavlahaZapisBeh(T), 0);

  const h2 = build();
  h2.api.stav = { model: 'x', zony: [1, 2], bezi: [], zavlazuje: true, destak: false, odklad: 0 };
  h2.api.kdy = T;
  check('když nic neběží, nic se nepíše', h2.api.zavlahaZapisBeh(T + MIN), 0);
  check('a žádný den nevznikne', h2.state.zavlahaDny.length, 0);

  const h3 = build();
  h3.api.stav = { model: 'x', zony: [1, 2], bezi: [1, 2], zavlazuje: true, destak: false, odklad: 0 };
  h3.api.kdy = T;
  h3.api.zavlahaZapisBeh(T + MIN);
  check('dvě běžící zóny dostanou obě', [h3.state.zavlahaDny[0].zony[1], h3.state.zavlahaDny[0].zony[2]].join(','),
    [MIN, MIN].join(','));

  // Osm dní by přerostlo to, co appka ukazuje
  const h4 = build();
  for (let i = 0; i < 9; i++) {
    h4.state.zavlahaDny.push({ d: `2026-09-0${i + 1}`, zony: { 1: MIN } });
  }
  h4.api.stav = { model: 'x', zony: [1], bezi: [1], zavlazuje: true, destak: false, odklad: 0 };
  h4.api.kdy = T;
  h4.api.zavlahaZapisBeh(T + MIN);
  check('drží se sedm dní', h4.state.zavlahaDny.length, h4.api.ZAVLAHA_DNU_MAX);
  check('a zůstanou ty poslední', h4.state.zavlahaDny[h4.api.ZAVLAHA_DNU_MAX - 1].d, '2026-09-17');
}

nadpis('16) Účtování při hlášení mostu');
{
  const h = build();
  await volej(h, 'POST /api/zavlaha/stav', { ...STAV, bezi: [5] });
  const kdy = h.api.kdy;
  h.api.kdy = kdy - 30000;   // jako by minulé hlášení dorazilo před půl minutou
  await volej(h, 'POST /api/zavlaha/stav', { ...STAV, bezi: [] });
  const den = h.state.zavlahaDny[0];
  // Zóna běžela v PŘEDCHOZÍM hlášení, i když v tom novém už neběží
  check('čas se připsal zóně z minulého hlášení', den.zony[5] >= 30000, true);
  check('a zóna z nového hlášení nic nedostala', den.zony[1], undefined);
  check('dny jsou v payloadu', h.api.zavlahaPayload().dny.length, 1);
}

nadpis('17) Obnova nastavení a časů');
{
  const h = build();
  const obnova = await volej(h, 'POST /api/zavlaha/zony/restore',
    { nazvy: { 2: 'Trávník A' }, skryte: [3, 5] });
  check('obnova projde', obnova.out.ok, true);
  check('jména naskočí', h.api.nazvy[2], 'Trávník A');
  check('schované naskočí', h.api.skryte.join(','), '3,5');
  // Obnova musí umět i ODkrýt — jinak by se osmička nedala nikdy natrvalo vrátit
  check('a osmička se odkryla', h.api.zavlahaSkryta(8), false);
  check('prázdné tělo nespadne', (await volej(h, 'POST /api/zavlaha/zony/restore', {})).out.ok, true);
  check('a nic nepřepíše', h.api.skryte.join(','), '3,5');

  const dny = await volej(h, 'POST /api/zavlaha/dny/restore',
    { dny: [{ d: '2026-09-16', zony: { 1: 600000 } }] });
  check('obnova dnů projde', dny.out.ok, true);
  check('a čas naskočí', h.state.zavlahaDny[0].zony[1], 600000);

  // Vyšší hodnota vyhrává: server po restartu začíná od nuly, telefon má nastřádáno
  await volej(h, 'POST /api/zavlaha/dny/restore', { dny: [{ d: '2026-09-16', zony: { 1: 60000 } }] });
  check('nižší hodnota nepřepíše vyšší', h.state.zavlahaDny[0].zony[1], 600000);
  await volej(h, 'POST /api/zavlaha/dny/restore', { dny: [{ d: '2026-09-16', zony: { 1: 900000 } }] });
  check('vyšší přepíše', h.state.zavlahaDny[0].zony[1], 900000);

  check('obnova bez dnů se odmítne', (await volej(h, 'POST /api/zavlaha/dny/restore', {})).kod, 400);
  await volej(h, 'POST /api/zavlaha/dny/restore', { dny: [{ d: '2099-01-01', zony: { 1: 60000 } }] });
  check('budoucí den se ignoruje', h.state.zavlahaDny.length, 1);
  await volej(h, 'POST /api/zavlaha/dny/restore', { dny: [{ d: '2026-09-15', zony: { 99: 60000, 2: -5 } }] });
  check('nesmyslné hodnoty se ignorují', h.state.zavlahaDny.length, 1);
}

nadpis('18) Kroky řady');
{
  const h = build();
  check('prázdná řada se odmítne', h.api.zavlahaKroky([]).chyba, 'Chybí zóny.');
  check('nepole se odmítne', h.api.zavlahaKroky('1,2').chyba, 'Chybí zóny.');
  check('platná řada projde', h.api.zavlahaKroky([{ zona: 1, minut: 10 }]).kroky.length, 1);
  check('  a spočítá se součet', h.api.zavlahaKroky([{ zona: 1, minut: 10 }, { zona: 2, minut: 5 }]).celkem, 15);
  // Pořadí je to, co přišlo z appky — v něm je smysl
  check('pořadí zůstává', h.api.zavlahaKroky([{ zona: 3, minut: 1 }, { zona: 1, minut: 1 }])
    .kroky.map(k => k.zona).join(','), '3,1');
  check('stejná zóna dvakrát projde', h.api.zavlahaKroky([{ zona: 1, minut: 1 }, { zona: 1, minut: 2 }]).kroky.length, 2);
  check('neznámá zóna se odmítne', h.api.zavlahaKroky([{ zona: 99, minut: 5 }]).chyba, 'Neznámá zóna.');
  check('schovaná zóna se odmítne', h.api.zavlahaKroky([{ zona: 8, minut: 5 }]).chyba, 'Zóna 8 je schovaná.');
  check('nesmyslné minuty se odmítnou', h.api.zavlahaKroky([{ zona: 1, minut: 0 }]).chyba.includes('Minuty'), true);

  const moc = Array.from({ length: h.api.ZAVLAHA_SERIE_MAX + 1 }, () => ({ zona: 1, minut: 1 }));
  check('moc kroků se odmítne', h.api.zavlahaKroky(moc).chyba.includes(String(h.api.ZAVLAHA_SERIE_MAX)), true);
  // Půldenní zálivka je skoro jistě překlep, ne záměr
  const dlouha = Array.from({ length: 5 }, () => ({ zona: 1, minut: 120 }));
  check('moc minut se odmítne', h.api.zavlahaKroky(dlouha).chyba.includes(String(h.api.ZAVLAHA_SERIE_MINUT_MAX)), true);
}

nadpis('19) Řada krok za krokem');
{
  const h = build();
  const T = 5000000;
  const MIN = 60000;
  const KROKY = [{ zona: 1, minut: 10 }, { zona: 3, minut: 5 }, { zona: 5, minut: 2 }];

  h.api.zavlahaPlanStart(KROKY, T);
  check('první krok se zařadí', h.api.fronta.length, 1);
  check('  a je to první zóna', h.api.fronta[0].zona, 1);
  check('  na svoje minuty', h.api.fronta[0].minut, 10);
  check('plán ví, kde je', h.api.zavlahaPlanPayload(T).index, 0);
  check('  a kolik zbývá', h.api.zavlahaPlanPayload(T).zbyva, 10 * MIN);

  // Dokud zóna běží, řada čeká
  h.api.stav = { model: 'x', zony: [1, 3, 5], bezi: [1], zavlazuje: true, destak: false, odklad: 0 };
  check('běžící zóna řadu nepustí dál', h.api.zavlahaPlanTik(T + 5 * MIN), '');
  check('  a plán zůstává na prvním', h.api.plan.index, 0);

  // Rozjezdový odklad: hned po povelu zóna ještě neběží, to není důvod přeskočit
  const h2 = build();
  h2.api.zavlahaPlanStart(KROKY, T);
  h2.api.stav = { model: 'x', zony: [1, 3, 5], bezi: [], zavlazuje: true, destak: false, odklad: 0 };
  check('těsně po startu se nepřeskakuje', h2.api.zavlahaPlanTik(T + 10000), '');
  check('  ani na hraně odkladu', h2.api.zavlahaPlanTik(T + h2.api.ZAVLAHA_ROZJEZD_MS), '');
  check('po odkladu se pozná, že zóna nejede',
    h2.api.zavlahaPlanTik(T + h2.api.ZAVLAHA_ROZJEZD_MS + 1).includes('Trávník nahoře B'), true);
  check('  a řada jde dál', h2.api.plan.index, 1);
  check('  a zařadí se druhá zóna', h2.api.fronta[h2.api.fronta.length - 1].zona, 3);

  // Uplynulý čas kroku řadu posune i tehdy, když zóna pořád běží
  check('po uplynutí času se jde dál',
    h2.api.zavlahaPlanTik(T + h2.api.ZAVLAHA_ROZJEZD_MS + 1 + 5 * MIN).includes('Kapka záhon zahrada'), true);
  check('  a je to poslední krok', h2.api.plan.index, 2);
  const konecHlaska = h2.api.zavlahaPlanTik(T + 999 * MIN);
  check('poslední krok řadu ukončí', konecHlaska, 'Závlaha: řada dozalévala');
  check('  a plán zmizí', h2.api.plan, null);
  check('bez plánu se nic neděje', h2.api.zavlahaPlanTik(T + 1000 * MIN), '');
}

nadpis('20) Řada přes endpoint');
{
  const h = build();
  const bezMostu = await volej(h, 'POST /api/zavlaha/serie', { kroky: [{ zona: 1, minut: 5 }] });
  check('bez mostu se řada nespustí', bezMostu.kod, 503);
  check('  a plán nevznikne', h.api.plan, null);

  await volej(h, 'POST /api/zavlaha/stav', STAV);
  const ok = await volej(h, 'POST /api/zavlaha/serie',
    { kroky: [{ zona: 1, minut: 10 }, { zona: 3, minut: 5 }] });
  check('s mostem projde', ok.out.success, true);
  check('  a řekne, co poběží', ok.out.message, 'Řada běží: Trávník dole, Trávník nahoře B.');
  check('  a vrátí plán', ok.out.plan.kroky.length, 2);
  check('zařadil se první krok', h.api.fronta[0].zona, 1);
  check('do logu se to zapsalo', h.logy[h.logy.length - 1].includes('řada 2 zón na 15 min'), true);
  // Minuty se pamatují, ať se příště nemusí klikat znovu
  check('minuty se zapamatovaly', `${h.api.volba[1]},${h.api.volba[3]}`, '10,5');
  check('  a jdou do appky', h.api.zavlahaPayload().minuty[1], 10);
  check('plán je v payloadu', h.api.zavlahaPayload().plan.index, 0);

  // Zastavit znamená zastavit, ne „zastav a za chvíli pusť další zónu"
  const stop = await volej(h, 'POST /api/zavlaha/stop', {});
  check('stopka řadu zruší', h.api.plan, null);
  check('  a řekne to', h.logy[h.logy.length - 1], 'Závlaha: řada zrušena (ručně)');
  check('  a odpoví', stop.out.success, true);

  // Jedna zóna ručně si taky pamatuje minuty
  await volej(h, 'POST /api/zavlaha/spust', { zona: 5, minut: 30 });
  check('ruční puštění si minuty pamatuje', h.api.volba[5], 30);

  // Řadu posouvá hlášení mostu — nic jiného v appce netiká tak často.
  // Bez tohohle zapojení by plán vznikl a zůstal stát na prvním kroku.
  const h3 = build();
  await volej(h3, 'POST /api/zavlaha/stav', STAV);
  await volej(h3, 'POST /api/zavlaha/serie', { kroky: [{ zona: 1, minut: 10 }, { zona: 3, minut: 5 }] });
  h3.api.plan.doKdy = Date.now() - 1000;   // jako by první krok právě dozaléval
  h3.api.fronta = [];
  const hlaseni = await volej(h3, 'POST /api/zavlaha/stav', STAV);
  check('hlášení mostu řadu posune', h3.api.plan.index, 1);
  // Další zóna se mostu předá rovnou v odpovědi, ne až za patnáct vteřin
  check('  a most si hned odveze další zónu', hlaseni.out.ukoly[0].zona, 3);
  check('  a zapíše to do logu', h3.logy[h3.logy.length - 1].includes('řada pokračuje'), true);
}

nadpis('21) Mlčící most řadu zruší');
{
  const h = build();
  await volej(h, 'POST /api/zavlaha/stav', STAV);
  await volej(h, 'POST /api/zavlaha/serie', { kroky: [{ zona: 1, minut: 10 }, { zona: 3, minut: 5 }] });
  h.api.zavlahaPlanHlidej();
  check('dokud most hlásí, plán běží', h.api.plan === null, false);
  // Řada, která by se probrala za dvě hodiny, by zalévala v noci
  h.api.kdy = Date.now() - 2 * h.api.ZAVLAHA_TICHO_MS;
  h.api.zavlahaPlanHlidej();
  check('mlčící most plán zruší', h.api.plan, null);
  check('  a zapíše se to jako chyba', h.logy[h.logy.length - 1].startsWith('CHYBA'), true);
  check('bez plánu hlídač nic nedělá', h.api.zavlahaPlanHlidej(), undefined);
}

nadpis('22) Obnova volby minut');
{
  const h = build();
  const obnova = await volej(h, 'POST /api/zavlaha/zony/restore', { minuty: { 2: 25, 99: 5, 3: 0 } });
  check('obnova projde', obnova.out.ok, true);
  check('platná volba naskočí', h.api.volba[2], 25);
  check('neznámá zóna se ignoruje', h.api.volba[99], undefined);
  check('nesmyslné minuty se ignorují', h.api.volba[3], undefined);
}

konec();
})().catch(err => {
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
