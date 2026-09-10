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
         + ' fetchHeatpump, pollHeatpump, heatpumpMap, heatpumpPayload, heatpumpTempC,'
         + ' hpTeplota, hpVoda, hpRezimText, HP_KODY, get token() { return tuyaToken; } };'
  )(
    require('crypto'),
    async (url, opts) => {
      dotazy.push({ url: String(url), headers: (opts && opts.headers) || {} });
      const o = fronta.shift();
      if (!o) throw new Error('došly podstrčené odpovědi');
      if (o.throw) throw new Error(o.throw);
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
    ])] });
    const d = await h.api.fetchHeatpump();
    check('desetiny stupně se přepočtou', d.tempC, 24.5);
    check('celé stupně zůstanou', d.targetC, 28);
    check('režim se přeloží', d.mode, 'topí');
    check('zapnuto se pozná', d.on, true);
    // Tohle je ta past: chybějící kód nesmí být nula, jinak graf kreslí ledovou vodu
    check('chybějící příkon je null, ne nula', d.powerW, null);
    check('chybějící teplota na výstupu taky', d.outC, null);
    check('kódy se jednou zapíšou do logu', /temp_current=245/.test(h.logy.join(' ')), true);
  }
  {
    const h = build({ odpovedi: [okToken, dev([{ code: 'water_temp', value: 22.5 }, { code: 'work_mode', value: 'zvlastni' }])] });
    const d = await h.api.fetchHeatpump();
    check('bere se i náhradní název kódu', d.tempC, 22.5);
    check('neznámý režim projde jako text', d.mode, 'zvlastni');
    check('nehlášené zapnutí je null', d.on, null);
  }
  {
    const h = build({ odpovedi: [okToken, { body: { success: true, result: { online: false, status: [] } } }] });
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
    ])] });
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
    ])] });
    const d = await h.api.fetchHeatpump();
    check('vstupní voda je teplota bazénu', d.tempC, 29);
    check('výstup je zvlášť', d.outC, 33);
    check('  a nesplete se se vstupem', d.tempC !== d.outC, true);
    check('žádaná teplota z topné větve', d.targetC, 31);
    check('výkon kompresoru v procentech', d.vykonPct, 61);
  }
  {
    const h = build({ odpovedi: [okToken, dev([{ code: 'inlet_temp', value: 29 }])] });
    const d = await h.api.fetchHeatpump();
    check('nehlášený výkon je null, ne nula', d.vykonPct, null);
  }
  {
    // Topná žádaná má přednost před obecnou — jinak by se u dvou setpointů brala chladicí
    const h = build({ odpovedi: [okToken, dev([
      { code: 'temp_set', value: 24 }, { code: 'temp_set_heat', value: 31 }
    ])] });
    check('topná žádaná přebije obecnou', (await h.api.fetchHeatpump()).targetC, 31);
  }

  nadpis('4) Teplota do grafu');
  {
    const h = build({ odpovedi: [okToken, dev([{ code: 'temp_current', value: 26 }])] });
    await h.api.pollHeatpump();
    check('čerstvá a online → kreslí se', h.api.heatpumpTempC(), 26);
    h.posun(20 * 60000);
    check('zestárlá → díra v grafu', h.api.heatpumpTempC(), null);
  }
  {
    const h = build({ odpovedi: [okToken, { body: { success: true, result: { online: false, status: [{ code: 'temp_current', value: 26 }] } } }] });
    await h.api.pollHeatpump();
    check('offline se do grafu nedostane', h.api.heatpumpTempC(), null);
  }
  {
    // Do grafu nesmí nesmyslná teplota ani při online a čerstvých datech
    const h = build({ odpovedi: [okToken, dev([{ code: 'temp_current', value: -220 }])] });
    await h.api.pollHeatpump();
    check('nesmyslná teplota se do grafu nedostane', h.api.heatpumpTempC(), null);
  }
  {
    // Po chybě se zahodí token — vypršelý token je nejčastější příčina a bez tohohle
    // by se na něj tlouklo dokola až do restartu serveru
    const h = build({ odpovedi: [okToken, { throw: 'síť' }] });
    await h.api.pollHeatpump();
    check('chyba se uloží do stavu', h.state.heatpump.error, 'síť');
    check('  a token se zahodí', h.api.token.value, null);
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
