# Testy

Sady si samy vytáhnou kus kódu ze `server.js` / `public/index.html` (podle kotev
v textu, ne podle čísel řádků) a proženou ho hotovými daty. Nic nespouštějí proti
ostrému Shelly ani Solaxu.

```sh
node test/sauna.js                    # logika sauny (blokace, notifikace, denní kWh)
node test/wallbox.js                  # režim wallboxu (typ dne, hodiny, hystereze)
node test/months.js                   # spotřeba po měsících (sauna, bazén, wallbox)
node test/staticka.js                 # inline skript: nic se nepoužívá bez deklarace
node test/store.js                    # záloha do Upstash (balení, whitelist, pojistky)
node test/runtime-sauna.js            # ostrý server na portu 3996 s podstrčeným cloudem
node test/runtime-store.js            # dva ostré servery: uložit, spadnout, načíst zpátky
./test/browser-run.sh test/browser-snapshot.js # ostrá applySnapshot: všechny série dojedou
./test/browser-run.sh test/browser-sauna.js    # stránka Sauna v headless Chromiu
./test/browser-run.sh test/browser-klima.js    # Klima bez dočasné karty čidel
./test/browser-run.sh test/browser-logika.js   # Logika automatiky + nastavení mezí sauny
./test/browser-run.sh test/browser-wallbox.js  # přepínač, nápověda a ruční režimy wallboxu
./test/browser-run.sh test/browser-mesice.js   # pořadí stránek, karty měsíců, graf FVE
./test/browser-run.sh test/browser-zaloha.js   # řádek o záloze na stránce Log
./test/browser-run.sh test/browser-smoke.js    # celá appka se načte a vykreslí bez chyby
```

Vše skončí `VŠE PROŠLO`, nebo vypíše, co nesedí, a vrátí nenulový kód.

`zdroj.js` je společný pomocník: `between('kotva', 'kotva')`, `fn('function xy(')`
a `suite()` (počítadlo výsledků). Když se v `server.js` přejmenuje funkce, sada
spadne na „kotva nenalezena" — to je záměr, ať se test nezačne tiše dívat jinam.

Prohlížečové sady potřebují Chromium (`CHROME=/cesta/k/chromium`, výchozí je
`/opt/pw-browsers/chromium`) a `node`. HTML se generuje do `/tmp` (`TEST_OUT`).

`browser-snapshot.js` a `staticka.js` vznikly po chybě, kdy zásah do `index.html`
odřízl deklaraci `wbManualBtnsEl`, ale její použití v `renderWallbox()` zůstalo.
`applySnapshot()` na tom padala uprostřed, takže se tiše nenačetla polovina dat
(historie wallboxu, bojlerů, režimů). Statická sada tenhle druh chyby najde bez
prohlížeče, prohlížečová ověří, že celý snapshot doopravdy dojede.
