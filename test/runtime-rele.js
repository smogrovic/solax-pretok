// Ostrý běh: relé přestane hlásit (cloud vrací online:false a poslední známé
// „zapnuto"). Doba běhu i pruh na časové ose musí ještě dojet do konce časovače
// v relé a pak SKONČIT — dřív rostly donekonečna. A ze zmrzlého příkonu se
// nesmí přičítat kilowatthodiny.
const fs = require('fs');
const path = require('path');
const SERVER = path.join(__dirname, '..', 'server.js');
const tmp = path.join(__dirname, '..', 'server_rele_tmp.js');

// Časovač v relé zkrácen na 6 s, ať test netrvá čtvrt hodiny. Keepalive z něj
// vychází (čtvrtina), takže se zkrátí sám.
const SRC = fs.readFileSync(SERVER, 'utf8')
  .replace('const POLL_INTERVAL_MS = 2 * 60 * 1000;', 'const POLL_INTERVAL_MS = 1000;')
  .replace('const SHELLY_GAP_MS = 1000;', 'const SHELLY_GAP_MS = 10;')
  .replace('const CACHE_TTL_MS = 5000;', 'const CACHE_TTL_MS = 10;')
  .replace('const RELAY_AUTO_OFF_MS = 15 * 60 * 1000;', 'const RELAY_AUTO_OFF_MS = 6000;')
  .replace('scheduleEvery(pollShelly, POLL_INTERVAL_MS, 20000);', 'scheduleEvery(pollShelly, POLL_INTERVAL_MS, 200);')
  .replace('scheduleEvery(runAutomation, AUTOMATION_INTERVAL_MS, 110000);', 'scheduleEvery(runAutomation, 3600000, 3600000);')
  .replace('scheduleEvery(sendKeepalive, KEEPALIVE_MS, 90000);', 'scheduleEvery(sendKeepalive, KEEPALIVE_MS, 300);');
fs.writeFileSync(tmp, SRC);

process.env.PORT = '3994';
process.env.SHELLY_AUTH_KEY = 'key';
process.env.SHELLY_SERVER_URI = 'shelly-test.local';
process.env.SHELLY_DEVICE_ID = 'boiler1';
process.env.POOL_DEVICE_ID = 'pool1';
process.env.SOLINATOR_DEVICE_ID = 'sol1';
process.env.SAUNA_DEVICE_ID = '';
process.env.OWM_API_KEY = '';
process.env.UPSTASH_REDIS_REST_URL = '';

const rele = { pool1: true, sol1: false, boiler1: true };
let cloudOnline = true;          // od kdy relé přestane hlásit
const povely = [];
const puvodni = globalThis.fetch;

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const body = opts && opts.body ? String(opts.body) : '';
  const id = (body.match(/(?:^|&)id=([^&]+)/) || [])[1];
  const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });

  if (u.includes('/device/relay/control')) {
    const turn = (body.match(/turn=(\w+)/) || [])[1];
    povely.push({ id, turn, t: Date.now() });
    // Odpojené relé povel nedostane — cloud ho odmítne
    if (!cloudOnline && (id === 'pool1' || id === 'boiler1')) return json({ isok: false });
    if (id in rele) rele[id] = turn === 'on';
    return json({ isok: true });
  }
  if (u.includes('/device/status')) {
    if ((id === 'pool1' || id === 'boiler1') && !cloudOnline) {
      // Přesně to, co dělá Shelly cloud u odpojeného relé: online:false
      // a k tomu POSLEDNÍ ZNÁMÝ stav — tedy „zapnuto" i s příkonem
      return json({ isok: true, data: { online: false,
        device_status: { 'switch:0': { output: true, apower: 1800 } } } });
    }
    if (id in rele) {
      return json({ isok: true, data: { online: true,
        device_status: { 'switch:0': { output: rele[id], apower: rele[id] ? 1800 : 0 } } } });
    }
    return json({ isok: true, data: { online: true, device_status: { 'pm1:0': { apower: 0 } } } });
  }
  throw new Error('mimo test: ' + u);
};

require(tmp);

const spanek = ms => new Promise(r => setTimeout(r, ms));
const snap = async () => {
  const res = await puvodni('http://127.0.0.1:3994/api/stream', { headers: { Accept: 'text/event-stream' } });
  const reader = res.body.getReader();
  const { value } = await reader.read();
  reader.cancel();
  const text = new TextDecoder().decode(value);
  return JSON.parse(text.slice(text.indexOf('data: ') + 6).split('\n')[0]);
};
const konecOsy = s => {
  const segs = (s.timeline && s.timeline.pool) || [];
  return segs.length ? segs[segs.length - 1].to : 0;
};

(async () => {
  const vysledky = [];
  const ok = (popis, podminka) => vysledky.push([popis, !!podminka]);

  // 1) Relé hlásí a běží — účtuje se
  await spanek(3000);
  const a = await snap();
  ok('běžící relé se účtuje', a.runtime.ms.pool > 0);
  ok('  a je na časové ose', konecOsy(a) > 0);
  ok('  a bere kWh z měření', a.runtime.wh.b1 > 0);

  // 2) Relé zmizí. Cloud dál tvrdí „zapnuto" — dřív to účtovalo navěky.
  cloudOnline = false;
  const vypadek = Date.now();
  await spanek(2500);                     // pořád uvnitř časovače v relé
  const b = await snap();
  ok('hned po výpadku se účtuje dál', b.runtime.ms.pool > a.runtime.ms.pool);
  ok('  protože relé má ještě napájení', Date.now() - vypadek < 6000);

  // 3) Časovač v relé doběhl → musí to přestat růst
  await spanek(6000);
  const c = await snap();
  await spanek(3000);
  const d = await snap();
  ok('po doběhnutí časovače doba běhu neroste', d.runtime.ms.pool === c.runtime.ms.pool);
  ok('  a ani pruh na časové ose', konecOsy(d) === konecOsy(c));
  ok('  celkem to nejelo víc než časovač navíc',
    d.runtime.ms.pool - a.runtime.ms.pool <= 8000);

  // 4) Zmrzlý příkon nesmí vyrábět kilowatthodiny. Cloud u odpojeného bojleru dál
  // vrací 1800 W — dřív se z toho účtovalo, dokud server běžel.
  ok('ze zmrzlého příkonu se kWh nepřičítají', d.runtime.wh.b1 === c.runtime.wh.b1);
  ok('  a nepřičítaly se ani hned po výpadku', c.runtime.wh.b1 === b.runtime.wh.b1);

  // 5) Appka se dozví, dokdy to relé ještě drží
  ok('stav relé nese čas samovypnutí', typeof (d.devices.pool || {}).offBy === 'number');

  // 6) Relé se vrátí → účtování naskočí zpátky
  cloudOnline = true;
  rele.pool1 = true;
  await spanek(3000);
  const e = await snap();
  ok('po návratu se zase účtuje', e.runtime.ms.pool > d.runtime.ms.pool);

  console.log();
  let bad = 0;
  for (const [popis, dobre] of vysledky) {
    if (!dobre) bad++;
    console.log(`${dobre ? 'OK ' : 'CHYBA'} ${popis}`);
  }
  console.log(`  (povelů celkem: ${povely.length})`);
  fs.unlinkSync(tmp);
  process.exit(bad ? 1 : 0);
})();
