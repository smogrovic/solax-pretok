// Stránka Závlaha v prohlížeči.
//
// Tři věci, kvůli kterým tahle sada existuje:
//  * Appka na ovladač nevidí. Když most na NASu mlčí, nesmí stránka vypadat
//    normálně — tlačítka musí zhasnout, jinak člověk mačká do prázdna a diví se,
//    proč voda neteče.
//  * Zóny se kreslí podle toho, co hlásí most. Kdyby se seznam vzal odjinud,
//    ukazovala by appka zóny, které v ovladači nejsou.
//  * Puštění zóny musí odejít na správnou adresu se správným počtem minut.
//    Překlep v čísle by zalil zahradu dvě hodiny místo deseti minut.
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
  return { ok: true, status: 200, json: async () => ({ success: true, nazvy: { 1: 'Trávník dole' } }) };
};
let POTVRZENO = true;
window.confirm = () => POTVRZENO;
let ZADANO = 'Nové jméno';
window.prompt = () => ZADANO;

// Kliky spouštějí async obsluhu — mezi klepnutím a odeslaným fetchem se musí
// nechat doběhnout smyčka událostí, jinak by sada měřila prázdno.
const pockej = () => new Promise(r => setTimeout(r, 20));
setTimeout(async () => {
 try {
  const ZONY = [1, 2, 3, 4, 5, 6, 7, 8];
  const NAZVY = { 1: 'Trávník dole', 2: 'Trávník nahoře A', 7: 'Dopouštění retenčky' };
  const zive = extra => renderZavlaha(Object.assign({
    zive: true, kdy: Date.now(), ceka: 0, minutMax: 120, nazvy: NAZVY,
    stav: { model: 'ESP-TM2', zony: ZONY, bezi: [], zavlazuje: true, destak: false, odklad: 0 }
  }, extra || {}));

  const radky = () => [...document.getElementById('zavlahaZony').querySelectorAll('.zavlaha-radek')];
  const jmena = () => radky().map(r => r.querySelector('.zavlaha-jmeno').textContent);
  const stavEl = document.getElementById('zavlahaStav');
  const metaEl = document.getElementById('zavlahaMeta');
  const svetlo = document.getElementById('zavlahaLight');
  const stopBtn = document.getElementById('zavlahaStopBtn');
  const minutEl = document.getElementById('zavlahaMinut');

  R.push('1) Bez mostu se nedá nic zmáčknout');
  renderZavlaha({ zive: false, kdy: 0, stav: null, nazvy: {}, ceka: 0, minutMax: 120 });
  check('stav to přizná', stavEl.textContent, 'most se neozývá');
  check('kontrolka je červená', svetlo.classList.contains('off'), true);
  check('zastavení nejde zmáčknout', stopBtn.disabled, true);
  check('minuty nejdou přepnout', minutEl.disabled, true);
  check('žádné zóny se nekreslí', radky().length, 0);
  check('řekne se, kde most běží',
    document.getElementById('zavlahaHint').textContent.includes('zavlaha-most.js'), true);
  // Výběr minut se plní jednou; jaký byl na začátku, se pozná jen teď
  const VYCHOZI_MINUTY = minutEl.value;

  R.push('\\n2) Zóny se berou z hlášení mostu');
  zive();
  check('kreslí se osm zón', radky().length, 8);
  check('pojmenovaná zóna má jméno', jmena()[0], 'Trávník dole');
  check('  i ta sedmá', jmena()[6], 'Dopouštění retenčky');
  // Zóna, kterou nikdo nepojmenoval, se nesmí vydávat za jinou
  check('nepojmenovaná je Zóna N', jmena()[2], 'Zóna 3');
  check('osmá taky', jmena()[7], 'Zóna 8');
  check('kontrolka není červená', svetlo.classList.contains('off'), false);
  check('stav říká, že nic neběží', stavEl.textContent, 'nic neběží');
  check('meta zná ovladač', metaEl.textContent.includes('ESP-TM2'), true);
  check('  i počet zón', metaEl.textContent.includes('zón 8'), true);
  check('  i čidlo', metaEl.textContent.includes('dešťové čidlo suché'), true);
  check('tlačítka jdou mačkat', radky()[0].querySelector('.zavlaha-pustit').disabled, false);

  // Most se může ztratit až potom, co jednou nahlásil. Zóny pak zůstanou
  // vykreslené — a právě tehdy nesmí jít zmáčknout, jinak povel spadne do prázdna.
  R.push('\\n2b) Most ztichl, zóny zůstaly');
  zive({ zive: false, kdy: Date.now() - 600000 });
  check('zóny se pořád kreslí', radky().length, 8);
  check('ale pustit nejdou', radky().every(r => r.querySelector('.zavlaha-pustit').disabled), true);
  check('ani zastavit', stopBtn.disabled, true);
  check('stav to přizná', stavEl.textContent, 'most se neozývá');
  check('a řekne se odkdy', metaEl.textContent.includes('mlčí od'), true);
  POSLANO.length = 0;
  radky()[0].querySelector('.zavlaha-pustit').click();
  await pockej();
  check('klik na zhaslé tlačítko nic nepošle', POSLANO.length, 0);

  R.push('\\n3) Běžící zóna je vidět');
  zive({ stav: { model: 'ESP-TM2', zony: ZONY, bezi: [3], zavlazuje: true, destak: true, odklad: 2 } });
  check('stav ukazuje běžící zónu', stavEl.textContent, 'Zóna 3');
  check('kontrolka svítí zeleně', svetlo.classList.contains('on'), true);
  check('řádek je označený', radky()[2].classList.contains('bezi'), true);
  check('  a sousední ne', radky()[1].classList.contains('bezi'), false);
  check('tlačítko říká běží', radky()[2].querySelector('.zavlaha-pustit').textContent, 'běží');
  check('déšť je vidět', metaEl.textContent.includes('hlásí déšť'), true);
  check('odklad je vidět', metaEl.textContent.includes('Odklad kvůli dešti: 2 dnů'), true);
  // Dvě zóny naráz umí ovladač taky — musí být vidět obě
  zive({ stav: { model: 'ESP-TM2', zony: ZONY, bezi: [1, 2], zavlazuje: true, destak: false, odklad: 0 } });
  check('dvě běžící zóny se vypíšou', stavEl.textContent, 'Trávník dole, Trávník nahoře A');

  R.push('\\n4) Puštění zóny');
  zive();
  POSLANO.length = 0;
  minutEl.value = '20';
  radky()[3].querySelector('.zavlaha-pustit').click();
  await pockej();
  check('jde to na správnou adresu', POSLANO[0].url, '/api/zavlaha/spust');
  check('se správnou zónou', POSLANO[0].telo.zona, 4);
  check('  a správnými minutami', POSLANO[0].telo.minut, 20);
  check('  a s klíčem od zámku', POSLANO[0].token !== undefined, true);

  // Zahrada se nemá rozjet jen proto, že někdo omylem ťukl do seznamu
  POTVRZENO = false;
  POSLANO.length = 0;
  radky()[0].querySelector('.zavlaha-pustit').click();
  await pockej();
  check('bez potvrzení se nic nepošle', POSLANO.length, 0);
  POTVRZENO = true;

  R.push('\\n5) Zastavení');
  POSLANO.length = 0;
  stopBtn.click();
  await pockej();
  check('jde to na zastavení', POSLANO[0].url, '/api/zavlaha/stop');
  POTVRZENO = false;
  POSLANO.length = 0;
  stopBtn.click();
  await pockej();
  check('bez potvrzení se nezastavuje', POSLANO.length, 0);
  POTVRZENO = true;

  R.push('\\n6) Přejmenování zóny');
  POSLANO.length = 0;
  ZADANO = 'Záhon u plotu';
  radky()[7].querySelector('.zavlaha-jmeno').click();
  await pockej();
  check('jde to na jména', POSLANO[0].url, '/api/zavlaha/nazvy');
  check('  se zónou jako klíčem', Object.keys(POSLANO[0].telo.nazvy)[0], '8');
  check('  a novým jménem', POSLANO[0].telo.nazvy['8'], 'Záhon u plotu');
  // Zrušené okénko nesmí zónu přejmenovat na prázdno
  POSLANO.length = 0;
  ZADANO = null;
  radky()[7].querySelector('.zavlaha-jmeno').click();
  await pockej();
  check('zrušené okénko nic nepošle', POSLANO.length, 0);
  ZADANO = 'Nové jméno';

  R.push('\\n7) Výběr minut');
  const volby = [...minutEl.options].map(o => Number(o.value));
  check('minuty jsou na výběr', volby.length > 3, true);
  check('výchozí je deset', Number(VYCHOZI_MINUTY), 10);
  check('nic přes mez', volby.every(m => m <= 120), true);
  check('nejkratší je minuta', Math.min(...volby), 1);

  R.push('\\n8) Stránka je v menu');
  const tituly = [...document.querySelectorAll('.slide')].map(s => s.dataset.title);
  check('Závlaha je mezi stránkami', tituly.includes('Závlaha'), true);
  const zavlahaSlide = [...document.querySelectorAll('.slide')].find(s => s.dataset.title === 'Závlaha');
  check('  a má zámek jako ostatní', !!zavlahaSlide.querySelector('.lock-panel'), true);
  check('  a zamykatelnou kartu', !!zavlahaSlide.querySelector('.card.lockable'), true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const ok = R.filter(r => r.startsWith('  OK')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + ok + ' ok, ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + ok + ' ok, 0 chyb (závlaha)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'zavlaha.html');
fs.writeFileSync(out, v);
console.log(out);
