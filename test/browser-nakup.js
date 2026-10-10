// Vlastní připomínky a nákupní seznam se zelenou záložkou.
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
let dotazy = [];
let odpoved = () => ({ ok: true });
window.fetch = async (url, init) => {
  const telo = init && init.body ? JSON.parse(init.body) : null;
  dotazy.push({ url, telo });
  const d = odpoved(url, telo);
  return { ok: !d.error, status: d.error ? 400 : 200, json: async () => d };
};
const vidi = el => !!el && el.getClientRects().length > 0;
const pockej = ms => new Promise(r => setTimeout(r, ms));
setTimeout(async () => {
 try {
  const DEN = 86400000;
  const T = Date.now();
  const iso = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const zaklad = pripominkyZaklad();
  function pripominkyZaklad() { return JSON.parse(JSON.stringify(pripData || {})); }

  R.push('1) Vlastní připomínky');
  pripData = { ...zaklad,
    v_aaaa1111: { vlastni: { nazev: 'Vyměnit filtr', ikona: '🔧', typ: 'opak' }, dni: 30, zapnuto: true, hotovo: T - 31 * DEN, predtim: 0, aktivovano: 0, vytvoreno: 1 },
    v_bbbb2222: { vlastni: { nazev: 'Zubař', ikona: '🦷', typ: 'jednou', datum: iso(T + 3 * DEN) }, zapnuto: true, hotovo: 0, predtim: 0, aktivovano: 0, vytvoreno: 2 },
    v_cccc3333: { vlastni: { nazev: 'Pojistka', ikona: '🧾', typ: 'jednou', datum: iso(T) }, zapnuto: true, hotovo: 0, predtim: 0, aktivovano: 0, vytvoreno: 3 }
  };
  renderPripominky();
  const radek = id => document.querySelector('#pripSeznam .prip-radek[data-id="' + id + '"]');
  check('opakovaná je v seznamu', !!radek('v_aaaa1111'), true);
  check('  po 31 dnech s intervalem 30 svítí', radek('v_aaaa1111').classList.contains('sviti'), true);
  check('  volič nabízí i 30 dní', radek('v_aaaa1111').querySelector('.prip-interval').value, '30');
  check('  má Smazat', !!radek('v_aaaa1111').querySelector('.prip-smazat'), true);
  check('pevná Smazat nemá', !!radek('kytky').querySelector('.prip-smazat'), false);
  check('jednorázová za 3 dny nesvítí', radek('v_bbbb2222').classList.contains('sviti'), false);
  check('  a říká kdy', /^Dne /.test(radek('v_bbbb2222').querySelector('.prip-text').textContent), true);
  check('  nemá volič intervalu', !!radek('v_bbbb2222').querySelector('.prip-interval'), false);
  check('jednorázová na dnešek svítí', radek('v_cccc3333').classList.contains('sviti'), true);
  check('  s textem Dnes', radek('v_cccc3333').querySelector('.prip-text').textContent, 'Dnes');
  check('svítící vlastní jsou ve zvonečku', pripSviticich(T) >= 2, true);
  pripData.v_cccc3333.hotovo = T;
  renderPripominky();
  check('odťuknutá jednorázová zmizí', !!radek('v_cccc3333'), false);

  // Formulář
  document.getElementById('pripPridatBtn').click();
  const okno = document.getElementById('vlastniOkno');
  check('+ Vlastní připomínka otevře okno', okno.hidden, false);
  odpoved = (url, telo) => url === '/api/pripominky/vlastni'
    ? { ok: true, pripominky: { ...pripData, v_dddd4444: { vlastni: { nazev: telo.nazev, ikona: telo.ikona, typ: telo.typ }, dni: telo.dni, zapnuto: true, hotovo: 0, vytvoreno: 9 } } }
    : { ok: true };
  document.getElementById('vlastniUlozit').click();
  await pockej(20);
  check('bez názvu se neuloží', /Napiš/.test(document.getElementById('vlastniChyba').textContent), true);
  document.getElementById('vlastniNazev').value = 'Zalít bonsaj';
  document.querySelectorAll('#vlastniIkony button')[11].click();
  document.getElementById('vlastniDni').value = '3';
  dotazy = [];
  document.getElementById('vlastniUlozit').click();
  await pockej(30);
  const dotaz = dotazy.find(d => d.url === '/api/pripominky/vlastni');
  check('uložení pošle zadání', dotaz && JSON.stringify(dotaz.telo), JSON.stringify({ nazev: 'Zalít bonsaj', ikona: '🧺', typ: 'opak', dni: 3 }));
  check('  okno se zavře', okno.hidden, true);
  check('  a připomínka je v seznamu', !!radek('v_dddd4444'), true);

  document.getElementById('pripPridatBtn').click();
  document.querySelector('#vlastniTyp button[data-typ="jednou"]').click();
  check('Jednou ukáže datum', vidi(document.getElementById('vlastniDatum')), true);
  check('  a schová interval', vidi(document.getElementById('vlastniDni')), false);
  document.getElementById('vlastniNazev').value = 'STK';
  document.getElementById('vlastniDatum').value = '2026-12-01';
  dotazy = [];
  document.getElementById('vlastniUlozit').click();
  await pockej(30);
  const d2 = dotazy.find(d => d.url === '/api/pripominky/vlastni');
  check('jednorázová pošle datum', d2 && d2.telo.typ + ' ' + d2.telo.datum + ' ' + ('dni' in d2.telo), 'jednou 2026-12-01 false');

  R.push('\\n2) Nákupní seznam');
  odpoved = () => ({ ok: true });
  nakupData = [];
  renderNakup();
  const zvonekPred = pripSviticich(T);
  const zal = document.getElementById('nakupZalozka');
  check('prázdný seznam = žádná záložka', vidi(zal), false);
  nakupData = [{ id: 'n_aaaa1111', text: 'mléko', t: 1 }, { id: 'n_bbbb2222', text: 'chleba', t: 2 }];
  renderNakup();
  check('neprázdný = zelená záložka', vidi(zal), true);
  check('  s počtem', zal.textContent, '🛒 2');
  const barva = getComputedStyle(zal).backgroundColor;
  check('  zelená, ne oranžová', barva, 'rgb(46, 157, 87)');
  check('  i na jiné stránce (je mimo stránky)', !zal.closest('.slide'), true);
  check('proklik na Připomínkách ukazuje počet', document.getElementById('nakupProklikPocet').textContent, ' · 2');
  check('zvoneček nákup nepočítá', pripSviticich(T), zvonekPred);

  pripPlovouciAkce(zal);
  const nokno = document.getElementById('nakupOkno');
  check('klepnutí otevře seznam', nokno.hidden, false);
  check('  položky s odrážkami', [...document.querySelectorAll('#nakupSeznam li .nakup-text')].map(x => x.textContent).join(','), 'mléko,chleba');

  dotazy = [];
  odpoved = (url, telo) => url === '/api/nakup' ? { ok: true, nakup: [...nakupData, { id: 'n_cccc3333', text: telo.text, t: 3 }] } : { ok: true };
  document.getElementById('nakupVstup').value = 'máslo';
  document.getElementById('nakupForm').dispatchEvent(new Event('submit', { cancelable: true }));
  await pockej(30);
  check('přidání pošle text', dotazy[0] && dotazy[0].url + ' ' + dotazy[0].telo.text, '/api/nakup máslo');
  check('  pole se vyprázdní', document.getElementById('nakupVstup').value, '');
  check('  a položka přibude', zal.textContent, '🛒 3');

  dotazy = [];
  odpoved = url => /smazat/.test(url) ? { ok: true, nakup: nakupData } : { ok: true };
  document.querySelector('#nakupSeznam li[data-id="n_aaaa1111"] .nakup-odskrt').click();
  await pockej(20);
  check('odškrtnutí smaže na serveru', dotazy[0] && dotazy[0].url, '/api/nakup/n_aaaa1111/smazat');
  const pr = document.querySelector('#nakupSeznam li[data-id="n_aaaa1111"]');
  check('  místo ní přeškrtnutá se Zpět', !!pr && pr.classList.contains('koupeno') && !!pr.querySelector('.nakup-zpet'), true);
  check('  počet klesne', zal.textContent, '🛒 2');
  dotazy = [];
  odpoved = (url, telo) => ({ ok: true, nakup: [{ id: telo.id, text: telo.text, t: telo.t }, ...nakupData].sort((a, b) => a.t - b.t) });
  pr.querySelector('.nakup-zpet').click();
  await pockej(20);
  check('Zpět pošle stejné id a čas', dotazy[0] && JSON.stringify(dotazy[0].telo), JSON.stringify({ text: 'mléko', id: 'n_aaaa1111', t: 1 }));
  check('  a je zpátky první', document.querySelector('#nakupSeznam li .nakup-text').textContent, 'mléko');
  document.getElementById('nakupZavrit').click();
  check('Zavřít', nokno.hidden, true);
  nakupData = [];
  renderNakup();
  check('vyprázdněný seznam záložku schová', vidi(zal), false);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (nákup)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'nakup.html');
fs.writeFileSync(out, v);
console.log(out);
