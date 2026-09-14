// OKNO: 1180,820
// Stránka Kalendář. Běží ve velkém okně, protože hlavní pointa je, že kalendář
// zabírá CELOU obrazovku — na rozdíl od ostatních stránek, které jsou na iPadu
// třetinové. V úzkém okně by se ten rozdíl nedal změřit.
//
// Panel schválně není `.slide`: kdyby byl, dostal by třetinovou šířku a týden by
// se do něj nevešel.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno.padEnd(52) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
 try {
  const panel = document.getElementById('kalPanel');
  const zalozka = document.querySelector('.page-tab-kal');
  const dnes = new Date();
  const den = o => {
    const d = new Date(dnes); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + o);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const denMs = o => { const d = new Date(dnes); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + o); return d.getTime(); };
  const dny = n => Array.from({ length: n }, (_, i) => ({ d: den(i), od: denMs(i), udalosti: [] }));

  R.push('1) Vlastní tlačítko, ne stránka v pásu');
  check('kalendář není mezi stránkami', panel.classList.contains('slide'), false);
  check('  a stojí mimo pás', document.getElementById('sliderWrap').contains(panel), false);
  check('záložka existuje', zalozka.textContent, 'Kalendář');
  check('na začátku je schovaný', panel.hidden, true);

  zalozka.click();
  check('klik ho otevře', panel.hidden, false);
  check('  a pás stránek se schová', document.getElementById('sliderWrap').style.display, 'none');
  check('  záložka svítí', zalozka.classList.contains('active'), true);
  // Tady je celá pointa: přes celou šířku, ne třetina jako ostatní stránky
  const sirkaStr = document.querySelector('.slide').getBoundingClientRect().width;
  check('zabírá celou šířku', panel.getBoundingClientRect().width > 2.5 * sirkaStr, true);

  document.querySelectorAll('#pageTabs .page-tab:not(.page-tab-kal)')[1].click();
  check('klik na jinou záložku ho zavře', panel.hidden, true);
  check('  a pás se vrátí', document.getElementById('sliderWrap').style.display, '');
  check('  a jeho záložka zhasne', zalozka.classList.contains('active'), false);
  zalozka.click();

  R.push('\\n2) Sedm dní');
  const d7 = dny(7);
  // Pořadí v rámci dne řeší server (celodenní nahoru) — appka kreslí, co dostane
  d7[0].udalosti = [
    { uid: 'b', od: denMs(0), do: denMs(1), celodenni: true, nazev: 'Svátek', misto: null },
    { uid: 'a', od: denMs(0) + 9 * 3600000, do: denMs(0) + 10 * 3600000, celodenni: false, nazev: 'Zubař', misto: 'Benešov' }
  ];
  d7[2].udalosti = [{ uid: 'c', od: denMs(2) + 18 * 3600000, do: denMs(2) + 19 * 3600000, celodenni: false, nazev: 'Trénink', misto: null }];
  renderKalendar({ enabled: true, dnu: 7, days: d7, fetchedAt: new Date().toISOString(), error: null });
  const boxy = [...document.querySelectorAll('#kalDny .kal-den')];
  check('vykreslí se sedm dnů', boxy.length, 7);
  check('první je dnes', /^Dnes /.test(boxy[0].querySelector('.kal-den-h').textContent), true);
  check('  a je zvýrazněný', boxy[0].classList.contains('dnes'), true);
  check('druhý je zítra', /^Zítra /.test(boxy[1].querySelector('.kal-den-h').textContent), true);
  check('další už jménem dne',
    /^(pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle) /.test(boxy[2].querySelector('.kal-den-h').textContent), true);
  check('prázdný den to řekne', boxy[1].querySelector('.kal-nic').textContent, 'nic');
  check('událost má čas a název', boxy[0].querySelectorAll('.kal-udalost').length, 2);
  check('  celodenní je první', boxy[0].querySelector('.kal-udalost').textContent.includes('Svátek'), true);
  check('  a píše se u ní „celý den"', boxy[0].querySelector('.kal-cas').textContent, 'celý den');
  check('  časovaná má hodinu', boxy[0].querySelectorAll('.kal-cas')[1].textContent, '09:00');
  check('  a místo se připíše', /Benešov/.test(boxy[0].textContent), true);

  R.push('\\n3) Sedm sloupců na iPadu');
  const sl = getComputedStyle(document.getElementById('kalDny')).gridTemplateColumns.split(' ').length;
  check('dny jsou vedle sebe', sl, 7);

  R.push('\\n4) Když to ještě není nastavené');
  renderKalendar({ enabled: false, dnu: 7, days: [], fetchedAt: null, error: null });
  check('řekne, že chybí přihlášení',
    /Zatím nenastavený/.test(document.getElementById('kalMeta').textContent), true);
  check('  a nekreslí prázdné dny', document.querySelectorAll('#kalDny .kal-den').length, 0);
  renderKalendar({ enabled: true, dnu: 7, days: dny(7), fetchedAt: null, error: null });
  check('před prvním stažením to taky řekne',
    /Čeká se na první stažení/.test(document.getElementById('kalMeta').textContent), true);
  renderKalendar({ enabled: true, dnu: 7, days: dny(7), fetchedAt: new Date().toISOString(), error: 'iCloud odmítl přihlášení (je to heslo pro aplikaci?)' });
  check('chyba se ukáže tak, jak přišla',
    /heslo pro aplikaci/.test(document.getElementById('kalMeta').textContent), true);
  // Poslední známý týden zůstane — výpadek iCloudu nemá vygumovat obrazovku
  check('  a dny zůstanou vykreslené', document.querySelectorAll('#kalDny .kal-den').length, 7);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (kalendář)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'kalendar.html');
fs.writeFileSync(out, v);
console.log(out);
