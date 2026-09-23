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
    zapisy: [],
    zpravicky: [],
    cekani: [],
    vzorky: [],
    nahrevy: [],
    tiky: [],
    hodiny: { hour: 18, minute: 30 },
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
    'broadcast', 'scheduleEvery', 'POLL_INTERVAL_MS', 'requireAuth', 'addLog', 'sendPushToAll',
    'delay', 'nahrevVzorek', 'nahrevStart', 'validTimerTime', 'pragueTime', 'setInterval',
    CODE + '\n; return { huumMap, huumNum, huumStavText, HUUM_STAVY, huumStatus,'
         + ' huumChyba, huumTelo, fetchHuum, pollHuum, huumPayload, huumSvetlo,'
         + ' checkHuumNahrata, HUUM_NAHRATA_C, huumMezeTeplot, huumPovel,'
         + ' huumOverStav, HUUM_OVERENI_MS, saunaTimerPridej,'
         + ' casovace: () => saunaTimers };'
  )(
    user, pass, url, zapnuto, fetchStub, h.state,
    { get: (c, fn) => { h.routy['GET ' + c] = fn; },
      post: (c, fn) => { h.routy['POST ' + c] = fn; },
      delete: (c, fn) => { h.routy['DELETE ' + c] = fn; } },
    (typ, data) => h.zpravy.push({ typ, data }),
    () => {},              // scheduleEvery: poller se v sadě nespouští
    2 * 60 * 1000,
    (req, res) => {
      if (h.pustDal) return true;
      res.status(401).json({ error: 'zamčeno' });
      return false;
    },
    text => h.zapisy.push(text),
    (nadpis, telo) => h.zpravicky.push({ nadpis, telo }),
    ms => { h.cekani.push(ms); return Promise.resolve(); },
    c => h.vzorky.push(c),
    duvod => h.nahrevy.push(duvod),
    t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t),
    () => h.hodiny,
    (fn, ms) => { h.tiky.push({ fn, ms }); return 0; }
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

nadpis('10) Syrové tělo pro diagnostiku');
{
  const h = build();
  await h.api.pollHuum();
  // Obal kolem `fetch` zapisuje odpovědi ořezané na 300 znaků; odpověď z HUUM je
  // delší a zajímavé názvy polí jsou až dole. Proto se schovává celá zvlášť.
  check('uloží se tak, jak přišlo', h.state.huumSyrove.telo.includes('"temperature":"23"'), true);
  check('  i se stavem', h.state.huumSyrove.stav, 200);
  check('  a s časem', typeof h.state.huumSyrove.kdy, 'string');
  h.odpovez = async () => ({ stav: 500, text: 'rozbito' });
  await h.api.pollHuum();
  // Zrovna u chyby se na to tělo člověk potřebuje podívat nejvíc
  check('i neúspěšná odpověď se schová', h.state.huumSyrove.telo, 'rozbito');
  check('  se svým kódem', h.state.huumSyrove.stav, 500);
  check('heslo v tom není', JSON.stringify(h.state.huumSyrove).includes('tajne-heslo'), false);
}
{
  const h = build();
  h.odpovez = async () => ({ stav: 200, text: 'x'.repeat(5000) });
  try { await h.api.fetchHuum(); } catch (e) { /* nečekaná odpověď, to je v pořádku */ }
  check('dlouhé tělo se ořízne', h.state.huumSyrove.telo.length, 2000);
}

nadpis('11) Zpráva o nahřáté sauně');
{
  const h = build();
  const kolo = async (t, cil, stav = 231) => {
    h.odpovez = async () => ({ stav: 200, text: JSON.stringify(
      odpoved({ statusCode: stav, temperature: String(t), targetTemperature: String(cil) })) });
    await h.api.pollHuum();
  };
  check('pět stupňů je ta hranice', h.api.HUUM_NAHRATA_C, 5);

  // První vzorek po startu jen nastaví výchozí stav. Kdyby se začínalo od `false`,
  // restart serveru nad rozpálenou saunou by poslal zprávu o něčem, co nikdo neviděl.
  await kolo(88, 90);
  check('první vzorek mlčí i nad cílem', h.zpravicky.length, 0);
}
{
  const h = build();
  const kolo = async (t, cil, stav = 231) => {
    h.odpovez = async () => ({ stav: 200, text: JSON.stringify(
      odpoved({ statusCode: stav, temperature: String(t), targetTemperature: String(cil) })) });
    await h.api.pollHuum();
  };
  await kolo(30, 90);
  check('studená sauna mlčí', h.zpravicky.length, 0);
  await kolo(84, 90);
  check('šest pod cílem ještě ne', h.zpravicky.length, 0);
  await kolo(85, 90);
  check('pět pod cílem už je zpráva', h.zpravicky.length, 1);
  check('  a řekne, kolik v ní je', h.zpravicky[0].telo, 'Je v ní 85 °C, cíl 90 °C.');
  check('  s nadpisem', h.zpravicky[0].nadpis, '🧖 Sauna je nahřátá');
  check('  a je to i v logu', h.zapisy.some(t => /nahřátá na 85/.test(t)), true);

  // Kolísání kolem cíle nesmí posílat zprávu každé dvě minuty
  await kolo(88, 90);
  check('další kola už mlčí', h.zpravicky.length, 1);
  await kolo(86, 90);
  check('  ani po poklesu v pásmu', h.zpravicky.length, 1);
  await kolo(84, 90);
  check('  ani těsně pod hranicí', h.zpravicky.length, 1);
  // A hlavně ani po návratu nahoru. Bez hystereze by stačilo klesnout o stupeň
  // pod hranici a zpráva by chodila při každém cyklu termostatu.
  await kolo(86, 90);
  check('  ani po návratu nahoru', h.zpravicky.length, 1);
  // Odjistí se až o dva stupně níž, pak smí přijít znovu
  await kolo(82, 90);
  await kolo(86, 90);
  check('po vychladnutí se ozve znovu', h.zpravicky.length, 2);
}
{
  const h = build();
  const kolo = async (o) => {
    h.odpovez = async () => ({ stav: 200, text: JSON.stringify(odpoved(o)) });
    await h.api.pollHuum();
  };
  await kolo({ statusCode: 231, temperature: '30', targetTemperature: '90' });
  // Offline jednotka drží poslední teplotu — z té by vznikla zpráva o ničem
  await kolo({ statusCode: 230, temperature: '88', targetTemperature: '90' });
  check('offline jednotka nic neposílá', h.zpravicky.length, 0);
  // Bez cílové teploty není co porovnávat
  await kolo({ statusCode: 231, temperature: '88', targetTemperature: '' });
  check('bez cíle taky ne', h.zpravicky.length, 0);
  await kolo({ statusCode: 232, temperature: '88', targetTemperature: '90' });
  check('ale připravená (232) se počítá', h.zpravicky.length, 1);
}

nadpis('12) Světlo');
// HUUM umí jen PŘEPNOUT. Nejdřív se proto čte skutečný stav — bez toho by
// tlačítko ON u rozsvíceného světla zhaslo, a to je přesně ta chyba, kterou
// by na kartě nikdo nehledal, protože „povel přece odešel".
const svetloOdpovedi = (predtim, potom) => {
  let krok = 0;
  return async () => {
    krok++;
    if (krok === 1) return { stav: 200, text: JSON.stringify(odpoved({ light: predtim })) };
    if (krok === 2) return { stav: 200, text: '{"ok":true}' };
    return { stav: 200, text: JSON.stringify(odpoved({ light: potom })) };
  };
};
{
  const h = build();
  h.odpovez = svetloOdpovedi(0, 1);
  const po = await h.api.huumSvetlo(true);
  check('nejdřív se zeptá, jak to je', h.volani[0].adresa,
    'https://sauna.huum.eu/action/home/status');
  check('  pak teprve přepne', h.volani[1].adresa, 'https://sauna.huum.eu/action/home/light');
  check('  a znovu ověří', h.volani[2].adresa, 'https://sauna.huum.eu/action/home/status');
  check('vrací se skutečný stav', po.light, 1);
  check('  a uloží se', h.state.huum.light, 1);
  // Bez rozeslání by karta na druhém telefonu zůstala na starém stavu
  check('  a rozešle se do appky', h.zpravy[h.zpravy.length - 1].data.huum.light, 1);
}
{
  // Tohle je ta chyba: přepnout rozsvícené světlo tlačítkem ON by ho zhaslo
  const h = build();
  h.odpovez = svetloOdpovedi(1, 0);
  const po = await h.api.huumSvetlo(true);
  check('rozsvícené světlo se ON nepřepíná', h.volani.length, 1);
  check('  a nikdo nesahal na /light',
    h.volani.some(v => v.adresa.endsWith('/light')), false);
  check('  a vrací se, že svítí', po.light, 1);
}
{
  const h = build();
  h.odpovez = svetloOdpovedi(0, 1);
  const po = await h.api.huumSvetlo(false);
  check('zhasnuté světlo se OFF taky nepřepíná', h.volani.length, 1);
  check('  a vrací se, že nesvítí', po.light, 0);
}
{
  const h = build();
  h.odpovez = svetloOdpovedi(1, 0);
  await h.api.huumSvetlo(false);
  check('rozsvícené se OFF zhasne', h.volani.length, 3);
  check('  a stav sedí', h.state.huum.light, 0);
}
{
  // Kdyby se povel ztratil, tlačítko nesmí říct „hotovo"
  const h = build();
  h.odpovez = svetloOdpovedi(0, 0);
  let chyba = '';
  try { await h.api.huumSvetlo(true); } catch (e) { chyba = e.message; }
  check('nepřepnuté světlo se nezamlčí', chyba,
    'Povel odešel, ale světlo je pořád zhasnuté.');
  check('  a stav v appce odpovídá skutečnosti', h.state.huum.light, 0);
}
{
  const h = build();
  h.odpovez = async () => ({ stav: 200, text: JSON.stringify(odpoved({ light: undefined })) });
  let chyba = '';
  try { await h.api.huumSvetlo(true); } catch (e) { chyba = e.message; }
  check('když HUUM neřekne, netvrdíme nic', chyba, 'HUUM neřekl, jestli světlo svítí.');
  check('  a nepřepíná se naslepo', h.volani.length, 1);
}
{
  const h = build();
  h.odpovez = async () => ({ stav: 401, text: '' });
  let chyba = '';
  try { await h.api.huumSvetlo(true); } catch (e) { chyba = e.message; }
  check('odmítnuté přihlášení projde dál', chyba, 'HUUM: neplatné jméno nebo heslo.');
  check('  a dál se nepokračuje', h.volani.length, 1);
}

nadpis('13) Endpoint na světlo');
{
  const h = build();
  h.odpovez = svetloOdpovedi(0, 1);
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-svetlo', { on: true });
  check('projde', kod, 200);
  check('  a vrátí stav světla', out.light, 1);
  check('  i celá kamna', out.huum.enabled, true);
  check('  a zapíše se to do logu', h.zapisy.some(t => /světlo zapnuto/.test(t)), true);
}
{
  const h = build();
  h.odpovez = svetloOdpovedi(1, 0);
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-svetlo', { on: false });
  check('vypnutí taky', kod, 200);
  check('  a v logu je vypnuto', h.zapisy.some(t => /světlo vypnuto/.test(t)), true);
  check('  se stavem', out.light, 0);
}
{
  const h = build();
  h.odpovez = svetloOdpovedi(0, 0);
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-svetlo', { on: true });
  check('neprovedený povel vrátí 502', kod, 502);
  check('  s hláškou', /pořád zhasnuté/.test(out.error), true);
  // I při chybě se posílá stav — jinak by karta zůstala na tom, co si pamatovala
  check('  ale i se stavem', out.huum.light, 0);
}
{
  // Jednotka jen s parním vyvíječem (config 1) nemá světlo kam zapnout
  const h = build();
  h.odpovez = async () => ({ stav: 200, text: JSON.stringify(odpoved({ config: 1 })) });
  await h.api.pollHuum();
  h.volani.length = 0;
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-svetlo', { on: true });
  check('bez osazeného světla 400', kod, 400);
  check('  a řekne se proč', out.error, 'Jednotka nemá osazené světlo.');
  check('  a nikam se nechodí', h.volani.length, 0);
}
{
  const h = build({ user: '', pass: '' });
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-svetlo', { on: true });
  check('bez nastavení 503', kod, 503);
  check('  a řekne se proč', out.error, 'Kamna HUUM nejsou nastavená.');
}
{
  const h = build();
  h.pustDal = false;
  const { kod } = await volej(h, 'POST /api/sauna/huum-svetlo', { on: true });
  check('zamčená appka nepřepíná', kod, 401);
  check('  a nikam nechodí', h.volani.length, 0);
}

nadpis('14) Zapnutí topení');
{
  const h = build();
  await h.api.pollHuum();          // meze: bez saunaConfig → výchozí 40–110
  h.volani.length = 0;
  h.odpovez = async n => (n === 1
    ? { stav: 200, text: '{"ok":true}' }
    : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 231, targetTemperature: '85' })) });
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-start', { teplota: 85 });
  check('projde', kod, 200);
  check('jde to na /start', h.volani[0].adresa, 'https://sauna.huum.eu/action/home/start');
  check('  POSTem', h.volani[0].opts.method, 'POST');
  check('  s cílovou teplotou', JSON.parse(h.volani[0].opts.body).targetTemperature, 85);
  check('  a jako JSON', h.volani[0].opts.headers['Content-Type'], 'application/json');
  // „Přijato" není „topí" — pravdu má až další /status
  check('povel se ověří dotazem na /status', h.volani[1].adresa,
    'https://sauna.huum.eu/action/home/status');
  check('  a čeká se, než si to cloud předá', h.cekani[0], h.api.HUUM_OVERENI_MS[0]);
  check('vrací se, na kolik se topí', out.teplota, 85);
  check('  a že kamna jedou', out.huum.heating, true);
  check('  a je to v logu', h.zapisy.some(t => /zapnuta na 85/.test(t)), true);
}
{
  // Kdyby se povel ztratil, tlačítko nesmí říct „hotovo"
  const h = build();
  h.odpovez = async n => (n === 1
    ? { stav: 200, text: '{"ok":true}' }
    : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 232 })) });
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-start', { teplota: 85 });
  check('nerozjetá kamna vrátí 502', kod, 502);
  check('  a řeknou proč', out.error, 'Povel odešel, ale kamna se do pár vteřin nerozjela.');
  // Zkouší se dvakrát — jedno pomalé čtení není důkaz, že povel selhal
  check('  po dvou pokusech o ověření', h.cekani.length, 2);
}
{
  const h = build();
  await h.api.pollHuum();
  h.state.huum.doorClosed = false;
  h.volani.length = 0;
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-start', { teplota: 85 });
  // Dveře jsou pojistka v jednotce; tohle to jen řekne srozumitelně a hned
  check('s otevřenými dveřmi 409', kod, 409);
  check('  a řekne se co s tím', out.error, 'Sauna má otevřené dveře — zavři je a zkus to znovu.');
  check('  a nikam se nechodí', h.volani.length, 0);
}
{
  const h = build();
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-start', {});
  check('bez teploty 400', kod, 400);
  check('  a řekne se proč', out.error, 'Chybí cílová teplota.');
  check('nesmysl místo teploty taky',
    (await volej(h, 'POST /api/sauna/huum-start', { teplota: 'horko' })).kod, 400);
}

nadpis('15) Teplota se ořízne na meze jednotky');
{
  const h = build();
  // Meze si hlásí sama jednotka — natvrdo napsaný rozsah by u jiných kamen lhal
  h.odpovez = async () => ({ stav: 200, text: JSON.stringify(odpoved({
    saunaConfig: { minTemp: 40, maxTemp: 90 } })) });
  await h.api.pollHuum();
  check('meze se vezmou z jednotky',
    `${h.api.huumMezeTeplot().min}–${h.api.huumMezeTeplot().max}`, '40–90');

  const zkus = async t => {
    h.volani.length = 0;
    h.odpovez = async n => (n === 1
      ? { stav: 200, text: '{"ok":true}' }
      : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 231 })) });
    const { out } = await volej(h, 'POST /api/sauna/huum-start', { teplota: t });
    return JSON.parse(h.volani[0].opts.body).targetTemperature;
  };
  check('200 °C se ořízne na 90', await zkus(200), 90);
  check('10 °C se zvedne na 40', await zkus(10), 40);
  check('85 projde beze změny', await zkus(85), 85);
  check('desetinná se zaokrouhlí', await zkus(78.6), 79);
}
{
  // Bez údajů od jednotky se jede na výchozí rozsah, ne na NaN
  const h = build();
  check('bez mezí platí výchozí',
    `${h.api.huumMezeTeplot().min}–${h.api.huumMezeTeplot().max}`, '40–110');
}

nadpis('16) Vypnutí topení');
{
  const h = build();
  h.odpovez = async n => (n === 1
    ? { stav: 200, text: '{"ok":true}' }
    : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 232 })) });
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-stop');
  check('projde', kod, 200);
  check('jde to na /stop', h.volani[0].adresa, 'https://sauna.huum.eu/action/home/stop');
  check('  a ověří se', h.volani[1].adresa, 'https://sauna.huum.eu/action/home/status');
  check('  kamna netopí', out.huum.heating, false);
  check('  a je to v logu', h.zapisy.some(t => /Sauna: vypnuta/.test(t)), true);
  // Vypnutí se dveřmi nebrzdí — je to ta bezpečná strana
}
{
  const h = build();
  await h.api.pollHuum();
  h.state.huum.doorClosed = false;
  h.volani.length = 0;
  h.odpovez = async n => (n === 1
    ? { stav: 200, text: '{"ok":true}' }
    : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 232 })) });
  check('vypnout jde i s otevřenými dveřmi',
    (await volej(h, 'POST /api/sauna/huum-stop')).kod, 200);
}
{
  const h = build();
  h.odpovez = async n => (n === 1
    ? { stav: 200, text: '{"ok":true}' }
    : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 231 })) });
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-stop');
  check('kamna co pořád topí = 502', kod, 502);
  check('  a řekne se to', out.error, 'Povel odešel, ale kamna pořád topí.');
}
{
  const h = build();
  h.odpovez = async () => ({ stav: 401, text: '' });
  const { out, kod } = await volej(h, 'POST /api/sauna/huum-stop');
  check('odmítnuté přihlášení projde dál', out.error, 'HUUM: neplatné jméno nebo heslo.');
  check('  jako 502', kod, 502);
}
{
  const h = build({ user: '', pass: '' });
  check('bez nastavení 503 u startu',
    (await volej(h, 'POST /api/sauna/huum-start', { teplota: 85 })).kod, 503);
  check('  i u vypnutí', (await volej(h, 'POST /api/sauna/huum-stop')).kod, 503);
}
{
  const h = build();
  h.pustDal = false;
  check('zamčená appka saunu nezapne',
    (await volej(h, 'POST /api/sauna/huum-start', { teplota: 85 })).kod, 401);
  check('  ani nevypne', (await volej(h, 'POST /api/sauna/huum-stop')).kod, 401);
  check('  a nikam nechodí', h.volani.length, 0);
}

nadpis('17) Časovač sauny');
const volejD = async (h, cesta, params) => {
  let out = null, kod = 200;
  const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
  await h.routy[cesta]({ params }, res);
  return { out, kod };
};
{
  const h = build();
  const { out, kod } = await volej(h, 'POST /api/sauna/timer', { time: '18:30', teplota: 85 });
  check('přidá se', kod, 200);
  check('  a vrátí se seznam', out.timers.length, 1);
  check('  s časem', out.timers[0].time, '18:30');
  check('  i teplotou', out.timers[0].teplota, 85);
  check('  a je to v logu', h.zapisy.some(t => /časovač na 18:30 \(85 °C\)/.test(t)), true);

  // Řadí se podle času, ne podle pořadí přidání
  await volej(h, 'POST /api/sauna/timer', { time: '06:00', teplota: 70 });
  check('řadí se podle času', h.api.casovace().map(t => t.time).join(','), '06:00,18:30');

  const id = h.api.casovace()[0].id;
  const smaz = await volejD(h, 'DELETE /api/sauna/timer/:id', { id: String(id) });
  check('křížek smaže', smaz.out.timers.length, 1);
  check('  a zůstane ten druhý', smaz.out.timers[0].time, '18:30');
  check('smazat neexistující nespadne',
    (await volejD(h, 'DELETE /api/sauna/timer/:id', { id: '999' })).kod, 200);
}
{
  const h = build();
  check('nesmyslný čas neprojde',
    (await volej(h, 'POST /api/sauna/timer', { time: '25:00', teplota: 85 })).kod, 400);
  check('chybějící teplota taky ne',
    (await volej(h, 'POST /api/sauna/timer', { time: '18:30' })).kod, 400);
  check('  a nic se nepřidalo', h.api.casovace().length, 0);
}
{
  // Meze si hlásí jednotka — časovač na 200 °C nesmí vzniknout
  const h = build();
  h.odpovez = async () => ({ stav: 200, text: JSON.stringify(odpoved({
    saunaConfig: { minTemp: 40, maxTemp: 90 } })) });
  await h.api.pollHuum();
  await volej(h, 'POST /api/sauna/timer', { time: '18:30', teplota: 200 });
  check('teplota se ořízne na meze jednotky', h.api.casovace()[0].teplota, 90);
}
{
  const h = build();
  for (let i = 0; i < 10; i++) await volej(h, 'POST /api/sauna/timer', { time: '0' + (i % 10) + ':00', teplota: 80 });
  const jeste = await volej(h, 'POST /api/sauna/timer', { time: '23:00', teplota: 80 });
  check('víc než deset jich nejde', jeste.kod, 400);
  check('  a řekne se proč', jeste.out.error, 'Maximálně 10 časovačů.');
}
{
  const h = build({ user: '', pass: '' });
  check('bez nastavených kamen 503',
    (await volej(h, 'POST /api/sauna/timer', { time: '18:30', teplota: 85 })).kod, 503);
}
{
  const h = build();
  h.pustDal = false;
  check('zamčená appka časovač nepřidá',
    (await volej(h, 'POST /api/sauna/timer', { time: '18:30', teplota: 85 })).kod, 401);
}

nadpis('18) Tik časovače');
{
  const h = build();
  h.api.saunaTimerPridej('18:30', 85);
  h.api.saunaTimerPridej('06:00', 70);
  const tik = h.tiky.find(t => t.ms === 30000).fn;
  h.volani.length = 0;
  h.odpovez = async n => (n === 1
    ? { stav: 200, text: '{"ok":true}' }
    : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 231 })) });
  await tik();
  check('pustí se ten, co sedí na minutu', h.volani[0].adresa,
    'https://sauna.huum.eu/action/home/start');
  check('  s uloženou teplotou', JSON.parse(h.volani[0].opts.body).targetTemperature, 85);
  // „Přijato" není „topí" — i časovač povel ověřuje
  check('  a ověří se', h.volani[1].adresa, 'https://sauna.huum.eu/action/home/status');
  check('  a založí se měření nahřívání', h.nahrevy[0], 'casovac');
  check('vyhodí se z fronty', h.api.casovace().map(t => t.time).join(','), '06:00');
  // Vyhazuje se PŘED spuštěním: tik po třiceti vteřinách by jinak stihl přijít
  // znovu a pustil by saunu podruhé
  h.volani.length = 0;
  await tik();
  check('  a podruhé se už nepustí', h.volani.length, 0);
}
{
  const h = build();
  h.api.saunaTimerPridej('06:00', 70);
  const tik = h.tiky.find(t => t.ms === 30000).fn;
  await tik();
  check('co na minutu nesedí, se nepustí', h.volani.length, 0);
  check('  a zůstane ve frontě', h.api.casovace().length, 1);
}
{
  const h = build();
  h.api.saunaTimerPridej('18:30', 85);
  const tik = h.tiky.find(t => t.ms === 30000).fn;
  h.odpovez = async () => ({ stav: 503, text: 'rozbito' });
  await tik();
  check('selhání se zapíše do logu',
    h.zapisy.some(t => /časovač 18:30 selhal/.test(t)), true);
  // Nevracet zpátky: v 18:31 by se zkusil znovu a v 18:32 zase
  check('  a časovač se nevrací', h.api.casovace().length, 0);
}
{
  const h = build();
  h.api.saunaTimerPridej('18:30', 85);
  const tik = h.tiky.find(t => t.ms === 30000).fn;
  h.odpovez = async n => (n === 1
    ? { stav: 200, text: '{"ok":true}' }
    : { stav: 200, text: JSON.stringify(odpoved({ statusCode: 232 })) });
  await tik();
  check('nerozjetá kamna se nezamlčí',
    h.zapisy.some(t => /kamna se nerozjela/.test(t)), true);
}

konec();
})().catch(err => {
  check('sada doběhla bez výjimky', err && err.stack, '(nic)');
  konec();
});
