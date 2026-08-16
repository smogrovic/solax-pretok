# Sauna na stejném jističi: bazén a solinátor jí uhnou

> **Zatím jen plán, nic z toho není nasazené.** Odložené do doby, než sauna bude
> fyzicky na místě (16. 8. 2026). Až přijde čas, jede se podle tohohle souboru —
> čísla řádků odpovídají stavu v commitu, který ho přidal.

## Kontext

Na stejný jistič jako bazén přibude sauna. Jakmile sauna topí, musí jít bazén
i solinátor dolů, jinak jistič nevydrží. Rychlé vypnutí napíšeš přímo do skriptu
v Shelly — otázka byla, jestli se s tím appka nepopere.

**Popere.** Solinátor se neřídí přebytkem, ale **denním rozpočtem hodin**
(`runSolinatorAutomation`, `server.js:1869`): každých 5 minut se podívá, jestli mu
dnes ještě něco zbývá, a pošle `on`. Skript ho vypne, appka ho zase zapne — a po
šesti kolech `logAutoSet` (`server.js:1649`) napíše falešné „Solinátor: nereaguje na
povel «zapnuto»". Bazén je přebytkový (`runPoolAutomation`, `server.js:1689`), takže
většinou uhne sám (sauna sežere přebytek), ale za silného slunce zbyde i po sauně přes
práh 1850 W a appka ho zapne zpátky.

**Řešení má dvě vrstvy.** Skript v Shelly zůstává jako tvrdá pojistka — reaguje
v sekundách a funguje, i když Render spí. Appka o sauně nově **ví**: sama bazén
i solinátor vypne a **drží je vypnuté, dokud sauna topí a ještě 30 minut potom**.
Tím přetahování mizí a solinátor jde dolů, i když má na dnešek nedoděláno — sauna má
přednost. Nedoběhnutý čas se solinátoru neztratí, sebere ho stávající přenos do dalšího
dne (`solinatorCarryFor`, strop 3 h).

## 1. Jak appka pozná saunu

Sauna má **vlastní Shelly PM** (jen měření, spíná ji její ovládání) → nová proměnná
prostředí **`SAUNA_PM_ID`**. Bez ní se celá věc tiše vypne, jako u ostatních volitelných
zařízení.

- Čtení: `fetchShellyPowerW()` (`server.js:455`) v `pollShelly()` (`server.js:558`) hned
  vedle `POOL_PM_IDS` → `state.saunaPowerW`, broadcast událostí `sauna`. Jede to ve
  stávající frontě `shellyQueued`, takže o jeden dotaz za 2 min navíc.
- `SAUNA_ON_W = 500` — nad tím „sauna topí". Kamna mají 6–9 kW, klid je nula, takže
  práh nemusí být chytrý.
- **Zdržení místo okamžitého puštění:** kdykoli je odběr nad prahem, nastaví se
  `state.saunaUntil = now + 30 min`. `saunaBlocking()` = `Date.now() < state.saunaUntil`.
  Tím se pokryje cyklování termostatu (kamna mezi přitopením spadnou na nulu i na pár
  minut) i tvých 30 minut po posledním odběru. Po vypršení se nic nezapíná natvrdo —
  jen se pustí normální automatika, takže platí všechny dosavadní podmínky (přebytek,
  SOC, okno, hystereze).
- **Volitelná rychlá cesta:** `POST /api/sauna/active` bez tokenu (stejně jako
  `/api/*/restore`) posune `saunaUntil` okamžitě. Skript ji může zavolat a odpadne
  tím okno až 2 min, než si poller sauny všimne. Bez ní to funguje taky, jen o chlup
  později.

Obnovu po deployi (`/api/*/restore`) sauna **nepotřebuje** — blokace trvá 30 min
a poller ji obnoví do 2 minut.

## 2. Blokace v automatikách

Klíčové je **kam** to dát. `runPoolAutomation` se vůbec nezavolá, když nejsou čerstvá
data ze střídače (`server.js:2053`) — v noci střídač spí. Vypnutí kvůli sauně na datech
ze střídače viset nesmí.

- **Nový `enforceSaunaOff(now)`** vedle `enforcePoolOffWindow` (`server.js:1837`), volaný
  ve stejné časové části `runAutomation` **před** guardy na počasí a Solax: když
  `saunaBlocking()`, pošle `autoSet('pool', 'off', 'sauna topí')` a
  `autoSet('solinator', 'off', 'sauna topí')` na to, co je zapnuté, a vynuluje
  `poolAuto.overCount/underCount`.
- **`runPoolAutomation`** — hned za guardem na neznámý stav: při `saunaBlocking()`
  vypnout a `return`. Vědomě to obchází `POOL_MIN_RUN_MS` (30 min minimálního běhu),
  stejně jako to dnes dělá západ slunce — jistič má přednost před hysterezí.
- **`runSolinatorAutomation`** — až **za** `solinatorRollDay`, `refreshForecast`,
  `applyTempBonus` a `broadcastSolinator()` (ať rozpis a odhad na zítřek zůstanou
  správné), ale před rozhodnutím o zapnutí: při `saunaBlocking()` vypnout a `return`.
- **Bojler 1** nepotřebuje nic — `runBoilerAutomation` už vypíná, když bazén neběží.

## 3. Sauna jako plnohodnotné zařízení v appce

Sauna nemá relé, takže jde o **zobrazení bez ovládání** — vzor je měření bazénu
(`renderPoolPower`, `public/index.html:2410`) a wallbox, který je taky jen v timeline
a v denních kWh, ne v `runtime.ms`.

- **Snapshot + SSE**: `saunaPowerW` a `saunaUntil` do `snapshot()` (vedle `poolPowerW`,
  `server.js:222`) a událost `sauna`.
- **Timeline**: nový klíč `sauna` v `state.timeline` (`server.js:109`), segmenty podle
  odběru nad prahem — přesně jako větev wallboxu v `updateRuntimes()` (`server.js:627`).
  V klientovi přidat do `TIMELINE_BASE_KEYS` a `TIMELINE_BASE` (`public/index.html:3022`)
  s barvou ověřenou na barvosleposti vůči stávající čtveřici, a do `validKey`
  v `/api/timeline/restore` (`server.js:1008`).
- **Denní kWh**: `sauna` do `emptyWh()` (`server.js:596`) a načítání v `updateRuntimes()`
  jako `wh.wb`. Slučování na klientovi jede přes `Object.keys`, takže záloha
  do localStorage a obnova fungují samy; přibude jen řádek v Přehledu.
- **Spotřeba domu**: odečíst saunu ve vzorci `houseKw` (`server.js:317`) vedle bazénu
  a bojlerů — jinak by se sauna počítala dvakrát.
- **Dlaždice + hláška**: odběr sauny na stránce Bazén a řádek, když blokuje —
  „Sauna topí — bazén a solinátor pozastaveny do 19:40" (čas z `saunaUntil`).
- **Logika automatiky**: nový odstavec — práh, 30 min zdržení, přednost před denním
  rozpočtem solinátoru, a že nedoběhnutý čas se přenáší na další den.

## 4. Skript v Shelly (mimo repo — dělám jen zadání)

Aby si skript a appka nelezly do zelí:

- Běží na Shelly u sauny (Gen2/Gen3 umí skripty), sleduje výkon, **stejný práh 500 W**.
- Nad prahem vypne obě relé lokálně po síti, ne přes cloud:
  Gen2+ `http://<ip>/rpc/Switch.Set?id=0&on=false`, Gen1 `http://<ip>/relay/0?turn=off`.
  Chce to **pevné IP** (rezervace v DHCP), jinak to po restartu routeru přestane platit.
- Volitelně navíc `GET`/`POST` na `/api/sauna/active` appky, ať blokace naskočí hned.
- Vypnutí stačí poslat při náběhu nad práh; ustálený stav pak drží appka.

## Soubory
- `server.js` — `SAUNA_PM_ID` + `SAUNA_ON_W` + `SAUNA_HOLD_MS`, čtení PM v `pollShelly`,
  `saunaBlocking()`, `enforceSaunaOff()`, guardy v `runPoolAutomation`
  a `runSolinatorAutomation`, `houseKw`, `emptyWh`/`updateRuntimes`, `state.timeline`,
  `validKey`, `snapshot`, endpoint `/api/sauna/active`.
- `public/index.html` — dlaždice a hláška na stránce Bazén, řádek v Přehledu,
  `TIMELINE_BASE`, text na stránce Logika automatiky.

## Ověření
1. **Nová sada `sim12`** (scratchpad, kód ze zdroje přes `zdroj.js`):
   - sauna 3 kW → bazén i solinátor dostanou `off`,
   - solinátor jde dolů, i když má na dnešek nedoděláno (sauna má přednost),
   - cyklování termostatu: odběr spadne na 0 na 5 min → pořád blokováno,
   - 31 min po posledním odběru → blokace končí a rozhoduje zase přebytek/rozpočet,
   - blokace **nikdy nic nezapíná**, jen vypíná,
   - bazén se vypne i před uplynutím 30 min minimálního běhu,
   - blokace funguje i bez čerstvých dat ze střídače (časová větev `runAutomation`),
   - nedoběhnutý čas solinátoru se přenese na další den (strop 3 h).
2. **Proti běžícímu serveru** na 3999: `/api/sauna/active` posune `saunaUntil`,
   snapshot nese `saunaPowerW` i `saunaUntil`, `/api/timeline/restore` bere klíč `sauna`.
3. **Vyrenderovat stránku Bazén** v headless Chromiu ve dvou stavech (sauna topí /
   sauna studená) a Přehled s pruhem sauny v timeline; zkontrolovat barvu vůči
   stávající čtveřici.
4. `node --check`, kontrola inline JS, přeběhnout sim2/4/5/6/7/8/9/10/11 a sady
   v prohlížeči (gesto žaluzií, doba běhu, bazén).
5. Commit na `claude/solinator-rename-gnu0kl`, fast-forward do `main`, push obojí.

**Co potřebuju od tebe, než to začne fungovat:** ID toho Shelly PM u sauny do proměnné
`SAUNA_PM_ID` na Renderu (stejný formát jako `POOL_PM_IDS`, např. `54320470d17c`).
Do té doby appka pojede přesně jako dnes, jen bez sauny.
