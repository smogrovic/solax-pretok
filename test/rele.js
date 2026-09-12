// Ověření: „běží to relé teď?" Odpojené relé cloud pořád obslouží a vrátí poslední
// známý stav s čerstvým razítkem — brát to vážně znamenalo účtovat dobu běhu navěky.
// Rozhoduje proto tvrdý časovač v relé: nejpozději 15 min po posledním úspěšném ON.
const { LINES, between, suite } = require('./zdroj');
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

nadpis('6) Oběhové čerpadlo');
{
  // Čerpadlo se spouští ručně a vypíná ho výhradně auto-off v samotném relé.
  // Udržovací ON ten časovač natahuje od začátku — kdyby se sem čerpadlo dostalo,
  // běželo by dál a dál a jediná pojistka, která funguje i bez sítě, by přestala platit.
  const zdroj = LINES.join('\n');
  const keepalive = (zdroj.match(/const KEEPALIVE_KEYS = \[([^\]]*)\]/) || [])[1] || '';
  check('do udržovacího ON nepatří', /obeh/.test(keepalive), false);
  check('  ale bazén, bojler a solinátor tam zůstávají',
    ['pool', 'shelly', 'solinator'].every(k => keepalive.includes(k)), true);

  check('relé je v seznamu zařízení', /obeh:\s*\{[^}]*apiPath: '\/api\/obeh'/.test(zdroj), true);
  check('  a má český popisek', /obeh: 'Oběhové čerpadlo'/.test(zdroj), true);
  check('  a vlastní dráhu v časové ose', /timeline: \{[^}]*obeh: \[\]/.test(zdroj), true);

  // Doba běhu na Přehledu je o spotřebičích, které řídí automatika. Kdyby se sem
  // čerpadlo přidalo, rozjelo by se i denní účtování a karta by ukazovala čtvrtý řádek.
  const runtimeMs = (zdroj.match(/ms: \{ shelly: 0, pool: 0, solinator: 0 \}/g) || []).length;
  check('do doby běhu se nepočítá', runtimeMs >= 1, true);
  check('  a v runtime.ms není', /ms: \{[^}]*obeh/.test(zdroj), false);

  // Telefon vrací serveru pruhy po deployi — bez klíče ve whitelistu by je zahodil
  const validKey = (zdroj.match(/const validKey = k => \/\^\(([^)]*)\)/) || [])[1] || '';
  check('obnova časové osy ho propustí', validKey.includes('obeh'), true);
}

konec();
