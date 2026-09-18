// Stránka Úklid: sekačka Anthbot.
//
// Tři věci, kvůli kterým tahle sada existuje:
//  * Appka na sekačku nevidí přímo — všechno jde přes cloud Anthbotu. Když se
//    neozve, musí tlačítka zhasnout, jinak člověk mačká do prázdna.
//  * Chybový kód od sekačky a problém se spojením jsou dvě různé věci a nesmí
//    se na stránce slít do jedné.
//  * Horní box má zůstat krátký. Každé číslo navíc se čte na úkor těch
//    čtyř, na která se člověk dívá doopravdy.
//  * Tvar bodů, které sekačka posílá, není nikde popsaný. Když se netrefí,
//    musí to mapa přiznat — nakreslená čára ze špatně přečtených čísel by
//    vypadala jako mapa a nešlo by poznat, že je to nesmysl.
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
  // Čtverec 10 × 10 s useknutým rohem, ať je poznat, kam která strana patří
  const OBRYS = [[0, 0], [10, 0], [10, 6], [6, 10], [0, 10]];
  const SYROVE = {
    elec: { value: 87 }, mode: { value: 'globalmowing' }, error: { value: 0 },
    map: { map_area: 297 }, region_area: { points: OBRYS },
    curpath: [[1, 1], [9, 9]], volume: 60
  };
  const zive = extra => renderSekacka(Object.assign({
    zapnuto: true, kdy: Date.now(), potiz: null,
    stav: 'globalmowing', popis: 'seká', baterie: 87, chyba: 0, vyska: 45,
    plochaCelkem: 900, minutyCelkem: 120, online: true, travnik: 297,
    syrove: SYROVE
  }, extra || {}));

  const stavEl = document.getElementById('sekStav');
  const batEl = document.getElementById('sekBaterie');
  const metaEl = document.getElementById('sekMeta');
  const svetlo = document.getElementById('sekLight');
  const sekat = document.getElementById('sekSekatBtn');
  const stop = document.getElementById('sekStopBtn');
  const dok = document.getElementById('sekDokBtn');
  const mapaBtn = document.getElementById('sekMapaBtn');
  const mapaBack = document.getElementById('sekMapaBack');
  const platno = document.getElementById('sekMapaPlatno');
  const potizEl = document.getElementById('sekMapaPotiz');

  R.push('1) Bez nastavení');
  renderSekacka({ zapnuto: false, kdy: 0, potiz: null, syrove: null });
  check('stav to přizná', stavEl.textContent, 'nenastavená');
  check('tlačítka nejdou', [sekat, stop, dok].every(b => b.disabled), true);
  check('řekne se, co chybí', metaEl.textContent.includes('Renderu'), true);
  check('baterie je prázdná', batEl.textContent, '– %');
  check('karta se syrovým hlášením je pryč', document.getElementById('sekSyrove'), 'null');

  R.push('\\n2) Sekačka seká');
  zive();
  check('stav je česky', stavEl.textContent, 'seká');
  check('kontrolka svítí zeleně', svetlo.classList.contains('on'), true);
  check('  a není červená', svetlo.classList.contains('off'), false);
  check('baterie v procentech', batEl.textContent, '87 %');
  check('tlačítka jdou mačkat', [sekat, stop, dok].every(b => b.disabled), false);
  check('výška sečení je vidět', metaEl.textContent.includes('45 mm'), true);
  check('  i trávník', metaEl.textContent.includes('Trávník: 297 m²'), true);
  check('  i celkem', metaEl.textContent.includes('900 m²'), true);
  check('  i kdy to přišlo', metaEl.textContent.includes('Naposledy'), true);
  // Box má být krátký. Tohle všechno se z něj vyhodilo schválně — kdyby se to
  // vrátilo zadem, sada si toho všimne.
  const VYHOZENE = ['Zahrada', 'RTK', 'Síť', 'Firmware', 'Aktivní zóny', 'Koš', 'Tenhle záběr', 'Událost'];
  check('nic navíc tam není',
    VYHOZENE.filter(t => metaEl.textContent.includes(t)).join(', ') || 'nic', 'nic');
  check('řádky jsou právě čtyři', metaEl.querySelectorAll('div').length, 4);
  // Prázdná pole se nemají ukazovat jako pomlčky — radši ať řádek není
  zive({ travnik: null, plochaCelkem: null });
  check('bez dat žádný prázdný řádek', metaEl.textContent.includes('Trávník'), false);
  check('  ani celkem', metaEl.textContent.includes('Celkem'), false);
  check('  a karta nespadne', stavEl.textContent, 'seká');

  R.push('\\n3) V doku a s chybou');
  zive({ stav: 'charge', popis: 'nabíjí se' });
  check('nabíjení se ukáže', stavEl.textContent, 'nabíjí se');
  // Nabíjení není jízda — kontrolka nemá svítit, jako by sekačka jela
  check('kontrolka nesvítí zeleně', svetlo.classList.contains('on'), false);
  zive({ stav: 'charge', popis: 'nabíjí se', chyba: 12 });
  check('chybový kód se ukáže', metaEl.textContent.includes('Chyba č. 12'), true);
  check('  a kontrolka zčervená', svetlo.classList.contains('off'), true);

  R.push('\\n4) Sekačka není na příjmu');
  // Cloud odpoví i o vypnuté sekačce — jen vydá poslední známý stav.
  // Kdyby to appka neřekla, ukazovala by stará čísla jako aktuální.
  zive({ online: false, stav: 'shutdown', popis: 'vypnutá', baterie: 57, chyba: 2133 });
  check('stav to přizná', stavEl.textContent, 'offline');
  check('kontrolka je červená', svetlo.classList.contains('off'), true);
  check('  a nesvítí zeleně', svetlo.classList.contains('on'), false);
  check('řekne se, že jsou hodnoty staré', metaEl.textContent.includes('poslední známé'), true);
  check('  ale pořád jsou vidět', batEl.textContent, '57 %');
  check('chybový kód se ukáže', metaEl.textContent.includes('Chyba č. 2133'), true);
  // Povel by se schoval do fronty a sekačka by ho provedla, až se probudí —
  // klidně ve tři ráno. To je horší než nic.
  check('tlačítka zhasnou', [sekat, stop, dok].every(b => b.disabled), true);
  POSLANO.length = 0;
  sekat.click();
  await pockej();
  check('klik nic nepošle', POSLANO.length, 0);
  check('a vysvětlí se proč', document.getElementById('sekHint').textContent.includes('fronty'), true);
  // Nejčastější případ: sekačka jela a spojení se ztratilo. Poslední známý
  // stav je „seká" — kontrolka ale nesmí tvrdit, že jede právě teď.
  zive({ online: false, stav: 'globalmowing', popis: 'seká' });
  check('poslední stav byl jízda, ale kontrolka nesvítí', svetlo.classList.contains('on'), false);
  check('  a stav pořád říká offline', stavEl.textContent, 'offline');
  zive({ online: true, stav: 'globalmowing', popis: 'seká', baterie: 87, chyba: 0 });
  check('když se probudí, tlačítka ožijí', [sekat, stop, dok].every(b => b.disabled), false);
  check('  a stav je zase režim', stavEl.textContent, 'seká');

  R.push('\\n5) Cloud se neozývá');
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

  R.push('\\n6) Povely');
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

  R.push('\\n7) Mapa');
  zive();
  check('mapa je zavřená', mapaBack.hidden, true);
  mapaBtn.click();
  check('proklik ji otevře', mapaBack.hidden, false);
  check('  a plátno je vidět', platno.hidden, false);
  check('  bez hlášky o potížích', potizEl.textContent, '');
  check('popisek říká, jak velký je trávník',
    document.getElementById('sekMapaPopis').textContent.includes('297 m²'), true);

  // Prázdné plátno by prošlo jako mapa. Tohle je jediná kontrola, která pozná,
  // že se doopravdy něco nakreslilo.
  const ctx = platno.getContext('2d');
  const px = ctx.getImageData(0, 0, platno.width, platno.height).data;
  let barevnych = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]) barevnych++;
  check('doopravdy se kreslilo', barevnych > 100, true);

  const m = sekackaKresliMapu();
  check('obrys má všechny body', m.obrys.length, OBRYS.length);
  check('žádný bod mimo plátno',
    m.obrys.every(p => p.x >= 0 && p.x <= m.w && p.y >= 0 && p.y <= m.h), true);
  // Sekačka měří nahoru, plátno dolů. Bez překlopení by byla zahrada vzhůru nohama.
  check('Y je překlopené', m.obrys[0].y > m.obrys[2].y, true);
  check('  a X ne', m.obrys[0].x < m.obrys[1].x, true);
  check('mapa se vejde na šířku', Math.round(Math.max(...m.obrys.map(p => p.x)) <= m.w), 1);

  document.getElementById('sekMapaZavri').click();
  check('křížek zavírá', mapaBack.hidden, true);
  mapaBtn.click();
  mapaBack.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  check('klepnutí vedle taky', mapaBack.hidden, true);

  R.push('\\n7b) Když se mapa poskládat nedá');
  zive({ syrove: { region_area: { points: 'nesmysl' }, elec: { value: 87 } } });
  mapaBtn.click();
  check('plátno se schová', platno.hidden, true);
  check('a řekne se to narovinu', potizEl.textContent.includes('poskládat neumím'), true);
  check('  s výpisem, co ve stínu je', potizEl.textContent.includes('region_area'), true);
  check('  a odkazem na celé hlášení',
    potizEl.querySelector('a').getAttribute('href'), '/api/sekacka/syrove');
  document.getElementById('sekMapaZavri').click();

  R.push('\\n7c) Čtení bodů');
  check('pole dvojic', JSON.stringify(sekackaBody([[1, 2], [3, 4]])), '[{"x":1,"y":2},{"x":3,"y":4}]');
  check('pole objektů', JSON.stringify(sekackaBody([{ x: 1, y: 2 }])), '[{"x":1,"y":2}]');
  check('  i pod jinými jmény', JSON.stringify(sekackaBody([{ lon: 1, lat: 2 }])), '[{"x":1,"y":2}]');
  check('plochý seznam po dvojicích',
    JSON.stringify(sekackaBody([1, 2, 3, 4])), '[{"x":1,"y":2},{"x":3,"y":4}]');
  check('  a lichý zbytek se zahodí', sekackaBody([1, 2, 3]).length, 1);
  check('zabalené v textu', JSON.stringify(sekackaBody('[[1,2]]')), '[{"x":1,"y":2}]');
  check('zabalené ve value', JSON.stringify(sekackaBody({ value: [[1, 2]] })), '[{"x":1,"y":2}]');
  check('v points', JSON.stringify(sekackaBody({ points: [[1, 2]] })), '[{"x":1,"y":2}]');
  // Radši nic než dohadovat se s daty, kterým nerozumím
  check('rozbitý text je prázdno', sekackaBody('{a').length, 0);
  check('slova jsou prázdno', sekackaBody(['a', 'b']).length, 0);
  check('prázdno je prázdno', sekackaBody(null).length, 0);
  check('objekt bez bodů je prázdno', sekackaBody({ a: 1 }).length, 0);
  check('body bez čísel se zahodí', sekackaBody([{ x: 1 }, { x: 2, y: 3 }]).length, 1);

  R.push('\\n8) Stránka je v menu');
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
