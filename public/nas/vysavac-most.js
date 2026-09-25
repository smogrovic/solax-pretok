#!/usr/bin/env node
// Most mezi appkou a vysavačem Xiaomi — běží trvale na NASu.
//
// X20+ jde ovládat jen přes cloud Xiaomi (po domácí síti se neozval) a přihlásit
// se do cloudu z Renderu nejde: Xiaomi na datové centrum hází captchu nebo SMS.
// Proto se přihlašuje tady doma a appka dostává jen stav. Spojení navazuje
// VŽDYCKY most sám směrem ven, do domácí sítě se nic neotevírá.
//
// Jedno kolo: přečti stav z cloudu → pošli ho appce → odvez si, co se má udělat →
// udělej to → přečti stav znovu, ať to appka hned vidí.
//
// Vedle musí ležet vysavac-test.js (je v něm přihlášení a podpisy). Stáhnou se oba:
//   curl -o /volume1/family/scripts/vysavac/vysavac-test.js https://solax-pretok.onrender.com/nas/vysavac-test.js
//   curl -o /volume1/family/scripts/vysavac/vysavac-most.js https://solax-pretok.onrender.com/nas/vysavac-most.js
//
// Jednou přihlásit (QR kódem v Mi Home, v terminálu přes SSH):
//   node /volume1/family/scripts/vysavac/vysavac-most.js --prihlas
// Pak spouštět bez argumentů, už se nezastaví:
//   node /volume1/family/scripts/vysavac/vysavac-most.js
//
// Přihlášení se uloží do vysavac.relace.json vedle skriptu. Je to klíč k účtu
// Xiaomi — zůstává na NASu, čitelný jen pro roota, do chatu ani do repozitáře
// nepatří. Když ho Xiaomi časem přestane brát, most to řekne appce a stačí
// zopakovat --prihlas.

const fs = require('node:fs');
const path = require('node:path');

const SLOZKA = '/volume1/family/scripts/vysavac';
const KONFIG = path.join(__dirname, 'vysavac.config.json');
const RELACE = path.join(__dirname, 'vysavac.relace.json');
const APPKA_VYCHOZI = 'https://solax-pretok.onrender.com';
const INTERVAL_S = 30;           // jak často se čte cloud a hlásí appce
const INTERVAL_MIN_S = 15;
const INTERVAL_MAX_S = 300;
const APPKA_CEKANI_MS = 30000;   // Render po nečinnosti startuje i půl minuty
const PAUZA_PO_CHYBE_S = 60;

let V;
try {
  V = require('./vysavac-test.js');
} catch {
  console.error(`Chybí vysavac-test.js vedle tohohle skriptu (${__dirname}).\nStáhni ho:\n  curl -o ${SLOZKA}/vysavac-test.js ${APPKA_VYCHOZI}/nas/vysavac-test.js`);
  process.exit(1);
}

// ---------- Co se čte a co se spouští (xiaomi.vacuum.c102gl, z výpisu vysavac-test.js) ----------

const CTENI = {
  status: [2, 1],     // vacuum.status
  porucha: [2, 2],    // vacuum.fault
  baterie: [3, 1],    // battery.battery-level
  nabiji: [3, 2],     // battery.charging-state
  uklidMin: [4, 2],   // vacuum-extend.cleaning-time
  uklidM2: [4, 3],    // vacuum-extend.cleaning-area
  uloha: [4, 7],      // vacuum-extend.task-status
  kartac: [9, 2],     // brush-cleaner.brush-life-level
  filtr: [11, 1],     // filter.filter-life-level
  mop: [18, 1]        // mop.mop-life-level
};

// Jen tohle smí most spustit. Úklid vybraných místností tu schválně NENÍ:
// vysavač čísluje místnosti po svém (v časovačích jsou malá čísla), ne čísly
// místností z Mi Home, a jejich jména zatím neznáme.
const AKCE = {
  uklid: { siid: 2, aiid: 1 },   // vacuum.start-sweep
  stop: { siid: 2, aiid: 2 },    // vacuum.stop-sweeping
  dok: { siid: 3, aiid: 1 }      // battery.start-charge
};

// ---------- Relace ----------

function ulozRelaci(relace, cesta = RELACE) {
  fs.writeFileSync(cesta, JSON.stringify(relace, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(cesta, 0o600); } catch {}
}

function nactiRelaci(cesta = RELACE) {
  try {
    const r = JSON.parse(fs.readFileSync(cesta, 'utf8'));
    if (r && r.ssecurity && r.serviceToken && r.did) return r;
  } catch {}
  return null;
}

// Cloud odmítl přihlášení (vypršelo, odhlášeno v Mi Home) — ne výpadek sítě
function jeVyprseni(chyba) {
  const t = String(chyba && chyba.message || chyba || '');
  return /HTTP 401|HTTP 403|auth|token|kód 3[,)]|kód -?401/i.test(t);
}

async function prihlasANajdi(nastaveni, pis = zapis, prihlasQr = V.prihlasQr) {
  const prihlaseni = await prihlasQr(nastaveni, { vypis: pis });
  const { varianta } = await V.najdiVariantu(prihlaseni, nastaveni.region);
  const seznam = await V.zarizeni(prihlaseni, nastaveni.region, varianta);
  const vysavac = seznam.find(V.jeVysavac);
  if (!vysavac) throw new Error(`na účtu není žádný vysavač (${seznam.length} zařízení)`);
  return {
    ssecurity: prihlaseni.ssecurity, serviceToken: prihlaseni.serviceToken,
    userId: prihlaseni.userId, cUserId: prihlaseni.cUserId,
    region: nastaveni.region, varianta, did: String(vysavac.did), model: vysavac.model,
    jmeno: vysavac.name || '', ulozeno: new Date().toISOString()
  };
}

// ---------- Popisy ze specifikace ----------

// Čísla stavů mají v miot-spec popisy (value-list). Natvrdo se nepíšou —
// u jiné verze firmwaru by lhaly.
function popisZeSpec(spec, siid, piid, hodnota) {
  const sluzba = ((spec && spec.services) || []).find(s => s.iid === siid);
  const vlastnost = sluzba && (sluzba.properties || []).find(p => p.iid === piid);
  const seznam = vlastnost && vlastnost['value-list'];
  const shoda = Array.isArray(seznam) ? seznam.find(v => v.value === hodnota) : null;
  return shoda ? String(shoda.description || '').trim() || null : null;
}

// ---------- Stav ----------

function prectiHodnoty(hodnoty) {
  const podle = new Map();
  for (const h of hodnoty || []) {
    if (h && (h.code === undefined || h.code === 0)) podle.set(`${h.siid}/${h.piid}`, h.value);
  }
  const vezmi = klic => podle.get(CTENI[klic].join('/'));
  return vezmi;
}

async function zjistiStav(relace, pamet) {
  if (!pamet.spec && !pamet.specZkouseno) {
    pamet.specZkouseno = true;
    try { pamet.spec = await V.nactiSpec(await V.najdiUrn(relace.model)); } catch { pamet.spec = null; }
  }
  const hodnoty = await V.vlastnosti(relace, relace.region, relace.varianta, relace.did, Object.values(CTENI));
  const vezmi = prectiHodnoty(hodnoty);
  const cislo = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const dvojice = klic => {
    const kod = cislo(vezmi(klic));
    const [siid, piid] = CTENI[klic];
    return { kod, popis: kod === null ? null : popisZeSpec(pamet.spec, siid, piid, kod) };
  };
  const nabiji = vezmi('nabiji');
  return {
    status: dvojice('status'),
    porucha: dvojice('porucha'),
    uloha: dvojice('uloha'),
    baterie: cislo(vezmi('baterie')),
    // charging-state: 1 = nabíjí se, 0/2 = ne (u Xiaomi „not charging" / „no charge")
    nabiji: typeof nabiji === 'number' ? nabiji === 1 : null,
    uklidMin: cislo(vezmi('uklidMin')),
    uklidM2: cislo(vezmi('uklidM2')),
    kartac: cislo(vezmi('kartac')),
    filtr: cislo(vezmi('filtr')),
    mop: cislo(vezmi('mop')),
    mistnosti: [],
    posledniPovel: pamet.posledniPovel || null,
    relaceVyprsela: false,
    chyba: null
  };
}

// ---------- Hlášení appce ----------

async function ohlas(nastaveni, stav) {
  const res = await fetch(`${nastaveni.appka}/api/vysavac/stav`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stav),
    signal: AbortSignal.timeout(APPKA_CEKANI_MS)
  });
  if (!res.ok) throw new Error(`appka odpověděla HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.ukoly) ? data.ukoly : [];
}

// ---------- Vykonání úkolu ----------

// Appce se věří jen potud, pokud povel dává smysl. Cokoli jiného se zahodí.
function zkontroluj(u) {
  if (!u || typeof u !== 'object') return 'úkol není objekt';
  if (!Object.prototype.hasOwnProperty.call(AKCE, u.typ)) return `neznámý úkol ${JSON.stringify(u.typ)}`;
  return '';
}

async function proved(relace, u, pamet, pis = zapis) {
  const potiz = zkontroluj(u);
  if (potiz) {
    pis(`úkol zahozen — ${potiz}`);
    return false;
  }
  const a = AKCE[u.typ];
  try {
    const out = await V.dotaz(relace, relace.region, '/miotspec/action',
      { params: { did: relace.did, siid: a.siid, aiid: a.aiid, in: [] } },
      relace.varianta === 'rc4' ? 'rc4' : null);
    const kod = out && typeof out.code === 'number' ? out.code : 0;
    if (kod !== 0) throw new Error(`vysavač odmítl (kód ${kod})`);
    pamet.posledniPovel = { typ: u.typ, ok: true, zprava: null };
    pis(`${u.typ}: provedeno`);
    return true;
  } catch (e) {
    pamet.posledniPovel = { typ: u.typ, ok: false, zprava: e.message.slice(0, 280) };
    pis(`${u.typ}: nepovedlo se — ${e.message}`);
    if (jeVyprseni(e)) pamet.vyprselo = true;
    return false;
  }
}

// ---------- Kolo ----------

function zapis(text) {
  const ted = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`${ted}  ${text}`);
}

// Stav, když se z cloudu nic přečíst nedá — appka se to má dozvědět, ne tápat
function stavBezDat(chyba, vyprselo) {
  return { relaceVyprsela: !!vyprselo, chyba: String(chyba || '').slice(0, 190), mistnosti: [] };
}

async function kolo(nastaveni, pamet, pis = zapis, cestaRelace = RELACE) {
  const relace = pamet.relace || (pamet.relace = nactiRelaci(cestaRelace));
  let stav;
  if (!relace) {
    stav = stavBezDat('Most není přihlášený — na NASu spusť vysavac-most.js --prihlas', true);
  } else if (pamet.vyprselo) {
    stav = stavBezDat('Přihlášení vypršelo — na NASu spusť vysavac-most.js --prihlas', true);
  } else {
    try {
      stav = await zjistiStav(relace, pamet);
    } catch (e) {
      const vyprselo = jeVyprseni(e);
      if (vyprselo) pamet.vyprselo = true;
      pis(`cloud Xiaomi neodpověděl: ${e.message}`);
      stav = stavBezDat(vyprselo ? 'Přihlášení vypršelo — na NASu spusť vysavac-most.js --prihlas' : e.message, vyprselo);
    }
  }
  let ukoly;
  try {
    ukoly = await ohlas(nastaveni, stav);
  } catch (e) {
    pis(`appka se neozvala: ${e.message}`);
    return false;
  }
  if (!ukoly.length || !relace || pamet.vyprselo) return true;

  for (const u of ukoly) await proved(relace, u, pamet, pis);
  // Po zásahu se stav přečte a pošle hned, ať appka nečeká na další kolo
  try {
    await ohlas(nastaveni, pamet.vyprselo
      ? stavBezDat('Přihlášení vypršelo — na NASu spusť vysavac-most.js --prihlas', true)
      : await zjistiStav(relace, pamet));
  } catch (e) {
    pis(`stav po povelu se nepodařilo poslat: ${e.message}`);
  }
  return true;
}

// ---------- Nastavení ----------

function nactiNastaveni(cesta = KONFIG) {
  const konfig = V.nactiKonfig(cesta, 'vysavac-most.js', { qr: true });
  if (konfig.chyba) return konfig;
  const data = JSON.parse(fs.readFileSync(cesta, 'utf8'));
  const appka = String(data.appka || APPKA_VYCHOZI).trim().replace(/\/+$/, '');
  const zadany = Number(data.interval);
  const interval = Number.isFinite(zadany) && zadany >= INTERVAL_MIN_S && zadany <= INTERVAL_MAX_S
    ? Math.round(zadany) : INTERVAL_S;
  return { nastaveni: { ...konfig.nastaveni, appka, interval } };
}

const pauza = ms => new Promise(r => setTimeout(r, ms));

async function hlavni(argv = process.argv.slice(2), cesta = KONFIG, cestaRelace = RELACE, pis = zapis) {
  const konfig = nactiNastaveni(cesta);
  if (konfig.chyba) {
    pis(konfig.chyba);
    return 1;
  }
  const nastaveni = konfig.nastaveni;

  if (argv.includes('--prihlas')) {
    try {
      const relace = await prihlasANajdi(nastaveni, t => console.log(t));
      ulozRelaci(relace, cestaRelace);
      console.log(`\nPřihlášeno. Vysavač ${relace.jmeno || relace.model} (${relace.model}) — přihlášení uložené do ${cestaRelace}.`);
      console.log(`Teď most spusť bez argumentů:\n  node ${SLOZKA}/vysavac-most.js`);
      return 0;
    } catch (e) {
      console.log(`Přihlášení se nepovedlo: ${e.message}`);
      return 1;
    }
  }

  pis(`most spuštěn — appka ${nastaveni.appka}, kolo po ${nastaveni.interval} s`);
  const pamet = { relace: null, spec: null, specZkouseno: false, posledniPovel: null, vyprselo: false };
  let bezelo = false;
  // Nekonečno: most se nemá kdy zastavit. Spadlé kolo jen počká déle.
  for (;;) {
    // Po novém --prihlas (jiný proces) si most relaci načte znovu sám
    if (pamet.vyprselo) {
      const nova = nactiRelaci(cestaRelace);
      if (nova && pamet.relace && nova.ulozeno !== pamet.relace.ulozeno) {
        pamet.relace = nova;
        pamet.vyprselo = false;
        pis('načteno nové přihlášení');
      }
    }
    const ok = await kolo(nastaveni, pamet, pis, cestaRelace).catch(e => {
      pis(`kolo spadlo: ${e.message}`);
      return false;
    });
    if (ok && !bezelo) pis('spojení s cloudem Xiaomi i appkou funguje');
    bezelo = ok;
    await pauza((ok ? nastaveni.interval : PAUZA_PO_CHYBE_S) * 1000);
  }
}

if (require.main === module) {
  hlavni().then(kod => { process.exitCode = kod; }).catch(e => {
    console.error(`Most spadl: ${e.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  SLOZKA, KONFIG, RELACE, APPKA_VYCHOZI, INTERVAL_S, CTENI, AKCE,
  ulozRelaci, nactiRelaci, jeVyprseni, prihlasANajdi, popisZeSpec, zjistiStav,
  ohlas, zkontroluj, proved, kolo, nactiNastaveni, hlavni, stavBezDat
};
