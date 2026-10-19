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

  // Nákup je samostatná stránka — záložka na ni přejede
  const strana = document.querySelector('.slide[data-title="Nákup"]');
  check('nákup je samostatná stránka', !!strana && strana.contains(document.getElementById('nakupSeznam')), true);
  check('  okno nákupu už není', !!document.getElementById('nakupOkno'), false);
  const vsechny = [...sliderWrap.querySelectorAll('.slide:not([hidden])')];
  check('  hned za Připomínkami', vsechny[vsechny.indexOf(document.getElementById('pripominkySlide')) + 1] === strana, true);
  let kam = null;
  const puvScroll = sliderWrap.scrollTo;
  sliderWrap.scrollTo = o => { kam = o.left; };
  pripPlovouciAkce(zal);
  check('klepnutí na záložku přejede na stránku Nákup', kam, stranaNaStred(vsechny.indexOf(strana)));
  kam = null;
  document.getElementById('nakupProklik').click();
  check('  i proklik z Připomínek', kam, stranaNaStred(vsechny.indexOf(strana)));
  sliderWrap.scrollTo = puvScroll;
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
  odpoved = () => ({ ok: true, nakup: nakupData });
  document.querySelector('#nakupSeznam li[data-id="n_aaaa1111"] .nakup-odskrt').click();
  await pockej(20);
  check('odškrtnutí pošle koupeno', dotazy[0] && dotazy[0].url + ' ' + JSON.stringify(dotazy[0].telo), '/api/nakup/n_aaaa1111/koupeno {"koupeno":true}');
  const poradi = () => [...document.querySelectorAll('#nakupSeznam li')].map(li => li.querySelector('.nakup-text').textContent + (li.classList.contains('koupeno') ? '✓' : '')).join(',');
  check('  zůstane přeškrtnutá na konci', poradi(), 'chleba,máslo,mléko✓');
  const pr = document.querySelector('#nakupSeznam li[data-id="n_aaaa1111"]');
  check('  opravdu přeškrtnutá', getComputedStyle(pr.querySelector('.nakup-text')).textDecorationLine, 'line-through');
  check('  počet na záložce klesne', zal.textContent, '🛒 2');
  check('  i u prokliku', document.getElementById('nakupProklikPocet').textContent, ' · 2');
  // Další koupená jde nad předchozí koupenou (naposledy koupené nahoře)
  await pockej(5);
  document.querySelector('#nakupSeznam li[data-id="n_bbbb2222"] .nakup-odskrt').click();
  await pockej(20);
  check('naposledy koupené nahoře mezi koupenými', poradi(), 'máslo,chleba✓,mléko✓');
  // Klepnutí na koupenou ji vrátí (i jako oprava omylu)
  dotazy = [];
  document.querySelector('#nakupSeznam li[data-id="n_aaaa1111"] .nakup-odskrt').click();
  await pockej(20);
  check('klepnutí na koupenou ji vrátí', dotazy[0] && JSON.stringify(dotazy[0].telo), '{"koupeno":false}');
  check('  na své místo nahoru', poradi(), 'mléko,máslo,chleba✓');
  // Jen koupené: záložka nesvítí, seznam je ukazuje
  nakupData = [{ id: 'n_aaaa1111', text: 'mléko', t: 1, koupeno: Date.now() }];
  renderNakup();
  check('jen koupené = záložka nesvítí', vidi(zal), false);
  check('  ale v seznamu jsou', poradi(), 'mléko✓');
  nakupData = [];
  renderNakup();
  check('vyprázdněný seznam záložku schová', vidi(zal), false);

  R.push('\\n3) Rohlík');
  const rbtn = document.getElementById('rohlikBtn');
  rohlikData = null;
  nakupData = [{ id: 'n_aaaa1111', text: 'Mléko', t: 1 }];
  renderNakup();
  check('bez nastaveného Rohlíku tlačítko není', rbtn.hidden, true);
  rohlikData = { enabled: true };
  renderNakup();
  check('s Rohlíkem a nekoupenými je', rbtn.hidden, false);
  nakupData = [{ id: 'n_aaaa1111', text: 'Mléko', t: 1, kosik: Date.now() }, { id: 'n_bbbb2222', text: 'chleba', t: 2, koupeno: Date.now() }];
  renderNakup();
  check('všechno v košíku nebo koupené = tlačítko není', rbtn.hidden, true);
  check('štítek v košíku', document.querySelector('#nakupSeznam li[data-id="n_aaaa1111"] .nakup-kosik').textContent, '🛒 v košíku');

  nakupData = [{ id: 'n_aaaa1111', text: 'Mléko', t: 1 }, { id: 'n_bbbb2222', text: 'chleba', t: 2 }, { id: 'n_cccc3333', text: 'sýr', t: 3 }];
  // Nepřihlášený: okno ukáže jen přihlášení
  rohlikData = { enabled: true, prihlaseno: false };
  renderNakup();
  dotazy = [];
  odpoved = url => url === '/api/rohlik/prihlasit' ? { ok: true, url: '#rohlik-test-prihlaseni' } : { ok: true };
  rbtn.click();
  await pockej(30);
  check('nepřihlášený: tlačítko přihlásit', document.getElementById('rohlikPrihlaseni').hidden, false);
  check('  bez seznamu a bez Přidat', document.getElementById('rohlikSeznam').hidden + ' ' + document.getElementById('rohlikPridat').hidden, 'true true');
  check('  nic se nehledá', dotazy.length, 0);
  document.getElementById('rohlikAdresa').value = 'http://localhost:3334/oauth/callback?error=stara';
  document.getElementById('rohlikPrihlasitBtn').click();
  await pockej(30);
  check('Přihlásit pošle požadavek se zámkem', dotazy[0] && dotazy[0].url, '/api/rohlik/prihlasit');
  check('  ukáže krok 2 s polem na adresu', document.getElementById('rohlikKrok2').hidden, false);
  check('  pole na adresu je po startu prázdné', document.getElementById('rohlikAdresa').value, '');
  // Dokončení vloženou adresou
  dotazy = [];
  odpoved = (url, telo) => url === '/api/rohlik/oauth/kod'
    ? (/code=/.test(telo.adresa) ? { ok: true, rohlik: { enabled: true, prihlaseno: true } } : { error: 'V adrese chybí kód.' })
    : (url === '/api/rohlik/vyber' ? { ok: true, vyber: {} } : (url.startsWith('/api/rohlik/hledat') ? { ok: true, vyrobky: [] } : { ok: true }));
  document.getElementById('rohlikAdresa').value = 'http://localhost:3334/oauth/callback';
  document.getElementById('rohlikDokoncitBtn').click();
  await pockej(30);
  check('adresa bez kódu: chyba', document.getElementById('rohlikStav').textContent, 'V adrese chybí kód.');
  check('  a pole se vyprázdní', document.getElementById('rohlikAdresa').value, '');
  document.getElementById('rohlikAdresa').value = 'http://localhost:3334/oauth/callback?code=KOD&state=S';
  document.getElementById('rohlikDokoncitBtn').click();
  await pockej(120);
  check('Dokončit pošle vloženou adresu', dotazy.filter(d => d.url === '/api/rohlik/oauth/kod').pop().telo.adresa, 'http://localhost:3334/oauth/callback?code=KOD&state=S');
  check('  přihlášeno', document.getElementById('rohlikStav').textContent, 'Přihlášeno k Rohlíku ✓');
  check('  a ukáže výběr výrobků', document.getElementById('rohlikPrihlaseni').hidden + ' ' + document.getElementById('rohlikSeznam').hidden, 'true false');
  document.getElementById('rohlikZavrit').click();
  rohlikData = { enabled: true, prihlaseno: true };
  renderNakup();
  dotazy = [];
  odpoved = (url, telo) => {
    if (url === '/api/rohlik/vyber') return { ok: true, vyber: { mleko: { productId: 1349777, nazev: 'Kunín Mléko 1,5 %', cena: 24.9 } } };
    if (url.startsWith('/api/rohlik/hledat')) return { ok: true, vyrobky: /chleba/.test(decodeURIComponent(url))
      ? [{ productId: 55, nazev: 'Chléb Šumava', cena: 39.9 }, { productId: 56, nazev: 'Chléb kmínový', cena: 35 }] : [] };
    if (url === '/api/rohlik/kosik') return { ok: true, pridano: telo.polozky.length, nakup: nakupData.map(p => telo.polozky.some(x => x.nakupId === p.id) ? { ...p, kosik: 1 } : p) };
    return { ok: true };
  };
  rbtn.click();
  await pockej(80);
  const rok = document.getElementById('rohlikOkno');
  check('okno se otevře', rok.hidden, false);
  check('  přihlášený: bez tlačítka přihlásit', document.getElementById('rohlikPrihlaseni').hidden, true);
  check('  s tokenem', dotazy.find(d => d.url === '/api/rohlik/vyber') && true, true);
  const box = id => document.querySelector('#rohlikSeznam .rohlik-polozka[data-id="' + id + '"]');
  check('zapamatovaný výběr je předvybraný', box('n_aaaa1111').querySelector('.rohlik-vyrobek.vybrany').textContent.includes('Kunín Mléko'), true);
  check('  a nehledá se', dotazy.some(d => /hledat\?q=Ml/.test(d.url)), false);
  check('nové se hledají', dotazy.filter(d => d.url.startsWith('/api/rohlik/hledat')).length, 2);
  check('  výsledky k výběru', box('n_bbbb2222').querySelectorAll('.rohlik-vyrobek').length, 2);
  check('  nic nenalezeno se řekne', /Nic se nenašlo/.test(box('n_cccc3333').textContent), true);
  check('tlačítko počítá vybrané', document.getElementById('rohlikPridat').textContent, 'Přidat do košíku (1)');
  box('n_bbbb2222').querySelectorAll('.rohlik-vyrobek')[1].click();
  check('klepnutím se vybere', box('n_bbbb2222').querySelector('.rohlik-vyrobek.vybrany').textContent.includes('kmínový'), true);
  box('n_aaaa1111').querySelectorAll('.rohlik-mnozstvi button')[1].click();
  check('množství +', box('n_aaaa1111').querySelector('.rohlik-pocet').textContent, '2×');
  box('n_cccc3333').querySelector('.rohlik-preskocit').click();
  check('přeskočit', box('n_cccc3333').classList.contains('preskoceno'), true);
  dotazy = [];
  document.getElementById('rohlikPridat').click();
  await pockej(40);
  const kos = dotazy.find(d => d.url === '/api/rohlik/kosik');
  check('odešle vybrané s množstvím', kos && kos.telo.polozky.map(p => p.nakupId + ':' + p.productId + ':' + p.mnozstvi).join(','), 'n_aaaa1111:1349777:2,n_bbbb2222:56:1');
  check('  hláška o přidání', /Přidáno 2 položek/.test(document.getElementById('rohlikStav').textContent), true);
  check('  v okně zbude jen přeskočená', [...document.querySelectorAll('#rohlikSeznam .rohlik-polozka')].map(b => b.dataset.id).join(), 'n_cccc3333');
  check('  a v seznamu je štítek', !!document.querySelector('#nakupSeznam li[data-id="n_aaaa1111"] .nakup-kosik'), true);
  document.getElementById('rohlikZavrit').click();
  check('Zavřít', rok.hidden, true);

  R.push('\\n4) Pravidelně kupované');
  const obl = document.getElementById('nakupOblibene');
  nakupOblibeneData = [{ text: 'Vajíčka', ikona: '🥚' }, { text: 'Mléko', ikona: '🥛' }, { text: 'Toaletní papír', ikona: '🧻' }];
  nakupData = [{ id: 'n_aaaa1111', text: 'mléko', t: 1 }];
  renderNakup();
  check('bez klepnutí do pole schované', obl.hidden, true);
  document.getElementById('nakupVstup').dispatchEvent(new Event('focus'));
  check('klepnutí do pole ukáže pravidelné', obl.hidden, false);
  check('  s ikonami', [...obl.querySelectorAll('button')].map(b => b.textContent).join(' | '), '🥚 Vajíčka | 🥛 Mléko | 🧻 Toaletní papír');
  check('  co už je na seznamu, je zašedlé', [...obl.querySelectorAll('button')].map(b => b.classList.contains('uz')).join(), 'false,true,false');
  dotazy = [];
  odpoved = (url, telo) => url === '/api/nakup' ? { ok: true, nakup: [...nakupData, { id: 'n_dddd4444', text: telo.text, t: 4 }] } : { ok: true };
  obl.querySelectorAll('button')[2].click();
  await pockej(30);
  check('klepnutí přidá položku', dotazy[0] && dotazy[0].url + ' ' + dotazy[0].telo.text, '/api/nakup Toaletní papír');
  check('  a hned je zašedlá', obl.querySelectorAll('button')[2].classList.contains('uz'), true);
  dotazy = [];
  obl.querySelectorAll('button')[1].click();
  await pockej(20);
  check('zašedlá se nepřidá podruhé', dotazy.length, 0);
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  check('klepnutí jinam nabídku schová', obl.hidden, true);

  // Úprava v Logice automatiky
  const ns = document.getElementById('oblibeneSeznam');
  check('nastavení je v Logice automatiky', !!ns.closest('.slide[data-title="Logika automatiky"]'), true);
  renderOblibeneNastaveni();
  check('  ukazuje seznam', [...ns.querySelectorAll('.nazev')].map(n => n.textContent).join(' | '), '🥚 Vajíčka | 🥛 Mléko | 🧻 Toaletní papír');
  dotazy = [];
  odpoved = (url, telo) => url === '/api/nakup/oblibene' ? { ok: true, nakupOblibene: telo.polozky } : { ok: true };
  ns.querySelectorAll('button')[1].click();
  await pockej(30);
  check('✕ odebere a uloží', dotazy[0] && dotazy[0].telo.polozky.map(p => p.text).join(), 'Vajíčka,Toaletní papír');
  document.getElementById('oblibeneIkona').value = '🍞';
  document.getElementById('oblibeneText').value = 'Rohlíky';
  document.getElementById('oblibenePridat').click();
  await pockej(30);
  check('přidání nové s ikonou', JSON.stringify(dotazy[1] && dotazy[1].telo.polozky.slice(-1)[0]), JSON.stringify({ text: 'Rohlíky', ikona: '🍞' }));
  check('  pole se vyprázdní', document.getElementById('oblibeneText').value, '');
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
