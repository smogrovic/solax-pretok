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
