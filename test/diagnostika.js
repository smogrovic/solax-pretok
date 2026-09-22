// Diagnostika: log, stav a posledních pár set odchozích volání na jedno klepnutí.
//
// Proč tahle sada existuje: ten výpis se posílá do chatu. Kdyby se z něj
// neproškrtly klíče, jednou za čas by tam proletěl token k Anthbotu, heslo
// k Xiaomi nebo odkaz na pracovní rozpis — a nikdo by si toho nevšiml, protože
// se nikdo nedívá na sto řádků JSONu.
//
// Druhá věc: obal kolem `fetch` sedí v cestě VŠEM odchozím voláním v appce.
// Kdyby spolkl odpověď, přestala by fungovat půlka domu. Proto se hlídá, že
// volajícímu vrací to, co dostal, a že při pádu chybu nespolkne.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('diagnostika');

const CODE = between('// ---------- Diagnostika ----------',
                     '// ---------- Keep-alive a start ----------');

function build() {
  const state = { log: [], assistantLog: [] };
  const routy = {};
  const api = new Function('state', 'app', 'snapshot', 'process',
    CODE + '\n; return { diagAdresa, diagOcisti, diagZapis, diagObalFetch,'
         + ' DIAG_MAX, DIAG_TELO_MAX, DIAG_VYNECHAT, volani: diagVolani };'
  )(
    state,
    { get: (cesta, fn) => { routy['GET ' + cesta] = fn; } },
    () => ({ pool: { on: true }, history: [1, 2, 3], log: ['x'], timeline: {}, sekacka: { stav: 'idle' } }),
    { uptime: () => 60 }
  );
  return { api, state, routy };
}

const volej = (h, cesta) => {
  let out = null;
  h.routy[cesta]({}, { json: v => { out = v; } });
  return out;
};

const puvodniFetch = globalThis.fetch;

(async () => {

nadpis('1) Z adresy se škrtají klíče');
{
  const h = build();
  check('obyčejná adresa projde', h.api.diagAdresa('https://api.anthbot.com/api/v1/login'),
    'api.anthbot.com/api/v1/login');
  // Přesně ten odkaz, co se posílal do chatu jako obyčejná adresa
  check('odkaz na rozpis se proškrtne',
    h.api.diagAdresa('https://dutylog-web.vercel.app/api/calendar/feed?t=9962e897-tajne.626Bw04'),
    'dutylog-web.vercel.app/api/calendar/feed?t=%E2%80%A6');
  check('  a tajemství v něm nezůstane',
    h.api.diagAdresa('https://x.cz/a?t=tajne').includes('tajne'), false);
  check('token v adrese taky', h.api.diagAdresa('https://x.cz/a?token=abc&b=1').includes('abc'), false);
  check('  a ostatní parametry zůstanou',
    h.api.diagAdresa('https://x.cz/a?token=abc&b=1').includes('b=1'), true);
  check('podpis se škrtá', h.api.diagAdresa('https://x.cz/a?signature=xyz').includes('xyz'), false);
  check('nesmyslná adresa nespadne', h.api.diagAdresa('tohle není url').length > 0, true);
}

nadpis('2) Z odpovědí se škrtají tajnosti');
{
  const h = build();
  const oc = h.api.diagOcisti;
  check('bearer token z Anthbotu', oc('{"code":0,"data":{"access_token":"eyJhbGci"}}'),
    '{"code":0,"data":{"access_token":"…"}}');
  check('ssecurity od Xiaomi', oc('{"ssecurity":"AbCd+/=","userId":123}').includes('AbCd'), false);
  check('  ale userId zůstane', oc('{"ssecurity":"x","userId":123}').includes('123'), true);
  check('dočasné klíče AWS', oc('{"secret_access_key":"tajne","region_name":"eu"}').includes('tajne'), false);
  check('  a region zůstane', oc('{"secret_access_key":"t","region_name":"eu"}').includes('eu'), true);
  check('heslo v jakémkoli tvaru', oc('{"heslo":"x","password":"y"}'), '{"heslo":"…","password":"…"}');
  check('velká písmena nevadí', oc('{"Access_Token":"abc"}').includes('abc'), false);
  check('obyčejná odpověď se nemění', oc('{"stav":"idle","baterie":87}'), '{"stav":"idle","baterie":87}');
  check('prázdno nespadne', oc(null), '');
}

nadpis('3) Zásobník drží jen posledních pár set');
{
  const h = build();
  for (let i = 0; i < h.api.DIAG_MAX + 50; i++) h.api.diagZapis({ kdy: String(i) });
  check('nepřeteče', h.api.volani.length, h.api.DIAG_MAX);
  check('  a drží ty poslední', h.api.volani[h.api.volani.length - 1].kdy, String(h.api.DIAG_MAX + 49));
  check('  ty nejstarší vypadly', h.api.volani[0].kdy, '50');
}

nadpis('4) Obal kolem fetch nesmí nic rozbít');
{
  const h = build();
  let videno = null;
  // Skutečná odpověď má tělo na JEDNO přečtení. Kdyby si ho vzal obal, volající
  // by našel prázdno — a to je půlka domu. Fixtura se proto chová stejně:
  // druhé čtení téhož těla vyhodí chybu, klon má vlastní.
  const teloJednou = text => {
    let precteno = false;
    return async () => {
      if (precteno) throw new TypeError('body already read');
      precteno = true;
      return text;
    };
  };
  const ODPOVED = '{"access_token":"tajne","stav":"ok"}';
  globalThis.fetch = async (url, opts) => {
    videno = { url: String(url), metoda: opts && opts.method };
    return {
      status: 200,
      clone: () => ({ text: teloJednou(ODPOVED) }),
      text: teloJednou(ODPOVED)
    };
  };
  h.api.diagObalFetch();
  const res = await globalThis.fetch('https://x.cz/a?token=abc', { method: 'POST' });
  check('volající dostane svou odpověď', res.status, 200);
  // Tělo se čte z klonu — kdyby se četlo z originálu, volající by našel prázdno
  check('  a tělo si může přečíst', (await res.text()).includes('ok'), true);
  check('dotaz dorazil, kam měl', videno.url, 'https://x.cz/a?token=abc');
  check('  se svou metodou', videno.metoda, 'POST');

  const z = h.api.volani[h.api.volani.length - 1];
  check('volání se zaznamenalo', z.kam, 'x.cz/a?token=%E2%80%A6');
  check('  s metodou', z.metoda, 'POST');
  check('  se stavem', z.stav, 200);
  check('  a s dobou', typeof z.ms, 'number');
  check('  odpověď je proškrtnutá', z.odpoved.includes('tajne'), false);
  check('  ale zbytek v ní je', z.odpoved.includes('"stav":"ok"'), true);

  // Dvojí obalení by každé volání zapsalo dvakrát
  const predtim = h.api.volani.length;
  h.api.diagObalFetch();
  await globalThis.fetch('https://x.cz/b');
  check('obalit dvakrát nejde', h.api.volani.length - predtim, 1);

  // Pád se nesmí spolknout — jinak by se appka tvářila, že je všechno v pořádku
  globalThis.fetch = puvodniFetch;
  globalThis.fetch = async () => { throw new Error('fetch failed'); };
  h.api.diagObalFetch();
  let chyba = '';
  try { await globalThis.fetch('https://y.cz/c'); } catch (e) { chyba = e.message; }
  check('chyba projde dál', chyba, 'fetch failed');
  const zc = h.api.volani[h.api.volani.length - 1];
  check('  a zapíše se', zc.stav, 'chyba');
  check('  i s důvodem', zc.odpoved, 'fetch failed');
  globalThis.fetch = puvodniFetch;
}

nadpis('5) Endpoint');
{
  const h = build();
  h.state.log = [{ t: 1, msg: 'něco' }];
  h.state.assistantLog = [{ t: 2, text: 'zapnul bojler' }];
  h.api.diagZapis({ kdy: 'x', kam: 'a.cz/b', stav: 200 });
  h.state.huumSyrove = { kdy: '2026-09-22T10:00:00.000Z', stav: 200,
    telo: '{"statusCode":232,"temperature":"33"}' };
  const out = volej(h, 'GET /api/diagnostika');
  check('vrátí log', out.log.length, 1);
  check('  i výpis asistenta', out.assistantLog[0].text, 'zapnul bojler');
  check('  i volání', out.volani.length, 1);
  check('  i stav zařízení', out.stav.sekacka.stav, 'idle');
  check('  a je v tom čas', typeof out.kdy, 'string');
  check('  i odkdy server běží', typeof out.behOd, 'string');
  // Dlouhé série by z toho udělaly soubor, který se do chatu nevejde
  check('dlouhé série se vynechají',
    ['history', 'timeline', 'log'].filter(k => k in out.stav).join(', ') || 'žádná', 'žádná');
  check('  a stav bazénu zůstane', out.stav.pool.on, true);
  // Odpověď z HUUM celá. Obal kolem fetch ji zapisuje taky, ale ořezanou na 300
  // znaků — a u ní jde právě o názvy polí až dole.
  check('a syrová odpověď z HUUM je v tom', out.huumSyrove.telo.includes('"temperature":"33"'), true);
  check('  se svým kódem', out.huumSyrove.stav, 200);
}
{
  // Bez kamen tam prostě nic není, ale klíč nesmí zmizet — jinak se z chybějícího
  // napojení stane „zapomněl jsem se podívat"
  const h = build();
  check('bez HUUM je to null', volej(h, 'GET /api/diagnostika').huumSyrove, null);
}

globalThis.fetch = puvodniFetch;
konec();
})().catch(err => {
  globalThis.fetch = puvodniFetch;
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
