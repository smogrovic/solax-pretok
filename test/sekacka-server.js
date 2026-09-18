// Sekačka Anthbot na straně appky: přihlášení do cloudu, čtení stavu, povely.
//
// Tři pasti, kvůli kterým tahle sada existuje:
//  * Podpis SigV4 je jediná věc, kterou AWS odmítne beze slova vysvětlení —
//    vrátí 403 a nic víc. Proto se prohání zveřejněnými vzorovými příklady
//    od AWS: tady se neověřuje, že je kód sám se sebou v souladu, ale že
//    počítá totéž co AWS.
//  * Token i dočasné klíče vyprší. Když se to nepozná, appka přestane ukazovat
//    stav a nikdo se nedozví proč.
//  * Chybový kód od sekačky a problém se spojením jsou dvě různé věci. Kdyby
//    se pletly, „všechno v pořádku" by přebilo „cloud se neozývá".
//
// Co tahle sada NEDOKÁŽE: ověřit, že tvar odpovědí Anthbotu sedí. Je reverzně
// zjištěný a odsud na účet ani na sekačku není vidět — fixtury jsou psané
// podle komunitní integrace. Potvrdí to až první ostrý běh.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('sekačka (appka)');

const CODE = between('// ---------- Sekačka Anthbot (cloud) ----------',
                     '// ---------- Tlačítka na Asistentovi');

const SN = 'M5TEST123';
const KLICE = {
  klicId: 'ASIA1', tajny: 'secret', relace: 'tok',
  region: 'eu-central-1', endpoint: 'abc-ats.iot.eu-central-1.amazonaws.com',
  doKdy: Date.now() + 3600000
};

function build({ email = 'a@b.cz', heslo = 'tajne' } = {}) {
  const logy = [];
  const zpravy = [];
  const routy = {};
  const state = { sekacka: { stin: null, kdy: 0, potiz: null } };
  const casovace = [];
  const api = new Function(
    'state', 'app', 'requireAuth', 'addLog', 'broadcast', 'crypto', 'fetch', 'process', 'scheduleEvery',
    CODE + '\n; return { anthbotEnabled, anthbotPodpisovyKlic, anthbotKoduj, anthbotOtisk,'
         + ' anthbotKanonickeHlavicky, anthbotAutorizace, anthbotCas, anthbotOverovaciToken,'
         + ' anthbotZeSeznamu, anthbotHodnota, anthbotCislo, anthbotStavZeStinu, anthbotPrectiStin,'
         + ' anthbotPodepsanyDotaz, anthbotPodepsanyPovel, anthbotPosliPovel, anthbotPriprav,'
         + ' anthbotStin, anthbotKliceStare, sekackaNacti, sekackaPayload,'
         + ' ANTHBOT_STAVY_PORADI, ANTHBOT_STAVY_CESKY, ANTHBOT_POVELY, ANTHBOT_VARIANTY,'
         + ' ANTHBOT_KLICE_REZERVA_MS, ANTHBOT_AREA,'
         + ' get token() { return anthbotToken; }, set token(v) { anthbotToken = v; },'
         + ' get stroj() { return anthbotStroj; }, set stroj(v) { anthbotStroj = v; },'
         + ' get klice() { return anthbotKlice; }, set klice(v) { anthbotKlice = v; } };'
  )(
    state,
    { get: (c, f) => { routy['GET ' + c] = f; }, post: (c, f) => { routy['POST ' + c] = f; } },
    () => true,
    (m, level) => logy.push((level === 'error' ? 'CHYBA ' : '') + m),
    (udalost, data) => zpravy.push({ udalost, data }),
    require('crypto'),
    (...a) => globalThis.fetch(...a),
    { env: { ANTHBOT_EMAIL: email, ANTHBOT_HESLO: heslo } },
    (fn, ms) => casovace.push({ fn, ms })
  );
  return { api, state, logy, zpravy, routy, casovace };
}

const volej = (h, cesta, telo) => {
  let out = null, kod = 200;
  const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
  return Promise.resolve(h.routy[cesta]({ body: telo }, res)).then(() => ({ out, kod }));
};

// Falešný cloud i AWS v jednom: podle adresy vrátí připravenou odpověď.
function podstrc(odpovedi) {
  const videno = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const klic = u.hostname.includes('anthbot') ? u.pathname : 'aws';
    videno.push({
      url: String(url), cesta: u.pathname, metoda: opts.method || 'GET',
      hlavicky: opts.headers || {}, telo: opts.body ? JSON.parse(opts.body) : null
    });
    const o = odpovedi[klic];
    if (o === undefined) throw new Error('falešný cloud nezná ' + klic);
    if (typeof o === 'function') return o(videno[videno.length - 1], videno.length);
    return { ok: true, status: 200, text: async () => JSON.stringify(o) };
  };
  return videno;
}

const CESTA_CELA = {
  '/api/v1/login': { code: 0, data: { access_token: 'xyz' } },
  '/api/v1/device/bind/list': { code: 0, data: [{ sn: SN, alias: 'Zahrada', category_id: 5 }] },
  '/api/v1/device/v2/iot/sts/arn': {
    code: 0,
    data: {
      access_key_id: 'ASIA1', secret_access_key: 'secret', session_token: 'tok',
      region_name: 'eu-central-1', endpoint: 'https://abc-ats.iot.eu-central-1.amazonaws.com/',
      expiration: Math.floor(Date.now() / 1000) + 3600
    }
  },
  aws: () => ({ ok: true, status: 200, text: async () => JSON.stringify({ state: { reported: { elec: { value: 87 }, robot_sta: { value: 'globalmowing' } } } }) })
};

const puvodniFetch = globalThis.fetch;

(async () => {

nadpis('1) Podpis SigV4 proti vzoru od AWS');
{
  const h = build();
  check('podpisový klíč sedí s AWS',
    h.api.anthbotPodpisovyKlic('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam').toString('hex'),
    'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
  // Celá hlavička Authorization proti druhému vzorovému příkladu (get-vanilla)
  check('hlavička Authorization sedí s AWS', h.api.anthbotAutorizace({
    klicId: 'AKIDEXAMPLE', tajny: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', den: '20150830', amzDatum: '20150830T123600Z',
    metoda: 'GET', cesta: '/', dotaz: '',
    hlavicky: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    otiskTela: h.api.anthbotOtisk(''), sluzba: 'service'
  }), 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, '
    + 'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');

  check('hlavičky se řadí a jdou na malá písmena',
    h.api.anthbotKanonickeHlavicky({ 'X-B': '1', a: '  x   y ' }).podepsane, 'a;x-b');
  check('  a mezery se smrsknou', h.api.anthbotKanonickeHlavicky({ a: '  x   y ' }).kanonicke, 'a:x y\n');
  check('lomítko zůstává', h.api.anthbotKoduj('/a/b'), '/a/b');
  check('  ale jde zakódovat taky', h.api.anthbotKoduj('/a/b', '-._~'), '%2Fa%2Fb');
  check('dolar se kóduje', h.api.anthbotKoduj('$aws', '-._~'), '%24aws');
  check('procento se kóduje znovu', h.api.anthbotKoduj('%24'), '%2524');
  const t = h.api.anthbotCas(new Date('2026-09-18T07:05:09.123Z'));
  check('razítko je ve tvaru AWS', t.amz, '20260918T070509Z');
  check('den je prvních osm znaků', t.den, '20260918');
}

nadpis('2) Ověřovací token');
{
  const h = build();
  const a = h.api.anthbotOverovaciToken(SN, 1700000000);
  check('token končí časem', a.slice(-10), '1700000000');
  check('a má 42 znaků', a.length, 42);
  // Bez měnícího se času by šel stejný požadavek donekonečna přehrávat
  check('jiný čas dá jiný token', h.api.anthbotOverovaciToken(SN, 1700000001) === a, false);
}

nadpis('3) Čtení stavu ze stínu');
{
  const h = build();
  check('hodnota se vybalí z value', h.api.anthbotHodnota({ value: 5 }), 5);
  check('holá hodnota projde', h.api.anthbotHodnota(7), 7);
  check('pole se nevybaluje', JSON.stringify(h.api.anthbotHodnota([1, 2])), '[1,2]');

  check('stav z robot_sta', h.api.anthbotStavZeStinu({ robot_sta: { value: 'GlobalMowing' } }), 'globalmowing');
  // M5 hlásí stav i pod jiným jménem — bereme, co se najde dřív
  check('stav z mode, když robot_sta chybí', h.api.anthbotStavZeStinu({ mode: { value: 'charge' } }), 'charge');
  check('číslo se přeloží podle pořadí', h.api.anthbotStavZeStinu({ robot_sta: { value: 2 } }), 'charge');
  check('neznámé číslo se vypíše', h.api.anthbotStavZeStinu({ robot_sta: { value: 99 } }), '99');
  check('prázdný stín nedá nic', h.api.anthbotStavZeStinu({}), null);

  const p = h.api.anthbotPrectiStin({
    elec: { value: 87 }, robot_sta: { value: 'globalmowing' }, error: { value: 0 },
    param_set: { cutter_height: 45 }, mowing_area_new: { value: 120 },
    mowing_time_new: { value: 18 }, mowing_time: { value: 7200 },
    rtk: { state: 4 }, net_config: { ip: '192.168.1.9' }, volume: 60
  });
  check('baterie', p.baterie, 87);
  check('stav česky', p.popis, 'seká');
  check('výška z param_set', p.vyska, 45);
  check('plocha záběru', p.plocha, 120);
  // Celkový čas chodí v sekundách, v appce se ukazují minuty
  check('celkový čas se přepočte na minuty', p.minutyCelkem, 120);
  check('RTK', p.rtk, 4);
  // Co M5 doopravdy hlásí — podle prvního ostrého čtení. `robot_sta`,
  // `mowing_area_new` ani `mowing_time_new` u něj vůbec nejsou, zato chodí
  // spousta jiného, co se dřív zahazovalo.
  const m5 = h.api.anthbotPrectiStin({
    mode: { value: 'shutdown' }, online: { value: 0 }, elec: { value: 57 },
    error: { value: 2133 }, event: { value: 1045 },
    map: { map_area: 297, area_id: 3 }, active_area: { id: [102, 101] },
    grass_state: { grass_bag_in_position: 1 }, fw_version: { value: '1.2.3' },
    net_state: { value: 'wifi' }, mowing_area: { value: 900 }
  });
  check('odpojená sekačka se pozná', m5.online, false);
  check('  a stav chodí z mode', m5.stav, 'shutdown');
  check('velikost trávníku z map.map_area', m5.travnik, 297);
  check('aktivní zóny', JSON.stringify(m5.zony), '[102,101]');
  check('koš na trávu', m5.kos, 1);
  check('událost se nese dál', m5.udalost, 1045);
  // Co číslo 2133 znamená, není nikde popsané — nepřekládá se, jen se ukáže
  check('chybový kód zůstane číslem', m5.chyba, 2133);
  check('firmware', m5.firmware, '1.2.3');
  check('síť', m5.sit, 'wifi');
  check('sekačka na příjmu', h.api.anthbotPrectiStin({ online: { value: 1 } }).online, true);
  check('bez pole online se nic nepředstírá', h.api.anthbotPrectiStin({}).online, null);
  check('síť ze záložního pole', h.api.anthbotPrectiStin({ net_config: { type: '4G' } }).sit, '4G');
  // Firmware chodí u některých modelů jako celý objekt — ten se nahoru nehodí,
  // je vidět dole v syrovém hlášení
  check('firmware jako objekt se nevypisuje',
    h.api.anthbotPrectiStin({ fw_version: { main: '1', mcu: '2' } }).firmware, null);
  check('chybějící pole nic neshodí', h.api.anthbotPrectiStin({ map: null, active_area: 5 }).travnik, null);
  check('  a zóny, co nejsou pole, se zahodí', h.api.anthbotPrectiStin({ active_area: { id: 7 } }).zony, null);
  check('prázdný stín nespadne', h.api.anthbotPrectiStin(null).baterie, null);
  check('  a stav je nic', h.api.anthbotPrectiStin(null).popis, null);
  check('výška z mow_remote, když param_set chybí',
    h.api.anthbotPrectiStin({ mow_remote: { cutter_height: 30 } }).vyska, 30);
  check('každý stav má český popis',
    h.api.ANTHBOT_STAVY_PORADI.every(s => h.api.ANTHBOT_STAVY_CESKY[s]), true);
}

nadpis('4) Seznam sekaček');
{
  const h = build();
  const s = h.api.anthbotZeSeznamu([{ sn: SN, alias: 'Zahrada', category_id: 5 }]);
  check('vezme se první se sériákem', s.sn, SN);
  check('jméno z aliasu', s.jmeno, 'Zahrada');
  check('bez aliasu je jméno sériák', h.api.anthbotZeSeznamu([{ sn: 'B' }]).jmeno, 'B');
  check('položka bez sériáku se přeskočí', h.api.anthbotZeSeznamu([{ alias: 'x' }, { sn: 'C' }]).sn, 'C');
  check('prázdno je nic', h.api.anthbotZeSeznamu([]), null);
  check('nepole je nic', h.api.anthbotZeSeznamu(null), null);
}

nadpis('5) Podepsaný dotaz na stav');
{
  const h = build();
  const d = h.api.anthbotPodepsanyDotaz(KLICE, SN, 'property', new Date('2026-09-18T07:05:09Z'));
  check('adresa míří na shadow sekačky', d.url,
    'https://abc-ats.iot.eu-central-1.amazonaws.com/things/M5TEST123/shadow?name=property');
  check('rozsah má službu iotdata',
    d.hlavicky.Authorization.includes('/20260918/eu-central-1/iotdata/aws4_request'), true);
  // Dočasné klíče bez podepsaného security tokenu AWS odmítne
  check('security token je podepsaný', d.hlavicky.Authorization.includes('x-amz-security-token'), true);
  check('  a posílá se', d.hlavicky['x-amz-security-token'], 'tok');
  const jiny = h.api.anthbotPodepsanyDotaz(KLICE, SN, 'property', new Date('2026-09-18T07:05:10Z'));
  check('jiný čas dá jiný podpis', jiny.hlavicky.Authorization === d.hlavicky.Authorization, false);
}

nadpis('6) Povel');
{
  const h = build();
  const p = h.api.anthbotPodepsanyPovel(KLICE, SN, 'mow_start', 1, 'dvojita', new Date('2026-09-18T07:05:09Z'));
  check('tělo je desired s povelem', p.telo, '{"state":{"desired":{"cmd":"mow_start","data":1}}}');
  check('adresa míří na servisní shadow', p.url.includes('%24aws%2Fthings%2FM5TEST123%2Fshadow%2Fname%2Fservice%2Fupdate'), true);
  check('posílá se octet-stream', p.hlavicky['Content-Type'], 'application/octet-stream');
  check('délka těla je podepsaná', p.hlavicky.Authorization.includes('content-length'), true);
  // Tři tvary cesty proto, že appka kanonizuje jinak než SDK a AWS je na to citlivé
  check('variant je na výběr víc', h.api.ANTHBOT_VARIANTY.length, 3);
  const syra = h.api.anthbotPodepsanyPovel(KLICE, SN, 'mow_start', 1, 'syra', new Date('2026-09-18T07:05:09Z'));
  check('syrová varianta má jinou adresu', syra.url === p.url, false);
  check('  a jiný podpis', syra.hlavicky.Authorization === p.hlavicky.Authorization, false);

  // První tvar projde → na další se nesahá
  let kolikrat = 0;
  globalThis.fetch = async () => { kolikrat++; return { ok: true, status: 200, text: async () => '{}' }; };
  check('při úspěchu se zkouší jednou', await h.api.anthbotPosliPovel(KLICE, SN, 'mow_start') && kolikrat, 1);

  // 403 znamená netrefený podpis — zkusí se další tvar
  kolikrat = 0;
  globalThis.fetch = async () => { kolikrat++; return { ok: kolikrat === 3, status: kolikrat === 3 ? 200 : 403, text: async () => '{}' }; };
  await h.api.anthbotPosliPovel(KLICE, SN, 'mow_start');
  check('po 403 se zkusí další tvar', kolikrat, 3);

  // Cokoliv jiného než 403 je odmítnutí od AWS a opakovat nemá smysl
  kolikrat = 0;
  globalThis.fetch = async () => { kolikrat++; return { ok: false, status: 400, text: async () => 'bad' }; };
  const spatny = await h.api.anthbotPosliPovel(KLICE, SN, 'mow_start').then(() => '(prošlo)', e => e.message);
  check('jiná chyba se neopakuje', kolikrat, 1);
  check('  a řekne se', spatny.includes('HTTP 400'), true);

  check('povely jsou tři', Object.keys(h.api.ANTHBOT_POVELY).join(','), 'sekat,stop,dok');
  check('sekat je mow_start', h.api.ANTHBOT_POVELY.sekat.cmd, 'mow_start');
  check('stop je stop_all_tasks', h.api.ANTHBOT_POVELY.stop.cmd, 'stop_all_tasks');
  check('dok je charge_start', h.api.ANTHBOT_POVELY.dok.cmd, 'charge_start');
}

nadpis('7) Příprava spojení');
{
  const h = build();
  const videno = podstrc(CESTA_CELA);
  const pripraveno = await h.api.anthbotPriprav();
  check('přihlásí se', h.api.token, 'Bearer xyz');
  check('najde sekačku', pripraveno.stroj.sn, SN);
  check('vezme si klíče', pripraveno.klice.klicId, 'ASIA1');
  check('adresa klíčů je holý host', pripraveno.klice.endpoint, 'abc-ats.iot.eu-central-1.amazonaws.com');
  check('prošly tři dotazy', videno.length, 3);

  // Podruhé už se nemá co dělat — token, sekačka i klíče platí
  videno.length = 0;
  await h.api.anthbotPriprav();
  check('podruhé se nikam nechodí', videno.length, 0);

  // Klíče vyprší; obnoví se s rezervou, ne až na hraně
  h.api.klice = { ...KLICE, doKdy: Date.now() + h.api.ANTHBOT_KLICE_REZERVA_MS - 1000 };
  check('klíče před vypršením jsou staré', h.api.anthbotKliceStare(), true);
  videno.length = 0;
  await h.api.anthbotPriprav();
  check('  a obnoví se', videno.length, 1);
  check('  jen ony, ne přihlášení', videno[0].cesta, '/api/v1/device/v2/iot/sts/arn');

  // Znovu od nuly: token vypršel, jde se celou cestou
  videno.length = 0;
  await h.api.anthbotPriprav(true);
  check('znovu projde celou cestu', videno.length, 3);
}

nadpis('8) Načtení stavu');
{
  const h = build();
  podstrc(CESTA_CELA);
  await h.api.sekackaNacti();
  check('stav se uloží', h.state.sekacka.stin.elec.value, 87);
  check('  a zapíše čas', h.state.sekacka.kdy > 0, true);
  check('  bez potíží', h.state.sekacka.potiz, null);
  check('změna stavu jde do logu', h.logy[h.logy.length - 1], 'Sekačka: seká');
  check('pošle se do appky', h.zpravy[h.zpravy.length - 1].udalost, 'sekacka');

  // Stejný stav se do logu nepíše podruhé — čte se po minutě
  const logu = h.logy.length;
  await h.api.sekackaNacti();
  check('stejný stav se nelogují dvakrát', h.logy.length, logu);

  const p = h.api.sekackaPayload();
  check('payload má baterii', p.baterie, 87);
  check('  i jméno sekačky', p.jmeno, 'Zahrada');
  // Syrový stav jde do appky schválně: jména polí u M5 nejsou popsaná
  check('  i syrový stav', typeof p.syrove, 'object');
  check('  a je zapnutá', p.zapnuto, true);
  // Odpojená sekačka musí být poznat až v appce — jinak by tam svítila
  // baterie a stav, jako by platily teď
  h.state.sekacka.stin = { ...h.state.sekacka.stin, online: { value: 0 } };
  check('  offline propadne až do payloadu', h.api.sekackaPayload().online, false);
}

nadpis('9) Když cloud nespolupracuje');
{
  const h = build();
  // 403 znamená „přihlaš se znovu"; jednou to zkusíme sami
  let pokusu = 0;
  podstrc({
    ...CESTA_CELA,
    aws: () => {
      pokusu++;
      if (pokusu === 1) return { ok: false, status: 403, text: async () => 'expired' };
      return CESTA_CELA.aws();
    }
  });
  await h.api.sekackaNacti();
  check('po 403 se zkusí přihlásit znovu', pokusu, 2);
  check('  a stav dorazí', h.state.sekacka.stin.elec.value, 87);
  check('  bez potíží', h.state.sekacka.potiz, null);

  // Když to nejde ani napodruhé, appka to přizná místo mlčení
  const h2 = build();
  podstrc({ ...CESTA_CELA, aws: () => ({ ok: false, status: 500, text: async () => 'rozbité' }) });
  await h2.api.sekackaNacti();
  check('trvalá chyba se přizná', String(h2.state.sekacka.potiz).includes('HTTP 500'), true);
  check('  a pošle do appky', h2.zpravy[h2.zpravy.length - 1].udalost, 'sekacka');
  // Chybový kód sekačky a problém se spojením jsou dvě různé věci. Když se
  // sekačka porouchá A zároveň vypadne cloud, musí být vidět obojí.
  h2.state.sekacka.stin = { error: { value: 7 }, robot_sta: { value: 'pause' } };
  const oboji = h2.api.sekackaPayload();
  check('potíž se spojením je v payloadu', String(oboji.potiz).includes('HTTP 500'), true);
  check('  a chybový kód sekačky vedle ní', oboji.chyba, 7);

  const h3 = build();
  podstrc({ ...CESTA_CELA, '/api/v1/login': { code: 10001, msg: 'wrong password' } });
  await h3.api.sekackaNacti();
  check('špatné heslo se přizná', String(h3.state.sekacka.potiz).includes('cloud odmítl'), true);
}

nadpis('10) Endpointy');
{
  const h = build();
  podstrc(CESTA_CELA);
  const ok = await volej(h, 'POST /api/sekacka/povel', { co: 'sekat' });
  check('povel projde', ok.out.success, true);
  check('  a řekne, co dělá', ok.out.message, 'Sekačka: začít sekat.');
  check('do logu se to zapsalo', h.logy.some(l => l.includes('začít sekat (ručně)')), true);

  const neznamy = await volej(h, 'POST /api/sekacka/povel', { co: 'leť' });
  check('neznámý povel se odmítne', neznamy.kod, 400);

  podstrc({ ...CESTA_CELA, aws: () => ({ ok: false, status: 400, text: async () => 'ne' }) });
  const padly = await volej(h, 'POST /api/sekacka/povel', { co: 'stop' });
  check('nedoručený povel se přizná', padly.kod, 502);

  podstrc(CESTA_CELA);
  const obnova = await volej(h, 'POST /api/sekacka/obnov', {});
  check('obnova projde', obnova.out.ok, true);
  check('  a vrátí stav', obnova.out.sekacka.baterie, 87);

  // Obrys pozemku a stopa sekačky jsou na kartě oříznuté. Přes tenhle endpoint
  // jde celý stín otevřít a poslat — bez něj se mapa dolaďovat nedá.
  const syrove = await volej(h, 'GET /api/sekacka/syrove', null);
  check('syrové hlášení vrátí celý stín', syrove.out.stin.elec.value, 87);
  check('  i s časem čtení', syrove.out.kdy > 0, true);
  const prazdna = build();
  const nic = await volej(prazdna, 'GET /api/sekacka/syrove', null);
  check('prázdný stín taky projde', nic.kod, 200);
  check('  a přizná, že nic není', nic.out.stin, null);
}

nadpis('11) Bez přihlašovacích údajů');
{
  const h = build({ email: '', heslo: '' });
  check('sekačka je vypnutá', h.api.anthbotEnabled, false);
  check('payload to přizná', h.api.sekackaPayload().zapnuto, false);
  // Bez údajů se nesmí nic zkoušet — jinak by to bušilo do cloudu naprázdno
  let sahnuto = 0;
  globalThis.fetch = async () => { sahnuto++; throw new Error('sem se to nemá dostat'); };
  await h.api.sekackaNacti();
  check('do cloudu se vůbec nesáhne', sahnuto, 0);
  check('  a nic se nenačte', h.state.sekacka.kdy, 0);
  const povel = await volej(h, 'POST /api/sekacka/povel', { co: 'sekat' });
  check('povel se odmítne', povel.kod, 503);
  check('  a řekne se proč', povel.out.error.includes('ANTHBOT_EMAIL'), true);
}

globalThis.fetch = puvodniFetch;
konec();
})().catch(err => {
  globalThis.fetch = puvodniFetch;
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
