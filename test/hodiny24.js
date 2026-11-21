// Ověření: hodinové koše za posledních 24 h (FVE: Přehled spotřeby) — sčítání Wh
// do koše podle začátku hodiny, ořez na 26 h a jen kladné hodnoty.
const { fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('hodiny 24 h');

const CODE = 'const HODINY24_MAX = 26;\n' + fn('function hodinyPricti(v, dtH, now = Date.now()) {');
const state = {};
const api = new Function('state', CODE + '\n; return { hodinyPricti };')(state);
const H = 3600000;
const t0 = Date.UTC(2026, 10, 21, 10, 0, 0);

nadpis('1) Sčítání');
api.hodinyPricti({ feed: 3000, imp: 0, wb: -5 }, 0.5, t0 + 10 * 60000);
api.hodinyPricti({ feed: 1000, sauna: 6000 }, 0.25, t0 + 50 * 60000);
check('jeden koš na hodinu', state.hodiny24.length, 1);
check('  začátek hodiny', state.hodiny24[0].h, t0);
check('  Wh = W × h, sečtené', state.hodiny24[0].feed, 1750);
check('  nuly a záporné se nezapisují', 'imp' in state.hodiny24[0] || 'wb' in state.hodiny24[0], false);
check('  sauna', state.hodiny24[0].sauna, 1500);
api.hodinyPricti({ feed: 1000 }, 0.1, t0 + H + 60000);
check('další hodina = nový koš', state.hodiny24.map(x => x.feed).join(','), '1750,100');
api.hodinyPricti({ feed: 1000 }, 0, t0 + H + 120000);
check('nulová doba nic', state.hodiny24[1].feed, 100);

nadpis('2) Ořez');
for (let i = 2; i < 40; i++) api.hodinyPricti({ feed: 100 }, 1, t0 + i * H);
check('drží jen 26 h', state.hodiny24.length, 26);
check('  nejstarší je 25 h zpět', (state.hodiny24[25].h - state.hodiny24[0].h) / H, 25);

konec();
