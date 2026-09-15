// Stránka Asistent: pevná tlačítka pod polem na instrukce, pořadí karet
// a přepínač „nejsme doma".
//
// Tlačítka se staví ze seznamu ze serveru — v appce tak nemůže svítit tlačítko na
// něco, co server neumí. Proto se tady nekontroluje jen jejich existence, ale i to,
// že se opravdu berou z těch dat.
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
const poslano = [];
window.fetch = async (url, opts) => {
  poslano.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
  return { ok: true, status: 200, json: async () => ({ reply: 'Hotovo.', away: true, awaySince: Date.now(), awayAt: Date.now() + 900000, awayActive: false }) };
};
setTimeout(async () => {
 try {
  const MIN = 60000;
  const slide = document.querySelector('.slide[data-title="Asistent"]');

  R.push('1) Tlačítka pod instrukcemi');
  renderSceny([
    { key: 'sauna', label: 'Zapni saunu' },
    { key: 'zhasni', label: 'Zhasni všechna světla' },
    { key: 'zamkni', label: 'Zamkni dům' },
    { key: 'sprcha', label: 'Jdu do sprchy' }
  ]);
  const tlacitka = [...document.querySelectorAll('#asstScenes .asst-scene')];
  check('jsou čtyři', tlacitka.length, 4);
  check('  s popisky ze serveru', tlacitka.map(b => b.textContent).join(' | '),
    'Zapni saunu | Zhasni všechna světla | Zamkni dům | Jdu do sprchy');
  // Musí být ve stejné kartě jako pole na instrukce, ne někde dole pod logem
  check('jsou v kartě s polem na instrukce',
    document.getElementById('asstScenes').closest('.card').contains(document.getElementById('asstInput')), true);
  check('  a pod ním', document.getElementById('asstInput').compareDocumentPosition(
    document.getElementById('asstScenes')) & Node.DOCUMENT_POSITION_FOLLOWING ? 'pod' : 'nad', 'pod');

  poslano.length = 0;
  tlacitka[3].click();
  await new Promise(r => setTimeout(r, 30));
  check('stisk pošle klíč tlačítka', poslano[0].url, '/api/scene');
  check('  a je to ten správný', poslano[0].body.scene, 'sprcha');
  check('odpověď serveru se ukáže', document.getElementById('asstReply').textContent, 'Hotovo.');

  // Server umí jen to, co pošle — appka si tlačítka nevymýšlí
  renderSceny([{ key: 'zamkni', label: 'Zamkni dům' }]);
  check('kratší seznam ubere tlačítka', document.querySelectorAll('#asstScenes .asst-scene').length, 1);
  renderSceny(null);
  check('  a bez seznamu nezbyde žádné', document.querySelectorAll('#asstScenes .asst-scene').length, 0);

  R.push('\\n2) Pořadí karet');
  const karty = [...slide.querySelectorAll(':scope > .page > .card')].filter(c => !c.classList.contains('lock-panel'));
  const popis = c => (c.querySelector('.asst-log-title, .shelly-label') || {}).textContent
    || (c.classList.contains('asszistant-card') ? 'pole pro asistenta' : c.id || '?');
  // Teplotní automatika má být PŘED automatikou — dřív to bylo obráceně
  const iTemp = karty.findIndex(c => c.id === 'tempAutoCard');
  const iAuto = karty.findIndex(c => c.querySelector('#autoModeSlider'));
  check('teplotní automatika je dřív než automatika', iTemp < iAuto, true);
  check('  a jsou vedle sebe', iAuto - iTemp, 1);
  check('pořadí karet sedí', karty.map(popis).join(' | '),
    'pole pro asistenta | Teplotní automatika | Automatika: –');
  // Nad polem nic nestojí — co se do něj píše, je vidět z placeholderu
  check('žádný popisek nad polem', document.querySelectorAll('.asst-hint').length, 0);
  check('  ale pole říká, co do něj patří',
    /zapni bojler/.test(document.getElementById('asstInput').placeholder), true);
  // Výpis patří k ostatním výpisům, ne mezi ovládání
  const logKarta = document.getElementById('asstLogCard');
  check('„Co asistent udělal" je pryč z Asistenta', slide.contains(logKarta), false);
  const logSlide = [...document.querySelectorAll('.slide')].find(s => s.dataset.title === 'Log');
  check('  a stojí na stránce Log', logSlide.contains(logKarta), true);
  const logKarty = [...logSlide.querySelectorAll(':scope > .page > .card')];
  const vypadky = logKarty.find(c => /Výpadky/.test(c.textContent));
  check('  hned nad výpadky', logKarty.indexOf(vypadky) - logKarty.indexOf(logKarta), 1);

  R.push('\\n3) Nejsme doma');
  const check2 = document.getElementById('awayCheck');
  check('přepínač je na kartě automatiky',
    check2.closest('.card').contains(document.getElementById('autoModeSlider')), true);
  renderAway({ away: false, awayAt: 0, awayActive: false });
  check('doma je nezaškrtnutý', check2.checked, false);
  check('  a nic nehlásí', document.getElementById('awayHint').textContent, '');

  const T = Date.now();
  renderAway({ away: true, awaySince: T, awayAt: T + 15 * MIN, awayActive: false });
  check('po zaškrtnutí řekne, kdy se zavře',
    /Zamkne se a zhasne v \\d\\d?:\\d\\d/.test(document.getElementById('awayHint').textContent), true);
  check('  a ještě netvrdí, že je zamčeno',
    /je zamčený/.test(document.getElementById('awayHint').textContent), false);

  renderAway({ away: true, awaySince: T - 20 * MIN, awayAt: T - 5 * MIN, awayActive: true });
  check('po odpočtu řekne, co platí',
    /Dům je zamčený, světla zhasnutá, bojler se nezapíná./.test(document.getElementById('awayHint').textContent), true);

  poslano.length = 0;
  check2.checked = true;
  check2.dispatchEvent(new Event('change'));
  await new Promise(r => setTimeout(r, 30));
  check('zaškrtnutí se pošle serveru', poslano[0].url, '/api/away');
  check('  s hodnotou', poslano[0].body.away, true);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }

  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb
    ? 'SELHALO — ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + R.length + ' ok, 0 chyb (asistent)');
  document.body.appendChild(pre);
}, 700);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'asistent.html');
fs.writeFileSync(out, v);
console.log(out);
