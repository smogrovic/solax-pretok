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
const { check, nadpis, konec } = suite('rozvrh žaluzií');

const CODE = between('// ---------- Rozvrh žaluzií (opakovaná pravidla místo scénářů v TaHomě) ----------',
                     '// ---------- Časovače relé');

// Pondělí 15. 9. 2026, 6:00 pražského času
const PO_6 = Date.UTC(2026, 8, 14, 4, 0);
const H = 3600000, MIN = 60000, DEN = 86400000;

function build({ auto = true, pryc = false, pocasi = {} } = {}) {
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
    'assistantControlBlinds', 'autoRunning', 'awayActive',
    CODE + '\n; return { rozvrhDenIndex, rozvrhMinuta, rozvrhSpustit, rozvrhPopis,'
         + ' rozvrhOcisti, runBlindSchedule, ZALUZIE_ZAVRENO, ROZVRH_DOHNAT_MS, ROZVRH_MAX,'
         + ' rozvrhOdlozeno, prazdninyPlati, ROZVRH_VYCHOZI, ZAPAD_DELAY_MAX,'
         + ' rozvrhVychoziPoStartu, rozvrhNasadVychozi, rozvrhSerad, rozvrhPoradi,'
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
    () => pryc
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
  await s.api.runBlindSchedule(PO_2015 + 20 * MIN);
  check('ani po dvaceti minutách', s.povely.length, 0);
  await s.api.runBlindSchedule(PO_2015 + 26 * MIN);
  check('třicet minut po nátopu se zavře', s.povely.join(','), 'Ložnice:down:100');
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

nadpis('6f) Předvyplněný rozvrh');
{
  const h = build();
  check('je tam sedm skupin', h.api.ROZVRH_VYCHOZI.length, 7);
  // Nasazuje se až po obnově z úložiště, ne při startu — jinak by zálohu jen přepsalo
  check('na prázdném serveru se nasadí', h.api.rozvrhVychoziPoStartu(), true);
  check('  a je jich sedm', h.api.pravidla.length, 7);
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
  check('ráno pokoje je na 6:40 Po–Pá', podle('Ráno pokoje').kdy.cas + ' ' + podle('Ráno pokoje').dny.join(','),
    '06:40 true,true,true,true,true,false,false');
  check('garáž se zavírá ve 23:00 každý den',
    podle('Garáž').kdy.cas + ' ' + podle('Garáž').dny.filter(Boolean).length, '23:00 7');
  // Zpoždění je v nastavení, ne v pravidle — jinak by se měnilo v každém zvlášť
  check('po západu nemá vlastní posun', podle('Po západu').kdy.posunMin, 0);
  check('  a dveře sjedou do 20 %',
    podle('Po západu').kroky.filter(k => k.akce === 'poloha').map(k => k.cil + ':' + k.hodnota).join(''),
    'Obývák Dveře:20');
  check('ložnice má odklad na saunu', podle('Ložnice po západu').odloz.minut, 30);
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
  check('prázdná záloha hotový rozvrh nesmaže', h.api.pravidla.length, 7);
  check('  a řekne to', out.odmitnuto, true);
  check('  nahlas do logu', h.logy.some(l => /^CHYBA .*záloha bez pravidel/.test(l)), true);
  // Ani záloha, ze které nic neprojde kontrolou
  const rozbita = build();
  rozbita.api.rozvrhVychoziPoStartu();
  await volej(rozbita.routy, 'POST /api/blinds/schedule/restore',
    { savedAt: Date.now(), rules: [{ dny: [], kdy: {}, kroky: [] }] });
  check('rozbitá záloha taky ne', rozbita.api.pravidla.length, 7);
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
  check('tlačítko nahraje doporučený rozvrh', out.rules.length, 7);
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

konec();

})();
