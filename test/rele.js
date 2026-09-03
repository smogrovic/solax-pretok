// Ověření: „běží to relé teď?" Odpojené relé cloud pořád obslouží a vrátí poslední
// známý stav s čerstvým razítkem — brát to vážně znamenalo účtovat dobu běhu navěky.
// Rozhoduje proto tvrdý časovač v relé: nejpozději 15 min po posledním úspěšném ON.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('relé');

const CODE = between('// ---------- Běží to relé teď? ----------', 'async function sendKeepalive()');
const MIN = 60000;
const AUTO_OFF = 15 * MIN;

function build() {
  const state = { devices: {} };
  const lastCmd = {};
  const api = new Function('state', 'lastCmd', 'RELAY_AUTO_OFF_MS', 'cerstve',
    CODE + '\n; return { releZname, releDobehDo, releBezi };'
  )(state, lastCmd, AUTO_OFF, (ts, max = 10 * MIN) => !!ts && Date.now() - ts <= max);
  return { api, state, lastCmd };
}

// Stav, jaký vrací cloud. `online:false` s isOn:true = odpojené relé, které
// naposledy svítilo; razítko je čerstvé, protože jsme se ptali právě teď.
const stav = (o = {}) => ({ online: true, isOn: true, powerW: 2000, fetchedAt: Date.now(), ...o });

nadpis('1) Když cloud říká pravdu');
{
  const h = build();
  h.state.devices.pool = stav();
  check('online a zapnuté → běží', h.api.releBezi('pool'), true);
  h.state.devices.pool = stav({ isOn: false });
  check('online a vypnuté → neběží', h.api.releBezi('pool'), false);
  // I když jsme před chvílí poslali ON — čerstvá pravda z cloudu má přednost
  h.lastCmd.pool = { turn: 'on', at: Date.now() };
  check('  ani když jsme zrovna poslali ON', h.api.releBezi('pool'), false);
}
{
  const h = build();
  h.state.devices.pool = stav();
  check('stav je známý', h.api.releZname('pool'), true);
  h.state.devices.pool = stav({ online: false });
  check('offline = neznámý', h.api.releZname('pool'), false);
  h.state.devices.pool = stav({ isOn: null });
  check('bez stavu = neznámý', h.api.releZname('pool'), false);
  h.state.devices.pool = stav({ fetchedAt: Date.now() - 11 * MIN });
  check('staré razítko = neznámý', h.api.releZname('pool'), false);
  h.state.devices.pool = undefined;
  check('zařízení bez záznamu = neznámý', h.api.releZname('pool'), false);
}

nadpis('2) Když cloud mlčí, rozhoduje časovač');
{
  const h = build();
  const T = Date.now();
  h.state.devices.pool = stav({ online: false });    // odpojené, naposledy zapnuto
  h.lastCmd.pool = { turn: 'on', at: T };
  check('hned po ON běží', h.api.releBezi('pool', T + 1000), true);
  check('  po 14 min pořád', h.api.releBezi('pool', T + 14 * MIN), true);
  check('  přesně v 15:00 už ne', h.api.releBezi('pool', T + AUTO_OFF), false);
  check('  a po 20 min tuplem ne', h.api.releBezi('pool', T + 20 * MIN), false);
  check('dobíhá do posledního ON + 15 min', h.api.releDobehDo('pool'), T + AUTO_OFF);
}
{
  // Spadlý dotaz (isOn: null) — relé má napájení dál, nesmí zhasnout hned
  const h = build();
  const T = Date.now();
  h.state.devices.pool = { online: false, isOn: null, powerW: null, fetchedAt: T };
  h.lastCmd.pool = { turn: 'on', at: T };
  check('po spadlém dotazu běží dál', h.api.releBezi('pool', T + 5 * MIN), true);
  check('  ale ne navěky', h.api.releBezi('pool', T + 16 * MIN), false);
}
{
  const h = build();
  const T = Date.now();
  h.state.devices.pool = stav({ online: true, fetchedAt: T - 30 * MIN });
  h.lastCmd.pool = { turn: 'on', at: T - 30 * MIN };
  check('zastaralé razítko časovač nepřebije', h.api.releBezi('pool', T), false);
}

nadpis('3) Bez záznamu o ON netvrdíme nic');
{
  const h = build();
  h.state.devices.pool = stav({ online: false });
  check('neznámé relé bez povelu → neběží', h.api.releBezi('pool'), false);
  check('  a nemá dokdy dobíhat', h.api.releDobehDo('pool'), 0);
  h.lastCmd.pool = { turn: 'off', at: Date.now() };
  check('po OFF neběží hned', h.api.releBezi('pool'), false);
  check('  a taky nedobíhá', h.api.releDobehDo('pool'), 0);
}

nadpis('4) Keepalive posouvá okno');
{
  const h = build();
  const T = Date.now();
  h.state.devices.pool = stav({ online: false });
  h.lastCmd.pool = { turn: 'on', at: T };
  check('po 16 min od prvního ON neběží', h.api.releBezi('pool', T + 16 * MIN), false);
  h.lastCmd.pool = { turn: 'on', at: T + 10 * MIN };   // udržovací ON prošel
  check('udržovací ON ho vrátí do hry', h.api.releBezi('pool', T + 16 * MIN), true);
  check('  a posune konec', h.api.releDobehDo('pool'), T + 10 * MIN + AUTO_OFF);
}

nadpis('5) Každé relé zvlášť');
{
  const h = build();
  const T = Date.now();
  for (const k of ['pool', 'solinator', 'shelly']) h.state.devices[k] = stav({ online: false });
  h.lastCmd.pool = { turn: 'on', at: T };
  h.lastCmd.solinator = { turn: 'on', at: T - 20 * MIN };
  check('bazén ještě běží', h.api.releBezi('pool', T + MIN), true);
  check('solinátor už ne', h.api.releBezi('solinator', T + MIN), false);
  check('bojler bez povelu taky ne', h.api.releBezi('shelly', T + MIN), false);
}

konec();
