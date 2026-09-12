// Statická kontrola inline skriptu v index.html: hledá identifikátory, které se
// používají, ale nikde nedeklarují. Přesně tohle propadlo v commitu 9d0f3fb —
// chirurgický zásah odřízl deklaraci `wbManualBtnsEl`, použití zůstalo a appka
// při každém snapshotu padala na ReferenceError.
//
// Prohlížeč to odhalí až za běhu; tahle sada za zlomek vteřiny a bez Chromia.
// Nekontroluje se celý JavaScript (na to by byl potřeba parser), jen jména
// s typickými příponami projektu — element/data/canvas/flag proměnné, kterých
// se takový zásah nejčastěji dotkne.
const fs = require('fs');
const path = require('path');
const { suite, between, fn } = require('./zdroj');
const { check, nadpis, konec } = suite('statická kontrola');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const skripty = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

nadpis('1) Inline skript');
check('v index.html je právě jeden', skripty.length, 1);
const js = skripty[0] || '';

// Co všechno se v souboru deklaruje (proměnné, funkce, parametry, destrukturace)
function deklarace(src) {
  const out = new Set();
  const pridej = text => {
    for (const jm of String(text).split(/[,\s:=.[\]{}]+/)) {
      if (/^[A-Za-z_$][\w$]*$/.test(jm)) out.add(jm);
    }
  };
  for (const re of [
    /\b(?:const|let|var)\s+([^;=\n]+?)\s*=/g,   // i vícenásobné `const a = 1, b = 2`
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /function\s+([A-Za-z_$][\w$]*)/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /\(([^()]*)\)\s*(?:=>|\{)/g,               // parametry funkcí i šipek
    /\b([A-Za-z_$][\w$]*)\s*=>/g               // šipka s jedním parametrem
  ]) {
    for (const m of src.matchAll(re)) pridej(m[1]);
  }
  return out;
}

const dekl = deklarace(js);
const vlastnosti = new Set([...js.matchAll(/\.\s*([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
const klice = new Set([...js.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)].map(m => m[1]));
const pouzita = new Set([...js.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(m => m[1]));

const PRIPONY = ['El', 'Els', 'Data', 'Canvas', 'Flag'];
const chybi = [...pouzita]
  .filter(n => PRIPONY.some(p => n.endsWith(p)) && n.length > 4)
  .filter(n => !dekl.has(n) && !vlastnosti.has(n) && !klice.has(n))
  .sort();

check('žádný prvek/proměnná bez deklarace', chybi.join(', ') || 'žádná', 'žádná');

nadpis('2) Kontrola samotné kontroly');
// Ať se sada nezvrhne v „vždycky projde": na podvrženém kódu MUSÍ chybu najít
const rozbite = 'const aEl = 1;\nfunction f() { return chybejiciBtnEl.value; }';
const d2 = deklarace(rozbite);
const v2 = new Set([...rozbite.matchAll(/\.\s*([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
const n2 = [...new Set([...rozbite.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map(m => m[1]))]
  .filter(n => PRIPONY.some(p => n.endsWith(p)) && n.length > 4)
  .filter(n => !d2.has(n) && !v2.has(n));
check('nedeklarovaný prvek se najde', n2.join(','), 'chybejiciBtnEl');
check('  a deklarovaný se nehlásí', n2.includes('aEl'), false);

nadpis('3) Ruční přepnutí režimu wallboxu');
// Konkrétně tenhle blok už jednou zmizel — hlídáme, že drží pohromadě
check('tlačítka mají deklaraci', /const wbManualBtnsEl = document\.getElementById/.test(js), true);
check('mají obsluhu kliknutí', /addEventListener\('click', \(\) => wbSetMode/.test(js), true);
check('a funkci, která povel pošle', /fetch\('\/api\/wallbox\/set'/.test(js), true);
const rezimy = [...HTML.matchAll(/class="wb-mode-btn" data-mode="(\w+)"/g)].map(m => m[1]);
check('v appce jsou čtyři režimy', rezimy.join(','), 'stop,eco,green,fast');

nadpis('4) Skript do Shelly');
// `shelly/sauna.js` neběží na Renderu, ale v měřáku sauny — žádná jiná sada se ho
// nedotkne. Přitom je to poslední pojistka jističe a jeho chyba se pozná až tím,
// že při zátopu bazén nezhasne. Hlídají se dvě věci, které se v něm reálně kazí:
// IP relé (naposledy po výměně bazénového relé) a meze mJS, které Shelly umí.
const SKRIPT = fs.readFileSync(path.join(__dirname, '..', 'shelly', 'sauna.js'), 'utf8');
const NAVOD = fs.readFileSync(path.join(__dirname, '..', 'SAUNA.md'), 'utf8');

function ipRele(src) {
  const out = {};
  for (const m of src.matchAll(/jmeno:\s*'(\w+)',\s*ip:\s*'([\d.]+)'/g)) out[m[1]] = m[2];
  return out;
}
const ip = ipRele(SKRIPT);
check('bazén má správnou IP', ip.BAZEN, '192.168.188.131');
check('solinátor má správnou IP', ip.SOLINATOR, '192.168.188.171');
// Návod tytéž adresy opisuje slovy. Rozejdou-li se, jedna z nich je stará a někdo
// podle ní bude relé hledat — proto to musí sedět doslova.
check('SAUNA.md píše tutéž IP bazénu', NAVOD.includes('bazén `' + ip.BAZEN + '`'), true);
check('  a tutéž IP solinátoru', NAVOD.includes('solinátor `' + ip.SOLINATOR + '`'), true);

// mJS v Shelly není JavaScript prohlížeče: šipky, backticky, `const` ani metody polí
// neumí a skript se po vložení rovnou zastaví.
function mimoMJS(src) {
  const kod = src.replace(/^\s*\/\/.*$/gm, '');
  const spatne = [];
  if (/=>/.test(kod)) spatne.push('šipka');
  if (/`/.test(kod)) spatne.push('backtick');
  if (/\bconst\s/.test(kod)) spatne.push('const');
  if (/\.(forEach|map|filter|reduce|includes)\s*\(/.test(kod)) spatne.push('metoda pole');
  return spatne;
}
check('drží se mezí mJS', mimoMJS(SKRIPT).join(', ') || 'ano', 'ano');

nadpis('5) Kontrola kontroly skriptu');
const podvrh = "let RELE = [\n  { jmeno: 'BAZEN', ip: '192.168.188.72' }\n];\nlet f = function (x) { return x; };";
check('stará IP se pozná', ipRele(podvrh).BAZEN, '192.168.188.72');
check('čistý úryvek mJS projde', mimoMJS(podvrh).join(',') || 'ano', 'ano');
check('šipka a backtick se najdou', mimoMJS('let a = () => `x`;').join(','), 'šipka,backtick');

nadpis('5b) Historie teplot nese jen bojlery');
// Teplota bazénu se nikde nekreslí do grafu, takže do boilerHistory nepatří: putovala by
// do zálohy na Upstash, do telefonu i do restore endpointu, a nikdo by ji nečetl.
const REC = fn('function recordBoilerTemps()');
check('bod má jen čas a oba bojlery', /const point = \{ t: Date\.now\(\), b1, b2 \};/.test(REC), true);
check('  a teplota bazénu se do něj nepřimíchá', /pool|heatpumpTempC/.test(REC), false);

nadpis('6) Identita Shelly zařízení');
// Patnáct zařízení bylo dřív zapsané třemi různými způsoby a bazénové relé bylo
// z nich jediné, jehož ID neexistovalo nikde v repozitáři — po jeho výměně nebylo
// co přepsat. Teď platí jeden tvar: `process.env.X || '<ID>'`. Tenhle oddíl hlídá,
// že to tak zůstane, a k tomu chytá překlep v ID, který by se jinak poznal až tím,
// že zařízení přestane odpovídat.
const KONFIG = between('const SHELLY_AUTH_KEY', 'const DEVICES = {');

// Literál vypadající jako Device ID: samé písmeno/číslice, aspoň šest znaků, případně
// víc oddělených čárkami (tak drží pohromadě tři měřáky bazénu). Oddělovač ',' ani
// adresa HUUM se do toho netrefí. Krátkou verzi bere schválně, ať se pozná i překlep.
function idLiteraly(src) {
  const idcka = [];
  const bezPromenne = [];
  const podle = {};
  for (const m of src.matchAll(/'([0-9a-zA-Z]{6,}(?:,[0-9a-zA-Z]{6,})*)'/g)) {
    const pred = src.slice(0, m.index);
    const promenna = (pred.match(/process\.env\.([A-Z0-9_]+)\s*\|\|\s*$/) || [])[1];
    if (!promenna) bezPromenne.push(m[1]);
    else podle[promenna] = m[1];
    for (const id of m[1].split(',')) idcka.push(id);
  }
  return { idcka, bezPromenne, podle };
}

const { idcka, bezPromenne, podle: podleJmena } = idLiteraly(KONFIG);
// Tohle je vlastní pointa změny: přibude-li zařízení natvrdo, sada spadne
check('každé ID má svou proměnnou', bezPromenne.join(', ') || 'ano', 'ano');
// Tuya má vlastní tvar ID (dvacet znaků, MAC až na konci), Shelly dvanáct hex.
// Míchat je do jedné kontroly nejde, ale ani jedno nesmí propadnout bez kontroly.
const tuyaId = podleJmena.TUYA_HEATPUMP_ID || '';
const shellyIdcka = idcka.filter(id => id !== tuyaId);
check('Shelly zařízení je šestnáct', shellyIdcka.length, 16);
check('  a všechna mají dvanáct hex znaků',
  shellyIdcka.filter(id => !/^[0-9a-f]{12}$/.test(id)).join(', ') || 'ano', 'ano');
check('Tuya čerpadlo má dvacet hex znaků', /^[0-9a-f]{20}$/.test(tuyaId), true);
// Tuya ID končí MAC adresou zařízení — u tohohle čerpadla je to 8C:AA:B5:E8:F0:28,
// které sedělo i ve výpisu wifi z routeru. Kdyby se ID přepsalo, tohle to chytí.
check('  a končí MAC čerpadla', tuyaId.slice(-12), '8caab5e8f028');
// Solinátor 'dcda0ce01f40' a noční světlo 'dcda0cea454c' se liší až osmým znakem —
// zaměnit dvě ID není teoretická obava
const dvakrat = idcka.filter((id, i) => idcka.indexOf(id) !== i);
check('žádné ID dvakrát', dvakrat.join(', ') || 'ano', 'ano');

const podle = jm => (KONFIG.match(new RegExp('process\\.env\\.' + jm + "\\s*\\|\\|\\s*'([0-9a-f]{12})'")) || [])[1];
check('bojler', podle('SHELLY_DEVICE_ID'), '5432045837c8');
check('bazén', podle('POOL_DEVICE_ID'), 'dcb4d9cb7b44');
check('solinátor', podle('SOLINATOR_DEVICE_ID'), 'dcda0ce01f40');
check('oběhové čerpadlo', podle('OBEH_DEVICE_ID'), '543204663bf4');

nadpis('7) Kontrola kontroly identit');
const cisty = "const A = process.env.A || 'aabbccddeeff';\nconst B = process.env.B || '112233445566';";
check('čistý úryvek projde', idLiteraly(cisty).bezPromenne.join(',') || 'ano', 'ano');
check('  a najde obě ID', idLiteraly(cisty).idcka.join(','), 'aabbccddeeff,112233445566');
check('  a přiřadí je k proměnným', idLiteraly(cisty).podle.B, '112233445566');
const natvrdo = "const A = 'aabbccddeeff';";
check('ID bez proměnné se najde', idLiteraly(natvrdo).bezPromenne.join(','), 'aabbccddeeff');
const seznam = "const A = process.env.A || 'aabbccddeeff,112233445566';";
check('seznam se rozpadne na kusy', idLiteraly(seznam).idcka.length, 2);
check('oddělovač se za ID nepovažuje', idLiteraly("','").idcka.length, 0);

konec();
