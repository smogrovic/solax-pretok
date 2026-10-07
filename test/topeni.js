// Data o topení: hodinové průměry venku, v pokojích a odhad topení ze spotřeby domu.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('topení');

const CODE = [
  fn('function pragueTime(at) {'),
  fn('function pragueDateString(at) {'),
  fn('function cerstve(ts, maxAgeMs = DATA_MAX_AGE_MS) {'),
  between('// ---------- Topení v domě', '// ---------- Sauna ----------')
].join('\n');

const HOD = 3600000;
function build(now) {
  const state = { topeni: { bezici: null, zaznamy: [] }, sensors: {}, weather: null, aircon: null };
  const zpravy = [];
  const routy = {};
  const realNow = Date.now;
  const api = new Function('state', 'broadcast', 'app', 'requireAuth', 'SENSOR_SILENCE_LOG_MS', 'DATA_MAX_AGE_MS',
    CODE + '\n; return { topeniOdhadW, topeniVzorek, topeniUzavri, topeniSouhrn, topeniPayload, topeniObnov,'
         + ' topeniNavod, TOPENI_ZAKLAD_W, TOPENI_VARENI_W, TOPENI_MIN_VZORKU, TOPENI_DNU };'
  )(state, (u, d) => zpravy.push({ u, d }), { get: (c, f) => { routy[c] = f; } }, () => true,
    6 * HOD, 10 * 60000);
  return { state, zpravy, api, routy, realNow };
}

nadpis('1) Odhad topení');
{
  const { api } = build();
  check('přes den: dům − bojlery − sauna − 400', api.topeniOdhadW(3000, 1000, 0, 10), 1600);
  check('večer se odečte i vaření', api.topeniOdhadW(3000, 1000, 0, 18), 1100);
  check('  od 17 h', api.topeniOdhadW(3000, 0, 0, 17), 2100);
  check('  ve 20 h už ne', api.topeniOdhadW(3000, 0, 0, 20), 2600);
  check('  v 16 h ještě ne', api.topeniOdhadW(3000, 0, 0, 16), 2600);
  check('sauna se odečte', api.topeniOdhadW(9000, 0, 6000, 10), 2600);
  check('pod nulu nejde', api.topeniOdhadW(300, 0, 0, 10), 0);
  check('bez spotřeby není odhad', api.topeniOdhadW(null, 0, 0, 10), 'null');
}

nadpis('2) Hodina se sbírá a uzavře');
{
  const { state, zpravy, api } = build();
  const T0 = Math.floor(Date.now() / HOD) * HOD - 3 * HOD;   // před třemi hodinami
  state.weather = { tempC: 4, fetchedAt: new Date().toISOString() };
  state.sensors = { obyvak: { tempC: 21.5, reportedAt: Date.now() }, miky: { tempC: 20.5, reportedAt: Date.now() },
    loznice: { tempC: 30, reportedAt: T0 - 7 * HOD } };
  state.aircon = { fetchedAt: new Date().toISOString(),
    devices: [{ power: true, mode: 'heat' }, { power: true, mode: 'cool' }, { power: false, mode: 'heat' }],
    aquarea: [{ zones: [{ on: true }] }] };
  for (let i = 0; i < 30; i++) api.topeniVzorek({ dumW: i < 15 ? 2000 : 3000, bojleryW: 0, saunaW: null }, T0 + i * 120000);
  check('během hodiny se nic nezapíše', state.topeni.zaznamy.length, 0);
  api.topeniVzorek({ dumW: 500, bojleryW: 0, saunaW: 0 }, T0 + HOD + 1000);
  const z = state.topeni.zaznamy[0];
  check('přechod hodiny ji uzavře', state.topeni.zaznamy.length, 1);
  check('  čas = začátek hodiny', z.t, T0);
  check('  průměr spotřeby', z.dumW, 2500);
  check('  počet vzorků', z.n, 30);
  check('  venku', z.venkuC, 4);
  check('  pokoje jen s čerstvým čidlem', JSON.stringify(z.pokoje), '{"obyvak":21.5,"miky":20.5}');
  check('  topící klimatizace', z.klimaTopi, 1);
  check('  Aquarea topí', z.aqTopi, 1);
  check('  sauna bez dat chybí', 'saunaW' in z, false);
  const hodPraha = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false }).format(T0)) % 24;
  check('  odhad topení podle pražské hodiny', z.topeniW, api.topeniOdhadW(2500, 0, null, hodPraha));
  check('appka dostala souhrn', zpravy.some(m => m.u === 'topeni' && m.d.topeni.hodin === 1), true);
  check('nová hodina běží', state.topeni.bezici.t, T0 + HOD);

  // Hodina s pár vzorky (restart, výpadek střídače) se zahodí
  const { state: s2, api: a2 } = build();
  for (let i = 0; i < 5; i++) a2.topeniVzorek({ dumW: 2000 }, T0 + i * 60000);
  for (let i = 0; i < 20; i++) a2.topeniVzorek({ dumW: null }, T0 + 600000 + i * 60000);
  a2.topeniVzorek({ dumW: 2000 }, T0 + HOD);
  check('málo vzorků spotřeby = hodina se zahodí', s2.topeni.zaznamy.length, 0);
}

nadpis('3) Souhrn, ořez a obnova');
{
  const { state, api } = build();
  const ted = Date.now();
  const h0 = Math.floor(ted / HOD) * HOD;
  state.topeni.zaznamy = [
    { t: h0 - (api.TOPENI_DNU + 1) * 24 * HOD, n: 30, dumW: 1000, topeniW: 600 },
    { t: h0 - 2 * HOD, n: 30, dumW: 1400, topeniW: 1000, venkuC: 2, pokoje: { obyvak: 21, miky: 23 } },
    { t: h0 - HOD, n: 30, dumW: 1900, topeniW: 1500, venkuC: 4, pokoje: { obyvak: 21 } }
  ];
  for (let i = 0; i < 12; i++) api.topeniVzorek({ dumW: 1000 }, h0 + i * 60000);
  api.topeniVzorek({ dumW: 1000 }, h0 + HOD);
  check('drží se rok', api.TOPENI_DNU, 365);
  check('starší než rok vypadne', state.topeni.zaznamy.every(r => r.t > ted - api.TOPENI_DNU * 24 * HOD), true);
  check('souhrn sečte kWh', api.topeniSouhrn([{ t: h0, topeniW: 1000 }, { t: h0 + 0, topeniW: 1500 }])[0].topeniKwh, 2.5);
  check('  průměr venku', api.topeniSouhrn([{ t: h0, venkuC: 2 }, { t: h0, venkuC: 4 }])[0].venkuC, 3);
  check('  průměr doma přes pokoje', api.topeniSouhrn([{ t: h0, pokoje: { a: 21, b: 23 } }, { t: h0, pokoje: { a: 21 } }])[0].pokojeC, 21.5);
  check('  počet hodin', api.topeniSouhrn([{ t: h0 }, { t: h0 }])[0].hodin, 2);
  const mnoho = [];
  for (let d = 0; d < 30; d++) mnoho.push({ t: h0 - d * 24 * HOD, topeniW: 100 });
  check('souhrn jen 14 dní', api.topeniSouhrn(mnoho.reverse()).length, 14);

  const pred = state.topeni.zaznamy.length;
  api.topeniObnov({ zaznamy: [
    { t: h0 - 2 * HOD, n: 10, dumW: 1 },            // méně vzorků — nepřepíše
    { t: h0 - 5 * HOD, n: 25, dumW: 1200 },         // nová hodina
    { t: h0 - 3 * HOD + 5, n: 25 },                 // necelá hodina — nesmysl
    { t: h0 + 5 * HOD, n: 25 },                     // budoucnost
    { t: h0 - 4 * HOD }                             // bez vzorků
  ] });
  check('obnova přidá jen platnou novou hodinu', state.topeni.zaznamy.length, pred + 1);
  check('  méně vzorků nepřepíše', state.topeni.zaznamy.find(r => r.t === h0 - 2 * HOD).dumW, 1400);
  check('  řazeno podle času', state.topeni.zaznamy.every((r, i, a) => !i || a[i - 1].t < r.t), true);
  api.topeniObnov({ zaznamy: [{ t: h0 - 2 * HOD, n: 40, dumW: 1450 }] });
  check('víc vzorků přepíše', state.topeni.zaznamy.find(r => r.t === h0 - 2 * HOD).dumW, 1450);
  check('obnova bez zaznamy selže', api.topeniObnov({}), false);
}

nadpis('4) Návod pro AI');
{
  const { api } = build();
  const t = api.topeniNavod().join('\n');
  check('je to pole řádků', Array.isArray(api.topeniNavod()), true);
  check('stálý odběr z modelu', t.includes(api.TOPENI_ZAKLAD_W + ' W stálý odběr'), true);
  check('vaření z modelu', t.includes(api.TOPENI_VARENI_W + ' W v hodinách 17:00–20:00'), true);
  check('minimum vzorků z kódu', t.includes('méně než ' + api.TOPENI_MIN_VZORKU + ' vzorky'), true);
  check('zmiňuje cyklování', /cykluje/.test(t), true);
  check('radí denní součty', /denními součty/.test(t), true);
  check('upozorní na COP', /COP/.test(t), true);
  check('časové pásmo', /Europe\/Prague/.test(t), true);
}

nadpis('4) Napojení');
{
  const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  check('vzorek se bere v updateRuntimes', /topeniVzorek\(\{\s*dumW: podil \? podil\.dumW : null/.test(SRC), true);
  check('do appky jde souhrn', /topeni: topeniPayload\(\),/.test(SRC), true);
  check('ukládá se do vlastního klíče', /storeTopeniUloz\(\)/.test(SRC) && /:topeni`/.test(SRC), true);
  check('po startu se načte', /await storeTopeniNacti\(\)/.test(SRC), true);
  check('návod jde v odpovědi první', /res\.json\(\{ navod: topeniNavod\(\), model: topeniModel\(\), zaznamy/.test(SRC), true);
  check('celá řada jen přes zámek', /app\.get\('\/api\/topeni', \(req, res\) => \{\s*if \(!requireAuth/.test(SRC), true);
}

konec();
