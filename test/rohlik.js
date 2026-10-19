// Rohlík: napojení na jejich MCP server (falešný server místo skutečného),
// hledání, košík, paměť výběrů — a hlavně že hesla nikam neuniknou.
const fs = require('fs');
const path = require('path');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('rohlík');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const CODE = SRC.slice(SRC.indexOf('// ---------- Rohlík (košík) ----------'));

const EMAIL = 'tajny@email.cz', HESLO = 'SuperTajneHeslo123';

// Falešný MCP server: `nastroje` = co vrací tools/list, `hledani`/`kosik` = obsluha
function falesny({ nastroje, hledani, kosik, sse = false, init401 = false, vyprsi = false } = {}) {
  const log = [];
  let sezeni = 0;
  const odpovez = (status, telo, hlavicky = {}) => ({
    status,
    headers: { get: k => hlavicky[k.toLowerCase()] || null },
    text: async () => (sse && telo ? `event: message\ndata: ${JSON.stringify(telo)}\n\n` : (telo ? JSON.stringify(telo) : ''))
  });
  const fetch = async (url, opts) => {
    const telo = JSON.parse(opts.body);
    log.push({ url, hlavicky: opts.headers, telo });
    if (telo.method === 'initialize') {
      if (init401) return odpovez(401, null);
      sezeni++;
      return odpovez(200, { jsonrpc: '2.0', id: telo.id, result: { protocolVersion: '2025-03-26' } }, { 'mcp-session-id': 'S' + sezeni });
    }
    if (telo.method === 'notifications/initialized') return odpovez(202, null);
    if (vyprsi && opts.headers['Mcp-Session-Id'] === 'S1') return odpovez(404, null);
    if (telo.method === 'tools/list') return odpovez(200, { jsonrpc: '2.0', id: telo.id, result: { tools: nastroje } });
    if (telo.method === 'tools/call') {
      const r = /search/.test(telo.params.name) ? hledani(telo.params.arguments) : kosik(telo.params.arguments);
      return odpovez(200, { jsonrpc: '2.0', id: telo.id, ...r });
    }
    return odpovez(400, null);
  };
  return { fetch, log };
}

function build(f, { env = { ROHLIK_EMAIL: EMAIL, ROHLIK_HESLO: HESLO }, odemceno = true } = {}) {
  const state = { nakup: [], rohlikVyber: {} };
  const routy = {}, zpravy = [];
  const puvodni = { ...process.env };
  delete process.env.ROHLIK_EMAIL; delete process.env.ROHLIK_HESLO;
  Object.assign(process.env, env);
  const api = new Function('state', 'app', 'requireAuth', 'broadcast', 'fetch', 'process',
    CODE + '\n; return { rohlikHledej, rohlikDoKosiku, rohlikVyrobky, rohlikPrectiOdpoved, rohlikKlic, rohlikZapamatuj,'
         + ' rohlikVyberObnov, rohlikArgKosik, rohlikArgHledani, ROHLIK_VYBER_MAX, rohlikEnabled };'
  )(state, { get: (c, h) => { routy['GET ' + c] = h; }, post: (c, h) => { routy['POST ' + c] = h; } },
    (req, res) => { if (odemceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    (u, d) => zpravy.push({ u, d }), f.fetch, process);
  process.env = puvodni;
  const volej = async (cesta, { query, body } = {}) => {
    let out = null, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    await routy[cesta]({ query: query || {}, body: body || {} }, res);
    return { out, kod };
  };
  return { api, state, volej, zpravy };
}

const NASTROJE_A = [
  { name: 'search_products', inputSchema: { properties: { keyword: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'add_items_to_cart', inputSchema: { properties: { items: { type: 'array', items: { properties: { productId: {}, quantity: {} } } } } } },
  { name: 'get_cart', inputSchema: { properties: {} } }
];
const VYSLEDEK_A = { content: [{ type: 'text', text: JSON.stringify({ products: [
  { productId: 1349777, productName: 'Kunín Mléko polotučné 1,5%', price: { amount: 24.9 }, textualAmount: '1 l', imageUrl: 'https://cdn.rohlik.cz/1.jpg' },
  { productId: 1234, productName: 'Olma mléko', price: { amount: 22.5 } }] }) }] };

(async () => {
  nadpis('1) Spojení a hledání');
  {
    const f = falesny({ nastroje: NASTROJE_A, hledani: () => ({ result: VYSLEDEK_A }) });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'mléko' } });
    check('hledání vrátí výrobky', r.kod + ' ' + r.out.vyrobky.length, '200 2');
    check('  s názvem, cenou, jednotkou a obrázkem', JSON.stringify(r.out.vyrobky[0]),
      JSON.stringify({ productId: 1349777, nazev: 'Kunín Mléko polotučné 1,5%', cena: 24.9, jednotka: '1 l', obrazek: 'https://cdn.rohlik.cz/1.jpg' }));
    check('nejdřív initialize, pak tools/list a volání', f.log.map(x => x.telo.method).join(','), 'initialize,notifications/initialized,tools/list,tools/call');
    check('  přihlášení hlavičkami', f.log[0].hlavicky['rhl-email'] + ' ' + (f.log[0].hlavicky['rhl-pass'] === HESLO), EMAIL + ' true');
    check('  sezení se posílá dál', f.log[3].hlavicky['Mcp-Session-Id'], 'S1');
    check('  textový parametr podle schématu', JSON.stringify(f.log[3].telo.params.arguments), '{"keyword":"mléko","limit":8}');
    await h.volej('GET /api/rohlik/hledat', { query: { q: 'chleba' } });
    check('nástroje se nenačítají znovu', f.log.filter(x => x.telo.method === 'tools/list').length, 1);
    check('prázdný dotaz 400', (await h.volej('GET /api/rohlik/hledat', { query: { q: ' ' } })).kod, 400);
  }
  {
    // SSE odpovědi a jiný tvar (structuredContent, id/name, items vnořené)
    const nastroje = [{ name: 'searchProducts', inputSchema: { properties: { query: { type: 'string' } } } },
      { name: 'cart_add', inputSchema: { properties: { product_id: {}, quantity: {} } } }];
    const f = falesny({ sse: true, nastroje,
      hledani: () => ({ result: { structuredContent: { data: { items: [{ id: 'A7', name: 'Rohlík tukový', prices: { price: 3.9 }, images: ['https://cdn/x.jpg'] }] } } } }),
      kosik: () => ({ result: { content: [{ type: 'text', text: 'ok' }] } }) });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'rohlík' } });
    check('SSE a jiný tvar výsledků', r.out.vyrobky.map(v => v.productId + ':' + v.nazev + ':' + v.cena + ':' + v.obrazek).join(), 'A7:Rohlík tukový:3.9:https://cdn/x.jpg');
    check('  parametr query', JSON.stringify(f.log[3].telo.params.arguments), '{"query":"rohlík"}');
    h.state.nakup.push({ id: 'n_aaaa1111', text: 'Rohlík', t: 1 });
    const k = await h.volej('POST /api/rohlik/kosik', { body: { polozky: [{ nakupId: 'n_aaaa1111', productId: 'A7', nazev: 'Rohlík tukový', mnozstvi: 6 }] } });
    check('košík po jednotlivých položkách', k.kod + ' ' + JSON.stringify(f.log[f.log.length - 1].telo.params.arguments), '200 {"product_id":"A7","quantity":6}');
  }

  nadpis('2) Košík a paměť výběrů');
  {
    const f = falesny({ nastroje: NASTROJE_A, hledani: () => ({ result: VYSLEDEK_A }),
      kosik: () => ({ result: { content: [{ type: 'text', text: 'Přidáno' }] } }) });
    const h = build(f);
    h.state.nakup.push({ id: 'n_aaaa1111', text: 'Mléko ', t: 1 }, { id: 'n_bbbb2222', text: 'chleba', t: 2 });
    const r = await h.volej('POST /api/rohlik/kosik', { body: { polozky: [
      { nakupId: 'n_aaaa1111', productId: 1349777, nazev: 'Kunín Mléko', cena: 24.9, obrazek: 'https://cdn/1.jpg', mnozstvi: 2 },
      { nakupId: 'n_bbbb2222', productId: 55, nazev: 'Chléb', mnozstvi: 99 }] } });
    const volani = f.log.filter(x => x.telo.method === 'tools/call').pop();
    check('jedním voláním se všemi položkami', JSON.stringify(volani.telo.params), JSON.stringify({ name: 'add_items_to_cart', arguments: { items: [{ productId: 1349777, quantity: 2 }, { productId: 55, quantity: 1 }] } }));
    check('  nesmyslné množství = 1', volani.telo.params.arguments.items[1].quantity, 1);
    check('  položky dostanou značku v košíku', h.state.nakup.every(x => typeof x.kosik === 'number'), true);
    check('  appka se dozví', h.zpravy.some(z => z.u === 'nakup'), true);
    check('  výběr se zapamatuje (bez diakritiky a velikosti)', h.state.rohlikVyber['mleko'] && h.state.rohlikVyber['mleko'].productId, 1349777);
    check('  i s obrázkem a cenou', h.state.rohlikVyber['mleko'].obrazek + ' ' + h.state.rohlikVyber['mleko'].cena, 'https://cdn/1.jpg 24.9');
    check('  objednávka se neodesílá (žádný jiný nástroj)', f.log.filter(x => x.telo.method === 'tools/call').every(x => /cart|search/.test(x.telo.params.name)), true);
    const v = await h.volej('GET /api/rohlik/vyber');
    check('výběry jdou přečíst', Object.keys(v.out.vyber).sort().join(), 'chleba,mleko');
    check('prázdný košík 400', (await h.volej('POST /api/rohlik/kosik', { body: { polozky: [] } })).kod, 400);
    check('klíč', h.api.rohlikKlic('  Polotučné   MLÉKO '), 'polotucne mleko');
    for (let i = 0; i < h.api.ROHLIK_VYBER_MAX + 5; i++) h.api.rohlikZapamatuj('p' + i, { productId: i, nazev: 'x' }, Date.now() + 1000 + i);
    check('paměť má strop', Object.keys(h.state.rohlikVyber).length, h.api.ROHLIK_VYBER_MAX);
    check('  nejstarší vypadly', 'mleko' in h.state.rohlikVyber, false);
    const h2 = build(f);
    h2.api.rohlikVyberObnov({ vyber: { mleko: { productId: 7, nazev: 'M', kdy: 5 }, spatne: { nazev: 'bez id' } } });
    check('obnova bere jen platné', Object.keys(h2.state.rohlikVyber).join(), 'mleko');
  }

  nadpis('3) Chyby a zabezpečení');
  {
    const f = falesny({ init401: true, nastroje: NASTROJE_A });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'mléko' } });
    check('špatné heslo česky', r.kod + ' ' + r.out.error, '502 Rohlík: špatný e-mail nebo heslo.');
    const d = await h.volej('GET /api/rohlik/diagnostika');
    const vse = JSON.stringify(d.out);
    check('diagnostika neobsahuje heslo ani e-mail', vse.includes(HESLO) || vse.includes(EMAIL), false);
  }
  {
    // Chyba od Rohlíku, která by heslo zopakovala
    const f = { log: [], fetch: async (url, opts) => ({ status: 200, headers: { get: () => null },
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(opts.body).id, error: { message: 'bad login ' + EMAIL + '/' + HESLO } }) }) };
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } });
    check('heslo z chybové hlášky se vymaže', r.out.error.includes(HESLO) || r.out.error.includes(EMAIL), false);
  }
  {
    // Vypršelé sezení se jednou obnoví
    const f = falesny({ vyprsi: true, nastroje: NASTROJE_A, hledani: () => ({ result: VYSLEDEK_A }) });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'mléko' } });
    check('po vypršení sezení se přihlásí znovu', r.kod + ' ' + f.log.filter(x => x.telo.method === 'initialize').length, '200 2');
  }
  {
    const h = build(falesny({ nastroje: NASTROJE_A }), { odemceno: false });
    check('zamčená appka: hledání 401', (await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } })).kod, 401);
    check('  košík 401', (await h.volej('POST /api/rohlik/kosik', { body: { polozky: [{ productId: 1 }] } })).kod, 401);
    check('  výběry 401', (await h.volej('GET /api/rohlik/vyber')).kod, 401);
    check('  diagnostika 401', (await h.volej('GET /api/rohlik/diagnostika')).kod, 401);
  }
  {
    const h = build(falesny({}), { env: {} });
    check('bez údajů vypnuto', h.api.rohlikEnabled, false);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } });
    check('  a hledání to řekne', /není nastavený/.test(r.out.error), true);
  }
  check('heslo se nikde nepíše do logu', /addLog\([^)]*ROHLIK_HESLO|console\.\w+\([^)]*ROHLIK_HESLO/.test(SRC), false);
  check('objednávka (checkout/order) se v kódu nevolá', /tools\/call[^\n]*(checkout|submit|order)/i.test(CODE), false);
  konec();
})();
