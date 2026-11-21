// Stránka Termíny: nejbližší termíny nahoře, karty s údaji a termíny,
// Hotovo u opakovaných, úprava a nová karta, smazání. Push posílá server
// (test/terminy.js) — tady se hlídá, co appka ukáže a co pošle.
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
let odpoved = null;
window.fetch = async (url, opts) => {
  const telo = opts && opts.body ? JSON.parse(opts.body) : null;
  poslano.push({ url: String(url), body: telo });
  if (odpoved) { const o = odpoved; odpoved = null; return { ok: o.ok !== false, status: o.status || 200, json: async () => o.telo }; }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};
setTimeout(async () => {
 try {
  const pockej = () => new Promise(r => setTimeout(r, 30));
  const den = n => termDnes(Date.now() + n * 86400000);
  // Termíny jsou na stránce Připomínky: nahoře nejbližší, celé pod „Všechny termíny“
  check('samostatná stránka Termíny není', !!document.getElementById('terminySlide'), false);
  const prip = document.getElementById('pripominkySlide');
  check('nejbližší termíny jsou nahoře na Připomínkách', prip.querySelector('.page > .card').id, 'termBlizkeKarta');
  check('  zbytek je pod tlačítkem Všechny termíny', document.getElementById('termKarty').closest('[data-sbal-obsah]').dataset.sbalObsah, 'terminy');
  check('  vše jen ve full (údaje do dětského mobilu nepatří)', document.getElementById('termBlizkeKarta').classList.contains('jen-full')
    && document.getElementById('terminyOblast').classList.contains('jen-full'), true);
  sbalNastav('terminy', false);

  terminyData = { predemDni: 14, karty: [
    { id: 'bmw4', nazev: 'BMW 4', ikona: '🚗', udaje: 'VIN: X\\nPojišťovna: Direct', terminy: [
      { id: 'stk', nazev: 'STK', datum: den(400), opakovani: 0, pozn: '' },
      { id: 'poj', nazev: 'Pojištění', datum: den(10), opakovani: 0, pozn: 'Direct' }] },
    { id: 'eso', nazev: 'Eso', ikona: '🐕', udaje: '', terminy: [
      { id: 'nob', nazev: 'Nobivac', datum: den(40), opakovani: 12, pozn: '' },
      { id: 'vz', nazev: 'Vzteklina', datum: null, opakovani: 0, pozn: '' },
      { id: 'prosle', nazev: 'Odčervení', datum: den(-3), opakovani: 0, pozn: '' }] }
  ] };
  renderTerminy();

  R.push('1) Nejbližší nahoře');
  const blizke = [...document.querySelectorAll('#termBlizke .term-radek')];
  check('do dvou měsíců a prošlé, nejbližší první', blizke.map(r => r.querySelector('.term-nazev').textContent).join(' | '),
    '🐕 Eso: Odčervení | 🚗 BMW 4: Pojištění | 🐕 Eso: Nobivac ↻');
  check('prošlé červeně', blizke[0].querySelector('.term-zbyva').className + ' ' + blizke[0].querySelector('.term-zbyva').textContent,
    'term-zbyva hori prošlo před 3 d');
  check('do 14 dní červeně', blizke[1].querySelector('.term-zbyva').className, 'term-zbyva hori');
  check('do 60 dní oranžově', blizke[2].querySelector('.term-zbyva').className + ' ' + blizke[2].querySelector('.term-zbyva').textContent,
    'term-zbyva brzy za 40 dní');
  check('poznámka a datum pod názvem', /Direct/.test(blizke[1].querySelector('.term-pod').textContent), true);

  R.push('\\n2) Karty');
  const karty = [...document.querySelectorAll('#termKarty > .card')];
  check('dvě karty', karty.map(k => k.querySelector('.graph-title').textContent).join(' | '), '🚗 BMW 4 | 🐕 Eso');
  check('údaje po řádcích', [...karty[0].querySelector('.term-udaje').children].map(e => e.firstChild.textContent).join(' | '), 'VIN: X | Pojišťovna: Direct');
  check('termíny podle data, bez data na konci', [...karty[1].querySelectorAll('.term-nazev')].map(e => e.textContent).join(','),
    'Odčervení,Nobivac ↻,Vzteklina');
  check('daleký termín v měsících', /za 13 měs\./.test(karty[0].textContent), true);
  check('bez data se řekne', /bez data/.test(karty[1].textContent), true);
  check('Hotovo u opakovaného, Nové datum u blízkých jednorázových', [...document.querySelectorAll('#termKarty .term-hotovo')].map(b => b.textContent).join(','), 'Nové datum,Nové datum,Hotovo');

  R.push('\\n3) Hotovo posune opakovaný');
  odpoved = { telo: { ok: true, terminy: { predemDni: 14, karty: terminyData.karty.map(k => k.id === 'eso'
    ? { ...k, terminy: k.terminy.map(x => x.id === 'nob' ? { ...x, datum: den(405) } : x) } : k) } } };
  poslano.length = 0;
  [...document.querySelectorAll('#termKarty .term-hotovo')].find(b => b.textContent === 'Hotovo').click();
  await pockej();
  check('pošle hotovo', poslano[0].url, '/api/terminy/nob/hotovo');
  check('  a překreslí s novým datem', document.querySelectorAll('#termBlizke .term-radek').length, 2);

  R.push('\\n4) Úprava karty');
  document.querySelector('#termKarty .term-upravit').click();
  const form = document.querySelector('#termKarty [data-karta="bmw4"] .term-form');
  check('otevře formulář', !!form, true);
  check('  tlačítko Nová karta se schová', document.getElementById('termNovaBtn').hidden, true);
  const nazev = form.querySelector('.term-f-nazev');
  nazev.value = 'BMW 4 Gran Coupé';
  nazev.dispatchEvent(new Event('input'));
  const udaje = form.querySelector('.term-f-udaje');
  udaje.value = 'VIN: X\\nSPZ: Y';
  udaje.dispatchEvent(new Event('input'));
  form.querySelector('.term-f-pridat').click();
  const f2 = document.querySelector('#termKarty [data-karta="bmw4"] .term-form');
  check('přidaný termín má řádek a název zůstal', f2.querySelectorAll('.term-f-termin').length + ' ' + f2.querySelector('.term-f-nazev').value,
    '3 BMW 4 Gran Coupé');
  const posl = [...f2.querySelectorAll('.term-f-termin')].pop();
  const tn = posl.querySelector('.term-f-tnazev'); tn.value = 'Dálniční známka'; tn.dispatchEvent(new Event('input'));
  const td = posl.querySelector('.term-f-datum'); td.value = '2027-05-05'; td.dispatchEvent(new Event('change'));
  const to = posl.querySelector('.term-f-opak'); to.value = '12'; to.dispatchEvent(new Event('change'));
  check('opakování nabízí „každý rok“', [...to.options].some(o => o.textContent === 'každý rok'), true);
  odpoved = { telo: { ok: true, terminy: terminyData } };
  poslano.length = 0;
  f2.querySelector('.ulozit').click();
  await pockej();
  check('uložení pošle všechny karty', poslano[0].url + ' ' + poslano[0].body.karty.length, '/api/terminy 2');
  const k0 = poslano[0].body.karty[0];
  check('  s novým názvem a údaji', k0.nazev + ' | ' + k0.udaje, 'BMW 4 Gran Coupé | VIN: X\\nSPZ: Y');
  check('  i s novým termínem', JSON.stringify(k0.terminy[2]), '{"nazev":"Dálniční známka","datum":"2027-05-05","opakovani":12,"pozn":""}');
  check('formulář se zavře', !!document.querySelector('#termKarty .term-form'), false);

  R.push('\\n5) Chyba ze serveru');
  document.querySelector('#termKarty .term-upravit').click();
  odpoved = { ok: false, status: 400, telo: { error: 'Špatné datum u „STK“.' } };
  document.querySelector('#termKarty .ulozit').click();
  await pockej();
  check('chyba se ukáže', document.getElementById('termHint').textContent, 'Špatné datum u „STK“.');
  check('  a formulář zůstane otevřený', !!document.querySelector('#termKarty .term-form'), true);
  document.querySelector('#termKarty .zrusit').click();
  check('Zrušit ho zavře', !!document.querySelector('#termKarty .term-form'), false);

  R.push('\\n6) Nová karta a smazání');
  document.getElementById('termNovaBtn').click();
  const fn = document.querySelector('#termKarty [data-karta="nova"] .term-form');
  check('nová karta má formulář na konci', !!fn && document.querySelector('#termKarty').lastElementChild.dataset.karta, 'nova');
  check('  bez tlačítka Smazat', !!fn.querySelector('.smazat'), false);
  const nn = fn.querySelector('.term-f-nazev'); nn.value = 'Naše očkování'; nn.dispatchEvent(new Event('input'));
  const t1 = fn.querySelector('.term-f-tnazev'); t1.value = 'Tetanus'; t1.dispatchEvent(new Event('input'));
  const d1 = fn.querySelector('.term-f-datum'); d1.value = '2037-02-01'; d1.dispatchEvent(new Event('change'));
  fn.querySelector('.term-f-pridat').click();   // prázdný řádek navíc se nepošle
  odpoved = { telo: { ok: true, terminy: terminyData } };
  poslano.length = 0;
  document.querySelector('#termKarty [data-karta="nova"] .ulozit').click();
  await pockej();
  const nova = poslano[0].body.karty[2];
  check('nová karta se přidá na konec', nova.nazev + ' ' + nova.terminy.length + ' ' + nova.terminy[0].datum, 'Naše očkování 1 2037-02-01');
  check('  bez vymyšleného id', 'id' in nova, false);
  window.confirm = () => true;
  document.querySelector('#termKarty [data-karta="eso"] .term-upravit').click();
  poslano.length = 0;
  odpoved = { telo: { ok: true, terminy: terminyData } };
  document.querySelector('#termKarty [data-karta="eso"] .smazat').click();
  await pockej();
  check('smazání pošle karty bez ní', poslano[0].body.karty.map(k => k.id).join(','), 'bmw4');

  R.push('\\n6b) Vložit údaje');
  const zaklad = [
    { id: 'bmw4', nazev: 'BMW 4 Gran Coupé', ikona: '🚗', udaje: 'Pojišťovna: Direct\\nVIN: staré', terminy: [] },
    { id: 'vw', nazev: 'VW Multivan', ikona: '🚐', udaje: '', terminy: [{ id: 't1', nazev: 'STK', datum: '2028-01-29', opakovani: 0, pozn: '' }] }];
  const r1 = termSlucUdaje(zaklad, '[bmw 4]\\nVIN: WBA1\\nSPZ: 1AB 2345\\n\\n[VW Multivan]\\nOMV karta: 1234\\n[Chata]\\nRevize kotle: 2027');
  check('karta podle začátku názvu, bez ohledu na velikost', r1.karty[0].udaje, 'Pojišťovna: Direct\\nVIN: WBA1\\nSPZ: 1AB 2345');
  check('  stejný klíč přepíše, nový přibude', r1.karty[1].udaje, 'OMV karta: 1234');
  check('  termíny zůstanou', r1.karty[1].terminy.length, 1);
  check('neznámá karta se založí', r1.nove.join() + ' | ' + r1.karty[2].udaje, 'Chata | Revize kotle: 2027');
  check('původní data se nemění', zaklad[0].udaje, 'Pojišťovna: Direct\\nVIN: staré');
  check('podruhé už nic', termSlucUdaje(r1.karty, '[BMW 4 Gran Coupé]\\nVIN: WBA1').zmeny.length, 0);
  terminyData = { predemDni: 14, karty: zaklad };
  renderTerminy();
  sbalNastav('termvloz', true);
  const pole = document.getElementById('termVlozText');
  pole.value = 'VIN: bez hlavičky';
  document.getElementById('termVlozBtn').click();
  await pockej();
  check('bez [Název] poradí', document.getElementById('termVlozHint').textContent, 'Chybí [Název karty] na prvním řádku.');
  pole.value = '[VW Multivan]\\nVIN: WV2\\nOMV karta: 1234';
  odpoved = { telo: { ok: true, terminy: { predemDni: 14, karty: zaklad } } };
  poslano.length = 0;
  document.getElementById('termVlozBtn').click();
  await pockej();
  check('pošle karty s doplněnými údaji', poslano[0].url + ' ' + poslano[0].body.karty[1].udaje, '/api/terminy VIN: WV2\\nOMV karta: 1234');
  check('  řekne, co doplnil, a pole vyprázdní', document.getElementById('termVlozHint').textContent + '|' + pole.value, 'Doplněno: VW Multivan.|');

  R.push('\\n6c) Pododdíly (osoby)');
  terminyData = { predemDni: 14, karty: [{ id: 'ockovani', nazev: 'Očkování', ikona: '💉', udaje: '',
    skupiny: ['Lukáš', 'Zuzka', 'Miky', 'Elenka'],
    terminy: [{ id: 'tet', nazev: 'Tetanus', datum: den(20), opakovani: 0, pozn: '', skupina: 'Lukáš' }] }] };
  renderTerminy();
  const ok = document.querySelector('#termKarty [data-karta="ockovani"]');
  check('nadpisy pododdílů', [...ok.querySelectorAll('.term-skupina')].map(e => e.textContent).join(','), 'Lukáš,Zuzka,Miky,Elenka');
  check('tetanus pod Lukášem', ok.querySelector('.term-skupina').nextElementSibling.querySelector('.term-nazev').textContent, 'Tetanus');
  check('prázdný pododdíl řekne zatím nic', ok.querySelectorAll('.term-prazdno').length, 3);
  check('nahoře je vidět komu', document.querySelector('#termBlizke .term-nazev').textContent, '💉 Očkování – Lukáš: Tetanus');
  ok.querySelector('.term-upravit').click();
  const fo = document.querySelector('#termKarty [data-karta="ockovani"] .term-form');
  check('formulář má pododdíly', fo.querySelector('.term-f-skupiny').value, 'Lukáš, Zuzka, Miky, Elenka');
  fo.querySelector('.term-f-pridat').click();
  const fo2 = document.querySelector('#termKarty [data-karta="ockovani"] .term-form');
  const novy = [...fo2.querySelectorAll('.term-f-termin')].pop();
  const nn2 = novy.querySelector('.term-f-tnazev'); nn2.value = 'Tetanus'; nn2.dispatchEvent(new Event('input'));
  const sel = novy.querySelector('.term-f-skupina');
  check('termín jde přiřadit osobě', [...sel.options].map(o => o.value).join(','), ',Lukáš,Zuzka,Miky,Elenka');
  sel.value = 'Elenka'; sel.dispatchEvent(new Event('change'));
  odpoved = { telo: { ok: true, terminy: terminyData } };
  poslano.length = 0;
  fo2.querySelector('.ulozit').click();
  await pockej();
  const ul = poslano[0].body.karty[0];
  check('uloží pododdíly i přiřazení', ul.skupiny.join(',') + ' | ' + ul.terminy[1].skupina, 'Lukáš,Zuzka,Miky,Elenka | Elenka');

  R.push('\\n6d) VIN ke zkopírování');
  terminyData = { predemDni: 14, karty: [{ id: 'bmw4', nazev: 'BMW 4', ikona: '🚗', udaje: 'VIN: WBA123\\nSPZ: 1AB', terminy: [] }] };
  renderTerminy();
  const kop = [...document.querySelectorAll('#termKarty .term-kopir')];
  check('u VIN je tlačítko Kopírovat (u SPZ ne)', kop.length, 1);
  let schranka = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { schranka = t; }, readText: async () => '' } });
  kop[0].click();
  await pockej();
  check('  zkopíruje jen hodnotu', schranka, 'WBA123');
  check('  a řekne to', kop[0].textContent, 'Zkopírováno ✓');

  R.push('\\n6e) Olej: Hotovo se zeptá na kilometry');
  const olej = { id: 'gs-olej', nazev: 'Olej', datum: den(5), opakovani: 12, pozn: '', posledni: 'Poslední olej', km: true };
  const stk = { id: 'gs-stk', nazev: 'STK', datum: den(3), opakovani: 0, pozn: '' };
  terminyData = { predemDni: 14, karty: [{ id: 'gs', nazev: 'BMW R 1300 GS', ikona: '🏍️', udaje: '', terminy: [olej, stk, { ...olej, id: 'x-olej', datum: den(300) }] }] };
  renderTerminy();
  const hot = [...document.querySelectorAll('#termKarty .term-hotovo')];
  check('olej má Hotovo i daleko, STK Nové datum', hot.map(b => b.textContent).join(','), 'Nové datum,Hotovo,Hotovo');
  poslano.length = 0;
  hot[1].click();
  await pockej();
  const okno = document.getElementById('termOkno');
  const oDatum = document.getElementById('termOknoDatum'), oKm = document.getElementById('termOknoKm');
  check('okno: dnešní datum a kilometry', [!okno.hidden, oDatum.value === termDnes(), oDatum.max === termDnes(), !oKm.hidden].join(' '), 'true true true true');
  oKm.value = '12345';
  odpoved = { telo: { ok: true, terminy: terminyData } };
  document.getElementById('termOknoAno').click();
  await pockej();
  check('  pošle hotovo s dneškem a km', poslano[0].url + ' ' + JSON.stringify(poslano[0].body), '/api/terminy/gs-olej/hotovo ' + JSON.stringify({ kdy: termDnes(), km: '12345' }));
  // Zapomenuté starší datum jde přepsat; budoucí ne
  poslano.length = 0;
  hot[1].click();
  await pockej();
  oDatum.value = den(-40);
  odpoved = { telo: { ok: true, terminy: terminyData } };
  document.getElementById('termOknoAno').click();
  await pockej();
  check('  starší datum projde, bez km se km neposílá', JSON.stringify(poslano[0].body), JSON.stringify({ kdy: den(-40) }));
  poslano.length = 0;
  hot[1].click();
  await pockej();
  oDatum.value = den(3);
  document.getElementById('termOknoAno').click();
  await pockej();
  check('  budoucí datum neodešle a řekne proč', poslano.length + ' ' + document.getElementById('termOknoText').textContent, '0 Datum nemůže být v budoucnu.');
  document.getElementById('termOknoZpet').click();
  await pockej();
  poslano.length = 0;
  hot[1].click();
  await pockej();
  document.getElementById('termOknoZpet').click();
  await pockej();
  check('  Zpět nic nepošle', poslano.length + ' ' + okno.hidden, '0 true');
  hot[0].click();
  await pockej();
  check('jednorázový se zeptá na nové datum (o rok dál), bez km', oDatum.value + ' ' + oKm.hidden, termPosunJs(den(3), 12) + ' true');
  odpoved = { telo: { ok: true, terminy: terminyData } };
  document.getElementById('termOknoAno').click();
  await pockej();
  check('  a pošle ho', JSON.stringify(poslano[0].body), JSON.stringify({ datum: termPosunJs(den(3), 12) }));

  R.push('\\n6f) Termín do 14 dní svítí mezi připomínkami');
  const defs = pripDefinice().filter(d => d.termin);
  check('olej a STK do 14 dní jsou připomínky (daleký olej ne)', defs.map(d => d.nazev).join(' | '), 'Objednat olej – BMW R 1300 GS | BMW R 1300 GS: STK');
  check('  svítí s textem', pripominkaStav(defs[0], null).sviti + ' ' + pripominkaStav(defs[0], null).text, 'true Za 5 dní (' + termDatumCz(den(5)) + ')');
  renderPripominky();
  check('  jsou v seznamu Připomínek', [...document.querySelectorAll('#pripSeznam .prip-radek')].filter(r => /^term_/.test(r.dataset.id)).length, 2);
  check('  i v emoji u zvonečku', !!document.querySelector('#pripEmoji [data-id="term_gs-olej"]'), true);
  poslano.length = 0;
  pripOdtukni(defs[0]);
  await pockej();
  check('Hotovo z připomínky = totéž okno s km', !okno.hidden && document.getElementById('termOknoNadpis').textContent, 'Olej hotovo');
  document.getElementById('termOknoZpet').click();
  await pockej();
  pouzijRezim('miky');
  check('dětský režim termíny mezi připomínky nedává', pripDefinice().some(d => d.termin), false);
  pouzijRezim('full');

  R.push('\\n6g) Vložení celých karet i s termíny');
  const vstup = '[BMW 4 Gran Coupé] 🚗\\nSPZ: 5SP 1\\nVIN: WBA1\\nPojišťovna: Direct\\nOstatní: geometrie hotová, koupit pneu\\n'
    + '+ STK: 3. 8. 2028 | každé 2 roky\\n+ Dálniční známka: 5. 5. 2027\\n+ Pojištění: bez data | Direct\\n'
    + '+ Olej: 3. 8. 2027 | každý rok | naposledy 3. 8. 2026, 97 000 km\\n\\n[Nová chata]\\n+ Revize kotle: 1. 3. 2027 | každých 6 měsíců';
  const im = termSlucUdaje([], vstup);
  const bmw = im.karty[0];
  check('karty založené i s ikonou', im.karty.map(k => k.ikona + ' ' + k.nazev).join(' | '), '🚗 BMW 4 Gran Coupé | 📌 Nová chata');
  check('  údaje v pořadí', bmw.udaje, 'SPZ: 5SP 1\\nVIN: WBA1\\nPojišťovna: Direct\\nOstatní: geometrie hotová, koupit pneu');
  check('  termíny', bmw.terminy.map(x => x.nazev + ':' + x.datum + ':' + x.opakovani).join(' | '),
    'STK:2028-08-03:24 | Dálniční známka:2027-05-05:0 | Pojištění:null:0 | Olej:2027-08-03:12');
  check('  olej: naposledy, km, zápis', [bmw.terminy[3].naposledy, bmw.terminy[3].km, bmw.terminy[3].posledni].join(' | '), '3. 8. 2026, 97 000 km | true | Poslední olej');
  check('  STK si pamatuje naposledy', bmw.terminy[0].posledni, 'Poslední STK');
  check('  poznámka u pojištění', bmw.terminy[2].pozn, 'Direct');
  check('  půlroční interval', im.karty[1].terminy[0].opakovani, 6);
  const znovu = termSlucUdaje(im.karty, '[BMW 4]\\n+ STK: 1. 1. 2029');
  check('znovu vložený termín přepíše datum, nezdvojí se', znovu.karty[0].terminy.filter(x => x.nazev === 'STK').map(x => x.datum + '/' + x.opakovani).join(), '2029-01-01/24');

  R.push('\\n6h) Hlavička: SPZ, VIN nahoře a tučně; naposledy u termínu');
  terminyData = { predemDni: 14, karty: [{ id: 'k', nazev: 'BMW', ikona: '🚗', udaje: 'Pojišťovna: Direct\\nVIN: WBA1\\nSPZ: 5SP 1', terminy: [
    { id: 'o', nazev: 'Olej', datum: den(200), opakovani: 12, pozn: '', posledni: 'Poslední olej', km: true, naposledy: '3. 8. 2026, 97 000 km' }] }] };
  renderTerminy();
  const ud = [...document.querySelectorAll('#termKarty .term-udaje > *')];
  check('pořadí SPZ, VIN, zbytek', ud.map(e => e.textContent.replace('Kopírovat', '')).join(' | '), 'SPZ: 5SP 1 | VIN: WBA1 | Pojišťovna: Direct');
  check('  SPZ a VIN tučně, zbytek ne', ud.map(e => !!(e.tagName === 'B' || e.querySelector('b'))).join(','), 'true,true,false');
  check('naposledy u oleje', /naposledy 3\. 8\. 2026, 97 000 km/.test(document.querySelector('#termKarty .term-pod').textContent), true);

  R.push('\\n7) Rozložení');
  terminyData = { predemDni: 14, karty: [] };
  renderTerminy();
  check('prázdno se řekne', /nic nekončí/.test(document.getElementById('termBlizke').textContent), true);
  check('stránka nejede do strany', document.documentElement.scrollWidth <= window.innerWidth, true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (termíny)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'terminy.html');
fs.writeFileSync(out, v);
console.log(out);
