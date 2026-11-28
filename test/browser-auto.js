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
  check('karta je na stránce Wallbox', el.closest('.slide').dataset.title, 'Auta/Wallbox');
  renderAuto(null);
  check('bez mostu se neukazuje', el.hidden, true);
  const T = Date.now();
  renderAuto({ zive: true, kdy: T, stav: { soc: 78.4, dojezdKm: 320, nabijeni: 'charging', nabiji: true, cilSoc: 80,
    vykonKw: 10.5, hotovoV: new Date(T + 3600000).toISOString(), zmerenoV: new Date(T - 600000).toISOString() } });
  check('s daty je vidět', el.hidden, false);
  const dl = () => [...el.querySelectorAll('.auto-dl')].map(x => x.textContent.replace(/\\u00a0/g, ' ')).join(' | ');
  const radky = () => [...el.querySelectorAll('.auto-radek')].map(r => r.textContent.replace(/\\u00a0/g, ' '));
  const meta = () => (el.querySelector('.auto-meta') || {}).textContent || '';
  check('  dlaždice: baterie a dojezd', dl(), 'Baterie78 % | Dojezd320 km');
  check('  nabíjení s cílem, výkonem a kdy hotovo', /^Nabíjenínabíjí se do 80 % \\(10,5 kW\\), hotovo v /.test(radky()[0]), true);
  check('  kdy auto hlásilo', /^auto hlásilo /.test(meta()), true);
  renderAuto({ zive: false, kdy: T - 3600000, stav: { soc: 60, nabijeni: 'off', nabiji: false } });
  check('mlčící most: zešedne a řekne to', el.classList.contains('stare') + ' ' + /most na NASu mlčí/.test(meta()), 'true true');
  check('  nenabíjí', radky()[0], 'Nabíjenínenabíjí');
  renderAuto({ zive: true, kdy: T, stav: { soc: null, chyba: 'VW odmítl přihlášení — zkontroluj heslo v auto.config.json.' } });
  check('chyba bez čísel se ukáže červeně', /VW odmítl/.test(radky().join()) + ' ' + !!el.querySelector('.auto-radek.pozor') + ' ' + el.querySelectorAll('.auto-dl').length, 'true true 0');
  // Diesel z portálu EU Data Act: km, zámek, ruční brzda, servis (dojezd zatím ne)
  renderAuto({ zive: true, kdy: T, stav: { km: 64063, zamek: 'zamčeno', rucniBrzda: true,
    servisKm: 17800, servisDatum: '2028-05-19T16:14:33.000Z', olejKm: 17800, olejDatum: '2028-05-19T16:14:33.000Z', zmerenoV: new Date(T).toISOString() } });
  check('jen km: jedna dlaždice', dl(), 'Najeto64 063 km');
  check('  zámek a ruční brzda', radky()[0], 'Zámek🔒 zamčeno · ruční brzda zatažená');
  check('  prohlídka a olej naráz, když sedí', radky()[1], 'ServisProhlídka a olej za 17 800 km nebo do 19. 5. 2028');
  // Multivan plug-in hybrid — jak ho portál poslal 28. 11. 2026
  renderAuto({ zive: true, kdy: T, stav: { soc: 99, palivoPct: 100, dojezdKm: 552, elDojezdKm: 32, km: 64063,
    zamek: 'odemčeno', rucniBrzda: true, nabijeni: 'off', nabiji: false, zapojeno: false } });
  check('hybrid: čtyři dlaždice', dl(), 'Baterie99 %32 km na elektřinu | Nádrž100 % | Dojezd552 km | Najeto64 063 km');
  const r = [...el.querySelectorAll('.auto-dl')].map(x => x.getBoundingClientRect());
  check('  ve dvou řadách po dvou, stejně široké', Math.abs(r[0].top - r[1].top) < 2 && r[2].top > r[0].bottom - 1 && Math.abs(r[0].width - r[3].width) < 2, true);
  check('  odemčeno červeně', el.querySelector('.auto-radek.pozor').textContent, 'Zámek🔓 odemčeno · ruční brzda zatažená');
  check('  nic nepřetéká', el.scrollWidth <= el.clientWidth + 1, true);
  renderAuto({ zive: true, kdy: T, stav: { soc: 90, zapojeno: true, nabijeni: 'off', nabiji: false } });
  check('kabel zapojený, nenabíjí', radky().join('|'), 'Nabíjenínenabíjí · 🔌 kabel zapojený');
  renderAuto({ zive: true, kdy: T, stav: { soc: 50, zapojeno: true, nabijeni: 'charging', nabiji: true } });
  check('  při nabíjení se kabel neopakuje', radky().join('|'), 'Nabíjenínabíjí se');
  renderAuto({ zive: true, kdy: T, stav: { palivoPct: 55, dojezdKm: 610, km: 64100, zamek: 'odemčeno', servisKm: 17800, olejKm: 9000 } });
  check('s nádrží: tři dlaždice v řadě', dl() + ' ' + el.querySelector('.auto-dlazdice').classList.contains('n3'), 'Nádrž55 % | Dojezd610 km | Najeto64 100 km true');
  check('  prohlídka a olej zvlášť pod sebou', radky()[1], 'ServisProhlídka za 17 800 km\\nOlej za 9 000 km');
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
