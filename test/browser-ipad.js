// Rozložení na širokém displeji (iPad na zeď, na šířku): tři stránky vedle sebe.
//
// OKNO: 1180,820
// Ten řádek výš čte spouštěč: sada MUSÍ běžet ve velkém okně. V úzkém by prošla
// i appka bez jediného @media dotazu, takže by neřekla vůbec nic.
//
// Past téhle změny: stránkování se počítalo jako scrollLeft / šířka okna. Jakmile
// jsou stránky tři, přestane to platit — lišta by skákala po trojicích a klik na
// záložku by odroloval třikrát dál. Proto se všude počítá se šířkou JEDNÉ stránky.
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
  const wrap = document.getElementById('sliderWrap');
  // Na širokém displeji je po startu vidět kalendář (iPad visí na zdi). Tahle sada
  // je o pásu stránek, takže se na něj napřed přepne — klikem na záložku, jako uživatel.
  document.querySelector('#pageTabs .page-tab:not(.page-tab-kal)').click();
  const slides = [...wrap.querySelectorAll('.slide')];
  const sirka = slides[0].getBoundingClientRect().width;
  const okno = wrap.clientWidth;

  R.push('1) Tři stránky vedle sebe');
  check('okno je široké', okno > 1000, true);
  check('stránka je třetina okna', Math.round(okno / sirka), 3);
  // Karty se nepředělávaly — sloupec zůstal široký jako telefon
  const page = slides[0].querySelector('.page');
  check('sloupec má pořád šířku telefonu', Math.round(page.getBoundingClientRect().width), 340);
  check('  a vejde se do stránky', page.getBoundingClientRect().width <= sirka, true);
  check('nic nepřetéká do stran', document.body.scrollWidth <= window.innerWidth + 1, true);

  R.push('\\n2) Počítání stránek');
  check('šířka stránky se bere z DOM', Math.round(sirkaStranky()), Math.round(sirka));
  check('  ne z šířky okna', Math.round(sirkaStranky()) === Math.round(okno), false);
  check('vidět jsou tři', viditelnychStranek(), 3);

  R.push('\\n3) Lišta záložek');
  const tabs = [...document.querySelectorAll('#pageTabs .page-tab:not(.page-tab-kal)')];
  check('záložek je tolik co stránek', tabs.length, slides.length);
  // Kalendář je záložka navíc: není to stránka v pásu, přepíná celou obrazovku
  check('kalendář má vlastní záložku', !!document.querySelector('.page-tab-kal'), true);
  wrap.scrollLeft = 0;
  updateDots();
  // Kdyby svítila jen jedna, zbylé dvě viditelné stránky by vypadaly jako zavřené
  check('na začátku svítí první tři', tabs.map(t => t.classList.contains('active')).slice(0, 4).join(','),
    'true,true,true,false');
  wrap.scrollLeft = 3 * sirka;
  updateDots();
  check('po posunu o tři svítí čtvrtá až šestá',
    tabs.map((t, i) => t.classList.contains('active') ? i : null).filter(i => i !== null).join(','), '3,4,5');

  R.push('\\n4) Klik na záložku');
  // Dřív se rolovalo na i * šířku okna — na šířku tří stránek by to ujelo třikrát dál
  let kam = null;
  const puvodni = wrap.scrollTo;
  wrap.scrollTo = o => { kam = o.left; };
  tabs[4].click();
  // Kliknutá stránka je ta prostřední ze tří: vlevo od ní čtvrtá
  check('pátá stránka skončí uprostřed', Math.round(kam), Math.round(3 * sirka));
  check('  a ne třikrát dál', Math.round(kam) === Math.round(3 * okno), false);
  tabs[0].click();
  check('první zůstane vlevo (před ní nic není)', Math.round(kam), 0);
  tabs[1].click();
  check('druhá je uprostřed', Math.round(kam), 0);
  tabs[tabs.length - 1].click();
  check('poslední zůstane vpravo', Math.round(kam), Math.round((tabs.length - 3) * sirka));
  wrap.scrollTo = puvodni;

  R.push('\\n5) Lišta pod stavovým řádkem');
  // Záložky nesmí sahat na horní hranu: iOS na ně tam nasadí „scroll edge" efekt a
  // rozmaže je. Na iPadu se zkoušelo přídavek zkrátit (výřez tam není) — jenže ten
  // rozmazaný pruh nedrží výřez, ale stavový řádek, a zmizel až u plné hodnoty.
  // Proto tu žádná výjimka pro široký displej NENÍ a hlídá se, že se nevrátí.
  const lista = document.querySelector('.page-tabs-bar');
  check('lišta sedí u horního okraje', Math.round(lista.getBoundingClientRect().top), 0);
  check('přídavek platí i na širokém displeji',
    getComputedStyle(lista).getPropertyValue('--tabs-drop').trim(), '34px');
  // Odsazení je max(8px, safe-area) + přídavek. V prohlížeči bez výřezu z toho vyjde
  // 8 + 34 px — kdyby se odsazení přebilo vlastním číslem nebo nulou, sedělo by tu jiné.
  check('  a odsazení pod stavový řádek drží',
    parseFloat(getComputedStyle(lista).paddingTop), 42);
  check('  a záložky jsou pod ním vidět',
    document.querySelector('.page-tab').getBoundingClientRect().top >= 30, true);

  R.push('\\n6) Svislé rolování zůstalo v sloupci');
  check('stránka roluje svisle sama', getComputedStyle(slides[0]).overflowY, 'auto');
  check('  a pás jen vodorovně', getComputedStyle(wrap).overflowY, 'hidden');
  check('přichytává se po stránkách', getComputedStyle(slides[0]).scrollSnapAlign, 'start');
  R.push('\\n7) Když běží sauna, je výchozí Sauna uprostřed');
  // Plynulé rolování headless nedojede — posun se provede hned
  const plynule = wrap.scrollTo;
  wrap.scrollTo = o => { wrap.scrollLeft = o.left; };
  const viditelne = () => [...wrap.querySelectorAll('.slide:not([hidden])')];
  const iSauna = viditelne().indexOf(document.getElementById('saunaSlide'));
  const prvni = () => Math.round(wrap.scrollLeft / sirkaStranky());
  kalOtevri(true);
  ipadDotekAt = 0;
  saunaTopilaAt = 0; saunaZapnutoData = null;
  huumData = { enabled: true, statusCode: 231, heating: true, temperature: 60, targetTemperature: 80,
               fetchedAt: new Date().toISOString() };
  renderHuum();
  check('rozjetá sauna zavře kalendář', document.getElementById('kalPanel').hidden, true);
  check('  a Sauna je prostřední ze tří', prvni() + 1, iSauna);
  // Kdo na iPad sahá, tomu se nic nepřepíná
  kalOtevri(true);
  ipadDotekAt = Date.now();
  renderHuum();
  check('pod rukama se nepřepíná', document.getElementById('kalPanel').hidden, false);
  ipadDotekAt = 0;
  // Dotopeno: 29 min po posledním topení pořád sauna, po 31 min kalendář
  huumData = { ...huumData, heating: false, statusCode: 232, fetchedAt: new Date().toISOString() };
  saunaTopilaAt = Date.now() - 29 * 60000;
  renderHuum();
  check('29 min po topení pořád Sauna', document.getElementById('kalPanel').hidden + ',' + (prvni() + 1), 'true,' + iSauna);
  saunaTopilaAt = Date.now() - 31 * 60000;
  ipadKontrola();
  check('po 31 min zase kalendář', document.getElementById('kalPanel').hidden, false);
  // Po otevření appky se čas posledního topení vezme ze serveru
  kalOtevri(true);
  saunaTopilaAt = 0;
  saunaZapnutoData = { od: Date.now() - 60 * 60000, naposledy: Date.now() - 10 * 60000 };
  ipadKontrola();
  check('poslední topení ze serveru (před 10 min) → Sauna', document.getElementById('kalPanel').hidden, true);
  saunaZapnutoData = null;
  ipadKontrola();
  check('  bez něj kalendář', document.getElementById('kalPanel').hidden, false);
  wrap.scrollTo = plynule;

  R.push('\\n8) Zvoneček je na iPadu 2× větší');
  const zv = document.getElementById('pripZalozka');
  check('na iPadu 2× větší než na telefonu (28,8 px)', getComputedStyle(zv).fontSize, '28.8px');

  R.push('\\n9) Zvoneček jde odtáhnout');
  try { localStorage.removeItem('pripZvonekPozice'); } catch {}
  // Pes nakrmený, ať je ve skupině jen zvoneček (psy testuje browser-pripominky)
  pripData = { kytky: { hotovo: 0 }, pesRano: { hotovo: Date.now() }, pesVecer: { hotovo: Date.now() } };
  kalOtevri(false); wrap.scrollLeft = 0; updateDots(); renderPripominky();
  check('zvoneček je vidět', zv.hidden, false);
  let otevreno = 0;
  const kamSrolovat = wrap.scrollTo;
  wrap.scrollTo = () => { otevreno++; };
  const r0 = zv.getBoundingClientRect();
  const ptr = (typ, x, y) => zv.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 5, clientX: x, clientY: y }));
  ptr('pointerdown', r0.left + 10, r0.top + 10);
  ptr('pointermove', r0.left + 60, r0.top + 210);
  ptr('pointermove', r0.left + 510, r0.top + 410);
  ptr('pointerup', r0.left + 510, r0.top + 410);
  zv.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  const r1 = zv.getBoundingClientRect();
  check('posune se s prstem', Math.round(r1.left - r0.left) + ',' + Math.round(r1.top - r0.top), '500,400');
  check('  a tažení Připomínky neotevře', otevreno, 0);
  let ulozeno = null;
  try { ulozeno = JSON.parse(localStorage.getItem('pripZvonekPozice')); } catch {}
  check('  poloha se zapamatuje', !!ulozeno && Math.round(ulozeno.x * innerWidth) === Math.round(r1.left), true);
  renderPripominky();
  check('překreslení ji nevrátí pod lištu', Math.round(zv.getBoundingClientRect().top), Math.round(r1.top));
  // Malý pohyb prstu je pořád klepnutí
  ptr('pointerdown', r1.left + 10, r1.top + 10);
  ptr('pointermove', r1.left + 13, r1.top + 12);
  ptr('pointerup', r1.left + 13, r1.top + 12);
  zv.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  check('klepnutí Připomínky otevře', otevreno, 1);
  // Po otevření se zvoneček schová, takže se měří jeho nastavená poloha
  // Poloha patří celé plovoucí skupině se zvonečkem a záložkami psa
  const skupina = document.getElementById('pripPlovouci');
  check('  a zvoneček se nehne', skupina.style.left, Math.round(r1.left) + 'px');
  zv.hidden = false;
  // Ven z okna se odtáhnout nedá
  ptr('pointerdown', r1.left + 10, r1.top + 10);
  ptr('pointermove', r1.left + 5000, r1.top + 5000);
  ptr('pointerup', r1.left + 5000, r1.top + 5000);
  const r2 = zv.getBoundingClientRect();
  check('za okraj okna neuteče', r2.right <= innerWidth + 1 && r2.bottom <= innerHeight + 1, true);
  wrap.scrollTo = kamSrolovat;
  try { localStorage.removeItem('pripZvonekPozice'); } catch {}
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (iPad)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'ipad.html');
fs.writeFileSync(out, v);
console.log(out);
