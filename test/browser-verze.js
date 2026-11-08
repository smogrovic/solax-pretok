// Lišta „nová verze": version.json se liší od window.APP_BUILD → jednou dole lišta s Načíst.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// Jako na serveru: otisk do hlavičky. fetch se podvrhne ještě před skripty stránky.
v = v.replace('</head>', `<script>window.APP_BUILD = "aaa111bbb222";
window.__dotazy = []; window.__odpoved = { build: "aaa111bbb222" }; window.__padat = false;
window.fetch = async (url, init) => {
  window.__dotazy.push({ url: String(url), init });
  if (window.__padat) throw new Error('síť');
  if (String(url).startsWith('version.json')) return { ok: true, status: 200, json: async () => window.__odpoved };
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
  const lista = () => document.querySelectorAll('.nova-verze');
  const verze = () => window.__dotazy.filter(d => d.url.startsWith('version.json'));
  window.dispatchEvent(new Event('focus'));
  await pockej(30);
  const d = verze().pop();
  check('focus stáhne version.json bez cache', /^version\\.json\\?t=\\d+$/.test(d.url) + ' ' + d.init.cache, 'true no-store');
  check('  stejný build → nic', lista().length, 0);
  window.__padat = true;
  window.dispatchEvent(new Event('focus'));
  await pockej(30);
  check('chyba sítě se tiše ignoruje', lista().length, 0);
  window.__padat = false;
  window.__odpoved = { build: 'ccc333ddd444' };
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  await pockej(30);
  check('návrat do appky + jiný build → lišta', lista().length, 1);
  const l = lista()[0];
  check('  text a tlačítko', l.querySelector('span').textContent + ' | ' + l.querySelector('button').textContent, 'Je nová verze aplikace. | Načíst');
  const cs = getComputedStyle(l);
  check('  pevně dole, 16 px od kraje, max 520 px', [cs.position, cs.left, cs.right, cs.maxWidth].join(' '), 'fixed 16px 16px 520px');
  check('  bílý text na barvě appky, zaoblená', [cs.color, cs.borderTopLeftRadius].join(' '), 'rgb(255, 255, 255) 16px');
  check('  nad spodním okrajem', parseFloat(cs.bottom) >= 14, true);
  window.dispatchEvent(new Event('focus'));
  await pockej(30);
  check('ukáže se jen jednou', lista().length, 1);
  const pred = verze().length;
  window.dispatchEvent(new Event('focus'));
  await pockej(30);
  check('  a dál se už neptá', verze().length, pred);
  // Načíst: nejdřív fetch('./', reload) — location.reload se v testu nevolá doopravdy
  const cely = [...document.scripts].map(s => s.textContent).find(t => t.includes('Nová verze appky'));
  const src = cely.slice(cely.indexOf('// ---------- Nová verze appky'));
  check('Načíst: fetch ./ s cache reload, pak location.reload i při chybě',
    /try \\{ await fetch\\('\\.\\/', \\{ cache: 'reload' \\}\\); \\} catch \\{[^}]*\\}\\s*location\\.reload\\(\\);/.test(src), true);
  check('kontroly: 20 s po startu a každých 5 min', /setTimeout\\(zkontroluj, 20000\\)/.test(src) && /setInterval\\(zkontroluj, 5 \\* 60000\\)/.test(src), true);
  check('žádný nový service worker', (src.match(/serviceWorker/g) || []).length, 0);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message); }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb ? 'SELHALO — ' + chyb + ' chyb' : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (verze)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'verze.html');
fs.writeFileSync(out, v);
console.log(out);
