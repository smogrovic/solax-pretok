# Nasazení appky na vlastní GitHub a Render

Návod pro někoho, kdo dostal tenhle balíček a chce si appku rozjet u sebe.
Počítá s tím, že s GitHubem ani Renderem nemáš zkušenosti. Celé to zabere zhruba hodinu,
z toho většinu času zabere sbírání klíčů k jednotlivým službám.

Appka je **jeden Node.js server + jedna webová stránka**. Nemá databázi, nic se neinstaluje
doma — běží v cloudu a v telefonu se otevírá jako webová appka.

---

## Než začneš — na co si dát pozor

**1. Appka nemá žádné přihlášení.** Kdo zná její internetovou adresu, může u tebe doma
zapínat bojler, otevírat garáž a odemykat dveře. V kódu je sice připravený PIN, ale je
**vypnutý** (`server.js`, `lockEnabled = false`). Adresa z Renderu je náhodná a nikde
se nezveřejňuje, ale je to jediná ochrana, kterou máš. Nedávej ji nikam veřejně.

**2. Appka nemá databázi.** Historie grafů, doby běhu i rozpočet solinátoru žijí v paměti
serveru a **každé nasazení i každý restart paměť vynuluje**. Proto si server dělá zálohu do
Upstash (Redis přes HTTPS, zdarma) — viz *Úložiště* v kroku 2. Bez něj zbývá jen záloha
v telefonu, a ta umí vrátit jen to, co appka viděla otevřená.

**3. Nepotřebuješ všechno.** Solax, Shelly, Panasonic, Somfy, Nuki, Infigy — když některou
z těch věcí nemáš, prostě její klíče nevyplníš. Appka tu část tiše vypne a zbytek jede dál.
Jediné, bez čeho to nemá smysl, je **Solax**.

---

## Krok 1: Kód na svůj GitHub

Potřebuješ účet na [github.com](https://github.com) (zdarma).

### Varianta A — dostal jsi ZIP
1. Na GitHubu vpravo nahoře **+** → **New repository**.
2. Jméno třeba `moje-fve`, zvol **Private**, **nic** nezaškrtávej (žádné README),
   → **Create repository**.
3. Na další stránce klikni **uploading an existing file**.
4. Rozbal ZIP a **obsah** složky (ne složku samotnou) přetáhni do okna prohlížeče.
5. Dole **Commit changes**.

### Varianta B — původní repo je veřejné
Otevři ho na GitHubu a klikni **Fork** → **Create fork**. Máš vlastní kopii včetně historie.
Fork je ale vždy veřejný a je z něj vidět, odkud pochází — pokud ti to vadí, použij variantu A.

---

## Krok 2: Nasbírat klíče

Můžeš je psát rovnou na Render (krok 3), ale je pohodlnější si je nejdřív někam poznamenat.
Přehled všech je v souboru `.env.example` a v tabulce na konci tohohle návodu.

### Solax — výroba, přetok, baterie (povinné)
1. [www.solaxcloud.com](https://www.solaxcloud.com) → přihlas se svým účtem.
2. **Service** → **API** → vygeneruj **tokenID**. To je `SOLAX_TOKEN_ID`.
3. **SN** je *registrační číslo* střídače (ne sériové číslo z výrobního štítku) — najdeš ho
   v seznamu zařízení. To je `SOLAX_SN`.
4. Máš-li i wallbox, jeho registrační číslo je `WALLBOX_SN`.

### Shelly — relé (bojler, bazén, solinátor, světla)
1. V mobilní appce Shelly: **Settings → Authorization cloud key** → **Get key**.
   Ukáže se ti klíč (`SHELLY_AUTH_KEY`) i adresa serveru ve tvaru `shelly-XX-eu.shelly.cloud`
   (`SHELLY_SERVER_URI` — piš ji **bez** `https://`).
2. Pro každé relé potřebuješ jeho **Device ID**: v appce otevři zařízení →
   **Settings → Device information → Device ID**. Je to řetězec typu `34b7dacb1234`.
   - bojler → `SHELLY_DEVICE_ID`
   - bazén → `POOL_DEVICE_ID`
   - solinátor → `SOLINATOR_DEVICE_ID`
3. Kdyby některé relé bylo na jiném serveru, dá se přebít přes `POOL_SERVER_URI` /
   `SOLINATOR_SERVER_URI`.
4. Každý pokoj s klimatizací má nástěnný **Shelly H&T** (teploměr) a řídí se
   **výhradně podle něj** — čidlo uvnitř klimatizace visí u stropu a ukazuje asi
   o 2 °C víc. Device ID patří do `SHELLY_TEMP_OBYVAK_ID`, `SHELLY_TEMP_LOZNICE_ID`,
   `SHELLY_TEMP_ELENKA_ID` a `SHELLY_TEMP_MIKY_ID`. **Vyplň je**, jinak se čtou
   čidla původního majitele. Pokoj bez vyplněného čidla jede podle klimatizace.

### Panasonic — klimatizace a tepelné čerpadlo
Stačí e-mail a heslo od účtu **Panasonic Comfort Cloud** (stejné jako v mobilní appce):
`PANASONIC_EMAIL`, `PANASONIC_PASSWORD`.

### Somfy / TaHoma — žaluzie
E-mail a heslo od účtu TaHoma: `TAHOMA_EMAIL`, `TAHOMA_PASSWORD`.

### Nuki — zámek dveří
1. [web.nuki.io](https://web.nuki.io) → **Menu → API** → **Generate API token**.
2. Token je `NUKI_TOKEN`. `NUKI_SMARTLOCK_ID` nevyplňuj, appka si vezme první zámek na účtu.

### Infigy — teplota bojleru 2, výkon wallboxu, odhad výroby
Přihlašovací údaje do Infigy portálu: `INFIGY_EMAIL`, `INFIGY_PASSWORD`.

> **Tohle nepřeskakuj:** `INFIGY_DEVICE_ID` a `INFIGY_SUPABASE_REF` mají v kódu výchozí
> hodnoty od původního majitele. Když je nevyplníš vlastními, appka bude číst **cizí
> zařízení**. Vlastní hodnoty vyčteš z adresního řádku Infigy portálu, nebo Infigy
> nepoužívej vůbec (nech `INFIGY_EMAIL` prázdné).

### Úložiště — Upstash Redis (zdarma, důrazně doporučené)
Bez něj se po každém nasazení ztratí historie grafů, doby běhu, měsíční spotřeby i log.

1. [upstash.com](https://upstash.com) → **Sign up** (stačí přihlášení GitHubem).
2. **Create Database** → typ **Redis**, jméno třeba `fve`, region nejblíž Renderu
   (`eu-central-1`), plán **Free**.
3. V detailu databáze sjeď na **REST API** a zkopíruj dvě hodnoty:
   - `UPSTASH_REDIS_REST_URL` (vypadá jako `https://neco-12345.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (dlouhý řetězec)
4. Volitelně `STORE_PREFIX` — jen když do jedné databáze ukládá víc instalací.

Server si ukládá **jeden klíč** (`solax:state`), zabalený gzipem — kolem 100 kB. Zapisuje
jednou za 10 minut, a jen když se něco změnilo, plus vždycky před vypnutím. Free plán
Upstash to utáhne s velkou rezervou. Že to jede, poznáš dole na stránce **Log**:
*„Záloha na serveru: obnoveno v 8:15, uloženo v 8:25."*

### Počasí — OpenWeatherMap (zdarma, doporučené)
1. [openweathermap.org](https://openweathermap.org) → registrace → **My API keys**.
2. Klíč je `OWM_API_KEY`. Po registraci trvá i pár hodin, než začne fungovat.
3. **Vyplň i `WEATHER_LAT` a `WEATHER_LON`** — souřadnice svého domu (najdeš v Mapách:
   klikneš pravým na místo a zkopíruješ čísla, např. `50.087` a `14.421`). Bez nich se
   použije původní místo v ČR a **na západu slunce visí vypínání bazénu i solinátoru**.

### Asistent (volitelné)
Chceš-li v appce chat, který umí ovládat dům větami: klíč z
[console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`. Je placený
podle použití.

### Push notifikace do telefonu (volitelné)
Potřebuješ vlastní pár klíčů. Na počítači s Node.js spusť:
```sh
npx web-push generate-vapid-keys
```
Vypíše `Public Key` → `VAPID_PUBLIC_KEY` a `Private Key` → `VAPID_PRIVATE_KEY`.
Do `VAPID_SUBJECT` dej `mailto:tvuj@email.cz`.

---

## Krok 3: Render

[Render](https://render.com) umí appku hostovat zdarma.

1. Zaregistruj se, nejjednodušeji **Sign up with GitHub**.
2. **New +** → **Web Service**.
3. **Connect a repository** → povol Renderu přístup a vyber svoje repo z kroku 1.
4. Nastav:
   | Položka | Hodnota |
   |---|---|
   | Name | cokoli, stane se součástí adresy |
   | Region | **Frankfurt** (nejblíž) |
   | Branch | `main` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |
5. Rozklikni **Advanced** → **Add Environment Variable** a přidej všechny hodnoty
   z kroku 2 (jméno vlevo, hodnota vpravo). `PORT` **nezadávej**, Render si ho řídí sám.
6. **Create Web Service**. První sestavení trvá pár minut, průběh vidíš v logu.
7. Až nahoře svítí **Live**, klikni na adresu `https://neco.onrender.com` — appka běží.

### Když budeš měnit klíče později
Render → tvoje služba → **Environment** → uprav → **Save changes**. Služba se sama restartuje.

### Free plán a usínání
Free služba jde po 15 minutách bez návštěvy spát a další otevření pak trvá ~30 s. Appka se
tomu brání tím, že si sama každých 10 minut sáhne na vlastní adresu (Render jí ji dodá
v proměnné `RENDER_EXTERNAL_URL`, nic nenastavuješ). Občasnému uspání to úplně nezabrání —
za těch pár minut appka nesbírá data a v grafech vznikne díra.

---

## Krok 4: Appka do telefonu

1. Otevři adresu v **Safari** (iPhone) nebo **Chrome** (Android).
2. iPhone: **Sdílet** → **Přidat na plochu**. Android: **⋮** → **Přidat na plochu**.
3. Otevře se pak na celou obrazovku jako běžná appka.
4. Notifikace: tlačítkem **Zapnout notifikace** dole na stránce Log (jen když máš
   vyplněné VAPID klíče).

---

## Krok 5: Co si přepiš v kódu

Tohle nejsou proměnné, tohle je přímo v souborech. Uprav rovnou na GitHubu (otevři soubor →
ikona tužky → **Commit changes**), Render nasadí novou verzi sám.

| Co | Kde | Co s tím |
|---|---|---|
| Jména pokojů s klimatizací | `server.js`, `TEMP_AUTO_RULES` | přepiš na svoje pokoje; klíč musí sedět na název jednotky v Panasonic Comfort Cloud |
| Rozdělení žaluzií na dvě stránky | `public/index.html`, `BLINDS_PAGE1` | názvy místností ze Somfy |
| Žaluzie vyloučené z časovačů | `public/index.html`, `TIMER_EXCLUDED_ROOMS` | co se nemá hýbat na časovač (u nás pergola a garáž) |
| Název appky a ikona | `public/manifest.json`, `public/icon-192.png`, `icon-512.png` | jméno na ploše telefonu |
| Jméno u Face ID / otisku | `public/index.html`, hledej `displayName` | jinak tě appka bude oslovovat cizím jménem |
| Prahy automatiky (kW, SOC, časy) | `server.js`, funkce `runPoolAutomation` a `runBoilerAutomation` | nastaveno na konkrétní dům — projdi podle stránky **Logika automatiky** v appce |

Kompletní popis toho, co a kdy se spíná, je přímo v appce na stránce **Logika automatiky**.

---

## Tabulka všech proměnných

| Proměnná | Nutná? | Bez ní |
|---|---|---|
| `SOLAX_TOKEN_ID`, `SOLAX_SN` | **ano** | appka nemá data o výrobě, automatika neběží |
| `SHELLY_AUTH_KEY`, `SHELLY_SERVER_URI` | pro relé | nejde ovládat bojler, bazén, solinátor ani světla |
| `SHELLY_DEVICE_ID` | pro bojler | bojler chybí |
| `POOL_DEVICE_ID` | pro bazén | bazén chybí |
| `SOLINATOR_DEVICE_ID` | pro solinátor | solinátor chybí |
| `POOL_SERVER_URI`, `SOLINATOR_SERVER_URI` | ne | použije se `SHELLY_SERVER_URI` |
| `SHELLY_TEMP_OBYVAK_ID`, `SHELLY_TEMP_LOZNICE_ID`, `SHELLY_TEMP_ELENKA_ID`, `SHELLY_TEMP_MIKY_ID` | **ano, když máš H&T** | čtou se **cizí čidla** původního majitele; teplotní automatika pokoje pak jede podle nich |
| `PANASONIC_EMAIL`, `PANASONIC_PASSWORD` | pro klimatizace | stránka Klima hlásí nenastaveno, teplotní automatika neběží |
| `TAHOMA_EMAIL`, `TAHOMA_PASSWORD` | pro žaluzie | stránky Žaluzie zůstanou prázdné |
| `WALLBOX_SN` | pro wallbox | stránka Wallbox nefunguje |
| `ANTHROPIC_API_KEY` | ne | asistent neodpovídá |
| `NUKI_TOKEN` | pro zámek | ovládání zámku zmizí |
| `NUKI_SMARTLOCK_ID` | ne | vezme se první zámek na účtu |
| `INFIGY_EMAIL`, `INFIGY_PASSWORD` | pro bojler 2 | chybí bojler 2, výkon wallboxu a odhad výroby |
| `INFIGY_DEVICE_ID`, `INFIGY_SUPABASE_REF`, `INFIGY_SUPABASE_ANON` | **ano, když používáš Infigy** | čte se **cizí zařízení** původního majitele |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | důrazně doporučeno | historie, doby běhu, měsíční spotřeby a log se ztratí při každém nasazení |
| `STORE_PREFIX` | ne | klíč se jmenuje `solax:state` |
| `OWM_API_KEY` | doporučeno | neběží korekce podle předpovědi; vypínání bazénu a solinátoru padá na náhradní mez 20:00 |
| `WEATHER_LAT`, `WEATHER_LON` | doporučeno | počasí a západ slunce z původního místa v ČR |
| `BATTERY_KWH` | doporučeno | počítá se s 11,6 kWh |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | pro notifikace | push notifikace nejdou zapnout |
| `PANASONIC_APP_VERSION` | ne | server si verzi zjistí sám |
| `PORT` | jen doma | na Renderu ho dodává platforma |
| `APP_PIN` | — | **nedělá nic**, zamykání je v kódu vypnuté |
| `RENDER_EXTERNAL_URL` | — | dodává Render sám, nenastavuj |

---

## Když něco nejede

- **Appka se neotevře / „Bad Gateway"** — Render → služba → **Logs**. Chyba bývá hned
  na konci. Po nasazení chvíli trvá, než server naběhne.
- **Nejdou data ze Solaxu** — nejčastěji je v `SOLAX_SN` sériové číslo místo registračního.
- **Shelly nereaguje** — zkontroluj, že `SHELLY_SERVER_URI` je bez `https://`, a že Device ID
  je opsané celé.
- **Počasí nejde** — nový klíč z OpenWeatherMap začne fungovat až za pár hodin.
- **Něco se sepnulo/nesepnulo** — stránka **Log** v appce píše každou akci automatiky
  i s důvodem. Když zařízení povel neposlechne, napíše se to tam taky.

---

## Provoz doma místo v cloudu

Když nechceš cloud, appka jede i na Synology NASu — postup je v `NAS-SETUP.md`.
Doma je navíc mimo internet, takže odpadá starost s tím, že je bez přihlášení.
