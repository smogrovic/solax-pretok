// Karta „Velikost aplikace" v Log/Nastavení: jen když server dovolí (správce), s procenty z limitů.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const MB = 1048576;
const DATA = { ok: true,
  kod: { b: 3.3 * MB, souboru: 120, indexHtml: 0.75 * MB, serverJs: 0.7 * MB, nejvetsi: { nazev: 'public/index.html', b: 0.75 * MB } },
  zavislosti: { b: 23 * MB, souboru: 2000 },
  github: { repo: 'x/y', b: 30 * MB, chyba: null },
  pamet: { rss: 470 * MB, heap: 80 * MB },
  uloziste: { zaznamy: [{ k: 'stav', b: 1.5 * MB }, { k: 'topeni', b: 0.5 * MB }], celkem: 2 * MB, nejvetsi: 1.5 * MB, zapnuto: true },
  limity: { githubSoubor: 100 * MB, githubRepo: 1024 * MB, renderRam: 512 * MB, upstashZaznam: 10 * MB, upstashData: 256 * MB } };
v = v.replace('</head>', `<script>
window.__spravce = false; window.__dotazy = [];
window.fetch = async (url, init) => {
  url = String(url); window.__dotazy.push(url);
  if (url.startsWith('/api/auth/stav')) return { ok: true, status: 200, json: async () => ({ zapnuto: true, prihlasen: true, email: 'nekdo@x.cz' }) };
  if (url.startsWith('/api/velikost')) return window.__spravce ? { ok: true, status: 200, json: async () => (${JSON.stringify(DATA)}) }
    : { ok: false, status: 403, json: async () => ({ error: 'Jen pro správce.' }) };
  return { ok: true, status: 200, json: async () => ({}) };
};</script></head>`);

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
const pockej = ms => new Promise(r => setTimeout(r, ms));
setTimeout(async () => {
 try {
  const karta = document.getElementById('velikostKarta');
  check('po načtení se server zeptal', window.__dotazy.some(u => u.startsWith('/api/velikost')), true);
  check('jiný účet (403): karta skrytá', karta.hidden, true);
  window.__spravce = true;
  await velikostNacti();
  check('správce: karta vidět', karta.hidden, false);
  check('  je v Log/Nastavení', !!karta.closest('.slide[data-title="Log/Nastavení"]'), true);
  const radky = [...karta.querySelectorAll('.velikost-radek')].map(r => r.querySelector('.velikost-hlava').textContent);
  check('řádky s procenty', radky.join(' | '),
    'Kód aplikace3,3 MB | GitHub: největší soubor0,75 % | GitHub: repozitář s historií3 % | Render: paměť serveru92 % | Upstash: největší záznam15 % | Upstash: data celkem0,78 % | Knihovny (node_modules)23 MB');
  const pruh = t => [...karta.querySelectorAll('.velikost-radek')].find(r => r.textContent.startsWith(t)).querySelector('.velikost-pruh');
  check('  pruh u limitů, u kódu ne', !!pruh('GitHub: největší') + ' ' + !!pruh('Kód aplikace'), 'true false');
  check('  nad 90 % = červený', pruh('Render').className, 'velikost-pruh plno');
  check('  šířka pruhu podle procent', pruh('Upstash: největší').firstChild.style.width, '15%');
  check('  podrobnosti', [...karta.querySelectorAll('.velikost-pod')][3].textContent, '470 MB z 512 MB RAM');
  window.__spravce = false;
  await velikostNacti();
  check('odebrané právo: zase skrytá', karta.hidden, true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message); }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb ? 'SELHALO — ' + chyb + ' chyb' : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (velikost)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'velikost.html');
fs.writeFileSync(out, v);
console.log(out);
