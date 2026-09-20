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
  const cekani = [];
  const api = new Function(
    'state', 'app', 'requireAuth', 'addLog', 'broadcast', 'crypto', 'fetch', 'process', 'scheduleEvery', 'delay',
    CODE + '\n; return { anthbotEnabled, anthbotPodpisovyKlic, anthbotKoduj, anthbotOtisk,'
         + ' anthbotKanonickeHlavicky, anthbotAutorizace, anthbotCas, anthbotOverovaciToken,'
         + ' anthbotZeSeznamu, anthbotHodnota, anthbotCislo, anthbotStavZeStinu, anthbotPrectiStin,'
         + ' anthbotPodepsanyDotaz, anthbotPodepsanyPovel, anthbotPosliPovel, anthbotPriprav,'
         + ' anthbotStin, anthbotKliceStare, sekackaNacti, sekackaPayload,'
         + ' ANTHBOT_STAVY_PORADI, ANTHBOT_STAVY_CESKY, ANTHBOT_POVELY, ANTHBOT_VARIANTY,'
         + ' anthbotTeloPovelu, anthbotOverStav, anthbotSit, ANTHBOT_TVARY, ANTHBOT_OVERENI_MS,'
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
    (fn, ms) => casovace.push({ fn, ms }),
    // Ověřování povelu čeká osm vteřin naostro. V sadě se čekat nemá — zajímá
    // nás, KOLIKRÁT se čte a co z toho vyjde, ne jak dlouho to trvá.
    ms => { cekani.push(ms); return Promise.resolve(); }
  );
  return { api, state, logy, zpravy, routy, casovace, cekani };
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
    param_set: { cutter_height: 45 }, mowing_area: { value: 900 },
    mowing_time: { value: 7200 }
  });
  check('baterie', p.baterie, 87);
  check('stav česky', p.popis, 'seká');
  check('výška z param_set', p.vyska, 45);
  check('celková plocha', p.plochaCelkem, 900);
  // Celkový čas chodí v sekundách, v appce se ukazují minuty
  check('celkový čas se přepočte na minuty', p.minutyCelkem, 120);
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
  // Co číslo 2133 znamená, není nikde popsané — nepřekládá se, jen se ukáže
  check('chybový kód zůstane číslem', m5.chyba, 2133);
  check('sekačka na příjmu', h.api.anthbotPrectiStin({ online: { value: 1 } }).online, true);
  check('bez pole online se nic nepředstírá', h.api.anthbotPrectiStin({}).online, null);
  check('chybějící pole nic neshodí', h.api.anthbotPrectiStin({ map: null }).travnik, null);

  // Vybírají se jen pole, která stránka ukazuje. Zbytek stínu jde do appky celý
  // v `syrove` — mrtvá pole navíc by vypadala živě a nikdo by je nehlídal.
  const ZBYLA = ['udalost', 'kos', 'zony', 'firmware', 'sit', 'ip', 'hlasitost', 'rtk', 'plocha', 'minuty'];
  check('žádné pole, co se neukazuje', ZBYLA.filter(k => k in m5).join(', ') || 'žádné', 'žádné');
  check('  a zůstala jen ta ukazovaná', Object.keys(m5).sort().join(','),
    'baterie,chyba,minutyCelkem,online,plochaCelkem,popis,stav,travnik,vyska');
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
  check('posílá se octet-stream', p.hlavicky['content-type'], 'application/octet-stream');
  check('délka těla je podepsaná', p.hlavicky.Authorization.includes('content-length'), true);

  // TOHLE je ta chyba, kvůli které nešel poslat jediný povel. `content-type` se
  // dřív přidával dvakrát — jednou malými písmeny do podpisu, podruhé velkými
  // mezi odesílané. V JS dva klíče, na drátě jedna hlavička: fetch je spojil
  // čárkou a AWS pak porovnávalo jinou hodnotu, než jaká šla do podpisu.
  const klice = Object.keys(p.hlavicky).map(k => k.toLowerCase());
  check('žádná hlavička dvakrát',
    klice.filter((k, i) => klice.indexOf(k) !== i).join(', ') || 'žádná', 'žádná');
  // A co se podepsalo, to se taky musí odeslat — jinak je podpis k ničemu
  const podepsane = p.hlavicky.Authorization.match(/SignedHeaders=([^,]+)/)[1].split(';');
  // Nestačí, že klíč v objektu je — musí nést hodnotu. Prázdná podepsaná
  // hlavička je pro AWS totéž jako chybějící: podpis nesedí.
  const odeslane = new Headers(p.hlavicky);
  check('  a všechno podepsané se odesílá i s hodnotou',
    podepsane.filter(k => k !== 'host' && !odeslane.get(k)).join(', ') || 'všechno', 'všechno');
  // `fetch` hlavičky spojuje, takže duplicitu pozná až Headers — ne oko
  const hlavicky = new Headers(p.hlavicky);
  check('  a ani po složení se nic nezdvojí',
    hlavicky.get('content-type'), 'application/octet-stream');

  // Který tvar dat sekačka chce, se dopředu poznat nedá — `category_id` je číslo
  check('zabalený tvar dat', JSON.stringify(h.api.anthbotTeloPovelu('mow_start', 1, 'zabaleny')),
    '{"mow_start":1}');
  check('holý tvar dat', h.api.anthbotTeloPovelu('mow_start', 1, 'holy'), 1);
  check('tvary jsou dva a zabalený první', h.api.ANTHBOT_TVARY.join(','), 'zabaleny,holy');
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
  // Celý stín se do appky netahá — je na to endpoint. Obrys pozemku po drátě
  // při každém čtení, když ho nikdo nekreslí, je čistá režie navíc.
  check('  ale ne celý stín', 'syrove' in p, false);
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
  // Hláška nese stav, který sekačka opravdu hlásí — ne jen „odesláno"
  check('  a řekne, co se stalo', ok.out.message, 'Sekačka: začít sekat — seká.');
  check('do logu se to zapsalo', h.logy.some(l => l.includes('začít sekat (ručně')), true);
  check('  i s tím, který tvar zabral', h.logy.some(l => l.includes('tvar zabaleny')), true);

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

nadpis('10b) Povel se ověřuje, nehlásí se naslepo');
// Publikace na shadow vrátí 200, jakmile ji AWS přijme. To znamená „zpráva je
// ve frontě", ne „sekačka to udělala" — a přesně z toho vzniklo „nereaguje".
{
  // a) sekačka se nehne ani po obou tvarech
  const h = build();
  const videno = podstrc({
    ...CESTA_CELA,
    aws: () => ({ ok: true, status: 200, text: async () => JSON.stringify({
      state: { reported: { elec: { value: 87 }, mode: { value: 'charge' } } } }) })
  });
  h.state.sekacka.stin = { mode: { value: 'charge' } };
  const nic = await volej(h, 'POST /api/sekacka/povel', { co: 'sekat' });
  check('neověřený povel se nehlásí jako úspěch', nic.out.success, undefined);
  check('  a vrátí se chyba', nic.kod, 502);
  check('  která to řekne narovinu', nic.out.error.includes('nehnula'), true);
  check('  a přizná, že zkusila oba tvary', nic.out.error.includes('zabaleny, holy'), true);
  check('do logu jde, že se nehnula', h.logy.some(l => l.startsWith('CHYBA') && l.includes('nehnula')), true);

  // Zkusily se oba tvary, a u „sekat" ještě app_state napřed
  const povely = videno.filter(v => v.cesta.includes('/topics/'))
    .map(v => v.telo.state.desired);
  check('appka se napřed ohlásí u kormidla', povely[0].cmd, 'app_state');
  check('zabalený tvar jde první', JSON.stringify(povely[1].data), '{"mow_start":1}');
  check('  a holý až potom', povely[2].data, 1);
  check('víc už se nezkouší', povely.length, 3);

  // b) první tvar zabere → druhý se neposílá
  const h2 = build();
  const videno2 = podstrc(CESTA_CELA);
  h2.state.sekacka.stin = { mode: { value: 'charge' } };
  const jede = await volej(h2, 'POST /api/sekacka/povel', { co: 'sekat' });
  check('když stav naskočí, je to úspěch', jede.out.success, true);
  const povely2 = videno2.filter(v => v.cesta.includes('/topics/'))
    .map(v => v.telo.state.desired);
  check('  a druhý tvar se už neposílá', povely2.length, 2);
  check('  a stav v appce se rovnou obnoví', h2.state.sekacka.stin.robot_sta.value, 'globalmowing');

  // c) app_state patří jen k rozjezdu — do doku se nikdo hlásit nemusí
  const h3 = build();
  const videno3 = podstrc(CESTA_CELA);
  await volej(h3, 'POST /api/sekacka/povel', { co: 'dok' });
  const cmdy = videno3.filter(v => v.cesta.includes('/topics/'))
    .map(v => v.telo.state.desired.cmd);
  check('u doku se app_state neposílá', cmdy.includes('app_state'), false);
  check('  a jde rovnou charge_start', cmdy[0], 'charge_start');
}

nadpis('10c) Síťová chyba řekne, kde spadla');
// „fetch failed" je v Node holé selhání spojení — ani slovo o tom, který krok
// a který server to byl. Skutečný důvod leží v `cause`.
{
  const h = build();
  const sit = h.api.anthbotSit;
  const pad = (nastav) => sit('přihlášení (api.anthbot.com)', async () => {
    const e = new TypeError('fetch failed');
    Object.assign(e, nastav);
    throw e;
  }).then(() => 'nespadlo', e => e.message);

  check('doplní se krok i server', await pad({ cause: { code: 'ENOTFOUND' } }),
    'přihlášení (api.anthbot.com): spojení selhalo — ENOTFOUND');
  check('  i jiný kód', (await pad({ cause: { code: 'ECONNREFUSED' } })).includes('ECONNREFUSED'), true);
  check('bez kódu se aspoň ví kde', await pad({}), 'přihlášení (api.anthbot.com): spojení selhalo');
  check('vypršení času se pojmenuje jinak',
    await pad({ name: 'TimeoutError' }), 'přihlášení (api.anthbot.com): nestihlo se to včas');
  // HTTP chybu už někdo pojmenoval — ta se nesmí přepsat na „spojení selhalo"
  const httpChyba = await sit('čtení stavu', async () => {
    const e = new Error('stav: HTTP 403 — nope');
    e.status = 403;
    throw e;
  }).then(() => 'nespadlo', e => e.message);
  check('hotová HTTP hláška se nepřepisuje', httpChyba, 'stav: HTTP 403 — nope');
  check('  a když nic nespadne, projde výsledek', await sit('x', async () => 42), 42);
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
