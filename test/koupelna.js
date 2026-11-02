// Noční světlo v koupelně: vlastní vypínač nemá, jde vždy spolu s nočními světly —
// z tlačítek v appce, ze zkratek (spánek, probuzení, odemčení), z časovačů i z asistenta.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('koupelna');

const SRC = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
const CODE = [between('const SPOLU = {', 'const state = {'), fn('async function actuateRelay(')].join('\n');

function build(o = {}) {
  const povely = [], logy = [], zpravy = [];
  const state = { devices: {} };
  const DEVICES = {
    lightNocni: { serverUri: 's', deviceId: 'NOCNI' },
    lightKoupelna: { serverUri: 's', deviceId: 'KOUPELNA' },
    lightDole: { serverUri: 's', deviceId: 'DOLE' }
  };
  const api = new Function('state', 'DEVICES', 'DEVICE_LABELS', 'setShellyState', 'noteCmd', 'broadcast', 'devicePayload',
    'addLog', 'setManualHold', 'jeSvetlo', 'pollDevice', 'setTimeout',
    CODE + '\n; return { SPOLU, spoluPrepni, actuateRelay };')(
    state, DEVICES, { lightNocni: 'Noční světla', lightKoupelna: 'Noční světlo koupelna', lightDole: 'Zahrada dole' },
    async (uri, id, turn) => { povely.push(id + ':' + turn); if (o.chyba === id) throw new Error('HTTP 502'); },
    () => {}, (u, d) => zpravy.push(d && d.key), () => ({}), (t) => logy.push(t), () => {}, () => true, () => {}, () => {});
  return { api, povely, logy, zpravy, state };
}

(async () => {
  nadpis('Párování');
  const h = build();
  check('koupelna patří k nočním světlům', JSON.stringify(h.api.SPOLU), '{"lightNocni":["lightKoupelna"]}');
  await h.api.actuateRelay('lightNocni', true, 'odemčení');
  check('rozsvícení nočních světel rozsvítí i koupelnu', h.povely.join(' '), 'NOCNI:on KOUPELNA:on');
  check('  stav koupelny v appce', [h.state.devices.lightKoupelna.isOn, h.zpravy.includes('lightKoupelna')].join(' '), 'true true');
  await h.api.actuateRelay('lightNocni', false, 'jdu spát');
  check('zhasnutí taky', h.povely.slice(2).join(' '), 'NOCNI:off KOUPELNA:off');
  const jine = build();
  await jine.api.actuateRelay('lightDole', true, 'asistent');
  check('jiné světlo koupelnu nechá', jine.povely.join(' '), 'DOLE:on');

  const ch = build({ chyba: 'KOUPELNA' });
  await ch.api.actuateRelay('lightNocni', true, 'probuzení');
  check('chyba koupelny hlavní světla nezastaví', [ch.state.devices.lightNocni.isOn, ch.logy.length].join(' '), 'true 1');
  check('  a zapíše se', /Noční světlo koupelna: zapnutí se nepovedlo \(probuzení\)/.test(ch.logy[0]), true);

  nadpis('Zapojení v serveru');
  check('ruční tlačítko v appce (set endpoint) přepne i společníky', /res\.json\(\{ success: true, turn \}\);\n\s+await spoluPrepni\(key, turn === 'on'/.test(SRC), true);
  check('relé koupelny je v seznamu zařízení i světel',
    /lightKoupelna: \{ apiPath: '\/api\/light\/koupelna'/.test(SRC) && /const LIGHT_KEYS = \[[^\]]*'lightKoupelna'/.test(SRC), true);
  check('výchozí Device Id z Shelly appky', /LIGHT_KOUPELNA_ID\s+= process\.env\.LIGHT_KOUPELNA_ID\s+\|\| 'e4b323254078'/.test(SRC), true);
  konec();
})();
