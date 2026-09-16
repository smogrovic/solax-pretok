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
  // Nenaklikané kroky = jednoduché pravidlo z výběru, ať nestojí dva kliky navíc
  check('  a jedním krokem z výběru', poslano[0].body.kroky.length, 1);
  check('  s cílem', poslano[0].body.kroky[0].cil, 'Ložnice');
  check('  akcí a hodnotou',
    poslano[0].body.kroky[0].akce + ':' + poslano[0].body.kroky[0].hodnota, 'down:100');
  check('  a bez id, protože je nové', poslano[0].body.id, undefined);

  R.push('\\n4b) Skupina: víc kroků pod jedním časem');
  // V 7:00 se obvykle stane víc věcí. Čas se pak mění na jednom místě, ne ve třech
  // pravidlech, u kterých se jedno dá zapomenout.
  const kroky = () => [...document.querySelectorAll('#rozvrhKroky .rozvrh-krok')];
  check('na začátku jsou kroky prázdné', kroky().length, 0);
  cil.value = 'Ložnice';
  document.getElementById('rozvrhAkce').value = 'up';
  document.getElementById('rozvrhKrokAdd').click();
  cil.value = 'Obývák';
  document.getElementById('rozvrhAkce').value = 'down';
  document.getElementById('rozvrhNaklon').value = '100';
  document.getElementById('rozvrhKrokAdd').click();
  cil.value = 'Kuchyň';
  document.getElementById('rozvrhAkce').value = 'tilt';
  document.getElementById('rozvrhNaklon').value = '40';
  document.getElementById('rozvrhKrokAdd').click();
  check('tři kroky se přidaly', kroky().length, 3);
  check('  a jsou očíslované', kroky().map(k => k.querySelector('b').textContent).join(''), '1.2.3.');
  check('  s popisem', kroky()[1].querySelector('span').textContent, 'Obývák — zatáhnout na 100 %');
  kroky()[1].querySelector('button').click();
  check('křížek krok ubere', kroky().length, 2);
  check('  a zbudou ty správné',
    kroky().map(k => k.querySelector('span').textContent.split(' —')[0]).join(','), 'Ložnice,Kuchyň');
  document.getElementById('rozvrhNazev').value = 'Ráno';
  poslano.length = 0;
  document.getElementById('rozvrhAdd').click();
  await pockej();
  check('pošlou se oba kroky', poslano[0].body.kroky.length, 2);
  // Pořadí je to, co člověk naklikal — „vytáhni a pak zaklop" je něco jiného než obráceně
  check('  v naklikaném pořadí',
    poslano[0].body.kroky.map(k => k.cil).join(','), 'Ložnice,Kuchyň');
  check('  s názvem skupiny', poslano[0].body.nazev, 'Ráno');
  check('  a jedním spouštěčem', poslano[0].body.kdy.cas, '06:15');

  SERVER = [{ id: 7, zapnuto: true, nazev: 'Ráno', dny: [true, true, true, true, true, false, false],
              kdy: { typ: 'cas', cas: '06:15' },
              kroky: [{ cil: 'Ložnice', akce: 'up', hodnota: null },
                      { cil: 'Obývák', akce: 'down', hodnota: 100 }] }];
  renderRozvrh({ rules: SERVER, savedAt: Date.now() });
  const radky = () => [...document.querySelectorAll('#rozvrhList .timer-row')];
  check('skupina je v seznamu jako jeden blok', radky().length, 1);
  check('  s časem', radky()[0].querySelector('.timer-row-time').textContent, '06:15');
  check('  názvem a dny', radky()[0].querySelector('.timer-row-text').textContent, 'Ráno · Po Út St Čt Pá');
  check('  a kroky pod tím', radky()[0].querySelector('.rozvrh-podkroky').textContent,
    'Ložnice — vytáhnout · Obývák — zatáhnout na 100 %');

  // Klik na hlavičku načte celou skupinu; další uložení ji musí PŘEPSAT
  radky()[0].querySelector('.rozvrh-hlava').click();
  check('klik načte celou skupinu', kroky().length, 2);
  check('  i s názvem', document.getElementById('rozvrhNazev').value, 'Ráno');
  // Odklad („počkej, až sauna dotopí") se v appce nenastavuje, ale při opravě času
  // se nesmí ztratit — jinak by se ložnice po první úpravě zavírala i při sauně
  SERVER = [{ ...SERVER[0], odloz: { typ: 'sauna', minut: 30 } }];
  renderRozvrh({ rules: SERVER, savedAt: Date.now() });
  // Odklad patří ke krokům, ne do sloupce s časem — tam by rozhodil celý řádek
  check('odklad je v seznamu vidět',
    /čeká 30 min po sauně/.test(radky()[0].querySelector('.rozvrh-podkroky').textContent), true);
  check('  a nerozhodí sloupec s časem',
    radky()[0].querySelector('.timer-row-time').textContent, '06:15');
  radky()[0].querySelector('.rozvrh-hlava').click();
  poslano.length = 0;
  document.getElementById('rozvrhAdd').click();
  await pockej();
  check('  a úpravou se neztratí', (poslano[0].body.odloz || {}).minut, 30);
  SERVER = [{ ...SERVER[0], odloz: null }];
  renderRozvrh({ rules: SERVER, savedAt: Date.now() });
  radky()[0].querySelector('.rozvrh-hlava').click();
  check('klik na řádek načte pravidlo', cas.value, '06:15');
  check('  a tlačítko změní popis', document.getElementById('rozvrhAdd').textContent, 'Uložit změnu');
  cas.value = '06:45';
  poslano.length = 0;
  document.getElementById('rozvrhAdd').click();
  await pockej();
  check('úprava jde na totéž id', poslano[0].body.id, 7);
  check('  s novým časem', poslano[0].body.kdy.cas, '06:45');
  check('  a kroky zůstanou', poslano[0].body.kroky.length, 2);
  check('a tlačítko se vrátí', document.getElementById('rozvrhAdd').textContent, 'Přidat pravidlo');
  check('  a kroky se vyprázdní', kroky().length, 0);

  R.push('\\n4c) Sjet do polohy a popisek hodnoty');
  // Jedno číslo, dva významy: u naklopení lamely, u polohy výška. Bez popisku by se
  // z „20 %" nepoznalo, jestli žaluzie sjede do pětiny, nebo zavře lamely.
  const popisek = document.getElementById('rozvrhNaklonLabel');
  document.getElementById('rozvrhAkce').value = 'tilt';
  document.getElementById('rozvrhAkce').dispatchEvent(new Event('change'));
  check('u naklopení se píše Naklopení', popisek.textContent, 'Naklopení');
  document.getElementById('rozvrhAkce').value = 'poloha';
  document.getElementById('rozvrhAkce').dispatchEvent(new Event('change'));
  check('  u polohy Poloha', popisek.textContent, 'Poloha');
  rozvrhKrokyStav = [];
  rozvrhKresliKroky();
  cil.value = 'Obývák Okno';
  document.getElementById('rozvrhNaklon').value = '20';
  document.getElementById('rozvrhKrokAdd').click();
  check('krok s polohou se čte srozumitelně',
    kroky()[0].querySelector('span').textContent, 'Obývák Okno — sjet do 20 %');
  poslano.length = 0;
  document.getElementById('rozvrhAdd').click();
  await pockej();
  check('  a pošle se jako poloha',
    poslano[0].body.kroky[0].akce + ':' + poslano[0].body.kroky[0].hodnota, 'poloha:20');

  // Posun od slunce se vybírá, ne píše — na zeď se to mačká líp
  // Ve výběru spouštěče je vidět, co „západ slunce" doopravdy znamená
  renderZapadDelay(20);
  check('u západu je vidět společné zpoždění',
    kdy.querySelector('option[value="zapad"]').textContent, 'Západ slunce (+20 min)');
  renderZapadDelay(0);
  check('  a při nule se nic nepřipisuje',
    kdy.querySelector('option[value="zapad"]').textContent, 'Západ slunce');
  renderZapadDelay(20);
  check('posun je výběr', posun.tagName, 'SELECT');
  check('  s rozumnými hodnotami',
    [...posun.options].map(o => o.value).join(','),
    '-90,-60,-45,-30,-20,-15,-10,0,10,15,20,30,45,60,90');
  kdy.value = 'zapad';
  kdy.dispatchEvent(new Event('change'));
  posun.value = '30';
  poslano.length = 0;
  document.getElementById('rozvrhAdd').click();
  await pockej();
  check('  a pošle se číslem', poslano[0].body.kdy.posunMin, 30);
  kdy.value = 'cas';
  kdy.dispatchEvent(new Event('change'));

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
