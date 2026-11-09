// Přihlášení přes Apple ID (Firebase): ověření ID tokenu, povolené e-maily, cookie,
// brána na /api a stránku, výjimky pro stroje, kód pro další zařízení.
const crypto = require('crypto');
const path = require('path');
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('přihlášení');

const CODE = between('// ---------- Přihlášení (Apple ID přes Firebase)', '// ---------- Otisk verze')
  + '\n' + between('// Přihlášení: stav (veřejný', '// ---------- SSE stream') + '\n' + fn('function safeEqual(a, b) {');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(telo, { kid = 'k1', klic = privateKey, alg = 'RS256' } = {}) {
  const h = b64({ alg, kid, typ: 'JWT' }), t = b64(telo);
  const podpis = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + t), klic).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return h + '.' + t + '.' + podpis;
}
const ted = () => Math.floor(Date.now() / 1000);
const token = (o = {}) => jwt({ aud: 'projekt-x', iss: 'https://securetoken.google.com/projekt-x', sub: 'u1',
  iat: ted() - 10, auth_time: ted() - 10, exp: ted() + 3600, email: 'Smogrovic@gmail.com', email_verified: true,
  firebase: { sign_in_provider: 'apple.com' }, ...o });

function build(env = {}) {
  const routy = {}, middleware = [], logy = [];
  const pokusy = new Map();
  const app = {
    use: f => middleware.push(f), all: (c, ...h) => { routy['ALL ' + [].concat(c)[0]] = h.pop(); },
    get: (c, f) => { for (const x of [].concat(c)) routy['GET ' + x] = f; }, post: (c, f) => { routy['POST ' + c] = f; }
  };
  const fetchKlice = async () => ({ ok: true, headers: { get: () => 'public, max-age=100' }, json: async () => ({ k1: PUB }) });
  const api = new Function('require', 'crypto', 'path', '__dirname', 'process', 'app', 'express', 'fetch', 'console',
    'tooManyAttempts', 'registerFailedAttempt', 'unlockAttempts', 'addLog', 'AbortSignal',
    CODE + '\n; return { authVydej, authOver, firebaseOverToken, prihlaseniBrana, authEmailPovolen, VNITRNI_KLIC, AUTH_EMAILY, prihlaseniZapnute };')(
    require, crypto, path, path.join(__dirname, '..'),
    { env: { FIREBASE_PROJECT_ID: 'projekt-x', FIREBASE_API_KEY: 'AIza-verejny', AUTH_SESSION_SECRET: 'tajne-sezeni', ...env } },
    app, { raw: () => (q, s, n) => n() }, fetchKlice, { log() {}, error() {} },
    ip => (pokusy.get(ip) || 0) >= 10, ip => pokusy.set(ip, (pokusy.get(ip) || 0) + 1), pokusy, (t, u) => logy.push(t), AbortSignal);
  const pozadavek = (metoda, cesta, { cookie, hlavicky = {}, telo } = {}) => ({
    method: metoda, path: cesta, ip: '1.2.3.4', body: telo,
    get: h => (h.toLowerCase() === 'cookie' ? cookie : hlavicky[h] || hlavicky[h.toLowerCase()])
  });
  const odpoved = () => {
    const r = { kod: 200, h: {}, cookies: [], json: null, soubor: null, dal: false };
    r.res = { status: c => { r.kod = c; return r.res; }, json: v => { r.json = v; return r.res; }, setHeader: (k, v) => { r.h[k] = v; },
      append: (k, v) => { if (k === 'Set-Cookie') r.cookies.push(v); }, sendFile: f => { r.soubor = f; } };
    return r;
  };
  const brana = (metoda, cesta, o) => { const r = odpoved(); api.prihlaseniBrana(pozadavek(metoda, cesta, o), r.res, () => { r.dal = true; }); return r; };
  const volej = async (metoda, cesta, o) => { const r = odpoved(); await routy[metoda + ' ' + cesta](pozadavek(metoda, cesta, o), r.res); return r; };
  const cookieZ = r => { const m = /solinator_prihlaseni=([^;]+)/.exec(r.cookies[0] || ''); return m ? 'solinator_prihlaseni=' + m[1] : null; };
  return { api, brana, volej, logy, pokusy, cookieZ };
}

(async () => {
  nadpis('1) Firebase ID token');
  {
    const { api } = build();
    const klice = { k1: PUB };
    check('platný token Apple → e-mail malými písmeny', (await api.firebaseOverToken(token(), { klice })).email, 'smogrovic@gmail.com');
    const chyba = async (t, o) => { try { await api.firebaseOverToken(t, { klice, ...o }); return 'prošlo'; } catch (e) { return e.message; } };
    const jiny = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    check('cizí podpis', await chyba(jwt({ ...JSON.parse(Buffer.from(token().split('.')[1], 'base64')) }, { klic: jiny })), 'Neplatný podpis tokenu.');
    check('jiný projekt', await chyba(token({ aud: 'jiny' })), 'Token je pro jiný projekt.');
    check('jiný vydavatel', await chyba(token({ iss: 'https://evil' })), 'Token je pro jiný projekt.');
    check('vypršelý', await chyba(token({ exp: ted() - 1 })), 'Token vypršel.');
    check('z budoucnosti', await chyba(token({ iat: ted() + 3600 })), 'Token vypršel.');
    check('Google místo Apple', await chyba(token({ firebase: { sign_in_provider: 'google.com' } })), 'Přihlas se přes Apple ID.');
    check('bez e-mailu', /Sdílet můj e-mail/.test(await chyba(token({ email: undefined }))), true);
    check('neznámý klíč', await chyba(jwt({}, { kid: 'nic' })), 'Neznámý klíč tokenu.');
    check('alg none', await chyba(jwt({}, { alg: 'none' })), 'Neplatný token.');
    check('nesmysl', await chyba('abc'), 'Neplatný token.');
  }

  nadpis('2) Povolené účty a přihlašovací cookie');
  {
    const h = build();
    check('výchozí čtyři účty', h.api.AUTH_EMAILY.join(','), 'smogrovic@gmail.com,zuzana.smogrovicova@gmail.com,mikulas.smogrovic@icloud.com,elena.smogrovicova@icloud.com');
    const r = await h.volej('POST', '/api/auth/firebase', { telo: { idToken: token({ email: 'Elena.Smogrovicova@icloud.com' }) } });
    check('povolený účet dostane cookie', [r.json.ok, r.json.email, /HttpOnly; Secure; SameSite=Lax/.test(r.cookies[0]), /Max-Age=34560000/.test(r.cookies[0])].join(' '),
      'true elena.smogrovicova@icloud.com true true');
    const cizi = await h.volej('POST', '/api/auth/firebase', { telo: { idToken: token({ email: 'cizi@example.com' }) } });
    check('cizí účet 403, bez cookie, zaloguje se', [cizi.kod, cizi.cookies.length, /cizi@example\.com/.test(h.logy.join())].join(' '), '403 0 true');
    const skryty = await h.volej('POST', '/api/auth/firebase', { telo: { idToken: token({ email: 'abc@privaterelay.appleid.com' }) } });
    check('skrytý e-mail od Apple: návod', /Sdílet můj e-mail/.test(skryty.json.error), true);
    const s = h.api.authOver(h.api.authVydej('smogrovic@gmail.com'));
    check('cookie se ověří', s && s.email, 'smogrovic@gmail.com');
    check('  podvržený podpis ne', h.api.authOver(h.api.authVydej('smogrovic@gmail.com').replace(/.$/, 'x') + 'y'), null);
    check('  cizí e-mail s platným podpisem ne', h.api.authOver(h.api.authVydej('cizi@example.com')), null);
    check('  starší než 400 dní ne', h.api.authOver(h.api.authVydej('smogrovic@gmail.com', Date.now() - 401 * 86400000)), null);
    const jinySecret = build({ AUTH_SESSION_SECRET: 'jine' });
    check('  jiný AUTH_SESSION_SECRET zneplatní všechna přihlášení', jinySecret.api.authOver(h.api.authVydej('smogrovic@gmail.com')), null);
    const omezene = build({ AUTH_EMAILY: 'jen@neco.cz' });
    check('AUTH_EMAILY přepíše seznam', [omezene.api.authEmailPovolen('jen@neco.cz'), omezene.api.authEmailPovolen('smogrovic@gmail.com')].join(' '), 'true false');
    const odh = await h.volej('POST', '/api/auth/odhlasit');
    check('odhlášení smaže cookie', /Max-Age=0/.test(odh.cookies[0]), true);
  }

  nadpis('3) Brána');
  {
    const h = build();
    const cookie = 'a=1; solinator_prihlaseni=' + encodeURIComponent(h.api.authVydej('smogrovic@gmail.com'));
    check('bez přihlášení: stránka = přihlašovací', /prihlaseni\.html$/.test(h.brana('GET', '/').soubor), true);
    const api401 = h.brana('GET', '/api/solax');
    check('  /api → 401 s hlavičkou pro appku', [api401.kod, api401.h['X-Prihlaseni'], api401.dal].join(' '), '401 nutne false');
    check('  živý stream taky', h.brana('GET', '/api/stream').kod, 401);
    check('  obnova dat zvenku taky', h.brana('POST', '/api/wbdays/restore').kod, 401);
    check('  ikony, manifest, skripty pro NAS volně', ['/icon-192.png', '/manifest.json', '/nas/zavlaha-most.js', '/__/auth/handler', '/version.json'].every(c => h.brana('GET', c).dal), true);
    check('  přihlašovací API volně', ['/api/auth/stav'].every(c => h.brana('GET', c).dal) && h.brana('POST', '/api/auth/kod/pouzit').dal, true);
    check('  stroje (zkratky, NAS, Shelly, jídelníček, auto) volně', [['POST', '/api/zkratka'], ['POST', '/api/zavlaha/stav'], ['POST', '/api/vysavac/stav'],
      ['POST', '/api/auto/stav'], ['POST', '/api/sauna/active'], ['POST', '/api/jidelnicek/import'], ['GET', '/api/jidelnicek/historie'], ['GET', '/api/auto/nabijeni'],
      ['GET', '/api/auto/nabijeni/fin'], ['OPTIONS', '/api/auto/nabijeni/fin']]
      .every(([m, c]) => h.brana(m, c).dal), true);
    check('  ale jen danou metodou', h.brana('GET', '/api/zavlaha/stav').kod, 401);
    check('vnitřní obnova po startu s klíčem projde', h.brana('POST', '/api/wbdays/restore', { hlavicky: { 'X-Vnitrni': h.api.VNITRNI_KLIC } }).dal, true);
    check('  se špatným klíčem ne', h.brana('POST', '/api/wbdays/restore', { hlavicky: { 'X-Vnitrni': 'x' } }).kod, 401);
    const ok = h.brana('GET', '/api/solax', { cookie });
    check('přihlášený projde všude, bez nové cookie', [ok.dal, ok.cookies.length, h.brana('GET', '/', { cookie }).dal].join(' '), 'true 0 true');
    const stara = 'solinator_prihlaseni=' + encodeURIComponent(h.api.authVydej('smogrovic@gmail.com', Date.now() - 40 * 86400000));
    const prodl = h.brana('GET', '/api/solax', { cookie: stara });
    check('starší než 30 dní se prodlouží (jednou přihlásit = napořád)', [prodl.dal, prodl.cookies.length].join(' '), 'true 1');
    const vyp = build({ FIREBASE_API_KEY: '' });
    check('bez nastavení Firebase je brána vypnutá (appka jede jako dřív)', [vyp.api.prihlaseniZapnute, vyp.brana('GET', '/api/solax').dal, vyp.brana('GET', '/').dal].join(' '), 'false true true');
    const st = await vyp.volej('GET', '/api/auth/stav', { hlavicky: { host: 'x' } });
    check('  stav: vypnuto = přihlášen', [st.json.zapnuto, st.json.prihlasen].join(' '), 'false true');
    const st2 = await h.volej('GET', '/api/auth/stav', { hlavicky: { host: 'solax-pretok.onrender.com' } });
    check('stav pro přihlašovací stránku: Firebase přes vlastní doménu, bez tajemství',
      JSON.stringify(st2.json), JSON.stringify({ zapnuto: true, prihlasen: false, email: null,
        firebase: { apiKey: 'AIza-verejny', projectId: 'projekt-x', authDomain: 'solax-pretok.onrender.com' } }));
  }

  nadpis('4) Kód pro další zařízení');
  {
    const h = build();
    const cookie = 'solinator_prihlaseni=' + encodeURIComponent(h.api.authVydej('zuzana.smogrovicova@gmail.com'));
    check('bez přihlášení kód nedostane', (await h.volej('POST', '/api/auth/kod')).kod, 401);
    const k = await h.volej('POST', '/api/auth/kod', { cookie });
    check('přihlášený dostane 6 číslic na 10 min', [/^\d{6}$/.test(k.json.kod), Math.round((k.json.platiDo - Date.now()) / 60000)].join(' '), 'true 10');
    const u = await h.volej('POST', '/api/auth/kod/pouzit', { telo: { kod: k.json.kod } });
    check('nové zařízení se kódem přihlásí jako ten, kdo kód vytvořil', [u.json.email, u.cookies.length].join(' '), 'zuzana.smogrovicova@gmail.com 1');
    check('  kód platí jen jednou', (await h.volej('POST', '/api/auth/kod/pouzit', { telo: { kod: k.json.kod } })).kod, 401);
    for (let i = 0; i < 12; i++) await h.volej('POST', '/api/auth/kod/pouzit', { telo: { kod: '000000' } });
    const k2 = await h.volej('POST', '/api/auth/kod', { cookie });
    check('hádání kódu zastaví limit pokusů', (await h.volej('POST', '/api/auth/kod/pouzit', { telo: { kod: k2.json.kod } })).kod, 429);
  }
  konec();
})();
