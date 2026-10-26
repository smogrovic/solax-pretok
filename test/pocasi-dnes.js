// Počasí na dnešek pro kalendář na iPadu: sloty po 3 h z předpovědi OWM,
// které se drží i po vypadnutí z odpovědi, a souhrn min/max/srážky.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('počasí dnes');

const CODE = [
  between('// ---------- Počasí na dnešek (kalendář na iPadu) ----------', '// Server na Renderu běží v UTC'),
  fn('function pragueTime('), fn('function pragueDateString(')
].join('\n');

function build(weather, { fetch = async () => { throw new Error('bez sítě'); } } = {}) {
  const state = { weather }, zpravy = [], routy = {};
  const api = new Function('state', 'broadcast', 'app', 'requireAuth', 'fetch', 'WEATHER_LAT', 'WEATHER_LON',
    CODE + '\n; return { pocasiPopis, pocasiSlotyUloz, pocasiDnes, pocasiDnesObnov, pocasiZOpenMeteo, refreshOpenMeteo, pocasiDnesVyber };')(
    state, (u, d) => zpravy.push({ u, d }), { get: (c, h) => { routy[c] = h; } }, () => true, fetch, 49.765, 14.688);
  const volej = async c => { let out; await routy[c]({}, { json: v => { out = v; } }); return out; };
  return { api, state, zpravy, volej };
}

// 23. 10. 2026 v Praze (UTC+2): sloty OWM jsou v UTC po 3 h
const H = 3600000;
const T = h => Date.UTC(2026, 9, 23, h - 2, 0, 0);   // h = pražská hodina
const slot = (h, temp, x = {}) => ({ dt: T(h) / 1000, main: { temp, feels_like: temp - 2 }, clouds: { all: x.clouds ?? 50 },
  weather: [{ id: x.kod ?? 800, icon: x.icon ?? '01d', description: 'jasno' }], pop: x.pop ?? 0, ...(x.rain ? { rain: { '3h': x.rain } } : {}) });

nadpis('Popis z odpovědi OWM');
{
  const { api } = build(null);
  check('pocitová, oblačnost, kód, noc, popis',
    JSON.stringify(api.pocasiPopis({ main: { feels_like: 3.2 }, clouds: { all: 75 }, weather: [{ id: 803, icon: '04n', description: 'oblačno' }] })),
    JSON.stringify({ pocitC: 3.2, oblacnost: 75, kod: 803, noc: true, popis: 'oblačno' }));
  check('chybějící pole = null', JSON.stringify(api.pocasiPopis({})), JSON.stringify({ pocitC: null, oblacnost: null, kod: null, noc: false, popis: null }));
}

nadpis('Souhrn na dnešek');
{
  const { api } = build({ tempC: 6, pocitC: 3, oblacnost: 40, kod: 801, noc: false, popis: 'skoro jasno', sunriseMs: T(7), sunsetMs: T(17) });
  api.pocasiSlotyUloz([slot(5, 2), slot(8, 4), slot(11, 9, { pop: 0.2 }), slot(14, 12, { pop: 0.7, rain: 1.6, kod: 500 }),
    slot(17, 10, { pop: 0.4, rain: 0.8 }), slot(20, 7), slot(23, 5, { icon: '01n' }), slot(26, 1)], '2026-10-23');
  const p = api.pocasiDnes(T(7) + 30 * 60000);
  check('teď z aktuálního počasí', p.ted.tempC + ' ' + p.ted.pocitC + ' ' + p.ted.popis, '6 3 skoro jasno');
  check('min/max z dnešních slotů (zítřek ne)', p.minC + ' / ' + p.maxC, '2 / 12');
  check('hodiny od běžícího slotu na 24 h', p.hodiny.map(h => new Date(h.t).getUTCHours() + 2).join(','), '5,8,11,14,17,20,23,2');
  check('srážky: max pravděpodobnost, součet, od kdy', JSON.stringify([p.srazky.pop, p.srazky.mm, p.srazky.od === T(14)]), '[70,2.4,true]');
  check('noc z ikony', p.hodiny[6].noc, true);
  check('slunce', p.vychodMs === T(7) && p.zapadMs === T(17), true);
  // Odpoledne: ranní sloty už v odpovědi nejsou, ale drží se → minimum zůstává
  api.pocasiSlotyUloz([slot(17, 10), slot(20, 7), slot(23, 5)], '2026-10-23');
  const p2 = api.pocasiDnes(T(16));
  check('vypadlé sloty se drží (min se nemění)', p2.minC, 2);
  check('  hodiny od teď na 24 h, i zítřek', p2.hodiny.map(h => new Date(h.t).getUTCHours() + 2).join(','), '14,17,20,23,2');
  check('  max/min jen za dnešek', p2.minC + ' / ' + p2.maxC, '2 / 12');
  {
    // 12 hodinových slotů → do appky jde nejvýš 8
    const b = build({ tempC: 1 });
    b.api.pocasiSlotyUloz(Array.from({ length: 12 }, (_, i) => ({ ...slot(0, 1), dt: (T(0) + i * H) / 1000 })), '2026-10-23');
    check('nejvýš 8 hodin', b.api.pocasiDnes(T(0)).hodiny.length, 8);
  }
  // Nový den: včerejšek zmizí
  api.pocasiSlotyUloz([], '2026-10-24');
  check('nový den: včerejšek pryč, zítřejší slot z minula platí', JSON.stringify([api.pocasiDnes(T(24 + 7)).hodiny.length, api.pocasiDnes(T(24 + 7)).minC, api.pocasiDnes(T(24 + 7)).maxC]), '[0,1,6]');
}
{
  // Drží se jen dnešek a zítřek — pozítří z dnešní odpovědi nepočká
  const { api } = build({ tempC: 4 });
  api.pocasiSlotyUloz([slot(8, 5), slot(48 + 8, -30)], '2026-10-23');
  api.pocasiSlotyUloz([], '2026-10-25');
  check('pozítří se neukládá', api.pocasiDnes(T(48 + 7)).minC, 4);
}
{
  const { api } = build(null);
  check('bez dat null', api.pocasiDnes(T(7)), null);
  const b = build({ tempC: 5 });
  b.api.pocasiDnesObnov();
  check('obnova pošle appce', b.zpravy[0].u + ' ' + b.state.pocasiDnes.ted.tempC, 'pocasiDnes 5');
  check('  bez slotů: srážky neznámé', JSON.stringify(b.state.pocasiDnes.srazky), '{"pop":null,"mm":0,"od":null}');
}
{
  // Předpověď se stahuje v každém běhu automatiky, ne jen u solinátoru (ten v zimě,
  // při sauně i s vypnutou automatikou skončí dřív a kalendář by zůstal bez hodin)
  const run = fn('async function runAutomation(');
  const i = run.indexOf('await refreshForecast();');
  check('předpověď v každém běhu, před vypínačem', i > 0 && i < run.indexOf('if (!autoRunning()) return'), true);
  const w = run.indexOf('await refreshOpenMeteo();');
  check('  Open-Meteo taky', w > 0 && w < run.indexOf('if (!autoRunning()) return'), true);
}

nadpis('Open-Meteo (hlavní zdroj, zdarma)');
(async () => {
  const ted = T(7) + 20 * 60000;
  const s = t => Math.floor(t / 1000);
  const hod = Array.from({ length: 48 }, (_, i) => T(0) + i * H);
  const OMJ = {
    current: { time: s(ted), temperature_2m: 6.2, apparent_temperature: 2.9, cloud_cover: 81, weather_code: 53, is_day: 1 },
    daily: { time: [s(T(0)), s(T(24))], temperature_2m_max: [13.4, 20], temperature_2m_min: [1.8, -5],
      sunrise: [s(T(7) - 600000), s(T(31))], sunset: [s(T(17) + 300000), s(T(41))] },
    hourly: { time: hod.map(s), temperature_2m: hod.map((_, i) => i * 0.5), precipitation_probability: hod.map((_, i) => (i === 12 ? 65 : i === 13 ? 35 : 5)),
      precipitation: hod.map((_, i) => (i === 12 ? 1.2 : 0)), weather_code: hod.map((_, i) => (i === 12 ? 63 : 3)), is_day: hod.map((_, i) => (i >= 7 && i < 17 ? 1 : 0)) }
  };
  const volani = [];
  const f = async url => { volani.push(url); return { ok: true, status: 200, json: async () => OMJ }; };
  const b = build({ tempC: 5 }, { fetch: f });
  const p = b.api.pocasiZOpenMeteo(OMJ, ted);
  check('teď: teplota, pocitová, oblačnost', [p.ted.tempC, p.ted.pocitC, p.ted.oblacnost].join(' '), '6.2 2.9 81');
  check('  WMO kód → ikona a popis česky', p.ted.kod + ' ' + p.ted.popis + ' ' + p.ted.noc, '301 Mrholení false');
  check('max/min z denní předpovědi dneška', p.maxC + ' / ' + p.minC, '13.4 / 1.8');
  check('hodiny: 24 h od této hodiny, přes půlnoc', p.hodiny.length + ' ' + (p.hodiny[0].t === T(7)) + ' ' + (p.hodiny[23].t === T(30)), '24 true true');
  check('  déšť ve 12:00', p.hodiny[5].kod + ' ' + p.hodiny[5].pop + ' ' + p.hodiny[5].mm, '501 65 1.2');
  check('  noc z is_day', p.hodiny.map(x => x.noc ? 'n' : 'd').join(''), 'dddddddddd' + 'n'.repeat(14));
  check('  max/min jen za dnešek (zítřek 20/−5 ne)', p.maxC + ' / ' + p.minC, '13.4 / 1.8');
  const vecer = b.api.pocasiZOpenMeteo(OMJ, T(22) + 20 * 60000);
  check('ve 22:20: od 22 h přes půlnoc do zítřka', vecer.hodiny.length + ' ' + (vecer.hodiny[0].t === T(22)) + ' ' + (vecer.hodiny[23].t === T(45)), '24 true true');
  check('srážky', JSON.stringify([p.srazky.pop, p.srazky.mm, p.srazky.od === T(12)]), '[65,1.2,true]');
  check('slunce a zdroj', (p.vychodMs === T(7) - 600000) + ' ' + (p.zapadMs === T(17) + 300000) + ' ' + p.zdroj, 'true true open-meteo');
  check('neznámý kód → oblačno', b.api.pocasiZOpenMeteo({ current: { temperature_2m: 1, weather_code: 42 } }, ted).ted.popis, 'Oblačno');
  check('v noci (is_day 0) noc', b.api.pocasiZOpenMeteo({ current: { temperature_2m: 1, weather_code: 0, is_day: 0 } }, ted).ted.noc, true);
  check('bouřka s kroupami', b.api.pocasiZOpenMeteo({ current: { temperature_2m: 1, weather_code: 99 } }, ted).ted.kod, 202);
  check('bez aktuálního počasí null', b.api.pocasiZOpenMeteo({}, ted), null);

  await b.api.refreshOpenMeteo(ted);
  const u = new URL(volani[0]);
  check('dotaz: Open-Meteo, domov, Praha, unix čas', [u.host, u.searchParams.get('latitude'), u.searchParams.get('longitude'),
    u.searchParams.get('timezone'), u.searchParams.get('timeformat')].join(' '), 'api.open-meteo.com 49.765 14.688 Europe/Prague unixtime');
  check('  bez klíče', /key|appid/i.test(volani[0]), false);
  check('  appka dostane data z Open-Meteo', b.state.pocasiDnes.zdroj + ' ' + b.zpravy.pop().u, 'open-meteo pocasiDnes');
  await b.api.refreshOpenMeteo(ted + 5 * 60000);
  check('  nejvýš jednou za 10 min', volani.length, 1);
  check('staré (> 30 min) → zpátky OpenWeather', b.api.pocasiDnesVyber(ted + 31 * 60000).zdroj, 'owm');
  const d = await b.volej('/api/pocasi/diagnostika');
  check('diagnostika', d.zdroj + ' ' + d.openMeteo.data + ' ' + d.openMeteo.posledni.stav, 'open-meteo true 200');
  const chyba = build({ tempC: 5 }, { fetch: async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '{"reason":"Too many requests"}' }) });
  await chyba.api.refreshOpenMeteo(ted);
  const dch = (await chyba.volej('/api/pocasi/diagnostika')).openMeteo.posledni;
  check('výpadek → OpenWeather dál, stav a důvod v diagnostice', dch.stav + ' ' + chyba.api.pocasiDnesVyber(ted).zdroj + ' ' + dch.chyba, '429 owm {"reason":"Too many requests"}');
  const sit = build({ tempC: 5 }, { fetch: async () => { throw new Error('getaddrinfo ENOTFOUND api.open-meteo.com'); } });
  await sit.api.refreshOpenMeteo(ted);
  check('  chyba sítě s textem', (await sit.volej('/api/pocasi/diagnostika')).openMeteo.posledni.chyba, 'getaddrinfo ENOTFOUND api.open-meteo.com');
  konec();
})();
