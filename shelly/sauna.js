// Sauna → okamžité vypnutí bazénu a solinátoru
// ------------------------------------------------------------------
// Běží PŘÍMO v Shelly 3EM-63 Gen3 za jističem sauny (Scripts → Add script).
// Jakmile odběr sauny přeskočí práh, letí oběma relé povel OFF po místní síti —
// do vteřiny a bez cloudu. Reaguje na nové měření, jak dorazí (status handler);
// časovač je jen záloha. Zpátky nic nezapíná: to je věc appky, která obě relé
// drží vypnuté ještě BLOKACE_MIN po posledním nátopu.
//
// Pořadí je schválně takové: nejdřív lokální OFF, teprve pak zpráva na Render.
// Jistič nesmí čekat na internet.

// ---- nastavení ----------------------------------------------------

// Nad tímhle odběrem se bere, že sauna topí. MUSÍ SEDĚT s prahem v appce
// (stránka Logika automatiky) — appka o téhle hodnotě neví, mění se na obou místech.
let PRAH_W = 500;

// Jak dlouho po posledním odběru nad prahem držet relé dole. Appka má vlastní,
// stejně dlouhou blokaci; tahle je pojistka pro případ, že by appka nejela.
let BLOKACE_MIN = 30;

// Pomalá záložní kontrola. Na první reakci nemá vliv (tu dělá status handler),
// jen prodlužuje blokaci, drží relé dole a zkouší znovu doručit zprávu appce.
let KONTROLA_S = 30;

// Appka na Renderu. Blokace na serveru díky tomu naskočí ve stejnou vteřinu
// a appka relé nezapne dřív, než si sama sáhne na měřák (až 2 min).
let APPKA = 'https://solax-pretok.onrender.com';
let APP_ENDPOINT = '/api/sauna/active';

// Relé k vypnutí. Gen3 (i Gen2/Plus/Pro) poslouchá na /rpc/Switch.Set.
// V routeru jim dej pevnou adresu, ať se IP nezmění.
let RELE = [
  { jmeno: 'BAZEN', ip: '192.168.188.131' },
  { jmeno: 'SOLINATOR', ip: '192.168.188.171' }
];

// ---- konec nastavení ----------------------------------------------

let posledniNadPrahem = 0;   // kdy naposledy byl odběr nad prahem
let blokaceAktivni = false;  // sauna topí (nebo dobíhá blokace)
let renderInformovan = false; // zpráva pro appku už prošla

function vypniRele(r) {
  let url = 'http://' + r.ip + '/rpc/Switch.Set?id=0&on=false';
  Shelly.call('HTTP.GET', { url: url, timeout: 3 }, function (res, err) {
    if (err) {
      print('CHYBA OFF ' + r.jmeno + ': ' + JSON.stringify(err));
    } else {
      print('OFF → ' + r.jmeno);
    }
  });
}

// Oba povely se odešlou hned za sebou, nečeká se na dokončení prvního
function vypniVse() {
  for (let i = 0; i < RELE.length; i++) {
    vypniRele(RELE[i]);
  }
}

// POZOR: tohle volá JEN pomalý časovač (a jednou start topení). Ze status
// handleru se to volat nesmí — 3EM hlásí změnu výkonu klidně několikrát za
// vteřinu, a kdyby byl Render nedostupný, `renderInformovan` by zůstalo false
// a skript by na něj pálil dotaz při každém hlášení. Takhle se to zkusí
// nejvýš jednou za KONTROLA_S.
function informujRender() {
  if (APPKA === '') return;
  if (renderInformovan) return;

  Shelly.call('HTTP.POST', { url: APPKA + APP_ENDPOINT, body: '{}', timeout: 5 },
    function (res, err) {
      if (err) {
        print('RENDER CHYBA: ' + JSON.stringify(err) + ' (zkusím za ' + KONTROLA_S + ' s)');
        return;
      }
      renderInformovan = true;
      print('RENDER INFORMOVÁN O SAUNĚ');
    });
}

// 3EM hlásí součet i jednotlivé fáze — bereme součet, fáze jsou záloha
function ziskejVykon(em) {
  if (!em) return null;
  if (typeof em.total_act_power === 'number') return em.total_act_power;

  let vykon = 0;
  if (typeof em.a_act_power === 'number') vykon += em.a_act_power;
  if (typeof em.b_act_power === 'number') vykon += em.b_act_power;
  if (typeof em.c_act_power === 'number') vykon += em.c_act_power;
  return vykon;
}

function aktualniVykon() {
  return ziskejVykon(Shelly.getComponentStatus('em:0'));
}

function aktivujSaunu(w) {
  posledniNadPrahem = Date.now();

  // Sauna už topí — jen jsme si poznamenali čas. Zprávu pro appku zkusí
  // znovu časovač, tady by se z ní stala salva dotazů.
  if (blokaceAktivni) return;

  blokaceAktivni = true;
  renderInformovan = false;

  print('');
  print('================================');
  print('SAUNA AKTIVNÍ — ' + JSON.stringify(Math.round(w)) + ' W');
  print('VYPÍNÁM BAZÉN A SOLINÁTOR');
  print('================================');

  vypniVse();        // nejdřív jistič
  informujRender();  // a teprve pak internet
}

function zpracujVykon(w) {
  if (w === null) return;
  if (w > PRAH_W) aktivujSaunu(w);
}

// ---- rychlá detekce -----------------------------------------------
// Tudy jde první reakce: žádný časovač, žádné čekání. Jakmile měřák hlásí
// nový odběr, hned se vyhodnotí.
Shelly.addStatusHandler(function (e) {
  if (!e) return;
  if (e.component !== 'em:0') return;
  zpracujVykon(aktualniVykon());
});

// ---- pomalá záloha -------------------------------------------------
// Drží relé dole po celou blokaci, prodlužuje ji a dotahuje zprávu pro appku.
Timer.set(KONTROLA_S * 1000, true, function () {
  let w = aktualniVykon();
  if (w === null) return;

  if (w > PRAH_W) {
    posledniNadPrahem = Date.now();
    vypniVse();
    informujRender();   // jediné místo, odkud se to opakuje
    return;
  }

  if (!blokaceAktivni) return;

  if (Date.now() - posledniNadPrahem < BLOKACE_MIN * 60 * 1000) {
    vypniVse();         // sauna dotopila, ale blokace ještě běží
    return;
  }

  blokaceAktivni = false;
  renderInformovan = false;
  print('BLOKACE PO SAUNĚ SKONČILA (' + BLOKACE_MIN + ' min od posledního nátopu)');
});

// Kdyby se skript restartoval během topení, ať se reaguje hned
zpracujVykon(aktualniVykon());

print('');
print('================================');
print('SAUNA OCHRANA SPUŠTĚNA');
print('Práh: ' + PRAH_W + ' W · blokace: ' + BLOKACE_MIN + ' min · záloha: ' + KONTROLA_S + ' s');
print('Bazén: ' + RELE[0].ip + ' · Solinátor: ' + RELE[1].ip);
print('Appka: ' + APPKA);
print('================================');
