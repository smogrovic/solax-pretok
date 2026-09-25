// Emoji odznaky na boxech zařízení (sada B).
//
// Odznak sedí na horní hraně boxu vlevo. Uvnitř boxu (první pokus) lezl přes
// dlaždice FVE, tečky světel i tlačítko zámku — tahle sada hlídá, že každý box
// má svoje emoji a že odznak nepřekryje nic z obsahu.
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
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
 try {
  try { setLocked(false); } catch (e) {}
  const slide = t => [...document.querySelectorAll('.slide')].find(s => s.dataset.title === t);
  const karta = id => document.getElementById(id).closest('.card');
  const BOXY = [
    ['sekačka', karta('sekLight'), '🌱'],
    ['vysavač', document.getElementById('vysKarta'), '🧹'],
    ['bazén', karta('poolLight'), '🌊'],
    ['solinátor', document.getElementById('solinatorLight').closest('.device-block'), '🧂'],
    ['tepelné čerpadlo', document.getElementById('heatpumpCard'), '🌡️'],
    ['světla', karta('lightDoleLight'), '💡'],
    ['světlo bazén', karta('lightBazenLight2'), '💡'],
    ['bojler', karta('shellyLight'), '🛁'],
    ['bojlery na FVE', slide('FVE').querySelector('.boilers-card'), '🛁'],
    ['oběhové čerpadlo', document.getElementById('obehCard'), '🔄'],
    ['zámek', document.getElementById('nukiCard'), '🔑'],
    ['FVE', slide('FVE').querySelector('.card'), '🔆'],
    ['kamna HUUM', karta('huumLight'), '🔥'],
    ['sauna', karta('saunaLight'), '🔥'],
    ['závlaha', karta('zavlahaLight'), '💧'],
    ['wallbox', slide('Wallbox').querySelector('.card.lockable'), '⚡'],
    ['klima', slide('Klima').querySelector('.blinds-card'), '🌬️'],
    ['žaluzie', document.getElementById('blindsList1').closest('.card'), '🪟']
  ];

  R.push('1) Každý box má svoje emoji');
  for (const [jmeno, el, emoji] of BOXY) check(jmeno, el && el.dataset.emoji, emoji);

  R.push('\\n2) Odznak sedí na horní hraně vlevo');
  const vysavac = document.getElementById('vysKarta');
  const st = getComputedStyle(vysavac, '::before');
  check('odznak je vidět', st.content.includes('🧹'), true);
  check('  vyčnívá nad horní hranu', parseFloat(st.top) < 0, true);
  check('  a je vlevo', parseFloat(st.left) <= 20, true);

  R.push('\\n3) Odznak nic nepřekrývá');
  // Obdélník odznaku se spočítá z jeho stylu a porovná s každým listem obsahu boxu
  const prekryti = el => {
    const r = el.getBoundingClientRect();
    if (!r.width) return null;              // schovaný box se neměří
    const s = getComputedStyle(el, '::before');
    const o = { l: r.left + parseFloat(s.left), t: r.top + parseFloat(s.top) };
    o.r = o.l + parseFloat(s.width); o.b = o.t + parseFloat(s.height);
    const listy = [...el.querySelectorAll('*')].filter(x => !x.children.length || x.matches('button, svg, .traffic-light'));
    return listy.filter(x => {
      const q = x.getBoundingClientRect();
      if (!q.width || !q.height) return false;
      return q.left < o.r && q.right > o.l && q.top < o.b && q.bottom > o.t;
    }).map(x => x.className || x.tagName);
  };
  for (const [jmeno, el] of BOXY) {
    const p = prekryti(el);
    if (p === null) continue;
    check(jmeno + ': nic pod odznakem', p.join(',') || 'nic', 'nic');
  }
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]); }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const ok = R.filter(r => r.startsWith('  OK')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb ? 'SELHALO — ' + ok + ' ok, ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + ok + ' ok, 0 chyb (emoji)');
  document.body.appendChild(pre);
}, 600);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'emoji.html');
fs.writeFileSync(out, v);
console.log(out);
