// Vysavač Xiaomi: přihlášení do cloudu Mi a přečtení toho, co účet vydá.
//
// Čím se tahle sada liší od té sekačkové: RC4 se dá ověřit **zvenčí**.
// Jeho vzorové vstupy a výstupy jsou zveřejněné dávno před Xiaomi, takže
// tady nejde o to, že je kód sám se sebou v souladu, ale že počítá totéž
// co zbytek světa. Kdyby se netrefil, cloud odpoví odmítnutím bez jediného
// slova vysvětlení a nebylo by podle čeho hádat.
//
// Druhá věc, kvůli které sada existuje: Xiaomi umí místo přihlášení chtít
// ověření účtu. Kdyby se to slilo se „špatným heslem", člověk by měnil
// heslo, které je správné, a nechápal, proč to pořád nejde.
//
// Třetí: tohle je OHMATÁVACÍ skript. Nesmí vysavač rozjet. Hlídá se tím,
// co prošlo falešným cloudem — žádné `prop/set`, žádná `action`.
//
// Co tahle sada NEDOKÁŽE: ověřit, že tvar odpovědí Xiaomi sedí. Je reverzně
// zjištěný z komunitních nástrojů a odsud na účet ani na vysavač není vidět.
// Potvrdí to až první běh u člověka doma.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('vysavač Xiaomi');

const V = require('../public/nas/vysavac-test.js');

const NASTAVENI = { email: 'nekdo@example.com', heslo: 'tajne', region: 'de' };
const PRIHLASENI = {
  ssecurity: Buffer.from('ssecurity-klic-16').toString('base64'),
  userId: '12345', cUserId: 'cu1', passToken: 'pt', serviceToken: 'st'
};

// Falešný cloud: podle cesty vrátí připravenou odpověď a zapamatuje si dotaz.
function podstrc(odpovedi) {
  const videno = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    videno.push({
      url: String(url), cesta: u.pathname, metoda: opts.method || 'GET',
      hlavicky: opts.headers || {}, telo: opts.body ? String(opts.body) : null
    });
    // Delší klíč vyhrává: /pass/serviceLogin by jinak pohltil i serviceLoginAuth2
    const klic = Object.keys(odpovedi).sort((a, b) => b.length - a.length)
      .find(k => u.pathname.startsWith(k) || String(url).startsWith(k));
    if (klic === undefined) throw new Error('falešný cloud nezná ' + u.pathname);
    const o = odpovedi[klic];
    const v = typeof o === 'function' ? o(videno[videno.length - 1], videno.length) : o;
    return {
      ok: v.ok !== false,
      status: v.status || 200,
      headers: { getSetCookie: () => v.cookies || [] },
      text: async () => (typeof v.telo === 'string' ? v.telo : JSON.stringify(v.telo || {})),
      json: async () => v.telo
    };
  };
  return videno;
}

const puvodniFetch = globalThis.fetch;

(async () => {

nadpis('1) RC4 proti zveřejněnému vzoru');
{
  // Tyhle tři dvojice jsou zveřejněné a nezávislé na Xiaomi. Když sedí,
  // počítá se RC4 správně — ne jen shodně sám se sebou.
  const zkus = (klic, text) => V.rc4(Buffer.from(klic), Buffer.from(text)).toString('hex');
  check('Key / Plaintext', zkus('Key', 'Plaintext'), 'bbf316e8d940af0ad3');
  check('Wiki / pedia', zkus('Wiki', 'pedia'), '1021bf0420');
  check('Secret / Attack at dawn', zkus('Secret', 'Attack at dawn'), '45a01f645fc35b383552544b9bf5');

  // Xiaomi vyhazuje první kilobajt keystreamu. Bez toho cloud odmítne
  // a neřekne proč — je to jediný řádek, kde se to dá splést.
  const klic = Buffer.from('Key');
  const data = Buffer.from('Plaintext');
  check('vyhození kilobajtu dá něco jiného',
    V.rc4Drop1024(klic, data).toString('hex') === V.rc4(klic, data).toString('hex'), false);
  check('  a pořád je to šifra tam i zpět',
    V.rc4Drop1024(klic, V.rc4Drop1024(klic, data)).toString('utf8'), 'Plaintext');
  check('prázdný vstup nespadne', V.rc4Drop1024(klic, Buffer.alloc(0)).length, 0);
}

nadpis('2) Podpisy');
{
  const n = V.nonce(1758153600000);
  check('nonce má dvanáct bajtů', Buffer.from(n, 'base64').length, 12);
  check('  a poslední čtyři jsou minuty',
    Buffer.from(n, 'base64').readUInt32BE(8), Math.floor(1758153600000 / 60000));
  check('dva nonce nejsou stejné', V.nonce() === V.nonce(), false);

  const podepsany = V.podepsanyNonce(PRIHLASENI.ssecurity, n);
  check('podepsaný nonce je SHA256 nad oběma kusy', podepsany,
    crypto.createHash('sha256').update(Buffer.concat([
      Buffer.from(PRIHLASENI.ssecurity, 'base64'), Buffer.from(n, 'base64')
    ])).digest('base64'));
  check('  a je stejný pokaždé', V.podepsanyNonce(PRIHLASENI.ssecurity, n), podepsany);

  const p1 = V.podpisProsty('/home/device_list', podepsany, n, { data: '{}' });
  // Že je podpis pokaždé stejný, platí i pro špatný algoritmus. Tohle je
  // jediná kontrola, která pozná, že se počítá to, co Xiaomi čeká.
  check('podpis je HMAC-SHA256 nad cestou, nonce a daty', p1,
    crypto.createHmac('sha256', Buffer.from(podepsany, 'base64'))
      .update(['/home/device_list', podepsany, n, 'data={}'].join('&')).digest('base64'));
  check('stejný vstup dá stejný podpis', V.podpisProsty('/home/device_list', podepsany, n, { data: '{}' }), p1);
  check('jiná data dají jiný podpis',
    V.podpisProsty('/home/device_list', podepsany, n, { data: '{"a":1}' }) === p1, false);
  check('jiná cesta taky', V.podpisProsty('/miotspec/prop/get', podepsany, n, { data: '{}' }) === p1, false);

  const p2 = V.podpisSifrovany('POST', '/app/home/device_list', podepsany, { data: '{}' });
  check('šifrovaný podpis je SHA1 nad metodou, cestou, daty a nonce', p2,
    crypto.createHash('sha1')
      .update(['POST', '/home/device_list', 'data={}', podepsany].join('&')).digest('base64'));
  check('šifrovaný podpis je jiný než prostý', p2 === p1, false);
  check('  a metoda se do něj počítá',
    V.podpisSifrovany('GET', '/app/home/device_list', podepsany, { data: '{}' }) === p2, false);
}

nadpis('3) Odbalení odpovědi z účtu');
{
  check('balast před JSONem se usekne', V.odbal(V.BALAST + '{"a":1}').a, 1);
  check('  a bez balastu to projde taky', V.odbal('{"a":2}').a, 2);
  // Rozbitá odpověď se nesmí tvářit, že je v pořádku
  let spadlo = false;
  try { V.odbal(V.BALAST + 'tohle není json'); } catch { spadlo = true; }
  check('rozbitý JSON se pozná', spadlo, true);
  check('samotný balast taky', (() => { try { V.odbal(V.BALAST); return false; } catch { return true; } })(), true);
}

nadpis('4) Ověření účtu není špatné heslo');
{
  const o1 = V.overeniPotreba({ notificationUrl: 'https://account.xiaomi.com/identity/list?x=1' });
  check('ověření se pozná', o1.druh, 'ověření účtu');
  check('  a ví se, kam kliknout', o1.kde, 'https://account.xiaomi.com/identity/list?x=1');
  const o2 = V.overeniPotreba({ captchaUrl: '/pass/captcha?x=2' });
  check('captcha se pozná', o2.druh, 'captcha');
  check('  a adresa se doplní na celou', o2.kde.startsWith('https://account.xiaomi.com/'), true);
  check('špatné heslo není ověření', V.overeniPotreba({ code: 70016, desc: 'ne' }), null);
  check('prázdná adresa se nepočítá', V.overeniPotreba({ notificationUrl: '' }), null);
  check('nesmysl nespadne', V.overeniPotreba(null), null);
}

nadpis('5) Adresa serveru');
{
  check('evropský server má předponu', V.adresaSluzby('de'), 'https://de.api.io.mi.com/app');
  check('čínský ji nemá', V.adresaSluzby('cn'), 'https://api.io.mi.com/app');
  check('velká písmena nevadí', V.adresaSluzby('DE'), 'https://de.api.io.mi.com/app');
  check('bez zadání se vezme Evropa', V.adresaSluzby(''), `https://${V.REGION_VYCHOZI}.api.io.mi.com/app`);
}

nadpis('6) Přihlášení');
{
  const videno = podstrc({
    '/pass/serviceLogin': { telo: V.BALAST + JSON.stringify({ _sign: 'podpis1' }), cookies: ['pass_ick=a; Path=/'] },
    '/pass/serviceLoginAuth2': {
      telo: V.BALAST + JSON.stringify({
        ssecurity: PRIHLASENI.ssecurity, userId: 12345, cUserId: 'cu1', passToken: 'pt',
        location: 'https://sts.api.io.mi.com/sts?d=1'
      })
    },
    'https://sts.api.io.mi.com/sts': { telo: 'ok', cookies: ['serviceToken=tok123; Path=/'] }
  });
  const p = await V.prihlas(NASTAVENI);
  check('projde ve třech krocích', videno.length, 3);
  check('  a vrátí serviceToken', p.serviceToken, 'tok123');
  check('  i ssecurity', p.ssecurity, PRIHLASENI.ssecurity);
  check('  a userId jako text', p.userId, '12345');

  const pole = new URLSearchParams(videno[1].telo);
  check('heslo jde jako MD5 velkými písmeny', pole.get('hash'),
    crypto.createHash('md5').update(NASTAVENI.heslo).digest('hex').toUpperCase());
  // Tohle je to hlavní: holé heslo nesmí opustit skript
  check('holé heslo se nikam neposílá',
    videno.some(v => (v.telo || '').includes(NASTAVENI.heslo)), false);
  check('podpis z prvního kroku se použije', pole.get('_sign'), 'podpis1');
  check('callback je ten, co Xiaomi čeká', pole.get('callback'), 'https://sts.api.io.mi.com/sts');
  check('sid je xiaomiio', pole.get('sid'), 'xiaomiio');

  // Ověření účtu musí být poznat — jinak by člověk měnil správné heslo
  podstrc({
    '/pass/serviceLogin': { telo: V.BALAST + JSON.stringify({ _sign: 's' }) },
    '/pass/serviceLoginAuth2': { telo: V.BALAST + JSON.stringify({ notificationUrl: 'https://account.xiaomi.com/ident' }) }
  });
  let zprava = '';
  try { await V.prihlas(NASTAVENI); } catch (e) { zprava = e.message; }
  check('ověření se nezamluví jako špatné heslo', zprava.includes('Heslo je nejspíš v pořádku'), true);
  check('  a řekne se, kam jít', zprava.includes('https://account.xiaomi.com/ident'), true);

  podstrc({
    '/pass/serviceLogin': { telo: V.BALAST + JSON.stringify({ _sign: 's' }) },
    '/pass/serviceLoginAuth2': { telo: V.BALAST + JSON.stringify({ code: 70016, desc: 'špatné heslo' }) }
  });
  let zprava2 = '';
  try { await V.prihlas(NASTAVENI); } catch (e) { zprava2 = e.message; }
  check('špatné heslo se taky pozná', zprava2.includes('70016'), true);
  check('  a netváří se jako ověření', zprava2.includes('v pořádku'), false);

  podstrc({
    '/pass/serviceLogin': { telo: V.BALAST + JSON.stringify({ _sign: 's' }) },
    '/pass/serviceLoginAuth2': { telo: V.BALAST + JSON.stringify({ ssecurity: 'x', location: 'https://sts.api.io.mi.com/sts' }) },
    'https://sts.api.io.mi.com/sts': { telo: 'ok', cookies: [] }
  });
  let zprava3 = '';
  try { await V.prihlas(NASTAVENI); } catch (e) { zprava3 = e.message; }
  check('chybějící serviceToken se přizná', zprava3.includes('serviceToken'), true);
}

nadpis('7) Dotaz do cloudu');
{
  const videno = podstrc({ '/app/home/device_list': { telo: { code: 0, result: { list: [{ did: '1' }] } } } });
  const out = await V.dotaz(PRIHLASENI, 'de', '/home/device_list', { getVirtualModel: false });
  check('vrátí se výsledek', out.list[0].did, '1');
  check('míří na správný server', videno[0].url, 'https://de.api.io.mi.com/app/home/device_list');
  const telo = new URLSearchParams(videno[0].telo);
  check('posílá se data, podpis a nonce',
    ['data', 'signature', '_nonce'].every(k => telo.get(k)), true);
  check('serviceToken jde v cookie', String(videno[0].hlavicky.Cookie).includes('serviceToken=st'), true);

  // Šifrovaná varianta: data ani podpis nesmí jít v čitelné podobě
  const videno2 = podstrc({
    '/app/home/device_list': (req) => {
      const t = new URLSearchParams(req.telo);
      const n = t.get('_nonce');
      const podepsany = V.podepsanyNonce(PRIHLASENI.ssecurity, n);
      return { telo: Buffer.from(V.rc4Drop1024(Buffer.from(podepsany, 'base64'),
        Buffer.from(JSON.stringify({ code: 0, result: { list: [] } })))).toString('base64') };
    }
  });
  const out2 = await V.dotaz(PRIHLASENI, 'de', '/home/device_list', { a: 1 }, 'rc4');
  check('šifrovaná odpověď se rozšifruje', JSON.stringify(out2.list), '[]');
  const telo2 = new URLSearchParams(videno2[0].telo);
  check('data jdou zašifrovaná', telo2.get('data').includes('{'), false);
  check('  a přibude rc4_hash__', !!telo2.get('rc4_hash__'), true);

  podstrc({ '/app/home/device_list': { telo: { code: 3, message: 'token vypršel' } } });
  let chyba = '';
  try { await V.dotaz(PRIHLASENI, 'de', '/home/device_list', {}); } catch (e) { chyba = e.message; }
  check('odmítnutí se přizná', chyba.includes('kód 3'), true);
  check('  i s důvodem', chyba.includes('token vypršel'), true);

  podstrc({ '/app/home/device_list': { ok: false, status: 500, telo: 'ne' } });
  let chyba2 = '';
  try { await V.dotaz(PRIHLASENI, 'de', '/home/device_list', {}); } catch (e) { chyba2 = e.message; }
  check('HTTP chyba se přizná', chyba2.includes('HTTP 500'), true);
}

nadpis('8) Který podpis účet chce');
{
  // Obě varianty jsou doložené a dopředu se nepozná, která u účtu platí.
  podstrc({ '/app/v2/homeroom/gethome': { telo: { code: 0, result: { homelist: [{ name: 'Doma' }] } } } });
  const a = await V.najdiVariantu(PRIHLASENI, 'de');
  check('prostý podpis se zkusí první', a.varianta, 'prosta');
  check('  a domácnosti se vrátí', a.domacnosti[0].name, 'Doma');

  let pokus = 0;
  podstrc({
    '/app/v2/homeroom/gethome': (req) => {
      pokus++;
      if (pokus === 1) return { telo: { code: 3, message: 'ne' } };
      const n = new URLSearchParams(req.telo).get('_nonce');
      const podepsany = V.podepsanyNonce(PRIHLASENI.ssecurity, n);
      return { telo: Buffer.from(V.rc4Drop1024(Buffer.from(podepsany, 'base64'),
        Buffer.from(JSON.stringify({ code: 0, result: { homelist: [] } })))).toString('base64') };
    }
  });
  const b = await V.najdiVariantu(PRIHLASENI, 'de');
  check('když prostý neprojde, zkusí se šifrovaný', b.varianta, 'rc4');

  podstrc({ '/app/v2/homeroom/gethome': { telo: { code: 3, message: 'ne' } } });
  let chyba = '';
  try { await V.najdiVariantu(PRIHLASENI, 'de'); } catch (e) { chyba = e.message; }
  check('když neprojde ani jeden, řekne se to', chyba.includes('ani jeden způsob'), true);
  check('  a vypíšou se oba důvody', chyba.includes('prosta') && chyba.includes('rc4'), true);
}

nadpis('9) Výběr vysavače a místnosti');
{
  check('vysavač se pozná podle modelu', V.jeVysavac({ model: 'xiaomi.vacuum.c102gl' }), true);
  check('žárovka ne', V.jeVysavac({ model: 'yeelink.light.ceiling' }), false);
  check('zařízení bez modelu ne', V.jeVysavac({}), false);

  const mistnosti = V.mistnostiZDomacnosti([
    { name: 'Doma', roomlist: [{ id: '11', name: 'Kuchyň', dids: ['a'] }, { id: '12', name: 'Obývák', dids: [] }] },
    { name: 'Chata', roomlist: [{ id: '21', name: 'Půda', dids: [] }] }
  ]);
  check('místnosti se poskládají ze všech domácností', mistnosti.length, 3);
  check('  i s čísly', mistnosti[0].id, '11');
  check('  a jménem domácnosti', mistnosti[2].domacnost, 'Chata');
  check('domácnost bez místností nespadne', V.mistnostiZDomacnosti([{ name: 'X' }]).length, 0);
  check('nesmysl nespadne', V.mistnostiZDomacnosti(null).length, 0);
}

nadpis('10) Rozebrání specifikace');
{
  const spec = {
    services: [
      { iid: 2, type: 'urn:miot-spec-v2:service:vacuum:00007810:xiaomi-c102gl:1',
        properties: [
          { iid: 1, type: 'urn:miot-spec-v2:property:status:00000007::1', access: ['read', 'notify'], format: 'uint8',
            'value-list': [{ value: 1, description: 'Sweeping' }] },
          { iid: 9, type: 'urn:miot-spec-v2:property:mode:00000008::1', access: ['write'], format: 'uint8' }
        ],
        actions: [{ iid: 1, type: 'urn:miot-spec-v2:action:start-sweep:00002804::1', in: [] },
                  { iid: 3, type: 'urn:miot-spec-v2:action:start-room-sweep:00002826::1', in: [7] }] },
      { iid: 3, type: 'urn:miot-spec-v2:service:battery:00007805::1',
        properties: [{ iid: 1, type: 'urn:miot-spec-v2:property:battery-level:00000014::1', access: ['read'], format: 'uint8' }] }
    ]
  };
  const r = V.rozeberSpec(spec);
  check('čtou se jen čitelné vlastnosti', r.cteni.length, 2);
  check('  s číslem služby i vlastnosti', `${r.cteni[0].siid}/${r.cteni[0].piid}`, '2/1');
  check('  a s čitelným jménem', `${r.cteni[0].sluzba}.${r.cteni[0].jmeno}`, 'vacuum.status');
  check('  i s výčtem hodnot', r.cteni[0].hodnoty[0].description, 'Sweeping');
  check('baterie se najde taky', `${r.cteni[1].siid}/${r.cteni[1].piid}`, '3/1');
  check('povely se poskládají', r.povely.length, 2);
  check('  s aiid', `${r.povely[1].siid}/${r.povely[1].aiid}`, '2/3');
  check('  a jménem', r.povely[1].jmeno, 'start-room-sweep');
  check('  i s tím, že chce vstup', r.povely[1].vstup.join(','), '7');
  check('prázdná specifikace nespadne', V.rozeberSpec({}).cteni.length, 0);
  check('nesmysl taky ne', V.rozeberSpec(null).povely.length, 0);
  check('krátký název z urn', V.kratkyNazev('urn:miot-spec-v2:property:status:00000007::1'), 'status');
}

nadpis('11) Ohmatávací skript nesmí nic spustit');
{
  const videno = podstrc({
    '/pass/serviceLogin': { telo: V.BALAST + JSON.stringify({ _sign: 's' }) },
    '/pass/serviceLoginAuth2': { telo: V.BALAST + JSON.stringify({
      ssecurity: PRIHLASENI.ssecurity, userId: 1, location: 'https://sts.api.io.mi.com/sts' }) },
    'https://sts.api.io.mi.com/sts': { telo: 'ok', cookies: ['serviceToken=t; Path=/'] },
    '/app/v2/homeroom/gethome': { telo: { code: 0, result: { homelist: [
      { name: 'Doma', roomlist: [{ id: '11', name: 'Kuchyň', dids: [] }] }] } } },
    '/app/home/device_list': { telo: { code: 0, result: { list: [
      { did: '9', model: 'yeelink.light.ceiling', name: 'Světlo' },
      { did: '7', model: 'xiaomi.vacuum.c102gl', name: 'Vysavač', token: 'tajnytokenvysavace', localip: '' }] } } },
    '/app/miotspec/prop/get': { telo: { code: 0, result: [{ siid: 3, piid: 1, value: 84, code: 0 }] } },
    'https://miot-spec.org/miot-spec-v2/instances': { telo: { instances: [
      { model: 'xiaomi.vacuum.c102gl', version: 1, type: 'urn:miot-spec-v2:device:vacuum:0000A006:xiaomi-c102gl:1' }] } },
    'https://miot-spec.org/miot-spec-v2/instance': { telo: { services: [
      { iid: 3, type: 'urn:miot-spec-v2:service:battery:00007805::1',
        properties: [{ iid: 1, type: 'urn:miot-spec-v2:property:battery-level:00000014::1', access: ['read'] }] }] } }
  });

  const slozka = fs.mkdtempSync(path.join(os.tmpdir(), 'vysavac-'));
  const cesta = path.join(slozka, 'vysavac.config.json');
  fs.writeFileSync(cesta, JSON.stringify(NASTAVENI));

  const radky = [];
  const puvodniLog = console.log;
  console.log = (...a) => radky.push(a.join(' '));
  let kod;
  try {
    kod = await V.hlavni([], cesta);
  } finally {
    console.log = puvodniLog;
  }
  const vypis = radky.join('\n');

  check('skript doběhl', kod, 0);
  // Tohle je to hlavní: ohmatávací skript se ptá, nespíná
  const spinal = videno.filter(v => v.cesta.includes('prop/set') || v.cesta.includes('/action'));
  check('nikam se nespíná', spinal.map(v => v.cesta).join(', ') || 'nikam', 'nikam');
  check('  a čte se jen prop/get', videno.some(v => v.cesta.endsWith('/miotspec/prop/get')), true);

  check('vybral se vysavač, ne světlo', vypis.includes('xiaomi.vacuum.c102gl'), true);
  check('  a světlo se přeskočilo', vypis.includes('yeelink'), false);
  check('místnost je ve výpisu i s číslem', vypis.includes('11  Kuchyň'), true);
  check('hodnota se spáruje se svým siid/piid', /3\/ ?1\s+battery\.battery-level\s+84/.test(vypis), true);

  // Heslo ani token nesmí skončit ve výpisu — ten se posílá do chatu
  check('heslo se do výpisu nedostane', vypis.includes(NASTAVENI.heslo), false);
  check('token vysavače taky ne', vypis.includes('tajnytokenvysavace'), false);
  check('  ale je poznat, že tam nějaký je', vypis.includes('znaků'), true);

  fs.rmSync(slozka, { recursive: true, force: true });
}

nadpis('12) Konfigurace');
{
  const slozka = fs.mkdtempSync(path.join(os.tmpdir(), 'vysavac2-'));
  const cesta = path.join(slozka, 'vysavac.config.json');

  const prvni = V.nactiKonfig(cesta);
  check('chybějící soubor se založí', fs.existsSync(cesta), true);
  check('  a řekne se, co dopsat', prvni.chyba.includes('e-mail a heslo'), true);
  check('  bez nastavení', prvni.nastaveni, undefined);

  fs.writeFileSync(cesta, '{tohle není json');
  check('rozbitý soubor se pozná', V.nactiKonfig(cesta).chyba.includes('nepodařilo přečíst'), true);

  fs.writeFileSync(cesta, JSON.stringify({ email: 'a@b.cz' }));
  check('chybějící heslo se pojmenuje', V.nactiKonfig(cesta).chyba.includes('chybí heslo'), true);
  fs.writeFileSync(cesta, JSON.stringify({ heslo: 'x' }));
  check('chybějící e-mail taky', V.nactiKonfig(cesta).chyba.includes('chybí e-mail'), true);

  fs.writeFileSync(cesta, JSON.stringify({ email: ' a@b.cz ', heslo: ' x ', region: ' DE ' }));
  const ok = V.nactiKonfig(cesta);
  check('mezery kolem se ořežou', ok.nastaveni.email, 'a@b.cz');
  check('  a region se zmenší', ok.nastaveni.region, 'de');
  fs.writeFileSync(cesta, JSON.stringify({ email: 'a@b.cz', heslo: 'x' }));
  check('bez regionu se vezme Evropa', V.nactiKonfig(cesta).nastaveni.region, V.REGION_VYCHOZI);

  // Hláška má říct, kde soubor je — jinak ho člověk na NASu hledá
  check('v hlášce je cesta k souboru', V.nactiKonfig(path.join(slozka, 'nic.json')).chyba.includes(slozka), true);
  fs.rmSync(slozka, { recursive: true, force: true });
}

nadpis('13) Zkrácení tokenu a domácí síť');
{
  check('token se zkrátí', V.zkratToken('abcdefghij'), 'abc…ij (10 znaků)');
  check('krátký se schová celý', V.zkratToken('abc'), '…');
  check('žádný se pojmenuje', V.zkratToken(''), '(žádný)');
  check('nesmysl nespadne', V.zkratToken(null), '(žádný)');

  const bez = await V.miioHello('');
  check('bez adresy se nikam nesahá', bez.ok, false);
  check('  a řekne se proč', bez.duvod.includes('adresu'), true);
  const nikdo = await V.miioHello('192.0.2.1', 60);
  check('když se nikdo neozve, není to pád', nikdo.ok, false);
}

globalThis.fetch = puvodniFetch;
konec();
})().catch(err => {
  globalThis.fetch = puvodniFetch;
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
