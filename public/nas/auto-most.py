#!/usr/bin/env python3
# Most mezi appkou a autem VW — běží trvale na NASu.
#
# Stav auta (procenta baterie, dojezd, nabíjení) umí jen cloud Volkswagenu, tedy
# to, co ukazuje aplikace Volkswagen / We Connect ID. Oficiální API na to VW nemá;
# přihlášení a čtení obstará knihovna CarConnectivity (github.com/tillsteinbach/
# CarConnectivity), která se o změny na straně VW stará. Přihlašuje se tady doma,
# heslo k VW ID zůstává na NASu a appka dostane jen stav. Spojení navazuje VŽDYCKY
# most sám směrem ven, do domácí sítě se nic neotevírá.
#
# Instalace (jednou, přes SSH jako root):
#   python3 -m pip install --upgrade pip
#   python3 -m pip install carconnectivity carconnectivity-connector-volkswagen
#   curl -o /volume1/family/scripts/auto/auto-most.py https://solax-pretok.onrender.com/nas/auto-most.py
# Vedle skriptu vytvoř auto.config.json (heslo sem, do chatu ani repozitáře ne):
#   {"appka": "https://solax-pretok.onrender.com",
#    "vw": {"username": "tvuj@email.cz", "password": "heslo-k-VW-ID"}}
# Volitelně "vin" (když je na účtu víc aut) a "interval" v sekundách (výchozí 600).
#
# Nejdřív vyzkoušet (vypíše, co VW o autě hlásí):
#   python3 /volume1/family/scripts/auto/auto-most.py --vypis
# Pak spouštět bez argumentů (Plánovač úloh → Spuštění systému), už se nezastaví:
#   python3 /volume1/family/scripts/auto/auto-most.py
#
# Přihlášení si knihovna ukládá do auto.tokeny.json vedle skriptu — je to klíč
# k účtu VW, čitelný jen pro roota.

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

SLOZKA = os.path.dirname(os.path.abspath(__file__))
KONFIG = os.path.join(SLOZKA, 'auto.config.json')
TOKENY = os.path.join(SLOZKA, 'auto.tokeny.json')
APPKA_VYCHOZI = 'https://solax-pretok.onrender.com'
INTERVAL_S = 600          # VW nemá rád časté dotazy; auto se stejně mění pomalu
INTERVAL_MIN_S = 300
INTERVAL_MAX_S = 3600
PAUZA_PO_CHYBE_S = 900


def zapis(text):
    print(datetime.now().strftime('%Y-%m-%d %H:%M:%S') + '  ' + text, flush=True)


def nacti_nastaveni(cesta=KONFIG):
    """→ (nastavení, chyba). Heslo se do chyby nikdy nevypisuje."""
    try:
        with open(cesta, 'r', encoding='utf-8') as f:
            k = json.load(f)
    except FileNotFoundError:
        return None, f'Chybí {cesta} — vytvoř ho podle návodu v hlavičce skriptu.'
    except (OSError, ValueError) as e:
        return None, f'{cesta} se nedá přečíst ({e.__class__.__name__}).'
    vw = k.get('vw') or {}
    if not vw.get('username') or not vw.get('password'):
        return None, f'V {cesta} chybí "vw": {{"username", "password"}}.'
    try:
        interval = int(k.get('interval') or INTERVAL_S)
    except (TypeError, ValueError):
        interval = INTERVAL_S
    return {
        'appka': str(k.get('appka') or APPKA_VYCHOZI).rstrip('/'),
        'vw': {'username': vw['username'], 'password': vw['password']},
        'vin': (k.get('vin') or '').strip().upper() or None,
        'interval': max(INTERVAL_MIN_S, min(INTERVAL_MAX_S, interval)),
    }, None


# ---------- Čtení z objektů CarConnectivity ----------
# Každý údaj je atribut s .value; kterýkoli může chybět (starší auto, jiný model),
# proto se čte opatrně a chybějící je None — appka si s tím poradí.

def _hodnota(obj, *cesta):
    for kus in cesta:
        if obj is None:
            return None
        obj = getattr(obj, kus, None)
    return getattr(obj, 'value', None) if obj is not None else None


def _cislo(v):
    try:
        return None if v is None else round(float(v), 1)
    except (TypeError, ValueError):
        return None


def _enum_text(v):
    if v is None:
        return None
    return str(getattr(v, 'value', v))


def _cas(v):
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc).isoformat()
    return None


def vyber_auto(garaz, vin=None):
    auta = list(garaz.list_vehicles()) if garaz is not None else []
    if vin:
        for a in auta:
            if (_hodnota(a, 'vin') or '').upper() == vin:
                return a
        return None
    return auta[0] if auta else None


def stav_auta(auto):
    """Z vozidla CarConnectivity → to, co appka zobrazí."""
    pohon = auto.get_electric_drive() if hasattr(auto, 'get_electric_drive') else None
    nabijeni = getattr(auto, 'charging', None)
    stav = _enum_text(_hodnota(nabijeni, 'state'))
    level = getattr(pohon, 'level', None) if pohon is not None else None
    return {
        'soc': _cislo(_hodnota(pohon, 'level')),
        'dojezdKm': _cislo(_hodnota(pohon, 'range')),
        'nabijeni': stav,
        'nabiji': stav == 'charging' if stav else None,
        'cilSoc': _cislo(_hodnota(nabijeni, 'settings', 'target_level')),
        'vykonKw': _cislo(_hodnota(nabijeni, 'power')),
        'hotovoV': _cas(_hodnota(nabijeni, 'estimated_date_reached')),
        # Kdy auto údaj naposledy změřilo — VW hlásí i staré hodnoty, když auto spí
        'zmerenoV': _cas(getattr(level, 'last_updated', None)),
        'model': _hodnota(auto, 'model'),
    }


# ---------- Appka ----------

def ohlas(nastaveni, telo):
    data = json.dumps(telo).encode('utf-8')
    req = urllib.request.Request(nastaveni['appka'] + '/api/auto/stav', data=data,
                                 headers={'Content-Type': 'application/json'}, method='POST')
    # Render po nečinnosti startuje i půl minuty
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def zabezpec_tokeny(cesta=TOKENY):
    try:
        os.chmod(cesta, 0o600)
    except OSError:
        pass


def cc_otevri(nastaveni):
    from carconnectivity import carconnectivity  # až tady: --help jde i bez knihovny
    config = {'carConnectivity': {'log_level': 'error',
                                  'connectors': [{'type': 'volkswagen', 'config': dict(nastaveni['vw'])}]}}
    return carconnectivity.CarConnectivity(config=config, tokenstore_file=TOKENY)


def kolo(nastaveni, cc):
    """Jedno přečtení a ohlášení. → True, když se povedlo."""
    from carconnectivity import errors
    try:
        cc.fetch_all()
        cc.persist()
        zabezpec_tokeny()
        auto = vyber_auto(cc.get_garage(), nastaveni['vin'])
        if auto is None:
            telo = {'chyba': 'Na účtu VW není žádné auto' + (f' s VIN {nastaveni["vin"]}' if nastaveni['vin'] else '') + '.'}
        else:
            telo = stav_auta(auto)
        ok = 'chyba' not in telo
    except errors.AuthenticationError as e:
        telo = {'chyba': 'VW odmítl přihlášení — zkontroluj heslo v auto.config.json.', 'prihlaseni': False}
        zapis(f'přihlášení odmítnuto ({e.__class__.__name__})')
        ok = False
    except Exception as e:  # noqa: BLE001 — cloud VW umí selhat všelijak, most jede dál
        telo = {'chyba': f'Čtení z cloudu VW selhalo ({e.__class__.__name__}).'}
        zapis(f'kolo spadlo: {e.__class__.__name__}: {str(e)[:200]}')
        ok = False
    try:
        ohlas(nastaveni, telo)
    except Exception as e:  # noqa: BLE001
        zapis(f'appka neodpověděla: {e.__class__.__name__}')
        return False
    return ok


def vypis(nastaveni):
    cc = cc_otevri(nastaveni)
    cc.fetch_all()
    cc.persist()
    zabezpec_tokeny()
    for a in cc.get_attributes(recursive=True):
        if a.enabled:
            print(f'{a.get_absolute_path()} = {a.value}')
    auto = vyber_auto(cc.get_garage(), nastaveni['vin'])
    print('\nCo půjde do appky:')
    print(json.dumps(stav_auta(auto) if auto else None, ensure_ascii=False, indent=1))
    cc.shutdown()


def hlavni(argv):
    nastaveni, chyba = nacti_nastaveni()
    if chyba:
        zapis(chyba)
        return 1
    try:
        import carconnectivity  # noqa: F401
    except ImportError:
        zapis('Chybí knihovna: python3 -m pip install carconnectivity carconnectivity-connector-volkswagen')
        return 1
    if '--vypis' in argv:
        vypis(nastaveni)
        return 0
    zapis(f'most spuštěn — appka {nastaveni["appka"]}, kolo po {nastaveni["interval"]} s')
    cc = cc_otevri(nastaveni)
    bezelo = False
    while True:
        ok = kolo(nastaveni, cc)
        if ok and not bezelo:
            zapis('spojení s cloudem VW i appkou funguje')
        bezelo = ok
        time.sleep(nastaveni['interval'] if ok else PAUZA_PO_CHYBE_S)


if __name__ == '__main__':
    sys.exit(hlavni(sys.argv[1:]))
