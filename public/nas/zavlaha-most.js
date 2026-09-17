#!/usr/bin/env node
// Most mezi appkou a závlahou Rain Bird — běží trvale na NASu.
//
// Ovladač ESP-TM2 mluví jen po domácí síti, appka běží na Renderu. Most je
// jediný, kdo vidí na obojí. Spojení navazuje VŽDYCKY on sám směrem ven:
// do domácí sítě se nic neotevírá a heslo k závlaze nikam neodchází.
//
// Jedno kolo: přečti stav modulu → pošli ho appce → odvez si, co se má udělat →
// udělej to → přečti stav znovu, ať to appka hned vidí. Když modul neodpoví,
// most appce NIC nepošle — ta si po třech minutách ticha sama řekne, že
// je odpojený. Lhát starým stavem je horší než přiznat, že se neví.
//
// Vedle musí ležet zavlaha-test.js (je v něm šifrování a čtení odpovědí).
// Stáhnou se oba:
//   curl -o /volume1/family/scripts/zavlaha/zavlaha-test.js https://solax-pretok.onrender.com/nas/zavlaha-test.js
//   curl -o /volume1/family/scripts/zavlaha/zavlaha-most.js https://solax-pretok.onrender.com/nas/zavlaha-most.js
//
// Spouští se bez argumentů a už se nezastaví:
//   node /volume1/family/scripts/zavlaha/zavlaha-most.js
//
// Nastavení je ve stejném zavlaha.config.json jako u zavlaha-test.js.

const fs = require('node:fs');
const path = require('node:path');

const SLOZKA = '/volume1/family/scripts/zavlaha';
const KONFIG = path.join(__dirname, 'zavlaha.config.json');
const APPKA_VYCHOZI = 'https://solax-pretok.onrender.com';
const INTERVAL_S = 15;          // jak často se čte modul a hlásí appce
const INTERVAL_MIN_S = 5;
const INTERVAL_MAX_S = 300;
const APPKA_CEKANI_MS = 30000;  // Render po nečinnosti startuje i půl minuty
const PAUZA_PO_CHYBE_S = 30;    // po výpadku se nezkouší hned, ať to nebubnuje
const ZON_MAX = 32;
const MINUT_MAX = 120;

let Z;
try {
  Z = require('./zavlaha-test.js');
} catch {
  console.error(`Chybí zavlaha-test.js vedle tohohle skriptu (${__dirname}).\nStáhni ho:\n  curl -o ${SLOZKA}/zavlaha-test.js ${APPKA_VYCHOZI}/nas/zavlaha-test.js`);
  process.exit(1);
}

// ---------- Povely, které něco spínají ----------

// V zavlaha-test.js schválně nejsou — ten se jen ptá. Tady jsou, protože tohle
// je ta část, která smí sáhnout na ventily.
//   39 = pusť zónu (4 bajty: povel, číslo zóny na dva bajty, minuty)
//   40 = zastav všechno (1 bajt)
// Na obojí modul odpovídá potvrzením 01.
function hex(cislo, znaku) {
  return Number(cislo).toString(16).toUpperCase().padStart(znaku, '0');
}

function povelSpust(zona, minut) {
  return { data: '39' + hex(zona, 4) + hex(minut, 2), delka: 4, odpoved: '01' };
}

function povelStop() {
  return { data: '40', delka: 1, odpoved: '01' };
}

// ---------- Čtení stavu ----------

// Model a seznam zón se nemění, tak se čtou jen jednou. Po výpadku se paměť
// zahodí — modul se mohl mezitím restartovat s jinou konfigurací.
async function zjistiStav(nastaveni, pamet) {
  if (!pamet.model) {
    const m = await Z.povel(nastaveni, 'model');
    pamet.model = Z.jmenoModelu(hex(m.hodnoty.model, 4));
    await Z.pauza(300);
    const z = await Z.povel(nastaveni, 'zony');
    pamet.zony = Z.zonyZMasky(z.hodnoty.maska);
    await Z.pauza(300);
  }
  const bezi = await Z.povel(nastaveni, 'bezi');
  await Z.pauza(300);
  const stav = await Z.povel(nastaveni, 'stav');
  await Z.pauza(300);
  const destak = await Z.povel(nastaveni, 'destak');
  await Z.pauza(300);
  const odklad = await Z.povel(nastaveni, 'odklad');
  return {
    model: pamet.model,
    zony: pamet.zony,
    bezi: Z.zonyZMasky(bezi.hodnoty.maska),
    zavlazuje: !!stav.hodnoty.zavlazuje,
    destak: !!destak.hodnoty.cidlo,
    odklad: odklad.hodnoty.dnu
  };
}

// ---------- Hlášení appce ----------

async function ohlas(nastaveni, stav) {
  const res = await fetch(`${nastaveni.appka}/api/zavlaha/stav`, {
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

// Appce se věří jen potud, pokud povel dává smysl. Kdyby se do fronty dostal
// nesmysl, nemá se zónám co stát — most ho zahodí a řekne to.
function zkontroluj(u) {
  if (!u || typeof u !== 'object') return 'úkol není objekt';
  if (u.typ === 'stop') return '';
  if (u.typ !== 'spust') return `neznámý úkol ${JSON.stringify(u.typ)}`;
  const zona = Number(u.zona), minut = Number(u.minut);
  if (!Number.isInteger(zona) || zona < 1 || zona > ZON_MAX) return `zóna mimo rozsah: ${u.zona}`;
  if (!Number.isInteger(minut) || minut < 1 || minut > MINUT_MAX) return `minuty mimo rozsah: ${u.minut}`;
  return '';
}

async function proved(nastaveni, u, pis = zapis) {
  const potiz = zkontroluj(u);
  if (potiz) {
    pis(`úkol zahozen — ${potiz}`);
    return false;
  }
  if (u.typ === 'stop') {
    await Z.povelSip(nastaveni, povelStop());
    pis('zastaveno všechno');
    return true;
  }
  await Z.povelSip(nastaveni, povelSpust(u.zona, u.minut));
  pis(`zóna ${u.zona} puštěná na ${u.minut} min`);
  return true;
}

// ---------- Kolo ----------

function zapis(text) {
  const ted = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`${ted}  ${text}`);
}

async function kolo(nastaveni, pamet, pis = zapis) {
  let stav;
  try {
    stav = await zjistiStav(nastaveni, pamet);
  } catch (e) {
    pamet.model = null;
    pis(`modul neodpověděl: ${e.message}`);
    return false;
  }
  let ukoly;
  try {
    ukoly = await ohlas(nastaveni, stav);
  } catch (e) {
    pis(`appka se neozvala: ${e.message}`);
    return false;
  }
  if (!ukoly.length) return true;

  let hotovo = 0;
  for (const u of ukoly) {
    try {
      if (await proved(nastaveni, u, pis)) hotovo++;
      await Z.pauza(300);
    } catch (e) {
      pis(`úkol se nepovedl: ${e.message}`);
    }
  }
  // Po zásahu se stav přečte hned znovu, ať appka nečeká na další kolo
  if (hotovo) {
    try {
      await ohlas(nastaveni, await zjistiStav(nastaveni, pamet));
    } catch (e) {
      pis(`stav po povelu se nepodařilo poslat: ${e.message}`);
    }
  }
  return true;
}

// ---------- Nastavení ----------

function nactiNastaveni(cesta = KONFIG) {
  const konfig = Z.nactiKonfig(cesta, 'zavlaha-most.js');
  if (konfig.chyba) return konfig;
  const data = JSON.parse(fs.readFileSync(cesta, 'utf8'));
  const appka = String(data.appka || APPKA_VYCHOZI).trim().replace(/\/+$/, '');
  const zadany = Number(data.interval);
  const interval = Number.isFinite(zadany) && zadany >= INTERVAL_MIN_S && zadany <= INTERVAL_MAX_S
    ? Math.round(zadany) : INTERVAL_S;
  return { nastaveni: { ...konfig.nastaveni, appka, interval } };
}

async function hlavni(cesta = KONFIG, pis = zapis) {
  const konfig = nactiNastaveni(cesta);
  if (konfig.chyba) {
    pis(konfig.chyba);
    return 1;
  }
  const nastaveni = konfig.nastaveni;
  pis(`most spuštěn — modul ${nastaveni.ip}, appka ${nastaveni.appka}, kolo po ${nastaveni.interval} s`);

  const pamet = { model: null, zony: [] };
  let bezelo = false;
  // Nekonečno: most se nemá kdy zastavit. Spadlé kolo jen počká déle.
  for (;;) {
    const ok = await kolo(nastaveni, pamet, pis).catch(e => {
      pis(`kolo spadlo: ${e.message}`);
      return false;
    });
    if (ok && !bezelo) pis('spojení s modulem i appkou funguje');
    bezelo = ok;
    await Z.pauza((ok ? nastaveni.interval : PAUZA_PO_CHYBE_S) * 1000);
  }
}

if (require.main === module) {
  hlavni().then(kod => { process.exitCode = kod; }).catch(e => {
    console.error(`Most spadl: ${e.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  SLOZKA, KONFIG, APPKA_VYCHOZI, INTERVAL_S, INTERVAL_MIN_S, INTERVAL_MAX_S,
  ZON_MAX, MINUT_MAX, PAUZA_PO_CHYBE_S,
  hex, povelSpust, povelStop, zkontroluj, proved,
  zjistiStav, ohlas, kolo, nactiNastaveni, hlavni
};
