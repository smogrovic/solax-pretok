// OKNO: 1180,820
// Spotřeba na iPadu: druhé klepnutí na záložku otevře stránku přes celou obrazovku
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');
const HISTORIE = require('../data/spotreba-historie.json').mesice;

const DRIVER = `
const OUT = [];
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
function check(name, got, want) {
  const ok = String(got) === String(want);
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(54) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
 try {
  await wait(150);
  check('široký displej', sirokyDisplej(), true);
  spotrebaData = { mesice: ${JSON.stringify(HISTORIE)}, rucneDo: '2026-10',
    cenik: { vt: 4.32625, nt: 3.42394, mesicne: 850.47, nazev: 'ČEZ D56d', vtPodilCas: 0.167 } };
  kalOtevri(false);
  const slides = [...sliderWrap.querySelectorAll('.slide:not([hidden])')];
  const i = slides.findIndex(s => s.id === 'spotrebaSlide');
  sliderWrap.scrollLeft = stranaNaStred(i);
  updateDots();
  renderSpotreba();
  const tab = [...document.querySelectorAll('#pageTabs .page-tab')].find(t => t.textContent === 'Spotřeba');
  check('Spotřeba je vidět, záložka svítí', tab.classList.contains('active'), true);
  check('zavírací tlačítko normálně schované', getComputedStyle(document.getElementById('spZavrit')).display, 'none');
  tab.click();
  await wait(50);
  const slide = document.getElementById('spotrebaSlide');
  const r = slide.getBoundingClientRect();
  check('druhé klepnutí: přes celou obrazovku', [document.body.classList.contains('sp-cela'), Math.round(r.width) === innerWidth, Math.round(r.height) === innerHeight, r.top].join(' '), 'true true true 0');
  const karty = [...slide.querySelectorAll('.page > .card')].map(k => k.getBoundingClientRect());
  check('  souhrn a graf vedle sebe, tabulka přes celou šířku pod nimi',
    Math.abs(karty[0].top - karty[1].top) < 2 && karty[1].left > karty[0].right && karty[2].top > karty[0].top && karty[2].width > karty[1].width, true);
  const posun = document.getElementById('spGrafPosun');
  const sloupce = slide.querySelectorAll('.sp-sloupec');
  check('  graf na novou šířku: zase 12 viditelných', Math.round(posun.clientWidth / (posun.scrollWidth / sloupce.length)), 12);
  check('  nic nepřetéká', slide.scrollWidth <= slide.clientWidth + 1, true);
  check('  zavírací tlačítko vidět', getComputedStyle(document.getElementById('spZavrit')).display, 'block');
  document.getElementById('spZavrit').click();
  check('Zavřít vrátí tři stránky', document.body.classList.contains('sp-cela'), false);
  tab.click();
  const jina = [...document.querySelectorAll('#pageTabs .page-tab')].find(t => t.textContent === 'Klima');
  jina.click();
  check('jiná záložka celou obrazovku zavře', document.body.classList.contains('sp-cela'), false);
  tab.click();
  ipadVychozi();
  check('návrat na kalendář ji zavře taky', document.body.classList.contains('sp-cela'), false);
 } catch (e) { OUT.push('CHYBA výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const bad = OUT.filter(l => l.startsWith('CHYBA')).length;
  OUT.push('\\n' + (bad === 0 ? 'VŠE PROŠLO — ' + OUT.length + ' ok, 0 chyb (spotreba iPad)' : 'SELHALO — ' + bad + ' chyb'));
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = OUT.join('\\n');
  document.body.appendChild(pre);
})();
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'spotreba-ipad.html');
fs.writeFileSync(out, v);
console.log(out);
