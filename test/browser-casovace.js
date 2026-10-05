// Časovače jsou sbalené pod tlačítkem; nastavené časovače jsou vidět i sbalené.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
const vidi = el => !!el && el.getClientRects().length > 0;
setTimeout(() => {
 try {
  const karta = document.getElementById('timerList').closest('.timer-card');
  const klic = karta.dataset.sbalCasovac;
  check('klimatizace má klíč sbalení', klic, 'casovac-timerList');
  const btn = document.querySelector('.sbal-btn[data-sbal="' + klic + '"]');
  check('tlačítko je hned před kartou', btn && btn.nextElementSibling === karta, true);
  check('tlačítko nese nadpis karty', btn.textContent.replace('▾', '').trim(),
    karta.querySelector('.graph-title').textContent.trim());
  check('rozvrh žaluzií své tlačítko nedostal',
    !!document.querySelector('.sbal-btn[data-sbal="casovac-rozvrhCard"]'), false);
  const vsechny = document.querySelectorAll('.timer-card:not(#rozvrhCard)');
  check('každá karta časovače má tlačítko',
    [...vsechny].every(k => k.dataset.sbalCasovac && document.querySelector('.sbal-btn[data-sbal="' + k.dataset.sbalCasovac + '"]')), true);

  const klice = [...vsechny].map(k => k.dataset.sbalCasovac);
  check('klíče jsou jedinečné a bez pořadí', klice.every(k => !/-[0-9]+$/.test(k)) && new Set(klice).size === klice.length, true);
  R.push('       ' + klice.join(', '));
  // Výchozí stav: sbaleno
  airconTimersData = [];
  renderTimers();
  check('výchozí je sbaleno', karta.classList.contains('sbaleno'), true);
  check('bez časovače je karta schovaná', vidi(karta), false);
  check('  tlačítko zůstává', vidi(btn), true);

  airconTimersData = [{ id: 'a', time: '07:30', name: 'Obývák', action: 'on' }];
  renderTimers();
  check('s časovačem je karta vidět', vidi(karta), true);
  check('  nastavený časovač je vidět', vidi(karta.querySelector('.timer-row')), true);
  check('  formulář je schovaný', vidi(document.getElementById('timerAddBtn')), false);
  check('  nadpis je schovaný', vidi(karta.querySelector('.graph-title')), false);

  btn.click();
  check('klik rozbalí', karta.classList.contains('sbaleno'), false);
  check('  formulář je vidět', vidi(document.getElementById('timerAddBtn')), true);
  check('  stav se pamatuje', localStorage.getItem('sbaleno:' + klic), 'ne');
  check('  tlačítko hlásí rozbaleno', btn.getAttribute('aria-expanded'), 'true');
  airconTimersData = [];
  renderTimers();
  check('rozbalená prázdná karta zůstane vidět', vidi(karta), true);
  btn.click();
  check('druhý klik sbalí', karta.classList.contains('sbaleno'), true);

  // Sauna: skrytá karta schová i své tlačítko
  const huum = document.getElementById('huumTimerCard');
  const hBtn = document.querySelector('.sbal-btn[data-sbal="casovac-huumTimerCard"]');
  huum.hidden = true;
  check('skrytá karta sauny schová tlačítko', vidi(hBtn), false);
  huum.hidden = false;
  check('viditelná karta sauny tlačítko ukáže', vidi(hBtn), true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (casovace)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'casovace.html');
fs.writeFileSync(out, v);
console.log(out);
