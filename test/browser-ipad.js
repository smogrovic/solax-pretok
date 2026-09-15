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
  wrap.scrollTo = puvodni;
  check('roluje na pátou stránku', Math.round(kam), Math.round(4 * sirka));
  check('  a ne třikrát dál', Math.round(kam) === Math.round(4 * okno), false);

  R.push('\\n5) Lišta nahoře, ale pod stavovým řádkem');
  // Na iPadu není výřez, takže těch 30 px navíc je jen ztracená výška. Stavový řádek
  // s hodinami a baterií ale iPad má a appku překrývá — odsazení pod něj musí zůstat,
  // jinak se lišta schová pod hodiny. (V testovacím prohlížeči je safe-area nulová,
  // takže se tu měří to, co jde: že zmizel jen ten přídavek.)
  const lista = document.querySelector('.page-tabs-bar');
  check('lišta sedí u horního okraje', Math.round(lista.getBoundingClientRect().top), 0);
  // Z původních 30 px zbyla půlka řádku se záložkami — lišta se nemá lepit těsně
  // pod hodiny, ale ani pod nimi mizet.
  check('přídavek pod výřez je jen půlka řádku',
    getComputedStyle(lista).getPropertyValue('--tabs-drop').trim(), '9px');
  // Odsazení je max(8px, safe-area) + přídavek. V prohlížeči bez výřezu z toho vyjde
  // 8 + 9 px — kdyby se odsazení přebilo vlastním číslem nebo nulou, sedělo by tu jiné.
  check('  a odsazení pod stavový řádek zůstalo',
    parseFloat(getComputedStyle(lista).paddingTop), 17);
  check('  a záložky jsou pod ním vidět',
    document.querySelector('.page-tab').getBoundingClientRect().top >= 8, true);

  R.push('\\n6) Svislé rolování zůstalo v sloupci');
  check('stránka roluje svisle sama', getComputedStyle(slides[0]).overflowY, 'auto');
  check('  a pás jen vodorovně', getComputedStyle(wrap).overflowY, 'hidden');
  check('přichytává se po stránkách', getComputedStyle(slides[0]).scrollSnapAlign, 'start');
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
