// Kontrola jídelníčku před odesláním do appky: struktura, skladba týdne podle
// PROMPT.md a jestli nákupní seznam přesně odpovídá součtu surovin z receptů.
// Použití: node jidelnicek/over.js plan.json [historie.json]
// Vypíše chyby (nutno opravit) a upozornění; skončí kódem 1, když je nějaká chyba.
const WEBY = ['maruskaveg.com', 'buchtavtroube.cz', 'receptyodanicky.cz', 'karolinafour.cz'];
const NAKUP_KATEGORIE = ['Maso, ryby, tofu a další bílkoviny', 'Mléčné výrobky a sýry', 'Zelenina', 'Ovoce',
  'Pečivo a přílohy', 'Mouky, vločky a suché potraviny', 'Ořechy, semínka a sladké suroviny', 'Dochucovadla a ostatní'];
const SKLADBA = [['vecere', 'pracovni', 4], ['vecere', 'vikend', 1], ['vecere', 'bez_vareni', 1],
  ['peceni', 'peceni', 1], ['snidane', 'pracovni_snidane', 2], ['snidane', 'vikend_snidane', 1]];
const PREVOD = { kg: ['g', 1000], l: ['ml', 1000], dl: ['ml', 100] };
// Doma je vždycky — v receptu ano, na nákupní seznam ne
const DOMA = ['sul', 'pepr', 'voda', 'studena voda', 'tepla voda', 'horka voda'];

const klic = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const jednotka = (m, j) => { const p = PREVOD[klic(j)]; return p ? [m * p[1], p[0]] : [m, klic(j)]; };

function zkontroluj(plan, historie = [], zbyva = []) {
  const chyby = [], varovani = [];
  if (!plan || typeof plan !== 'object') return { chyby: ['Soubor neobsahuje jídelníček.'], varovani };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.tyden || '')) chyby.push('tyden musí být datum pondělí (YYYY-MM-DD).');
  else if (new Date(plan.tyden + 'T12:00:00Z').getUTCDay() !== 1) chyby.push(`tyden ${plan.tyden} není pondělí.`);
  // Náhradní recepty (nahradni: true) se do skladby týdne ani do nákupu nepočítají
  const vsechny = Array.isArray(plan.recepty) ? plan.recepty : [];
  const recepty = vsechny.filter(r => r.nahradni !== true);
  const nahradni = vsechny.filter(r => r.nahradni === true);
  const s = (r, x) => Array.isArray(r.stitky) && r.stitky.includes(x);

  // Skladba týdne
  for (const [kat, typ, n] of SKLADBA) {
    const pocet = recepty.filter(r => r.kategorie === kat && r.typ === typ).length;
    if (pocet !== n) chyby.push(`${kat}/${typ}: má být ${n}, je ${pocet}.`);
  }
  if (recepty.length !== SKLADBA.reduce((a, x) => a + x[2], 0)) chyby.push(`Receptů má být 10, je ${recepty.length}.`);
  const hlavni = recepty.filter(r => r.typ === 'pracovni' || r.typ === 'vikend');
  const maso = hlavni.filter(r => s(r, 'maso')).length;
  if (maso !== 2) chyby.push(`Hlavní jídla s masem: mají být přesně 2, jsou ${maso}.`);
  const vegan = hlavni.filter(r => s(r, 'vegan'));
  if (!vegan.length) chyby.push('Chybí plně veganské hlavní jídlo.');
  for (const r of vegan) {
    if (['maso', 'ryba', 'mozzarella', 'cottage', 'tvaroh'].some(x => s(r, x))) chyby.push(`${r.nazev}: veganské jídlo nesmí mít maso, rybu ani mléčné.`);
    const b = r.vyziva && r.vyziva.bilkoviny;
    if (!(b >= 25 && b <= 30)) varovani.push(`${r.nazev}: veganské jídlo má mít 25–30 g bílkovin na porci (má ${b ?? '?'}).`);
  }
  if (!recepty.some(r => s(r, 'tortilla'))) chyby.push('Chybí jídlo s tortillami.');
  const brambory = hlavni.filter(r => s(r, 'brambory')).length;
  if (brambory > 1) chyby.push(`Brambory nejvýš 1× týdně, jsou ${brambory}×.`);
  for (const x of ['mozzarella', 'cottage', 'tvaroh']) if (!recepty.some(r => s(r, x))) chyby.push(`Chybí ${x}.`);
  // Ryba jednou za 14 dní: minulý týden byla → teď ne; nebyla → teď právě jednou
  const ryby = hlavni.filter(r => s(r, 'ryba')).length;
  const minule = (historie || []).find(h => h && h.tyden < plan.tyden);
  if (minule && minule.ryba && ryby) chyby.push('Ryba byla minulý týden — tento týden žádná.');
  if (minule && !minule.ryba && ryby !== 1) chyby.push(`Minulý týden ryba nebyla — tento týden má být právě jedna (je ${ryby}).`);
  if (!minule && ryby > 1) chyby.push('Ryba nejvýš jednou.');
  // Náhradní: 2 hlavní jídla, 1 pečení, 1 snídaně
  for (const [popis, n, f] of [['hlavní jídla (vecere pracovni/vikend)', 2, r => r.kategorie === 'vecere' && (r.typ === 'pracovni' || r.typ === 'vikend')],
    ['pečení', 1, r => r.kategorie === 'peceni'], ['snídaně', 1, r => r.kategorie === 'snidane']]) {
    const pocet = nahradni.filter(f).length;
    if (pocet !== n) chyby.push(`Náhradní ${popis}: má být ${n}, je ${pocet}.`);
  }
  if (nahradni.length !== 4) chyby.push(`Náhradních receptů má být 4, je ${nahradni.length}.`);
  for (const r of vsechny.filter(r => r.typ === 'pracovni_snidane')) {
    if ((r.suroviny || []).some(x => /vejce|vajic/.test(klic(x.nazev)))) chyby.push(`${r.nazev}: pracovní snídaně je bez vajec.`);
  }
  // Opakování z minulých týdnů
  const dřív = new Set((historie || []).flatMap(h => (h.nazvy || []).map(klic)));
  const zustava = new Set((zbyva || []).map(klic));
  for (const r of vsechny) if (zustava.has(klic(r.nazev))) chyby.push(`${r.nazev}: v jídelníčku už zůstává z minula — vyber jiné.`);
  const nazvy = vsechny.map(r => klic(r.nazev));
  if (new Set(nazvy).size !== nazvy.length) chyby.push('Některé jídlo je v jídelníčku dvakrát (i mezi náhradními).');
  for (const r of vsechny) if (!zustava.has(klic(r.nazev)) && dřív.has(klic(r.nazev))) varovani.push(`${r.nazev}: bylo v některém z minulých týdnů.`);

  // Zdroje a údaje u receptů (i náhradních)
  for (const r of vsechny) {
    const kde = r.nazev || '(bez názvu)';
    if (r.vlastni !== true) {
      let host = '';
      try { host = new URL(r.zdroj && r.zdroj.url).hostname.replace(/^www\./, ''); } catch { /* níž */ }
      if (!WEBY.includes(host)) chyby.push(`${kde}: odkaz musí vést na ${WEBY.join(', ')} (nebo vlastni: true).`);
    }
    if (!Array.isArray(r.suroviny) || !r.suroviny.length) chyby.push(`${kde}: chybí suroviny.`);
    for (const x of r.suroviny || []) if (!DOMA.includes(klic(x.nazev)) && (!x.nazev || !Number.isFinite(x.mnozstvi) || !x.jednotka)) chyby.push(`${kde}: surovina „${x.nazev || '?'}" bez přesného množství a jednotky.`);
    // Kategorie u suroviny: po aktivaci náhradního jídla z ní appka sečte nákup
    for (const x of r.suroviny || []) if (!DOMA.includes(klic(x.nazev)) && !NAKUP_KATEGORIE.includes(x.kategorie)) chyby.push(`${kde}: surovina „${x.nazev || '?'}" bez platné kategorie.`);
    if (!Array.isArray(r.postup) || !r.postup.length) chyby.push(`${kde}: chybí postup.`);
    if (r.typ !== 'bez_vareni') {
      const v = r.vyziva || {};
      if (!['kcal', 'bilkoviny', 'sacharidy', 'tuky'].every(k => Number.isFinite(v[k]))) chyby.push(`${kde}: chybí výživové hodnoty.`);
    }
  }

  // Nákup = přesný součet surovin (stejný název, převod kg→g, l→ml)
  const nakup = Array.isArray(plan.nakup) ? plan.nakup : [];
  const soucet = new Map();
  for (const r of recepty) for (const x of r.suroviny || []) {
    if (!Number.isFinite(x.mnozstvi) || DOMA.includes(klic(x.nazev))) continue;
    const [m, j] = jednotka(x.mnozstvi, x.jednotka);
    const k = klic(x.nazev) + '|' + j;
    soucet.set(k, (soucet.get(k) || 0) + m);
  }
  const vNakupu = new Map();
  for (const n of nakup) {
    if (DOMA.includes(klic(n.nazev))) { chyby.push(`Nákup: ${n.nazev} je vždy doma — vyřaď.`); continue; }
    if (!NAKUP_KATEGORIE.includes(n.kategorie)) chyby.push(`Nákup „${n.nazev}": neznámá kategorie.`);
    if (!Number.isFinite(n.mnozstvi)) { if (!n.odhad) chyby.push(`Nákup „${n.nazev}": bez množství musí mít odhad: true.`); continue; }
    const [m, j] = jednotka(n.mnozstvi, n.jednotka);
    const k = klic(n.nazev) + '|' + j;
    if (vNakupu.has(k)) chyby.push(`Nákup „${n.nazev}" je tam dvakrát — slouč.`);
    vNakupu.set(k, m);
  }
  for (const [k, m] of soucet) {
    const [nazev, j] = k.split('|');
    if (!vNakupu.has(k)) chyby.push(`Nákup: chybí ${nazev} (${m} ${j}).`);
    else if (Math.abs(vNakupu.get(k) - m) > Math.max(0.01 * m, 0.001)) chyby.push(`Nákup: ${nazev} má být ${m} ${j}, je ${vNakupu.get(k)}.`);
  }
  for (const [k] of vNakupu) if (!soucet.has(k)) chyby.push(`Nákup: ${k.split('|')[0]} není v žádném receptu.`);

  for (const k of plan.kontrola || []) if (!k.ok) varovani.push(`Kontrola nesplněna: ${k.bod}${k.poznamka ? ' — ' + k.poznamka : ''}`);
  return { chyby, varovani };
}

module.exports = { zkontroluj, WEBY };

if (require.main === module) {
  const fs = require('fs');
  const [soubor, histSoubor] = process.argv.slice(2);
  if (!soubor) { console.error('Použití: node jidelnicek/over.js plan.json [historie.json]'); process.exit(2); }
  const plan = JSON.parse(fs.readFileSync(soubor, 'utf8'));
  let historie = [], zbyva = [];
  if (histSoubor) { const h = JSON.parse(fs.readFileSync(histSoubor, 'utf8')); historie = Array.isArray(h) ? h : h.historie || []; zbyva = (h && h.zbyva) || []; }
  const { chyby, varovani } = zkontroluj(plan, historie, zbyva);
  for (const v of varovani) console.log('UPOZORNĚNÍ ' + v);
  for (const c of chyby) console.log('CHYBA ' + c);
  console.log(chyby.length ? `\n${chyby.length} chyb — oprav a zkontroluj znovu.` : '\nOK — jídelníček odpovídá pravidlům.');
  process.exit(chyby.length ? 1 : 0);
}
