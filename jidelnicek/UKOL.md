# Úloha: jídelníček na příští týden

Spouští se v pátek ráno jako naplánovaná úloha (a kdykoli ručně). Výsledek se pošle do
appky Solinátor. Appka ho ukáže na stránce Nákup a jeho suroviny dá na nákupní seznam.

Pravidla jídelníčku jsou v `jidelnicek/PROMPT.md`. Platí bez výjimek. Formát výstupu
(sekce 12–14 promptu) tady nahrazuje JSON níž: appka z něj sama udělá přehled
VEČEŘE / PEČENÍ / SNÍDANĚ, odškrtávací nákupní seznam a tiskovou verzi.

## Postup

1. **Historie:** `curl -s https://solax-pretok.onrender.com/api/jidelnicek/historie > /tmp/historie.json`.
   Obsahuje názvy jídel z posledních týdnů a příznak `ryba`. Jídla se nemají opakovat a ryba
   má být jednou za 14 dní: když byla minulý týden, teď žádná, jinak právě jedna.
   Pokud appka neodpoví (Render se probouzí), zkus to znovu za minutu, nejvýš 3×.
2. **Recepty:** hledej (WebSearch) a hlavně **otevři** (WebFetch) konkrétní recepty jen na:
   `maruskaveg.com`, `buchtavtroube.cz`, `receptyodanicky.cz`, `karolinafour.cz`.
   Pracovní večeře ber z více webů. Každý převzatý recept musí být otevřený a zkontrolovaný
   (název, suroviny, postup, porce). Když se recept dohledat nedá, vezmi jiný, nebo napiš
   vlastní (`vlastni: true`, bez odkazu). Odkazy nikdy nevymýšlej.
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
    "suroviny": [{ "nazev": "Rýže", "mnozstvi": 300, "jednotka": "g", "poznamka": "suchá hmotnost" }],
    "postup": ["…", "…"],
    "predem": "…", "skladovani": "…", "ohrev": "…", "forma": "jen u pečení, např. plech 30 × 40 cm",
    "vyziva": { "kcal": 0, "bilkoviny": 0, "sacharidy": 0, "tuky": 0 },
    "stitky": ["maso", "vegan", "ryba", "tortilla", "brambory", "mozzarella", "cottage", "tvaroh"]
  }],
  "nakup": [{ "kategorie": "Mléčné výrobky a sýry", "nazev": "Mozzarella", "mnozstvi": 250, "jednotka": "g", "odhad": false, "poznamka": "" }],
  "kontrola": [{ "bod": "Je přesně 5 hlavních jídel?", "ok": true, "poznamka": "" }],
  "upozorneni": ["Co se nepodařilo ověřit nebo splnit."]
}
```

- `tyden` je pondělí příštího týdne (pražský čas).
- Receptů je přesně 10: 4× `pracovni`, 1× `vikend`, 1× `bez_vareni` (vše `vecere`), 1× `peceni`,
  2× `pracovni_snidane` a 1× `vikend_snidane` (obě `snidane`). Pizza se nepíše.
- `stitky`: jen ty, které platí. `maso` jen u hlavních jídel s masem (přesně dvě),
  `vegan` u plně veganského hlavního jídla, `mozzarella`/`cottage`/`tvaroh` u receptů, kde jsou.
- `mnozstvi` je číslo, jednotka `g`, `kg`, `ml`, `l`, `ks`, `lžíce`, `lžička`, `balení`…
- **Nákup** je přesný součet surovin. Položka se jmenuje **stejně** jako surovina v receptech
  (stejné názvy napříč recepty, jinak se nesečtou) a má stejnou jednotku (kg/g a l/ml se převádí).
  Kategorie jsou přesně ty z promptu (sekce 13). Bez čísla jen s `"odhad": true`.
- `kontrola` = body ze sekce 15 promptu, poctivě vyplněné.

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
