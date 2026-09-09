// Ověření: solinátor má jezdit SPOLU s bazénem. Zapne se, jakmile bazén běží,
// nejpozději ve 13:00 (kdy se otevírá zaručené okno bazénu), a nakonec vždycky,
// když by se zbytek denního cíle jinak do okna už nevešel.
//
// Ten poslední bod je pojistka pro velké cíle: v červnu je okno 11:00 → západ − 1 h
// asi 9,5 h, takže boost na 8 h by se od 13:00 nestihl a rozpočet hodin by přestal
// platit. Vypínání se tímhle nemění — o něm rozhoduje dál naplněný rozpočet a okno.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('solinátor');

const MIN = 60000, H = 3600000;
const CODE = between('// Konec dnešního okna: hodina před západem',
                     'function outsideSolinatorWindow');

// Sestaví prostředí pro dané pražské hodiny. `zapad` = celá hodina západu slunce.
function build({ hour = 11, minute = 0, bazenBezi = false, zapad = 21, pocasi = true } = {}) {
  const now = Date.now();
  const weather = pocasi ? { sys: { sunset: Math.floor((now - hour * H + zapad * H) / 1000) } } : null;
  const api = new Function(
    'releBezi', 'HARD_OFF_HOUR', 'POOL_GUARANTEE_FROM_HOUR',
    CODE + '\n; return { solinatorCutoffMs, solinatorMuzeStartovat, SOLINATOR_LAST_CHANCE_MS };'
  )(() => bazenBezi, 20, 13);
  return { api, prague: { hour, minute }, weather, now };
}

const smi = (h, zbyva) => h.api.solinatorMuzeStartovat(h.now, h.prague, h.weather, zbyva);

nadpis('1) Konec okna');
{
  const h = build({ hour: 11, zapad: 21 });
  check('hodinu před západem', Math.round((h.api.solinatorCutoffMs(h.now, h.prague, h.weather) - h.now) / H), 9);
  const b = build({ hour: 11, pocasi: false });
  check('bez počasí náhradní mez 20:00',
    Math.round((b.api.solinatorCutoffMs(b.now, b.prague, b.weather) - b.now) / H), 9);
}

nadpis('2) Jede s bazénem');
check('bazén běží v 11:00 → jede se taky', smi(build({ hour: 11, bazenBezi: true }), 2 * H), true);
check('  i v 11:05', smi(build({ hour: 11, minute: 5, bazenBezi: true }), 2 * H), true);
check('bazén stojí v 11:00 → čeká se', smi(build({ hour: 11 }), 2 * H), false);
check('bazén stojí ve 12:30 → pořád čeká', smi(build({ hour: 12, minute: 30 }), 2 * H), false);

nadpis('3) Nejpozději ve 13:00');
check('ve 13:00 i bez bazénu', smi(build({ hour: 13 }), 2 * H), true);
check('ve 14:00 taky', smi(build({ hour: 14 }), 2 * H), true);
check('ve 12:59 ještě ne', smi(build({ hour: 12, minute: 59 }), 2 * H), false);

nadpis('4) Poslední šance');
{
  // Do západu − 1 h zbývá 9 h, cíl 2 h se v klidu vejde → čeká se na bazén
  check('cíl se pohodlně vejde → čeká', smi(build({ hour: 11, zapad: 21 }), 2 * H), false);
  // Zbývá 9 h a cíl je 9 h → víc čekat nelze
  check('cíl vyplní celé okno → jede hned', smi(build({ hour: 11, zapad: 21 }), 9 * H), true);
  // Osmihodinový boost: od 13:00 by zbývalo jen 7 h, takže se musí začít v 11:00
  check('boost na 8 h se od 13:00 nestihne → jede v 11:00',
    smi(build({ hour: 11, zapad: 21 }), 8 * H + 50 * MIN), true);
  // Rezerva: automatika běží po pěti minutách, okamžik se nesmí přeskočit
  check('rezerva deset minut se počítá', smi(build({ hour: 11, zapad: 21 }), 9 * H - 5 * MIN), true);
  check('  ale ne o minutu dřív', smi(build({ hour: 11, zapad: 21 }), 9 * H - 15 * MIN), false);
  // Krátký podzimní den: okno je kratší než cíl, takže se jede od otevření
  check('krátký den → jede se hned', smi(build({ hour: 11, zapad: 17 }), 5 * H), true);
}

konec();
