/* =========================================================
   Estado persistente pequeno: ajustes, favoritos e progresso.
   Fica em localStorage (rapido e sincrono). O progresso tambem
   e espelhado na nuvem por cloud.js.
   ========================================================= */
(function (w) {
  'use strict';

  var K_SETTINGS  = 'nebula.settings';
  var K_PROGRESS  = 'nebula.progress';
  var K_FAVORITES = 'nebula.favorites';
  var MAX_PROGRESS = 300;

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  var settings  = read(K_SETTINGS, {});
  var progress  = read(K_PROGRESS, {});
  var favorites = read(K_FAVORITES, {});

  w.Store = {

    /* ---------------- Ajustes ---------------- */
    settings: function () { return settings; },

    get: function (path, fallback) {
      var parts = path.split('.'), node = settings;
      for (var i = 0; i < parts.length; i++) {
        if (node === null || typeof node !== 'object') return fallback;
        node = node[parts[i]];
      }
      return node === undefined ? fallback : node;
    },

    set: function (path, value) {
      var parts = path.split('.'), node = settings;
      for (var i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = value;
      write(K_SETTINGS, settings);
      return value;
    },

    isConfigured: function () {
      return !!w.Store.get('source.url');
    },

    /* ---------------- Favoritos ---------------- */
    isFavorite: function (id) { return !!favorites[id]; },

    toggleFavorite: function (item) {
      if (favorites[item.id]) delete favorites[item.id];
      else favorites[item.id] = {
        id: item.id, kind: item.kind, title: item.title,
        poster: item.poster || '', at: new Date().toISOString()
      };
      write(K_FAVORITES, favorites);
      return !!favorites[item.id];
    },

    favorites: function () {
      return Object.keys(favorites).map(function (k) { return favorites[k]; })
        .sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
    },

    /* ---------------- Progresso ---------------- */
    progressOf: function (id) { return progress[id] || null; },

    allProgress: function () { return progress; },

    /* Substitui todo o mapa (usado ao trazer o historico da nuvem). */
    mergeProgress: function (records) {
      var changed = 0;
      (records || []).forEach(function (r) {
        if (!r || !r.id) return;
        var mine = progress[r.id];
        if (!mine || (r.updated_at || '') > (mine.updated_at || '')) {
          progress[r.id] = r;
          changed++;
        }
      });
      if (changed) { w.Store._trim(); write(K_PROGRESS, progress); }
      return changed;
    },

    saveProgress: function (rec) {
      rec.updated_at = new Date().toISOString();
      if (rec.duration > 0) {
        rec.completed = (rec.position / rec.duration) >= w.CFG.COMPLETED_RATIO;
      }
      progress[rec.id] = rec;
      w.Store._trim();
      write(K_PROGRESS, progress);
      if (w.Cloud) w.Cloud.queue(rec);
      return rec;
    },

    clearProgress: function (id) {
      delete progress[id];
      write(K_PROGRESS, progress);
      if (w.Cloud) w.Cloud.remove(id);
    },

    /* Lista "Continuar assistindo": nao concluidos, mais recentes primeiro. */
    continueList: function (limit) {
      return Object.keys(progress)
        .map(function (k) { return progress[k]; })
        .filter(function (r) {
          return r && !r.completed && r.kind !== 'live' &&
                 r.position >= w.CFG.RESUME_MIN_SEC &&
                 (!r.duration || r.duration - r.position > w.CFG.RESUME_TAIL_SEC);
        })
        .sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); })
        .slice(0, limit || w.CFG.HISTORY_LIMIT);
    },

    /* Historico completo, incluindo o que ja foi assistido. */
    historyList: function (limit) {
      return Object.keys(progress)
        .map(function (k) { return progress[k]; })
        .filter(Boolean)
        .sort(function (a, b) { return (b.updated_at || '').localeCompare(a.updated_at || ''); })
        .slice(0, limit || w.CFG.HISTORY_LIMIT);
    },

    /* Ultimo episodio visto de uma serie, para sugerir o proximo. */
    lastEpisodeOf: function (seriesId) {
      var best = null;
      Object.keys(progress).forEach(function (k) {
        var r = progress[k];
        if (r && r.kind === 'episode' && String(r.series_id) === String(seriesId)) {
          if (!best || (r.updated_at || '') > (best.updated_at || '')) best = r;
        }
      });
      return best;
    },

    _trim: function () {
      var keys = Object.keys(progress);
      if (keys.length <= MAX_PROGRESS) return;
      keys.sort(function (a, b) {
        return (progress[b].updated_at || '').localeCompare(progress[a].updated_at || '');
      }).slice(MAX_PROGRESS).forEach(function (k) { delete progress[k]; });
    },

    /* Apaga tudo (usado no botao "recomeçar do zero" nos ajustes). */
    wipe: function () {
      settings = {}; progress = {}; favorites = {};
      try {
        localStorage.removeItem(K_SETTINGS);
        localStorage.removeItem(K_PROGRESS);
        localStorage.removeItem(K_FAVORITES);
      } catch (e) {}
      if (w.IDB) w.IDB.clear();
    }
  };

})(window);
