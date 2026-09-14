#!/bin/sh
# Vyrenderuje sadu v headless Chromiu a vypíše její výsledek.
# Použití: test/browser-run.sh test/browser-sauna.js
# Výchozí okno je telefon. Sada, která potřebuje jiné (iPad na šířku), si ho řekne
# řádkem `// OKNO: 1180,820` — jinak by se pustila v úzkém okně a tiše prošla, aniž
# by cokoli ověřila. Přebít jde i zvenčí: OKNO=1180,820 test/browser-run.sh ...
set -e
CHROME=${CHROME:-/opt/pw-browsers/chromium}
OUT=$(TEST_OUT=${TEST_OUT:-/tmp} node "$1")
ZE_SADY=$(sed -n 's|^// OKNO: *\([0-9]*,[0-9]*\).*|\1|p' "$1" | head -1)
"$CHROME" --headless --no-sandbox --disable-gpu --virtual-time-budget=15000 \
  --window-size=${OKNO:-${ZE_SADY:-430,900}} --dump-dom "file://$OUT" 2>/dev/null | python3 -c "
import sys, re, html
d = sys.stdin.read()
m = re.search(r'<pre id=\"VYSLEDEK\">(.*?)</pre>', d, re.S)
t = html.unescape(m.group(1)) if m else 'NENALEZENO — sada se nespustila'
print(t)
sys.exit(0 if 'VŠE PROŠLO' in t else 1)
"
