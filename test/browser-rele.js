// Hláška u nedostupného relé: kromě posledního známého stavu má říct, dokdy ho
// ještě drží jeho vlastní časovač — na tom stojí i účtování doby běhu na serveru.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
 try {
  const T = Date.now(), MIN = 60000;
  const hlaska = () => devices.pool.holdEl.textContent;
  const ukaz = d => { renderDevice(devices.pool, d); renderManualHold(); return hlaska(); };

  // Odpojené relé: cloud vrací online:false a k tomu poslední známé „zapnuto"
  const odpojene = (offBy, isOn = true) =>
    ({ online: false, isOn, powerW: 1800, fetchedAt: new Date(T).toISOString(), offBy });

  let t = ukaz(odpojene(T + 9 * MIN));
  check('nedostupné se pozná', /Nedostupné/.test(t), true);
  check('  s posledním stavem', /naposledy zapnuto/.test(t), true);
  // I tady může fmtSolTime přidat datum, když čas přeteče přes půlnoc
  check('  a časem samovypnutí',
    /samo se vypne v (\\d+\\.\\s?\\d+\\.\\s)?\\d\\d?:\\d\\d/.test(t), true);

  t = ukaz(odpojene(T - 2 * MIN));
  check('po uplynutí časovače to řekne', /už se vypnulo samo/.test(t), true);
  check('  a nenabízí budoucí čas', /samo se vypne v/.test(t), false);

  t = ukaz(odpojene(0));
  check('bez záznamu o povelu nic neslibuje', /Nedostupné — naposledy zapnuto/.test(t), true);
  check('  a o časovači mlčí', /vypne|vypnulo/.test(t), false);

  t = ukaz(odpojene(T + 5 * MIN, false));
  check('naposledy vypnuté se pozná taky', /naposledy vypnuto/.test(t), true);
  t = ukaz(odpojene(T + 5 * MIN, null));
  check('neznámý stav taky', /neznámý stav/.test(t), true);

  // Dostupné relé: semafor a hláška se nemění
  t = ukaz({ online: true, isOn: true, powerW: 1800, fetchedAt: new Date().toISOString(), offBy: T + 9 * MIN });
  check('u dostupného relé se hláška nepíše', t, '');
  check('  a semafor svítí', devices.pool.light[0].className, 'traffic-light on');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (relé)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'rele.html');
fs.writeFileSync(out, v);
console.log(out);
