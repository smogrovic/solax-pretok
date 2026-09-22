// PIN na přepnutí režimu appky (full / Miky / Elenka).
//
// Blok se zámkem v server.js dosud nehlídala ani jedna sada, přestože je v něm
// porovnávání kódu i počítadlo pokusů. Tahle ho zavádí.
//
// Co je tady podstatné:
//  * Kód se porovnává `safeEqual` — přes SHA256 a `timingSafeEqual`. Prosté
//    `===` by na délce řetězce prozradilo, jak daleko se hádající dostal.
//  * Prefix nesmí projít: „842" není „8423".
//  * Počítadlo pokusů je společné s odemykáním appky. Jeden rozpočet hádání
//    na IP — jinak by šlo střídat endpointy a hádat dvakrát tak rychle.
//
// Co tahle sada NEDĚLÁ: neudělá z dětského režimu zámek. Režim se drží
// v prohlížeči, takže kdo umí otevřít vývojářské nástroje, si ho přepíše i bez
// kódu. PIN je na to, aby se přepínač nedal odklepnout omylem.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('PIN režimu');

const CODE = between('// ---------- Zámek ovládání (PIN) ----------',
                     '// ---------- Push notifikace (plná baterie) ----------');

function build({ pin } = {}) {
  const puvodni = process.env.REZIM_PIN;
  if (pin === undefined) delete process.env.REZIM_PIN;
  else process.env.REZIM_PIN = pin;
  const routy = {};
  const api = new Function('app', 'crypto', 'process',
    CODE + '\n; return { REZIM_PIN, safeEqual, tooManyAttempts, registerFailedAttempt, unlockAttempts };'
  )(
    { post: (cesta, fn) => { routy['POST ' + cesta] = fn; },
      get: (cesta, fn) => { routy['GET ' + cesta] = fn; } },
    require('crypto'),
    process
  );
  if (puvodni === undefined) delete process.env.REZIM_PIN;
  else process.env.REZIM_PIN = puvodni;
  return { api, routy };
}

// Volání endpointu s vlastní IP, ať si sekce nešlapou po počítadle
const volej = (h, telo, ip = '10.0.0.1') => {
  let out = null, kod = 200;
  const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
  h.routy['POST /api/rezim/pin']({ body: telo, ip }, res);
  return { out, kod };
};

nadpis('1) Výchozí kód');
{
  const h = build();
  check('bez proměnné prostředí je 8423', h.api.REZIM_PIN, '8423');
  check('správný kód projde', volej(h, { pin: '8423' }).out.ok, true);
  check('  a vrátí 200', volej(h, { pin: '8423' }, '10.0.0.2').kod, 200);
}

nadpis('2) Špatný kód neprojde');
{
  const h = build();
  const spatny = volej(h, { pin: '1111' }, '10.0.1.1');
  check('vrátí 401', spatny.kod, 401);
  check('  a řekne se proč', spatny.out.error, 'Nesprávný kód.');
  // Ten kód v odpovědi nesmí být ani náhodou — z chybové hlášky by se dal číst
  check('  ale kód v odpovědi není', JSON.stringify(spatny.out).includes('8423'), false);

  check('prefix neprojde', volej(h, { pin: '842' }, '10.0.1.2').kod, 401);
  check('  ani delší', volej(h, { pin: '84230' }, '10.0.1.3').kod, 401);
  check('prázdný kód neprojde', volej(h, { pin: '' }, '10.0.1.4').kod, 401);
  check('chybějící kód neprojde', volej(h, {}, '10.0.1.5').kod, 401);
  check('nesmyslné tělo nespadne', volej(h, null, '10.0.1.6').kod, 401);
  // Číslo místo řetězce: bez kontroly typu by `safeEqual` porovnávalo "8423"
  // s číslem 8423 a pustilo by to dál
  check('číslo místo textu neprojde', volej(h, { pin: 8423 }, '10.0.1.7').kod, 401);
}

nadpis('3) Počítadlo pokusů');
{
  const h = build();
  const IP = '10.0.2.1';
  for (let i = 0; i < 10; i++) volej(h, { pin: '0000' }, IP);
  const dalsi = volej(h, { pin: '0000' }, IP);
  check('po deseti pokusech přijde 429', dalsi.kod, 429);
  // A hlavně: v tom okně neprojde ani SPRÁVNÝ kód, jinak by limit nebyl k ničemu
  check('  a neprojde ani správný kód', volej(h, { pin: '8423' }, IP).kod, 429);
  // Limit je na IP, ne na celý server
  check('jiná IP hádat může', volej(h, { pin: '8423' }, '10.0.2.2').out.ok, true);

  // Úspěch rozpočet vynuluje — jinak by po devíti překlepech zbýval jeden pokus
  // a desátý překlep za celý den by člověka vyřadil. Devět špatných, jeden
  // správný, zase devět špatných: bez vynulování je jich osmnáct a limit padne.
  const IP2 = '10.0.2.3';
  for (let i = 0; i < 9; i++) volej(h, { pin: '0000' }, IP2);
  check('úspěch projde i po devíti překlepech', volej(h, { pin: '8423' }, IP2).out.ok, true);
  for (let i = 0; i < 9; i++) volej(h, { pin: '0000' }, IP2);
  check('  a počítadlo začíná znovu', volej(h, { pin: '8423' }, IP2).out.ok, true);
  // Limit ale pořád platí — dvacet pokusů v kuse projít nesmí
  const IP3 = '10.0.2.4';
  for (let i = 0; i < 10; i++) volej(h, { pin: '0000' }, IP3);
  check('  ale limit platí dál', volej(h, { pin: '8423' }, IP3).kod, 429);
}

nadpis('4) Kód z prostředí přebije výchozí');
{
  const h = build({ pin: '1234' });
  check('platí ten z prostředí', h.api.REZIM_PIN, '1234');
  check('  a projde', volej(h, { pin: '1234' }, '10.0.3.1').out.ok, true);
  check('výchozí 8423 už ne', volej(h, { pin: '8423' }, '10.0.3.2').kod, 401);
}

nadpis('5) Porovnání nepadá na různé délce');
{
  const h = build();
  // `crypto.timingSafeEqual` vyhodí výjimku, když mají vstupy jinou délku.
  // Proto se obojí nejdřív přežene přes SHA256 — bez toho by kratší kód
  // shodil celý endpoint místo aby vrátil 401.
  check('krátký kód nespadne', volej(h, { pin: 'a' }, '10.0.4.1').kod, 401);
  check('dlouhý kód taky ne',
    volej(h, { pin: 'x'.repeat(500) }, '10.0.4.2').kod, 401);
  check('safeEqual je tam, kde má být', h.api.safeEqual('8423', '8423'), true);
  check('  a rozdílné odmítne', h.api.safeEqual('8423', '8424'), false);
}

konec();
