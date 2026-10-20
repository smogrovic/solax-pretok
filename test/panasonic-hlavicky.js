// Panasonic: hlavičky jako aktuální knihovna pro Home Assistant a zotavení
// z chyby 4000 „Missing required header" (jedno přihlášení načisto).
const crypto = require('crypto');
const { fn, LINES, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('panasonic hlavičky');
const SRC = LINES.join('\n');

const CODE = [fn('function pccApiHeaders('), fn('async function pccApiFetch(')].join('\n');

function build(odpovedi) {
  const pcc = { accessToken: 'TOK-123456789', refreshToken: 'REF-1', clientId: 'CID-1', appVersion: '4.4.0' };
  const log = { volani: [], prihlaseni: 0, verze: 0 };
  const odpovez = (status, text) => ({ status, ok: status < 300, text: async () => text,
    clone() { return this; }, json: async () => JSON.parse(text) });
  const fetch = async (url, opts) => {
    log.volani.push({ url, headers: opts.headers });
    const [status, text] = odpovedi.shift() || [200, '{}'];
    return odpovez(status, text);
  };
  const api = new Function('pcc', 'crypto', 'fetch', 'PCC_ACC_BASE', 'pccEnsureToken', 'pccUpdateAppVersion', 'pccAuthenticate', 'AbortSignal',
    CODE + '\n; return { pccApiHeaders, pccApiFetch };')(
    pcc, crypto, fetch, 'https://acc', async () => {}, async () => { log.verze++; },
    async () => { log.prihlaseni++; pcc.accessToken = 'NOVY-TOK-987654'; pcc.clientId = 'CID-2'; },
    { timeout: () => null });
  return { api, pcc, log };
}

const CHYBA_4000 = '{"code":4000,"message":"Missing required header parameter or bad request for header"}';

(async () => {
  nadpis('Hlavičky');
  {
    const { api } = build([]);
    const h = api.pccApiHeaders();
    check('accept jako knihovna', h.accept, 'application/json; charset=utf-8');
    check('content-type bez charsetu', h['content-type'], 'application/json');
    check('x-client-id', h['x-client-id'], 'CID-1');
    check('bez client-id pro přihlášení', 'x-client-id' in api.pccApiHeaders(false), false);
    check('klíč s „cfc"', /^[0-9a-f]{9}cfc[0-9a-f]{55}$/.test(h['x-cfc-api-key']), true);
    check('časové razítko', /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(h['x-app-timestamp']), true);
  }

  nadpis('Chyba 4000');
  {
    const { api, log, pcc } = build([[400, CHYBA_4000], [200, '{"ok":1}']]);
    const r = await api.pccApiFetch('/device/group');
    check('po 4000 jedno přihlášení načisto a projde', JSON.stringify(r) + ' ' + log.prihlaseni + ' ' + log.volani.length, '{"ok":1} 1 2');
    check('  nová verze appky se zjistí', log.verze, 1);
    check('  druhý pokus s novým clientId a tokenem', log.volani[1].headers['x-client-id'] + ' ' + log.volani[1].headers['x-user-authorization-v2'], 'CID-2 Bearer NOVY-TOK-987654');
    check('  starý obnovovací token zahozen', pcc.refreshToken, null);
  }
  {
    const { api, log } = build([[400, CHYBA_4000], [400, CHYBA_4000]]);
    let chyba = '';
    try { await api.pccApiFetch('/device/group'); } catch (e) { chyba = e.message; }
    check('dvakrát 4000: jen jeden pokus navíc', log.prihlaseni + ' ' + log.volani.length, '1 2');
    check('  chyba s verzí a clientId', / \(verze appky 4\.4\.0, clientId ano\)$/.test(chyba), true);
    check('  bez tokenu', /TOK/.test(chyba), false);
  }
  {
    const { api, log } = build([[400, '{"code":4100,"message":"jiná chyba"}']]);
    let chyba = '';
    try { await api.pccApiFetch('/x'); } catch (e) { chyba = e.message; }
    check('jiná 400: bez přihlašování', log.prihlaseni + ' ' + log.volani.length + ' ' + /HTTP 400/.test(chyba), '0 1 true');
  }
  {
    const { api, log } = build([[401, '{"code":4106}'], [200, '{"ok":2}']]);
    const r = await api.pccApiFetch('/x');
    check('401/4106: jen nová verze appky', JSON.stringify(r) + ' ' + log.verze + ' ' + log.prihlaseni, '{"ok":2} 1 0');
  }
  check('bez clientId po přihlášení je chyba', /if \(!clientId\) throw new Error\('Panasonic po přihlášení nevrátil clientId\.'\)/.test(SRC), true);
  konec();
})();
