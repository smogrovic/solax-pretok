// Bývalý Přehled (teď na FVE): boxy „Dnes" a „Posledních 7 dní" a karta „Odhad vs. skutečnost".
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
  check('karta je na FVE (bývalý Přehled)', karta.closest('.slide').dataset.title, 'FVE');
  check('přepínač odhadů je pryč', !!document.getElementById('pvTabs'), false);
  check('  ani tlačítka nezbyla', document.querySelectorAll('.pv-tab').length, 0);
  // Nadpis se přestěhoval do sbalovacího tlačítka nad kartou
  check('nadpis zůstal', /Odhad vs. skutečnost/.test(
    document.querySelector('.sbal-btn[data-sbal="odhad"]').textContent), true);
  check('  a karta se sbaluje pod ním', karta.dataset.sbalObsah, 'odhad');

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

  // ---- Jedna karta: 24 h a 7 dní vedle sebe, pod tím dva listy „odkud“ ----
  sbalNastav('fve', false);
  const tab = document.querySelector('.prehled-tab');
  const prehledKarta = tab.closest('.stats-card');
  check('24 h a 7 dní jsou v jedné kartě', prehledKarta.contains(document.getElementById('statFeedinYest')) && prehledKarta.contains(document.getElementById('usageSrcList')), true);
  check('  hlavička sloupců', [...tab.querySelectorAll(':scope > b')].map(e => e.textContent).join(' | '), '24 h | 7 dní');
  const popisky = [...tab.children].filter((e, i) => i >= 3 && i % 3 === 0).map(e => e.textContent);
  check('  řádky ve správném pořadí', popisky.join(' | '), 'Přetok do sítě | Odběr ze sítě | Wallbox | Bazén | Bojler 1 | Bojler 2 | Sauna');
  check('  nemluví o době běhu', popisky.some(p => /běžel/.test(p)), false);
  check('sloupce stojí vedle sebe', document.getElementById('statPoolYest').getBoundingClientRect().left > document.getElementById('statPoolToday').getBoundingClientRect().right, true);
  check('karta se vejde na šířku', prehledKarta.scrollWidth <= prehledKarta.clientWidth + 1, true);

  const dnes = new Date();
  const den = o => {
    const d = new Date(dnes); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - o);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  poolDaysData = [{ d: den(0), grid: 3000, pv: 9000 }, { d: den(1), grid: 1000, pv: 1000 },
                  { d: den(2), grid: 500, pv: 500 }];
  saunaDaysData = [{ d: den(0), wh: 8000, ms: 7200000 }, { d: den(1), wh: 3000, ms: 0 }];
  wbDaysData = [{ d: den(1), grid: 2000, pv: 5000 }];
  siteDnyData = [
    { d: den(1), feed: 1000, imp: 2000, b1: 1500, b2: 500 },
    { d: den(2), feed: 500, imp: 1000, b1: 1000, b2: 1000 }
  ];
  // Hodinové koše: 25 h zpět po hodině; nejstarší leží napůl mimo okno 24 h
  const H = 3600000;
  const ted = Math.floor(Date.now() / H) * H + H / 2;   // půlka hodiny
  const kos = (h, o) => ({ h, feed: 100, imp: 200, wb: 1000, wbGrid: 400, pool: 500, poolGrid: 100,
    dum: 1000, dumGrid: 300, b1: 50, b2: 25, sauna: 0, ...o });
  hodiny24Data = [];
  for (let i = 25; i >= 0; i--) hodiny24Data.push(kos(ted - H / 2 - i * H));
  // Běžící hodina je naplněná jen do půlky
  hodiny24Data[hodiny24Data.length - 1] = kos(ted - H / 2, { feed: 50, imp: 100, wb: 500, wbGrid: 200, pool: 250,
    poolGrid: 50, dum: 500, dumGrid: 150, b1: 25, b2: 12.5, sauna: 4000 });
  check('24 h: nejstarší koš poměrem (24 celých hodin)', (h24Soucet('feed', ted) / 100).toFixed(2), '24.00');
  const puvodniNow = Date.now;
  Date.now = () => ted;
  renderStats();
  check('24 h: přetok', document.getElementById('statFeedinToday').textContent, '2,4 kWh');
  check('  odběr', document.getElementById('statImportToday').textContent, '4,8 kWh');
  check('  wallbox', document.getElementById('wbOverview').textContent, '24,0 kWh');
  check('  bazén', document.getElementById('statPoolToday').textContent, '12,0 kWh');
  check('  bojler 1 a 2 zvlášť', document.getElementById('statB1Today').textContent + ' | ' + document.getElementById('statB2Today').textContent, '1,2 kWh | 0,6 kWh');
  check('  sauna', document.getElementById('statSaunaToday').textContent, '4,0 kWh');

  // 7 dní: dnešek se nepočítá (řada sítě a bojlerů ho dostane až o půlnoci)
  check('7 dní sečte uzavřené dny', document.getElementById('statPoolYest').textContent, '3,0 kWh');
  check('  a dnešek vynechá', document.getElementById('statSaunaYest').textContent, '3,0 kWh');
  check('bojlery za 7 dní zvlášť', document.getElementById('statB1Tyden').textContent + ' | ' + document.getElementById('statB2Tyden').textContent, '2,5 kWh | 1,5 kWh');
  check('přetok jde z řady sítě', document.getElementById('statFeedinYest').textContent, '1,5 kWh');
  check('odběr taky', document.getElementById('statImportYest').textContent, '3,0 kWh');
  check('wallbox se sečte ze sítě i z FVE', document.getElementById('wbYest').textContent, '7,0 kWh');
  check('řekne se, kolik dnů to je', /7 dní: zatím jen 2 uzavřené dny/.test(document.getElementById('tydenNote').textContent), true);

  // Listy grafu „odkud šla spotřeba“
  const l24 = document.getElementById('usageSrc24'), l7 = document.getElementById('usageSrcList');
  prehledList('24');
  check('list 24 h je vidět, 7 dní ne', !l24.hidden && l7.hidden, true);
  const r24 = [...l24.querySelectorAll('.wbsrc-row')].map(r => r.querySelector('.wbsrc-head').textContent);
  check('24 h: celý dům a pod ním dům, bazén, auto', r24.join(' | '),
    'Celý dům za 24 h60,0 kWh | Dům (bez auta a bazénu)24,0 kWh | Bazén12,0 kWh | Auto24,0 kWh');
  check('  celý dům: ze sítě součet tří dílů', /ze sítě 19,2 kWh/.test(l24.querySelector('.wbsrc-row').textContent), true);
  document.querySelector('.prehled-list[data-list="7"]').click();
  check('klepnutí přepne na 7 dní', !l7.hidden && l24.hidden, true);
  check('  tlačítko svítí', document.querySelector('.prehled-list[data-list="7"]').classList.contains('aktivni'), true);
  check('  a volba se pamatuje', localStorage.getItem('prehledList'), '7');
  prehledList('24');
  Date.now = puvodniNow;

  siteDnyData = [];
  poolDaysData = [];
  wbDaysData = [];
  saunaDaysData = [];
  hodiny24Data = [];
  renderStats();
  check('bez dat pomlčky', document.getElementById('statPoolToday').textContent + ' | ' + document.getElementById('statB1Tyden').textContent, '– | – kWh');
  check('  a poznámka přizná, že se plní', /24 h: zatím 0 h/.test(document.getElementById('tydenNote').textContent) && /první den se uzavře o půlnoci/.test(document.getElementById('tydenNote').textContent), true);
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
