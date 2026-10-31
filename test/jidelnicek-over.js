// Kontrola jídelníčku, kterou si úloha pustí před odesláním (jidelnicek/over.js)
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('jídelníček — kontrola');
const { zkontroluj } = require('../jidelnicek/over');
const VZOR = require('./data/jidelnicek-vzor.json');
const kopie = () => JSON.parse(JSON.stringify(VZOR));
const chyby = (p, h) => zkontroluj(p, h).chyby;
const najdi = (p, nazev) => p.recepty.find(r => r.nazev === nazev);

nadpis('Vzor projde');
check('vzor bez chyb', chyby(kopie()).join(' | '), '');

nadpis('Skladba týdne');
{
  const p = kopie();
  najdi(p, 'Tofu s červenou čočkou a dýní').stitky = [];
  check('chybí veganské', chyby(p).includes('Chybí plně veganské hlavní jídlo.'), true);
  const q = kopie();
  najdi(q, 'Zapečené těstoviny s mozzarellou').stitky.push('maso');
  check('3× maso', chyby(q).includes('Hlavní jídla s masem: mají být přesně 2, jsou 3.'), true);
  const m1 = kopie();
  najdi(m1, 'Kuřecí tortilly se zeleninou').stitky = ['tortilla'];
  check('jen 1× maso', chyby(m1).includes('Hlavní jídla s masem: mají být přesně 2, jsou 1.'), true);
  const r = kopie();
  r.recepty = r.recepty.filter(x => x.typ !== 'peceni');
  check('chybí pečení', chyby(r).some(c => c.startsWith('peceni/peceni: má být 1, je 0')), true);
  const t = kopie();
  najdi(t, 'Kuřecí tortilly se zeleninou').stitky = ['maso'];
  check('chybí tortilly', chyby(t).includes('Chybí jídlo s tortillami.'), true);
  const b = kopie();
  najdi(b, 'Hovězí s rýží a mrkví').stitky.push('brambory');
  check('brambory 2×', chyby(b).includes('Brambory nejvýš 1× týdně, jsou 2×.'), true);
  const v = kopie();
  najdi(v, 'Tvarohová miska s jablkem').suroviny.push({ nazev: 'Vejce', mnozstvi: 2, jednotka: 'ks' });
  check('pracovní snídaně s vejci', chyby(v).some(c => c.includes('pracovní snídaně je bez vajec')), true);
  const pon = kopie(); pon.tyden = '2026-11-03';
  check('týden musí začínat pondělím', chyby(pon).includes('tyden 2026-11-03 není pondělí.'), true);
}

nadpis('Ryba jednou za 14 dní');
check('minulý týden ryba → teď ne', chyby(kopie(), [{ tyden: '2026-10-26', ryba: true, nazvy: [] }]).includes('Ryba byla minulý týden — tento týden žádná.'), true);
{
  const p = kopie();
  najdi(p, 'Losos s bramborami').stitky = ['brambory'];
  check('minulý týden bez ryby → teď jedna', chyby(p, [{ tyden: '2026-10-26', ryba: false, nazvy: [] }]).some(c => c.startsWith('Minulý týden ryba nebyla')), true);
}
check('opakování z historie je upozornění', zkontroluj(kopie(), [{ tyden: '2026-10-19', ryba: false, nazvy: ['Švestková buchta'] }]).varovani
  .includes('Švestková buchta: bylo v některém z minulých týdnů.'), true);

nadpis('Zdroje');
{
  const p = kopie();
  najdi(p, 'Švestková buchta').zdroj.url = 'https://www.toprecepty.cz/recept/1/';
  check('cizí web neprojde', chyby(p).some(c => c.startsWith('Švestková buchta: odkaz musí vést')), true);
}

nadpis('Nákup = součet receptů');
{
  const p = kopie();
  p.nakup = p.nakup.filter(n => n.nazev !== 'Mozzarella');
  check('chybějící surovina', chyby(p).includes('Nákup: chybí mozzarella (250 g).'), true);
  const q = kopie();
  q.nakup.find(n => n.nazev === 'Paprika').mnozstvi = 4;
  check('špatný součet (paprika 2 + 1)', chyby(q).includes('Nákup: paprika má být 3 ks, je 4.'), true);
  const r = kopie();
  r.nakup.push({ kategorie: 'Ovoce', nazev: 'Banány', mnozstvi: 6, jednotka: 'ks' });
  check('navíc položka, která není v receptu', chyby(r).includes('Nákup: banany není v žádném receptu.'), true);
  const s = kopie();
  const br = s.nakup.find(n => n.nazev === 'Brambory');
  br.mnozstvi = 1000; br.jednotka = 'g';
  check('kg a g se převádí', chyby(s).join(), '');
}
konec();
