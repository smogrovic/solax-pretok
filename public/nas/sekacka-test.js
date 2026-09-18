#!/usr/bin/env node
// Ohmatávací skript pro sekačku Anthbot — nic nespíná, jen se ptá.
//
// Anthbot nemá oficiální API. Tvar přihlášení a čtení stavu je odkoukaný
// z komunitní integrace do Home Assistantu (vincentjanv/anthbot_genie_ha),
// přepsaný do Node bez jediné závislosti.
//
// Celá cesta ke stavu sekačky vede přes cloud, takže na rozdíl od závlahy
// nepotřebuje domácí síť — tenhle skript poběží na NASu i na Macu:
//   curl -o /volume1/family/scripts/uklid/sekacka-test.js https://solax-pretok.onrender.com/nas/sekacka-test.js
//   node /volume1/family/scripts/uklid/sekacka-test.js
//
// Heslo k účtu Anthbot se píše do uklid.config.json vedle skriptu — zůstává
// u tebe, do repozitáře ani do chatu nepatří.
//
// Čtyři kroky, než se dostaneme ke stavu:
//   1. přihlášení heslem            → bearer token
//   2. seznam sekaček na účtu       → sériové číslo
//   3. region sekačky               → adresa AWS IoT
//   4. dočasné AWS klíče (STS)      → podpis SigV4 → „shadow" se stavem
//
// Natvrdo zadrátované AWS klíče, které má v sobě ta integrace, tady schválně
// nejsou. Dočasné klíče z kroku 4 dělají totéž a nikomu nepatří napořád.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SLOZKA = '/volume1/family/scripts/uklid';
const KONFIG = path.join(__dirname, 'uklid.config.json');
const HOST = 'api.anthbot.com';
const UA = 'LdMower/1581 CFNetwork/3860.400.51 Darwin/25.3.0';
const AWS_UA = 'aws-sdk-js/3.1025.0';
const SLUZBA = 'iotdata';          // jméno služby v podpisu SigV4
const CEKANI_MS = 20000;
const AREA_KOD_VYCHOZI = '420';    // předvolba, se kterou se účet zakládal

// ---------- Hlavičky, na kterých cloud trvá ----------

function hlavicky(token) {
  const h = {
    Accept: 'application/json, text/plain, */*',
    version: 'v2',
    language: 'en',
    'User-Agent': UA
  };
  if (token) h.Authorization = token;
  return h;
}

// Některé endpointy chtějí navíc tenhle token. Není to tajemství — jen otisk
// sériového čísla a času, aby se stejný požadavek nedal donekonečna přehrávat.
function overovaciToken(sn, cas) {
  const razitko = String(cas === undefined ? Math.floor(Date.now() / 1000) : cas);
  return crypto.createHash('md5').update(`${sn}${razitko}`, 'utf8').digest('hex') + razitko;
}

// ---------- Podpis SigV4 ----------

function hmac(klic, text) {
  return crypto.createHmac('sha256', klic).update(text, 'utf8').digest();
}

function otisk(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Klíč se odvozuje ve čtyřech krocích a na pořadí záleží: datum, region,
// služba, závěrečná konstanta. Prohození kteréhokoli z nich dá jiný podpis
// a AWS odpoví 403 bez vysvětlení.
function podpisovyKlic(tajny, den, region, sluzba = SLUZBA) {
  const kDatum = hmac(`AWS4${tajny}`, den);
  const kRegion = hmac(kDatum, region);
  const kSluzba = hmac(kRegion, sluzba);
  return hmac(kSluzba, 'aws4_request');
}

// AWS chce v podpisu cestu zakódovanou znovu, takže z '%' je '%25'. Bez toho
// by sériová čísla se zvláštním znakem tiše přestala fungovat.
function kanonickaCesta(uri) {
  let out = '';
  for (const bajt of Buffer.from(uri, 'utf8')) {
    const znak = String.fromCharCode(bajt);
    out += /[0-9A-Za-z\-._~/]/.test(znak) ? znak : '%' + bajt.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

// Hlavičky se do podpisu dávají malými písmeny, seřazené a se smrsknutými
// mezerami. Jiné pořadí = jiný podpis.
function kanonickeHlavicky(hlavicky) {
  const male = {};
  for (const [klic, hodnota] of Object.entries(hlavicky)) {
    male[klic.toLowerCase()] = String(hodnota).trim().split(/\s+/).join(' ');
  }
  const klice = Object.keys(male).sort();
  return {
    kanonicke: klice.map(k => `${k}:${male[k]}\n`).join(''),
    podepsane: klice.join(';')
  };
}

function kanonickyPozadavek({ metoda, cesta, dotaz, hlavicky, otiskTela }) {
  const { kanonicke, podepsane } = kanonickeHlavicky(hlavicky);
  return {
    text: [metoda, kanonickaCesta(cesta), dotaz, kanonicke, podepsane, otiskTela].join('\n'),
    podepsane
  };
}

function autorizace({ klicId, tajny, region, den, amzDatum, pozadavek, podepsane, sluzba = SLUZBA }) {
  const rozsah = `${den}/${region}/${sluzba}/aws4_request`;
  const kPodpisu = ['AWS4-HMAC-SHA256', amzDatum, rozsah, otisk(pozadavek)].join('\n');
  const podpis = crypto.createHmac('sha256', podpisovyKlic(tajny, den, region, sluzba))
    .update(kPodpisu, 'utf8').digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${klicId}/${rozsah}, SignedHeaders=${podepsane}, Signature=${podpis}`;
}

function amzCas(kdy = new Date()) {
  const amz = kdy.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amz, den: amz.slice(0, 8) };
}

// ---------- Cloud Anthbotu ----------

// Všechny endpointy odpovídají obálkou { code, data }. Nula znamená v pořádku;
// cokoliv jiného je odmítnutí a nemá smysl číst data.
async function cloud(cesta, { token, metoda = 'GET', telo, dotaz } = {}) {
  const url = new URL(`https://${HOST}${cesta}`);
  for (const [k, v] of Object.entries(dotaz || {})) url.searchParams.set(k, v);
  const h = hlavicky(token);
  if (telo) h['content-type'] = 'application/json';
  const res = await fetch(url, {
    method: metoda,
    headers: h,
    body: telo ? JSON.stringify(telo) : undefined,
    signal: AbortSignal.timeout(CEKANI_MS)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${cesta}: cloud odpověděl HTTP ${res.status} — ${text.slice(0, 200)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${cesta}: odpověď není JSON — ${text.slice(0, 200)}`);
  }
  if (!json || json.code !== 0) {
    throw new Error(`${cesta}: cloud odmítl (code ${json && json.code}${json && json.msg ? ', ' + json.msg : ''})`);
  }
  return json.data;
}

async function prihlas(nastaveni) {
  const data = await cloud('/api/v1/login', {
    metoda: 'POST',
    telo: { username: nastaveni.email, password: nastaveni.heslo, areaCode: nastaveni.areaCode }
  });
  if (!data || typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('přihlášení prošlo, ale nepřišel token');
  }
  return `Bearer ${data.access_token}`;
}

function sekackyZeSeznamu(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter(p => p && typeof p.sn === 'string' && p.sn)
    .map(p => ({
      sn: p.sn,
      jmeno: (typeof p.alias === 'string' && p.alias) ? p.alias : p.sn,
      model: p.category_id === undefined || p.category_id === null ? '' : String(p.category_id),
      majitel: typeof p.is_owner === 'boolean' ? p.is_owner : p.is_owner === 1
    }));
}

async function sekacky(token) {
  return sekackyZeSeznamu(await cloud('/api/v1/device/bind/list', { token }));
}

async function region(token, sn) {
  const data = await cloud('/api/v1/device/v2/region', { token, dotaz: { sn } });
  if (!data || !data.region_name || !data.iot_endpoint) throw new Error('region neobsahuje adresu IoT');
  return { region: data.region_name, endpoint: data.iot_endpoint };
}

async function docasneKlice(token, sn) {
  const data = await cloud('/api/v1/device/v2/iot/sts/arn', {
    token, metoda: 'POST',
    telo: { sn, verification_token: overovaciToken(sn) }
  });
  const chybi = ['access_key_id', 'secret_access_key', 'session_token', 'region_name', 'endpoint']
    .filter(k => typeof (data || {})[k] !== 'string' || !data[k]);
  if (chybi.length) throw new Error(`dočasné klíče neobsahují: ${chybi.join(', ')}`);
  return {
    klicId: data.access_key_id,
    tajny: data.secret_access_key,
    relace: data.session_token,
    region: data.region_name,
    endpoint: String(data.endpoint).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    doKdy: data.expiration
  };
}

// ---------- Stav sekačky (AWS IoT shadow) ----------

function podepsanyDotaz(klice, sn, jmenoStinu, kdy = new Date()) {
  const cesta = `/things/${encodeURIComponent(sn)}/shadow`;
  const dotaz = `name=${encodeURIComponent(jmenoStinu)}`;
  const otiskTela = otisk('');
  const { amz, den } = amzCas(kdy);

  const kPodpisu = {
    host: klice.endpoint,
    'x-amz-content-sha256': otiskTela,
    'x-amz-date': amz,
    'x-amz-security-token': klice.relace,
    'x-amz-user-agent': AWS_UA
  };
  const { text, podepsane } = kanonickyPozadavek({
    metoda: 'GET', cesta, dotaz, hlavicky: kPodpisu, otiskTela
  });
  const podpis = autorizace({
    klicId: klice.klicId, tajny: klice.tajny, region: klice.region,
    den, amzDatum: amz, pozadavek: text, podepsane
  });
  return {
    url: `https://${klice.endpoint}${cesta}?${dotaz}`,
    hlavicky: { ...kPodpisu, Accept: '*/*', 'User-Agent': AWS_UA, Authorization: podpis }
  };
}

async function stinSekacky(klice, sn, jmenoStinu = 'property') {
  const { url, hlavicky } = podepsanyDotaz(klice, sn, jmenoStinu);
  const res = await fetch(url, { headers: hlavicky, signal: AbortSignal.timeout(CEKANI_MS) });
  const text = await res.text();
  if (!res.ok) throw new Error(`stav (${jmenoStinu}): HTTP ${res.status} — ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return (json.state && json.state.reported) || {};
}

// ---------- Mapa ----------

async function mapaSekacky(token, sn) {
  const data = await cloud('/api/v1/device/v2/presigned_url', {
    token,
    dotaz: { filename: `area_${sn}.txt`, sn, verification_token: overovaciToken(sn) }
  });
  if (!data || typeof data.presigned_url !== 'string') throw new Error('nepřišla adresa souboru s plochou');
  const res = await fetch(data.presigned_url, { signal: AbortSignal.timeout(CEKANI_MS) });
  if (!res.ok) throw new Error(`soubor s plochou: HTTP ${res.status}`);
  return await res.text();
}

// ---------- Konfigurace ----------

function nactiKonfig(cesta = KONFIG, skript = 'sekacka-test.js') {
  if (!fs.existsSync(cesta)) {
    fs.writeFileSync(cesta, JSON.stringify({ email: '', heslo: '', areaCode: AREA_KOD_VYCHOZI }, null, 2) + '\n');
    return { chyba: `Založil jsem ${cesta}.\nDopiš do něj e-mail a heslo k účtu Anthbot, pak skript spusť znovu:\n  node ${SLOZKA}/${skript}` };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(cesta, 'utf8'));
  } catch (e) {
    return { chyba: `Soubor ${cesta} se nepodařilo přečíst (${e.message}).\nMá vypadat takhle:\n  { "email": "…", "heslo": "…", "areaCode": "${AREA_KOD_VYCHOZI}" }` };
  }
  const email = String(data && data.email || '').trim();
  const heslo = String(data && data.heslo || '').trim();
  const areaCode = String(data && data.areaCode || AREA_KOD_VYCHOZI).trim();
  if (!email || !heslo) {
    const chybi = !email && !heslo ? 'e-mail i heslo' : !email ? 'e-mail' : 'heslo';
    return { chyba: `V ${cesta} chybí ${chybi}.\nDopiš to a spusť znovu:\n  node ${SLOZKA}/${skript}` };
  }
  return { nastaveni: { email, heslo, areaCode } };
}

// ---------- Výpis ----------

// Jak se pole ve stínu jmenují u M5, se odsud nedá zjistit. Tohle jsou dohady
// podle jmen z integrace — co se netrefí, vypíše se z --raw a doplní se pak.
const CTENI = {
  baterie: ['battery', 'batteryLevel', 'battery_level', 'power'],
  stav: ['workStatus', 'work_status', 'status', 'state', 'mode'],
  chyba: ['errorCode', 'error_code', 'error', 'fault'],
  vyska: ['mowHeight', 'mow_height', 'cuttingHeight', 'height'],
  plocha: ['mowArea', 'mow_area', 'area', 'totalArea'],
  cas: ['mowTime', 'mow_time', 'workTime', 'totalTime']
};

function vyber(stin, jmena) {
  for (const jmeno of jmena) {
    if (stin && stin[jmeno] !== undefined && stin[jmeno] !== null) return stin[jmeno];
  }
  return undefined;
}

function radkyVypisu(sekacka, stin) {
  const r = [`Sekačka: ${sekacka.jmeno}${sekacka.model ? ` (kategorie ${sekacka.model})` : ''}`];
  for (const [popis, jmena] of Object.entries(CTENI)) {
    const hodnota = vyber(stin, jmena);
    if (hodnota !== undefined) r.push(`  ${popis}: ${typeof hodnota === 'object' ? JSON.stringify(hodnota) : hodnota}`);
  }
  const poli = Object.keys(stin || {}).length;
  r.push(`  polí ve stavu: ${poli}${poli ? ` (${Object.keys(stin).slice(0, 12).join(', ')}${poli > 12 ? ', …' : ''})` : ''}`);
  return r;
}

async function hlavni(argv = process.argv.slice(2), cesta = KONFIG) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Ohmatávací skript pro sekačku Anthbot. Nic nespíná, jen se ptá.\n\n  node ${SLOZKA}/sekacka-test.js          čitelný výpis\n  node ${SLOZKA}/sekacka-test.js --raw    uloží i syrový stav a mapu do souborů\n\nÚčet je v ${cesta}.`);
    return 0;
  }
  const syrove = argv.includes('--raw');
  const konfig = nactiKonfig(cesta);
  if (konfig.chyba) {
    console.log(konfig.chyba);
    return 1;
  }

  console.log('Sekačka Anthbot — ohmatávací test\n');
  let token;
  try {
    token = await prihlas(konfig.nastaveni);
    console.log('Přihlášení: v pořádku');
  } catch (e) {
    console.log(`Přihlášení selhalo: ${e.message}`);
    console.log(`\nZkontroluj e-mail, heslo a předvolbu areaCode v ${cesta}.\nPředvolba je číslo země bez plusu — pro Česko "420".`);
    return 1;
  }

  let seznam;
  try {
    seznam = await sekacky(token);
  } catch (e) {
    console.log(`Seznam sekaček se nepodařilo načíst: ${e.message}`);
    return 1;
  }
  if (!seznam.length) {
    console.log('Na účtu není žádná sekačka. Je to ten účet, kterým se hlásíš v appce Anthbot?');
    return 1;
  }
  console.log(`Sekaček na účtu: ${seznam.length}\n`);

  let potize = 0;
  for (const sekacka of seznam) {
    try {
      const kraj = await region(token, sekacka.sn);
      const klice = await docasneKlice(token, sekacka.sn);
      const stin = await stinSekacky(klice, sekacka.sn);
      console.log(radkyVypisu(sekacka, stin).join('\n'));
      console.log(`  region: ${kraj.region}`);
      if (syrove) {
        const soubor = path.join(path.dirname(cesta), `stav-${sekacka.sn}.json`);
        fs.writeFileSync(soubor, JSON.stringify(stin, null, 2) + '\n');
        console.log(`  syrový stav uložen do ${soubor}`);
        try {
          const mapa = await mapaSekacky(token, sekacka.sn);
          const mapaSoubor = path.join(path.dirname(cesta), `mapa-${sekacka.sn}.txt`);
          fs.writeFileSync(mapaSoubor, mapa);
          console.log(`  mapa (${mapa.length} znaků) uložena do ${mapaSoubor}`);
        } catch (e) {
          console.log(`  mapa se nenačetla: ${e.message}`);
        }
      }
    } catch (e) {
      potize++;
      console.log(`Sekačka ${sekacka.jmeno}: ${e.message}`);
    }
    console.log('');
  }

  if (potize === seznam.length) {
    console.log('Ani u jedné sekačky se nepodařilo přečíst stav.');
    return 1;
  }
  console.log(syrove
    ? 'Hotovo — pošli mi tenhle výpis a soubor stav-*.json. Podle nich se postaví stránka.'
    : 'Hotovo. Spusť to ještě jednou s --raw, ať se uloží syrový stav, a pošli mi ho.');
  return 0;
}

if (require.main === module) {
  hlavni().then(kod => { process.exitCode = kod; }).catch(e => {
    console.error(`Skript spadl: ${e.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  SLOZKA, KONFIG, HOST, UA, AWS_UA, SLUZBA, AREA_KOD_VYCHOZI, CTENI,
  hlavicky, overovaciToken, podpisovyKlic, kanonickaCesta, kanonickeHlavicky,
  kanonickyPozadavek, autorizace, amzCas, otisk,
  cloud, prihlas, sekacky, sekackyZeSeznamu, region, docasneKlice,
  podepsanyDotaz, stinSekacky, mapaSekacky,
  nactiKonfig, vyber, radkyVypisu, hlavni
};
