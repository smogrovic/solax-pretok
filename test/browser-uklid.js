// Stránka Úklid: sekačka Anthbot.
//
// Tři věci, kvůli kterým tahle sada existuje:
//  * Appka na sekačku nevidí přímo — všechno jde přes cloud Anthbotu. Když se
//    neozve, musí tlačítka zhasnout, jinak člověk mačká do prázdna.
//  * Chybový kód od sekačky a problém se spojením jsou dvě různé věci a nesmí
//    se na stránce slít do jedné.
//  * Jména polí u M5 nejsou nikde popsaná, takže se syrové hlášení vypisuje.
//    Kdyby přestalo, nebylo by podle čeho appku dolaďovat.
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
  POSLANO.push({ url: String(url), telo: opts && opts.body ? JSON.parse(opts.body) : null,
                 token: opts && opts.headers ? opts.headers['X-Auth-Token'] : undefined });
  return { ok: true, status: 200, json: async () => ({ success: true }) };
};
let POTVRZENO = true;
window.confirm = () => POTVRZENO;
const pockej = () => new Promise(r => setTimeout(r, 20));

setTimeout(async () => {
 try {
  const SYROVE = {
    elec: { value: 87 }, robot_sta: { value: 'globalmowing' }, error: { value: 0 },
    param_set: { cutter_height: 45 }, mowing_area_new: { value: 120 }, volume: 60
  };
  const zive = extra => renderSekacka(Object.assign({
    zapnuto: true, kdy: Date.now(), potiz: null, jmeno: 'Zahrada', model: '5',
    stav: 'globalmowing', popis: 'seká', baterie: 87, chyba: 0, vyska: 45,
    plocha: 120, minuty: 18, plochaCelkem: 900, minutyCelkem: 120, rtk: 4,
    syrove: SYROVE
  }, extra || {}));

  const stavEl = document.getElementById('sekStav');
  const batEl = document.getElementById('sekBaterie');
  const metaEl = document.getElementById('sekMeta');
  const svetlo = document.getElementById('sekLight');
  const syroveEl = document.getElementById('sekSyrove');
  const sekat = document.getElementById('sekSekatBtn');
  const stop = document.getElementById('sekStopBtn');
  const dok = document.getElementById('sekDokBtn');
  const radkySyrove = () => [...syroveEl.querySelectorAll('div')].map(d => d.textContent);

  R.push('1) Bez nastavení');
  renderSekacka({ zapnuto: false, kdy: 0, potiz: null, syrove: null });
  check('stav to přizná', stavEl.textContent, 'nenastavená');
  check('tlačítka nejdou', [sekat, stop, dok].every(b => b.disabled), true);
  check('řekne se, co chybí', metaEl.textContent.includes('Renderu'), true);
  check('baterie je prázdná', batEl.textContent, '– %');
  check('syrové hlášení je prázdné', radkySyrove()[0], 'Zatím nic.');

  R.push('\\n2) Sekačka seká');
  zive();
  check('stav je česky', stavEl.textContent, 'seká');
  check('kontrolka svítí zeleně', svetlo.classList.contains('on'), true);
  check('  a není červená', svetlo.classList.contains('off'), false);
  check('baterie v procentech', batEl.textContent, '87 %');
  check('tlačítka jdou mačkat', [sekat, stop, dok].every(b => b.disabled), false);
  check('jméno sekačky je vidět', metaEl.textContent.includes('Zahrada'), true);
  check('výška sečení taky', metaEl.textContent.includes('45 mm'), true);
  check('  i záběr', metaEl.textContent.includes('120 m²'), true);
  check('  i celkem', metaEl.textContent.includes('900 m²'), true);

  R.push('\\n3) V doku a s chybou');
  zive({ stav: 'charge', popis: 'nabíjí se' });
  check('nabíjení se ukáže', stavEl.textContent, 'nabíjí se');
  // Nabíjení není jízda — kontrolka nemá svítit, jako by sekačka jela
  check('kontrolka nesvítí zeleně', svetlo.classList.contains('on'), false);
  zive({ stav: 'charge', popis: 'nabíjí se', chyba: 12 });
  check('chybový kód se ukáže', metaEl.textContent.includes('Chyba č. 12'), true);
  check('  a kontrolka zčervená', svetlo.classList.contains('off'), true);

  R.push('\\n4) Cloud se neozývá');
  zive({ potiz: 'stav: HTTP 500 — rozbité' });
  check('stav to přizná', stavEl.textContent, 'neozývá se');
  check('kontrolka je červená', svetlo.classList.contains('off'), true);
  check('  a řekne se proč', metaEl.textContent.includes('HTTP 500'), true);
  check('tlačítka zhasnou', [sekat, stop, dok].every(b => b.disabled), true);
  check('baterie se neukazuje', batEl.textContent, '– %');
  POSLANO.length = 0;
  sekat.click();
  await pockej();
  check('klik do prázdna nic nepošle', POSLANO.length, 0);

  R.push('\\n5) Povely');
  zive();
  POSLANO.length = 0;
  sekat.click();
  await pockej();
  check('sekat jde na správnou adresu', POSLANO[0].url, '/api/sekacka/povel');
  check('  se správným povelem', POSLANO[0].telo.co, 'sekat');
  check('  a s klíčem od zámku', POSLANO[0].token !== undefined, true);
  POSLANO.length = 0;
  stop.click();
  await pockej();
  check('zastavit posílá stop', POSLANO[0].telo.co, 'stop');
  POSLANO.length = 0;
  dok.click();
  await pockej();
  check('do doku posílá dok', POSLANO[0].telo.co, 'dok');

  // Sekačka se nemá rozjet jen proto, že někdo omylem ťukl do stránky
  POTVRZENO = false;
  POSLANO.length = 0;
  sekat.click();
  await pockej();
  check('bez potvrzení se nic nepošle', POSLANO.length, 0);
  POTVRZENO = true;

  R.push('\\n6) Syrové hlášení');
  zive();
  const radky = radkySyrove();
  check('vypisují se všechna pole', radky.length, Object.keys(SYROVE).length);
  check('  seřazená podle jména', radky[0].startsWith('elec'), true);
  // Tohle je jediný způsob, jak se zjistí, co M5 doopravdy hlásí
  check('  i ta, co appka neumí pojmenovat', radky.some(r => r.startsWith('volume')), true);
  check('vnořená hodnota se vypíše celá', radky.some(r => r.includes('{"cutter_height":45}')), true);

  R.push('\\n7) Stránka je v menu');
  const tituly = [...document.querySelectorAll('.slide')].map(s => s.dataset.title);
  check('Úklid je mezi stránkami', tituly.includes('Úklid'), true);
  const slide = [...document.querySelectorAll('.slide')].find(s => s.dataset.title === 'Úklid');
  check('  a má zámek jako ostatní', !!slide.querySelector('.lock-panel'), true);
  check('  a zamykatelnou kartu', !!slide.querySelector('.card.lockable'), true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const ok = R.filter(r => r.startsWith('  OK')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + ok + ' ok, ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + ok + ' ok, 0 chyb (úklid)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'uklid.html');
fs.writeFileSync(out, v);
console.log(out);
