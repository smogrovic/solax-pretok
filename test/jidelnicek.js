// Jídelníček z páteční úlohy: příjem v appce, nákupní seznam, historie a záloha
const crypto = require('crypto');
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('jídelníček');
const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const CODE = between('// ---------- Jídelníček na týden ----------', '// ---------- Trvalé úložiště');
const VZOR = require('./data/jidelnicek-vzor.json');
const kopie = () => JSON.parse(JSON.stringify(VZOR));

function build(o = {}) {
  const routy = {}, zpravy = [], logy = [], push = [];
  const state = { nakup: o.nakup || [] };
  const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
  const api = new Function('state', 'app', 'addLog', 'broadcast', 'sendPushToAll', 'safeEqual', 'NAKUP_MAX', 'NAKUP_CELKEM_MAX', 'NAKUP_TEXT_MAX', 'process',
    CODE + '\n; return { jidelnicekOver, jidelnicekUloz, jidelnicekMnozstvi, JIDELNICEK_WEBY };')(
    state, { post: (c, f) => { routy['POST ' + c] = f; }, get: (c, f) => { routy['GET ' + c] = f; } },
    t => logy.push(t), (u, d) => zpravy.push(u), async (t, b) => { push.push(t + ' | ' + b); }, safeEqual,
    o.max || 120, 200, 80, { env: o.env || {} });
  const volej = (cesta, body, hlavicky = {}) => {
    let out, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    routy[cesta]({ body, get: k => hlavicky[k] }, res);
    return { out, kod };
  };
  return { api, state, logy, zpravy, push, volej };
}

nadpis('Příjem');
{
  const h = build({ nakup: [{ id: 'n_ruc00001', text: 'Toaletní papír', t: 1 }] });
  const r = h.volej('POST /api/jidelnicek/import', kopie());
  check('vzor se přijme', r.kod + ' ' + JSON.stringify(r.out), '200 {"ok":true,"receptu":10,"polozek":27}');
  check('  uložen s časem', h.state.jidelnicek.tyden + ' ' + (h.state.jidelnicek.vytvoreno > 0), '2026-11-02 true');
  check('  appka se dozví (seznam i jídelníček)', h.zpravy.join(), 'nakup,jidelnicek');
  check('  notifikace', h.push[0], '🍽️ Jídelníček na příští týden | 6 večeří a 27 položek na seznamu — vyškrtej, co máme doma.');
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
  check('jen https', zkus(p => { p.recepty[0].zdroj.url = 'http://www.karolinafour.cz/x/'; }).kod, 400);
  check('podvržená doména', zkus(p => { p.recepty[0].zdroj.url = 'https://karolinafour.cz.evil.com/x/'; }).kod, 400);
  check('vlastní recept bez odkazu projde', zkus(p => { p.recepty[0].vlastni = true; p.recepty[0].zdroj = null; }).kod, 200);
  check('neznámá kategorie nákupu', zkus(p => { p.nakup[0].kategorie = 'Drogerie'; }).kod, 400);
  check('chybí týden', zkus(p => { delete p.tyden; }).out.error, 'Chybí tyden (YYYY-MM-DD, pondělí).');
  check('příliš mnoho položek', zkus(p => { p.nakup = Array.from({ length: 121 }, (_, i) => ({ ...p.nakup[0], nazev: 'x' + i })); }).kod, 400);
  check('dlouhý text se ořízne', (zkus(p => { p.recepty[0].postup = ['a'.repeat(5000)]; }), h.state.jidelnicek.recepty[0].postup[0].length), 600);
  check('nepovolené štítky zmizí', (zkus(p => { p.recepty[0].stitky = ['maso', 'hack']; }), h.state.jidelnicek.recepty[0].stitky.join()), 'maso');
  check('množství bez čísla = odhad', h.api.jidelnicekMnozstvi({ mnozstvi: null, jednotka: 'balení', odhad: true }), 'balení (odhad)');
}

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
konec();
