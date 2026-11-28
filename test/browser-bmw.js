// BMW v kartě termínů: připojení přes Client ID, kód k potvrzení, živá data
// (dojezd, nádrž, km, zámek, servis, pneu) a že rozepsané Client ID nepřepíše stream.
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DRIVER = `
const R = [];
const check = (jmeno, got, want) => {
  const ok = String(got) === String(want);
  R.push((ok ? '  OK   ' : 'CHYBA  ') + jmeno.padEnd(50) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
};
let poslano = [];
let odpoved = null;
window.fetch = async (url, init) => {
  poslano.push({ url: String(url), telo: init && init.body ? JSON.parse(init.body) : null });
  const o = odpoved || { status: 200, data: { ok: true } };
  return { ok: o.status === 200, status: o.status, json: async () => o.data };
};
setTimeout(async () => {
 try {
  const pockej = () => new Promise(r => setTimeout(r, 30));
  terminyData = { karty: [{ id: 'bmw4', nazev: 'BMW 4 Gran Coupé', ikona: '🚗', udaje: '', terminy: [] },
    { id: 'vw', nazev: 'VW Multivan', ikona: '🚐', udaje: '', terminy: [] }] };
  bmwData = { pripojeno: false, stav: null, cekani: null, chyba: null, stream: false, model: null };
  renderTerminy();
  renderBmw(bmwData);
  const blok = () => document.getElementById('bmwBlok');
  check('karta na Wallboxu s fotkou, v Termínech nic', !!blok().closest('.slide[data-title="Auta/Wallbox"]') + ' ' + document.querySelectorAll('.bmw-blok').length
    + ' ' + document.querySelector('#bmwKarta img.bmw-foto').getAttribute('src'), 'true 1 /bmw.jpg');
  check('nepřipojeno: pole na Client ID', !!document.getElementById('bmwClientId'), true);
  blok().querySelector('.bmw-tl.hlavni').click();
  await pockej();
  check('  prázdné → hláška, nic se nepošle', poslano.length + ' ' + /Vlož Client ID/.test(blok().textContent), '0 true');
  document.getElementById('bmwClientId').value = ' abcd1234-0000 ';
  odpoved = { status: 200, data: { ok: true, bmw: { pripojeno: false, cekani: { userCode: 'QW-ER', url: 'https://bmw.example/x', doKdy: 1 } } } };
  blok().querySelector('.bmw-tl.hlavni').click();
  await pockej();
  check('  pošle oříznuté Client ID', poslano[0].url + ' ' + poslano[0].telo.clientId, '/api/bmw/pripojit abcd1234-0000');
  check('  ukáže kód a odkaz', blok().querySelector('.bmw-kod').textContent + ' ' + blok().querySelector('a').href, 'QW-ER https://bmw.example/x');

  R.push('\\n2) Data');
  renderBmw({ pripojeno: true, stream: true, model: '420d Gran Coupé', chyba: null, cekani: null, stav: {
    dojezdKm: 612, palivoPct: 68, palivoL: 40, km: 98412, zamek: 'zamčeno', otevreno: [], servisKm: 8400,
    servis: [{ typ: 'OIL', stav: 'OK', datum: '2027-08-01', km: null }], pneu: { lp: 2.5, pp: 2.5, lz: 2.7, pz: null }, kdy: Date.now() } });
  const t = blok().textContent;
  const dl = () => [...blok().querySelectorAll('.auto-dl')].map(x => x.textContent.replace(/\\u00a0/g, ' ')).join(' | ');
  const rad = () => [...blok().querySelectorAll('.auto-radek')].map(x => x.textContent.replace(/\\u00a0/g, ' '));
  check('dlaždice: dojezd, nádrž, km', dl(), 'Dojezd612 km | Nádrž68 %40 l | Najeto98 412 km');
  check('  vedle sebe, stejně široké', (() => { const r = [...blok().querySelectorAll('.auto-dl')].map(x => x.getBoundingClientRect());
    return Math.abs(r[0].top - r[2].top) < 2 && Math.abs(r[0].width - r[2].width) < 2; })(), true);
  check('zámek', rad()[0] + ' ' + blok().querySelector('.auto-radek').classList.contains('pozor'), 'Zámek🔒 zamčeno · vše zavřené false');
  check('servis česky, každá položka zvlášť', rad()[1], 'ServisServis za 8 400 km\\nOlej do 1. 8. 2027');
  check('pneu', rad()[2], 'Pneuvpředu 2,5 / 2,5 · vzadu 2,7 / – bar');
  const popisy = [...blok().querySelectorAll('.auto-radek-hodnota')].map(x => Math.round(x.getBoundingClientRect().left));
  check('  hodnoty zarovnané pod sebou', new Set(popisy).size, 1);
  check('živě a tlačítko Odpojit v patičce', /auto hlásilo .* · živě/.test(blok().querySelector('.auto-meta').textContent) + ' ' + blok().querySelector('.auto-pata button').textContent, 'true Odpojit');
  renderBmw({ ...bmwData, stav: { ...bmwData.stav, servis: [{ typ: 'OIL', km: 8400 }, { typ: 'BRAKE_FLUID', datum: '2028-01-01' }] } });
  check('stejné km u oleje → obecný servis se neopakuje', rad()[1], 'ServisOlej za 8 400 km\\nBrzdová kapalina do 1. 1. 2028');
  renderBmw({ ...bmwData, stav: { ...bmwData.stav, zamek: 'odemčeno', otevreno: ['okno řidič'] } });
  check('odemčené a otevřené okno červeně', rad()[0] + ' ' + blok().querySelector('.auto-radek').classList.contains('pozor'), 'Zámek🔓 odemčeno · otevřené: okno řidič true');
  renderBmw({ pripojeno: true, stream: false, stav: null, chyba: 'přihlášení k BMW vypršelo — připoj auto znovu.' });
  check('bez dat a s chybou', /čekám na první data/.test(blok().textContent) + ' ' + /stream odpojený/.test(blok().textContent) + ' ' + /vypršelo/.test(blok().textContent), 'true true true');
  check('nic nepřetéká', blok().scrollWidth <= blok().clientWidth + 1, true);

  R.push('\\n2b) Co auto posílá');
  const pk = document.getElementById('bmwPoleKarta');
  check('karta v Log/Nastavení', !!pk.closest('.slide[data-title="Log/Nastavení"]'), true);
  odpoved = { status: 200, data: { popisovace: [{ nazev: 'vehicle.drivetrain.fuelSystem.level', typ: 'číslo', u: '%', n: 3, t: Date.now() }] } };
  poslano = [];
  document.getElementById('bmwPoleNacist').click();
  await pockej();
  check('  načte a ukáže', poslano[0].url + ' | ' + /^vehicle\\.drivetrain\\.fuelSystem\\.level číslo % · 3× · \\d/.test(document.getElementById('bmwPoleSeznam').textContent), '/api/bmw/popisovace | true');
  check('  jde zkopírovat', document.getElementById('bmwPoleKopirovat').disabled + ' ' + document.getElementById('bmwPoleHint').textContent, 'false 1 polí.');
  odpoved = { status: 200, data: { popisovace: [] } };
  document.getElementById('bmwPoleNacist').click();
  await pockej();
  check('  prázdné → vysvětlí', document.getElementById('bmwPoleHint').textContent + ' ' + document.getElementById('bmwPoleKopirovat').disabled, 'Zatím nic — auto ještě nic neposlalo. true');

  R.push('\\n3) Rozepsané Client ID');
  renderBmw({ pripojeno: false });
  const inp = document.getElementById('bmwClientId');
  inp.focus(); inp.value = 'rozepsane';
  renderBmw({ pripojeno: false, chyba: 'něco' });
  check('příchozí stav ho nesmaže', document.getElementById('bmwClientId').value, 'rozepsane');
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (bmw)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'bmw.html');
fs.writeFileSync(out, v);
console.log(out);
