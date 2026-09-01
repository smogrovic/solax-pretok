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
  saunaDaysData = [{ d: den(0), wh: 12500, ms: 2 * H }, { d: den(2), wh: 8000, ms: 90 * MIN }];
  renderSaunaDays();
  const radky = Array.from(saunaList.querySelectorAll('.wbsrc-row'));
  check('sedm dní a součet', radky.length, 8);
  check('  dnešek první', radky[0].querySelector('.wbsrc-day').textContent, 'dnes');
  check('  s kWh', radky[0].textContent.includes('12,5 kWh'), 'true');
  check('  a dobou topení', /topila 2:00/.test(radky[0].textContent), 'true');
  check('  den bez sauny má pomlčku', radky[1].textContent.includes('–'), 'true');
  check('  součet za týden', radky[7].textContent.includes('20,5 kWh'), 'true');
  check('  a je označený jako celkový', radky[7].className.includes('wbsrc-total'), 'true');

  OUT.push('\\n4) Záloha v telefonu');
  saveSaunaDaysLocal();
  check('uloží se a načte zpátky', loadSaunaDaysLocal().length, 2);
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
