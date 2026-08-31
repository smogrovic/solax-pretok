// Sauna → okamžité vypnutí bazénu a solinátoru
// ------------------------------------------------------------------
// Běží PŘÍMO v Shelly 3EM-63T Gen3 za jističem sauny (Scripts → Add script).
// Jakmile odběr sauny přeskočí práh, pošle oběma relé povel OFF po místní síti —
// tedy do vteřiny a bez cloudu. Appka dělá to samé, ale až v dvouminutovém cyklu,
// takže tohle je rychlá pojistka jističe. Zpátky nic nezapíná: to je věc appky,
// která obě relé drží vypnuté ještě 30 min po dotopení.

// ---- nastavení ----------------------------------------------------
let PRAH_W = 500;          // stejná hodnota jako SAUNA_ON_W v appce
let INTERVAL_S = 5;        // jak často se kouká na odběr
let ZNOVU_TIKU = 12;       // dokud sauna topí, povel se zopakuje po 12 ticích (1 min)

// Relé bazénu a solinátoru. Doplň jejich IP (v routeru jim dej pevnou adresu!)
// a generaci: Gen2/Gen3 (Plus/Pro) = 2, staré Gen1 = 1.
let RELE = [
  { jmeno: 'bazen', ip: '192.168.1.101', gen: 2 },
  { jmeno: 'solinator', ip: '192.168.1.102', gen: 2 }
];

// Volitelně: adresa appky. Když ji vyplníš, blokace na serveru naskočí hned
// a nečeká se na poller. Nech prázdné, pokud to nechceš.
let APPKA = '';   // např. 'https://tvoje-appka.onrender.com'

// ---- kód ----------------------------------------------------------
let tiky = ZNOVU_TIKU;     // ať se první nátop pošle hned

function vypni(r) {
  let url = r.gen >= 2
    ? 'http://' + r.ip + '/rpc/Switch.Set?id=0&on=false'
    : 'http://' + r.ip + '/relay/0?turn=off';
  Shelly.call('HTTP.GET', { url: url, timeout: 5 }, function (res, err) {
    print('sauna → ' + r.jmeno + ': ' + (err ? 'chyba ' + err : 'vypnuto'));
  });
}

function odber() {
  let em = Shelly.getComponentStatus('em:0');
  if (!em) return null;
  if (typeof em.total_act_power === 'number') return em.total_act_power;
  // Kdyby firmware součet nehlásil, sečteme fáze sami
  let a = em.a_act_power, b = em.b_act_power, c = em.c_act_power;
  if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') return a + b + c;
  return null;
}

function kontrola() {
  let w = odber();
  if (w === null) return;
  if (w <= PRAH_W) { tiky = ZNOVU_TIKU; return; }   // netopí → povel se pošle hned při náběhu
  tiky = tiky + 1;
  if (tiky < ZNOVU_TIKU) return;
  tiky = 0;
  print('sauna topí (' + JSON.stringify(Math.round(w)) + ' W) → vypínám bazén a solinátor');
  for (let i = 0; i < RELE.length; i++) vypni(RELE[i]);
  if (APPKA !== '') {
    Shelly.call('HTTP.POST', { url: APPKA + '/api/sauna/active', body: '{}', timeout: 5 });
  }
}

Timer.set(INTERVAL_S * 1000, true, kontrola);
kontrola();
