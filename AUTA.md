# Auta a motorka v SMGhome

Stránka **Auta/Wallbox** má kartu pro každé vozidlo: fotku, živá data (kde to jde) a sekci
**Termíny a údaje** (STK, známka, pojištění, olej, SPZ/VIN…). Stav k 11/2026:

| Vozidlo | Živá data | Ovládání (zamknout, topení…) |
|---|---|---|
| BMW 420d Gran Coupé | ✅ BMW CarData (oficiální, zdarma) | ❌ CarData je jen pro čtení |
| VW Multivan | ⚠️ most na NASu, VW ho v 5/2026 zablokoval | ❌ jen přes appku VW |
| BMW R 1300 GS | ❌ BMW Motorrad rozhraní nemá | ❌ |

## Ovládání aut z appky (zamknout, odemknout, větrání…)

- **BMW CarData** umí jen číst data. Na povely má BMW zvláštní rozhraní jen pro svou appku
  My BMW a od roku 2025 ho jiným programům blokuje.
- **VW** stejně: povely jdou jen přes appku Volkswagen.
- **Jediná čistá cesta jsou Zkratky v iPhonu.** Když appka výrobce nabízí akce ve Zkratkách
  (Siri), umí SMGhome tlačítkem spustit zkratku a tu provede appka výrobce v telefonu.
  - Jak to ověřit: appka **Zkratky** → **+** → **Přidat akci** → hledat „BMW“ / „Volkswagen“.
    Když se tam objeví akce typu *Zamknout vozidlo*, napiš Claudovi jejich názvy.
  - Pak: v Zkratkách vytvořit zkratky (např. „Zamknout BMW“) a Claude přidá do karty auta
    tlačítka, která je spustí (`shortcuts://run-shortcut?name=…`). Funguje jen na iPhonu
    s nainstalovanou appkou výrobce; do serveru nejde nic.
  - Když akce ve Zkratkách nejsou, ovládání z SMGhome udělat nejde (bez obcházení zabezpečení
    výrobce, což tu neděláme).

## VW Multivan — jak zkusit živá data

Most `public/nas/auto-most.py` běží na NASu a čte data přes knihovnu CarConnectivity
(neoficiální přístup do cloudu VW). VW ho 27.–28. 5. 2026 zablokoval; komunita ho částečně
obešla. Postup, jestli to u nás pojede:

1. **SSH na NAS jako root** a aktualizovat knihovnu:
   ```
   python3 -m pip install --upgrade carconnectivity carconnectivity-connector-volkswagen
   curl -o /volume1/family/scripts/auto/auto-most.py https://solax-pretok.onrender.com/nas/auto-most.py
   ```
2. **Konfigurace** `auto.config.json` vedle skriptu (heslo k VW ID jen sem, ne do chatu):
   ```
   {"appka": "https://solax-pretok.onrender.com",
    "vw": {"username": "…", "password": "…"}}
   ```
3. **Zkouška:** `python3 /volume1/family/scripts/auto/auto-most.py --vypis`
   - Vypíše procenta, dojezd, nabíjení → funguje. Pak spouštět bez `--vypis` v Plánovači úloh
     (Spuštění systému). Karta VW se sama naplní do 10 minut.
   - Chyba přihlášení / 401 / 403 → VW přístup zavřel. Výstup (bez hesla) pošli Claudovi;
     zkusí, jestli novější verze knihovny nepomůže.
4. **Když to nepůjde:**
   - *Oficiální partneři VW* (Tronity, Enode, …) — placené, hlavně stav nabíjení. Pro domácí
     kartu se to nevyplatí.
   - *EU Data Act* (od 9/2026 musí výrobce dát majiteli data z auta) — VW zatím nemá rozhraní
     na živá data, jen žádost o export. Až ho mít bude, napoj se přes něj.
   - Do té doby má karta VW jen termíny a údaje.

## BMW R 1300 GS — co jde

- **BMW CarData je jen pro auta** (BMW, MINI). Motorky BMW Motorrad tam nejsou.
- **Appka BMW Motorrad Connected** ukazuje kilometry, servis a jízdy, ale rozhraní pro jiné
  programy nemá (ani neoficiální, které by se dalo rozumně používat).
- **Co jde v SMGhome:** termíny a údaje v kartě motorky; u oleje se při **Hotovo** zadávají
  kilometry, takže je přehled o servisu.
- **Případně:** jízdy z Connected appky jdou exportovat (GPX) — kdyby byla chuť na knihu jízd,
  dá se udělat ruční import. Napiš Claudovi.

## BMW auto — co už funguje

Připojení: karta BMW → Client ID z webu BMW (BMW CarData → Technický přístup, zapnuté API
i Streaming) → kód potvrdit na webu BMW. Server drží tokeny sám. Které další údaje auto
posílá: Log/Nastavení → **BMW — co auto posílá** (jen názvy polí), seznam pošli Claudovi.
