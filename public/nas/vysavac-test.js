#!/usr/bin/env node
// Ohmatávací skript pro vysavač Xiaomi — nic nespíná, jen se ptá.
//
// Xiaomi X20+ (model xiaomi.vacuum.c102gl) mluví protokolem MIoT. Ten je
// veřejně popsaný, ale čísla vlastností (siid/piid) má každý model jiná
// a pro tenhle nejsou nikde napsaná. Tenhle skript je od toho, aby je
// vypsal — teprve podle nich se dá napsat můstek a stránka v appce.
//
// Přihlašovací postup i podpisy jsou odkoukané z
// PiotrMachowski/Xiaomi-cloud-tokens-extractor a al-one/hass-xiaomi-miot,
// přepsané do Node bez jediné závislosti.
//
// Běží schválně DOMA, ne na Renderu: Xiaomi na přihlášení z datového centra
// hází captchu nebo ověření přes SMS, které se ze serveru nedá proklikat,
// a denně povolí jen pár pokusů. Z domácí IP projde normálně.
//   curl -o /volume1/family/scripts/vysavac/vysavac-test.js https://solax-pretok.onrender.com/nas/vysavac-test.js
//   node /volume1/family/scripts/vysavac/vysavac-test.js
//
// Heslo k účtu Xiaomi se píše do vysavac.config.json vedle skriptu — zůstává
// u tebe, do repozitáře ani do chatu nepatří.
//
// Pět kroků:
//   1. přihlášení heslem            → ssecurity + serviceToken
//   2. domácnosti a místnosti       → jména a čísla pokojů
//   3. seznam zařízení              → did, model, token, adresa v síti
//   4. spec modelu z miot-spec.org  → tabulka siid/piid/aiid
//   5. přečtení všech vlastností    → co který siid/piid doopravdy vrací

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');

const SLOZKA = '/volume1/family/scripts/vysavac';
const KONFIG = path.join(__dirname, 'vysavac.config.json');
const UCET = 'https://account.xiaomi.com';
const SPEC_HOST = 'https://miot-spec.org';
const UA = 'Android-7.1.1-1.0.0-ONEPLUS A3010-136-9C4A55F5F1A2-app-mi-com-AndroidApp/10.5.201';
const SDK = 'accountsdk-18.8.15';
const CEKANI_MS = 20000;
const REGION_VYCHOZI = 'de';       // evropský server; „cn" je bez předpony
const MIIO_PORT = 54321;
const MIIO_CEKANI_MS = 2000;

// Odpovědi z účtu Xiaomi mají před JSONem jedenáct znaků balastu (&&&START&&&),
// které do JSON.parse nepatří.
const BALAST = '&&&START&&&';

// ---------- Drobné pomůcky ----------

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function nahodneId(delka = 16) {
  const znaky = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < delka; i++) out += znaky[crypto.randomInt(znaky.length)];
  return out;
}

// Před JSONem bývá balast. Když tam není, odpověď bereme celou —
// ale rozbitý JSON se nesmí tvářit jako v pořádku.
function odbal(text) {
  const cisty = text.startsWith(BALAST) ? text.slice(BALAST.length) : text;
  try {
    return JSON.parse(cisty);
  } catch {
    throw new Error('odpověď nešla přečíst jako JSON');
  }
}

// ---------- RC4 ----------

// Node RC4 neumí, OpenSSL 3 ho vyhodil. Patnáct řádků podle referenční
// implementace v hass-xiaomi-miot.
function rc4(klic, data) {
  const s = [];
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + klic[i % klic.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  const out = Buffer.alloc(data.length);
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// Xiaomi vyhazuje první kilobajt keystreamu. Bez toho odpoví odmítnutím
// a není z čeho poznat proč — je to jediný řádek, kde se to dá splést.
function rc4Drop1024(klic, data) {
  const s = [];
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + klic[i % klic.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  const krok = () => {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    return s[(s[i] + s[j]) & 255];
  };
  for (let n = 0; n < 1024; n++) krok();
  const out = Buffer.alloc(data.length);
  for (let n = 0; n < data.length; n++) out[n] = data[n] ^ krok();
  return out;
}

// ---------- Podpisy ----------

function nonce(kdy = Date.now()) {
  const buf = Buffer.alloc(12);
  crypto.randomFillSync(buf, 0, 8);
  buf.writeUInt32BE(Math.floor(kdy / 60000), 8);
  return buf.toString('base64');
}

function podepsanyNonce(ssecurity, n) {
  return sha256(Buffer.concat([
    Buffer.from(ssecurity, 'base64'),
    Buffer.from(n, 'base64')
  ])).toString('base64');
}

// Prostá varianta: HMAC-SHA256 nad cestou, podepsaným nonce a parametry
function podpisProsty(cesta, podepsany, n, parametry) {
  const casti = [cesta, podepsany, n];
  for (const [k, v] of Object.entries(parametry)) casti.push(`${k}=${v}`);
  return crypto.createHmac('sha256', Buffer.from(podepsany, 'base64'))
    .update(casti.join('&')).digest('base64');
}

// Šifrovaná varianta: SHA1 nad metodou, cestou, parametry a podepsaným nonce
function podpisSifrovany(metoda, cesta, podepsany, parametry) {
  const casti = [String(metoda).toUpperCase(), cesta.replace('/app/', '/')];
  for (const [k, v] of Object.entries(parametry)) casti.push(`${k}=${v}`);
  casti.push(podepsany);
  return crypto.createHash('sha1').update(casti.join('&')).digest('base64');
}

function zasifrujParametry(podepsany, hodnota) {
  return rc4Drop1024(Buffer.from(podepsany, 'base64'), Buffer.from(hodnota, 'utf8')).toString('base64');
}

function desifrujOdpoved(podepsany, telo) {
  return rc4Drop1024(Buffer.from(podepsany, 'base64'), Buffer.from(telo, 'base64')).toString('utf8');
}

// ---------- Přihlášení ----------

function cookieHlavicka(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function posbirejCookies(res, kam) {
  const hlavicky = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.raw ? res.headers.raw()['set-cookie'] || [] : []);
  for (const radek of hlavicky) {
    const [par] = String(radek).split(';');
    const i = par.indexOf('=');
    if (i > 0) kam[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
  return kam;
}

// Ověření účtu není totéž co špatné heslo. Když se to slije, člověk mění
// heslo, které je správné, a nechápe proč to pořád nejde.
function overeniPotreba(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.notificationUrl === 'string' && data.notificationUrl) {
    return { druh: 'ověření účtu', kde: data.notificationUrl };
  }
  if (typeof data.captchaUrl === 'string' && data.captchaUrl) {
    return { druh: 'captcha', kde: UCET + data.captchaUrl };
  }
  return null;
}

async function prihlas(nastaveni) {
  const cookies = { sdkVersion: SDK, deviceId: nahodneId() };

  const krok1 = await fetch(`${UCET}/pass/serviceLogin?sid=xiaomiio&_json=true`, {
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHlavicka(cookies) },
    signal: AbortSignal.timeout(CEKANI_MS)
  });
  if (!krok1.ok) throw new Error(`přihlášení (krok 1): HTTP ${krok1.status}`);
  posbirejCookies(krok1, cookies);
  const uvod = odbal(await krok1.text());

  const pole = new URLSearchParams({
    sid: 'xiaomiio',
    hash: md5(nastaveni.heslo).toUpperCase(),
    callback: 'https://sts.api.io.mi.com/sts',
    qs: '%3Fsid%3Dxiaomiio%26_json%3Dtrue',
    user: nastaveni.email,
    _json: 'true'
  });
  if (uvod._sign) pole.set('_sign', uvod._sign);

  const krok2 = await fetch(`${UCET}/pass/serviceLoginAuth2`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHlavicka(cookies) },
    body: pole.toString(),
    signal: AbortSignal.timeout(CEKANI_MS)
  });
  if (!krok2.ok) throw new Error(`přihlášení (krok 2): HTTP ${krok2.status}`);
  posbirejCookies(krok2, cookies);
  const data = odbal(await krok2.text());

  const overeni = overeniPotreba(data);
  if (overeni) {
    const e = new Error(`Xiaomi chce ${overeni.druh}. Heslo je nejspíš v pořádku — účet jen žádá potvrzení.\n  Otevři v prohlížeči: ${overeni.kde}\n  Potvrď to a spusť skript znovu.`);
    e.overeni = overeni;
    throw e;
  }
  if (!data.ssecurity || !data.location) {
    throw new Error(`přihlášení neprošlo (kód ${data.code === undefined ? '?' : data.code}${data.desc ? `, ${data.desc}` : ''})`);
  }

  const krok3 = await fetch(data.location, {
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHlavicka(cookies) },
    signal: AbortSignal.timeout(CEKANI_MS)
  });
  if (!krok3.ok) throw new Error(`přihlášení (krok 3): HTTP ${krok3.status}`);
  posbirejCookies(krok3, cookies);
  if (!cookies.serviceToken) throw new Error('nepřišel serviceToken');

  return {
    ssecurity: data.ssecurity,
    userId: String(data.userId || ''),
    cUserId: String(data.cUserId || ''),
    passToken: String(data.passToken || ''),
    serviceToken: cookies.serviceToken
  };
}

// ---------- Dotazy do cloudu ----------

function adresaSluzby(region) {
  const r = String(region || REGION_VYCHOZI).trim().toLowerCase();
  return `https://${r === 'cn' ? '' : r + '.'}api.io.mi.com/app`;
}

function hlavickyDotazu(prihlaseni, region) {
  return {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
    'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
    Accept: '*/*',
    Cookie: cookieHlavicka({
      userId: prihlaseni.userId,
      yetAnotherServiceToken: prihlaseni.serviceToken,
      serviceToken: prihlaseni.serviceToken,
      locale: 'cs_CZ',
      timezone: 'GMT+02:00',
      is_daylight: '1',
      dst_offset: '3600000',
      channel: 'MI_APP_STORE',
      sdkVersion: SDK,
      deviceId: nahodneId(),
      cUserId: prihlaseni.cUserId,
      countryCode: String(region || REGION_VYCHOZI).toUpperCase()
    })
  };
}

// Obě varianty podpisu jsou doložené a který účet chce kterou, se dopředu
// nepozná. Zkusí se prostá, a když ji cloud odmítne, šifrovaná — a ven jde,
// která prošla, ať se v můstku nemusí hádat znovu.
async function dotaz(prihlaseni, region, cesta, data, varianta = null) {
  const zaklad = adresaSluzby(region);
  const url = zaklad + cesta;
  const telo = JSON.stringify(data);
  const n = nonce();
  const podepsany = podepsanyNonce(prihlaseni.ssecurity, n);
  const cestaProPodpis = new URL(url).pathname;

  let body;
  if (varianta === 'rc4') {
    const parametry = { data: telo };
    parametry.rc4_hash__ = podpisSifrovany('POST', cestaProPodpis, podepsany, parametry);
    for (const k of Object.keys(parametry)) parametry[k] = zasifrujParametry(podepsany, parametry[k]);
    body = new URLSearchParams({
      ...parametry,
      signature: podpisSifrovany('POST', cestaProPodpis, podepsany, parametry),
      ssecurity: prihlaseni.ssecurity,
      _nonce: n
    }).toString();
  } else {
    body = new URLSearchParams({
      data: telo,
      signature: podpisProsty(cestaProPodpis.replace('/app/', '/'), podepsany, n, { data: telo }),
      _nonce: n
    }).toString();
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: hlavickyDotazu(prihlaseni, region),
    body,
    signal: AbortSignal.timeout(CEKANI_MS)
  });
  if (!res.ok) throw new Error(`${cesta}: HTTP ${res.status}`);
  const syrove = await res.text();
  const text = varianta === 'rc4' ? desifrujOdpoved(podepsany, syrove) : syrove;
  let odpoved;
  try {
    odpoved = JSON.parse(text);
  } catch {
    throw new Error(`${cesta}: odpověď nešla přečíst`);
  }
  if (odpoved.code !== undefined && odpoved.code !== 0) {
    throw new Error(`${cesta}: cloud odmítl (kód ${odpoved.code}${odpoved.message ? `, ${odpoved.message}` : ''})`);
  }
  return odpoved.result === undefined ? odpoved : odpoved.result;
}

// Zjistí, kterou variantou podpisu se s tímhle účtem mluví
async function najdiVariantu(prihlaseni, region) {
  const potize = [];
  for (const varianta of ['prosta', 'rc4']) {
    try {
      const vysledek = await dotaz(prihlaseni, region, '/v2/homeroom/gethome',
        { fetch_share: true, fetch_share_dev: true, limit: 300, app_ver: 7 }, varianta === 'rc4' ? 'rc4' : null);
      return { varianta, domacnosti: (vysledek && vysledek.homelist) || [] };
    } catch (e) {
      potize.push(`${varianta}: ${e.message}`);
    }
  }
  throw new Error(`ani jeden způsob podpisu neprošel\n  ${potize.join('\n  ')}`);
}

async function zarizeni(prihlaseni, region, varianta) {
  const vysledek = await dotaz(prihlaseni, region, '/home/device_list',
    { getVirtualModel: false, getHuamiDevices: 0 }, varianta === 'rc4' ? 'rc4' : null);
  return (vysledek && vysledek.list) || [];
}

async function vlastnosti(prihlaseni, region, varianta, did, dvojice) {
  const params = dvojice.map(([siid, piid]) => ({ did: String(did), siid, piid }));
  const vysledek = await dotaz(prihlaseni, region, '/miotspec/prop/get', { params },
    varianta === 'rc4' ? 'rc4' : null);
  return Array.isArray(vysledek) ? vysledek : [];
}

// ---------- Spec modelu ----------

async function najdiUrn(model) {
  const res = await fetch(`${SPEC_HOST}/miot-spec-v2/instances?status=all`, {
    signal: AbortSignal.timeout(CEKANI_MS)
  });
  if (!res.ok) throw new Error(`seznam specifikací: HTTP ${res.status}`);
  const data = await res.json();
  const seznam = (data && data.instances) || [];
  const shody = seznam.filter(i => i && i.model === model);
  if (!shody.length) throw new Error(`pro model ${model} není v seznamu žádná specifikace`);
  shody.sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
  return shody[0].type;
}

async function nactiSpec(urn) {
  const res = await fetch(`${SPEC_HOST}/miot-spec-v2/instance?type=${encodeURIComponent(urn)}`, {
    signal: AbortSignal.timeout(CEKANI_MS)
  });
  if (!res.ok) throw new Error(`specifikace: HTTP ${res.status}`);
  return await res.json();
}

function kratkyNazev(urn) {
  const casti = String(urn || '').split(':');
  return casti.length > 3 ? casti[3] : String(urn || '');
}

// Ze specifikace se vytáhne to, co potřebuju do můstku: co jde číst
// a co jde spustit, každé se svým číslem.
function rozeberSpec(spec) {
  const cteni = [];
  const povely = [];
  for (const sluzba of (spec && spec.services) || []) {
    const sJmeno = kratkyNazev(sluzba.type) || sluzba.description || '?';
    for (const p of sluzba.properties || []) {
      if (!(p.access || []).includes('read')) continue;
      cteni.push({
        sluzba: sJmeno,
        jmeno: kratkyNazev(p.type) || p.description || '?',
        siid: sluzba.iid,
        piid: p.iid,
        format: p.format,
        hodnoty: p['value-list'] || p['value-range'] || null
      });
    }
    for (const a of sluzba.actions || []) {
      povely.push({
        sluzba: sJmeno,
        jmeno: kratkyNazev(a.type) || a.description || '?',
        siid: sluzba.iid,
        aiid: a.iid,
        vstup: a.in || []
      });
    }
  }
  return { cteni, povely };
}

// ---------- Domácí síť ----------

// Jen „ozve se vůbec?". Podle toho se v kroku 2 rozhodne, jestli může
// můstek mluvit s vysavačem přímo a cloud vynechat.
function miioHello(adresa, cekani = MIIO_CEKANI_MS) {
  return new Promise(resolve => {
    if (!adresa) return resolve({ ok: false, duvod: 'vysavač nehlásí adresu v síti' });
    const paket = Buffer.alloc(32, 0xff);
    paket.writeUInt16BE(0x2131, 0);
    paket.writeUInt16BE(32, 2);
    paket.writeUInt32BE(0, 4);
    const soket = dgram.createSocket('udp4');
    let hotovo = false;
    const dokonci = v => {
      if (hotovo) return;
      hotovo = true;
      clearTimeout(budik);
      try { soket.close(); } catch {}
      resolve(v);
    };
    const budik = setTimeout(() => dokonci({ ok: false, duvod: 'neozval se do dvou vteřin' }), cekani);
    soket.on('error', e => dokonci({ ok: false, duvod: e.message }));
    soket.on('message', zprava => dokonci({ ok: zprava.length >= 32, delka: zprava.length }));
    soket.send(paket, MIIO_PORT, adresa, e => { if (e) dokonci({ ok: false, duvod: e.message }); });
  });
}

// ---------- Konfigurace ----------

function nactiKonfig(cesta = KONFIG, skript = 'vysavac-test.js') {
  if (!fs.existsSync(cesta)) {
    fs.writeFileSync(cesta, JSON.stringify({ email: '', heslo: '', region: REGION_VYCHOZI }, null, 2) + '\n');
    return { chyba: `Založil jsem ${cesta}.\nDopiš do něj e-mail a heslo k účtu Xiaomi (ten, do kterého se hlásíš v Mi Home), pak skript spusť znovu:\n  node ${SLOZKA}/${skript}` };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(cesta, 'utf8'));
  } catch (e) {
    return { chyba: `Soubor ${cesta} se nepodařilo přečíst (${e.message}).\nMá vypadat takhle:\n  { "email": "…", "heslo": "…", "region": "${REGION_VYCHOZI}" }` };
  }
  const email = String(data && data.email || '').trim();
  const heslo = String(data && data.heslo || '').trim();
  const region = String(data && data.region || REGION_VYCHOZI).trim().toLowerCase();
  if (!email || !heslo) {
    const chybi = !email && !heslo ? 'e-mail i heslo' : !email ? 'e-mail' : 'heslo';
    return { chyba: `V ${cesta} chybí ${chybi}.\nDopiš to a spusť znovu:\n  node ${SLOZKA}/${skript}` };
  }
  return { nastaveni: { email, heslo, region } };
}

// ---------- Výpis ----------

// Token je klíč k vysavači. Do výpisu patří jen tolik, aby bylo poznat,
// že tam nějaký je — celý se posílat nemá.
function zkratToken(token) {
  const t = String(token || '');
  if (!t) return '(žádný)';
  return t.length <= 6 ? '…' : `${t.slice(0, 3)}…${t.slice(-2)} (${t.length} znaků)`;
}

function jeVysavac(z) {
  return typeof z.model === 'string' && z.model.includes('vacuum');
}

function mistnostiZDomacnosti(domacnosti) {
  const out = [];
  for (const d of domacnosti || []) {
    for (const m of d.roomlist || []) {
      out.push({ domacnost: d.name || '', jmeno: m.name || '', id: m.id, did: (m.dids || []).length });
    }
  }
  return out;
}

function radkyVypisu(vysavac, mistnosti, spec, hodnoty) {
  const r = [`Vysavač: ${vysavac.name || '(bez jména)'}  ${vysavac.model}`];
  r.push(`  did: ${vysavac.did}`);
  r.push(`  v síti: ${vysavac.localip || '(nehlásí)'}`);
  r.push(`  token: ${zkratToken(vysavac.token)}`);
  r.push(`  online: ${vysavac.isOnline ? 'ano' : 'ne'}`);

  r.push('', `Místnosti (${mistnosti.length}):`);
  for (const m of mistnosti) r.push(`  ${m.id}  ${m.jmeno}${m.domacnost ? `  [${m.domacnost}]` : ''}`);
  if (!mistnosti.length) r.push('  (žádné — vysavač zatím nemá uloženou mapu?)');

  const podleKlice = new Map();
  for (const h of hodnoty || []) podleKlice.set(`${h.siid}/${h.piid}`, h);

  r.push('', `Co jde číst (${spec.cteni.length}):`);
  for (const p of spec.cteni) {
    const h = podleKlice.get(`${p.siid}/${p.piid}`);
    const hodnota = !h ? '—'
      : h.code !== undefined && h.code !== 0 ? `(kód ${h.code})`
      : typeof h.value === 'object' ? JSON.stringify(h.value) : String(h.value);
    r.push(`  ${String(p.siid).padStart(2)}/${String(p.piid).padStart(2)}  ${`${p.sluzba}.${p.jmeno}`.padEnd(38)} ${hodnota}`);
  }

  r.push('', `Co jde spustit (${spec.povely.length}):`);
  for (const a of spec.povely) {
    r.push(`  ${String(a.siid).padStart(2)}/${String(a.aiid).padStart(2)}  ${`${a.sluzba}.${a.jmeno}`.padEnd(38)}${a.vstup.length ? ` vstup: ${a.vstup.join(', ')}` : ''}`);
  }
  return r;
}

// ---------- Hlavní ----------

async function hlavni(argv = process.argv.slice(2), cesta = KONFIG) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Ohmatávací skript pro vysavač Xiaomi. Nic nespíná, jen se ptá.\n\n  node ${SLOZKA}/vysavac-test.js          čitelný výpis\n  node ${SLOZKA}/vysavac-test.js --raw    uloží i celou specifikaci a hodnoty do souborů\n\nÚčet je v ${cesta}.`);
    return 0;
  }
  const syrove = argv.includes('--raw');
  const konfig = nactiKonfig(cesta);
  if (konfig.chyba) {
    console.log(konfig.chyba);
    return 1;
  }

  console.log('Vysavač Xiaomi — ohmatávací test\n');
  let prihlaseni;
  try {
    prihlaseni = await prihlas(konfig.nastaveni);
    console.log('Přihlášení: v pořádku');
  } catch (e) {
    console.log(`Přihlášení neprošlo: ${e.message}`);
    return 1;
  }

  let varianta, domacnosti;
  try {
    ({ varianta, domacnosti } = await najdiVariantu(prihlaseni, konfig.nastaveni.region));
    console.log(`Podpis: ${varianta === 'rc4' ? 'šifrovaný (rc4)' : 'prostý'}, server ${konfig.nastaveni.region}`);
  } catch (e) {
    console.log(`Do cloudu se nedostanu: ${e.message}`);
    return 1;
  }

  let seznam;
  try {
    seznam = await zarizeni(prihlaseni, konfig.nastaveni.region, varianta);
  } catch (e) {
    console.log(`Seznam zařízení se nenačetl: ${e.message}`);
    return 1;
  }
  const vysavac = seznam.find(jeVysavac);
  if (!vysavac) {
    console.log(`Na účtu je ${seznam.length} zařízení, ale žádný vysavač:\n  ${seznam.map(z => z.model).join('\n  ')}`);
    return 1;
  }

  let spec = { cteni: [], povely: [] };
  let celySpec = null;
  try {
    const urn = await najdiUrn(vysavac.model);
    celySpec = await nactiSpec(urn);
    spec = rozeberSpec(celySpec);
    console.log(`Specifikace: ${urn}`);
  } catch (e) {
    console.log(`Specifikace se nenačetla: ${e.message}`);
  }

  let hodnoty = [];
  if (spec.cteni.length) {
    try {
      hodnoty = await vlastnosti(prihlaseni, konfig.nastaveni.region, varianta, vysavac.did,
        spec.cteni.map(p => [p.siid, p.piid]));
    } catch (e) {
      console.log(`Hodnoty se nenačetly: ${e.message}`);
    }
  }

  console.log('');
  console.log(radkyVypisu(vysavac, mistnostiZDomacnosti(domacnosti), spec, hodnoty).join('\n'));

  const hello = await miioHello(vysavac.localip);
  console.log('', `Po domácí síti: ${hello.ok ? 'ozval se — půjde ovládat bez cloudu' : `neozval se (${hello.duvod})`}`);

  if (syrove) {
    const slozka = path.dirname(cesta);
    if (celySpec) {
      const soubor = path.join(slozka, `spec-${vysavac.model}.json`);
      fs.writeFileSync(soubor, JSON.stringify(celySpec, null, 2) + '\n');
      console.log(`  specifikace uložena do ${soubor}`);
    }
    const soubor = path.join(slozka, `hodnoty-${vysavac.model}.json`);
    fs.writeFileSync(soubor, JSON.stringify({ hodnoty, mistnosti: mistnostiZDomacnosti(domacnosti) }, null, 2) + '\n');
    console.log(`  hodnoty uloženy do ${soubor}`);
  }
  return 0;
}

if (require.main === module) {
  hlavni().then(kod => process.exit(kod)).catch(e => {
    console.log(`Nečekaná potíž: ${e.message}`);
    process.exit(1);
  });
}

module.exports = {
  md5, odbal, rc4, rc4Drop1024, nonce, podepsanyNonce, podpisProsty, podpisSifrovany,
  zasifrujParametry, desifrujOdpoved, adresaSluzby, overeniPotreba, prihlas, dotaz,
  najdiVariantu, zarizeni, vlastnosti, najdiUrn, nactiSpec, rozeberSpec, kratkyNazev,
  jeVysavac, mistnostiZDomacnosti, zkratToken, miioHello, nactiKonfig, radkyVypisu, hlavni,
  BALAST, REGION_VYCHOZI
};
