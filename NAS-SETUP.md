# Provoz appky na Synology NAS (DS218, DSM 7)

DS218 nemá Docker, ale má balíček **Node.js** — appka běží přímo přes Node.
Tenhle návod ji rozjede a zpřístupní přes HTTPS zvenčí.

## 1. Node.js
Package Center → nainstaluj **Node.js v20** (už máš).

## 2. Kód na NAS
1. Na GitHubu: **Code → Download ZIP** (nebo `git clone`).
2. Ve **File Station** vytvoř složku, např. `/web/fve`, a rozbal tam obsah repa.

## 3. Konfigurace (.env)
1. Zkopíruj `.env.example` na `.env` (ve File Station: kopírovat + přejmenovat).
2. Vyplň hodnoty (stejné jako máš na Renderu). `.env` zůstává jen na NASu.

## 4. Instalace závislostí (jednorázově, přes SSH)
1. Control Panel → **Terminal & SNMP** → zaškrtni **Enable SSH service**.
2. Připoj se (z Macu Terminál): `ssh TVUJ_UZIVATEL@IP_NASU`
3. Přejdi do složky a nainstaluj balíčky:
   ```sh
   cd /volume1/web/fve
   /var/packages/Node.js_v20/target/usr/local/bin/npm install
   chmod +x nas-start.sh
   ```
4. Vyzkoušej ručně: `sh nas-start.sh` — v prohlížeči otevři `http://IP_NASU:3000`.
   Když jede, dej Ctrl+C.

## 5. Automatické spuštění po startu
Control Panel → **Task Scheduler** → Create → **Triggered Task → User-defined script**
- Event: **Boot-up**, User: **root**
- Task Settings → Run command:
  ```sh
  sh /volume1/web/fve/nas-start.sh
  ```
- Ulož a **spusť ručně** (Run) — appka běží a po restartu NASu naběhne sama.

## 6. HTTPS a přístup zvenčí
1. **DDNS**: Control Panel → External Access → DDNS → přidej `neco.synology.me`.
2. **Certifikát**: Control Panel → Security → Certificate → Let's Encrypt pro tu doménu.
3. **Reverse Proxy**: Control Panel → Login Portal → Advanced → Reverse Proxy → Create:
   - Zdroj: `https://fve.neco.synology.me` (port 443)
   - Cíl: `http://localhost:3000`
   - V **Custom Header** přidej WebSocket (tlačítko „Create → WebSocket") — kvůli živým aktualizacím (SSE).
4. **Router**: přesměruj port **443** (a 80 pro obnovu certifikátu) na IP NASu.
   - Když ISP nedá veřejnou IP (CGNAT), použij místo toho **Tailscale** nebo **Cloudflare Tunnel**.

## 7. Telefon
V PWA otevři novou adresu `https://fve.neco.synology.me` a přidej na plochu.

## Druhá appka
Stejný postup, jiná složka a **jiný PORT** (např. 3001) + druhý záznam v reverse proxy
(`fve2.neco.synology.me` → `http://localhost:3001`).
