#!/bin/sh
# Spuštění appky na Synology NAS (přes balíček Node.js).
# Používá se v Plánovači úloh jako spouštěcí úloha po startu systému.

cd "$(dirname "$0")" || exit 1

# Najdi node: nejdřív v PATH, pak balíčky Synology (v20 / v18 / v16)
NODE=$(command -v node 2>/dev/null)
for p in \
  /var/packages/Node.js_v20/target/usr/local/bin/node \
  /var/packages/Node.js_v18/target/usr/local/bin/node \
  /var/packages/Node.js_v16/target/usr/local/bin/node \
  /usr/local/bin/node ; do
  [ -x "$NODE" ] && break
  [ -x "$p" ] && NODE="$p"
done

[ -x "$NODE" ] || { echo "Node.js nenalezen"; exit 1; }

# Restartovací smyčka — když appka spadne, sama znovu naběhne
while true; do
  echo "=== start $(date) ==="
  "$NODE" server.js
  echo "=== spadlo, restart za 3 s ($(date)) ==="
  sleep 3
done >> app.log 2>&1
