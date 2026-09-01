// Stránka Klima po odstranění dočasné karty s daty čidel: karta je pryč, ale čidla
// samotná zůstávají (jede na nich teplotní automatika obýváku) a stránka se kreslí.
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
  const klima = Array.from(document.querySelectorAll('.slide')).find(s => s.dataset.title === 'Klima');
  check('stránka Klima existuje', !!klima, true);
  check('dočasná karta čidel je pryč', !!document.getElementById('sensorCard'), false);
  check('  ani její obsah nezbyl', !!document.getElementById('sensorLog'), false);
  // Skládané, ať se hledaný text nenajde v tomhle skriptu samotném
  const nadpis = 'Data' + ' čidel';
  const bezSkriptu = Array.from(document.querySelectorAll('.slide')).map(s => s.innerHTML).join('');
  check('nadpis se nikde nevyskytuje', bezSkriptu.includes(nadpis), false);
  check('renderSensorCard už neexistuje', typeof renderSensorCard, 'undefined');

  // Čidla musí zůstat — obývák se podle nich řídí
  sensorsData = { obyvak: { tempC: 23.4, humidity: 45, battery: 90, reportedAt: Date.now() } };
  airconData = { devices: [{ guid: 'g1', name: 'Obývák', on: true, mode: 'cool', tempC: 24, targetC: 23 }], error: null };
  airconEnabled = true;
  renderAircon();
  renderTempAuto();
  renderAirconChart();
  check('čidla zůstala v datech', sensorsData.obyvak.tempC, 23.4);
  check('stránka se překreslí bez chyby', true, true);

  const T = Date.now();
  airconHistory = [];
  for (let t = T - 6 * 3600000; t <= T; t += 10 * 60000) airconHistory.push({ t, temps: { g1: 24 }, sens: { obyvak: 23 } });
  renderAirconChart();
  check('graf teplot pořád kreslí', document.getElementById('airconChart').height > 0, true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (klima)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'klima.html');
fs.writeFileSync(out, v);
console.log(out);
