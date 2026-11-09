# Přihlášení do appky (Google účet nebo jednorázový odkaz e-mailem)

Do appky se na každém zařízení přihlásí **jednou**. Pak si zařízení přihlášení pamatuje.
Platnost je 400 dní a při používání se sama prodlužuje.

**Tři způsoby přihlášení:**
- **Google účtem.** Hodí se pro adresy na Gmailu.
- **Jednorázovým odkazem e-mailem.** Jde s jakoukoli adresou, takže i s iCloudem.
  Appka pošle odkaz, ten se otevře a přihlášení je hotové. Odkaz platí jednou, zhruba hodinu.
- **Kódem z jiného přihlášeného zařízení** (6 číslic, platí 10 minut a jednou). Hodí se pro appku
  na ploše iPhonu: odkaz z e-mailu se otevře v Safari, ne v ní.

**Povolené účty:** smogrovic@gmail.com, zuzana.smogrovicova@gmail.com,
mikulas.smogrovic@icloud.com, elena.smogrovicova@icloud.com.
Seznam jde přepsat proměnnou `AUTH_EMAILY` na Renderu, e-maily oddělené čárkou.

**Dokud nejsou nastavené proměnné z kroku 3, appka jede jako dřív, bez přihlášení.**
Nasazení samo nikoho nezamkne. Všechno je zdarma, stačí tarif Firebase Spark.

## 1. Firebase

Můžeš použít **projekt, který už máš pro Moje finance** (`moje-finance-4bb9e`), nebo založit nový.
Postup je stejný.

1. [console.firebase.google.com](https://console.firebase.google.com) → projekt → **Project settings →
   General → Your apps**. Pokud tam webová appka (`</>`) ještě není, zaregistruj ji (hosting ne).
   Z `firebaseConfig` si opiš `apiKey` a `projectId`.
2. **Authentication → Sign-in method:**
   - **Google → Enable.** Vyplň support e-mail, uložit.
   - **Email/Password → Enable** a zapni i **Email link (passwordless sign-in)**, uložit.
3. **Authentication → Settings → Authorized domains → Add domain:** `solax-pretok.onrender.com`.
4. **Authentication → Templates:** jazyk šablon (tužka dole) přepni na **češtinu**, aby e-mail s odkazem
   přišel česky.
5. **Návratová adresa pro Google.** Je potřeba kvůli Safari na iPhonu, appka si přihlašovací stránky
   Firebase přeposílá ze své domény.
   - [console.cloud.google.com](https://console.cloud.google.com) → vyber stejný projekt.
   - **APIs & Services → Credentials** → klient *Web client (auto created by Google Service)* → upravit.
   - **Authorized JavaScript origins:** přidej `https://solax-pretok.onrender.com`.
   - **Authorized redirect URIs:** přidej `https://solax-pretok.onrender.com/__/auth/handler`.
   - Uložit. Změna se projeví do pár minut.

## 2. Render (služba `solax-pretok` → Environment)

| Proměnná | Hodnota |
|---|---|
| `FIREBASE_API_KEY` | `apiKey` z kroku 1.1. Není tajný, posílá se i do prohlížeče. |
| `FIREBASE_PROJECT_ID` | `projectId` z kroku 1.1 |
| `AUTH_SESSION_SECRET` | dlouhý náhodný řetězec, např. z `openssl rand -hex 32` v Terminálu. **Tajný, nikam neposílat.** |
| `AUTH_EMAILY` | nepovinné, jen když chceš změnit seznam povolených účtů |

Po uložení se Render restartuje a přihlášení se zapne.

## 3. První přihlášení

- **Gmail:** otevři appku a klepni na **Přihlásit se Google účtem**.
- **iCloud (nebo jakýkoli e-mail):** zadej e-mail a klepni na **Poslat**. Odkaz z e-mailu otevři
  **na stejném zařízení**. Když se otevře jinde, appka si e-mail řekne znovu.
- **Appka na ploše iPhonu nebo iPadu:** přihlas se jednou v Safari, nebo na jiném zařízení.
  Pak v té appce otevři **Log/Nastavení → Přihlášení → Kód pro další zařízení** a v appce
  na ploše zadej 6 číslic.

Účet mimo seznam appka odmítne s hláškou, že nemá přístup. Odmítnutí se zapíše do logu.

## Jak to funguje

- Firebase přihlásí Google účet nebo ověří odkaz z e-mailu a vydá podepsaný token.
- Server zkontroluje:
  - podpis tokenu (veřejné klíče Googlu), projekt a platnost;
  - poskytovatele (Google nebo odkaz z e-mailu);
  - **ověřený** e-mail ze seznamu povolených.
- Pak vydá vlastní přihlašovací cookie: HttpOnly, Secure, podepsanou `AUTH_SESSION_SECRET`.
  Firebase už dál potřeba není.
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
