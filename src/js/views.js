/* =========================================================
   Telas do aplicativo.
   Cada função monta uma tela dentro de #stage e devolve uma
   Promise que resolve quando o conteúdo essencial já apareceu.
   ========================================================= */
(function (w) {
  'use strict';

  /* ---------------------------------------------------------
     Carregamento preguiçoso de imagens
     --------------------------------------------------------- */
  var io = null;
  function lazyInit() {
    if (io || !w.IntersectionObserver) return;
    io = new w.IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var img = e.target;
        io.unobserve(img);
        var src = img.getAttribute('data-src');
        if (src) img.src = src;
      });
    }, { rootMargin: '300px 600px' });
  }
  function lazy(img) {
    lazyInit();
    if (io) io.observe(img);
    else img.src = img.getAttribute('data-src') || '';
  }

  /* ---------------------------------------------------------
     Blocos reutilizáveis
     --------------------------------------------------------- */
  function screen(cls) {
    var stage = w.$('#stage');
    w.clear(stage);
    var s = w.el('div', { class: 'screen enter ' + (cls || '') });
    stage.appendChild(s);
    return s;
  }

  function scroller(parent) {
    var wrap = w.el('div', { class: 'screen-scroll' });
    var inner = w.el('div', { class: 'screen-inner', 'data-scroll': 'y' });
    wrap.appendChild(inner);
    parent.appendChild(wrap);
    return inner;
  }

  function thumb(item, shape) {
    var shell = w.el('div', { class: 'shell' });
    var url = item.poster || '';
    if (url) {
      var img = w.el('img', {
        class: 'thumb' + (shape === 'logo' ? ' contain' : ''),
        'data-src': url, alt: ''
      });
      img.onerror = function () {
        img.style.display = 'none';
        shell.appendChild(w.el('div', { class: 'card-fallback', text: w.initials(item.title) }));
      };
      shell.appendChild(img);
      lazy(img);
    } else {
      shell.appendChild(w.el('div', { class: 'card-fallback', text: w.initials(item.title) }));
    }
    return shell;
  }

  /* Um card. shape: poster | wide | logo */
  function card(item, opts) {
    opts = opts || {};
    var shape = opts.shape || 'poster';
    var b = w.el('button', {
      class: 'card card-' + shape + (opts.rank ? ' card-rank' : ''),
      'data-focusable': true
    });

    if (opts.rank) b.appendChild(w.el('span', { class: 'num', text: String(opts.rank) }));

    var stack = opts.rank ? w.el('div', {}) : b;
    if (opts.rank) b.appendChild(stack);

    var shell = thumb(item, shape);

    if (opts.live) shell.appendChild(w.el('span', { class: 'tag', text: 'AO VIVO' }));
    if (opts.tag)  shell.appendChild(w.el('span', { class: 'tag soft', text: opts.tag }));

    shell.appendChild(w.el('div', { class: 'play-hint', html: w.icon('play', 'solid') }));

    if (opts.overlayTitle) {
      shell.appendChild(w.el('div', { class: 'card-scrim' }));
      shell.appendChild(w.el('div', { class: 'card-overlay', text: w.cleanName(item.title) }));
    }

    if (opts.progress > 0) {
      var bar = w.el('div', { class: 'card-progress' });
      bar.appendChild(w.el('i', { style: 'width:' + Math.min(100, opts.progress * 100) + '%' }));
      shell.appendChild(bar);
    }

    stack.appendChild(shell);

    if (!opts.overlayTitle) {
      var meta = w.el('div', { class: 'card-meta' });
      meta.appendChild(w.el('div', { class: 'card-name', text: w.cleanName(item.title) }));
      if (opts.note) meta.appendChild(w.el('div', { class: 'card-note', text: opts.note }));
      stack.appendChild(meta);
    }

    b.setAttribute('data-ambient', item.poster || '');
    b.onclick = function () { if (opts.onSelect) opts.onSelect(item); };
    return b;
  }

  function rowBlock(title, subtitle) {
    var row = w.el('div', { class: 'row' });
    var head = w.el('div', { class: 'section-title' });
    head.appendChild(w.el('span', { text: title }));
    if (subtitle) head.appendChild(w.el('small', { text: subtitle }));
    var track = w.el('div', { class: 'row-track', 'data-scroll': 'x', 'data-nav-axis': 'x' });
    row.appendChild(head);
    row.appendChild(track);
    row.track = track;
    return row;
  }

  function skeletonRow(title, count, shape) {
    var row = rowBlock(title, '');
    for (var i = 0; i < (count || 7); i++) {
      var d = w.el('div', {
        class: 'skel',
        style: shape === 'wide' ? 'width:20rem;height:11.25rem;flex:0 0 auto'
                                : 'width:11.5rem;height:17.2rem;flex:0 0 auto'
      });
      row.track.appendChild(d);
    }
    return row;
  }

  function chip(text, cls) { return w.el('span', { class: 'chip ' + (cls || ''), text: text }); }

  function emptyBlock(title, html) {
    var e = w.el('div', { class: 'empty' });
    if (title) e.appendChild(w.el('h2', { text: title }));
    e.appendChild(w.el('div', { html: html || '' }));
    return e;
  }

  function errorBlock(err, retry) {
    var e = w.el('div', { class: 'empty' });
    e.appendChild(w.el('h2', { text: 'Não consegui carregar' }));
    e.appendChild(w.el('div', { html: w.esc(err && err.message ? err.message : String(err)) }));
    if (retry) {
      var btns = w.el('div', { class: 'row-btns', style: 'margin-top:1.6rem', 'data-nav-axis': 'x' });
      var b = w.el('button', { class: 'btn primary', 'data-focusable': true, text: 'Tentar de novo' });
      b.onclick = retry;
      btns.appendChild(b);
      e.appendChild(btns);
    }
    return e;
  }

  /* Converte um registro de progresso em item reproduzível. */
  function fromProgress(p) {
    return {
      id: p.id, kind: p.kind, title: p.title, subtitle: p.subtitle,
      poster: p.poster, url: p.stream_url, duration: p.duration,
      seriesId: p.series_id, seriesTitle: p.series_title,
      season: p.season, episode: p.episode
    };
  }

  function play(item, opts) {
    w.Player.open(item, opts || {});
  }

  /* =========================================================
     TELA: INÍCIO
     ========================================================= */
  function home() {
    var s = screen('screen-home');
    var inner = scroller(s);

    /* --- Billboard --- */
    var bb = w.el('div', { class: 'billboard' });
    var art = w.el('div', { class: 'bb-art' });
    var body = w.el('div', { class: 'bb-body' });
    var dots = w.el('div', { class: 'bb-dots' });
    bb.appendChild(art); bb.appendChild(body); bb.appendChild(dots);
    inner.appendChild(bb);

    body.innerHTML =
      '<div class="bb-kicker">Boa noite</div>' +
      '<div class="bb-title">Nebula</div>' +
      '<div class="bb-desc">Carregando seu catálogo…</div>';

    /* --- Fileiras --- */
    var rows = w.el('div', {});
    inner.appendChild(rows);

    var cont = w.Store.continueList(20);
    if (cont.length) {
      var rc = rowBlock('Continuar assistindo', cont.length + ' em andamento');
      cont.forEach(function (p) {
        var item = fromProgress(p);
        rc.track.appendChild(card(item, {
          shape: 'wide', overlayTitle: true,
          progress: p.duration ? p.position / p.duration : 0,
          tag: p.duration ? 'restam ' + w.fmtLeft(p.duration - p.position) : null,
          onSelect: function (it) { play(it); }
        }));
      });
      rows.appendChild(rc);
    }

    var lives = w.Store.historyList(40).filter(function (r) { return r.kind === 'live'; }).slice(0, 14);
    if (lives.length) {
      var rl = rowBlock('Canais recentes', '');
      lives.forEach(function (p) {
        var item = fromProgress(p);
        rl.track.appendChild(card(item, {
          shape: 'logo', live: true,
          onSelect: function (it) { play(it); }
        }));
      });
      rows.appendChild(rl);
    }

    var favs = w.Store.favorites();
    if (favs.length) {
      var rf = rowBlock('Sua lista', favs.length + ' itens');
      favs.forEach(function (f) {
        rf.track.appendChild(card(f, {
          shape: f.kind === 'live' ? 'logo' : 'poster',
          onSelect: function (it) { openItem(it); }
        }));
      });
      rows.appendChild(rf);
    }

    var skMovies = skeletonRow('Filmes', 7, 'poster');
    var skSeries = skeletonRow('Séries', 7, 'poster');
    rows.appendChild(skMovies);
    rows.appendChild(skSeries);

    w.Nav.focusFirst('.screen .card') || w.Nav.focusFirst('.rail-item');

    /* --- Preenche em segundo plano --- */
    var billboardItems = [];

    w.Catalog.categories('movie')
      .then(function (cats) {
        if (!cats.length) throw new Error('Nenhuma categoria de filme.');
        return Promise.all(cats.slice(0, 3).map(function (c) {
          return w.Catalog.items('movie', c.id).then(function (items) {
            return { cat: c, items: items };
          }).catch(function () { return { cat: c, items: [] }; });
        }));
      })
      .then(function (packs) {
        rows.removeChild(skMovies);
        var anchor = skSeries;
        packs.forEach(function (p, idx) {
          if (!p.items.length) return;
          var sorted = byNewest(p.items);
          if (!billboardItems.length) billboardItems = sorted.filter(hasPoster).slice(0, 5);
          var r = rowBlock(idx === 0 ? 'Adicionados recentemente' : p.cat.name,
                           idx === 0 ? p.cat.name : p.items.length + ' filmes');
          sorted.slice(0, 40).forEach(function (it, i) {
            r.track.appendChild(card(it, {
              shape: 'poster',
              rank: (idx === 0 && i < 10) ? i + 1 : null,
              progress: progressOf(it.id),
              onSelect: openItem
            }));
          });
          rows.insertBefore(r, anchor);
        });
        renderBillboard(art, body, dots, billboardItems);
      })
      .catch(function (e) {
        if (skMovies.parentNode) rows.replaceChild(errorBlock(e, function () { w.App.go('home'); }), skMovies);
        renderBillboard(art, body, dots, []);
      });

    w.Catalog.categories('series')
      .then(function (cats) {
        return Promise.all(cats.slice(0, 2).map(function (c) {
          return w.Catalog.items('series', c.id).then(function (items) {
            return { cat: c, items: items };
          }).catch(function () { return { cat: c, items: [] }; });
        }));
      })
      .then(function (packs) {
        if (skSeries.parentNode) rows.removeChild(skSeries);
        packs.forEach(function (p) {
          if (!p.items.length) return;
          var r = rowBlock(p.cat.name, p.items.length + ' séries');
          byNewest(p.items).slice(0, 40).forEach(function (it) {
            r.track.appendChild(card(it, { shape: 'poster', onSelect: openItem }));
          });
          rows.appendChild(r);
        });
      })
      .catch(function () {
        if (skSeries.parentNode) rows.removeChild(skSeries);
      });

    return Promise.resolve();
  }

  function hasPoster(i) { return !!i.poster; }
  function byNewest(items) {
    return items.slice().sort(function (a, b) {
      return (Number(b.added) || 0) - (Number(a.added) || 0);
    });
  }
  function progressOf(id) {
    var p = w.Store.progressOf(id);
    return p && p.duration ? p.position / p.duration : 0;
  }

  /* Rotação do destaque principal. */
  var bbTimer = null;
  function renderBillboard(art, body, dots, items) {
    clearInterval(bbTimer);
    if (!items.length) {
      body.innerHTML =
        '<div class="bb-kicker">Nebula</div>' +
        '<div class="bb-title">Tudo pronto</div>' +
        '<div class="bb-desc">Use o menu à esquerda para navegar pelos canais, filmes e séries.</div>';
      return;
    }
    w.clear(dots);
    items.forEach(function () { dots.appendChild(w.el('i')); });

    var i = -1;
    function next() {
      i = (i + 1) % items.length;
      var it = items[i];
      art.classList.remove('on');
      setTimeout(function () {
        art.style.backgroundImage = 'url("' + String(it.poster).replace(/"/g, '%22') + '")';
        art.classList.add('on');
      }, 40);

      w.clear(body);
      body.appendChild(w.el('div', { class: 'bb-kicker', text: 'Em destaque' }));
      body.appendChild(w.el('div', { class: 'bb-title', text: w.cleanName(it.title) }));

      var meta = w.el('div', { class: 'bb-meta' });
      if (it.year) meta.appendChild(chip(it.year));
      if (it.rating) meta.appendChild(chip('★ ' + it.rating, 'warn'));
      meta.appendChild(chip(it.kind === 'series' ? 'Série' : 'Filme'));
      body.appendChild(meta);

      body.appendChild(w.el('div', { class: 'bb-desc',
        text: it.plot || 'Abra para ver os detalhes, o elenco e começar a assistir.' }));

      var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
      var bPlay = w.el('button', { class: 'btn', 'data-focusable': true,
                                   html: w.icon('play', 'solid') + '<span>Assistir</span>' });
      bPlay.onclick = function () { openItem(it, true); };
      var bInfo = w.el('button', { class: 'btn ghost', 'data-focusable': true,
                                   html: w.icon('info') + '<span>Detalhes</span>' });
      bInfo.onclick = function () { openItem(it); };
      btns.appendChild(bPlay); btns.appendChild(bInfo);
      body.appendChild(btns);

      w.$$('i', dots).forEach(function (d, k) { d.classList.toggle('on', k === i); });

      /* Na primeira montagem o foco ainda está no menu: traz para o destaque. */
      var cur = w.Nav.current();
      if (!cur || (cur.closest && cur.closest('#rail'))) w.Nav.focus(bPlay);
    }
    next();
    bbTimer = setInterval(next, 9000);
  }

  /* =========================================================
     Abertura de um item, conforme o tipo
     ========================================================= */
  function openItem(item, straightToPlay) {
    if (item.kind === 'live') { play(item); return; }
    if (item.kind === 'series') { w.App.go('series-detail', { item: item }); return; }
    if (item.kind === 'movie') {
      if (straightToPlay) play(item);
      else w.App.go('movie-detail', { item: item });
      return;
    }
    play(item);
  }
  w.openItem = openItem;

  /* =========================================================
     TELA GENÉRICA: categorias + grade
     ========================================================= */
  function browse(kind, titleText, subtitleText) {
    var s = screen('screen-browse');
    var split = w.el('div', { class: 'split' });
    var catsCol = w.el('div', { class: 'cats' });
    var catsScroll = w.el('div', { class: 'cats-scroll', 'data-scroll': 'y', 'data-nav-axis': 'y' });
    catsCol.appendChild(w.el('div', { class: 'cats-head', text: titleText }));
    catsCol.appendChild(catsScroll);

    var gridWrap = w.el('div', { class: 'grid-wrap' });
    var gridHead = w.el('div', { class: 'grid-head' });
    var grid = w.el('div', { class: 'grid', 'data-scroll': 'y', 'data-nav-axis': 'grid' });
    gridWrap.appendChild(gridHead);
    gridWrap.appendChild(grid);

    split.appendChild(catsCol);
    split.appendChild(gridWrap);
    s.appendChild(split);

    gridHead.appendChild(w.el('h2', { text: 'Carregando…' }));

    return w.Catalog.categories(kind).then(function (cats) {
      if (!cats.length) {
        w.clear(gridWrap);
        gridWrap.appendChild(emptyBlock('Nada por aqui',
          'O servidor não devolveu nenhuma categoria de ' + subtitleText + '.'));
        w.Nav.focusFirst('.rail-item');
        return;
      }

      var current = null;
      cats.forEach(function (c, idx) {
        var b = w.el('button', { class: 'cat-item', 'data-focusable': true });
        b.appendChild(w.el('b', { text: c.name }));
        if (c.count) b.appendChild(w.el('i', { text: String(c.count) }));
        b.onclick = function () { select(c, b); };
        b.setAttribute('data-on-focus', '1');
        b._select = function () { select(c, b); };
        catsScroll.appendChild(b);
        if (idx === 0) current = { cat: c, btn: b };
      });

      function select(c, btn) {
        w.$$('.cat-item', catsScroll).forEach(function (n) { n.classList.remove('active'); });
        btn.classList.add('active');
        w.clear(gridHead); w.clear(grid);
        gridHead.appendChild(w.el('h2', { text: c.name }));
        var count = w.el('small', { text: 'carregando…' });
        gridHead.appendChild(count);
        w.Nav.resetScroll(grid.parentElement);

        w.Catalog.items(kind, c.id).then(function (items) {
          count.textContent = items.length.toLocaleString('pt-BR') +
                              ' ' + (kind === 'live' ? 'canais' : kind === 'movie' ? 'filmes' : 'séries');
          renderPage(items, 0);
        }).catch(function (e) {
          w.clear(grid);
          grid.appendChild(errorBlock(e, function () { select(c, btn); }));
        });

        function renderPage(items, from) {
          var slice = items.slice(from, from + w.CFG.PAGE_SIZE);
          slice.forEach(function (it) {
            grid.appendChild(card(it, {
              shape: kind === 'live' ? 'logo' : 'poster',
              live: kind === 'live',
              progress: progressOf(it.id),
              onSelect: openItem
            }));
          });
          if (from + w.CFG.PAGE_SIZE < items.length) {
            var more = w.el('button', {
              class: 'card card-' + (kind === 'live' ? 'logo' : 'poster'),
              'data-focusable': true
            });
            var shell = w.el('div', { class: 'shell' });
            shell.appendChild(w.el('div', { class: 'card-fallback',
              text: '+' + (items.length - from - w.CFG.PAGE_SIZE) }));
            more.appendChild(shell);
            more.appendChild(w.el('div', { class: 'card-meta' },
              [w.el('div', { class: 'card-name', text: 'Mostrar mais' })]));
            more.onclick = function () {
              grid.removeChild(more);
              renderPage(items, from + w.CFG.PAGE_SIZE);
              w.Nav.focus(grid.lastChild);
            };
            grid.appendChild(more);
          }
        }
      }

      select(current.cat, current.btn);
      w.Nav.focus(current.btn);
    }).catch(function (e) {
      w.clear(s);
      s.appendChild(errorBlock(e, function () { w.App.go(kind === 'live' ? 'live' : kind === 'movie' ? 'movies' : 'series'); }));
      w.Nav.focusFirst('.screen .btn') || w.Nav.focusFirst('.rail-item');
    });
  }

  /* =========================================================
     TELA: DETALHE DE FILME
     ========================================================= */
  function movieDetail(params) {
    var item = params.item;
    var s = screen('screen-detail');
    var inner = scroller(s);

    var art = w.el('div', { class: 'detail-art' });
    if (item.poster) art.style.backgroundImage = 'url("' + item.poster.replace(/"/g, '%22') + '")';
    s.insertBefore(art, s.firstChild);

    var head = w.el('div', { class: 'detail-head' });
    var posterBox = w.el('div', { class: 'detail-poster' });
    if (item.poster) {
      var img = w.el('img', { src: item.poster, alt: '' });
      img.onerror = function () { img.style.display = 'none'; };
      posterBox.appendChild(img);
    }
    var info = w.el('div', { class: 'detail-info' });
    head.appendChild(posterBox);
    head.appendChild(info);
    inner.appendChild(head);

    info.appendChild(w.el('h1', { text: w.cleanName(item.title) }));
    var meta = w.el('div', { class: 'detail-meta' });
    info.appendChild(meta);
    var plot = w.el('div', { class: 'detail-plot', text: 'Buscando informações…' });
    info.appendChild(plot);

    var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
    info.appendChild(btns);
    var credits = w.el('div', { class: 'detail-credits' });
    info.appendChild(credits);

    var saved = w.Store.progressOf(item.id);
    var bPlay = w.el('button', {
      class: 'btn', 'data-focusable': true,
      html: w.icon('play', 'solid') + '<span>' +
            (saved && saved.position > w.CFG.RESUME_MIN_SEC && !saved.completed
              ? 'Continuar de ' + w.fmtTime(saved.position) : 'Assistir') + '</span>'
    });
    bPlay.onclick = function () { play(item); };
    btns.appendChild(bPlay);

    if (saved && saved.position > 0) {
      var bRestart = w.el('button', { class: 'btn ghost', 'data-focusable': true,
                                      text: 'Começar do início' });
      bRestart.onclick = function () { play(item, { forceStart: true }); };
      btns.appendChild(bRestart);
    }

    var bFav = w.el('button', { class: 'btn ghost', 'data-focusable': true });
    function paintFav() {
      bFav.innerHTML = w.icon('star', w.Store.isFavorite(item.id) ? 'solid' : '') +
                       '<span>' + (w.Store.isFavorite(item.id) ? 'Na sua lista' : 'Minha lista') + '</span>';
    }
    paintFav();
    bFav.onclick = function () {
      var on = w.Store.toggleFavorite(item);
      paintFav();
      w.toast(on ? 'Adicionado à sua lista' : 'Removido da sua lista');
    };
    btns.appendChild(bFav);

    w.Nav.focus(bPlay);
    w.setAmbient(item.poster);

    if (item.streamId) {
      w.Catalog.movieInfo(item.streamId).then(function (d) {
        if (!d) { plot.textContent = ''; return; }
        plot.textContent = d.plot || 'Sem sinopse disponível.';
        w.clear(meta);
        if (d.year) meta.appendChild(chip(d.year));
        if (d.duration) meta.appendChild(chip(w.fmtLeft(d.duration)));
        if (d.rating) meta.appendChild(chip('★ ' + d.rating, 'warn'));
        if (d.genre) meta.appendChild(chip(d.genre));
        var c = [];
        if (d.director) c.push('<b>Direção:</b> ' + w.esc(d.director));
        if (d.cast) c.push('<b>Elenco:</b> ' + w.esc(d.cast));
        credits.innerHTML = c.join('<br>');
        if (d.url) item.url = d.url;
        if (d.poster) { art.style.backgroundImage = 'url("' + d.poster.replace(/"/g, '%22') + '")'; }
      }).catch(function () { plot.textContent = ''; });
    } else {
      plot.textContent = '';
    }

    return Promise.resolve();
  }

  /* =========================================================
     TELA: DETALHE DE SÉRIE
     ========================================================= */
  function seriesDetail(params) {
    var item = params.item;
    var s = screen('screen-detail');
    var inner = scroller(s);

    var art = w.el('div', { class: 'detail-art' });
    if (item.poster) art.style.backgroundImage = 'url("' + item.poster.replace(/"/g, '%22') + '")';
    s.insertBefore(art, s.firstChild);

    var head = w.el('div', { class: 'detail-head' });
    var posterBox = w.el('div', { class: 'detail-poster' });
    if (item.poster) posterBox.appendChild(w.el('img', { src: item.poster, alt: '' }));
    var info = w.el('div', { class: 'detail-info' });
    head.appendChild(posterBox); head.appendChild(info);
    inner.appendChild(head);

    info.appendChild(w.el('h1', { text: w.cleanName(item.title) }));
    var meta = w.el('div', { class: 'detail-meta' });
    info.appendChild(meta);
    var plot = w.el('div', { class: 'detail-plot', text: 'Carregando temporadas…' });
    info.appendChild(plot);
    var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
    info.appendChild(btns);

    var seasonsBar = w.el('div', { class: 'seasons', 'data-nav-axis': 'x' });
    var epList = w.el('div', { class: 'episodes' });
    inner.appendChild(seasonsBar);
    inner.appendChild(epList);

    w.setAmbient(item.poster);
    w.Nav.focusFirst('.rail-item');

    return w.Catalog.seriesInfo(item.seriesId).then(function (d) {
      plot.textContent = d.plot || 'Sem sinopse disponível.';
      w.clear(meta);
      if (d.year) meta.appendChild(chip(d.year));
      meta.appendChild(chip(d.seasons.length + (d.seasons.length === 1 ? ' temporada' : ' temporadas')));
      if (d.rating) meta.appendChild(chip('★ ' + d.rating, 'warn'));
      if (d.genre) meta.appendChild(chip(d.genre));

      var all = [];
      d.seasons.forEach(function (se) { all = all.concat(se.episodes); });

      /* Botão principal: continuar de onde parou, ou o primeiro episódio. */
      var last = w.Store.lastEpisodeOf(item.seriesId);
      var target = null, label = 'Assistir T1 E1';
      if (last) {
        var idx = indexOfEpisode(all, last.id);
        var savedRec = w.Store.progressOf(last.id);
        if (idx >= 0 && savedRec && !savedRec.completed) {
          target = all[idx];
          label = 'Continuar T' + target.season + ' E' + target.episode;
        } else if (idx >= 0 && all[idx + 1]) {
          target = all[idx + 1];
          label = 'Próximo: T' + target.season + ' E' + target.episode;
        }
      }
      if (!target) target = all[0];

      if (target) {
        var bPlay = w.el('button', { class: 'btn', 'data-focusable': true,
          html: w.icon('play', 'solid') + '<span>' + w.esc(label) + '</span>' });
        bPlay.onclick = function () { playEpisode(target, all, d); };
        btns.appendChild(bPlay);
      }

      var bFav = w.el('button', { class: 'btn ghost', 'data-focusable': true });
      function paintFav() {
        bFav.innerHTML = w.icon('star', w.Store.isFavorite(item.id) ? 'solid' : '') +
                         '<span>' + (w.Store.isFavorite(item.id) ? 'Na sua lista' : 'Minha lista') + '</span>';
      }
      paintFav();
      bFav.onclick = function () { w.Store.toggleFavorite(item); paintFav(); };
      btns.appendChild(bFav);

      var currentSeason = target ? target.season : (d.seasons[0] && d.seasons[0].season);

      d.seasons.forEach(function (se) {
        var b = w.el('button', { class: 'season-btn', 'data-focusable': true,
                                 text: 'Temporada ' + se.season });
        b.onclick = function () { showSeason(se, b); };
        seasonsBar.appendChild(b);
        if (se.season === currentSeason) setTimeout(function () { showSeason(se, b); }, 0);
      });

      function showSeason(se, btn) {
        w.$$('.season-btn', seasonsBar).forEach(function (n) { n.classList.remove('active'); });
        btn.classList.add('active');
        w.clear(epList);
        epList.setAttribute('data-nav-axis', 'y');
        se.episodes.forEach(function (ep) {
          epList.appendChild(episodeRow(ep, all, d));
        });
      }

      if (btns.firstChild) w.Nav.focus(btns.firstChild);
    }).catch(function (e) {
      plot.textContent = '';
      inner.appendChild(errorBlock(e, function () { w.App.go('series-detail', params); }));
      w.Nav.focusFirst('.screen .btn') || w.Nav.focusFirst('.rail-item');
    });
  }

  function indexOfEpisode(all, id) {
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return i;
    return -1;
  }

  function episodeRow(ep, all, info) {
    var b = w.el('button', { class: 'ep', 'data-focusable': true });
    var th = w.el('div', { class: 'ep-thumb' });
    if (ep.poster) {
      var img = w.el('img', { 'data-src': ep.poster, alt: '' });
      img.onerror = function () { img.style.display = 'none'; };
      th.appendChild(img);
      lazy(img);
    }
    th.appendChild(w.el('span', { class: 'ep-num', text: 'T' + ep.season + ' · E' + ep.episode }));

    var p = w.Store.progressOf(ep.id);
    if (p && p.duration) {
      var bar = w.el('div', { class: 'card-progress' });
      bar.appendChild(w.el('i', { style: 'width:' + Math.min(100, (p.position / p.duration) * 100) + '%' }));
      th.appendChild(bar);
    }

    var body = w.el('div', { class: 'ep-body' });
    var line = w.el('div', { class: 'ep-title' });
    line.appendChild(w.el('span', { text: w.cleanName(ep.title) }));
    if (ep.duration) line.appendChild(w.el('span', { class: 'ep-dur', text: w.fmtLeft(ep.duration) }));
    body.appendChild(line);
    body.appendChild(w.el('div', { class: 'ep-plot', text: ep.plot || '' }));
    if (p) {
      body.appendChild(w.el('div', { class: 'ep-state',
        text: p.completed ? 'Assistido' :
              (p.position > 30 ? 'Você parou em ' + w.fmtTime(p.position) : '') }));
    }

    b.appendChild(th); b.appendChild(body);
    b.setAttribute('data-ambient', ep.poster || info.poster || '');
    b.onclick = function () { playEpisode(ep, all, info); };
    return b;
  }

  function playEpisode(ep, all, info) {
    var idx = indexOfEpisode(all, ep.id);
    var queue = all.map(function (e) {
      return {
        id: e.id, kind: 'episode', title: e.title,
        subtitle: info.title + ' · T' + e.season + ' E' + e.episode,
        poster: e.poster || info.poster, url: e.url, duration: e.duration,
        seriesId: e.seriesId, seriesTitle: info.title,
        season: e.season, episode: e.episode
      };
    });
    play(queue[idx >= 0 ? idx : 0], { queue: queue, index: idx >= 0 ? idx : 0 });
  }

  /* =========================================================
     TELA: BUSCA
     ========================================================= */
  function search() {
    var s = screen('screen-search');
    var inner = scroller(s);

    var headBox = w.el('div', { class: 'page-head' });
    headBox.appendChild(w.el('div', { class: 'page-title', text: 'Buscar' }));
    headBox.appendChild(w.el('div', { class: 'page-sub',
      text: 'Digite e o resultado aparece sozinho. Filmes, séries e canais ao mesmo tempo.' }));
    inner.appendChild(headBox);

    var box = w.el('div', { class: 'pad', style: 'margin-top:2rem' });
    var field = w.el('div', { class: 'field' });
    var input = w.el('input', { type: 'text', 'data-focusable': true,
                                placeholder: 'Nome do filme, série ou canal…' });
    field.appendChild(input);
    box.appendChild(field);
    inner.appendChild(box);

    var status = w.el('div', { class: 'empty', text: 'Preparando o índice de busca…' });
    inner.appendChild(status);

    var results = w.el('div', { class: 'grid', 'data-nav-axis': 'grid',
                                style: 'padding-left:4rem' });
    inner.appendChild(results);

    w.Nav.focus(input);

    var index = null;
    w.Catalog.buildSearchIndex(function (msg) { status.textContent = msg; })
      .then(function (idx) {
        index = idx;
        status.textContent = idx.length.toLocaleString('pt-BR') + ' títulos prontos para busca.';
      })
      .catch(function (e) {
        status.textContent = 'Não consegui montar o índice: ' + e.message;
      });

    var run = w.debounce(function () {
      if (!index) return;
      var q = input.value.trim();
      w.clear(results);
      if (q.length < 2) {
        status.textContent = index.length.toLocaleString('pt-BR') + ' títulos prontos para busca.';
        return;
      }
      var hits = w.Catalog.search(q, index);
      status.textContent = hits.length
        ? hits.length + (hits.length === 200 ? '+' : '') + ' resultados para “' + q + '”'
        : 'Nada encontrado para “' + q + '”.';
      hits.forEach(function (it) {
        results.appendChild(card(it, {
          shape: it.kind === 'live' ? 'logo' : 'poster',
          live: it.kind === 'live',
          note: it.kind === 'live' ? 'Canal' : it.kind === 'series' ? 'Série' : 'Filme',
          onSelect: openItem
        }));
      });
    }, 320);

    input.addEventListener('input', run);
    input.addEventListener('keyup', run);

    return Promise.resolve();
  }

  /* =========================================================
     TELA: PRIMEIRA CONFIGURAÇÃO
     ========================================================= */
  function setup() {
    var s = screen('screen-setup');
    var inner = scroller(s);

    var head = w.el('div', { class: 'page-head' });
    head.appendChild(w.el('div', { class: 'page-title', text: 'Vamos conectar sua lista' }));
    head.appendChild(w.el('div', { class: 'page-sub',
      text: 'Cole aqui o mesmo link que você usava no outro aplicativo. Eu descubro sozinho se ele fala a língua do Xtream.' }));
    inner.appendChild(head);

    var box = w.el('div', { class: 'pad', style: 'margin-top:2.4rem' });
    inner.appendChild(box);

    var f = w.el('div', { class: 'field' });
    f.appendChild(w.el('label', { text: 'Endereço da lista M3U' }));
    var input = w.el('input', { type: 'text', 'data-focusable': true,
      value: w.Store.get('source.url', ''),
      placeholder: 'http://servidor:porta/get.php?username=…&password=…' });
    f.appendChild(input);
    f.appendChild(w.el('div', { class: 'hint',
      html: 'Use o controle para abrir o teclado da TV. Se preferir digitar do computador, ' +
            'dá para colar esse endereço depois pelos Ajustes.' }));
    box.appendChild(f);

    var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
    var go = w.el('button', { class: 'btn primary', 'data-focusable': true, text: 'Conectar' });
    btns.appendChild(go);
    box.appendChild(btns);

    var log = w.el('div', { class: 'empty', style: 'padding-left:0' });
    box.appendChild(log);

    go.onclick = function () {
      var url = input.value.trim();
      log.innerHTML = '';
      var line = w.el('div', { text: 'Conectando…' });
      log.appendChild(line);
      go.textContent = 'Conectando…';

      w.Catalog.connect(url, function (msg) { line.textContent = msg; })
        .then(function (res) {
          w.toast(res.mode === 'xtream'
            ? 'Conectado pela API do servidor — catálogo completo.'
            : 'Lista carregada com ' + (res.count || 0) + ' itens.');
          w.App.go('home', null, { replace: true });
        })
        .catch(function (e) {
          go.textContent = 'Tentar de novo';
          line.innerHTML = '<b>Não deu certo:</b> ' + w.esc(e.message);
          log.appendChild(w.el('div', { style: 'margin-top:1rem;font-size:.9rem',
            html: 'Se o endereço está certo, o problema costuma ser o servidor recusando ' +
                  'a conexão vinda da TV. Veja a seção sobre proxy no README.' }));
        });
    };

    w.Nav.focus(input);
    return Promise.resolve();
  }

  /* =========================================================
     TELA: AJUSTES
     ========================================================= */
  function settings() {
    var s = screen('screen-settings');
    var inner = scroller(s);

    var head = w.el('div', { class: 'page-head' });
    head.appendChild(w.el('div', { class: 'page-title', text: 'Ajustes' }));
    head.appendChild(w.el('div', { class: 'page-sub', text: 'Fonte, nuvem e atualização do aplicativo.' }));
    inner.appendChild(head);

    var box = w.el('div', { class: 'pad', style: 'margin-top:2.2rem' });
    inner.appendChild(box);

    box.appendChild(panelUpdate());
    box.appendChild(panelSource());
    box.appendChild(panelCloud());
    box.appendChild(panelData());

    w.Nav.focusFirst('.screen-settings [data-focusable]');
    return Promise.resolve();
  }

  function panel(title, sub) {
    var p = w.el('div', { class: 'panel' });
    p.appendChild(w.el('h3', { text: title }));
    if (sub) p.appendChild(w.el('div', { class: 'sub', text: sub }));
    return p;
  }

  function textField(label, value, placeholder, hint) {
    var f = w.el('div', { class: 'field' });
    f.appendChild(w.el('label', { text: label }));
    var i = w.el('input', { type: 'text', 'data-focusable': true,
                            value: value || '', placeholder: placeholder || '' });
    f.appendChild(i);
    if (hint) f.appendChild(w.el('div', { class: 'hint', html: hint }));
    f.input = i;
    return f;
  }

  /* ---- Atualização pelo GitHub ---- */
  function panelUpdate() {
    var p = panel('Atualizar pelo GitHub',
      'O aplicativo instalado na TV é só uma casca. O código de verdade fica no seu repositório: ' +
      'você dá git push no Mac e aperta o botão aqui.');

    var loaded = (w.Updater && w.Updater.loaded) || {};
    var kv = w.el('div', { style: 'margin-bottom:1.4rem' });
    kv.appendChild(row2('Versão em execução', loaded.version || '?'));
    kv.appendChild(row2('Origem', loaded.source === 'github' ? 'baixada do GitHub'
                                : loaded.source === 'local' ? 'cópia que veio no aplicativo'
                                : String(loaded.source || '?')));
    if (loaded.rolledBackFrom) {
      kv.appendChild(row2('Atenção', 'a versão ' + loaded.rolledBackFrom +
                                     ' não iniciou e foi revertida automaticamente'));
    }
    p.appendChild(kv);

    var fRepo = textField('Repositório', w.Store.get('update.repo', ''),
      'seu-usuario/nebula-tv',
      'No formato <b>usuario/repositorio</b>. O repositório pode ser público ou, se for privado, ' +
      'a TV não vai conseguir baixar — use um público, já que aqui não vai nada sensível.');
    var fBranch = textField('Ramo (branch)', w.Store.get('update.branch', 'main'), 'main');
    var fDir = textField('Pasta do pacote', w.Store.get('update.dir', 'build'), 'build',
      'É a pasta que o comando <b>npm run build</b> gera.');
    p.appendChild(fRepo); p.appendChild(fBranch); p.appendChild(fDir);

    var status = w.el('div', { class: 'sub', style: 'margin:0 0 1.2rem' });
    p.appendChild(status);

    var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
    p.appendChild(btns);

    var bSave = w.el('button', { class: 'btn ghost', 'data-focusable': true, text: 'Salvar endereço' });
    bSave.onclick = function () {
      w.Store.set('update.repo', fRepo.input.value.trim());
      w.Store.set('update.branch', fBranch.input.value.trim() || 'main');
      w.Store.set('update.dir', fDir.input.value.trim());
      status.textContent = 'Endereço salvo: ' + (w.Updater.baseUrl() || '(incompleto)');
      w.toast('Endereço salvo');
    };

    var pending = null;
    var bCheck = w.el('button', { class: 'btn primary', 'data-focusable': true,
                                  html: w.icon('refresh') + '<span>Procurar atualização</span>' });
    bCheck.onclick = function () {
      bSave.onclick();
      status.textContent = 'Consultando o GitHub…';
      w.Updater.check().then(function (info) {
        pending = info;
        if (!info.isNew) {
          status.textContent = 'Você já está na versão mais recente (' + info.version + ').';
          bInstall.classList.add('hidden');
          return;
        }
        status.innerHTML = 'Versão nova disponível: <b>' + w.esc(info.version) + '</b>' +
                           (info.notes ? ' — ' + w.esc(info.notes) : '');
        bInstall.classList.remove('hidden');
        w.Nav.focus(bInstall);
      }).catch(function (e) {
        status.textContent = 'Não consegui verificar: ' + e.message;
        bInstall.classList.add('hidden');
      });
    };

    var bInstall = w.el('button', { class: 'btn', 'data-focusable': true,
                                    html: w.icon('down') + '<span>Instalar e reiniciar</span>' });
    bInstall.classList.add('hidden');
    bInstall.onclick = function () {
      if (!pending) return;
      status.textContent = 'Baixando…';
      w.Updater.install(pending, function (msg) { status.textContent = msg; })
        .then(function (r) {
          status.textContent = 'Versão ' + r.version + ' instalada. Reiniciando…';
          setTimeout(function () { w.Updater.reload(); }, 900);
        })
        .catch(function (e) { status.textContent = 'Falhou: ' + e.message; });
    };

    var bBack = w.el('button', { class: 'btn ghost', 'data-focusable': true,
                                 text: 'Voltar à versão anterior' });
    bBack.onclick = function () {
      w.confirmDialog('Voltar à versão anterior?',
        'A TV vai reiniciar o aplicativo usando o pacote guardado antes da última atualização.',
        'Voltar').then(function (yes) {
          if (!yes) return;
          if (w.Updater.rollback()) w.Updater.reload();
          else w.toast('Não há versão anterior guardada.');
        });
    };

    btns.appendChild(bCheck);
    btns.appendChild(bInstall);
    btns.appendChild(bSave);
    if (w.Updater.hasPrevious && w.Updater.hasPrevious()) btns.appendChild(bBack);

    if (w.Updater.baseUrl && w.Updater.baseUrl())
      status.textContent = 'Buscando em ' + w.Updater.baseUrl();

    return p;
  }

  function row2(k, v) {
    var d = w.el('div', { class: 'kv' });
    d.appendChild(w.el('b', { text: k }));
    d.appendChild(w.el('span', { text: v }));
    return d;
  }

  /* ---- Fonte da lista ---- */
  function panelSource() {
    var p = panel('Lista de canais', 'Onde o app busca o catálogo.');

    var acc = w.Store.get('source.account', null);
    var kv = w.el('div', { style: 'margin-bottom:1.4rem' });
    kv.appendChild(row2('Modo', w.Catalog.mode() === 'xtream'
      ? 'API Xtream (catálogo completo)' : 'lista M3U (simples)'));
    if (w.Store.get('source.username')) kv.appendChild(row2('Usuário', w.Store.get('source.username')));
    if (acc && acc.expires) kv.appendChild(row2('Vence em', new Date(acc.expires).toLocaleDateString('pt-BR')));
    if (acc && acc.maxConnections) kv.appendChild(row2('Conexões simultâneas', String(acc.maxConnections)));
    p.appendChild(kv);

    var f = textField('Endereço da lista', w.Store.get('source.url', ''),
      'http://servidor:porta/get.php?username=…&password=…');
    p.appendChild(f);

    var fProxy = textField('Proxy (só se precisar)', w.Store.get('source.proxy', ''),
      'https://seu-worker.workers.dev/?url=',
      'Deixe vazio primeiro. Preencha só se o app conectar no navegador mas não na TV — ' +
      'aí o servidor da sua lista está recusando a origem da TV, e o proxy resolve. ' +
      'O README traz o código pronto de um proxy gratuito no Cloudflare.');
    p.appendChild(fProxy);

    var status = w.el('div', { class: 'sub', style: 'margin:0 0 1.2rem' });
    p.appendChild(status);

    var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
    var bConn = w.el('button', { class: 'btn primary', 'data-focusable': true, text: 'Reconectar' });
    bConn.onclick = function () {
      w.Store.set('source.proxy', fProxy.input.value.trim());
      status.textContent = 'Conectando…';
      w.Catalog.connect(f.input.value.trim(), function (m) { status.textContent = m; })
        .then(function () { w.toast('Lista atualizada'); w.App.go('home', null, { replace: true }); })
        .catch(function (e) { status.textContent = 'Falhou: ' + e.message; });
    };
    var bRefresh = w.el('button', { class: 'btn ghost', 'data-focusable': true,
                                    html: w.icon('refresh') + '<span>Limpar cache do catálogo</span>' });
    bRefresh.onclick = function () {
      w.Catalog.refresh().then(function () { w.toast('Cache limpo — o catálogo será rebaixado.'); });
    };
    btns.appendChild(bConn); btns.appendChild(bRefresh);
    p.appendChild(btns);
    return p;
  }

  /* ---- Supabase ---- */
  function panelCloud() {
    var p = panel('Histórico na nuvem (Supabase)',
      'É o que faz o ponto de onde você parou sobreviver a qualquer reinstalação do aplicativo.');

    var fUrl = textField('URL do projeto', w.Store.get('cloud.url', ''),
      'https://xxxxxxxx.supabase.co');
    var fKey = textField('Chave anon (public)', w.Store.get('cloud.key', ''), 'eyJhbGciOi…',
      'É a chave pública do projeto. Ela fica gravada na TV, então não guarde nada sensível nesse banco.');
    p.appendChild(fUrl); p.appendChild(fKey);

    var status = w.el('div', { class: 'sub', style: 'margin:0 0 1.2rem' });
    var pend = w.Cloud.pending();
    status.textContent = w.Cloud.enabled()
      ? ('Ativo. ' + (pend ? pend + ' registro(s) esperando envio.' : 'Tudo sincronizado.') +
         (w.Cloud.lastError() ? ' Último erro: ' + w.Cloud.lastError() : ''))
      : 'Desligado — o histórico está só na TV.';
    p.appendChild(status);

    var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
    var bSave = w.el('button', { class: 'btn primary', 'data-focusable': true, text: 'Salvar e testar' });
    bSave.onclick = function () {
      w.Store.set('cloud.url', fUrl.input.value.trim());
      w.Store.set('cloud.key', fKey.input.value.trim());
      status.textContent = 'Testando…';
      w.Cloud.test()
        .then(function () {
          status.textContent = 'Funcionou. Trazendo o histórico que já estava na nuvem…';
          return w.Cloud.pull();
        })
        .then(function (n) {
          status.textContent = 'Tudo certo. ' + (n ? n + ' registros vieram da nuvem.' : 'Nada novo por lá.');
          w.Cloud.flush();
        })
        .catch(function (e) {
          status.textContent = 'Falhou: ' + e.message +
            ' — confira se você rodou o supabase/schema.sql no painel do Supabase.';
        });
    };
    var bSync = w.el('button', { class: 'btn ghost', 'data-focusable': true, text: 'Sincronizar agora' });
    bSync.onclick = function () {
      status.textContent = 'Sincronizando…';
      w.Cloud.flush().then(function () { return w.Cloud.pull(); })
        .then(function (n) { status.textContent = 'Pronto. ' + n + ' registros atualizados.'; })
        .catch(function (e) { status.textContent = 'Falhou: ' + e.message; });
    };
    btns.appendChild(bSave); btns.appendChild(bSync);
    p.appendChild(btns);
    return p;
  }

  /* ---- Dados locais ---- */
  function panelData() {
    var p = panel('Dados neste aparelho', 'Histórico, favoritos e cache guardados na TV.');
    var hist = w.Store.historyList(999);
    var kv = w.el('div', { style: 'margin-bottom:1.4rem' });
    kv.appendChild(row2('Itens no histórico', String(hist.length)));
    kv.appendChild(row2('Favoritos', String(w.Store.favorites().length)));
    p.appendChild(kv);

    var btns = w.el('div', { class: 'row-btns', 'data-nav-axis': 'x' });
    var bClear = w.el('button', { class: 'btn danger', 'data-focusable': true,
                                  text: 'Apagar tudo e recomeçar' });
    bClear.onclick = function () {
      w.confirmDialog('Apagar tudo?',
        'Isso remove a lista configurada, o histórico local, os favoritos e o cache. ' +
        'O que já foi para o Supabase continua lá.',
        'Apagar').then(function (yes) {
          if (!yes) return;
          w.Store.wipe();
          w.Updater.reload();
        });
    };
    btns.appendChild(bClear);
    p.appendChild(btns);
    return p;
  }

  /* =========================================================
     Exporta
     ========================================================= */
  w.Views = {
    home: home,
    live:   function () { return browse('live',   'Categorias', 'canais'); },
    movies: function () { return browse('movie',  'Categorias', 'filmes'); },
    series: function () { return browse('series', 'Categorias', 'séries'); },
    search: search,
    setup: setup,
    settings: settings,
    movieDetail: movieDetail,
    seriesDetail: seriesDetail,
    stopBillboard: function () { clearInterval(bbTimer); }
  };

})(window);
