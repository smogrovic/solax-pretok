// Dětský režim: appka jde dětem do mobilu a mají vidět jen svůj pokoj.
//
// Tři věci, kvůli kterým tahle sada existuje:
//  * Textové pole asistenta umí cokoli — zapnout bojler, odemknout dům. V dětském
//    režimu nesmí být na stránce vůbec, ne jen schované za zámkem.
//  * Miky a Elenka se nesmí vidět navzájem. Stačí jedno pravidlo napsané
//    obráceně a dítě ovládá cizí pokoj.
//  * Z dětského režimu musí vést cesta zpátky. Kdyby přepínač zmizel spolu se
//    zbytkem appky, byl by telefon zamčený napořád.
//
// Co tahle sada NEDOKÁŽE: udělat z toho zámek. Je to plot — schovává se
// v prohlížeči a authToken v telefonu zůstává. Na děti, co appku používají,
// to stačí; víc si od toho nikdo slibovat nemá.
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
const POSLANO = [];
window.fetch = async (url, opts) => {
  POSLANO.push({ url: String(url), telo: opts && opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({ ok: true, success: true }) };
};
const pockej = () => new Promise(r => setTimeout(r, 30));

setTimeout(async () => {
 try {
  const zaluzie = (label, room) => ({
    deviceURL: 'io://' + label, label, room, type: 'cover',
    position: 0, hasOrientation: true, orientation: 50
  });
  blinds = [
    zaluzie('Obývák Okno', 'Obývák'),
    zaluzie('Ložnice', 'Ložnice'),
    zaluzie('Miky Okno', 'Miky'),
    zaluzie('Miky dveře', 'Miky'),
    zaluzie('Elenka Okno', 'Elenka'),
    zaluzie('Elenka Dveře', 'Elenka'),
    // Terasa má vedle žaluzie pergoly i světlo — to je spínač z TaHomy
    zaluzie('Pergola', 'Terasa'),
    { deviceURL: 'io://SvetlaTerasa', label: 'Světla terasa', room: 'Terasa',
      type: 'switch', onState: false }
  ];
  rozvrhData = [
    { id: 1, nazev: 'Ráno', zapnuto: true, dny: [true,true,true,true,true,false,false],
      kdy: { typ: 'cas', cas: '06:40' },
      kroky: [{ cil: 'Miky', akce: 'tilt', hodnota: 50 }, { cil: 'Elenka', akce: 'tilt', hodnota: 50 }] },
    { id: 2, nazev: 'Garáž', zapnuto: true, dny: [true,true,true,true,true,true,true],
      kdy: { typ: 'cas', cas: '23:00' }, kroky: [{ cil: 'Garáž', akce: 'down' }] }
  ];

  const zalozky = () => [...document.querySelectorAll('#pageTabs .page-tab')]
    .filter(t => !t.classList.contains('page-tab-kal')).map(t => t.textContent);
  // Schovaná karta se do potomka nepropíše: display:none se nedědí, jen zruší
  // celý podstrom. Pozná se to podle toho, že prvek nemá na obrazovce místo.
  const vidim = el => !!el && el.getClientRects().length > 0;
  const detiBtns = () => [...document.querySelectorAll('#detiTlacitka .deti-btn')].map(b => b.textContent);

  R.push('1) Ve full režimu je všechno jako dřív');
  pouzijRezim('full');
  check('záložek je čtrnáct', zalozky().length, 14);
  check('  a je mezi nimi Wallbox', zalozky().includes('Wallbox'), true);
  check('pole pro asistenta je vidět', vidim(document.getElementById('asstInput')), true);
  check('dětská tlačítka ne', vidim(document.getElementById('detiTlacitka')), false);
  // Rozvrh je ve full sbalený pod tlačítkem — jde k němu, jen se na něj musí ťuknout
  check('tlačítko na rozvrh je vidět',
    vidim(document.querySelector('.sbal-btn[data-sbal="rozvrh"]')), true);
  sbalNastav('rozvrh', false);
  check('  a po rozbalení jde nastavovat', vidim(document.getElementById('rozvrhCard')), true);
  check('  jeho náhled se neukazuje', vidim(document.getElementById('rozvrhPrehled')), false);
  check('bazén jde spínat', vidim(document.getElementById('poolOnBtn')), true);
  check('na Ovládání je oběhové čerpadlo', vidim(document.getElementById('obehOnBtn')), true);
  check('  i zámek domu', vidim(document.getElementById('nukiLockBtn')), true);

  R.push('\\n2) Mikyho režim');
  pouzijRezim('miky');
  check('zbydou čtyři záložky', zalozky().join(' · '),
    'Asistent · Žaluzie · Ovládání · Bazén · Logika automatiky');
  // Asistent umí zapnout bojler i odemknout dům — do dětské ruky nepatří
  check('pole pro asistenta zmizí', vidim(document.getElementById('asstInput')), false);
  check('  i scénáře', vidim(document.getElementById('asstScenes')), false);
  check('  i jezdec automatiky', vidim(document.getElementById('autoModeSlider')), false);
  check('bazén už nejde spínat', vidim(document.getElementById('poolOnBtn')), false);
  check('  ale světlo ano', vidim(document.getElementById('lightBazenOnBtn2')), true);
  // Ovládání se dětem vrátilo, ale jen se světly zahrady — ne s čerpadlem,
  // zámkem domu ani časovačem relé
  check('světla zahrady jsou zpátky', vidim(document.getElementById('lightDoleOnBtn')), true);
  check('  obě', vidim(document.getElementById('lightNahoreOnBtn')), true);
  check('  ale noční světla ne', vidim(document.getElementById('lightNocniOnBtn')), false);
  check('  ani oběhové čerpadlo', vidim(document.getElementById('obehOnBtn')), false);
  check('  ani zámek domu', vidim(document.getElementById('nukiLockBtn')), false);
  check('  a teplota vody taky', !!document.getElementById('hpTemp'), true);
  // I rozbalený zůstane v dětském režimu schovaný — tam ho neschovává sbalení,
  // ale režim
  check('rozvrh nejde nastavovat', vidim(document.getElementById('rozvrhCard')), false);
  check('  ani tlačítko k němu',
    vidim(document.querySelector('.sbal-btn[data-sbal="rozvrh"]')), false);
  check('  jen se ukáže', vidim(document.getElementById('rozvrhPrehled')), true);

  check('tlačítka jsou tři', detiBtns().join(' | '),
    'Zatáhnout žaluzie | Otevřít žaluzie | Otevřít žaluzie dveří');
  const boxy = () => [...document.querySelectorAll('#blindsList1 .blind-room-title')].map(t => t.textContent);
  // Vedle vlastního pokoje zbydou světla z TaHomy (terasa, pergola) — jsou to
  // světla, ne žaluzie, a dětem je nemá smysl brát
  check('na stránce žaluzií je jeho pokoj a světla', boxy().join(' | '), 'Terasa | Miky');
  const terasa = [...document.querySelectorAll('#blindsList1 .blind-room')]
    .find(b => b.textContent.includes('Terasa'));
  check('  a z terasy jen to světlo', /Světla terasa/.test(terasa.textContent), true);
  check('  ne žaluzie pergoly', /Pergola/.test(terasa.textContent), false);

  // Časovač nabízel žaluzie z DRUHÉ stránky: Miky i Elenka patří na stránku dvě,
  // ta je schovaná, a jejich pokoj se kreslí na první
  const casovac = [...document.querySelectorAll('#blindsList1')].length
    ? [...document.querySelectorAll('.blind-timer-card')].find(c => c.getClientRects().length) : null;
  const nabidka = () => [...casovac.querySelectorAll('.bt-device option')].map(o => o.textContent);
  check('v časovači jsou jen jeho dvě žaluzie', nabidka().join(' | '), 'Miky Okno | Miky dveře');
  check('teplotní automatika je jen pro Mikyho',
    [...document.querySelectorAll('#tempAutoList .tempauto-name')].map(e => e.textContent).join(' | '), 'Miky');
  check('  a obývák tam není', vidim(document.getElementById('tempAutoListOwn')), true);
  check('společná mez se nedá přenastavit',
    vidim(document.getElementById('tempAutoOnSlider')), false);
  // Nestačí, že cizí krok není vidět — pravidlo, co se pokoje netýká, tam nemá
  // být vůbec. Prázdný řádek vypadá jako chyba.
  check('v rozvrhu je jediný řádek',
    document.getElementById('rozvrhPrehled').querySelectorAll('div').length, 1);
  check('  a není v něm garáž',
    document.getElementById('rozvrhPrehled').textContent.includes('Garáž'), false);
  check('  a to jeho ano',
    document.getElementById('rozvrhPrehled').textContent.includes('Miky'), true);

  R.push('\\n3) Tlačítka míří do správného pokoje');
  POSLANO.length = 0;
  document.querySelectorAll('#detiTlacitka .deti-btn')[0].click();
  await pockej();
  check('zatáhnout pošle dvě žaluzie', POSLANO.length, 2);
  check('  obě Mikyho', POSLANO.every(p => p.telo.deviceURL.includes('Miky')), true);
  check('  a jede se dolů', POSLANO[0].telo.action, 'down');

  POSLANO.length = 0;
  document.querySelectorAll('#detiTlacitka .deti-btn')[1].click();
  await pockej();
  check('otevřít naklopí na 25 %', POSLANO[0].telo.tilt, 25);
  check('  a je to naklopení, ne poloha', POSLANO[0].telo.action, 'tilt');

  POSLANO.length = 0;
  document.querySelectorAll('#detiTlacitka .deti-btn')[2].click();
  await pockej();
  check('dveře jdou jen na jednu žaluzii', POSLANO.length, 1);
  check('  a na tu správnou', POSLANO[0].telo.deviceURL, 'io://Miky dveře');
  check('  nahoru', POSLANO[0].telo.action, 'up');

  R.push('\\n4) Elenka nevidí Mikyho a naopak');
  pouzijRezim('elenka');
  check('na stránce žaluzií je Elenčin pokoj a světla', boxy().join(' | '), 'Terasa | Elenka');
  check('  a v časovači jsou Elenčiny žaluzie',
    [...document.querySelectorAll('.blind-timer-card')].find(c => c.getClientRects().length)
      .querySelectorAll('.bt-device option').length, 2);
  POSLANO.length = 0;
  document.querySelectorAll('#detiTlacitka .deti-btn')[2].click();
  await pockej();
  check('dveře míří k Elence', POSLANO[0].telo.deviceURL, 'io://Elenka Dveře');
  check('  a nikam jinam', POSLANO.length, 1);
  check('teplotní automatika je Elenčina',
    [...document.querySelectorAll('#tempAutoList .tempauto-name')].map(e => e.textContent).join(' | '), 'Elenka');

  R.push('\\n5) Když v pokoji žádné dveře nejsou');
  // Radši tlačítko neukázat, než aby mlelo naprázdno
  blinds = [zaluzie('Miky Okno', 'Miky')];
  pouzijRezim('miky');
  check('zbydou jen dvě tlačítka', detiBtns().join(' | '), 'Zatáhnout žaluzie | Otevřít žaluzie');

  R.push('\\n6) Cesta zpátky');
  check('přepínač je vidět i v dětském režimu',
    document.querySelectorAll('#rezimBtns .rezim-btn').length, 3);
  check('  a ví se, který režim běží',
    document.querySelector('#rezimBtns .rezim-btn.aktivni').dataset.rezim, 'miky');
  // Přepnutí projde potvrzovacím oknem — jedno omylem ťuknutí appku nepřehodí
  document.querySelector('#rezimBtns .rezim-btn[data-rezim="full"]').click();
  check('klik se nejdřív zeptá', document.getElementById('potvrzOkno').hidden, false);
  check('  a režim se zatím nemění', rezimApky, 'miky');
  document.getElementById('potvrzZpet').click();
  check('zamítnutí režim nechá být', rezimApky, 'miky');
  document.querySelector('#rezimBtns .rezim-btn[data-rezim="full"]').click();
  document.getElementById('potvrzAno').click();
  check('potvrzení přepne na full', rezimApky, 'full');
  check('  a vrátí všechny záložky', zalozky().length, 14);
  check('  i pole pro asistenta', vidim(document.getElementById('asstInput')), true);

  R.push('\\n7) Režim přežije zavření appky');
  pouzijRezim('elenka');
  check('uloží se do telefonu', localStorage.getItem('rezimApky'), 'elenka');
  check('  a načte se zpátky', rezimNacti(), 'elenka');
  localStorage.setItem('rezimApky', 'nesmysl');
  check('nesmysl se nebere', rezimNacti(), 'full');
  pouzijRezim('full');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const ok = R.filter(r => r.startsWith('  OK')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + ok + ' ok, ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + ok + ' ok, 0 chyb (dětský režim)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'rezim.html');
fs.writeFileSync(out, v);
console.log(out);
