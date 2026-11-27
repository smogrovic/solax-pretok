// Most auta VW na NASu (public/nas/auto-most.py) — Python, spouští se tady přes python3.
//
// Knihovna CarConnectivity se v sadě nepoužívá: vozidlo se podstrčí jako prosté
// objekty se stejnými jmény atributů (level, range, charging.state, …). Že ta
// jména sedí na skutečnou knihovnu, bylo ověřené proti carconnectivity 0.11.
// Hlídá se: co jde appce, výběr auta podle VIN a že se heslo nikdy nevypíše.
const { spawnSync } = require('child_process');
const path = require('path');
const { suite } = require('./zdroj');
const { check, nadpis, konec } = suite('auto — most (Python)');

const MOST = path.join(__dirname, '..', 'public', 'nas', 'auto-most.py');
const py = kod => {
  const r = spawnSync('python3', ['-c', `
import importlib.util, json, os, tempfile
from types import SimpleNamespace as N
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('most', ${JSON.stringify(MOST)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
A = lambda v, **kw: N(value=v, **kw)
${kod}
`], { encoding: 'utf8' });
  if (r.status !== 0) return { chyba: (r.stderr || '').trim().split('\n').slice(-1)[0] };
  return JSON.parse(r.stdout.trim().split('\n').slice(-1)[0]);
};

if (spawnSync('python3', ['--version']).status !== 0) {
  check('python3 je k dispozici', 'ne', 'ano');
  konec();
}

nadpis('1) Co jde appce');
{
  const out = py(`
class Stav:
    value = 'charging'
auto = N(vin=A('WVWZZZ1'), model=A('ID.4'),
  get_electric_drive=lambda: N(level=A(78.04, last_updated=datetime(2026, 9, 29, 8, 0, tzinfo=timezone.utc)), range=A(320)),
  charging=N(state=A(Stav()), settings=N(target_level=A(80)), power=A(10.52), estimated_date_reached=A(None)))
print(json.dumps(m.stav_auta(auto)))`);
  check('procenta', out.soc, 78);
  check('dojezd', out.dojezdKm, 320);
  check('nabíjení: stav z enumu jako text', out.nabijeni + ' ' + out.nabiji, 'charging true');
  check('cíl a výkon', out.cilSoc + ' ' + out.vykonKw, '80 10.5');
  check('kdy auto měřilo', out.zmerenoV, '2026-09-29T08:00:00+00:00');
  check('model', out.model, 'ID.4');
}
{
  // Starší auto nebo neúplná data: nic nespadne, chybějící je null
  const out = py(`print(json.dumps(m.stav_auta(N(vin=A('X')))))`);
  check('bez pohonu a nabíjení jen prázdno', out.chyba || [out.soc, out.nabiji, out.nabijeni].join(','), ',,');
}

{
  // Multivan diesel z portálu EU Data Act — přesně co most vypsal 27. 11. 2026
  const out = py(`
class E:
    def __init__(s, v): s.value = v
t = datetime(2028, 5, 19, 16, 14, 33, tzinfo=timezone.utc)
auto = N(vin=A('X'), odometer=A(64063.0), parking_brake=A(True), doors=N(lock_state=A(E('locked'))),
  maintenance=N(inspection_due_at=A(t), inspection_due_after=A(17800.0), oil_service_due_at=A(t), oil_service_due_after=A(17800.0)),
  captured_at=A(datetime(2026, 11, 27, 16, 14, 33, tzinfo=timezone.utc)))
print(json.dumps(m.stav_auta(auto)))`);
  check('portál: km, zámek, brzda', [out.km, out.zamek, out.rucniBrzda].join(','), '64063,zamčeno,true');
  check('  servis a olej (km i datum)', [out.servisKm, out.servisDatum, out.olejKm].join(','), '17800,2028-05-19T16:14:33+00:00,17800');
  check('  kdy auto hlásilo = captured_at', out.zmerenoV, '2026-11-27T16:14:33+00:00');
  check('  bez pohonu nádrž i dojezd prázdné', [out.palivoPct, out.dojezdKm, out.soc].join(','), ',,');
}
{
  // Kdyby portál poslal i pohon: nádrž z dieselu, dojezd z total_range
  const out = py(`
class T:
    def __init__(s, v): s.value = v
auto = N(vin=A('X'), drives=N(total_range=A(612), drives={'primary': N(type=A(T('diesel')), level=A(55.0), range=A(600))}))
print(json.dumps(m.stav_auta(auto)))`);
  check('pohon diesel: nádrž a dojezd', [out.palivoPct, out.dojezdKm, out.soc].join(','), '55,612,');
}
{
  // Plug-in hybrid: kabel z charging.connector (bez něj null)
  const out = py(`
class E:
    def __init__(s, v): s.value = v
a = N(vin=A('X'), charging=N(state=A(E('off')), connector=N(connection_state=A(E('connected')))))
b = N(vin=A('X'), charging=N(state=A(E('off')), connector=N(connection_state=A(E('disconnected')))))
print(json.dumps([m.stav_auta(a)['zapojeno'], m.stav_auta(b)['zapojeno'], m.stav_auta(N(vin=A('X')))['zapojeno']]))`);
  check('kabel: zapojený / ne / neznámo', out.join(','), 'true,false,');
}

nadpis('2) Výběr auta');
{
  const out = py(`
g = N(list_vehicles=lambda: [N(vin=A('AAA')), N(vin=A('BBB'))])
print(json.dumps([m.vyber_auto(g).vin.value, m.vyber_auto(g, 'BBB').vin.value, m.vyber_auto(g, 'CCC'), m.vyber_auto(None)]))`);
  check('bez VIN první auto', out[0], 'AAA');
  check('s VIN to jeho', out[1], 'BBB');
  check('neznámý VIN nic', out[2], null);
  check('prázdná garáž nic', out[3], null);
}

nadpis('3) Nastavení a heslo');
{
  const out = py(`
d = tempfile.mkdtemp()
def zkus(obsah):
    c = os.path.join(d, 'c.json')
    with open(c, 'w') as f: f.write(obsah)
    return m.nacti_nastaveni(c)
ok, _ = zkus(json.dumps({'vw': {'username': 'a@b.cz', 'password': 'TAJNE-HESLO'}, 'interval': 30, 'vin': ' wvw1 '}))
_, bez = zkus(json.dumps({'vw': {'username': 'a@b.cz'}}))
_, rozbite = zkus('{nesmysl TAJNE-HESLO')
_, chybi = m.nacti_nastaveni(os.path.join(d, 'neni.json'))
print(json.dumps({'appka': ok['appka'], 'interval': ok['interval'], 'vin': ok['vin'], 'bez': bez, 'rozbite': rozbite, 'chybi': chybi}))`);
  check('výchozí adresa appky', out.appka, 'https://solax-pretok.onrender.com');
  check('interval nejméně 5 min (VW nemá rád časté dotazy)', out.interval, 300);
  check('VIN velkými a bez mezer', out.vin, 'WVW1');
  check('bez hesla to řekne', /chybí/i.test(out.bez), true);
  check('rozbitý soubor heslo nevypíše', /TAJNE/.test(out.rozbite), false);
  check('chybějící soubor poradí', /Chybí .*vytvoř/.test(out.chybi), true);
}

nadpis('4) Zdroj: portál EU Data Act (výchozí) nebo We Connect');
{
  const out = py(`
d = tempfile.mkdtemp()
def zkus(vw):
    c = os.path.join(d, 'c.json')
    with open(c, 'w') as f: f.write(json.dumps({'vw': {'username': 'a@b.cz', 'password': 'X', **vw}}))
    return m.nacti_nastaveni(c)
vych, _ = zkus({})
wc, _ = zkus({'zdroj': 'weconnect'})
br, _ = zkus({'brand': 'VWN'})
_, spatne = zkus({'zdroj': 'nesmysl'})
k1 = m.cc_konfigurace(vych, 'VOLKSWAGEN_COMMERCIAL_VEHICLES')['carConnectivity']['connectors'][0]
k2 = m.cc_konfigurace(wc)['carConnectivity']['connectors'][0]
print(json.dumps({'zdroj': vych['zdroj'], 'znacky': vych['znacky'], 'br': br['znacky'], 'spatne': spatne,
  'k1': [k1['type'], k1['config']['brand'], k1['config']['interval']], 'k2': [k2['type'], 'brand' in k2['config']]}))`);
  check('výchozí zdroj = portál EU Data Act', out.zdroj, 'eu-data-act');
  check('  zkusí osobní a pak užitkové VW', out.znacky.join(','), 'VOLKSWAGEN_PASSENGER_CARS,VOLKSWAGEN_COMMERCIAL_VEHICLES');
  check('  značka z konfigurace jen ta', out.br.join(','), 'VWN');
  check('  connector, značka a interval po 15 min', out.k1.join(' '), 'vw_eu_data_act VOLKSWAGEN_COMMERCIAL_VEHICLES 900');
  check('We Connect: starý connector bez značky', out.k2.join(' '), 'volkswagen false');
  check('neznámý zdroj → chyba', /povolené/.test(out.spatne), true);
}
{
  const out = py(`
print(json.dumps([m.ceka_na_data(Exception('GET /proxy_api/euda-apim/datadelivery/vehicles/X/abc/list -> HTTP 404')),
  m.ceka_na_data(Exception('GET /vehicles -> HTTP 401')), m.ceka_na_data(Exception('nic'))]))`);
  check('404 na seznamu dodávek = portál čeká na první data', out.join(','), 'true,false,false');
}

konec();
