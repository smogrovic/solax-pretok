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
setTimeout(() => {
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
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

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
