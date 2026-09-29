// Karta Wallbox: baterie auta VW z mostu na NASu
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno.padEnd(52) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
 try {
  const el = document.getElementById('wbAuto');
  check('karta je na stránce Wallbox', el.closest('.slide').dataset.title, 'Wallbox');
  renderAuto(null);
  check('bez mostu se neukazuje', el.hidden, true);
  const T = Date.now();
  renderAuto({ zive: true, kdy: T, stav: { soc: 78.4, dojezdKm: 320, nabijeni: 'charging', nabiji: true, cilSoc: 80,
    vykonKw: 10.5, hotovoV: new Date(T + 3600000).toISOString(), zmerenoV: new Date(T - 600000).toISOString() } });
  check('s daty je vidět', el.hidden, false);
  check('  procenta', document.getElementById('wbAutoSoc').textContent, '🚗 78 %');
  check('  dojezd a nabíjení', document.getElementById('wbAutoText').textContent, 'dojezd 320 km · nabíjí se do 80 % (10,5 kW)');
  check('  kdy bude nabito a kdy měřilo', /nabito v .* · změřeno /.test(document.getElementById('wbAutoMeta').textContent), true);
  renderAuto({ zive: false, kdy: T - 3600000, stav: { soc: 60, nabijeni: 'off', nabiji: false } });
  check('mlčící most: zešedne a řekne to', el.classList.contains('stare') + ' ' + /most na NASu mlčí/.test(document.getElementById('wbAutoMeta').textContent), 'true true');
  check('  nenabíjí', document.getElementById('wbAutoText').textContent, 'nenabíjí');
  renderAuto({ zive: true, kdy: T, stav: { soc: null, chyba: 'VW odmítl přihlášení — zkontroluj heslo v auto.config.json.' } });
  check('chyba bez procent se ukáže', /VW odmítl/.test(document.getElementById('wbAutoMeta').textContent) + ' ' + document.getElementById('wbAutoSoc').textContent, 'true 🚗 –');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message); }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb ? 'SELHALO — ' + chyb + ' chyb' : 'VŠE PROŠLO (auto)');
  document.body.appendChild(pre);
}, 500);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'auto.html');
fs.writeFileSync(out, v);
console.log(out);
