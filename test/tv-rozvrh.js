// Ověření: rozvrh televize dětí — výchozí pravidla ze Shelly, kontrola vstupu,
// spouštění v pravou minutu (i po vynechaném tiku), Elenka bez Shelly se nespouští,
// vypnutá automatika a „nejsme doma" a obnova ze zálohy.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('rozvrh televize');

const CODE = fn('function pragueTime(at) {') + '\n' + fn('function validTimerTime(t) {') + '\n'
  + between('// ---------- Televize dětí: rozvrh ----------', '// ---------- Automatika přebytků');

function build({ elenka = false } = {}) {
  const h = { state: { autoMode: 'on' }, routy: {}, povely: [], log: [], zpravy: [], ulozeni: 0, pryc: false };
  const DEVICES = { tvMiky: { deviceId: 'm' }, ...(elenka ? { tvElenka: { deviceId: 'e' } } : {}) };
  h.api = new Function('state', 'DEVICES', 'app', 'requireAuth', 'addLog', 'broadcast', 'storeUlozBrzy', 'scheduleEvery',
    'autoRunning', 'awayActive', 'autoSet',
    CODE + '\n; return { tvRozvrhData, tvRozvrhOver, tvRozvrhPayload, tvRozvrhSplatne, runTvRozvrh, TV_ROZVRH_VYCHOZI };'
  )(h.state, DEVICES, { post: (c, f) => { h.routy[c] = f; } }, () => true, t => h.log.push(t),
    (typ, d) => h.zpravy.push(typ), () => { h.ulozeni++; }, () => {},
    () => h.state.autoMode !== 'off', () => h.pryc,
    async (key, turn, duvod, o) => { h.povely.push(`${key}:${turn}:${duvod}:${!!(o && o.force)}`); return true; });
  h.volej = (cesta, body) => {
    let out = null;
    const res = { status(s) { this.s = s; return this; }, json(j) { out = { s: this.s || 200, ...j }; return this; } };
    h.routy[cesta]({ body }, res);
    return out;
  };
  return h;
}
// Praha v zimě = UTC+1. 23. 11. 2026 je pondělí.
const praha = (d, hh, mm) => Date.UTC(2026, 10, d, hh - 1, mm);

(async () => {
nadpis('1) Výchozí rozvrh = Mikyho Shelly');
{
  const h = build();
  const r = h.api.tvRozvrhData();
  check('Miky: čtyři pravidla', r.miky.map(p => `${p.dny.join('')} ${p.cas} ${p.akce}`).join(' | '),
    '12345 07:30 on | 12345 20:00 off | 67 06:30 on | 67 22:00 off');
  check('Elenka zatím prázdná', r.elenka.length, 0);
  r.miky.length = 0;
  check('data jsou kopie (výchozí se nepřepíše)', h.api.tvRozvrhData().miky.length, 4);
  const p = h.api.tvRozvrhPayload();
  check('appka ví, kdo má Shelly', p.deti.map(d => d.klic + ':' + d.pripojeno).join(','), 'miky:true,elenka:false');
  check('s Elenčiným Shelly je připojená', build({ elenka: true }).api.tvRozvrhPayload().deti[1].pripojeno, true);
}

nadpis('2) Kontrola vstupu');
{
  const h = build();
  const o = h.api.tvRozvrhOver({ miky: [{ dny: [7, 1, 1, '3'], cas: '21:15', akce: 'off' }, { dny: [6], cas: '08:00', akce: 'on', zap: false }] });
  check('dny se seřadí a zdvojené vypadnou', o.rozvrh.miky[1].dny.join(','), '1,3,7');
  check('pravidla podle času', o.rozvrh.miky.map(p => p.cas).join(','), '08:00,21:15');
  check('vypnuté pravidlo zůstane vypnuté', o.rozvrh.miky[0].zap, false);
  check('chybějící Elenka = prázdná', o.rozvrh.elenka.length, 0);
  check('špatný čas', /čas/.test(h.api.tvRozvrhOver({ miky: [{ dny: [1], cas: '25:00', akce: 'on' }] }).chyba), true);
  check('bez dne', /aspoň jeden den/.test(h.api.tvRozvrhOver({ miky: [{ dny: [9], cas: '07:00', akce: 'on' }] }).chyba), true);
  check('neznámá akce', !!h.api.tvRozvrhOver({ miky: [{ dny: [1], cas: '07:00', akce: 'toggle' }] }).chyba, true);
  check('nic → chyba', !!h.api.tvRozvrhOver(null).chyba, true);
  check('moc pravidel', !!h.api.tvRozvrhOver({ miky: Array(21).fill({ dny: [1], cas: '07:00', akce: 'on' }) }).chyba, true);
}

nadpis('3) Spouštění');
{
  const h = build();
  await h.api.runTvRozvrh(praha(23, 7, 29));          // první tik jen nastaví čas
  check('první tik po startu nic nedohání', h.povely.length, 0);
  await h.api.runTvRozvrh(praha(23, 7, 30) + 20000);
  check('pondělí 7:30 → Miky ON (natvrdo)', h.povely.join(' | '), 'tvMiky:on:rozvrh televize 07:30:true');
  await h.api.runTvRozvrh(praha(23, 7, 31) + 20000);
  check('  a jen jednou', h.povely.length, 1);
  h.povely.length = 0;
  // Tik vynechal (deploy) — 20:00 padlo do mezery 19:55–20:04
  await h.api.runTvRozvrh(praha(23, 19, 55));
  await h.api.runTvRozvrh(praha(23, 20, 4));
  check('vynechaný tik se dožene', h.povely.join(' | '), 'tvMiky:off:rozvrh televize 20:00:true');
  h.povely.length = 0;
  await h.api.runTvRozvrh(praha(23, 21, 59));
  await h.api.runTvRozvrh(praha(23, 22, 1));
  check('víkendové 22:00 v pondělí ne', h.povely.length, 0);
  await h.api.runTvRozvrh(praha(28, 21, 59));
  await h.api.runTvRozvrh(praha(28, 22, 1));
  check('  v sobotu ano', h.povely.join(), 'tvMiky:off:rozvrh televize 22:00:true');
  h.povely.length = 0;
  // Dlouhý výpadek: staré pravidlo se už nespustí
  await h.api.runTvRozvrh(praha(28, 21, 0));
  await h.api.runTvRozvrh(praha(28, 22, 20));
  check('22:00 po 20 min výpadku už ne', h.povely.length, 0);
  await h.api.runTvRozvrh(praha(29, 6, 29));
  await h.api.runTvRozvrh(praha(29, 6, 30));
  check('neděle 6:30 → ON', h.povely.join(), 'tvMiky:on:rozvrh televize 06:30:true');
}
{
  const h = build();
  h.state.tvRozvrh = { miky: [], elenka: [{ dny: [1], cas: '08:00', akce: 'on', zap: true }] };
  await h.api.runTvRozvrh(praha(23, 7, 59));
  await h.api.runTvRozvrh(praha(23, 8, 0));
  check('Elenka bez Shelly se nespouští', h.povely.length, 0);
  const s = build({ elenka: true });
  s.state.tvRozvrh = h.state.tvRozvrh;
  await s.api.runTvRozvrh(praha(23, 7, 59));
  await s.api.runTvRozvrh(praha(23, 8, 0));
  check('  se Shelly ano', s.povely.join(), 'tvElenka:on:rozvrh televize 08:00:true');
}
{
  const h = build();
  h.state.tvRozvrh = { miky: [{ dny: [1], cas: '07:30', akce: 'on', zap: false }, { dny: [1], cas: '07:31', akce: 'off', zap: true }], elenka: [] };
  await h.api.runTvRozvrh(praha(23, 7, 29));
  await h.api.runTvRozvrh(praha(23, 7, 31));
  check('vypnuté pravidlo se přeskočí', h.povely.join(), 'tvMiky:off:rozvrh televize 07:31:true');
  h.povely.length = 0;
  h.state.autoMode = 'off';
  await h.api.runTvRozvrh(praha(30, 7, 29));
  await h.api.runTvRozvrh(praha(30, 7, 31));
  check('vypnutá automatika → nic', h.povely.length, 0);
  h.state.autoMode = 'on';
  h.pryc = true;
  h.state.tvRozvrh.miky[0].zap = true;          // 7:30 ON i 7:31 OFF v pondělí
  await h.api.runTvRozvrh(praha(30, 7, 29));
  await h.api.runTvRozvrh(praha(30, 7, 31));
  check('nejsme doma: zapnutí ne, vypnutí ano', h.povely.join(), 'tvMiky:off:rozvrh televize 07:31:true');
}

nadpis('4) Uložení a záloha');
{
  const h = build();
  const r = h.volej('/api/tv-rozvrh', { rozvrh: { miky: [{ dny: [1, 2], cas: '18:00', akce: 'off' }] } });
  check('uloží se', r.s + ' ' + h.state.tvRozvrh.miky[0].cas, '200 18:00');
  check('  zapíše do logu a zálohy, appky se dozví', h.log.length + ' ' + h.ulozeni + ' ' + h.zpravy.join(), '1 1 tvRozvrh');
  check('špatný → 400 a nic se nemění', h.volej('/api/tv-rozvrh', { rozvrh: { miky: [{ dny: [], cas: '18:00', akce: 'off' }] } }).s + ' ' + h.state.tvRozvrh.miky[0].cas, '400 18:00');
  h.volej('/api/tv-rozvrh/restore', { rozvrh: { miky: 'nesmysl' } });
  check('neplatná záloha nic nepřepíše', h.state.tvRozvrh.miky[0].cas, '18:00');
  h.volej('/api/tv-rozvrh/restore', { rozvrh: { miky: [{ dny: [7], cas: '09:00', akce: 'on' }], elenka: [] } });
  check('platná se obnoví', h.state.tvRozvrh.miky[0].cas, '09:00');
}

konec();
})();
