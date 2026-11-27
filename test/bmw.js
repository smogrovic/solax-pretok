// Ověření: BMW CarData — přihlášení přes kód (device flow s PKCE), obnova tokenu,
// propadlé přihlášení, příjem dat ze streamu i dotazu (bez polohy), shrnutí pro
// kartu, VIN a kontejner jen jednou, limit dotazů, stream s čerstvým tokenem
// a že tokeny nejdou do appky.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('bmw');

const CODE = between('// ---------- Auto BMW (BMW CarData) ----------', '// ---------- Sekačka Anthbot');

function jwt(obsah) {
  return 'x.' + Buffer.from(JSON.stringify(obsah)).toString('base64url') + '.y';
}

function build() {
  const h = { state: {}, routy: {}, log: [], zpravy: [], ulozeni: 0, dotazy: [], odpovedi: [], mqtt: [], casovace: [] };
  h.fetch = async (url, init = {}) => {
    const telo = init.body ? (String(init.body).startsWith('{') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : null;
    h.dotazy.push({ url: String(url), telo, hlavicky: init.headers || {} });
    const o = h.odpovedi.shift() || { status: 500, j: {} };
    return { status: o.status, json: async () => o.j };
  };
  const { EventEmitter } = require('events');
  const mqtt = { connect: (url, opt) => {
    const k = new EventEmitter();
    k.url = url; k.opt = opt; k.sub = []; k.subscribe = t => k.sub.push(t); k.end = () => { k.konec = true; };
    h.mqtt.push(k);
    return k;
  } };
  const req = n => (n === 'mqtt' ? mqtt : require(n));
  h.api = new Function('state', 'app', 'requireAuth', 'addLog', 'broadcast', 'storeUlozBrzy', 'fetch', 'require', 'setTimeout', 'clearTimeout',
    CODE + '\n; return { bmwPrijmi, bmwShrnuti, bmwPayload, bmwPrihlasitStart, bmwPrihlasitCekej, bmwObnovToken, bmwDotaz, bmwTik, bmwStreamPripoj,'
      + ' bmwHodnota, BMW_DOTAZ_MS, nastavPosledni: t => { bmwPosledniDotaz = t; } };'
  )(h.state, { post: (c, f) => { h.routy[c] = f; }, get: (c, f) => { h.routy[c] = f; } }, () => true, t => h.log.push(t),
    (typ, d) => h.zpravy.push([typ, d]), () => { h.ulozeni++; }, h.fetch, req,
    (f, ms) => { h.casovace.push([f, ms]); return h.casovace.length; }, () => {});
  h.volej = async (cesta, body) => {
    let out = null;
    const res = { status(s) { this.s = s; return this; }, json(j) { out = { s: this.s || 200, ...j }; return this; } };
    await h.routy[cesta]({ body }, res);
    return out;
  };
  return h;
}

(async () => {
nadpis('1) Přihlášení kódem');
{
  const h = build();
  check('špatné Client ID → 400', (await h.volej('/api/bmw/pripojit', { clientId: 'x' })).s, 400);
  h.odpovedi.push({ status: 200, j: { device_code: 'DEV', user_code: 'ABCD-EFGH', verification_uri_complete: 'https://bmw.example/link?c=ABCD', interval: 5, expires_in: 600 } });
  const r = await h.volej('/api/bmw/pripojit', { clientId: 'abcd1234-0000-4000-8000-000000000000' });
  const d = h.dotazy[0];
  check('kód: správná adresa a scope', d.url + ' | ' + d.telo.scope, 'https://customer.bmwgroup.com/gcdm/oauth/device/code | authenticate_user openid cardata:api:read cardata:streaming:read');
  check('  PKCE S256 a device_code', d.telo.code_challenge_method + ' ' + d.telo.response_type + ' ' + /^[A-Za-z0-9_-]{43}$/.test(d.telo.code_challenge), 'S256 device_code true');
  check('appka dostane kód a odkaz', r.bmw.cekani.userCode + ' ' + r.bmw.cekani.url, 'ABCD-EFGH https://bmw.example/link?c=ABCD');
  check('  a čeká se 5 s', h.casovace[0][1], 5000);
  h.odpovedi.push({ status: 400, j: { error: 'authorization_pending' } });
  check('ještě nepotvrzeno → čeká dál', await h.api.bmwPrihlasitCekej(), 'ceka');
  const t = h.dotazy[1];
  check('  token: grant a verifier k výzvě', t.telo.grant_type + ' ' + (require('crypto').createHash('sha256').update(t.telo.code_verifier).digest('base64url') === d.telo.code_challenge),
    'urn:ietf:params:oauth:grant-type:device_code true');
  h.odpovedi.push({ status: 400, j: { error: 'slow_down' } });
  await h.api.bmwPrihlasitCekej();
  check('  slow_down zpomalí o 5 s', h.casovace[h.casovace.length - 1][1], 10000);
  h.odpovedi.push({ status: 200, j: { access_token: 'AT', refresh_token: 'RT', id_token: jwt({ sub: 'GCID-1' }), expires_in: 3600 } });
  check('potvrzeno → hotovo', await h.api.bmwPrihlasitCekej(), 'hotovo');
  const o = h.state.bmwOauth;
  check('  tokeny a gcid z id_token', [o.access, o.refresh, o.gcid, o.clientId.slice(0, 8)].join(' '), 'AT RT GCID-1 abcd1234');
  check('  uložit a zapsat do logu', h.ulozeni > 0 && h.log.includes('BMW: auto připojené'), true);
  const p = JSON.stringify(h.api.bmwPayload());
  check('tokeny, Client ID ani gcid do appky nejdou', ['AT', 'RT', 'GCID', 'abcd1234', 'DEV'].some(x => p.includes(x)), false);
  check('  připojeno', h.api.bmwPayload().pripojeno, true);
}
{
  const h = build();
  h.odpovedi.push({ status: 200, j: { device_code: 'D', user_code: 'U', verification_uri: 'https://v', interval: 5, expires_in: 1 } });
  await h.api.bmwPrihlasitStart('abcdefgh-1234', 0);
  check('kód vyprší → chyba a nic nečeká', await h.api.bmwPrihlasitCekej(5000) + ' ' + h.api.bmwPayload().cekani + ' ' + /vypršel/.test(h.api.bmwPayload().chyba), 'vyprselo null true');
  h.odpovedi.push({ status: 401, j: { error: 'invalid_client' } });
  const r = await h.volej('/api/bmw/pripojit', { clientId: 'abcdefgh-1234' });
  check('BMW kód nevydá → 502 s radou', r.s + ' ' + /API i Streaming/.test(r.error), '502 true');
}

nadpis('2) Obnova tokenu');
{
  const h = build();
  h.state.bmwOauth = { clientId: 'cid12345', access: 'A1', refresh: 'R1', id: 'I1', gcid: 'G', exp: 1000000 + 30 * 60000, vin: 'V', kontejner: 'K' };
  check('dost času → bez dotazu', (await h.api.bmwObnovToken(1000000)) + ' ' + h.dotazy.length, 'true 0');
  h.odpovedi.push({ status: 200, j: { access_token: 'A2', refresh_token: 'R2', id_token: jwt({ sub: 'G' }), expires_in: 3600 } });
  check('10 min před koncem → obnoví', await h.api.bmwObnovToken(1000000 + 20 * 60000), true);
  check('  refresh_token grant, nové tokeny, VIN zůstane', h.dotazy[0].telo.grant_type + ' ' + h.state.bmwOauth.access + ' ' + h.state.bmwOauth.refresh + ' ' + h.state.bmwOauth.vin, 'refresh_token A2 R2 V');
  h.state.bmwOauth.exp = 0;
  h.odpovedi.push({ status: 400, j: { error: 'invalid_grant' } });
  check('propadlé přihlášení → odhlásí', await h.api.bmwObnovToken(5e6), false);
  check('  tokeny pryč, VIN a Client ID zůstanou, chyba', [h.state.bmwOauth.refresh, h.state.bmwOauth.clientId, h.state.bmwOauth.vin, h.api.bmwPayload().pripojeno, /vypršelo/.test(h.api.bmwPayload().chyba)].join(' '),
    ' cid12345 V false true');
  check('  propadlé přihlášení se zapíše do logu', h.log.some(t => /BMW: přihlášení k BMW vypršelo/.test(t)), true);
}

nadpis('3) Data z auta');
{
  const h = build();
  check('převod hodnot', [h.api.bmwHodnota('42'), h.api.bmwHodnota('2.5'), h.api.bmwHodnota('true'), JSON.stringify(h.api.bmwHodnota('[{"a":1}]')), h.api.bmwHodnota('LOCKED')].join(' '), '42 2.5 true [{"a":1}] LOCKED');
  const T = '2026-11-27T10:00:00Z';
  h.api.bmwPrijmi({
    'vehicle.drivetrain.lastRemainingRange': { value: '612', unit: 'km', timestamp: T },
    'vehicle.drivetrain.fuelSystem.level': { value: '68', unit: '%', timestamp: T },
    'vehicle.drivetrain.fuelSystem.remainingFuel': { value: '40', unit: 'l', timestamp: T },
    'vehicle.vehicle.travelledDistance': { value: '98412', unit: 'km', timestamp: T },
    'vehicle.cabin.door.lock.status': { value: 'SECURED', timestamp: T },
    'vehicle.cabin.window.row1.driver.status': { value: 'CLOSED', timestamp: T },
    'vehicle.cabin.window.row2.passenger.status': { value: 'INTERMEDIATE', timestamp: T },
    'vehicle.body.trunk.isOpen': { value: 'false', timestamp: T },
    'vehicle.chassis.axle.row1.wheel.left.tire.pressure': { value: '250', unit: 'kPa', timestamp: T },
    'vehicle.chassis.axle.row2.wheel.right.tire.pressure': { value: '2.7', unit: 'bar', timestamp: T },
    'vehicle.status.serviceDistance.next': { value: '8400', unit: 'km', timestamp: T },
    'vehicle.status.conditionBasedServices': { value: '[{"type":"OIL","status":"OK","dateTime":"2027-08-01T00:00:00Z"}]', timestamp: T },
    'vehicle.cabin.infotainment.navigation.currentLocation.latitude': { value: '50.1', timestamp: T },
    'vehicle.neznamy.udaj': { value: '1', timestamp: T }
  });
  check('poloha ani neznámé se neuloží', Object.keys(h.state.bmwHodnoty).some(k => /currentLocation|neznamy/.test(k)), false);
  const s = h.api.bmwShrnuti();
  check('shrnutí: dojezd, palivo, km', [s.dojezdKm, s.palivoPct, s.palivoL, s.km].join(' '), '612 68 40 98412');
  check('  zámek, otevřené okno', s.zamek + ' | ' + s.otevreno.join(','), 'zamčeno | okno vzadu vpravo');
  check('  pneu v barech (kPa převedené)', JSON.stringify(s.pneu), '{"lp":2.5,"pp":null,"lz":null,"pz":2.7}');
  check('  servis', s.servisKm + ' ' + JSON.stringify(s.servis), '8400 [{"typ":"OIL","stav":"OK","datum":"2027-08-01","km":null}]');
  check('  kdy', new Date(s.kdy).toISOString(), '2026-11-27T10:00:00.000Z');
  check('appka se dozví', h.zpravy.some(z => z[0] === 'bmw'), true);
  h.api.bmwPrijmi({ 'vehicle.drivetrain.fuelSystem.level': { value: '10', timestamp: '2026-11-26T10:00:00Z' } });
  check('starší údaj nepřepíše novější', h.api.bmwShrnuti().palivoPct, 68);
  h.api.bmwPrijmi({ 'vehicle.cabin.door.lock.status': { value: 'UNLOCKED', timestamp: '2026-11-27T11:00:00Z' },
    'vehicle.cabin.door.row1.driver.isOpen': { value: 'true', timestamp: '2026-11-27T11:00:00Z' } });
  check('odemčeno a otevřené dveře', h.api.bmwShrnuti().zamek + ' | ' + h.api.bmwShrnuti().otevreno.join(','), 'odemčeno | dveře řidič,okno vzadu vpravo');
}

nadpis('4) Dotaz: VIN a kontejner jednou, pak telematika');
{
  const h = build();
  h.state.bmwOauth = { clientId: 'cid12345', access: 'AT', refresh: 'RT', id: 'I', gcid: 'G', exp: Date.now() + 3600e3 };
  h.state.bmwHodnoty = {};
  h.odpovedi.push({ status: 200, j: [{ vin: 'WBA123', mappingType: 'PRIMARY' }] },
    { status: 200, j: { modelName: '420d Gran Coupé' } },
    { status: 400, j: { error: 'neznámý popisovač' } },
    { status: 201, j: { containerId: 'C1' } },
    { status: 200, j: { telematicData: { 'vehicle.vehicle.travelledDistance': { value: '98500', unit: 'km', timestamp: '2026-11-27T12:00:00Z' } } } });
  await h.api.bmwDotaz(1000);
  check('adresy', h.dotazy.map(d => d.url.replace('https://api-cardata.bmwgroup.com', '')).join(' | '),
    '/customers/vehicles/mappings | /customers/vehicles/WBA123/basicData | /customers/containers | /customers/containers | /customers/vehicles/WBA123/telematicData?containerId=C1');
  check('  hlavičky', h.dotazy[0].hlavicky.Authorization + ' ' + h.dotazy[0].hlavicky['x-version'], 'Bearer AT v1');
  check('  kontejner: napoprvé plný, pak jen ověřené', h.dotazy[2].telo.technicalDescriptors.length + ' ' + h.dotazy[3].telo.technicalDescriptors.length
    + ' ' + h.dotazy[3].telo.technicalDescriptors.includes('vehicle.drivetrain.lastRemainingRange'), '17 15 false');
  check('  data, VIN, model', h.api.bmwShrnuti().km + ' ' + h.state.bmwOauth.vin + ' ' + h.api.bmwPayload().model, '98500 WBA123 420d Gran Coupé');
  check('VIN do appky nejde', JSON.stringify(h.api.bmwPayload()).includes('WBA123'), false);
  h.dotazy.length = 0;
  h.odpovedi.push({ status: 200, j: { telematicData: {} } });
  await h.api.bmwDotaz(2000);
  check('podruhé jen telematika', h.dotazy.length, 1);
}

nadpis('5) Tik: limit dotazů a stream');
{
  const h = build();
  const now = Date.now();
  h.state.bmwOauth = { clientId: 'cid12345', access: 'AT', refresh: 'RT', id: 'IDT', gcid: 'G7', exp: now + 3600e3, vin: 'V', kontejner: 'K' };
  h.state.bmwHodnoty = {};
  h.odpovedi.push({ status: 200, j: { telematicData: {} } });
  await h.api.bmwTik(now);
  check('stream: adresa, gcid, heslo id_token', [h.mqtt[0].url, h.mqtt[0].opt.username, h.mqtt[0].opt.clientId, h.mqtt[0].opt.password].join(' '),
    'mqtts://customer.streaming-cardata.bmwgroup.com:9000 G7 G7 IDT');
  check('  první tik se zeptá', h.dotazy.length, 1);
  await h.api.bmwTik(now + 60e3);
  check('  hned další už ne (limit 50/den)', h.dotazy.length + ' ' + h.mqtt.length, '1 1');
  h.mqtt[0].emit('connect');
  check('  přihlášení k topicu gcid/+ a appka vidí spojeno', h.mqtt[0].sub.join() + ' ' + h.api.bmwPayload().stream, 'G7/+ true');
  h.mqtt[0].emit('message', 'G7/V', Buffer.from(JSON.stringify({ vin: 'V', data: { 'vehicle.drivetrain.fuelSystem.level': { value: 55, timestamp: new Date(now).toISOString() } } })));
  check('  zpráva ze streamu se ukáže', h.api.bmwShrnuti().palivoPct, 55);
  h.mqtt[0].emit('message', 'G7/V', Buffer.from('nesmysl'));
  check('  nečitelná zpráva nic nerozbije', h.api.bmwShrnuti().palivoPct, 55);
  h.state.bmwOauth.id = 'IDT2';
  h.mqtt[0].emit('close');
  check('  po výpadku odpojeno a za 30 s znovu', h.api.bmwPayload().stream + ' ' + h.casovace[h.casovace.length - 1][1], 'false 30000');
  await h.casovace[h.casovace.length - 1][0]();
  check('  znovu s čerstvým id_token', h.mqtt.length + ' ' + h.mqtt[1].opt.password, '2 IDT2');
  await h.api.bmwTik(now + h.api.BMW_DOTAZ_MS + 1000);
  check('za 3 h zase dotaz', h.dotazy.length, 2);
}
{
  const h = build();
  await h.api.bmwTik();
  check('nepřipojené → nic', h.dotazy.length + ' ' + h.mqtt.length, '0 0');
}

nadpis('5b) Co auto posílá (jen názvy)');
{
  const h = build();
  h.state.bmwHodnoty = {};
  const T = '2026-11-27T10:00:00Z';
  h.api.bmwPrijmi({ 'vehicle.cabin.infotainment.navigation.currentLocation.latitude': { value: '50.123', unit: 'deg', timestamp: T },
    'vehicle.drivetrain.fuelSystem.level': { value: '60', unit: '%', timestamp: T },
    'vehicle.status.checkControlMessages': { value: '[{"type":"ADBLUE"}]', timestamp: T } }, 1000);
  h.api.bmwPrijmi({ 'vehicle.drivetrain.fuelSystem.level': { value: '59', unit: '%', timestamp: T }, 'divny klic!': { value: 1 } }, 2000);
  const r = await h.volej('/api/bmw/popisovace');
  check('zaznamená i neukládaná pole, neplatný název ne', r.popisovace.map(x => x.nazev.split('.').pop()).join(','), 'latitude,level,checkControlMessages');
  check('  typ, jednotka, počet, kdy', JSON.stringify(r.popisovace[1]), '{"nazev":"vehicle.drivetrain.fuelSystem.level","n":2,"od":1000,"t":2000,"typ":"číslo","u":"%"}');
  check('  žádné hodnoty (ani poloha)', /50\.123|ADBLUE|"59"|"60"/.test(JSON.stringify(r)), false);
  check('  poloha se mezi hodnoty neuloží', Object.keys(h.state.bmwHodnoty).some(k => /Location/.test(k)), false);
  check('  uloží se do zálohy stavu', h.ulozeni > 0, true);
}

nadpis('6) Odpojení');
{
  const h = build();
  h.state.bmwOauth = { clientId: 'c', refresh: 'R' };
  h.state.bmwHodnoty = { 'vehicle.vehicle.travelledDistance': { v: 1, t: 1 } };
  const r = await h.volej('/api/bmw/odpojit', {});
  check('smaže přihlášení i data', [r.s, h.state.bmwOauth, Object.keys(h.state.bmwHodnoty).length, r.bmw.pripojeno].join(' '), '200  0 false');
}

konec();
})();
