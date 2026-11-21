// Graf a karty na stránce FVE: panely grafu, legenda bojlerů a karta „odkud šla spotřeba".
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
// Kreslení se nesmí zadrhnout na žádných datech — chyba se ohlásí jmenovitě
// Na canvasu není co změřit přes DOM, takže si posloucháme, jakými barvami se táhne.
// Každý bojler má vlastní barvu, takže je to spolehlivý podpis té které čáry.
const tahy = [];
const puvodniStroke = CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.stroke = function (...a) {
  tahy.push(String(this.strokeStyle));
  return puvodniStroke.apply(this, a);
};
const nakresli = () => { tahy.length = 0; renderFveChart(); return tahy; };
const bezVyjimky = (jmeno, fn) => {
  try { fn(); check(jmeno, 'bez chyby', 'bez chyby'); }
  catch (e) { R.push('CHYBA  ' + jmeno + ' → ' + e.message); }
};
// V headless Chromiu s virtuálním časem rAF nechodí — kreslíme napřímo
setTimeout(() => {
 try {
  const T = Date.now(), MIN = 60000;

  OUT1: {
    // Panel „Bazén a bojlery (kW)" je pryč — odběr okruhů se nikde nekreslí ani nesbírá.
    // Kdyby se vrátil, tekla by do zálohy i do telefonu data, na která se nikdo nedívá.
    const labely = FVE_PANELS.map(p => p.label);
    check('graf má pět panelů', labely.length, 5);
    check('  ve správném pořadí', labely.join(' | '),
      'Výkon FVE (kW) | Baterie (%) | Wallbox (kW) | Přetok (kW) | Bojlery (°C)');
    check('teploty bojlerů jsou poslední', labely[labely.length - 1], 'Bojlery (°C)');
    check('žádný panel nemluví o bazénu', labely.some(l => /Bazén/.test(l)), false);
    check('panel odběru okruhů ve zdroji není', typeof panelUsage, 'undefined');
    check('  a řada, kterou kreslil, taky ne', typeof usageHistory, 'undefined');
    // Appka má jediný inline skript; ten druhý je tenhle ovladač
    const zdrojApky = document.querySelectorAll('script')[0].textContent;
    check('mrtvou zálohu v telefonu appka jednou smaže',
      zdrojApky.includes("removeItem('usageHistory')"), true);
    check('  a nikdo ji už neukládá', zdrojApky.includes("setItem('usageHistory'"), false);
  }

  // 1) prázdno — graf nesmí spadnout
  history = [];
  boilerHistory = [];
  bezVyjimky('prázdný graf se zvládne nakreslit', renderFveChart);

  // 2) data ve všech zbylých panelech
  history = [];
  for (let t = T - 26 * 3600000; t <= T; t += 2 * MIN) history.push({ t, kw: 1, soc: 60, pv: 2 });
  wallboxHistory = [];
  for (let t = T - 26 * 3600000; t <= T; t += 2 * MIN) wallboxHistory.push({ t, w: 3400 });
  boilerHistory = [];
  for (let t = T - 26 * 3600000; t <= T; t += 5 * MIN) boilerHistory.push({ t, b1: 48, b2: 52 });
  nakresli();
  check('graf s daty má výšku', parseInt(fveChartCanvas.style.height, 10) > 300, true);
  check('kreslí se oba bojlery',
    tahy.filter(c => c === BOILER_COLORS.b1 || c === BOILER_COLORS.b2).length >= 2, true);

  // 3) jeden bojler mlčí (null) — druhý se pořád kreslí
  boilerHistory = boilerHistory.map(p => ({ t: p.t, b1: p.b1, b2: null }));
  nakresli();
  check('bez dat bojleru 2 se jeho čára nekreslí', tahy.includes(BOILER_COLORS.b2), false);
  check('  ale bojler 1 se kreslí dál', tahy.includes(BOILER_COLORS.b1), true);
  boilerHistory = boilerHistory.map(p => ({ t: p.t, b1: null, b2: null }));
  bezVyjimky('samé nully graf nerozbijí', renderFveChart);
  boilerHistory = [{ t: T, b1: 50, b2: null }];
  bezVyjimky('jediný bod taky ne', renderFveChart);

  OUT2: {
    renderBoilerLegend();
    const polozky = Array.from(document.querySelectorAll('#boilerLegend span')).map(s => s.textContent);
    check('legenda má dvě položky', polozky.length, 2);
    check('  jen oba bojlery', polozky.join(','), 'Bojler 1 (TČ),Bojler 2');
    const barvy = Array.from(document.querySelectorAll('#boilerLegend i')).map(i => i.style.background);
    check('  a dvě různé barvy', new Set(barvy).size, 2);
    check('barva bazénu už neexistuje', BOILER_COLORS.pool, undefined);
  }

  // 4) karta „odkud šla spotřeba"
  const dnes = new Date();
  const den = o => {
    const d = new Date(dnes); d.setDate(d.getDate() - o);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  // List 7 dní: jako 24 h — celý dům a pod ním dům, bazén, auto, sečtené za 7 uzavřených dnů
  usageDaysData = [{ d: den(0), grid: 3000, pv: 9000 }, { d: den(1), grid: 12000, pv: 0 }, { d: den(3), grid: 1000, pv: 3000 }];
  poolDaysData = [{ d: den(1), grid: 1000, pv: 2000 }, { d: den(9), grid: 50000, pv: 0 }];
  wbDaysData = [{ d: den(2), grid: 2000, pv: 4000 }, { d: den(5), grid: 0, pv: 5000 }];
  renderUsageSrc();
  const radky = [...document.querySelectorAll('#usageSrcList .wbsrc-row')];
  check('žádné jednotlivé dny: celý dům + dům, bazén, auto', radky.map(r => r.querySelector('.wbsrc-day').textContent).join(' | '),
    'Celý dům za 7 dní | Dům (bez auta a bazénu) | Bazén | Auto');
  const hl = r => r.querySelector('.wbsrc-head').textContent;
  check('dům: uzavřené dny, dnešek ani starší ne', /16,0 kWh/.test(hl(radky[1])), true);
  check('bazén: jen do 7 dní zpět', /3,0 kWh/.test(hl(radky[2])), true);
  check('auto ze sítě i z FVE', /11,0 kWh/.test(hl(radky[3])), true);
  check('celý dům = součet', /30,0 kWh/.test(hl(radky[0])), true);
  check('  ze sítě sečteno', /ze sítě 16,0 kWh/.test(radky[0].textContent), true);
  check('  z FVE sečteno', radky[0].textContent.includes('14,0 kWh z FVE (47 %)'), true);
  check('text pod kartou mluví o celém domě', /Celý dům včetně auta, bazénu/.test(document.querySelector('.prehled-karta > .wbsrc-note:last-child').textContent), true);
  poolDaysData = [];
  wbDaysData = [];
  usageDaysData = [];
  renderUsageSrc();
  check('bez dat to řekne', /zatím bez dat/.test(document.getElementById('usageSrcList').textContent), true);

  // Měsíce: celý dům a rozpad; slučování nesmí zahodit dům ani rozpad
  const mm = mergeMonths([{ m: '2026-08', sauna: 0, pool: 100000, poolGrid: 40000, poolPv: 60000,
    wb: 200000, wbGrid: 50000, wbPv: 150000, dum: 300000, dumGrid: 100000, dumPv: 200000 }], []);
  check('slučování měsíců drží dům', mm[0].dum, 300000);
  check('  i rozpad', mm[0].dumGrid + '/' + mm[0].dumPv, '100000/200000');
  check('měsíční karta domu je pryč (měsíce jsou na Spotřebě)', document.getElementById('dumMonths'), null);

  // 5) karta wallboxu zůstala nedotčená
  wbDaysData = [{ d: den(0), grid: 1000, pv: 3000 }];
  renderWbSrc();
  check('wallbox má svoji kartu dál',
    document.querySelectorAll('#wbSrcList .wbsrc-row').length, 8);
  check('  s vlastní hláškou', /nenabíjelo se/.test(document.getElementById('wbSrcList').textContent), true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (FVE)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'fve.html');
fs.writeFileSync(out, v);
console.log(out);
