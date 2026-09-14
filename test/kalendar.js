// Ověření: čtení kalendáře z iCloudu (CalDAV + ICS).
//
// Přihlašovací údaje jsou jen na Renderu, takže napojení naostro se odsud vyzkoušet
// nedá. Zato je celá cesta od odpovědi k seznamu dnů poskládaná z čistých funkcí —
// a právě tam jsou všechny pasti:
//  * ICS láme dlouhé řádky a pokračování začíná mezerou (bez rozbalení zmizí názvy),
//  * prefixy v XML nejsou zaručené (`d:`, `D:`, `A:`, žádný),
//  * opakované události chodí jako JEDNO pravidlo, ne jako dvacet událostí,
//  * čas má tři tvary a v neděli, kdy se mění čas, se posun zóny sám hne.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('kalendář');

const DEN = 86400000, H = 3600000, MIN = 60000;
const CODE = between('// ---------- Kalendář z iCloudu (CalDAV) ----------',
                     '// ---------- Nuki zámek ----------');

function build({ odpovedi = [] } = {}) {
  const state = { calendar: { days: [], fetchedAt: null, error: null } };
  const dotazy = [];
  const api = new Function('state', 'app', 'requireAuth', 'addLog', 'broadcast',
    'scheduleEvery', 'pragueDateString', 'fetch', 'Buffer',
    CODE + '\n; return { xmlTagy, xmlTag, xmlText, maVevent, absUrl, icsRozbal, icsRadek,'
         + ' icsUdalosti, icsCas, zonaNaMs, kalRozvin, kalUdalosti, kalDoDnu, kalZacatek,'
         + ' calendarPayload, kalStahni, kalDotazTelo, KAL_DNU };'
  )(
    state,
    { get: () => {} },
    () => true,
    () => {},
    () => {},
    () => {},
    at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(at === undefined ? new Date() : new Date(at)),
    async (url, opts) => {
      dotazy.push({ url: String(url), body: (opts && opts.body) || '' });
      const o = odpovedi.shift();
      if (!o) throw new Error('došly podstrčené odpovědi');
      return { ok: o.ok !== false, status: o.status || 200, text: async () => o.body || '' };
    },
    Buffer
  );
  return { api, state, dotazy };
}

const api = build().api;
const ics = (...radky) => ['BEGIN:VEVENT', ...radky, 'END:VEVENT'].join('\r\n');

nadpis('1) XML nezávisle na prefixu');
for (const [popis, xml] of [
  ['bez prefixu', '<href>/x/</href>'],
  ['malé d:', '<d:href>/x/</d:href>'],
  ['velké D:', '<D:href>/x/</D:href>'],
  ['cizí A:', '<A:href>/x/</A:href>']
]) {
  check(popis, api.xmlText(api.xmlTag(xml, 'href')), '/x/');
}
check('značka s atributy projde taky',
  api.xmlText(api.xmlTag('<d:href xml:lang="cs">/y/</d:href>', 'href')), '/y/');
check('víc značek se najde všech', api.xmlTagy('<href>/a/</href><href>/b/</href>', 'href').length, 2);
check('entity se přeloží', api.xmlText('<x>Ku&amp;cha&#39;</x>'.replace(/<\/?x>/g, '')), "Ku&cha'");
check('VEVENT se pozná z atributu',
  api.maVevent('<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>'), true);
check('  a připomínky se nevezmou',
  api.maVevent('<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'), false);
// calendar-home-set vrací absolutní adresu na správný shard — musí se použít ona
check('absolutní adresa se nechá být',
  api.absUrl('https://caldav.icloud.com/', 'https://p61-caldav.icloud.com/123/calendars/'),
  'https://p61-caldav.icloud.com/123/calendars/');
check('relativní se doplní o server',
  api.absUrl('https://p61-caldav.icloud.com/123/', '/123/calendars/'),
  'https://p61-caldav.icloud.com/123/calendars/');

nadpis('2) Rozbalení zalomených řádků');
{
  // Tohle musí být první krok. Bez něj se z dlouhého názvu stane „Schůzka s panem"
  const text = 'BEGIN:VEVENT\r\nSUMMARY:Schůzka s panem\r\n  Novákem o ploto\r\n\tvé zdi\r\nEND:VEVENT';
  const ev = api.icsUdalosti(text)[0];
  check('dlouhý název se slepí zpátky', ev.SUMMARY.hodnota, 'Schůzka s panem Novákem o plotové zdi');
  check('  a nic se neztratí', /plotové zdi/.test(ev.SUMMARY.hodnota), true);
}
check('escapované čárky a nové řádky',
  api.icsUdalosti(ics('SUMMARY:Nákup: mléko\\, chleba\\nа pak pošta'))[0].SUMMARY.hodnota.includes('\\,'), true);
{
  const ev = api.icsUdalosti(ics('SUMMARY:A\\, B', 'DTSTART:20260914T080000Z'))[0];
  const u = api.kalUdalosti([ics('SUMMARY:A\\, B', 'DTSTART:20260914T080000Z')],
    Date.UTC(2026, 8, 14), Date.UTC(2026, 8, 21));
  check('  a v hotové události už jsou čitelné', u[0].nazev, 'A, B');
}

nadpis('3) Tři tvary času');
{
  const c = api.icsCas({ hodnota: '20260914T140000Z', param: {} });
  check('UTC se bere rovnou', new Date(c.ms).toISOString(), '2026-09-14T14:00:00.000Z');
  check('  a není celodenní', c.celodenni, false);
}
{
  // Září = letní čas, Praha je UTC+2
  const c = api.icsCas({ hodnota: '20260914T160000', param: { TZID: 'Europe/Prague' } });
  check('místní čas se převede', new Date(c.ms).toISOString(), '2026-09-14T14:00:00.000Z');
}
{
  const c = api.icsCas({ hodnota: '20260914', param: { VALUE: 'DATE' } });
  check('celodenní začíná půlnocí v Praze', new Date(c.ms).toISOString(), '2026-09-13T22:00:00.000Z');
  check('  a je označená', c.celodenni, true);
}
{
  // Leden = zimní čas, UTC+1 — kdyby se posun bral natvrdo, tohle spadne
  const c = api.icsCas({ hodnota: '20260114T160000', param: { TZID: 'Europe/Prague' } });
  check('v zimě platí jiný posun', new Date(c.ms).toISOString(), '2026-01-14T15:00:00.000Z');
}
{
  // Neděle 29. 3. 2026 ve 2:00 se posouvá na 3:00 — dvouprůchodový převod to musí trefit
  const pred = api.icsCas({ hodnota: '20260329T010000', param: { TZID: 'Europe/Prague' } });
  const po = api.icsCas({ hodnota: '20260329T040000', param: { TZID: 'Europe/Prague' } });
  check('před změnou času UTC+1', new Date(pred.ms).toISOString(), '2026-03-29T00:00:00.000Z');
  check('po změně času UTC+2', new Date(po.ms).toISOString(), '2026-03-29T02:00:00.000Z');
}
check('nesmyslný čas je null', api.icsCas({ hodnota: 'nesmysl', param: {} }), null);
check('chybějící pole taky', api.icsCas(null), null);

nadpis('4) Opakování');
const OD = Date.UTC(2026, 8, 14), DO = OD + 7 * DEN;   // pondělí 14. 9. 2026
const kolik = (radky) => api.kalUdalosti([ics(...radky)], OD, DO);
{
  const u = kolik(['UID:a', 'SUMMARY:Denně', 'DTSTART:20260914T060000Z', 'DTEND:20260914T063000Z',
                   'RRULE:FREQ=DAILY']);
  check('denní pravidlo dá sedm výskytů', u.length, 7);
}
{
  const u = kolik(['UID:b', 'SUMMARY:Popelnice', 'DTSTART:20260914T060000Z', 'DTEND:20260914T063000Z',
                   'RRULE:FREQ=WEEKLY;INTERVAL=2']);
  check('každý druhý týden jen jednou', u.length, 1);
}
{
  const u = kolik(['UID:c', 'SUMMARY:Kroužek', 'DTSTART:20260914T140000Z', 'DTEND:20260914T150000Z',
                   'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR']);
  check('BYDAY dá tři dny v týdnu', u.length, 3);
  check('  a jsou to po, st, pá',
    u.map(x => new Date(x.od).getUTCDay()).sort().join(','), '1,3,5');
}
{
  const u = kolik(['UID:d', 'SUMMARY:Třikrát', 'DTSTART:20260914T060000Z', 'DTEND:20260914T063000Z',
                   'RRULE:FREQ=DAILY;COUNT=3']);
  check('COUNT omezí počet', u.length, 3);
}
{
  const u = kolik(['UID:e', 'SUMMARY:Do středy', 'DTSTART:20260914T060000Z', 'DTEND:20260914T063000Z',
                   'RRULE:FREQ=DAILY;UNTIL=20260916T235959Z']);
  check('UNTIL ukončí řadu', u.length, 3);
}
{
  const u = kolik(['UID:f', 'SUMMARY:S výjimkou', 'DTSTART:20260914T060000Z', 'DTEND:20260914T063000Z',
                   'RRULE:FREQ=DAILY', 'EXDATE:20260916T060000Z']);
  check('EXDATE vynechá termín', u.length, 6);
  check('  a je to ten správný', u.some(x => x.od === Date.UTC(2026, 8, 16, 6)), false);
}
{
  // Přesunutý jednotlivý výskyt: pravidlo dá pondělí–neděle, ale středa se posunula
  const texty = [
    ics('UID:g', 'SUMMARY:Porada', 'DTSTART:20260914T060000Z', 'DTEND:20260914T063000Z', 'RRULE:FREQ=DAILY'),
    ics('UID:g', 'SUMMARY:Porada (posunutá)', 'RECURRENCE-ID:20260916T060000Z',
        'DTSTART:20260916T100000Z', 'DTEND:20260916T103000Z')
  ];
  const u = api.kalUdalosti(texty, OD, DO);
  check('přesunutý výskyt nahradí původní', u.filter(x => x.od === Date.UTC(2026, 8, 16, 6)).length, 0);
  check('  a objeví se v novém čase', u.some(x => x.od === Date.UTC(2026, 8, 16, 10)), true);
  check('  ostatní dny zůstanou', u.length, 7);
}
{
  const u = kolik(['UID:h', 'SUMMARY:Zrušeno', 'DTSTART:20260915T060000Z', 'STATUS:CANCELLED']);
  check('zrušená událost se nezobrazí', u.length, 0);
}
{
  // Server smí rozvinout opakování sám (expand) — pak chodí instance bez RRULE
  const texty = [
    ics('UID:i', 'SUMMARY:Rozvinuto', 'DTSTART:20260914T060000Z', 'DTEND:20260914T063000Z'),
    ics('UID:i', 'SUMMARY:Rozvinuto', 'DTSTART:20260915T060000Z', 'DTEND:20260915T063000Z')
  ];
  check('hotové instance se berou jak jsou', api.kalUdalosti(texty, OD, DO).length, 2);
}

nadpis('5) Skládání do dnů');
{
  const u = api.kalUdalosti([
    ics('UID:x', 'SUMMARY:Dovolená', 'DTSTART;VALUE=DATE:20260915', 'DTEND;VALUE=DATE:20260918'),
    ics('UID:y', 'SUMMARY:Oběd', 'DTSTART:20260915T100000Z', 'DTEND:20260915T110000Z')
  ], OD, DO);
  const dny = api.kalDoDnu(u, api.kalZacatek(Date.UTC(2026, 8, 14, 12)));
  check('dnů je sedm', dny.length, 7);
  check('první den má datum', dny[0].d, '2026-09-14');
  check('první den je prázdný', dny[0].udalosti.length, 0);
  // Vícedenní událost musí být vidět v každém dotčeném dni, ne jen v den odjezdu
  const sDovolenou = dny.filter(d => d.udalosti.some(x => x.nazev === 'Dovolená')).length;
  check('vícedenní se ukáže ve všech dnech', sDovolenou, 3);
  check('celodenní je v dni první', dny[1].udalosti[0].nazev, 'Dovolená');
  check('  a časovaná za ní', dny[1].udalosti[1].nazev, 'Oběd');
}
{
  const dny = api.kalDoDnu([], api.kalZacatek(Date.UTC(2026, 8, 14, 12)));
  check('bez událostí jsou dny prázdné', dny.every(d => d.udalosti.length === 0), true);
  check('  ale pořád jich je sedm', dny.length, 7);
}
{
  // Uříznutá nebo prázdná odpověď nesmí shodit poller
  check('prázdný text nic nedá', api.kalUdalosti([''], OD, DO).length, 0);
  check('uříznutý blok taky ne', api.kalUdalosti(['BEGIN:VEVENT\r\nSUMMARY:X'], OD, DO).length, 0);
  check('nesmysl taky ne', api.kalUdalosti(['<html>404</html>'], OD, DO).length, 0);
}

nadpis('6) Pojistka kolem „expand"');
{
  // `expand` prosí server, ať opakování rozvine sám. Podporovat ho ale nemusí a nemusí
  // ho ani mlčky přejít — může odmítnout celý dotaz. Bez pojistky by jedna nepodporovaná
  // značka shodila kalendář celý.
  const ODPOVED = '<multistatus><response><calendar-data>BEGIN:VEVENT\r\nUID:z\r\n'
    + 'SUMMARY:Test\r\nDTSTART:20260914T060000Z\r\nEND:VEVENT</calendar-data></response></multistatus>';
  const h = build({ odpovedi: [{ ok: false, status: 403 }, { body: ODPOVED }] });
  // Bez `.catch` by chybějící pojistka sadu shodila výjimkou místo čitelné hlášky
  return h.api.kalStahni({ url: 'https://x/kal/', nazev: 'K' }, 0, 7 * DEN)
    .catch(err => { check('odmítnutý expand se má zkusit znovu bez něj', err.message, 'nespadnout'); return []; })
    .then(texty => {
    check('odmítnutý expand shodí jen ten dotaz', h.dotazy.length, 2);
    check('  první se ptal s expandem', /c:expand/.test((h.dotazy[0] || {}).body || ''), true);
    check('  druhý bez něj', /c:expand/.test((h.dotazy[1] || {}).body || ''), false);
    check('  a data nakonec dorazila', texty.length, 1);
    check('  časové okno zůstalo v obou', /time-range/.test((h.dotazy[1] || {}).body || ''), true);
    dalsi();
  });
}

function dalsi() {
nadpis('7) Bez přihlašovacích údajů');
{
  const h = build();
  check('kalendář je vypnutý', h.api.calendarPayload().enabled, false);
  check('  a dnů je sedm', h.api.calendarPayload().dnu, 7);
  check('  bez dat', h.api.calendarPayload().days.length, 0);
}

konec();
}
