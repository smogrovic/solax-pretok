// Závlaha Rain Bird: místní protokol modulu LNK WiFi.
//
// Co tahle sada NEDOKÁŽE: ověřit, že se tvar shoduje se skutečným modulem.
// Ten je v domácí síti a odsud na něj není vidět. Sada hlídá jen to, že je
// skript sám se sebou v souladu — že šifrování a dešifrování do sebe zapadají,
// že tělo má popsaný tvar a že se odpověď čte ze správných míst. Jestli tvar
// sedí, řekne teprve první ostrý běh na NASu.
//
// Proč to přesto stojí za sadu: rozdíl jednoho bajtu v odsazení nebo přehozený
// otisk se v ostrém běhu projeví jen tím, že modul mlčí. Z toho se nepozná,
// jestli je špatně heslo, adresa, nebo kód. Tady je aspoň kód vyloučený.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('závlaha Rain Bird');

const Z = require('../public/nas/zavlaha-test.js');

const HESLO = 'tajneheslo';
const IV = Buffer.alloc(16, 7);

nadpis('1) Šifrování');

const KRATKY = '{"a":1}';
const zasifrovany = Z.zasifruj(KRATKY, HESLO, IV);
check('co se zašifruje, to se dešifruje zpátky', Z.desifruj(zasifrovany, HESLO), KRATKY);
check('prvních 32 bajtů je otisk PŮVODNÍHO textu',
  zasifrovany.subarray(0, 32).toString('hex'),
  crypto.createHash('sha256').update(KRATKY, 'utf8').digest('hex'));
check('otisk NENÍ z dorovnaného textu',
  zasifrovany.subarray(0, 32).toString('hex') === crypto.createHash('sha256').update(Z.dorovnej(KRATKY)).digest('hex'),
  false);
check('dalších 16 bajtů je IV', zasifrovany.subarray(32, 48).toString('hex'), IV.toString('hex'));
check('data začínají na 48. bajtu a jsou celé bloky', (zasifrovany.length - 48) % 16, 0);
check('klíč je otisk hesla', Z.klicZHesla(HESLO).toString('hex'),
  crypto.createHash('sha256').update(HESLO, 'utf8').digest('hex'));
check('klíč je dlouhý 32 bajtů (AES-256)', Z.klicZHesla(HESLO).length, 32);
// Stejné IV u dvou dotazů by ze šifry udělalo tabulku: stejný text = stejné bajty
check('každý dotaz dostane jiné IV',
  Z.zasifruj(KRATKY, HESLO).subarray(32, 48).equals(Z.zasifruj(KRATKY, HESLO).subarray(32, 48)), false);

// Špatné heslo nesmí tiše vrátit nesmysl jako by byl v pořádku
let jineHeslo = '(nespadlo)';
try {
  jineHeslo = Z.desifruj(zasifrovany, 'jineheslo') === KRATKY ? '(rozluštilo)' : '(nesmysl)';
} catch {
  jineHeslo = '(nesmysl)';
}
check('jiným heslem se text nerozluští', jineHeslo, '(nesmysl)');

nadpis('2) Dorovnání na celé bloky');

check('krátký text se dorovná na 16', Z.dorovnej('abc').length, 16);
check('dorovnává se nulami', Z.dorovnej('abc').subarray(3).toString('hex'), '00'.repeat(13));
check('text před dorovnáním zůstane', Z.dorovnej('abc').subarray(0, 3).toString(), 'abc');
check('přesně 16 znaků se NEdorovnává', Z.dorovnej('a'.repeat(16)).length, 16);
check('17 znaků se dorovná na 32', Z.dorovnej('a'.repeat(17)).length, 32);
check('31 znaků se dorovná na 32', Z.dorovnej('a'.repeat(31)).length, 32);
check('32 znaků zůstane 32', Z.dorovnej('a'.repeat(32)).length, 32);
// Diakritika je v UTF-8 dvoubajtová: počítat znaky místo bajtů by rozházelo bloky
check('počítají se bajty, ne znaky', Z.dorovnej('ěščřž'.repeat(2)).length, 32);

nadpis('3) Povely');

check('povelů je šest', Object.keys(Z.POVELY).join(','), 'model,zony,bezi,stav,destak,odklad');
const OCEKAVANE = {
  model:  ['02', 1, '82'],
  zony:   ['0300', 2, '83'],
  bezi:   ['3F00', 2, 'BF'],
  stav:   ['48', 1, 'C8'],
  destak: ['3E', 1, 'BE'],
  odklad: ['36', 1, 'B6']
};
for (const [jmeno, [data, delka, odpoved]] of Object.entries(OCEKAVANE)) {
  const p = Z.POVELY[jmeno];
  check(`${jmeno}: povel ${data}`, p.data, data);
  check(`${jmeno}: délka ${delka}`, p.delka, delka);
  check(`${jmeno}: čeká odpověď ${odpoved}`, p.odpoved, odpoved);
  // `length` je délka DOTAZU v bajtech, ne odpovědi — modul jinou hodnotu odmítne
  check(`${jmeno}: délka sedí s hexem povelu`, p.data.length / 2, p.delka);
}

nadpis('4) Čtení odpovědi');

check('model: ESP-TM2 2.1', JSON.stringify(Z.rozluzti('model', '82000A0201')),
  '{"model":10,"verzeVelka":2,"verzeMala":1}');
check('kód 000a je ESP-TM2', Z.jmenoModelu('000a'), 'ESP-TM2');
check('kód 0005 je taky ESP-TM2', Z.jmenoModelu('0005'), 'ESP-TM2');
check('velká písmena kódu nevadí', Z.jmenoModelu('000A'), 'ESP-TM2');
check('neznámý kód se vypíše, ne zamlčí', Z.jmenoModelu('9999'), 'neznámý (kód 9999)');
check('zóny: maska a stránka', JSON.stringify(Z.rozluzti('zony', '83003F000000')),
  '{"stranka":0,"maska":1056964608}');
check('stav zavlažování', Z.rozluzti('stav', 'C801').zavlazuje, 1);
check('dešťové čidlo', Z.rozluzti('destak', 'BE00').cidlo, 0);
check('odklad je čtyřznakový', Z.rozluzti('odklad', 'B6000C').dnu, 12);

nadpis('5) Maska zón');

check('0x3F000000 je šest zón', Z.zonyZMasky(0x3F000000).join(','), '1,2,3,4,5,6');
check('prázdná maska je žádná zóna', Z.zonyZMasky(0).length, 0);
check('bit 0 prvního bajtu je zóna 1', Z.zonyZMasky(0x01000000).join(','), '1');
// Bity jdou v bajtu odspodu, bajty zleva — přehození kteréhokoli z toho posune zóny
check('bit 7 prvního bajtu je zóna 8', Z.zonyZMasky(0x80000000).join(','), '8');
check('bit 0 druhého bajtu je zóna 9', Z.zonyZMasky(0x00010000).join(','), '9');
check('bit 0 třetího bajtu je zóna 17', Z.zonyZMasky(0x00000100).join(','), '17');
check('poslední bit je zóna 32', Z.zonyZMasky(0x00000080).join(','), '32');
check('díra v masce se přeskočí', Z.zonyZMasky(0x05000000).join(','), '1,3');

nadpis('6) Výpis');

const SEBRANO = {
  model: { model: 10, verzeVelka: 2, verzeMala: 1 },
  zony: { stranka: 0, maska: 0x3F000000 },
  bezi: { stranka: 0, maska: 0 },
  stav: { zavlazuje: 1 },
  destak: { cidlo: 0 },
  odklad: { dnu: 0 }
};
const RADKY = Z.radkyVypisu(SEBRANO);
check('řádků je šest', RADKY.length, 6);
check('ovladač', RADKY[0], 'Ovladač: ESP-TM2, protokol 2.1');
check('osazené zóny', RADKY[1], 'Osazené zóny: 6 → 1, 2, 3, 4, 5, 6');
check('nic neběží', RADKY[2], 'Právě běží: nic');
check('zavlažování', RADKY[3], 'Zavlažování: zapnuté');
check('dešťové čidlo', RADKY[4], 'Dešťové čidlo: nehlásí déšť');
check('odklad', RADKY[5], 'Odklad kvůli dešti: 0 dnů');

const BEZI = Z.radkyVypisu({ bezi: { maska: 0x0A000000 } });
check('běžící zóny se vypíšou', BEZI[0], 'Právě běží: 2, 4');
check('vypnuté zavlažování', Z.radkyVypisu({ stav: { zavlazuje: 0 } })[0], 'Zavlažování: vypnuté');
check('déšť', Z.radkyVypisu({ destak: { cidlo: 1 } })[0], 'Dešťové čidlo: hlásí déšť');
check('jeden den odkladu', Z.radkyVypisu({ odklad: { dnu: 1 } })[0], 'Odklad kvůli dešti: 1 den');
// Když modul na půlku dotazů neodpoví, výpis se nesmí utnout na nedefinované hodnotě
check('chybějící odpovědi se přeskočí', Z.radkyVypisu({}).length, 0);

nadpis('7) Dotaz na modul (podstrčený modul)');

// Falešný modul: rozluští požadavek, ověří tvar a odpoví stejně zabaleně.
function podstrcModul(odpovedi) {
  const videno = [];
  globalThis.fetch = async (url, opts) => {
    const telo = JSON.parse(Z.desifruj(opts.body, HESLO));
    videno.push({ url, telo, hlavicky: opts.headers });
    const hex = odpovedi[telo.params && telo.params.data];
    if (hex === undefined) throw new Error('falešný modul nezná povel ' + JSON.stringify(telo.params));
    const odpoved = JSON.stringify({ id: telo.id, jsonrpc: '2.0', result: { data: hex } });
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => Z.zasifruj(odpoved, HESLO)
    };
  };
  return videno;
}

const puvodniFetch = globalThis.fetch;
const NASTAVENI = { ip: '10.0.0.5', heslo: HESLO };

(async () => {
  // Padlý povel se musí projevit jako CHYBA, ne tím, že sada tiše umře
  const zkus = jmeno => Z.povel(NASTAVENI, jmeno).catch(e => ({ hex: `(${e.message})`, hodnoty: {} }));

  const videno = podstrcModul({ '02': '82000A0201' });
  const m = await zkus('model');
  const prvni = videno[0] || { telo: { params: {} }, hlavicky: {} };
  check('jde na /stick daného modulu', prvni.url, 'http://10.0.0.5/stick');
  check('posílá se tunnelSip', prvni.telo.method, 'tunnelSip');
  check('v params je povel', prvni.telo.params.data, '02');
  check('v params je délka dotazu', prvni.telo.params.length, 1);
  check('je to JSON-RPC 2.0', prvni.telo.jsonrpc, '2.0');
  check('tělo se posílá jako octet-stream', prvni.hlavicky['Content-Type'], 'application/octet-stream');
  check('odpověď se rozluští', JSON.stringify(m.hodnoty), '{"model":10,"verzeVelka":2,"verzeMala":1}');
  check('hex odpovědi se vrací velkými písmeny', m.hex, '82000A0201');

  // Malá písmena v odpovědi modulu nesmí shodit kontrolu kódu
  podstrcModul({ '3F00': 'bf0000000000' });
  const b = await zkus('bezi');
  check('malá písmena v odpovědi projdou', b.hodnoty.maska, 0);

  // Cizí kód odpovědi znamená, že se s modulem míjíme — nesmí se tiše číst dál
  podstrcModul({ '48': 'C90101' });
  const cizi = await Z.povel(NASTAVENI, 'stav').then(() => '(prošlo)', e => e.message);
  check('cizí kód odpovědi se odmítne', cizi, 'čekal jsem odpověď C8, přišla C9');

  // 00 je odmítnutí povelu; hláška musí říct, co se nelíbilo
  podstrcModul({ '48': '004801' });
  const nak = await Z.povel(NASTAVENI, 'stav').then(() => '(prošlo)', e => e.message);
  check('odmítnutý povel se pozná', nak, 'modul povel 48 odmítl (důvod 01)');

  // Odpověď bez pole data by jinak spadla na undefined až o kus dál
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    arrayBuffer: async () => Z.zasifruj(JSON.stringify({ id: 1, jsonrpc: '2.0', result: {} }), HESLO)
  });
  const bezData = await Z.povel(NASTAVENI, 'stav').then(() => '(prošlo)', e => e.message);
  check('odpověď bez dat se pozná', bezData, 'odpověď neobsahuje pole data');

  globalThis.fetch = async () => ({ ok: false, status: 403, arrayBuffer: async () => Buffer.alloc(0) });
  const http = await Z.povel(NASTAVENI, 'stav').then(() => '(prošlo)', e => e.message);
  check('HTTP chyba se pozná', http, 'modul odpověděl HTTP 403');

  // Chybu z modulu nesmí skript prohlásit za platnou odpověď
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    arrayBuffer: async () => Z.zasifruj(JSON.stringify({ id: 1, jsonrpc: '2.0', error: { message: 'CONTROLLER_BUSY' } }), HESLO)
  });
  const chyba = await Z.dotaz(NASTAVENI, 'tunnelSip', {}).then(() => '(prošlo)', e => e.message);
  check('chyba z modulu se pozná', chyba, 'modul vrátil chybu: CONTROLLER_BUSY');

  // Špatné heslo vyrobí z odpovědi nesmysl — hláška to musí říct rovnou
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    arrayBuffer: async () => Z.zasifruj('{"id":1}', 'jineheslo')
  });
  const spatneHeslo = await Z.dotaz(NASTAVENI, 'tunnelSip', {}).then(() => '(prošlo)', e => e.message);
  check('nečitelná odpověď ukáže na heslo', spatneHeslo,
    'odpověď se nepodařilo přečíst — nejspíš nesedí heslo');

  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(16) });
  const kratka = await Z.dotaz(NASTAVENI, 'tunnelSip', {}).then(() => '(prošlo)', e => e.message);
  check('krátká odpověď se pozná', kratka, 'odpověď je krátká (16 B) — heslo nebo adresa nesedí');

  globalThis.fetch = puvodniFetch;

  nadpis('8) Tělo dotazu');

  check('tvar JSON-RPC', Z.teloDotazu('tunnelSip', { data: '02', length: 1 }, 5),
    '{"id":5,"jsonrpc":"2.0","method":"tunnelSip","params":{"data":"02","length":1}}');
  check('bez id se doplní čas', JSON.parse(Z.teloDotazu('x', {})).id > 1e12, true);

  nadpis('9) Konfigurace');

  const docasna = fs.mkdtempSync(path.join(os.tmpdir(), 'zavlaha-'));
  const cesta = path.join(docasna, 'zavlaha.config.json');

  const chybi = Z.nactiKonfig(cesta);
  check('chybějící soubor se založí', fs.existsSync(cesta), true);
  check('a řekne se to, ne spadne', String(chybi.chyba).includes('Založil jsem'), true);
  check('nic se nepřipojuje', chybi.nastaveni, undefined);
  check('hláška vede na složku na NASu', String(chybi.chyba).includes('/volume1/family/scripts/zavlaha'), true);
  check('založený soubor má prázdné heslo', JSON.parse(fs.readFileSync(cesta, 'utf8')).heslo, '');

  const prazdny = Z.nactiKonfig(cesta);
  check('prázdné hodnoty zastaví skript', prazdny.nastaveni, undefined);
  check('a řeknou, co chybí', String(prazdny.chyba).includes('adresa modulu i heslo'), true);

  fs.writeFileSync(cesta, JSON.stringify({ ip: '192.168.1.50', heslo: '' }));
  check('chybějící heslo se pozná', String(Z.nactiKonfig(cesta).chyba).includes('chybí heslo'), true);

  fs.writeFileSync(cesta, JSON.stringify({ ip: '', heslo: 'x' }));
  check('chybějící adresa se pozná', String(Z.nactiKonfig(cesta).chyba).includes('chybí adresa modulu'), true);

  fs.writeFileSync(cesta, '{tohle není json');
  const rozbity = Z.nactiKonfig(cesta);
  check('rozbitý soubor nespadne na výjimce', typeof rozbity.chyba, 'string');
  check('a poradí, jak má vypadat', String(rozbity.chyba).includes('"ip"'), true);

  fs.writeFileSync(cesta, JSON.stringify({ ip: ' 192.168.1.50 ', heslo: ' tajne ' }));
  const dobry = Z.nactiKonfig(cesta);
  check('vyplněný soubor projde', JSON.stringify(dobry.nastaveni), '{"ip":"192.168.1.50","heslo":"tajne"}');
  check('bez chyby', dobry.chyba, undefined);

  nadpis('10) Celý běh');

  // Jediná část, kterou uživatel doopravdy spustí. Bez tohohle by se dalo
  // rozbít pořadí výpisu nebo návratový kód a žádná sada by to nechytla.
  const VSE = {
    '02': '82000A0201', '0300': '83003F000000', '3F00': 'BF0002000000',
    '48': 'C801', '3E': 'BE00', '36': 'B6000000'
  };
  function odchyt(fn) {
    const puvodni = console.log;
    const radky = [];
    console.log = (...a) => radky.push(a.join(' '));
    return fn().then(kod => { console.log = puvodni; return { kod, text: radky.join('\n') }; },
                     e => { console.log = puvodni; throw e; });
  }

  fs.writeFileSync(cesta, JSON.stringify({ ip: '10.0.0.5', heslo: HESLO }));
  podstrcModul(VSE);
  const beh = await odchyt(() => Z.hlavni([], cesta));
  check('běh skončí bez chyby', beh.kod, 0);
  check('v hlavičce je adresa modulu', beh.text.includes('Modul: 10.0.0.5'), true);
  check('vypíše ovladač', beh.text.includes('Ovladač: ESP-TM2, protokol 2.1'), true);
  check('vypíše zóny', beh.text.includes('Osazené zóny: 6 → 1, 2, 3, 4, 5, 6'), true);
  check('vypíše běžící zónu', beh.text.includes('Právě běží: 2'), true);
  check('nehlásí nic rozbitého', beh.text.includes('Nepovedlo se'), false);
  check('řekne, že se má výpis poslat', beh.text.includes('pošli do chatu'), true);
  check('bez --raw se hex nevypisuje', beh.text.includes('82000A0201'), false);

  podstrcModul(VSE);
  const raw = await odchyt(() => Z.hlavni(['--raw'], cesta));
  check('--raw ukáže syrový hex', raw.text.includes('82000A0201'), true);

  // Bez konfigurace se nesmí nic připojovat a běh musí skončit nenulou,
  // jinak by si automat na NASu myslel, že je všechno v pořádku
  globalThis.fetch = async () => { throw new Error('sem se to nemá dostat'); };
  const bezKonfigu = await odchyt(() => Z.hlavni([], path.join(docasna, 'nova.json')));
  check('bez konfigurace skončí nenulou', bezKonfigu.kod, 1);
  check('a poradí, co doplnit', bezKonfigu.text.includes('Založil jsem'), true);
  podstrcModul(VSE);

  const napoveda = await odchyt(() => Z.hlavni(['--help'], cesta));
  check('--help nic nespouští', napoveda.text.includes('Nic nespíná'), true);
  check('--help skončí nulou', napoveda.kod, 0);

  // Když modul mlčí, skript to musí říct a skončit nenulově — ne tvářit se, že je hotovo
  globalThis.fetch = async () => { throw new Error('connect EHOSTUNREACH'); };
  const ticho = await odchyt(() => Z.hlavni([], cesta));
  check('mlčící modul skončí nenulou', ticho.kod, 1);
  check('a řekne se to', ticho.text.includes('Modul neodpověděl na nic'), true);
  check('vypíše i důvod u každého dotazu', (ticho.text.match(/EHOSTUNREACH/g) || []).length, 6);

  // Půlka odpovědí chybí: co dorazilo, se vypsat musí, zbytek se přizná
  podstrcModul({ '02': '82000A0201', '0300': '83003F000000' });
  const pulka = await odchyt(() => Z.hlavni([], cesta));
  check('částečná odpověď se vypíše', pulka.text.includes('Osazené zóny: 6'), true);
  check('a chybějící se přizná', pulka.text.includes('Nepovedlo se'), true);
  check('částečný běh je úspěch', pulka.kod, 0);

  globalThis.fetch = puvodniFetch;
  fs.rmSync(docasna, { recursive: true, force: true });

  nadpis('11) Skript nic nespíná');

  const ZDROJ = fs.readFileSync(path.join(__dirname, '..', 'public', 'nas', 'zavlaha-test.js'), 'utf8');
  // Spínací povely Rain Birdu: 38 spustí program, 39 a 4B zónu, 40 zastaví,
  // 37 nastaví odklad. V ohmatávacím skriptu nemá žádný z nich co dělat.
  for (const [kod, co] of [['38', 'spuštění programu'], ['39', 'spuštění zóny'],
                           ['4B', 'zařazení zóny'], ['40', 'zastavení'], ['37', 'nastavení odkladu']]) {
    check(`povel ${kod} (${co}) tam není`,
      Object.values(Z.POVELY).some(p => p.data.slice(0, 2) === kod), false);
  }
  // Heslo smí jít jen do šifrování. Kdyby se kdekoli vsadilo do vypisovaného
// textu, skončilo by ve výpisu, který uživatel posílá do chatu.
check('heslo se nikam nevsazuje', /\$\{[^}]*heslo[^}]*\}/.test(ZDROJ), false);
const sHeslem = ZDROJ.split('\n').filter(r => r.includes('nastaveni.heslo'));
check('heslo se bere jen na dvou místech', sHeslem.length, 2);
check('a obě jsou šifrování', sHeslem.every(r => r.includes('sifruj')), true);
  check('skript nemá závislosti', /require\('(?!node:)/.test(ZDROJ), false);

  konec();
})().catch(err => {
  // Bez tohohle by výjimka sadu jen utnula a chybějící řádky by nikdo nedopočítal
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
