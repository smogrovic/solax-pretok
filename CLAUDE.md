# Poznámky pro Clauda

- **Appka se jmenuje SMGhome.** Neříkej jí Solinátor.
- „Solinátor“ je **zařízení u bazénu** (relé `SOLINATOR`, denní rozpočet hodin, boost podle chloru).
  V kódu, logu i v appce se tak jmenuje dál, to se nepřejmenovává.
- Proměnné `SOLINATOR_URL` / `SOLINATOR_KLIC` ve druhé appce (viz `AUTO-NABIJENI.md`) jsou historické
  názvy, nepřejmenovávat.
- Uživateli odpovídej česky.
- **Změny nastavení topení a ohřevu vody** se zapisují do `TOPENI_ZMENY` v `server.js` (jdou s exportem
  `/api/topeni` jako `zmenyNastaveni`). Při analýze nových dat porovnej období před změnou a po ní.
  Novou změnu, kterou uživatel udělá, připiš na konec seznamu.
- **Televize dětí:** rozvrh řídí appka (Log/Nastavení → Rozvrh televize dětí, server `runTvRozvrh`),
  ne Shelly. **Elenka zatím Shelly nemá — uživatel ho přidá.** Až ho přidá: vyplnit
  `TV_ELENKA_DEVICE_ID` (Render → Environment); relé `tvElenka`, tlačítka na Ovládání a spouštění
  jejího rozvrhu se zapnou samy. Zkontroluj pak i časovače relé (`RELAY_TIMER_DEVICES` v appce),
  kde Elenka zatím není, a že v aplikaci Shelly je plán vypnutý (aktualizace firmwaru zůstává).
- **Na sauně se nic samo nepřeučuje:** vzorec náběhu je pevný (`SAUNA_*` v `server.js`). Když
  analýza v appce napíše „pošli data k přefitování", přefituj ho tady z exportu a konstanty přepiš.
