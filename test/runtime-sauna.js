// Ostrý běh serveru: sauna začne topit → bazén i solinátor musí dolů a zůstat dole,
// i když je někdo zapne ručně nebo běží bazénové „+24 h".
const fs = require('fs');
const path = require('path');
const SERVER = path.join(__dirname, '..', 'server.js');
const tmp = path.join(__dirname, '..', 'server_test_tmp.js');

const SRC = fs.readFileSync(SERVER, 'utf8')
  .replace('const POLL_INTERVAL_MS = 2 * 60 * 1000;', 'const POLL_INTERVAL_MS = 1500;')
  .replace('const SHELLY_GAP_MS = 1000;', 'const SHELLY_GAP_MS = 10;')
  .replace('const CACHE_TTL_MS = 5000;', 'const CACHE_TTL_MS = 10;')
  .replace('scheduleEvery(pollShelly, POLL_INTERVAL_MS, 20000);', 'scheduleEvery(pollShelly, POLL_INTERVAL_MS, 200);')
  // Automatika schválně JEN po 15 s: co se stane dřív, musí přijít z pollu sauny
  .replace('scheduleEvery(runAutomation, AUTOMATION_INTERVAL_MS, 110000);', 'scheduleEvery(runAutomation, 15000, 500);')
  .replace('scheduleEvery(sendKeepalive, KEEPALIVE_MS, 90000);', 'scheduleEvery(sendKeepalive, 1500, 1000);');
fs.writeFileSync(tmp, SRC);

process.env.PORT = '3996';
process.env.SHELLY_AUTH_KEY = 'key';
process.env.SHELLY_SERVER_URI = 'shelly-test.local';
process.env.SHELLY_DEVICE_ID = 'boiler1';
process.env.POOL_DEVICE_ID = 'pool1';
process.env.SOLINATOR_DEVICE_ID = 'sol1';
process.env.SAUNA_DEVICE_ID = 'sauna1';
process.env.OWM_API_KEY = '';

let saunaW = 20;                 // sauna zatím netopí
const rele = { pool1: true, sol1: true, boiler1: false };
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
    if (id in rele) rele[id] = turn === 'on';
    return json({ isok: true });
  }
  if (u.includes('/device/status')) {
    if (id === 'sauna1') {
      return json({ isok: true, data: { online: true, device_status: { 'em:0': { total_act_power: saunaW } } } });
    }
    if (id in rele) {
      return json({ isok: true, data: { online: true, device_status: { 'switch:0': { output: rele[id], apower: rele[id] ? 1000 : 0 } } } });
    }
    return json({ isok: true, data: { online: true, device_status: { 'pm1:0': { apower: 0 } } } });
  }
  throw new Error('mimo test: ' + u);
};

require(tmp);

const spanek = ms => new Promise(r => setTimeout(r, ms));
const proId = (id, turn, od = 0) => povely.filter(p => p.id === id && p.turn === turn && p.t >= od);

(async () => {
  await spanek(3000);
  const vysledky = [];
  const ok = (popis, podminka) => vysledky.push([popis, !!podminka]);

  // Sauna se rozjede a obě relé zrovna běží. Automatika je až za 15 s, takže OFF
  // musí přijít z pollu sauny — jinak by se čekalo minuty.
  const start = Date.now();
  saunaW = 6200;
  rele.pool1 = true;
  rele.sol1 = true;
  await spanek(4500);
  const prvni = proId('pool1', 'off', start)[0];
  ok('sauna začne topit → bazén dostane OFF', !!prvni);
  ok('  a je to do dvou pollů, ne až s automatikou', prvni && prvni.t - start < 5000);
  ok('  solinátor taky', proId('sol1', 'off', start).length >= 1);
  ok('  a obě relé jsou vypnutá', rele.pool1 === false && rele.sol1 === false);

  // Udržovací ON nesmí křísit, co sauna srazila
  const ka = Date.now();
  rele.pool1 = true;                    // appka si bude myslet, že bazén zase běží
  await spanek(4000);
  const onPovely = povely.filter(p => p.turn === 'on' && p.t >= ka && (p.id === 'pool1' || p.id === 'sol1'));
  ok('během sauny nechodí udržovací ON', onPovely.length === 0);

  const snap = async () => {
    const res = await puvodni('http://127.0.0.1:3996/api/stream', { headers: { Accept: 'text/event-stream' } });
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel();
    return JSON.parse(new TextDecoder().decode(value).split('data: ')[1].split('\n\n')[0]);
  };
  const s1 = await snap();
  ok('appka ví, že sauna topí', s1.sauna && s1.sauna.topi === true);
  ok('  a zná její odběr', s1.sauna && s1.sauna.powerW === 6200);
  ok('  drží blokaci do budoucna', s1.sauna && s1.sauna.blockUntil > Date.now());
  ok('  stránka sauny je zapnutá', s1.saunaEnabled === true);

  // Někdo bazén přesto zapne (ručně u relé) — automatika ho musí zase srazit
  const znovu = Date.now();
  rele.pool1 = true;
  await spanek(4500);
  ok('zapnutý bazén sauna zase srazí', proId('pool1', 'off', znovu).length >= 1);
  ok('  a je zase vypnutý', rele.pool1 === false);

  // „+24 h" taky nesmí vyhrát (tohle už řeší automatika, tak počkáme na její kolo)
  const force = Date.now();
  await puvodni('http://127.0.0.1:3996/api/pool/force', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  }).catch(() => {});
  rele.pool1 = true;
  await spanek(16000);
  ok('ani „+24 h" bazén během sauny neudrží', rele.pool1 === false);
  ok('  a šel na něj OFF', proId('pool1', 'off', force).length >= 1);

  const s2 = await snap();
  ok('denní spotřeba sauny se počítá', (s2.saunaDays || []).length >= 1);
  ok('log má řádek o saune', (s2.log || []).some(e => /Sauna: topí/.test(e.msg)));

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
