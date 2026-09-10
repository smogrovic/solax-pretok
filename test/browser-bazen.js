// Karta tepelného čerpadla na stránce Bazén. Čerpadlo visí na zahradní wifi
// se slabým signálem (−70 dBm), takže výpadky budou — a offline ani zestárlá data
// se nesmí kreslit jako platná teplota.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.slide{display:none!important}'
  + '.slide[data-title="Bazén"]{display:block!important}'
  + '.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno.padEnd(50) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
 try {
  const T = Date.now(), MIN = 60000;
  const karta = document.getElementById('heatpumpCard');
  const ukaz = d => { heatpumpData = d; renderHeatpump(); };
  const zaklad = (o = {}) => ({ enabled: true, online: true, fetchedAt: new Date(T).toISOString(),
    tempC: 26.4, targetC: 28, outC: null, vykonPct: null, powerW: null, on: true,
    mode: 'topí', fault: 0, dp: [], ...o });

  R.push('\\n1) Bez klíčů k Tuyi');
  ukaz({ enabled: false });
  check('karta se vůbec neukáže', karta.hidden, 'true');
  ukaz(zaklad());
  check('s klíči se ukáže', karta.hidden, 'false');

  R.push('\\n2) Běžný stav');
  check('semafor svítí, když topí', hpLight.className, 'traffic-light on');
  check('  a stav to říká režimem', hpState.textContent, 'topí');
  check('teplota vody velkým písmem', hpTemp.textContent, '26,4 °C');
  check('  s desetinnou čárkou', /,/.test(hpTemp.textContent), 'true');
  check('cíl je v podrobnostech', /cíl 28,0 °C/.test(hpMeta.textContent), 'true');
  check('  a chybějící údaje se nevypisují', /příkon|výstupu/.test(hpMeta.textContent), 'false');

  ukaz(zaklad({ outC: 30.2, powerW: 1480, vykonPct: 61 }));
  check('teplota na výstupu se ukáže', /na výstupu 30,2 °C/.test(hpMeta.textContent), 'true');
  check('příkon taky', /příkon 1480 W/.test(hpMeta.textContent), 'true');
  check('výkon kompresoru v procentech', /výkon 61 %/.test(hpMeta.textContent), 'true');
  check('  a je hned za cílem', /cíl 28,0 °C · výkon 61 %/.test(hpMeta.textContent), 'true');
  check('  oddělené tečkou', / · /.test(hpMeta.textContent), 'true');

  ukaz(zaklad({ on: false, mode: 'topí' }));
  check('vypnuté čerpadlo má šedý semafor', hpLight.className, 'traffic-light off');
  check('  a neříká režim', hpState.textContent, 'vypnuté');

  ukaz(zaklad({ fault: 3 }));
  check('chyba jednotky se ukáže', /chyba 3/.test(hpMeta.textContent), 'true');

  R.push('\\n3) Výpadky');
  ukaz(zaklad({ online: false }));
  check('offline = nedostupné', hpState.textContent, 'nedostupné');
  check('  semafor zhasne úplně', hpLight.className, 'traffic-light');
  check('  a teplota se nekreslí', hpTemp.textContent, '– °C');
  ukaz(zaklad({ fetchedAt: new Date(T - 40 * MIN).toISOString() }));
  check('zestárlá data taky', hpState.textContent, 'nedostupné');
  check('  a nekreslí zmrzlou teplotu', hpTemp.textContent, '– °C');
  ukaz(zaklad({ online: false, error: 'Tuya: sign invalid (1004)' }));
  check('chyba z Tuyi se ukáže', /sign invalid/.test(hpMeta.textContent), 'true');

  R.push('\\n4) Nehlášené hodnoty a špatné mapování');
  ukaz(zaklad({ tempC: null, targetC: null }));
  check('bez teploty je pomlčka', hpTemp.textContent, '– °C');
  check('  a řekne se, že nic nechodí', /nehlásí/.test(hpMeta.textContent), 'true');
  // Karta poprvé ukazovala −22 °C, protože jsme sáhli na špatný datový bod a tvářili se
  // jistě. Teď má být místo čísla pomlčka a rovnou výpis toho, co čerpadlo posílá —
  // ať stačí screenshot karty a nemusí se lovit /api/heatpump/raw.
  ukaz(zaklad({ tempC: null, dp: [{ code: 'temp_current', value: -220 }, { code: 'inlet_temp', value: 29 }] }));
  check('nesmyslná teplota se nekreslí jako číslo', hpTemp.textContent, '– °C');
  check('  a karta vypíše, co čerpadlo hlásí', /hlásí: temp_current=-220, inlet_temp=29/.test(hpMeta.textContent), 'true');
  ukaz(zaklad({ tempC: 26.4, dp: [{ code: 'inlet_temp', value: 26.4 }] }));
  check('když teplota sedí, výpis kódů se neukazuje', /hlásí:/.test(hpMeta.textContent), 'false');

  R.push('\\n5) Graf teplot bere bazén jako třetí čáru');
  // Barvu i legendu sdílí s odběrem bazénu ve vedlejším panelu — v obou je to totéž místo
  check('bazén má v legendě svou barvu', BOILER_COLORS.pool, '#16a085');
  check('  a liší se od obou bojlerů',
    BOILER_COLORS.pool !== BOILER_COLORS.b1 && BOILER_COLORS.pool !== BOILER_COLORS.b2, 'true');
  boilerHistory = [
    { t: T - 30 * MIN, b1: 48, b2: 44, pool: 25.1 },
    { t: T - 15 * MIN, b1: 49, b2: 44, pool: 25.4 },
    { t: T, b1: 50, b2: 45, pool: 26.0 }
  ];
  check('teplota bazénu přežije úklid historie',
    pruneBoiler(boilerHistory).filter(p => typeof p.pool === 'number').length, 3);
  check('  i sloučení se zálohou z telefonu',
    mergeByTime(boilerHistory, []).filter(p => typeof p.pool === 'number').length, 3);
 } catch (e) { R.push('CHYBA výjimka: ' + e.message); }

  const bad = R.filter(l => l.startsWith('CHYBA')).length;
  R.push('\\n' + (bad === 0 ? 'VŠE PROŠLO — ' + (R.length - bad) + ' ok, 0 chyb (bazén)' : 'SELHALO — ' + bad + ' chyb'));
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n');
  document.body.appendChild(pre);
}, 150);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'bazen.html');
fs.writeFileSync(out, v);
console.log(out);
