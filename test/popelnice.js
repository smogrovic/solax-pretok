// Ověření: hlídač popelnic — v den svozu ráno červené upozornění na iPadu (7:30–8:00)
// a v 7:30 notifikace, když popelnice není odťuknutá jako vyndaná.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('popelnice');

const PRIP = between('// ---------- Připomínky ----------', '// ---------- Spotřeba po měsících ----------');
const HLID = between('// ---------- Hlídač popelnic ----------', '// ---------- Záloha do souboru');

function build() {
  const pushe = [], broadcasts = [];
  const app = { post: () => {}, get: () => {} };
  const state = {};
  globalThis.sendPushToAll = async (t, b, o) => { pushe.push({ t, b, k: o && o.kategorie }); };
  const api = new Function('state', 'broadcast', 'app', 'addLog', 'requireAuth', 'scheduleEvery',
    PRIP + '\n' + HLID + '\n; state.pripominky = pripominkyVychozi(); state.oznameni = null;'
      + ' return { popelniceHlidej, popelniceNevyndane, popelniceText, pripominkaHotovo, oznameniNastav, oznameniZrus };'
  )(state, (e, d) => broadcasts.push(e), app, () => {}, () => true, undefined);
  return { api, state, pushe, broadcasts };
}
// Pražský čas: listopad UTC+1, červen UTC+2
const P = (den, h, m = 0, posun = 1) => Date.parse(`${den}T${String(h - posun).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

nadpis('1) Čtvrtek, popelnice nevyndaná');
{
  const h = build();
  h.api.popelniceHlidej(P('2026-11-12', 7, 20));
  check('7:20 ještě nic', !!h.state.oznameni + ' ' + h.pushe.length, 'false 0');
  h.api.popelniceHlidej(P('2026-11-12', 7, 29));
  check('7:29 ještě nic', !!h.state.oznameni + ' ' + h.pushe.length, 'false 0');
  h.api.popelniceHlidej(P('2026-11-12', 7, 30));
  check('7:30 upozornění jen pro iPad', h.state.oznameni && h.state.oznameni.text + ' ' + h.state.oznameni.jenIpad, '🗑️ Vyvézt popelnici true');
  h.api.popelniceHlidej(P('2026-11-12', 7, 31));
  check('7:30 notifikace, jen jednou, kategorie popelnice', h.pushe.length + ' ' + h.pushe[0].k + ' ' + h.pushe[0].t, '1 popelnice 🗑️ Vyvézt popelnici');
  h.api.popelniceHlidej(P('2026-11-12', 8, 0));
  check('8:00 upozornění zmizí', h.state.oznameni, null);
}

nadpis('2) Odťuknuto');
{
  const h = build();
  h.api.pripominkaHotovo('popelnice', false, P('2026-11-11', 18), P('2026-11-11', 18));
  h.api.popelniceHlidej(P('2026-11-12', 7, 40));
  check('vyndaná večer předem → nic', !!h.state.oznameni + ' ' + h.pushe.length, 'false 0');
  const h2 = build();
  h2.api.pripominkaHotovo('popelnice', false, P('2026-11-05', 10), P('2026-11-05', 10));
  h2.api.popelniceHlidej(P('2026-11-12', 7, 40));
  check('odťuknutí před minulým svozem (čt 10:00) se nepočítá', !!h2.state.oznameni, true);
  h2.api.pripominkaHotovo('popelnice', false, P('2026-11-12', 7, 45), P('2026-11-12', 7, 45));
  h2.api.popelniceHlidej(P('2026-11-12', 7, 45));
  check('odťuknutí během okna upozornění zruší', h2.state.oznameni, null);
  h2.api.popelniceHlidej(P('2026-11-12', 7, 50));
  check('  a už se nevrátí', h2.state.oznameni, null);
}

nadpis('3) Vypnutá, jiný den, cizí upozornění, odkliknutí');
{
  const h = build();
  h.state.pripominky.popelnice.zapnuto = false;
  h.api.popelniceHlidej(P('2026-11-12', 7, 40));
  check('vypnutá → nic', !!h.state.oznameni + ' ' + h.pushe.length, 'false 0');
  const h2 = build();
  h2.api.popelniceHlidej(P('2026-11-11', 7, 40));
  check('středa → nic', !!h2.state.oznameni + ' ' + h2.pushe.length, 'false 0');
  const h3 = build();
  h3.api.oznameniNastav('Večeře v 18', P('2026-11-12', 7));
  h3.api.popelniceHlidej(P('2026-11-12', 7, 40));
  check('cizí upozornění se nepřepíše, notifikace ale jde', h3.state.oznameni.text + ' ' + h3.pushe.length, 'Večeře v 18 1');
  h3.api.popelniceHlidej(P('2026-11-12', 8, 5));
  check('  a v 8:00 se cizí neruší', h3.state.oznameni.text, 'Večeře v 18');
  const h4 = build();
  h4.api.popelniceHlidej(P('2026-11-12', 7, 36));
  h4.api.oznameniZrus(h4.state.oznameni.id);
  h4.api.popelniceHlidej(P('2026-11-12', 7, 37));
  check('odkliknuté se ten den nevrátí', h4.state.oznameni, null);
}

nadpis('4) BIO v pondělí');
{
  const h = build();
  h.api.popelniceHlidej(P('2026-06-15', 7, 35, 2));
  check('červen: BIO', h.state.oznameni && h.state.oznameni.text, '🗑️ Vyvézt popelnici BIO');
  const h2 = build();
  h2.api.popelniceHlidej(P('2026-11-16', 7, 35));
  check('listopad mimo sezónu: nic', h2.state.oznameni, null);
  const h3 = build();
  h3.api.pripominkaHotovo('popelnice', false, P('2026-11-05', 18), P('2026-11-05', 18));
  h3.api.popelniceHlidej(P('2026-11-12', 7, 40));
  check('odťuknuto po minulém svozu (jako v appce) = vyndáno', h3.state.oznameni, null);
  check('obě naráz', h.api.popelniceText(['popelnice', 'bio']), '🗑️ Vyvézt popelnici a popelnici BIO');
}

delete globalThis.sendPushToAll;
konec();
