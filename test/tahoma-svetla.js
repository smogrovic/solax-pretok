// Ověření: světla z TaHomy, která stav sama nehlásí (RTS — terasa). Server si
// pamatuje poslední ON/OFF, který TaHomě poslal, a ukáže ho jako odhad.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('světla TaHoma');

const CODE = between('let blindsCache = { ts: 0, list: [] };', 'async function getBlinds() {') + '\n'
  + fn('async function getBlinds() {') + '\n'
  + fn('async function tahomaExec(label, deviceURL, commands) {');

function build(zarizeni) {
  const volani = [];
  const tahomaFetch = async (cesta, opts) => {
    volani.push(cesta);
    if (cesta === '/setup/devices') return zarizeni;
    if (cesta === '/setup/places') return { oid: 'p', label: 'Dům', subPlaces: [{ oid: 't', label: 'Terasa' }] };
    if (cesta === '/exec/apply') return { execId: 'x1' };
    return null;
  };
  return new Function('tahomaFetch', 'delay',
    CODE + '\n; return { getBlinds, tahomaExec, tahomaSpinacStav, spinace: () => tahomaSpinace,'
         + ' zneplatni: () => { blindsCache = { ts: 0, list: [] }; } };'
  )(tahomaFetch, async () => {});
}

const svetlo = (url, states = []) => ({
  deviceURL: url, label: 'Světla terasa', uiClass: 'Light', placeOID: 't',
  definition: { commands: [{ commandName: 'on' }, { commandName: 'off' }] }, states
});

(async () => {
  nadpis('1) Světlo na RTS stav nehlásí');
  {
    const h = build([svetlo('rts://terasa')]);
    let b = (await h.getBlinds())[0];
    check('bez povelu je stav neznámý', b.onState, null);
    check('  a není to odhad', b.onStateOdhad, false);
    await h.tahomaExec('Světla terasa', 'rts://terasa', [{ name: 'on', parameters: [] }]);
    h.zneplatni();
    b = (await h.getBlinds())[0];
    check('po ON z appky svítí', b.onState, true);
    check('  jako odhad', b.onStateOdhad, true);
    await h.tahomaExec('Světla terasa', 'rts://terasa', [{ name: 'off', parameters: [] }]);
    h.zneplatni();
    check('OFF ho přepne', (await h.getBlinds())[0].onState, false);
  }

  nadpis('2) Rolety nic nezapisují');
  {
    const h = build([]);
    await h.tahomaExec('Obývák', 'rts://roleta', [{ name: 'down', parameters: [] }]);
    check('povel dolů stav světla nezaloží', 'rts://roleta' in h.spinace(), false);
  }

  nadpis('3) Když TaHoma stav hlásí, má přednost');
  {
    const h = build([svetlo('io://pergola', [{ name: 'core:OnOffState', value: 'off' }])]);
    await h.tahomaExec('Pergola', 'io://pergola', [{ name: 'on', parameters: [] }]);
    h.zneplatni();
    const b = (await h.getBlinds())[0];
    check('skutečný stav přebije náš povel', b.onState, false);
    check('  a není to odhad', b.onStateOdhad, false);
    check('stav z TaHomy „on“', h.tahomaSpinacStav('io://x', 'on').onState, true);
  }

  konec();
})().catch(e => { console.log('CHYBA  sada doběhla bez výjimky → ' + e.message); process.exit(1); });
