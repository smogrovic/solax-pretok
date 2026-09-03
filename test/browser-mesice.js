// Karty „Spotřeba po měsících" na saune, bazénu i wallboxu + pořadí stránek
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
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(54) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const radky = el => Array.from(el.querySelectorAll('.wbsrc-row')).map(r => r.textContent);

(async () => {
 try {
  await wait(150);

  OUT.push('\\n1) Pořadí stránek');
  const tabs = Array.from(document.querySelectorAll('#pageTabs .page-tab')).map(t => t.textContent);
  check('záložky jdou v zadaném pořadí', tabs.join(' · '),
    'Asistent · FVE · Klima · Žaluzie · Žaluzie 2 · Ovládání · Wallbox · Bazén · Sauna · Přehled · Log · Logika automatiky');
  const slides = Array.from(document.querySelectorAll('.slide')).map(s => s.dataset.title);
  check('  a stejně i stránky', slides.join(' · ') === tabs.join(' · '), 'true');

  // Pořadí panelů v grafu FVE hlídá test/browser-fve.js (má tam blíž k ostatním
  // kontrolám grafu), tady zůstává jen to, že wallbox v tom grafu vůbec je
  OUT.push('\\n2) Wallbox v grafu na FVE');
  check('wallbox má v grafu svůj panel',
    FVE_PANELS.some(p => p.label === 'Wallbox (kW)' && p.draw === panelWbPower), true);
  check('  a je hned pod baterií',
    FVE_PANELS.findIndex(p => p.label === 'Wallbox (kW)')
    - FVE_PANELS.findIndex(p => p.label === 'Baterie (%)'), 1);

  OUT.push('\\n3) Měsíce: jen uzavřené');
  const d = new Date();
  const ted = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const minuly = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  const predminuly = new Date(d.getFullYear(), d.getMonth() - 2, 15);
  const kl = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
  monthsData = [
    { m: kl(predminuly), sauna: 32000, pool: 120000, wb: 210000 },
    { m: kl(minuly), sauna: 41200, pool: 98000, wb: 305000 },
    { m: ted, sauna: 5000, pool: 4000, wb: 9000 }
  ];
  renderMonths();
  const s = radky(saunaMonths);
  check('běžící měsíc se neukazuje', s.some(r => /5,0 kWh/.test(r)), 'false');
  check('  uzavřené ano, nejnovější nahoře', /41,2 kWh/.test(s[0]) && /32,0 kWh/.test(s[1]), 'true');
  check('  s českým názvem měsíce', /\\d{4}/.test(s[0]) && /[a-zěščřžýáíé]{3,}/.test(s[0]), 'true');
  check('  a součtem na konci', /Celkem \\(2 měsíců\\)/.test(s[2]) && /73,2 kWh/.test(s[2]), 'true');
  check('bazén má svoje čísla', /98,0 kWh/.test(radky(poolMonths)[0]), 'true');
  check('wallbox taky', /305,0 kWh/.test(radky(wbMonths)[0]), 'true');
  monthsData = [];
  renderMonths();
  check('bez uzavřeného měsíce to řekne', /Zatím žádný celý měsíc/.test(saunaMonths.textContent), 'true');

  OUT.push('\\n4) Sauna: jen součet za 7 dní');
  check('rozpis po dnech je pryč', document.getElementById('saunaList'), 'null');
  const den = i => {
    const x = new Date(); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - i);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  };
  saunaDaysData = [{ d: den(0), wh: 12500, ms: 7200000 }, { d: den(3), wh: 8000, ms: 5400000 },
                   { d: den(9), wh: 5000, ms: 3600000 }];
  renderSaunaDays();
  check('součet bere jen posledních 7 dní', saunaTotal.textContent, '20,5 kWh');

  OUT.push('\\n5) Záloha měsíců');
  monthsData = [{ m: kl(minuly), sauna: 41200, pool: 98000, wb: 305000 }];
  saveMonthsLocal();
  check('uloží se a načte zpátky', loadMonthsLocal().length, 1);
  // Server po deployi začíná měsíc od nuly — vyhrát musí vyšší číslo z telefonu
  const slouceno = mergeMonths([{ m: kl(minuly), sauna: 100, pool: 0, wb: 0 }], loadMonthsLocal());
  check('slučování bere vyšší hodnotu', (slouceno.find(r => r.m === kl(minuly)) || {}).sauna, 41200);
  check('  a nezaloží duplicitní měsíc', slouceno.length, 1);
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
const out = path.join(SP, 'mesice.html');
fs.writeFileSync(out, v);
console.log(out);
