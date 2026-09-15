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
  // iPad visí na zdi: to, co má být vidět, když kolem nikdo nestojí, je kalendář
  check('na širokém displeji je hned otevřený', panel.hidden, false);
  check('  a pás stránek je schovaný', document.getElementById('sliderWrap').style.display, 'none');
  check('  a jeho záložka svítí', zalozka.classList.contains('active'), true);
  zalozka.click();
  check('klik ho zavře', panel.hidden, true);
  zalozka.click();
  check('  a znovu otevře', panel.hidden, false);
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
  check('  a proužek v barvě kalendáře', let6.style.borderLeftColor, 'rgb(142, 142, 147)');
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

  R.push('\\n3d) Nadpis pryč, „načteno" dolů');
  // Nadpis „Kalendář" nad kalendářem jen bral výšku — v liště svítí záložka téhož
  // jména. „Načteno v…" je poznámka pod čarou a patří pod kalendář, ne nad něj.
  check('nad kalendářem už není nadpis', document.querySelectorAll('.kal-title').length, 0);
  const meta = document.getElementById('kalMeta');
  check('„načteno" je poslední v panelu', panel.lastElementChild === meta, true);
  check('  a je pod mřížkou',
    meta.getBoundingClientRect().top >= document.getElementById('kalMrizka').getBoundingClientRect().bottom, true);
  check('  vpravo', getComputedStyle(meta).textAlign, 'right');
  check('  a pořád píše, kdy se to načetlo', /^Načteno v /.test(meta.textContent), true);

  R.push('\\n3c) Barvy podle telefonu');
  // Sloupec musí mít tu barvu, kterou má kalendář v telefonu — jinak se na zdi hledá,
  // čí událost to vlastně je. Barva z iCloudu na to není: u sdílených kalendářů vrací
  // barvu toho, kdo sdílí, takže KAL schválně hlásí u Family modrou.
  const dc = dny(7);
  dc[0].udalosti = [
    ud('Family', 10, 11, 'Oběd'),
    ud('Zuzka', 12, 13, 'Kadeřník'),
    ud('Lukáš', 8, 9, 'Porada'),
    ud('Lukáš', 15, 18, 'OK123 PRG-FCO', { zdroj: 'duty' })
  ];
  renderKalendar({ enabled: true, dnu: 7, days: dc, kalendare: KAL,
                   fetchedAt: new Date().toISOString(), error: null });
  const sl2 = [...document.querySelectorAll('#kalMrizka .kal-sloupec')];
  const blok = (i, jm) => [...sl2[i].querySelectorAll('.kal-blok')].find(b => b.textContent.includes(jm));
  check('Family je žlutá', blok(0, 'Oběd').style.borderLeftColor, 'rgb(255, 214, 10)');
  check('  i když iCloud hlásí modrou', KAL[0].barva, '#34AADC');
  check('Zuzka červená', blok(2, 'Kadeřník').style.borderLeftColor, 'rgb(229, 69, 58)');
  check('Lukáš šedý', blok(1, 'Porada').style.borderLeftColor, 'rgb(142, 142, 147)');
  // Létání chodí z odebíraného kalendáře a slévá se k Lukášovi — jen modře
  check('létání je v Lukášově sloupci', !!blok(1, 'OK123'), true);
  check('  ale modré, ne šedé', blok(1, 'OK123').style.borderLeftColor, 'rgb(47, 125, 216)');

  // Karta je bílá: žlutá ani světle šedá se na ní nepřečtou. Text se proto ztmavuje,
  // dokud nemá kontrast 4,5:1 — proužek a výplň zůstávají v barvě z telefonu.
  // Měří se proti podkladu, na kterém text OPRAVDU sedí (světlá výplň bloku, ne bílá),
  // a se započtenou průhledností — zeslabený text je stejně nečitelný jako světlý.
  const rgb = s => (s.match(/[\\d.]+/g) || []).map(Number);
  const kan = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const jas = c => 0.2126 * kan(c[0]) + 0.7152 * kan(c[1]) + 0.0722 * kan(c[2]);
  const pomer = (fg, bg) => (jas(bg) + 0.05) / (jas(fg) + 0.05);
  check('kontrolní výpočet sedí',
    Math.round(pomer([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
  const citelnost = el => {
    const blok = el.closest('.kal-blok');
    const v = rgb(blok.style.background);                 // rgba(r,g,b,alfa) na bílé kartě
    const bg = [0, 1, 2].map(i => v[i] * v[3] + 255 * (1 - v[3]));
    const pruhl = parseFloat(getComputedStyle(el).opacity);
    const fg = rgb(getComputedStyle(el).color).map((c, i) => c * pruhl + bg[i] * (1 - pruhl));
    return pomer(fg, bg);
  };
  const vsechny = [...document.querySelectorAll('#kalMrizka .kal-blok')];
  check('bloků je na co koukat', vsechny.length, 4);
  check('název v bloku je čitelný',
    vsechny.every(b => citelnost(b.querySelector('b')) >= 4.5), true);
  check('  a čas pod ním taky', vsechny.every(b => citelnost(b.querySelector('.kal-blok-cas')) >= 4.5), true);
  check('  a názvy sloupců taky',
    [...document.querySelectorAll('#kalMrizka .kal-hlava')]
      .every(h => pomer(rgb(getComputedStyle(h).color), [255, 255, 255]) >= 4.5), true);
  // Hodinová událost je na dvě řádky moc nízká: z času pod názvem by koukala půlka
  // písmen. Takový blok má název i čas na jedné řádce.
  check('nic z bloků nevykoukává',
    vsechny.every(b => b.scrollHeight <= b.clientHeight + 1), true);
  check('  hodinovka má čas vedle názvu',
    blok(1, 'Porada').classList.contains('kal-blok-uzky'), true);
  check('  a dlouhá událost pod ním', blok(1, 'OK123').classList.contains('kal-blok-uzky'), false);
  // Ztmavit se nesmí až na černou — barva je to, podle čeho se sloupec pozná
  const cZuzka = rgb(getComputedStyle(blok(2, 'Kadeřník')).color);
  check('  ale text si barvu nechá', cZuzka[0] > cZuzka[2] + 20, true);

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

  R.push('\\n6) Sám se vrátí ke kalendáři');
  // Kdo si na zdi odskočí na Ovládání, nemusí nic vracet. Čeká se na klid: kdyby se
  // odpočet nerestartoval, přepnulo by to stránku někomu pod rukama.
  document.querySelectorAll('#pageTabs .page-tab:not(.page-tab-kal)')[2].click();
  check('odskok na jinou stránku kalendář zavře', panel.hidden, true);
  let odlozeno = null;
  const puvodniTimeout = window.setTimeout;
  window.setTimeout = (fn, ms) => { odlozeno = { fn: fn, ms: ms }; return 0; };
  window.dispatchEvent(new Event('pointerdown'));
  window.setTimeout = puvodniTimeout;
  check('dotek nastartuje odpočet', odlozeno && odlozeno.ms, 5 * 60 * 1000);
  odlozeno.fn();
  check('  a po pěti minutách klidu je kalendář zpátky', panel.hidden, false);
  // Otočený iPad je úzký displej. Odpočet mohl naskočit ještě na šířku, přepnout
  // se ale nesmí — na výšku je denní pohled schovaný a zbyla by prázdná obrazovka.
  document.querySelectorAll('#pageTabs .page-tab:not(.page-tab-kal)')[2].click();
  window.setTimeout = (fn, ms) => { odlozeno = { fn: fn, ms: ms }; return 0; };
  window.dispatchEvent(new Event('pointerdown'));
  window.setTimeout = puvodniTimeout;
  const puvodniMM = window.matchMedia;
  window.matchMedia = () => ({ matches: false });
  odlozeno.fn();
  window.matchMedia = puvodniMM;
  check('na úzkém displeji se nepřepne', panel.hidden, true);

  R.push('\\n7) Listování prstem');
  // Dny leží pomyslně vpravo od pásu stránek: tah doleva jde na zítřek, tah doprava
  // na včerejšek — a z dneška, kde žádný předchozí den není, se stejným tahem vyjde
  // zpátky do appky. Bez toho by se z kalendáře dalo ven jen přes lištu.
  zalozka.click();
  renderKalendar({ enabled: true, dnu: 7, days: dd, kalendare: KAL,
                   fetchedAt: new Date().toISOString(), error: null });
  const nazev = () => document.getElementById('kalDenNazev').textContent;
  const tah = (dx, dy) => {
    panel.dispatchEvent(new PointerEvent('pointerdown', { clientX: 600, clientY: 400, bubbles: true }));
    panel.dispatchEvent(new PointerEvent('pointerup',
      { clientX: 600 + dx, clientY: 400 + (dy || 0), bubbles: true }));
  };
  check('začínáme na dnešku', /^Dnes /.test(nazev()), true);
  tah(-200);
  check('tah doleva ukáže zítřek', /^Zítra /.test(nazev()), true);
  tah(-200);
  check('  a další tah pozítří', /^Dnes |^Zítra /.test(nazev()), false);
  tah(200); tah(200);
  check('tah doprava se vrací', /^Dnes /.test(nazev()), true);
  // Klepnutí ani rolování prstem nahoru nesmí listovat
  tah(-20);
  check('krátký tah je klepnutí, ne listování', /^Dnes /.test(nazev()), true);
  tah(-200, 400);
  check('  a svislý tah je rolování', /^Dnes /.test(nazev()), true);
  // Poslední tah doprava už nemá kam v kalendáři jít — vede zpátky do appky
  tah(200);
  check('z dneška doprava se vyjde na stránky', panel.hidden, true);
  check('  a pás stránek je zpátky', document.getElementById('sliderWrap').style.display, '');

  R.push('\\n8) Slide animace');
  // Na zdi se mezi včerejškem a zítřkem jinak nepozná, že se vůbec něco stalo.
  // Nový den přijíždí z té strany, odkud jde — a panel zprava, kde v liště leží.
  zalozka.click();
  check('panel přijíždí zprava', panel.classList.contains('kal-panel-prichod'), true);
  check('  a animace opravdu běží', getComputedStyle(panel).animationName, 'kal-zprava');
  renderKalendar({ enabled: true, dnu: 7, days: dd, kalendare: KAL,
                   fetchedAt: new Date().toISOString(), error: null });
  const mrizka = document.getElementById('kalMrizka');
  document.getElementById('kalNext').click();
  check('další den přijíždí zprava', getComputedStyle(mrizka).animationName, 'kal-zprava');
  document.getElementById('kalPrev').click();
  check('  a předchozí zleva', getComputedStyle(mrizka).animationName, 'kal-zleva');
  // Obě třídy naráz by znamenaly, že se ta stará neuklidila a druhý přesun neanimuje
  check('  jen jedna třída naráz', mrizka.classList.contains('kal-den-dopredu'), false);
  tah(-200);
  check('prstem stejně jako šipkou', getComputedStyle(mrizka).animationName, 'kal-zprava');
  // Na kraji týdne se nikam nepřesouvá, tak se nemá ani animovat
  for (let i = 0; i < 6; i++) tah(-200);
  check('  (jsme na konci týdne)', /^Dnes |^Zítra /.test(nazev()), false);
  mrizka.classList.remove('kal-den-dopredu', 'kal-den-zpet');
  tah(-200);
  check('na kraji týdne se neanimuje', getComputedStyle(mrizka).animationName, 'none');
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
