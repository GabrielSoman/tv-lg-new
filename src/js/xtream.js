/* =========================================================
   Cliente da API Xtream (player_api.php).
   Todos os metodos devolvem itens ja normalizados no formato
   que o resto do app entende.
   ========================================================= */
(function (w) {
  'use strict';

  function creds() {
    return {
      origin:   w.Store.get('source.origin', ''),
      username: w.Store.get('source.username', ''),
      password: w.Store.get('source.password', '')
    };
  }

  function api(action, params) {
    var c = creds();
    var qs = 'username=' + encodeURIComponent(c.username) +
             '&password=' + encodeURIComponent(c.password);
    if (action) qs += '&action=' + action;
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '')
        qs += '&' + k + '=' + encodeURIComponent(params[k]);
    });
    return w.fetchJSON(c.origin + '/player_api.php?' + qs);
  }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /* Duracao vem em formatos variados: "01:32:00", segundos, ou nada. */
  function toSeconds(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var p = s.split(':').map(Number);
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return 0;
  }

  function cats(list, prefix) {
    return (list || []).map(function (c) {
      return {
        id: String(c.category_id),
        name: c.category_name || 'Sem nome',
        kind: prefix
      };
    });
  }

  w.Xtream = {

    /* Verifica as credenciais e devolve dados da conta. */
    account: function () {
      return api('', {}).then(function (d) {
        if (!d || !d.user_info) throw new Error('Servidor não reconheceu o usuário e a senha.');
        if (String(d.user_info.auth) === '0') throw new Error('Usuário ou senha recusados pelo servidor.');
        var u = d.user_info;
        return {
          status: u.status || '',
          expires: u.exp_date ? new Date(num(u.exp_date) * 1000) : null,
          maxConnections: u.max_connections || '',
          activeConnections: u.active_cons || '',
          server: (d.server_info && d.server_info.url) || creds().origin
        };
      });
    },

    liveCategories:   function () { return api('get_live_categories').then(function (r) { return cats(r, 'live'); }); },
    vodCategories:    function () { return api('get_vod_categories').then(function (r) { return cats(r, 'movie'); }); },
    seriesCategories: function () { return api('get_series_categories').then(function (r) { return cats(r, 'series'); }); },

    liveStreams: function (categoryId) {
      return api('get_live_streams', { category_id: categoryId }).then(function (list) {
        return (list || []).map(function (s) {
          return {
            id: 'live:' + s.stream_id,
            streamId: String(s.stream_id),
            kind: 'live',
            title: s.name || 'Canal',
            poster: s.stream_icon || '',
            groupId: String(s.category_id || ''),
            epgId: s.epg_channel_id || '',
            url: w.Xtream.liveUrl(s.stream_id)
          };
        });
      });
    },

    vodStreams: function (categoryId) {
      return api('get_vod_streams', { category_id: categoryId }).then(function (list) {
        return (list || []).map(function (s) {
          return {
            id: 'movie:' + s.stream_id,
            streamId: String(s.stream_id),
            kind: 'movie',
            title: s.name || 'Filme',
            poster: s.stream_icon || s.cover || '',
            groupId: String(s.category_id || ''),
            rating: s.rating || '',
            year: s.year || (s.releaseDate || '').slice(0, 4),
            added: Number(s.added) || 0,
            plot: s.plot || '',
            duration: toSeconds(s.episode_run_time),
            url: w.Xtream.movieUrl(s.stream_id, s.container_extension)
          };
        });
      });
    },

    seriesList: function (categoryId) {
      return api('get_series', { category_id: categoryId }).then(function (list) {
        return (list || []).map(function (s) {
          return {
            id: 'series:' + s.series_id,
            seriesId: String(s.series_id),
            kind: 'series',
            title: s.name || 'Série',
            poster: s.cover || '',
            groupId: String(s.category_id || ''),
            rating: s.rating || '',
            year: (s.releaseDate || s.last_modified || '').slice(0, 4),
            added: Number(s.last_modified) || 0,
            plot: s.plot || ''
          };
        });
      });
    },

    /* Detalhe de uma serie: temporadas com seus episodios. */
    seriesInfo: function (seriesId) {
      return api('get_series_info', { series_id: seriesId }).then(function (d) {
        if (!d) throw new Error('Série não encontrada no servidor.');
        var info = d.info || {};
        var raw = d.episodes || {};
        var seasons = Object.keys(raw)
          .sort(function (a, b) { return Number(a) - Number(b); })
          .map(function (sn) {
            var eps = (raw[sn] || []).map(function (e) {
              var ei = e.info || {};
              return {
                id: 'ep:' + e.id,
                episodeId: String(e.id),
                kind: 'episode',
                seriesId: String(seriesId),
                seriesTitle: info.name || '',
                season: Number(sn),
                episode: Number(e.episode_num) || 0,
                title: e.title || ('Episódio ' + e.episode_num),
                poster: ei.movie_image || info.cover || '',
                plot: ei.plot || '',
                duration: toSeconds(ei.duration_secs || ei.duration),
                url: w.Xtream.episodeUrl(e.id, e.container_extension)
              };
            });
            eps.sort(function (a, b) { return a.episode - b.episode; });
            return { season: Number(sn), episodes: eps };
          });

        return {
          id: 'series:' + seriesId,
          seriesId: String(seriesId),
          title: info.name || 'Série',
          poster: info.cover || '',
          plot: info.plot || '',
          genre: info.genre || '',
          rating: info.rating || '',
          year: (info.releaseDate || '').slice(0, 4),
          seasons: seasons
        };
      });
    },

    movieInfo: function (streamId) {
      return api('get_vod_info', { vod_id: streamId }).then(function (d) {
        var i = (d && d.info) || {};
        var m = (d && d.movie_data) || {};
        return {
          plot: i.plot || i.description || '',
          genre: i.genre || '',
          cast: i.cast || '',
          director: i.director || '',
          rating: i.rating || '',
          year: i.releasedate ? String(i.releasedate).slice(0, 4) : '',
          duration: toSeconds(i.duration_secs || i.duration),
          poster: i.movie_image || i.cover_big || '',
          url: w.Xtream.movieUrl(streamId, m.container_extension)
        };
      });
    },

    /* Programação atual do canal (usada no rodapé do player ao vivo). */
    shortEpg: function (streamId) {
      return api('get_short_epg', { stream_id: streamId, limit: 2 })
        .then(function (d) {
          var list = (d && d.epg_listings) || [];
          return list.map(function (e) {
            var dec = function (s) { try { return decodeURIComponent(escape(atob(s || ''))); }
                                     catch (err) { return ''; } };
            return { title: dec(e.title), desc: dec(e.description),
                     start: e.start, end: e.end };
          });
        })
        .catch(function () { return []; });
    },

    /* ---- Montagem das URLs de reproducao ---- */
    liveUrl: function (streamId) {
      var c = creds();
      var ext = w.CFG.PREFER_HLS_FOR_LIVE ? '.m3u8' : '.ts';
      return c.origin + '/live/' + enc(c.username) + '/' + enc(c.password) + '/' + streamId + ext;
    },
    liveUrlAlt: function (streamId) {
      var c = creds();
      var ext = w.CFG.PREFER_HLS_FOR_LIVE ? '.ts' : '.m3u8';
      return c.origin + '/live/' + enc(c.username) + '/' + enc(c.password) + '/' + streamId + ext;
    },
    movieUrl: function (streamId, ext) {
      var c = creds();
      return c.origin + '/movie/' + enc(c.username) + '/' + enc(c.password) + '/' +
             streamId + '.' + (ext || 'mp4');
    },
    episodeUrl: function (episodeId, ext) {
      var c = creds();
      return c.origin + '/series/' + enc(c.username) + '/' + enc(c.password) + '/' +
             episodeId + '.' + (ext || 'mp4');
    }
  };

  function enc(s) { return encodeURIComponent(s); }

})(window);
