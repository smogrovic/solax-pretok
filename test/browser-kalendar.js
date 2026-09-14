// OKNO: 1180,820
// Stránka Kalendář. Běží ve velkém okně, protože hlavní pointa je, že kalendář
// zabírá CELOU obrazovku — na rozdíl od ostatních stránek, které jsou na iPadu
// třetinové. V úzkém okně by se ten rozdíl nedal změřit.
//
// Panel schválně není `.slide`: kdyby byl, dostal by třetinovou šířku a den by
// se do něj nevešel.
//
// Na širokém displeji se ukazuje DENNÍ pohled: sloupec = kalendář, svisle 00:00–24:00.
// Seznam dnů pod sebou zůstává pro telefon, kde by pět sloupců po 24 h bylo nečitelné.
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

  R.push('\\n3) Denní pohled: sloupec = kalendář');
  check('na širokém displeji je vidět denní pohled',
    getComputedStyle(document.getElementById('kalDenPohled')).display, 'flex');
  check('  a seznam dnů ustoupí', getComputedStyle(document.getElementById('kalDny')).display, 'none');

  const KAL = [
    { nazev: 'Family', barva: '#34AADC' }, { nazev: 'Lukáš', barva: '#8B8B8B' },
    { nazev: 'Zuzka', barva: '#FF2968' }, { nazev: 'Miki', barva: '#1D9A57' },
    { nazev: 'Elenka', barva: '#CC73E1' }
  ];
  const ud = (kal, odH, doH, nazev, extra) => Object.assign(
    { uid: nazev, kalendar: kal, od: denMs(0) + odH * 3600000, do: denMs(0) + doH * 3600000,
      celodenni: false, nazev, misto: null }, extra || {});
  const dd = dny(7);
  dd[0].udalosti = [
    ud('Lukáš', 6, 14, 'Let Praha–Řím'),
    ud('Lukáš', 8, 9, 'Porada'),                 // překrývá se s letem
    ud('Miki', 8, 12, 'Škola'),
    { uid: 'sv', kalendar: 'Family', od: denMs(0), do: denMs(1), celodenni: true, nazev: 'Svátek', misto: null }
  ];
  renderKalendar({ enabled: true, dnu: 7, days: dd, kalendare: KAL,
                   fetchedAt: new Date().toISOString(), error: null });

  const hlavy = [...document.querySelectorAll('#kalMrizka .kal-hlava')].map(h => h.textContent);
  check('sloupců je pět', hlavy.length, 5);
  check('  v zadaném pořadí', hlavy.join(', '), 'Family, Lukáš, Zuzka, Miki, Elenka');
  const sloupce = [...document.querySelectorAll('#kalMrizka .kal-sloupec')];
  check('každý kalendář má svůj sloupec', sloupce.length, 5);
  check('osa jde od půlnoci do půlnoci',
    [...document.querySelectorAll('#kalMrizka .kal-hod')].map(h => h.textContent).slice(0, 3).join(','), '00:00,01:00,02:00');
  check('  a je jich čtyřiadvacet', document.querySelectorAll('#kalMrizka .kal-hod').length, 24);
  check('  a poslední je 23:00', [...document.querySelectorAll('#kalMrizka .kal-hod')].pop().textContent, '23:00');

  // Událost sedí na svém čase: 6:00 je čtvrtina dne od půlnoci
  const bloky = [...sloupce[1].querySelectorAll('.kal-blok')];
  check('let je ve sloupci Lukáš', bloky.length, 2);
  const let6 = bloky.find(b => /Let Praha/.test(b.textContent));
  // Umisťuje se v PROCENTECH dne, takže celý den je vidět naráz a nikam se neroluje
  check('  a začíná v šest ráno', Math.round(parseFloat(let6.style.top) / 100 * 24), 6);
  check('  s délkou osmi hodin', Math.round(parseFloat(let6.style.height.match(/([\\d.]+)%/)[1]) / 100 * 24), 8);
  // Panel je na zdi — celý den musí být vidět naráz, nikam se neroluje
  const mr = document.getElementById('kalMrizka');
  check('celý den se vejde bez rolování', mr.scrollHeight <= mr.clientHeight + 1, true);
  check('  a osa vyplní zbylou výšku', document.querySelector('.kal-osa').clientHeight > 400, true);
  // Vzhled podle předlohy: světlá výplň a barevný proužek vlevo, ne plocha syté barvy.
  // Na pěti sloupcích vedle sebe je sytá plocha nečitelná.
  check('blok má světlou výplň', /^rgba\\(/.test(let6.style.background), true);
  check('  a text v barvě kalendáře', let6.style.color, 'rgb(139, 139, 139)');
  // Překryv se nesmí schovat jeden za druhý — na zdi by to vypadalo prázdně
  check('překrývající se události jdou vedle sebe', /50%/.test(let6.style.width), true);
  check('celodenní má vlastní pruh nad osou',
    document.querySelectorAll('#kalMrizka .kal-cely-chip').length, 1);
  check('  a není v ose', sloupce[0].querySelectorAll('.kal-blok').length, 0);
  check('dnešek má čáru „teď"', document.querySelectorAll('#kalMrizka .kal-ted').length, 5);

  R.push('\\n3b) Přepínání dnů');
  check('název říká, že je dnes', /^Dnes /.test(document.getElementById('kalDenNazev').textContent), true);
  check('zpátky se nedá', document.getElementById('kalPrev').disabled, true);
  document.getElementById('kalNext').click();
  check('dopředu ano', /^Zítra /.test(document.getElementById('kalDenNazev').textContent), true);
  check('  a zítřek už čáru „teď" nemá', document.querySelectorAll('#kalMrizka .kal-ted').length, 0);
  document.getElementById('kalPrev').click();
  check('a zpátky na dnešek', /^Dnes /.test(document.getElementById('kalDenNazev').textContent), true);

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

  R.push('\\n5) Diagnostika napojení');
  // Ladit napojení jde jen naostro (přihlašovací údaje jsou na serveru), takže
  // tlačítko musí být po ruce právě tehdy, když je co ladit — a jinak nepřekážet.
  const diagBtn = document.getElementById('kalDiagBtn');
  renderKalendar({ enabled: true, dnu: 7, days: dny(7), fetchedAt: new Date().toISOString(),
                   error: 'hledání kalendářů: Nenašel jsem žádný kalendář s událostmi' });
  check('při chybě se tlačítko nabídne', diagBtn.hidden, false);
  renderKalendar({ enabled: true, dnu: 7, days: [], fetchedAt: null, error: null });
  check('  i když ještě nic nedorazilo', diagBtn.hidden, false);
  const sDaty = dny(7);
  sDaty[0].udalosti = [{ uid: 'q', od: denMs(0), do: denMs(1), celodenni: true, nazev: 'Něco', misto: null }];
  renderKalendar({ enabled: true, dnu: 7, days: sDaty, fetchedAt: new Date().toISOString(), error: null });
  check('když to jede, tlačítko nepřekáží', diagBtn.hidden, true);
  renderKalendar({ enabled: false, dnu: 7, days: [], fetchedAt: null, error: null });
  check('  a bez nastavení taky ne', diagBtn.hidden, true);
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
