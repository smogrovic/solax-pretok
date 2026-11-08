// Otisk verze: SHA-256 obsahu index.html (12 znaků), vložený do stránky a na /version.json.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { between, suite } = require('./zdroj');
const { check, konec } = suite('verze');

const CODE = between('// ---------- Otisk verze', "app.use(express.static(");
const routy = {};
new Function('require', 'crypto', 'path', '__dirname', 'app', 'console', CODE)(
  require, crypto, path, path.join(__dirname, '..'), { get: (c, f) => { for (const x of [].concat(c)) routy[x] = f; } }, console);
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const otisk = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);
const volej = cesta => {
  const r = { h: {}, telo: null, typ: null };
  const res = { setHeader: (k, v) => { r.h[k] = v; }, type: t => { r.typ = t; return res; }, send: t => { r.telo = t; }, json: t => { r.telo = t; } };
  routy[cesta]({}, res, () => { r.dal = true; });
  return r;
};
const v = volej('/version.json');
check('version.json: 12 znaků SHA-256 obsahu stránky', JSON.stringify(v.telo), JSON.stringify({ build: otisk }));
check('  bez cache', v.h['Cache-Control'], 'no-cache, no-store, must-revalidate');
const s = volej('/');
check('stránka má otisk v hlavičce', s.telo.includes(`<script>window.APP_BUILD = "${otisk}";</script>\n</head>`), true);
check('  jinak beze změny', s.telo.replace(`<script>window.APP_BUILD = "${otisk}";</script>\n`, '') === html, true);
check('  bez cache, html', [s.h['Cache-Control'], s.typ].join(' '), 'no-cache, no-store, must-revalidate html');
check('/index.html taky', volej('/index.html').telo === s.telo, true);
check('otisk se mění jen se stránkou', crypto.createHash('sha256').update(html + ' ').digest('hex').slice(0, 12) !== otisk, true);
konec();
