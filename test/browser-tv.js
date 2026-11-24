// Televize dětí: karta na Ovládání (Miky + Elenka, jeden graf se dvěma čarami),
// tlačítka Elenky neaktivní bez Shelly, a rozvrh v Log/Nastavení (úpravy, uložení).
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
let poslano = [];
let odpoved = null;
window.fetch = async (url, init) => {
  const telo = init && init.body ? JSON.parse(init.body) : null;
  poslano.push({ url: String(url), telo });
  const o = odpoved || { status: 200, data: { ok: true } };
  return { ok: o.status === 200, status: o.status, json: async () => o.data };
};
const VYCHOZI = {
  rozvrh: {
    miky: [
      { dny: [1, 2, 3, 4, 5], cas: '07:30', akce: 'on', zap: true },
      { dny: [1, 2, 3, 4, 5], cas: '20:00', akce: 'off', zap: true },
      { dny: [6, 7], cas: '06:30', akce: 'on', zap: true },
      { dny: [6, 7], cas: '22:00', akce: 'off', zap: true }
    ],
    elenka: []
  },
  deti: [{ klic: 'miky', jmeno: 'Miky', rele: 'tvMiky', pripojeno: true },
         { klic: 'elenka', jmeno: 'Elenka', rele: 'tvElenka', pripojeno: false }]
};
const kopie = o => JSON.parse(JSON.stringify(o));
setTimeout(async () => {
 try {
  const pockej = () => new Promise(r => setTimeout(r, 30));
  R.push('1) Karta na Ovládání');
  renderTvRozvrh(kopie(VYCHOZI));
  const karta = document.getElementById('tvMikyCard');
  check('karta je na Ovládání', !!karta.closest('.slide[data-title="Ovládání"]'), true);
  check('  Miky i Elenka', [...karta.querySelectorAll('.shelly-label')].map(e => e.textContent).join(' | '), 'Televize Miky | Televize Elenka');
  const eOn = document.getElementById('tvElenkaOnBtn'), eOff = document.getElementById('tvElenkaOffBtn');
  check('tlačítka Elenky neaktivní', eOn.disabled + ' ' + eOff.disabled, 'true true');
  check('  a proč', document.getElementById('tvElenkaHold').textContent, 'Shelly zatím není připojené');
  check('Mikyho tlačítka aktivní', document.getElementById('tvMikyOnBtn').disabled, false);
  poslano = [];
  eOn.click();
  await pockej();
  check('neaktivní tlačítko nic nepošle', poslano.length, 0);
  check('jeden graf dole v kartě', karta.querySelectorAll('canvas').length + ' ' + (karta.querySelector('canvas').closest('.device-block').id), '1 tvElenkaBlok');
  check('  se dvěma čarami', TV_MIKY_LANE.key + ',' + TV_ELENKA_LANE.key, 'tvMiky,tvElenka');
  // Až server Elenčino Shelly ohlásí, tlačítka ožijí
  const pripojena = kopie(VYCHOZI); pripojena.deti[1].pripojeno = true;
  renderTvRozvrh(pripojena);
  check('se Shelly tlačítka Elenky ožijí', eOn.disabled + ' ' + eOff.disabled, 'false false');
  poslano = [];
  eOn.click();
  await pockej();
  check('  a posílají na její relé', poslano[0] && poslano[0].url + ' ' + poslano[0].telo.turn, '/api/tv/elenka/set on');
  check('  hláška „není připojené" zmizí', document.getElementById('tvElenkaHold').textContent, '');
  renderTvRozvrh(kopie(VYCHOZI));

  R.push('\\n2) Rozvrh v Log/Nastavení');
  const rk = document.getElementById('tvRozvrhKarta');
  check('karta je v Log/Nastavení', !!rk.closest('.slide[data-title="Log/Nastavení"]'), true);
  const sek = k => rk.querySelector('.tvr-dite[data-dite="' + k + '"]');
  check('Miky má čtyři pravidla', sek('miky').querySelectorAll('.tvr-pravidlo').length, 4);
  const prvni = sek('miky').querySelector('.tvr-pravidlo');
  check('  dny Po–Pá svítí', [...prvni.querySelectorAll('.rozvrh-dny button.on')].map(b => b.textContent).join(','), 'Po,Út,St,Čt,Pá');
  check('  čas a akce', prvni.querySelector('input[type=time]').value + ' ' + prvni.querySelector('.tvr-akce').textContent, '07:30 Zapnout');
  check('Elenka: prázdná s poznámkou o Shelly', sek('elenka').querySelectorAll('.tvr-pravidlo').length + ' ' + /Shelly zatím není/.test(sek('elenka').textContent), '0 true');
  const ulozit = document.getElementById('tvRozvrhUlozit');
  check('bez úprav nejde uložit', ulozit.disabled, true);

  // Úpravy: přidat Elence pravidlo, přepnout ho na vypnutí, přidat sobotu, změnit čas
  sek('elenka').querySelector('.tvr-pridat').click();
  check('přidání Elence pravidlo', sek('elenka').querySelectorAll('.tvr-pravidlo').length, 1);
  check('  teď jde uložit', ulozit.disabled, false);
  check('  a hlásí se neuloženo', document.getElementById('tvRozvrhHint').textContent, 'Neuloženo.');
  let ep = () => sek('elenka').querySelector('.tvr-pravidlo');
  ep().querySelector('.tvr-akce').click();
  ep().querySelectorAll('.rozvrh-dny button')[5].click();
  const cas = ep().querySelector('input[type=time]');
  cas.value = '19:45'; cas.dispatchEvent(new Event('change'));
  check('  akce, dny a čas', ep().querySelector('.tvr-akce').textContent + ' ' + [...ep().querySelectorAll('.rozvrh-dny button.on')].map(b => b.textContent).join(',') + ' ' + ep().querySelector('input[type=time]').value,
    'Vypnout Po,Út,St,Čt,Pá,So 19:45');
  // Smazat Mikyho víkendové 22:00 a vypnout jeho 6:30
  const mp = () => [...sek('miky').querySelectorAll('.tvr-pravidlo')];
  mp()[3].querySelector('.tvr-mini[aria-label]').click();
  mp()[2].querySelectorAll('.tvr-mini')[0].click();
  check('smazání a vypnutí pravidla', mp().length + ' ' + mp()[2].classList.contains('vyp'), '3 true');
  // Stav ze serveru během úprav návrh nepřepíše
  renderTvRozvrh(kopie(VYCHOZI));
  check('příchozí stav úpravy nesmaže', mp().length, 3);

  poslano = [];
  odpoved = { status: 200, data: { rozvrh: { miky: [], elenka: [] }, deti: VYCHOZI.deti } };
  ulozit.click();
  await pockej();
  const t = poslano[0];
  check('uložení pošle celý rozvrh', t && t.url, '/api/tv-rozvrh');
  check('  Elenka', JSON.stringify(t.telo.rozvrh.elenka), JSON.stringify([{ dny: [1, 2, 3, 4, 5, 6], cas: '19:45', akce: 'off', zap: true }]));
  check('  Miky bez smazaného, 6:30 vypnuté', t.telo.rozvrh.miky.map(p => p.cas + (p.zap ? '' : '-')).join(','), '07:30,20:00,06:30-');
  check('po uložení se ukáže, co vrátil server', sek('miky').querySelectorAll('.tvr-pravidlo').length + ' ' + document.getElementById('tvRozvrhHint').textContent, '0 Uloženo.');
  check('  a uložit zase nejde', ulozit.disabled, true);

  renderTvRozvrh(kopie(VYCHOZI));
  sek('miky').querySelector('.tvr-pridat').click();
  odpoved = { status: 400, data: { error: 'Miky 07:00: vyber aspoň jeden den.' } };
  ulozit.click();
  await pockej();
  check('chyba serveru se ukáže', document.getElementById('tvRozvrhHint').textContent, 'Miky 07:00: vyber aspoň jeden den.');
  check('  návrh zůstane a jde uložit znovu', sek('miky').querySelectorAll('.tvr-pravidlo').length + ' ' + ulozit.disabled, '5 false');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (televize)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'tv.html');
fs.writeFileSync(out, v);
console.log(out);
