/* =========================================================
   Monta a estrutura fixa da tela dentro de #root.
   Fica no pacote (e não na casca) para que qualquer mudança
   de layout chegue pela atualização do GitHub, sem reinstalar
   o aplicativo na TV.
   ========================================================= */
(function (w) {
  'use strict';

  /* Biblioteca de ícones. Traço fino, para não pesar de longe. */
  var ICON = {
    logo:     '<path d="M8 5.5v13l11-6.5z"/>',
    home:     '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
    live:     '<rect x="3" y="6" width="18" height="11" rx="1.5"/><path d="M8 20h8"/>',
    movie:    '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M7 5v14M17 5v14M3 12h18"/>',
    series:   '<rect x="4" y="8" width="16" height="11" rx="1.5"/><path d="m8 4 4 4 4-4"/>',
    search:   '<circle cx="11" cy="11" r="6"/><path d="m16 16 4.5 4.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    play:     '<path d="M8 5.5v13l11-6.5z"/>',
    star:     '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.6-.8z"/>',
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
    { route: 'home',     icon: 'home',     label: 'Início'  },
    { route: 'live',     icon: 'live',     label: 'Ao Vivo' },
    { route: 'movies',   icon: 'movie',    label: 'Filmes'  },
    { route: 'series',   icon: 'series',   label: 'Séries'  },
    { route: 'search',   icon: 'search',   label: 'Buscar'  }
  ];

  w.buildDOM = function () {
    var railItems = MENU.map(function (m) {
      return '<li><button class="rail-item" data-focusable data-nav-group="rail" ' +
             'data-route="' + m.route + '">' + w.icon(m.icon) +
             '<span>' + m.label + '</span></button></li>';
    }).join('');

    document.getElementById('root').innerHTML =
      '<div id="ambient"></div>' +
      '<div id="ambient-veil"></div>' +

      '<nav id="rail">' +
        '<div class="rail-logo">' + w.icon('logo', 'solid') + '</div>' +
        '<ul class="rail-items" data-nav-axis="y">' + railItems + '</ul>' +
        '<ul class="rail-items rail-bottom" data-nav-axis="y">' +
          '<li><button class="rail-item" data-focusable data-nav-group="rail" ' +
          'data-route="settings">' + w.icon('settings') + '<span>Ajustes</span></button></li>' +
        '</ul>' +
      '</nav>' +

      '<main id="stage"></main>' +
      '<div id="clock"></div>' +

      '<div id="player-layer" class="hidden">' +
        '<video id="video" playsinline></video>' +
        '<div id="player-spinner" class="spinner hidden"><i></i></div>' +
        '<div id="player-ui">' +
          '<div class="pl-top">' +
            '<div class="pl-title" id="pl-title"></div>' +
            '<div class="pl-sub" id="pl-sub"></div>' +
          '</div>' +
          '<div class="pl-bottom">' +
            '<div class="pl-bar">' +
              '<div class="pl-bar-buf" id="pl-buf"></div>' +
              '<div class="pl-bar-fill" id="pl-fill"><span class="pl-knob"></span></div>' +
            '</div>' +
            '<div class="pl-times">' +
              '<span id="pl-cur">00:00</span>' +
              '<span id="pl-badge" class="pl-badge hidden">AO VIVO</span>' +
              '<span id="pl-dur">00:00</span>' +
            '</div>' +
            '<div class="pl-hint">' +
              '<span><b>OK</b> pausar</span>' +
              '<span><b>◀ ▶</b> 10 segundos</span>' +
              '<span><b>▲ ▼</b> 5 minutos</span>' +
              '<span><b>CH +/−</b> próximo</span>' +
              '<span><b>Voltar</b> sair</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="player-error" class="pl-error hidden">' +
          '<h2>Não consegui reproduzir</h2>' +
          '<p id="pl-error-msg"></p>' +
          '<div class="row-btns" data-nav-axis="x">' +
            '<button class="btn" data-focusable id="pl-retry">Tentar de novo</button>' +
            '<button class="btn ghost" data-focusable id="pl-back">Voltar</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="resume-layer" class="overlay hidden">' +
        '<div class="dialog">' +
          '<h2>Continuar de onde parou?</h2>' +
          '<p id="resume-desc"></p>' +
          '<div class="row-btns" data-nav-axis="x">' +
            '<button class="btn primary" data-focusable id="resume-yes">Continuar</button>' +
            '<button class="btn ghost" data-focusable id="resume-no">Começar do início</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="confirm-layer" class="overlay hidden">' +
        '<div class="dialog">' +
          '<h2 id="confirm-title"></h2>' +
          '<p id="confirm-desc"></p>' +
          '<div class="row-btns" data-nav-axis="x">' +
            '<button class="btn primary" data-focusable id="confirm-yes">Confirmar</button>' +
            '<button class="btn ghost" data-focusable id="confirm-no">Cancelar</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="toast" class="toast hidden"></div>';
  };

  /* Relógio discreto, como nos apps nativos da TV. */
  w.startClock = function () {
    function tick() {
      var n = document.getElementById('clock');
      if (!n) return;
      var d = new Date();
      var hh = d.getHours(), mm = d.getMinutes();
      n.innerHTML = (hh < 10 ? '0' + hh : hh) + ':' + (mm < 10 ? '0' + mm : mm) +
        '<small>' + d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }) + '</small>';
    }
    tick();
    setInterval(tick, 20000);
  };

  /* ---------------------------------------------------------
     Fundo ambiente: acompanha o item em foco com um atraso
     curto, para não piscar quando se percorre a fileira rápido.
     --------------------------------------------------------- */
  var ambientTimer = null, ambientSrc = '';

  w.setAmbient = function (url) {
    clearTimeout(ambientTimer);
    ambientTimer = setTimeout(function () {
      var n = document.getElementById('ambient');
      if (!n) return;
      if (!url) { n.classList.remove('on'); ambientSrc = ''; return; }
      if (url === ambientSrc) return;
      ambientSrc = url;
      n.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      n.classList.add('on');
    }, 260);
  };

  /* ---------------------------------------------------------
     Diálogo de confirmação genérico.
     --------------------------------------------------------- */
  w.confirmDialog = function (title, desc, okLabel) {
    return new Promise(function (resolve) {
      var layer = w.$('#confirm-layer');
      var prev = w.Nav.current();
      w.$('#confirm-title').textContent = title;
      w.$('#confirm-desc').textContent = desc || '';
      w.$('#confirm-yes').textContent = okLabel || 'Confirmar';
      layer.classList.remove('hidden');
      w.Nav.setScope(layer);

      function finish(value) {
        layer.classList.add('hidden');
        w.$('#confirm-yes').onclick = null;
        w.$('#confirm-no').onclick = null;
        w.Nav.clearScope(prev);
        resolve(value);
      }
      w.$('#confirm-yes').onclick = function () { finish(true); };
      w.$('#confirm-no').onclick  = function () { finish(false); };
    });
  };

})(window);
