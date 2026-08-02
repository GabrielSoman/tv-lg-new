/* =========================================================
   Roteador e inicialização.
   ========================================================= */
(function (w) {
  'use strict';

  var stack = [];          // histórico de telas
  var currentRoute = null;

  var ROUTES = {
    home:            { view: function (p) { return w.Views.home(p); },        rail: 'home' },
    live:            { view: function (p) { return w.Views.live(p); },        rail: 'live' },
    movies:          { view: function (p) { return w.Views.movies(p); },      rail: 'movies' },
    series:          { view: function (p) { return w.Views.series(p); },      rail: 'series' },
    search:          { view: function (p) { return w.Views.search(p); },      rail: 'search' },
    settings:        { view: function (p) { return w.Views.settings(p); },    rail: 'settings' },
    setup:           { view: function (p) { return w.Views.setup(p); },       rail: null },
    'movie-detail':  { view: function (p) { return w.Views.movieDetail(p); }, rail: null },
    'series-detail': { view: function (p) { return w.Views.seriesDetail(p); },rail: null }
  };

  function paintRail(railKey) {
    w.$$('.rail-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-route') === railKey);
    });
  }

  function render(route, params) {
    var r = ROUTES[route];
    if (!r) return;
    currentRoute = route;
    w.Views.stopBillboard();
    paintRail(r.rail);
    try {
      var out = r.view(params || {});
      if (out && out.catch) out.catch(function (e) { console.error(e); });
    } catch (e) {
      console.error('Falha ao montar a tela ' + route, e);
      w.toast('Algo quebrou ao abrir esta tela.');
    }
  }

  w.App = {

    go: function (route, params, opts) {
      opts = opts || {};
      if (w.Player.isOpen()) w.Player.close();
      if (!opts.replace && currentRoute) {
        stack.push({ route: currentRoute, params: w.App.lastParams });
        if (stack.length > 12) stack.shift();
      }
      w.App.lastParams = params;
      render(route, params);
    },

    back: function () {
      var prev = stack.pop();
      if (prev) {
        w.App.lastParams = prev.params;
        render(prev.route, prev.params);
        return true;
      }
      return false;
    },

    reload: function () { render(currentRoute, w.App.lastParams); },

    current: function () { return currentRoute; },

    lastParams: null
  };

  /* ---------------------------------------------------------
     Barra lateral: abre quando o foco entra nela.
     --------------------------------------------------------- */
  function wireRail() {
    w.$$('.rail-item').forEach(function (b) {
      b.onclick = function () {
        var route = b.getAttribute('data-route');
        if (route === currentRoute) return;
        w.App.go(route, null, { replace: currentRoute === 'home' && route === 'home' });
      };
    });
  }

  /* ---------------------------------------------------------
     Reações ao foco
     ---------------------------------------------------------
     Três coisas, nesta ordem, e a ordem importa:

       1. a virtualização remonta a janela de cartões. Precisa
          vir primeiro, porque as outras duas podem consultar o
          DOM que ela acabou de mexer;
       2. o menu lateral mostra os rótulos quando o foco entra
          nele (só opacidade — a largura nunca muda);
       3. a coluna de categorias carrega a pasta quando o foco
          DESCANSA, não a cada tecla.

     O fundo ambiente saiu daqui. Era o culpado número 1 da
     queda de quadros: uma imagem grande trocando a cada
     movimento de foco.
     --------------------------------------------------------- */
  w.Nav.aoFocar = function (el) {
    w.Virt.aoFocar(el);

    var noMenu = !!(el.closest && el.closest('#rail'));
    var rail = w.$('#rail');
    if (rail) rail.classList.toggle('open', noMenu);

    w.Views.aoFocarCategoria(el);
  };

  /* ---------------------------------------------------------
     Tecla Voltar
     --------------------------------------------------------- */
  w.Nav.addKeyHandler(function (k) {
    if (k !== w.KEY.BACK && k !== w.KEY.BACKSPACE && k !== w.KEY.ESC) return false;

    if (w.Player.isOpen()) { w.Player.close(); return true; }

    if (!w.$('#confirm-layer').classList.contains('hidden')) {
      var no = w.$('#confirm-no'); if (no) no.click();
      return true;
    }
    if (!w.$('#resume-layer').classList.contains('hidden')) return true;

    /* Dentro de uma tela, se o foco não está na barra lateral, o
       primeiro Voltar leva o foco para o menu — igual aos apps da TV. */
    var cur = w.Nav.current();
    if (cur && cur.closest && !cur.closest('#rail') && currentRoute !== 'home') {
      if (w.App.back()) return true;
    }
    if (cur && cur.closest && !cur.closest('#rail')) {
      w.Nav.focusFirst('.rail-item.active') || w.Nav.focusFirst('.rail-item');
      return true;
    }
    if (currentRoute !== 'home') { w.App.go('home', null, { replace: true }); return true; }

    w.confirmDialog('Sair do ClaudeTV?', 'Você volta para a tela inicial da TV.', 'Sair')
      .then(function (yes) { if (yes) { try { w.close(); } catch (e) {} } });
    return true;
  });

  /* Teclas coloridas: atalhos rápidos.
     A vermelha é a única que a tela pode interceptar: nas telas
     com pasta aberta ela leva ao filtro DAQUELA pasta, que é o
     que a pessoa quer ali. Fora delas, cai na busca global. */
  w.Nav.addKeyHandler(function (k) {
    if (w.Player.isOpen()) return false;
    var tela = w.$('.screen');
    if (tela && tela._tecla && tela._tecla(k)) return true;
    if (k === w.KEY.RED)    { w.App.go('search');   return true; }
    if (k === w.KEY.GREEN)  { w.App.go('live');     return true; }
    if (k === w.KEY.YELLOW) { w.App.go('movies');   return true; }
    if (k === w.KEY.BLUE)   { w.App.go('settings'); return true; }
    return false;
  });

  /* ---------------------------------------------------------
     Configuração embutida no pacote instalado
     --------------------------------------------------------- */
  /* ---------------------------------------------------------
     Configuração embutida no pacote
     ---------------------------------------------------------
     Isto rodava SÓ quando o app estava zerado. Consequência que
     apareceu na TV: quem já tinha a lista configurada nunca
     recebia as credenciais do Supabase, porque elas foram
     preenchidas no `nebula.config.json` depois. O banco ficava
     desligado sem nenhum aviso.

     Agora roda em todo boot, mas em modo COMPLEMENTAR: só grava
     o que ainda está vazio. Nunca sobrescreve uma escolha sua —
     se você trocou a lista pela tela de configuração, o pacote
     não desfaz isso.
     --------------------------------------------------------- */
  function applyDefaults(sobrescrever) {
    var d = w.NEBULA_DEFAULTS;
    if (!d || typeof d !== 'object') return false;

    var gravou = false;
    Object.keys(d).forEach(function (grupo) {
      if (grupo.charAt(0) === '_') return;            /* comentários do arquivo */
      var g = d[grupo];
      if (g === null || typeof g !== 'object') {
        if (sobrescrever || w.Store.get(grupo, '') === '') { w.Store.set(grupo, g); gravou = true; }
        return;
      }
      Object.keys(g).forEach(function (k) {
        var valor = g[k];
        if (valor === '' || valor === null) return;
        var caminho = grupo + '.' + k;
        var atual = w.Store.get(caminho, '');
        if (sobrescrever || atual === '' || atual === undefined) {
          w.Store.set(caminho, valor);
          gravou = true;
        }
      });
    });
    return gravou;
  }

  /* Completa o que faltar, sem mexer no que já existe. */
  function completarDefaults() {
    var antes = w.Cloud.enabled();
    applyDefaults(false);
    if (!antes && w.Cloud.enabled()) {
      w.toast('Banco de dados conectado — histórico volta a sincronizar.', 5000);
      w.Cloud.pull().then(function (n) {
        if (n && w.App.current() === 'home') w.App.reload();
      }).catch(function () {});
    }
  }

  /* Reconecta na lista e traz o histórico de volta, sem pedir nada
     no controle remoto. */
  function restoreFromDefaults() {
    var s = w.$('#stage');
    s.innerHTML =
      '<div class="screen enter"><div class="empty" style="padding-top:12rem">' +
      '<h2>Restaurando sua configuração</h2>' +
      '<div id="restore-msg">Reconectando à sua lista…</div></div></div>';
    var msg = w.$('#restore-msg');

    w.Catalog.conectar(w.Store.get('source.url'), function (m) { msg.textContent = m; })
      .then(function () {
        if (!w.Cloud.enabled()) return 0;
        msg.textContent = 'Trazendo o histórico da nuvem…';
        return w.Cloud.pull();
      })
      .then(function (n) {
        w.toast(n ? 'Tudo de volta — ' + n + ' itens no histórico.' : 'Tudo de volta.', 4000);
        w.App.go('home', null, { replace: true });
      })
      .catch(function (e) {
        msg.innerHTML = 'Não consegui reconectar sozinho: ' + w.esc(e.message) +
                        '<br>Vou abrir a tela de configuração.';
        setTimeout(function () { w.App.go('setup', null, { replace: true }); }, 3500);
      });
  }

  /* ---------------------------------------------------------
     Início
     --------------------------------------------------------- */
  function start() {
    w.buildDOM();
    w.startClock();
    wireRail();

    /* Reinstalou o app e caiu num aparelho zerado? Se o .ipk trouxe
       credenciais embutidas, o app se reconfigura sozinho. */
    if (!w.Store.isConfigured() && applyDefaults(true)) {
      restoreFromDefaults();
      return;
    }

    /* Já configurado: ainda assim completa o que faltar — foi
       assim que o Supabase ficou de fora até agora. */
    completarDefaults();

    if (!w.Store.isConfigured()) {
      w.App.go('setup', null, { replace: true });
    } else {
      w.App.go('home', null, { replace: true });
      /* Traz o histórico da nuvem sem travar a tela. */
      if (w.Cloud.enabled()) {
        w.Cloud.pull().then(function (n) {
          if (n && w.App.current() === 'home') w.App.reload();
        });
        w.Cloud.flush();
      }
    }

    /* A tela já está desenhada: pode tirar o "Iniciando…" da frente. */
    if (w.Updater && w.Updater.ready) w.Updater.ready();

    /* A aprovação da versão vem só depois, quando ficou claro que o app
       realmente subiu. Se algo quebrar antes disso, a casca desfaz a
       atualização no próximo boot. */
    setTimeout(function () {
      if (w.$('.screen') && w.Updater && w.Updater.ok) w.Updater.ok();
    }, 6000);

    /* Procura atualização em segundo plano, sem instalar nada sozinho. */
    if (w.Updater && w.Updater.configured && w.Updater.configured()) {
      setTimeout(function () {
        w.Updater.check().then(function (info) {
          if (!info.isNew) return;

          /* Atualização automática, ligada por padrão.
             -------------------------------------------------
             O ponto do GitHub era não ter que ir até a TV. Se
             ainda é preciso apertar um botão no controle toda
             vez, metade do ganho se perde. Então o app instala
             sozinho e recarrega — a casca já tem a rede de
             segurança: aprova a versão só depois de seis
             segundos de app de pé, e desfaz no próximo boot se
             algo estourar antes disso.

             Quem preferir decidir na mão desliga em Ajustes. */
          if (w.Store.get('update.auto', true) === false) {
            w.toast('Versão ' + info.version + ' disponível — veja em Ajustes.', 5000);
            return;
          }
          w.toast('Atualizando para ' + info.version + '…', 4000);
          w.Updater.install(info)
            .then(function () { setTimeout(function () { w.Updater.reload(); }, 1200); })
            .catch(function (e) {
              w.toast('Não consegui atualizar sozinho: ' + e.message, 6000);
            });
        }).catch(function () {});
      }, 6000);
    }
  }

  /* Grava o progresso se o app for para segundo plano. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && w.Player.isOpen()) w.Cloud.flush();
  });
  w.addEventListener('beforeunload', function () { w.Cloud.flush(); });

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else start();

})(window);
