// Most vysavače Xiaomi na NASu: čte stav z cloudu, hlásí appce, provádí povely.
//
// Co se tu hlídá:
//  * Most spíná JEN na úkol z appky a jen tři známé povely (vysát, stop, dok).
//    Úklid místností schválně neumí — vysavač čísluje místnosti po svém.
//  * Čísla stavů se překládají ze specifikace (value-list), ne natvrdo.
//  * Vypršelé přihlášení se appce řekne, místo aby most tiše mlčel.
//  * Přihlášení (klíč k účtu) se ukládá jen pro roota a do hlášení appce nejde.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('vysavač — most');

const M = require('../public/nas/vysavac-most.js');
const V = require('../public/nas/vysavac-test.js');

const RELACE = {
  ssecurity: Buffer.from('ssecurity-klic-16').toString('base64'), serviceToken: 'TAJNY-TOKEN',
  userId: '1', cUserId: 'c', region: 'de', varianta: 'prosta', did: '1066125993',
  model: 'xiaomi.vacuum.c102gl', jmeno: 'X20+', ulozeno: '2026-09-25T10:00:00Z'
};
const SPEC = { services: [
  { iid: 2, properties: [
    { iid: 1, 'value-list': [{ value: 1, description: 'Sweeping' }, { value: 13, description: 'Charging Completed' }] },
    { iid: 2, 'value-list': [{ value: 0, description: 'No Error' }, { value: 68, description: 'Low Battery' }] }] },
  { iid: 4, properties: [{ iid: 7, 'value-list': [{ value: 0, description: 'Idle' }] }] }
] };
const HODNOTY = [
  [2, 1, 13], [2, 2, 0], [3, 1, 100], [3, 2, 1], [4, 2, 0], [4, 3, 0], [4, 7, 0], [9, 2, 24], [11, 1, 37], [18, 1, 20]
].map(([siid, piid, value]) => ({ siid, piid, value, code: 0 }));

// Falešný cloud Xiaomi (fetch pro dotaz()) a falešná appka
function podstrc({ hodnoty = HODNOTY, akce = () => ({ code: 0, result: { code: 0 } }), ukoly = [], prop = null } = {}) {
  const videno = { cloud: [], appka: [] };
  const puvodni = { spec: V.nactiSpec, urn: V.najdiUrn };
  V.najdiUrn = async () => 'urn:x';
  V.nactiSpec = async () => SPEC;
  let prvni = true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/vysavac/stav')) {
      videno.appka.push(JSON.parse(opts.body));
      const ven = prvni ? ukoly : [];
      prvni = false;
      return { ok: true, status: 200, json: async () => ({ ok: true, ukoly: ven }) };
    }
    const cesta = new URL(u).pathname;
    videno.cloud.push({ cesta, telo: opts.body ? new URLSearchParams(String(opts.body)).get('data') : null });
    const odpoved = cesta.endsWith('/miotspec/prop/get') ? (prop ? prop() : { code: 0, result: hodnoty })
      : cesta.endsWith('/miotspec/action') ? akce()
      : { code: 0, result: {} };
    if (odpoved.status) return { ok: false, status: odpoved.status, text: async () => '' };
    return { ok: true, status: 200, text: async () => JSON.stringify(odpoved) };
  };
  videno.vrat = () => { V.nactiSpec = puvodni.spec; V.najdiUrn = puvodni.urn; };
  return videno;
}

const NASTAVENI = { appka: 'https://appka.test', region: 'de', interval: 30 };
const tiche = () => {};
const puvodniFetch = globalThis.fetch;

(async () => {
  nadpis('1) Kolo bez povelů');
  {
    const v = podstrc();
    const pamet = { relace: RELACE };
    const ok = await M.kolo(NASTAVENI, pamet, tiche);
    v.vrat();
    const s = v.appka[0];
    check('kolo proběhne', ok, true);
    check('appka dostane stav', v.appka.length, 1);
    check('  stav slovy ze specifikace', s.status.kod + ' ' + s.status.popis, '13 Charging Completed');
    check('  porucha taky', s.porucha.popis, 'No Error');
    check('  baterie, nabíjení', s.baterie + ' ' + s.nabiji, '100 true');
    check('  opotřebení', [s.kartac, s.filtr, s.mop].join(','), '24,37,20');
    check('čte se jen prop/get', v.cloud.every(c => c.cesta.endsWith('/miotspec/prop/get')), true);
    check('  všech deset vlastností naráz', JSON.parse(v.cloud[0].telo).params.length, 10);
    check('bez úkolu se nic nespíná', v.cloud.some(c => c.cesta.endsWith('/miotspec/action')), false);
    check('klíč k účtu do appky nejde', JSON.stringify(s).includes('TAJNY-TOKEN'), false);
    check('místnosti zatím žádné (vlastní číslování vysavače)', s.mistnosti.length, 0);
  }

  nadpis('2) Povely');
  for (const [typ, siid, aiid] of [['uklid', 2, 1], ['stop', 2, 2], ['dok', 3, 1]]) {
    const v = podstrc({ ukoly: [{ typ }] });
    await M.kolo(NASTAVENI, { relace: RELACE }, tiche);
    v.vrat();
    const akce = v.cloud.filter(c => c.cesta.endsWith('/miotspec/action'));
    const p = akce.length ? JSON.parse(akce[0].telo).params : {};
    check(`${typ} → ${siid}/${aiid}`, akce.length + ' ' + p.siid + '/' + p.aiid + ' ' + p.did, `1 ${siid}/${aiid} 1066125993`);
    check(`  a hned se pošle nový stav s výsledkem`, v.appka.length === 2 && v.appka[1].posledniPovel.ok, true);
  }
  {
    const v = podstrc({ ukoly: [{ typ: 'mistnosti', ids: ['1'] }, { typ: 'vyhodit' }, null] });
    const radky = [];
    await M.kolo(NASTAVENI, { relace: RELACE }, t => radky.push(t));
    v.vrat();
    check('neznámé úkoly (i místnosti) se zahodí', v.cloud.some(c => c.cesta.endsWith('/miotspec/action')), false);
    check('  a řekne se to', radky.filter(r => /zahozen/.test(r)).length, 3);
  }
  {
    const v = podstrc({ ukoly: [{ typ: 'dok' }], akce: () => ({ code: 0, result: { code: -704 } }) });
    const pamet = { relace: RELACE };
    await M.kolo(NASTAVENI, pamet, tiche);
    v.vrat();
    check('odmítnutý povel jde appce i s kódem', v.appka[1].posledniPovel.ok + ' ' + /-704/.test(v.appka[1].posledniPovel.zprava), 'false true');
  }

  nadpis('3) Přihlášení');
  {
    const v = podstrc({ prop: () => ({ status: 401 }) });
    const pamet = { relace: RELACE };
    await M.kolo(NASTAVENI, pamet, tiche);
    v.vrat();
    check('odmítnuté přihlášení se appce řekne', v.appka[0].relaceVyprsela, true);
    check('  s radou, co spustit', /--prihlas/.test(v.appka[0].chyba), true);
    check('  a most si to pamatuje', pamet.vyprselo, true);
    const v2 = podstrc({ ukoly: [{ typ: 'uklid' }] });
    await M.kolo(NASTAVENI, pamet, tiche);
    v2.vrat();
    check('s vypršelým přihlášením se nespíná', v2.cloud.some(c => c.cesta.endsWith('/miotspec/action')), false);
  }
  {
    const v = podstrc({ prop: () => ({ status: 502 }) });
    const pamet = { relace: RELACE };
    await M.kolo(NASTAVENI, pamet, tiche);
    v.vrat();
    check('výpadek cloudu není vypršelé přihlášení', v.appka[0].relaceVyprsela + ' ' + !!pamet.vyprselo, 'false false');
  }
  {
    const slozka = fs.mkdtempSync(path.join(os.tmpdir(), 'vysavac-most-'));
    const cesta = path.join(slozka, 'vysavac.relace.json');
    const v = podstrc();
    await M.kolo(NASTAVENI, {}, tiche, cesta);
    v.vrat();
    check('bez přihlášení most řekne, co spustit', /--prihlas/.test(v.appka[0].chyba), true);
    M.ulozRelaci(RELACE, cesta);
    check('přihlášení se uloží a načte', M.nactiRelaci(cesta).did, RELACE.did);
    check('  čitelné jen pro vlastníka', (fs.statSync(cesta).mode & 0o777).toString(8), '600');
    fs.writeFileSync(cesta, '{"nic":1}');
    check('neúplné přihlášení se nebere', M.nactiRelaci(cesta), null);
    fs.rmSync(slozka, { recursive: true, force: true });
  }
  check('HTTP 401 je vypršení', M.jeVyprseni(new Error('/miotspec/prop/get: HTTP 401')), true);
  check('HTTP 502 není', M.jeVyprseni(new Error('/miotspec/prop/get: HTTP 502')), false);

  nadpis('4) Popisy ze specifikace');
  check('známé číslo má popis', M.popisZeSpec(SPEC, 2, 1, 1), 'Sweeping');
  check('neznámé číslo popis nemá (žádné vymýšlení)', M.popisZeSpec(SPEC, 2, 1, 99), null);
  check('bez specifikace taky nic', M.popisZeSpec(null, 2, 1, 1), null);

  globalThis.fetch = puvodniFetch;
  konec();
})().catch(err => {
  globalThis.fetch = puvodniFetch;
  check('sada doběhla bez výjimky', err && err.stack, '(nic)');
  konec();
});
