// Rohlík: napojení na jejich MCP server (falešný server místo skutečného),
// hledání, košík, paměť výběrů — a hlavně že hesla nikam neuniknou.
const fs = require('fs');
const path = require('path');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('rohlík');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const CODE = SRC.slice(SRC.indexOf('// ---------- Rohlík (košík) ----------'));

const ACCESS = 'ACCESS-tok-123456', REFRESH = 'REFRESH-tok-654321';

// Falešný Rohlík: MCP server (chce Bearer token) + OAuth server (metadata,
// registrace klienta, token). `nastroje` = co vrací tools/list.
function falesny({ nastroje, hledani, kosik, sse = false, odmitni = null, vyprsi = false, platny = ACCESS } = {}) {
  const log = [];
  let sezeni = 0;
  const st = { platny };
  const odpovez = (status, telo, hlavicky = {}) => ({
    status,
    headers: { get: k => hlavicky[k.toLowerCase()] || null },
    text: async () => (typeof telo === 'string' ? telo
      : (sse && telo ? `event: message\ndata: ${JSON.stringify(telo)}\n\n` : (telo ? JSON.stringify(telo) : '')))
  });
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u === 'https://mcp.rohlik.cz/.well-known/oauth-protected-resource/mcp') {
      log.push({ url: u });
      return odpovez(200, { resource: 'https://mcp.rohlik.cz/mcp', authorization_servers: ['https://auth.rohlik.cz'] });
    }
    if (u === 'https://auth.rohlik.cz/.well-known/oauth-authorization-server') {
      log.push({ url: u });
      return odpovez(200, { authorization_endpoint: 'https://auth.rohlik.cz/authorize', token_endpoint: 'https://auth.rohlik.cz/token',
        registration_endpoint: 'https://auth.rohlik.cz/register', scopes_supported: ['mcp'] });
    }
    if (u === 'https://auth.rohlik.cz/register') {
      log.push({ url: u, telo: JSON.parse(opts.body) });
      return odpovez(201, { client_id: 'klient-1' });
    }
    if (u === 'https://auth.rohlik.cz/token') {
      const p = Object.fromEntries(new URLSearchParams(opts.body));
      log.push({ url: u, telo: p });
      if (p.grant_type === 'refresh_token' && p.refresh_token === REFRESH) { st.platny = 'NOVY-access-999999'; return odpovez(200, { access_token: 'NOVY-access-999999', expires_in: 3600 }); }
      if (p.grant_type === 'authorization_code' && p.code === 'KOD') return odpovez(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 });
      return odpovez(400, { error: 'invalid_grant' });
    }
    const telo = JSON.parse(opts.body);
    log.push({ url: u, hlavicky: opts.headers, telo });
    if (odmitni) return odpovez(odmitni.status, odmitni.telo, odmitni.hlavicky || {});
    if (opts.headers.Authorization !== 'Bearer ' + st.platny) {
      return odpovez(401, { error: 'invalid_token' }, { 'www-authenticate': 'Bearer error="invalid_token"' });
    }
    if (telo.method === 'initialize') {
      sezeni++;
      return odpovez(200, { jsonrpc: '2.0', id: telo.id, result: { protocolVersion: '2025-03-26' } }, { 'mcp-session-id': 'S' + sezeni });
    }
    if (telo.method === 'notifications/initialized') return odpovez(202, null);
    if (vyprsi && opts.headers['Mcp-Session-Id'] === 'S1') return odpovez(404, null);
    if (telo.method === 'tools/list') return odpovez(200, { jsonrpc: '2.0', id: telo.id, result: { tools: nastroje } });
    if (telo.method === 'tools/call') {
      const r = /search/i.test(telo.params.name) ? hledani(telo.params.arguments) : kosik(telo.params.arguments);
      return odpovez(200, { jsonrpc: '2.0', id: telo.id, ...r });
    }
    return odpovez(400, null);
  };
  return { fetch, log, st };
}

function build(f, { prihlasen = true, odemceno = true } = {}) {
  const state = { nakup: [], rohlikVyber: {},
    rohlikOauth: prihlasen ? { clientId: 'klient-1', access: ACCESS, refresh: REFRESH, redirect: 'https://app/api/rohlik/oauth/zpet' } : null };
  const routy = {}, zpravy = [];
  const api = new Function('state', 'app', 'requireAuth', 'broadcast', 'fetch', 'process', 'crypto',
    CODE + '\n; return { rohlikHledej, rohlikDoKosiku, rohlikVyrobky, rohlikPrectiOdpoved, rohlikKlic, rohlikZapamatuj,'
         + ' rohlikVyberObnov, rohlikArgKosik, rohlikArgHledani, ROHLIK_VYBER_MAX, rohlikPayload, rohlikOauthStart,'
         + ' rohlikOauthZpet, rohlikOauthObnov, rohlikPrihlaseni };'
  )(state, { get: (c, h) => { routy['GET ' + c] = h; }, post: (c, h) => { routy['POST ' + c] = h; } },
    (req, res) => { if (odemceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    (u, d) => zpravy.push({ u, d }), f.fetch, process, require('crypto'));
  const volej = async (cesta, { query, body } = {}) => {
    let out = null, kod = 200, kam = null;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; }, redirect: u => { kam = u; return res; } };
    await routy[cesta]({ query: query || {}, body: body || {}, protocol: 'https', get: k => ({ host: 'app.test' })[k] }, res);
    return { out, kod, kam };
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
    check('  s tokenem', f.log[0].hlavicky.Authorization, 'Bearer ' + ACCESS);
    check('  a bez starých hlaviček', 'rhl-pass' in f.log[0].hlavicky, false);
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

  nadpis('3) Přihlášení OAuth');
  {
    const f = falesny({ nastroje: NASTROJE_A, hledani: () => ({ result: VYSLEDEK_A }) });
    const h = build(f, { prihlasen: false });
    check('nepřihlášený: payload', JSON.stringify(h.api.rohlikPayload()), '{"enabled":true,"prihlaseno":false}');
    const r0 = await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } });
    check('  hledání řekne, ať se přihlásí', /nejdřív se přihlas/.test(r0.out.error), true);
    const s = await h.volej('POST /api/rohlik/prihlasit');
    const u = new URL(s.out.url);
    check('start vrátí adresu přihlášení u Rohlíku', u.origin + u.pathname, 'https://auth.rohlik.cz/authorize');
    check('  s PKCE a stavem', u.searchParams.get('code_challenge_method') + ' ' + !!u.searchParams.get('code_challenge') + ' ' + !!u.searchParams.get('state'), 'S256 true true');
    check('  návrat na appku', u.searchParams.get('redirect_uri'), 'https://app.test/api/rohlik/oauth/zpet');
    check('  zdroj a rozsah', u.searchParams.get('resource') + ' ' + u.searchParams.get('scope'), 'https://mcp.rohlik.cz/mcp mcp');
    check('  klient se zaregistroval', f.log.find(x => x.url === 'https://auth.rohlik.cz/register').telo.redirect_uris[0], 'https://app.test/api/rohlik/oauth/zpet');
    const z = await h.volej('GET /api/rohlik/oauth/zpet', { query: { code: 'KOD', state: u.searchParams.get('state') } });
    check('návrat s kódem: přesměruje do appky', z.kam, '/?rohlik=ok');
    const tok = f.log.filter(x => x.url === 'https://auth.rohlik.cz/token').pop().telo;
    check('  výměna kódu s verifierem', tok.grant_type + ' ' + !!tok.code_verifier + ' ' + tok.client_id, 'authorization_code true klient-1');
    check('  tokeny uložené', h.state.rohlikOauth.access + ' ' + h.state.rohlikOauth.refresh, ACCESS + ' ' + REFRESH);
    check('  appka se dozví', h.zpravy.some(m => m.u === 'rohlik' && m.d.rohlik.prihlaseno === true), true);
    check('  tokeny do appky nejdou', JSON.stringify(h.zpravy).includes(ACCESS), false);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'mléko' } });
    check('po přihlášení hledání funguje', r.kod + ' ' + r.out.vyrobky.length, '200 2');
    const z2 = await h.volej('GET /api/rohlik/oauth/zpet', { query: { code: 'KOD', state: u.searchParams.get('state') } });
    check('stav jde použít jen jednou', /rohlik=chyba/.test(z2.kam), true);
    const z3 = await h.volej('GET /api/rohlik/oauth/zpet', { query: { error: 'access_denied' } });
    check('odmítnutí u Rohlíku se vrátí jako chyba', z3.kam, '/?rohlik=chyba&duvod=access_denied');
    const d = (await h.volej('GET /api/rohlik/diagnostika')).out;
    const dj = JSON.stringify(d);
    check('diagnostika bez tokenů', dj.includes(ACCESS) || dj.includes(REFRESH), false);
    check('  ale řekne, že je přihlášeno', d.oauth.prihlaseno + ' ' + d.oauth.obnovovaciToken, 'true true');
  }
  {
    // Odmítnutá registrace: důvod od Rohlíku do hlášky i diagnostiky
    const f = falesny({ nastroje: NASTROJE_A });
    const puvodni = f.fetch;
    f.fetch = async (url, opts) => (String(url) === 'https://auth.rohlik.cz/register'
      ? { status: 400, headers: { get: () => null }, text: async () => JSON.stringify({ error: 'invalid_redirect_uri', error_description: 'Redirect URI not allowed' }) }
      : puvodni(url, opts));
    const h = build(f, { prihlasen: false });
    const r = await h.volej('POST /api/rohlik/prihlasit');
    check('odmítnutá registrace řekne proč', r.out.error, 'Rohlík: registrace klienta se nepovedla (HTTP 400): Redirect URI not allowed');
    const d = (await h.volej('GET /api/rohlik/diagnostika')).out;
    check('  diagnostika má celou odpověď', /invalid_redirect_uri/.test(d.registrace.odpoved) && d.registrace.redirect, 'https://app.test/api/rohlik/oauth/zpet');
  }
  {
    // Rozběhnuté přihlášení platí jen 10 minut
    const f = falesny({ nastroje: NASTROJE_A });
    const h = build(f, { prihlasen: false });
    const url = new URL(await h.api.rohlikOauthStart('https://app/zpet', Date.now() - 11 * 60000));
    let chyba = '';
    try { await h.api.rohlikOauthZpet(url.searchParams.get('state'), 'KOD'); } catch (e) { chyba = e.message; }
    check('přihlášení po 10 minutách vyprší', chyba, 'Přihlášení vypršelo, zkus to znovu.');
  }
  {
    // Token, který by Rohlík zopakoval v chybě, se z hlášky vymaže
    const f = falesny({ nastroje: NASTROJE_A, hledani: () => ({ error: { message: 'token ' + ACCESS + ' nepovolen' } }) });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } });
    check('token z chybové hlášky se vymaže', r.out.error.includes(ACCESS), false);
  }
  {
    // Vypršelý token se sám obnoví obnovovacím tokenem
    const f = falesny({ nastroje: NASTROJE_A, hledani: () => ({ result: VYSLEDEK_A }), platny: 'NOVY-access-999999' });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'mléko' } });
    check('vypršelý token se obnoví', r.kod + ' ' + h.state.rohlikOauth.access, '200 NOVY-access-999999');
  }
  {
    // Neplatný token a obnova selže → odhlásit a říct, ať se přihlásí znovu
    const f = falesny({ nastroje: NASTROJE_A, platny: 'jiny-token-xxxxxx' });
    const h = build(f);
    h.state.rohlikOauth.refresh = 'spatny-refresh-xxx';
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } });
    check('neplatné přihlášení: přihlas se znovu', r.out.error, 'Rohlík: přihlášení vypršelo nebo chybí — přihlas se znovu.');
    check('  a odhlásí', h.api.rohlikPayload().prihlaseno, false);
    const d = JSON.stringify((await h.volej('GET /api/rohlik/diagnostika')).out);
    check('  diagnostika zaznamená odpověď', /invalid_token/.test(d), true);
  }
  {
    const f = falesny({ nastroje: NASTROJE_A, odmitni: { status: 403, telo: '<!DOCTYPE html> cloudflare', hlavicky: { 'content-type': 'text/html' } } });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } });
    check('403 s HTML = blokace serveru', r.out.error, 'Rohlík blokuje přístup ze serveru (ochrana proti robotům).');
  }
  {
    // Vypršelé sezení se jednou obnoví
    const f = falesny({ vyprsi: true, nastroje: NASTROJE_A, hledani: () => ({ result: VYSLEDEK_A }) });
    const h = build(f);
    const r = await h.volej('GET /api/rohlik/hledat', { query: { q: 'mléko' } });
    check('po vypršení sezení se naváže znovu', r.kod + ' ' + f.log.filter(x => x.telo && x.telo.method === 'initialize').length, '200 2');
  }
  {
    const h = build(falesny({ nastroje: NASTROJE_A }), { odemceno: false });
    check('zamčená appka: hledání 401', (await h.volej('GET /api/rohlik/hledat', { query: { q: 'x' } })).kod, 401);
    check('  košík 401', (await h.volej('POST /api/rohlik/kosik', { body: { polozky: [{ productId: 1 }] } })).kod, 401);
    check('  výběry 401', (await h.volej('GET /api/rohlik/vyber')).kod, 401);
    check('  přihlášení 401', (await h.volej('POST /api/rohlik/prihlasit')).kod, 401);
    check('  odhlášení 401', (await h.volej('POST /api/rohlik/odhlasit')).kod, 401);
    check('  diagnostika 401', (await h.volej('GET /api/rohlik/diagnostika')).kod, 401);
  }
  {
    const h = build(falesny({}), { prihlasen: false });
    h.api.rohlikOauthObnov({ clientId: 'k', access: 'A-zaloha-123456', refresh: 'R-zaloha-123456', meta: { token_endpoint: 'https://t', authorization_endpoint: 'https://a' } });
    check('obnova přihlášení ze zálohy', h.api.rohlikPayload().prihlaseno, true);
    h.api.rohlikOauthObnov({ clientId: 'jiny', access: 'jiny-token-123456' });
    check('  přihlášené nepřepíše', h.state.rohlikOauth.access, 'A-zaloha-123456');
  }
  check('tokeny se nikde nepíšou do logu', /addLog\([^)]*rohlikOauth|console\.\w+\([^)]*rohlikOauth/.test(SRC), false);
  check('objednávka (checkout/order) se v kódu nevolá', /tools\/call[^\n]*(checkout|submit|order)/i.test(CODE), false);
  konec();
})();
