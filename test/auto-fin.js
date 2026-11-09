// Nabíjení auta pro Moje finance: GET /api/auto/nabijeni/fin s přihlášením Firebase (ověření podpisu tokenu,
// projekt, platnost, e-mail z FIN_EMAILS, CORS jen pro appku). Certifikáty Googlu podvržené, nic se nevolá naostro.
const crypto = require('crypto');
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('nabíjení auta pro Moje finance');

const CODE = between('// ---------- Nabíjení auta pro Moje finance', '// ---------- Záloha do souboru');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const cizi = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const PEM = publicKey.export({ type: 'spki', format: 'pem' });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(o = {}, klic = privateKey, kid = 'k1') {
  const t = Math.floor(Date.now() / 1000);
  const obsah = Object.assign({ iss: 'https://securetoken.google.com/moje-finance-4bb9e', aud: 'moje-finance-4bb9e', sub: 'u1',
    iat: t - 10, exp: t + 3600, email: 'Majitel@Example.com', email_verified: true }, o);
  const hlava = b64({ alg: 'RS256', kid }) + '.' + b64(obsah);
  return hlava + '.' + crypto.sign('RSA-SHA256', Buffer.from(hlava), klic).toString('base64url');
}

function build(env = { FIN_EMAILS: 'majitel@example.com' }, certsOk = true) {
  const routy = {}, volano = { certs: 0, odpoved: 0 };
  const app = { get: (c, f) => { routy['GET ' + c] = f; }, options: (c, f) => { routy['OPTIONS ' + c] = f; } };
  const fetchMock = async () => { volano.certs++; return certsOk
    ? { ok: true, json: async () => ({ k1: PEM }), headers: { get: () => 'public, max-age=20000' } }
    : { ok: false, status: 500, json: async () => ({}), headers: { get: () => '' } }; };
  const odpoved = (req, res) => { volano.odpoved++; res.json({ ok: true, dny: [] }); };
  new Function('app', 'process', 'crypto', 'fetch', 'autoNabijeniOdpoved', CODE)(app, { env }, crypto, fetchMock, odpoved);
  const volej = async (metoda, hlavicky = {}) => {
    let kod = 200, out, h = {};
    const res = { setHeader: (k, v) => { h[k] = v; }, status: c => { kod = c; return res; }, json: v => { out = v; return res; }, end: () => res };
    const lc = {}; for (const k in hlavicky) lc[k.toLowerCase()] = hlavicky[k];
    await routy[metoda + ' /api/auto/nabijeni/fin']({ query: {}, get: k => lc[k.toLowerCase()] }, res);
    return { kod, out, h };
  };
  return { volej, volano };
}
const ORIGIN = 'https://finance-kavq.onrender.com';

(async () => {
  nadpis('1) Přihlášení tokenem z Firebase');
  {
    const b = build();
    let r = await b.volej('GET', { Authorization: 'Bearer ' + token(), Origin: ORIGIN });
    check('platný token majitele → data', [r.kod, b.volano.odpoved].join(' '), '200 1');
    check('  CORS jen pro adresu appky', r.h['Access-Control-Allow-Origin'], ORIGIN);
    r = await b.volej('GET', { Authorization: 'Bearer ' + token(), Origin: 'https://zlo.example' });
    check('  cizí web CORS nedostane', r.h['Access-Control-Allow-Origin'], undefined);
    check('bez přihlášení 401', (await b.volej('GET', {})).kod, 401);
    check('podpis jiným klíčem 401', (await b.volej('GET', { Authorization: 'Bearer ' + token({}, cizi) })).kod, 401);
    check('neznámý kid 401', (await b.volej('GET', { Authorization: 'Bearer ' + token({}, privateKey, 'k9') })).kod, 401);
    check('prošlý token 401', (await b.volej('GET', { Authorization: 'Bearer ' + token({ exp: Math.floor(Date.now() / 1000) - 5 }) })).kod, 401);
    check('jiný projekt Firebase 401', (await b.volej('GET', { Authorization: 'Bearer ' + token({ aud: 'jiny-projekt' }) })).kod, 401);
    check('cizí e-mail 403', (await b.volej('GET', { Authorization: 'Bearer ' + token({ email: 'cizi@example.com' }) })).kod, 403);
    check('neověřený e-mail 403', (await b.volej('GET', { Authorization: 'Bearer ' + token({ email_verified: false }) })).kod, 403);
    check('nesmysl místo tokenu 401', (await b.volej('GET', { Authorization: 'Bearer abc' })).kod, 401);
    check('data se nevydala nikomu jinému', b.volano.odpoved, 2);
    check('certifikáty Googlu se drží v paměti', b.volano.certs, 1);
  }
  nadpis('2) Nastavení');
  {
    check('bez FIN_EMAILS adresa nefunguje (503)', (await build({}).volej('GET', { Authorization: 'Bearer ' + token() })).kod, 503);
    check('Google nedostupný → 502', (await build(undefined, false).volej('GET', { Authorization: 'Bearer ' + token() })).kod, 502);
    const o = await build().volej('OPTIONS', { Origin: ORIGIN });
    check('předletový dotaz prohlížeče', [o.kod, o.h['Access-Control-Allow-Origin'], o.h['Access-Control-Allow-Headers']].join(' '), '204 ' + ORIGIN + ' Authorization');
  }
  konec();
})();
