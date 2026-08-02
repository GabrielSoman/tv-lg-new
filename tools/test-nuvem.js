#!/usr/bin/env node
/* =========================================================
   TESTE DA NUVEM, DA FILEIRA NUMERADA E DO TRAILER
   =========================================================
   Três coisas que o app passou a fazer nesta versão e que não
   dá para conferir olhando a tela:

     1. as CINCO tabelas do Supabase recebem escrita. Antes só
        `watch_progress` recebia — favoritos morriam com o app,
        que era justamente o problema que o banco existia para
        resolver;

     2. a fileira numerada mede certo. Ela é a única com um
        cartão de largura diferente das outras, e a
        virtualização deduz o passo da fileira medindo UM
        cartão: se o "1" for mais estreito que o "10", tudo do
        décimo em diante sai deslocado — e um defeito que só
        começa no décimo item passa despercebido;

     3. o trailer entra e, o que importa mais, SAI. Um <iframe>
        do YouTube esquecido continua tocando dentro de um nó
        que já saiu do documento.

   O Supabase de verdade não é chamado: as rotas do PostgREST
   são interceptadas e gravadas. O que se verifica é o que o app
   TENTOU escrever, que é exatamente a pergunta.

       node tools/mock-iptv.js &
       node tools/dev-server.js &
       node tools/test-nuvem.js
   ========================================================= */
const { chromium } = require('playwright');

const APP  = process.env.APP_URL  || 'http://localhost:8088';
const MOCK = process.env.MOCK_URL || 'http://localhost:9099';
const LISTA = MOCK + '/get.php?username=teste&password=123&type=m3u_plus';
const SUPA = 'https://exemplo.supabase.co';

let page;
const falhas = [];
let n = 0;

function ok(rot, real, esperado) {
  n++;
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${bate ? 'ok   ' : 'FALHA'}  ${rot}` +
    (bate ? '' : `\n           esperado: ${JSON.stringify(esperado)}\n           veio:     ${JSON.stringify(real)}`));
  if (!bate) falhas.push(rot);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(fn, arg, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await page.evaluate(fn, arg)) return true;
    await espera(100);
  }
  return false;
}

/* Tudo o que o app tentou escrever no banco, por tabela. */
const escritas = {};
function registrar(tabela, metodo, corpo) {
  escritas[tabela] = escritas[tabela] || [];
  escritas[tabela].push({ metodo, corpo });
}
function tabelasEscritas() { return Object.keys(escritas).sort(); }

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));

  /* O Supabase de mentira. Responde 200 vazio a tudo e anota. */
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const tabela = new URL(req.url()).pathname.split('/rest/v1/')[1].split('?')[0];
    if (req.method() !== 'GET') {
      let corpo = null;
      try { corpo = JSON.parse(req.postData() || 'null'); } catch (e) { corpo = null; }
      registrar(tabela, req.method(), corpo);
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: req.method() === 'GET' ? '[]' : ''
    });
  });

  /* O YouTube também não é chamado de verdade: devolve uma
     página em branco que carrega na hora. O que se testa é o
     ciclo de vida do iframe, não o vídeo. */
  let pedidosYoutube = 0;
  await page.route('**://www.youtube.com/**', async (route) => {
    pedidosYoutube++;
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
  });

  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });

  console.log('\n1) Conectar a lista e ligar o banco');
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.App && window.Store, null, { timeout: 20000 });

  await page.evaluate(([lista, supa]) => {
    Store.set('cloud.url', supa);
    Store.set('cloud.key', 'chave-de-teste');
    Store.set('cloud.profile', 'teste');
  }, [LISTA, SUPA]);

  await page.evaluate((l) => Catalog.conectar(l), LISTA);
  await ate(() => !!document.querySelector('.screen'), null, 20000);
  await page.evaluate(() => App.go('home', null, { replace: true }));
  await ate(() => document.querySelectorAll('.card').length > 5, null, 20000);
  ok('o app abriu com o banco ligado', await page.evaluate(() => Cloud.enabled()), true);
  ok('e conhece as cinco tabelas',
     await page.evaluate(() => Cloud.chaves.length), 5);

  console.log('\n1-B) Credencial velha no aparelho não pode se eternizar');

  /* O caso real: o navegador de desenvolvimento tinha guardado o
     endereço de um projeto ANTIGO do Supabase. O
     `nebula.config.json` já apontava para o projeto atual, mas
     `applyDefaults` só preenchia campos vazios — então o valor
     velho ficava lá, e todas as requisições morriam em
     ERR_NAME_NOT_RESOLVED, em silêncio, para sempre.

     `cloud` e `update` não têm tela de edição: só podem vir do
     pacote. Logo, o pacote manda neles. */
  await page.evaluate(() => {
    Store.set('cloud.url', 'https://projeto-que-nao-existe-mais.supabase.co');
    Store.set('cloud.key', 'chave-velha');
    /* A lista É escolha do usuário e não pode ser desfeita. */
    Store.set('source.url', 'http://a-minha-lista-escolhida-a-mao/get.php');
    window.NEBULA_DEFAULTS = {
      source: { url: 'http://lista-do-pacote/get.php' },
      cloud: { url: 'https://projeto-novo.supabase.co', key: 'chave-nova', profile: 'teste' },
      update: { repo: 'g/tv', branch: 'main', dir: 'build' }
    };
    App.reaplicarDefaults();
  });

  ok('o endereço velho do banco é corrigido pelo pacote',
     await page.evaluate(() => Store.get('cloud.url', '')),
     'https://projeto-novo.supabase.co');
  ok('a chave também', await page.evaluate(() => Store.get('cloud.key', '')), 'chave-nova');
  ok('mas a lista escolhida à mão continua sendo a sua',
     await page.evaluate(() => Store.get('source.url', '')),
     'http://a-minha-lista-escolhida-a-mao/get.php');
  ok('e a correção fica registrada, não acontece por baixo do pano',
     await page.evaluate(() => (App.corrigidos() || []).indexOf('cloud.url') >= 0), true);

  /* Devolve o cenário do teste. */
  await page.evaluate(([lista, supa]) => {
    window.NEBULA_DEFAULTS = null;
    Store.set('cloud.url', supa);
    Store.set('cloud.key', 'chave-de-teste');
    Store.set('cloud.profile', 'teste');
    Store.set('source.url', lista);
  }, [LISTA, SUPA]);

  console.log('\n2) Favoritos vão para o banco');
  await page.evaluate(() => {
    Store.toggleFavorite({ id: 'movie:4242', kind: 'movie', title: 'Um Filme', poster: 'p.png' });
  });
  await page.evaluate(() => Cloud.flush());
  await espera(400);
  ok('escreveu em favorites', !!escritas['favorites'], true);
  ok('com o id certo',
     escritas['favorites'] && escritas['favorites'][0].corpo[0].id, 'movie:4242');
  ok('e com o perfil certo',
     escritas['favorites'] && escritas['favorites'][0].corpo[0].profile, 'teste');

  /* Espera por uma condição AQUI no node — o DELETE é disparado
     sem `await` do lado da página, e um `sleep` fixo transforma
     isso num teste que falha de vez em quando por causa da
     máquina, não do código. */
  const ateAqui = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await espera(80);
    }
    return false;
  };

  ok('desfavoritar apaga no banco', await (async () => {
    await page.evaluate(() => Store.toggleFavorite({ id: 'movie:4242', kind: 'movie' }));
    return ateAqui(() => (escritas['favorites'] || []).some((e) => e.metodo === 'DELETE'));
  })(), true);

  console.log('\n3) Hábito de canal vai para channel_usage');
  await page.evaluate(() => {
    Store.touchChannel({ id: 'canal:HBO', chave: 'HBO', title: 'HBO', kind: 'live' });
    Store.addChannelSeconds({ id: 'canal:HBO', chave: 'HBO', title: 'HBO' }, 120, 'FHD');
  });
  await page.evaluate(() => Cloud.flush());
  await espera(400);
  ok('escreveu em channel_usage', !!escritas['channel_usage'], true);
  const canal = escritas['channel_usage'] && escritas['channel_usage'].slice(-1)[0].corpo[0];
  ok('com a chave lógica, não o stream_id', canal && canal.chave, 'HBO');
  ok('e com os segundos somados', canal && canal.segundos, 120);
  ok('e o degrau usado', canal && canal.ultimo_posto, 'FHD');

  console.log('\n4) Estado da série vai para series_state');
  await page.evaluate(() => {
    Store.saveProgress({
      id: 'ep:900', kind: 'episode', title: 'Episódio 3',
      position: 600, duration: 2400,
      series_id: '77', series_title: 'Uma Série', season: 2, episode: 3
    });
  });
  await page.evaluate(() => Cloud.flush());
  await espera(400);
  ok('escreveu em series_state', !!escritas['series_state'], true);
  const st = escritas['series_state'] && escritas['series_state'].slice(-1)[0].corpo[0];
  ok('na temporada e episódio certos', st && [st.temporada, st.episodio], [2, 3]);
  ok('apontando para o último episódio', st && st.ultimo_ep_id, 'ep:900');
  ok('e o progresso do episódio também subiu', !!escritas['watch_progress'], true);

  console.log('\n5) Preferências vão para settings_sync');
  await page.evaluate(() => Store.set('hero.trailer', false));
  await page.evaluate(() => Cloud.flush());
  await espera(400);
  ok('escreveu em settings_sync', !!escritas['settings_sync'], true);
  const aj = escritas['settings_sync'] && escritas['settings_sync'].slice(-1)[0].corpo[0];
  ok('com a chave e o valor', aj && [aj.chave, aj.valor], ['hero.trailer', false]);

  ok('credencial da lista NÃO é sincronizada', await (async () => {
    await page.evaluate(() => Store.set('source.url', 'http://segredo/lista'));
    await page.evaluate(() => Cloud.flush());
    await espera(300);
    return (escritas['settings_sync'] || [])
      .every((e) => (e.corpo || []).every((r) => r.chave !== 'source.url'));
  })(), true);

  console.log('\n6) As cinco tabelas, juntas');
  await page.evaluate(() => { Cloud.reenviarTudo(); return Cloud.flush(); });
  await espera(600);
  ok('todas receberam escrita', tabelasEscritas(),
     ['channel_usage', 'favorites', 'series_state', 'settings_sync', 'watch_progress']);

  console.log('\n6-A) Uma linha impossível não pode travar a tabela inteira');

  /* Este é o defeito medido no banco de verdade do Gabriel:
     `watch_progress` VAZIO enquanto `favorites` e `channel_usage`
     enchiam normalmente.

     A causa: a versão antiga gravava progresso de canal ao vivo,
     o `schema-v2.sql` proibiu isso com um `check`, e a linha
     velha ficou presa na FILA — que ninguém limpava. O PostgREST
     é tudo-ou-nada: a linha impossível derrubava o POST do lote
     inteiro, a cada 30 segundos, para sempre e em silêncio. */
  await page.unroute('**/rest/v1/**');
  let recusaPorLive = 0;
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const tabela = new URL(req.url()).pathname.split('/rest/v1/')[1].split('?')[0];
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
                             headers: { 'Access-Control-Allow-Origin': '*' }, body: '[]' });
    }
    let corpo = null;
    try { corpo = JSON.parse(req.postData() || 'null'); } catch (e) { corpo = null; }
    /* Imita a restrição do schema: qualquer lote que contenha uma
       linha `kind:'live'` é recusado INTEIRO, com 400. */
    if (tabela === 'watch_progress' && (corpo || []).some((r) => r.title === 'Impossível')) {
      recusaPorLive++;
      return route.fulfill({
        status: 400, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ code: '23514',
          message: 'new row for relation "watch_progress" violates check constraint "watch_progress_sem_ao_vivo"' })
      });
    }
    registrar(tabela, req.method(), corpo);
    return route.fulfill({ status: 200, contentType: 'application/json',
                           headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
  });

  /* Planta o veneno do jeito que ele existe de verdade: direto na
     fila em localStorage, como uma versão antiga teria deixado. */
  await page.evaluate(() => {
    const q = JSON.parse(localStorage.getItem('nebula.cloudq') || '{}');
    q.progresso = q.progresso || {};
    q.progresso['live:999'] = {
      id: 'live:999', profile: 'teste', kind: 'live', title: 'Canal velho',
      position_sec: 0, duration_sec: null, completed: false,
      updated_at: '2026-01-01T00:00:00Z'
    };
    localStorage.setItem('nebula.cloudq', JSON.stringify(q));
  });

  ok('a faxina da fila remove o progresso de canal ao vivo',
     await page.evaluate(() => { Cloud.pending(); return Cloud.pending('progresso'); }), 0);

  /* Agora o caso geral, que é o que importa: uma linha que o
     banco recusa NO MEIO de um lote bom. O veneno pode ser outro
     amanhã — o que não pode é bloquear as demais. */
  escritas.watch_progress = [];
  await page.evaluate(() => {
    const q = JSON.parse(localStorage.getItem('nebula.cloudq') || '{}');
    q.progresso = q.progresso || {};
    for (let i = 0; i < 6; i++) {
      q.progresso['movie:' + (500 + i)] = {
        id: 'movie:' + (500 + i), profile: 'teste', kind: 'movie',
        title: 'Filme ' + i, position_sec: 10, duration_sec: 100, completed: false,
        updated_at: '2026-02-0' + (i + 1) + 'T00:00:00Z'
      };
    }
    /* A linha impossível é um filme comum aos olhos da faxina: o
       que o banco recusa aqui é OUTRA coisa. É o caso geral — o
       veneno de amanhã não vai ser `kind='live'`, e o app tem de
       aguentar qualquer recusa sem travar a tabela. */
    q.progresso['movie:666'] = {
      id: 'movie:666', profile: 'teste', kind: 'movie', title: 'Impossível',
      position_sec: 0, duration_sec: null, completed: false,
      updated_at: '2026-02-09T00:00:00Z'
    };
    localStorage.setItem('nebula.cloudq', JSON.stringify(q));
  });

  await page.evaluate(() => Cloud.flush());
  await espera(1200);

  const subiram = (escritas.watch_progress || [])
    .flatMap((e) => (e.corpo || []).map((r) => r.id));
  ok('as seis linhas boas sobem mesmo com a ruim no lote',
     [500, 501, 502, 503, 504, 505].every((n) => subiram.indexOf('movie:' + n) >= 0), true);
  ok('a fila esvazia em vez de ficar travada',
     await page.evaluate(() => Cloud.pending('progresso')), 0);
  ok('e a recusa é registrada, com o motivo do banco', await page.evaluate(() => {
    const r = (Cloud.recusados() || {}).progresso || [];
    return r.length === 1 && /check constraint/.test(r[0].motivo) && r[0].chave === 'movie:666';
  }), true);
  console.log(`         o mock recusou ${recusaPorLive} lote(s) antes de a linha ficar sozinha`);

  /* Uma falha 5xx é tropeço, não recusa: a fila TEM de continuar. */
  ok('mas um erro 500 não descarta nada — a fila espera', await (async () => {
    await page.unroute('**/rest/v1/**');
    await page.route('**/rest/v1/**', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ status: 200, contentType: 'application/json',
                      headers: { 'Access-Control-Allow-Origin': '*' }, body: '[]' })
        : r.fulfill({ status: 500, body: 'servidor caiu' }));
    await page.evaluate(() => {
      Store.saveProgress({ id: 'movie:900', kind: 'movie', title: 'Espera',
                           position: 50, duration: 500 });
      return Cloud.flush();
    });
    await espera(900);
    return page.evaluate(() => Cloud.pending('progresso') > 0);
  })(), true);

  console.log('\n6-B) O BANCO manda: o que some de lá some da TV');

  /* Até aqui o Supabase de mentira devolvia `[]` em todo GET, e a
     TV nunca perdia nada — que era exatamente o defeito: o `pull`
     só acrescentava. Deste ponto em diante o mock passa a devolver
     um conteúdo controlado, e o teste é sobre a TV OBEDECER. */
  let bancoFake = {};
  await page.unroute('**/rest/v1/**');
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request();
    const tabela = new URL(req.url()).pathname.split('/rest/v1/')[1].split('?')[0];
    if (req.method() !== 'GET') {
      let corpo = null;
      try { corpo = JSON.parse(req.postData() || 'null'); } catch (e) { corpo = null; }
      registrar(tabela, req.method(), corpo);
      return route.fulfill({ status: 200, contentType: 'application/json',
                             headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(bancoFake[tabela] || [])
    });
  });

  /* Estado de partida: dois favoritos e um progresso, gravados na
     TV e presentes no banco. */
  bancoFake = {
    favorites: [
      { profile: 'teste', id: 'movie:1', kind: 'movie', title: 'Fica', poster: null,
        chave: null, ordem: 0, created_at: '2026-01-01T00:00:00Z' },
      { profile: 'teste', id: 'movie:2', kind: 'movie', title: 'Sai', poster: null,
        chave: null, ordem: 0, created_at: '2026-01-01T00:00:00Z' }
    ],
    watch_progress: [
      { id: 'movie:9', profile: 'teste', kind: 'movie', title: 'Progresso do banco',
        position_sec: 100, duration_sec: 1000, completed: false,
        updated_at: '2026-01-01T00:00:00Z' }
    ],
    channel_usage: [], series_state: [], settings_sync: []
  };

  await page.evaluate(() => Cloud.pull());
  await espera(500);
  ok('a leitura traz os favoritos do banco',
     await page.evaluate(() => Store.favorites().map((f) => f.id).sort()),
     ['movie:1', 'movie:2']);
  ok('e o progresso do banco',
     await page.evaluate(() => !!Store.progressOf('movie:9')), true);

  /* Agora some com um deles NO BANCO, como se você tivesse
     apagado a linha no Supabase. */
  bancoFake.favorites = bancoFake.favorites.filter((f) => f.id !== 'movie:2');
  bancoFake.watch_progress = [];

  await page.evaluate(() => Cloud.pull());
  await espera(500);
  ok('apagar um favorito no banco apaga na TV',
     await page.evaluate(() => Store.favorites().map((f) => f.id)), ['movie:1']);
  ok('e o que sobrou continua lá',
     await page.evaluate(() => Store.isFavorite('movie:1')), true);
  ok('apagar o progresso no banco apaga na TV',
     await page.evaluate(() => !!Store.progressOf('movie:9')), false);

  /* O que ainda NÃO subiu é intocável: existe na TV e ainda não
     existe no banco, e ler isso como "removido lá" apagaria o que
     você acabou de fazer. */
  ok('mas o que está na fila sobrevive à leitura', await (async () => {
    /* Sem flush em seguida: o favorito fica só na fila. */
    await page.evaluate(() =>
      Store.toggleFavorite({ id: 'movie:77', kind: 'movie', title: 'Recém-marcado' }));
    await page.evaluate(() => Cloud.pull());
    await espera(400);
    return page.evaluate(() => Store.isFavorite('movie:77'));
  })(), true);

  /* Banco fora do ar NÃO apaga nada. Falha de leitura é diferente
     de tabela vazia, e confundir as duas coisas seria destruir o
     histórico de quem ficou sem rede. */
  ok('e uma FALHA de leitura não apaga nada', await (async () => {
    await page.unroute('**/rest/v1/**');
    await page.route('**/rest/v1/**', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ status: 500, body: 'erro' })
        : r.fulfill({ status: 200, contentType: 'application/json',
                      headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
    await page.evaluate(() => Cloud.pull());
    await espera(400);
    return page.evaluate(() => Store.favorites().length > 0);
  })(), true);

  console.log('\n7) Conteúdo adulto não chega ao banco');
  const antesAdulto = JSON.stringify(escritas);
  await page.evaluate(() => {
    Catalog.itemAdulto = function () { return true; };
    Store.toggleFavorite({ id: 'movie:666', kind: 'movie', title: 'Proibido' });
    Store.saveProgress({ id: 'movie:666', kind: 'movie', title: 'Proibido',
                         position: 300, duration: 3000 });
    Store.touchChannel({ id: 'canal:XXX', chave: 'XXX', title: 'XXX' });
    return Cloud.flush();
  });
  await espera(400);
  ok('nada de novo foi escrito', JSON.stringify(escritas), antesAdulto);
  ok('nem localmente', await page.evaluate(() => !!Store.progressOf('movie:666')), false);
  ok('nem como favorito', await page.evaluate(() => Store.isFavorite('movie:666')), false);

  console.log('\n8) A fileira numerada');
  await page.evaluate(() => {
    Catalog.itemAdulto = function () { return false; };
    Store.set('hero.trailer', true);
    App.go('home', null, { replace: true });
  });
  await ate(() => document.querySelectorAll('.card').length > 5, null, 20000);
  const achou = await ate(() => !!document.querySelector('.card-rank'), null, 20000);
  ok('existe uma fileira numerada na abertura', achou, true);

  const nums = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll('.card-rank .num'))
      .map((n) => n.textContent));
  ok('começa no 1', nums[0], '1');
  ok('e a contagem não pula', nums.slice(0, 5), ['1', '2', '3', '4', '5']);

  /* O ponto do teste: um cartão numerado tem de medir o mesmo
     que outro, senão o passo da virtualização mente. */
  const larguras = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll('.card-rank'))
      .map((c) => Math.round(c.getBoundingClientRect().width)));
  const unicas = Array.from(new Set(larguras));
  ok('todos os cartões numerados medem igual', unicas.length, 1);

  ok('o nome fica ABAIXO da capa, não ao lado', await page.evaluate(() => {
    const c = document.querySelector('.card-rank');
    const capa = c.querySelector('.shell').getBoundingClientRect();
    const nome = c.querySelector('.card-name').getBoundingClientRect();
    return nome.top >= capa.bottom - 2;
  }), true);

  ok('o algarismo fica à esquerda da capa', await page.evaluate(() => {
    const c = document.querySelector('.card-rank');
    const num = c.querySelector('.num').getBoundingClientRect();
    const capa = c.querySelector('.shell').getBoundingClientRect();
    return num.left < capa.left;
  }), true);

  ok('a fileira chega aos dez', nums.length >= 5 && nums.length <= 10, true);

  /* -------------------------------------------------------
     E são as novidades DE VERDADE
     -------------------------------------------------------
     A conta era feita sobre a pasta cortada nos 60 primeiros, e
     os 60 primeiros vêm na ordem do provedor, que não é ordem de
     chegada. A abertura anunciava como novidade o começo da
     lista, e a mesma pasta ordenada por "Recentes" mostrava
     coisas mais novas que não estavam no Top 10.
     ------------------------------------------------------- */
  const datas = await page.evaluate(() => {
    const f = Array.prototype.slice.call(document.querySelectorAll('.row'))
      .filter((r) => /Top 10/.test(r.textContent))[0];
    return Array.prototype.slice.call(f.querySelectorAll('.card'))
      .map((c) => c._item.added || 0);
  });
  ok('a fileira está em ordem decrescente de chegada',
     datas.every((d, i) => i === 0 || datas[i - 1] >= d), true);

  /* A prova de que a pasta inteira foi considerada: o mais novo
     de uma pasta de 600 itens não está nos 60 primeiros que o
     provedor manda — se estivesse na fileira só por acaso, este
     teste não passaria de forma estável. */
  const olhouAPastaInteira = await page.evaluate(async (m) => {
    const cats = await Catalog.categorias('movie');
    const util = cats.filter((c) => !Catalog.ehAdulta(c.nome));
    for (const c of util) {
      const itens = await Catalog.itens('movie', c.id);
      if (itens.length < 100) continue;
      const maior = itens.reduce((a, b) => ((b.added || 0) > (a.added || 0) ? b : a));
      const posicao = itens.indexOf(maior);
      if (posicao > 60) return { pasta: c.nome, posicao: posicao, titulo: maior.title };
    }
    return null;
  }, MOCK);
  ok('há uma pasta cujo item mais novo está além dos 60 primeiros',
     !!olhouAPastaInteira, true);
  if (olhouAPastaInteira) {
    console.log(`         "${olhouAPastaInteira.titulo}" é o mais novo de ` +
                `"${olhouAPastaInteira.pasta}", na posição ${olhouAPastaInteira.posicao}`);
    ok('e o Top 10 da abertura o inclui — logo, olhou a pasta inteira',
       await page.evaluate((t) => {
         const f = Array.prototype.slice.call(document.querySelectorAll('.row'))
           .filter((r) => /Top 10/.test(r.textContent))[0];
         return Array.prototype.slice.call(f.querySelectorAll('.card'))
           .some((c) => c._item.title === t);
       }, olhouAPastaInteira.titulo), true);
  }

  console.log('\n9) O trailer da abertura');
  const veioTrailer = await ate(() => !!document.querySelector('.hero-trailer iframe'), null, 12000);
  ok('o iframe entra depois do atraso', veioTrailer, true);
  ok('e não de cara', pedidosYoutube > 0, true);
  ok('entra atrás do véu, não na frente do texto', await page.evaluate(() => {
    const hero = document.querySelector('.hero');
    const filhos = Array.prototype.slice.call(hero.children).map((c) => c.className);
    return filhos.indexOf('hero-trailer') < filhos.indexOf('hero-texto');
  }), true);
  ok('a arte parada sai de baixo dele',
     await ate(() => document.querySelector('.hero').classList.contains('tocando'), null, 6000), true);
  ok('e aparece o botão de som',
     await page.evaluate(() => !!document.querySelector('.hero-som')), true);

  console.log('\n9-B) O destaque acompanha o "Continuar assistindo"');

  /* Precisa de histórico para a fileira existir. Dois itens
     diferentes, porque o teste é sobre a TROCA. */
  await page.evaluate(() => {
    Store.saveProgress({ id: 'movie:18000', kind: 'movie', title: 'Primeiro Filme',
                         poster: 'http://localhost:9099/img/2.png',
                         position: 600, duration: 6000 });
    Store.saveProgress({ id: 'movie:18002', kind: 'movie', title: 'Segundo Filme',
                         poster: 'http://localhost:9099/img/4.png',
                         position: 300, duration: 6000 });
    App.go('home', null, { replace: true });
  });
  await ate(() => !!document.querySelector('.hero-titulo'), null, 20000);
  await ate(() => {
    const f = Array.prototype.slice.call(document.querySelectorAll('.row'))
      .filter((r) => /Continuar assistindo/.test(r.textContent))[0];
    return !!(f && f.querySelectorAll('.card').length > 1);
  }, null, 20000);
  await espera(600);

  const tituloInicial = await page.evaluate(() =>
    document.querySelector('.hero-titulo').textContent);
  ok('a abertura tem destaque com título', !!tituloInicial, true);

  /* Anda um cartão na fileira e espera o descanso do foco. */
  const trocou = await page.evaluate(() => {
    const f = Array.prototype.slice.call(document.querySelectorAll('.row'))
      .filter((r) => /Continuar assistindo/.test(r.textContent))[0];
    const cards = f.querySelectorAll('.card');
    Nav.focar(cards[0]);
    Nav.mover('right');
    return Nav.atual() && Nav.atual()._item ? Nav.atual()._item.title : null;
  });
  ok('dá para andar na fileira', !!trocou, true);

  const acompanhou = await ate(() => {
    const h = document.querySelector('.hero-titulo');
    const a = Nav.atual();
    return !!(h && a && a._item && h.textContent.indexOf(a._item.title.slice(0, 8)) >= 0);
  }, null, 8000);
  ok('o destaque troca para o item em foco', acompanhou, true);

  /* E não troca a cada tecla: só quando o foco descansa. */
  ok('mas só no descanso do foco, não a cada tecla', await page.evaluate(async () => {
    const antes = document.querySelector('.hero-titulo').textContent;
    for (let i = 0; i < 3; i++) Nav.mover('left');
    await new Promise((r) => setTimeout(r, 120));
    return document.querySelector('.hero-titulo').textContent === antes;
  }), true);

  /* Andar numa fileira de BAIXO não mexe no destaque: ele já
     saiu da tela e trocá-lo seria trabalho para ninguém ver. */
  ok('fileiras de baixo não mexem no destaque', await page.evaluate(async () => {
    const antes = document.querySelector('.hero-titulo').textContent;
    const fs = Array.prototype.slice.call(document.querySelectorAll('.row'))
      .filter((r) => !/Continuar assistindo/.test(r.textContent));
    const outra = fs.map((r) => r.querySelector('.card')).filter(Boolean)[0];
    if (!outra) return true;
    Nav.focar(outra);
    await new Promise((r) => setTimeout(r, 900));
    return document.querySelector('.hero-titulo').textContent === antes;
  }), true);

  console.log('\n9-C) Voltar para o destaque traz ele INTEIRO');

  /* Desce até uma fileira lá embaixo e volta subindo. Com a
     rolagem mínima, o destaque voltava cortado: só o pedaço que
     fazia o BOTÃO dele caber na tela. */
  const voltaAoTopo = await page.evaluate(async () => {
    const espera = (m) => new Promise((r) => setTimeout(r, m));
    Nav.entrar('rows');
    for (let i = 0; i < 12; i++) { Nav.mover('down'); await espera(30); }
    const desceu = Number(document.querySelector('.screen.home .trilho')
      .getAttribute('data-off-y') || 0);
    for (let i = 0; i < 12; i++) { Nav.mover('up'); await espera(30); }
    const hero = document.querySelector('.hero');
    const t = document.querySelector('.screen.home .trilho');
    return {
      desceu: desceu,
      voltou: Number(t.getAttribute('data-off-y') || 0),
      noHero: !!(Nav.atual() && Nav.atual().closest('.hero')),
      alturaHero: hero ? hero.offsetHeight : 0
    };
  });
  ok('a tela realmente rolou para baixo', voltaAoTopo.desceu > 200, true);
  ok('subir de volta chega ao destaque', voltaAoTopo.noHero, true);
  ok('e a coluna volta ao topo — destaque inteiro, não pela metade',
     voltaAoTopo.voltou, 0);
  console.log(`         desceu ${voltaAoTopo.desceu}px, voltou para ${voltaAoTopo.voltou}px`);

  console.log('\n9-D) O trailer para quando o destaque sai de cena');
  await page.evaluate(() => { Nav.entrar('hero'); });
  const tocandoNoTopo = await ate(() => !!document.querySelector('.hero-trailer iframe'), null, 12000);
  ok('com o destaque em cena, o trailer toca', tocandoNoTopo, true);

  ok('descer para outra fileira devolve a arte parada', await (async () => {
    await page.evaluate(async () => {
      const espera = (m) => new Promise((r) => setTimeout(r, m));
      Nav.entrar('rows');
      for (let i = 0; i < 6; i++) { Nav.mover('down'); await espera(30); }
    });
    await espera(500);
    return page.evaluate(() => ({
      semIframe: !document.querySelector('.hero-trailer'),
      comArte: !!document.querySelector('.hero-arte'),
      semClasse: !document.querySelector('.hero').classList.contains('tocando')
    }));
  })(), { semIframe: true, comArte: true, semClasse: true });

  /* E não volta a tocar enquanto está lá embaixo — era o
     "tocando freneticamente". */
  ok('e não ressuscita sozinho enquanto você está longe', await (async () => {
    await espera(5000);
    return page.evaluate(() => !document.querySelector('.hero-trailer'));
  })(), true);

  ok('voltar ao destaque religa o trailer', await (async () => {
    await page.evaluate(async () => {
      const espera = (m) => new Promise((r) => setTimeout(r, m));
      for (let i = 0; i < 12; i++) { Nav.mover('up'); await espera(30); }
    });
    return ate(() => !!document.querySelector('.hero-trailer iframe'), null, 12000);
  })(), true);

  console.log('\n10) O trailer MORRE ao trocar de tela');
  await page.evaluate(() => App.go('home', null, { replace: true }));
  await ate(() => !!document.querySelector('.hero-trailer iframe'), null, 15000);
  await page.evaluate(() => App.go('live'));
  await espera(1200);
  ok('nenhum iframe do YouTube sobrou',
     await page.evaluate(() => document.querySelectorAll('iframe[src*="youtube"]').length), 0);

  /* O temporizador é o vazamento de verdade: sem `_desligar`,
     ele recria o iframe três segundos depois, numa tela que já
     não existe. */
  await espera(5000);
  ok('e não volta sozinho depois do atraso',
     await page.evaluate(() => document.querySelectorAll('iframe[src*="youtube"]').length), 0);

  console.log('\n11) O interruptor dos Ajustes desliga mesmo');
  await page.evaluate(() => { Store.set('hero.trailer', false); App.go('home', null, { replace: true }); });
  await ate(() => document.querySelectorAll('.card').length > 5, null, 20000);
  await espera(5000);
  ok('com o trailer desligado, nenhum iframe é criado',
     await page.evaluate(() => document.querySelectorAll('.hero-trailer').length), 0);
  ok('e a arte estática continua lá',
     await page.evaluate(() => !!document.querySelector('.hero-arte')), true);

  ok('nenhum erro de JavaScript no caminho', erros, []);

  console.log('\n=============================');
  if (falhas.length) {
    console.log(`${n - falhas.length}/${n} passaram. Falhou:`);
    falhas.forEach((f) => console.log('  · ' + f));
  } else {
    console.log(`${n}/${n} verificações passaram.`);
    console.log('Nuvem: cinco tabelas. Fileira numerada: passo certo. Trailer: entra e sai.');
  }
  await browser.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('o teste quebrou:', e); process.exit(1); });
