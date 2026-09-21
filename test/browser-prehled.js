// Přehled: boxy „Dnes" a „Posledních 7 dní" a karta „Odhad vs. skutečnost".
//
// Ta druhá je schválně podle RANNÍHO
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

  // ---- Boxy Dnes a Posledních 7 dní ----
  // Doba běhu odsud zmizela: u bazénu i bojleru zajímá, kolik to sežralo, ne jak
  // dlouho to jelo. Kdyby se řádky vrátily, box zase naroste na devět položek.
  const dnesBox = document.getElementById('statPoolToday').closest('.stats-card');
  const popisky = [...dnesBox.querySelectorAll('.stat-row > span:first-child')].map(e => e.textContent);
  check('box Dnes nemluví o době běhu', popisky.some(p => /běžel/.test(p)), false);
  check('  a má sedm řádků', popisky.length, 7);
  check('  ve správném pořadí', popisky.join(' | '),
    'Přetok do sítě | Odběr ze sítě | Wallbox celkem | Bazén celkem | Bojler 1 | Bojler 2 | Sauna');

  const dnes = new Date();
  const den = o => {
    const d = new Date(dnes); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - o);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const tydenBox = document.getElementById('statBojleryTyden').closest('.stats-card');
  check('druhý box mluví o sedmi dnech',
    tydenBox.querySelector('.graph-title').textContent, 'Posledních 7 dní');
  const tydenPopisky = [...tydenBox.querySelectorAll('.stat-row > span:first-child')].map(e => e.textContent);
  check('  a bojlery jsou sečtené do jednoho řádku', tydenPopisky.join(' | '),
    'Přetok do sítě | Odběr ze sítě | Wallbox celkem | Bazén celkem | Ohřev vody miko TČ | Sauna');

  // Bazén se sčítá ze SÍTĚ i z FVE — je to celková spotřeba, ne jen to, co došlo odjinud
  poolDaysData = [{ d: den(0), grid: 3000, pv: 9000 }, { d: den(1), grid: 1000, pv: 1000 },
                  { d: den(2), grid: 500, pv: 500 }];
  saunaDaysData = [{ d: den(0), wh: 8000, ms: 7200000 }, { d: den(1), wh: 3000, ms: 0 }];
  wbDaysData = [{ d: den(1), grid: 2000, pv: 5000 }];
  siteDnyData = [
    { d: den(1), feed: 1000, imp: 2000, b1: 1500, b2: 500 },
    { d: den(2), feed: 500, imp: 1000, b1: 1000, b2: 1000 }
  ];
  runtimeData = { date: den(0), ms: {}, wh: { feed: 1000, import: 2000, wb: 4000, b1: 10, b2: 20 },
                  yesterday: { ms: {}, wh: { feed: 1, import: 2, wb: 3, b1: 4, b2: 5 } } };
  renderStats();
  check('bazén se sečte ze sítě i z FVE', document.getElementById('statPoolToday').textContent, '12,0 kWh');
  check('sauna se ukáže', document.getElementById('statSaunaToday').textContent, '8,0 kWh');

  // Dnešek se do týdne nepočítá: řada sítě a bojlerů ho dostane až o půlnoci,
  // takže by každý řádek mluvil o jinak dlouhé době
  check('týden sečte uzavřené dny', document.getElementById('statPoolYest').textContent, '3,0 kWh');
  check('  a dnešek vynechá', document.getElementById('statSaunaYest').textContent, '3,0 kWh');
  check('bojlery se sečtou dohromady',
    document.getElementById('statBojleryTyden').textContent, '4,0 kWh');
  check('přetok jde z řady sítě', document.getElementById('statFeedinYest').textContent, '1,5 kWh');
  check('odběr taky', document.getElementById('statImportYest').textContent, '3,0 kWh');
  check('wallbox se sečte ze sítě i z FVE', document.getElementById('wbYest').textContent, '7,0 kWh');

  // Řada se plní od nasazení — první týden nesmí vypadat jako celý týden
  check('řekne se, kolik dnů to je',
    /Zatím jen 2 uzavřené dny/.test(document.getElementById('tydenNote').textContent), true);
  siteDnyData = [];
  poolDaysData = [];
  wbDaysData = [];
  saunaDaysData = [];
  renderStats();
  check('bez dat bazénu taky pomlčka', document.getElementById('statPoolToday').textContent, '– kWh');
  check('  a týden přizná, že nemá z čeho',
    /není z čeho počítat/.test(document.getElementById('tydenNote').textContent), true);
  check('  a řádky jsou prázdné', document.getElementById('statBojleryTyden').textContent, '– kWh');
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
