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
