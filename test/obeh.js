// Ověření: rozvrh oběhového čerpadla.
//
// Celá věc stojí na jedné nesamozřejmosti: relé má vlastní auto-off po 15 minutách,
// ale nejkratší okno je 45. Jedno ON tedy nestačí — uvnitř okna se musí posílat
// dokola, jinak se čerpadlo v 6:30 zavře samo. Právě proto je tu oddíl 4.
//
// Druhá past je opačná: do KEEPALIVE_KEYS čerpadlo nepatří (hlídá test/rele.js),
// tam by se držel nažhavený i ruční ON, který má naopak doběhnout za 15 minut.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('rozvrh čerpadla');

const MIN = 60000;
const CODE = between('// ---------- Oběhové čerpadlo: rozvrh ----------',
                     '// ---------- Automatika přebytků');

// `den` je zkratka jako z Intl (Mon…Sun), `cas` je 'HH:MM' pražského času.
function build({ den = 'Mon', cas = '06:15', rezim = 'on', rucni = false } = {}) {
  const povely = [];      // co šlo přes autoSet (tedy i do logu)
  const primo = [];       // připomenutí ON nízkou cestou
  let now = 1_700_000_000_000;
  let dnes = den, hodiny = cas;

  const api = new Function(
    'pragueTime', 'Intl', 'DEVICES', 'setShellyState', 'noteCmd', 'autoSet',
    'manualHeld', 'autoRunning', 'scheduleEvery', 'RELAY_AUTO_OFF_MS',
    CODE + '\n; return { obehOknoNyni, obehPracovniDen, runObehSchedule, OBEH_ROZVRH,'
         + ' OBEH_TICK_MS, OBEH_KEEPALIVE_MS };'
  )(
    () => ({ hour: Number(hodiny.slice(0, 2)), minute: Number(hodiny.slice(3, 5)) }),
    { DateTimeFormat: function () { return { format: () => dnes }; } },
    { obeh: { serverUri: 'srv', deviceId: 'id' } },
    async (uri, id, turn) => { primo.push({ turn, at: now }); },
    () => {},
    // Chová se jako ostrý autoSet: bez `force` ho ruční odklad zastaví. Bez téhle
    // věrnosti by sada schválila i variantu, kde rozvrhu odklad okno sebere.
    async (key, turn, reason, opts = {}) => {
      if (!opts.force && rucni) return false;
      povely.push(`${key}:${turn} (${reason})`);
      return true;
    },
    () => rucni,
    () => rezim !== 'off',
    () => {},
    15 * MIN
  );

  return {
    api, povely, primo,
    get now() { return now; },
    // Posune čas o `ms` a případně přestaví hodiny/den
    tik: async (ms = 0, novyCas, novyDen) => {
      now += ms;
      if (novyCas) hodiny = novyCas;
      if (novyDen) dnes = novyDen;
      await api.runObehSchedule(now);
    }
  };
}

const okno = (den, cas) => build({ den, cas }).api.obehOknoNyni();

nadpis('1) Hranice oken na minutu');
check('v 6:14 ještě ne', okno('Mon', '06:14'), null);
check('v 6:15 už ano', okno('Mon', '06:15'), '06:15–07:15');
check('v 7:14 pořád', okno('Mon', '07:14'), '06:15–07:15');
// Zprava otevřené: „6:15–7:15" má být přesně hodina, ne hodina a minuta
check('v 7:15 už ne', okno('Mon', '07:15'), null);
check('v 18:44 ne', okno('Mon', '18:44'), null);
check('v 18:45 ano', okno('Mon', '18:45'), '18:45–19:30');
check('v 19:29 pořád', okno('Mon', '19:29'), '18:45–19:30');
check('v 19:30 už ne', okno('Mon', '19:30'), null);
check('v poledne nic', okno('Mon', '12:00'), null);
check('v noci nic', okno('Mon', '03:00'), null);

nadpis('2) Pracovní dny versus víkend');
for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
  check(`${d} má ranní okno`, okno(d, '06:30'), '06:15–07:15');
}
check('sobota ráno nejede', okno('Sat', '06:30'), null);
check('neděle ráno taky ne', okno('Sun', '06:30'), null);
check('sobota v 18:30 jede', okno('Sat', '18:30'), '18:30–19:30');
check('neděle taky', okno('Sun', '18:30'), '18:30–19:30');
// Pátek má večerní okno o čtvrt hodiny později — víkendový plán se v týdnu nesmí použít
check('pátek v 18:30 ještě ne', okno('Fri', '18:30'), null);
check('  a rozjede se až v 18:45', okno('Fri', '18:45'), '18:45–19:30');
check('sobota v 19:29 pořád', okno('Sat', '19:29'), '18:30–19:30');
check('sobota v 19:30 už ne', okno('Sat', '19:30'), null);
check('pondělí je pracovní den', build({ den: 'Mon' }).api.obehPracovniDen(), true);
check('sobota není', build({ den: 'Sat' }).api.obehPracovniDen(), false);

(async () => {

nadpis('3) Hrany');
{
  const h = build({ den: 'Mon', cas: '06:14' });
  await h.tik();
  check('před oknem se neposílá nic', h.povely.length + h.primo.length, 0);
  await h.tik(MIN, '06:15');
  check('náběžná hrana zapne', h.povely[0], 'obeh:on (rozvrh 06:15–07:15)');
  await h.tik(MIN, '07:15');
  check('sestupná hrana vypne', h.povely[1], 'obeh:off (konec rozvrhu 06:15–07:15)');
  await h.tik(MIN, '07:16');
  check('  a pak už je ticho', h.povely.length, 2);
}
{
  // Dvě okna za den se nesmí slít — každé má vlastní hranu
  const h = build({ den: 'Mon', cas: '18:45' });
  await h.tik();
  await h.tik(MIN, '19:30');
  await h.tik(MIN, '19:31');
  check('večerní okno má vlastní hlášku', h.povely.join(' | '),
    'obeh:on (rozvrh 18:45–19:30) | obeh:off (konec rozvrhu 18:45–19:30)');
}
{
  // Server se na Renderu nasazuje několikrát denně — restart uprostřed okna
  // nesmí čerpadlo nechat stát
  const h = build({ den: 'Mon', cas: '06:40' });
  await h.tik();
  check('restart uprostřed okna čerpadlo zapne', h.povely[0], 'obeh:on (rozvrh 06:15–07:15)');
}

nadpis('4) Uvnitř okna se ON připomíná');
{
  // Tohle je vlastní pointa: bez připomínání by auto-off v relé čerpadlo v 6:30
  // zavřel a okno by trvalo čtvrt hodiny místo hodiny.
  const h = build({ den: 'Mon', cas: '06:15' });
  await h.tik();
  for (let i = 1; i <= 45; i++) await h.tik(MIN, '06:' + String(15 + i).padStart(2, '0'));
  check('za hodinu chodila připomenutí', h.primo.length > 0, true);
  check('  a všechna byla ON', h.primo.every(p => p.turn === 'on'), true);
  // Vlastní měřítko: mezi dvěma povely nesmí uplynout tolik, aby relé stihlo
  // zhasnout. Počítá se i mezera od zapnutí k prvnímu připomenutí a od posledního
  // připomenutí do konce okna.
  const casy = [h.now - 45 * MIN, ...h.primo.map(p => p.at), h.now];
  const mezera = Math.max(...casy.slice(1).map((t, i) => t - casy[i]));
  check('  a mezi povely se relé nestihne zavřít', mezera < 15 * MIN, true);
  check('    (nejdelší mezera v minutách)', Math.round(mezera / MIN) + ' min', '4 min');
  // Připomenutí jde nízkou cestou — přes autoSet by logAutoSet začal hlásit „opakovaně"
  check('připomenutí nejdou přes autoSet (a tedy ani do logu)', h.povely.length, 1);
}
{
  const h = build({ den: 'Mon', cas: '12:00' });
  await h.tik();
  await h.tik(MIN, '12:01');
  check('mimo okno se nepřipomíná nic', h.primo.length, 0);
}

nadpis('5) Ruční zásah');
{
  // Rozvrh je tvoje nastavení, ne konkurenční automatika — odklad mu okno nesebere
  const h = build({ den: 'Mon', cas: '06:14', rucni: true });
  await h.tik();
  await h.tik(MIN, '06:15');
  check('odklad nebrání otevření okna', h.povely[0], 'obeh:on (rozvrh 06:15–07:15)');
  await h.tik(MIN, '07:15');
  check('  ale brání jeho zavření', h.povely.length, 1);
}
{
  const h = build({ den: 'Mon', cas: '06:15' });
  await h.tik();
  await h.tik(MIN, '07:15');
  check('bez odkladu se zavře normálně', h.povely[1], 'obeh:off (konec rozvrhu 06:15–07:15)');
}

nadpis('6) Hlavní vypínač automatiky');
{
  const h = build({ den: 'Mon', cas: '06:15', rezim: 'off' });
  await h.tik();
  await h.tik(MIN, '06:30');
  check('při „vypnuto" se nesahá na nic', h.povely.length + h.primo.length, 0);
}
{
  // Zima je jen o bazénu; teplá voda teče pořád
  const h = build({ den: 'Mon', cas: '06:15', rezim: 'winter' });
  await h.tik();
  check('v zimě rozvrh jede dál', h.povely[0], 'obeh:on (rozvrh 06:15–07:15)');
}

nadpis('7) Rozvrh sám');
{
  const r = build().api.OBEH_ROZVRH;
  check('pracovní dny mají dvě okna', JSON.stringify(r.pracovni),
    '[["06:15","07:15"],["18:45","19:30"]]');
  check('víkend jedno', JSON.stringify(r.vikend), '[["18:30","19:30"]]');
  // Tik po minutě: pětiminutová automatika by okraj 6:15 rozmazala až o pět minut
  check('kontroluje se po minutě', build().api.OBEH_TICK_MS, MIN);
}

konec();

})();
