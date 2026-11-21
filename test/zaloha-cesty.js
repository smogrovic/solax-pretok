// Ověření: každá cesta, kterou záloha (storeSnapshot) ukládá do `posts`, se po startu
// opravdu obnoví — je v seznamu STORE_POSTS. Termíny tam chyběly: uložené se
// zálohovaly, ale po nasazení se nevrátily a záloha se pak přepsala výchozími.
const { LINES, suite } = require('./zdroj');
const { check, konec } = suite('cesty zálohy');
const text = LINES.join('\n');
const snap = text.slice(text.indexOf('function storeSnapshot() {'), text.indexOf('function storeApplyPrimo('));
const ukladane = [...new Set([...snap.matchAll(/'(\/api\/[a-z0-9/-]+\/restore)'/g)].map(m => m[1]))];
const seznam = text.slice(text.indexOf('const STORE_POSTS = ['), text.indexOf('];', text.indexOf('const STORE_POSTS = [')));
const obnovovane = new Set([...seznam.matchAll(/'(\/api\/[a-z0-9/-]+\/restore)'/g)].map(m => m[1]));
check('záloha ukládá aspoň 30 cest', ukladane.length >= 30, true);
check('termíny se zálohují', ukladane.includes('/api/terminy/restore'), true);
const chybi = ukladane.filter(c => !obnovovane.has(c));
check('každá zálohovaná cesta se po startu obnoví', chybi.join(', ') || 'všechny', 'všechny');
for (const c of obnovovane) {
  if (!new RegExp("app\\.post\\('" + c.replace(/[/]/g, '\\/') + "'").test(text)) check('endpoint existuje: ' + c, false, true);
}
konec();
