// Přepínač automatiky (nahoře na Ovládání, do 11/2026 na FVE). Box s prázdninami
// a ložnicí je pryč — prázdniny se řídí kalendářem. Box se scénami („Zapni saunu"…) je
// z FVE pryč (11/2026), stránka Asistent i pole na instrukce taky.
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
// Odpovídá podle toho, na co se appka ptá — jinak by se nedalo poznat, jestli jezdec
// skončil tam, kam ho posadil server, nebo tam, kde ho nechal prst
window.fetch = async (url, opts) => {
  const telo = opts && opts.body ? JSON.parse(opts.body) : null;
  poslano.push({ url: String(url), body: telo });
  const T = Date.now();
  let odpoved = { reply: 'Hotovo.' };
  // Bez regulárního výrazu schválně: lomítko v něm by se cestou do stránky ztratilo
  if (String(url).includes('/api/away')) {
    odpoved = { away: !!(telo && telo.away), awaySince: T, awayAt: T + 900000, awayActive: false };
  } else if (String(url).includes('/api/automation')) {
    odpoved = { autoMode: telo && telo.mode };
  }
  return { ok: true, status: 200, json: async () => odpoved };
};
setTimeout(async () => {
 try {
  const MIN = 60000;
  const pockej = () => new Promise(r => setTimeout(r, 30));
  const slide = document.querySelector('.slide[data-title="FVE"]');

  R.push('1) Box se scénami je pryč');
  check('žádná tlačítka scén', document.querySelectorAll('#asstScenes, .asst-scene, .asszistant-card').length, 0);
  check('ani odpověď asistenta', !!document.getElementById('asstReply'), false);
  check('stránka Asistent je pryč', !!document.querySelector('.slide[data-title="Asistent"]'), false);
  check('  i pole na instrukce', !!document.getElementById('asstInput'), false);
  check('alarm (rozpracovaný) taky', !!document.getElementById('asstAlarm'), false);
  // Snímek ze serveru dál posílá seznam scén — appka ho jen přejde
  check('renderSceny už neexistuje', typeof window.renderSceny, 'undefined');

  R.push('\\n1b) Box s prázdninami a ložnicí je pryč (prázdniny se řídí kalendářem)');
  check('žádný box ani tlačítka', ['rozvrhVyjimky', 'prazdninyBtn', 'lozniceZavrenoBtn'].filter(id => document.getElementById(id)).length, 0);
  check('  ani jejich kód', typeof window.renderPrazdniny + ' ' + typeof window.renderLozniceZavreno, 'undefined undefined');
  check('  a nápověda rozvrhu tlačítko nezmiňuje', [...document.querySelectorAll('.logic-list')].some(u => /tlačítko na FVE/.test(u.textContent)), false);

  R.push('\\n2) Pořadí karet');
  const karty = [...slide.querySelectorAll(':scope > .page > .card')]
    .filter(c => !c.classList.contains('lock-panel') && getComputedStyle(c).display !== 'none');
  check('FVE začíná elektrárnou', !!karty[0].querySelector('.nodes'), true);
  check('  bez zámkového panelu (nic se tu neovládá)', slide.querySelectorAll('.lock-panel, .lockable').length, 0);
  // Automatika řídí celý dům — patří nahoru na Ovládání
  const ovl = document.querySelector('.slide[data-title="Ovládání"]');
  const ovlKarty = [...ovl.querySelectorAll(':scope > .page > .card')].filter(c => !c.classList.contains('lock-panel'));
  check('přepínač automatiky je první na Ovládání', ovlKarty[0].id, 'autoCard');
  // Teplotní automatika je nahoře na Klimatu
  const klima = document.querySelector('.slide[data-title="Klima"]');
  const klimaKarty = [...klima.querySelectorAll(':scope > .page > .card')].filter(c => !c.classList.contains('lock-panel'));
  check('teplotní automatika je první na Klimatu', klimaKarty[0].id, 'tempAutoCard');
  // Výpis patří k ostatním výpisům, ne mezi ovládání
  const logKarta = document.getElementById('asstLogCard');
  check('„Co asistent udělal" je pryč z Asistenta', slide.contains(logKarta), false);
  const logSlide = [...document.querySelectorAll('.slide')].find(s => s.dataset.title === 'Log/Nastavení');
  check('  a stojí na stránce Log/Nastavení', logSlide.contains(logKarta), true);
  const logKarty = [...logSlide.querySelectorAll(':scope > .page > .card')];
  const vypadky = logKarty.find(c => /Výpadky/.test(c.textContent));
  check('  hned nad výpadky', logKarty.indexOf(vypadky) - logKarty.indexOf(logKarta), 1);

  R.push('\\n3) Jezdec automatiky má čtyři polohy');
  const jezdec = document.getElementById('autoModeSlider');
  const hint = document.getElementById('autoModeHint');
  const okno = document.getElementById('potvrzOkno');
  const posun = i => { jezdec.value = String(i); jezdec.dispatchEvent(new Event('change')); };
  check('jezdec sahá po čtvrtou polohu', jezdec.max, '3');
  // Vypnuto a „jsme pryč" stojí vedle sebe schválně: obojí dům utlumí a obojí se ptá
  check('  a popisky sedí', [...document.querySelectorAll('.mode-scale span')].map(s => s.textContent).join(', '),
    'Vypnuto, Jsme pryč, Zapnuto, Zima');

  renderAutomation('winter');
  renderAway({ away: false, awayAt: 0, awayActive: false });
  check('zima je poslední poloha', jezdec.value, '3');
  check('  a nic se nehlásí', document.getElementById('awayHint').textContent, '');

  const T = Date.now();
  renderAway({ away: true, awaySince: T, awayAt: T + 15 * MIN, awayActive: false });
  check('„jsme pryč" je druhá', jezdec.value, '1');
  check('  a semafor svítí dál', document.getElementById('autoLight').classList.contains('off'), false);
  check('  stav to říká', document.getElementById('autoState').textContent, 'jsme pryč');
  // Pryč je nadřazené režimu, ne náhrada za něj — jinak by se v zimě přestalo hlídat
  // zhasnuté světlo u bazénu právě ve chvíli, kdy nikdo není doma
  check('  a režim pod tím zůstává', /režimu zima/.test(hint.textContent), true);
  check('řekne, kdy se zavře',
    /Zamkne se a zhasne v \\d\\d?:\\d\\d/.test(document.getElementById('awayHint').textContent), true);
  check('  a ještě netvrdí, že je zamčeno',
    /je zamčený/.test(document.getElementById('awayHint').textContent), false);
  renderAway({ away: true, awaySince: T - 20 * MIN, awayAt: T - 5 * MIN, awayActive: true });
  check('po odpočtu řekne, co platí',
    /Dům je zamčený, světla, sauna i oběhové čerpadlo vypnuté, bojler se nezapíná./.test(document.getElementById('awayHint').textContent), true);

  R.push('\\n4) Potvrzení u poloh, které dům utlumí');
  // Návrat domů se neptá: zapnout dům zpátky není nic, co by šlo litovat
  renderAway({ away: true, awaySince: T, awayAt: T + 15 * MIN, awayActive: false });
  poslano.length = 0;
  posun(2);
  await pockej();
  check('návrat domů se neptá', okno.hidden, true);
  check('  a pošle obojí', poslano.map(x => x.url).join(' + '), '/api/away + /api/automation');
  check('  nejdřív návrat', poslano[0].body.away, false);
  check('  pak režim', poslano[1].body.mode, 'on');

  renderAutomation('winter');
  poslano.length = 0;
  posun(0);
  check('„vypnuto" se ptá', okno.hidden, false);
  check('  a zatím nic neposlalo', poslano.length, 0);
  check('  na tlačítku běží odpočet', /^Potvrdit \\(30 s\\)$/.test(document.getElementById('potvrzAno').textContent), true);
  // Dokud se člověk rozhoduje, nesmí mu jezdec pod rukou uskočit zpátky
  renderAutomation('winter');
  check('  a jezdec zůstává u volby', jezdec.value, '0');
  document.getElementById('potvrzZpet').click();
  check('„zpět" okno zavře', okno.hidden, true);
  check('  jezdec skočí zpátky na zimu', jezdec.value, '3');
  check('  a nic se neposlalo', poslano.length, 0);

  posun(0);
  document.getElementById('potvrzAno').click();
  await pockej();
  check('potvrzení automatiku vypne', poslano[0].body.mode, 'off');
  check('  a jezdec zůstane na vypnuto', jezdec.value, '0');

  // Když se člověk mezitím zvedne a odejde, okno nesmí zůstat viset donekonečna
  renderAutomation('winter');
  poslano.length = 0;
  posun(1);
  check('„jsme pryč" se taky ptá', okno.hidden, false);
  potvrzDoKdy = Date.now() - 1;
  potvrzTik();
  check('po půl minutě okno zmizí samo', okno.hidden, true);
  check('  jezdec skočí zpátky tam, kde byl', jezdec.value, '3');
  check('  a dům zůstane, jak byl', poslano.length, 0);
  check('odpočet je půlminutový', POTVRZ_MS, 30000);

  poslano.length = 0;
  posun(1);
  document.getElementById('potvrzAno').click();
  await pockej();
  check('potvrzené „jsme pryč" se pošle', poslano[0].url, '/api/away');
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
