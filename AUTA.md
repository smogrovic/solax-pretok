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

## VW Multivan — jak zkusit živá data (podrobně)

Most `public/nas/auto-most.py` běží na NASu a čte data přes knihovnu CarConnectivity
(neoficiální přístup do cloudu VW, oficiální pro majitele VW nemá). VW ho 27.–28. 5. 2026
zablokoval; komunita ho částečně obešla. Proto nejdřív zkouška, jestli to u nás pojede.

**Proč NAS a ne server na Renderu:** knihovna je v Pythonu (server je v Node), heslo k VW ID
by muselo být na Renderu a cloud VW servery z datacenter blokuje častěji než domácí připojení.
Kdyby na NASu jelo spolehlivě, dá se přesun zvážit.

Heslo k VW ID nikam nepiš — jen do souboru na NASu (krok 6). Do chatu ani do repozitáře ne.

**Stav 11/2026:** přístup přes We Connect (connector `volkswagen`) VW zablokoval — i nejnovější
verze hlásí *Authorization URL could not be fetched due to WeConnect failure*. Most proto
výchozí čte z **portálu VW podle EU Data Act** (connector `vw_eu_data_act`): jen čtení, data
po ~15 minutách, umí i hybridy. Navíc je potřeba:

### 0. Portál EU Data Act (jednou, v prohlížeči)
1. Otevři https://eu-data-act.vwgroup-datahub.com/ a přihlas se **VW ID** (stejný účet jako appka).
2. **Data clusters → Vehicle overview**; když tam auto není, **připoj ho** (souhlasy pro VIN).
3. U auta **Get customised data** → nastav **průběžný (continuous) požadavek** s frekvencí
   **15 minut**.
4. Počkej, až se v seznamu dodávek objeví první ZIP soubory (může to chvíli trvat).

V kroku 4 se pak instaluje `carconnectivity-connector-vw-eu-data-act`
(`$PY -m pip install --upgrade carconnectivity-connector-vw-eu-data-act`). Most zkusí značku
osobní VW a pak užitkové VW (Multivan). Ke starému We Connect jde vrátit `"zdroj": "weconnect"`
v části `"vw"` konfigurace.

### 1. Zapnout SSH na NASu (jednou)
DSM v prohlížeči → **Ovládací panely → Terminál a SNMP** → zaškrtni **Povolit službu SSH**
(port 22) → **Použít**.

### 2. Připojit se z Macu
1. Otevři appku **Terminál** (Spotlight ⌘+mezerník → „Terminál“).
2. Napiš (UZIVATEL = tvůj účet v DSM, IP_NASU = adresa NASu v síti, např. 192.168.1.x —
   najdeš ji v DSM → Ovládací panely → Síť):
   ```
   ssh UZIVATEL@IP_NASU
   ```
3. Napoprvé se zeptá *Are you sure you want to continue connecting?* → napiš `yes` a Enter.
4. Zadej heslo k DSM. **Při psaní se nic nezobrazuje, ani hvězdičky** — to je správně. Enter.
5. Přepni se na správce: `sudo -i` a znovu heslo k DSM. Řádek teď končí `#`.

### 3. Python a pip
```
python3 --version
python3 -m pip --version
```
- Když `pip` chybí: `python3 -m ensurepip --upgrade`.
- Knihovna potřebuje Python 3.9 nebo novější. Když je verze starší (DSM má někdy 3.8),
  nainstaluj v DSM **Centrum balíčků → Python 3.11** (nebo nejnovější nabízený) a dál místo
  `python3` piš celou cestu, kterou vypíše `ls /var/packages/*ython3*/target/usr/bin/python3*`.

### 4. Složka a knihovna
```
mkdir -p /volume1/family/scripts/auto
cd /volume1/family/scripts/auto
python3 -m pip install --upgrade pip
python3 -m pip install --upgrade carconnectivity carconnectivity-connector-volkswagen
```
Trvá to pár minut. Červené *WARNING* nevadí, *ERROR* na konci ano — pak výstup pošli Claudovi.

### 5. Stáhnout most
```
curl -o auto-most.py https://solax-pretok.onrender.com/nas/auto-most.py
```
(Render po nečinnosti usíná — když to napoprvé selže, zkus za minutu znovu.)

### 6. Konfigurace s heslem
```
vi auto.config.json
```
V editoru `vi`: stiskni **i** (psaní), vlož text níže a doplň svůj e-mail a heslo k VW ID
(ten účet, kterým se přihlašuješ do appky Volkswagen), pak **Esc**, napiš **:wq** a Enter.
```
{"appka": "https://solax-pretok.onrender.com",
 "vw": {"username": "tvuj e-mail k VW ID", "password": "heslo k VW ID"}}
```
Pak soubor zamkni jen pro správce: `chmod 600 auto.config.json`

### 7. Zkouška
```
python3 auto-most.py --vypis
```
- **Vypíše procenta baterie, dojezd a stav nabíjení** → funguje, pokračuj krokem 8.
- **Chyba přihlášení, 401, 403, „login failed“** → VW přístup zavřel. Výstup zkopíruj a pošli
  Claudovi, **ale nejdřív z něj smaž VIN a e-mail** (heslo se nevypisuje).
- **„Chybí knihovna“** → zopakuj krok 4.

### 8. Spouštět trvale
DSM → **Ovládací panely → Plánovač úloh → Vytvořit → Spuštěná úloha → Uživatelem definovaný
skript**:
- Obecné: název „VW most“, **Uživatel: root**, Událost: **Spuštění systému**.
- Nastavení úlohy → Spustit příkaz:
  ```
  python3 /volume1/family/scripts/auto/auto-most.py >> /volume1/family/scripts/auto/auto-most.log 2>&1
  ```
- **OK**, pak úlohu označ a dej **Spustit** (ať nečeká na restart NASu).

Do 10 minut se karta VW na Auta/Wallbox naplní (procenta, dojezd, nabíjení). Když ne:
`tail -n 30 /volume1/family/scripts/auto/auto-most.log` a výstup (bez VIN a e-mailu) Claudovi.

### 9. Odhlásit se z NASu
`exit` (ze správce) a ještě jednou `exit`. SSH můžeš v DSM zase vypnout, most běží dál.

### Když to nepůjde vůbec
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
