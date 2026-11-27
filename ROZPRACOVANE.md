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

## VW Multivan — živá data přes portál EU Data Act (čeká se na VW)

**Stav (27. 11. 2026):** most `public/nas/auto-most.py` je na NASu (verze 11 923 B),
přihlášení do portálu funguje, auto se našlo jako `VOLKSWAGEN_PASSENGER_CARS`.
Žádost o data („Načíst data definovaná uživatelem", průběžně) je podaná; portál
vrací 404 na `/list`, dokud nepřijde první dodávka (VW má až 24 h).

**Co má udělat uživatel (připomenout, až se zeptá):**
1. Na portálu (Přehled vozidel → auto) zkontrolovat, že přišla první data.
2. Na NASu: `ssh` na NAS, `sudo -i`,
   `PY=/var/packages/Python3.9/target/usr/bin/python3.9`,
   `cd /volume1/family/scripts/auto`, `$PY auto-most.py --vypis`.
   Výstup poslat **bez VIN a e-mailu**.

**Co pak udělá Claude:**
- napevno nastavit značku v konfiguraci (osobní VW),
- doladit kartu VW (Auta/Wallbox i kalendář na iPadu) podle toho, co portál posílá,
- dát krok do Plánovače úloh: Spuštění systému, root, příkaz
  `/var/packages/Python3.9/target/usr/bin/python3.9 /volume1/family/scripts/auto/auto-most.py >> /volume1/family/scripts/auto/auto-most.log 2>&1`.

## Kalendář na iPadu — počasí + auta (doladit detaily)

Vpravo nahoře počasí na půl výšky (co se nevejde, posouvá se), dole karty
BMW 420d a VW Multivan vedle sebe (`#kalAuta`, `renderKalAuta`). Uživatel chce
detaily doladit, až to uvidí.
