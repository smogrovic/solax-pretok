// Stránka Logika automatiky: všechny sekce, krátké odrážky a funkční nastavení sauny
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.slide{display:none!important}'
  + '.slide[data-title="Logika automatiky"]{display:block!important}'
  + '.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const OUT = [];
let poslano = null;
window.fetch = async (url, opts) => {
  poslano = { url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null };
  return { ok: true, status: 200, json: async () => ({ ok: true, limitW: 800, holdMin: 45 }) };
};
function check(name, got, want) {
  const ok = String(got) === String(want);
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(54) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
 try {
  await wait(150);
  const page = document.querySelector('.slide[data-title="Logika automatiky"]');
  const sekce = [...page.querySelectorAll('.logic-h')].map(e => e.textContent);
  const li = [...page.querySelectorAll('.logic-list li')];

  OUT.push('\\n1) Obsah a délka');
  check('sekcí je dvanáct', sekce.length, 12);
  for (const s of ['Obecné', 'Zima', 'Bazén (filtrace)', 'Sauna', 'Bojler 1 (TČ)', 'Wallbox',
                   'Ruční zásah vs. automatika', 'Priorita auta', 'Korekce podle předpovědi',
                   'Data, notifikace, časovače'])
    check('je tam ' + s, sekce.some(x => x.startsWith(s)), 'true');
  check('odrážek je nejvýš 65', li.length <= 65, 'true');
  const lh = parseFloat(getComputedStyle(li[0]).lineHeight) || 18;
  const dlouhe = li.filter(e => e.getBoundingClientRect().height > lh * 3.4);
  check('žádná odrážka není delší než tři řádky', dlouhe.length, 0);
  for (const e of dlouhe) OUT.push('      ' + e.textContent.slice(0, 80));
  check('nic nepřetéká do stran', page.scrollWidth <= page.clientWidth + 1, 'true');
  const txt = li.map(e => e.textContent).join(' ');
  check('sauna má pravidlo o jističi', /stejném jističi/.test(txt), 'true');
  check('wallbox má ranní okno', /ráno 3:00 → 10:00/.test(txt), 'true');
  check('  i denní práh', /zbývá vyrobit aspoň 10 kWh/.test(txt), 'true');
  check('  a večerní GREEN', /večer a noc do 3:00/.test(txt), 'true');

  OUT.push('\\n2) Nastavení sauny');
  saunaData = { powerW: 0, fetchedAt: new Date().toISOString(), topi: false, since: 0,
                blockUntil: 0, limitW: 500, holdMin: 30 };
  renderSaunaSet();
  check('pole ukazují aktuální meze', saunaLimitInput.value + '/' + saunaHoldInput.value, '500/30');
  saunaLimitInput.value = '800';
  saunaHoldInput.value = '45';
  saunaSaveBtn.click();
  await wait(120);
  check('uložení střelí na server', poslano && poslano.url, '/api/sauna/limits');
  check('  s novými hodnotami', JSON.stringify(poslano.body), '{"limitW":800,"holdMin":45}');
  check('  a appka si je vezme', saunaData.limitW + '/' + saunaData.holdMin, '800/45');
  check('  potvrdí to pod tlačítkem', /Uloženo: topí od 800 W, drží 45 min/.test(saunaSaveHint.textContent), 'true');
  check('  a zálohuje do telefonu', JSON.parse(localStorage.getItem('saunaSet')).limitW, 800);
  check('připomene, že skript má práh vlastní', /skriptu uvnitř Shelly/.test(saunaSaveHint.textContent), 'true');

  saunaData = { ...saunaData, limitW: 500, holdMin: 30 };
  poslano = null;
  await maybeRestoreSaunaSet(saunaData);
  check('po deployi vrátí serveru poslední meze', poslano && poslano.url, '/api/sauna/limits/restore');
  check('  a jsou to ty z telefonu', JSON.stringify(poslano.body), '{"limitW":800,"holdMin":45}');
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
const out = path.join(SP, 'logika.html');
fs.writeFileSync(out, v);
console.log(out);
