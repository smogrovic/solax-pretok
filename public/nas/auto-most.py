#!/usr/bin/env python3
# Most mezi appkou a autem VW — běží trvale na NASu.
#
# Stav auta (procenta baterie, dojezd, nabíjení) umí jen cloud Volkswagenu. Čtení
# obstará knihovna CarConnectivity (github.com/tillsteinbach/CarConnectivity).
# Dvě cesty („zdroj" v konfiguraci):
#   - "eu-data-act" (výchozí): portál VW podle EU Data Act (eu-data-act.vwgroup-
#     datahub.com), connector carconnectivity-connector-vw-eu-data-act. Jen čtení,
#     data po ~15 min. Na portálu je potřeba jednou zapnout průběžný požadavek
#     na data (Get customised data → continuous, 15 minut) — viz AUTA.md.
#   - "weconnect": původní přístup appky We Connect; VW ho 5/2026 zablokoval.
# Přihlašuje se tady doma, heslo k VW ID zůstává na NASu a appka dostane jen stav.
# Spojení navazuje VŽDYCKY most sám směrem ven, do domácí sítě se nic neotevírá.
#
# Instalace (jednou, přes SSH jako root; na DSM je potřeba Python 3.9 z Centra balíčků):
#   PY=/var/packages/Python3.9/target/usr/bin/python3.9
#   $PY -m pip install --upgrade carconnectivity carconnectivity-connector-vw-eu-data-act
#   curl -o /volume1/family/scripts/auto/auto-most.py https://solax-pretok.onrender.com/nas/auto-most.py
# Vedle skriptu vytvoř auto.config.json (heslo sem, do chatu ani repozitáře ne):
#   {"appka": "https://solax-pretok.onrender.com",
#    "vw": {"username": "tvuj@email.cz", "password": "heslo-k-VW-ID"}}
# Volitelně "vin" (když je na účtu víc aut), "interval" v sekundách (výchozí 900),
# ve "vw" pak "zdroj" ("eu-data-act" / "weconnect") a "brand" (značka na portálu;
# bez ní se zkusí osobní VW a pak užitkové VW — Multivan bývá pod užitkovými).
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
INTERVAL_S = 900          # portál EU Data Act dává nová data po ~15 min, častěji to nemá smysl
ZNACKY_VW = ['VOLKSWAGEN_PASSENGER_CARS', 'VOLKSWAGEN_COMMERCIAL_VEHICLES']
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
    zdroj = str(vw.get('zdroj') or 'eu-data-act').lower()
    if zdroj not in ('eu-data-act', 'weconnect'):
        return None, f'V {cesta} je "zdroj" "{zdroj}" — povolené jsou "eu-data-act" a "weconnect".'
    return {
        'appka': str(k.get('appka') or APPKA_VYCHOZI).rstrip('/'),
        'vw': {'username': vw['username'], 'password': vw['password']},
        'zdroj': zdroj,
        'znacky': [str(vw['brand'])] if vw.get('brand') else list(ZNACKY_VW),
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


ZAMEK_CZ = {'locked': 'zamčeno', 'unlocked': 'odemčeno'}


def _pohony(auto):
    """Všechny pohony auta (portál EU Data Act je dává do drives.drives, i spalovací)."""
    d = getattr(getattr(auto, 'drives', None), 'drives', None)
    return list(d.values()) if isinstance(d, dict) else []


def _je_elektricky(pohon):
    return (_enum_text(_hodnota(pohon, 'type')) or '').lower() == 'electric'


def stav_auta(auto):
    """Z vozidla CarConnectivity → to, co appka zobrazí."""
    pohony = _pohony(auto)
    pohon = auto.get_electric_drive() if hasattr(auto, 'get_electric_drive') else None
    if pohon is None:
        pohon = next((p for p in pohony if _je_elektricky(p)), None)
    # Nádrž: první pohon, který není elektrický (diesel, benzín…)
    nadrz = next((p for p in pohony if not _je_elektricky(p)), None)
    nabijeni = getattr(auto, 'charging', None)
    stav = _enum_text(_hodnota(nabijeni, 'state'))
    level = getattr(pohon, 'level', None) if pohon is not None else None
    dojezd = next((d for d in (_cislo(_hodnota(auto, 'drives', 'total_range')), _cislo(_hodnota(pohon, 'range')),
                               _cislo(_hodnota(nadrz, 'range'))) if d is not None), None)
    zamek = _enum_text(_hodnota(auto, 'doors', 'lock_state'))
    brzda = _hodnota(auto, 'parking_brake')
    udrzba = getattr(auto, 'maintenance', None)
    return {
        'soc': _cislo(_hodnota(pohon, 'level')),
        'dojezdKm': dojezd,
        'palivoPct': _cislo(_hodnota(nadrz, 'level')),
        'km': _cislo(_hodnota(auto, 'odometer')),
        'zamek': ZAMEK_CZ.get((zamek or '').lower()) if zamek else None,
        'rucniBrzda': brzda if isinstance(brzda, bool) else None,
        'servisDatum': _cas(_hodnota(udrzba, 'inspection_due_at')),
        'servisKm': _cislo(_hodnota(udrzba, 'inspection_due_after')),
        'olejDatum': _cas(_hodnota(udrzba, 'oil_service_due_at')),
        'olejKm': _cislo(_hodnota(udrzba, 'oil_service_due_after')),
        'nabijeni': stav,
        'nabiji': stav == 'charging' if stav else None,
        'cilSoc': _cislo(_hodnota(nabijeni, 'settings', 'target_level')),
        'vykonKw': _cislo(_hodnota(nabijeni, 'power')),
        'hotovoV': _cas(_hodnota(nabijeni, 'estimated_date_reached')),
        # Kdy auto údaj naposledy změřilo — VW hlásí i staré hodnoty, když auto spí
        'zmerenoV': _cas(getattr(level, 'last_updated', None)) or _cas(_hodnota(auto, 'captured_at')),
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


CEKA_NA_DATA = 'Portál VW zatím nedodal žádná data — požadavek čeká na první dodávku (až 24 h).'


def ceka_na_data(e):
    """Portál EU Data Act vrací 404 na seznam dodávek, dokud nepřišla první."""
    t = str(e)
    return '404' in t and '/list' in t


def cc_konfigurace(nastaveni, znacka=None):
    if nastaveni.get('zdroj') == 'weconnect':
        connector = {'type': 'volkswagen', 'config': dict(nastaveni['vw'])}
    else:
        connector = {'type': 'vw_eu_data_act', 'config': {**nastaveni['vw'], 'interval': nastaveni['interval'],
                                                         'brand': znacka or nastaveni['znacky'][0]}}
    return {'carConnectivity': {'log_level': 'error', 'connectors': [connector]}}


def cc_otevri(nastaveni):
    """Otevře CarConnectivity. U portálu EU Data Act zkusí značky po řadě (osobní VW,
    užitkové VW) a nechá tu, pod kterou je na účtu auto."""
    from carconnectivity import carconnectivity  # až tady: --help jde i bez knihovny
    znacky = [None] if nastaveni.get('zdroj') == 'weconnect' else nastaveni['znacky']
    posledni = None
    for i, znacka in enumerate(znacky):
        cc = carconnectivity.CarConnectivity(config=cc_konfigurace(nastaveni, znacka), tokenstore_file=TOKENY)
        posledni = cc
        if i == len(znacky) - 1:
            break
        try:
            cc.fetch_all()
        except Exception as e:  # noqa: BLE001
            # Přihlášení prošlo a auto se našlo, jen portál ještě nemá data (404 na
            # seznamu dodávek) → značka je správná, další se nezkouší
            if ceka_na_data(e) or vyber_auto(cc.get_garage(), nastaveni['vin']) is not None:
                return cc
            zapis(f'značka {znacka}: {e.__class__.__name__}: {str(e)[:150]}')
        if vyber_auto(cc.get_garage(), nastaveni['vin']) is not None:
            return cc
        zapis(f'pod značkou {znacka} žádné auto, zkouším další')
        cc.shutdown()
    return posledni


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
        if ceka_na_data(e):
            ohlas_bezpecne(nastaveni, {'chyba': CEKA_NA_DATA})
            zapis('portál zatím nemá data, zkusím později')
            return False
        telo = {'chyba': f'Čtení z cloudu VW selhalo ({e.__class__.__name__}).'}
        zapis(f'kolo spadlo: {e.__class__.__name__}: {str(e)[:200]}')
        ok = False
    try:
        ohlas(nastaveni, telo)
    except Exception as e:  # noqa: BLE001
        zapis(f'appka neodpověděla: {e.__class__.__name__}')
        return False
    return ok


def ohlas_bezpecne(nastaveni, telo):
    try:
        ohlas(nastaveni, telo)
    except Exception as e:  # noqa: BLE001
        zapis(f'appka neodpověděla: {e.__class__.__name__}')


def vypis(nastaveni):
    cc = cc_otevri(nastaveni)
    try:
        cc.fetch_all()
    except Exception as e:  # noqa: BLE001
        if not ceka_na_data(e):
            raise
        print('\nPřihlášení k portálu VW funguje a auto je na účtu. ' + CEKA_NA_DATA
              + '\nAž bude u auta na portálu první dodávka, spusť --vypis znovu.')
        cc.shutdown()
        return
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
        zapis('Chybí knihovna: python3 -m pip install carconnectivity carconnectivity-connector-vw-eu-data-act')
        return 1
    if '--vypis' in argv:
        vypis(nastaveni)
        return 0
    zapis(f'most spuštěn — zdroj {nastaveni["zdroj"]}, appka {nastaveni["appka"]}, kolo po {nastaveni["interval"]} s')
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
