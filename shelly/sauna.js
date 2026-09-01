// Sauna → okamžité vypnutí bazénu a solinátoru
// ------------------------------------------------------------------
// Běží PŘÍMO v Shelly 3EM-63T Gen3 za jističem sauny (Scripts → Add script).
// Jakmile odběr sauny přeskočí práh, letí oběma relé povel OFF po místní síti —
// do sekundy a bez cloudu. Reaguje na nové měření, jak dorazí (status handler),
// časovač je jen záloha. Zpátky nic nezapíná: to je věc appky, která obě relé
// drží vypnuté ještě 30 min po posledním nátopu.

// ---- nastavení ----------------------------------------------------
let PRAH_W = 500;          // stejná hodnota jako práh sauny v appce (mění se na obou místech!)
let ZALOHA_S = 5;          // jak často se pro jistotu kouká na odběr sám
let ZNOVU_S = 60;          // dokud sauna topí, povel se zopakuje nejvýš takhle často

// Relé bazénu a solinátoru. Doplň jejich IP (v routeru jim dej pevnou adresu!)
// a generaci: Gen2/Gen3 (Plus/Pro) = 2, staré Gen1 = 1.
let RELE = [
  { jmeno: 'bazen', ip: '192.168.1.101', gen: 2 },
  { jmeno: 'solinator', ip: '192.168.1.102', gen: 2 }
];

// Adresa appky — doporučeno vyplnit. Blokace na serveru pak naskočí ve stejnou
// vteřinu a appka relé nezapne dřív, než si sama sáhne na měřák (až 2 min).
let APPKA = '';   // např. 'https://tvoje-appka.onrender.com'

// ---- kód ----------------------------------------------------------
let topi = false;          // překročili jsme práh a ještě jsme nespadli pod něj
let odPovelu = ZNOVU_S;    // vteřin od posledního odeslání

function vypni(r) {
  let url = r.gen >= 2
    ? 'http://' + r.ip + '/rpc/Switch.Set?id=0&on=false'
    : 'http://' + r.ip + '/relay/0?turn=off';
  Shelly.call('HTTP.GET', { url: url, timeout: 5 }, function (res, err) {
    print('sauna → ' + r.jmeno + ': ' + (err ? 'chyba ' + err : 'vypnuto'));
  });
}

function posli(w) {
  odPovelu = 0;
  print('sauna topí (' + JSON.stringify(Math.round(w)) + ' W) → vypínám bazén a solinátor');
  for (let i = 0; i < RELE.length; i++) vypni(RELE[i]);
  if (APPKA !== '') {
    Shelly.call('HTTP.POST', { url: APPKA + '/api/sauna/active', body: '{}', timeout: 5 });
  }
}

// Z měření (nebo z celého stavu) vytáhne činný výkon všech fází
function vykon(em) {
  if (!em) return null;
  if (typeof em.total_act_power === 'number') return em.total_act_power;
  let a = em.a_act_power, b = em.b_act_power, c = em.c_act_power;
  if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') return a + b + c;
  return null;
}

function zvaz(w) {
  if (w === null) return;
  if (w <= PRAH_W) { topi = false; odPovelu = ZNOVU_S; return; }  // pod prahem → příště hned
  if (!topi || odPovelu >= ZNOVU_S) posli(w);
  topi = true;
}

// Hlavní cesta: měřák hlásí nové měření zhruba jednou za sekundu
Shelly.addStatusHandler(function (e) {
  if (!e || e.component !== 'em:0') return;
  zvaz(vykon(e.delta));
});

// Záloha, kdyby notifikace nedorazila (a odpočet pro opakování povelu)
Timer.set(ZALOHA_S * 1000, true, function () {
  odPovelu = odPovelu + ZALOHA_S;
  zvaz(vykon(Shelly.getComponentStatus('em:0')));
});

zvaz(vykon(Shelly.getComponentStatus('em:0')));
