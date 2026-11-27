# Rozpracováno

## Alarm přes SMS (Zakóduj / Odkóduj)

**Stav:** odloženo. Tlačítka jsou v appce, ale schovaná (`#asstAlarm hidden`
v `public/index.html`). Kód i testy fungují.

**Co je hotové:** tlačítka „Zakóduj alarm" / „Odkóduj alarm" se zeptají (15 s)
a spustí zkratku v iPhonu „Alarm zapnout" / „Alarm vypnout"
(`shortcuts://run-shortcut?name=…`), která pošle SMS ústředně. Číslo ani kód
alarmu appka nezná. Statický test hlídá, že se do `index.html` nedostanou.

**Proč odloženo:** spuštění zkratky z webové appky vždy přepne do aplikace
Zkratky a zpátky do appky se to samo nevrátí.

**Jak pokračovat (bez opuštění appky):** SMS musí poslat server. Varianty:
1. **SMS brána** (SMSbrána / GoSMS / Twilio, ~1–2 Kč za SMS). SMS odejde
   z čísla brány, takže ho možná bude třeba povolit v ústředně. Kód alarmu půjde
   jen do Render → Environment.
2. **E-mail + osobní automatizace v iPhonu** („Když přijde e-mail od…",
   spustit okamžitě → Poslat zprávu). Je to zdarma a odejde z vlastního čísla,
   ale potřebuje to SMTP na serveru a záleží na tom, jak rychle iPhone stáhne
   poštu.

**Otevřené otázky:** kterou variantu, a jestli ústředna bere povely z jakéhokoli
čísla, nebo jen z povolených.

**Bezpečnost:** kód alarmu prošel chatem na snímku, takže je potřeba ho změnit.
Číslo a kód nikdy nepatří do repozitáře ani do chatu.

## VW Multivan — živá data přes portál EU Data Act

**Stav (27. 11. 2026, 22:35):** most běží na NASu (verze 14 548 B), spouští ho hlídač
v Plánovači úloh (druhý řádek pod smyčkou vysavač/závlaha). Uživatel podal na portálu
novou průběžnou žádost s víc skupinami dat (All Data, nebo Dashboard Measurements +
Breakdown) kvůli baterii, nádrži a dojezdu; čeká se na první dodávku (až 24 h).

**Připomenout:** po dodávce spustit `$PY auto-most.py --vypis` a výpis (bez VIN) poslat.
Zkontrolovat, že přišly `soc`, `palivoPct`, `dojezdKm`, nabíjení a `zapojeno`, a podle
toho doladit kartu VW. Ověřit, že hlídač má oba řádky uložené (přežije restart NASu).

## Motorka BMW R 1300 GS — zjistit, jestli je v BMW CarData

Uživatel ověří na webu BMW (stejně jako u auta: BMW CarData), jestli je tam mezi vozidly
i motorka. Když ano, server (`bmwDotaz`, mapování vozidel) se rozšíří na víc vozidel
a motorka dostane živá data jako BMW. Když ne, zůstávají jen termíny a údaje.

## Kalendář na iPadu — počasí + auta (doladit detaily)

Vpravo nahoře počasí na půl výšky (co se nevejde, posouvá se), dole karty
BMW 420d a VW Multivan vedle sebe (`#kalAuta`, `renderKalAuta`). Uživatel chce
detaily doladit, až to uvidí.
