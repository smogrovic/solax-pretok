// Upozornění pro všechny: červený box přes celou appku, i přes kalendář.
// OKNO: 1180,820
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
window.fetch = async (url, init) => {
  const telo = init && init.body ? JSON.parse(init.body) : null;
  dotazy.push({ url, telo });
  const d = url === '/api/oznameni' ? { ok: true, oznameni: { id: 'o_novy', text: telo.text, od: 1 } } : { ok: true };
  return { ok: true, status: 200, json: async () => d };
};
const pockej = ms => new Promise(r => setTimeout(r, ms));
setTimeout(async () => {
 try {
  const okno = document.getElementById('oznameniOkno');
  check('bez upozornění nic', okno.hidden, true);
  // Kalendář přes celou obrazovku (iPad) — upozornění musí být nad ním
  const siroky = window.innerWidth >= 1000;
  const zal = document.getElementById('oznameniZalozka');
  if (!siroky) {
    // Telefon: jen červená záložka u zvonečku, box až po klepnutí
    oznameniData = { id: 'o_abc', text: 'Večeře v 18:00!', od: Date.now() };
    renderOznameni();
    check('telefon: přes displej nesvítí', okno.hidden, true);
    check('  červená záložka v rohu', zal.getClientRects().length > 0, true);
    check('  je červená', getComputedStyle(zal).backgroundColor, 'rgb(198, 40, 40)');
    pripPlovouciAkce(zal);
    check('  klepnutí ukáže text', okno.hidden, false);
    check('  s tlačítkem nechat na iPadu', document.getElementById('oznameniZavrit').getClientRects().length > 0, true);
    dotazy = [];
    document.getElementById('oznameniZavrit').click();
    await pockej(20);
    check('  Zavřít jen u sebe', okno.hidden + ' ' + dotazy.length + ' ' + (zal.getClientRects().length > 0), 'true 0 true');
    pripPlovouciAkce(zal);
  } else {
    check('iPad: červená záložka není', (oznameniData = { id: 'o_abc', text: 'Večeře v 18:00!', od: Date.now() }, renderOznameni(), zal.hidden), true);
    check('  ani Zavřít jen u sebe', document.getElementById('oznameniZavrit').hidden, true);
  }
  try { kalOtevri(true); } catch {}
  renderOznameni();
  check('upozornění je vidět', okno.getClientRects().length > 0, true);
  check('  s textem', document.getElementById('oznameniText').textContent, 'Večeře v 18:00!');
  const box = okno.querySelector('.oznameni-box');
  check('  červený box', getComputedStyle(box).backgroundColor, 'rgb(198, 40, 40)');
  const r = box.getBoundingClientRect();
  const nahore = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  check('  je nahoře nad vším (i kalendářem)', box.contains(nahore), true);
  const roh = document.elementFromPoint(5, window.innerHeight - 5);
  check('  překrývá celou obrazovku', roh === okno, true);

  dotazy = [];
  document.getElementById('oznameniOk').click();
  await pockej(20);
  check('Rozumím zavře', okno.hidden, true);
  check('  a odklikne pro všechny se správným id', dotazy[0] && dotazy[0].url + ' ' + dotazy[0].telo.id, '/api/oznameni/zrusit o_abc');
  try { kalOtevri(false); } catch {}

  // Logika automatiky: text → potvrzení → odeslání
  const vstup = document.getElementById('oznameniVstup');
  check('pole je v Logice automatiky', !!vstup.closest('.slide[data-title="Logika automatiky"]'), true);
  dotazy = [];
  vstup.value = '';
  document.getElementById('oznameniPoslat').click();
  await pockej(20);
  check('prázdné se nepošle', dotazy.length + ' ' + /Napiš/.test(document.getElementById('oznameniHint').textContent), '0 true');
  vstup.value = 'Zavřete okna, bude bouřka';
  document.getElementById('oznameniPoslat').click();
  await pockej(20);
  const potvrz = document.getElementById('potvrzOkno');
  check('nejdřív se ptá', potvrz.hidden, false);
  check('  s náhledem textu', document.getElementById('potvrzText').textContent, 'Zavřete okna, bude bouřka');
  check('  a zatím nic neodešlo', dotazy.length, 0);
  document.getElementById('potvrzAno').click();
  await pockej(30);
  check('po potvrzení odešle', dotazy[0] && dotazy[0].url + ' ' + dotazy[0].telo.text, '/api/oznameni Zavřete okna, bude bouřka');
  check('  a hned se ukáže (na iPadu přes displej, na telefonu záložka)', siroky ? !okno.hidden : !zal.hidden, true);
  check('  pole se vyprázdní', vstup.value, '');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (upozornění)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'oznameni.html');
fs.writeFileSync(out, v);
console.log(out);
