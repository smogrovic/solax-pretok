// Log a nová karta výpadků. Hlavní log má být o tom, co dům udělal; co se nepovedlo,
// patří do výpadků. Trvající výpadek se ukazuje jako rozsah „10:00–nyní".
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
setTimeout(() => {
 try {
  const T = new Date(); T.setHours(10, 0, 0, 0);
  const t0 = T.getTime(), MIN = 60000;
  const radky = el => Array.from(el.querySelectorAll('.log-entry'));
  const text = el => radky(el).map(r => r.textContent);

  check('karta výpadků je pod logem', !!document.getElementById('outageList'), true);
  const karty = Array.from(document.querySelectorAll('.slide[data-title="Log"] .page > .card'));
  check('  a je to samostatná karta', karty.length, 2);
  check('  s mezerou jako všude jinde',
    parseFloat(getComputedStyle(karty[1]).marginTop) >= 10, true);

  logEntries = [
    { t: t0, msg: 'Bazén: zapnuto (přebytek 2,1 kW)' },
    { t: t0 + 5 * MIN, msg: 'Bazén: neodpovídá', level: 'error', tEnd: t0 + 25 * MIN },
    { t: t0 + 10 * MIN, msg: 'Baterie je plná — 100 %', level: 'notif' },
    { t: t0 + 30 * MIN, msg: 'Solinátor: neodpovídá', level: 'error', tEnd: Date.now(), open: true }
  ];
  renderLog();

  check('v hlavním logu jsou jen běžné události', radky(logList).length, 2);
  check('  výpadek tam není', /neodpovídá/.test(logList.textContent), false);
  check('  ale notifikace ano', /Baterie je plná/.test(logList.textContent), true);
  check('ve výpadcích jsou oba výpadky', radky(outageList).length, 2);
  check('  a nic jiného', /přebytek|Baterie/.test(outageList.textContent), false);

  const t = text(outageList).join(' | ');
  check('trvající výpadek má „nyní"', /10:30–nyní/.test(t), true);
  check('uzavřený má konec', /10:05–10:25/.test(t), true);
  check('výpadky svítí červeně',
    radky(outageList).every(r => r.classList.contains('log-error')), true);

  // Krátký výpadek (pod minutu) rozsah nedostane — „10:00–10:00" nikomu nic neřekne
  logEntries = [{ t: t0, msg: 'Měřák: nedorazila data', level: 'error', tEnd: t0 + 20000 }];
  renderLog();
  check('výpadek pod minutu má jen čas', /10:00–/.test(outageList.textContent), false);

  logEntries = [];
  renderLog();
  check('prázdný log to řekne', /Zatím žádné záznamy/.test(logList.textContent), true);
  check('prázdné výpadky taky', /Zatím žádné výpadky/.test(outageList.textContent), true);

  // Ze zálohy v telefonu se „open" zahazuje — jinak by starý výpadek visel na „nyní"
  try {
    localStorage.setItem('appLog', JSON.stringify([
      { t: Date.now() - 3600000, msg: 'Bazén: neodpovídá', level: 'error',
        tEnd: Date.now() - 3000000, open: true }]));
  } catch {}
  const zalohaLoc = loadLogLocal();
  check('záloha nenese „pořád to trvá"', zalohaLoc.some(e => e.open), false);
  check('  ale výpadek zůstane', zalohaLoc.length, 1);

  // Staré řádky, které se do logu už nezapisují, se nesmí kreslit ani vracet serveru
  logEntries = [
    { t: t0, msg: 'Bazén: zapnuto (přebytek 2,1 kW)' },
    { t: t0 + MIN, msg: 'Wallbox: režim FAST (automatika)' },
    { t: t0 + 2 * MIN, msg: 'Zahrada dole: zapnuto ručně' },
    { t: t0 + 3 * MIN, msg: 'Teplotní automatika — Ložnice: zapnuto (23,4 °C nad 22 °C)' },
    { t: t0 + 4 * MIN, msg: 'Bazén (relé): zase odpovídá' },
    { t: t0 + 5 * MIN, msg: 'Wallbox: režim FAST ručně (automatika převezme v 14:20)' },
    // Diagnostika čerpadla zavalila log čtyřmi obřími řádky. Odvedla svoje a jde pryč.
    { t: t0 + 6 * MIN, msg: 'Čerpadlo (shadow properties): Power=true, WInTemp=19, SpeedPercentage=0' },
    { t: t0 + 7 * MIN, msg: 'Čerpadlo: diagnostiku se nepodařilo stáhnout (síť)' },
    { t: t0 + 8 * MIN, msg: 'Tepelné čerpadlo: switch=true, temp_set=31, temp_current=-22' },
    { t: t0 + 9 * MIN, msg: 'Klima: připojeno k Panasonic (5 zařízení)' },
    // Chybová varianta je o písmeno vedle a patří do výpadků — zůstat musí
    { t: t0 + 10 * MIN, msg: 'Klima: připojení k Panasonic selhalo — token vypršel', level: 'error' }
  ];
  logEntries = mergeLogs(logEntries, []);
  renderLog();
  check('starý wallboxový řádek se nekreslí', /\\(automatika\\)/.test(logList.textContent), false);
  check('  ani cvakání světel', /Zahrada dole/.test(logList.textContent), false);
  check('  ani spínání klimatizace', /Teplotní automatika —/.test(logList.textContent), false);
  check('  ani „zase odpovídá"',
    /zase odpovídá/.test(logList.textContent + outageList.textContent), false);
  check('  ani diagnostika čerpadla',
    /WInTemp|shadow properties|temp_current/.test(logList.textContent + outageList.textContent), false);
  check('  ani její chybová varianta',
    /diagnostiku se nepodařilo/.test(logList.textContent + outageList.textContent), false);
  check('  ani „připojeno k Panasonic"',
    /připojeno k Panasonic/.test(logList.textContent + outageList.textContent), false);
  check('selhání Panasonicu naopak ve výpadcích zůstane',
    /připojení k Panasonic selhalo/.test(outageList.textContent), true);
  check('ruční přepnutí wallboxu zůstane', /režim FAST ručně/.test(logList.textContent), true);
  check('  a běžná událost taky', /přebytek 2,1 kW/.test(logList.textContent), true);
  check('  takže zbyly dva řádky', document.querySelectorAll('#logList .log-entry').length, 2);

  check('  a ze zálohy v telefonu taky zmizí',
    pruneOldLog([{ t: Date.now(), msg: 'Čerpadlo (iot-03 status): switch=true' },
                 { t: Date.now(), msg: 'Bazén: zapnuto (přebytek 2,1 kW)' }]).length, 1);

  check('log si pamatuje 48 h', LOG_MAX_AGE_MS, 48 * 3600000);
  check('  a starší se zahodí',
    pruneOldLog([{ t: Date.now() - 50 * 3600000, msg: 'staré' },
                 { t: Date.now(), msg: 'nové' }]).length, 1);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (log)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'log.html');
fs.writeFileSync(out, v);
console.log(out);
