// Ověření: velikost aplikace a limity služeb — jen pro správce (první povolený účet)
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('velikost aplikace');
const path = require('path');

const CODE = between('// ---------- Velikost aplikace (jen pro správce) ----------', '// ---------- Hlídač popelnic ----------');

function build({ email = 'spravce@x.cz', prihlaseni = true, github = () => ({ ok: true, json: async () => ({ size: 51200 }) }), env = {} } = {}) {
  const routy = {}, gh = [];
  const api = new Function('require', 'app', 'process', 'prihlaseniZapnute', 'authOver', 'authCookieZ', 'AUTH_EMAILY', 'fetch', '__dirname', 'path',
    'storeVelikosti', 'storeEnabled', 'STORE_KEY', 'storeSnapshot', 'storeEncode',
    CODE + '\n; return { velikostPrehled, velikostSlozky, VELIKOST_LIMITY };')(
    require, { get: (c, f) => { routy[c] = f; } }, { env, memoryUsage: () => ({ rss: 128 * 1048576, heapUsed: 50 * 1048576 }) },
    prihlaseni, () => (email ? { email } : null), () => 'cookie', ['spravce@x.cz', 'druhy@x.cz'],
    async url => { gh.push(url); return github(); }, path.join(__dirname, '..'), path,
    { 'solax:nahrev': 2 * 1048576 }, true, 'solax:stav', () => ({ a: 1 }), () => 'x'.repeat(3 * 1048576));
  const volej = async () => {
    let out, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; }, setHeader: () => {} };
    await routy['/api/velikost']({}, res);
    return { out, kod };
  };
  return { api, volej, gh };
}

(async () => {
  nadpis('1) Kdo to vidí');
  check('správce (první povolený) ano', (await build().volej()).kod, 200);
  check('jiný účet ne', (await build({ email: 'druhy@x.cz' }).volej()).kod, 403);
  check('nepřihlášený ne', (await build({ email: null }).volej()).kod, 403);
  check('bez zapnutého přihlášení ne', (await build({ prihlaseni: false }).volej()).kod, 403);
  check('AUTH_SPRAVCE přepíše správce', (await build({ email: 'druhy@x.cz', env: { AUTH_SPRAVCE: 'Druhy@x.cz' } }).volej()).kod, 200);

  nadpis('2) Co se počítá');
  const h = build();
  const d = (await h.volej()).out;
  check('kód bez node_modules a .git', d.kod.b > 1e6 && d.kod.souboru > 20 && !/node_modules|\.git\//.test(d.kod.nejvetsi.nazev), true);
  check('  index.html a server.js', d.kod.indexHtml > 5e5 && d.kod.serverJs > 5e5, true);
  check('  největší soubor je z kódu', d.kod.nejvetsi.b >= d.kod.indexHtml, true);
  check('repozitář z GitHubu v bajtech (size je v KB)', d.github.b, 51200 * 1024);
  check('  veřejné API, správný repozitář', h.gh[0], 'https://api.github.com/repos/smogrovic/solax-pretok');
  await h.volej();
  check('  GitHub se ptá nejvýš jednou za hodinu', h.gh.length, 1);
  check('paměť z procesu', d.pamet.rss, 128 * 1048576);
  check('úložiště: zapsané i spočítaná hlavní záloha, největší první', d.uloziste.zaznamy.map(z => z.k + '=' + z.b / 1048576).join(), 'stav=3,nahrev=2');
  check('  celkem a největší', d.uloziste.celkem / 1048576 + ' ' + d.uloziste.nejvetsi / 1048576, '5 3');
  check('limity', JSON.stringify([d.limity.githubSoubor, d.limity.githubRepo, d.limity.renderRam, d.limity.upstashZaznam, d.limity.upstashData].map(b => b / 1048576)), '[100,1024,512,10,256]');
  check('  RAM jde přepsat', (await build({ env: { RENDER_RAM_MB: '2048' } }).volej()).out.limity.renderRam / 1048576, 2048);
  const chyba = await build({ github: () => ({ ok: false, status: 403 }) }).volej();
  check('GitHub nedostupný: bez čísla a s důvodem', chyba.out.github.b + ' ' + chyba.out.github.chyba, 'null HTTP 403');
  konec();
})().catch(e => { console.log('CHYBA ' + e.stack); konec(); });
