// Karta „Topení a teplota v domě" na FVE: denní souhrn a kopírování celé řady.
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
let dotazy = [];
let odpoved = { status: 200, data: { zaznamy: [{ t: 1, n: 30, dumW: 2000 }], model: { zakladW: 400 } } };
window.fetch = async (url, init) => {
  dotazy.push({ url, init });
  return { ok: odpoved.status === 200, status: odpoved.status, json: async () => odpoved.data };
};
let schranka = null;
setTimeout(async () => {
 try {
  const fve = document.querySelector('.slide[data-title="FVE"]');
  const btn = fve.querySelector('.sbal-btn[data-sbal="topeni"]');
  check('tlačítko je na FVE', !!btn, true);
  check('  výchozí sbalené', document.querySelector('[data-sbal-obsah="topeni"]').hidden, true);

  topeniData = null;
  renderTopeni();
  check('bez dat hláška', /první záznam/.test(document.getElementById('topeniList').textContent), true);

  topeniData = { hodin: 30, model: { zakladW: 400, vareniW: 500, vareniOd: 17, vareniDo: 20 }, dny: [
    { d: '2026-10-04', hodin: 24, topeniKwh: 12.4, venkuC: 3.2, pokojeC: 21.4 },
    { d: '2026-10-05', hodin: 6, topeniKwh: 3, venkuC: null, pokojeC: 21 }
  ] };
  renderTopeni();
  const radky = document.querySelectorAll('#topeniList .wbsrc-row');
  check('řádek na den', radky.length, 2);
  check('nejnovější nahoře', /3 kWh/.test(radky[0].textContent), true);
  check('  kWh s čárkou', /~12,4 kWh/.test(radky[1].textContent), true);
  check('  teploty', /venku 3,2 °C · doma 21,4 °C/.test(radky[1].textContent), true);
  check('  celý den bez poznámky o hodinách', /h dat/.test(radky[1].textContent), false);
  check('  neúplný den řekne kolik hodin', /6 h dat/.test(radky[0].textContent), true);
  check('  chybějící teplota pomlčkou', /venku – ·/.test(radky[0].textContent), true);
  topeniData.dny[1] = { d: '2026-10-05', hodin: 24, topeniKwh: 3, tcTopeniKwh: 7.25, tcVodaKwh: 1.9, venkuC: 4, pokojeC: 21 };
  renderTopeni();
  const tcRadek = document.querySelectorAll('#topeniList .wbsrc-row')[0];
  check('změřené TČ místo odhadu', tcRadek.querySelector('.wbsrc-head').textContent.includes('TČ topení 7,3 kWh'), true);
  check('  voda a odhad pod tím', /TČ voda 1,9 kWh · odhad ~3 kWh/.test(tcRadek.textContent), true);
  check('poznámka vysvětlí odhad', /400 W a večer \\(17–20 h\\) vaření 500 W/.test(document.getElementById('topeniPozn').textContent), true);
  const an = document.getElementById('topeniAnalyza');
  check('bez rozboru skrytý', an.hidden, true);
  topeniData.analyza = { zdroj: 'tc', dnu: 30, kwhNaK: 2.3, bodZlomuC: 16.4, wNaK: 96, regreseDnu: 28,
    tyden: { dnu: 7, kwhDen: 31.5, venkuC: 2.1, kwhNaDenostupen: 1.98 }, minuly: { dnu: 7, kwhDen: 25, venkuC: 6, kwhNaDenostupen: 2.2 } };
  topeniData.model.zakladW = 310; topeniData.model.zakladZDat = true;
  renderTopeni();
  const anR = [...an.children].map(e => e.textContent);
  check('rozbor: kWh na °C, bod zlomu, zdroj', anR[0], 'Každý °C venku chladněji = +2,3 kWh topení za den (96 W/K) · topit začíná pod 16,4 °C · 28 dní, změřeno TČ');
  check('  týden proti minulému na denostupeň', anR[1], 'Týden: 31,5 kWh/den při 2,1 °C venku = 1,98 kWh/denostupeň (minulý 2,20, −10 %)'.replace('−', '-'));
  check('  zlepšení zeleně', an.querySelector('.lepsi') && an.querySelector('.lepsi').textContent, '-10 %');
  check('  poznámka: stálý odběr z dat', /310 W \\(spočítaný z nočních hodin\\)/.test(document.getElementById('topeniPozn').textContent), true);
  // Účinnost, porovnání před/po a ranní voda
  topeniData.analyza.cop = { cop: 4.11, hodin: 120, vodaC: 28, venkuC: 0.5, usporaNaStupenPct: 2.4 };
  topeniData.analyza.porovnani = [{ d: '2026-11-13', zmeny: ['a', 'b', 'c', 'd'], hotovo: false,
    pred: { dnu: 7, kwhDen: 20, venkuC: 2, kwhNaDenostupen: 1.25, vodaKwhDen: 3, pokoje: { obyvak: 23, loznice: 22.4 } },
    po: { dnu: 3, kwhDen: 14, venkuC: 4, kwhNaDenostupen: 1, vodaKwhDen: 2.5, pokoje: { obyvak: 22.1, loznice: 20 } } }];
  topeniData.voda = [{ d: '2026-11-14', v0630: 47.2, minRano: 31.4, pred11: 34.1, v1800: 46, max: 50.3 },
    { d: '2026-11-15', v0630: 41, minRano: 30 }, { d: '2026-11-16', v0630: 46.5, minRano: 33, pred11: 35 }, { d: '2026-11-17', max: 40 }];
  renderTopeni();
  const rk = [...an.querySelectorAll('div')].map(e => e.textContent);
  check('účinnost jako odhad', rk.find(t => t.startsWith('Účinnost')),
    'Účinnost čerpadla (odhad z teplot): z 1 kWh elektřiny asi 4,1 kWh tepla při vodě 28,0 °C a 0,5 °C venku · topná voda o 1 °C nižší = asi −2,4 % elektřiny');
  check('porovnání: nadpis', rk.includes('Změna nastavení 13. 11. (4×) — týden před a po'), true);
  check('  topení na denostupeň se změnou', rk.includes('Topení 1,25 kWh/denostupeň → 1,00 kWh/denostupeň (-20 %)'), true);
  check('  kWh/den, počasí a kolik dní zatím', rk.includes('20,0 kWh/den při 2,0 °C venku → 14,0 kWh/den při 4,0 °C · po změně zatím 3 dny ze 7'), true);
  check('  voda a pokoje', rk.includes('Teplá voda 3,0 kWh/den → 2,5 kWh/den (-17 %)') + ' ' + rk.includes('Pokoje: obývák 23,0 → 22,1 °C · ložnice 22,4 → 20,0 °C'), 'true true');
  check('  úspora zeleně', [...an.querySelectorAll('.topeni-porovnani .lepsi')].map(e => e.textContent).join(' '), '(-20 %) (-17 %)');
  check('ranní voda: nejnovější nahoře, den bez rána se neukáže', rk.filter(t => /^\\d+\\. 11\\.:/.test(t)).join(' | '),
    '16. 11.: v 6:30 46,5 °C · po sprše nejníž 33,0 °C · před 11:00 35,0 °C | 15. 11.: v 6:30 41,0 °C · po sprše nejníž 30,0 °C · před 11:00 – | 14. 11.: v 6:30 47,2 °C · po sprše nejníž 31,4 °C · před 11:00 34,1 °C · v 18:00 46,0 °C');
  check('  souhrn rána', rk.includes('V 6:30 bylo aspoň 43 °C 2× z 3 dní.'), true);
  topeniData.analyza.porovnani[0].po = null;
  renderTopeni();
  check('den po změně: počkat na data', [...an.querySelectorAll('div')].some(e => e.textContent === 'Po změně zatím není celý den dat — porovnání se ukáže zítra.'), true);
  check('nic nepřetéká', an.scrollWidth <= an.clientWidth + 1, true);

  // Kopírování: celá řada se stahuje až teď, se zámkem
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { schranka = t; } }, configurable: true });
  await topeniZkopiruj();
  check('stáhne celou řadu', dotazy.length && dotazy[0].url, '/api/topeni');
  check('  s tokenem', 'X-Auth-Token' in dotazy[0].init.headers, true);
  check('  do schránky JSON', JSON.parse(schranka).zaznamy[0].dumW, 2000);
  check('  stav', /zkopírováno/.test(document.getElementById('topeniStav').textContent), true);

  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('ne'); } }, configurable: true });
  await topeniZkopiruj();
  const zal = document.getElementById('topeniZaloha');
  check('bez schránky text k označení', !zal.hidden && /dumW/.test(zal.value), true);

  odpoved = { status: 500, data: {} };
  await topeniZkopiruj();
  check('chyba serveru se řekne', document.getElementById('topeniStav').textContent, 'nestáhlo se');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (topeni)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'topeni.html');
fs.writeFileSync(out, v);
console.log(out);
