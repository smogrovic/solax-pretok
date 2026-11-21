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
  const slide = document.getElementById('terminySlide');
  check('stránka Termíny existuje a je za Recepty', slide.previousElementSibling.id, 'nakupSlide');
  check('  jen ve full režimu', slide.dataset.rezim, 'full');

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
  check('údaje po řádcích', karty[0].querySelector('.term-udaje').textContent, 'VIN: X\\nPojišťovna: Direct');
  check('termíny podle data, bez data na konci', [...karty[1].querySelectorAll('.term-nazev')].map(e => e.textContent).join(','),
    'Odčervení,Nobivac ↻,Vzteklina');
  check('daleký termín v měsících', /za 13 měs\./.test(karty[0].textContent), true);
  check('bez data se řekne', /bez data/.test(karty[1].textContent), true);
  check('Hotovo jen u opakovaného', document.querySelectorAll('#termKarty .term-hotovo').length, 1);

  R.push('\\n3) Hotovo posune opakovaný');
  odpoved = { telo: { ok: true, terminy: { predemDni: 14, karty: terminyData.karty.map(k => k.id === 'eso'
    ? { ...k, terminy: k.terminy.map(x => x.id === 'nob' ? { ...x, datum: den(405) } : x) } : k) } } };
  poslano.length = 0;
  document.querySelector('#termKarty .term-hotovo').click();
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
