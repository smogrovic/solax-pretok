// Nápověda a přepínač wallboxu (pracovní den / víkend, fáze dne, hystereze)
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const OUT = [];
let poslano = null;
window.fetch = async (url, opts) => {
  poslano = { url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null };
  return { ok: true, status: 200, json: async () => ({ wbAuto: true, wbDayType: 'weekend',
    wbDayTypeManual: true, wbDayTypeUntil: Date.now() + 20 * 3600000,
    wbPlan: { green: 8, fast: 10 }, wbFaze: 'green', wbHystMode: 'fast',
    wbHystUpKw: 3.5, wbHystDownKw: 2.5, wbPrebytekW: null, wbWinter: false, wbManualUntil: 0 }) };
};
function check(name, got, want) {
  const ok = String(got) === String(want);
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(52) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function stav(d) {
  applyWbSwitches({
    wbAuto: true, wbDayType: 'weekday', wbDayTypeManual: false, wbDayTypeUntil: 0,
    wbPlan: { green: 4, fast: 7 }, wbFaze: 'hyst', wbHystMode: 'fast',
    wbHystUpKw: 3.5, wbHystDownKw: 2.5, wbPrebytekW: 4200, wbWinter: false, wbManualUntil: 0, ...d
  });
  renderWbAuto();
  return wbMorningHint.textContent;
}

(async () => {
 try {
  await wait(150);
  wbAutoData = true;

  OUT.push('\\n1) Popisek přepínače');
  stav({ wbDayType: 'weekday' });
  check('pracovní den', wbDayTypeLabel.textContent, 'Pracovní den');
  check('  a přepínač je zapnutý', wbMorningSwitch.classList.contains('on'), 'true');
  stav({ wbDayType: 'weekend', wbPlan: { green: 8, fast: 10 } });
  check('víkend', wbDayTypeLabel.textContent, 'Víkend');
  check('  a přepínač vypnutý', wbMorningSwitch.classList.contains('on'), 'false');

  OUT.push('\\n2) Nápověda podle plánu dne');
  let t = stav({ wbDayType: 'weekday', wbPlan: { green: 4, fast: 7 }, wbFaze: 'green' });
  check('pracovní den: plán s hodinami', /GREEN do 4:00, FAST do 7:00/.test(t), 'true');
  check('  a prahy hystereze', /FAST od 3,5 kW, ECO pod 2,5 kW/.test(t), 'true');
  check('  a co jede teď', /Teď jede GREEN/.test(t), 'true');
  t = stav({ wbDayType: 'weekend', wbPlan: { green: 8, fast: 10 }, wbFaze: 'fast' });
  check('víkend: jiné hodiny', /GREEN do 8:00, FAST do 10:00/.test(t), 'true');
  check('  a dobíjí naplno', /Teď se dobíjí naplno \\(FAST\\)/.test(t), 'true');
  t = stav({ wbFaze: 'hyst', wbHystMode: 'eco', wbPrebytekW: 1800 });
  check('v hysterezi ukáže režim i přebytek', /Teď jede ECO \\(přebytek 1,8 kW\\)/.test(t), 'true');

  OUT.push('\\n3) Ruční volba, zima, pevné FAST');
  t = stav({ wbDayTypeManual: true, wbDayTypeUntil: Date.now() + 5 * 3600000 });
  check('ruční volba má platnost', /Ručně do \\d\\d?:\\d\\d, pak zase podle kalendáře/.test(t), 'true');
  t = stav({ wbDayTypeManual: false });
  check('jinak podle dne v týdnu', /Podle dne v týdnu/.test(t), 'true');
  t = stav({ wbWinter: true });
  check('zima', t.startsWith('Zimní režim'), 'true');
  wbAutoData = false;
  t = stav({ wbAuto: false });
  check('pevné FAST', /Uplatní se až v režimu AUTO/.test(t), 'true');
  wbAutoData = true;

  OUT.push('\\n4) Přepnutí posílá typ dne');
  stav({ wbDayType: 'weekday' });
  wbMorningSwitch.click();
  await wait(120);
  check('klik pošle opačný typ', poslano && poslano.url, '/api/wallbox/daytype');
  check('  a je to víkend', JSON.stringify(poslano.body), '{"dayType":"weekend"}');
  check('  odpověď se hned promítne', wbDayTypeLabel.textContent, 'Víkend');
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
