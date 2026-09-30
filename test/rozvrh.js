// Rozvrh žaluzií: opakovaná pravidla místo scénářů v TaHomě.
//
// Tři pasti, kvůli kterým tahle sada existuje:
//  * Render appku při KAŽDÉM nasazení restartuje. Kdyby se čekalo na přesnou minutu
//    jako u jednorázových časovačů, ranní pravidlo by při nasazení v 6:00 tiše
//    propadlo. Dohánění ale nesmí sahat daleko, jinak by večerní pravidlo spadlo ráno.
//  * Pravidlo se smí spustit jednou za den. Tik chodí po minutě a TaHoma odpovídá
//    pomalu, takže značka „dnes už běželo" musí padnout PŘED povelem.
//  * Když jsme pryč, dům je zavřený a takový má zůstat.
const { LINES, between, suite } = require('./zdroj');

// Skutečné „sauna běží" ze serveru (kamna, nebo světlo a ≥ 60 °C), ne náhražka
const SAUNA_AKTIVNI = between('const SAUNA_BEZI_C', 'function saunaRelaceSleduj');
const saunaAktivniPro = state => new Function('state', SAUNA_AKTIVNI + '\nreturn saunaAktivni;')(state);
const { check, nadpis, konec } = suite('rozvrh žaluzií');

const CODE = between('// ---------- Rozvrh žaluzií (opakovaná pravidla místo scénářů v TaHomě) ----------',
                     '// ---------- Časovače relé');

// Pondělí 15. 9. 2026, 6:00 pražského času
const PO_6 = Date.UTC(2026, 8, 14, 4, 0);
const H = 3600000, MIN = 60000, DEN = 86400000;

function build({ auto = true, pryc = false, pocasi = {}, huum = false } = {}) {
  const h = { zlobi: null };     // cíl, na kterém TaHoma spadne
  const povely = [];
  const logy = [];
  const routy = {};
  const state = {
    weather: { sunsetMs: null, sunriseMs: null, ...pocasi },
    sauna: { lastHeatAt: 0 },
    prazdniny: null,
    zapadDelayMin: 0
  };
  const api = new Function(
    'state', 'app', 'requireAuth', 'addLog', 'broadcast', 'scheduleEvery',
    'pragueTime', 'pragueDateString', 'naMinuty', 'validTimerTime',
    'assistantControlBlinds', 'autoRunning', 'awayActive', 'huumEnabled', 'saunaAktivni', 'cz', 'actuateRelay',
    CODE + '\n; return { rozvrhDenIndex, rozvrhMinuta, rozvrhSpustit, rozvrhPopis,'
         + ' rozvrhOcisti, runBlindSchedule, saunaZahradaPoSaune, ZALUZIE_ZAVRENO, ROZVRH_DOHNAT_MS, ROZVRH_MAX,'
         + ' rozvrhOdlozeno, prazdninyPlati, prazdninyDuvod, prazdninyPayload, ROZVRH_VYCHOZI, ZAPAD_DELAY_MAX,'
         + ' lozniceZavrenoPlati, lozniceZavrenoPayload, rozvrhMigrace, rozvrhMigraceV6, rozvrhMigraceV7,'
         + ' rozvrhVychoziPoStartu, rozvrhNasadVychozi, rozvrhSerad, rozvrhPoradi, rozvrhStavTed,'
         + ' get pravidla() { return blindRules; }, set pravidla(v) { blindRules = v; },'
         + ' get savedAt() { return blindRulesAt; } };'
  )(
    state,
    { get: (c, f) => { routy['GET ' + c] = f; }, post: (c, f) => { routy['POST ' + c] = f; } },
    () => true,
    (m, level) => logy.push((level === 'error' ? 'CHYBA ' : '') + m),
    () => {},
    () => {},
    at => {
      const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date(at === undefined ? Date.now() : at));
      const g = t => Number(d.find(p => p.type === t).value);
      return { hour: g('hour') % 24, minute: g('minute') };
    },
    at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date(at === undefined ? Date.now() : at)),
    hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)),
    t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t),
    async ({ target, action, orientation }) => {
      if (h.zlobi === target) throw new Error('TaHoma neodpovídá');
      povely.push(`${target}:${action}${orientation === undefined ? '' : ':' + orientation}`);
      return `${target}: hotovo.`;
    },
    () => auto,
    () => pryc,
    huum,
    saunaAktivniPro(state),
    t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    async (key, zapnout, duvod) => {
      if (h.zlobi === key) throw new Error('Shelly neodpovídá');
      povely.push(`${key}:${zapnout ? 'on' : 'off'} (${duvod})`);
      state.devices = state.devices || {};
      state.devices[key] = { ...(state.devices[key] || {}), isOn: zapnout };
    }
  );
  return Object.assign(h, { api, povely, logy, routy, state });
}

const pravidlo = (zm = {}) => Object.assign({
  id: 1, zapnuto: true, nazev: '', dny: [true, true, true, true, true, false, false],
  kdy: { typ: 'cas', cas: '06:00' },
  kroky: [{ cil: 'Ložnice', akce: 'up', hodnota: null }],
  spustenoDne: null
}, zm);
const krok = (cil, akce = 'up', hodnota = null) => ({ cil, akce, hodnota });

const volej = (routy, cesta, telo) => {
  let out = null, kod = 200;
  const res = { json: v => { out = v; return res; }, status: c => { kod = c; return res; } };
  return Promise.resolve(routy[cesta]({ body: telo }, res)).then(() => ({ out, kod }));
};

(async () => {

nadpis('1) Který den to je');
{
  const h = build();
  check('pondělí je nula', h.api.rozvrhDenIndex(PO_6), 0);
  check('neděle je šestka', h.api.rozvrhDenIndex(PO_6 + 6 * DEN), 6);
  // Pravidlo „jen o víkendu" nesmí v pondělí spadnout
  check('pravidlo na všední dny v sobotu nespustí',
    h.api.rozvrhSpustit(pravidlo(), PO_6 + 5 * DEN), false);
  check('  a v pondělí ano', h.api.rozvrhSpustit(pravidlo(), PO_6), true);
}

nadpis('2) Čas ze slunce');
{
  // Západ ve 20:15 pražského času
  const zapad = Date.UTC(2026, 8, 14, 18, 15);
  const h = build({ pocasi: { sunsetMs: zapad, sunriseMs: Date.UTC(2026, 8, 14, 4, 30) } });
  const p = zm => pravidlo({ kdy: { typ: 'zapad', ...zm } });
  check('bez posunu sedí na západ', h.api.rozvrhMinuta(p({ posunMin: 0 }), PO_6), 20 * 60 + 15);
  check('půl hodiny před ním', h.api.rozvrhMinuta(p({ posunMin: -30 }), PO_6), 19 * 60 + 45);
  check('  a po něm', h.api.rozvrhMinuta(p({ posunMin: 45 }), PO_6), 21 * 60);
  check('východ je vlastní čas',
    h.api.rozvrhMinuta(pravidlo({ kdy: { typ: 'vychod', posunMin: 0 } }), PO_6), 6 * 60 + 30);
  // Bez počasí radši nic než povel v náhodný čas
  const bez = build();
  check('bez počasí se pravidlo nespustí', bez.api.rozvrhMinuta(p({ posunMin: 0 }), PO_6), null);
  check('  a tik ho přeskočí', bez.api.rozvrhSpustit(p({ posunMin: 0 }), PO_6), false);
}

nadpis('3) Dohánění po nasazení');
{
  const h = build();
  const p = pravidlo();
  check('přesně v čas spustí', h.api.rozvrhSpustit(p, PO_6), true);
  check('o minutu dřív ne', h.api.rozvrhSpustit(p, PO_6 - MIN), false);
  // Render restartuje při každém nasazení — pravidlo se musí dohnat
  check('deset minut po nasazení se dožene', h.api.rozvrhSpustit(p, PO_6 + 10 * MIN), true);
  check('  a v posledním okamžiku taky', h.api.rozvrhSpustit(p, PO_6 + h.api.ROZVRH_DOHNAT_MS), true);
  // Kdyby se dohánělo bez stropu, ranní pravidlo by spadlo večer
  check('o minutu později už ne', h.api.rozvrhSpustit(p, PO_6 + h.api.ROZVRH_DOHNAT_MS + MIN), false);
  check('a večer vůbec', h.api.rozvrhSpustit(p, PO_6 + 14 * H), false);
  check('dohánění je dvacetiminutové', h.api.ROZVRH_DOHNAT_MS, 20 * MIN);
}

nadpis('4) Jednou za den');
{
  const h = build();
  h.api.pravidla = [pravidlo()];
  await h.api.runBlindSchedule(PO_6);
  check('pravidlo spustí povel', h.povely.join(','), 'Ložnice:up');
  check('  a zapíše se do logu', /Rozvrh žaluzií: \(06:00\): Ložnice vytáhnout — hotovo/.test(h.logy[0]), true);
  await h.api.runBlindSchedule(PO_6 + MIN);
  check('další tik už nic', h.povely.length, 1);
  await h.api.runBlindSchedule(PO_6 + DEN);
  check('zítra znovu', h.povely.length, 2);
}
{
  // Značka musí padnout PŘED povelem: TaHoma odpovídá pomalu a další tik by
  // mezitím pustil totéž pravidlo podruhé
  const h = build();
  h.api.pravidla = [pravidlo()];
  const bezi = h.api.runBlindSchedule(PO_6);
  await h.api.runBlindSchedule(PO_6 + MIN);
  await bezi;
  check('pomalá TaHoma pravidlo nezdvojí', h.povely.length, 1);
}

nadpis('5) Kdy rozvrh mlčí');
{
  const h = build({ auto: false });
  h.api.pravidla = [pravidlo()];
  await h.api.runBlindSchedule(PO_6);
  check('na „vypnuto" se nehne nic', h.povely.length, 0);
}
{
  // Odchod dům zavřel a zaklopil — ranní „vytáhni" by ho zase otevřel
  const h = build({ pryc: true });
  h.api.pravidla = [pravidlo()];
  await h.api.runBlindSchedule(PO_6);
  check('když jsme pryč, taky ne', h.povely.length, 0);
  check('  a pravidlo si to nezapíše jako splněné', h.api.pravidla[0].spustenoDne, null);
}
{
  const h = build();
  h.api.pravidla = [pravidlo({ zapnuto: false })];
  await h.api.runBlindSchedule(PO_6);
  check('vypnuté pravidlo se přeskočí', h.povely.length, 0);
}
{
  // Výpadek TaHomy nesmí shodit tik ani zbytek pravidel
  const h = build();
  h.api.pravidla = [pravidlo(), pravidlo({ id: 2, kroky: [krok('Obývák')] })];
  await h.api.runBlindSchedule(PO_6);
  check('obě pravidla jedou', h.povely.length, 2);
}

nadpis('6) Co se pošle do TaHomy');
{
  const h = build();
  h.api.pravidla = [pravidlo({ kroky: [krok('Ložnice', 'down', 100)] })];
  await h.api.runBlindSchedule(PO_6);
  // Zatažení i naklopení jedním povelem — zřetězené by si pohyb přerušily
  check('zatáhnout a zaklopit je jeden povel', h.povely.join(','), 'Ložnice:down:100');
  const t = build();
  t.api.pravidla = [pravidlo({ kroky: [krok('Ložnice', 'tilt', 30)] })];
  await t.api.runBlindSchedule(PO_6);
  check('samotné naklopení je „orientation"', t.povely.join(','), 'Ložnice:orientation:30');
  // „Sjet do 20 %" znamená pětinu dráhy, ne zatáhnout s pootevřenými lamelami
  const pol = build();
  pol.api.pravidla = [pravidlo({ kroky: [krok('Obývák Dveře', 'poloha', 20)] })];
  await pol.api.runBlindSchedule(PO_6);
  check('poloha je „closure"', pol.povely.join(','), 'Obývák Dveře:closure:20');
  check('zavřeno je sto procent', h.api.ZALUZIE_ZAVRENO, 100);
}

nadpis('6b) Skupina kroků');
{
  // V 7:00 se obvykle stane víc věcí. Spouštěč je jeden, kroků kolik je potřeba —
  // čas se pak mění na jednom místě, ne ve třech pravidlech.
  const h = build();
  h.api.pravidla = [pravidlo({ nazev: 'Ráno', kroky: [
    krok('Ložnice'), krok('Obývák', 'down', 100), krok('Kuchyň', 'tilt', 40)
  ] })];
  await h.api.runBlindSchedule(PO_6);
  check('projedou všechny kroky', h.povely.length, 3);
  // Pořadí je to, co člověk naklikal: „vytáhni a pak zaklop" je něco jiného než obráceně
  check('  a v zadaném pořadí', h.povely.join(' | '),
    'Ložnice:up | Obývák:down:100 | Kuchyň:orientation:40');
  check('  log zmíní název i počet', /Ráno \(06:00\): .* — hotovo \(3\)/.test(h.logy[0]), true);
}
{
  // Když neodpoví jedna žaluzie, ostatní se hýbat mají
  const h = build();
  h.zlobi = 'Obývák';
  h.api.pravidla = [pravidlo({ kroky: [krok('Ložnice'), krok('Obývák'), krok('Kuchyň')] })];
  // Výjimka se musí spolknout uvnitř skupiny. Kdyby vylétla ven, shodí celý tik —
  // a tahle sada by se bez toho `catch` jen tiše ukončila uprostřed.
  await h.api.runBlindSchedule(PO_6)
    .catch(err => check('skupina výjimku nepustí ven', err.message, '(nic)'));
  check('pád prostředního kroku nezastaví zbytek', h.povely.join(','), 'Ložnice:up,Kuchyň:up');
  check('  a zapíše se jako chyba', /^CHYBA /.test(h.logy[0]), true);
  check('  se zmínkou, kolik prošlo', /2 z 3/.test(h.logy[0]), true);
  check('  a co selhalo', /Obývák/.test(h.logy[0]), true);
  await h.api.runBlindSchedule(PO_6 + MIN);
  check('neúspěšná skupina se neopakuje', h.povely.length, 2);
}

nadpis('6c) Starý tvar ze zálohy');
{
  // V telefonu může ležet záloha z doby, kdy pravidlo mělo jen jeden cíl a akci.
  // Bez převodu by se tiše zahodila.
  const h = build();
  const stare = h.api.rozvrhOcisti({
    dny: [true, true, true, true, true, false, false],
    kdy: { typ: 'cas', cas: '06:00' }, cil: 'Ložnice', akce: 'down', naklopeni: 100
  });
  check('staré pravidlo se přečte', !!stare, true);
  check('  a udělá se z něj jeden krok', stare.kroky.length, 1);
  check('  se vším, co v něm bylo',
    `${stare.kroky[0].cil}:${stare.kroky[0].akce}:${stare.kroky[0].hodnota}`, 'Ložnice:down:100');
}

nadpis('2b) Společné zpoždění po západu');
{
  // „Západ slunce" v rozvrhu neznamená přesný okamžik západu, ale západ plus jedno
  // společné zpoždění. Jinak by se posun musel přepisovat v každém pravidle zvlášť.
  const zapad = Date.UTC(2026, 8, 14, 18, 15);           // 20:15 pražského času
  const h = build({ pocasi: { sunsetMs: zapad, sunriseMs: Date.UTC(2026, 8, 14, 4, 30) } });
  const p = pravidlo({ kdy: { typ: 'zapad', posunMin: 0 } });
  check('bez zpoždění sedí na západ', h.api.rozvrhMinuta(p, PO_6), 20 * 60 + 15);
  h.state.zapadDelayMin = 20;
  check('zpoždění se přičte', h.api.rozvrhMinuta(p, PO_6), 20 * 60 + 35);
  // Posun u pravidla se počítá k tomu, ne místo toho
  check('  a posun pravidla se přidá k němu',
    h.api.rozvrhMinuta(pravidlo({ kdy: { typ: 'zapad', posunMin: -15 } }), PO_6), 20 * 60 + 20);
  // U východu by se s ním čekalo na světlo, tam nemá co dělat
  check('u východu se zpoždění nepočítá',
    h.api.rozvrhMinuta(pravidlo({ kdy: { typ: 'vychod', posunMin: 0 } }), PO_6), 6 * 60 + 30);
}
{
  const h = build();
  const { out } = await volej(h.routy, 'POST /api/zapad-delay', { minut: 45 });
  check('zpoždění se dá přenastavit', out.minut, 45);
  check('  a platí hned', h.state.zapadDelayMin, 45);
  check('nula projde', (await volej(h.routy, 'POST /api/zapad-delay', { minut: 0 })).kod, 200);
  check('hodina je maximum', h.api.ZAPAD_DELAY_MAX, 60);
  check('  víc neprojde', (await volej(h.routy, 'POST /api/zapad-delay', { minut: 65 })).kod, 400);
  // Po pěti minutách: v appce je výběr, tohle drží i cestu zvenčí
  check('mezihodnota neprojde', (await volej(h.routy, 'POST /api/zapad-delay', { minut: 7 })).kod, 400);
  check('záporné taky ne', (await volej(h.routy, 'POST /api/zapad-delay', { minut: -5 })).kod, 400);
}

nadpis('6d) Odklad kvůli sauně');
{
  // Po západu se zavře všechno kromě ložnice, když jede sauna. Ložnice se zavře
  // až 30 minut po posledním nátopu — sauna je přes ložnici a nemá se zatemnit
  // dřív, než se dosauní.
  const zapad = Date.UTC(2026, 8, 14, 18, 15);          // 20:15 pražského času
  const PO_2015 = Date.UTC(2026, 8, 14, 18, 15);
  const s = build({ pocasi: { sunsetMs: zapad } });
  const loznice = pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] });
  s.api.pravidla = [loznice];
  s.state.sauna.lastHeatAt = PO_2015 - 5 * MIN;          // sauna topila před chvílí
  await s.api.runBlindSchedule(PO_2015);
  check('při sauně se ložnice po západu nezavře', s.povely.length, 0);
  // Kdyby se to zapsalo jako splněné, ložnice by zůstala otevřená celou noc
  check('  a pravidlo zůstane na řadě', s.api.pravidla[0].spustenoDne, null);
  // Čeká se podle nastavení v Logice automatiky (výchozí 15 min), ne podle pravidla
  await s.api.runBlindSchedule(PO_2015 + 9 * MIN);
  check('14 min po nátopu ještě ne', s.povely.length, 0);
  await s.api.runBlindSchedule(PO_2015 + 11 * MIN);
  check('15 min po nátopu se zavře', s.povely.join(','), 'Ložnice:down:100');
}
{
  // Bez sauny se ložnice zavře po západu jako ostatní
  const zapad = Date.UTC(2026, 8, 14, 18, 15);
  const b = build({ pocasi: { sunsetMs: zapad } });
  b.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] })];
  await b.api.runBlindSchedule(zapad);
  check('bez sauny se zavře hned', b.povely.join(','), 'Ložnice:down:100');
  // Odpolední sauna večer nic nezdrží
  const o = build({ pocasi: { sunsetMs: zapad } });
  o.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] })];
  o.state.sauna.lastHeatAt = zapad - 4 * H;
  await o.api.runBlindSchedule(zapad);
  check('odpolední sauna večer nezdrží', o.povely.length, 1);
}
{
  // Čekání na saunu je delší než dvacetiminutové okno na dohánění — odložené
  // pravidlo se jím proto neřídí a platí do konce dne
  const zapad = Date.UTC(2026, 8, 14, 18, 15);
  const d = build({ pocasi: { sunsetMs: zapad } });
  const p = pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] });
  check('odložené pravidlo neomezuje okno na dohánění',
    d.api.rozvrhSpustit(p, zapad + 2 * H), true);
  check('  ale neodložené ano',
    d.api.rozvrhSpustit(pravidlo({ kdy: { typ: 'zapad', posunMin: 0 } }), zapad + 2 * H), false);
}

nadpis('6d2) Odklad podle kamen a světla HUUM, po sauně znovu');
{
  // Termostat nechává kamna i dvě hodiny odpočívat — odběr nerozhoduje. Čeká se,
  // dokud jsou zapnutá kamna nebo světlo, a pak 30 min od toho, co zhaslo později.
  const zapad = Date.UTC(2026, 8, 14, 18, 15);          // 20:15
  const s = build({ pocasi: { sunsetMs: zapad }, huum: true });
  s.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] })];
  s.state.huum = { heating: true, light: 1, fetchedAt: 'x' };
  s.state.sauna.lastHeatAt = zapad - 3 * H;             // odběr naposled dávno — nevadí
  s.state.saunaRelace = { od: zapad - H, konec: 0 };
  await s.api.runBlindSchedule(zapad + 90 * MIN);
  check('kamna zapnutá → ložnice čeká, i když dávno netopila', s.povely.length, 0);
  s.state.huum = { heating: false, light: 1, temperature: 70, fetchedAt: 'x' };
  await s.api.runBlindSchedule(zapad + 100 * MIN);
  check('kamna vypnutá, světlo svítí a 70 °C → pořád čeká', s.povely.length, 0);
  s.state.huum = { heating: false, light: 1, temperature: 59, fetchedAt: 'x' };
  await s.api.runBlindSchedule(zapad + 101 * MIN);
  check('  59 °C se světlem pořád běží (drží se do 58)', s.povely.length, 0);
  s.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  s.state.saunaRelace = { od: zapad - H, konec: zapad + 110 * MIN };
  await s.api.runBlindSchedule(zapad + 124 * MIN);
  check('14 min po zhasnutí ještě ne', s.povely.length, 0);
  await s.api.runBlindSchedule(zapad + 125 * MIN);
  check('15 min po tom, co zhaslo později, se zatáhne', s.povely.join(','), 'Ložnice:down:100');
  // Světlo ve studené sauně (úklid) saunování není — ložnice nečeká
  const c = build({ pocasi: { sunsetMs: zapad }, huum: true });
  c.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] })];
  c.state.huum = { heating: false, light: 1, temperature: 30, fetchedAt: 'x' };
  c.state.saunaRelace = { od: 0, konec: 0 };
  await c.api.runBlindSchedule(zapad + 5 * MIN);
  check('světlo ve studené sauně ložnici neodloží', c.povely.join(','), 'Ložnice:down:100');
}
{
  // Po restartu, dokud HUUM neodpověděl, se nezatahuje naslepo
  const zapad = Date.UTC(2026, 8, 14, 18, 15);
  const r = build({ pocasi: { sunsetMs: zapad }, huum: true });
  r.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] })];
  r.state.huum = { error: null };
  await r.api.runBlindSchedule(zapad);
  check('bez dat z kamen se čeká', r.povely.length, 0);
  r.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  await r.api.runBlindSchedule(zapad + MIN);
  check('  a s daty bez sauny se zatáhne', r.povely.length, 1);
}
{
  // Ložnice se zatáhla po západu, pak přišla sauna (příprava ložnici vytáhne).
  // Po sauně se má zatáhnout znovu — i když pravidlo dnes už jednou proběhlo.
  const zapad = Date.UTC(2026, 8, 14, 18, 15);          // 20:15
  const s = build({ pocasi: { sunsetMs: zapad }, huum: true });
  s.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 }, dny: [true, true, true, true, true, true, true],
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] })];
  s.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  await s.api.runBlindSchedule(zapad);
  check('po západu zatáhne', s.povely.length, 1);
  s.state.huum = { heating: true, light: 1, fetchedAt: 'x' };
  s.state.saunaRelace = { od: zapad + 30 * MIN, konec: 0 };
  await s.api.runBlindSchedule(zapad + 2 * H);
  check('během sauny nic', s.povely.length, 1);
  // Sauna skončila po půlnoci (vypnuto v 0:10)
  s.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  s.state.saunaRelace = { od: zapad + 30 * MIN, konec: zapad + 235 * MIN };
  await s.api.runBlindSchedule(zapad + 245 * MIN);
  check('10 min po sauně ještě ne', s.povely.length, 1);
  await s.api.runBlindSchedule(zapad + 250 * MIN);
  check('15 min po sauně znovu zatáhne (i po půlnoci)', s.povely.join(','), 'Ložnice:down:100,Ložnice:down:100');
  check('  a v Logu je, že po sauně', s.logy.some(t => /^Rozvrh žaluzií po sauně/.test(t)), true);
  await s.api.runBlindSchedule(zapad + 280 * MIN);
  check('  jen jednou', s.povely.length, 2);
  // Dnešní večer (po půlnoci je nový den) tím nepropadl
  await s.api.runBlindSchedule(zapad + 24 * H);
  check('další večer se zatáhne normálně', s.povely.length, 3);
}
{
  // Ranní sauna po večerním zatažení ložnici nezatahuje
  const zapad = Date.UTC(2026, 8, 14, 18, 15);
  const s = build({ pocasi: { sunsetMs: zapad }, huum: true });
  s.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 }, dny: [true, true, true, true, true, true, true],
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] })];
  s.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  await s.api.runBlindSchedule(zapad);
  s.state.saunaRelace = { od: zapad + 14 * H, konec: zapad + 15 * H };   // 10:15–11:15
  await s.api.runBlindSchedule(zapad + 16 * H);
  check('ranní sauna ložnici nezatáhne', s.povely.length, 1);
}

{
  // Starší záloha nese 30 min — po obnově platí jednotných 15
  const h = build();
  const o = h.api.rozvrhOcisti({ dny: [true, true, true, true, true, true, true], kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 30 }, kroky: [krok('Ložnice', 'down', 100)] });
  check('odklad ze zálohy se převede na 15 min', o.odloz.minut, 15);
}
{
  // 15 min po vypnutí kamen i světla (dřív 30)
  const zapad = Date.UTC(2026, 8, 14, 18, 15);
  const s = build({ pocasi: { sunsetMs: zapad }, huum: true });
  s.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 15 }, kroky: [krok('Ložnice', 'down', 100)] })];
  s.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  s.state.saunaRelace = { od: zapad - H, konec: zapad + 10 * MIN };
  await s.api.runBlindSchedule(zapad + 24 * MIN);
  check('14 min po sauně ještě ne', s.povely.length, 0);
  await s.api.runBlindSchedule(zapad + 25 * MIN);
  check('15 min po sauně zatáhne', s.povely.length, 1);
}

nadpis('6e) Zítra jsou prázdniny');
{
  // Prázdninový den se počítá jako neděle: pravidla Po–Pá nespadnou, víkendová ano.
  // Jinak by musel mít každý rozvrh druhou sadu dnů.
  const h = build();
  const stredaRano = PO_6 + 2 * DEN;
  check('středa je normálně všední den', h.api.rozvrhDenIndex(stredaRano), 2);
  check('  a pravidlo Po–Pá spustí', h.api.rozvrhSpustit(pravidlo(), stredaRano), true);
  h.state.prazdniny = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date(stredaRano));
  check('o prázdninách se počítá jako neděle', h.api.rozvrhDenIndex(stredaRano), 6);
  check('  pravidlo Po–Pá nespustí', h.api.rozvrhSpustit(pravidlo(), stredaRano), false);
  const vikendove = pravidlo({ dny: [false, false, false, false, false, true, true] });
  check('  víkendové ano', h.api.rozvrhSpustit(vikendove, stredaRano), true);
  const kazdyDen = pravidlo({ dny: [true, true, true, true, true, true, true] });
  check('  a „každý den" jede pořád', h.api.rozvrhSpustit(kazdyDen, stredaRano), true);
  check('jiný den prázdniny neovlivní', h.api.rozvrhDenIndex(PO_6), 0);
}
{
  const h = build();
  const { out } = await volej(h.routy, 'POST /api/prazdniny', { zapnout: true });
  check('tlačítko zapne zítřek', out.zitra, true);
  const zitra = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date(Date.now() + DEN));
  check('  a uloží jeho datum', h.state.prazdniny, zitra);
  await volej(h.routy, 'POST /api/prazdniny', { zapnout: false });
  check('druhý stisk je zruší', h.state.prazdniny, null);
  // Prošlé datum by po nasazení oživlo prázdniny z minulého týdne
  await volej(h.routy, 'POST /api/prazdniny/restore', { datum: '2020-01-01' });
  check('staré datum se ze zálohy nebere', h.state.prazdniny, null);
  await volej(h.routy, 'POST /api/prazdniny/restore', { datum: zitra });
  check('  a zítřejší ano', h.state.prazdniny, zitra);
}

nadpis('6e2) Prázdniny samy: léto a bez školy v kalendáři');
{
  const h = build();
  const den = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date(ms));
  const stredaRano = PO_6 + 2 * DEN;                 // středa 16. 9. 2026
  const cervenec = Date.UTC(2026, 6, 15, 4, 0);      // středa 15. 7.
  const srpen = Date.UTC(2026, 7, 31, 4, 0);
  const zari = Date.UTC(2026, 8, 1, 4, 0);
  check('červenec = prázdniny (léto)', h.api.prazdninyDuvod(cervenec), 'leto');
  check('  srpen až do konce', h.api.prazdninyDuvod(srpen), 'leto');
  check('  1. září už ne', h.api.prazdninyDuvod(zari), null);
  check('  a v létě se jede víkendová sada', h.api.rozvrhDenIndex(cervenec), 6);

  // Kalendář: Škola u Mikiho a Elenky
  const kal = (udalosti, zm = {}) => {
    h.state.calendar = { error: null, fetchedAt: new Date(stredaRano - 3600000).toISOString(),
      kalendare: [{ nazev: 'Family' }, { nazev: 'Miki' }, { nazev: 'Elenka' }],
      days: [{ d: den(stredaRano), udalosti }], ...zm };
  };
  const skola = kdo => ({ kalendar: kdo, nazev: 'Škola', celodenni: true });
  kal([skola('Miki'), skola('Elenka')]);
  check('oba mají Školu → normální den', h.api.prazdninyDuvod(stredaRano), null);
  kal([skola('Miki')]);
  check('jen Miki má Školu → pořád školní den', h.api.prazdninyDuvod(stredaRano), null);
  kal([skola('Elenka')]);
  check('jen Elenka → taky školní den', h.api.prazdninyDuvod(stredaRano), null);
  kal([{ kalendar: 'Family', nazev: 'Škola' }, { kalendar: 'Miki', nazev: 'Kroužek' }]);
  check('nikdo z nich Školu nemá → prázdniny', h.api.prazdninyDuvod(stredaRano), 'skola');
  check('  a jede víkendová sada', h.api.rozvrhDenIndex(stredaRano), 6);
  kal([{ kalendar: 'Miki', nazev: 'škola – výlet' }, skola('Elenka')]);
  check('„škola" malými a s diakritikou se počítá', h.api.prazdninyDuvod(stredaRano), null);
  // Nejistota = jede se jako do školy
  kal([], { error: 'iCloud neodpověděl' });
  check('kalendář v chybě → žádné prázdniny', h.api.prazdninyDuvod(stredaRano), null);
  kal([], { fetchedAt: new Date(stredaRano - 2 * DEN).toISOString() });
  check('starý kalendář → žádné prázdniny', h.api.prazdninyDuvod(stredaRano), null);
  kal([], { kalendare: [{ nazev: 'Family' }, { nazev: 'Miki' }] });
  check('chybí kalendář Elenky → žádné prázdniny', h.api.prazdninyDuvod(stredaRano), null);
  kal([], { days: [] });
  check('den mimo kalendář → žádné prázdniny', h.api.prazdninyDuvod(stredaRano), null);
  // Ruční tlačítko má pořád přednost a payload řekne proč
  h.state.calendar = null;
  h.state.prazdniny = den(stredaRano);
  check('ruční tlačítko platí dál', h.api.prazdninyDuvod(stredaRano), 'rucne');
  const pl = h.api.prazdninyPayload(stredaRano - DEN);
  check('payload: zítra ručně i s důvodem', pl.zitra + ' ' + pl.zitraDuvod, 'true rucne');
  h.state.prazdniny = null;
  check('payload v létě: zítra léto', h.api.prazdninyPayload(cervenec).zitraDuvod, 'leto');
}

nadpis('6e3) Ráno dětí a ložnice jako pravidla rozvrhu');
{
  // Výchozí rozvrh; čtvrtek 17. 9. 2026 je školní den (Praha = UTC+2)
  const CT = (h, m = 0) => Date.UTC(2026, 8, 17, h - 2, m);
  const vychozi = (pocasi = {}) => { const h = build({ pocasi }); h.api.rozvrhNasadVychozi(); return h; };
  const deti = povely => povely.filter(x => /^(Miky|Elenka|Ložnice):/.test(x));
  {
    const d = vychozi({ sunriseMs: CT(6, 10) });
    const r = d.api.pravidla.find(p => p.nazev === 'Děti ráno');
    check('„Děti ráno": Po–Pá, východ −15, nejdřív 6:40', r.dny.join(',') + ' ' + JSON.stringify(r.kdy),
      'true,true,true,true,true,false,false {"typ":"vychod","posunMin":-15,"nejdrive":"06:40"}');
    check('  popis v Logu to řekne', d.api.rozvrhPopis(r).startsWith('Děti ráno (východ slunce -15 min, nejdřív 06:40)'), true);
    await d.api.runBlindSchedule(CT(6, 39));
    check('východ 6:10 → v 6:39 děti ještě ne', deti(d.povely).length, 0);
    await d.api.runBlindSchedule(CT(6, 40));
    check('  v 6:40 na 50 %', deti(d.povely).join(' | '), 'Miky:orientation:50 | Elenka:orientation:50');
    await d.api.runBlindSchedule(CT(6, 59));
    check('  v 6:59 nic dalšího', deti(d.povely).length, 2);
    await d.api.runBlindSchedule(CT(7, 0));
    check('  v 7:00 na 25 % („Děti po ránu")', deti(d.povely).slice(2).join(' | '), 'Miky:orientation:25 | Elenka:orientation:25');
    await d.api.runBlindSchedule(CT(10, 0));
    check('  v 10:00 už jen ložnice na 25 %', deti(d.povely).slice(4).join(' | '), 'Ložnice:orientation:25');
    const pred = d.povely.length;
    await d.api.runBlindSchedule(CT(12, 0));
    check('  a pak nic — nic se nedrží', d.povely.length, pred);
  }
  {
    // Pozdní východ (zima): 7:20 → 15 min předem = 7:05, ne dřív
    const d = vychozi({ sunriseMs: CT(7, 20) });
    await d.api.runBlindSchedule(CT(7, 4));
    check('východ 7:20 → v 7:04 ještě ne', deti(d.povely).length, 0);
    await d.api.runBlindSchedule(CT(7, 5));
    check('  v 7:05 ano (50 %)', deti(d.povely).join(' | '), 'Miky:orientation:50 | Elenka:orientation:50');
    await d.api.runBlindSchedule(CT(7, 19));
    check('  25 % ne v 7:00, ale až při východu (7:20) — vždycky po 50 %', deti(d.povely).length, 2);
    await d.api.runBlindSchedule(CT(7, 20));
    check('  v 7:20 na 25 %', deti(d.povely).slice(2).join(' | '), 'Miky:orientation:25 | Elenka:orientation:25');
    const bez = build();
    check('bez počasí platí 6:40', bez.api.rozvrhMinuta({ kdy: { typ: 'vychod', posunMin: -15, nejdrive: '06:40' } }, CT(6)), 400);
  }
  {
    // Víkend = prázdniny: jen 10:00, děti i ložnice 25 %
    const so = vychozi();
    await so.api.runBlindSchedule(Date.UTC(2026, 8, 19, 8, 0));   // sobota 19. 9., 10:00
    check('sobota 10:00: děti i ložnice 25 %', deti(so.povely).join(' | '),
      'Miky:orientation:25 | Elenka:orientation:25 | Ložnice:orientation:25');
    const pr = vychozi({ sunriseMs: Date.UTC(2026, 6, 15, 3, 0) });
    await pr.api.runBlindSchedule(Date.UTC(2026, 6, 15, 4, 45));  // prázdninová středa 6:45
    check('prázdniny: ráno se děti nehýbou', deti(pr.povely).length, 0);
    await pr.api.runBlindSchedule(Date.UTC(2026, 6, 15, 8, 0));   // 10:00
    check('  v 10:00 děti i ložnice 25 %', deti(pr.povely).join(' | '),
      'Miky:orientation:25 | Elenka:orientation:25 | Ložnice:orientation:25');
    check('auto prázdniny o víkendu neplatí', so.api.prazdninyDuvod(Date.UTC(2026, 6, 18, 8, 0)), null);
    so.state.prazdniny = '2026-07-18';
    check('  ruční tlačítko o víkendu ano', so.api.prazdninyDuvod(Date.UTC(2026, 6, 18, 8, 0)), 'rucne');
  }
  {
    // Pozastavené a smazané pravidlo nic nedělá
    const d = vychozi();
    d.api.pravidla.find(p => p.nazev === 'Víkend a prázdniny').zapnuto = false;
    await d.api.runBlindSchedule(Date.UTC(2026, 8, 19, 8, 0));
    check('pozastavené „Víkend a prázdniny" nic nepošle', deti(d.povely).length, 0);
  }
}
{
  // Zavřená ložnice: ráno ji nic neotevře
  const STREDA = Date.UTC(2026, 6, 15, 8, 0);
  const h = build();
  h.state.lozniceZavrenoRano = '2026-07-15';
  check('zavřená ložnice platí to ráno', h.api.lozniceZavrenoPlati(STREDA), true);
  check('  v poledne už ne', h.api.lozniceZavrenoPlati(STREDA + 2 * H), false);
  h.api.pravidla = [pravidlo({ dny: [true, true, true, true, true, true, true], kdy: { typ: 'cas', cas: '08:00' },
    kroky: [krok('Ložnice', 'up'), krok('Kuchyň', 'up')] }),
    pravidlo({ id: 2, dny: [true, true, true, true, true, true, true], kdy: { typ: 'cas', cas: '08:05' },
    kroky: [krok('Ložnice', 'down', 100)] }),
    pravidlo({ id: 3, dny: [false, false, false, false, false, true, true], kdy: { typ: 'cas', cas: '10:00' },
    kroky: [krok('Miky', 'tilt', 25), krok('Ložnice', 'tilt', 25)] })];
  await h.api.runBlindSchedule(STREDA - 2 * H);        // 8:00
  await h.api.runBlindSchedule(STREDA - 2 * H + 5 * MIN);
  check('krok „Ložnice nahoru" se přeskočí, ostatní jedou, zatažení taky', h.povely.join(' | '),
    'Kuchyň:up | Ložnice:down:100');
  await h.api.runBlindSchedule(STREDA);
  check('prázdninové 10:00 ložnici vynechá, děti ne', h.povely.slice(2).join(' | '), 'Miky:orientation:25');
}
{
  // Tlačítko: stisk večer platí pro zítřek, po půlnoci pro dnešek
  const h = build();
  const puvodni = Date.now;
  Date.now = () => Date.UTC(2026, 8, 15, 20, 0);        // 22:00 Praha, úterý 15. 9.
  let r = await volej(h.routy, 'POST /api/loznice-zavreno', { zapnout: true });
  check('stisk ve 22:00 → zítřejší ráno', h.state.lozniceZavrenoRano, '2026-09-16');
  check('  a ložnice se hned zatáhne', h.povely.slice(-1)[0], 'ložnice:down:100');
  check('  appka ví, že je zapnuto', r.out.aktivni, true);
  Date.now = () => Date.UTC(2026, 8, 16, 4, 0);         // 6:00 Praha
  await volej(h.routy, 'POST /api/loznice-zavreno', { zapnout: true });
  check('stisk v 6:00 → dnešní ráno', h.state.lozniceZavrenoRano, '2026-09-16');
  const pred = h.povely.length;
  r = await volej(h.routy, 'POST /api/loznice-zavreno', { zapnout: false });
  check('vypnutí jen zruší, žaluzií se nedotkne', h.povely.length + ' ' + h.state.lozniceZavrenoRano + ' ' + r.out.aktivni, pred + ' null false');
  await volej(h.routy, 'POST /api/loznice-zavreno/restore', { datum: '2020-01-01' });
  check('prošlé datum ze zálohy se nevezme', h.state.lozniceZavrenoRano, null);
  Date.now = puvodni;
}
{
  // Návrat z „jsme pryč" ráno: zavřenou ložnici neotevře
  const h = build();
  h.api.pravidla = [pravidlo({ dny: [true, true, true, true, true, true, true], kdy: { typ: 'cas', cas: '07:00' },
    kroky: [krok('Ložnice', 'tilt', 30), krok('Kuchyň', 'up')] })];
  h.state.lozniceZavrenoRano = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date(PO_6));
  await h.api.rozvrhStavTed(PO_6 + 2 * H);   // 8:00
  check('návrat domů zavřenou ložnici neotevře', h.povely.join(' | '), 'Kuchyň:up');
}
{
  // Volič v Logice automatiky: 5–15 min po konci sauny (ložnice i zahrada)
  const zapad = Date.UTC(2026, 8, 14, 18, 15);
  const s = build({ pocasi: { sunsetMs: zapad }, huum: true });
  s.api.pravidla = [pravidlo({ kdy: { typ: 'zapad', posunMin: 0 },
    odloz: { typ: 'sauna', minut: 15 }, kroky: [krok('Ložnice', 'down', 100)] })];
  const ok = await volej(s.routy, 'POST /api/sauna-po', { minut: 5 });
  check('nastavení 5 min se uloží', ok.out.minut + ' ' + s.state.saunaPoMin, '5 5');
  check('  a pravidlo s odkladem to ukáže', s.api.pravidla[0].odloz.minut, 5);
  check('  i s logem', s.logy.some(t => /5 min po konci saunování/.test(t)), true);
  check('mimo 5–15 neprojde', (await volej(s.routy, 'POST /api/sauna-po', { minut: 20 })).kod
    + ' ' + (await volej(s.routy, 'POST /api/sauna-po', { minut: 4 })).kod + ' ' + s.state.saunaPoMin, '400 400 5');
  s.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  s.state.saunaRelace = { od: zapad - H, konec: zapad + 30 * MIN, zahrada: true, zahradaZhasnuta: false };
  s.state.devices = { lightDole: { isOn: true } };
  await s.api.runBlindSchedule(zapad + 34 * MIN);
  check('s 5 min: za 4 min nic', s.povely.join(), '');
  await s.api.runBlindSchedule(zapad + 35 * MIN);
  check('  za 5 min ložnice i zahrada', s.povely.slice().sort().join(' | '), 'Ložnice:down:100 | lightDole:off (po sauně)');
}
{
  // Po sauně zhasne zahradu dole — 15 min po konci, stejně jako se zatahuje ložnice
  const KONEC = PO_6;
  const saunovani = (zm = {}) => ({ od: KONEC - H, konec: KONEC, loznice: true, svetla: true,
    zahrada: true, zahradaZhasnuta: false, ...zm });
  const h = build({ huum: true });
  h.state.huum = { heating: false, light: 0, temperature: 55, fetchedAt: 'x' };
  h.state.devices = { lightDole: { isOn: true } };
  h.state.saunaRelace = saunovani();
  await h.api.runBlindSchedule(KONEC + 14 * MIN);
  check('14 min po konci sauny zahrada ještě svítí', h.povely.join(), '');
  await h.api.runBlindSchedule(KONEC + 15 * MIN);
  check('15 min po konci zhasne', h.povely.join(), 'lightDole:off (po sauně)');
  check('  a v Logu je proč', h.logy.some(t => /zahrada dole zhasnuta/.test(t)), true);
  await h.api.runBlindSchedule(KONEC + 20 * MIN);
  check('  jen jednou', h.povely.length, 1);
  const n = build({ huum: true });
  n.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  n.state.devices = { lightDole: { isOn: true } };
  n.state.saunaRelace = saunovani({ zahrada: false });
  await n.api.runBlindSchedule(KONEC + 30 * MIN);
  check('zahradu nerozsvítila sauna → nechá ji být', n.povely.join(), '');
  const b = build({ huum: true });
  b.state.huum = { heating: false, light: 1, temperature: 70, fetchedAt: 'x' };
  b.state.devices = { lightDole: { isOn: true } };
  b.state.saunaRelace = saunovani();
  await b.api.runBlindSchedule(KONEC + 30 * MIN);
  check('sauna zase běží (světlo, 70 °C) → nezhasne', b.povely.join(), '');
  const v = build({ huum: true, auto: false });
  v.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  v.state.devices = { lightDole: { isOn: true } };
  v.state.saunaRelace = saunovani();
  await v.api.runBlindSchedule(KONEC + 30 * MIN);
  check('vypnutá automatika → nezhasne (jako ložnice)', v.povely.join(), '');
  const r = build({ huum: true });
  r.state.huum = { heating: false, light: 0, fetchedAt: 'x' };
  r.state.devices = { lightDole: { isOn: false } };
  r.state.saunaRelace = saunovani();
  await r.api.runBlindSchedule(KONEC + 30 * MIN);
  check('ručně zhasnutá → žádný povel, jen se označí', r.povely.join() + ' ' + r.state.saunaRelace.zahradaZhasnuta, ' true');
}
{
  // Migrace v7: Obývák Dveře po západu 20 → 15 %, jen výchozí hodnota
  const poZapadu = hodnota => pravidlo({ id: 1, nazev: 'Po západu', kdy: { typ: 'zapad', posunMin: 0 },
    kroky: [krok('Kuchyň', 'down', 100), krok('Obývák Dveře', 'poloha', hodnota)] });
  const h = build();
  h.state.rozvrhVerze = 6;
  h.api.pravidla = [poZapadu(20)];
  check('v7: dveře po západu 20 → 15 %', h.api.rozvrhMigraceV7(20000) + ' ' + h.api.pravidla[0].kroky[1].hodnota, 'true 15');
  check('  razítko se posune', h.api.savedAt, 20000);
  check('  verze 7', h.state.rozvrhVerze, 7);
  check('  druhé volání nic', h.api.rozvrhMigraceV7(21000), false);
  const u = build();
  u.state.rozvrhVerze = 6;
  u.api.pravidla = [poZapadu(30)];
  check('vlastní hodnota (30 %) zůstane', u.api.rozvrhMigraceV7(20000) + ' ' + u.api.pravidla[0].kroky[1].hodnota, 'false 30');
  check('  ale verze se zapíše', u.state.rozvrhVerze, 7);
}
{
  // Migrace v6: jednou znovu celý doporučený rozvrh, i přes vlastní úpravy
  const h = build();
  h.state.rozvrhVerze = 5;
  h.api.pravidla = [pravidlo({ id: 1, nazev: 'Moje vlastní' }), pravidlo({ id: 2, nazev: 'Garáž' })];
  check('v6 nahraje doporučený rozvrh', h.api.rozvrhMigraceV6(12000), true);
  check('  celý a jen ten', h.api.pravidla.map(p => p.nazev).sort().join(','),
    h.api.ROZVRH_VYCHOZI.map(p => p.nazev).sort().join(','));
  check('  razítko se posune (záloha z telefonu ho nepřepíše)', h.api.savedAt, 12000);
  check('  verze 7 (výchozí rozvrh je už po v7)', h.state.rozvrhVerze, 7);
  check('  a je to v logu', h.logy.some(t => /znovu nahrán doporučený rozvrh/.test(t)), true);
  h.api.pravidla = h.api.pravidla.slice(1);
  check('druhý start už nic nepřepíše', h.api.rozvrhMigraceV6(13000), false);
  check('  úpravy po v6 zůstanou', h.api.pravidla.length, h.api.ROZVRH_VYCHOZI.length - 1);
  h.api.rozvrhMigrace(14000);
  check('starší migrace verzi nesníží', h.state.rozvrhVerze, 7);
  const e = build();
  e.state.rozvrhVerze = 5;
  e.api.pravidla = [];
  check('smazaný (prázdný) rozvrh zůstane prázdný', e.api.rozvrhMigraceV6(12000) + ' ' + e.api.pravidla.length, 'false 0');
  check('  ale verze se zapíše', e.state.rozvrhVerze, 6);
  const n = build();
  n.api.rozvrhNasadVychozi();
  check('nahrání doporučeného dá rovnou verzi 7', n.state.rozvrhVerze, 7);
}
{
  // Migrace v1: jen přesně výchozí staré skupiny
  const VIKEND = [false, false, false, false, false, true, true];
  const PRAC = [true, true, true, true, true, false, false];
  const pokoje = (zm = {}) => pravidlo({ id: 9, nazev: 'Pokoje', dny: VIKEND, kdy: { typ: 'cas', cas: '10:00' },
    kroky: [krok('Elenka', 'tilt', 50), krok('Miky', 'tilt', 50)], ...zm });
  const h = build();
  h.state.rozvrhVerze = 5;
  h.api.pravidla = [pravidlo({ id: 1 }), pokoje()];
  check('výchozí „Pokoje" se smaže', h.api.rozvrhMigrace(5000) + ' ' + h.api.pravidla.map(p => p.id).join(','), 'true 1');
  check('  a razítko se posune (záloha ji nevrátí)', h.api.savedAt, 5000);
  check('druhý start už nic', h.api.rozvrhMigrace(6000), false);
  const u = build();
  u.state.rozvrhVerze = 5;
  u.api.pravidla = [pokoje({ kroky: [krok('Elenka', 'tilt', 30), krok('Miky', 'tilt', 30)] })];
  check('upravená „Pokoje" zůstane', u.api.rozvrhMigrace() + ' ' + u.api.pravidla.length, 'false 1');
  const m = build();
  m.state.rozvrhVerze = 5;
  m.api.pravidla = [
    pravidlo({ id: 1, nazev: 'Ráno pokoje', dny: PRAC, kdy: { typ: 'cas', cas: '06:40' },
      kroky: [krok('Miky', 'tilt', 50), krok('Elenka', 'tilt', 50)] }),
    pravidlo({ id: 2, nazev: 'Dopoledne', dny: PRAC, kdy: { typ: 'cas', cas: '08:00' },
      kroky: [krok('Miky', 'tilt', 25), krok('Elenka', 'tilt', 25), krok('Hosté', 'tilt', 25),
        krok('Kuchyň', 'tilt', 25), krok('Obývák Okno', 'tilt', 25), krok('Obývák Dveře', 'up')] }),
    pravidlo({ id: 3, nazev: 'Ráno pokoje', dny: PRAC, kdy: { typ: 'cas', cas: '07:00' },
      kroky: [krok('Miky', 'tilt', 50), krok('Elenka', 'tilt', 50)] })
  ];
  m.api.rozvrhMigrace(7000);
  check('výchozí „Ráno pokoje" pryč, upravené (7:00) zůstane', m.api.pravidla.map(p => p.id).sort().join(','), '2,3');
  check('„Dopoledne" bez dětí', m.api.pravidla.find(p => p.id === 2).kroky.map(k => k.cil).join(','), 'Hosté,Kuchyň,Obývák Okno,Obývák Dveře');
}
{
  // Migrace v2: do uloženého rozvrhu se jednou doplní skupiny dětí
  const h = build();
  h.api.pravidla = [pravidlo({ id: 1, nazev: 'Garáž' })];
  check('doplní se', h.api.rozvrhMigrace(9000), true);
  check('  děti ráno a po ránu, ložnice a hosté, víkend',
    h.api.pravidla.map(p => p.nazev).filter(n => n !== 'Garáž').sort().join(','), 'Děti po ránu,Děti ráno,Ložnice a hosté,Víkend a prázdniny');
  check('  a verze se zapíše', h.state.rozvrhVerze, 5);
  h.api.pravidla = h.api.pravidla.filter(p => p.nazev !== 'Děti ráno');   // smazal si je
  check('smazané se znovu nedoplní', h.api.rozvrhMigrace(9500), false);
  const e = build();
  e.api.pravidla = [];
  check('prázdný rozvrh (smazaný) nic nedostane', e.api.rozvrhMigrace(9000) + ' ' + e.api.pravidla.length, 'false 0');
  const x = build();
  x.api.pravidla = [pravidlo({ id: 1, nazev: 'Děti ráno' })];
  x.api.rozvrhMigrace(9000);
  check('stejně pojmenovanou skupinu nezdvojí', x.api.pravidla.filter(p => p.nazev === 'Děti ráno').length, 1);
}

{
  // Migrace v3: uložená „Děti ráno" (50 %) → 25 %, „Děti dopoledne" → jen ložnice
  const PRAC = [true, true, true, true, true, false, false];
  const h = build();
  h.state.rozvrhVerze = 2;
  h.api.pravidla = [
    pravidlo({ id: 1, nazev: 'Děti ráno', dny: PRAC, kdy: { typ: 'vychod', posunMin: -15, nejdrive: '06:40' },
      kroky: [krok('Miky', 'tilt', 50), krok('Elenka', 'tilt', 50)] }),
    pravidlo({ id: 2, nazev: 'Děti dopoledne', dny: PRAC, kdy: { typ: 'cas', cas: '10:00' },
      kroky: [krok('Miky', 'tilt', 25), krok('Elenka', 'tilt', 25)] })
  ];
  check('migrace v3 proběhne', h.api.rozvrhMigrace(11000), true);
  check('  děti ráno 50 % (v4) a přibude „Děti po ránu"', h.api.pravidla.find(p => p.id === 1).kroky.map(k => k.hodnota).join(',')
    + ' ' + h.api.pravidla.some(p => p.nazev === 'Děti po ránu'), '50,50 true');
  const lz = h.api.pravidla.find(p => p.id === 2);
  // v3 z ní udělá „Ložnice dopoledne"; Hosty v5 přidá jen s převedeným „Dopoledne" (tady není)
  check('  z „Děti dopoledne" je „Ložnice dopoledne" jen s ložnicí', lz.nazev + ': ' + lz.kroky.map(k => k.cil + ' ' + k.hodnota).join(','), 'Ložnice dopoledne: Ložnice 25');
  check('  podruhé nic', h.api.rozvrhMigrace(12000), false);
  const u = build();
  u.state.rozvrhVerze = 2;
  u.api.pravidla = [pravidlo({ id: 3, nazev: 'Děti dopoledne', dny: PRAC, kdy: { typ: 'cas', cas: '10:00' },
    kroky: [krok('Miky', 'tilt', 25), krok('Hosté', 'tilt', 25)] })];
  u.api.rozvrhMigrace(11000);
  const up = u.api.pravidla.find(p => p.id === 3);
  check('ručně předělané „Děti dopoledne" zůstane', up.nazev + ' ' + up.kroky.length, 'Děti dopoledne 2');
}

{
  // „Dopoledne" v 7:00, nejdřív při východu; Hosté až v 10:00 s ložnicí
  const CT = (h, m = 0) => Date.UTC(2026, 8, 17, h - 2, m);   // čtvrtek, školní den
  const vychozi = pocasi => { const h = build({ pocasi }); h.api.rozvrhNasadVychozi(); return h; };
  const obyvak = p => p.filter(x => /^(Kuchyň|Obývák|Hosté)/.test(x));
  const d = vychozi({ sunriseMs: CT(6, 55) });
  await d.api.runBlindSchedule(CT(6, 59));
  check('východ 6:55 → dopoledne v 6:59 ještě ne', obyvak(d.povely).length, 0);
  await d.api.runBlindSchedule(CT(7, 0));
  check('  v 7:00 kuchyň a obývák, bez Hostů', obyvak(d.povely).join(' | '), 'Kuchyň:orientation:25 | Obývák Okno:orientation:25 | Obývák Dveře:up');
  await d.api.runBlindSchedule(CT(10, 0));
  check('  v 10:00 Hosté s ložnicí', d.povely.filter(x => /^(Ložnice|Hosté)/.test(x)).join(' | '), 'Ložnice:orientation:25 | Hosté:orientation:25');
  const z = vychozi({ sunriseMs: CT(7, 30) });
  await z.api.runBlindSchedule(CT(7, 29));
  check('východ 7:30 → v 7:29 ještě ne', obyvak(z.povely).length, 0);
  await z.api.runBlindSchedule(CT(7, 30));
  check('  až při východu', obyvak(z.povely).length, 3);
  // Zavřená ložnice: Hosté jedou, ložnice ne
  const l = vychozi({ sunriseMs: CT(6, 55) });
  l.state.lozniceZavrenoRano = '2026-09-17';
  await l.api.runBlindSchedule(CT(10, 0));
  check('zavřená ložnice: v 10:00 jen Hosté', l.povely.filter(x => /^(Ložnice|Hosté)/.test(x)).join(' | '), 'Hosté:orientation:25');
}
{
  // Migrace v5
  const PRAC = [true, true, true, true, true, false, false];
  const dopoledne = (zm = {}) => pravidlo({ id: 1, nazev: 'Dopoledne', dny: PRAC, kdy: { typ: 'cas', cas: '08:00' },
    kroky: [krok('Hosté', 'tilt', 25), krok('Kuchyň', 'tilt', 25), krok('Obývák Okno', 'tilt', 25), krok('Obývák Dveře', 'up')], ...zm });
  const lozDop = () => pravidlo({ id: 2, nazev: 'Ložnice dopoledne', dny: PRAC, kdy: { typ: 'cas', cas: '10:00' },
    kroky: [krok('Ložnice', 'tilt', 25)] });
  const h = build();
  h.state.rozvrhVerze = 4;
  h.api.pravidla = [dopoledne(), lozDop(), pravidlo({ id: 3, nazev: 'Děti po ránu' })];
  check('migrace v5 proběhne', h.api.rozvrhMigrace(13000), true);
  const d = h.api.pravidla.find(p => p.id === 1), l = h.api.pravidla.find(p => p.id === 2);
  check('  „Dopoledne" v 7:00 nebo při východu, bez Hostů', JSON.stringify(d.kdy) + ' ' + d.kroky.map(k => k.cil).join(','),
    '{"typ":"vychod","posunMin":0,"nejdrive":"07:00"} Kuchyň,Obývák Okno,Obývák Dveře');
  check('  „Ložnice dopoledne" → „Ložnice a hosté"', l.nazev + ': ' + l.kroky.map(k => k.cil).join(','), 'Ložnice a hosté: Ložnice,Hosté');
  check('  podruhé nic', h.api.rozvrhMigrace(14000), false);
  // Bez „Ložnice dopoledne" se Hosté nesmí ztratit
  const b = build();
  b.state.rozvrhVerze = 4;
  b.api.pravidla = [dopoledne(), pravidlo({ id: 3, nazev: 'Děti po ránu' })];
  b.api.rozvrhMigrace(13000);
  check('bez ložnicové skupiny se „Ložnice a hosté" přidá', b.api.pravidla.some(p => p.nazev === 'Ložnice a hosté'), true);
  // Ručně předělané zůstane
  const u = build();
  u.state.rozvrhVerze = 4;
  u.api.pravidla = [dopoledne({ kdy: { typ: 'cas', cas: '07:30' } }), lozDop(), pravidlo({ id: 3, nazev: 'Děti po ránu' })];
  u.api.rozvrhMigrace(13000);
  const ud = u.api.pravidla.find(p => p.id === 1), ul = u.api.pravidla.find(p => p.id === 2);
  check('upravené „Dopoledne" (7:30) zůstane i s Hosty', ud.kdy.cas + ' ' + ud.kroky.length, '07:30 4');
  check('  a Hosté se pak do 10:00 nepřidají (byli by dvakrát)', ul.nazev + ' ' + ul.kroky.length, 'Ložnice dopoledne 1');
}

nadpis('6f) Předvyplněný rozvrh');
{
  const h = build();
  check('je tam devět skupin', h.api.ROZVRH_VYCHOZI.length, 9);
  // Nasazuje se až po obnově z úložiště, ne při startu — jinak by zálohu jen přepsalo
  check('na prázdném serveru se nasadí', h.api.rozvrhVychoziPoStartu(), true);
  check('  a je jich devět', h.api.pravidla.length, 9);
  check('podruhé už ne', h.api.rozvrhVychoziPoStartu(), false);
  // Kdyby výchozí pravidlo neprošlo vlastní validací, tiše by se do rozvrhu nedostalo
  check('všechna projdou validací',
    h.api.ROZVRH_VYCHOZI.every(p => !!h.api.rozvrhOcisti(p)), true);
  check('  a mají razítko nula', h.api.savedAt, 0);
  // Kdo si všechna pravidla smaže, nedostane je po nasazení zpátky
  {
    const smazane = build();
    await volej(smazane.routy, 'POST /api/blinds/schedule/restore', { savedAt: Date.now(), rules: [] });
    check('po smazaném rozvrhu se předvyplnění nevrací', smazane.api.rozvrhVychoziPoStartu(), false);
  }
  const podle = jm => h.api.pravidla.find(p => p.nazev === jm);
  check('děti mají ve výchozím rozvrhu vlastní skupiny',
    h.api.ROZVRH_VYCHOZI.filter(p => p.kroky.some(k => k.cil === 'Miky') && p.kroky.every(k => k.akce === 'tilt')).map(p => p.nazev).join(','),
    'Děti ráno,Děti po ránu,Víkend a prázdniny');
  check('dopoledne bez dětí a bez Hostů, v 7:00 nebo při východu', podle('Dopoledne').kroky.map(k => k.cil).join(',') + ' ' + JSON.stringify(podle('Dopoledne').kdy),
    'Kuchyň,Obývák Okno,Obývák Dveře {"typ":"vychod","posunMin":0,"nejdrive":"07:00"}');
  check('Hosté v 10:00 s ložnicí', podle('Ložnice a hosté').kroky.map(k => k.cil).join(',') + ' ' + podle('Ložnice a hosté').kdy.cas, 'Ložnice,Hosté 10:00');
  check('garáž se zavírá ve 23:00 každý den',
    podle('Garáž').kdy.cas + ' ' + podle('Garáž').dny.filter(Boolean).length, '23:00 7');
  // Zpoždění je v nastavení, ne v pravidle — jinak by se měnilo v každém zvlášť
  check('po západu nemá vlastní posun', podle('Po západu').kdy.posunMin, 0);
  check('  a dveře sjedou do 15 %',
    podle('Po západu').kroky.filter(k => k.akce === 'poloha').map(k => k.cil + ':' + k.hodnota).join(''),
    'Obývák Dveře:15');
  check('ložnice má odklad na saunu 15 min', podle('Ložnice po západu').odloz.minut, 15);
}

nadpis('6f2) Chronologické pořadí');
{
  // V appce má rozvrh stát v pořadí, ve kterém se odehraje — ne v tom, jak pravidla
  // vznikla. Čas u slunce se přes rok posouvá o hodiny, takže se to musí rovnat
  // pořád, ne jen při uložení.
  const zapad = Date.UTC(2026, 8, 14, 18, 15);        // 20:15 pražského času
  const h = build({ pocasi: { sunsetMs: zapad, sunriseMs: Date.UTC(2026, 8, 14, 4, 30) } });
  h.api.pravidla = [
    pravidlo({ id: 1, nazev: 'večer', kdy: { typ: 'zapad', posunMin: 0 } }),
    pravidlo({ id: 2, nazev: 'ráno', kdy: { typ: 'cas', cas: '06:40' } }),
    pravidlo({ id: 3, nazev: 'garáž', kdy: { typ: 'cas', cas: '23:00' } }),
    pravidlo({ id: 4, nazev: 'východ', kdy: { typ: 'vychod', posunMin: 0 } })
  ];
  check('seřadí se podle času', h.api.rozvrhSerad(PO_6).map(p => p.nazev).join(','),
    'východ,ráno,večer,garáž');
  // V prosinci zapadá v 16:00 a večerní pravidlo je najednou před garáží i před
  // osmou večerní — proto se řadí podle dneška, ne jednou provždy
  h.state.weather.sunsetMs = Date.UTC(2026, 11, 14, 15, 0);   // 16:00
  h.api.pravidla.push(pravidlo({ id: 5, nazev: 'podvečer', kdy: { typ: 'cas', cas: '17:00' } }));
  check('  a po posunu západu znovu', h.api.rozvrhSerad(PO_6).map(p => p.nazev).join(','),
    'východ,ráno,večer,podvečer,garáž');
  // Bez počasí se nesmí nic zhroutit — pořadí je pak jen odhad
  const bez = build();
  bez.api.pravidla = [pravidlo({ id: 1, nazev: 'večer', kdy: { typ: 'zapad', posunMin: 0 } }),
                      pravidlo({ id: 2, nazev: 'ráno', kdy: { typ: 'cas', cas: '06:40' } })];
  check('bez počasí to nespadne', bez.api.rozvrhSerad(PO_6).map(p => p.nazev).join(','), 'ráno,večer');
}
{
  // Tik pořadí srovnává sám, jinak by se rozešlo s během roku
  const zdroj = LINES.join('\n');
  const TIK = zdroj.slice(zdroj.indexOf('async function runBlindSchedule'),
                          zdroj.indexOf('function rozvrhOcisti'));
  check('tik si pořadí srovná', /rozvrhSerad\(at\)/.test(TIK), true);
}

nadpis('6g) Prázdná záloha rozvrh nesmaže');
{
  // Tudy zmizel předvyplněný rozvrh: obnova vzala razítko, zahodila pravidla, která
  // neprošla kontrolou, a výsledek byl prázdno — potichu a rovnou i do úložiště,
  // takže se to opakovalo po každém nasazení.
  const h = build();
  h.api.rozvrhVychoziPoStartu();
  const { out } = await volej(h.routy, 'POST /api/blinds/schedule/restore', { savedAt: Date.now(), rules: [] });
  check('prázdná záloha hotový rozvrh nesmaže', h.api.pravidla.length, 9);
  check('  a řekne to', out.odmitnuto, true);
  check('  nahlas do logu', h.logy.some(l => /^CHYBA .*záloha bez pravidel/.test(l)), true);
  // Ani záloha, ze které nic neprojde kontrolou
  const rozbita = build();
  rozbita.api.rozvrhVychoziPoStartu();
  await volej(rozbita.routy, 'POST /api/blinds/schedule/restore',
    { savedAt: Date.now(), rules: [{ dny: [], kdy: {}, kroky: [] }] });
  check('rozbitá záloha taky ne', rozbita.api.pravidla.length, 9);
}
{
  // Na prázdném rozvrhu projít musí — jinak by se všechna pravidla dala smazat
  // jen jednou a po nasazení by se vrátila
  const h = build();
  const { out } = await volej(h.routy, 'POST /api/blinds/schedule/restore', { savedAt: Date.now(), rules: [] });
  check('na prázdném rozvrhu prázdná záloha projde', !out.odmitnuto, true);
  check('  a razítko se převezme', h.api.savedAt > 0, true);
}
{
  // Tlačítko v appce: ať se rozvrh dá vrátit bez ohledu na to, co ho vymazalo
  const h = build();
  const { out } = await volej(h.routy, 'POST /api/blinds/schedule/default', {});
  check('tlačítko nahraje doporučený rozvrh', out.rules.length, 9);
  // Bez razítka by ho stará záloha z telefonu hned zase přepsala
  check('  s razítkem teď', out.savedAt > 0, true);
}

nadpis('7) Co appka pošle, to se ověří');
{
  const h = build();
  const ok = v => !!h.api.rozvrhOcisti(v);
  const zaklad = { dny: [true, false, false, false, false, false, false], kdy: { typ: 'cas', cas: '07:30' }, cil: 'Ložnice', akce: 'up' };
  check('rozumné pravidlo projde', ok(zaklad), true);
  check('bez jediného dne ne', ok({ ...zaklad, dny: [false, false, false, false, false, false, false] }), false);
  check('šest dnů místo sedmi ne', ok({ ...zaklad, dny: [true, true, true, true, true, true] }), false);
  check('nesmyslný čas ne', ok({ ...zaklad, kdy: { typ: 'cas', cas: '25:99' } }), false);
  check('posun přes tři hodiny ne', ok({ ...zaklad, kdy: { typ: 'zapad', posunMin: 500 } }), false);
  check('  ale tři hodiny ano', ok({ ...zaklad, kdy: { typ: 'zapad', posunMin: 180 } }), true);
  check('prázdný cíl ne', ok({ ...zaklad, cil: '   ' }), false);
  check('neznámá akce ne', ok({ ...zaklad, akce: 'otoc' }), false);
  // Naklopení bez hodnoty by byl povel bez obsahu
  check('naklopení bez hodnoty ne', ok({ ...zaklad, akce: 'tilt', naklopeni: null }), false);
  check('naklopení mimo rozsah ne', ok({ ...zaklad, akce: 'tilt', naklopeni: 120 }), false);
  const skupina = (kroky) => ok({ dny: [true, false, false, false, false, false, false], kdy: { typ: 'cas', cas: '07:30' }, kroky });
  check('skupina s kroky projde', skupina([krok('Ložnice'), krok('Obývák', 'down', 100)]), true);
  // Pravidlo bez jediného kroku by v domě nic neudělalo
  check('prázdná skupina ne', skupina([]), false);
  check('jedenáct kroků ne', skupina(Array.from({ length: 11 }, () => krok('Ložnice'))), false);
  check('  ale deset ano', skupina(Array.from({ length: 10 }, () => krok('Ložnice'))), true);
  // Jeden rozbitý krok shodí celé pravidlo — půlka pravidla by byla horší než chyba
  check('rozbitý krok mezi dobrými ne', skupina([krok('Ložnice'), krok('', 'up')]), false);
}

nadpis('8) Cesty a obnova');
{
  const h = build();
  h.api.pravidla = [];
  const { out } = await volej(h.routy, 'POST /api/blinds/schedule', {
    dny: [true, true, true, true, true, false, false],
    kdy: { typ: 'cas', cas: '06:00' }, kroky: [krok('Ložnice')]
  });
  check('pravidlo se přidá', out.rules.length, 1);
  const id = out.rules[0].id;
  const { out: po } = await volej(h.routy, 'POST /api/blinds/schedule', {
    id, dny: [true, true, true, true, true, false, false],
    kdy: { typ: 'cas', cas: '06:30' }, kroky: [krok('Ložnice'), krok('Obývák')]
  });
  // Úprava nesmí založit druhé pravidlo — jinak by se čas „opravoval" mazáním
  check('úprava nepřidá druhé', po.rules.length, 1);
  check('  a čas se změní', po.rules[0].kdy.cas, '06:30');
  check('  i kroky', po.rules[0].kroky.length, 2);
  const { kod } = await volej(h.routy, 'POST /api/blinds/schedule', { dny: [], kdy: {}, kroky: [] });
  check('nesmysl se odmítne', kod, 400);
  await volej(h.routy, 'POST /api/blinds/schedule/delete', { id });
  check('smazání zabere', h.api.pravidla.length, 0);
}
{
  // Obnova PŘEPISUJE, neslučuje: rozvrh je jeden celek a slučováním by smazané
  // pravidlo obživlo ze zálohy
  const h = build();
  h.api.pravidla = [];
  await volej(h.routy, 'POST /api/blinds/schedule', {
    dny: [true, true, true, true, true, false, false],
    kdy: { typ: 'cas', cas: '06:00' }, kroky: [krok('Ložnice')]
  });
  const starsi = h.api.savedAt - 1000;
  await volej(h.routy, 'POST /api/blinds/schedule/restore', {
    savedAt: starsi,
    rules: [{ dny: [true, true, true, true, true, true, true], kdy: { typ: 'cas', cas: '09:00' }, kroky: [krok('Obývák', 'down', 100)] }]
  });
  check('starší záloha nepřepíše novější rozvrh', h.api.pravidla[0].kroky[0].cil, 'Ložnice');
  // Shoda na milisekundu drží server — po nasazení je jeho savedAt nula, takže
  // záloha z telefonu stejně vyhraje
  await volej(h.routy, 'POST /api/blinds/schedule/restore', {
    savedAt: h.api.savedAt,
    rules: [{ dny: [true, true, true, true, true, true, true], kdy: { typ: 'cas', cas: '09:00' }, kroky: [krok('Obývák', 'down', 100)] }]
  });
  check('  a při shodě taky ne', h.api.pravidla[0].kroky[0].cil, 'Ložnice');
  await new Promise(r => setTimeout(r, 5));
  await volej(h.routy, 'POST /api/blinds/schedule/restore', {
    savedAt: Date.now(),
    rules: [{ dny: [true, true, true, true, true, true, true], kdy: { typ: 'cas', cas: '09:00' }, kroky: [krok('Obývák', 'down', 100)] }]
  });
  check('novější přepíše celý rozvrh', h.api.pravidla.map(p => p.kroky[0].cil).join(','), 'Obývák');
  const { kod } = await volej(h.routy, 'POST /api/blinds/schedule/restore', { rules: [] });
  check('bez savedAt se obnova odmítne', kod, 400);
}

nadpis('Návrat z „jsme pryč": žaluzie jak by stály podle rozvrhu');
{
  // Výchozí rozvrh, pondělí; západ v 19:10
  const ZAPAD = Date.UTC(2026, 8, 14, 17, 10);
  const stav = at => {
    const h = build({ pocasi: { sunsetMs: ZAPAD } });
    h.api.rozvrhNasadVychozi();
    return h;
  };
  {
    // Ve 13:00: večer (neděle) vše dole, ráno se naklopilo a dveře vytáhly
    const h = stav();
    const v = await h.api.rozvrhStavTed(PO_6 + 7 * H);
    check('ve 13:00 jen výsledný stav, jeden povel na žaluzii', h.povely.join(' | '),
      'Kuchyň:down:25 | Obývák Okno:down:25 | Obývák Dveře:up | Miky:down:25 | Elenka:down:25 | Ložnice:down:25 | Hosté:down:25 | Garáž:down');
    check('  a spočítá to', v.ok + '/' + v.celkem, '8/8');
    const dnes = h.api.pravidla.filter(p => p.spustenoDne).map(p => p.nazev).join(',');
    check('dnešní proběhlá pravidla jsou odškrtnutá', dnes, 'Děti ráno,Děti po ránu,Dopoledne,Ložnice a hosté');
    const pred = h.povely.length;
    await h.api.runBlindSchedule(PO_6 + 7 * H);
    check('  a tik je znovu nepustí', h.povely.length, pred);
  }
  {
    const h = stav();
    await h.api.rozvrhStavTed(PO_6 + 15 * H);   // 21:00
    check('po západu už jen zataženo', h.povely.join(' | '),
      'Kuchyň:down:100 | Obývák Okno:down:100 | Obývák Dveře:closure:15 | Miky:down:100 | Elenka:down:100 | Ložnice:down:100 | Hosté:down:100 | Garáž:down');
  }
  {
    // V noci dnes ještě nic neproběhlo — stav je ze včerejšího večera
    const h = stav();
    await h.api.rozvrhStavTed(PO_6 - 5 * H);    // 1:00
    check('v 1:00 stav ze včerejška', h.povely.join(' | '),
      'Kuchyň:down:100 | Obývák Okno:down:100 | Obývák Dveře:closure:15 | Miky:down:100 | Elenka:down:100 | Ložnice:down:100 | Hosté:down:100 | Garáž:down');
    check('  a dnešní pravidla zůstávají na později', h.api.pravidla.some(p => p.spustenoDne), false);
  }
  {
    // Při sauně se ložnice odkládá — dožene ji běžný tik
    const h = stav();
    h.state.sauna.lastHeatAt = PO_6 + 15 * H - 5 * MIN;
    await h.api.rozvrhStavTed(PO_6 + 15 * H);
    const loznice = h.api.pravidla.find(p => p.nazev === 'Ložnice po západu');
    check('odložené pravidlo se neodškrtne', loznice.spustenoDne, null);
  }
  {
    const h = stav();
    h.zlobi = 'Hosté';
    const v = await h.api.rozvrhStavTed(PO_6 + 7 * H);
    check('výpadek jedné žaluzie nezastaví ostatní', v.ok + '/' + v.celkem + ' ' + v.chyby.length, '7/8 1');
  }
  {
    const h = stav();
    h.api.pravidla.forEach(p => { p.zapnuto = false; });
    const v = await h.api.rozvrhStavTed(PO_6 + 7 * H);
    check('vypnutá pravidla se nepočítají', v.celkem, 0);
  }
}

konec();

})();
