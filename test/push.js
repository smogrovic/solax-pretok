// Notifikace podle zařízení: dětský režim jen garáž a upozornění pro všechny, iPad
// upozornění ne; upozornění pro všechny chodí i jako notifikace.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('notifikace');

const CODE = between('// Subscriptions jsou jen v paměti', '// Hláška o plné baterce');
const CODE_OZN = between('// ---------- Upozornění pro všechny', '// ---------- Spotřeba po měsících');

function build() {
  const routy = {}, odeslano = [], logy = [];
  const app = { get: (c, f) => { routy['GET ' + c] = f; }, post: (c, f) => { routy['POST ' + c] = f; } };
  const webpush = { sendNotification: async (sub, payload) => {
    if (sub.endpoint.includes('mrtvy')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    odeslano.push(sub.endpoint + ' ' + JSON.parse(payload).title);
  } };
  const state = { oznameni: null };
  const api = new Function('app', 'webpush', 'addLog', 'pushEnabled', 'VAPID_PUBLIC_KEY', 'state', 'broadcast',
    CODE + '\n' + CODE_OZN + '\n; return { pushSubscriptions, sendPushToAll, pushZaznam, pushProZarizeni };')(
    app, webpush, t => logy.push(t), true, 'klic', state, () => {});
  const volej = (cesta, body) => { let out, kod = 200; const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } }; routy['POST ' + cesta]({ body }, res); return { kod, out }; };
  return { api, volej, odeslano, logy, state };
}
const sub = id => ({ endpoint: 'https://push.example/' + id, keys: { p256dh: 'a', auth: 'b' } });

(async () => {
  nadpis('1) Přihlášení zařízení');
  {
    const h = build();
    check('nový tvar: režim a iPad', JSON.stringify(h.volej('/api/push/subscribe', { sub: sub('mikyho'), rezim: 'miky', ipad: false }).out), JSON.stringify({ ok: true, rezim: 'miky', ipad: false }));
    check('starý tvar (jen subscription) = full, ne iPad', JSON.stringify(h.volej('/api/push/subscribe', sub('stary')).out), JSON.stringify({ ok: true, rezim: 'full', ipad: false }));
    check('neznámý režim = full', h.volej('/api/push/subscribe', { sub: sub('x'), rezim: 'hacker' }).out.rezim, 'full');
    check('bez endpointu / klíčů 400', [h.volej('/api/push/subscribe', {}).kod, h.volej('/api/push/subscribe', { sub: { endpoint: 'https://a' } }).kod].join(' '), '400 400');
    h.volej('/api/push/subscribe', { sub: sub('mikyho'), rezim: 'full' });
    check('nové přihlášení stejného zařízení přepíše režim', h.api.pushSubscriptions.get('https://push.example/mikyho').rezim, 'full');
    check('obnova ze zálohy přijme nový i starý tvar', [h.api.pushZaznam({ sub: sub('a'), rezim: 'elenka', ipad: true }).rezim, h.api.pushZaznam(sub('b')).rezim].join(' '), 'elenka full');
  }

  nadpis('2) Kdo co dostane');
  {
    const h = build();
    h.volej('/api/push/subscribe', { sub: sub('tata'), rezim: 'full' });
    h.volej('/api/push/subscribe', { sub: sub('ipad'), rezim: 'full', ipad: true });
    h.volej('/api/push/subscribe', { sub: sub('miky'), rezim: 'miky' });
    h.volej('/api/push/subscribe', { sub: sub('elenka'), rezim: 'elenka' });
    h.volej('/api/push/subscribe', { sub: sub('mrtvy'), rezim: 'full' });
    const kdo = async (kat) => { h.odeslano.length = 0; await h.api.sendPushToAll('T', 'x', { kategorie: kat }); return h.odeslano.map(x => x.split('/').pop().split(' ')[0]).sort().join(','); };
    check('běžná hláška (baterie, sauna…): jen full', await kdo(null), 'ipad,tata');
    check('  neplatné zařízení se smaže', h.api.pushSubscriptions.has('https://push.example/mrtvy'), false);
    check('garáž: všichni včetně dětí', await kdo('garaz'), 'elenka,ipad,miky,tata');
    check('upozornění pro všechny: všichni kromě iPadu', await kdo('oznameni'), 'elenka,miky,tata');
  }

  nadpis('3) Upozornění pro všechny jde i jako notifikace');
  {
    const h = build();
    h.volej('/api/push/subscribe', { sub: sub('miky'), rezim: 'miky' });
    h.volej('/api/push/subscribe', { sub: sub('ipad'), rezim: 'full', ipad: true });
    h.volej('/api/oznameni', { text: 'Večeře je hotová!' });
    await new Promise(r => setTimeout(r, 10));
    check('notifikace s textem upozornění, iPad ne', JSON.stringify(h.odeslano), JSON.stringify(['https://push.example/miky 📢 Upozornění']));
    check('  zapíše se do logu', h.logy.some(t => t.includes('Večeře je hotová!')), true);
    h.odeslano.length = 0;
    h.volej('/api/oznameni', { text: '' });
    await new Promise(r => setTimeout(r, 10));
    check('  prázdné upozornění nic neposílá', h.odeslano.length, 0);
  }
  konec();
})();
