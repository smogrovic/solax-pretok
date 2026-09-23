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
  // Práh patří k políčku na Logice automatiky, kde se nastavuje — na kartě
  // to byla jen věta navíc, která nikdy nikoho nezajímala
  check('  a práh 500 W na kartě není', /od 500 W/.test(saunaHint.textContent), 'false');

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
  const vsechny = ['door', 'end', 'left', 'light'];
  check('všechny 4 řádky jsou vidět', vsechny.filter(vidi).length, 4);
  // Vlhkost jednotka hlásí (39 %), ale bez parního vyvíječe s ní nejde nic dělat
  // a na kartě jen mátla. Číslo zůstává v diagnostice.
  check('vlhkost je z karty pryč', !!radek('humidity'), 'false');
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
  check('světlo', huumLightState.textContent, 'zapnuto');
  // „Osazeno: světlo" se nemění a nic neříká — hint nese jen to, co je špatně
  check('hláška o vybavení je pryč', /Osazeno/.test(huumHint.textContent), 'false');
  check('  a při připojených kamnech je hint prázdný', huumHint.textContent, '');

  OUT.push('\\n8) Kamna HUUM — mezní stavy');
  // Cílovou teplotu API nevrací, dokud sauna netopí
  huumData = { ...huumData, statusCode: 232, statusText: 'připravená', heating: false,
    targetTemperature: null, endDate: null, humidity: null };
  renderHuum();
  check('bez cíle je pomlčka', huumTarget.textContent, '– °C');
  check('  ale teplota zůstane', huumTemp.textContent, '78 °C');
  check('semafor zhasne', huumLight.className, 'traffic-light off');
  check('prázdné řádky se po připojení schovají', vidi('end'), 'false');
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
  // Zapínání patří hned pod teploty — je to jedna věc
  check('  zap\u00edn\u00e1n\u00ed hned pod nimi', karty[1].id, 'huumTopeniCard');
  check('  \u010dasova\u010d hned za n\u00edm', karty[2].id, 'huumTimerCard');
  check('  m\u011b\u0159\u00e1k 3EM a\u017e \u010dtvrt\u00fd', karty[3].contains(saunaLight), 'true');
  // „33 °C" se lámalo mezi číslo a jednotku a stupeň zůstával viset níž
  check('teplota se nel\u00e1me', getComputedStyle(huumTemp).whiteSpace, 'nowrap');
  check('  a c\u00edl taky', getComputedStyle(huumTarget).whiteSpace, 'nowrap');

  // Každá půlka přesně polovina karty, ať dělítko sedí uprostřed a hodnota
  // zůstane pod svým popiskem i když se změní počet číslic
  const stred = el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
  const tempKarta = document.querySelector('.huum-temps');
  const delitko = tempKarta.querySelector('.boiler-sep');
  check('d\u011bl\u00edtko sed\u00ed uprost\u0159ed karty',
    Math.abs(stred(delitko) - stred(tempKarta)) < 1.5, 'true');
  // A dvojice jde přes celou kartu, ne jen doprostřed podle šířky čísel
  check('  a teploty jdou p\u0159es celou kartu',
    Math.round(tempKarta.getBoundingClientRect().width),
    Math.round(tempKarta.parentElement.getBoundingClientRect().width));
  const popisky = [...tempKarta.querySelectorAll('.boiler-name')];
  const hodnoty = [...tempKarta.querySelectorAll('.boiler-temp')];
  check('teplota sed\u00ed pod sv\u00fdm popiskem',
    Math.abs(stred(popisky[0]) - stred(hodnoty[0])) < 1.5, 'true');
  check('  a c\u00edl taky', Math.abs(stred(popisky[1]) - stred(hodnoty[1])) < 1.5, 'true');
  // Tříciferná teplota nesmí půlky rozhodit
  huumData = { ...huumData, temperature: 100, targetTemperature: 9 };
  renderHuum();
  check('  a nerozhod\u00ed to ani 100 proti 9',
    Math.abs(stred(delitko) - stred(tempKarta)) < 1.5, 'true');

  OUT.push('\\n8c2) Sjednoceno s baz\u00e9nem');
  // Bazén je předloha: velké číslo 34 px navy. Sauna měla teploty 26 px oranžové
  // a odběr 34 px oranžový — tři různé podoby téhož na dvou stránkách.
  const hp = document.getElementById('hpTemp');
  const st = el => getComputedStyle(el);
  check('teplota sauny je stejn\u011b velk\u00e1 jako u baz\u00e9nu',
    st(huumTemp).fontSize, st(hp).fontSize);
  check('  a c\u00edl taky', st(huumTarget).fontSize, st(hp).fontSize);
  check('  i odb\u011br v kW', st(document.getElementById('saunaPower')).fontSize, st(hp).fontSize);
  check('teplota sauny m\u00e1 barvu baz\u00e9nu', st(huumTemp).color, st(hp).color);
  check('  i odb\u011br', st(document.getElementById('saunaPower')).color, st(hp).color);
  // Oranžová zůstává jinde v appce — bojlery na Ovládání se měnit neměly
  const bojler = document.querySelector('.boilers-card:not(.huum-temps) .boiler-temp');
  check('bojlery si oran\u017eovou nechaly', st(bojler).color !== st(hp).color, 'true');

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

  OUT.push('\\n8e) \u010c\u00edseln\u00edk topen\u00ed');
  const top = id => document.getElementById(id);
  POSLANO.length = 0;
  window.fetch = async (adresa, opts) => {
    POSLANO.push({ adresa: String(adresa), metoda: (opts && opts.method) || 'GET',
                   telo: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, teplota: 85, timers: [], huum: {
      ...huumData, heating: true, statusCode: 231, statusText: 'top\u00ed',
      targetTemperature: 85, fetchedAt: new Date().toISOString() } }) };
  };

  huumData = { enabled: false, error: null };
  renderHuum();
  check('nep\u0159ipojen\u00e1 kamna topen\u00ed neukazuj\u00ed', top('huumTopeniCard').hidden, 'true');
  check('  ani \u010dasova\u010d', top('huumTimerCard').hidden, 'true');

  huumData = { enabled: true, statusCode: 232, statusText: 'p\u0159ipraven\u00e1', heating: false,
    temperature: 33, targetTemperature: 79, doorClosed: true, light: 0, config: 2,
    limits: { minTemp: 40, maxTemp: 90 },
    fetchedAt: new Date().toISOString(), error: null };
  renderHuum();
  check('po p\u0159ipojen\u00ed je karta vid\u011bt', top('huumTopeniCard').hidden, 'false');
  // Meze si hlásí sama jednotka — natvrdo napsaný rozsah by u jiných kamen lhal
  const jezdec = top('huumCilSlider');
  check('\u010d\u00edseln\u00edk m\u00e1 meze z jednotky', jezdec.min + '\u2013' + jezdec.max, '40\u201390');
  check('  a p\u0159evezme c\u00edl z kamen', jezdec.value, '79');
  check('  \u010d\u00edslo uprost\u0159ed sed\u00ed', top('huumCilVal').textContent, '79 \u00b0C');

  // Bez tohohle by tažení po kruhu appka vzala jako listování stránek — stejná
  // past jako u jezdce naklopení u žaluzií
  check('kruh nepou\u0161t\u00ed ta\u017een\u00ed d\u00e1l',
    getComputedStyle(top('huumDial')).touchAction, 'none');

  // Puntík má sedět na úhlu odpovídajícím hodnotě: výseč jde od 135° po 405°
  const puntik = top('huumDialPuntik');
  const uhelPuntiku = () => {
    const x = Number(puntik.getAttribute('cx')) - 120, y = Number(puntik.getAttribute('cy')) - 120;
    let u = Math.atan2(y, x) * 180 / Math.PI;
    if (u < -45) u += 360;
    return Math.round(u);
  };
  jezdec.value = '40'; jezdec.dispatchEvent(new Event('input'));
  check('na minimu je punt\u00edk na za\u010d\u00e1tku v\u00fdse\u010de', uhelPuntiku(), 135);
  jezdec.value = '90'; jezdec.dispatchEvent(new Event('input'));
  check('na maximu na konci', uhelPuntiku(), 45);
  jezdec.value = '65'; jezdec.dispatchEvent(new Event('input'));
  check('v p\u016flce uprost\u0159ed', uhelPuntiku(), 270);
  check('  a \u010d\u00edslo se p\u0159episuje', top('huumCilVal').textContent, '65 \u00b0C');
  // Data ze serveru už jím nesmí hýbat — jinak by mizel pod prstem
  huumData = { ...huumData, targetTemperature: 79, fetchedAt: new Date().toISOString() };
  renderHuum();
  check('  a data ze serveru s n\u00edm nehnou', jezdec.value, '65');

  OUT.push('\\n8e2) Vyp\u00edna\u010d se mus\u00ed podr\u017eet');
  const btn = top('huumTopeniBtn');
  const dotyk = typ => btn.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 1 }));
  POSLANO.length = 0;
  // Rozpálit kamna omýlem ťuknutím v kapse je jiná liga než omýlem rozsvítit
  dotyk('pointerdown');
  await wait(120);
  dotyk('pointerup');
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await wait(60);
  check('kr\u00e1tk\u00e9 klepnut\u00ed saunu NEZAPNE', POSLANO.length, 0);
  check('  a popisek \u0159ekne, \u017ee se m\u00e1 dr\u017eet',
    /Podr\u017e pro zapnut\u00ed na 65 \u00b0C/.test(top('huumTopeniPopis').textContent), 'true');

  dotyk('pointerdown');
  await wait(1200);
  check('podr\u017een\u00ed zapne', POSLANO[0].adresa, '/api/sauna/huum-start');
  check('  s teplotou z \u010d\u00edseln\u00edku', POSLANO[0].telo.teplota, 65);
  dotyk('pointerup');
  await wait(60);
  check('stav se p\u0159evezme z odpov\u011bdi', huumState.textContent, 'top\u00ed');
  check('  a vyp\u00edna\u010d je rozsv\u00edcen\u00fd', btn.classList.contains('topi'), 'true');

  // Vypínání je bezpečná strana — držet se nemusí
  POSLANO.length = 0;
  window.fetch = async (adresa, opts) => {
    POSLANO.push({ adresa: String(adresa), metoda: (opts && opts.method) || 'GET',
                   telo: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, huum: {
      ...huumData, heating: false, statusCode: 232, fetchedAt: new Date().toISOString() } }) };
  };
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await wait(60);
  check('klepnut\u00ed p\u0159i topen\u00ed vypne', POSLANO[0].adresa, '/api/sauna/huum-stop');
  check('  a popisek se zm\u011bn\u00ed', /Podr\u017e pro zapnut\u00ed/.test(top('huumTopeniPopis').textContent), 'true');

  OUT.push('\\n8e3) \u010casova\u010d sauny');
  POSLANO.length = 0;
  window.fetch = async (adresa, opts) => {
    POSLANO.push({ adresa: String(adresa), metoda: (opts && opts.method) || 'GET',
                   telo: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({
      timers: [{ id: 7, time: '18:30', teplota: 65 }] }) };
  };
  // Po povelu si číselník vzal hodnotu ze serveru, tak se před časovačem nastaví znovu
  jezdec.value = '72'; jezdec.dispatchEvent(new Event('input'));
  top('huumTimerTime').value = '18:30';
  top('huumTimerAdd').click();
  await wait(80);
  check('\u010dasova\u010d se po\u0161le', POSLANO[0].adresa, '/api/sauna/timer');
  check('  POSTem', POSLANO[0].metoda, 'POST');
  check('  s \u010dasem', POSLANO[0].telo.time, '18:30');
  // Teplota se bere z číselníku, ne z vlastního políčka
  check('  a s teplotou z \u010d\u00edseln\u00edku', POSLANO[0].telo.teplota, 72);
  const casRadek = document.querySelector('#huumTimerList .timer-row');
  check('a objev\u00ed se v seznamu', casRadek.textContent.includes('18:30'), 'true');
  check('  i s teplotou', /65 \u00b0C/.test(casRadek.textContent), 'true');
  POSLANO.length = 0;
  casRadek.querySelector('.timer-del').click();
  await wait(80);
  check('k\u0159\u00ed\u017eek ho zru\u0161\u00ed', POSLANO[0].metoda, 'DELETE');
  check('  a m\u00ed\u0159\u00ed na spr\u00e1vn\u00e9 id', POSLANO[0].adresa, '/api/sauna/timer/7');

  OUT.push('\\n8f) Jak dlouho se nah\u0159\u00edv\u00e1');
  const seznam = document.getElementById('nahrevList');
  saunaNahrevData = { bezici: null, zaznamy: [] };
  renderSaunaNahrev();
  // Prázdná karta nesmí vypadat jako rozbitá — má říct, že se to teď sbírá
  check('bez m\u011b\u0159en\u00ed to \u0159ekne', /p\u0159ibude to po prvn\u00edm/.test(seznam.textContent), 'true');

  saunaNahrevData = { bezici: null, zaznamy: [
    { start: T - 26 * H, konec: T - 25 * H, duvod: 'appka', venkuC: -2, odC: 15, cilC: 79,
      prahy: {}, body: [{ min: 0, c: 15 }, { min: 2, c: 19 }], maxC: 41 },
    { start: T - 3 * H, konec: T - 2 * H, duvod: 'odber', venkuC: 8, odC: 22, cilC: 79,
      prahy: { 60: { min: 18, c: 61 }, 70: { min: 26, c: 72 }, cil: { min: 38, c: 79 } },
      body: [{ min: 0, c: 22 }, { min: 2, c: 31 }], maxC: 79 }
  ] };
  renderSaunaNahrev();
  const radky = [...seznam.querySelectorAll('.wbsrc-row')];
  check('dv\u011b m\u011b\u0159en\u00ed = dva \u0159\u00e1dky', radky.length, 2);
  // Nejnovější nahoře — chodíš se podívat, jak to trvalo dneska
  check('nejnov\u011bj\u0161\u00ed je prvn\u00ed', /venku 8/.test(radky[0].textContent), 'true');
  check('  s po\u010d\u00e1te\u010dn\u00ed teplotou v saun\u011b', /v saun\u011b 22/.test(radky[0].textContent), 'true');
  check('  a s \u010dasy na prahy', /60 \u00b0C za 18 min/.test(radky[0].textContent), 'true');
  check('  i na c\u00edl', /c\u00edl 79 \u00b0C za 38 min/.test(radky[0].textContent), 'true');
  // Nahřívání, co se nikam nedostalo, je taky údaj — nemá se tvářit jako chyba
  check('nedokon\u010den\u00e9 nah\u0159\u00edv\u00e1n\u00ed \u0159ekne, kam do\u0161lo',
    /nedostalo se na 60/.test(radky[1].textContent) && /max 41/.test(radky[1].textContent), 'true');
  check('pozn\u00e1mka \u0159ekne, kolik jich je',
    /2 m\u011b\u0159en\u00ed/.test(document.getElementById('nahrevPozn').textContent), 'true');
  // ±2 min je poctivé říct: kamna se ptají po dvou minutách
  check('  i s jak\u00fdm rozli\u0161en\u00edm',
    /\u00b12 min/.test(document.getElementById('nahrevPozn').textContent), 'true');

  let zkopirovano = null;
  // navigator.clipboard je jen ke čtení, přiřazením by se nepřepsalo
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async t => { zkopirovano = t; } } });
  document.getElementById('nahrevKopirBtn').click();
  await wait(60);
  check('tla\u010d\u00edtko zkop\u00edruje data', typeof zkopirovano, 'string');
  const parsed = JSON.parse(zkopirovano);
  check('  jako JSON se v\u0161\u00edm', parsed.zaznamy.length, 2);
  // Celá křivka je to, proč to tlačítko existuje — z milestones samotných
  // se rychlost nahřívání nespočítá
  check('  v\u010detn\u011b k\u0159ivky', parsed.zaznamy[0].body.length, 2);
  check('  a \u0159ekne kolik toho bylo',
    /zkop\u00edrov\u00e1no/.test(document.getElementById('nahrevStav').textContent), 'true');

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
