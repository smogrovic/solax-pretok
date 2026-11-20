// Ověření: analýza nahřívání sauny — model náběhu (kontrolní hodnoty z předání),
// přefitování z vlastních měření, doladění bez dvojího dojezdu, cena saunování
// podle VT/NT (časy HDO v Praze i přes přechod letní/zimní čas), sčítání
// navazujících měření, body při výpadku spojení a hlídání relé.
const { between, fn, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('sauna – analýza');

const MIN = 60000;
const CODE = fn('function pragueTime(at) {') + '\n'
  + between('const CENIK = ', 'function spotrebaPredMesic(') + '\n'
  + between('const NAHREV_PRAHY', '// ---------- Kdy se saunování zaplo ----------');

function build({ env = {} } = {}) {
  const h = { log: [], push: [], zpravy: [] };
  h.state = {
    saunaNahrev: { bezici: null, zaznamy: [] },
    weather: { tempC: 8, vitrMs: 2, srazkyMm: 0, fetchedAt: new Date().toISOString() },
    huum: { temperature: 12, targetTemperature: 75, heating: true },
    sauna: { powerW: null, fetchedAt: null }
  };
  h.api = new Function('process', 'state', 'addLog', 'sendPushToAll', 'broadcast', 'cerstve',
    'saunaTopi', 'storeNahrevUloz', 'SAUNA_ON_W',
    CODE + '\n; return { odhadNabehu, saunaModel, saunaModelMin, SAUNA_MODEL_VYCHOZI, saunaFit, saunaFitUsek,'
      + ' saunaFitAktualni, saunaKalibrace, odhadNabehuDoladeny, saunaSkupiny, saunaSaunovani, saunaPrumery,'
      + ' saunaAnalyza, hdoNizky, hdoZTextu, HDO_NT, CENIK, nahrevStart, nahrevBezSpojeni, nahrevReleKontrola,'
      + ' nahrevVzorek, NAHREV_BODU_MAX, nahrevNavazujeNa, saunaOdhad };'
  )({ env }, h.state, t => h.log.push(t), (a, b) => h.push.push(a + ' — ' + b),
    (typ, d) => h.zpravy.push(typ), () => true, () => true, async () => {}, 500);
  return h;
}

// Umělé měření z modelu `p`: body po 2 min, plný výkon s pauzou kamen 31.–35. min,
// od cíle − 2 °C snížený výkon. Cíl „dosažen“ o `dojezd` minut po modelovém čase.
function mereni(p, { venku = 8, od = 10, cil = 75, start = Date.UTC(2026, 10, 10, 17), dojezd = 8,
                     delka = 150, sW = true, zaokr = 10 } = {}) {
  const T = t => {
    const m = p.a + p.b * venku;
    return t <= p.rozjezd ? od : m - (m - od) * Math.exp(-(t - p.rozjezd) / p.tau);
  };
  const tCil = p.rozjezd + p.tau * Math.log((p.a + p.b * venku - od) / (p.a + p.b * venku - cil));
  const body = [];
  const prahy = {};
  for (let t = 0; t <= delka; t += 2) {
    const c = Math.min(cil + 1, Math.round(T(t) * zaokr) / zaokr);
    const bod = { min: t, c, venkuC: venku };
    if (sW) bod.w = t >= 31 && t < 35 ? 3 : (c >= cil - 2 ? 2900 : 8400);
    body.push(bod);
    for (const pr of [60, 70, 80]) if (c >= pr && !prahy[pr]) prahy[pr] = { min: t, c };
  }
  prahy.cil = { min: Math.round((tCil + dojezd) * 10) / 10, c: cil };
  return { start, konec: start + (delka + 30) * MIN, duvod: 'appka', venkuC: venku, odC: od, cilC: cil, cilStartC: cil,
    zmenyCile: [{ min: 0, cilC: cil, zdroj: 'appka' }], prahy, body, maxC: Math.max(...body.map(b => b.c)) };
}

nadpis('1) Model náběhu — kontrolní hodnoty z předání (bez dojezdu)');
{
  const h = build();
  const m = h.api.SAUNA_MODEL_VYCHOZI;
  check('8,3 °C venku, z 11 na 60 °C → 59,5 min', h.api.saunaModelMin(m, 8.3, 11, 60).toFixed(1), '59.5');
  check('11,5 °C venku, z 11 na 61 °C → 60,4 min', h.api.saunaModelMin(m, 11.5, 11, 61).toFixed(1), '60.4');
  check('5,6 °C venku, z 9 na 75 °C → 85,4 min', h.api.saunaModelMin(m, 5.6, 9, 75).toFixed(1), '85.4');
  check('−20 °C venku, z 10 na 80 °C → 102 min', Math.round(h.api.saunaModelMin(m, -20, 10, 80)), 102);
  check('−20 °C venku, z 10 na 85 °C → 114 min', Math.round(h.api.saunaModelMin(m, -20, 10, 85)), 114);
  check('cíl pod startem → 0', h.api.saunaModelMin(m, 8, 50, 40), 0);
  check('cíl na termostatu → nedosažitelné (null, žádná výjimka)', h.api.saunaModelMin(m, 8, 10, 90), null);
  check('odhad = model + dojezd 8 min', (h.api.odhadNabehu(8.3, 11, 60, 0).minut - 59.5).toFixed(1), '8.0');
  check('bez měření se počítá s výchozím modelem', h.api.saunaModel() === m, true);
}

nadpis('2) Úsek na plný výkon');
{
  const h = build();
  const p = h.api.SAUNA_MODEL_VYCHOZI;
  const r = mereni(p, { cil: 75 });
  const u = h.api.saunaFitUsek(r);
  const pokles = r.body.find(b => b.min > 45 && b.w < 7000).min;
  check('konec úseku = poslední bod před poklesem pod 7 kW po 45. min', u.hend, pokles - 2);
  check('pauza kamen kolem 31. min v úseku zůstává', u.body.some(b => b.min === 32), true);
  const bezW = mereni(p, { cil: 75, sW: false });
  const ub = h.api.saunaFitUsek(bezW);
  check('staré měření bez příkonu: do cíle − 4 °C', ub.body.every(b => b.c < 71) && ub.body.length > 10, true);
  const snizeny = mereni(p, { cil: 75 });
  snizeny.zmenyCile = [{ min: 0, cilC: 80 }, { min: 40, cilC: 75 }];
  check('cíl snížený během náběhu → jen do snížení', h.api.saunaFitUsek(snizeny).hend, 40);
  const zvyseny = mereni(p, { cil: 75 });
  zvyseny.zmenyCile = [{ min: 0, cilC: 70 }, { min: 40, cilC: 75 }];
  check('  zvýšený cíl úsek nezkracuje', h.api.saunaFitUsek(zvyseny).hend, pokles - 2);
  const netopila = mereni(p);
  netopila.body.forEach(b => { b.w = 2; });
  check('kamna netopila (relé) → vynechat', h.api.saunaFitUsek(netopila), null);
  check('teplý start (odC nad 50) → vynechat', h.api.saunaFitUsek({ ...mereni(p), odC: 55 }), null);
  check('nedostalo se na 50 °C → vynechat', h.api.saunaFitUsek({ ...mereni(p), maxC: 37 }), null);
  check('teplý start z restartu → vynechat', h.api.saunaFitUsek({ ...mereni(p), teplyStart: true }), null);
  const vypadek = mereni(p);
  vypadek.body.splice(5, 0, { min: 9, c: null, bezSpojeni: true, w: 8400 });
  check('bod bez teploty (výpadek) fit nerozhodí', h.api.saunaFitUsek(vypadek).body.every(b => typeof b.c === 'number'), true);
}

nadpis('3) Přefitování');
{
  const h = build();
  const vych = h.api.SAUNA_MODEL_VYCHOZI;
  const varianty = [[8, 10], [12, 18], [3, 6], [15, 20], [6, 11], [10, 14]];
  // Data přesně z výchozího modelu i s dojezdem 8 min → nic se nemění
  const stejne = varianty.map(([v, o], i) => mereni(vych, { venku: v, od: o, start: Date.UTC(2026, 9, 10 + i, 17) }));
  const f0 = h.api.saunaFit(stejne);
  check('data podle výchozího modelu → fit se nepoužije', f0.pouzit, false);
  check('  a vyjde skoro stejný', Math.abs(f0.model.tau - vych.tau) < 3 && Math.abs(f0.model.rozjezd - vych.rozjezd) < 0.6, true);
  check('  dojezd ~8 min', Math.abs(f0.model.dojezd - 8) < 0.6, true);
  check('  b drží na 0,3', f0.model.b, 0.3);
  check('tři měření nestačí', h.api.saunaFit(stejne.slice(0, 3)).pouzit + ' ' + /málo/.test(h.api.saunaFit(stejne.slice(0, 3)).duvod), 'false true');
  // Pomalejší sauna (třeba po výměně kamenů)
  const jina = { rozjezd: 7, tau: 140, a: 145, b: 0.3, termostat: 90, dojezd: 5 };
  const pomale = varianty.map(([v, o], i) => mereni(jina, { venku: v, od: o, dojezd: 5, start: Date.UTC(2026, 9, 10 + i, 17) }));
  const f1 = h.api.saunaFit(pomale);
  check('pomalejší sauna → nový model se použije', f1.pouzit, true);
  check('  τ vyjde ~140', Math.abs(f1.model.tau - 140) < 4, true);
  check('  a vyjde ~145', Math.abs(f1.model.a - 145) < 3, true);
  check('  rozjezd ~7 min', Math.abs(f1.model.rozjezd - 7) < 0.6, true);
  check('  dojezd ~5 min', Math.abs(f1.model.dojezd - 5) < 0.6, true);
  check('  chyba na prazích klesla', f1.chybaPrahuMin.fit < f1.chybaPrahuMin.vychozi, true);
  // Appka pak počítá s novým modelem
  h.state.saunaNahrev.zaznamy = pomale;
  check('aktivní model = přefitovaný', h.api.saunaModel().tau, f1.model.tau);
  check('odhad v appce ho hlásí jako „z měření“', h.api.saunaOdhad().model.zdroj, 'mereni');
  check('  a odhad počítá s ním', h.api.odhadNabehu(8, 10, 75, 0).minut.toFixed(1),
    (h.api.saunaModelMin(f1.model, 8, 10, 75) + f1.model.dojezd).toFixed(1));
  h.state.saunaNahrev.zaznamy = stejne;
  check('bez znatelného rozdílu zůstává výchozí', h.api.saunaOdhad().model.zdroj, 'vychozi');
  // Mráz: b se uvolní až po třech nábězích pod nulou
  const sB = { rozjezd: 5.2, tau: 115, a: 138, b: 0.6, termostat: 90 };
  const sezona = [...varianty, [-10, 2], [-5, 4], [-15, 0]]
    .map(([v, o], i) => mereni(sB, { venku: v, od: o, cil: 70, start: Date.UTC(2026, 11, 1 + i, 17) }));
  const f2 = h.api.saunaFit(sezona);
  check('3 náběhy v mrazu → b se fituje', f2.bVolne + ' ' + (Math.abs(f2.model.b - 0.6) < 0.08), 'true true');
  check('2 náběhy v mrazu → b pořád 0,3', h.api.saunaFit(sezona.slice(0, -1)).model.b, 0.3);
}

nadpis('4) Doladění bez dvojího dojezdu');
{
  const h = build();
  const vych = h.api.SAUNA_MODEL_VYCHOZI;
  const z = [8, 12, 3].map((v, i) => mereni(vych, { venku: v, od: 10, start: Date.UTC(2026, 9, 1 + i, 17) }));
  const k = h.api.saunaKalibrace(z);
  check('sauna přesně podle modelu i s dojezdem → faktor 1', k.faktor, 1);
  const o = h.api.odhadNabehu(8, 10, 75, 0).minut;
  check('doladěný odhad = celý odhad × faktor', h.api.odhadNabehuDoladeny(8, 10, 75, 0, undefined, { faktor: 1.1, pouzito: true }).minut.toFixed(2),
    (o * 1.1).toFixed(2));
}

nadpis('5) Cena podle VT/NT');
{
  const h = build();
  const bodyPo2 = (doMin, w) => Array.from({ length: doMin / 2 + 1 }, (_, i) => ({ min: i * 2, c: 20 + i, w }));
  // 19. 11. 18:00 v Praze (zima, UTC+1): 6 kW dvě hodiny, VT jen 19–20 h
  const zima = { start: Date.UTC(2026, 10, 19, 17), konec: Date.UTC(2026, 10, 19, 19, 30), odC: 11, venkuC: 8, cilC: 75,
    zmenyCile: [{ min: 0, cilC: 75 }], prahy: { cil: { min: 60, c: 75 } }, body: bodyPo2(120, 6000) };
  const s = h.api.saunaSaunovani([zima]);
  check('zima: 6 kWh v NT, 6 kWh ve VT', s.kwhNt + ' ' + s.kwhVt + ' ' + s.kwh, '6 6 12');
  check('  cena = NT × 3,42394 + VT × 4,32625', s.cena, Math.round((6 * 3.42394 + 6 * 4.32625) * 10) / 10);
  check('  náběh do cíle 6 kWh, udržování 6 kWh', s.nabehKwh + ' ' + s.udrzKwh, '6 6');
  check('  náběh 60 min, saunování 60 min, celkem 120', s.nabehMin + ' ' + s.saunovaniMin + ' ' + s.celkemMin, '60 60 120');
  // Léto (UTC+2): stejný místní čas = jiný UTC; posun o hodinu by dal 12 kWh v NT
  const leto = { ...zima, start: Date.UTC(2026, 6, 15, 16), konec: Date.UTC(2026, 6, 15, 18, 30) };
  check('léto: VT se trefí i v letním čase', h.api.saunaSaunovani([leto]).kwhVt, 6);
  // Den přechodu na zimní čas (25. 10. 2026): 18:00 místního = 17:00 UTC
  const prechod = { ...zima, start: Date.UTC(2026, 9, 25, 17), konec: Date.UTC(2026, 9, 25, 19, 30) };
  check('den přechodu na zimní čas sedí', h.api.saunaSaunovani([prechod]).kwhVt, 6);
  // Interval přes hranici tarifu se dělí po 0,1 min: 18:59–19:01
  const hrana = { start: Date.UTC(2026, 10, 19, 17, 59), konec: Date.UTC(2026, 10, 19, 18, 30), odC: 11, venkuC: 8, cilC: 75,
    prahy: {}, body: [{ min: 0, c: 11, w: 6000 }, { min: 2, c: 12, w: 6000 }] };
  const sh = h.api.saunaSaunovani([hrana]);
  check('interval přes hranici tarifu: půl NT, půl VT', sh.kwhNt + ' ' + sh.kwhVt, '0.1 0.1');
  check('  bez dosaženého cíle: náběh a saunování nevíme', sh.nabehMin + ' ' + sh.saunovaniMin, 'null null');
  // Měření bez příkonu (do 10. 10.) ceny nemá
  const bezW = { ...zima, body: zima.body.map(({ w, ...b }) => b) };
  check('bez příkonu → bez ceny', h.api.saunaSaunovani([bezW]).cena, null);
  check('HDO z prostředí', JSON.stringify(build({ env: { HDO_NT: '0-6.5,7-24' } }).api.HDO_NT), '[[0,6.5],[7,24]]');
  check('  nesmysl v HDO_NT → výchozí časy', build({ env: { HDO_NT: '25-3' } }).api.HDO_NT.length, 5);
}

nadpis('6) Navazující saunování a průměry');
{
  const h = build();
  const t0 = Date.UTC(2026, 10, 12, 17);
  const bodyPo2 = (doMin, w) => Array.from({ length: doMin / 2 + 1 }, (_, i) => ({ min: i * 2, c: 20 + i, w }));
  const a = { start: t0, konec: t0 + 100 * MIN, duvod: 'casovac', odC: 16, venkuC: 10, cilC: 75,
    zmenyCile: [{ min: 0, cilC: 75 }], prahy: { cil: { min: 60, c: 75 } }, body: bodyPo2(70, 6000) };
  const b = { start: t0 + 110 * MIN, konec: t0 + 200 * MIN, duvod: 'odber', odC: 70, venkuC: 10, cilC: 75, teplyStart: true,
    zmenyCile: [{ min: 0, cilC: 75 }], prahy: { cil: { min: 4, c: 75 } }, body: bodyPo2(60, 3000) };
  const blik = { start: t0 + 300 * MIN, konec: t0 + 301 * MIN, kratke: true, prahy: {}, body: [] };
  const c = { ...a, start: t0 + 400 * MIN, konec: t0 + 500 * MIN };
  const sk = h.api.saunaSkupiny([c, blik, b, a]);
  check('do 15 min po konci = jedno saunování, bliknutí se nepočítá', sk.map(s => s.length).join(','), '2,1');
  check('zapsané `navazuje` platí i při větší mezeře', h.api.nahrevNavazujeNa(a, { start: t0 + 150 * MIN, navazuje: t0 }), true);
  const s = h.api.saunaSaunovani(sk[0]);
  check('sečte energii obou měření', s.kwh, 10);
  check('cíl podle prvního dosažení, náběh 60 min', s.nabehMin, 60);
  check('saunování do posledního topení druhého měření', s.saunovaniMin, 110);
  const radky = sk.map(x => h.api.saunaSaunovani(x));
  const p = h.api.saunaPrumery(radky);
  check('průměr ze dvou saunování', p.pocet, 2);
  check('hodina saunování navíc = udržování / doba × NT',
    p.hodinaNavicKc, Math.round(p.udrzKwh / p.saunovaniMin * 60 * 3.42394 * 10) / 10);
  const an = h.api.saunaAnalyza([a, b, blik, c]);
  check('analýza: řádky, průměry, ceník', an.saunovani.length + ' ' + !!an.prumer + ' ' + an.cenik.nt, '2 true 3.42394');
}

nadpis('7) Měření: navazování, výpadek spojení, relé');
{
  const h = build();
  const now = Date.UTC(2026, 10, 20, 18);
  h.state.saunaNahrev.zaznamy = [{ start: now - 120 * MIN, konec: now - 10 * MIN, body: [], prahy: {} }];
  h.api.nahrevStart('odber', now);
  check('nové zapnutí do 15 min po konci → navazuje', h.state.saunaNahrev.bezici.navazuje, now - 120 * MIN);
  h.state.saunaNahrev.bezici = null;
  h.state.saunaNahrev.zaznamy = [{ start: now - 120 * MIN, konec: now - 20 * MIN, body: [], prahy: {} }];
  h.api.nahrevStart('odber', now);
  check('po 20 min už ne', h.state.saunaNahrev.bezici.navazuje, undefined);
  check('strop vzorků pokryje 4 h po dvou minutách', h.api.NAHREV_BODU_MAX >= 120, true);

  // Výpadek spojení s kamny: bod bez teploty, ale s příkonem
  h.state.sauna = { powerW: 8400, fetchedAt: new Date(now + 4 * MIN).toISOString() };
  h.api.nahrevBezSpojeni(now + 4 * MIN);
  const posl = h.state.saunaNahrev.bezici.body.slice(-1)[0];
  check('výpadek: bod s příkonem a bez teploty', posl.c + ' ' + posl.w + ' ' + posl.bezSpojeni + ' ' + posl.min, 'null 8400 true 4');
  h.api.nahrevVzorek(30, now + 6 * MIN);
  check('  maximum a prahy dál z teplot', h.state.saunaNahrev.bezici.maxC, 30);

  // Relé: zapnuto z appky, měřák po 3 min pořád pod 1 kW
  const b = { start: now, duvod: 'appka', body: [{ min: 0, c: 12, w: 20 }], prahy: {} };
  h.state.huum.heating = true;
  h.state.sauna = { powerW: 15, fetchedAt: new Date(now - MIN).toISOString() };
  h.api.nahrevReleKontrola(b, 3.5);
  check('čtení měřáku z doby před zapnutím → žádný poplach', h.push.length, 0);
  h.state.sauna = { powerW: 15, fetchedAt: new Date(now + 3 * MIN).toISOString() };
  h.api.nahrevReleKontrola(b, 1.5);
  check('před 3. minutou ještě ne', h.push.length, 0);
  h.api.nahrevReleKontrola(b, 3.5);
  check('po 3 min bez odběru → upozornění', h.push.length + ' ' + /nehřeje/.test(h.push[0]), '1 true');
  h.api.nahrevReleKontrola(b, 5.5);
  check('  jen jednou', h.push.length, 1);
  const b2 = { start: now, duvod: 'appka', body: [{ min: 2, c: 14, w: 8300 }], prahy: {} };
  h.api.nahrevReleKontrola(b2, 3.5);
  check('kamna odebírala → nic', h.push.length, 1);
  const b3 = { start: now, duvod: 'odber', body: [], prahy: {} };
  h.api.nahrevReleKontrola(b3, 3.5);
  check('start z odběru se nehlídá', h.push.length, 1);
  h.state.huum.heating = false;
  h.api.nahrevReleKontrola({ start: now, duvod: 'casovac', body: [], prahy: {} }, 3.5);
  check('kamna mezitím vypnutá → nic', h.push.length, 1);
}

konec();
