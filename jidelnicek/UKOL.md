# Úloha: jídelníček na příští týden

Spouští se v pátek ve 12:00 jako naplánovaná úloha (a kdykoli ručně). Výsledek se pošle do
appky SMGhome. Appka ho ukáže na stránce Nákup a jeho suroviny dá na nákupní seznam.

Pravidla jídelníčku jsou v `jidelnicek/PROMPT.md`. Platí bez výjimek. Formát výstupu
(sekce 12–14 promptu) tady nahrazuje JSON níž: appka z něj sama udělá přehled
VEČEŘE / PEČENÍ / SNÍDANĚ, odškrtávací nákupní seznam a tiskovou verzi.

## Postup

1. **Historie:** `curl -s https://solax-pretok.onrender.com/api/jidelnicek/historie > /tmp/historie.json`.
   Obsahuje názvy jídel z posledních týdnů (první záznam = minulý týden) a příznak `ryba`, dále `zname` (suroviny, ke kterým
   appka zná konkrétní výrobek na Rohlíku) a `doma` (sůl, pepř).
   `zbyva` jsou neuvařená jídla, která v jídelníčku zůstávají (nakoupeno na ně je) — nová jídla
   je nesmí opakovat a do `nakup` za ně nic nepatří. Nový jídelníček má i tak plnou skladbu.
   **Neopakuj nic z minulého týdne:** jídla, hlavní zdroj bílkovin, luštěninu ani přílohy (starší týdny nevadí).
   **Žádná podobná jídla** v jednom týdnu: jen jedno jídlo s tortillou (tacos, wrap, burrito, quesadilla…),
   nejvýš jedno rizoto, kari, polévka, miska apod. Ryba má být jednou za 14 dní: když byla minulý týden,
   teď žádná, jinak právě jedna.
   Pokud appka neodpoví (Render se probouzí), zkus to znovu za minutu, nejvýš 3×.
2. **Recepty:** hledej (WebSearch) a hlavně **otevři** (WebFetch) konkrétní recepty jen na:
   `maruskaveg.com`, `buchtavtroube.cz`, `receptyodanicky.cz`, `karolinafour.cz`.
   MaruškaVeg jede jen přes http — odkazy tvaru `http://www.maruskaveg.com/…` jsou v pořádku.
   Pracovní večeře ber z více webů. Každý převzatý recept musí být otevřený a zkontrolovaný
   (název, suroviny, postup, porce). Když se recept dohledat nedá, vezmi jiný, nebo napiš
   vlastní (`vlastni: true`, bez odkazu). Odkazy nikdy nevymýšlej.
   **Výjimka — večeře bez vaření (`bez_vareni`):** smí být z jakéhokoli webu (vyhledej WebSearch, otevři
   WebFetch), a když nic nenajdeš, vymysli vlastní (`vlastni: true`). Nesmí se nic vařit ani péct —
   v postupu ani v čase nepiš vaření, pečení, smažení, restování, troubu ani panev.
   Pokud jsou weby nedostupné (síť prostředí je nepovoluje), **nic neposílej** a skonči se
   zprávou, které domény je potřeba povolit. Nic si nevymýšlej.
3. **Přepočet:** suroviny přepočítej na porce podle promptu (pracovní večeře 4 + 1 krabička,
   děti 9 a 12 let, víkend 3 dospělí + 2 děti, pečení jedna dávka). Žádné rezervy.
4. **JSON** ulož do `/tmp/plan.json` (mimo repo, nic se necommituje):

```json
{
  "tyden": "YYYY-MM-DD",
  "recepty": [{
    "kategorie": "vecere | peceni | snidane",
    "typ": "pracovni | vikend | bez_vareni | peceni | pracovni_snidane | vikend_snidane",
    "nazev": "Konkrétní název",
    "vlastni": false,
    "zdroj": { "web": "Karolina Four", "autor": "Karolína Fourová", "url": "https://karolinafour.cz/…" },
    "upraveno": "Vlastní úprava: … (nebo null)",
    "porce": "4 + 1 do krabičky",
    "cas": "30 min",
    "suroviny": [{ "nazev": "Rýže", "mnozstvi": 300, "jednotka": "g", "poznamka": "suchá hmotnost", "kategorie": "Pečivo a přílohy" }],
    "nahradni": false,
    "postup": ["…", "…"],
    "predem": "…", "skladovani": "…", "ohrev": "…", "forma": "jen u pečení, např. plech 30 × 40 cm",
    "vyziva": { "kcal": 0, "bilkoviny": 0, "sacharidy": 0, "tuky": 0 },
    "foto": "adresa fotky jídla z otevřené stránky (nepovinné — appka ji jinak dohledá sama)",
    "stitky": ["maso", "vegan", "ryba", "tortilla", "brambory", "mozzarella", "cottage", "tvaroh"]
  }],
  "nakup": [{ "kategorie": "Mléčné výrobky a sýry", "nazev": "Mozzarella", "mnozstvi": 250, "jednotka": "g", "odhad": false, "poznamka": "" }],
  "kontrola": [{ "bod": "Je přesně 5 hlavních jídel?", "ok": true, "poznamka": "" }],
  "upozorneni": ["Krátký bod, jen to nejnutnější."]
}
```

- `tyden` je pondělí příštího týdne (pražský čas).
- Receptů je přesně 9: 4× `pracovni`, 1× `vikend`, 1× `bez_vareni` (vše `vecere`), 1× `peceni`,
  1× `pracovni_snidane` a 1× `vikend_snidane` (obě `snidane`). Pizza se nepíše.
- **Náhradní recepty navíc:** přidej 4 recepty s `"nahradni": true` — 2 hlavní jídla (`vecere`, typ
  `pracovni` nebo `vikend`), 1 `peceni` a 1 `snidane`. Platí pro ně stejná pravidla (povolené weby, ověřené
  odkazy, gramáže, výživa), nesmí opakovat ostatní jídla ani `zbyva`. Do skladby týdne ani do `nakup` se
  nepočítají — v appce jsou šedé dole a jdou aktivovat místo něčeho, co se nelíbí.
- Každá surovina má `kategorie` (jedna z 8 kategorií nákupu, sekce 13 promptu; sůl a pepř nemusí).
  Appka z nich po potvrzení výběru sama sečte nákup, i za aktivovaná náhradní jídla.
- `stitky`: jen ty, které platí. `maso` jen u hlavních jídel s masem (přesně dvě),
  `vegan` u plně veganského hlavního jídla, `mozzarella`/`cottage`/`tvaroh` u receptů, kde jsou.
- `mnozstvi` je číslo, jednotka `g`, `kg`, `ml`, `l`, `ks`, `lžíce`, `lžička`, `balení`…
- **Sůl a pepř** jsou doma vždycky: v receptu je uveď (klidně bez množství), do `nakup` je nedávej.
- Když surovina odpovídá něčemu ze `zname`, pojmenuj ji v receptech i v nákupu **přesně tak** —
  appka pak výrobek na Rohlíku pozná a nemusí se vybírat.
- **Nákup** je přesný součet surovin. Položka se jmenuje **stejně** jako surovina v receptech
  (stejné názvy napříč recepty, jinak se nesečtou) a má stejnou jednotku (kg/g a l/ml se převádí).
  Kategorie jsou přesně ty z promptu (sekce 13). Bez čísla jen s `"odhad": true`.
- `kontrola` = body ze sekce 15 promptu, poctivě vyplněné (appka je neukazuje, slouží ke kontrole).
- `upozorneni`: **jen nezbytné minimum**, nejvýš 3 krátké body (do 100 znaků). Nic, co je v pořádku,
  a nic, co je vidět z receptů. Když není co hlásit, dej prázdné pole.

5. **Kontrola:** `node jidelnicek/over.js /tmp/plan.json /tmp/historie.json`.
   Každou `CHYBA` oprav a spusť znovu, dokud nevypíše OK. `UPOZORNĚNÍ` buď vyřeš, nebo ho
   uveď v `upozorneni`.
6. **Odeslání:**

```sh
curl -s -X POST https://solax-pretok.onrender.com/api/jidelnicek/import \
  -H 'Content-Type: application/json' ${JIDELNICEK_KLIC:+-H "X-Klic: $JIDELNICEK_KLIC"} \
  --data @/tmp/plan.json
```

   Odpověď `{"ok":true,…}` = hotovo. Při 400 oprav, co appka hlásí, a pošli znovu.
   Klíč `JIDELNICEK_KLIC` nikdy nevypisuj.

7. **Na konec** napiš krátké shrnutí: názvy jídel podle kategorií, odkazy a co šlo do upozornění.
   Nic necommituj a nepushuj.
