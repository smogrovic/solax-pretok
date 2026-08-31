// Vytahování kusů server.js podle kotev v textu, ne podle čísel řádků — ta se
// s každou úpravou posunou a sady pak tiše berou cizí kód.
const fs = require('fs');
const path = require('path');
const LINES = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('\n');

function findLine(anchor, from = 0) {
  for (let i = from; i < LINES.length; i++) if (LINES[i].startsWith(anchor)) return i;
  throw new Error(`kotva nenalezena: ${anchor}`);
}

// Text od řádku začínajícího `od` (včetně) po řádek začínající `do` (bez něj).
function between(od, doo) {
  const a = findLine(od);
  const b = findLine(doo, a + 1);
  return LINES.slice(a, b).join('\n');
}

// Celá deklarace funkce od hlavičky po uzavírací } na začátku řádku.
function fn(sig) {
  const a = findLine(sig);
  for (let i = a + 1; i < LINES.length; i++) {
    if (LINES[i] === '}') return LINES.slice(a, i + 1).join('\n');
  }
  throw new Error(`konec funkce nenalezen: ${sig}`);
}

// Společné počítadlo výsledků pro všechny sady
function suite(nazev) {
  let pass = 0, fail = 0;
  const check = (name, got, want) => {
    const ok = String(got) === String(want);
    console.log(`${ok ? '  OK ' : 'CHYBA'}  ${String(name).padEnd(58)} → ${got}${ok ? '' : `   (čekáno ${want})`}`);
    ok ? pass++ : fail++;
  };
  const nadpis = t => console.log('\n' + t);
  const konec = () => {
    console.log(`\n${fail ? `SELHALO — ${pass} ok, ${fail} chyb` : `VŠE PROŠLO — ${pass} ok, 0 chyb`} (${nazev})`);
    process.exit(fail ? 1 : 0);
  };
  return { check, nadpis, konec };
}

module.exports = { LINES, between, fn, suite };
