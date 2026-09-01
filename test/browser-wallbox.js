// Nápověda pod přepínačem wallboxu ve všech fázích
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
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(52) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function stav(d) {
  applyWbSwitches({
    wbAuto: true, wbMorningNeed: true, wbMorningUntil: Date.now() + 6 * 3600000,
    wbMorningManual: false, wbWinter: false, wbManualUntil: 0,
    wbRanoDoHour: 10, wbRanoKoncePvKw: 3.5, wbRanoOdHour: 3, wbDenFastKwh: 10,
    wbCarReady: true, ...d
  });
  renderWbAuto();
  return wbMorningHint.textContent;
}

(async () => {
 try {
  await wait(150);
  wbAutoData = true;

  OUT.push('\\n1) Ráno');
  let t = stav({ wbFaze: 'rano', wbMorningNeed: true });
  check('potřebuju → FAST do 10:00 nebo 3,5 kW', /naplno \\(FAST\\) do 10:00, nebo než FVE dá 3,5 kW/.test(t), 'true');
  check('  a řekne, podle čeho', /pracovní den|víkend|Ručně/.test(t), 'true');
  t = stav({ wbFaze: 'rano', wbMorningNeed: false });
  check('nepotřebuju → jen přebytek', /jen z přebytku \\(GREEN\\)/.test(t), 'true');

  OUT.push('\\n2) Den');
  t = stav({ wbFaze: 'den', wbZbyva: 14.2 });
  check('zbývá 14,2 kWh → FAST', /Dnes zbývá vyrobit 14,2 kWh → auto se dobíjí naplno \\(FAST\\)/.test(t), 'true');
  check('  a připomene práh', /aspoň 10 kWh/.test(t), 'true');
  t = stav({ wbFaze: 'den', wbZbyva: 3.4 });
  check('zbývá 3,4 kWh → ECO', /Dnes zbývá vyrobit 3,4 kWh → nabíjí se z přebytku \\(ECO\\)/.test(t), 'true');
  t = stav({ wbFaze: 'den', wbZbyva: null });
  check('bez odhadu to řekne rovnou', /Bez odhadu výroby/.test(t), 'true');

  OUT.push('\\n3) Noc, zima, ruční');
  t = stav({ wbFaze: 'noc', wbMorningNeed: true });
  check('v noci GREEN a odkdy se dobíjí', /Teď jen z přebytku \\(GREEN\\). Od 3:00 se auto dobije naplno/.test(t), 'true');
  t = stav({ wbFaze: null, wbWinter: true });
  check('zima', t.startsWith('Zimní režim — jede se pořád FAST.'), 'true');
  t = stav({ wbFaze: 'den', wbZbyva: 12, wbManualUntil: Date.now() + 2 * 3600000 });
  check('ruční odklad se připíše', /Ručně nastavený režim drží do /.test(t), 'true');
  wbAutoData = false;
  t = stav({ wbFaze: 'den', wbAuto: false });
  check('pevné FAST', /Uplatní se až v režimu AUTO/.test(t), 'true');
  wbAutoData = true;

  OUT.push('\\n4) Stránka sauny je vidět i bez měřáku');
  saunaEnabledFlag = false;
  renderSauna();
  check('stránka zůstává', !!document.getElementById('saunaSlide'), 'true');
  check('  semafor je šedý', saunaLight.className, 'traffic-light');
  check('  a řekne, co chybí', /Chybí ID měřáku sauny/.test(saunaHint.textContent), 'true');
  check('  stav to říká taky', saunaState.textContent, 'zatím nenastavená');
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
const out = path.join(SP, 'wallbox.html');
fs.writeFileSync(out, v);
console.log(out);
