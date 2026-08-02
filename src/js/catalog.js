/* =========================================================
   Camada unica de catalogo.
   Esconde do resto do app a diferenca entre "lista M3U crua"
   e "API Xtream", e guarda tudo em cache no IndexedDB para
   que abrir o app nao dependa da velocidade do servidor.
   ========================================================= */
(function (w) {
  'use strict';

  var memo = {};   // cache em memoria dentro da sessao

  function mode() { return w.Store.get('source.mode', 'm3u'); }

  function cached(key, ttl, producer) {
    if (memo[key]) return Promise.resolve(memo[key]);
    return w.IDB.getFresh(key, ttl).then(function (hit) {
      if (hit) { memo[key] = hit; return hit; }
      return producer().then(function (fresh) {
        memo[key] = fresh;
        w.IDB.putFresh(key, fresh);
        return fresh;
      });
    });
  }

  /* Carrega e interpreta a lista M3U inteira (modo de reserva). */
  function m3uAll() {
    return cached('m3u.all', w.CFG.CACHE_TTL_MS, function () {
      return w.fetchText(w.Store.get('source.url')).then(function (text) {
        var items = w.M3U.parse(text);
        if (!items.length) throw new Error('A lista foi baixada mas está vazia.');
        return items;
      });
    });
  }

  w.Catalog = {

    mode: mode,

    /* -----------------------------------------------------
       Conexao inicial. Recebe a URL da lista, tenta o caminho
       Xtream (melhor) e cai para o M3U cru se nao der.
       ----------------------------------------------------- */
    connect: function (url, onStep) {
      var step = onStep || function () {};
      url = String(url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        return Promise.reject(new Error('O endereço precisa começar com http:// ou https://'));
      }

      w.Store.set('source.url', url);
      memo = {};

      var c = w.M3U.credentialsFrom(url);
      if (!c) {
        step('Não achei usuário e senha no link — vou ler a lista direto.');
        return connectM3U(url, step);
      }

      w.Store.set('source.origin', c.origin);
      w.Store.set('source.username', c.username);
      w.Store.set('source.password', c.password);
      w.Store.set('source.mode', 'xtream');

      step('Encontrei as credenciais. Testando a API do servidor…');
      return w.Xtream.account()
        .then(function (acc) {
          step('Conectado como ' + c.username + '.');
          w.Store.set('source.account', {
            status: acc.status,
            expires: acc.expires ? acc.expires.toISOString() : null,
            maxConnections: acc.maxConnections
          });
          return w.IDB.clear().then(function () {
            return { mode: 'xtream', account: acc };
          });
        })
        .catch(function (e) {
          step('A API não respondeu (' + e.message + '). Tentando ler a lista direto…');
          return connectM3U(url, step);
        });
    },

    /* ----------------------------------------------------- */
    categories: function (kind) {
      if (mode() === 'xtream') {
        var fn = kind === 'live'   ? w.Xtream.liveCategories :
                 kind === 'movie'  ? w.Xtream.vodCategories  :
                                     w.Xtream.seriesCategories;
        return cached('cat.' + kind, w.CFG.CACHE_TTL_MS, fn);
      }
      return m3uAll().then(function (items) {
        var wanted = kind === 'series' ? 'episode' : kind;
        var groups = w.M3U.groupsOf(items.filter(function (i) { return i.kind === wanted; }));
        return groups.map(function (g) {
          return { id: g.id, name: g.name, kind: kind, count: g.count };
        });
      });
    },

    items: function (kind, categoryId) {
      if (mode() === 'xtream') {
        var fn = kind === 'live'  ? w.Xtream.liveStreams :
                 kind === 'movie' ? w.Xtream.vodStreams  :
                                    w.Xtream.seriesList;
        return cached('items.' + kind + '.' + categoryId, w.CFG.CACHE_TTL_MS, function () {
          return fn(categoryId);
        });
      }
      return m3uAll().then(function (items) {
        var wanted = kind === 'series' ? 'episode' : kind;
        return items.filter(function (i) {
          return i.kind === wanted && (i.group || 'Sem categoria') === categoryId;
        });
      });
    },

    seriesInfo: function (seriesId) {
      if (mode() !== 'xtream') return Promise.reject(new Error('Detalhes de série exigem um servidor Xtream.'));
      return cached('series.' + seriesId, w.CFG.CACHE_TTL_MS, function () {
        return w.Xtream.seriesInfo(seriesId);
      });
    },

    movieInfo: function (streamId) {
      if (mode() !== 'xtream') return Promise.resolve(null);
      return cached('movie.' + streamId, w.CFG.CACHE_TTL_MS, function () {
        return w.Xtream.movieInfo(streamId);
      }).catch(function () { return null; });
    },

    /* -----------------------------------------------------
       Indice de busca: baixado sob demanda e reaproveitado.
       ----------------------------------------------------- */
    buildSearchIndex: function (onStep) {
      var step = onStep || function () {};
      return cached('search.index', w.CFG.CACHE_TTL_MS, function () {
        if (mode() !== 'xtream') {
          return m3uAll().then(function (items) {
            return items.map(lean);
          });
        }
        step('Baixando filmes…');
        return w.Xtream.vodStreams('').then(function (movies) {
          step('Baixando séries…');
          return w.Xtream.seriesList('').then(function (series) {
            step('Baixando canais…');
            return w.Xtream.liveStreams('').then(function (live) {
              return movies.concat(series).concat(live).map(lean);
            });
          });
        });
      });
    },

    search: function (query, index) {
      var q = normalize(query);
      if (q.length < 2) return [];
      var terms = q.split(/\s+/).filter(Boolean);
      var out = [];
      for (var i = 0; i < index.length && out.length < 200; i++) {
        var it = index[i];
        var hay = it.n || (it.n = normalize(it.title));
        var ok = true;
        for (var t = 0; t < terms.length; t++) {
          if (hay.indexOf(terms[t]) < 0) { ok = false; break; }
        }
        if (ok) out.push(it);
      }
      /* Quem começa com o termo aparece primeiro. */
      out.sort(function (a, b) {
        var A = a.n.indexOf(terms[0]) === 0 ? 0 : 1;
        var B = b.n.indexOf(terms[0]) === 0 ? 0 : 1;
        return A - B || a.title.localeCompare(b.title);
      });
      return out;
    },

    /* Limpa todo o cache mas mantem os ajustes. */
    refresh: function () {
      memo = {};
      return w.IDB.clear();
    }
  };

  function lean(it) {
    return {
      id: it.id, kind: it.kind, title: it.title, poster: it.poster || '',
      url: it.url || '', seriesId: it.seriesId || '', streamId: it.streamId || '',
      duration: it.duration || 0
    };
  }

  /* Minusculas e sem acento, para que "sao paulo" ache "São Paulo". */
  function normalize(s) {
    var t = String(s || '').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  function connectM3U(url, step) {
    w.Store.set('source.mode', 'm3u');
    step('Baixando a lista… isso pode levar um minuto.');
    return w.IDB.clear()
      .then(m3uAll)
      .then(function (items) {
        step(items.length.toLocaleString('pt-BR') + ' itens encontrados.');
        return { mode: 'm3u', count: items.length };
      });
  }

})(window);
