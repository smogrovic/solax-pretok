// Stránka Připomínky: kytky a vysavač po 7 dnech, popelnice v okně před svozem,
// přepínače popelnic a vystrčená záložka na ostatních stránkách.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const OUT = [];
const POSLANO = [];
window.fetch = async (adresa, opts) => {
  const telo = opts && opts.body ? JSON.parse(opts.body) : null;
  POSLANO.push({ adresa: String(adresa), telo });
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};
function check(name, got, want) {
  const ok = String(got) === String(want);
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(54) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const DEN = 86400000, H = 3600000, MIN = 60000;
// Září je letní čas: Praha = UTC + 2 h
const praha = (d, hod, min) => Date.parse(d + 'T00:00:00Z') + (hod - 2) * H + (min || 0) * MIN;
const def = id => PRIPOMINKY.find(p => p.id === id);
const sviti = (id, p, t) => pripominkaStav(def(id), p, t).sviti;
const radek = id => document.querySelector('#pripSeznam .prip-radek[data-id="' + id + '"]');

(async () => {
 try {
  await wait(150);

  OUT.push('\\n1) Stránka');
  const tituly = Array.from(document.querySelectorAll('.slide')).map(s => s.dataset.title);
  check('stránka je hned za Úklidem', tituly[tituly.indexOf('Úklid') + 1], 'Připomínky');
  pripData = null; renderPripominky();
  check('osm připomínek (i pes, tráva a povlečení; sekačka jen nastavená)', document.querySelectorAll('#pripSeznam .prip-radek').length, 8);
  check('přepínač má každá připomínka',
    Array.from(document.querySelectorAll('#pripSeznam .prip-prepinac')).map(s => s.closest('.prip-radek').dataset.id).join(','),
    'kytky,vysavac,bio,popelnice,trava,povleceni,pesRano,pesVecer');
  const druh = e => e.classList.contains('prip-prepinac') ? 'prepinac' : e.classList.contains('prip-hotovo') ? 'hotovo'
    : e.classList.contains('prip-interval') ? 'interval' : 'nastaveni';
  check('nastavení vlevo, Hotovo vpravo', Array.from(radek('bio').querySelector('.prip-akce').children).map(druh).join(','), 'nastaveni,hotovo');
  check('  přepínač a pod ním volič intervalu', Array.from(radek('kytky').querySelector('.prip-nastaveni').children).map(druh).join(','), 'prepinac,interval');
  const sw = radek('kytky').querySelector('.prip-prepinac').getBoundingClientRect(), iv = radek('kytky').querySelector('.prip-interval').getBoundingClientRect();
  check('  opravdu pod sebou', iv.top >= sw.bottom - 1, true);
  const prepOkraje = Array.from(document.querySelectorAll('#pripSeznam .prip-prepinac')).map(b => Math.round(b.getBoundingClientRect().left));
  check('  přepínače jsou pod sebou (i bez voliče)', new Set(prepOkraje).size, 1);
  const praveOkraje = Array.from(document.querySelectorAll('#pripSeznam .prip-hotovo')).map(b => Math.round(b.getBoundingClientRect().right));
  const sirky = Array.from(document.querySelectorAll('#pripSeznam .prip-hotovo')).map(b => Math.round(b.getBoundingClientRect().width));
  check('tlačítka jsou pod sebou', new Set(praveOkraje).size === 1 && new Set(sirky).size === 1, 'true');
  check('není zamykací', document.getElementById('pripominkySlide').querySelector('.lockable'), null);
  // Volič intervalu přibyl do řádku — nic nesmí přetéct přes pravý okraj karty
  const karta = document.getElementById('pripSeznam').getBoundingClientRect();
  check('tlačítka nepřetékají kartu', Array.from(document.querySelectorAll('#pripSeznam .prip-hotovo'))
    .every(b => b.getBoundingClientRect().right <= karta.right + 1), 'true');
  check('  a text má aspoň 120 px', Array.from(document.querySelectorAll('#pripSeznam .prip-telo'))
    .every(t => t.getBoundingClientRect().width >= 120), 'true');

  OUT.push('\\n2) Kytky a vysavač');
  const ted = praha('2026-09-23', 10);
  check('bez odťuknutí svítí hned', sviti('kytky', { hotovo: 0 }, ted), 'true');
  check('  i vysavač', sviti('vysavac', null, ted), 'true');
  check('odťuknuté před 6 dny nesvítí', sviti('kytky', { hotovo: ted - 6 * DEN }, ted), 'false');
  // Počítá se po dnech: hotovo 16. 9. → svítí od půlnoci 23. 9.
  check('  hotovo 16. 9.: 22. 9. ve 23:59 ještě ne', sviti('kytky', { hotovo: praha('2026-09-16', 18) }, praha('2026-09-22', 23) + 59 * MIN), 'false');
  check('  23. 9. od půlnoci už ano', sviti('kytky', { hotovo: praha('2026-09-16', 18) }, praha('2026-09-23', 0)), 'true');
  // (pomocník praha() počítá s letním časem; po 25. 10. je v Praze UTC+1, proto Date.UTC)
  // Vysavač: ráno aktivovaný, pak „hotovo včera" (1. 10.) → svítit začne až 8. 10.
  const vys = { dni: 7, hotovo: praha('2026-10-01', 12), aktivovano: 0 };
  check('hotovo včera 1. 10. → dnes 2. 10. nesvítí', sviti('vysavac', vys, praha('2026-10-02', 9)), 'false');
  check('  a říká Příště 8. 10.', pripominkaStav(def('vysavac'), vys, praha('2026-10-02', 9)).text, 'Příště 8. 10.');
  check('  7. 10. večer ještě ne', sviti('vysavac', vys, praha('2026-10-07', 23)), 'false');
  check('  8. 10. ráno ano', sviti('vysavac', vys, praha('2026-10-08', 0) + MIN), 'true');
  check('  odpočet ráno 2. 10. „za 6 dní"', pripOdpocet(pripominkaStav(def('vysavac'), vys, praha('2026-10-02', 9)).dalsi - praha('2026-10-02', 9)), 'za 6 dní');
  check('povlečení 4 týdny: hotovo 1. 10. → příště 29. 10.', pripominkaStav(def('povleceni'), { hotovo: praha('2026-10-01', 20) }, praha('2026-10-02', 9)).text, 'Příště 29. 10.');
  check('  přes změnu času (25. 10.) svítí 29. 10. od půlnoci', sviti('povleceni', { hotovo: praha('2026-10-01', 20) }, Date.UTC(2026, 9, 28, 23, 0)) + ',' + sviti('povleceni', { hotovo: praha('2026-10-01', 20) }, Date.UTC(2026, 9, 28, 22, 59)), 'true,false');
  check('po 7 dnech svítí', sviti('kytky', { hotovo: ted - 7 * DEN }, ted), 'true');
  const st9 = pripominkaStav(def('vysavac'), { hotovo: ted - 9 * DEN }, ted);
  check('  naposledy a pod tím příště', st9.naposledy + ' | ' + st9.text, 'Naposledy 14. 9. (před 9 dny) | Příště 21. 9. — už je čas');
  check('hotové řekne, kdy příště',
    (st => st.naposledy + ' | ' + st.text)(pripominkaStav(def('kytky'), { hotovo: praha('2026-09-20', 9) }, ted)), 'Naposledy 20. 9. | Příště 27. 9.');
  check('interval ze serveru (3 dny) platí', pripominkaStav(def('kytky'), { hotovo: praha('2026-09-20', 9), dni: 3 }, ted).text,
    'Příště 23. 9. — už je čas');
  check('nikdy neodťuknuté', (st => st.naposledy + ' | ' + st.text)(pripominkaStav(def('kytky'), { hotovo: 0 }, ted)), 'Naposledy: zatím nikdy | ');
  check('povlečení výchozí 4 týdny', pripominkaStav(def('povleceni'), { hotovo: praha('2026-09-01', 9) }, ted).text, 'Příště 29. 9.');

  OUT.push('\\n3) BIO (svoz v pondělí)');
  const bio = { zapnuto: true, hotovo: 0 };
  check('sobota večer nesvítí', sviti('bio', bio, praha('2026-09-26', 20)), 'false');
  check('neděle 11:59 nesvítí', sviti('bio', bio, praha('2026-09-27', 11, 59)), 'false');
  check('neděle 12:00 svítí', sviti('bio', bio, praha('2026-09-27', 12)), 'true');
  check('  s textem', pripominkaStav(def('bio'), bio, praha('2026-09-27', 12)).text, 'Vyndat — svoz zítra');
  check('pondělí 11:59 svítí', sviti('bio', bio, praha('2026-09-28', 11, 59)), 'true');
  check('  svoz dnes', pripominkaStav(def('bio'), bio, praha('2026-09-28', 8)).text, 'Vyndat — svoz dnes dopoledne');
  check('pondělí 12:00 zhasne samo', sviti('bio', bio, praha('2026-09-28', 12)), 'false');
  check('  a řekne příští svoz', pripominkaStav(def('bio'), bio, praha('2026-09-28', 12)).text, 'Příští svoz v pondělí 5. 10.');
  check('odťuknuté v okně nesvítí',
    sviti('bio', { zapnuto: true, hotovo: praha('2026-09-27', 18) }, praha('2026-09-27', 20)), 'false');
  check('odťuknutí z minulého týdne se nepočítá',
    sviti('bio', { zapnuto: true, hotovo: praha('2026-09-20', 18) }, praha('2026-09-27', 20)), 'true');
  const bioSob = { zapnuto: true, hotovo: praha('2026-09-26', 10) };
  check('odťuknuté dřív (sobota) v neděli 12:00 nesvítí', sviti('bio', bioSob, praha('2026-09-27', 12)), 'false');
  check('  a hlásí vyndáno', (st => st.naposledy + ' | ' + st.text)(pripominkaStav(def('bio'), bioSob, praha('2026-09-27', 12))), 'Naposledy 26. 9. | Vyndáno ✓ · svoz zítra');
  check('  už v sobotu', pripominkaStav(def('bio'), bioSob, praha('2026-09-26', 11)).text, 'Vyndáno ✓ · svoz v pondělí 28. 9.');
  check('  a odpočítává do dalšího týdne', pripominkaStav(def('bio'), bioSob, praha('2026-09-26', 11)).dalsi, praha('2026-10-04', 12));
  check('odťuknuté hned po svozu platí pro příští týden',
    sviti('bio', { zapnuto: true, hotovo: praha('2026-09-21', 13) }, praha('2026-09-27', 12)), 'false');
  check('odťuknuté před svozem se na další týden nepřenese',
    sviti('bio', { zapnuto: true, hotovo: praha('2026-09-21', 8) }, praha('2026-09-27', 12)), 'true');
  check('vypnutý přepínač nesvítí', sviti('bio', { zapnuto: false, hotovo: 0 }, praha('2026-09-27', 20)), 'false');
  // Zimní čas: v lednu je Praha UTC + 1 h
  check('v zimním čase neděle 12:00 svítí',
    sviti('bio', bio, Date.parse('2026-01-04T11:00:00Z')), 'true');
  check('  a 11:59 ještě ne', sviti('bio', bio, Date.parse('2026-01-04T10:59:00Z')), 'false');

  OUT.push('\\n4) Popelnice (svoz ve čtvrtek)');
  const pop = { zapnuto: true, hotovo: 0 };
  check('středa 11:59 nesvítí', sviti('popelnice', pop, praha('2026-09-30', 11, 59)), 'false');
  check('středa 12:00 svítí', sviti('popelnice', pop, praha('2026-09-30', 12)), 'true');
  check('čtvrtek 11:59 svítí', sviti('popelnice', pop, praha('2026-10-01', 11, 59)), 'true');
  check('čtvrtek 12:00 zhasne', sviti('popelnice', pop, praha('2026-10-01', 12)), 'false');
  check('  a řekne příští svoz', pripominkaStav(def('popelnice'), pop, praha('2026-10-01', 12)).text,
    'Příští svoz ve čtvrtek 8. 10.');
  check('mimo okno odpočítává do dalšího okna',
    pripominkaStav(def('popelnice'), pop, praha('2026-10-02', 12)).dalsi, praha('2026-10-07', 12));
  check('i běžná popelnice jde vypnout',
    sviti('popelnice', { zapnuto: false, hotovo: 0 }, praha('2026-09-30', 12)), 'false');
  check('vypnuté kytky nesvítí', pripominkaStav(def('kytky'), { zapnuto: false, hotovo: 0 }, ted).text, 'Připomínka vypnutá');
  check('  ruční „Aktivovat teď" má přednost', sviti('kytky', { zapnuto: false, hotovo: 0, aktivovano: ted - MIN }, ted), 'true');
  check('vypnutý pes nesvítí', sviti('pesRano', { zapnuto: false, hotovo: 0 }, praha('2026-09-30', 7)), 'false');
  check('vypnuté BIO neodpočítává', pripominkaStav(def('bio'), { zapnuto: false }, praha('2026-09-30', 12)).dalsi, null);

  OUT.push('\\n4b) Odpočet');
  check('pod den v hodinách', pripOdpocet(3 * H - MIN), 'za 3 h');
  check('den', pripOdpocet(DEN), 'za 1 den');
  check('dny', pripOdpocet(3 * DEN + H), 'za 4 dny');
  check('dní', pripOdpocet(6 * DEN + H), 'za 7 dní');

  OUT.push('\\n5) Tlačítka');
  pripData = { trava: { hotovo: Date.now() }, kytky: { hotovo: 0 }, vysavac: { hotovo: Date.now() }, bio: { zapnuto: true, hotovo: 0 },
               popelnice: { zapnuto: true, hotovo: 0 } };
  renderPripominky();
  POSLANO.length = 0;
  radek('kytky').querySelector('.prip-hotovo').click();
  const datOkno = document.getElementById('pripDatumOkno');
  await wait(30);
  check('oranžové Hotovo = teď, bez kalendáře', datOkno.hidden, true);
  check('Hotovo pošle odťuknutí', POSLANO[0] && POSLANO[0].adresa, '/api/pripominky/kytky/hotovo');
  check('  bez data (server vezme teď)', POSLANO[0].telo.kdy, undefined);
  check('  a tlačítko nabídne Zpět', radek('kytky').querySelector('.prip-hotovo').textContent, 'Zpět');
  pripZpet.kytky = 0;
  pripData.kytky.hotovo = Date.now() - 2 * DEN;
  renderPripominky();
  const kb = radek('kytky').querySelector('.prip-hotovo');
  check('hotové místo Hotovo odpočítává', kb.textContent, 'za 5 dní');
  check('  šedě, ne oranžově', kb.classList.contains('sviti') + ',' + kb.classList.contains('odpocet'), 'false,true');
  check('  a jde odťuknout i dřív', kb.disabled, 'false');
  POSLANO.length = 0;
  kb.click();
  await wait(30);
  check('  pošle odťuknutí hned', POSLANO[0] && POSLANO[0].adresa, '/api/pripominky/kytky/hotovo');
  check('  a nabídne Zpět', radek('kytky').querySelector('.prip-hotovo').textContent, 'Zpět');
  pripZpet.kytky = 0;
  pripData.kytky.hotovo = Date.now() - 2 * DEN;
  renderPripominky();
  // „Udělal jsem to včera": klepnutí na „Naposledy …" a den v kalendáři
  POSLANO.length = 0;
  const nap = radek('kytky').querySelector('.prip-naposledy');
  check('řádek Naposledy je klepací', nap.tagName, 'BUTTON');
  nap.click();
  check('  otevře kalendář', datOkno.hidden, false);
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  check('  s předvybraným posledním datem', document.getElementById('pripDatum').value, iso(new Date(Date.now() - 2 * DEN)));
  const vcera = new Date(Date.now() - DEN);
  document.getElementById('pripDatum').value = vcera.getFullYear() + '-' + String(vcera.getMonth() + 1).padStart(2, '0') + '-' + String(vcera.getDate()).padStart(2, '0');
  document.getElementById('pripDatumAno').click();
  await wait(30);
  check('  Uložit pošle odťuknutí', POSLANO[0] && POSLANO[0].adresa, '/api/pripominky/kytky/hotovo');
  const vceraPoledne = new Date(vcera.getFullYear(), vcera.getMonth(), vcera.getDate(), 12).getTime();
  check('  s včerejším dnem (poledne)', POSLANO[0].telo.kdy, vceraPoledne);
  check('  a nabídne Zpět', radek('kytky').querySelector('.prip-hotovo').textContent, 'Zpět');
  pripZpet.kytky = 0;
  pripData.kytky.hotovo = Date.now();
  renderPripominky();
  check('  pak naskočí nový odpočet', radek('kytky').querySelector('.prip-hotovo').textContent, 'za 7 dní');
  // Volič intervalu: kytky, vysavač, tráva 3–14 dní; povlečení 1–4 týdny
  const volic = id => radek(id).querySelector('.prip-interval');
  check('volič mají kytky, vysavač, tráva a povlečení',
    Array.from(document.querySelectorAll('#pripSeznam .prip-interval')).map(e => e.closest('.prip-radek').dataset.id).join(','), 'kytky,vysavac,trava,povleceni');
  check('  kytky 3–14 dní', Array.from(volic('kytky').options).map(o => o.value).join(','), '3,4,5,6,7,8,9,10,11,12,13,14');
  check('  s popisky', volic('kytky').options[0].textContent + ' / ' + volic('kytky').options[11].textContent, '3 d / 14 d');
  check('  povlečení po týdnech', Array.from(volic('povleceni').options).map(o => o.textContent).join(','), '1 týd.,2 týd.,3 týd.,4 týd.');
  check('  výchozí: kytky 7, povlečení 4 týdny', volic('kytky').value + ' ' + volic('povleceni').value, '7 28');
  POSLANO.length = 0;
  volic('vysavac').value = '10';
  volic('vysavac').dispatchEvent(new Event('change'));
  await wait(30);
  check('změna intervalu se pošle serveru', POSLANO[0] && POSLANO[0].adresa + ' ' + POSLANO[0].telo.dni, '/api/pripominky/vysavac/interval 10');
  // Zpět v kalendáři nic nepošle
  POSLANO.length = 0;
  pripZpet.povleceni = 0;
  radek('povleceni').querySelector('.prip-naposledy').click();
  document.getElementById('pripDatumZpet').click();
  await wait(30);
  radek('povleceni').querySelector('.prip-naposledy').click();
  const boxR = document.querySelector('#pripDatumOkno .potvrz-box').getBoundingClientRect();
  const poleR = document.getElementById('pripDatum').getBoundingClientRect();
  check('pole s datem nevyčuhuje z okna', poleR.right <= boxR.right - 10 && poleR.left >= boxR.left + 10, 'true');
  document.getElementById('pripDatumZpet').click();
  check('Zpět v kalendáři nic neodťukne', POSLANO.length + ' ' + document.getElementById('pripDatumOkno').hidden, '0 true');
  POSLANO.length = 0;
  pripData.vysavac.hotovo = 0; renderPripominky();
  const vb = radek('vysavac').querySelector('.prip-hotovo');
  check('svítící je oranžové Hotovo', vb.textContent + ',' + vb.classList.contains('sviti') + ',' + vb.classList.contains('odpocet'), 'Hotovo,true,false');
  pripZpet.kytky = Date.now() + 5000; renderPripominky();
  radek('kytky').querySelector('.prip-hotovo').click();
  await wait(30);
  check('Zpět vrátí odťuknutí', JSON.stringify(POSLANO[0] && POSLANO[0].telo), '{"zpet":true}');
  POSLANO.length = 0;
  radek('bio').querySelector('.prip-prepinac').click();
  await wait(30);
  check('přepínač BIO se vypne', POSLANO[0] && POSLANO[0].adresa + ' ' + JSON.stringify(POSLANO[0].telo),
    '/api/pripominky/bio/zapnuto {"zapnuto":false}');

  OUT.push('\\n6) Vystrčená záložka');
  const zal = document.getElementById('pripZalozka');
  sliderWrap.scrollTo({ left: 0 }); await wait(100); updateDots();
  pripData = { trava: { hotovo: Date.now() }, povleceni: { hotovo: Date.now() }, kytky: { hotovo: 0 }, vysavac: { hotovo: 0 }, bio: { zapnuto: false }, popelnice: { hotovo: Date.now() } };
  renderPripominky();
  check('na jiné stránce je vidět', zal.hidden, 'false');
  check('  s počtem', zal.textContent, '🔔 2');
  const rz = zal.getBoundingClientRect();
  const listaDole = document.querySelector('.page-tabs-bar').getBoundingClientRect().bottom;
  check('zvoneček je vlevo pod lištou záložek', rz.left < 30 && rz.top >= listaDole && rz.top < listaDole + 30, 'true');
  check('  s aurou kolem', getComputedStyle(zal, '::before').backdropFilter, 'blur(6px)');
  check('  o 20 % menší než dřív (14,4 px místo 18)', getComputedStyle(zal).fontSize, '14.4px');
  // Plynulé rolování headless prohlížeč nedojede — zachytí se, kam se rolovalo
  const slides = Array.from(sliderWrap.querySelectorAll('.slide:not([hidden])'));
  const cil = slides.indexOf(document.getElementById('pripominkySlide'));
  let kam = null;
  const puvodni = sliderWrap.scrollTo;
  sliderWrap.scrollTo = o => { kam = o.left; };
  const panel = document.getElementById('pripPanel');
  zal.click();
  check('klepnutí na zvoneček stránku nepřepne', kam, null);
  check('  ale rozbalí oranžový panel', panel.hidden, 'false');
  const kolik = Number(zal.textContent.replace(/\\D/g, ''));
  check('  řádků je tolik, kolik ukazuje zvoneček', panel.querySelectorAll('.prip-panel-radek').length, kolik);
  const rp = panel.getBoundingClientRect(), rz2 = zal.getBoundingClientRect();
  check('  panel je pod zvonečkem a v okně', rp.top >= rz2.bottom && rp.right <= innerWidth && rp.left >= 0, 'true');
  check('  oranžový', getComputedStyle(panel).backgroundColor, getComputedStyle(zal).backgroundColor);
  // Hotovo z panelu
  POSLANO.length = 0;
  const prvni = panel.querySelector('.prip-panel-radek');
  const idPrvni = prvni.dataset.id;
  prvni.querySelector('.prip-panel-hotovo').click();
  check('Hotovo v panelu odťukne', POSLANO.some(x => x.adresa === '/api/pripominky/' + idPrvni + '/hotovo'), 'true');
  check('  a ukáže Zpět', panel.querySelector('.prip-panel-radek[data-id="' + idPrvni + '"] .prip-panel-hotovo').textContent, 'Zpět');
  panel.querySelector('.prip-panel-radek[data-id="' + idPrvni + '"] .prip-panel-hotovo').click();
  check('  Zpět vrátí', POSLANO.some(x => x.adresa === '/api/pripominky/' + idPrvni + '/hotovo' && x.telo && x.telo.zpet), 'true');
  // Druhé klepnutí na zvoneček panel zavře, třetí zase otevře
  zal.click();
  check('druhé klepnutí na zvoneček panel zavře', panel.hidden, 'true');
  zal.click();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  check('klepnutí jinam panel zavře', panel.hidden, 'true');
  zal.click();
  panel.querySelector('.prip-panel-text').click();
  sliderWrap.scrollTo = puvodni;
  check('klepnutí na text v panelu přejede na Připomínky', Math.round(kam / sirkaStranky()), cil);
  check('  a panel se zavře', panel.hidden, 'true');
  sliderWrap.scrollLeft = cil * sirkaStranky(); updateDots();
  check('i na Připomínkách je zvoneček vidět', zal.hidden, 'false');
  sliderWrap.scrollLeft = 0; updateDots();
  check('zpátky jinde je zase vidět', zal.hidden, 'false');
  pripData = { trava: { hotovo: Date.now() }, povleceni: { hotovo: Date.now() }, kytky: { hotovo: Date.now() }, vysavac: { hotovo: Date.now() }, bio: { zapnuto: false }, popelnice: { hotovo: Date.now() } };
  renderPripominky();
  check('když nic nesvítí, záložka není', zal.hidden, 'true');

  OUT.push('\\n8) Aktivovat teď');
  const T0 = praha('2026-09-23', 10);
  const kytkyHotove = { hotovo: T0 - 2 * DEN };
  check('hotové kytky nesvítí', sviti('kytky', kytkyHotove, T0), 'false');
  check('po aktivaci svítí', sviti('kytky', { ...kytkyHotove, aktivovano: T0 - MIN }, T0), 'true');
  check('  s textem', pripominkaStav(def('kytky'), { ...kytkyHotove, aktivovano: T0 - MIN }, T0).text, 'Aktivováno ručně');
  check('po odťuknutí zhasne a běží do půlnoci za 7 dní',
    pripominkaStav(def('kytky'), { hotovo: T0, aktivovano: T0 - MIN }, T0 + MIN).dalsi, praha('2026-09-30', 0));
  check('aktivace svítí i u vypnutého BIO', sviti('bio', { zapnuto: false, aktivovano: T0 }, T0), 'true');
  check('i mimo okno svozu', sviti('popelnice', { aktivovano: T0 }, praha('2026-09-26', 10)), 'true');
  pripData = { trava: { hotovo: Date.now() }, povleceni: { hotovo: Date.now() }, kytky: { hotovo: Date.now() }, vysavac: { hotovo: Date.now() }, bio: { zapnuto: false },
               popelnice: { hotovo: Date.now() }, pesRano: { hotovo: Date.now() }, pesVecer: { hotovo: Date.now() } };
  renderPripominky();
  check('tlačítko „Aktivovat teď“ je u nesvítících', !!radek('kytky').querySelector('.prip-aktivovat'), 'true');
  POSLANO.length = 0;
  radek('kytky').querySelector('.prip-aktivovat').click();
  await wait(30);
  check('  pošle aktivaci', POSLANO[0] && POSLANO[0].adresa, '/api/pripominky/kytky/aktivovat');
  check('  a hned svítí', radek('kytky').classList.contains('sviti'), 'true');
  check('  u svítící už tlačítko není', !!radek('kytky').querySelector('.prip-aktivovat'), 'false');
  check('  a zvoneček ji počítá', document.getElementById('pripZalozka').textContent, '🔔 1');

  OUT.push('\\n9) Krmení psa');
  const pes = { hotovo: 0 };
  check('ráno 4:59 nesvítí', sviti('pesRano', pes, praha('2026-09-24', 4, 59)), 'false');
  check('  a řekne od kdy', pripominkaStav(def('pesRano'), pes, praha('2026-09-24', 4, 59)).text, 'Od 5:00');
  check('ráno 5:00 svítí', sviti('pesRano', pes, praha('2026-09-24', 5)), 'true');
  const nakrmeno = { hotovo: praha('2026-09-24', 6, 12) };
  check('nakrmeno v 6:12 nesvítí', sviti('pesRano', nakrmeno, praha('2026-09-24', 20)), 'false');
  check('  s časem', pripominkaStav(def('pesRano'), nakrmeno, praha('2026-09-24', 20)).text, 'Nakrmeno v 6:12');
  check('  ani ve 2:59 dalšího dne', sviti('pesRano', nakrmeno, praha('2026-09-25', 2, 59)), 'false');
  check('ve 3:00 se vynuluje (od 5:00)', pripominkaStav(def('pesRano'), nakrmeno, praha('2026-09-25', 3)).text, 'Od 5:00');
  check('  a v 5:00 zase svítí', sviti('pesRano', nakrmeno, praha('2026-09-25', 5)), 'true');
  check('nenakrmeno ráno svítí až do 3:00', sviti('pesRano', pes, praha('2026-09-25', 2, 30)), 'true');
  check('večer 15:59 nesvítí', sviti('pesVecer', pes, praha('2026-09-24', 15, 59)), 'false');
  check('večer 16:00 svítí', sviti('pesVecer', pes, praha('2026-09-24', 16)), 'true');
  check('  ranní krmení večerní neruší', sviti('pesVecer', pes, praha('2026-09-24', 17)), 'true');
  check('nakrmeno ráno → odpočet do zítřejších 5:00',
    pripominkaStav(def('pesRano'), nakrmeno, praha('2026-09-24', 20)).dalsi, praha('2026-09-25', 5));

  OUT.push('\\n10) Záložky psa přes všechny stránky — jen na iPadu');
  const psR = document.getElementById('pesRanoZalozka'), psV = document.getElementById('pesVecerZalozka');
  const skupina = document.getElementById('pripPlovouci');
  // Telefon (tohle okno): záložky psa nejsou, krmení je jen v seznamu
  pripData = { trava: { hotovo: Date.now() }, povleceni: { hotovo: Date.now() }, kytky: { hotovo: Date.now() }, vysavac: { hotovo: Date.now() }, bio: { zapnuto: false },
               popelnice: { hotovo: Date.now() }, pesRano: { hotovo: 0, aktivovano: Date.now() }, pesVecer: { hotovo: 0, aktivovano: Date.now() } };
  renderPripominky();
  check('na telefonu záložky psa nejsou', psR.hidden + ',' + psV.hidden, 'true,true');
  check('  a když nic jiného nesvítí, není ani skupina', skupina.hidden, 'true');
  check('  krmení je dál v seznamu', radek('pesRano').classList.contains('sviti'), 'true');
  // Dál jako na iPadu — široký displej se podvrhne
  const puvodniMM = window.matchMedia;
  window.matchMedia = q => /min-width: 1000px/.test(q) ? { matches: true } : puvodniMM.call(window, q);
  check('záložky psa jsou v plovoucí skupině se zvonečkem',
    skupina.contains(psR) && skupina.contains(psV) && skupina.contains(document.getElementById('pripZalozka')), 'true');
  pripData = { trava: { hotovo: Date.now() }, povleceni: { hotovo: Date.now() }, kytky: { hotovo: Date.now() }, vysavac: { hotovo: Date.now() }, bio: { zapnuto: false },
               popelnice: { hotovo: Date.now() }, pesRano: { hotovo: 0, aktivovano: Date.now() }, pesVecer: { hotovo: Date.now() } };
  renderPripominky();
  check('hladový pes (ráno) = záložka vidět', psR.hidden, 'false');
  check('  se symbolem', psR.textContent, '☀️🐕🥣');
  check('nakrmený (večer) = schovaná', psV.hidden, 'true');
  check('zvoneček psa nepočítá', document.getElementById('pripZalozka').hidden, 'true');
  check('skupina je vidět', skupina.hidden, 'false');
  // Na stránce Připomínky zvoneček mizí, pes ne
  const vid = Array.from(sliderWrap.querySelectorAll('.slide:not([hidden])'));
  sliderWrap.scrollLeft = vid.indexOf(document.getElementById('pripominkySlide')) * sirkaStranky(); updateDots();
  check('pes je vidět i na stránce Připomínky', psR.hidden, 'false');
  sliderWrap.scrollLeft = 0; updateDots();
  // Klepnutí = nakrmeno, 5 s jde vrátit
  POSLANO.length = 0;
  const r = psR.getBoundingClientRect();
  const ptr = (typ, x, y) => psR.dispatchEvent(new PointerEvent(typ, { bubbles: true, pointerId: 9, clientX: x, clientY: y }));
  ptr('pointerdown', r.left + 5, r.top + 5); ptr('pointerup', r.left + 5, r.top + 5);
  await wait(30);
  check('klepnutí = nakrmeno', POSLANO[0] && POSLANO[0].adresa, '/api/pripominky/pesRano/hotovo');
  check('  a záložka nabídne Zpět', psR.textContent, '↩︎ Zpět');
  ptr('pointerdown', r.left + 5, r.top + 5); ptr('pointerup', r.left + 5, r.top + 5);
  await wait(30);
  check('Zpět krmení vrátí', JSON.stringify(POSLANO[1] && POSLANO[1].telo), '{"zpet":true}');
  // Tažením se posune celá skupina, psa nenakrmí
  POSLANO.length = 0;
  const s0 = skupina.getBoundingClientRect();
  ptr('pointerdown', r.left + 5, r.top + 5);
  ptr('pointermove', r.left + 105, r.top + 45);
  ptr('pointerup', r.left + 105, r.top + 45);
  await wait(30);
  const s1 = skupina.getBoundingClientRect();
  check('tažení posune celou skupinu', Math.round(s1.left - s0.left) + ',' + Math.round(s1.top - s0.top), '100,40');
  check('  a psa nenakrmí', POSLANO.length, 0);
  try { localStorage.removeItem('pripZvonekPozice'); } catch {}
  window.matchMedia = puvodniMM;

  OUT.push('\\n11) Vysvobodit sekačku');
  const T = Date.now();
  check('nenastavená sekačka řádek nemá', radek('sekacka'), null);
  sekackaData = { ...sekackaData, zapnuto: true, online: true, offlineOd: 0 };
  renderAutomation('on');
  pripData = { sekacka: { zapnuto: true, hotovo: 0 }, trava: { hotovo: Date.now() } };
  renderPripominky();
  check('s nastavenou sekačkou řádek je', !!radek('sekacka'), 'true');
  check('  s přepínačem', !!radek('sekacka').querySelector('.prip-prepinac'), 'true');
  check('na příjmu nesvítí', sviti('sekacka', pripData.sekacka, T), 'false');
  check('  a řekne to', pripominkaStav(def('sekacka'), pripData.sekacka, T).text, 'Sekačka je na příjmu');
  sekackaData.offlineOd = T - 30 * MIN;
  const pul = pripominkaStav(def('sekacka'), pripData.sekacka, T);
  check('30 min bez příjmu ještě nesvítí', pul.sviti, 'false');
  check('  a odpočítává, kdy se rozsvítí', pul.dalsi, T + 30 * MIN);
  sekackaData.offlineOd = T - 61 * MIN;
  const zvonekPred = pripSviticich(T);
  check('hodinu bez příjmu svítí', sviti('sekacka', pripData.sekacka, T), 'true');
  check('  s časem, od kdy mlčí', /^Není na příjmu od \\d+:\\d\\d$/.test(pripominkaStav(def('sekacka'), pripData.sekacka, T).text), 'true');
  renderPripominky(T);
  check('  a řádek svítí', radek('sekacka').classList.contains('sviti'), 'true');
  check('  i ve zvonečku', pripSviticich(T) >= 1, 'true');
  check('vypnutý přepínač nesvítí', sviti('sekacka', { zapnuto: false, hotovo: 0 }, T), 'false');
  check('odťuknuto během odmlky nesvítí', sviti('sekacka', { zapnuto: true, hotovo: T - 5 * MIN }, T), 'false');
  check('  ale odťuknutí z dřívější odmlky neplatí', sviti('sekacka', { zapnuto: true, hotovo: T - 2 * H }, T), 'true');
  // Zima: server přepínač vypne (zimaVypnulo), řádek zůstane vidět s vypnutým přepínačem
  renderAutomation('winter');
  pripData = { sekacka: { zapnuto: false, zimaVypnulo: true, hotovo: 0 }, trava: { zapnuto: false, zimaVypnulo: true, hotovo: 0 } };
  renderPripominky(T);
  check('v zimě řádek sekačky zůstane', !!radek('sekacka'), 'true');
  check('  s vypnutým přepínačem', radek('sekacka').querySelector('.prip-prepinac').classList.contains('on'), 'false');
  check('  a nesvítí', radek('sekacka').classList.contains('sviti'), 'false');
  check('  ani ve zvonečku', pripSviticich(T), zvonekPred - 1);
  check('tráva taky vypnutá, ale vidět', !!radek('trava') && !radek('trava').querySelector('.prip-prepinac').classList.contains('on'), 'true');
  renderAutomation('on');

  OUT.push('\\n12) Posekat trávu (po 10 dnech)');
  check('bez odťuknutí svítí', sviti('trava', { zapnuto: true, hotovo: 0 }, T), 'true');
  check('po 9 dnech ještě ne', sviti('trava', { zapnuto: true, hotovo: T - 9 * DEN }, T), 'false');
  // Termín je půlnoc desátého dne — odpočet ukazuje zbytek dnešního dne (v hodinách)
  check('  a odpočítává do půlnoci', /^za \\d+ h$/.test(pripOdpocet(pripominkaStav(def('trava'), { zapnuto: true, hotovo: T - 9 * DEN }, T).dalsi - T)), 'true');
  check('po 10 dnech svítí', sviti('trava', { zapnuto: true, hotovo: T - 10 * DEN }, T), 'true');
  check('  s textem o dnech', pripominkaStav(def('trava'), { zapnuto: true, hotovo: T - 12 * DEN }, T).naposledy,
    // Datum podle dnešku — natvrdo zapsané přestalo sedět, jakmile ten den minul
    'Naposledy ' + new Date(T - 12 * DEN).getDate() + '. ' + (new Date(T - 12 * DEN).getMonth() + 1) + '. (před 12 dny)');
  check('vypnutá nesvítí', sviti('trava', { zapnuto: false, hotovo: 0 }, T), 'false');
  sekackaData = { ...sekackaData, zapnuto: false, offlineOd: 0 };
  renderPripominky();

  OUT.push('\\n7) Dětský režim');
  pouzijRezim('miky');
  check('dítě stránku vidí', document.getElementById('pripominkySlide').hidden, 'false');
  check('  i v záložkách', Array.from(document.querySelectorAll('#pageTabs .page-tab')).some(t => t.textContent === 'Připomínky'), 'true');
  pouzijRezim('full');
 } catch (e) { OUT.push('CHYBA výjimka: ' + e.message); }

  const bad = OUT.filter(l => l.startsWith('CHYBA')).length;
  OUT.push('\\n' + (bad === 0 ? 'VŠE PROŠLO' : 'SELHALO — ' + bad + ' chyb'));
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = OUT.join('\\n');
  document.body.appendChild(pre);
})();
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'pripominky.html');
fs.writeFileSync(out, v);
console.log(out);
