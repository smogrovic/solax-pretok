// Ověření: co všechno v zimním režimu drží appka dole.
//
// Bazén a solinátor spí odjakživa. Nově i světlo u bazénu — pod zakrytým bazénem
// nemá co svítit a zapnout ho jde i mimo appku (Shelly aplikace, vypínač), o čemž
// appka žádný odklad neví. Proto zhasne na nejbližším cyklu automatiky.
const { fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('zima');

const CODE = fn('async function enforceWinterOff() {');

function build({ zima = true, force = false, rucni = [], sviti = [] } = {}) {
  const povely = [];
  const state = { devices: {} };
  for (const k of ['pool', 'solinator', 'lightBazen', 'lightDole', 'shelly']) {
    state.devices[k] = { online: true, isOn: sviti.includes(k) };
  }
  const poolAuto = { overCount: 3, underCount: 3 };
  const api = new Function('state', 'poolAuto', 'isWinter', 'poolForceActive', 'autoSet', 'manualHeld',
    CODE + '\n; return { enforceWinterOff };'
  )(
    state, poolAuto,
    () => zima,
    () => force,
    // Jako ostrý autoSet: bez `force` ho ruční odklad zastaví
    async (key, turn, reason, opts = {}) => {
      if (!opts.force && rucni.includes(key)) return false;
      povely.push(`${key}:${turn} (${reason})`);
      state.devices[key].isOn = turn === 'on';
      return true;
    },
    key => rucni.includes(key)
  );
  return { api, state, povely, poolAuto };
}

const zhasni = async h => { await h.api.enforceWinterOff(); return h.povely; };

(async () => {

nadpis('1) Co se v zimě vypíná');
check('běžící bazén zhasne', (await zhasni(build({ sviti: ['pool'] })))[0], 'pool:off (zimní režim)');
check('solinátor taky', (await zhasni(build({ sviti: ['solinator'] })))[0], 'solinator:off (zimní režim)');
// Vlastní pointa téhle změny
check('a světlo u bazénu taky', (await zhasni(build({ sviti: ['lightBazen'] })))[0],
  'lightBazen:off (zimní režim)');
check('všechno tři naráz', (await zhasni(build({ sviti: ['pool', 'solinator', 'lightBazen'] }))).join(' | '),
  'pool:off (zimní režim) | solinator:off (zimní režim) | lightBazen:off (zimní režim)');

nadpis('2) Do čeho se nesahá');
check('co nesvítí, se nevypíná', (await zhasni(build({ sviti: [] }))).length, 0);
// Zima je o bazénu, ne o zbytku baráku — ostatní světla i bojler jedou dál
check('jiná světla zima neřeší', (await zhasni(build({ sviti: ['lightDole'] }))).length, 0);
check('bojler taky ne', (await zhasni(build({ sviti: ['shelly'] }))).length, 0);
check('mimo zimu se nedělá nic',
  (await zhasni(build({ zima: false, sviti: ['pool', 'lightBazen'] }))).length, 0);

nadpis('3) Ruční zásah a +24 h');
{
  // Kdo světlo zapne z Ovládání, chtěl to — má svých třicet minut. Zhasne se až pak,
  // a hlavně to, co někdo zapnul mimo appku (o tom appka odklad nemá).
  const h = build({ sviti: ['lightBazen'], rucni: ['lightBazen'] });
  check('čerstvé ruční zapnutí světla se nechá být', (await zhasni(h)).length, 0);
  check('  a světlo opravdu svítí dál', h.state.devices.lightBazen.isOn, true);
}
check('bazén puštěný na +24 h jede i v zimě',
  (await zhasni(build({ force: true, sviti: ['pool'] }))).length, 0);
{
  // +24 h je jen o bazénu — světlo zhasne tak jako tak
  const h = build({ force: true, sviti: ['pool', 'lightBazen'] });
  check('  ale světlo zhasne i tak', (await zhasni(h)).join(','), 'lightBazen:off (zimní režim)');
}

nadpis('4) Počítadla přebytku');
{
  const h = build({ sviti: ['pool'] });
  await zhasni(h);
  check('po zimním vypnutí se vynulují', `${h.poolAuto.overCount},${h.poolAuto.underCount}`, '0,0');
}

konec();

})();
