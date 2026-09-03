// Mezera mezi kartami. Karta bez modifikátoru se dřív tiše nalepila na sousedku
// (tak vznikl #nukiCard a naposledy dvě slepené karty na saune) — tahle sada projde
// všechny stránky a hlídá, že každá karta kromě první nějakou mezeru má.
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
  // Stránky jsou vedle sebe v posouvací liště, takže kartu neschovává display:none —
  // vidíme na ně všechny naráz. Zámkový panel je ale při odemčeném domě opravdu skrytý.
  const viditelna = el => getComputedStyle(el).display !== 'none';
  const mezera = el => parseFloat(getComputedStyle(el).marginTop) || 0;

  const slepene = [];
  const stranky = Array.from(document.querySelectorAll('.slide'));
  check('stránek je dvanáct', stranky.length, 12);

  for (const slide of stranky) {
    const karty = Array.from(slide.querySelectorAll('.page > .card')).filter(viditelna);
    karty.forEach((karta, i) => {
      if (i === 0) return;                      // první kartu odsazuje stránka sama
      if (mezera(karta) < 10) {
        slepene.push(slide.dataset.title + ' #' + (i + 1) + ' (' + karta.className + ')');
      }
    });
  }
  check('žádné dvě karty se nedotýkají', slepene.join(' | ') || 'žádné', 'žádné');

  // Konkrétně to, co bylo rozbité: dvě obyčejné karty za sebou na saune
  const sauna = stranky.find(s => s.dataset.title === 'Sauna');
  const saunaKarty = Array.from(sauna.querySelectorAll('.page > .card')).filter(viditelna);
  check('sauna má šest karet', saunaKarty.length, 6);
  check('  a Kamna HUUM mají mezeru od měřáku', mezera(saunaKarty[1]) >= 12, true);

  // Grafy si drží svých 10 px — obecné pravidlo je nesmí přebít
  const fve = stranky.find(s => s.dataset.title === 'FVE');
  const graf = fve.querySelector('.page > .card.graph-card');
  check('graf na FVE má pořád 10 px', mezera(graf), 10);

  // Zámkový panel je při odemčeném domě skrytý, ale sousedem v DOMu zůstává —
  // karta za ním si proto musí nechat to, co měla dosud, a ne dostat okraj navíc
  const prvniViditelna = titul => {
    const sl = stranky.find(x => x.dataset.title === titul);
    return Array.from(sl.querySelectorAll('.page > .card')).filter(viditelna)[0];
  };
  check('Ovládání se kvůli zámku neposune', mezera(prvniViditelna('Ovládání')), 0);
  check('  a Wallbox taky ne', mezera(prvniViditelna('Wallbox')), 0);
  check('Bazén si svých 12 px nechá', mezera(prvniViditelna('Bazén')), 12);

  // První karta na stránce okraj z obecného pravidla nedostane
  const log = stranky.find(s => s.dataset.title === 'Log');
  check('jediná karta na Logu nemá okraj navíc',
    mezera(log.querySelector('.page > .card')), 0);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (mezery)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'mezery.html');
fs.writeFileSync(out, v);
console.log(out);
