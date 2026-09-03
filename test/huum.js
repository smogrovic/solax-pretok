// Ověření: překlad odpovědi z HUUM (kamna UKU WiFi). Teploty odtud chodí jako
// ŘETĚZCE, `door: true` znamená ZAVŘENÉ a cílovou teplotu API nevrátí, dokud sauna
// netopí — na těch třech věcech se dá nejsnáz uklouznout.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('HUUM');

const CODE = between('// ---------- Kamna HUUM (UKU WiFi) ----------', 'async function fetchHuum()');
const api = new Function(CODE + '\n; return { huumMap, huumNum, huumStavText, HUUM_STAVY };')();

// Odpověď tak, jak ji API vrací (viz dokumentace HUUM i knihovna pyhuum)
const odpoved = (o = {}) => ({
  statusCode: 232, door: true, temperature: '23', targetTemperature: '50',
  startDate: 1507184846, endDate: 1507184846, duration: 0, config: 2, steamerError: 0, ...o
});

nadpis('1) Stavy');
{
  check('offline', api.huumStavText(230), 'offline');
  check('topí', api.huumStavText(231), 'topí');
  check('připravená', api.huumStavText(232), 'připravená');
  check('ovládá ji někdo jiný', api.huumStavText(233), 'ovládá ji někdo jiný');
  check('nouzové zastavení', api.huumStavText(400), 'nouzové zastavení');
  check('neznámý kód se nezamlčí', api.huumStavText(999), 'neznámý stav (999)');
  check('chybějící kód → null', api.huumStavText(undefined), null);
  check('jen 231 znamená topí', api.huumMap(odpoved({ statusCode: 231 })).heating, true);
  check('  232 ne', api.huumMap(odpoved()).heating, false);
  check('  a 230 taky ne', api.huumMap(odpoved({ statusCode: 230 })).heating, false);
}

nadpis('2) Teploty chodí jako text');
{
  const m = api.huumMap(odpoved());
  check('aktuální teplota je číslo', m.temperature, 23);
  check('  a je to opravdu number', typeof m.temperature, 'number');
  check('cílová teplota taky', m.targetTemperature, 50);
  check('číslo projde beze změny', api.huumMap(odpoved({ temperature: 78 })).temperature, 78);
  check('desetinné taky', api.huumMap(odpoved({ temperature: '78.5' })).temperature, 78.5);
}
{
  // Dokud sauna netopí, cílovou teplotu API nevrací — nesmí z toho vzniknout NaN
  const m = api.huumMap(odpoved({ targetTemperature: undefined }));
  check('chybějící cíl → null', m.targetTemperature, null);
  check('prázdný řetězec taky', api.huumMap(odpoved({ targetTemperature: '' })).targetTemperature, null);
  check('nesmysl taky', api.huumMap(odpoved({ targetTemperature: 'abc' })).targetTemperature, null);
  check('  a nikdy NaN', Number.isNaN(api.huumMap(odpoved({ temperature: 'x' })).temperature), false);
}

nadpis('3) Dveře');
{
  check('door: true = zavřené', api.huumMap(odpoved({ door: true })).doorClosed, true);
  check('door: false = otevřené', api.huumMap(odpoved({ door: false })).doorClosed, false);
  check('bez údaje nevíme', api.huumMap(odpoved({ door: undefined })).doorClosed, null);
}

nadpis('4) Vybavení a vyvíječ');
{
  check('config 1 = vyvíječ', api.huumMap(odpoved({ config: 1 })).configText, 'parní vyvíječ');
  check('config 2 = světlo', api.huumMap(odpoved({ config: 2 })).configText, 'světlo');
  check('config 3 = obojí', api.huumMap(odpoved({ config: 3 })).configText, 'vyvíječ i světlo');
  check('neznámé vybavení → null', api.huumMap(odpoved({ config: 9 })).configText, null);
  check('chyba vyvíječe se přenese', api.huumMap(odpoved({ steamerError: 1 })).steamerError, 1);
  check('  a nula je taky hodnota', api.huumMap(odpoved()).steamerError, 0);
}

nadpis('5) Delší odpověď');
{
  const m = api.huumMap(odpoved({
    humidity: '35', targetHumidity: 40, light: 1, saunaName: 'Chata',
    saunaConfig: { childLock: 'OFF', minTemp: 40, maxTemp: 110,
                   minHeatingTime: 1, maxHeatingTime: 3, minTimer: 0, maxTimer: 12 }
  }));
  check('vlhkost jako číslo', m.humidity, 35);
  check('cílová vlhkost', m.targetHumidity, 40);
  check('světlo', m.light, 1);
  check('název sauny', m.saunaName, 'Chata');
  check('meze teploty', `${m.limits.minTemp}–${m.limits.maxTemp}`, '40–110');
  check('meze doby topení', `${m.limits.minHeatingTime}–${m.limits.maxHeatingTime}`, '1–3');
  check('meze časovače', `${m.limits.minTimer}–${m.limits.maxTimer}`, '0–12');
  check('dětský zámek', m.limits.childLock, 'OFF');
}
{
  // Krátká odpověď (tak vypadá dokumentovaný příklad) nesmí spadnout
  const m = api.huumMap(odpoved());
  check('bez saunaConfig se nespadne', m.limits.maxTemp, null);
  check('  ani na dětském zámku', m.limits.childLock, null);
  check('chybějící vlhkost → null', m.humidity, null);
  check('prázdná odpověď projde', api.huumMap({}).statusCode, null);
  check('  a nemá stav', api.huumMap({}).statusText, null);
}

nadpis('6) Časy');
{
  const m = api.huumMap(odpoved({ startDate: 1507184846, endDate: 1507195646, duration: 3 }));
  check('začátek', m.startDate, 1507184846);
  check('konec', m.endDate, 1507195646);
  check('délka', m.duration, 3);
  check('chybějící konec → null', api.huumMap(odpoved({ endDate: undefined })).endDate, null);
}

konec();
