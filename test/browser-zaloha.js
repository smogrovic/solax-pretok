// Řádek o záloze na stránce Log: musí umět vypnuto, čerstvě uloženo i chybu.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
  return ok;
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
  const el = document.getElementById('storeNote');
  const T = new Date(); T.setHours(12, 34, 0, 0);
  check('řádek na stránce Log existuje', !!el, true);
  check('je uvnitř stránky Log',
    el.closest('.slide').dataset.title, 'Log');

  renderStore({ enabled: false });
  check('vypnutá záloha to řekne', /vypnutá/.test(el.textContent), true);
  check('  a nesvítí červeně', el.classList.contains('bad'), false);

  renderStore({ enabled: true, loadedAt: 0, savedAt: 0 });
  check('zapnutá bez uložení čeká', /čeká na první uložení/.test(el.textContent), true);

  renderStore({ enabled: true, loadedAt: T.getTime(), savedAt: T.getTime() });
  check('po obnově ukáže čas', /obnoveno v 12:34/.test(el.textContent), true);
  check('  i čas uložení', /uloženo v 12:34/.test(el.textContent), true);

  renderStore({ enabled: true, savedAt: T.getTime(), error: 'HTTP 401' });
  check('chyba se ukáže', /HTTP 401/.test(el.textContent), true);
  check('  a je červená', el.classList.contains('bad'), true);

  renderStore({ enabled: true, savedAt: T.getTime() });
  check('po opravě červená zmizí', el.classList.contains('bad'), false);

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (záloha)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'zaloha.html');
fs.writeFileSync(out, v);
console.log(out);
