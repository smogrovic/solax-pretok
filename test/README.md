# Testy

Sady si samy vytáhnou kus kódu ze `server.js` / `public/index.html` (podle kotev
v textu, ne podle čísel řádků) a proženou ho hotovými daty. Nic nespouštějí proti
ostrému Shelly ani Solaxu.

```sh
node test/sauna.js                    # logika sauny (blokace, notifikace, denní kWh)
node test/wallbox.js                  # režim wallboxu (typ dne, hodiny, hystereze)
node test/months.js                   # spotřeba po měsících (sauna, bazén, wallbox)
node test/runtime-sauna.js            # ostrý server na portu 3996 s podstrčeným cloudem
./test/browser-run.sh test/browser-sauna.js    # stránka Sauna v headless Chromiu
./test/browser-run.sh test/browser-logika.js   # Logika automatiky + nastavení mezí sauny
./test/browser-run.sh test/browser-wallbox.js  # přepínač a nápověda u wallboxu
./test/browser-run.sh test/browser-mesice.js   # pořadí stránek, karty měsíců, graf FVE
./test/browser-run.sh test/browser-smoke.js    # celá appka se načte a vykreslí bez chyby
```

Vše skončí `VŠE PROŠLO`, nebo vypíše, co nesedí, a vrátí nenulový kód.

`zdroj.js` je společný pomocník: `between('kotva', 'kotva')`, `fn('function xy(')`
a `suite()` (počítadlo výsledků). Když se v `server.js` přejmenuje funkce, sada
spadne na „kotva nenalezena" — to je záměr, ať se test nezačne tiše dívat jinam.

Prohlížečové sady potřebují Chromium (`CHROME=/cesta/k/chromium`, výchozí je
`/opt/pw-browsers/chromium`) a `node`. HTML se generuje do `/tmp` (`TEST_OUT`).
