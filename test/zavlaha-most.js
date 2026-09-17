// Most mezi appkou a závlahou: skript, který trvale běží na NASu.
//
// Tři věci, kvůli kterým tahle sada existuje:
//  * Most je jediná část celé závlahy, která smí sáhnout na ventily. Povel se
//    skládá ručně z hexu a překlep v něm znamená, že se pustí jiná zóna nebo
//    na jinou dobu. Proto se kontroluje bajt po bajtu.
//  * Appce se nevěří naslepo. Kdyby do fronty spadl nesmysl, musí ho most
//    zahodit sám — mezi appkou a ventily není nic jiného.
//  * Když modul mlčí, most NESMÍ appce poslat starý stav. Ta by ho ukazovala
//    jako živý a člověk by si myslel, že zahrada běží, i když neběží.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('most závlahy');

const Z = require('../public/nas/zavlaha-test.js');
// Pauzy mezi dotazy jsou ohleduplnost k modulu, ne správnost — v sadě by jen
// přidaly vteřiny. Že tam jsou, se hlídá čtením zdroje na konci.
Z.pauza = async () => {};
const M = require('../public/nas/zavlaha-most.js');

const HESLO = 'tajneheslo';
const NASTAVENI = { ip: '10.0.0.5', heslo: HESLO, appka: 'https://appka.example', interval: 15 };

// Falešný modul i falešná appka v jednom: podle adresy se pozná, kdo se ptá.
function podstrc({ modul = {}, ukoly = [], appkaPada = false, modulPada = false } = {}) {
  const videno = { modul: [], appka: [] };
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/stick')) {
      if (modulPada) throw new Error('connect EHOSTUNREACH');
      const telo = JSON.parse(Z.desifruj(opts.body, HESLO));
      videno.modul.push(telo.params);
      const hex = modul[telo.params.data];
      if (hex === undefined) throw new Error('falešný modul nezná povel ' + telo.params.data);
      return {
        ok: true, status: 200,
        arrayBuffer: async () => Z.zasifruj(JSON.stringify({ id: telo.id, jsonrpc: '2.0', result: { data: hex } }), HESLO)
      };
    }
    if (appkaPada) throw new Error('getaddrinfo ENOTFOUND');
    videno.appka.push({ url: String(url), telo: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, ukoly }) };
  };
  return videno;
}

const MODUL = {
  '02': '82000A0201', '0300': '8300FF000000', '3F00': 'BF0000000000',
  '48': 'C801', '3E': 'BE01', '36': 'B6000000',
  '3900030A': '0139', '40': '0140'
};

nadpis('1) Spínací povely');

check('spuštění zóny 3 na 10 min', M.povelSpust(3, 10).data, '3900030A');
check('délka povelu jsou 4 bajty', M.povelSpust(3, 10).delka, 4);
check('hex sedí s délkou', M.povelSpust(3, 10).data.length / 2, M.povelSpust(3, 10).delka);
check('čeká se potvrzení', M.povelSpust(3, 10).odpoved, '01');
// Zóna je dvoubajtová, minuty jednobajtové — prohození by pustilo úplně jinou zónu
check('zóna 12 na 1 min', M.povelSpust(12, 1).data, '39000C01');
check('zóna 1 na 120 min', M.povelSpust(1, 120).data, '39000178');
check('zastavení', M.povelStop().data, '40');
check('zastavení je jednobajtové', M.povelStop().delka, 1);
check('i zastavení čeká potvrzení', M.povelStop().odpoved, '01');
check('hex doplňuje zleva nulami', M.hex(10, 4), '000A');
check('hex je velkými písmeny', M.hex(255, 2), 'FF');

nadpis('2) Kontrola úkolu z appky');

check('zastavení projde', M.zkontroluj({ typ: 'stop' }), '');
check('spuštění projde', M.zkontroluj({ typ: 'spust', zona: 3, minut: 10 }), '');
check('neznámý typ neprojde', M.zkontroluj({ typ: 'smaz' }), 'neznámý úkol "smaz"');
check('nic neprojde', M.zkontroluj(null), 'úkol není objekt');
check('zóna 0 neprojde', M.zkontroluj({ typ: 'spust', zona: 0, minut: 5 }), 'zóna mimo rozsah: 0');
check('zóna 33 neprojde', M.zkontroluj({ typ: 'spust', zona: 33, minut: 5 }), 'zóna mimo rozsah: 33');
check('desetinná zóna neprojde', M.zkontroluj({ typ: 'spust', zona: 1.5, minut: 5 }), 'zóna mimo rozsah: 1.5');
check('0 minut neprojde', M.zkontroluj({ typ: 'spust', zona: 1, minut: 0 }), 'minuty mimo rozsah: 0');
check('121 minut neprojde', M.zkontroluj({ typ: 'spust', zona: 1, minut: 121 }), 'minuty mimo rozsah: 121');
check('120 minut ještě projde', M.zkontroluj({ typ: 'spust', zona: 1, minut: 120 }), '');
check('text místo minut neprojde', M.zkontroluj({ typ: 'spust', zona: 1, minut: 'hodně' }), 'minuty mimo rozsah: hodně');

(async () => {
  nadpis('3) Vykonání úkolu');

  let videno = podstrc({ modul: MODUL });
  const hlasky = [];
  const pis = t => hlasky.push(t);

  check('spuštění doputuje k modulu', await M.proved(NASTAVENI, { typ: 'spust', zona: 3, minut: 10 }, pis), true);
  check('a je to ten správný povel', videno.modul[0].data, '3900030A');
  check('s délkou 4', videno.modul[0].length, 4);
  check('řekne se to do logu', hlasky[0], 'zóna 3 puštěná na 10 min');

  videno = podstrc({ modul: MODUL });
  check('zastavení doputuje k modulu', await M.proved(NASTAVENI, { typ: 'stop' }, pis), true);
  check('a je to povel 40', videno.modul[0].data, '40');

  // Tohle je ta hlavní pojistka: nesmysl z appky se k ventilům nedostane
  videno = podstrc({ modul: MODUL });
  check('nesmysl se zahodí', await M.proved(NASTAVENI, { typ: 'spust', zona: 99, minut: 10 }, pis), false);
  check('a k modulu nejde nic', videno.modul.length, 0);
  check('a řekne se proč', hlasky[hlasky.length - 1], 'úkol zahozen — zóna mimo rozsah: 99');

  // Odmítnutý povel se nesmí tvářit jako splněný
  videno = podstrc({ modul: { ...MODUL, '3900030A': '003901' } });
  const odmitnuty = await M.proved(NASTAVENI, { typ: 'spust', zona: 3, minut: 10 }, pis)
    .then(() => '(prošlo)', e => e.message);
  check('odmítnutý povel vyhodí chybu', odmitnuty, 'modul povel 39 odmítl (důvod 01)');

  nadpis('4) Čtení stavu');

  videno = podstrc({ modul: MODUL });
  const pamet = { model: null, zony: [] };
  const stav = await M.zjistiStav(NASTAVENI, pamet);
  check('poprvé se ptá na všechno', videno.modul.map(p => p.data).join(','), '02,0300,3F00,48,3E,36');
  check('model', stav.model, 'ESP-TM2');
  check('osm zón', stav.zony.join(','), '1,2,3,4,5,6,7,8');
  check('nic neběží', stav.bezi.length, 0);
  check('zavlažování zapnuté', stav.zavlazuje, true);
  check('čidlo hlásí déšť', stav.destak, true);
  check('odklad nula', stav.odklad, 0);

  // Model a seznam zón se nemění — ptát se na ně pořád dokola je zbytečné trápení modulu
  videno = podstrc({ modul: MODUL });
  await M.zjistiStav(NASTAVENI, pamet);
  check('podruhé už se na model neptá', videno.modul.map(p => p.data).join(','), '3F00,48,3E,36');

  videno = podstrc({ modul: { ...MODUL, '3F00': 'BF000A000000' } });
  const bezi = await M.zjistiStav(NASTAVENI, pamet);
  check('běžící zóny se přečtou', bezi.bezi.join(','), '2,4');

  nadpis('5) Hlášení appce');

  videno = podstrc({ modul: MODUL, ukoly: [{ typ: 'stop' }] });
  const ukoly = await M.ohlas(NASTAVENI, stav);
  check('jde to na stav appky', videno.appka[0].url, 'https://appka.example/api/zavlaha/stav');
  check('posílá se celý stav', Object.keys(videno.appka[0].telo).sort().join(','),
    'bezi,destak,model,odklad,zavlazuje,zony');
  check('úkoly se přivezou zpátky', JSON.stringify(ukoly), '[{"typ":"stop"}]');

  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const padla = await M.ohlas(NASTAVENI, stav).then(() => '(prošlo)', e => e.message);
  check('chyba appky se pozná', padla, 'appka odpověděla HTTP 502');

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  check('appka bez úkolů vrátí prázdno', (await M.ohlas(NASTAVENI, stav)).length, 0);

  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ukoly: 'nic' }) });
  check('nesmysl místo úkolů vrátí prázdno', (await M.ohlas(NASTAVENI, stav)).length, 0);

  nadpis('6) Celé kolo');

  videno = podstrc({ modul: MODUL, ukoly: [{ typ: 'spust', zona: 3, minut: 10 }] });
  const p2 = { model: null, zony: [] };
  hlasky.length = 0;
  check('kolo doběhne', await M.kolo(NASTAVENI, p2, pis), true);
  check('povel se vykonal', videno.modul.some(p => p.data === '3900030A'), true);
  // Po zásahu se stav čte a hlásí znovu, jinak by appka celý interval ukazovala staré
  check('stav se hlásí dvakrát', videno.appka.length, 2);
  check('druhé hlášení je po povelu',
    videno.modul.filter(p => p.data === '3F00').length, 2);

  videno = podstrc({ modul: MODUL, ukoly: [] });
  check('kolo bez úkolů hlásí jednou', await M.kolo(NASTAVENI, { model: null, zony: [] }, pis) && videno.appka.length, 1);

  // Mlčící modul: appce se nesmí poslat nic, ať si sama pozná, že most nejede
  videno = podstrc({ modulPada: true });
  const p3 = { model: 'ESP-TM2', zony: [1, 2] };
  hlasky.length = 0;
  check('kolo s mrtvým modulem selže', await M.kolo(NASTAVENI, p3, pis), false);
  check('a appce nejde nic', videno.appka.length, 0);
  check('paměť se zahodí', p3.model, null);
  check('a řekne se to', hlasky[0].startsWith('modul neodpověděl:'), true);

  videno = podstrc({ modul: MODUL, appkaPada: true });
  hlasky.length = 0;
  check('kolo s nedostupnou appkou selže', await M.kolo(NASTAVENI, { model: null, zony: [] }, pis), false);
  check('a řekne se to', hlasky[0].startsWith('appka se neozvala:'), true);

  // Jeden špatný úkol nesmí shodit celé kolo ani zbylé úkoly
  videno = podstrc({ modul: MODUL, ukoly: [{ typ: 'spust', zona: 99, minut: 1 }, { typ: 'stop' }] });
  hlasky.length = 0;
  check('kolo přežije zahozený úkol', await M.kolo(NASTAVENI, { model: null, zony: [] }, pis), true);
  check('druhý úkol se přesto udělá', videno.modul.some(p => p.data === '40'), true);

  nadpis('7) Nastavení');

  const docasna = fs.mkdtempSync(path.join(os.tmpdir(), 'most-'));
  const cesta = path.join(docasna, 'zavlaha.config.json');

  fs.writeFileSync(cesta, JSON.stringify({ ip: '10.0.0.5', heslo: 'x' }));
  const zaklad = M.nactiNastaveni(cesta);
  check('appka má výchozí adresu', zaklad.nastaveni.appka, 'https://solax-pretok.onrender.com');
  check('interval má výchozí hodnotu', zaklad.nastaveni.interval, M.INTERVAL_S);
  check('heslo se nese dál', zaklad.nastaveni.heslo, 'x');

  fs.writeFileSync(cesta, JSON.stringify({ ip: '10.0.0.5', heslo: 'x', appka: 'https://jina.example/', interval: 30 }));
  const vlastni = M.nactiNastaveni(cesta);
  check('vlastní adresa projde', vlastni.nastaveni.appka, 'https://jina.example');
  check('lomítko na konci se uřízne', vlastni.nastaveni.appka.endsWith('/'), false);
  check('vlastní interval projde', vlastni.nastaveni.interval, 30);

  // Vteřinový interval by modul utloukl dotazy, tisícivteřinový by byl k ničemu
  fs.writeFileSync(cesta, JSON.stringify({ ip: '10.0.0.5', heslo: 'x', interval: 1 }));
  check('moc krátký interval se nebere', M.nactiNastaveni(cesta).nastaveni.interval, M.INTERVAL_S);
  fs.writeFileSync(cesta, JSON.stringify({ ip: '10.0.0.5', heslo: 'x', interval: 9999 }));
  check('moc dlouhý interval se nebere', M.nactiNastaveni(cesta).nastaveni.interval, M.INTERVAL_S);
  fs.writeFileSync(cesta, JSON.stringify({ ip: '10.0.0.5', heslo: 'x', interval: M.INTERVAL_MIN_S }));
  check('krajní interval projde', M.nactiNastaveni(cesta).nastaveni.interval, M.INTERVAL_MIN_S);

  fs.writeFileSync(cesta, JSON.stringify({ ip: '', heslo: '' }));
  const prazdny = M.nactiNastaveni(cesta);
  check('prázdná konfigurace zastaví most', prazdny.nastaveni, undefined);
  check('a řekne se to', String(prazdny.chyba).includes('chybí'), true);

  const bezKonfigu = await M.hlavni(path.join(docasna, 'nova.json'), () => {});
  check('bez konfigurace most nenaběhne', bezKonfigu, 1);

  fs.rmSync(docasna, { recursive: true, force: true });

  nadpis('8) Ohleduplnost k modulu');

  const ZDROJ = fs.readFileSync(path.join(__dirname, '..', 'public', 'nas', 'zavlaha-most.js'), 'utf8');
  // Modul zvládne jeden dotaz naráz. Bez pauz mezi nimi začne odpovídat chybami.
  check('mezi dotazy na modul se čeká', (ZDROJ.match(/Z\.pauza\(/g) || []).length >= 6, true);
  check('most nemá závislosti', /require\('(?!node:|\.\/zavlaha-test)/.test(ZDROJ), false);
  check('heslo se nikam nevsazuje', /\$\{[^}]*heslo[^}]*\}/.test(ZDROJ), false);
  // Nekonečná smyčka: most se nemá kdy zastavit, DSM ho po skončení nerestartuje
  check('smyčka je nekonečná', ZDROJ.includes('for (;;)'), true);

  konec();
})().catch(err => {
  check('sada doběhla bez výjimky', err.message, '(nic)');
  konec();
});
