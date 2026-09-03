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
  check('  i dokdy drží bazén', /do \\d\\d?:\\d\\d/.test(saunaHint.textContent), 'true');

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
  const vsechny = ['door', 'end', 'left', 'humidity', 'light', 'steamer', 'name',
                   'lTemp', 'lHeat', 'lTimer', 'lLock'];
  check('všech 11 řádků je vidět', vsechny.filter(vidi).length, 11);
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
  check('vyvíječ v pořádku', huumSteamer.textContent, 'v pořádku');
  check('název sauny', huumName.textContent, 'Chata');
  check('meze teploty', huumLimTemp.textContent, '40–110 °C');
  check('meze doby topení', huumLimHeat.textContent, '1–3 h');
  check('dětský zámek', huumLimLock.textContent, 'vypnutý');
  check('hláška ukáže vybavení', /vyvíječ i světlo/.test(huumHint.textContent), 'true');

  OUT.push('\\n8) Kamna HUUM — mezní stavy');
  // Cílovou teplotu API nevrací, dokud sauna netopí
  huumData = { ...huumData, statusCode: 232, statusText: 'připravená', heating: false,
    targetTemperature: null, endDate: null, humidity: null, steamerError: null };
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
  huumData = { ...huumData, steamerError: 1 };
  renderHuum();
  check('došlá voda ve vyvíječi', huumSteamer.textContent, 'došla voda');
  huumData = { enabled: true, statusCode: 232, fetchedAt: new Date(T - 30 * MIN).toISOString() };
  renderHuum();
  check('stará data = nedostupná', huumState.textContent, 'nedostupná');
  huumData = { enabled: true, error: 'HUUM: neplatné jméno nebo heslo.' };
  renderHuum();
  check('chyba se ukáže', /neplatné jméno/.test(huumHint.textContent), 'true');

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
