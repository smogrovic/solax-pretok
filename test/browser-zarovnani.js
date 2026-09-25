// První box na každé stránce sedí ve stejné výšce.
//
// Asistent, Bazén a Přehled měly první box o 12 px níž než ostatní stránky. Mezera
// mezi kartami (`.card + .card`) se nalepila i na kartu, před kterou stojí jen
// schovaná sousedka (#heatpumpCard `hidden`, dětská karta Asistenta v plném
// režimu), a Bazén s Přehledem si ji navíc nesly ve vlastní třídě.
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
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
setTimeout(() => {
 try {
  try { setLocked(false); } catch (e) {}
  const odsazeni = () => {
    const out = {};
    for (const s of document.querySelectorAll('.slide')) {
      const page = s.querySelector('.page');
      if (!page) continue;
      const c = [...page.children].find(x => x.getBoundingClientRect().height > 0);
      if (!c) continue;
      out[s.dataset.title] = Math.round(c.getBoundingClientRect().top - s.getBoundingClientRect().top);
    }
    return out;
  };
  const projdi = rezim => {
    document.body.dataset.rezim = rezim;
    const o = odsazeni();
    const vzor = o['FVE'] !== undefined ? o['FVE'] : o[Object.keys(o)[0]];
    R.push('\\n' + rezim + ': vzor ' + vzor + ' px');
    for (const [t, px] of Object.entries(o)) check(t, px, vzor);
  };
  projdi('full');
  projdi('miky');
  document.body.dataset.rezim = 'full';
  R.push('\\nMezera mezi boxy zůstává');
  const bazen = [...document.querySelectorAll('.slide')].find(s => s.dataset.title === 'Bazén');
  const tc = document.getElementById('heatpumpCard');
  tc.hidden = false;
  const druha = tc.nextElementSibling;
  check('Bazén s TČ: druhý box 12 px pod prvním', Math.round(druha.getBoundingClientRect().top - tc.getBoundingClientRect().bottom), 12);
  tc.hidden = true;
  const prehled = [...document.querySelectorAll('.slide')].find(s => s.dataset.title === 'Přehled');
  const k = [...prehled.querySelector('.page').children].filter(x => x.getBoundingClientRect().height > 0);
  check('Přehled: druhý box 12 px pod prvním', Math.round(k[1].getBoundingClientRect().top - k[0].getBoundingClientRect().bottom), 12);
 } catch (e) { R.push('CHYBA  výjimka: ' + e.message); }
  const chyb = R.filter(r => r.startsWith('CHYBA')).length;
  const ok = R.filter(r => r.startsWith('  OK')).length;
  const pre = document.createElement('pre');
  pre.id = 'VYSLEDEK';
  pre.textContent = R.join('\\n') + '\\n\\n' + (chyb ? 'SELHALO — ' + ok + ' ok, ' + chyb + ' chyb'
    : 'VŠE PROŠLO — ' + ok + ' ok, 0 chyb (zarovnání)');
  document.body.appendChild(pre);
}, 600);
`;
v = v.replace('</body>', '<script>' + DRIVER + '<\/script></body>');
const out = path.join(SP, 'zarovnani.html');
fs.writeFileSync(out, v);
console.log(out);
