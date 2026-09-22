// Ověření: napojení na kamna HUUM (jednotka UKU WiFi).
//
// Dvě poloviny. První je překlad odpovědi: teploty odtud chodí jako ŘETĚZCE,
// `door: true` znamená ZAVŘENÉ a cílovou teplotu API nevrátí, dokud sauna netopí
// — na těch třech věcech se dá nejsnáz uklouznout.
//
// Druhá polovina je samotné volání, a to je důležitější, než vypadá: appka běží
// na Renderu, kamna odpovídají z cloudu a přihlašovací údaje jsou v prostředí.
// Odsud se to naživo vyzkoušet nedá, takže jediné, co o tom napojení opravdu
// víme, je to, co hlídá tahle sada. Hlavně: chybová hláška musí říct, CO se
// stalo (špatné heslo × výpadek × nesmyslná odpověď), protože podle ní se pak
// ladí naslepo — a nesmí v ní být heslo, ten výpis se posílá dál.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('HUUM');

const CODE = between('// ---------- Kamna HUUM (UKU WiFi) ----------',
                     '// ---------- Teplota bazénu: platí jen při proudící vodě ----------');

// Odpověď tak, jak ji API vrací (viz dokumentace HUUM i knihovna pyhuum)
const odpoved = (o = {}) => ({
  statusCode: 232, door: true, temperature: '23', targetTemperature: '50',
  startDate: 1507184846, endDate: 1507184846, duration: 0, config: 2, steamerError: 0, ...o
});

function build({ user = 'ja@doma.cz', pass = 'tajne-heslo',
                 url = 'https://sauna.huum.eu/action/home', enabled } = {}) {
  const zapnuto = enabled === undefined ? !!(user && pass) : enabled;
  const h = {
    state: { huum: { error: null } },
    routy: {},
    zpravy: [],
    volani: [],
    pustDal: true,
    // Co má stub odpovědět; sekce si to přepisují
    odpovez: async () => ({ stav: 200, text: JSON.stringify(odpoved()) })
  };

  const fetchStub = async (adresa, opts) => {
    h.volani.push({ adresa, opts });
    const r = await h.odpovez(h.volani.length);
    if (r.pad) throw new Error(r.pad);
    return {
      status: r.stav,
      ok: r.stav >= 200 && r.stav < 300,
      text: async () => r.text
    };
  };

  h.api = new Function(
    'HUUM_USER', 'HUUM_PASS', 'HUUM_URL', 'huumEnabled', 'fetch', 'state', 'app',
    'broadcast', 'scheduleEvery', 'POLL_INTERVAL_MS', 'requireAuth',
    CODE + '\n; return { huumMap, huumNum, huumStavText, HUUM_STAVY, huumStatus,'
         + ' huumChyba, huumTelo, fetchHuum, pollHuum, huumPayload };'
  )(
    user, pass, url, zapnuto, fetchStub, h.state,
    { get: (c, fn) => { h.routy['GET ' + c] = fn; },
      post: (c, fn) => { h.routy['POST ' + c] = fn; } },
    (typ, data) => h.zpravy.push({ typ, data }),
    () => {},              // scheduleEvery: poller se v sadě nespouští
    2 * 60 * 1000,
    (req, res) => {
      if (h.pustDal) return true;
      res.status(401).json({ error: 'zamčeno' });
      return false;
    }
  );
  return h;
}

const volej = async (h, cesta, telo) => {
  let out = null, kod = 200;
  const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
  await h.routy[cesta]({ body: telo }, res);
  return { out, kod };
};

const api = build().api;

(async () => {

nadpis('1) Stavy');
{
  check('offline', api.huumStavText(230), 'offline');
  check('topí', api.huumStavText(231), 'topí');
  check('připravená', api.huumStavText(232), 'připravená');
  check('ovládá ji někdo jiný', api.huumStavText(233), 'ovládá ji někdo jiný');
  check('nouzové zastavení', api.huumStavText(400), 'nouzové zastavení');
  check('neznámý kód se nezamlčí', api.huumStavText(999), 'neznámý stav (999)');
  check('chybějící kód → null', api.huumStavText(undefined), null);
  check('jen 231 znamená topí', api.huumMap(odpoved({ statusCode: 231 })).heating, true);
  check('  232 ne', api.huumMap(odpoved()).heating, false);
  check('  a 230 taky ne', api.huumMap(odpoved({ statusCode: 230 })).heating, false);
}

nadpis('2) Teploty chodí jako text');
{
  const m = api.huumMap(odpoved());
  check('aktuální teplota je číslo', m.temperature, 23);
  check('  a je to opravdu number', typeof m.temperature, 'number');
  check('cílová teplota taky', m.targetTemperature, 50);
  check('číslo projde beze změny', api.huumMap(odpoved({ temperature: 78 })).temperature, 78);
  check('desetinné taky', api.huumMap(odpoved({ temperature: '78.5' })).temperature, 78.5);
}
{
  // Dokud sauna netopí, cílovou teplotu API nevrací — nesmí z toho vzniknout NaN
  const m = api.huumMap(odpoved({ targetTemperature: undefined }));
  check('chybějící cíl → null', m.targetTemperature, null);
  check('prázdný řetězec taky', api.huumMap(odpoved({ targetTemperature: '' })).targetTemperature, null);
  check('nesmysl taky', api.huumMap(odpoved({ targetTemperature: 'abc' })).targetTemperature, null);
  check('  a nikdy NaN', Number.isNaN(api.huumMap(odpoved({ temperature: 'x' })).temperature), false);
}

nadpis('3) Dveře');
{
  check('door: true = zavřené', api.huumMap(odpoved({ door: true })).doorClosed, true);
  check('door: false = otevřené', api.huumMap(odpoved({ door: false })).doorClosed, false);
  check('bez údaje nevíme', api.huumMap(odpoved({ door: undefined })).doorClosed, null);
}

nadpis('4) Vybavení a vyvíječ');
{
  check('config 1 = vyvíječ', api.huumMap(odpoved({ config: 1 })).configText, 'parní vyvíječ');
  check('config 2 = světlo', api.huumMap(odpoved({ config: 2 })).configText, 'světlo');
  check('config 3 = obojí', api.huumMap(odpoved({ config: 3 })).configText, 'vyvíječ i světlo');
  check('neznámé vybavení → null', api.huumMap(odpoved({ config: 9 })).configText, null);
  check('chyba vyvíječe se přenese', api.huumMap(odpoved({ steamerError: 1 })).steamerError, 1);
  check('  a nula je taky hodnota', api.huumMap(odpoved()).steamerError, 0);
}

nadpis('5) Delší odpověď');
{
  const m = api.huumMap(odpoved({
    humidity: '35', targetHumidity: 40, light: 1, saunaName: 'Chata',
    saunaConfig: { childLock: 'OFF', minTemp: 40, maxTemp: 110,
                   minHeatingTime: 1, maxHeatingTime: 3, minTimer: 0, maxTimer: 12 }
  }));
  check('vlhkost jako číslo', m.humidity, 35);
  check('cílová vlhkost', m.targetHumidity, 40);
  check('světlo', m.light, 1);
  check('název sauny', m.saunaName, 'Chata');
  check('meze teploty', `${m.limits.minTemp}–${m.limits.maxTemp}`, '40–110');
  check('meze doby topení', `${m.limits.minHeatingTime}–${m.limits.maxHeatingTime}`, '1–3');
  check('meze časovače', `${m.limits.minTimer}–${m.limits.maxTimer}`, '0–12');
  check('dětský zámek', m.limits.childLock, 'OFF');
}
{
  // Krátká odpověď (tak vypadá dokumentovaný příklad) nesmí spadnout
  const m = api.huumMap(odpoved());
  check('bez saunaConfig se nespadne', m.limits.maxTemp, null);
  check('  ani na dětském zámku', m.limits.childLock, null);
  check('chybějící vlhkost → null', m.humidity, null);
  check('prázdná odpověď projde', api.huumMap({}).statusCode, null);
  check('  a nemá stav', api.huumMap({}).statusText, null);
}

nadpis('6) Časy');
{
  const m = api.huumMap(odpoved({ startDate: 1507184846, endDate: 1507195646, duration: 3 }));
  check('začátek', m.startDate, 1507184846);
  check('konec', m.endDate, 1507195646);
  check('délka', m.duration, 3);
  check('chybějící konec → null', api.huumMap(odpoved({ endDate: undefined })).endDate, null);
}

nadpis('7) Dotaz na HUUM');
{
  const h = build();
  const m = await h.api.fetchHuum();
  check('adresa je /status pod HUUM_URL', h.volani[0].adresa,
    'https://sauna.huum.eu/action/home/status');
  const hl = h.volani[0].opts.headers;
  // Basic auth, přesně jako pyhuum — jiný tvar HUUM odmítne
  check('přihlášení je Basic', hl.Authorization.startsWith('Basic '), true);
  check('  a je v něm jméno:heslo v base64',
    Buffer.from(hl.Authorization.slice(6), 'base64').toString(), 'ja@doma.cz:tajne-heslo');
  check('žádá JSON', hl.Accept, 'application/json');
  // Bez časového limitu by viselo volání na mrtvý cloud do nekonečna a s ním
  // i celý poller — `huumPollRunning` by zůstalo zapnuté napořád
  check('má časový limit', !!h.volani[0].opts.signal, true);
  check('přeloží se to, co přišlo', m.temperature, 23);
}
{
  // Vlastní adresa z prostředí (kdyby sauna.huum.eu přestala odpovídat)
  const h = build({ url: 'https://api.huum.eu/action/home' });
  await h.api.fetchHuum();
  check('jiná adresa z prostředí se použije', h.volani[0].adresa,
    'https://api.huum.eu/action/home/status');
}

nadpis('8) Když to nevyjde, musí být poznat proč');
{
  const h = build();
  const zkus = async (stav, text) => {
    h.odpovez = async () => ({ stav, text });
    try { await h.api.fetchHuum(); return '(prošlo)'; } catch (e) { return e.message; }
  };
  check('401 je špatné heslo', await zkus(401, 'Unauthorized'), 'HUUM: neplatné jméno nebo heslo.');
  // 403 vrací HUUM taky — bez tohohle by z toho bylo nic neříkající „HTTP 403"
  check('403 taky', await zkus(403, ''), 'HUUM: neplatné jméno nebo heslo.');
  check('  a heslo v hlášce není', (await zkus(401, '')).includes('tajne-heslo'), false);
  check('výpadek nese kód i kus odpovědi', await zkus(503, '{"error":"maintenance"}'),
    'HUUM API HTTP 503: {"error":"maintenance"}');
  check('  prázdné tělo nenechá viset dvojtečku', await zkus(500, ''), 'HUUM API HTTP 500');
  check('  a dlouhé tělo se ořízne', (await zkus(500, 'x'.repeat(500))).length < 200, true);
  // Přihlašovací stránka místo API je nejčastější podoba „nefunguje to"
  check('HTML místo JSONu', await zkus(200, '<!DOCTYPE html><title>Login</title>'),
    'HUUM: nečekaná odpověď.');
  // Pole projde `typeof 'object'` — bez kontroly by z toho byla tichá karta s pomlčkami
  check('prázdné pole', await zkus(200, '[]'), 'HUUM: nečekaná odpověď.');
  check('null', await zkus(200, 'null'), 'HUUM: nečekaná odpověď.');
  check('prázdná odpověď', await zkus(200, ''), 'HUUM: nečekaná odpověď.');

  h.odpovez = async () => ({ pad: 'fetch failed' });
  let chyba = '';
  try { await h.api.fetchHuum(); } catch (e) { chyba = e.message; }
  check('spadlé spojení projde dál', chyba, 'fetch failed');
}

nadpis('9) Kolo dotazů');
{
  const h = build();
  await h.api.pollHuum();
  check('stav se uloží', h.state.huum.temperature, 23);
  check('  bez chyby', h.state.huum.error, null);
  check('  s razítkem', typeof h.state.huum.fetchedAt, 'string');
  check('a pošle se do appky', h.zpravy[0].typ, 'huum');
  check('  se zapnutostí', h.zpravy[0].data.huum.enabled, true);

  // Razítko se při chybě NEobnovuje: znamená „kdy naposledy dorazila data",
  // ne „kdy jsme se ptali". Jinak by zmrzlá teplota vypadala čerstvě.
  const razitko = h.state.huum.fetchedAt;
  h.odpovez = async () => ({ stav: 500, text: '' });
  await h.api.pollHuum();
  check('při chybě zůstane staré razítko', h.state.huum.fetchedAt, razitko);
  check('  a stará teplota taky', h.state.huum.temperature, 23);
  check('  ale chyba se doplní', h.state.huum.error, 'HUUM API HTTP 500');
  check('  a appka se to dozví', h.zpravy.length, 2);

  // A po opravě se chyba musí zase ztratit, ne zůstat viset na kartě
  h.odpovez = async () => ({ stav: 200, text: JSON.stringify(odpoved()) });
  h.state.huum.fetchedAt = '2020-01-01T00:00:00.000Z';   // ať je posun vidět i v rámci milisekundy
  const pred = new Date().toISOString();
  await h.api.pollHuum();
  check('po opravě chyba zmizí', h.state.huum.error, null);
  check('  a razítko se posune', h.state.huum.fetchedAt >= pred, true);
}
{
  // Dvě kola naráz by se přepisovala a při pomalém cloudu by se hromadila
  const h = build();
  let pust;
  h.odpovez = () => new Promise(r => { pust = () => r({ stav: 200, text: JSON.stringify(odpoved()) }); });
  const a = h.api.pollHuum();
  const b = h.api.pollHuum();
  pust();
  await Promise.all([a, b]);
  check('dvě kola naráz se nepřekryjí', h.volani.length, 1);
  // …a po doběhnutí musí jít další kolo, jinak by se poller umlčel napořád
  h.odpovez = async () => ({ stav: 200, text: JSON.stringify(odpoved()) });
  await h.api.pollHuum();
  check('  ale další kolo jde', h.volani.length, 2);
}
{
  const h = build({ user: '', pass: '' });
  await h.api.pollHuum();
  check('bez údajů se nikam nechodí', h.volani.length, 0);
  check('  a appka ví, že to není zapnuté', h.api.huumPayload().enabled, false);
}

nadpis('10) Syrová data');
{
  const h = build();
  const { out } = await volej(h, 'GET /api/sauna/huum-syrove');
  check('řekne, že je nastaveno', out.nastaveno, true);
  check('  a kam se ptalo', out.adresa, 'https://sauna.huum.eu/action/home/status');
  check('  s jakým výsledkem', out.stav, 200);
  // Tělo musí jít dál NEPŘELOŽENÉ — jinak by se nepoznalo, že HUUM přejmenoval
  // pole nebo je nevrátil, a přesně kvůli tomu ten endpoint existuje
  check('tělo je syrové', out.telo.temperature, '23');
  check('  včetně názvů polí', 'statusCode' in out.telo, true);
  check('a vedle něj překlad', out.prelozeno.temperature, 23);
  check('  se stavem slovy', out.prelozeno.statusText, 'připravená');
  // Výpis se posílá do chatu
  check('heslo ve výpisu není', JSON.stringify(out).includes('tajne-heslo'), false);
  check('  ani jméno', JSON.stringify(out).includes('ja@doma.cz'), false);
}
{
  const h = build();
  h.odpovez = async () => ({ stav: 503, text: '{"error":"maintenance"}' });
  const { out } = await volej(h, 'GET /api/sauna/huum-syrove');
  check('při chybě je vidět kód', out.stav, 503);
  check('  i hláška', out.chyba, 'HUUM API HTTP 503: {"error":"maintenance"}');
  check('  a tělo pořád taky', out.telo.error, 'maintenance');
  check('  překlad se nepřikládá', 'prelozeno' in out, false);
}
{
  const h = build();
  h.odpovez = async () => ({ stav: 200, text: '<!DOCTYPE html><title>Login</title>' });
  const { out } = await volej(h, 'GET /api/sauna/huum-syrove');
  // Právě tohle je ta odpověď, kterou z přeloženého tvaru nepoznáš
  check('co není JSON, jde dál jako text', out.telo, '<!DOCTYPE html><title>Login</title>');
  check('  a řekne se, že je to nečekané', out.chyba, 'HUUM: nečekaná odpověď.');
}
{
  const h = build();
  h.odpovez = async () => ({ pad: 'fetch failed' });
  const { out } = await volej(h, 'GET /api/sauna/huum-syrove');
  check('spadlé spojení nespadne endpoint', out.chyba, 'fetch failed');
}
{
  const h = build({ user: '', pass: '' });
  const { out, kod } = await volej(h, 'GET /api/sauna/huum-syrove');
  check('bez nastavení 503', kod, 503);
  check('  a řekne se co chybí', out.chyba, 'Na serveru chybí HUUM_USER a HUUM_PASS.');
  check('  a nikam se nechodí', h.volani.length, 0);
}
{
  const h = build();
  h.pustDal = false;
  const { kod } = await volej(h, 'GET /api/sauna/huum-syrove');
  check('zamčená appka se neptá', kod, 401);
  check('  a do HUUM nechodí', h.volani.length, 0);
}

nadpis('11) Ruční aktualizace');
{
  const h = build();
  const { out } = await volej(h, 'POST /api/sauna/huum-obnov');
  check('kolo proběhne', h.volani.length, 1);
  check('  a vrátí se čerstvý stav', out.huum.temperature, 23);
  check('  se zapnutostí', out.huum.enabled, true);
  check('  a potvrzením', out.ok, true);
}
{
  const h = build();
  h.odpovez = async () => ({ stav: 401, text: '' });
  const { out } = await volej(h, 'POST /api/sauna/huum-obnov');
  // Tlačítko nesmí mlčet, když se nepovedlo — chyba jde rovnou v odpovědi
  check('chyba se vrátí rovnou', out.huum.error, 'HUUM: neplatné jméno nebo heslo.');
}
{
  const h = build({ user: '', pass: '' });
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-obnov');
  check('bez nastavení 503', kod, 503);
  check('  a řekne se proč', out.error, 'Kamna HUUM nejsou nastavená.');
}

konec();
})().catch(err => {
  check('sada doběhla bez výjimky', err && err.stack, '(nic)');
  konec();
});
