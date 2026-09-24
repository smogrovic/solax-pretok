// Ověření: naklopení žaluzie poslané během jízdy počká, až žaluzie dojede.
// Dřív ho TaHoma vzala jako nový povel a rozjetou žaluzii zastavila.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('žaluzie: naklopení po dojetí');

const CODE = between('let blindsCache = { ts: 0, list: [] };', 'async function getBlinds() {') + '\n'
  + fn('async function getBlinds() {') + '\n'
  + fn('async function tahomaExec(label, deviceURL, commands) {') + '\n'
  + between('const EXEC_WAIT_MAX_MS', '// action: up / down / stop / on / off / orientation / closure') + '\n'
  + fn('async function blindCommand(deviceURL, action, value, tilt) {');

const URL = 'io://obyvak';
function build() {
  const poslano = [];            // co odešlo na /exec/apply
  const bezi = new Set();        // execId, které TaHoma hlásí v /exec/current
  let dalsiId = 1;
  const cekani = [];             // čekající delay() — pouští je test
  let ted = 1790000000000, cteni = 0;   // podvržené hodiny a kolikrát se četla zařízení
  const tahomaFetch = async (cesta, opts) => {
    if (cesta === '/setup/devices') {
      cteni++;
      return [{ deviceURL: URL, label: 'Obývák', uiClass: 'ExteriorVenetianBlind', placeOID: 'o',
        definition: { commands: ['open', 'close', 'stop', 'setClosure', 'setOrientation'].map(c => ({ commandName: c })) },
        states: [] }];
    }
    if (cesta === '/setup/places') return { oid: 'o', label: 'Obývák' };
    if (cesta === '/exec/current') return [...bezi].map(id => ({ id }));
    if (cesta === '/exec/apply') {
      const telo = JSON.parse(opts.body);
      const id = 'e' + dalsiId++;
      poslano.push(telo.actions[0].commands.map(c => c.name + (c.parameters.length ? ':' + c.parameters.join(',') : '')).join('+'));
      return { execId: id };
    }
    return null;
  };
  // Čekání mezi dotazy na dojetí (2 s) pouští test sám; ostatní (obnova stavů
  // v getBlinds) proběhne hned
  const delay = ms => ms === 2000 ? new Promise(r => cekani.push(r)) : Promise.resolve();
  const FakeDate = class extends Date { static now() { return ted; } };
  const api = new Function('tahomaFetch', 'delay', 'console', 'Date',
    CODE + '\n; return { blindCommand, getBlinds, ceka: () => tahomaNaklopeniCeka };'
  )(tahomaFetch, delay, { error() {}, log() {} }, FakeDate);
  // Pustí všechna čekání a nechá doběhnout, co na ně navazuje
  const tik = async () => {
    for (let i = 0; i < 5; i++) { while (cekani.length) cekani.shift()(); await new Promise(r => setImmediate(r)); }
  };
  return { api, poslano, bezi, tik, posledniId: () => 'e' + (dalsiId - 1),
    posun: ms => { ted += ms; }, cteni: () => cteni };
}

(async () => {
  nadpis('1) Naklopení během jízdy počká');
  {
    const h = build();
    await h.api.blindCommand(URL, 'closure', 60);
    h.bezi.add(h.posledniId());          // žaluzie jede
    const r = await h.api.blindCommand(URL, 'orientation', 40);
    check('odpověď řekne, že čeká', r.ceka, true);
    check('  a naklopení zatím neodešlo', h.poslano.join(' | '), 'setClosure:60');
    await h.tik();
    check('dokud jede, pořád nic', h.poslano.length, 1);
    h.bezi.clear();                      // dojela
    await h.tik();
    check('po dojetí se naklopí', h.poslano.join(' | '), 'setClosure:60 | setOrientation:40');
  }

  nadpis('2) Víc naklopení za sebou — platí poslední');
  {
    const h = build();
    await h.api.blindCommand(URL, 'closure', 30);
    h.bezi.add(h.posledniId());
    await h.api.blindCommand(URL, 'orientation', 20);
    await h.api.blindCommand(URL, 'orientation', 70);
    h.bezi.clear();
    await h.tik();
    check('odejde jen poslední naklopení', h.poslano.join(' | '), 'setClosure:30 | setOrientation:70');
  }

  nadpis('3) Stop čekající naklopení zruší');
  {
    const h = build();
    await h.api.blindCommand(URL, 'closure', 30);
    h.bezi.add(h.posledniId());
    await h.api.blindCommand(URL, 'orientation', 20);
    await h.api.blindCommand(URL, 'stop', null);
    h.bezi.clear();
    await h.tik();
    check('po stopu se už nenaklápí', h.poslano.join(' | '), 'setClosure:30 | stop');
  }

  nadpis('4) Bez jízdy se naklápí hned');
  {
    const h = build();
    const r = await h.api.blindCommand(URL, 'orientation', 50);
    check('odejde hned', h.poslano.join(' | '), 'setOrientation:50');
    check('  a nečeká', !!r.ceka, false);
    await h.api.blindCommand(URL, 'closure', 10);
    // Jízda doběhla (v /exec/current už není) — naklopení jde rovnou
    await h.api.blindCommand(URL, 'orientation', 80);
    check('po dojeté jízdě taky hned', h.poslano.slice(-1)[0], 'setOrientation:80');
  }

  nadpis('5) Během jízdy se seznam nedrží minutu v cache');
  {
    const h = build();
    await h.api.getBlinds();
    const n = h.cteni();
    h.posun(6000);
    await h.api.getBlinds();
    check('bez jízdy platí minutová cache', h.cteni(), n);
    await h.api.blindCommand(URL, 'closure', 60);     // povel cache zneplatní a čte se znovu
    await h.api.getBlinds();
    const m = h.cteni();
    h.posun(6000);
    await h.api.getBlinds();
    check('po jízdě se za 6 s čte znovu', h.cteni(), m + 1);
    h.posun(3 * 60000);
    await h.api.getBlinds();
    const k = h.cteni();
    h.posun(6000);
    await h.api.getBlinds();
    check('2 min po jízdě zase minutová cache', h.cteni(), k);
  }

  konec();
})().catch(e => { console.log('CHYBA  sada doběhla bez výjimky → ' + e.message); process.exit(1); });
