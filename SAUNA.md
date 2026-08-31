# Sauna: měření, vypínání bazénu a solinátoru

Sauna visí na **stejném jističi** jako bazén a solinátor. Když topí (6–9 kW), musí ta
dvě relé dolů, jinak jistič nevydrží. Hlídají to dvě vrstvy:

1. **Skript přímo v Shelly u sauny** — reaguje do vteřiny, funguje i když je appka
   uspaná nebo bez internetu. Jen vypíná.
2. **Appka** — vidí odběr každé 2 minuty, vypne obojí a **drží to vypnuté ještě
   30 minut po dotopení** (termostat sauny cykluje, mezi nátopy odběr spadne skoro
   na nulu — bazén se mezitím nesmí vrátit).

Zpátky zapíná jen appka, a to normální automatikou (přebytek, okno, SOC). Solinátor
o svůj denní rozpočet nepřijde — nedoběhnutý čas se přenáší na další den.

## 1. Co nastavit na Renderu

| Proměnná | Význam | Výchozí |
|---|---|---|
| `SAUNA_DEVICE_ID` | ID toho 3EM v Shelly Cloud (např. `54320470d17c`). Bez ní se stránka Sauna v appce vůbec neukáže. | – |
| `SAUNA_SERVER_URI` | Server Shelly Cloud, když je jiný než u ostatních zařízení | `SHELLY_SERVER_URI` |
| `SAUNA_ON_W` | Od kolika wattů se bere, že sauna topí | `500` |

> **Pozor:** appka běží na Renderu, takže do domácí sítě nevidí — **lokální IP jí je
> k ničemu**. Potřebuje ID zařízení ze Shelly Cloud (appka Shelly → zařízení →
> *Settings → Device information → Device ID*). Lokální IP se použije jen ve skriptu
> níž, který běží uvnitř tvojí sítě.

ID najdeš stejně jako u bazénových měřáků. Dokud proměnná chybí, appka jede přesně
jako dosud, jen bez sauny.

## 2. Skript do Shelly (rychlá vrstva)

Soubor: [`shelly/sauna.js`](shelly/sauna.js)

**Kam ho dát:**

1. Otevři webové rozhraní toho 3EM (`http://<ip-sauny>`) nebo appku Shelly.
2. **Scripts → Add script** (u Gen3 je to v levém menu, sekce *Scripts*).
3. Vlož obsah `shelly/sauna.js`, nahoře uprav:
   - `RELE` — IP adresy relé **bazénu** a **solinátoru** a jejich generaci
     (Plus/Pro/Gen3 → `gen: 2`, staré Shelly 1/1PM → `gen: 1`),
   - `PRAH_W` — stejné číslo jako `SAUNA_ON_W` na Renderu,
   - `APPKA` — volitelně adresa appky, ať blokace na serveru naskočí hned
     (jinak se čeká na poller, tedy až 2 minuty).
4. **Save** → **Start** a zaškrtni **Run on startup**, ať se skript pustí i po výpadku
   proudu.
5. V logu skriptu (tlačítko *Console*) uvidíš při topení řádky
   `sauna topí (6200 W) → vypínám bazén a solinátor`.

**Nutná podmínka:** obě relé musí mít v routeru **pevnou IP** (rezervace v DHCP).
Jinak po restartu routeru skript střílí do prázdna. Když mají relé zapnuté heslo
(*Authentication*), povel po místní síti neprojde — buď heslo vypni, nebo použij
variantu s webhookem níž.

**Jednodušší alternativa bez skriptu:** 3EM umí *URL actions* (webhooky) —
podmínka „Active power over 500 W" a tři URL:
`http://<ip-bazén>/rpc/Switch.Set?id=0&on=false`,
`http://<ip-solinátor>/rpc/Switch.Set?id=0&on=false`,
`https://<adresa-appky>/api/sauna/active`. Dělá to totéž, jen se to nastaví klikáním.

## 3. Co appka umí

- **Stránka Sauna**: semafor (zeleně topí, oranžově pauza mezi nátopy, červeně
  vypnutá, šedě nedostupný měřák), aktuální odběr a **spotřeba za 7 dní** (kWh
  a jak dlouho topila).
- **Bazén a solinátor** mají pod tlačítky „Vypnuto saunou — vrátí se po 19:40".
- Vypnutí kvůli sauně **přebíjí i ruční zapnutí a bazénové „+24 h"** — jistič má
  přednost před vším ostatním.
- **Notifikace**: když sauna topí **2 hodiny v kuse**, přijde upozornění; pokud topí
  dál, připomene se po dalších **6 hodinách**. Po dotopení se to samo vynuluje.
- Sauna má vlastní pruh na časové ose „Kdy co běželo" a **nepočítá se do spotřeby
  domu** (měří se zvlášť).
- Když měřák sauny přestane odpovídat, appka to hlásí jako každý jiný výpadek
  (červený řádek + notifikace po 15 min). Blokace bazénu v tu chvíli doběhne
  normálně za 30 minut — proto je ten skript v Shelly důležitý.

## 4. Jak to vyzkoušet, až to bude zapojené

1. Pusť saunu a koukej na stránku **Sauna** — do 2 minut naskočí odběr a zelený semafor.
2. Na stránce **Bazén** se u obou relé objeví „Vypnuto saunou".
3. V **logu** přibude „Sauna: topí (6 200 W) — bazén a solinátor jdou dolů".
4. Po vypnutí sauny zkontroluj, že se bazén vrátí **až po 30 minutách** (a jen když
   mu to dovolí přebytek a okno).
