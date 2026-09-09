// Ověření: bazén musí odběhnout aspoň 2 h denně. Co do 13:00 nevyjde z přebytku,
// se dožene natvrdo mezi 13:00 a 15:00 — bez ohledu na SOC prahy i přebytek.
// Past téhle logiky: po restartu serveru je počítadlo doby běhu na nule a pravdu
// má telefon. Bez runtimeKnown() by nasazení ve 13:30 pustilo bazén na další dvě
// hodiny, i když už dávno odběhl svoje.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('bazén');

const MIN = 60000, H = 3600000;
const CODE = between('// ---------- Bazén: zaručené 2 h denně ----------',
                     '// Přirážka za teplo se bere');

function build({ hour = 13, minute = 0, ranMs = 0, isOn = false, winter = false,
                 sauna = false, znamo = true, force = false, pocasi = true,
                 povelProjde = true } = {}) {
  const povely = [];
  const state = {
    devices: { pool: { isOn } },
    runtime: { ms: { pool: ranMs } },
    poolForce: { until: force ? Date.now() + H : 0 },
    autoMode: winter ? 'winter' : 'summer'
  };
  const poolAuto = { overCount: 3, underCount: 3, lastOnTime: 0 };
  const now = Date.now();
  // Západ ve 21:00 toho dne, o kterém se rozhoduje — do okna 13–15 nezasahuje
  const weather = pocasi ? { sys: { sunset: Math.floor((now - hour * H + 21 * H) / 1000) } } : null;

  const api = new Function(
    'state', 'poolAuto', 'isWinter', 'saunaBlokuje', 'afterSunsetCutoff', 'runtimeKnown',
    'poolForceActive', 'autoSet', 'fmtDur',
    'POOL_MIN_DAILY_MS', 'POOL_GUARANTEE_FROM_HOUR', 'POOL_GUARANTEE_TO_HOUR',
    CODE + '\n; return { poolDeficitMs, poolGuaranteeActive, enforcePoolMinRun };'
  )(
    state, poolAuto,
    () => state.autoMode === 'winter',
    () => sauna,
    (n, p, w) => (w && w.sys ? n >= w.sys.sunset * 1000 - H : p.hour >= 20),
    () => znamo,
    () => Date.now() < state.poolForce.until,
    async (key, turn, reason) => {
      if (!povelProjde) return false;          // ruční zásah povel zdržel
      povely.push(`${key}:${turn} (${reason})`);
      return true;
    },
    ms => Math.round(ms / MIN) + ' min',
    2 * H, 13, 15
  );
  return { api, state, poolAuto, povely, prague: { hour, minute }, weather, now };
}

const aktivni = h => h.api.poolGuaranteeActive(h.now, h.prague, h.weather);
const pust = async h => { await h.api.enforcePoolMinRun(h.now, h.prague, h.weather); return h.povely; };

(async () => {

nadpis('1) Deficit');
check('nic neodběhlo → chybí 2 h', build({ ranMs: 0 }).api.poolDeficitMs(), 2 * H);
check('odběhla hodina → chybí hodina', build({ ranMs: H }).api.poolDeficitMs(), H);
check('odběhly 2 h → nechybí nic', build({ ranMs: 2 * H }).api.poolDeficitMs(), 0);
check('odběhlo víc → pořád nula, ne minus', build({ ranMs: 5 * H }).api.poolDeficitMs(), 0);

nadpis('2) Okno 13:00–15:00');
check('v 11:00 ne', aktivni(build({ hour: 11 })), false);
check('ve 12:59 ještě ne', aktivni(build({ hour: 12, minute: 59 })), false);
check('ve 13:00 ano', aktivni(build({ hour: 13 })), true);
check('ve 14:30 pořád', aktivni(build({ hour: 14, minute: 30 })), true);
check('v 15:00 už ne', aktivni(build({ hour: 15 })), false);
check('v 18:00 ne', aktivni(build({ hour: 18 })), false);

nadpis('3) Kdy se neuplatní');
check('splněné 2 h → záruka mlčí', aktivni(build({ ranMs: 2 * H })), false);
check('chybí 10 min → pořád jede', aktivni(build({ ranMs: 2 * H - 10 * MIN })), true);
check('zima', aktivni(build({ winter: true })), false);
check('sauna topí', aktivni(build({ sauna: true })), false);
// Vlastní past téhle změny: po nasazení je počítadlo na nule, ale telefon zná pravdu
check('po restartu, dokud nedorazí doba běhu z telefonu', aktivni(build({ znamo: false })), false);
check('  a jakmile dorazí, rozhoduje se normálně', aktivni(build({ znamo: true })), true);
// Bez počasí se západ bere podle náhradní meze 20:00 — okno 13–15 to nezasáhne
check('bez počasí funguje dál', aktivni(build({ pocasi: false })), true);
{
  const h = build({ hour: 14 });
  h.weather = { sys: { sunset: Math.floor((h.now - 30 * MIN) / 1000) } };
  check('po západu slunce ne', aktivni(h), false);
}

nadpis('4) Zapnutí');
check('vypnutý bazén se pustí', (await pust(build({ isOn: false })))[0],
  'pool:on (zaručené 2 h denně — zbývá 120 min)');
check('  a se zbytkem v hlášce', (await pust(build({ isOn: false, ranMs: 90 * MIN })))[0],
  'pool:on (zaručené 2 h denně — zbývá 30 min)');
check('běžící bazén se nechá být', (await pust(build({ isOn: true }))).length, 0);
check('neznámý stav se pro jistotu pustí', (await pust(build({ isOn: null })))[0],
  'pool:on (zaručené 2 h denně — zbývá 120 min)');
check('mimo okno nic', (await pust(build({ hour: 11 }))).length, 0);
check('splněné 2 h nic', (await pust(build({ ranMs: 2 * H }))).length, 0);
check('+24 h už bazén drží samo', (await pust(build({ force: true }))).length, 0);

nadpis('5) Předání přebytkové logice');
{
  // Po 15:00 přebírá runPoolAutomation. Kdyby zdědila naplněná počítadla, vypnula by
  // bazén hned prvním cyklem — proto se při zapnutí nulují.
  const h = build({ isOn: false });
  await pust(h);
  check('počítadla přebytku se vynulují', `${h.poolAuto.overCount},${h.poolAuto.underCount}`, '0,0');
  check('  a zapíše se čas zapnutí', h.poolAuto.lastOnTime, h.now);
}
{
  // autoSet je bez `force`: když ruční OFF drží, povel neprojde. Počítadla musí zůstat
  // naplněná, ať se bazén vypne hned prvním cyklem po vypršení odkladu.
  const h = build({ isOn: false, povelProjde: false });
  await pust(h);
  check('zdržený povel nechá počítadla být',
    `${h.poolAuto.overCount},${h.poolAuto.underCount},${h.poolAuto.lastOnTime}`, '3,3,0');
}

konec();

})();
