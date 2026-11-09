# Přihlášení do appky přes Apple ID (Firebase)

Do appky se na každém zařízení přihlásí **jednou**, přes Apple ID. Pak si zařízení přihlášení pamatuje.
Platnost je 400 dní a při používání se sama prodlužuje.

**Povolené účty** (e-mail Apple ID): smogrovic@gmail.com, zuzana.smogrovicova@gmail.com,
mikulas.smogrovic@icloud.com, elena.smogrovicova@icloud.com.
Seznam jde přepsat proměnnou `AUTH_EMAILY` na Renderu, e-maily oddělené čárkou.

**Dokud nejsou nastavené proměnné z kroku 3, appka jede jako dřív, bez přihlášení.**
Nasazení samo nikoho nezamkne.

## Co je potřeba

- **Placený Apple Developer Program** (99 USD/rok). Bez něj Apple přihlášení na webu nepovolí.
- Účet Google kvůli Firebase. Stačí zdarma tarif Spark.

## 1. Firebase

1. Na [console.firebase.google.com](https://console.firebase.google.com) vytvoř projekt, třeba `solinator`.
   Google Analytics nejsou potřeba.
2. **Project settings → General → Your apps → Web (`</>`)**: zaregistruj webovou appku (hosting ne).
   Z ukázaného `firebaseConfig` si opiš `apiKey` a `projectId`.
3. **Authentication → Get started → Sign-in method → Apple → Enable.** Okno nech otevřené, vyplníš ho v kroku 2.6.
4. **Authentication → Settings → Authorized domains → Add domain:** `solax-pretok.onrender.com`.

## 2. Apple Developer ([developer.apple.com/account](https://developer.apple.com/account))

1. **Certificates, IDs & Profiles → Identifiers → +** → *App IDs* → *App*:
   - Description: `Solinator`;
   - Bundle ID: `com.smogrovic.solinator`;
   - v Capabilities zaškrtni **Sign In with Apple**;
   - uložit.
2. **Identifiers → +** → *Services IDs*:
   - Description: `Solinator web`;
   - Identifier: `com.smogrovic.solinator.web`.

   Tohle je *Services ID*, budeš ho potřebovat ve Firebase.
3. Otevři ten Services ID, zaškrtni **Sign In with Apple → Configure**:
   - Primary App ID: `com.smogrovic.solinator`;
   - **Domains**: `solax-pretok.onrender.com`;
   - **Return URLs**: `https://solax-pretok.onrender.com/__/auth/handler`;
   - uložit (Next → Done → Continue → Save).
4. **Keys → +**:
   - Name: `Solinator Sign in`;
   - zaškrtni **Sign In with Apple → Configure** → Primary App ID `com.smogrovic.solinator`;
   - uložit a **stáhni soubor `.p8`**. Jde stáhnout jen jednou. Opiš si **Key ID**.
5. **Team ID** najdeš vpravo nahoře u jména, nebo v Membership details.
6. Zpátky ve Firebase (Apple provider z kroku 1.3) vyplň:
   - Services ID: `com.smogrovic.solinator.web`;
   - v *OAuth code flow configuration*: **Apple team ID**, **Key ID** a **Private key** (celý obsah souboru `.p8`);
   - Save.

   Soubor `.p8` a privátní klíč nikam jinam nedávej: do chatu, repozitáře ani na Render.

## 3. Render (služba `solax-pretok` → Environment)

| Proměnná | Hodnota |
|---|---|
| `FIREBASE_API_KEY` | `apiKey` z kroku 1.2. Není tajný, posílá se i do prohlížeče. |
| `FIREBASE_PROJECT_ID` | `projectId` z kroku 1.2 |
| `AUTH_SESSION_SECRET` | dlouhý náhodný řetězec, např. z `openssl rand -hex 32` v Terminálu. **Tajný, nikam neposílat.** |
| `AUTH_EMAILY` | nepovinné, jen když chceš změnit seznam povolených účtů |

Po uložení se Render restartuje a přihlášení se zapne.

## 4. První přihlášení

1. Otevři appku a klepni na **Přihlásit se přes Apple**.
2. Apple se zeptá, jestli sdílet e-mail. Zvol **Sdílet můj e-mail**. Při volbě „Skrýt můj e-mail“
   Apple pošle náhodnou adresu a appka přístup odmítne. Kdo to omylem zvolí, opraví to takto:
   - v Nastavení iPhonu → [jméno] → Přihlášení a zabezpečení → Přihlásit se přes Apple
     → Solinator → *Přestat používat*;
   - přihlásí se znovu se sdílením e-mailu.
3. **Appka na ploše iPhonu nebo iPadu:** pokud přesměrování na Apple v appce z plochy neprojde, použij
   kód z jiného zařízení:
   - na přihlášeném zařízení otevři **Log/Nastavení → Přihlášení → Kód pro další zařízení**;
   - na novém zařízení zadej 6 číslic.

   Kód platí 10 minut a jen jednou.

## Jak to funguje

- Firebase ověří Apple ID a vydá podepsaný token.
- Server zkontroluje podpis tokenu (veřejné klíče Googlu), projekt, platnost, poskytovatele `apple.com`
  a e-mail ze seznamu povolených.
- Pak vydá vlastní přihlašovací cookie: HttpOnly, Secure, podepsanou `AUTH_SESSION_SECRET`.
- Cookie se kontroluje u každého požadavku včetně seznamu povolených účtů. Kdo ze seznamu vypadne,
  přístup okamžitě ztratí.
- **Odhlásit všechna zařízení najednou:** změň `AUTH_SESSION_SECRET` na Renderu.
- **Odhlásit jedno zařízení:** Log/Nastavení → Přihlášení → Odhlásit toto zařízení.
- Stránky Firebase pro přihlášení (`/__/auth/*`) appka přeposílá ze své domény. Bez toho by Safari
  přihlášení rozbilo blokováním cizích cookies.

## Co zůstává bez přihlášení

Tyhle adresy volají zařízení, která se přihlásit neumí, nebo mají vlastní klíč:

| Adresa | Kdo ji volá | Ochrana |
|---|---|---|
| `POST /api/zkratka` | zkratky iPhonu | klíč `ZKRATKY_KLIC` |
| `POST /api/jidelnicek/import` | naplánovaná úloha | klíč `JIDELNICEK_KLIC` |
| `GET /api/jidelnicek/historie` | naplánovaná úloha | bez klíče, jen názvy jídel |
| `GET /api/auto/nabijeni` | druhá appka | klíč `AUTO_KLIC` |
| `GET /api/auto/nabijeni/fin` | appka Moje finance | její přihlášení Firebase (`FIN_EMAILS`) |
| `POST /api/zavlaha/stav`, `/api/vysavac/stav`, `/api/auto/stav` | mosty na NASu | **bez klíče, jako dosud** |
| `POST /api/sauna/active` | webhook ze Shelly | bez klíče, jen vypíná bazén |
| ikony, manifest, `version.json`, skripty pro NAS | — | veřejné soubory |

Mosty na NASu jdou časem zabezpečit vlastním klíčem. Chce to ale upravit i jejich nastavení na NASu.
