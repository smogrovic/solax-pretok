// Stránka Sauna + „vypnuto saunou" u bazénu a solinátoru
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const OUT = [];
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
function check(name, got, want) {
  const ok = String(got) === String(want);
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(56) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const MIN = 60000, H = 3600000, DEN = 24 * H;

(async () => {
 try {
  await wait(120);
  const T = Date.now();
  const ted = () => new Date().toISOString();

  OUT.push('\\n1) Semafor a odběr');
  saunaData = { powerW: 6200, fetchedAt: ted(), topi: true, since: T - 40 * MIN, blockUntil: T + 30 * MIN, limitW: 500 };
  renderSauna();
  check('semafor svítí zeleně, když topí', saunaLight.className, 'traffic-light on');
  check('  stav to říká slovy', saunaState.textContent, 'topí');
  check('  a ukazuje kolik bere', saunaPower.textContent, '6,2 kW');
  check("  s dobou topení", /Topí 40 min/.test(saunaHint.textContent), "true");
  // Dokdy drží blokace, nese nově řádek pod odběrem — v hlášce by to bylo dvakrát
  check('  a blokaci nechává řádku níž',
    /do \\d\\d?:\\d\\d/.test(document.getElementById('saunaMeta').textContent), 'true');

  saunaData = { powerW: 120, fetchedAt: ted(), topi: false, since: T - 40 * MIN, blockUntil: T + 20 * MIN, limitW: 500 };
  renderSauna();
  check('mezi nátopy je oranžová (termostat)', saunaLight.className, 'traffic-light warm');
  check('  a stav „v pauze"', saunaState.textContent, 'v pauze');

  saunaData = { powerW: 3, fetchedAt: ted(), topi: false, since: 0, blockUntil: 0, limitW: 500 };
  renderSauna();
  check('vypnutá sauna má červenou', saunaLight.className, 'traffic-light off');
  check('  a řekne, od čeho se počítá zapnuto', /od 500 W/.test(saunaHint.textContent), 'true');

  saunaData = { powerW: 500, fetchedAt: new Date(T - 40 * MIN).toISOString(), topi: false, since: 0, blockUntil: 0, limitW: 500 };
  renderSauna();
  check('stará data = šedý semafor', saunaLight.className, 'traffic-light');
  check('  a odběr se nepředstírá', saunaPower.textContent, '–');

  OUT.push('\\n2) Bazén a solinátor vědí, že je vypnula sauna');
  saunaData = { powerW: 6000, fetchedAt: ted(), topi: true, since: T, blockUntil: T + 30 * MIN, limitW: 500 };
  deviceData.pool = { online: true, isOn: false, fetchedAt: ted() };
  deviceData.solinator = { online: true, isOn: false, fetchedAt: ted() };
  manualHoldData = { pool: T + 10 * MIN };
  renderManualHold();
  check('u bazénu stojí „vypnuto saunou"', /Vypnuto saunou/.test(document.getElementById('poolHold').textContent), 'true');
  check('  a přebíjí i ruční odklad', /Ručně/.test(document.getElementById('poolHold').textContent), 'false');
  check('u solinátoru taky', /Vypnuto saunou/.test(document.getElementById('solinatorHold').textContent), 'true');
  saunaData = { powerW: 0, fetchedAt: ted(), topi: false, since: 0, blockUntil: 0, limitW: 500 };
  renderManualHold();
  check('po dotopení se vrátí ruční odklad', /Ručně/.test(document.getElementById('poolHold').textContent), 'true');

  OUT.push('\\n3) Sedmidenní spotřeba');
  const den = i => {
    const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  saunaDaysData = [{ d: den(0), wh: 12500, ms: 2 * H }, { d: den(2), wh: 8000, ms: 90 * MIN },
                   { d: den(9), wh: 4000, ms: 60 * MIN }];
  renderSaunaDays();
  check('ukazuje se jen součet za 7 dní', saunaTotal.textContent, '20,5 kWh');
  check('  rozpis po dnech je pryč', document.getElementById('saunaList'), 'null');

  OUT.push('\\n4) Záloha v telefonu');
  saveSaunaDaysLocal();
  check('uloží se a načte zpátky', loadSaunaDaysLocal().length, saunaDaysData.length);
  check('slučování bere vyšší hodnotu', JSON.stringify(mergeSaunaDays(
    [{ d: '2026-08-20', wh: 100, ms: 60 }], [{ d: '2026-08-20', wh: 900, ms: 30 }])),
    '[{"d":"2026-08-20","wh":900,"ms":60}]');

  OUT.push('\\n5) Bez nastaveného měřáku stránka zůstává');
  check('stránka existuje', !!document.getElementById('saunaSlide'), 'true');
  saunaEnabledFlag = false;
  renderSauna();
  check('  a nezmizí, jen řekne co chybí', !!document.getElementById('saunaSlide'), 'true');
  check('  semafor je šedý', saunaLight.className, 'traffic-light');
  check('  stav: zatím nenastavená', saunaState.textContent, 'zatím nenastavená');
  check('  záložka Sauna je v liště', Array.from(document.querySelectorAll('#pageTabs .page-tab')).some(t => t.textContent === 'Sauna'), 'true');
  saunaEnabledFlag = true;

  OUT.push('\\n5b) Věta o skriptu a blokaci');
  const M = Date.now();
  saunaData = { powerW: 6200, fetchedAt: new Date(M - 60000).toISOString(), topi: true,
    since: M - 10 * MIN, blockUntil: M + 25 * MIN, limitW: 500, holdMin: 30,
    scriptAt: M - 3 * MIN };
  renderSauna();
  const meta = document.getElementById('saunaMeta');
  const hint = document.getElementById('saunaHint');
  check('řádek s podrobnostmi existuje', !!meta, 'true');
  // Měřák se ptá každé dvě minuty, takže „poslední měření" je pořád „před chvílí"
  check('čas posledního měření se nepíše', /Měření z Shelly/.test(meta.textContent), 'false');
  check('ukáže, kdy skript hlásil saunu', /Skript hlásil saunu \\d\\d?:\\d\\d/.test(meta.textContent), 'true');
  check('  a nehlásí, že se neozval', /neozval/.test(meta.textContent), 'false');
  check('ukáže, dokdy drží blokace', /bazén a solinátor blokované do \\d\\d?:\\d\\d/.test(meta.textContent), 'true');
  check('obojí je na jednom řádku', meta.children.length, 1);
  check('  oddělené tečkou', / · /.test(meta.textContent), 'true');
  // Hláška nad řádkem nesla tentýž čas — prvky jsou přímo pod sebou, tak to bilo do očí
  check('hláška výš už blokaci neopakuje', /blokované|drží vypnuté/.test(hint.textContent), 'false');
  check('  ale dobu topení pořád ukáže', /Topí/.test(hint.textContent), 'true');

  saunaData = { ...saunaData, scriptAt: 0 };
  renderSauna();
  check('bez skriptu to řekne', /Skript v Shelly se zatím neozval/.test(meta.textContent), 'true');
  check('  a je to šedě', !!meta.querySelector('.skript-ne'), 'true');
  check('  blokace zůstává vedle', /blokované do/.test(meta.textContent), 'true');
  saunaData = { ...saunaData, blockUntil: 0, topi: false, since: 0 };
  renderSauna();
  check('bez blokace se ta část neukazuje', /blokované do/.test(meta.textContent), 'false');
  saunaData = { ...saunaData, scriptAt: M - 3 * MIN };
  renderSauna();
  check('  a zůstane samotný skript', meta.textContent.trim(), 'Skript hlásil saunu ' + fmtSolTime(M - 3 * MIN));
  saunaEnabledFlag = false;
  renderSauna();
  check('bez měřáku je řádek prázdný', meta.textContent, '');
  saunaEnabledFlag = true;

  OUT.push('\\n6) Kamna HUUM — náhled bez připojení');
  const radek = k => document.querySelector('[data-huum="' + k + '"]');
  const vidi = k => { const r = radek(k); return !!r && !r.hidden; };
  huumData = { enabled: false, error: null };
  renderHuum();
  check('semafor je šedý', huumLight.className, 'traffic-light');
  check('stav: zatím nepřipojená', huumState.textContent, 'zatím nepřipojená');
  check('teplota je pomlčka', huumTemp.textContent, '– °C');
  check('cíl taky', huumTarget.textContent, '– °C');
  check('hláška řekne, co doplnit', /HUUM_USER a HUUM_PASS/.test(huumHint.textContent), 'true');
  // Náhled: ukazují se VŠECHNY řádky, ať je co ladit
  const vsechny = ['door', 'end', 'left', 'humidity', 'light'];
  check('všech 5 řádků je vidět', vsechny.filter(vidi).length, 5);
  // Parní vyvíječ, název sauny a celá karta „Meze jednotky" jsou pryč — na stránku
  // se chodí kvůli teplotě, ne kvůli tabulce parametrů, co se nikdy nemění
  check('parní vyvíječ je pryč', !!radek('steamer'), 'false');
  check('název sauny taky', !!radek('name'), 'false');
  check('a karta s mezemi jednotky neexistuje',
    !!document.getElementById('huumLimitsCard'), 'false');
  check('  a všechny mají pomlčku',
    vsechny.every(k => radek(k).querySelector('.stat-val').textContent === '–'), 'true');

  OUT.push('\\n7) Kamna HUUM — s daty');
  huumData = { enabled: true, statusCode: 231, statusText: 'topí', heating: true,
    temperature: 78, targetTemperature: 90, doorClosed: true, humidity: 35,
    targetHumidity: 40, light: 1, steamerError: 0, config: 3, configText: 'vyvíječ i světlo',
    endDate: Math.round((T + 80 * MIN) / 1000), saunaName: 'Chata',
    limits: { minTemp: 40, maxTemp: 110, minHeatingTime: 1, maxHeatingTime: 3,
              minTimer: 0, maxTimer: 12, childLock: 'OFF' },
    fetchedAt: new Date(T).toISOString(), error: null };
  renderHuum();
  check('semafor svítí, když topí', huumLight.className, 'traffic-light on');
  check('stav slovy', huumState.textContent, 'topí');
  check('teplota v sauně', huumTemp.textContent, '78 °C');
  check('cílová teplota', huumTarget.textContent, '90 °C');
  check('dveře zavřené', huumDoor.textContent, 'zavřené');
  check('zbývá se dopočítá', huumLeft.textContent, '1:20');
  check('vlhkost i s cílem', huumHumidity.textContent, '35 % (cíl 40 %)');
  check('světlo', huumLightState.textContent, 'zapnuto');
  check('hláška ukáže vybavení', /vyvíječ i světlo/.test(huumHint.textContent), 'true');

  OUT.push('\\n8) Kamna HUUM — mezní stavy');
  // Cílovou teplotu API nevrací, dokud sauna netopí
  huumData = { ...huumData, statusCode: 232, statusText: 'připravená', heating: false,
    targetTemperature: null, endDate: null, humidity: null };
  renderHuum();
  check('bez cíle je pomlčka', huumTarget.textContent, '– °C');
  check('  ale teplota zůstane', huumTemp.textContent, '78 °C');
  check('semafor zhasne', huumLight.className, 'traffic-light off');
  check('prázdné řádky se po připojení schovají', vidi('humidity'), 'false');
  check('  i „topí do"', vidi('end'), 'false');
  check('  ale dveře zůstanou', vidi('door'), 'true');
  huumData = { ...huumData, doorClosed: false };
  renderHuum();
  check('otevřené dveře se poznají', huumDoor.textContent, 'otevřené');
  huumData = { enabled: true, statusCode: 232, fetchedAt: new Date(T - 30 * MIN).toISOString() };
  renderHuum();
  check('stará data = nedostupná', huumState.textContent, 'nedostupná');
  huumData = { enabled: true, error: 'HUUM: neplatné jméno nebo heslo.' };
  renderHuum();
  check('chyba se ukáže', /neplatné jméno/.test(huumHint.textContent), 'true');

  OUT.push('\\n8b) Kdy naposledy dorazila data');
  // Ražítko se na serveru při chybě neobnovuje, takže tenhle řádek je jediné místo,
  // kde je zmrzlá teplota poznat — karta jinak vypadá úplně normálně
  huumData = { enabled: true, statusCode: 232, fetchedAt: new Date(T - 90 * MIN).toISOString() };
  renderHuum();
  check('u zmrzl\u00fdch dat je vid\u011bt, odkdy jsou',
    huumKdy.textContent, 'Naposledy ' + fmtSolTime(T - 90 * MIN));
  huumData = { enabled: false, error: null };
  renderHuum();
  check('bez p\u0159ipojen\u00ed se \u0159\u00e1dek neukazuje', huumKdy.textContent, '');

  OUT.push('\\n8c) Po\u0159ad\u00ed karet a zalomen\u00ed teploty');
  // Kamna patří nahoru — teplota v sauně je to, kvůli čemu se na stránku chodí.
  // Měření z 3EM je hlídač jističe, ne displej.
  const karty = Array.from(document.querySelectorAll('#saunaSlide .page > .card'));
  check('kamna HUUM jsou prvn\u00ed karta', karty[0].contains(huumLight), 'true');
  check('  m\u011b\u0159en\u00ed 3EM druh\u00e1', karty[1].contains(saunaLight), 'true');
  // „33 °C" se lámalo mezi číslo a jednotku a stupeň zůstával viset níž
  check('teplota se nel\u00e1me', getComputedStyle(huumTemp).whiteSpace, 'nowrap');
  check('  a c\u00edl taky', getComputedStyle(huumTarget).whiteSpace, 'nowrap');

  OUT.push('\\n8d) Sv\u011btlo v saun\u011b');
  const POSLANO = [];
  const svetloOn = document.getElementById('huumSvetloOnBtn');
  const svetloOff = document.getElementById('huumSvetloOffBtn');
  const svetloKontrolka = document.getElementById('huumSvetloLight');
  window.fetch = async (adresa, opts) => {
    POSLANO.push({ adresa: String(adresa), metoda: (opts && opts.method) || 'GET',
                   telo: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, light: 1, huum: {
      ...huumData, light: 1, fetchedAt: new Date().toISOString() } }) };
  };

  // Dokud ze serveru nic nepřišlo, neví se, jestli kamna vůbec jsou — do té doby
  // se světlo neukazuje. Prázdné ON/OFF vedle ostatních vypadá jako rozbité relé.
  check('do prvn\u00edho sn\u00edmku se sv\u011btlo neukazuje',
    document.getElementById('huumSvetloCard').hasAttribute('hidden'), 'true');

  huumData = { enabled: true, statusCode: 232, statusText: 'p\u0159ipraven\u00e1', heating: false,
    temperature: 33, targetTemperature: 79, light: 0, config: 2,
    fetchedAt: new Date().toISOString(), error: null };
  renderHuum();
  check('po p\u0159ipojen\u00ed je karta se sv\u011btlem vid\u011bt',
    document.getElementById('huumSvetloCard').getClientRects().length > 0, 'true');
  check('zhasnut\u00e9 sv\u011btlo m\u00e1 \u010dervenou', svetloKontrolka.className, 'traffic-light off');
  check('  a OFF je zv\u00fdrazn\u011bn\u00e9', svetloOff.classList.contains('active-state'), 'true');
  check('  ON nen\u00ed', svetloOn.classList.contains('active-state'), 'false');

  svetloOn.click();
  await wait(80);
  check('ON po\u0161le povel', POSLANO[0].adresa, '/api/sauna/huum-svetlo');
  check('  POSTem', POSLANO[0].metoda, 'POST');
  check('  a \u0159ekne co chce', POSLANO[0].telo.on, 'true');
  // Server povel ověřuje dalším dotazem, takže v odpovědi je skutečný stav
  check('stav se p\u0159evezme z odpov\u011bdi', svetloKontrolka.className, 'traffic-light on');
  check('  a ON je te\u010f zv\u00fdrazn\u011bn\u00e9', svetloOn.classList.contains('active-state'), 'true');

  POSLANO.length = 0;
  svetloOff.click();
  await wait(80);
  check('OFF po\u0161le opak', POSLANO[0].telo.on, 'false');

  // Totéž tlačítko je i na Ovládání — musí ukazovat ten samý stav
  check('na Ovl\u00e1d\u00e1n\u00ed je tot\u00e9\u017e sv\u011btlo',
    document.getElementById('huumSvetloLight2').className,
    document.getElementById('huumSvetloLight').className);

  // Bez čerstvých dat se stav nepředstírá
  huumData = { ...huumData, fetchedAt: new Date(T - 30 * MIN).toISOString() };
  renderHuum();
  check('u star\u00fdch dat je semafor \u0161ed\u00fd', svetloKontrolka.className, 'traffic-light');
  check('  a \u017e\u00e1dn\u00e9 tla\u010d\u00edtko nen\u00ed zv\u00fdrazn\u011bn\u00e9',
    svetloOn.classList.contains('active-state') || svetloOff.classList.contains('active-state'), 'false');

  // Jednotka jen s parním vyvíječem (config 1) nemá světlo kam zapnout
  huumData = { ...huumData, config: 1, fetchedAt: new Date().toISOString() };
  renderHuum();
  check('bez osazen\u00e9ho sv\u011btla karta zmiz\u00ed',
    document.getElementById('huumSvetloCard').getClientRects().length, 0);
  check('  i bu\u0148ka na Ovl\u00e1d\u00e1n\u00ed',
    document.getElementById('huumSvetloCell2').getClientRects().length, 0);
  huumData = { enabled: false, error: null };
  renderHuum();
  check('nep\u0159ipojen\u00e1 kamna sv\u011btlo taky neukazuj\u00ed',
    document.getElementById('huumSvetloCard').getClientRects().length, 0);

  OUT.push('\\n9) Měřák 3EM zůstal nedotčený');
  saunaData = { powerW: 6200, fetchedAt: new Date().toISOString(), topi: true,
    since: T - 10 * MIN, blockUntil: T + 30 * MIN, limitW: 500 };
  renderSauna();
  check('semafor sauny pořád podle odběru', saunaLight.className, 'traffic-light on');
  check('  a ukazuje kW', saunaPower.textContent, '6,2 kW');

 } catch (e) { OUT.push('CHYBA výjimka: ' + e.message); }

  const bad = OUT.filter(l => l.startsWith('CHYBA')).length;
  OUT.push('\\n' + (bad === 0 ? 'VŠE PROŠLO' : 'SELHALO — ' + bad + ' chyb'));
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = OUT.join('\\n');
  document.body.appendChild(pre);
})();
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'sauna.html');
fs.writeFileSync(out, v);
console.log(out);
