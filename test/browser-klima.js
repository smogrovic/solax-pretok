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
const bezVyjimky = (jmeno, fn) => {
  try { fn(); check(jmeno, 'bez chyby', 'bez chyby'); }
  catch (e) { R.push('CHYBA  ' + jmeno + ' → ' + e.message); }
};
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
    ({ guid: 'g' + i, name: 'Klima ' + label, on: true, power: true, mode: 'cool',
       insideTemp: 25 + i, targetC: 23 })), error: null };
  tempAutoData = { obyvak: true, loznice: true, elenka: true, miky: true };
  renderTempAuto();
  renderAircon();

  // ---- seznam automatiky: jen teplota z čidla ----
  const radky = Array.from(document.querySelectorAll('#tempAutoListOwn .tempauto-row, #tempAutoList .tempauto-row'));
  check('v seznamu jsou všechny čtyři pokoje', radky.length, 4);
  const teploty = Array.from(document.querySelectorAll('.tempauto-name .tempauto-temp'));
  check('u každého pokoje je JEDNA teplota', teploty.length, 4);
  check('  a je tučná (z čidla)', teploty.every(el => el.tagName === 'B'), true);
  check('  s hodnotami z čidel', teploty.map(el => el.textContent).join(' '),
    '22,5 °C 21,2 °C 23,1 °C 23,8 °C');
  // Jednotky hlásí 25–28 °C; nikde se to nesmí objevit
  check('hodnota z jednotky v seznamu není',
    /2[5-8],0 °C/.test(document.getElementById('tempAutoListOwn').textContent
      + document.getElementById('tempAutoList').textContent), false);

  // ---- karta jednotky: tučné číslo bez uvozujícího slova ----
  const karta = Array.from(document.querySelectorAll('.blind-pos'))
    .find(el => /22,5/.test(el.textContent));
  check('karta jednotky ukazuje teplotu z čidla', !!karta, true);
  check('  tučně a bez slova před ní', karta.querySelector('b').textContent, '22,5 °C');
  check('  slovo „čidlo" tam není', /čidlo/.test(karta.textContent), false);
  check('  ani „uvnitř" s hodnotou z jednotky', /uvnitř/.test(karta.textContent), false);
  check('  vlhkost a režim zůstaly', /45 % · Chlazení/.test(karta.textContent), true);

  // Když čidlo mlčí, nezůstane po jednotce nic a nic nespadne
  sensorsData = {};
  bezVyjimky('bez čidel se karty nakreslí', renderAircon);
  const bezCidla = Array.from(document.querySelectorAll('.blind-pos'))
    .find(el => /Chlazení/.test(el.textContent));
  check('bez čidla se teplota neukáže vůbec', /°C/.test(bezCidla.textContent), false);
  for (const [k, , t] of POKOJE) {
    sensorsData[k] = { tempC: t, humidity: 45, battery: 90, online: true, reportedAt: T };
  }

  // ---- graf: čtyři plné čáry, barva na pokoj ----
  airconHistory = [];
  for (let t = T - 6 * 3600000; t <= T; t += 10 * 60000) {
    airconHistory.push({ t,
      temps: { g0: 25, g1: 26, g2: 27, g3: 28 },
      sens: { obyvak: 22.5, loznice: 21.2, elenka: 23.1, miky: 23.8 } });
  }
  const rady = airconChartSeries(pruneAirconHistory(airconHistory));
  check('graf má čtyři řady', rady.length, 4);
  check('  žádná není čárkovaná', rady.some(r => r.dashed), false);
  check('  popisky jsou holé názvy pokojů', rady.map(r => r.label).join(', '),
    'Obývák, Ložnice, Elenka, Miky');
  check('  a nikde není „(klima)"', rady.some(r => /klima|čidlo/.test(r.label)), false);
  const barva = jm => (rady.find(r => r.label === jm) || {}).color;
  check('Ložnice zelená', barva('Ložnice'), '#27ae60');
  check('Miky modrá', barva('Miky'), '#2f80ed');
  check('Elenka růžová', barva('Elenka'), '#e0559f');
  check('Obývák fialová', barva('Obývák'), '#6a2f9e');
  check('  a každá barva je jiná', new Set(rady.map(r => r.color)).size, 4);

  // Pokoj bez dat z čidla se nekreslí
  airconHistory = airconHistory.map(p => ({ ...p, sens: { obyvak: 22.5, miky: 23.8 } }));
  const dva = airconChartSeries(pruneAirconHistory(airconHistory));
  check('pokoj bez čidla v grafu není', dva.map(r => r.label).join(', '), 'Obývák, Miky');
  renderAirconChart();
  check('legenda vypíše jen ty dva',
    document.querySelectorAll('#airconChartLegend span').length, 2);
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
