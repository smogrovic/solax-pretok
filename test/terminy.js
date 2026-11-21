// Ověření: stránka Termíny — výchozí data (bez VIN a SPZ, repo je veřejné),
// kontrola dat z appky, posun opakovaných termínů, upozornění 14 dní předem
// a v den termínu (jen přes den, každé jednou) a obnova ze zálohy.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('termíny');

const CODE = fn('function pragueTime(at) {') + '\n' + fn('function pragueDateString(at) {') + '\n'
  + between('// ---------- Termíny (auta, motorka, pes, očkování…) ----------', '// ---------- Nákupní seznam ----------');

function build() {
  const h = { state: {}, routy: {}, push: [], log: [], zpravy: [], ulozeni: 0, plan: [] };
  h.api = new Function('state', 'app', 'sendPushToAll', 'addLog', 'broadcast', 'storeUlozBrzy', 'scheduleEvery',
    CODE + '\n; return { terminyVychozi, terminyData, terminyPayload, terminyOver, terminyDni, terminyPosun, terminyKontrola, TERMINY_PREDEM_DNI };'
  )(h.state, { post: (c, f) => { h.routy[c] = f; } }, (a, b) => h.push.push(a + ' — ' + b), t => h.log.push(t),
    (typ, d) => h.zpravy.push({ typ, d }), () => { h.ulozeni++; }, (f, ms) => h.plan.push(ms));
  h.volej = (cesta, body = {}, params = {}) => {
    let out = null;
    const res = { status(s) { this.s = s; return this; }, json(j) { out = { s: this.s || 200, ...j }; return this; } };
    h.routy[cesta]({ body, params }, res);
    return out;
  };
  return h;
}
// Poledne v Praze daného dne (zima UTC+1)
const poledne = (r, m, d) => Date.UTC(r, m - 1, d, 11);

nadpis('1) Výchozí data');
{
  const h = build();
  const t = h.api.terminyData();
  check('pět karet: dvě auta, motorka, pes, naše očkování', t.karty.map(k => k.id).join(','), 'bmw4,vw,gs,eso,ockovani');
  check('STK BMW 4', t.karty[0].terminy.find(x => x.nazev === 'STK').datum, '2028-08-03');
  check('Nobivac každý rok', t.karty[3].terminy[1].opakovani, 12);
  const vse = JSON.stringify(t);
  // Repo je veřejné: žádné VIN (17 znaků), SPZ ani číslo karty
  check('žádné VIN ve výchozích datech', /\b[A-HJ-NPR-Z0-9]{17}\b/.test(vse), false);
  check('žádná SPZ', /\b\d[A-Z]{1,2}\d?\s?\d{3,4}\b/.test(vse), false);
  check('výchozí data se ověřením nezmění', JSON.stringify(h.api.terminyOver(t.karty).karty), JSON.stringify(t.karty));
  check('kontrola běží hodinově', h.plan[0], 3600000);
  const ock = t.karty[4];
  check('očkování má pododdíly Lukáš, Zuzka, Miky, Elenka', ock.skupiny.join(','), 'Lukáš,Zuzka,Miky,Elenka');
  check('  tetanus je Lukášův', ock.terminy[0].skupina, 'Lukáš');
  // Karta ze zálohy z doby před pododdíly se doplní
  const h2 = build();
  h2.state.terminy = { karty: [{ id: 'ockovani', nazev: 'Naše očkování', ikona: '💉', udaje: '',
    terminy: [{ id: 'my-tetanus', nazev: 'Tetanus', datum: '2037-02-01', opakovani: 0, pozn: '' }] }], upozorneno: {} };
  const m = h2.api.terminyData().karty[0];
  check('stará karta dostane pododdíly i Lukášův tetanus', m.skupiny.length + ' ' + m.terminy[0].skupina, '4 Lukáš');
  m.skupiny = ['Zuzka'];
  check('  ale jen jednou (úpravy zůstanou)', h2.api.terminyData().karty[0].skupiny.join(), 'Zuzka');
}

nadpis('2) Kontrola dat z appky');
{
  const h = build();
  const k = [{ nazev: 'Auto', terminy: [{ nazev: 'STK', datum: '2027-02-30' }] }];
  check('nesmyslné datum odmítne', /Špatné datum/.test(h.api.terminyOver(k).chyba), true);
  check('karta bez názvu', h.api.terminyOver([{ nazev: ' ' }]).chyba, 'Karta musí mít název.');
  check('nejsou karty', h.api.terminyOver(null).chyba, 'Chybí karty.');
  const o = h.api.terminyOver([{ nazev: 'Pes', terminy: [{ nazev: 'Vzteklina', datum: '' }, { nazev: 'X', datum: '2027-01-01', opakovani: 12 }] }]);
  check('prázdné datum = bez data, chybějící id se doplní', o.karty[0].terminy[0].datum + ' ' + /^t/.test(o.karty[0].terminy[0].id) + ' ' + /^k/.test(o.karty[0].id), 'null true true');
  const sk = h.api.terminyOver([{ nazev: 'Očkování', skupiny: [' Zuzka ', '', 'Zuzka', 'Miky'], terminy: [{ nazev: 'Tetanus', skupina: 'Miky' }, { nazev: 'X', skupina: '' }] }]).karty[0];
  check('pododdíly: bez prázdných a dvojic', sk.skupiny.join(','), 'Zuzka,Miky');
  check('  termín si pododdíl nese, prázdný ne', sk.terminy[0].skupina + ' ' + ('skupina' in sk.terminy[1]), 'Miky false');
  check('karta bez pododdílů je nemá', 'skupiny' in h.api.terminyOver([{ nazev: 'A' }]).karty[0], false);
  check('špatné opakování', /opakování/.test(h.api.terminyOver([{ nazev: 'A', terminy: [{ nazev: 'B', opakovani: -1 }] }]).chyba), true);
  const dvojite = h.api.terminyOver([{ id: 'a', nazev: 'A', terminy: [{ id: 'a', nazev: 'B' }] }]);
  check('duplicitní id se přečísluje', dvojite.karty[0].terminy[0].id !== 'a', true);
  const r = h.volej('/api/terminy', { karty: [{ nazev: 'Chata', ikona: '🏠', udaje: 'Revize kotle', terminy: [{ nazev: 'Revize', datum: '2027-03-01' }] }] });
  check('uložení: odpověď, broadcast, záloha', r.ok + ' ' + h.zpravy[0].typ + ' ' + h.ulozeni, 'true terminy 1');
  check('  karta uložená', h.state.terminy.karty[0].nazev, 'Chata');
  check('vadná data → 400', h.volej('/api/terminy', { karty: 'x' }).s, 400);
}

nadpis('3) Posun a hotovo u opakovaných');
{
  const h = build();
  check('rok dopředu', h.api.terminyPosun('2027-05-22', 12), '2028-05-22');
  check('31. 1. + měsíc = konec února', h.api.terminyPosun('2027-01-31', 1), '2027-02-28');
  check('29. 2. + rok = 28. 2.', h.api.terminyPosun('2028-02-29', 12), '2029-02-28');
  const r = h.volej('/api/terminy/:id/hotovo', {}, { id: 'eso-nobivac' });
  check('hotovo posune Nobivac o rok', r.ok + ' ' + h.state.terminy.karty[3].terminy[1].datum, 'true 2028-05-22');
  check('neopakovaný termín → chce nové datum', h.volej('/api/terminy/:id/hotovo', {}, { id: 'bmw4-stk' }).s, 400);
  check('neznámý → 404', h.volej('/api/terminy/:id/hotovo', {}, { id: 'nic' }).s, 404);
}

nadpis('4) Upozornění');
{
  const h = build();
  h.api.terminyData().karty = [{ id: 'a', nazev: 'BMW 4', terminy: [
    { id: 'stk', nazev: 'STK', datum: '2027-03-15', opakovani: 0, pozn: '' },
    { id: 'poj', nazev: 'Pojištění', datum: '2027-04-20', opakovani: 0, pozn: 'Direct' },
    { id: 'bez', nazev: 'Bez data', datum: null, opakovani: 0, pozn: '' }] }];
  check('dny do termínu', h.api.terminyDni('2027-03-15', poledne(2027, 3, 1)), 14);
  h.api.terminyKontrola(poledne(2027, 2, 28));
  check('15 dní předem ještě nic', h.push.length, 0);
  h.api.terminyKontrola(Date.UTC(2027, 2, 1, 5));   // 6:00 v Praze
  check('v noci a brzy ráno nic', h.push.length, 0);
  h.api.terminyKontrola(poledne(2027, 3, 1));
  check('14 dní předem push', h.push.join(), '📅 BMW 4: STK — Za 14 dní (15. 3. 2027)');
  h.api.terminyKontrola(poledne(2027, 3, 2));
  check('  jen jednou', h.push.length, 1);
  h.api.terminyKontrola(poledne(2027, 3, 15));
  check('v den termínu druhý', h.push[1], '📅 BMW 4: STK — Dnes (15. 3. 2027)');
  h.api.terminyKontrola(poledne(2027, 3, 16));
  check('  a pak už nic', h.push.length, 2);
  // Termín přidaný, když už je blízko / prošlý
  h.api.terminyKontrola(poledne(2027, 4, 19));
  const h3 = build();
  h3.api.terminyData().karty = [{ id: 'o', nazev: 'Očkování', skupiny: ['Miky'], terminy: [{ id: 'm', nazev: 'Tetanus', datum: '2027-03-15', opakovani: 0, pozn: '', skupina: 'Miky' }] }];
  h3.api.terminyKontrola(poledne(2027, 3, 1));
  check('upozornění řekne komu', h3.push[0], '📅 Očkování – Miky: Tetanus — Za 14 dní (15. 3. 2027)');
  check('pojistka zítra (s poznámkou)', h.push[2], '📅 BMW 4: Pojištění — Zítra (20. 4. 2027) · Direct');
  const h2 = build();
  h2.api.terminyData().karty = [{ id: 'm', nazev: 'BMW R 1300 GS', terminy: [{ id: 's', nazev: 'Servis', datum: '2026-09-10', opakovani: 12, pozn: '' }] }];
  h2.api.terminyKontrola(poledne(2026, 11, 21));
  check('prošlý termín ohlásí jednou', h2.push.join(), '📅 BMW R 1300 GS: Servis — Prošlo před 72 dny (10. 9. 2026)');
  h2.api.terminyKontrola(poledne(2026, 11, 22));
  check('  jednou', h2.push.length, 1);
  // Nové datum (obnovená STK) → upozorní se znovu
  h.state.terminy.karty[0].terminy[0].datum = '2029-03-15';
  h.api.terminyKontrola(poledne(2029, 3, 1));
  check('po obnovení nové upozornění', /15\. 3\. 2029/.test(h.push[h.push.length - 1]), true);
}

nadpis('5) Obnova ze zálohy');
{
  const h = build();
  const z = { karty: [{ id: 'x', nazev: 'Z zálohy', udaje: 'VIN: dopsané', terminy: [] }], upozorneno: { 'stk|2027-03-15|predem': 1, '': 'x' } };
  h.volej('/api/terminy/restore', { terminy: z });
  check('obnoví karty i odeslaná upozornění', h.state.terminy.karty[0].nazev + ' ' + Object.keys(h.state.terminy.upozorneno).join(), 'Z zálohy stk|2027-03-15|predem');
  h.volej('/api/terminy', { karty: [{ nazev: 'Nové' }] });
  h.volej('/api/terminy/restore', { terminy: z });
  check('po úpravě v appce záloha nepřepíše', h.state.terminy.karty[0].nazev, 'Nové');
  check('vadná záloha → 400', h.volej('/api/terminy/restore', { terminy: { karty: 5 } }).s, 400);
}

konec();
