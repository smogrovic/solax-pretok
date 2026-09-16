// Editor rozvrhu žaluzií na stránce Žaluzie.
//
// Past, kvůli které tu je kontrola úpravy: formulář slouží zároveň k zakládání
// i k opravám. Kdyby si nepamatoval, které pravidlo se upravuje, každá oprava času
// by v seznamu založila druhé pravidlo navíc a v domě by pak jezdilo obojí.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno.padEnd(52) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
const poslano = [];
window.fetch = async (url, opts) => {
  const telo = opts && opts.body ? JSON.parse(opts.body) : null;
  poslano.push({ url: String(url), body: telo });
  return { ok: true, status: 200, json: async () => ({ rules: SERVER, savedAt: Date.now() }) };
};
let SERVER = [];
setTimeout(async () => {
 try {
  const pockej = () => new Promise(r => setTimeout(r, 30));
  const karta = document.getElementById('rozvrhCard');
  const dny = () => [...document.querySelectorAll('#rozvrhDny button')];
  const zvolene = () => dny().filter(b => b.classList.contains('on')).map(b => b.textContent).join('');

  R.push('1) Karta je na první stránce žaluzií');
  const slide = karta.closest('.slide');
  check('stojí na stránce Žaluzie', slide.dataset.title, 'Žaluzie');
  // Pravidla míří na jména, ne na stránky — na druhé kartě by ukazovala totéž dvakrát
  check('  a na druhé stránce není',
    !!document.getElementById('blindsSlide2').querySelector('#rozvrhCard'), false);
  check('je pod časovačem',
    [...slide.querySelectorAll('.page > .card')].indexOf(karta),
    [...slide.querySelectorAll('.page > .card')].length - 1);

  R.push('\\n2) Dny: sedm políček a rychlé volby');
  check('dnů je sedm', dny().length, 7);
  check('  a jmenují se česky', dny().map(b => b.textContent).join(' '), 'Po Út St Čt Pá So Ne');
  document.querySelector('.rozvrh-rychle [data-dny="vikend"]').click();
  check('So–Ne zaškrtne víkend', zvolene(), 'SoNe');
  document.querySelector('.rozvrh-rychle [data-dny="pracovni"]').click();
  check('Po–Pá všední dny', zvolene(), 'PoÚtStČtPá');
  document.querySelector('.rozvrh-rychle [data-dny="vse"]').click();
  check('Každý den všechny', zvolene(), 'PoÚtStČtPáSoNe');
  // Rychlé volby jsou jen zkratka — jednotlivé dny musí jít doklikat
  dny()[2].click();
  check('a jednotlivý den jde odškrtnout', zvolene(), 'PoÚtČtPáSoNe');

  R.push('\\n3) Čas nebo slunce, ne obojí');
  const kdy = document.getElementById('rozvrhKdy');
  const cas = document.getElementById('rozvrhCas');
  const posun = document.getElementById('rozvrhPosun');
  check('na začátku je vidět čas', cas.hidden, false);
  check('  a posun ne', posun.hidden, true);
  kdy.value = 'zapad';
  kdy.dispatchEvent(new Event('change'));
  check('u západu se přepne na posun', posun.hidden, false);
  check('  a čas zmizí', cas.hidden, true);

  R.push('\\n4) Přidání a úprava');
  // Cíle jsou jména, ne adresy zařízení — server je páruje stejně jako u asistenta
  blinds = [
    { deviceURL: 'io://1', label: 'Obývák Okno', room: 'Obývák', type: 'cover' },
    { deviceURL: 'io://2', label: 'Kuchyň', room: 'Obývák', type: 'cover' },
    { deviceURL: 'io://3', label: 'Ložnice', room: 'Ložnice', type: 'cover' }
  ];
  renderRozvrhCile();
  const cil = document.getElementById('rozvrhCil');
  check('v cílech je „Vše"', cil.options[0].value, 'Vše');
  check('  i skupiny a štítky',
    [...cil.options].map(o => o.value).join(', '), 'Vše, Obývák, Kuchyň, Ložnice, Obývák Okno');

  document.querySelector('.rozvrh-rychle [data-dny="pracovni"]').click();
  kdy.value = 'cas';
  kdy.dispatchEvent(new Event('change'));
  cas.value = '06:15';
  cil.value = 'Ložnice';
  document.getElementById('rozvrhAkce').value = 'down';
  document.getElementById('rozvrhNaklon').value = '100';
  poslano.length = 0;
  document.getElementById('rozvrhAdd').click();
  await pockej();
  check('pravidlo se pošle', poslano[0].url, '/api/blinds/schedule');
  check('  se dny', poslano[0].body.dny.join(','), 'true,true,true,true,true,false,false');
  check('  časem', poslano[0].body.kdy.cas, '06:15');
  check('  cílem', poslano[0].body.cil, 'Ložnice');
  check('  akcí a naklopením', poslano[0].body.akce + ':' + poslano[0].body.naklopeni, 'down:100');
  check('  a bez id, protože je nové', poslano[0].body.id, undefined);

  SERVER = [{ id: 7, zapnuto: true, dny: [true, true, true, true, true, false, false],
              kdy: { typ: 'cas', cas: '06:15' }, cil: 'Ložnice', akce: 'down', naklopeni: 100 }];
  renderRozvrh({ rules: SERVER, savedAt: Date.now() });
  const radky = () => [...document.querySelectorAll('#rozvrhList .timer-row')];
  check('pravidlo je v seznamu', radky().length, 1);
  check('  s časem', radky()[0].querySelector('.timer-row-time').textContent, '06:15');
  check('  a popisem', radky()[0].querySelector('.timer-row-text').textContent,
    'Ložnice — zatáhnout na 100 % · Po Út St Čt Pá');

  // Klik na řádek ho načte do formuláře; další uložení musí pravidlo PŘEPSAT
  radky()[0].querySelector('.timer-row-text').click();
  check('klik na řádek načte pravidlo', cas.value, '06:15');
  check('  a tlačítko změní popis', document.getElementById('rozvrhAdd').textContent, 'Uložit změnu');
  cas.value = '06:45';
  poslano.length = 0;
  document.getElementById('rozvrhAdd').click();
  await pockej();
  check('úprava jde na totéž id', poslano[0].body.id, 7);
  check('  s novým časem', poslano[0].body.kdy.cas, '06:45');
  check('a tlačítko se vrátí', document.getElementById('rozvrhAdd').textContent, 'Přidat pravidlo');

  R.push('\\n5) Vypnutí a smazání');
  renderRozvrh({ rules: SERVER, savedAt: Date.now() });
  poslano.length = 0;
  radky()[0].querySelector('.rozvrh-prep').click();
  await pockej();
  check('pauza pravidlo vypne, nesmaže', poslano[0].body.zapnuto, false);
  check('  a pošle ho s jeho id', poslano[0].body.id, 7);
  SERVER = [{ ...SERVER[0], zapnuto: false }];
  renderRozvrh({ rules: SERVER, savedAt: Date.now() });
  check('vypnuté je vidět v seznamu', radky().length, 1);
  check('  ale zešedne', radky()[0].classList.contains('rozvrh-vyp'), true);
  poslano.length = 0;
  radky()[0].querySelector('.timer-del').click();
  await pockej();
  check('křížek maže', poslano[0].url, '/api/blinds/schedule/delete');
  check('  podle id', poslano[0].body.id, 7);

  R.push('\\n6) Záloha v telefonu');
  // Rozvrh je nastavení od člověka a v paměti serveru nepřežije nasazení
  const zaloha = JSON.parse(localStorage.getItem('blindRules') || 'null');
  check('rozvrh se ukládá do telefonu', Array.isArray(zaloha.rules), true);
  check('  i s časem uložení', typeof zaloha.savedAt, 'number');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (rozvrh žaluzií)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'rozvrh.html');
fs.writeFileSync(out, v);
console.log(out);
