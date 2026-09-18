// Sekačka Anthbot: přihlášení do cloudu a čtení stavu.
//
// Čím se tahle sada liší od té závlahové: podpis SigV4 se dá ověřit **zvenčí**.
// AWS zveřejnilo vzorové příklady — vstup i očekávaný podpis — takže tady
// nejde jen o to, že je skript sám se sebou v souladu, ale že počítá totéž
// co AWS. Když se tenhle podpis netrefí, cloud odpoví 403 bez jediného slova
// vysvětlení, takže spoléhat na ostrý běh by znamenalo hádat.
//
// Co tahle sada NEDOKÁŽE: ověřit tvar odpovědí Anthbotu. Ten je reverzně
// zjištěný a odsud na účet ani na sekačku není vidět — fixtury jsou psané
// podle komunitní integrace, ne odchycené z ostrého provozu. Potvrdí to až
// první běh u člověka doma.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('sekačka Anthbot');

const S = require('../public/nas/sekacka-test.js');

const SN = 'M5TEST123';
const TOKEN = 'Bearer abc123';
const NASTAVENI = { email: 'nekdo@example.com', heslo: 'tajne', areaCode: '420' };

// Falešný cloud: podle cesty vrátí připravenou odpověď a zapamatuje si dotaz.
function podstrc(odpovedi) {
  const videno = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const klic = u.pathname;
    videno.push({
      url: String(url), cesta: klic, metoda: opts.method || 'GET',
      hlavicky: opts.headers || {},
      telo: opts.body ? JSON.parse(opts.body) : null,
      dotaz: Object.fromEntries(u.searchParams)
    });
    const o = odpovedi[klic];
    if (o === undefined) throw new Error('falešný cloud nezná cestu ' + klic);
    if (typeof o === 'function') return o(videno[videno.length - 1]);
    return { ok: true, status: 200, text: async () => JSON.stringify(o) };
  };
  return videno;
}

nadpis('1) Podpis SigV4 proti vzoru od AWS');
{
  // Zveřejněný příklad: tajný klíč, datum, region a služba → podpisový klíč
  const klic = S.podpisovyKlic('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam');
  check('podpisový klíč sedí s AWS', klic.toString('hex'),
    'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
  // Pořadí kroků odvození je součást normy — jiné pořadí dá jiný klíč
  check('jiná služba dá jiný klíč',
    S.podpisovyKlic('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iotdata').toString('hex')
      === klic.toString('hex'), false);
  check('jiný region dá jiný klíč',
    S.podpisovyKlic('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'eu-west-1', 'iam').toString('hex')
      === klic.toString('hex'), false);
  check('jiný den dá jiný klíč',
    S.podpisovyKlic('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150831', 'us-east-1', 'iam').toString('hex')
      === klic.toString('hex'), false);

  // A celá hlavička Authorization proti druhému vzorovému příkladu (get-vanilla)
  const p = S.kanonickyPozadavek({
    metoda: 'GET', cesta: '/', dotaz: '',
    hlavicky: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    otiskTela: S.otisk('')
  });
  // Norma má šest částí; blok hlaviček si nese vlastní konec řádku, takže
  // po rozsekání vyjde o jednu víc — na tom se pozná, že tam ten konec je
  const casti = p.text.split('\n');
  check('kanonický požadavek začíná metodou', casti[0], 'GET');
  check('  a končí otiskem těla', casti[casti.length - 1], S.otisk(''));
  check('  blok hlaviček končí prázdným řádkem', casti[casti.length - 3], '');
  check('podepsané hlavičky jsou seřazené', p.podepsane, 'host;x-amz-date');
  check('hlavička Authorization sedí s AWS', S.autorizace({
    klicId: 'AKIDEXAMPLE', tajny: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', den: '20150830', amzDatum: '20150830T123600Z',
    pozadavek: p.text, podepsane: p.podepsane, sluzba: 'service'
  }), 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, '
    + 'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
}

nadpis('2) Kanonická cesta a hlavičky');
{
  check('obyčejná cesta projde beze změny', S.kanonickaCesta('/things/ABC123/shadow'), '/things/ABC123/shadow');
  check('lomítka se nekódují', S.kanonickaCesta('/a/b/c'), '/a/b/c');
  // AWS chce v podpisu procento zakódované znovu, jinak 403
  check('procento se kóduje znovu', S.kanonickaCesta('/things/%24aws/shadow'), '/things/%2524aws/shadow');
  check('mezera se kóduje', S.kanonickaCesta('/a b'), '/a%20b');
  check('tilda a tečka zůstávají', S.kanonickaCesta('/a~b.c_d-e'), '/a~b.c_d-e');

  const h = S.kanonickeHlavicky({ 'X-Amz-Date': '20150830T123600Z', Host: 'a.b', 'x-amz-content-sha256': 'ff' });
  check('hlavičky jsou malými písmeny a seřazené', h.podepsane, 'host;x-amz-content-sha256;x-amz-date');
  check('a v kanonickém tvaru taky', h.kanonicke.split('\n')[0], 'host:a.b');
  check('vícenásobné mezery se smrsknou',
    S.kanonickeHlavicky({ a: '  x   y  ' }).kanonicke, 'a:x y\n');
}

nadpis('3) Ověřovací token');
{
  const cekano = crypto.createHash('md5').update('M5TEST1231700000000', 'utf8').digest('hex') + '1700000000';
  check('je to otisk sériáku s časem a čas za ním', S.overovaciToken(SN, 1700000000), cekano);
  check('token končí časem', S.overovaciToken(SN, 1700000000).slice(-10), '1700000000');
  check('otisk má 32 znaků', S.overovaciToken(SN, 1700000000).length, 42);
  // Jiný čas musí dát jiný token, jinak by šel požadavek donekonečna přehrávat
  check('jiný čas dá jiný token',
    S.overovaciToken(SN, 1700000001) === S.overovaciToken(SN, 1700000000), false);
  check('jiná sekačka dá jiný token',
    S.overovaciToken('JINY', 1700000000) === S.overovaciToken(SN, 1700000000), false);
}

nadpis('4) Čas pro AWS');
{
  const t = S.amzCas(new Date('2026-09-18T07:05:09.123Z'));
  check('razítko je bez pomlček a dvojteček', t.amz, '20260918T070509Z');
  check('den je prvních osm znaků', t.den, '20260918');
}

const puvodniFetch = globalThis.fetch;

(async () => {

nadpis('5) Obálka cloudu');
{
  let videno = podstrc({ '/api/v1/test': { code: 0, data: { a: 1 } } });
  check('data se vrátí', JSON.stringify(await S.cloud('/api/v1/test')), '{"a":1}');
  check('posílá se verze v2', videno[0].hlavicky.version, 'v2');
  check('  a User-Agent appky', videno[0].hlavicky['User-Agent'], S.UA);
  check('bez tokenu se Authorization neposílá', videno[0].hlavicky.Authorization, undefined);

  videno = podstrc({ '/api/v1/test': { code: 0, data: 1 } });
  await S.cloud('/api/v1/test', { token: TOKEN });
  check('s tokenem se posílá Authorization', videno[0].hlavicky.Authorization, TOKEN);

  // code != 0 znamená odmítnutí. Číst po něm data by bylo čtení nesmyslu.
  podstrc({ '/api/v1/test': { code: 401, msg: 'token expired' } });
  const odmitnuto = await S.cloud('/api/v1/test').then(() => '(prošlo)', e => e.message);
  check('odmítnutí se pozná', odmitnuto.includes('cloud odmítl (code 401'), true);
  check('  a řekne se důvod', odmitnuto.includes('token expired'), true);

  podstrc({ '/api/v1/test': () => ({ ok: false, status: 500, text: async () => 'nope' }) });
  const http = await S.cloud('/api/v1/test').then(() => '(prošlo)', e => e.message);
  check('HTTP chyba se pozná', http.includes('HTTP 500'), true);

  podstrc({ '/api/v1/test': () => ({ ok: true, status: 200, text: async () => '<html>' }) });
  const neJson = await S.cloud('/api/v1/test').then(() => '(prošlo)', e => e.message);
  check('odpověď, co není JSON, se pozná', neJson.includes('není JSON'), true);
}

nadpis('6) Přihlášení');
{
  const videno = podstrc({ '/api/v1/login': { code: 0, data: { access_token: 'xyz' } } });
  check('vrací se bearer', await S.prihlas(NASTAVENI), 'Bearer xyz');
  check('posílá se POST', videno[0].metoda, 'POST');
  check('  s e-mailem jako username', videno[0].telo.username, NASTAVENI.email);
  check('  s heslem', videno[0].telo.password, NASTAVENI.heslo);
  check('  a předvolbou země', videno[0].telo.areaCode, '420');

  podstrc({ '/api/v1/login': { code: 0, data: {} } });
  const bezTokenu = await S.prihlas(NASTAVENI).then(() => '(prošlo)', e => e.message);
  check('přihlášení bez tokenu se pozná', bezTokenu, 'přihlášení prošlo, ale nepřišel token');

  podstrc({ '/api/v1/login': { code: 10001, msg: 'wrong password' } });
  const spatne = await S.prihlas(NASTAVENI).then(() => '(prošlo)', e => e.message);
  check('špatné heslo se pozná', spatne.includes('cloud odmítl'), true);
}

nadpis('7) Seznam sekaček');
{
  const seznam = S.sekackyZeSeznamu([
    { sn: SN, alias: 'Zahrada', category_id: 5, is_owner: true },
    { sn: 'B', category_id: null, is_owner: 0 },
    { alias: 'bez sériáku' },
    null
  ]);
  check('projdou jen sekačky se sériákem', seznam.length, 2);
  check('jméno se bere z aliasu', seznam[0].jmeno, 'Zahrada');
  // Bez aliasu se nemá co vymýšlet — ať je vidět aspoň sériové číslo
  check('bez aliasu je jméno sériák', seznam[1].jmeno, 'B');
  check('model se nese jako text', seznam[0].model, '5');
  check('chybějící model je prázdný', seznam[1].model, '');
  check('majitel jako číslo se přeloží', seznam[1].majitel, false);
  check('nepole je prázdný seznam', S.sekackyZeSeznamu(null).length, 0);

  const videno = podstrc({ '/api/v1/device/bind/list': { code: 0, data: [{ sn: SN, alias: 'Zahrada' }] } });
  check('endpoint sedí', (await S.sekacky(TOKEN)).length && videno[0].cesta, '/api/v1/device/bind/list');
}

nadpis('8) Region a dočasné klíče');
{
  let videno = podstrc({
    '/api/v1/device/v2/region': { code: 0, data: { region_name: 'eu-central-1', iot_endpoint: 'abc-ats.iot.eu-central-1.amazonaws.com' } }
  });
  const kraj = await S.region(TOKEN, SN);
  check('region se přečte', kraj.region, 'eu-central-1');
  check('  i adresa IoT', kraj.endpoint, 'abc-ats.iot.eu-central-1.amazonaws.com');
  check('sériák jde v dotazu', videno[0].dotaz.sn, SN);

  podstrc({ '/api/v1/device/v2/region': { code: 0, data: { region_name: 'eu-central-1' } } });
  const bezAdresy = await S.region(TOKEN, SN).then(() => '(prošlo)', e => e.message);
  check('chybějící adresa se pozná', bezAdresy, 'region neobsahuje adresu IoT');

  videno = podstrc({
    '/api/v1/device/v2/iot/sts/arn': {
      code: 0,
      data: {
        access_key_id: 'ASIA1', secret_access_key: 'secret', session_token: 'tok',
        region_name: 'eu-central-1', endpoint: 'https://abc-ats.iot.eu-central-1.amazonaws.com/',
        expiration: 1700000000
      }
    }
  });
  const klice = await S.docasneKlice(TOKEN, SN);
  check('klíče se přečtou', klice.klicId, 'ASIA1');
  check('  i dočasný token relace', klice.relace, 'tok');
  // Adresa přijde i s protokolem a lomítkem; do podpisu smí jen holý host
  check('adresa se očistí na holý host', klice.endpoint, 'abc-ats.iot.eu-central-1.amazonaws.com');
  check('posílá se ověřovací token', typeof videno[0].telo.verification_token, 'string');
  check('  a sériák', videno[0].telo.sn, SN);

  podstrc({ '/api/v1/device/v2/iot/sts/arn': { code: 0, data: { access_key_id: 'ASIA1' } } });
  const necelé = await S.docasneKlice(TOKEN, SN).then(() => '(prošlo)', e => e.message);
  check('neúplné klíče se poznají', necelé.includes('secret_access_key'), true);
}

nadpis('9) Podepsaný dotaz na stav');
{
  const klice = {
    klicId: 'ASIA1', tajny: 'secret', relace: 'tok',
    region: 'eu-central-1', endpoint: 'abc-ats.iot.eu-central-1.amazonaws.com'
  };
  const d = S.podepsanyDotaz(klice, SN, 'property', new Date('2026-09-18T07:05:09Z'));
  check('adresa míří na shadow sekačky', d.url,
    'https://abc-ats.iot.eu-central-1.amazonaws.com/things/M5TEST123/shadow?name=property');
  check('podpis je AWS4-HMAC-SHA256', d.hlavicky.Authorization.startsWith('AWS4-HMAC-SHA256 '), true);
  check('rozsah má službu iotdata',
    d.hlavicky.Authorization.includes('/20260918/eu-central-1/iotdata/aws4_request'), true);
  // Dočasné klíče bez podepsaného security tokenu AWS odmítne
  check('security token je mezi podepsanými',
    d.hlavicky.Authorization.includes('x-amz-security-token'), true);
  check('  a posílá se i v hlavičkách', d.hlavicky['x-amz-security-token'], 'tok');
  check('razítko sedí s časem', d.hlavicky['x-amz-date'], '20260918T070509Z');
  check('otisk prázdného těla', d.hlavicky['x-amz-content-sha256'], S.otisk(''));
  // Jiný čas = jiný podpis; kdyby se razítko do podpisu nedostalo, byl by stejný
  const jiny = S.podepsanyDotaz(klice, SN, 'property', new Date('2026-09-18T07:05:10Z'));
  check('jiný čas dá jiný podpis', jiny.hlavicky.Authorization === d.hlavicky.Authorization, false);

  globalThis.fetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ state: { reported: { battery: 87, workStatus: 'mowing' } } })
  });
  const stin = await S.stinSekacky(klice, SN);
  check('stav se přečte ze state.reported', stin.battery, 87);
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  const zakaz = await S.stinSekacky(klice, SN).then(() => '(prošlo)', e => e.message);
  check('403 se pozná', zakaz.includes('HTTP 403'), true);
}

nadpis('10) Výpis');
{
  const sekacka = { sn: SN, jmeno: 'Zahrada', model: '5' };
  const r = S.radkyVypisu(sekacka, { battery: 87, workStatus: 'mowing', mowHeight: 45, nezname: 1 });
  check('první řádek je jméno', r[0], 'Sekačka: Zahrada (kategorie 5)');
  check('baterie se najde', r.some(x => x.includes('baterie: 87')), true);
  check('stav se najde', r.some(x => x.includes('stav: mowing')), true);
  check('výška se najde', r.some(x => x.includes('vyska: 45')), true);
  // Jména polí u M5 jsou odhad — proto se vypisuje i to, co se nepřiřadilo
  check('vypíše se, kolik polí stav má', r[r.length - 1].includes('polí ve stavu: 4'), true);
  check('  a jak se jmenují', r[r.length - 1].includes('nezname'), true);
  check('prázdný stav nespadne', S.radkyVypisu(sekacka, {}).length, 2);
  check('chybějící pole se přeskočí', S.radkyVypisu(sekacka, { battery: 10 }).length, 3);
  check('bere se první jméno, které sedí', S.vyber({ battery_level: 5 }, S.CTENI.baterie), 5);
  check('nic nenajde nic', S.vyber({}, S.CTENI.baterie), undefined);
}

nadpis('11) Konfigurace');
{
  const docasna = fs.mkdtempSync(path.join(os.tmpdir(), 'uklid-'));
  const cesta = path.join(docasna, 'uklid.config.json');

  const chybi = S.nactiKonfig(cesta);
  check('chybějící soubor se založí', fs.existsSync(cesta), true);
  check('a řekne se to', String(chybi.chyba).includes('Založil jsem'), true);
  check('nic se nepřihlašuje', chybi.nastaveni, undefined);
  check('hláška vede na složku', String(chybi.chyba).includes('/volume1/family/scripts/uklid'), true);
  check('předvolba je předvyplněná', JSON.parse(fs.readFileSync(cesta, 'utf8')).areaCode, S.AREA_KOD_VYCHOZI);
  check('ale heslo prázdné', JSON.parse(fs.readFileSync(cesta, 'utf8')).heslo, '');

  const prazdny = S.nactiKonfig(cesta);
  check('prázdné hodnoty zastaví skript', prazdny.nastaveni, undefined);
  check('a řeknou, co chybí', String(prazdny.chyba).includes('e-mail i heslo'), true);

  fs.writeFileSync(cesta, JSON.stringify({ email: 'a@b.cz', heslo: '' }));
  check('chybějící heslo se pozná', String(S.nactiKonfig(cesta).chyba).includes('chybí heslo'), true);
  fs.writeFileSync(cesta, '{nejde o json');
  check('rozbitý soubor nespadne na výjimce', typeof S.nactiKonfig(cesta).chyba, 'string');

  fs.writeFileSync(cesta, JSON.stringify({ email: '  a@b.cz  ', heslo: ' x ' }));
  const dobry = S.nactiKonfig(cesta);
  check('vyplněný soubor projde', dobry.nastaveni.email, 'a@b.cz');
  check('mezery se oříznou', dobry.nastaveni.heslo, 'x');
  check('chybějící předvolba se doplní', dobry.nastaveni.areaCode, S.AREA_KOD_VYCHOZI);

  const bezKonfigu = await S.hlavni([], path.join(docasna, 'nova.json'));
  check('bez konfigurace skript nenaběhne', bezKonfigu, 1);

  fs.rmSync(docasna, { recursive: true, force: true });
}

nadpis('12) Skript nic nespíná');
{
  globalThis.fetch = puvodniFetch;
  const ZDROJ = fs.readFileSync(path.join(__dirname, '..', 'public', 'nas', 'sekacka-test.js'), 'utf8');
  // Povely se publikují POSTem na IoT; ohmatávací skript smí jen číst
  check('nikam se neposílá povel', /publish|\/topics\//.test(ZDROJ), false);
  check('na IoT se jen čte', (ZDROJ.match(/metoda: 'GET'/g) || []).length >= 1, true);
  // Natvrdo zadrátované klíče z cizí appky do repozitáře nepatří
  check('žádné natvrdo zadrátované AWS klíče', /AKIA[0-9A-Z]{16}/.test(ZDROJ), false);
  check('heslo se nikam nevsazuje', /\$\{[^}]*heslo[^}]*\}/.test(ZDROJ), false);
  const sHeslem = ZDROJ.split('\n').filter(r => r.includes('.heslo'));
  check('heslo se bere jen při přihlášení', sHeslem.length, 2);
  check('skript nemá závislosti', /require\('(?!node:)/.test(ZDROJ), false);
}

konec();
})().catch(err => {
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
