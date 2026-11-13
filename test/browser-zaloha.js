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
setTimeout(async () => {
  const el = document.getElementById('storeNote');
  const T = new Date(); T.setHours(12, 34, 0, 0);
  check('řádek na stránce Log existuje', !!el, true);
  check('je uvnitř stránky Log/Nastavení',
    el.closest('.slide').dataset.title, 'Log/Nastavení');

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
  renderStore({ enabled: true, savedAt: T.getTime(), verze: 'b950250', spusteno: T.getTime() });
  check('ukáže nasazenou verzi', /Verze b950250 \\(spuštěno /.test(el.textContent), true);
  renderStore({ enabled: false, verze: 'b950250' });
  check('  i při vypnuté záloze', /Verze b950250/.test(el.textContent), true);
  renderStore({ enabled: true, savedAt: T.getTime(), verze: '' });
  check('bez verze nic navíc', /Verze/.test(el.textContent), false);

  // Záloha do souboru
  const karta = document.getElementById('zalohaKarta');
  check('karta Záloha je na Log/Nastavení', karta.closest('.slide').dataset.title, 'Log/Nastavení');
  check('  dvě tlačítka', [...karta.querySelectorAll('button')].map(b => b.textContent).join(' | '),
    '⬇️ Stáhnout zálohu (data + aplikace) | ⬆️ Obnovit data ze zálohy');
  let dotaz = null, stazeno = null;
  const puvodniKlik = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { stazeno = this.download; };
  window.fetch = async (adresa, init) => {
    dotaz = { adresa, init };
    return { ok: true, status: 200, headers: { get: () => 'attachment; filename="solinator-zaloha-2026-11-02.json"' },
      blob: async () => new Blob(['{"zaloha":"solinator"}'], { type: 'application/json' }) };
  };
  await zalohaStahni();
  HTMLAnchorElement.prototype.click = puvodniKlik;
  check('stažení: s tokenem', dotaz.adresa + ' ' + ('X-Auth-Token' in dotaz.init.headers), '/api/zaloha true');
  check('  uloží se pod jménem ze serveru', stazeno, 'solinator-zaloha-2026-11-02.json');
  check('  a řekne to', /Staženo: solinator-zaloha-2026-11-02\.json/.test(document.getElementById('zalohaHint').textContent), true);

  // Obnova: po potvrzení jen data
  window.zeptejSe = async () => true;
  zeptejSe = window.zeptejSe;
  window.fetch = async (adresa, init) => { dotaz = { adresa, telo: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ ok: true, obnoveno: 30, celkem: 41 }) }; };
  await zalohaObnov(JSON.stringify({ zaloha: 'solinator', at: Date.now(), data: { posts: { a: 1 }, primo: {} }, aplikace: { soubory: { 'server.js': 'x' } } }));
  check('obnova pošle jen data', dotaz.adresa + ' ' + Object.keys(dotaz.telo).join(',') + ' ' + JSON.stringify(dotaz.telo.data.posts), '/api/zaloha/obnovit data {"a":1}');
  check('  a ukáže výsledek', document.getElementById('zalohaHint').textContent, 'Obnoveno 30 z 41 částí.');
  dotaz = null;
  await zalohaObnov('{"neco":1}');
  check('cizí soubor se nepošle', [dotaz, document.getElementById('zalohaHint').textContent].join(' '), ' Soubor není záloha SMGhome.');
  window.zeptejSe = async () => false;
  zeptejSe = window.zeptejSe;
  await zalohaObnov(JSON.stringify({ data: { posts: {} } }));
  check('bez potvrzení nic', dotaz, null);

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
