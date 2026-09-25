// Vysavač Xiaomi na straně appky: stav od mostu na NASu a fronta povelů pro něj.
//
// Stejné pasti jako u závlahy:
//  * Most se ozývá po půl minutě, ale když přestane, appka se to nemá jak dozvědět.
//    Jediné, co má, je čas posledního hlášení — podle něj musí přiznat, že stav
//    už nemusí platit.
//  * Povel čeká ve frontě, dokud si pro něj most nepřijde. Starý se zahodí.
//  * „Zastavit" vyhodí i to, co ve frontě ještě stojí.
// A jedna navíc: místnosti se smí poslat jen ty, které most sám hlásí.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('vysavač (appka)');

const CODE = between('// ---------- Vysavač Xiaomi (most na NASu) ----------',
                     '// ---------- Sekačka Anthbot (cloud) ----------');

function build() {
  const logy = [], zpravy = [], routy = {};
  const h = { pustDal: true };
  const api = new Function('app', 'requireAuth', 'addLog', 'broadcast',
    CODE + '\n; return { vysavacZive, vysavacPayload, vysavacOcisti, vysavacZmena, vysavacZarad,'
         + ' vysavacVyzvedni, vysavacUkol, VYSAVAC_TICHO_MS, VYSAVAC_UKOL_PLATI_MS, VYSAVAC_FRONTA_MAX,'
         + ' get fronta() { return vysavacFronta; }, set fronta(v) { vysavacFronta = v; },'
         + ' get stav() { return vysavacStav; }, set stav(v) { vysavacStav = v; },'
         + ' get kdy() { return vysavacKdy; }, set kdy(v) { vysavacKdy = v; } };'
  )(
    { post: (c, fn) => { routy['POST ' + c] = fn; } },
    (req, res) => { if (h.pustDal) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    t => logy.push(t),
    (typ, data) => zpravy.push({ typ, data })
  );
  const volej = (cesta, telo) => {
    let out = null, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    routy[cesta]({ body: telo }, res);
    return { out, kod };
  };
  return Object.assign(h, { api, logy, zpravy, volej });
}

const STAV = {
  status: { kod: 13, popis: 'Charging Completed' }, porucha: { kod: 0, popis: 'No Error' },
  uloha: { kod: 0, popis: 'Idle' }, baterie: 100, nabiji: true, uklidMin: 0, uklidM2: 0,
  kartac: 24, filtr: 37, mop: 20,
  mistnosti: [{ id: '814001007622', jmeno: 'Obývák' }, { id: 814001007614, jmeno: 'Ložnice' }]
};

nadpis('1) Hlášení mostu');
{
  const h = build();
  check('bez hlášení most nežije', h.api.vysavacZive(), false);
  const r = h.volej('POST /api/vysavac/stav', STAV);
  check('hlášení projde', r.kod + ' ' + r.out.ok, '200 true');
  check('  a most žije', h.api.vysavacZive(), true);
  check('  baterie a opotřebení', [h.api.stav.baterie, h.api.stav.kartac, h.api.stav.filtr, h.api.stav.mop].join(','), '100,24,37,20');
  check('  id místností jako text', h.api.stav.mistnosti.map(m => m.id).join(','), '814001007622,814001007614');
  check('  a jde to do appky', h.zpravy.pop().typ, 'vysavac');
  check('stav slovy do Logu', h.logy.includes('Vysavač: Charging Completed'), true);
  check('„No Error" se jako porucha nezapisuje', h.logy.some(t => /porucha/.test(t)), false);
  check('nesmysl neprojde', h.volej('POST /api/vysavac/stav', null).kod, 400);
  const divny = h.api.vysavacOcisti({ baterie: 900, kartac: 'x', mistnosti: [{ id: {}, jmeno: 'x' }, { id: '1', jmeno: 'A' }] });
  check('baterie mimo rozsah se zahodí', divny.baterie, null);
  check('  i místnost bez platného id', divny.mistnosti.length, 1);
  // Živost: po třech minutách ticha se most bere jako odpojený
  h.api.kdy = Date.now() - h.api.VYSAVAC_TICHO_MS - 1;
  check('3 min ticha = most mlčí', h.api.vysavacZive(), false);
}

nadpis('2) Povely z appky');
{
  const h = build();
  check('bez mostu → 503', h.volej('POST /api/vysavac/povel', { typ: 'uklid' }).kod, 503);
  h.volej('POST /api/vysavac/stav', STAV);
  const r = h.volej('POST /api/vysavac/povel', { typ: 'dok' });
  check('povel do doku projde', r.kod, 200);
  check('  a čeká ve frontě', JSON.stringify(h.api.fronta.map(u => u.typ)), '["dok"]');
  check('  v Logu', h.logy.includes('Vysavač: do doku — odesláno'), true);
  check('neznámý povel → 400', h.volej('POST /api/vysavac/povel', { typ: 'vyhodit' }).kod, 400);
  h.pustDal = false;
  check('zamčená appka nepošle nic', h.volej('POST /api/vysavac/povel', { typ: 'uklid' }).kod, 401);
  h.pustDal = true;
  // Stop vyhodí, co ve frontě ještě stojí
  h.volej('POST /api/vysavac/povel', { typ: 'uklid' });
  h.volej('POST /api/vysavac/povel', { typ: 'stop' });
  check('stop vyprázdní frontu', JSON.stringify(h.api.fronta.map(u => u.typ)), '["stop"]');
  // Most si frontu odveze
  const odvoz = h.volej('POST /api/vysavac/stav', STAV).out.ukoly;
  check('most si frontu odveze', JSON.stringify(odvoz), '[{"typ":"stop"}]');
  check('  a fronta je prázdná', h.api.fronta.length, 0);
  // Starý povel se zahodí
  h.api.fronta = [{ typ: 'uklid', at: Date.now() - h.api.VYSAVAC_UKOL_PLATI_MS - 1 }];
  check('starý povel se zahodí', h.volej('POST /api/vysavac/stav', STAV).out.ukoly.length, 0);
  // Přihlášení vypršelo → povely nemají smysl
  h.volej('POST /api/vysavac/stav', { ...STAV, relaceVyprsela: true });
  check('vypršelé přihlášení se zapíše', h.logy.includes('Vysavač: přihlášení na NASu vypršelo'), true);
  const r2 = h.volej('POST /api/vysavac/povel', { typ: 'uklid' });
  check('  a povel se nepošle', r2.kod + ' ' + /--prihlas/.test(r2.out.error), '503 true');
}

nadpis('3) Místnosti');
{
  const h = build();
  h.volej('POST /api/vysavac/stav', STAV);
  const r = h.volej('POST /api/vysavac/povel', { typ: 'mistnosti', ids: ['814001007622', '999', 814001007614, '814001007622'] });
  check('známé místnosti projdou', r.kod, 200);
  check('  cizí id se zahodí a duplicita taky', JSON.stringify(h.api.fronta[0].ids), '["814001007622","814001007614"]');
  check('  v Logu jménem', h.logy.includes('Vysavač: vysát místnosti (Obývák, Ložnice) — odesláno'), true);
  check('jen cizí id → 400', h.volej('POST /api/vysavac/povel', { typ: 'mistnosti', ids: ['999'] }).kod, 400);
}

nadpis('4) Výsledek povelu a porucha');
{
  const h = build();
  h.volej('POST /api/vysavac/stav', STAV);
  h.volej('POST /api/vysavac/stav', { ...STAV, posledniPovel: { typ: 'mistnosti', ok: false, zprava: 'cloud odmítl (kód -704)' } });
  check('neúspěšný povel se zapíše i s důvodem', h.logy.includes('Vysavač: vysát místnosti selhal (cloud odmítl (kód -704))'), true);
  const pocet = h.logy.length;
  h.volej('POST /api/vysavac/stav', { ...STAV, posledniPovel: { typ: 'mistnosti', ok: false, zprava: 'cloud odmítl (kód -704)' } });
  check('  a podruhé se neopakuje', h.logy.length, pocet);
  h.volej('POST /api/vysavac/stav', { ...STAV, porucha: { kod: 12, popis: 'Wheels stuck' } });
  check('nová porucha do Logu', h.logy.includes('Vysavač: porucha — Wheels stuck'), true);
  check('stav je i ve snímku pro appku', h.api.vysavacPayload().stav.porucha.popis, 'Wheels stuck');
}

konec();
