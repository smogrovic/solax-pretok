# SMG home

Domácí appka k fotovoltaice: ukazuje výrobu, přetok a stav baterie a podle přebytku sama
spíná bojler, bazénovou filtraci a solinátor. K tomu ovládá klimatizace, žaluzie, wallbox,
zámek a světla — všechno z jedné stránky v telefonu.

Je to **jeden Node.js server** (`server.js`) a **jedna stránka** (`public/index.html`).
Žádná databáze, žádný build — `npm install` a `npm start`.

## Co umí

- **Přehled FVE** — výroba, přetok, baterie, spotřeba domu, diagram toku energie, grafy za 24 h
- **Automatika přebytků** — bojler, bazén a solinátor se spínají podle přetoku, stavu baterie
  a předpovědi výroby; auto na wallboxu má přednost. Kompletní pravidla jsou přímo v appce
  na stránce *Logika automatiky*.
- **Klimatizace** (Panasonic), **žaluzie** (Somfy/TaHoma), **wallbox** (Solax),
  **zámek** (Nuki), **relé** (Shelly) — ruční ovládání i časovače
- **Asistent** — ovládání větami („zatáhni žaluzie v ložnici")
- **Push notifikace** — garáž nechaná otevřená, auto nabité, výpadek zdroje dat

## Napojené služby

Solax Cloud · Shelly Cloud · Panasonic Comfort Cloud · Somfy TaHoma · Infigy ·
Nuki Web API · OpenWeatherMap · Anthropic API

Co nemáš, prostě nevyplníš — appka tu část vypne a zbytek jede dál.

## Nasazení

- **Do cloudu (GitHub + Render):** [`NASAZENI.md`](NASAZENI.md) — návod krok za krokem
  včetně toho, kde vzít který klíč
- **Na Synology NAS:** [`NAS-SETUP.md`](NAS-SETUP.md)
- **Přehled proměnných:** [`.env.example`](.env.example)

## Upozornění

Appka **nemá přihlášení** — kdo zná adresu, ovládá dům. Jediná ochrana je, že adresa nikde
není zveřejněná. Stav appky (historie grafů, doby běhu, rozpočet solinátoru) je jen v paměti
a **každé nasazení nové verze ho vynuluje**.
