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
  check('poznámka vysvětlí odhad', /400 W a večer \\(17–20 h\\) vaření 500 W/.test(document.getElementById('topeniPozn').textContent), true);

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
