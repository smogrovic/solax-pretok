// Počasí na dnešek pro kalendář na iPadu: sloty po 3 h z předpovědi OWM,
// které se drží i po vypadnutí z odpovědi, a souhrn min/max/srážky.
const crypto = require('crypto');
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('počasí dnes');

const CODE = [
  between('// ---------- Počasí na dnešek (kalendář na iPadu) ----------', '// Server na Renderu běží v UTC'),
  fn('function pragueTime('), fn('function pragueDateString(')
].join('\n');

function build(weather, { env = {}, fetch = async () => { throw new Error('bez sítě'); } } = {}) {
  const state = { weather }, zpravy = [], routy = {};
  const api = new Function('state', 'broadcast', 'app', 'requireAuth', 'process', 'crypto', 'fetch', 'WEATHER_LAT', 'WEATHER_LON',
    CODE + '\n; return { pocasiPopis, pocasiSlotyUloz, pocasiDnes, pocasiDnesObnov, pocasiZWeatherKit, weatherkitJwt, refreshWeatherKit, pocasiDnesVyber };')(
    state, (u, d) => zpravy.push({ u, d }), { get: (c, h) => { routy[c] = h; } }, () => true, { env }, require('crypto'), fetch, 49.765, 14.688);
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
  check('hodiny od běžícího slotu, jen dnes', p.hodiny.map(h => new Date(h.t).getUTCHours() + 2).join(','), '5,8,11,14,17,20,23');
  check('srážky: max pravděpodobnost, součet, od kdy', JSON.stringify([p.srazky.pop, p.srazky.mm, p.srazky.od === T(14)]), '[70,2.4,true]');
  check('noc z ikony', p.hodiny[6].noc, true);
  check('slunce', p.vychodMs === T(7) && p.zapadMs === T(17), true);
  // Odpoledne: ranní sloty už v odpovědi nejsou, ale drží se → minimum zůstává
  api.pocasiSlotyUloz([slot(17, 10), slot(20, 7), slot(23, 5)], '2026-10-23');
  const p2 = api.pocasiDnes(T(16));
  check('vypadlé sloty se drží (min se nemění)', p2.minC, 2);
  check('  hodiny jen od teď', p2.hodiny.map(h => new Date(h.t).getUTCHours() + 2).join(','), '14,17,20,23');
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
  const w = run.indexOf('await refreshWeatherKit();');
  check('  Apple taky', w > 0 && w < run.indexOf('if (!autoRunning()) return'), true);
}

nadpis('Apple WeatherKit (jako iPhone)');
(async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const ENV = { WEATHERKIT_TEAM_ID: 'TEAM123', WEATHERKIT_KEY_ID: 'KEY456', WEATHERKIT_SERVICE_ID: 'cz.domov.pocasi',
    WEATHERKIT_KEY: pem.replace(/\n/g, '\\n') };   // v Renderu jako jeden řádek s \n
  const iso = t => new Date(t).toISOString();
  const ted = T(7) + 20 * 60000;
  const WKJ = {
    currentWeather: { asOf: iso(ted), temperature: 6.2, temperatureApparent: 2.9, cloudCover: 0.81, conditionCode: 'Drizzle', daylight: true },
    forecastDaily: { days: [{ forecastStart: iso(T(0)), temperatureMax: 13.4, temperatureMin: 1.8, sunrise: iso(T(7) - 10 * 60000), sunset: iso(T(17) + 5 * 60000) },
      { forecastStart: iso(T(24)), temperatureMax: 20, temperatureMin: -5 }] },
    forecastHourly: { hours: Array.from({ length: 30 }, (_, i) => ({ forecastStart: iso(T(5) + i * H), temperature: 2 + i * 0.5,
      precipitationChance: i === 7 ? 0.65 : i === 8 ? 0.35 : 0.05, precipitationAmount: i === 7 ? 1.2 : 0, conditionCode: i === 7 ? 'Rain' : 'Cloudy',
      daylight: i >= 2 && i < 12 })) }
  };
  const volani = [];
  const f = async (url, opts) => { volani.push({ url, opts }); return { ok: true, status: 200, json: async () => WKJ }; };
  const b = build({ tempC: 5 }, { env: ENV, fetch: f });
  const p = b.api.pocasiZWeatherKit(WKJ, ted);
  check('teď: teplota, pocitová, oblačnost', [p.ted.tempC, p.ted.pocitC, p.ted.oblacnost].join(' '), '6.2 2.9 81');
  check('  kód a popis česky', p.ted.kod + ' ' + p.ted.popis + ' ' + p.ted.noc, '300 Mrholení false');
  check('max/min z denní předpovědi dneška', p.maxC + ' / ' + p.minC, '13.4 / 1.8');
  check('hodiny od této hodiny, jen dnes, nejvýš 12', p.hodiny.length + ' ' + (p.hodiny[0].t === T(7)), '12 true');
  check('  déšť v 12:00', p.hodiny[5].kod + ' ' + p.hodiny[5].pop + ' ' + p.hodiny[5].mm, '500 65 1.2');
  check('  noc z daylight', p.hodiny.map(h => h.noc ? 'n' : 'd').join(''), 'ddddddddddnn');
  check('srážky', JSON.stringify([p.srazky.pop, p.srazky.mm, p.srazky.od === T(12)]), '[65,1.2,true]');
  check('slunce a zdroj', (p.vychodMs === T(7) - 600000) + ' ' + (p.zapadMs === T(17) + 300000) + ' ' + p.zdroj, 'true true apple');
  check('neznámý kód → oblačno', b.api.pocasiZWeatherKit({ currentWeather: { temperature: 1, conditionCode: 'Nové' } }, ted).ted.popis, 'Oblačno');
  check('bez aktuálního počasí null', b.api.pocasiZWeatherKit({}, ted), null);

  // JWT podle Applu: ES256, kid, id = TEAM.SERVICE, ověřitelný veřejným klíčem
  const jwt = b.api.weatherkitJwt(ted);
  const [h64, p64, s64] = jwt.split('.');
  const hl = JSON.parse(Buffer.from(h64, 'base64url')), pl = JSON.parse(Buffer.from(p64, 'base64url'));
  check('JWT hlavička', JSON.stringify(hl), '{"alg":"ES256","kid":"KEY456","id":"TEAM123.cz.domov.pocasi"}');
  check('  payload', [pl.iss, pl.sub, pl.exp - pl.iat].join(' '), 'TEAM123 cz.domov.pocasi 3600');
  check('  podpis sedí', crypto.verify('sha256', Buffer.from(h64 + '.' + p64), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url')), true);
  check('  znovu použitý', b.api.weatherkitJwt(ted + 60000) === jwt, true);

  await b.api.refreshWeatherKit(ted);
  check('stažení: adresa a token', /^https:\/\/weatherkit\.apple\.com\/api\/v1\/weather\/cs\/49\.765\/14\.688\?dataSets=currentWeather,forecastHourly,forecastDaily&timezone=Europe\/Prague$/.test(volani[0].url)
    + ' ' + (volani[0].opts.headers.Authorization === 'Bearer ' + jwt), 'true true');
  check('  appka dostane data z Applu', b.state.pocasiDnes.zdroj + ' ' + b.zpravy.pop().u, 'apple pocasiDnes');
  await b.api.refreshWeatherKit(ted + 5 * 60000);
  check('  nejvýš jednou za 10 min', volani.length, 1);
  check('staré (> 30 min) → zpátky OpenWeather', b.api.pocasiDnesVyber(ted + 31 * 60000).zdroj, 'owm');
  const d = await b.volej('/api/pocasi/diagnostika');
  check('diagnostika', d.zdroj + ' ' + d.weatherkit.zapnuto + ' ' + d.weatherkit.posledni.stav, 'apple true 200');
  const vse = JSON.stringify(d) + JSON.stringify(b.state);
  check('  klíč ani token nikde', vse.includes('PRIVATE') || vse.includes(s64) || vse.includes('KEY456'), false);

  const bez = build({ tempC: 5 }, { fetch: f });
  await bez.api.refreshWeatherKit(ted);
  check('bez klíčů se Apple nevolá', volani.length, 1);
  const chyba = build({ tempC: 5 }, { env: ENV, fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await chyba.api.refreshWeatherKit(ted);
  check('401 → OpenWeather dál, stav v diagnostice', (await chyba.volej('/api/pocasi/diagnostika')).weatherkit.posledni.stav + ' ' + chyba.api.pocasiDnesVyber(ted).zdroj, '401 owm');
  konec();
})();
