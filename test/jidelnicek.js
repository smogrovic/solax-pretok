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
  return { api, state, logy, zpravy, push, volej, ulozeni, stazeno };
}

nadpis('Příjem');
{
  const h = build({ nakup: [{ id: 'n_ruc00001', text: 'Toaletní papír', t: 1 }] });
  const r = h.volej('POST /api/jidelnicek/import', kopie());
  check('vzor se přijme', r.kod + ' ' + JSON.stringify(r.out), '200 {"ok":true,"receptu":10,"polozek":27}');
  check('  uložen s časem', h.state.jidelnicek.tyden + ' ' + (h.state.jidelnicek.vytvoreno > 0), '2026-11-02 true');
  check('  appka se dozví (seznam i jídelníček)', h.zpravy.join(), 'nakup,jidelnicek');
  check('  notifikace', h.push[0], '🍽️ Jídelníček na příští týden | 6 večeří a 27 položek na seznamu — vyškrtej, co máme doma.');
  check('  záloha se uloží hned', h.ulozeni.length, 1);
  check('  log', h.logy[0], 'Jídelníček na týden od 2026-11-02: 10 receptů, 27 položek na seznamu');
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
  h.volej('POST /api/jidelnicek/import', p2);
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
  h.volej('POST /api/jidelnicek/import', kopie());
  check('limit seznamu se dodrží', h.state.nakup.length, 10);
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
  check('chyba sítě nic nerozbije', g.state.jidelnicek.recepty.length + ' ' + g.state.jidelnicek.recepty.some(r => r.foto), '10 false');
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
    '10 ' + a.state.jidelnicek.vytvoreno + ' 1');
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
