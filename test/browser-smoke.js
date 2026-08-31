// Smoke test celé appky: načtení nesmí hodit chybu a klíčové rendery musí projít
// (prázdná data i data plná). Chytá překlepy a rozbité pořadí deklarací.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DRIVER = `
const CHYBY = [];
window.addEventListener('error', e => CHYBY.push('error: ' + e.message));
window.addEventListener('unhandledrejection', e => CHYBY.push('reject: ' + (e.reason && e.reason.message)));
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
  const T = Date.now(), MIN = 60000;
  try {
    // 1) prázdno — grafy musí zvládnout „Zatím sbírám data…" bez pádu
    history = []; boilerHistory = []; wallboxHistory = []; wbModeHistoryData = [];
    saunaData = null; saunaDaysData = [];
    renderFveChart(); renderWallboxChart(); renderSauna(); renderSaunaDays();
    renderTimeline(); renderLog(); renderManualHold();
    // 2) a pak s daty
    for (let t = T - 26 * 3600000; t <= T; t += 2 * MIN) {
      history.push({ t, kw: 1, soc: 55, pv: 2 });
      wallboxHistory.push({ t, w: 1000 });
    }
    boilerHistory.push({ t: T - 3600000, b1: 40, b2: 45 }, { t: T, b1: 42, b2: 46 });
    wbModeHistoryData = [{ t: T - 5 * 3600000, mode: 'eco' }];
    saunaData = { powerW: 6000, fetchedAt: new Date().toISOString(), topi: true, since: T - MIN, blockUntil: T + 30 * MIN, limitW: 500 };
    saunaDaysData = [{ d: '2026-08-27', wh: 5000, ms: 3600000 }];
    timelineData = { ...timelineData, sauna: [{ from: T - 2 * 3600000, to: T }] };
    renderFveChart(); renderWallboxChart(); renderSauna(); renderSaunaDays();
    renderTimeline(); renderManualHold();
    // 3) stránky a záložky drží pohromadě
    const stranky = Array.from(document.querySelectorAll('.slide')).map(s => s.dataset.title);
    if (!stranky.includes('Sauna')) CHYBY.push('chybí stránka Sauna');
    const tabs = Array.from(document.querySelectorAll('#pageTabs .page-tab')).map(t => t.textContent);
    if (tabs.length !== stranky.length) CHYBY.push('záložek (' + tabs.length + ') a stránek (' + stranky.length + ') není stejně');
  } catch (e) { CHYBY.push('výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = CHYBY.length ? 'SELHALO — ' + CHYBY.join(' | ') : 'VŠE PROŠLO (načtení i kreslení bez chyby)';
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'smoke.html');
fs.writeFileSync(out, v);
console.log(out);
