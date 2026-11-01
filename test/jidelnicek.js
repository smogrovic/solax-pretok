// Jídelníček z páteční úlohy: příjem v appce, nákupní seznam, historie a záloha
const crypto = require('crypto');
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('jídelníček');
const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const CODE = between('// ---------- Jídelníček na týden ----------', '// ---------- Trvalé úložiště');
const VZOR = require('./data/jidelnicek-vzor.json');
const kopie = () => JSON.parse(JSON.stringify(VZOR));

function build(o = {}) {
  const routy = {}, zpravy = [], logy = [], push = [], ulozeni = [], stazeno = [];
  const state = { nakup: o.nakup || [] };
  const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
  const api = new Function('state', 'app', 'addLog', 'broadcast', 'sendPushToAll', 'safeEqual', 'NAKUP_MAX', 'NAKUP_CELKEM_MAX', 'NAKUP_TEXT_MAX', 'process', 'requireAuth', 'storeUlozBrzy', 'fetch',
    CODE + '\n; return { jidelnicekOver, jidelnicekUloz, jidelnicekMnozstvi, JIDELNICEK_WEBY, jidelnicekFotoZeStranky, jidelnicekFotoUrl, jidelnicekDoplnFotky };')(
    state, { post: (c, f) => { routy['POST ' + c] = f; }, get: (c, f) => { routy['GET ' + c] = f; } },
    t => logy.push(t), (u, d) => zpravy.push(u), async (t, b) => { push.push(t + ' | ' + b); }, safeEqual,
    o.max || 120, 200, 80, { env: o.env || {} }, (req, res) => { if (!o.zamceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    () => { ulozeni.push(1); },
    async url => { stazeno.push(url); if (o.fetch) return o.fetch(url); return { ok: false, status: 404, text: async () => '' }; });
  if (o.vyber) state.rohlikVyber = o.vyber;
  if (o.nauceno) state.rohlikNauceno = o.nauceno;
  const volej = (cesta, body, hlavicky = {}) => {
    let out, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    routy[cesta]({ body, get: k => hlavicky[k] }, res);
    return { out, kod };
  };
  // Import z úlohy a hned „Přidat na nákupní seznam" (bez úprav výběru)
  const vloz = (p, hl) => { const r = volej('POST /api/jidelnicek/import', p, hl); if (r.kod === 200) volej('POST /api/jidelnicek/potvrdit', {}); return r; };
  return { api, state, logy, zpravy, push, volej, ulozeni, stazeno, vloz };
}

nadpis('Příjem');
{
  const h = build({ nakup: [{ id: 'n_ruc00001', text: 'Toaletní papír', t: 1 }] });
  const r = h.volej('POST /api/jidelnicek/import', kopie());
  check('vzor se přijme (10 jídel + 4 náhradní)', r.kod + ' ' + JSON.stringify(r.out), '200 {"ok":true,"receptu":14,"polozek":27}');
  check('  uložen s časem, čeká na výběr', h.state.jidelnicek.tyden + ' ' + (h.state.jidelnicek.vytvoreno > 0) + ' ' + h.state.jidelnicek.nakupPotvrzeno, '2026-11-02 true false');
  check('  na seznam zatím nic', h.state.nakup.length + ' ' + h.zpravy.join(), '1 jidelnicek');
  check('  notifikace', h.push[0], '🍽️ Jídelníček na příští týden | 6 večeří je hotových — vyber jídla a přidej je na nákupní seznam.');
  check('  záloha se uloží hned', h.ulozeni.length, 1);
  check('  log', h.logy[0], 'Jídelníček na týden od 2026-11-02: 10 jídel + 4 náhradních, čeká na výběr');
  const pt = h.volej('POST /api/jidelnicek/potvrdit', {});
  check('přidat na seznam: suroviny 10 jídel', pt.kod + ' ' + pt.out.polozek + ' ' + h.state.jidelnicek.recepty.length + ' ' + h.state.jidelnicek.nakupPotvrzeno, '200 27 10 true');
  check('  appka se dozví', h.zpravy.slice(-2).join(), 'nakup,jidelnicek');
  const moz = h.state.nakup.find(x => x.nazev === 'Mozzarella');
  check('položka na seznamu: název, množství, kategorie', JSON.stringify([moz.text, moz.mnozstvi, moz.kategorie, moz.zdroj]),
    JSON.stringify(['Mozzarella 250 g', '250 g', 'Mléčné výrobky a sýry', 'jidelnicek']));
  check('  mléko 0,5 l s desetinnou čárkou', h.state.nakup.find(x => x.nazev === 'Mléko').text, 'Mléko 0,5 l');
  check('  ruční položka zůstala první', h.state.nakup[0].text + ' ' + h.state.nakup.length, 'Toaletní papír 28');

  // Další týden: staré nekoupené z jídelníčku pryč, odškrtnuté (máme doma) a ruční zůstanou
  h.state.nakup.find(x => x.nazev === 'Cukr').koupeno = Date.now();
  const p2 = kopie(); p2.tyden = '2026-11-09';
  p2.nakup = p2.nakup.filter(n => n.nazev !== 'Mozzarella');
  p2.recepty.forEach(r => { r.suroviny = r.suroviny.filter(s => s.nazev !== 'Mozzarella'); });
  h.vloz(p2);
  check('nový týden nahradí staré položky', h.state.nakup.filter(x => x.nazev === 'Mozzarella').length + ' ' + h.state.nakup.filter(x => x.zdroj === 'jidelnicek' && !x.koupeno).length, '0 26');
  check('  odškrtnuté a ruční zůstanou', h.state.nakup.filter(x => x.koupeno).length + ' ' + h.state.nakup.some(x => x.text === 'Toaletní papír'), '1 true');
  check('historie: nejnovější první', h.state.jidelnicekHistorie.map(x => x.tyden).join(), '2026-11-09,2026-11-02');
  check('  ryba se pamatuje', h.state.jidelnicekHistorie[0].ryba, true);
  for (let i = 0; i < 8; i++) { const p = kopie(); p.tyden = `2027-01-${String(4 + i).padStart(2, '0')}`; h.api.jidelnicekUloz(h.api.jidelnicekOver(p).plan); }
  check('historie jen 6 týdnů', h.state.jidelnicekHistorie.length, 6);
  check('GET historie pro úlohu', JSON.stringify(h.volej('GET /api/jidelnicek/historie').out.weby), JSON.stringify(h.api.JIDELNICEK_WEBY));
}
{
  const h = build({ max: 10 });
  h.vloz(kopie());
  check('limit seznamu se dodrží', h.state.nakup.length, 10);
}

nadpis('Výběr: ✕ smazat, aktivovat náhradní, přidat na seznam');
{
  const h = build({ nakup: [{ id: 'n_ruc00021', text: 'Kafe', t: 1 }] });
  h.volej('POST /api/jidelnicek/import', kopie());
  const j = () => h.state.jidelnicek;
  const idx = n => j().recepty.findIndex(r => r.nazev === n);
  const akce = (nazev, a, x = {}) => h.volej('POST /api/jidelnicek/recept', { index: idx(nazev), nazev, akce: a, ...x });
  check('smazat jídlo', akce('Zapečené těstoviny s mozzarellou', 'smazat').kod + ' ' + j().recepty.length, '200 13');
  check('aktivovat náhradní', akce('Krůtí rizoto s hráškem', 'aktivovat').kod + ' ' + ('nahradni' in j().recepty[idx('Krůtí rizoto s hráškem')]), '200 false');
  check('  aktivovat aktivní nejde', akce('Krůtí rizoto s hráškem', 'aktivovat').kod, 400);
  check('jiný název na indexu → 404 (posun)', h.volej('POST /api/jidelnicek/recept', { index: 0, nazev: 'Něco jiného', akce: 'smazat' }).kod, 404);
  check('zamčeno 401', build({ zamceno: true }).volej('POST /api/jidelnicek/recept', { index: 0, nazev: 'x', akce: 'smazat' }).kod, 401);
  check('  appka se dozví, záloha', h.zpravy.slice(-1)[0] + ' ' + (h.ulozeni.length >= 3), 'jidelnicek true');
  const z = build();
  z.volej('POST /api/jidelnicek/restore', JSON.parse(JSON.stringify({ jidelnicek: j() })));
  check('nepotvrzený výběr přežije zálohu', z.state.jidelnicek.nakupPotvrzeno + ' ' + z.state.jidelnicek.recepty.filter(r => r.nahradni).length, 'false 3');
  const r = h.volej('POST /api/jidelnicek/potvrdit', {});
  const nak = n => h.state.nakup.find(x => x.nazev === n);
  check('na seznam: aktivované náhradní ano, smazané a náhradní ne', !!nak('Krůtí prsa') + ' ' + !!nak('Mozzarella') + ' ' + !!nak('Cizrna'), 'true false false');
  check('  rýže 300 g + 0,3 kg sečtena', nak('Rýže').mnozstvi, '600 g');
  check('  kategorie ze suroviny', nak('Krůtí prsa').kategorie, 'Maso, ryby, tofu a další bílkoviny');
  check('  sůl ne, ruční zůstala', !!nak('Sůl') + ' ' + h.state.nakup.some(x => x.text === 'Kafe'), 'false true');
  check('náhradní zmizí, výběr potvrzený', j().recepty.length + ' ' + j().recepty.some(x => x.nahradni) + ' ' + j().nakupPotvrzeno + ' ' + r.out.polozek, '10 false true 25');
  check('  historie s vybranými', h.state.jidelnicekHistorie[0].nazvy.includes('Krůtí rizoto s hráškem') + ' ' + h.state.jidelnicekHistorie[0].nazvy.includes('Zapečené těstoviny s mozzarellou'), 'true false');
  check('po potvrzení ✕ už nejde (409)', akce('Krůtí rizoto s hráškem', 'smazat').kod, 409);
  const pocet = h.state.nakup.length;
  const z2 = h.volej('POST /api/jidelnicek/potvrdit', {});
  check('přidat znovu: bez duplicit', z2.kod + ' ' + z2.out.znovu + ' ' + h.state.nakup.length, '200 true ' + pocet);
  h.state.nakup = [{ id: 'n_ruc00031', text: 'Kafe', t: 1 }];
  h.volej('POST /api/jidelnicek/potvrdit', {});
  check('  po smazání seznamu vrátí suroviny, ruční zůstane', h.state.nakup.length + ' ' + h.state.nakup.some(x => x.text === 'Kafe'), '26 true');
  const ru = build();
  const rt = kopie(); rt.nakupHotovo = true; rt.nakup = [];
  ru.volej('POST /api/jidelnicek/import', rt);
  check('ručně vložený týden bez surovin: 400', ru.volej('POST /api/jidelnicek/potvrdit', {}).kod, 400);
  const st = build();
  st.state.jidelnicek = JSON.parse(JSON.stringify(j())); delete st.state.jidelnicek.nakupPotvrzeno;
  check('starý jídelníček bez příznaku = potvrzený (✕ nejde)', st.volej('POST /api/jidelnicek/recept', { index: 0, nazev: st.state.jidelnicek.recepty[0].nazev, akce: 'smazat' }).kod, 409);
  const sm = build();
  sm.vloz(kopie());
  sm.volej('POST /api/jidelnicek/hotovo', { index: 0, hotovo: true });
  const p2 = kopie(); p2.tyden = '2026-11-09'; p2.recepty.forEach(x => { x.nazev = 'Nové ' + x.nazev; });
  sm.volej('POST /api/jidelnicek/import', p2);
  const zm = sm.state.jidelnicek.recepty.find(x => x.zMinula);
  check('jídlo z minula smazat nejde', sm.volej('POST /api/jidelnicek/recept', { index: sm.state.jidelnicek.recepty.indexOf(zm), nazev: zm.nazev, akce: 'smazat' }).kod, 400);
  check('  a náhradní se nepřevádí', sm.state.jidelnicek.recepty.filter(x => x.zMinula).length, 9);
}

nadpis('Nový týden: neuvařená jídla zůstanou');
{
  const h = build();
  h.vloz(kopie());
  h.volej('POST /api/jidelnicek/hotovo', { index: 0, hotovo: true });
  h.volej('POST /api/jidelnicek/hotovo', { index: 1, hotovo: true });
  // Ruční položka připsaná před generováním i po něm zůstane; staré nekoupené z jídelníčku pryč (nakoupeno)
  h.state.nakup.push({ id: 'n_ruc00011', text: 'Pečivo na víkend', t: 1 });
  check('zbyva pro úlohu: neuvařená', h.volej('GET /api/jidelnicek/historie').out.zbyva.length, 8);
  const p2 = kopie(); p2.tyden = '2026-11-09';
  p2.recepty.forEach(r => { r.nazev = 'Nové ' + r.nazev; });
  p2.recepty = p2.recepty.filter(r => !r.nahradni);
  p2.recepty.forEach(r => { r.suroviny = r.suroviny.filter(x => ['Kuřecí prsa', 'Tortilly', 'Paprika'].includes(x.nazev)); });
  p2.recepty.forEach(r => { if (!r.suroviny.length) r.suroviny = [{ nazev: 'Paprika', mnozstvi: 1, jednotka: 'ks', kategorie: 'Zelenina' }]; });
  h.vloz(p2);
  const rec = h.state.jidelnicek.recepty;
  check('nová jídla první, pak neuvařená z minula', rec.length + ' ' + rec[0].nazev.startsWith('Nové') + ' ' + rec.slice(10).every(r => r.zMinula === '2026-11-02'), '18 true true');
  check('  uvařená se nepřevedou', rec.some(r => r.nazev === VZOR.recepty[0].nazev || r.nazev === VZOR.recepty[1].nazev), false);
  check('  historie týdne jen s novými', h.state.jidelnicekHistorie[0].nazvy.length, 10);
  check('na seznam jen suroviny nových jídel', h.state.nakup.filter(x => x.zdroj === 'jidelnicek').length, 3);
  check('  ruční zůstala', h.state.nakup.some(x => x.text === 'Pečivo na víkend'), true);
  const b = build();
  b.volej('POST /api/jidelnicek/restore', JSON.parse(JSON.stringify({ jidelnicek: h.state.jidelnicek })));
  check('záloha s 18 recepty se obnoví i se zMinula', b.state.jidelnicek && b.state.jidelnicek.recepty.length + ' ' + b.state.jidelnicek.recepty[17].zMinula, '18 2026-11-02');
  const p3 = kopie(); p3.tyden = '2026-11-09';
  h.vloz(p3);
  check('stejný týden znovu (oprava): nic se nepřevádí', h.state.jidelnicek.recepty.length, 10);
  const p4 = kopie(); p4.tyden = '2026-11-30';
  h.vloz(p4);
  check('starší než 14 dní se nepřevádí', h.state.jidelnicek.recepty.length, 10);
}

nadpis('Ověření');
{
  const h = build();
  const zkus = upravit => { const p = kopie(); upravit(p); return h.volej('POST /api/jidelnicek/import', p); };
  check('cizí web v odkazu', zkus(p => { p.recepty[0].zdroj.url = 'https://www.toprecepty.cz/x/'; }).out.error, 'Kuřecí tortilly se zeleninou: odkaz musí vést na jeden z povolených webů (maruskaveg.com, buchtavtroube.cz, receptyodanicky.cz, karolinafour.cz).');
  check('jen http(s)', zkus(p => { p.recepty[0].zdroj.url = 'javascript:alert(1)//karolinafour.cz'; }).kod, 400);
  check('podvržená doména', zkus(p => { p.recepty[0].zdroj.url = 'https://karolinafour.cz.evil.com/x/'; }).kod, 400);
  check('vlastní recept bez odkazu projde', zkus(p => { p.recepty[0].vlastni = true; p.recepty[0].zdroj = null; }).kod, 200);
  check('neznámá kategorie nákupu', zkus(p => { p.nakup[0].kategorie = 'Drogerie'; }).kod, 400);
  check('chybí týden', zkus(p => { delete p.tyden; }).out.error, 'Chybí tyden (YYYY-MM-DD, pondělí).');
  check('příliš mnoho položek', zkus(p => { p.nakup = Array.from({ length: 121 }, (_, i) => ({ ...p.nakup[0], nazev: 'x' + i })); }).kod, 400);
  check('dlouhý text se ořízne', (zkus(p => { p.recepty[0].postup = ['a'.repeat(5000)]; }), h.state.jidelnicek.recepty[0].postup[0].length), 600);
  check('nepovolené štítky zmizí', (zkus(p => { p.recepty[0].stitky = ['maso', 'hack']; }), h.state.jidelnicek.recepty[0].stitky.join()), 'maso');
  check('množství bez čísla = odhad', h.api.jidelnicekMnozstvi({ mnozstvi: null, jednotka: 'balení', odhad: true }), 'balení (odhad)');
}

nadpis('MaruškaVeg, sůl a pepř, ruční týden');
{
  const h = build();
  const zkus = upravit => { const p = kopie(); upravit(p); return h.volej('POST /api/jidelnicek/import', p); };
  check('MaruškaVeg jen přes http projde', zkus(p => { p.recepty[2].zdroj.url = 'http://www.maruskaveg.com/2024/10/tofu.html'; }).kod, 200);
  check('  cizí web přes http ne', zkus(p => { p.recepty[2].zdroj.url = 'http://www.toprecepty.cz/x/'; }).kod, 400);
  check('  ftp ne', zkus(p => { p.recepty[2].zdroj.url = 'ftp://www.maruskaveg.com/x'; }).kod, 400);
  zkus(p => { p.nakup.push({ kategorie: 'Dochucovadla a ostatní', nazev: 'Sůl', mnozstvi: 1, jednotka: 'lžička' }, { kategorie: 'Dochucovadla a ostatní', nazev: 'pepř', mnozstvi: null, jednotka: '', odhad: true }); });
  check('sůl a pepř na seznam nejdou', h.state.nakup.some(x => /^(sůl|pepř)$/i.test(x.nazev)) + ' ' + h.state.jidelnicek.nakup.length, 'false 27');
  check('bez odkazu u úlohy neprojde', zkus(p => { p.recepty[0].zdroj.url = ''; }).kod, 400);

  // Ruční týden: už nakoupeno → na seznam nic, staré nekoupené z minulého jídelníčku pryč
  h.state.nakup.push({ id: 'n_ruc00009', text: 'Toaletní papír', t: 1 });
  const rucne = kopie();
  rucne.nakupHotovo = true; rucne.nakup = [];
  rucne.recepty[0].zdroj.url = '';
  const pushPred = h.push.length;
  const r = h.volej('POST /api/jidelnicek/import', rucne);
  check('ruční týden: odkaz smí chybět, nákup prázdný', r.kod + ' ' + h.state.jidelnicek.recepty[0].zdroj.url + ' ' + h.state.jidelnicek.nakupHotovo, '200 null true');
  check('  na seznamu zůstalo jen ruční', h.state.nakup.map(x => x.text).join(), 'Toaletní papír');
  check('  bez notifikace', h.push.length - pushPred, 0);
}

nadpis('Odškrtnutá jídla');
{
  const h = build();
  h.volej('POST /api/jidelnicek/import', kopie());
  const r = h.volej('POST /api/jidelnicek/hotovo', { index: 3, hotovo: true });
  check('odškrtnutí uloží čas', r.kod + ' ' + (h.state.jidelnicek.recepty[3].hotovo > 0), '200 true');
  check('  appka se dozví', h.zpravy.slice(-1)[0], 'jidelnicek');
  h.volej('POST /api/jidelnicek/hotovo', { index: 3, hotovo: false });
  check('  vrácení smaže', 'hotovo' in h.state.jidelnicek.recepty[3], false);
  check('index mimo 404', h.volej('POST /api/jidelnicek/hotovo', { index: 99, hotovo: true }).kod, 404);
  check('bez hotovo 400', h.volej('POST /api/jidelnicek/hotovo', { index: 1 }).kod, 400);
  check('zamčeno 401', build({ zamceno: true }).volej('POST /api/jidelnicek/hotovo', { index: 1, hotovo: true }).kod, 401);
  h.volej('POST /api/jidelnicek/hotovo', { index: 1, hotovo: true });
  const b = build();
  b.volej('POST /api/jidelnicek/restore', JSON.parse(JSON.stringify({ jidelnicek: h.state.jidelnicek })));
  check('odškrtnutí přežije zálohu', b.state.jidelnicek.recepty[1].hotovo, h.state.jidelnicek.recepty[1].hotovo);
  const c = build();
  const budouci = JSON.parse(JSON.stringify(h.state.jidelnicek)); budouci.recepty[1].hotovo = Date.now() + 9e9;
  c.volej('POST /api/jidelnicek/restore', { jidelnicek: budouci });
  check('  čas z budoucnosti zahodí', 'hotovo' in c.state.jidelnicek.recepty[1], false);
}

nadpis('Známé suroviny pro úlohu');
{
  const h = build({ vyber: { mozzarella: { productId: 1, nazev: 'Miil Mozzarella light', text: 'Mozzarella' }, mleko: { productId: 2, nazev: 'M' } },
    nauceno: { 'uzene tofu': { surovina: 'Uzené tofu', vyrobek: 'Lunter Tofu uzené XXL (2×160 g)' } } });
  const o = h.volej('GET /api/jidelnicek/historie').out;
  check('zname: vybrané i naučené, abecedně', o.zname.join(), 'mleko,Mozzarella,Uzené tofu');
  check('doma', o.doma.join(), 'sůl,pepř');
}

nadpis('Fotky receptů');
const fotkyTest = (async () => {
  const h = build();
  check('foto: povolený web i CDN subdoména', [h.api.jidelnicekFotoUrl('https://karolinafour.cz/wp-content/a.jpg'), h.api.jidelnicekFotoUrl('https://cdn.buchtavtroube.cz/a.jpg')].every(Boolean), true);
  check('  Blogger (MaruškaVeg)', !!h.api.jidelnicekFotoUrl('https://blogger.googleusercontent.com/img/a.jpg') && !!h.api.jidelnicekFotoUrl('https://1.bp.blogspot.com/x.jpg'), true);
  check('  cizí ne', h.api.jidelnicekFotoUrl('https://evil.com/karolinafour.cz.jpg') + ' ' + h.api.jidelnicekFotoUrl('https://karolinafour.cz.evil.com/a.jpg'), 'null null');
  const karolina = '<meta property="og:image" content="https://karolinafour.cz/wp-content/uploads/cropped-logo.png">'
    + '<script type="application/ld+json">{"image":{"@type":"ImageObject","url":"https:\\/\\/karolinafour.cz\\/wp-content\\/uploads\\/2018\\/kuskus.png","width":599}}</script>';
  check('ze stránky: JSON-LD před logem v og:image', h.api.jidelnicekFotoZeStranky(karolina), 'https://karolinafour.cz/wp-content/uploads/2018/kuskus.png');
  const buchta = '<script>{"image":{"@type":"ImageObject","url":"https://secure.gravatar.com/avatar/x"}}</script><meta property="og:image" content="https://www.buchtavtroube.cz/wp-content/uploads/2025/08/P8050025-scaled.jpg">';
  check('  avatar přeskočí, vezme og:image', h.api.jidelnicekFotoZeStranky(buchta), 'https://www.buchtavtroube.cz/wp-content/uploads/2025/08/P8050025-scaled.jpg');
  check('  záloha první obrázek článku', h.api.jidelnicekFotoZeStranky('<img src="https://karolinafour.cz/wp-content/uploads/logo.png"><img class="x" src="https://karolinafour.cz/wp-content/uploads/jidlo.jpg">'), 'https://karolinafour.cz/wp-content/uploads/jidlo.jpg');
  check('  nic', h.api.jidelnicekFotoZeStranky('<p>bez obrázku</p>'), null);

  const f = build({ fetch: async url => ({ ok: true, text: async () => url.includes('karolinafour') ? karolina : '<p>nic</p>' }) });
  f.volej('POST /api/jidelnicek/import', kopie());
  await new Promise(r => setTimeout(r, 20));
  const sKaroli = f.state.jidelnicek.recepty.filter(r => r.zdroj && /karolinafour/.test(r.zdroj.url));
  check('po importu se fotky doplní', sKaroli.length > 0 && sKaroli.every(r => r.foto === 'https://karolinafour.cz/wp-content/uploads/2018/kuskus.png'), true);
  check('  vlastní recept bez odkazu se nestahuje', f.stazeno.length, f.state.jidelnicek.recepty.filter(r => r.zdroj && r.zdroj.url).length);
  check('  appka se dozví, záloha se uloží', f.zpravy.slice(-1)[0] + ' ' + f.ulozeni.length, 'jidelnicek 2');
  const pred = f.stazeno.length;
  await f.api.jidelnicekDoplnFotky(Date.now() + 3600000);
  check('bez fotky se znovu zkouší až po 6 h', f.stazeno.length - pred, 0);
  await f.api.jidelnicekDoplnFotky(Date.now() + 7 * 3600000);
  check('  po 6 h ano (jen ty bez fotky)', f.stazeno.length - pred, f.state.jidelnicek.recepty.filter(r => r.zdroj && r.zdroj.url && !r.foto).length);
  const g = build({ fetch: async () => { throw new Error('síť'); } });
  g.volej('POST /api/jidelnicek/import', kopie());
  await new Promise(r => setTimeout(r, 20));
  check('chyba sítě nic nerozbije', g.state.jidelnicek.recepty.length + ' ' + g.state.jidelnicek.recepty.some(r => r.foto), '14 false');
  const z = build();
  z.volej('POST /api/jidelnicek/restore', JSON.parse(JSON.stringify({ jidelnicek: f.state.jidelnicek })));
  check('fotka přežije zálohu', z.state.jidelnicek.recepty.filter(r => r.foto).length, sKaroli.length);
})();

nadpis('Klíč');
{
  const h = build({ env: { JIDELNICEK_KLIC: 'tajne-456' } });
  check('bez klíče 401', h.volej('POST /api/jidelnicek/import', kopie()).kod, 401);
  check('špatný klíč 401', h.volej('POST /api/jidelnicek/import', kopie(), { 'X-Klic': 'x' }).kod, 401);
  check('správný klíč', h.volej('POST /api/jidelnicek/import', kopie(), { 'X-Klic': 'tajne-456' }).kod, 200);
}

nadpis('Záloha');
{
  const a = build();
  a.volej('POST /api/jidelnicek/import', kopie());
  const b = build();
  b.volej('POST /api/jidelnicek/restore', JSON.parse(JSON.stringify({ jidelnicek: a.state.jidelnicek, historie: a.state.jidelnicekHistorie })));
  check('obnova jídelníčku i historie', b.state.jidelnicek.recepty.length + ' ' + b.state.jidelnicek.vytvoreno + ' ' + b.state.jidelnicekHistorie.length,
    '14 ' + a.state.jidelnicek.vytvoreno + ' 1');
  const c = build();
  c.volej('POST /api/jidelnicek/import', kopie());
  const pred = c.state.jidelnicek.vytvoreno;
  c.volej('POST /api/jidelnicek/restore', { jidelnicek: { ...a.state.jidelnicek, vytvoreno: 1 } });
  check('záloha nepřepíše novější', c.state.jidelnicek.vytvoreno, pred);
}
check('záloha, snapshot, úvodní data', SRC.includes("'/api/jidelnicek/restore',") && SRC.includes("'/api/jidelnicek/restore': { jidelnicek: state.jidelnicek, historie: state.jidelnicekHistorie }")
  && SRC.includes('jidelnicek: state.jidelnicek,'), true);
check('Rohlík si pamatuje podle názvu bez množství', SRC.includes('rohlikZapamatuj(n.nazev || n.text, p, ted);'), true);
fotkyTest.then(konec);
