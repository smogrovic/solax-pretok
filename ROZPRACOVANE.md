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
