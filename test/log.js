// Ověření: co se do logu píše a co ne. Hlavní log má být o tom, co dům udělal —
// automatické přepínání wallboxu, cíl solinátoru, spínání klimatizací, ticho čidel
// a cvakání světel se z něj vyhodilo (všechno je vidět jinde). Selhané povely mají
// úroveň 'error', takže je appka dá do karty výpadků.
const fs = require('fs');
const path = require('path');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('log');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
// Text logované hlášky, ne kód okolo — hledáme, jestli takový addLog vůbec existuje
const loguje = re => new RegExp('addLog\\(\\s*[`\'"].{0,80}' + re).test(SRC);

nadpis('1) Co se do logu píše');
{
  check('ruční přepnutí relé', loguje('zapnuto.*ručně|\\$\\{DEVICE_LABELS\\[key\\]\\}'), true);
  check('režim automatiky', loguje('Automatika:'), true);
  check('sauna začne topit', loguje('Sauna: topí'), true);
  check('bazén +24 h', loguje('Bazén: \\+'), true);
  check('časovače', loguje('Časovač'), true);
  check('ruční režim wallboxu', /Wallbox: režim \$\{WB_MODE_LABELS\[mode\]\} ručně/.test(SRC), true);
}

nadpis('2) Co se do logu NEPÍŠE');
{
  check('automatické přepnutí wallboxu podle přebytku',
    /addLog\(`Wallbox: přebytek/.test(SRC), false);
  check('  ani režim nastavený automatikou',
    /addLog\(`Wallbox: režim \$\{WB_MODE_LABELS\[target\]\}/.test(SRC), false);
  check('cíl solinátoru', /addLog\(`Solinátor: \$\{zdroj\}/.test(SRC), false);
  check('  přenos boostu', /addLog\(`Solinátor: \$\{fmtDur\(carry\)\}/.test(SRC), false);
  check('  čekání na dopočet', /addLog\('Solinátor: po restartu/.test(SRC), false);
  check('spínání klimatizace automatikou',
    /addLog\(`Teplotní automatika — /.test(SRC), false);
  check('ticho čidel', /addLog\(`Čidlo \$\{label\}/.test(SRC), false);
}

nadpis('3) Světla');
{
  check('existuje seznam světel', /const LIGHT_KEYS = \[/.test(SRC), true);
  check('  a jsou v něm čtyři', (SRC.match(/const LIGHT_KEYS = \[([^\]]*)\]/) || [])[1].split(',').length, 4);
  // Ruční i časovačem/asistentem — obojí musí u světel mlčet
  check('ruční přepnutí světla se neloguje', (SRC.match(/if \(!jeSvetlo\(key\)\) \{/g) || []).length, 2);
}

nadpis('4) Selhání jdou do výpadků');
{
  const chyby = [
    'příkaz automatiky selhal',
    'roleta selhala',
    'vypnutí klimatizace selhalo',
    'připojení k Panasonic selhalo',
    'Wallbox automatika'
  ];
  for (const c of chyby) {
    const i = SRC.indexOf(c);
    const radek = i < 0 ? '' : SRC.slice(i, SRC.indexOf('\n', i) + 200);
    check(`„${c}" má úroveň error`, /'error'\)/.test(radek.split(');')[0] + ');'), true);
  }
}

nadpis('5) Doba života');
{
  check('log si pamatuje 48 h', /const LOG_MAX_AGE_MS = 48 \* 60 \* 60 \* 1000;/.test(SRC), true);
  check('  a nejvýš 500 řádků', /const LOG_MAX_ENTRIES = 500;/.test(SRC), true);
}

nadpis('6) Výpadek nese, že pořád trvá');
{
  check('začátek výpadku nastaví open', /outageLog\[s\.key\]\.open = true;/.test(SRC), true);
  check('konec ho shodí', /outageLog\[s\.key\]\.open = false;/.test(SRC), true);
  check('a druhý řádek „zase odpovídá" už nevzniká',
    /addLog\(s\.rele \? `\$\{s\.label\}: zase odpovídá`/.test(SRC), false);
}

konec();
