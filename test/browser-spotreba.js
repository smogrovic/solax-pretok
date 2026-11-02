// Stránka Spotřeba: souhrn 12 měsíců, graf, tabulka se sloupci jako ručně vedená
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');
const HISTORIE = require('../data/spotreba-historie.json').mesice;

const DRIVER = `
const OUT = [];
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
function check(name, got, want) {
  const ok = String(got) === String(want);
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(54) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const HISTORIE = ${JSON.stringify(HISTORIE)};

(async () => {
 try {
  await wait(150);
  const slide = document.getElementById('spotrebaSlide');
  check('stránka Spotřeba je hned za FVE', slide.previousElementSibling.dataset.title, 'FVE');
  spotrebaData = null;
  renderSpotreba();
  check('bez dat hláška', /načítají/.test(document.getElementById('spSouhrn').textContent), true);

  const BEZI = { m: '2026-11', celkova: 120, bazen: 0, sauna: 0, auto: 15, tcTopeni: 12, tcVoda: 8, b1: 0, b2: 0, voda: 8,
    zbytek: 85, sit: 52, pretok: 0, samo: true, bezi: true };
  const CENIK = { vt: 4.32625, nt: 3.42394, mesicne: 850.47, nazev: 'ČEZ D56d, jistič 3×25 A', vtPodilCas: 0.167 };
  spotrebaData = { mesice: HISTORIE.map(r => ({ ...r, rucne: true, ...(r.m === '2026-10' ? { venku: 9.4 } : r.m === '2025-10' ? { venku: 10.1 } : {}) }))
    .concat([BEZI]), rucneDo: '2026-10', cenik: CENIK };
  slide.scrollIntoView();
  renderSpotreba();
  const souhrn = document.getElementById('spSouhrn');
  check('12 měsíců jako v tabulce (bez běžícího)', souhrn.querySelector('.sp-celkem b').textContent, '18,02');
  check('  období', /listopad 2025 – říjen 2026/.test(souhrn.textContent), true);
  check('  legenda: TČ topení', [...souhrn.querySelectorAll('.sp-leg')].find(l => /TČ topení/.test(l.textContent)).querySelector('b').textContent,
    '3 352 kWh');
  check('  ze sítě a přetok', /ze sítě 8 841 kWh/.test(souhrn.textContent) && /přetok 1 549 kWh/.test(souhrn.textContent), true);
  check('  pruh má 6 dílů', souhrn.querySelectorAll('.sp-pruh i').length, 6);
  const statky = [...souhrn.querySelectorAll('.sp-statky .stat-row')].map(r => r.children[0].textContent + ': ' + r.children[1].textContent);
  check('  výroba, soběstačnost, peníze, teplota, loňsko', statky.join(' / '),
    'Výroba FVE: 10 732 kWh / Soběstačnost: 51 % / Zaplaceno za elektřinu: ~41 809 Kč / Ušetřeno díky FVE: ~32 826 Kč / Průměrně venku: 9,4 °C / Celkem proti loňsku (9 měs.): +24 % / TČ topení proti loňsku (9 měs.): −19 %');

  const sloupce = document.querySelectorAll('#spGraf .sp-sloupec');
  check('graf: sloupec na měsíc', sloupce.length, HISTORIE.length + 1);
  check('  běžící měsíc bledý', sloupce[sloupce.length - 1].getAttribute('opacity'), '0.45');
  check('  venkovní teplota čárou (2 měsíce s teplotou)', document.querySelectorAll('#spGraf circle').length + ' ' + !!document.querySelector('#spGraf .sp-teplota'), '2 true');

  const tab = document.querySelector('.sp-tabulka');
  const hlavicka = [...tab.querySelectorAll('thead th')].map(t => t.textContent).slice(1).join('|');
  check('tabulka: sloupce jako ručně vedená', hlavicka,
    'Celková|Bazén|Sauna|Auto|TČ topení|TČ voda|TČ dohřev bojler 1|Bojler 2 (přídavný)|Voda celkem|Dům zbytek|Ze sítě|Přetok|Výroba FVE|Sobě­stač­nost|Venku|Náklady|Ušetřeno FVE');
  const radky = [...tab.querySelectorAll('tbody tr')];
  check('  nahoře součet 12 měsíců', radky[0].textContent.startsWith('12 měsíců18 024'), true);
  check('  12 měsíců: náklady a úspora', [...radky[0].querySelectorAll('td')].slice(16).map(t => t.textContent).join(' | '), '~41 809 Kč | ~32 826 Kč');
  check('  pak běžící měsíc s označením', radky[1].classList.contains('sp-bezi') && /běží/.test(radky[1].textContent), true);
  const rij = [...radky[2].querySelectorAll('td')];
  check('  říjen 2026 hodnoty jako v tabulce', rij.slice(0, 13).map(t => t.firstChild.textContent).join(' '),
    'říj 26 1 431 38 85 303 121 58 88 50 196 688 804 35');
  check('  výroba = celková − síť + přetok, soběstačnost', rij[13].textContent + ' | ' + rij[14].textContent, '662 | 44 %');
  check('  venku, náklady (~ = VT/NT podle času), ušetřeno', [rij[15].textContent, rij[16].textContent, rij[17].textContent].join(' | '),
    '9,4 °C | ~3 724 Kč | ~2 241 Kč');
  check('  proti říjnu 2025: celková víc (červeně), TČ topení míň (zeleně)',
    rij[1].querySelector('.sp-zmena').textContent + ' ' + rij[1].querySelector('.sp-zmena').className + ' | ' + rij[5].querySelector('.sp-zmena').textContent + ' ' + rij[5].querySelector('.sp-zmena').className,
    '+25 % sp-zmena vic | −46 % sp-zmena min');
  check('  běžící měsíc bez srovnání', radky[1].querySelectorAll('.sp-zmena').length, 0);
  check('  únor 2025 nemá s čím srovnat', radky[radky.length - 1].querySelectorAll('.sp-zmena').length, 0);
  check('  nejstarší dole', radky[radky.length - 1].dataset.m, '2025-02');
  check('poznámka o ruční části', /Do října 2026 z ručně vedené tabulky/.test(document.getElementById('spPozn').textContent), true);
  const obal = document.getElementById('spTabulkaObal');
  check('tabulka se posouvá uvnitř karty, stránka nepřetéká',
    obal.scrollWidth > obal.clientWidth && slide.querySelector('.page').scrollWidth <= slide.querySelector('.page').clientWidth + 1, true);
  check('  první sloupec drží na místě', getComputedStyle(tab.querySelector('td')).position, 'sticky');
  const leg = souhrn.querySelector('.sp-legenda');
  check('legenda se vejde', leg.scrollWidth <= leg.clientWidth + 1, true);

  // Méně než 12 hotových měsíců
  spotrebaData = { mesice: HISTORIE.slice(0, 3), rucneDo: null };
  renderSpotreba();
  check('málo měsíců: nadpis podle počtu', document.getElementById('spSouhrnTitul').textContent, 'Posledních 3 měsíců');
 } catch (e) { OUT.push('CHYBA výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const bad = OUT.filter(l => l.startsWith('CHYBA')).length;
  OUT.push('\\n' + (bad === 0 ? 'VŠE PROŠLO — ' + OUT.length + ' ok, 0 chyb (spotreba)' : 'SELHALO — ' + bad + ' chyb'));
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = OUT.join('\\n');
  document.body.appendChild(pre);
})();
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'spotreba.html');
fs.writeFileSync(out, v);
console.log(out);
