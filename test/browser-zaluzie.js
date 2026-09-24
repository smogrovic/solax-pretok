// Šedé boxy na stránce Žaluzie: jeden box = jedno místo, kam se dá ukázat prstem.
//
// Kuchyň a obývák jsou jeden otevřený prostor, takže je TaHoma hlásí jako JEDNU
// místnost. Všechny tři žaluzie tím spadly do jednoho šedého boxu a „Kuchyň" se
// ztrácela mezi „Obývák Okno" a „Obývák Dveře". Rozhoduje proto štítek žaluzie,
// ne místnost z TaHomy — a kuchyň má vlastní box, jako ložnice nebo Mikiho pokoj.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno.padEnd(52) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(async () => {
 try {
  // Tak, jak to chodí z TaHomy: tři žaluzie přízemí hlásí tutéž místnost
  const zaluzie = (label, room) => ({
    deviceURL: 'io://' + label, label: label, room: room, type: 'cover',
    position: 0, hasOrientation: true, orientation: 50
  });
  blinds = [
    zaluzie('Obývák Okno', 'Obývák'),
    zaluzie('Kuchyň', 'Obývák'),
    zaluzie('Obývák Dveře', 'Obývák'),
    zaluzie('Ložnice', 'Ložnice'),
    zaluzie('Miky 1', 'Miky'),
    zaluzie('Miky 2', 'Miky')
  ];
  renderBlinds();

  R.push('1) Kuchyň má vlastní šedý box');
  const boxy = n => [...document.getElementById(n).querySelectorAll('.blind-room')]
    .map(b => b.querySelector('.blind-room-title').textContent);
  check('na první stránce jsou dva boxy', boxy('blindsList1').join(' | '), 'Obývák | Kuchyň');
  check('  a kuchyň je hned pod obývákem', boxy('blindsList1')[1], 'Kuchyň');
  const prvni = [...document.getElementById('blindsList1').querySelectorAll('.blind-room')];
  check('v obýváku zůstaly jeho dvě', prvni[0].querySelectorAll('.blind-item').length, 2);
  check('  a v kuchyni je jen ta kuchyňská', prvni[1].querySelectorAll('.blind-item').length, 1);
  check('  se svým štítkem', prvni[1].querySelector('.blind-label').textContent, 'Kuchyň');
  // Šedé je to, co box od boxu odděluje — bez pozadí by to byl jeden dlouhý sloupec
  check('box má šedé pozadí', getComputedStyle(prvni[1]).backgroundColor, 'rgba(44, 62, 80, 0.04)');
  check('  a mezeru od sousedního', parseFloat(getComputedStyle(prvni[0]).marginBottom) >= 8, true);

  R.push('\\n2) Zbytek zůstal, jak byl');
  check('ložnice a Miky jsou na druhé stránce', boxy('blindsList2').join(' | '), 'Ložnice | Miky');
  check('  a Miky má obě své', [...document.getElementById('blindsList2')
    .querySelectorAll('.blind-room')][1].querySelectorAll('.blind-item').length, 2);

  R.push('\\n3) Časovač zná kuchyň zvlášť');
  // Časovač řadí místnosti stejně jako ovládání — jinak by „Kuchyň" v seznamu chyběla
  const volby = blindTimerOptions(1).map(o => o.label);
  check('kuchyň je v seznamu vlastní položkou', volby.includes('Kuchyň'), true);
  check('  a obývákové taky', volby.filter(l => /Obývák/.test(l)).join(','), 'Obývák Okno,Obývák Dveře');

  R.push('');
  R.push('4) Jezdec naklopen\u00ed');
  // Dřív byl jezdec poslední v řádku, takže končil na hraně karty — a tažení
  // od kraje obrazovky appka brala jako listování stránek místo naklopení lamel.
  const box = document.querySelector('#blindsList1 .blind-room');
  const tilt = box.querySelector('.blind-tilt');
  const jezdec = tilt.querySelector('input[type=range]');
  check('u \u017ealuzie popisek \u201eNaklopen\u00ed\u201c nen\u00ed',
    !!tilt.querySelector('.blind-tilt-label'), 'false');
  check('  ale procenta z\u016fstala', /%/.test(tilt.textContent), 'true');
  const stred = el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
  check('jezdec sed\u00ed na st\u0159edu karty',
    Math.abs(stred(jezdec) - stred(box)) < 1.5, 'true');
  // Procenta patří nalevo od jezdce, ne napravo
  const proc = tilt.querySelector('.blind-tilt-val');
  check('  a procenta jsou vlevo od n\u011bj',
    proc.getBoundingClientRect().right <= jezdec.getBoundingClientRect().left + 1, 'true');
  const rb = box.getBoundingClientRect(), rj = jezdec.getBoundingClientRect();
  check('  a od obou hran m\u00e1 m\u00edsto',
    Math.min(rj.left - rb.left, rb.right - rj.right) >= 40, 'true');
  // Šířka se neměla srazit — jen se místo popisku posunula na druhou stranu
  // Šířka se neměla srazit: dřív mu popisek s hodnotou ubraly ~108 px, teď mu
  // mřížka ubere ~112. Zbytek karty mu má pořád patřit.
  check('  a z\u016fstal skoro stejn\u011b \u0161irok\u00fd', rj.width > rb.width * 0.5, 'true');
  // Formuláře časovače a rozvrhu mají pořadí popisek → jezdec → hodnota, takže
  // ke hraně nesahají a popisek tam dává smysl
  check('v \u010dasova\u010di popisek z\u016fst\u00e1v\u00e1',
    document.querySelector('.timer-card .blind-tilt .blind-tilt-label').textContent, 'Naklopen\u00ed');
  check('  i v rozvrhu',
    document.getElementById('rozvrhNaklonLabel').textContent, 'Naklopen\u00ed');
  R.push('');
  R.push('4b) Naklopen\u00ed b\u011bhem j\u00edzdy');
  // Server naklopen\u00ed odlo\u017e\u00ed, kdy\u017e \u017ealuzie je\u0161t\u011b jede \u2014 appka to \u0159ekne
  const ceka = box.querySelector('.blind-tilt-ceka');
  check('hl\u00e1\u0161ka je schovan\u00e1', ceka.hidden, 'true');
  const puvodniFetch = window.fetch;
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, ceka: true }) });
  jezdec.value = '30'; jezdec.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 50));
  check('kdy\u017e server \u010dek\u00e1, uk\u00e1\u017ee se', ceka.hidden + ' ' + ceka.textContent, 'false Naklop\u00ed se po dojet\u00ed');
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, ceka: false }) });
  jezdec.value = '40'; jezdec.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 50));
  check('  a po okam\u017eit\u00e9m naklopen\u00ed zmiz\u00ed', ceka.hidden, 'true');
  window.fetch = puvodniFetch;
  R.push('');
  R.push('5) Poloha se nep\u00ed\u0161e slovy');
  // Vedle v řádku ji kreslí ukazatel pruhem a píše pod něj procenta — text
  // „zavřeno" byl tatáž informace podruhé. Na zataženou roletu je navíc vidět.
  blinds = [
    { deviceURL: 'io://Loznice', label: 'Lo\u017enice', room: 'Lo\u017enice', type: 'cover',
      hasOrientation: true, orientation: 50, hasClosure: true, closure: 100 },
    { deviceURL: 'io://SvetlaTerasa', label: 'Sv\u011btla terasa', room: 'Terasa',
      type: 'switch', onState: true }
  ];
  renderBlinds();
  // Ložnice patří na druhou stránku žaluzií, takže se hledá v obou seznamech
  const radky = [...document.querySelectorAll('.blind-row')];
  const roleta = radky.find(r => /Lo\u017enice/.test(r.textContent));
  check('roleta u\u017e popisek polohy nem\u00e1', !!roleta.querySelector('.blind-pos'), 'false');
  check('  a slovo \u201ezav\u0159eno" v \u0159\u00e1dku nen\u00ed', /zav\u0159eno/.test(roleta.textContent), 'false');
  // Ta informace se neztrácí, jen ji nese ukazatel
  check('  ale ukazatel po\u0159\u00e1d p\u00ed\u0161e procenta',
    roleta.querySelector('.blind-meter-pct').textContent, '100 %');
  // Světlo ukazatel nemá, takže tohle je jediné, z čeho se u něj stav pozná
  const svetlo = radky.find(r => /Sv\u011btla terasa/.test(r.textContent));
  check('sv\u011btlu popisek z\u016fst\u00e1v\u00e1', !!svetlo.querySelector('.blind-pos'), 'true');
  check('  a \u0159\u00edk\u00e1 stav', svetlo.querySelector('.blind-pos').textContent, 'zapnuto');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (žaluzie)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'zaluzie.html');
fs.writeFileSync(out, v);
console.log(out);
