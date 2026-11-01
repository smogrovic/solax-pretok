// Jídelníček na stránce Nákup: karta s recepty, značky víme/nevíme u seznamu,
// průvodce košíkem krok po kroku a tisková verze.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.slide{display:none!important}.slide[data-title="Recepty/Nákup"]{display:block!important}</style></head>');
const VZOR = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'jidelnicek-vzor.json'), 'utf8'));
VZOR.vytvoreno = Date.UTC(2026, 9, 30, 5, 0);
VZOR.kontrola.push({ bod: 'Obsahuje veganské jídlo 25–30 g bílkovin na porci?', ok: false, poznamka: 'má 24 g' });

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
const VZOR = ${JSON.stringify(VZOR)};
let dotazy = [];
let odpoved = () => ({ ok: true });
window.fetch = async (url, init) => {
  const telo = init && init.body ? JSON.parse(init.body) : null;
  dotazy.push({ url, telo });
  const d = odpoved(url, telo);
  return { ok: !d.error, status: d.error ? 400 : 200, json: async () => d };
};
const pockej = ms => new Promise(r => setTimeout(r, ms));
const vidi = el => !!el && el.getClientRects().length > 0;
setTimeout(async () => {
 try {
  R.push('1) Karta jídelníčku');
  const karta = document.getElementById('jidKarta');
  jidelnicekData = null; renderJidelnicek();
  check('bez jídelníčku skrytá', karta.hidden, true);
  jidelnicekData = VZOR; renderJidelnicek();
  check('s jídelníčkem vidět', vidi(karta), true);
  check('sekce bez dnů v týdnu', [...karta.querySelectorAll('.jid-sekce')].map(e => e.textContent).join(','), 'Večeře,Pečení,Snídaně');
  check('deset receptů', karta.querySelectorAll('details.jid-recept').length, 10);
  check('nesplněný bod kontroly je vidět', karta.querySelector('.jid-pozor').textContent.includes('Nesplněno: Obsahuje veganské jídlo'), true);
  check('  žlutý box až pod jídly', karta.querySelector('#jidObsah').lastElementChild.classList.contains('jid-pozor'), true);
  const prvni = karta.querySelector('details.jid-recept');
  check('  zavřený na začátku', prvni.open, false);
  prvni.open = true;
  check('  telefon: rozbalí se v kartě, žádné okno', document.getElementById('jidReceptOkno').hidden, true);
  const a = prvni.querySelector('a.jid-zdroj');
  check('odkaz na recept do nové karty', a.href === VZOR.recepty[0].zdroj.url && a.target === '_blank', true);
  check('  suroviny s množstvím', prvni.querySelector('.jid-suroviny li').textContent, '600 g Kuřecí prsa');
  check('výživa pod názvem malým písmem', prvni.querySelector('.jid-makra').textContent, '550 kcal · B: 35 g · S: 50 g · T: 20 g');
  check('  výživa orientačně', [...prvni.querySelectorAll('.jid-meta')].some(e => /orientačně/.test(e.textContent)), true);
  const vlastni = [...karta.querySelectorAll('details.jid-recept')].find(d => d.textContent.includes('Cottage pomazánka'));
  jidelnicekData = { ...VZOR, recepty: [...VZOR.recepty, { ...VZOR.recepty[3], nazev: 'Zbylé jídlo', zMinula: '2026-10-26' }] }; renderJidelnicek();
  check('převedené jídlo: z minulého týdne', [...karta.querySelectorAll('details.jid-recept')].find(d => d.textContent.includes('Zbylé jídlo')).querySelector('.jid-typ').textContent, 'pracovní večeře · z minulého týdne');
  jidelnicekData = VZOR; renderJidelnicek();
  check('vlastní recept označený', vlastni.querySelector('.jid-zdroj').textContent, 'Vlastní recept');

  R.push('\\n1b) Výběr před nákupem');
  jidelnicekData = { ...JSON.parse(JSON.stringify(VZOR)), nakupPotvrzeno: false }; renderJidelnicek();
  check('nápověda nahoře', karta.querySelector('#jidObsah').firstElementChild.classList.contains('jid-napoveda'), true);
  check('✕ u aktivních (10), náhradní sekce se 4', karta.querySelectorAll('.jid-smazat').length + ' ' + karta.querySelectorAll('details.nahradni').length, '10 4');
  check('  náhradní dole, šedé, s Aktivovat', [...karta.querySelectorAll('.jid-sekce')].pop().textContent + ' ' + getComputedStyle(karta.querySelector('details.nahradni .jid-hlava')).opacity + ' ' + karta.querySelectorAll('.jid-aktivovat').length, 'Náhradní jídla 0.5 4');
  check('  náhradní bez odškrtávání', karta.querySelector('details.nahradni .nakup-odskrt'), null);
  check('tlačítko na seznam', karta.querySelector('.jid-potvrdit').textContent, '🛒 Přidat na nákupní seznam (10 jídel)');
  dotazy = [];
  odpoved = (url, telo) => url === '/api/jidelnicek/recept' ? { ok: true } : url === '/api/jidelnicek/potvrdit' ? { ok: true, polozek: 25, jidelnicek: { ...VZOR, recepty: VZOR.recepty.filter(r => !r.nahradni), nakupPotvrzeno: true } } : { ok: true };
  karta.querySelector('details.nahradni .jid-aktivovat').click();
  await pockej(30);
  check('Aktivovat pošle akci s názvem', JSON.stringify(dotazy[0] && dotazy[0].telo), JSON.stringify({ index: 10, nazev: 'Krůtí rizoto s hráškem', akce: 'aktivovat' }));
  karta.querySelector('.jid-smazat').click();
  await pockej(30);
  check('✕ se nejdřív zeptá', !document.getElementById('potvrzOkno') || !document.getElementById('potvrzOkno').hidden, true);
  potvrzKonec(true);
  await pockej(30);
  check('  po potvrzení smaže', JSON.stringify(dotazy[1] && dotazy[1].telo), JSON.stringify({ index: 0, nazev: VZOR.recepty[0].nazev, akce: 'smazat' }));
  karta.querySelector('.jid-potvrdit').click();
  await pockej(30);
  check('Přidat na nákupní seznam', dotazy[2] && dotazy[2].url + ' ' + document.getElementById('jidZprava').textContent, '/api/jidelnicek/potvrdit Na nákupní seznam přidáno 25 položek.');
  check('  potom bez ✕, náhradních a tlačítka', karta.querySelectorAll('.jid-smazat, details.nahradni, .jid-potvrdit, .jid-napoveda').length, 0);
  jidelnicekData = VZOR; renderJidelnicek();

  R.push('\\n2) Seznam: kategorie, množství, víme/nevíme');
  nakupData = [
    { id: 'n_ruc00001', text: 'Toaletní papír', t: 1 },
    { id: 'n_jid00001', text: 'Tvaroh 500 g', t: 2, nazev: 'Tvaroh', mnozstvi: '500 g', kategorie: 'Mléčné výrobky a sýry', zdroj: 'jidelnicek' },
    { id: 'n_jid00002', text: 'Kuřecí prsa 600 g', t: 3, nazev: 'Kuřecí prsa', mnozstvi: '600 g', kategorie: 'Maso, ryby, tofu a další bílkoviny', zdroj: 'jidelnicek' },
    { id: 'n_jid00003', text: 'Mozzarella 250 g', t: 4, nazev: 'Mozzarella', mnozstvi: '250 g', kategorie: 'Mléčné výrobky a sýry', zdroj: 'jidelnicek' }
  ];
  rohlikData = { enabled: true, prihlaseno: true };
  rohlikZname = null;
  odpoved = (url, telo) => {
    if (url === '/api/rohlik/vyber') return { ok: true, vyber: { mozzarella: { productId: 11, nazev: 'Galbani Mozzarella 125 g', cena: 29.9 } } };
    if (url.startsWith('/api/rohlik/hledat')) {
      const q = decodeURIComponent(url.split('q=')[1]);
      return { ok: true, vyrobky: [{ productId: q.length * 100 + 1, nazev: q + ' A', cena: 10 }, { productId: q.length * 100 + 2, nazev: q + ' B', cena: 20 }] };
    }
    if (url === '/api/rohlik/kosik') return { ok: true, pridano: telo.polozky.length, nakup: nakupData.map(p => telo.polozky.some(x => x.nakupId === p.id) ? { ...p, kosik: 1 } : p) };
    return { ok: true };
  };
  renderNakup();
  await pockej(60);
  const radky = [...document.querySelectorAll('#nakupSeznam li')];
  check('ruční nahoře, pak kategorie v pořadí promptu', radky.map(li => li.classList.contains('nakup-kat') ? '[' + li.textContent + ']' : li.querySelector('.nakup-text').textContent).join(' | '),
    'Toaletní papír | [Maso, ryby, tofu a další bílkoviny] | Kuřecí prsa | [Mléčné výrobky a sýry] | Tvaroh | Mozzarella');
  const li = id => document.querySelector('#nakupSeznam li[data-id="' + id + '"]');
  check('množství zvlášť', li('n_jid00001').querySelector('.nakup-mnozstvi').textContent, '500 g');
  check('značka víme u zapamatovaného', li('n_jid00003').querySelector('.nakup-znacka').textContent + ' ' + li('n_jid00003').querySelector('.nakup-jiny').textContent, 'víme jiný');
  check('  nevíme u ostatních', li('n_jid00001').querySelector('.nakup-znacka').textContent + ' ' + li('n_jid00001').querySelector('.nakup-jiny').textContent, 'nevíme vybrat');
  check('  i u ručních', li('n_ruc00001').querySelector('.nakup-znacka').textContent, 'nevíme');
  check('  vybraný výrobek v bublině', li('n_jid00003').querySelector('.nakup-znacka').title, 'Galbani Mozzarella 125 g');

  R.push('\\n3) Průvodce krok po kroku');
  const okno = document.getElementById('pruvodceOkno');
  const obsah = document.getElementById('pruvodceObsah');
  const dal = document.getElementById('pruvodceDal'), zpet = document.getElementById('pruvodceZpet');
  dotazy = [];
  document.getElementById('rohlikKrokBtn').click();
  await pockej(80);
  check('okno se otevře', vidi(okno), true);
  check('kroky jen pro neznámé (3 ze 4)', obsah.querySelector('.pruvodce-krok').textContent, '1 / 3');
  check('  první je toaletní papír', obsah.querySelector('.rohlik-nazev').textContent, 'Toaletní papír');
  check('  hledá se podle názvu bez množství', dotazy.filter(d => d.url.startsWith('/api/rohlik/hledat')).map(d => decodeURIComponent(d.url.split('q=')[1])).join(), 'Toaletní papír');
  check('Další až po výběru', dal.disabled, true);
  obsah.querySelectorAll('.rohlik-vyrobek')[1].click();
  check('  po klepnutí na výrobek jde dál', dal.disabled + ' ' + obsah.querySelector('.rohlik-vyrobek.vybrany').textContent.includes('Toaletní papír B'), 'false true');
  obsah.querySelectorAll('.rohlik-mnozstvi button')[1].click();
  check('počet +', obsah.querySelector('.rohlik-pocet').textContent, '2×');
  dal.click(); await pockej(60);
  check('druhý krok: tvaroh s potřebou', obsah.querySelector('.pruvodce-krok').textContent + ' ' + obsah.querySelector('.rohlik-nazev').textContent + ' · ' + obsah.querySelector('.pruvodce-potreba').textContent, '2 / 3 Tvaroh · Potřeba: 500 g');
  obsah.querySelector('.pruvodce-preskocit').click(); await pockej(60);
  check('přeskočit → další krok', obsah.querySelector('.pruvodce-krok').textContent + ' ' + obsah.querySelector('.rohlik-nazev').textContent, '3 / 3 Kuřecí prsa');
  zpet.click(); await pockej(30);
  check('zpět na tvaroh', obsah.querySelector('.rohlik-nazev').textContent, 'Tvaroh');
  zpet.click(); await pockej(30);
  check('  a na první s vybraným výrobkem', obsah.querySelector('.rohlik-vyrobek.vybrany').textContent.includes('Toaletní papír B') + ' ' + obsah.querySelector('.rohlik-pocet').textContent, 'true 2×');
  dal.click(); await pockej(30);
  check('  na přeskočeném tvarohu Další nejde', dal.disabled, true);
  obsah.querySelector('.pruvodce-preskocit').click(); await pockej(30);
  obsah.querySelectorAll('.rohlik-vyrobek')[0].click();
  check('poslední krok vede na souhrn', dal.textContent, 'Souhrn ›');
  dal.click(); await pockej(30);
  check('souhrn: všechny položky', [...obsah.querySelectorAll('.pruvodce-radek')].map(r => r.dataset.id).join(), 'n_ruc00001,n_jid00001,n_jid00002,n_jid00003');
  check('  známá s puntíkem a výrobkem', obsah.querySelector('.pruvodce-radek[data-id="n_jid00003"]').textContent.includes('🟢 Mozzarella · 250 g') && obsah.textContent.includes('Galbani Mozzarella 125 g'), true);
  check('  přeskočená', obsah.querySelector('.pruvodce-radek[data-id="n_jid00001"]').classList.contains('preskoceno'), true);
  check('  cena z Rohlíku sečtená', obsah.querySelector('.pruvodce-soucet').textContent, 'Orientačně 79,90 Kč podle cen na Rohlíku');
  check('  tlačítko počítá', dal.textContent, 'Přidat do košíku (3)');
  dotazy = [];
  dal.click(); await pockej(60);
  const kos = dotazy.find(d => d.url === '/api/rohlik/kosik');
  check('do košíku správné výrobky a počty', JSON.stringify(kos.telo.polozky.map(p => [p.nakupId, p.productId, p.mnozstvi])),
    JSON.stringify([['n_ruc00001', 1402, 2], ['n_jid00002', 1101, 1], ['n_jid00003', 11, 1]]));
  check('  hláška, objednávka se neodesílá', document.getElementById('pruvodceStav').textContent, 'Přidáno 3 položek. Objednávku dokonči v appce Rohlík.');
  check('  zbude jen přeskočený tvaroh', [...obsah.querySelectorAll('.pruvodce-radek')].map(r => r.dataset.id).join(), 'n_jid00001');
  document.getElementById('pruvodceZavrit').click();
  check('zavřít', okno.hidden, true);

  R.push('\\n4) „jiný" u známé položky');
  nakupData = nakupData.map(p => ({ ...p, kosik: undefined }));
  renderNakup(); await pockej(30);
  li('n_jid00003').querySelector('.nakup-jiny').click();
  await pockej(80);
  check('průvodce jen pro mozzarellu', obsah.querySelector('.pruvodce-krok').textContent + ' ' + obsah.querySelector('.rohlik-nazev').textContent, '1 / 1 Mozzarella');
  check('  zapamatovaný předvybraný, nabídka dalších', obsah.querySelector('.rohlik-vyrobek.vybrany').textContent.includes('Galbani') + ' ' + obsah.querySelectorAll('.rohlik-vyrobek').length, 'true 3');
  obsah.querySelectorAll('.rohlik-vyrobek')[2].click();
  dal.click(); await pockej(30);
  check('  souhrn jen s ní', [...obsah.querySelectorAll('.pruvodce-radek')].map(r => r.dataset.id).join() + ' ' + dal.textContent, 'n_jid00003 Přidat do košíku (1)');
  document.getElementById('pruvodceZavrit').click();

  R.push('\\n5) Tisk v okně appky');
  const tOkno = document.getElementById('jidTiskOkno');
  check('okno je přímo v body (tisk schová zbytek)', tOkno.parentElement === document.body, true);
  let otevreno = false;
  window.open = () => { otevreno = true; return null; };
  document.getElementById('jidTiskSeznam').click();
  check('neotevírá novou kartu', otevreno, false);
  check('okno přes celou obrazovku s křížkem', vidi(tOkno) + ' ' + vidi(document.getElementById('jidTiskZavrit')) + ' ' + document.getElementById('jidTiskNadpis').textContent, 'true true Nákupní seznam');
  const papir = document.getElementById('jidTiskPapir');
  check('seznam: políčko u každé položky', papir.querySelectorAll('.box').length, VZOR.nakup.length);
  check('  kategorie jako nadpisy', papir.querySelectorAll('h2')[0].textContent, 'Maso, ryby, tofu a další bílkoviny');
  let sdileno = null;
  navigator.canShare = x => !!(x && x.files);
  navigator.share = async x => { sdileno = x; };
  document.getElementById('jidTiskSdilet').click();
  await pockej(30);
  check('Sdílet pošle soubor', sdileno && sdileno.files[0].name + ' ' + sdileno.files[0].type, 'nakupni-seznam.html text/html');
  // (File.text() v headless režimu s virtuálním časem nedoběhne — stačí velikost)
  check('  soubor má obsah celé stránky', sdileno.files[0].size > document.getElementById('jidTiskPapir').innerHTML.length, true);
  document.getElementById('jidTiskZavrit').click();
  check('✕ zavře', tOkno.hidden + ' ' + vidi(tOkno), 'true false');
  document.getElementById('jidTiskRecepty').click();
  check('recepty: tři sekce, deset receptů', papir.querySelectorAll('h2').length + ' ' + papir.querySelectorAll('h3').length, '3 10');
  check('  s odkazem na web', papir.textContent.includes(VZOR.recepty[0].zdroj.url), true);
  navigator.canShare = () => false;
  navigator.share = async x => { sdileno = x; };
  document.getElementById('jidTiskSdilet').click();
  await pockej(30);
  check('bez souborů sdílí text', sdileno.title + ' | ' + sdileno.text.includes('Švestková buchta'), 'Rodinný jídelníček — týden od 02. 11. 2026 | true');
  document.getElementById('jidTiskZavrit').click();

  R.push('\\n6) Odškrtnutí jídla');
  jidelnicekData = JSON.parse(JSON.stringify(VZOR)); renderJidelnicek();
  dotazy = [];
  odpoved = (url, telo) => url === '/api/jidelnicek/hotovo' ? { ok: true } : { ok: true };
  const det = () => document.querySelector('#jidKarta details.jid-recept[data-index="3"]');
  det().querySelector('.nakup-odskrt').click();
  await pockej(30);
  check('pošle hotovo s indexem', JSON.stringify(dotazy[0].telo), '{"index":3,"hotovo":true}');
  check('  přeškrtnuté, recept se neotevřel', det().classList.contains('hotovo') + ' ' + det().open, 'true false');
  det().querySelector('.nakup-odskrt').click();
  await pockej(30);
  check('vrácení', JSON.stringify(dotazy[1].telo) + ' ' + det().classList.contains('hotovo'), '{"index":3,"hotovo":false} false');
  jidelnicekData.recepty[3].hotovo = Date.now() - 11 * 3600000; renderJidelnicek();
  check('po 11 h ještě vidět', !!det(), true);
  jidelnicekData.recepty[3].hotovo = Date.now() - 13 * 3600000; renderJidelnicek();
  check('po 12 h zmizí', !!det() + ' ' + document.querySelectorAll('#jidKarta details.jid-recept').length, 'false 9');
  jidelnicekData.recepty.filter(r => r.kategorie === 'peceni').forEach(r => { r.hotovo = 1; }); renderJidelnicek();
  check('prázdná sekce se schová', [...document.querySelectorAll('#jidKarta .jid-sekce')].map(e => e.textContent).join(), 'Večeře,Snídaně');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb ? 'SELHALO — ' + chyb + ' chyb' : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (jídelníček)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'jidelnicek.html');
fs.writeFileSync(out, v);
console.log(out);
