// Karta „Odhad vs. skutečnost" na Přehledu: bez přepínače a schválně podle RANNÍHO
// odhadu. Večerní je poslední hodnota dne, do večera se stáhne ke skutečnosti —
// kdyby se počítalo z něj, graf by vždycky vypadal skvěle a neřekl nic.
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
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
 try {
  const karta = document.getElementById('pvChart').closest('.card');
  check('karta je na Přehledu', karta.closest('.slide').dataset.title, 'Přehled');
  check('přepínač odhadů je pryč', !!document.getElementById('pvTabs'), false);
  check('  ani tlačítka nezbyla', document.querySelectorAll('.pv-tab').length, 0);
  check('nadpis zůstal', /Odhad vs. skutečnost/.test(karta.textContent), true);

  // Ranní odhad 20 kWh, večerní 10 — skutečnost 10. Podle ranního je to 50 %,
  // podle večerního 100 %; musí vyjít 50.
  pvDaysData = [{ d: '2026-08-30', fcAm: 20, fcPm: 10, actual: 10 }];
  renderPvChart();
  const avg = document.getElementById('pvAvg').textContent;
  check('počítá se z ranního odhadu', /50 %/.test(avg), true);
  check('  ne z večerního', /100 %/.test(avg), false);

  pvDaysData = [
    { d: '2026-08-29', fcAm: 10, fcPm: 10, actual: 10 },   // 100 %
    { d: '2026-08-30', fcAm: 20, fcPm: 10, actual: 10 }    // 50 %
  ];
  renderPvChart();
  check('průměr přes dny', /75 %/.test(document.getElementById('pvAvg').textContent), true);

  // Den bez ranního odhadu do grafu nepatří (nemá s čím porovnávat)
  pvDaysData = [{ d: '2026-08-30', fcAm: null, fcPm: 18, actual: 17 }];
  renderPvChart();
  check('den bez ranního odhadu se nekreslí',
    /Zatím sbírám data|jeden bod za den/.test(document.getElementById('pvAvg').textContent), true);

  const legenda = Array.from(document.querySelectorAll('#pvLegend span')).map(s => s.textContent);
  check('legenda říká, že je ranní', legenda.join(','), 'Ranní odhad (Infigy),Skutečnost (Solax)');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (přehled)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'prehled.html');
fs.writeFileSync(out, v);
console.log(out);
