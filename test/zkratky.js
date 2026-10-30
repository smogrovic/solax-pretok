// Pokyny ze zkratek iPhonu: „jdu spát" zhasne noční světla, „probuzení" je rozsvítí
// a pustí oběhové čerpadlo na pár minut. Při „Nejsme doma" se pokyn ignoruje.
const crypto = require('crypto');
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('zkratky');

const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const CODE = between('// ---------- Pokyny ze zkratek iPhonu ----------', '// ---------- Trvalé úložiště');

function build(o = {}) {
  const routy = {}, zpravy = [], logy = [], akce = [];
  const state = o.state || {};
  const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
  const api = new Function('state', 'app', 'requireAuth', 'addLog', 'broadcast', 'actuateRelay', 'autoSet', 'awayOn',
    'safeEqual', 'fmtPragueTime', 'obehOknoNyni', 'process', 'obehOknoPreskocit', 'scenaZaluzie', 'tahomaEnabled',
    CODE + '\n; return { zkratkaProvest, zkratkyOver, zkratkyObehHlidej, zkratkyPayload };')(
    state, { post: (c, f) => { routy[c] = f; } },
    (req, res) => { if (!o.zamceno) return true; res.status(401).json({ error: 'zamčeno' }); return false; },
    t => logy.push(t), u => zpravy.push(u),
    async (key, on, duvod) => { if (o.selze === key) throw new Error('Shelly nereaguje'); akce.push(`${key}:${on ? 'on' : 'off'} (${duvod})`); },
    async (key, turn, duvod, opt) => { akce.push(`auto:${key}:${turn} (${duvod})${opt && opt.force ? ' force' : ''}`); return true; },
    () => !!o.pryc, safeEqual, t => new Date(t).toISOString().slice(11, 16),
    () => (o.okno || null), { env: o.env || {} },
    now => { akce.push('preskocit okno'); return o.okno || null; },
    async () => { if (o.selze === 'zaluzie') throw new Error('TaHoma nereaguje'); akce.push('žaluzie dolů'); return 'Žaluzie: dolů.'; },
    o.tahoma !== false);
  const volej = async (cesta, body, hlavicky = {}) => {
    let out, kod = 200;
    const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
    await routy[cesta]({ body, get: k => hlavicky[k] }, res);
    return { out, kod };
  };
  return { api, state, logy, akce, zpravy, volej };
}

(async () => {
  nadpis('Pokyny');
  {
    const h = build();
    const r = await h.volej('/api/zkratka', { udalost: 'spanek', kdo: 'Lukáš' });
    check('jdu spát: zhasne noční světla', r.kod + ' ' + h.akce.join() + ' | ' + r.out.reply, '200 lightNocni:off (jdu spát) | Noční světla zhasnuta.');
    check('  log s kým', h.logy.pop(), 'Jdu spát (Lukáš): noční světla zhasnuta');
    const t0 = Date.UTC(2026, 9, 30, 5, 30);
    const odp = await h.api.zkratkaProvest('probuzeni', 'Lukáš', t0);
    check('probuzení: světla a oběh', h.akce.slice(1).join(', '), 'lightNocni:on (probuzení), obeh:on (probuzení)');
    check('  odpověď', odp, 'Noční světla rozsvícena, oběhové čerpadlo na 15 min.');
    check('  oběh do +15 min', h.state.zkratky.obehDo - t0, 15 * 60000);
    check('  naposledy', JSON.stringify(h.state.zkratky.posledni.probuzeni), JSON.stringify({ kdy: t0, kdo: 'Lukáš', vysledek: 'noční světla rozsvícena, oběhové čerpadlo na 15 min' }));
    check('  appka se dozví', h.zpravy.includes('zkratky'), true);
    // budík a „Probuzení" přijdou krátce po sobě
    const znovu = await h.api.zkratkaProvest('probuzeni', 'Lukáš', t0 + 10 * 60000);
    check('do 30 min se neopakuje', znovu + ' ' + h.akce.length, 'Už proběhlo v 05:30. 3');
    await h.api.zkratkaProvest('probuzeni', '', t0 + 31 * 60000);
    check('po 30 min znovu', h.akce.length, 5);
    check('neznámá událost 400', (await h.volej('/api/zkratka', { udalost: 'tanec' })).kod, 400);
  }
  {
    const h = build({ pryc: true });
    const r = await h.volej('/api/zkratka', { udalost: 'probuzeni' });
    check('nejsme doma: nic se nezapne', r.out.reply + ' ' + h.akce.length, 'Nejsme doma — pokyn se ignoruje. 0');
    check('  ale v logu je vidět, že přišel', h.logy.pop(), 'Probuzení: nejsme doma — pokyn ignorován');
    check('  a nepočítá se jako proběhlý', h.state.zkratky.posledni.probuzeni, null);
  }
  {
    const h = build();
    h.state.zkratky.probuzeni = { nocniSvetla: false, obehMin: 0 };
    const r = await h.api.zkratkaProvest('probuzeni', '');
    check('vypnuté volby: nic', r + ' ' + h.akce.length, 'Nic nastaveno. 0');
  }
  {
    const h = build({ selze: 'lightNocni' });
    const r = await h.api.zkratkaProvest('probuzeni', '');
    check('chyba světel: čerpadlo stejně běží, chyba v odpovědi', h.akce.join() + ' | ' + r, 'obeh:on (probuzení) | Noční světla rozsvícena — chyba (Shelly nereaguje), oběhové čerpadlo na 15 min.');
  }

  {
    const h = build();
    const t = Date.now();
    await h.api.zkratkaProvest('spanek', 'L', t);
    const r = await h.volej('/api/zkratky/zkouska', { udalost: 'spanek' });
    check('vyzkoušet z appky: proběhne i hned po pokynu, nepočítá se', r.out.reply + ' ' + h.akce.length + ' ' + (h.state.zkratky.posledni.spanek.kdy === t), 'Noční světla zhasnuta. 2 true');
  }

  nadpis('Zamčení a odemčení');
  {
    const h = build();
    h.state.zkratky.obehDo = 5000;
    const r = await h.volej('/api/zkratka', { udalost: 'zamceni', kdo: 'Lukáš' });
    check('zamčení: oběh vypnout (natvrdo), okno přeskočit, žaluzie dolů', h.akce.join(', '), 'preskocit okno, auto:obeh:off (zamčení) force, žaluzie dolů');
    check('  odpověď', r.out.reply, 'Oběhové čerpadlo vypnuto, žaluzie zataženy.');
    check('  konec probuzení zrušen', h.state.zkratky.obehDo, 0);
    check('  log', h.logy.pop(), 'Zamčení (Lukáš): oběhové čerpadlo vypnuto, žaluzie zataženy');
    check('  Nejsme doma se nepřepíná (žádná taková závislost)', /awaySet|state\.away\s*=/.test(CODE), false);
    const t0 = Date.UTC(2026, 9, 30, 22, 0);
    const o = await h.api.zkratkaProvest('odemceni', 'Lukáš', t0);
    check('odemčení: noční světla', o + ' ' + h.akce.slice(3).join(), 'Noční světla rozsvícena. lightNocni:on (odemčení)');
    const znovu = await h.api.zkratkaProvest('odemceni', '', t0 + 60000);
    check('do 2 min se neopakuje', znovu, 'Už proběhlo v 22:00.');
    await h.api.zkratkaProvest('odemceni', '', t0 + 3 * 60000);
    check('po 3 min znovu svítí', h.akce.length, 5);
  }
  {
    const h = build({ selze: 'zaluzie' });
    const r = await h.api.zkratkaProvest('zamceni', '');
    check('chyba žaluzií: čerpadlo stejně vypne', h.akce.join() + ' | ' + r, 'preskocit okno,auto:obeh:off (zamčení) force | Oběhové čerpadlo vypnuto, žaluzie zataženy — chyba (TaHoma nereaguje).');
    const b = build({ tahoma: false });
    check('bez TaHomy chyba, ne „zataženy"', await b.api.zkratkaProvest('zamceni', ''), 'Oběhové čerpadlo vypnuto, žaluzie zataženy — chyba (nejsou nastavené).');
    const v = build();
    v.state.zkratky.zamceni = { obeh: false, zaluzie: false };
    v.state.zkratky.odemceni = { nocniSvetla: false };
    check('vypnuté volby: nic', (await v.api.zkratkaProvest('zamceni', '')) + ' ' + (await v.api.zkratkaProvest('odemceni', '')) + ' ' + v.akce.length, 'Nic nastaveno. Nic nastaveno. 0');
    const p = build({ pryc: true });
    check('nejsme doma: zamčení i odemčení ignoruje', (await p.api.zkratkaProvest('zamceni', '')) + ' ' + (await p.api.zkratkaProvest('odemceni', '')) + ' ' + p.akce.length,
      'Nejsme doma — pokyn se ignoruje. Nejsme doma — pokyn se ignoruje. 0');
  }

  nadpis('Klíč');
  {
    const h = build({ env: { ZKRATKY_KLIC: 'tajne-123' } });
    check('bez hlavičky 401', (await h.volej('/api/zkratka', { udalost: 'spanek' })).kod, 401);
    check('špatný klíč 401', (await h.volej('/api/zkratka', { udalost: 'spanek' }, { 'X-Klic': 'jiny' })).kod, 401);
    check('správný klíč', (await h.volej('/api/zkratka', { udalost: 'spanek' }, { 'X-Klic': 'tajne-123' })).kod, 200);
    check('appka ví jen, že je nastaven', JSON.stringify(h.api.zkratkyPayload()).includes('tajne') + ' ' + h.api.zkratkyPayload().klic, 'false true');
  }

  nadpis('Konec oběhu');
  {
    const h = build();
    h.state.zkratky.obehDo = 1000;
    await h.api.zkratkyObehHlidej(999);
    check('před koncem nic', h.akce.length, 0);
    await h.api.zkratkyObehHlidej(1000);
    check('po konci vypne (natvrdo)', h.akce.join() + ' ' + h.state.zkratky.obehDo, 'auto:obeh:off (konec probuzení) force 0');
    const o = build({ okno: '06:00–07:00' });
    o.state.zkratky.obehDo = 1000;
    await o.api.zkratkyObehHlidej(2000);
    check('v okně rozvrhu nechá běžet', o.akce.length + ' ' + o.state.zkratky.obehDo, '0 0');
  }

  nadpis('Nastavení');
  {
    const h = build();
    const r = await h.volej('/api/zkratky/nastaveni', { nastaveni: { probuzeni: { nocniSvetla: false, obehMin: 30 }, spanek: { nocniSvetla: true } } });
    check('uložení', r.kod + ' ' + JSON.stringify(h.state.zkratky.probuzeni), '200 {"nocniSvetla":false,"obehMin":30}');
    check('  minuty jen z nabídky', (await h.volej('/api/zkratky/nastaveni', { nastaveni: { probuzeni: { obehMin: 7 }, spanek: {} } })).kod, 400);
    await h.volej('/api/zkratky/restore', { nastaveni: { probuzeni: { nocniSvetla: true, obehMin: 15 }, spanek: { nocniSvetla: true } } });
    check('  záloha nepřepíše upravené', h.state.zkratky.probuzeni.obehMin, 30);
    check('  zamčeno 401', (await build({ zamceno: true }).volej('/api/zkratky/nastaveni', { nastaveni: {} })).kod, 401);
    const z = build();
    await z.volej('/api/zkratky/restore', { nastaveni: { probuzeni: { nocniSvetla: true, obehMin: 10 }, spanek: { nocniSvetla: false } },
      obehDo: Date.now() + 60000, posledni: { spanek: { kdy: 123, kdo: 'L', vysledek: 'x' } } });
    check('obnova ze zálohy', [z.state.zkratky.probuzeni.obehMin, z.state.zkratky.obehDo > Date.now(), z.state.zkratky.posledni.spanek.kdy].join(' '), '10 true 123');
    check('  stará záloha bez zamčení: výchozí', JSON.stringify([z.state.zkratky.zamceni, z.state.zkratky.odemceni]), '[{"obeh":true,"zaluzie":true},{"nocniSvetla":true}]');
    const n = build();
    await n.volej('/api/zkratky/nastaveni', { nastaveni: { probuzeni: { nocniSvetla: true, obehMin: 15 }, spanek: { nocniSvetla: true },
      zamceni: { obeh: true, zaluzie: false }, odemceni: { nocniSvetla: false } } });
    check('  uložení zamčení/odemčení', JSON.stringify([n.state.zkratky.zamceni, n.state.zkratky.odemceni]), '[{"obeh":true,"zaluzie":false},{"nocniSvetla":false}]');
    await n.volej('/api/zkratky/restore', { nastaveni: { probuzeni: { obehMin: 15 }, spanek: {} }, posledni: { zamceni: { kdy: 77, kdo: null, vysledek: 'x' } } });
    check('  naposledy zamčení ze zálohy', n.state.zkratky.posledni.zamceni.kdy, 77);
  }
  check('záloha a snapshot', SRC.includes("'/api/zkratky/restore',") && SRC.includes("'/api/zkratky/restore': (z => ({ nastaveni: { probuzeni: z.probuzeni, spanek: z.spanek, zamceni: z.zamceni, odemceni: z.odemceni }") && SRC.includes('zkratky: zkratkyPayload(),'), true);
  check('hlídání konce oběhu běží', /scheduleEvery\(\(\) => zkratkyObehHlidej\(\)/.test(SRC), true);
  konec();
})();
