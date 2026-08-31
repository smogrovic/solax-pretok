#!/bin/sh
# Vyrenderuje sadu v headless Chromiu a vypíše její výsledek.
# Použití: test/browser-run.sh test/browser-sauna.js
set -e
CHROME=${CHROME:-/opt/pw-browsers/chromium}
OUT=$(TEST_OUT=${TEST_OUT:-/tmp} node "$1")
"$CHROME" --headless --no-sandbox --disable-gpu --virtual-time-budget=15000 \
  --window-size=430,900 --dump-dom "file://$OUT" 2>/dev/null | python3 -c "
import sys, re, html
d = sys.stdin.read()
m = re.search(r'<pre id=\"VYSLEDEK\">(.*?)</pre>', d, re.S)
t = html.unescape(m.group(1)) if m else 'NENALEZENO — sada se nespustila'
print(t)
sys.exit(0 if 'VŠE PROŠLO' in t else 1)
"
