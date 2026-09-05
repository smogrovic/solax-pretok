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

  // ---- nástěnná čidla ve všech čtyřech pokojích ----
  const POKOJE = [['obyvak', 'Obývák', 22.5], ['loznice', 'Ložnice', 21.2],
                  ['elenka', 'Elenka', 23.1], ['miky', 'Miky', 23.8]];
  sensorsData = {};
  for (const [k, , t] of POKOJE) {
    sensorsData[k] = { tempC: t, humidity: 45, battery: 90, online: true, reportedAt: T };
  }
  airconData = { devices: POKOJE.map(([k, label], i) =>
    ({ guid: 'g' + i, name: 'Klima ' + label, on: true, mode: 'cool', insideTemp: 25 + i, targetC: 23 })),
    error: null };
  tempAutoData = { obyvak: true, loznice: true, elenka: true, miky: true };
  renderTempAuto();

  const radky = Array.from(document.querySelectorAll('#tempAutoListOwn .tempauto-row, #tempAutoList .tempauto-row'));
  check('v seznamu jsou všechny čtyři pokoje', radky.length, 4);
  // Tučně je to, podle čeho se rozhoduje (čidlo), vedle toho hodnota z klimatizace
  const tucne = Array.from(document.querySelectorAll('.tempauto-name b.tempauto-temp')).map(b => b.textContent);
  check('každý pokoj ukazuje tučně teplotu z čidla', tucne.length, 4);
  check('  a jsou to hodnoty z čidel', tucne.join(' '), '22,5 °C 21,2 °C 23,1 °C 23,8 °C');
  const vedle = Array.from(document.querySelectorAll('.tempauto-temp-alt')).map(b => b.textContent);
  check('vedle nich je hodnota z klimatizace', vedle.join(' '), '25,0 °C 26,0 °C 27,0 °C 28,0 °C');

  // Jezdce: obývák vlastní, tři ložnice pořád jeden společný
  check('obývák má svůj jezdec', !!document.getElementById('tempAutoOnSliderObyvak'), true);
  check('  a zbytek jeden společný', !!document.getElementById('tempAutoOnSlider'), true);
  check('  víc jezdců nepřibylo', document.querySelectorAll('.tempauto-card input[type=range]').length, 2);
  check('u vlastního jezdce je jen obývák',
    document.querySelectorAll('#tempAutoListOwn .tempauto-row').length, 1);
  check('  u společného tři pokoje',
    document.querySelectorAll('#tempAutoList .tempauto-row').length, 3);

  // Graf: ke každé jednotce plná (klima) i čárkovaná (čidlo) řada
  airconHistory = [];
  for (let t = T - 6 * 3600000; t <= T; t += 10 * 60000) {
    airconHistory.push({ t,
      temps: { g0: 25, g1: 26, g2: 27, g3: 28 },
      sens: { obyvak: 22.5, loznice: 21.2, elenka: 23.1, miky: 23.8 } });
  }
  const rady = airconChartSeries(pruneAirconHistory(airconHistory));
  check('graf má osm řad', rady.length, 8);
  check('  čtyři z nich jsou čidla', rady.filter(r => r.dashed).length, 4);
  check('  a jsou popsané', rady.filter(r => r.dashed).map(r => r.label).join(', '),
    'Obývák (čidlo), Ložnice (čidlo), Elenka (čidlo), Miky (čidlo)');
  check('  klimatizační řady jsou označené taky',
    rady.filter(r => !r.dashed).every(r => / \\(klima\\)$/.test(r.label)), true);
  check('  a čidlo má barvu své jednotky',
    rady[0].color === rady[1].color && rady[2].color === rady[3].color, true);
  renderAirconChart();
  const legenda = document.querySelectorAll('#airconChartLegend span');
  check('legenda vypíše všech osm', legenda.length, 8);
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
