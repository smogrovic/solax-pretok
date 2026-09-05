// Ověření: nástěnná Shelly čidla řídí spínání klimatizace ve svém pokoji. Čidlo
// v klimatizaci visí u stropu a ukazuje o pár stupňů víc, takže pokoj s čidlem
// se podle něj řídit NESMÍ — ani jako náhrada, ani po dlouhém tichu čidla.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('čidla');

const CFG = between('// Teplotní čidla (Shelly H&T)', '// Jak dlouhé ticho čidla');
const ZDROJ = between('// Podle čeho se v pokoji rozhoduje', '// Teploty v pokojích pro graf');
const GRAF = between('// Teploty v pokojích pro graf', '// Zásah do klimatizace od člověka');
const TEMPC = fn('function sensorTempC(room)');
const BATERIE = between('const sensorBatteryWarned = {};', 'let shellyPollRunning');

const H = 3600000;

// Konfigurace čidel se čte jako obyčejný objekt (proměnné prostředí tu nejsou)
const cfg = new Function('SHELLY_SERVER_URI',
  CFG.replace(/^\/\/.*$/gm, '') + '\n; return TEMP_SENSORS;')('shelly-test.local');

function build(sensors = {}, pravidla = null) {
  const state = { sensors, airconHistory: [] };
  const logy = [];
  const api = new Function('state', 'TEMP_SENSORS', 'TEMP_AUTO_RULES', 'SENSOR_SILENCE_LOG_MS',
    'addLog', 'broadcast', 'sendPushToAll', 'SENSOR_LOW_BATTERY',   // stáří historie si nese samotný úsek
    TEMPC + '\n' + ZDROJ + '\n' + GRAF + '\n' + BATERIE
    + '\n; return { roomTemp, recordAirconTemps, sensorTempC, checkSensorBattery, noteSensorState };'
  )(state, cfg,
    pravidla || [{ key: 'obyvak', room: 'Obývák' }, { key: 'loznice', room: 'Ložnice' },
                 { key: 'elenka', room: 'Elenka' }, { key: 'miky', room: 'Miky' }],
    6 * H, m => logy.push(m), () => {}, (t, b) => logy.push(t + ' ' + b), 15);
  return { api, state, logy };
}

const cidlo = (tempC, o = {}) => ({ tempC, humidity: 45, battery: 90,
  online: true, reportedAt: Date.now(), fetchedAt: Date.now(), ...o });

nadpis('1) Konfigurace');
{
  check('čidla mají všechny čtyři pokoje', Object.keys(cfg).sort().join(','),
    'elenka,loznice,miky,obyvak');
  check('každé má svoje Device Id',
    new Set(Object.values(cfg).map(c => c.deviceId)).size, 4);
  check('  a všechna vypadají jako Shelly ID',
    Object.values(cfg).every(c => /^[0-9a-f]{12}$/.test(c.deviceId)), true);
  check('ložnice', (cfg.loznice || {}).deviceId, '70af09e40198');
  check('elenka', (cfg.elenka || {}).deviceId, '9070694e6010');
  check('miky', (cfg.miky || {}).deviceId, '9070695ad278');
  check('klíče sedí na pokoje v automatice',
    Object.keys(cfg).every(k => ['obyvak', 'loznice', 'elenka', 'miky'].includes(k)), true);
}

nadpis('2) Podle čeho se pokoj řídí');
{
  const h = build({ miky: cidlo(23.4) });
  const klima = { insideTemp: 26.1 };            // čidlo u stropu ukazuje víc
  const r = h.api.roomTemp('miky', klima);
  check('pokoj s čidlem jede podle čidla', r.temp, 23.4);
  check('  a řekne to i zdrojem', r.source, 'čidlo');
  check('  klimatizační hodnotu ignoruje', r.temp === klima.insideTemp, false);
}
{
  const h = build({});
  const r = h.api.roomTemp('kuchyn', { insideTemp: 26.1 });
  check('pokoj bez čidla jede podle klimatizace', r.temp, 26.1);
  check('  a řekne to', r.source, 'klimatizace');
}
{
  // Čidlo hlásí jen při změně, takže ticho znamená stabilní teplotu — ne neplatná data
  const h = build({ loznice: cidlo(21.2, { reportedAt: Date.now() - 20 * H }) });
  const r = h.api.roomTemp('loznice', { insideTemp: 25 });
  check('po dlouhém tichu platí poslední hodnota z čidla', r.temp, 21.2);
  check('  a do logu se to jednou napíše',
    h.logy.some(l => /Čidlo Ložnice: nehlásí přes 6 h/.test(l)), true);
  h.api.roomTemp('loznice', { insideTemp: 25 });
  check('  ale jen jednou', h.logy.filter(l => /nehlásí přes 6 h/.test(l)).length, 1);
}
{
  const h = build({ elenka: { online: false } });   // čidlo ještě nikdy nehlásilo
  const r = h.api.roomTemp('elenka', { insideTemp: 24 });
  check('bez dat se pokoj přeskočí', r.temp, null);
  check('  a NEsáhne se po klimatizaci', r.temp === 24, false);
  check('  log to řekne', h.logy.some(l => /Čidlo Elenka: zatím nehlásí/.test(l)), true);
}
{
  const h = build({ miky: cidlo(23) });
  h.api.roomTemp('miky', null);
  h.state.sensors.miky = { online: false };
  h.api.roomTemp('miky', null);
  h.state.sensors.miky = cidlo(23.5);
  h.api.roomTemp('miky', null);
  check('návrat čidla se hlásí', h.logy.some(l => /Čidlo Miky: zase hlásí/.test(l)), true);
}

nadpis('3) Do grafu');
{
  const h = build({ obyvak: cidlo(22.5), loznice: cidlo(21), elenka: cidlo(23), miky: cidlo(24) });
  h.api.recordAirconTemps([{ guid: 'g1', insideTemp: 25 }]);
  const bod = h.state.airconHistory[0];
  check('do grafu jdou všechna čtyři čidla', Object.keys(bod.sens).sort().join(','),
    'elenka,loznice,miky,obyvak');
  check('  se svými teplotami', bod.sens.loznice, 21);
  check('  a klimatizace vedle nich', bod.temps.g1, 25);
}
{
  const h = build({ obyvak: cidlo(22.5), loznice: { online: false }, elenka: cidlo(23) });
  h.api.recordAirconTemps([]);
  check('čidlo bez teploty se do grafu nedá',
    Object.keys(h.state.airconHistory[0].sens).sort().join(','), 'elenka,obyvak');
}
{
  const h = build({});
  h.api.recordAirconTemps([]);
  check('bez čehokoli se bod nezakládá', h.state.airconHistory.length, 0);
}

nadpis('4) Baterie');
{
  const h = build({});
  h.api.checkSensorBattery('miky', 12);
  check('slabá baterie se ohlásí', h.logy.filter(l => /Slabá baterie/.test(l)).length, 1);
  check('  se jménem pokoje', h.logy.some(l => /Miky/.test(l)), true);
  h.api.checkSensorBattery('miky', 11);
  check('  ale ne pokaždé', h.logy.filter(l => /Slabá baterie/.test(l)).length, 1);
  h.api.checkSensorBattery('miky', 90);
  h.api.checkSensorBattery('miky', 12);
  check('po výměně se upozornění natáhne',
    h.logy.filter(l => /Slabá baterie/.test(l)).length, 2);
  h.api.checkSensorBattery('elenka', null);
  check('bez údaje o baterii se nic nehlásí',
    h.logy.filter(l => /Slabá baterie/.test(l)).length, 2);
}

konec();
