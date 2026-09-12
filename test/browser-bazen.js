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
  // poolTemp je to, co se ukazuje velkým písmem: poslední teplota naměřená za
  // proudící vody. tempC je syrové čidlo a slouží už jen k diagnostice mapování.
  const zaklad = (o = {}) => ({ enabled: true, online: true, fetchedAt: new Date(T).toISOString(),
    tempC: 26.4, targetC: 28, outC: null, vykonPct: null, powerW: null, on: true,
    mode: 'topí', fault: 0, dp: [],
    poolTemp: { c: 26.4, at: T, zive: true, duvod: null }, ...o });
  const bezTeploty = { c: null, at: null, zive: false, duvod: 'zatim' };

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

  R.push('\\n3) Výpadky — každý druh se pozná zvlášť');
  // „Z čerpadla nechodí data" znamenalo čtyři různé věci naráz a při ladění se pak
  // jen hádalo, o kterou jde. Každá chce jinou reakci.
  ukaz(zaklad({ online: false }));
  check('offline = nedostupné', hpState.textContent, 'nedostupné');
  check('  semafor zhasne úplně', hpLight.className, 'traffic-light');
  // Zapamatovaná voda na dostupnosti čerpadla nezávisí — ale musí být vidět, že je stará
  check('  zapamatovaná teplota platí dál', hpTemp.textContent, '26,4 °C');
  check('  a nese čas měření', /Naměřeno v \\d\\d?:\\d\\d/.test(hpMeta.textContent), 'true');
  check('  hláška řekne, že to hlásí Tuya', /Tuya hlásí čerpadlo jako offline/.test(hpMeta.textContent), 'true');
  check('  i kdy naposledy dorazila data', /Poslední data v \\d\\d?:\\d\\d/.test(hpMeta.textContent), 'true');

  const stara = new Date(T - 40 * MIN).toISOString();
  ukaz(zaklad({ fetchedAt: stara, poolTemp: bezTeploty }));
  check('zestárlá data taky', hpState.textContent, 'nedostupné');
  check('  a bez naměřené vody je pomlčka', hpTemp.textContent, '– °C');
  ukaz(zaklad({ fetchedAt: stara }));
  check('  ale řeknou, že jen zestárla', /zestárla/.test(hpMeta.textContent), 'true');
  check('  a neplete se s offline', /offline/.test(hpMeta.textContent), 'false');

  // Hned po nasazení ještě žádný dotaz neproběhl — to není porucha
  ukaz({ enabled: true, dp: [] });
  check('před prvním dotazem se to řekne', /Čeká se na první dotaz/.test(hpMeta.textContent), 'true');
  check('  a nehlásí se to jako výpadek', /offline|zestárla/.test(hpMeta.textContent), 'false');

  ukaz(zaklad({ online: false, error: 'Tuya: sign invalid (1004)' }));
  check('chyba z Tuyi má přednost', /sign invalid/.test(hpMeta.textContent), 'true');
  check('  a nepřekryje ji obecná hláška', /offline/.test(hpMeta.textContent), 'false');

  // I u nedostupného čerpadla jsou poslední známé kódy k něčemu
  ukaz(zaklad({ online: false, tempC: null, poolTemp: bezTeploty, dp: [{ code: 'inlet_temp', value: 29 }] }));
  check('výpis kódů funguje i u nedostupného', /hlásí: inlet_temp=29/.test(hpMeta.textContent), 'true');

  R.push('\\n4) Nehlášené hodnoty a špatné mapování');
  ukaz(zaklad({ tempC: null, targetC: null, poolTemp: bezTeploty }));
  check('bez teploty je pomlčka', hpTemp.textContent, '– °C');
  check('  a řekne se, že nic nechodí', /nehlásí/.test(hpMeta.textContent), 'true');
  // Karta poprvé ukazovala −22 °C, protože jsme sáhli na špatný datový bod a tvářili se
  // jistě. Teď má být místo čísla pomlčka a rovnou výpis toho, co čerpadlo posílá —
  // ať stačí screenshot karty a nemusí se lovit /api/heatpump/raw.
  ukaz(zaklad({ tempC: null, poolTemp: bezTeploty,
    dp: [{ code: 'temp_current', value: -220 }, { code: 'inlet_temp', value: 29 }] }));
  check('nesmyslná teplota se nekreslí jako číslo', hpTemp.textContent, '– °C');
  check('  a karta vypíše, co čerpadlo hlásí', /hlásí: temp_current=-220, inlet_temp=29/.test(hpMeta.textContent), 'true');
  // Pomlčka sama by vypadala jako výpadek, a to je něco úplně jiného: čerpadlo
  // odpovídá, jen teplotu vody přes Tuyu neposílá
  check('  a řekne se to slovy', /přes Tuyu teplotu vody nehlásí/.test(hpMeta.textContent), 'true');
  check('  ne jako výpadek', /offline|zestárla|nechodí data/.test(hpMeta.textContent), 'false');
  check('  cíl přitom zůstane', /cíl 28,0 °C/.test(hpMeta.textContent), 'true');
  ukaz(zaklad({ tempC: 26.4, dp: [{ code: 'inlet_temp', value: 26.4 }] }));
  check('když teplota sedí, výpis kódů se neukazuje', /hlásí:/.test(hpMeta.textContent), 'false');
  check('  ani hláška o nehlášené teplotě', /nehlásí/.test(hpMeta.textContent), 'false');

  R.push('\\n5) Pořadí a rozdělení karet');
  const karty = [...document.querySelector('.slide[data-title="Bazén"] .page')
    .querySelectorAll(':scope > .card')].filter(c => !c.classList.contains('lock-panel'));
  check('teplota je úplně první karta', karty[0].id, 'heatpumpCard');
  // Spotřeba visela pod solinátorem a vypadala jako jeho — přitom je to celý okruh
  const solBlok = document.getElementById('solinatorHold').closest('.device-block');
  check('spotřeba už není v bloku solinátoru', solBlok.contains(document.getElementById('poolTotalPower')), 'false');
  const spotrebaKarta = document.getElementById('poolTotalPower').closest('.card');
  check('má vlastní kartu', spotrebaKarta.querySelector('.graph-title').textContent, 'Spotřeba okruhu bazénu');
  check('  a je v ní řečeno, že to není jen solinátor', /není to spotřeba samotného solinátoru/.test(spotrebaKarta.textContent), 'true');
  check('  karta je až pod světlem',
    karty.indexOf(spotrebaKarta) > karty.findIndex(c => c.contains(document.getElementById('lightBazenLight2'))), 'true');

  R.push('\\n6) Odkud bazén bral');
  poolDaysData = [{ d: new Date(T).toISOString().slice(0, 10), grid: 3000, pv: 9000 }];
  renderPoolSrc();
  const src = document.getElementById('poolSrcList');
  check('karta se vykreslí', /kWh/.test(src.textContent), 'true');
  check('  ukáže celkem', /12,0 kWh/.test(src.textContent), 'true');
  check('  ze sítě', /ze sítě 3,0 kWh/.test(src.textContent), 'true');
  check('  i podíl z FVE', /9,0 kWh z FVE \\(75 %\\)/.test(src.textContent), 'true');

  R.push('\\n7) Měsíční rozpad');
  monthsData = [
    { m: '2026-06', pool: 10000, poolGrid: 2000, poolPv: 8000 },
    { m: '2026-07', pool: 20000 }
  ];
  renderMonths();
  const mes = document.getElementById('poolMonths');
  check('měsíc s rozpadem ho ukáže', /ze sítě 2,0 kWh/.test(mes.textContent), 'true');
  // Starší měsíce rozpad nemají a nesmí se dokreslit jako nula — „nevíme" není „nic ze sítě"
  const radky = [...mes.querySelectorAll('.wbsrc-row')];
  // Pozor: „červenec" začíná na „červen", takže se musí porovnávat celý popisek
  const podleMesice = jm => radky.find(x => {
    const d = x.querySelector('.wbsrc-day');
    return d && d.textContent.trim().startsWith(jm + ' ');
  });
  const cerven = podleMesice('červen');
  const cervenec = podleMesice('červenec');
  check('  a je u správného měsíce', !!cerven.querySelector('.wbsrc-bar'), 'true');
  check('měsíc bez rozpadu zůstane bez pruhu', !!cervenec.querySelector('.wbsrc-bar'), 'false');
  check('  ale celkové kWh ukáže', /20,0 kWh/.test(cervenec.textContent), 'true');
  // Součtový pruh smí sčítat jen měsíce, které rozpad mají
  const soucet = radky.find(x => x.classList.contains('wbsrc-total'));
  check('součet bere jen měsíce s rozpadem', /ze sítě 2,0 kWh/.test(soucet.textContent), 'true');
  check('  a celkem je za všechny', /30,0 kWh/.test(soucet.textContent), 'true');

  R.push('\\n8) Bazén v grafu na FVE není vůbec');
  // Teplota vody patří na kartu tepelného čerpadla a panel s ODBĚREM okruhů
  // (bazén + oba bojlery) byl zrušený celý. Kdyby se cokoli z toho vrátilo, tekla by
  // do zálohy i do telefonu data, na která se nikdo nedívá — a nikdo by si toho nevšiml.
  const panel = String(panelBoilers);
  check('panel teplot kreslí jen oba bojlery', /for \\(const key of \\['b1', 'b2'\\]\\)/.test(panel), 'true');
  check('  a bazén v něm není', /'pool'/.test(panel), 'false');
  check('popisek panelu mluví o bojlerech',
    FVE_PANELS.some(x => x.draw === panelBoilers && x.label === 'Bojlery (°C)'), 'true');
  check('panel odběru okruhů je pryč', typeof panelUsage, 'undefined');
  check('  a žádný jiný panel o bazénu nemluví',
    FVE_PANELS.some(x => /Bazén/.test(x.label)), 'false');
  check('barva bazénu se nikde nedrží', String(BOILER_COLORS.pool), 'undefined');
  check('legenda pod grafem bazén neslibuje',
    /'Bazén'/.test(String(renderBoilerLegend)), 'false');

  R.push('\\n9) Teplota platí, jen když voda proudí');
  // Čidlo je v čerpadle, ne v bazénu. Když bazén ani solinátor neběží, voda v trubce
  // stojí a vychladne — karta dřív ukazovala tu trubku. Teď drží poslední hodnotu
  // naměřenou za chodu a musí být poznat, že je to zapamatované číslo.
  ukaz(zaklad({ poolTemp: { c: 26.4, at: T, zive: true, duvod: null } }));
  check('za chodu se ukazuje živá teplota', hpTemp.textContent, '26,4 °C');
  check('  a nic se k ní nedopisuje', /Naměřeno|nekoluje/.test(hpMeta.textContent), 'false');

  ukaz(zaklad({ on: false, poolTemp: { c: 26.4, at: T - 90 * MIN, zive: false, duvod: null } }));
  check('po vypnutí drží zapamatovanou', hpTemp.textContent, '26,4 °C');
  check('  a řekne, že voda nekoluje', /voda teď nekoluje/.test(hpMeta.textContent), 'true');
  check('  i kdy se měřilo', /Naměřeno v \\d\\d?:\\d\\d/.test(hpMeta.textContent), 'true');

  ukaz(zaklad({ poolTemp: { c: null, at: null, zive: false, duvod: 'zima' } }));
  check('v zimě je pomlčka', hpTemp.textContent, '– °C');
  check('  a řekne se proč', /v zimě vypnutý/.test(hpMeta.textContent), 'true');
  check('  ne jako porucha čerpadla', /nehlásí|offline|zestárla/.test(hpMeta.textContent), 'false');

  ukaz(zaklad({ poolTemp: bezTeploty }));
  check('bez jediného měření taky pomlčka', hpTemp.textContent, '– °C');
  check('  a řekne se, na co se čeká', /až se bazén rozběhne/.test(hpMeta.textContent), 'true');

  // Past: velké číslo se bere ze zapamatované teploty, ne ze syrového čidla. Kdyby se
  // vrátilo tempC, byla by tu zase teplota trubky.
  ukaz(zaklad({ tempC: 18.2, poolTemp: { c: 26.4, at: T - 90 * MIN, zive: false, duvod: null } }));
  check('syrové čidlo velké číslo nepřebije', hpTemp.textContent, '26,4 °C');

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
