// Ověření: tepelné čerpadlo bazénu (Fairland) přes Tuya cloud.
//
// Podpis je jediné místo, kde se dá tiše minout: Tuya na chybu odpoví kódem 1004
// („sign invalid") a nic víc neřekne, takže se to musí trefit napoprvé. Kontrolní
// hodnoty níž jsou spočítané ručně podle dokumentovaného postupu, ne z tohohle kódu —
// jinak by sada jen opisovala implementaci a schválila by i chybu.
//
// Druhá past je mapování: kódy datových bodů Fairland nedokumentuje a liší se model
// od modelu. Co se nenajde, musí zůstat null. Nula by v grafu nakreslila ledovou vodu.
const { between, suite } = require('./zdroj');
const { check, nadpis, konec } = suite('tuya');

const CODE = between('// ---------- Tepelné čerpadlo bazénu (Fairland přes Tuya cloud) ----------',
                     '// ---------- Nuki zámek ----------');

function build({ id = 'cid', secret = 'tajne', devId = 'abc', zapnuto = true,
                 odpovedi = [], ted = Date.now() } = {}) {
  const dotazy = [];
  const logy = [];
  const state = { heatpump: { error: null } };
  let now = ted;
  const fronta = odpovedi.slice();

  const api = new Function(
    'crypto', 'fetch', 'state', 'addLog', 'broadcast', 'cerstve', 'scheduleEvery', 'app',
    'POLL_INTERVAL_MS', 'TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET', 'TUYA_API_URL',
    'TUYA_HEATPUMP_ID', 'tuyaEnabled', 'Date',
    CODE + '\n; return { tuyaSign, tuyaStringToSign, tuyaHlavicky, tuyaAccessToken,'
         + ' fetchHeatpump, pollHeatpump, heatpumpMap, heatpumpPayload,'
         + ' hpTeplota, hpVoda, hpRezimText, HP_KODY, fetchHeatpumpDiag,'
         + ' HP_DIAG_ZDROJE, get token() { return tuyaToken; } };'
  )(
    require('crypto'),
    async (url, opts) => {
      dotazy.push({ url: String(url), headers: (opts && opts.headers) || {} });
      const o = fronta.shift();
      if (!o) throw new Error('došly podstrčené odpovědi');
      if (o.throw) throw new Error(o.throw);
      if (o.delay) await new Promise(r => setTimeout(r, o.delay));
      return { ok: o.ok !== false, status: o.status || 200, json: async () => o.body };
    },
    state,
    m => logy.push(m),
    () => {},
    ts => !!ts && now - new Date(ts).getTime() <= 10 * 60000,
    () => {},
    { get: () => {} },
    120000, id, secret, 'https://openapi.tuyaeu.com', devId, zapnuto,
    class extends Date { static now() { return now; } }
  );
  return { api, state, dotazy, logy, posun: ms => { now += ms; }, get now() { return now; } };
}

const okToken = { body: { success: true, result: { access_token: 'tok123', expire_time: 7200 } } };
const dev = st => ({ body: { success: true, result: { online: true, name: 'AFD', status: st } } });
// Shadow properties: vlastní číslované body, které standardní status nevrací
const stin = props => ({ body: { success: true, result: { properties: props } } });
const bezStinu = { throw: 'shadow nedostupný' };

nadpis('1) Podpis');
{
  const h = build();
  // Řetězec k podpisu: METODA \n SHA256(tělo) \n hlavičky \n cesta.
  // Ten prázdný třetí řádek tam MUSÍ zůstat, i když hlavičky nepoužíváme.
  check('stringToSign má prázdný řádek hlaviček',
    JSON.stringify(h.api.tuyaStringToSign('GET', '/v1.0/token?grant_type=1')),
    JSON.stringify('GET\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n\n/v1.0/token?grant_type=1'));
  // Kontrolní hodnoty spočítané ručně podle dokumentace Tuyi
  check('podpis tokenu sedí',
    h.api.tuyaSign('cid' + '1700000000000' + 'n1' + h.api.tuyaStringToSign('GET', '/v1.0/token?grant_type=1')),
    '7FEECA959EABF28FE2EAC470015A3250D29D60D8C6762736A336332BD37F2A1F');
  check('podpis business volání sedí (s tokenem)',
    h.api.tuyaSign('cid' + 'tok123' + '1700000000000' + 'n1' + h.api.tuyaStringToSign('GET', '/v1.0/devices/abc')),
    '71FFCDCD441B997269CD307979B4E17A6F8C836A5E0CB97C6AEBD9B548DA9D5E');
  check('podpis je velkými písmeny', h.api.tuyaSign('x'), h.api.tuyaSign('x').toUpperCase());
}
{
  const h = build();
  const bez = h.api.tuyaHlavicky('GET', '/v1.0/token?grant_type=1');
  check('u tokenu se access_token neposílá', 'access_token' in bez, false);
  check('  ale nonce ano', typeof bez.nonce === 'string' && bez.nonce.length > 10, true);
  check('  a metoda podpisu taky', bez.sign_method, 'HMAC-SHA256');
  const s = h.api.tuyaHlavicky('GET', '/v1.0/devices/abc', { token: 'tok123' });
  check('u business volání access_token je', s.access_token, 'tok123');
  // Nonce musí být pokaždé jiný, jinak by šel podpis přehrát
  check('nonce se neopakuje', h.api.tuyaHlavicky('GET', '/x').nonce === h.api.tuyaHlavicky('GET', '/x').nonce, false);
  // A hlavně: nonce i token se musí do podepisovaného řetězce OPRAVDU dostat. Poslat je
  // v hlavičkách a zapomenout je v podpisu je chyba, kterou Tuya vrátí až jako 1004.
  check('podpis v hlavičkách počítá s nonce i tokenem', s.sign,
    h.api.tuyaSign('cid' + 'tok123' + s.t + s.nonce + h.api.tuyaStringToSign('GET', '/v1.0/devices/abc')));
  check('  a u tokenového volání zase bez tokenu', bez.sign,
    h.api.tuyaSign('cid' + bez.t + bez.nonce + h.api.tuyaStringToSign('GET', '/v1.0/token?grant_type=1')));
}

nadpis('2) Token');
(async () => {
  {
    const h = build({ odpovedi: [okToken] });
    check('první volání token vytáhne', await h.api.tuyaAccessToken(), 'tok123');
    check('  a jde na správnou cestu', h.dotazy[0].url, 'https://openapi.tuyaeu.com/v1.0/token?grant_type=1');
    check('druhé volání ho vezme z paměti', await h.api.tuyaAccessToken(), 'tok123');
    check('  takže se neptá znovu', h.dotazy.length, 1);
  }
  {
    // Platnost 7200 s minus pětiminutová rezerva → obnova nejpozději po 115 min
    const h = build({ odpovedi: [okToken, { body: { success: true, result: { access_token: 'novy', expire_time: 7200 } } }] });
    await h.api.tuyaAccessToken();
    h.posun(114 * 60000);
    check('před vypršením se drží starý', await h.api.tuyaAccessToken(), 'tok123');
    h.posun(2 * 60000);
    check('po vypršení se obnoví', await h.api.tuyaAccessToken(), 'novy');
    check('  a stálo to druhý dotaz', h.dotazy.length, 2);
  }
  {
    // Tuya vrací HTTP 200 i na chybu; pravda je v poli success
    const h = build({ odpovedi: [{ body: { success: false, code: 1004, msg: 'sign invalid' } }] });
    let chyba = '';
    try { await h.api.tuyaAccessToken(); } catch (e) { chyba = e.message; }
    check('chyba v těle se pozná i při HTTP 200', chyba, 'Tuya: sign invalid (1004)');
  }

  nadpis('3) Mapování datových bodů');
  {
    const h = build({ odpovedi: [okToken, dev([
      { code: 'temp_current', value: 245 },
      { code: 'temp_set', value: 28 },
      { code: 'switch', value: true },
      { code: 'mode', value: 'heat' }
    ]), bezStinu] });
    const d = await h.api.fetchHeatpump();
    check('desetiny stupně se přepočtou', d.tempC, 24.5);
    check('celé stupně zůstanou', d.targetC, 28);
    check('režim se přeloží', d.mode, 'topí');
    check('zapnuto se pozná', d.on, true);
    // Tohle je ta past: chybějící kód nesmí být nula, jinak graf kreslí ledovou vodu
    check('chybějící příkon je null, ne nula', d.powerW, null);
    check('chybějící teplota na výstupu taky', d.outC, null);
    // Do logu se nezapisuje nic: diagnostika svoje odvedla a čtyři obří řádky ho
    // jen zavalovaly. Rozbité mapování se pozná na kartě a přes /api/heatpump/raw.
    check('do logu se nezapisuje nic', h.logy.length, 0);
  }
  {
    const h = build({ odpovedi: [okToken, dev([{ code: 'water_temp', value: 22.5 }, { code: 'work_mode', value: 'zvlastni' }]), bezStinu] });
    const d = await h.api.fetchHeatpump();
    check('bere se i náhradní název kódu', d.tempC, 22.5);
    check('neznámý režim projde jako text', d.mode, 'zvlastni');
    check('nehlášené zapnutí je null', d.on, null);
  }
  {
    const h = build({ odpovedi: [okToken, { body: { success: true, result: { online: false, status: [] } } }, bezStinu] });
    const d = await h.api.fetchHeatpump();
    check('offline se přenese', d.online, false);
    check('  a z prázdného stavu se nic nevymyslí', d.tempC, null);
  }
  check('záporná teplota se nepřepočítává', build().api.hpTeplota(-3), -3);
  check('nesmysl je null', build().api.hpTeplota('x'), null);
  check('prázdný režim je null', build().api.hpRezimText(''), null);

  nadpis('3b) Pojistka na nesmyslnou teplotu');
  // Tenhle případ appku poprvé shodil: čerpadlo hlásilo 29 °C, my kreslili −22 °C
  // z jiného datového bodu a tvářili se jistě. Špatné mapování má vypadat jako „nevíme".
  {
    const a = build().api;
    check('−22 °C bazén mít nemůže → null', a.hpVoda(-22), null);
    check('  a −220 v desetinách taky ne', a.hpVoda(-220), null);
    check('80 °C taky ne', a.hpVoda(80), null);
    check('29 °C projde', a.hpVoda(29), 29);
    check('  i jako desetiny', a.hpVoda(294), 29.4);
    check('mírný mráz na kraji rozmezí projde', a.hpVoda(-4), -4);
    check('nehlášená hodnota zůstává null', a.hpVoda(null), null);
  }
  {
    const h = build({ odpovedi: [okToken, dev([
      { code: 'temp_current', value: -220 },
      { code: 'inlet_temp', value: 29 }
    ]), bezStinu] });
    const d = await h.api.fetchHeatpump();
    // Nesmyslná hodnota z prvního kódu nesmí přebít rozumnou z dalšího… ale nepřebije jen
    // proto, že se první kód najde. Ať je vidět, co se doopravdy stane:
    check('nesmysl z prvního kódu neprojde jako teplota', d.tempC, null);
    check('  ale kódy jsou v odpovědi, ať se dá mapování opravit',
      d.dp.map(x => x.code).join(','), 'temp_current,inlet_temp');
  }

  nadpis('3c) Výkon kompresoru');
  {
    const h = build({ odpovedi: [okToken, dev([
      { code: 'inlet_temp', value: 29 },
      { code: 'compressor_percentage', value: 61 },
      { code: 'temp_set_heat', value: 31 },
      { code: 'outlet_temp', value: 33 }
    ]), bezStinu] });
    const d = await h.api.fetchHeatpump();
    check('vstupní voda je teplota bazénu', d.tempC, 29);
    check('výstup je zvlášť', d.outC, 33);
    check('  a nesplete se se vstupem', d.tempC !== d.outC, true);
    check('žádaná teplota z topné větve', d.targetC, 31);
    check('výkon kompresoru v procentech', d.vykonPct, 61);
  }
  {
    const h = build({ odpovedi: [okToken, dev([{ code: 'inlet_temp', value: 29 }]), bezStinu] });
    const d = await h.api.fetchHeatpump();
    check('nehlášený výkon je null, ne nula', d.vykonPct, null);
  }
  {
    // Topná žádaná má přednost před obecnou — jinak by se u dvou setpointů brala chladicí
    const h = build({ odpovedi: [okToken, dev([
      { code: 'temp_set', value: 24 }, { code: 'temp_set_heat', value: 31 }
    ]), bezStinu] });
    check('topná žádaná přebije obecnou', (await h.api.fetchHeatpump()).targetC, 31);
  }

  nadpis('4) Co se uloží do stavu');
  // Teplota vody se nikde nekreslí do grafu — je jen na kartě. Pravda o její
  // důvěryhodnosti proto sedí ve stavu a kartu si pohlídá test/browser-bazen.js.
  {
    const h = build({ odpovedi: [okToken, dev([{ code: 'temp_current', value: 26 }]), bezStinu] });
    await h.api.pollHeatpump();
    check('rozumná teplota se uloží', h.state.heatpump.tempC, 26);
    check('  s razítkem, ať se pozná stáří', typeof h.state.heatpump.fetchedAt, 'string');
  }
  {
    const h = build({ odpovedi: [okToken, { body: { success: true, result: { online: false, status: [{ code: 'temp_current', value: 26 }] } } }, bezStinu] });
    await h.api.pollHeatpump();
    check('offline se do stavu přenese', h.state.heatpump.online, false);
  }
  {
    // Přesně ta −22 °C, kvůli které se mapování předělávalo
    const h = build({ odpovedi: [okToken, dev([{ code: 'temp_current', value: -220 }]), bezStinu] });
    await h.api.pollHeatpump();
    check('nesmyslná teplota se neuloží ani do stavu', h.state.heatpump.tempC, null);
  }
  {
    // Po chybě se zahodí token — vypršelý token je nejčastější příčina a bez tohohle
    // by se na něj tlouklo dokola až do restartu serveru
    const h = build({ odpovedi: [okToken, { throw: 'síť' }] });
    await h.api.pollHeatpump();
    check('chyba se uloží do stavu', h.state.heatpump.error, 'síť');
    check('  a token se zahodí', h.api.token.value, null);
  }

  nadpis('3d) Vlastní číslované body ze shadow properties');
  // Tohle je jádro celé integrace. Standardní status vrací u tohohle čerpadla čtyři
  // pojmenované body a teplota vody mezi nimi NENÍ — `temp_current` hlásí −22, zatímco
  // Fairland ukazuje 29. Ta správná hodnota chodí jako vlastní číslovaný bod WInTemp
  // (dp 102), výkon kompresoru jako SpeedPercentage (dp 104).
  {
    const h = build({ odpovedi: [okToken,
      dev([{ code: 'switch', value: true }, { code: 'temp_unit_convert', value: 'f' },
           { code: 'temp_set', value: 31 }, { code: 'temp_current', value: -22 }]),
      stin([{ code: 'Power', dp_id: 1, value: true },
            { code: 'WInTemp', dp_id: 102, value: 29 },
            { code: 'change_tem', dp_id: 103, value: true },
            { code: 'SpeedPercentage', dp_id: 104, value: 61 }])
    ] });
    const d = await h.api.fetchHeatpump();
    check('teplota vody je z WInTemp, ne z temp_current', d.tempC, 29);
    check('výkon kompresoru ze SpeedPercentage', d.vykonPct, 61);
    check('cíl zůstává ze standardní sady', d.targetC, 31);
    check('zapnuto se pozná', d.on, true);
    check('online z /devices se přenese', d.online, true);
    check('do výpisu jdou body z obou zdrojů',
      d.dp.map(x => x.code).join(','),
      'switch,temp_unit_convert,temp_set,temp_current,Power,WInTemp,change_tem,SpeedPercentage');
  }
  {
    // Když týž kód přijde z obou zdrojů, platí shadow — je čerstvější a bohatší
    const h = build({ odpovedi: [okToken, dev([{ code: 'switch', value: false }]),
      stin([{ code: 'switch', value: true }, { code: 'WInTemp', value: 29 }])] });
    check('při shodném kódu vyhraje shadow', (await h.api.fetchHeatpump()).on, true);
  }
  {
    // Kdyby WInTemp jednou zmizel, ať se nesáhne po temp_current s jeho −22
    const h = build({ odpovedi: [okToken, dev([{ code: 'temp_current', value: -22 }]),
      stin([{ code: 'SpeedPercentage', value: 61 }])] });
    const d = await h.api.fetchHeatpump();
    check('bez WInTemp radši nic než −22', d.tempC, null);
    check('  ale výkon zůstane', d.vykonPct, 61);
  }
  {
    // Shadow je jediný zdroj teploty vody, ale ne toho, jestli čerpadlo žije.
    // Když spadne, karta musí pořád vědět stav a cíl.
    const h = build({ odpovedi: [okToken, dev([{ code: 'temp_set', value: 31 }, { code: 'switch', value: true }]),
      { throw: 'shadow nedostupný' }] });
    const d = await h.api.fetchHeatpump();
    check('rozbitý shadow čtení stavu neshodí', d.online, true);
    check('  cíl zůstane', d.targetC, 31);
    check('  zapnuto taky', d.on, true);
    check('  jen teplota vody chybí', d.tempC, null);
  }
  {
    // Naopak: /devices je jediný zdroj příznaku online, ten padat nesmí
    const h = build({ odpovedi: [okToken, { throw: 'cloud' }] });
    let chyba = '';
    try { await h.api.fetchHeatpump(); } catch (e) { chyba = e.message; }
    check('rozbitý /devices se propíše jako chyba', chyba, 'cloud');
  }

  nadpis('4b) Diagnostika mimo standardní sadu');
  // Běžný status vrací u tohohle čerpadla jen čtyři pojmenované body, kdežto Fairland
  // appka jich ukazuje víc. Tyhle tři zdroje mají najít i číslované DP.
  {
    const h = build({ odpovedi: [okToken,
      { body: { success: true, result: { status: [{ code: 'temp_current', type: 'Integer' }] } } },
      { body: { success: true, result: [{ code: 'va_temperature', value: 290 }] } },
      { body: { success: true, result: { properties: [{ dp_id: 101, value: 29 }] } } }
    ] });
    const d = await h.api.fetchHeatpumpDiag();
    check('zkusí se všechny tři zdroje', Object.keys(d).join(','),
      'specifikace,iot-03 status,shadow properties');
    check('  a jde se na správné cesty',
      h.dotazy.slice(1).map(q => q.url.replace('https://openapi.tuyaeu.com', '')).join(' '),
      '/v1.0/devices/abc/specifications /v1.0/iot-03/devices/abc/status /v2.0/cloud/thing/abc/shadow/properties');
    check('výsledek nese i číslované DP', JSON.stringify(d['shadow properties'].properties), '[{"dp_id":101,"value":29}]');
  }
  {
    // Vlastní riziko téhle změny: diagnostika nesmí rozbít to, co funguje
    const h = build({ odpovedi: [okToken,
      { body: { success: false, code: 1106, msg: 'permission deny' } },
      { throw: 'síť' },
      { body: { success: true, result: { properties: [] } } }
    ] });
    const d = await h.api.fetchHeatpumpDiag();
    check('chyba jednoho zdroje ostatní nezastaví', Object.keys(d).length, 3);
    check('  a zapíše se ke svému zdroji', /permission deny/.test(d.specifikace.chyba), true);
    check('  i když spadne spojení', d['iot-03 status'].chyba, 'síť');
    check('  poslední zdroj přesto projde', Array.isArray(d['shadow properties'].properties), true);
  }
  {
    // Poller diagnostiku vůbec nespouští — jde se na ni jen ručně přes /api/heatpump/raw.
    // Kdyby ji spouštěl, byly by to tři dotazy navíc a čtyři obří řádky v logu.
    const h = build({ odpovedi: [okToken, dev([{ code: 'temp_current', value: 26 }]), bezStinu] });
    await h.api.pollHeatpump();
    await new Promise(r => setTimeout(r, 20));
    check('poller stav uloží', h.state.heatpump.tempC, 26);
    check('  a do logu nenapíše nic', h.logy.length, 0);
    check('  ani si nevyžádá diagnostické dotazy', h.dotazy.length, 3);
  }
  {
    // Ani při chybě se do logu nic nesype — jen se zapamatuje ve stavu pro kartu
    const h = build({ odpovedi: [okToken, { throw: 'síť' }] });
    await h.api.pollHeatpump();
    await new Promise(r => setTimeout(r, 20));
    check('chyba se do logu taky nepíše', h.logy.length, 0);
    check('  ale ve stavu je', h.state.heatpump.error, 'síť');
  }

  nadpis('5) Bez klíčů');
  {
    const h = build({ zapnuto: false, odpovedi: [okToken] });
    await h.api.pollHeatpump();
    check('poller se vůbec nespustí', h.dotazy.length, 0);
    check('payload to řekne appce', h.api.heatpumpPayload().enabled, false);
  }

  konec();
})();
