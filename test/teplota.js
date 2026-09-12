// Ověření: teplota bazénu platí, jen když voda proudí.
//
// Čidlo sedí v čerpadle, ne v bazénu. Když bazén ani solinátor neběží, voda v trubce
// stojí a vychladne — karta pak ukazovala teplotu trubky a vydávala ji za bazén.
// Proto se drží poslední hodnota naměřená ZA CHODU.
//
// Dvě pasti, na kterých to stojí: hned po rozběhu teče kolem čidla pořád ta vychladlá
// voda z trubky (proto proplach), a po zimě by se jinak ukazovala loňská podzimní
// teplota, dokud se bazén poprvé nerozběhne (proto stáří).
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('teplota bazénu');

const MIN = 60000, H = 3600000;
const CODE = between('// ---------- Teplota bazénu: platí jen při proudící vodě ----------',
                     '// ---------- Tepelné čerpadlo bazénu (Fairland přes Tuya cloud) ----------');

function build({ bazen = false, solinator = false, zima = false, ulozeno = null } = {}) {
  const now = 1_700_000_000_000;
  const state = { poolTemp: ulozeno || { c: null, at: 0, bezOd: 0 } };
  const routy = {};
  const api = new Function(
    'state', 'releBezi', 'isWinter', 'broadcast', 'heatpumpPayload', 'app',
    'HP_VODA_MIN', 'HP_VODA_MAX', 'Date',
    CODE + '\n; return { vodaProudi, recordPoolTemp, poolTempPayload,'
         + ' POOL_TEMP_GRACE_MS, POOL_TEMP_MAX_AGE_MS };'
  )(
    state,
    key => (key === 'pool' ? bazen : key === 'solinator' ? solinator : false),
    () => zima,
    () => {},
    () => ({}),
    { post: (cesta, fn) => { routy[cesta] = fn; } },
    -5, 60,
    class extends Date { static now() { return now; } }
  );
  return { api, state, now, routy };
}

// Pošle teplotu v čase `now + posun`
const zapis = (h, t, posun = 0) => h.api.recordPoolTemp(t, h.now + posun);
const ukaz = (h, posun = 0) => h.api.poolTempPayload(h.now + posun);

nadpis('1) Zapamatuje se jen voda za chodu');
{
  const h = build({ bazen: true });
  zapis(h, 26.4);
  check('hned po rozběhu se ještě nic nebere', h.state.poolTemp.c, null);
  // Trubka je propláchnutá, teprve teď měří čidlo bazén
  zapis(h, 26.4, 6 * MIN);
  check('po proplachu se zapamatuje', h.state.poolTemp.c, 26.4);
  check('  s časem měření', h.state.poolTemp.at, h.now + 6 * MIN);
}
{
  const h = build({ bazen: false, solinator: true });
  zapis(h, 25);             // rozběh se zaznamená prvním voláním
  check('stačí, když jede solinátor', h.state.poolTemp.bezOd, h.now);
  zapis(h, 25, 6 * MIN);
  check('  po jeho proplachu se bere i jeho voda', h.state.poolTemp.c, 25);
}
{
  const h = build();
  zapis(h, 18.2);
  zapis(h, 18.2, 6 * MIN);
  check('stojatá voda se nezapamatuje vůbec', h.state.poolTemp.c, null);
}
{
  // Tohle je celá pointa: dokud běželo, drží se poslední hodnota z chodu
  const h = build({ bazen: true });
  zapis(h, 26.4);
  zapis(h, 26.4, 6 * MIN);
  const vypnuto = build({ ulozeno: { ...h.state.poolTemp } });
  zapis(vypnuto, 18.2, 30 * MIN);
  check('po vypnutí relé chladnoucí trubka nepřepíše', vypnuto.state.poolTemp.c, 26.4);
}
{
  const h = build({ bazen: true, zima: true });
  zapis(h, 26.4);
  zapis(h, 26.4, 6 * MIN);
  check('v zimě se neměří, i kdyby relé běželo', h.state.poolTemp.c, null);
}
{
  const h = build({ bazen: true });
  zapis(h, null);
  zapis(h, null, 6 * MIN);
  check('nehlášená teplota nic nepřepíše', h.state.poolTemp.c, null);
  check('  ale proplach už běží', h.state.poolTemp.bezOd, h.now);
}

nadpis('2) Proplach po rozběhu');
{
  const h = build({ bazen: true });
  zapis(h, 18.2);                 // ještě chladná voda z trubky
  zapis(h, 18.5, 4 * MIN);
  check('čtyři minuty po rozběhu se pořád čeká', h.state.poolTemp.c, null);
  zapis(h, 26.4, 5 * MIN);
  check('po pěti minutách se bere', h.state.poolTemp.c, 26.4);
}
{
  // Vypnutí a znovuzapnutí musí proplach spustit znovu, ne navázat na starý rozběh
  const h = build({ bazen: true });
  zapis(h, 26.4);
  zapis(h, 26.4, 6 * MIN);
  const stop = build({ ulozeno: { ...h.state.poolTemp } });
  zapis(stop, 18, 10 * MIN);      // relé dole → bezOd se nuluje
  check('vypnutím se proplach zruší', stop.state.poolTemp.bezOd, 0);
  const znovu = build({ bazen: true, ulozeno: { ...stop.state.poolTemp } });
  zapis(znovu, 18.2, 20 * MIN);
  check('  a po dalším rozběhu se čeká znovu', znovu.state.poolTemp.c, 26.4);
}

nadpis('3) Co se ukáže na kartě');
{
  const h = build({ bazen: true, ulozeno: { c: 26.4, at: 1_700_000_000_000, bezOd: 1_699_999_000_000 } });
  const p = ukaz(h);
  check('za chodu je teplota živá', `${p.c},${p.zive},${p.duvod}`, '26.4,true,null');
}
{
  const h = build({ ulozeno: { c: 26.4, at: 1_700_000_000_000 - 90 * MIN, bezOd: 0 } });
  const p = ukaz(h);
  check('po vypnutí se ukáže zapamatovaná', p.c, 26.4);
  check('  ale už ne jako živá', p.zive, false);
  check('  a nese čas měření', p.at, h.now - 90 * MIN);
}
{
  const h = build({ bazen: true, ulozeno: { c: 26.4, at: 1_700_000_000_000, bezOd: 1_700_000_000_000 } });
  check('během proplachu ještě není živá', ukaz(h, 2 * MIN).zive, false);
  check('  a po něm ano', ukaz(h, 6 * MIN).zive, true);
}
{
  const h = build({ zima: true, ulozeno: { c: 26.4, at: 1_700_000_000_000, bezOd: 0 } });
  const p = ukaz(h);
  check('v zimě je pomlčka', p.c, null);
  check('  a důvod je zima', p.duvod, 'zima');
}
{
  const h = build();
  check('bez měření je pomlčka', ukaz(h).c, null);
  check('  s důvodem, že se teprve změří', ukaz(h).duvod, 'zatim');
}
{
  // Po zimě by se jinak ukazovala loňská teplota, dokud se bazén poprvé nerozběhne
  const h = build({ ulozeno: { c: 21, at: 1_700_000_000_000 - 50 * H, bezOd: 0 } });
  check('po dvou dnech už to není informace', ukaz(h).c, null);
  check('  a řekne se to jako „zatím"', ukaz(h).duvod, 'zatim');
  const cerstve = build({ ulozeno: { c: 21, at: 1_700_000_000_000 - 47 * H, bezOd: 0 } });
  check('  těsně pod mezí ještě platí', ukaz(cerstve).c, 21);
}

nadpis('4) Obnova ze zálohy');
{
  const h = build();
  const post = h.routy['/api/pool/temp/restore'];
  const volej = telo => {
    let out = null;
    post({ body: telo }, { json: v => { out = v; } });
    return out;
  };
  volej({ c: 26.4, at: h.now - H });
  check('měření ze zálohy se převezme', h.state.poolTemp.c, 26.4);
  volej({ c: 20, at: h.now - 2 * H });
  check('starší měření nepřepíše novější', h.state.poolTemp.c, 26.4);
  volej({ c: 22, at: h.now - 10 * MIN });
  check('novější ano', h.state.poolTemp.c, 22);
  // Ze zálohy smí přijít jen to, co by prošlo i při měření naostro
  volej({ c: -22, at: h.now });
  check('nesmyslná teplota se nepřevezme', h.state.poolTemp.c, 22);
  volej({ c: 24, at: h.now + 10 * H });
  check('měření z budoucnosti taky ne', h.state.poolTemp.c, 22);
  volej({});
  check('prázdné tělo nic nerozbije', h.state.poolTemp.c, 22);
  // Proplach se nedědí: po restartu se neví, jak dlouho už voda koluje
  check('obnova nepředstírá propláchnutou trubku', h.state.poolTemp.bezOd, 0);
}

konec();
