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
setTimeout(async () => {
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
  const teploty = Array.from(document.querySelectorAll('.tempauto-row .tempauto-temp'));
  check('u každého pokoje je JEDNA teplota', teploty.length, 4);
  check('  a je tučná (z čidla)', teploty.every(el => el.tagName === 'B'), true);
  // Vlastní sloupec uprostřed řádku, ne přívěsek názvu — jinak by teploty skákaly
  check('  a stojí ve vlastním sloupci',
    teploty.every(el => el.parentElement.classList.contains('tempauto-row')), true);
  check('  řádek má tři sloupce',
    getComputedStyle(teploty[0].parentElement).gridTemplateColumns.split(' ').length, 3);
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
  // Teplota v pokojích je to, kvůli čemu se na stránku kouká — patří nad časovač
  const karty = [...document.querySelector('.slide[data-title="Klima"]')
    .querySelectorAll(':scope > .page > .card')].filter(c => !c.classList.contains('lock-panel'));
  const nazev = c => (c.querySelector('.graph-title') || {}).textContent || 'seznam klimatizací';
  check('pořadí karet sedí', karty.map(nazev).join(' | '),
    'seznam klimatizací | Tepelné čerpadlo | Program tepelného čerpadla | Teplota v pokojích (12 h) | Časovač');

  R.push('\\nTepelné čerpadlo');
  const box = document.getElementById('aquareaBox');
  check('bez Aquarey box není', box.hidden, true);
  const AQ = { guid: 'GW-1', name: 'Aquarea', zapnuto: true, ohrevVody: false, tankTemp: 48.2, tankTarget: 50, tankOn: false, tankMin: 40, tankMax: 60,
    zones: [{ zoneId: 1, name: 'House', temp: 34, target: 2, on: true, min: -5, max: 5, relativni: true, pouzita: true },
      { zoneId: 2, name: 'Zone2', temp: null, target: 0, on: true, min: -5, max: 5, relativni: true, pouzita: false }] };
  airconData = { devices: airconData.devices, aquarea: [JSON.parse(JSON.stringify(AQ))], error: null };
  renderAircon();
  check('s Aquareou je vidět pod klimatizacemi', !box.hidden && box.previousElementSibling.querySelector('#airconList') !== null, true);
  const rezimy = () => [...box.querySelectorAll('.aq-rezimy button')];
  check('režimy, svítí Topení', rezimy().map(b => b.textContent + (b.classList.contains('active') ? '*' : '')).join(' '), 'Topení* Voda Obojí Vyp.');
  check('jen zóna 1, bez názvu zóny', [...box.querySelectorAll('[data-zona]')].map(r => r.dataset.zona + ':' + r.querySelector('.aq-nazev').textContent).join(), '1:Topení');
  const zona1 = box.querySelector('[data-zona="1"]');
  check('topení: posun křivky +2 °C', zona1.querySelector('.temp-val').textContent + ' | ' + zona1.querySelector('.aq-pozn').textContent, '+2 °C | 34,0 °C · posun křivky');
  check('voda: nádrž a cíl', box.querySelector('.aq-voda .aq-pozn').textContent + ' | ' + box.querySelector('.aq-voda .temp-val').textContent, 'v nádrži 48,2 °C | 50 °C');
  let poslano = [];
  window.fetch = async (url, init) => {
    if (url === '/api/aquarea') poslano.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  const pockej = ms => new Promise(r => setTimeout(r, ms));
  const zona = () => box.querySelector('[data-zona="1"]');
  const [minus, , plus] = zona().querySelector('.temp-stepper').children;
  plus.click(); plus.click(); plus.click();
  check('+ + +: hodnota hned, povel ještě ne', zona().querySelector('.temp-val').textContent + ' ' + poslano.length, '+5 °C 0');
  check('  na +5 se + vypne', plus.disabled, true);
  await pockej(300);
  check('  za 0,3 s pořád čeká na další klepnutí', poslano.length, 0);
  await pockej(1400);
  check('  po chvíli jeden povel +5', JSON.stringify(poslano), JSON.stringify([{ guid: 'GW-1', zona: { zoneId: 1, heatSet: 5 } }]));
  poslano = [];
  const [m2, , p2] = zona().querySelector('.temp-stepper').children;
  m2.click(); p2.click();
  await pockej(1700);
  check('tam a zpátky = žádný povel', poslano.length, 0);
  box.querySelectorAll('.aq-rezimy button')[2].click();
  await pockej(50);
  check('Obojí → povel režimu', JSON.stringify(poslano.pop()), JSON.stringify({ guid: 'GW-1', rezim: 'oboji' }));
  box.querySelectorAll('.aq-rezimy button')[3].click();
  await pockej(50);
  check('Vyp. se nejdřív zeptá', document.getElementById('potvrzOkno').hidden + ' ' + poslano.length, 'false 0');
  document.getElementById('potvrzZpet').click();
  await pockej(50);
  check('  Zpět nic nepošle', poslano.length, 0);
  box.querySelector('.aq-hned').click();
  await pockej(50);
  check('Ohřát hned', JSON.stringify(poslano.pop()), JSON.stringify({ guid: 'GW-1', ohrevVody: true }));
  window.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'Panasonic API HTTP 500' }) });
  box.querySelectorAll('.aq-rezimy button')[1].click();
  await pockej(50);
  check('chyba se ukáže v boxu', document.getElementById('aquareaChyba').hidden + ' ' + document.getElementById('aquareaChyba').textContent, 'false Tepelné čerpadlo: Panasonic API HTTP 500');
  check('nic nepřetéká', box.scrollWidth <= box.clientWidth + 1, true);
  // Bez cíle (detail nedorazil): poznámka místo ticha
  airconData.aquarea[0].zones[0].target = null;
  airconData.aquarea[0].tankTarget = null;
  renderAquarea();
  check('bez cíle: „cíl se načítá“ a −/+ vypnuté', box.querySelector('[data-zona="1"] .aq-pozn').textContent + ' | '
    + box.querySelector('.aq-voda .aq-pozn').textContent + ' | ' + [...box.querySelectorAll('.temp-btn')].every(b => b.disabled),
    '34,0 °C · cíl se načítá | v nádrži 48,2 °C · cíl se načítá | true');

  R.push('\\nProgram tepelného čerpadla');
  const pbox = document.getElementById('aqProgramBox');
  check('bez programu ze serveru box není', pbox.hidden, true);
  const PROG = { zapnuto: false, topeni: [{ od: '00:00', posun: 0 }, { od: '11:00', posun: 1 }, { od: '17:00', posun: 0 }],
    voda: [{ od: '00:00', teplota: 43 }, { od: '06:00', teplota: null }, { od: '09:00', teplota: 43 }] };
  const puvodniNow = Date.now;
  const dnes = new Date(); dnes.setHours(12, 30, 0, 0);
  Date.now = () => dnes.getTime();
  aqProgramData = JSON.parse(JSON.stringify(PROG));
  sbalNastav('aqprogram', true);
  renderAqProgram();
  const pbtn = document.getElementById('aqProgramBtn');
  check('rozbalovací: tlačítko pod čerpadlem, obsah sbalený', !pbtn.hidden && pbtn.previousElementSibling.id === 'aquareaBox' && pbox.hidden, true);
  pbtn.click();
  check('  klepnutím se rozbalí', pbox.hidden + ' ' + pbtn.getAttribute('aria-expanded'), 'false true');
  renderAqProgram();
  check('  překreslení ho nechá rozbalený', pbox.hidden, false);
  check('vypnutý: svítí Vyp.', [...pbox.querySelectorAll('.aqp-prepinac button')].map(b => b.textContent + (b.classList.contains('active') ? '*' : '')).join(' '), 'Vyp.* Zap.');
  check('teď (12:30)', pbox.querySelector('.aqp-ted').textContent, 'Teď: topení +1 °C (do 17:00), voda 43 °C (do 24:00)');
  const pruhy = [...pbox.querySelectorAll('.aqp-pruh')].map(p => [...p.children].map(u => u.textContent + '@' + u.style.flexGrow).join(','));
  check('pruh topení jako v Panasonicu', pruhy[0], '0@660,+1@360,0@420');
  check('pruh vody', pruhy[1], '43@360,vyp.@180,43@900');
  poslano = [];
  window.fetch = async (url, init) => { if (url === '/api/aquarea/program') poslano.push(JSON.parse(init.body).program);
    return { ok: true, status: 200, json: async () => ({ ok: true, aquareaProgram: JSON.parse(init.body).program }) }; };
  pbox.querySelectorAll('.aqp-prepinac button')[1].click();
  await pockej(50);
  check('Zap. se nejdřív zeptá (plán v Panasonicu)', document.getElementById('potvrzOkno').hidden + ' ' + poslano.length, 'false 0');
  document.getElementById('potvrzAno').click();
  await pockej(80);
  check('  po potvrzení uloží zapnuto', poslano.length + ' ' + poslano[0].zapnuto, '1 true');
  // Úpravy
  pbox.querySelector('.aqp-upravit').click();
  const prRadky = k => [...pbox.querySelectorAll('.aqp-radek[data-seznam="' + k + '"]')];
  check('editor: úseky topení a vody', prRadky('topeni').length + ' ' + prRadky('voda').length, '3 3');
  check('  první úsek 00:00 nejde smazat ani posunout', prRadky('topeni')[0].querySelector('.aqp-smazat').disabled + ' ' + prRadky('topeni')[0].querySelector('input').disabled, 'true true');
  pbox.querySelector('.aqp-pridat[data-seznam="topeni"]').click();
  const novy = prRadky('topeni')[3];
  check('+ úsek: o hodinu později, stejná hodnota', novy.querySelector('input').value + ' ' + novy.querySelector('select').value, '18:00 0');
  novy.querySelector('input').value = '20:00'; novy.querySelector('input').dispatchEvent(new Event('change'));
  novy.querySelector('select').value = '-2'; novy.querySelector('select').dispatchEvent(new Event('change'));
  prRadky('voda')[1].querySelector('.aqp-smazat').click();
  prRadky('voda')[0].querySelector('select').value = '45'; prRadky('voda')[0].querySelector('select').dispatchEvent(new Event('change'));
  poslano = [];
  pbox.querySelector('.aqp-ulozit').click();
  await pockej(80);
  check('Uložit pošle celý program', JSON.stringify(poslano[0]), JSON.stringify({ zapnuto: true,
    topeni: [{ od: '00:00', posun: 0 }, { od: '11:00', posun: 1 }, { od: '17:00', posun: 0 }, { od: '20:00', posun: -2 }],
    voda: [{ od: '00:00', teplota: 45 }, { od: '09:00', teplota: 43 }] }));
  check('  editor se zavře, pruh ukáže nový program', !!pbox.querySelector('.aqp-editor') + ' ' + pbox.querySelectorAll('.aqp-pruh')[0].children.length, 'false 4');
  window.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Topení: dva úseky ve stejný čas.' }) });
  pbox.querySelector('.aqp-upravit').click();
  pbox.querySelector('.aqp-ulozit').click();
  await pockej(80);
  check('chyba ze serveru v boxu', document.getElementById('aqProgramChyba').textContent, 'Program: Topení: dva úseky ve stejný čas.');
  check('nic nepřetéká', pbox.scrollWidth <= pbox.clientWidth + 1, true);
  Date.now = puvodniNow;
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
