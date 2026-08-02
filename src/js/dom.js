/* =========================================================
   A CASCA
   =========================================================
   Tudo o que existe antes de qualquer tela: o menu lateral,
   o palco onde as telas entram, o player com seu OSD, e os
   dois diálogos.

   Fica no pacote (e não na casca do .ipk) para que qualquer
   mudança de layout chegue pela atualização do GitHub, sem
   reinstalar o aplicativo na TV.

   O que mudou em relação à versão anterior:

     · o fundo ambiente foi embora (decisão 2 da spec de
       experiência). Era o culpado número 1 da queda de
       quadros: uma imagem grande trocando e desfocando a
       cada movimento de foco;

     · o menu deixou de mudar de largura. Ele é estreito e
       fixo; os rótulos aparecem por opacidade quando o foco
       entra. Animar largura reflui a tela inteira a cada
       vez — animar opacidade não custa nada;

     · toda região de navegação agora se declara. Nada de
       `data-nav-group` improvisado: `data-region`, `data-axis`,
       `data-nb-*` e `data-enter`, que é o contrato que o
       `nav.js` entende;

     · o OSD do player passou a existir de verdade: linha de
       transporte, linha de contexto, painel sobreposto e o
       painel de aferição da §4.2-A.
   ========================================================= */
(function (w) {
  'use strict';

  /* Biblioteca de ícones. Traço fino, para não pesar de longe. */
  var ICON = {
    logo:     '<path d="M8 5.5v13l11-6.5z"/><path d="M3 8.5v7M20.5 8.5v7" opacity=".55"/>',
    home:     '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
    live:     '<rect x="3" y="6" width="18" height="11" rx="1.5"/><path d="M8 20h8"/>',
    movie:    '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M7 5v14M17 5v14M3 12h18"/>',
    series:   '<rect x="4" y="8" width="16" height="11" rx="1.5"/><path d="m8 4 4 4 4-4"/>',
    search:   '<circle cx="11" cy="11" r="6"/><path d="m16 16 4.5 4.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    play:     '<path d="M8 5.5v13l11-6.5z"/>',
    pause:    '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
    restart:  '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>',
    prev:     '<path d="M17 5.5v13l-9-6.5z"/><rect x="5" y="5.5" width="2.4" height="13" rx="1"/>',
    next:     '<path d="M7 5.5v13l9-6.5z"/><rect x="16.6" y="5.5" width="2.4" height="13" rx="1"/>',
    back10:   '<path d="M12 6a6 6 0 1 1-5.7 4.1"/><path d="M6 4v3.4h3.4"/>',
    fwd10:    '<path d="M12 6a6 6 0 1 0 5.7 4.1"/><path d="M18 4v3.4h-3.4"/>',
    star:     '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z"/>',
    list:     '<path d="M4 7h16M4 12h16M4 17h10"/>',
    layers:   '<path d="m12 4 8 4.5-8 4.5-8-4.5z"/><path d="m4 13 8 4.5 8-4.5"/>',
    audio:    '<path d="M5 9v6h3l4.5 3.5v-13L8 9z"/><path d="M16 9.5a4 4 0 0 1 0 5"/>',
    cc:       '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M10 10.5a2.2 2.2 0 1 0 0 3M16.5 10.5a2.2 2.2 0 1 0 0 3"/>',
    refresh:  '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
    check:    '<path d="m5 12.5 4.5 4.5L19 7"/>',
    down:     '<path d="M12 4v13"/><path d="m6.5 11.5 5.5 5.5 5.5-5.5"/><path d="M5 20h14"/>',
    info:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>'
  };

  w.icon = function (name, cls) {
    return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + '>' +
           (ICON[name] || '') + '</svg>';
  };

  var MENU = [
    { route: 'home',   icon: 'home',   label: 'Início'  },
    { route: 'live',   icon: 'live',   label: 'Ao Vivo' },
    { route: 'movies', icon: 'movie',  label: 'Filmes'  },
    { route: 'series', icon: 'series', label: 'Séries'  },
    { route: 'search', icon: 'search', label: 'Buscar'  }
  ];

  /* Um botão do OSD. Fica aqui porque o player e os testes
     precisam da mesma forma. */
  function botaoOSD(id, ic, rotulo) {
    return '<button class="osd-btn" data-focusable id="' + id + '" ' +
           'aria-label="' + rotulo + '" title="' + rotulo + '">' +
           w.icon(ic) + '</button>';
  }

  w.buildDOM = function () {

    var itensMenu = MENU.map(function (m) {
      return '<button class="rail-item" data-focusable data-route="' + m.route + '">' +
             w.icon(m.icon) + '<span class="rail-label">' + m.label + '</span></button>';
    }).join('');

    document.getElementById('root').innerHTML =

      /* ---------- menu lateral ----------
         Largura fixa. `data-enter="last"` faz o menu lembrar em
         qual item você estava; voltar para a tela é o motor que
         resolve, gravando o caminho de volta ao pular de região. */
      '<nav id="rail" data-region="rail" data-axis="y" data-enter="last">' +
        '<div class="rail-logo">' + w.icon('logo', 'solid') + '</div>' +
        '<div class="rail-items">' + itensMenu + '</div>' +
        '<div class="rail-items rail-bottom">' +
          '<button class="rail-item" data-focusable data-route="settings">' +
          w.icon('settings') + '<span class="rail-label">Ajustes</span></button>' +
        '</div>' +
      '</nav>' +

      '<main id="stage"></main>' +
      '<div id="clock"></div>' +

      /* ---------- player ---------- */
      '<div id="player-layer" class="hidden">' +
        '<video id="video" playsinline></video>' +
        '<div id="player-spinner" class="spinner hidden"><i></i></div>' +

        '<div id="player-ui" class="hidden">' +

          /* painel de aferição — spec de experiência §4.2-A */
          '<div class="afer" id="afer">' +
            '<div class="afer-l1">' +
              '<span id="afer-decl">—</span>' +
              '<span class="afer-sep">·</span>' +
              '<span id="afer-real">—</span>' +
            '</div>' +
            '<div class="afer-l2">' +
              '<span id="afer-fonte">—</span>' +
              '<span class="afer-sep">·</span>' +
              '<span id="afer-buf">—</span>' +
              '<span class="afer-sep">·</span>' +
              '<span id="afer-quedas">—</span>' +
            '</div>' +
            '<div class="afer-hora" id="afer-hora">--:--</div>' +
          '</div>' +

          '<div class="pl-top">' +
            '<div class="pl-title" id="pl-title"></div>' +
            '<div class="pl-sub" id="pl-sub"></div>' +
          '</div>' +

          '<div class="pl-bottom">' +
            /* A linha do tempo é FOCÁVEL e é uma região própria.
               Sem isso não havia como arrastar a posição com o
               controle: com o menu aberto, ←/→ pertenciam à linha
               de botões, e a timeline ficava fora de alcance. */
            '<div class="pl-linha" data-region="timeline" data-axis="x" ' +
                 'data-enter="first" data-nb-down="transport">' +
              '<button class="pl-bar" id="pl-bar" data-focusable ' +
                      'aria-label="Linha do tempo">' +
                '<span class="pl-bar-buf" id="pl-buf"></span>' +
                '<span class="pl-bar-fill" id="pl-fill"><i class="pl-knob"></i></span>' +
                '<span class="pl-fantasma hidden" id="pl-fantasma"></span>' +
              '</button>' +
            '</div>' +
            '<div class="pl-times">' +
              '<span id="pl-cur">00:00</span>' +
              '<span id="pl-badge" class="pl-badge hidden">AO VIVO</span>' +
              '<span id="pl-dur">00:00</span>' +
            '</div>' +

            /* linha 1 — transporte */
            '<div class="osd-row" id="osd-transport" data-region="transport" ' +
                 'data-axis="x" data-enter="#osd-play" data-nb-down="context" ' +
                 'data-nb-up="timeline">' +
              botaoOSD('osd-restart', 'restart', 'Reiniciar') +
              botaoOSD('osd-prev', 'prev', 'Anterior') +
              botaoOSD('osd-back10', 'back10', 'Voltar 10 segundos') +
              botaoOSD('osd-play', 'play', 'Reproduzir ou pausar') +
              botaoOSD('osd-fwd10', 'fwd10', 'Avançar 10 segundos') +
              botaoOSD('osd-next', 'next', 'Próximo') +
            '</div>' +

            /* linha 2 — contexto. O conteúdo é montado pelo player:
               em série entram Episódios/Áudio/Legendas; ao vivo
               entram os degraus de qualidade. */
            '<div class="osd-row osd-ctx" id="osd-context" data-region="context" ' +
                 'data-axis="x" data-enter="first" data-nb-up="transport"></div>' +

            '<div class="pl-hint" id="pl-hint"></div>' +
          '</div>' +

          /* painel sobreposto: episódios, faixas, degraus */
          '<div id="osd-panel" class="osd-panel hidden"></div>' +
        '</div>' +

        '<div id="player-error" class="pl-error hidden">' +
          '<h2>Não consegui reproduzir</h2>' +
          '<p id="pl-error-msg"></p>' +
          '<div class="row-btns" data-region="plerr" data-axis="x" data-enter="first">' +
            '<button class="btn" data-focusable id="pl-retry">Tentar de novo</button>' +
            '<button class="btn ghost" data-focusable id="pl-back">Voltar</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ---------- diálogos ---------- */
      '<div id="resume-layer" class="overlay hidden">' +
        '<div class="dialog">' +
          '<h2>Continuar de onde parou?</h2>' +
          '<p id="resume-desc"></p>' +
          '<div class="row-btns" data-region="resume" data-axis="x" data-enter="first">' +
            '<button class="btn primary" data-focusable id="resume-yes">Continuar</button>' +
            '<button class="btn ghost" data-focusable id="resume-no">Começar do início</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="confirm-layer" class="overlay hidden">' +
        '<div class="dialog">' +
          '<h2 id="confirm-title"></h2>' +
          '<p id="confirm-desc"></p>' +
          '<div class="row-btns" data-region="confirm" data-axis="x" data-enter="first">' +
            '<button class="btn primary" data-focusable id="confirm-yes">Confirmar</button>' +
            '<button class="btn ghost" data-focusable id="confirm-no">Cancelar</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="toast" class="toast hidden"></div>';
  };

  /* -----------------------------------------------------------
     Relógio
     -----------------------------------------------------------
     O desenho mostra só hora e minuto, então 20 segundos de
     intervalo garante que a virada nunca atrase mais que isso,
     sem custar nada. O painel do player tem o seu próprio, que
     só roda com o OSD aberto.
     ----------------------------------------------------------- */
  function horaAgora() {
    var d = new Date();
    var hh = d.getHours(), mm = d.getMinutes();
    return (hh < 10 ? '0' + hh : hh) + ':' + (mm < 10 ? '0' + mm : mm);
  }
  w.horaAgora = horaAgora;

  w.startClock = function () {
    function tick() {
      var n = document.getElementById('clock');
      if (!n) return;
      n.innerHTML = horaAgora() + '<small>' +
        new Date().toLocaleDateString('pt-BR',
          { weekday: 'short', day: '2-digit', month: 'short' }) + '</small>';
    }
    tick();
    setInterval(tick, 20000);
  };

  /* -----------------------------------------------------------
     Regiões: ligar e desligar
     -----------------------------------------------------------
     Uma região escondida ainda é uma região declarada, e o motor
     tentaria entrar nela ao seguir um vizinho. Trocar o nome do
     atributo a tira do mapa sem perder a declaração — e devolvê-la
     é só desfazer a troca.
     ----------------------------------------------------------- */
  w.desligarRegiao = function (el) {
    if (el && el.hasAttribute && el.hasAttribute('data-region')) {
      el.setAttribute('data-region-off', el.getAttribute('data-region'));
      el.removeAttribute('data-region');
    }
  };
  w.ligarRegiao = function (el) {
    if (el && el.hasAttribute && el.hasAttribute('data-region-off')) {
      el.setAttribute('data-region', el.getAttribute('data-region-off'));
      el.removeAttribute('data-region-off');
    }
  };

  /* -----------------------------------------------------------
     Diálogo de confirmação
     ----------------------------------------------------------- */
  w.confirmDialog = function (title, desc, okLabel) {
    return new Promise(function (resolve) {
      var layer = w.$('#confirm-layer');
      var anterior = w.Nav.atual();
      w.$('#confirm-title').textContent = title;
      w.$('#confirm-desc').textContent = desc || '';
      w.$('#confirm-yes').textContent = okLabel || 'Confirmar';
      layer.classList.remove('hidden');
      w.Nav.definirEscopo(layer);

      function fim(valor) {
        layer.classList.add('hidden');
        w.$('#confirm-yes').onclick = null;
        w.$('#confirm-no').onclick = null;
        w.Nav.limparEscopo(anterior);
        resolve(valor);
      }
      w.$('#confirm-yes').onclick = function () { fim(true); };
      w.$('#confirm-no').onclick  = function () { fim(false); };
    });
  };

})(window);
