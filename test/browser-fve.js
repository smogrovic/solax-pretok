// Graf a karty na stránce FVE: nový panel odběru okruhů a karta „odkud šla spotřeba".
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
// Barva bazénu je v celé appce jen jedna, takže je to spolehlivý podpis té čáry.
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
    const labely = FVE_PANELS.map(p => p.label);
    check('graf má šest panelů', labely.length, 6);
    check('  ve správném pořadí', labely.join(' | '),
      'Výkon FVE (kW) | Baterie (%) | Wallbox (kW) | Přetok (kW) | Bazén a bojlery (kW) | Bojlery (°C)');
    check('odběr okruhů je hned nad teplotami',
      labely.indexOf('Bojlery (°C)') - labely.indexOf('Bazén a bojlery (kW)'), 1);
  }

  // 1) prázdno — panel nesmí spadnout
  usageHistory = [];
  bezVyjimky('prázdný panel se zvládne nakreslit', renderFveChart);

  // 2) všechny tři okruhy
  usageHistory = [];
  for (let t = T - 26 * 3600000; t <= T; t += 2 * MIN) {
    usageHistory.push({ t, pool: 420, b1: t > T - 3600000 ? 2000 : 0, b2: 1200 });
  }
  history = [];
  for (let t = T - 26 * 3600000; t <= T; t += 2 * MIN) history.push({ t, kw: 1, soc: 60, pv: 2 });
  boilerHistory = [{ t: T - 3600000, b1: 48, b2: 52 }, { t: T, b1: 49, b2: 53 }];
  nakresli();
  check('graf s daty má výšku', parseInt(fveChartCanvas.style.height, 10) > 400, true);
  check('kreslí se čára bazénu', tahy.includes(BOILER_COLORS.pool), true);
  check('  i oba bojlery', tahy.filter(c => c === BOILER_COLORS.b1 || c === BOILER_COLORS.b2).length >= 2, true);

  // 3) jeden okruh mlčí (null) — ostatní se pořád kreslí
  usageHistory = usageHistory.map(p => ({ ...p, pool: null }));
  nakresli();
  check('bez dat bazénu se jeho čára nekreslí', tahy.includes(BOILER_COLORS.pool), false);
  usageHistory = usageHistory.map(p => ({ ...p, pool: 420, b2: null }));
  bezVyjimky('chybějící okruh graf nerozbije', renderFveChart);
  usageHistory = usageHistory.map(p => ({ t: p.t, pool: null, b1: null, b2: null }));
  bezVyjimky('samé nully taky ne', renderFveChart);
  usageHistory = [{ t: T, pool: 100, b1: null, b2: null }];
  bezVyjimky('jediný bod taky ne', renderFveChart);

  OUT2: {
    renderBoilerLegend();
    const polozky = Array.from(document.querySelectorAll('#boilerLegend span')).map(s => s.textContent);
    check('legenda má tři položky', polozky.length, 3);
    check('  včetně bazénu', polozky.join(','), 'Bazén,Bojler 1 (TČ),Bojler 2');
    const barvy = Array.from(document.querySelectorAll('#boilerLegend i')).map(i => i.style.background);
    check('  a tři různé barvy', new Set(barvy).size, 3);
  }

  // 4) karta „odkud šla spotřeba"
  const dnes = new Date();
  const den = o => {
    const d = new Date(dnes); d.setDate(d.getDate() - o);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  usageDaysData = [{ d: den(0), grid: 3000, pv: 9000 }, { d: den(1), grid: 12000, pv: 0 }];
  renderUsageSrc();
  const radky = document.querySelectorAll('#usageSrcList .wbsrc-row');
  check('karta má 7 dní a součet', radky.length, 8);
  check('dnešek ukazuje celkovou spotřebu', /12,0 kWh/.test(radky[0].textContent), true);
  check('  a podíl z FVE', /75 %/.test(radky[0].textContent), true);
  check('den jen ze sítě má 0 %', /0 %/.test(radky[1].textContent), true);
  const celkem = radky[radky.length - 1];
  check('součet je za celých 7 dní', /Celkem za 7 dní/.test(celkem.textContent), true);
  check('  a sečte oba dny', /24,0 kWh/.test(celkem.textContent), true);
  usageDaysData = [];
  renderUsageSrc();
  check('bez dat to řekne', /zatím bez dat/.test(document.getElementById('usageSrcList').textContent), true);

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
