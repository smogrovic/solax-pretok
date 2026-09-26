// Stránka Logika automatiky: všechny sekce a krátké odrážky jen o tom, co se děje
const fs = require('fs');
const path = require('path');
const SP = process.env.TEST_OUT || require('os').tmpdir();
let v = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
v = v.replace('</head>', '<style>.slide{display:none!important}'
  + '.slide[data-title="Logika automatiky"]{display:block!important}'
  + '.card.lock-panel{display:none!important}</style></head>');

const DRIVER = `
const OUT = [];
let poslano = null;
window.fetch = async (url, opts) => {
  poslano = { url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};
function check(name, got, want) {
  const ok = String(got) === String(want);
  OUT.push((ok ? '  OK  ' : 'CHYBA ') + name.padEnd(54) + ' → ' + got + (ok ? '' : '   (čekáno ' + want + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
 try {
  await wait(150);
  const page = document.querySelector('.slide[data-title="Logika automatiky"]');
  const sekce = [...page.querySelectorAll('.logic-h')].map(e => e.textContent);
  const li = [...page.querySelectorAll('.logic-list li')];

  OUT.push('\\n1) Obsah a délka');
  // Patnáctá sekce je „Nejsme doma". Rozpočet se zvedá vědomě — stránka se dřív
  // rozrostla do nečitelna, tak ať se to nestane znovu potichu.
  check('sekcí je patnáct', sekce.length, 15);
  for (const s of ['Obecné', 'Zima', 'Bazén (filtrace)', 'Sauna', 'Bojler 1 (TČ)', 'Wallbox',
                   'Ruční zásah vs. automatika', 'Priorita auta', 'Korekce podle předpovědi',
                   'Data, notifikace, časovače', 'Oběhové čerpadlo', 'Rozvrh žaluzií', 'Nejsme doma'])
    check('je tam ' + s, sekce.some(x => x.startsWith(s)), 'true');
  // Po zjednodušení jen to, jak se to chová — žádné zdůvodňování na pozadí
  check('odrážek je nejvýš 50', li.length <= 50, 'true');   // po zjednodušení jich je 45
  const lh = parseFloat(getComputedStyle(li[0]).lineHeight) || 18;
  const dlouhe = li.filter(e => e.getBoundingClientRect().height > lh * 3.4);
  check('žádná odrážka není delší než tři řádky', dlouhe.length, 0);
  for (const e of dlouhe) OUT.push('      ' + e.textContent.slice(0, 80));
  check('nic nepřetéká do stran', page.scrollWidth <= page.clientWidth + 1, 'true');
  const txt = li.map(e => e.textContent).join(' ');
  check('sauna má natvrdo práh a dobu', /nad 500 W/.test(txt) && /30 min po posledním nátopu/.test(txt), 'true');
  check('nastavení sauny už na stránce není', !!document.getElementById('saunaLimitInput'), 'false');
  check('nejsme doma drží vypnutou saunu i čerpadlo', /drží vypnutá světla/.test(txt) && /čerpadlo/.test(txt), 'true');
  // Tlačítko na Asistentovi dělá víc věcí naráz — ať se nemusí hádat které
  check('  i co udělá tlačítko Zapni saunu', /žaluzie v ložnici/.test(txt), 'true');
  check('  včetně zahrady po západu', /zahradu dole/.test(txt) && /ve dne ne/.test(txt), 'true');
  check('wallbox má plán pracovního dne', /GREEN 0:00–4:00 · FAST 4:00–7:00/.test(txt), 'true');
  check('  i víkend', /Víkend o 4 h později/.test(txt), 'true');
  check('  a hysterezi s prahy', /10 min nad 3,5 kW/.test(txt) && /10 min pod 2,5 kW/.test(txt), 'true');
  check('  a že přebytek je před autem', /před autem/.test(txt), 'true');

  OUT.push('\\n1b) Zpoždění po západu');
  // Jedno číslo pro všechna pravidla rozvrhu. Bez něj by se posun musel přepisovat
  // v každém pravidle zvlášť — a „západ" by znamenal přesný okamžik západu.
  const zap = document.getElementById('zapadDelay');
  check('výběr je na téhle stránce', page.contains(zap), 'true');
  check('  od nuly do hodiny po pěti minutách',
    [...zap.options].map(o => o.value).join(','), '0,5,10,15,20,25,30,35,40,45,50,55,60');
  renderZapadDelay(20);
  check('  a ukazuje nastavenou hodnotu', zap.value, '20');
  poslano = null;
  zap.value = '35';
  zap.dispatchEvent(new Event('change'));
  await wait(30);
  check('změna se pošle serveru', poslano.url, '/api/zapad-delay');
  check('  s minutami', poslano.body.minut, 35);

  OUT.push('\\n2) Nová pravidla');
  check('bazén má denní minimum', /Aspoň 2 h denně/.test(txt), 'true');
  check('  s oknem 13–15', /13:00 a 15:00/.test(txt), 'true');
  check('solinátor jede s bazénem', /Jede s bazénem/.test(txt), 'true');
  check('  nejpozději ve 13:00', /nejpozději ve 13:00/.test(txt), 'true');
  check('wallbox má západku na vybitou baterku', /Baterie pod 20 % po 12:00/.test(txt), 'true');
  check('  a je znát dokdy drží', /do ranního FAST okna/.test(txt), 'true');

  // Wallbox byl nejdelší sekce v appce — po zeštíhlení nesmí zase nabobtnat
  const wbIdx = sekce.findIndex(x => x.startsWith('Wallbox'));
  const wbSekce = [...page.querySelectorAll('.logic-sec')][wbIdx];
  check('wallbox má nejvýš pět odrážek', wbSekce.querySelectorAll('li').length <= 5, 'true');

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
const out = path.join(SP, 'logika.html');
fs.writeFileSync(out, v);
console.log(out);
