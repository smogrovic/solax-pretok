// Záloha do souboru: data bez tajností + soubory aplikace; obnova jen dat
const path = require('path');
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('záloha do souboru');

const CODE = between('// ---------- Záloha do souboru (data i aplikace) ----------', '// ---------- Rohlík (košík) ----------');
const KOREN = path.join(__dirname, '..');

function build(o = {}) {
  const routy = {}, logy = [], volani = [];
  const state = { topeni: { zaznamy: [{ t: 1, dumW: 900 }] } };
  const snap = {
    v: 1, at: 123,
    posts: { '/api/log/restore': { entries: [{ t: 1, msg: 'x' }] }, '/api/sauna/nahrev/restore': { zaznamy: [{ start: 1 }] } },
    primo: { wbAuto: true, rohlikOauth: { token: 'TAJNE' }, rohlikWebCookies: 'COOKIE', push: [{ endpoint: 'e' }], saunaRelace: { od: 0 } }
  };
  const app = { get: (c, ...h) => { routy['GET ' + c] = h[h.length - 1]; }, post: (c, ...h) => { routy['POST ' + c] = h[h.length - 1]; } };
  const api = new Function('require', '__dirname', 'app', 'express', 'requireAuth', 'storeSnapshot', 'state', 'pragueDateString',
    'storeApplyPrimo', 'storeObnovPosts', 'topeniObnov', 'addLog', 'storeUlozBrzy', 'STORE_POSTS', 'PORT',
    CODE + '\n; return { zalohaSoubory, zalohaData, ZALOHA_NE };')(
    require, KOREN, app, { json: () => (q, s, n) => n() },
    (req, res) => { if (!o.zamceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    () => JSON.parse(JSON.stringify(snap)), state, () => '2026-11-02',
    p => volani.push('primo:' + Object.keys(p).sort().join(',')),
    async (port, posts) => { volani.push('posts:' + port + ':' + Object.keys(posts).length); return Object.keys(posts).length; },
    t => volani.push('topeni:' + t.zaznamy.length), t => logy.push(t), () => volani.push('ulozit'),
    ['/api/log/restore', '/api/sauna/nahrev/restore', '/api/nakup/restore'], 3000);
  const volej = async (k, body) => {
    let out, kod = 200; const hlavicky = {};
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; }, setHeader: (a, b) => { hlavicky[a] = b; } };
    await routy[k]({ body, socket: { localPort: 4321 } }, res);
    return { out, kod, hlavicky };
  };
  return { api, volej, logy, volani };
}

(async () => {
  nadpis('Stažení');
  const h = build();
  const r = await h.volej('GET /api/zaloha');
  check('soubor ke stažení s datem', r.hlavicky['Content-Disposition'], 'attachment; filename="solinator-zaloha-2026-11-02.json"');
  const d = r.out.data;
  check('data: snímek jako do Upstash + topení', [Object.keys(d.posts).length, d.topeni.zaznamy.length, d.primo.wbAuto].join(' '), '2 1 true');
  check('bez přihlášení k Rohlíku a push odběrů', ['rohlikOauth', 'rohlikWebCookies', 'push'].filter(k => k in d.primo).join(',') || 'nic', 'nic');
  check('  ani nikde v datech', /TAJNE|COOKIE/.test(JSON.stringify(r.out.data)), false);
  const s = r.out.aplikace.soubory;
  check('aplikace: server, appka, data, jídelníček', ['server.js', 'package.json', 'public/index.html', 'public/sw.js', 'data/spotreba-historie.json',
    'jidelnicek/UKOL.md', 'README.md'].filter(f => typeof s[f] !== 'string').join(',') || 'vše', 'vše');
  check('  server je celý', s['server.js'] === require('fs').readFileSync(path.join(KOREN, 'server.js'), 'utf8'), true);
  check('  ikona jako base64', typeof s['public/icon-180.png'].base64 === 'string'
    && Buffer.from(s['public/icon-180.png'].base64, 'base64').subarray(1, 4).toString(), 'PNG');
  check('  testy a node_modules ne', Object.keys(s).some(f => f.startsWith('test/') || f.includes('node_modules')), false);
  check('  počet souborů sedí', r.out.aplikace.souboru, Object.keys(s).length);
  check('konfigurace NASu s hesly se vynechá', ['public/nas/zavlaha.config.json', 'auto.tokeny.json', 'public/nas/vysavac.relace.json', '.env', 'x/__pycache__/a.pyc']
    .filter(f => !h.api.ZALOHA_NE.test(f)).join(',') || 'vše vynecháno', 'vše vynecháno');
  check('  běžné soubory projdou', ['public/nas/zavlaha-most.js', 'data/spotreba-historie.json'].some(f => h.api.ZALOHA_NE.test(f)), false);
  check('zamčeno → 401', (await build({ zamceno: true }).volej('GET /api/zaloha')).kod, 401);

  nadpis('Obnova');
  const o = build();
  const zpet = await o.volej('POST /api/zaloha/obnovit', { data: { posts: d.posts, primo: { wbAuto: false, rohlikOauth: { x: 1 } }, topeni: d.topeni } });
  check('obnoví části přes restore endpointy', JSON.stringify(zpet.out), '{"ok":true,"obnoveno":2,"celkem":3}');
  check('  primo bez tajností, posty na vlastní port, topení, uložit', o.volani.join(' | '), 'primo:wbAuto | posts:4321:2 | topeni:1 | ulozit');
  check('  zapíše se do logu', o.logy[0], 'Záloha: data obnovena ze souboru (2/3 částí)');
  const cely = build();
  check('jde poslat i celý soubor (data + aplikace)', (await cely.volej('POST /api/zaloha/obnovit', r.out)).out.obnoveno, 2);
  check('nesmysl → 400', (await build().volej('POST /api/zaloha/obnovit', { neco: 1 })).kod, 400);
  check('zamčeno → 401', (await build({ zamceno: true }).volej('POST /api/zaloha/obnovit', { data: d })).kod, 401);

  nadpis('Zapojení');
  const SRC = require('fs').readFileSync(path.join(KOREN, 'server.js'), 'utf8');
  check('obecný parser obnovu přeskočí (vlastní limit 20 MB)',
    /req\.path === '\/api\/zaloha\/obnovit' \? next\(\) : jsonBezne/.test(SRC) && /express\.json\(\{ limit: '20mb' \}\)/.test(SRC), true);
  check('obnova po startu jde stejnou cestou', /const obnoveno = await storeObnovPosts\(port, snap\.posts\);/.test(SRC), true);
  konec();
})();
