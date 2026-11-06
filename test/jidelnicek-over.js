// Kontrola jídelníčku, kterou si úloha pustí před odesláním (jidelnicek/over.js)
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('jídelníček — kontrola');
const { zkontroluj } = require('../jidelnicek/over');
const VZOR = require('./data/jidelnicek-vzor.json');
const kopie = () => JSON.parse(JSON.stringify(VZOR));
const chyby = (p, h, z) => zkontroluj(p, h, z).chyby;
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
  const dve = kopie();
  dve.recepty.push({ ...JSON.parse(JSON.stringify(najdi(dve, 'Tvarohová miska s jablkem'))), nazev: 'Druhá tvarohová miska' });
  check('pracovní snídaně jen jedna', chyby(dve).some(c => c.startsWith('snidane/pracovni_snidane: má být 1, je 2')), true);
  const pon = kopie(); pon.tyden = '2026-11-03';
  check('týden musí začínat pondělím', chyby(pon).includes('tyden 2026-11-03 není pondělí.'), true);
}

nadpis('Náhradní jídla');
{
  const p = kopie();
  p.recepty = p.recepty.filter(r => !(r.nahradni && r.kategorie === 'peceni'));
  check('chybí náhradní pečení', chyby(p).includes('Náhradní pečení: má být 1, je 0.'), true);
  const q = kopie();
  q.recepty.find(r => r.nahradni && r.kategorie === 'vecere').stitky.push('ryba');
  check('ryba v náhradním se do týdne nepočítá', chyby(q).join(), '');
  const m = kopie();
  m.recepty.filter(r => r.nahradni).forEach(r => { r.stitky.push('maso'); });
  check('  ani maso', chyby(m).some(c => c.startsWith('Hlavní jídla s masem')), false);
  const n = kopie();
  n.nakup.push({ kategorie: 'Ovoce', nazev: 'Hrušky', mnozstvi: 500, jednotka: 'g' });
  check('suroviny náhradního do nákupu nepatří', chyby(n).includes('Nákup: hrusky není v žádném receptu.'), true);
  const k = kopie();
  delete k.recepty.find(r => r.nahradni).suroviny[0].kategorie;
  check('surovina bez kategorie', chyby(k).some(c => c.includes('bez platné kategorie')), true);
  const d = kopie();
  d.recepty.find(r => r.nahradni).nazev = d.recepty[0].nazev;
  check('náhradní nesmí opakovat aktivní', chyby(d).includes('Některé jídlo je v jídelníčku dvakrát (i mezi náhradními).'), true);
}

nadpis('Ryba jednou za 14 dní');
check('minulý týden ryba → teď ne', chyby(kopie(), [{ tyden: '2026-10-26', ryba: true, nazvy: [] }]).includes('Ryba byla minulý týden — tento týden žádná.'), true);
{
  const p = kopie();
  najdi(p, 'Losos s bramborami').stitky = ['brambory'];
  check('minulý týden bez ryby → teď jedna', chyby(p, [{ tyden: '2026-10-26', ryba: false, nazvy: [] }]).some(c => c.startsWith('Minulý týden ryba nebyla')), true);
}
check('jídlo z minulého týdne se opakovat nesmí', chyby(kopie(), [{ tyden: '2026-10-26', ryba: false, nazvy: ['Švestková buchta'] }])
  .includes('Švestková buchta: bylo minulý týden — vyber jiné.'), true);
check('  starší týdny nevadí', chyby(kopie(), [{ tyden: '2026-10-26', ryba: false, nazvy: [] }, { tyden: '2026-10-19', ryba: false, nazvy: ['Švestková buchta'] }])
  .some(c => c.includes('Švestková buchta')), false);
{
  const t = kopie();
  najdi(t, 'Hovězí s rýží a mrkví').nazev = 'Hovězí tacos';
  check('dvě podobná jídla s tortillou (2× tacos) → chyba', chyby(t).some(c => c.startsWith('Podobná jídla s tortillou')), true);
  const r = kopie();
  const prac = r.recepty.filter(x => x.typ === 'pracovni');
  prac[0].nazev = 'Houbové rizoto'; prac[1].nazev = 'Dýňové rizoto';
  check('dvě rizota → chyba', chyby(r).some(c => c.startsWith('Podobná jídla (rizoto)')), true);
  const bv = kopie();
  const b = bv.recepty.find(x => x.typ === 'bez_vareni');
  b.postup = ['Těstoviny uvaříme a necháme vychladnout.'];
  check('bez vaření s vařením → chyba', chyby(bv).some(c => c.includes('nesmí nic vařit')), true);
  b.postup = ['Pečivo namažeme pomazánkou.'];
  check('  pečivo vařením není', chyby(bv).some(c => c.includes('nesmí nic vařit')), false);
  b.vlastni = false; b.zdroj = { web: 'Jiný', url: 'https://www.jiny-web.cz/pomazanka' };
  check('bez vaření smí mít odkaz odjinud', chyby(bv).some(c => c.includes(b.nazev + ': odkaz')), false);
  const u = kopie();
  u.upozorneni = ['a', 'b', 'c', 'd'];
  check('upozornění nejvýš 3', chyby(u).some(c => c.startsWith('Upozornění nejvýš 3')), true);
  u.upozorneni = ['x'.repeat(101)];
  check('  a krátká', chyby(u).some(c => c.startsWith('Upozornění je dlouhé')), true);
}

check('jídlo, které zůstává z minula, se nesmí opakovat', chyby(kopie(), [], ['Švestková buchta']).includes('Švestková buchta: v jídelníčku už zůstává z minula — vyber jiné.'), true);

nadpis('Zdroje');
{
  const p = kopie();
  najdi(p, 'Švestková buchta').zdroj.url = 'https://www.toprecepty.cz/recept/1/';
  check('cizí web neprojde', chyby(p).some(c => c.startsWith('Švestková buchta: odkaz musí vést')), true);
}

nadpis('Nákup = součet receptů');
{
  const p = kopie();
  najdi(p, 'Kuřecí tortilly se zeleninou').suroviny.push({ nazev: 'Sůl', mnozstvi: null, jednotka: '' }, { nazev: 'Pepř', mnozstvi: 1, jednotka: 'špetka' });
  check('sůl a pepř v receptu nevadí (bez množství, mimo součet)', chyby(p).join(), '');
  p.nakup.push({ kategorie: 'Dochucovadla a ostatní', nazev: 'Sůl', mnozstvi: 5, jednotka: 'g' });
  check('  v nákupu chyba', chyby(p).includes('Nákup: Sůl je vždy doma — vyřaď.'), true);
  const m = kopie();
  najdi(m, 'Tofu s červenou čočkou a dýní').zdroj.url = 'http://www.maruskaveg.com/2024/10/tofu.html';
  check('MaruškaVeg přes http', chyby(m).join(), '');
}
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
