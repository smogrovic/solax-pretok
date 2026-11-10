// Tlačítko notifikací: vidět ve všech režimech (i dětských), ne schované ve sbaleném Logu.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
setTimeout(async () => {
 try {
  const btn = document.getElementById('notifBtn');
  const slide = btn.closest('.slide');
  check('tlačítko je v Log/Nastavení', slide && slide.dataset.title, 'Log/Nastavení');
  check('  ne ve sbaleném Logu', btn.closest('[data-sbal-obsah]'), null);
  for (const r of ['full', 'miky', 'elenka']) {
    pouzijRezim(r);
    const karta = btn.closest('.card');
    check('  vidět v režimu ' + r, getComputedStyle(karta).display !== 'none' && !karta.hidden && getComputedStyle(btn).display !== 'none', true);
  }
  pouzijRezim('miky'); notifHintNastav();
  check('dětem vysvětlí, co jim chodí', document.getElementById('notifHint').textContent, 'Chodí jen: garáž otevřená moc dlouho a upozornění pro všechny.');
  pouzijRezim('full'); notifHintNastav();
  check('full: všechny hlášky', /^Chodí všechny hlášky appky/.test(document.getElementById('notifHint').textContent), true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message); }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb ? 'SELHALO — ' + chyb + ' chyb' : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (notifikace)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'notifikace.html');
fs.writeFileSync(out, v);
console.log(out);
