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
                     '// ---------- Tlačítka na Asistentovi');

const MIN = 60000;

function build() {
  const logy = [];
  const zpravy = [];
  const routy = {};
  const api = new Function(
    'app', 'requireAuth', 'addLog', 'broadcast',
    CODE + '\n; return { zavlahaZive, zavlahaNazev, zavlahaPayload, zavlahaCisloZony,'
         + ' zavlahaMinuty, zavlahaOcisti, zavlahaZony, zavlahaZarad, zavlahaVyzvedni,'
         + ' zavlahaZmena, zavlahaPrejmenuj, zavlahaSeznam, ZAVLAHA_MINUT_MAX,'
         + ' ZAVLAHA_TICHO_MS, ZAVLAHA_UKOL_PLATI_MS, ZAVLAHA_FRONTA_MAX,'
         + ' ZAVLAHA_NAZVY_VYCHOZI,'
         + ' get fronta() { return zavlahaFronta; }, set fronta(v) { zavlahaFronta = v; },'
         + ' get stav() { return zavlahaStav; }, set stav(v) { zavlahaStav = v; },'
         + ' get kdy() { return zavlahaKdy; }, set kdy(v) { zavlahaKdy = v; },'
         + ' get nazvy() { return zavlahaNazvy; } };'
  )(
    { get: (c, f) => { routy['GET ' + c] = f; }, post: (c, f) => { routy['POST ' + c] = f; } },
    () => true,
    m => logy.push(m),
    (udalost, data) => zpravy.push({ udalost, data })
  );
  return { api, logy, zpravy, routy };
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

  const obnova = await volej(h, 'POST /api/zavlaha/nazvy/restore', { nazvy: { 2: 'Trávník A' } });
  check('obnova projde', obnova.out.ok, true);
  check('a jméno naskočí', h.api.nazvy[2], 'Trávník A');
  // Obnova po nasazení nesmí spadnout na prázdnu — ta chodí, když se nic neuložilo
  check('prázdná obnova nespadne', (await volej(h, 'POST /api/zavlaha/nazvy/restore', {})).out.ok, true);
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

konec();
})().catch(err => {
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
