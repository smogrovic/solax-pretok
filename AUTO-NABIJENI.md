# Nabíjení auta: data pro jinou appku

Solinátor po dnech počítá, kolik auto (wallbox) vzalo z FVE a kolik ze sítě, a kolik to stálo.
Druhá appka si data stahuje sama z adresy Solinátoru a sčítá je do měsíců.

## 1. Nastavení (jednou)

1. **Vymysli klíč.** Je to dlouhý náhodný řetězec, třeba z příkazu `openssl rand -hex 24` v Terminálu
   na Macu. Klíč nikam neposílej, ani do chatu, ani do repozitáře.
2. **Solinátor na Renderu:** služba `solax-pretok` → Environment → Add Environment Variable:
   `AUTO_KLIC` = tvůj klíč. Uložit; Render službu sám restartuje.
3. **Druhá appka na Renderu:** její služba → Environment → `SOLINATOR_KLIC` = **stejný** klíč.
   Do stejné appky přidej i `SOLINATOR_URL` = `https://solax-pretok.onrender.com`.
4. Pak dej Claudovi v repozitáři druhé appky prompt ze sekce 3.

Bez nastaveného `AUTO_KLIC` adresa vrací 503 a žádná data nevydá.

## 2. Adresa a formát

```
GET https://solax-pretok.onrender.com/api/auto/nabijeni?od=2026-10-01&do=2026-10-31
Hlavička: X-Klic: <klíč>
```

- `od`, `do` ve tvaru `YYYY-MM-DD` (pražské dny), obojí volitelné. Výchozí rozsah je posledních 31 dní
  do dneška. Najednou jde nejvýš 400 dní.
- Chybný klíč vrací 401, `od` po `do` nebo příliš dlouhý rozsah vrací 400.
- Render po nečinnosti usíná, takže první dotaz může trvat i desítky vteřin. Počítej s timeoutem
  aspoň 60 s a při chybě to zkus znovu za pár minut.

Odpověď:

```json
{
  "ok": true, "od": "2026-10-01", "do": "2026-10-31", "mena": "CZK",
  "cenik": { "nazev": "ČEZ D56d, jistič 3×25 A", "vtKcKwh": 4.32625, "ntKcKwh": 3.42394, "fveKcKwh": 0 },
  "poznamka": "…",
  "dny": [
    { "d": "2026-10-14", "kwh": 32.4, "fveKwh": 21.1, "sitKwh": 11.3,
      "sitVtKwh": 1.2, "sitNtKwh": 10.1, "cenaKc": 39.77 },
    { "d": "2026-11-09", "kwh": 5.2, "fveKwh": 5.2, "sitKwh": 0, "sitVtKwh": 0, "sitNtKwh": 0,
      "cenaKc": 0, "neuplny": true }
  ]
}
```

Popis polí:

| Pole | Význam |
|---|---|
| `kwh` | Celkem nabito za den = `fveKwh + sitKwh` |
| `fveKwh` | Z fotovoltaiky, počítá se zdarma (přetok se neprodává) |
| `sitKwh` | Ze sítě, rozdělené na `sitVtKwh` (vysoký tarif) a `sitNtKwh` (nízký tarif) |
| `cenaKc` | `sitVtKwh × vtKcKwh + sitNtKwh × ntKcKwh`. Je to proměnná cena s DPH a distribucí. Měsíční poplatky (jistič, stálá platba) v ní **nejsou**, ty platíš i bez auta. |
| `odhadTarifu` | `true` = den z doby, kdy Solinátor ještě neměřil tarif. VT/NT je u něj rozdělené podle podílu času. |
| `neuplny` | `true` = dnešek, ještě se nabíjí. Načti ho znovu později. |

Dny bez nabíjení v seznamu nejsou, to znamená nula. Hodnoty dne se můžou měnit, dokud den neskončí,
a po restartu Solinátoru se ještě doplní ze zálohy. Proto se poslední dny stahují pokaždé znovu
a ukládají se přepsáním podle data.

## 3. Prompt pro Clauda (do repozitáře druhé appky)

> Přidej do aplikace evidenci nákladů na nabíjení auta. Data dodává moje druhá aplikace Solinátor
> přes HTTP. Napoj se na ni, ukládej denní data a ukazuj měsíční součty.
>
> **Zdroj dat**
> - `GET ${SOLINATOR_URL}/api/auto/nabijeni?od=YYYY-MM-DD&do=YYYY-MM-DD` s hlavičkou
>   `X-Klic: ${SOLINATOR_KLIC}`.
> - Obě hodnoty ber z proměnných prostředí `SOLINATOR_URL` a `SOLINATOR_KLIC`. Jsou nastavené
>   na Renderu. Klíč nikdy nedávej do kódu, logů, odpovědí API ani do klienta (prohlížeče).
>   Volání dělej jen ze serveru.
> - Odpověď: `{ ok, od, do, mena: "CZK", cenik: { nazev, vtKcKwh, ntKcKwh, fveKcKwh }, poznamka,
>   dny: [{ d, kwh, fveKwh, sitKwh, sitVtKwh, sitNtKwh, cenaKc, odhadTarifu?, neuplny? }] }`.
>   - Dny jsou pražské dny `YYYY-MM-DD`. Den, který v seznamu chybí, znamená, že se nenabíjelo (0).
>   - `cenaKc` je cena jen za odběr ze sítě. FVE je zdarma. Měsíční poplatky v ceně nejsou.
>   - `neuplny: true` je dnešek, který se ještě mění.
>   - `odhadTarifu: true` znamená, že VT/NT je u toho dne odhadnuté podle času.
> - Jeden dotaz smí mít nejvýš 400 dní.
> - Chyby: 401 = špatný klíč, 503 = Solinátor nemá nastavený klíč, 400 = špatný rozsah.
> - Solinátor běží na Renderu a po nečinnosti usíná. Použij timeout 60 s a při chybě opakuj
>   nejvýš 3× s odstupem 2 minut.
>
> **Ukládání**
> - Ulož denní záznamy podle data (`d` je klíč) do úložiště, které aplikace už používá.
>   Pokud žádné nemá, zvol nejjednodušší trvalé řešení vhodné pro Render a vysvětli proč.
>   Disk Renderu se po nasazení maže.
> - Ukládej přepsáním (upsert). Den, který dřív existoval a v nové odpovědi pro stejný rozsah chybí,
>   nastav na nulu.
> - Při prvním spuštění stáhni historii od `2025-01-01` po kouscích nejvýš 400 dní.
> - Potom jednou denně kolem 00:30 pražského času a při každém startu serveru stáhni posledních
>   7 dní. Ukládej je přepsáním, protože se zpětně doplňují.
>
> **Zobrazení**
> - Přidej stránku nebo kartu „Nabíjení auta“ s tabulkou po měsících, nejnovější nahoře.
> - Sloupce: měsíc, kWh celkem, z toho FVE (kWh a %), ze sítě (kWh, z toho NT), cena Kč, průměrná cena
>   za 1 kWh nabitou celkem (Kč/kWh) a průměrná cena za 1 kWh ze sítě.
> - Pod tabulkou celkový součet za zobrazený rok.
> - Běžící měsíc označ jako neúplný. Měsíc obsahující dny s `odhadTarifu` označ hvězdičkou
>   s vysvětlivkou „VT/NT odhadnuto podle času“.
> - Ukaž, kdy byla data naposledy stažena. Když poslední stažení selhalo, ukaž srozumitelnou hlášku.
> - Přidej tlačítko „Načíst znovu“, které stáhne posledních 31 dní.
> - Měsíční součty počítej z uložených denních dat, neukládej je zvlášť.
>
> **Ověření**
> - Napiš testy: rozbor odpovědi, upsert (přepsání dne i vynulování chybějícího dne), měsíční součty
>   (včetně průměrné ceny a procenta z FVE), chování při 401, 503 a timeoutu.
>   Solinátor v testech podvrhni, nevolej ostrou adresu.
> - Na konci mi napiš, jestli musím na Renderu něco nastavit, a jak ověřím, že stahování funguje.
