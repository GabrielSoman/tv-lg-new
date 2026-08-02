window.NEBULA_FALLBACK_VERSION = "1.0.0+acb0452f";

/* ===== config.js ================================================= */
/* =========================================================
   Configuracoes globais do app.
   Mexa aqui se quiser mudar comportamento sem caçar no codigo.
   ========================================================= */
window.CFG = {
  APP_ID: 'com.gabriel.claudetv',
  VERSION: '1.0.0',

  /* Quando o app roda em http:// (servidor de desenvolvimento no Mac) as
     requisicoes passam por um proxy local, porque o Chrome bloqueia
     chamadas para outro dominio. Na TV o app roda em file:// e vai direto. */
  DEV: location.protocol === 'http:' || location.protocol === 'https:',

  /* Player */
  SAVE_EVERY_MS:      10000,  // grava a posicao a cada 10 segundos
  RESUME_MIN_SEC:     45,     // so pergunta "continuar?" depois de 45s
  RESUME_TAIL_SEC:    90,     // se faltam menos que isso pro fim, recomeça
  COMPLETED_RATIO:    0.93,   // acima disso o item conta como assistido
  SEEK_SMALL_SEC:     10,     // setas esquerda/direita
  SEEK_BIG_SEC:       300,    // setas cima/baixo
  UI_HIDE_MS:         4000,   // tempo ate a barra do player sumir

  /* Catalogo */
  PAGE_SIZE:          90,     // itens renderizados por vez numa grade
  CACHE_TTL_MS:       6 * 60 * 60 * 1000,   // 6 horas
  HISTORY_LIMIT:      60,

  /* Rede */
  REQUEST_TIMEOUT_MS: 20000,
  PREFER_HLS_FOR_LIVE: true   // usa .m3u8 no lugar de .ts nos canais ao vivo
};


/* ===== util.js =================================================== */
/* =========================================================
   Utilidades gerais: DOM, tempo, rede, teclas do controle remoto.
   ========================================================= */
(function (w) {
  'use strict';

  /* ---- Teclas do controle remoto da LG ---- */
  w.KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    OK: 13, ENTER: 13,
    BACK: 461, ESC: 27, BACKSPACE: 8,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 179, STOP: 413,
    FF: 417, RW: 412,
    CH_UP: 33, CH_DOWN: 34,
    INFO: 457
  };

  /* ---- DOM ---- */
  w.$  = function (sel, root) { return (root || document).querySelector(sel); };
  w.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  w.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.indexOf('data-') === 0) node.setAttribute(k, v === true ? '' : v);
        else if (k === 'style') node.setAttribute('style', v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  w.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); };

  /* ---- Texto e tempo ---- */
  w.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  w.fmtTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600),
        m = Math.floor((sec % 3600) / 60),
        s = sec % 60,
        p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  };

  w.fmtLeft = function (sec) {
    var m = Math.round(sec / 60);
    if (m < 1) return 'menos de 1 min';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + 'h ' + r + 'min' : h + 'h';
  };

  w.relTime = function (iso) {
    var t = new Date(iso).getTime();
    if (!t) return '';
    var d = (Date.now() - t) / 1000;
    if (d < 60) return 'agora há pouco';
    if (d < 3600) return 'há ' + Math.floor(d / 60) + ' min';
    if (d < 86400) return 'há ' + Math.floor(d / 3600) + 'h';
    if (d < 604800) return 'há ' + Math.floor(d / 86400) + ' dias';
    return new Date(t).toLocaleDateString('pt-BR');
  };

  /* Remove prefixos de país/qualidade comuns em listas IPTV, só para exibição.
     Ex.: "BR| HBO MAX FHD" -> "HBO MAX" */
  w.cleanName = function (name) {
    return String(name || '')
      .replace(/^[A-Z]{2,4}\s*[|:\-]\s*/, '')
      .replace(/\s*\[(FHD|HD|SD|4K|H265|HEVC)\]\s*/gi, ' ')
      .replace(/\s+(FHD|UHD|4K|H265|HEVC)\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim() || String(name || '');
  };

  w.initials = function (name) {
    var parts = w.cleanName(name).split(/[\s\-|]+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  };

  w.debounce = function (fn, ms) {
    var t;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* ---- Rede ---- */

  /* Em desenvolvimento passa pelo proxy local. Na TV vai direto,
     a menos que um proxy tenha sido configurado nos Ajustes - o que
     resolve o caso do servidor da lista recusar a origem da TV. */
  w.viaProxy = function (url) {
    if (w.CFG.DEV) return '/proxy?url=' + encodeURIComponent(url);
    var p = w.Store ? w.Store.get('source.proxy', '') : '';
    if (!p) return url;
    return p + (p.indexOf('?') >= 0 ? '&' : '?') + 'url=' + encodeURIComponent(url);
  };

  w.fetchText = function (url, opts) {
    opts = opts || {};
    var target = opts.raw ? url : w.viaProxy(url);
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try { xhr.abort(); } catch (e) {}
        reject(new Error('Tempo esgotado ao contatar o servidor.'));
      }, opts.timeout || w.CFG.REQUEST_TIMEOUT_MS);

      xhr.open(opts.method || 'GET', target, true);
      if (opts.headers) {
        Object.keys(opts.headers).forEach(function (h) {
          xhr.setRequestHeader(h, opts.headers[h]);
        });
      }
      xhr.onload = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 400) resolve(xhr.responseText);
        else reject(new Error('O servidor respondeu ' + xhr.status + '.'));
      };
      xhr.onerror = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        reject(new Error('Não foi possível alcançar o servidor.'));
      };
      xhr.send(opts.body || null);
    });
  };

  w.fetchJSON = function (url, opts) {
    return w.fetchText(url, opts).then(function (txt) {
      if (!txt || !txt.trim()) return null;
      try { return JSON.parse(txt); }
      catch (e) { throw new Error('O servidor devolveu algo que não é JSON.'); }
    });
  };

  /* ---- Feedback visual ---- */
  var toastTimer;
  w.toast = function (msg, ms) {
    var t = w.$('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  };

  w.boot = function (show, msg) {
    var b = w.$('#boot');
    if (!b) return;
    if (msg) b.querySelector('span').textContent = msg;
    b.classList.toggle('hidden', !show);
  };

})(window);


/* ===== idb.js ==================================================== */
/* =========================================================
   Armazenamento local grande (IndexedDB).
   Usado para o catalogo em cache: listas de IPTV passam
   facil de 20 MB, o que nao caberia em localStorage.
   Se o IndexedDB falhar, o app continua funcionando -
   so fica sem cache e recarrega do servidor a cada vez.
   ========================================================= */
(function (w) {
  'use strict';

  var DB_NAME = 'nebula', STORE = 'kv', VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!w.indexedDB) return reject(new Error('IndexedDB indisponível'));
      var req = w.indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB')); };
    }).catch(function (e) { dbPromise = null; throw e; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var req = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(req ? req.result : undefined); };
        t.onerror = t.onabort = function () { reject(t.error || new Error('tx')); };
      });
    });
  }

  w.IDB = {
    get: function (key) {
      return tx('readonly', function (s) { return s.get(key); })
        .catch(function () { return undefined; });
    },
    set: function (key, val) {
      return tx('readwrite', function (s) { return s.put(val, key); })
        .catch(function () { return undefined; });
    },
    del: function (key) {
      return tx('readwrite', function (s) { return s.delete(key); })
        .catch(function () { return undefined; });
    },
    clear: function () {
      return tx('readwrite', function (s) { return s.clear(); })
        .catch(function () { return undefined; });
    },

    /* Cache com validade. */
    getFresh: function (key, ttl) {
      return w.IDB.get(key).then(function (rec) {
        if (!rec || !rec.t) return null;
        if (Date.now() - rec.t > (ttl || w.CFG.CACHE_TTL_MS)) return null;
        return rec.v;
      });
    },
    putFresh: function (key, value) {
      return w.IDB.set(key, { t: Date.now(), v: value });
    }
  };

})(window);


/* ===== store.js ================================================== */
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
  var K_CHANNELS  = 'nebula.channels';
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

  /* Limpeza de uma sujeira que a versão anterior deixou: ela
     gravava progresso de canal AO VIVO, que é um número sem
     significado — quando você volta ao canal, o programa é
     outro. Esses registros entupiam "continuar assistindo" e o
     histórico. É a mesma faxina que o `schema-v2.sql` faz no
     banco, só que aqui na TV. */
  (function limparAoVivo() {
    var mudou = false;
    Object.keys(progress).forEach(function (k) {
      var r = progress[k];
      if (r && (r.kind === 'live' || /^(live|canal):/.test(k))) {
        delete progress[k]; mudou = true;
      }
    });
    if (mudou) write(K_PROGRESS, progress);
  }());
  var favorites = read(K_FAVORITES, {});
  var channels  = read(K_CHANNELS, {});

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

    /* ---------------- Hábito de canal ----------------
       Ao vivo não tem "onde parei", mas TEM "o que eu vejo".
       Guardar aberturas e a hora da última é o que deixa a lista
       de canais em ordem de uso em vez de ordem alfabética — e é
       o espelho local da tabela `channel_usage` do schema v2. */
    touchChannel: function (item) {
      if (!item || !item.id) return;
      var r = channels[item.id] || { id: item.id, chave: item.chave || '', aberturas: 0 };
      r.title = item.title || r.title || '';
      r.aberturas++;
      r.at = new Date().toISOString();
      channels[item.id] = r;
      write(K_CHANNELS, channels);
    },

    channelUsage: function (id) { return channels[id] || null; },

    recentChannels: function (limit) {
      return Object.keys(channels).map(function (k) { return channels[k]; })
        .sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); })
        .slice(0, limit || 30);
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


/* ===== cloud.js ================================================== */
/* =========================================================
   Sincronizacao com o Supabase (opcional).
   Regra de ouro: a TV nunca espera a nuvem. Tudo e gravado
   primeiro em localStorage; a nuvem recebe depois, em fila,
   e tenta de novo sozinha se a rede falhar.
   ========================================================= */
(function (w) {
  'use strict';

  var K_QUEUE = 'nebula.cloudq';
  var TABLE   = 'watch_progress';
  var flushTimer = null;
  var flushing = false;
  var lastError = null;

  function cfg() {
    var url = w.Store.get('cloud.url', '');
    var key = w.Store.get('cloud.key', '');
    if (!url || !key) return null;
    return { url: String(url).replace(/\/+$/, ''), key: key };
  }

  function profile() { return w.Store.get('cloud.profile', 'gabriel'); }

  function headers(extra) {
    var c = cfg(), h = {
      'apikey': c.key,
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    };
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function toRow(r) {
    return {
      id:            r.id,
      profile:       profile(),
      kind:          r.kind || 'movie',
      title:         r.title || '',
      subtitle:      r.subtitle || null,
      poster:        r.poster || null,
      stream_url:    r.stream_url || null,
      position_sec:  Math.round(r.position || 0),
      duration_sec:  r.duration ? Math.round(r.duration) : null,
      completed:     !!r.completed,
      series_id:     r.series_id ? String(r.series_id) : null,
      series_title:  r.series_title || null,
      season:        r.season || null,
      episode:       r.episode || null,
      updated_at:    r.updated_at || new Date().toISOString()
    };
  }

  function fromRow(row) {
    return {
      id: row.id, kind: row.kind, title: row.title,
      subtitle: row.subtitle || '', poster: row.poster || '',
      stream_url: row.stream_url || '',
      position: Number(row.position_sec) || 0,
      duration: row.duration_sec ? Number(row.duration_sec) : 0,
      completed: !!row.completed,
      series_id: row.series_id || '', series_title: row.series_title || '',
      season: row.season || 0, episode: row.episode || 0,
      updated_at: row.updated_at
    };
  }

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(K_QUEUE) || '{}'); }
    catch (e) { return {}; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(K_QUEUE, JSON.stringify(q)); } catch (e) {}
  }

  w.Cloud = {

    enabled: function () { return !!cfg(); },
    lastError: function () { return lastError; },
    pending: function () { return Object.keys(loadQueue()).length; },

    /* Traz o historico da nuvem e funde com o que ja existe na TV. */
    pull: function () {
      var c = cfg();
      if (!c) return Promise.resolve(0);
      var url = c.url + '/rest/v1/' + TABLE +
                '?select=*&profile=eq.' + encodeURIComponent(profile()) +
                '&order=updated_at.desc&limit=400';
      return w.fetchJSON(url, { headers: headers(), raw: true })
        .then(function (rows) {
          lastError = null;
          if (!rows || !rows.length) return 0;
          return w.Store.mergeProgress(rows.map(fromRow));
        })
        .catch(function (e) {
          lastError = e.message;
          return 0;
        });
    },

    /* Testa credenciais e a existencia da tabela. */
    test: function () {
      var c = cfg();
      if (!c) return Promise.reject(new Error('Preencha a URL e a chave do Supabase.'));
      return w.fetchJSON(c.url + '/rest/v1/' + TABLE + '?select=id&limit=1',
                         { headers: headers(), raw: true })
        .then(function () { lastError = null; return true; });
    },

    /* Enfileira uma gravacao. Nunca lanca erro. */
    queue: function (rec) {
      if (!cfg()) return;
      var q = loadQueue();
      q[rec.id] = toRow(rec);
      saveQueue(q);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(w.Cloud.flush, 1200);
    },

    remove: function (id) {
      var c = cfg();
      if (!c) return;
      var q = loadQueue();
      delete q[id];
      saveQueue(q);
      w.fetchText(c.url + '/rest/v1/' + TABLE +
                  '?id=eq.' + encodeURIComponent(id) +
                  '&profile=eq.' + encodeURIComponent(profile()),
                  { method: 'DELETE', raw: true,
                    headers: headers({ 'Prefer': 'return=minimal' }) })
       .catch(function () {});
    },

    /* Envia a fila inteira num unico POST (upsert). */
    flush: function () {
      var c = cfg();
      if (!c || flushing) return Promise.resolve(false);
      var q = loadQueue();
      var rows = Object.keys(q).map(function (k) { return q[k]; });
      if (!rows.length) return Promise.resolve(true);

      flushing = true;
      return w.fetchText(c.url + '/rest/v1/' + TABLE + '?on_conflict=id',
        {
          method: 'POST', raw: true,
          headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(rows)
        })
        .then(function () {
          lastError = null;
          /* Remove da fila apenas o que foi enviado; algo pode ter entrado
             na fila enquanto a requisicao estava no ar. */
          var now = loadQueue();
          rows.forEach(function (r) {
            if (now[r.id] && now[r.id].updated_at === r.updated_at) delete now[r.id];
          });
          saveQueue(now);
          flushing = false;
          return true;
        })
        .catch(function (e) {
          lastError = e.message;
          flushing = false;
          /* Tenta de novo daqui a 30 segundos. */
          clearTimeout(flushTimer);
          flushTimer = setTimeout(w.Cloud.flush, 30000);
          return false;
        });
    }
  };

  /* Tenta esvaziar a fila ao abrir e sempre que a rede voltar. */
  w.addEventListener('online', function () { w.Cloud.flush(); });

})(window);


/* ===== m3u.js ==================================================== */
/* =========================================================
   Lista M3U: extracao de credenciais e leitura do arquivo.

   A maioria dos provedores entrega um link no formato
     http://servidor:porta/get.php?username=USER&password=SENHA&type=m3u_plus
   Desse link da para deduzir as credenciais e falar com a API
   Xtream, que devolve um catalogo muito mais organizado
   (categorias, capas, sinopses, temporadas) do que o .m3u cru.
   Se a deducao falhar, o app cai para a leitura do arquivo.
   ========================================================= */
(function (w) {
  'use strict';

  w.M3U = {

    /* Tenta descobrir servidor + usuario + senha a partir da URL. */
    credentialsFrom: function (url) {
      if (!url) return null;
      var clean = String(url).trim();
      var m = clean.match(/^(https?:\/\/[^\/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i);
      if (!m) return null;

      var origin = m[1];
      var path   = m[2] || '';
      var query  = m[3] || '';

      /* Formato 1: parametros na query (get.php?username=..&password=..) */
      var user = null, pass = null;
      query.split('&').forEach(function (pair) {
        var kv = pair.split('=');
        var k = decodeURIComponent(kv[0] || '').toLowerCase();
        var v = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
        if (k === 'username' || k === 'user') user = v;
        if (k === 'password' || k === 'pass') pass = v;
      });

      /* Formato 2: credenciais no caminho (/live/USER/SENHA/... ou /USER/SENHA/) */
      if (!user || !pass) {
        var seg = path.split('/').filter(Boolean);
        if (seg.length >= 2 && ['live', 'movie', 'series'].indexOf(seg[0]) >= 0) {
          user = seg[1]; pass = seg[2];
        } else if (seg.length >= 2 && seg[0].indexOf('.') < 0 && seg[1].indexOf('.') < 0) {
          user = seg[0]; pass = seg[1];
        }
      }

      if (!user || !pass) return null;
      return { origin: origin, username: user, password: pass };
    },

    /* Le e interpreta um arquivo .m3u / .m3u8 de lista. */
    parse: function (text) {
      var lines = String(text || '').split(/\r?\n/);
      var items = [], pending = null, seq = 0;

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        if (line.indexOf('#EXTINF') === 0) {
          pending = parseExtinf(line);
          continue;
        }
        if (line.charAt(0) === '#') continue;   // outras diretivas

        if (pending) {
          pending.url = line;
          pending.id = 'm3u:' + (seq++);
          pending.kind = classify(line, pending.group);
          items.push(pending);
          pending = null;
        }
      }
      return items;
    },

    /* Agrupa os itens por group-title, preservando a ordem de aparicao. */
    groupsOf: function (items) {
      var order = [], byName = {};
      items.forEach(function (it) {
        var g = it.group || 'Sem categoria';
        if (!byName[g]) { byName[g] = []; order.push(g); }
        byName[g].push(it);
      });
      return order.map(function (name) {
        return { id: name, name: name, count: byName[name].length, items: byName[name] };
      });
    }
  };

  function attr(line, name) {
    var re = new RegExp(name + '="([^"]*)"', 'i');
    var m = line.match(re);
    return m ? m[1] : '';
  }

  function parseExtinf(line) {
    var comma = line.indexOf(',');
    var title = comma >= 0 ? line.slice(comma + 1).trim() : '';
    var tvgName = attr(line, 'tvg-name');
    return {
      title: title || tvgName || 'Sem nome',
      tvgId: attr(line, 'tvg-id'),
      poster: attr(line, 'tvg-logo'),
      group: attr(line, 'group-title') || '',
      url: ''
    };
  }

  function classify(url, group) {
    var u = url.toLowerCase();
    var g = (group || '').toLowerCase();
    if (u.indexOf('/series/') >= 0) return 'episode';
    if (u.indexOf('/movie/') >= 0)  return 'movie';
    if (u.indexOf('/live/') >= 0)   return 'live';
    if (/s\d{1,2}\s*e\d{1,2}/i.test(url)) return 'episode';
    if (/(filme|movie|vod|cinema)/.test(g)) return 'movie';
    if (/(serie|série|season|temporada)/.test(g)) return 'episode';
    /* Sem pista melhor: extensao de arquivo costuma indicar conteudo gravado. */
    if (/\.(mp4|mkv|avi|mov)(\?|$)/.test(u)) return 'movie';
    return 'live';
  }

})(window);


/* ===== xtream.js ================================================= */
/* =========================================================
   CLIENTE DA API XTREAM — ClaudeTV
   =========================================================
   Duas coisas descobertas medindo o painel de verdade, e que
   definem este arquivo inteiro:

   1. O painel responde HTTP 200 com CORPO VAZIO quando o
      cliente manda `Accept-Encoding`. E no navegador esse
      cabeçalho é PROIBIDO de alterar — nem XHR nem fetch
      deixam removê-lo. Ou seja: por GET a API nunca
      funcionaria na TV. Por POST funciona, mesmo com gzip
      pedido. Por isso tudo aqui é POST.

   2. `POST` com `application/x-www-form-urlencoded` é uma
      requisição simples de CORS — não dispara preflight. E a
      API devolve `Access-Control-Allow-Origin: *`. Então a TV
      fala direto, sem proxy.

   Tamanhos medidos no provedor: categorias 4 kB, TODOS os
   2.846 canais 820 kB, uma categoria de filmes 85 kB, uma
   série completa 39 kB. Contra 81,5 MB da lista M3U.
   ========================================================= */
(function (w) {
  'use strict';

  function cred() {
    return {
      origem: String(w.Store.get('source.origin', '')).replace(/\/+$/, ''),
      usuario: w.Store.get('source.username', ''),
      senha: w.Store.get('source.password', '')
    };
  }

  /* ---------------------------------------------------------
     Chamada crua
     --------------------------------------------------------- */
  function chamar(acao, params) {
    var c = cred();
    if (!c.origem || !c.usuario) {
      return Promise.reject(new Error('A lista ainda não foi configurada.'));
    }

    var corpo = 'username=' + encodeURIComponent(c.usuario) +
                '&password=' + encodeURIComponent(c.senha);
    if (acao) corpo += '&action=' + acao;
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') {
        corpo += '&' + k + '=' + encodeURIComponent(v);
      }
    });

    return w.fetchJSON(c.origem + '/player_api.php', {
      method: 'POST',
      body: corpo,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      raw: true,                      /* a API tem CORS: vai direto */
      timeout: acao === 'get_live_streams' ? 45000 : w.CFG.REQUEST_TIMEOUT_MS
    });
  }

  /* ---------------------------------------------------------
     Normalização de nomes de canal
     ---------------------------------------------------------
     Separa três coisas que a lista mistura no mesmo texto:
     a REGIÃO (feed), o NOME e a QUALIDADE.

     Isto importa de verdade: `LAT | HBO` é o sinal latino em
     espanhol e `USL- HBO` é outro feed. Agrupar os dois com o
     `HBO` brasileiro faria a troca automática de qualidade
     mudar o idioma do canal no meio do jogo.
     --------------------------------------------------------- */
  var QUALIDADES = ['4K', 'UHD', 'ULTRA HD', '2160P', 'FHD', 'FULL HD', '1080P',
                    'HD', '720P', 'H265', 'HEVC', 'H264', 'SD', '480P', '360P', '60FPS'];

  /* ---------------------------------------------------------
     DUAS ordenações, e a diferença entre elas é proposital.
     ---------------------------------------------------------
     POSTO — a ordem da ESCADA, usada quando a conexão engasga.
     Aqui o H265 fica logo abaixo do 4K, e não lá embaixo: em
     HEVC o mesmo conteúdo cabe em cerca de metade dos bits, e
     o problema que faz o canal travar quase sempre é banda.
     Descer de 4K para H265 alivia a rede sem jogar a imagem
     fora — é o degrau mais inteligente que existe.

     ABERTURA — qual variante tocar ao abrir o canal. Aqui o
     critério é resolução declarada, não economia: se o nome
     não diz a resolução do H265 (e no painel medido não diz),
     abrir nele seria apostar às cegas. Então abre no FHD.

     Se um dia medirmos a resolução real do H265 no aparelho,
     esta segunda tabela é o único lugar a mudar.
     --------------------------------------------------------- */
  var POSTO = {
    '4K': 5, 'UHD': 5, 'ULTRA HD': 5, '2160P': 5,
    'H265': 4, 'HEVC': 4,
    'FHD': 3, 'FULL HD': 3, '1080P': 3,
    'HD': 2, '720P': 2, 'H264': 2,
    'SD': 1, '480P': 1, '360P': 1
  };
  var POSTO_ABERTURA = {
    '4K': 5, 'UHD': 5, 'ULTRA HD': 5, '2160P': 5,
    'FHD': 4, 'FULL HD': 4, '1080P': 4,
    'HD': 3, '720P': 3,
    'H265': 2, 'HEVC': 2, 'H264': 2,
    'SD': 1, '480P': 1, '360P': 1
  };
  var POSTO_PADRAO = 2.5;             /* sem marca: fica no meio */

  var REGIOES = ['LAT', 'USL', 'USA', 'US', 'PT', 'BR', 'ES', 'AR', 'MX',
                 'UK', 'IT', 'FR', 'DE', 'CL', 'CO', 'PY', 'UY'];

  function semAcento(s) {
    var t = String(s || '');
    return t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t;
  }

  /* HD escrito em unicode sobrescrito (ᴴᴰ) aparece na lista e
     passava batido pelo detector. */
  function normalizaUnicode(s) {
    return String(s || '')
      .replace(/ᶠ?ᴴᴰ/g, ' HD ')
      .replace(/⁴ᴷ/g, ' 4K ')
      .replace(/[ᴀ-ᵿʰ-˿]/g, '');
  }

  /* Palavra inteira → palavra inteira. Sempre a forma mais longa
     como destino, para que a variante abreviada caia no grupo que
     já tem escada, e não o contrário. */
  var APELIDOS = [
    [/\bDISC\b/g, 'DISCOVERY'],       /* `DISC Turbo` = `Discovery Turbo` */
    /* o & já virou espaço na limpeza acima, então `H&H` chega
       aqui como `H H` */
    [/\bDISCOVERY H H\b/g, 'DISCOVERY HOME HEALTH']
  ];

  function aplicaApelidos(s) {
    for (var i = 0; i < APELIDOS.length; i++) s = s.replace(APELIDOS[i][0], APELIDOS[i][1]);
    return s.replace(/\s{2,}/g, ' ').trim();
  }

  function decompor(nome) {
    var s = normalizaUnicode(semAcento(nome)).toUpperCase();

    var regiao = '';
    var m = s.match(/^\s*([A-Z]{2,4})\s*[|\-:]\s*/);
    if (m && REGIOES.indexOf(m[1]) >= 0) { regiao = m[1]; s = s.slice(m[0].length); }

    var marcas = [];
    QUALIDADES.forEach(function (q) {
      var re = new RegExp('(^|[\\s\\[\\(\\-|])' +
                          q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                          '($|[\\s\\]\\)\\-|])', 'g');
      if (re.test(s)) { marcas.push(q); s = s.replace(re, ' '); }
    });

    /* preserva + e números: HBO+ ≠ HBO, ESPN 2 ≠ ESPN */
    s = s.replace(/[\[\]()|·!]/g, ' ')
         .replace(/[^A-Z0-9+\s]/g, ' ')
         .replace(/\s{2,}/g, ' ').trim();

    /* O "+" cola no nome. A sonda do 4K achou `HBO+ FHD` e
       `HBO + UHD` virando dois canais lógicos por causa de um
       espaço — e o segundo, sozinho, sem escada nenhuma. */
    s = s.replace(/\s*\+/g, '+');

    /* Apelidos observados na lista. É uma TABELA do que existe,
       não um adivinhador: só entra aqui o que a sonda mostrar,
       porque encurtar nome por conta própria mistura canais que
       não são o mesmo. */
    s = aplicaApelidos(s);

    var posto = POSTO_PADRAO;
    if (marcas.length) {
      posto = 0;
      marcas.forEach(function (q) { posto = Math.max(posto, POSTO[q] || 0); });
      if (!posto) posto = POSTO_PADRAO;
    }

    return {
      regiao: regiao,
      base: s,
      marcas: marcas,
      posto: posto,
      chave: (regiao ? regiao + '::' : '') + s
    };
  }

  function postoDe(marcas, tabela) {
    if (!marcas.length) return POSTO_PADRAO;
    var p = 0;
    marcas.forEach(function (q) { p = Math.max(p, tabela[q] || 0); });
    return p || POSTO_PADRAO;
  }

  /* Rótulo curto da qualidade, para mostrar na interface. */
  function rotuloQualidade(d) {
    if (!d.marcas.length) return '';
    var ordem = d.marcas.slice().sort(function (a, b) {
      return (POSTO[b] || 0) - (POSTO[a] || 0);
    });
    return ordem[0];
  }

  /* ---------------------------------------------------------
     Agrupamento: várias versões do mesmo canal viram UM canal
     com uma escada de qualidade.
     --------------------------------------------------------- */
  function agrupar(canais) {
    var mapa = {}, ordem = [];

    canais.forEach(function (c) {
      var d = decompor(c.name);
      if (!d.base) d.base = String(c.name || '').toUpperCase();
      var k = d.chave;
      if (!mapa[k]) {
        mapa[k] = {
          id: 'canal:' + k,
          kind: 'live',
          chave: k,
          regiao: d.regiao,
          title: '',
          poster: '',
          groupId: String(c.category_id || ''),
          epgId: c.epg_channel_id || '',
          variantes: []
        };
        ordem.push(k);
      }
      var g = mapa[k];
      g.variantes.push({
        streamId: String(c.stream_id),
        nome: c.name,
        qualidade: rotuloQualidade(d),
        posto: d.posto,                  /* ordem da escada */
        postoAbertura: postoDe(d.marcas, POSTO_ABERTURA),
        poster: c.stream_icon || '',
        catId: String(c.category_id || ''),
        num: Number(c.num) || 0
      });
      if (!g.poster && c.stream_icon) g.poster = c.stream_icon;
      if (!g.epgId && c.epg_channel_id) g.epgId = c.epg_channel_id;
    });

    return ordem.map(function (k) {
      var g = mapa[k];
      /* a lista fica na ordem da ESCADA, que é como o player anda */
      g.variantes.sort(function (a, b) { return b.posto - a.posto; });
      var abrir = Xtream.variantePreferida(g);
      g.title = (g.regiao ? g.regiao + ' ' : '') + tituloBonito(g.chave);
      g.streamId = abrir.streamId;
      g.qualidade = abrir.qualidade;
      g.url = Xtream.urlAoVivo(abrir.streamId);
      g.num = abrir.num;
      return g;
    });
  }

  function tituloBonito(chave) {
    var s = chave.indexOf('::') >= 0 ? chave.split('::')[1] : chave;
    return s.replace(/\b([A-Z])([A-Z0-9+]*)\b/g, function (_, a, b) {
      return b.length <= 3 && b === b.toUpperCase() && b.length > 0
        ? a + b                                   /* siglas: HBO, ESPN, TNT */
        : a + b.toLowerCase();
    });
  }

  /* A escada da troca automática. Inclui TUDO, inclusive o 4K:
     quem decide travar numa qualidade é você, pelo menu do player.
     O que impede o vai-e-volta não é excluir degraus, é a espera
     crescente entre tentativas de subir (60s, 3min, 10min). */
  function escada(grupo) {
    return grupo.variantes.slice().sort(function (a, b) { return b.posto - a.posto; });
  }

  /* ---------------------------------------------------------
     DEGRAUS — a escada agrupada por qualidade.
     ---------------------------------------------------------
     A sonda do 4K mostrou uma coisa que eu não esperava: existem
     variantes REPETIDAS na mesma qualidade. `Globo SP UHD` duas
     vezes, `Discovery Channel HD` duas vezes, `Curta! H265` duas
     vezes — stream_ids diferentes, mesma qualidade declarada.

     Isso não é lixo, é rede de segurança: são fontes distintas,
     provavelmente servidores distintos. Então, quando o canal
     engasga, a primeira tentativa não precisa ser perder
     qualidade — é tentar a OUTRA fonte do mesmo degrau. Só
     depois de esgotar as fontes é que se desce.

     E isso também conserta o menu: o OSD lista DEGRAUS, não
     variantes. Ver "UHD" duas vezes na lista não ajudaria
     ninguém a escolher.
     --------------------------------------------------------- */
  function degraus(grupo) {
    var mapa = {}, ordem = [];
    escada(grupo).forEach(function (v) {
      /* `4K` e `UHD` são o mesmo degrau: a sonda confirmou que
         nenhum canal tem os dois, e quando aparecem é sempre a
         mesma coisa escrita de dois jeitos. */
      var rot = (v.qualidade === '4K') ? 'UHD' : (v.qualidade || '—');
      if (!mapa[rot]) { mapa[rot] = { rotulo: rot, posto: v.posto, fontes: [] };
                        ordem.push(rot); }
      mapa[rot].fontes.push(v);
    });
    return ordem.map(function (r) { return mapa[r]; });
  }

  /* ---------------------------------------------------------
     Conversões
     --------------------------------------------------------- */
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function segundos(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var p = s.split(':').map(Number);
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return 0;
  }

  function primeiro(v) {
    if (Array.isArray(v)) return v[0] || '';
    return v || '';
  }

  function categorias(lista, tipo) {
    return (Array.isArray(lista) ? lista : []).map(function (c) {
      return {
        id: String(c.category_id),
        nome: String(c.category_name || 'Sem nome').trim(),
        tipo: tipo
      };
    });
  }

  /* ---------------------------------------------------------
     API
     --------------------------------------------------------- */
  var Xtream = {

    decompor: decompor,
    agrupar: agrupar,
    escada: escada,
    degraus: degraus,

    /* Qual variante tocar ao abrir. Se `catId` vier, prefere a
       variante daquela categoria — é o que faz abrir a Globo pela
       pasta `Canais | 4K` já travar no 4K. */
    variantePreferida: function (grupo, catId) {
      var lista = grupo.variantes;
      if (catId) {
        var daPasta = lista.filter(function (v) { return v.catId === String(catId); });
        if (daPasta.length) {
          return daPasta.slice().sort(function (a, b) {
            return b.postoAbertura - a.postoAbertura;
          })[0];
        }
      }
      return lista.slice().sort(function (a, b) {
        return b.postoAbertura - a.postoAbertura;
      })[0];
    },

    conta: function () {
      return chamar('', {}).then(function (d) {
        if (!d || !d.user_info) throw new Error('O servidor não reconheceu o usuário.');
        if (String(d.user_info.auth) === '0') throw new Error('Usuário ou senha recusados.');
        var u = d.user_info, s = d.server_info || {};
        return {
          status: u.status || '',
          vence: u.exp_date ? new Date(num(u.exp_date) * 1000) : null,
          conexoes: num(u.max_connections) || 1,
          ativas: num(u.active_cons),
          formatos: u.allowed_output_formats || [],
          fuso: s.timezone || '',
          agora: s.timestamp_now ? new Date(num(s.timestamp_now) * 1000) : null
        };
      });
    },

    catAoVivo:  function () { return chamar('get_live_categories').then(function (r) { return categorias(r, 'live'); }); },
    catFilmes:  function () { return chamar('get_vod_categories').then(function (r) { return categorias(r, 'movie'); }); },
    catSeries:  function () { return chamar('get_series_categories').then(function (r) { return categorias(r, 'series'); }); },

    /* Sem categoria = todos os canais. São 820 kB; cabe. */
    canais: function (catId) {
      return chamar('get_live_streams', { category_id: catId }).then(function (lista) {
        return Array.isArray(lista) ? lista : [];
      });
    },

    filmes: function (catId) {
      return chamar('get_vod_streams', { category_id: catId }).then(function (lista) {
        return (Array.isArray(lista) ? lista : []).map(function (f) {
          return {
            id: 'movie:' + f.stream_id,
            streamId: String(f.stream_id),
            kind: 'movie',
            title: f.name || 'Filme',
            poster: f.stream_icon || '',
            groupId: String(f.category_id || ''),
            rating: f.rating || '',
            ano: String(f.year || '').slice(0, 4),
            added: num(f.added),
            duracao: segundos(f.episode_run_time),
            url: Xtream.urlFilme(f.stream_id, f.container_extension)
          };
        });
      });
    },

    /* `get_series` já traz sinopse, elenco, gênero e backdrop —
       a grade de séries não precisa de chamada extra. */
    series: function (catId) {
      return chamar('get_series', { category_id: catId }).then(function (lista) {
        return (Array.isArray(lista) ? lista : []).map(function (s) {
          return {
            id: 'series:' + s.series_id,
            seriesId: String(s.series_id),
            kind: 'series',
            title: s.name || 'Série',
            poster: s.cover || '',
            fundo: primeiro(s.backdrop_path),
            groupId: String(s.category_id || ''),
            rating: s.rating || '',
            ano: String(s.releaseDate || '').slice(0, 4),
            genero: s.genre || '',
            sinopse: s.plot || '',
            elenco: s.cast || '',
            direcao: s.director || '',
            trailer: s.youtube_trailer || '',
            added: num(s.last_modified),
            duracaoEp: segundos(s.episode_run_time)
          };
        });
      });
    },

    serie: function (seriesId) {
      return chamar('get_series_info', { series_id: seriesId }).then(function (d) {
        if (!d) throw new Error('Série não encontrada.');
        var info = d.info || {};
        var cru = d.episodes || {};
        var temporadas = Object.keys(cru)
          .sort(function (a, b) { return Number(a) - Number(b); })
          .map(function (t) {
            var eps = (cru[t] || []).map(function (e) {
              var ei = e.info || {};
              return {
                id: 'ep:' + e.id,
                episodeId: String(e.id),
                kind: 'episode',
                seriesId: String(seriesId),
                seriesTitle: info.name || '',
                temporada: num(e.season) || Number(t),
                episodio: num(e.episode_num),
                title: e.title || ('Episódio ' + e.episode_num),
                poster: ei.movie_image || info.cover || '',
                sinopse: ei.plot || '',
                duracao: segundos(ei.duration_secs || ei.duration),
                url: Xtream.urlEpisodio(e.id, e.container_extension)
              };
            });
            eps.sort(function (a, b) { return a.episodio - b.episodio; });
            return { temporada: Number(t), episodios: eps };
          });

        return {
          id: 'series:' + seriesId,
          seriesId: String(seriesId),
          title: info.name || 'Série',
          poster: info.cover || '',
          fundo: primeiro(info.backdrop_path),
          sinopse: info.plot || '',
          genero: info.genre || '',
          rating: info.rating || '',
          ano: String(info.releaseDate || '').slice(0, 4),
          elenco: info.cast || '',
          direcao: info.director || '',
          temporadas: temporadas
        };
      });
    },

    filme: function (streamId) {
      return chamar('get_vod_info', { vod_id: streamId }).then(function (d) {
        var i = (d && d.info) || {};
        var m = (d && d.movie_data) || {};
        return {
          tmdb: i.tmdb_id || '',
          sinopse: i.plot || i.description || '',
          genero: i.genero || i.genre || '',
          elenco: i.cast || i.actors || '',
          direcao: i.director || '',
          rating: i.rating || '',
          ano: String(i.releasedate || '').slice(0, 4),
          duracao: segundos(i.duration_secs || i.duration),
          poster: i.movie_image || i.cover_big || '',
          fundo: primeiro(i.backdrop_path),
          trailer: i.youtube_trailer || '',
          pais: i.country || '',
          idade: i.age || i.mpaa_rating || '',
          url: Xtream.urlFilme(streamId, m.container_extension)
        };
      });
    },

    /* O que está passando agora e a seguir, 1 kB por canal. */
    epgCurto: function (streamId, quantos) {
      return chamar('get_short_epg', { stream_id: streamId, limit: quantos || 2 })
        .then(function (d) {
          var lista = (d && d.epg_listings) || [];
          return lista.map(function (e) {
            return {
              titulo: base64(e.title),
              descricao: base64(e.description),
              inicio: e.start,
              fim: e.end,
              inicioTs: num(e.start_timestamp) * 1000,
              fimTs: num(e.stop_timestamp) * 1000,
              agora: String(e.now_playing) === '1'
            };
          });
        })
        .catch(function () { return []; });
    },

    /* ---- URLs de reprodução ---- */
    urlAoVivo: function (streamId, formato) {
      var c = cred();
      var ext = formato || (w.CFG.PREFER_HLS_FOR_LIVE ? '.m3u8' : '.ts');
      return c.origem + '/live/' + enc(c.usuario) + '/' + enc(c.senha) + '/' + streamId + ext;
    },
    urlFilme: function (streamId, ext) {
      var c = cred();
      return c.origem + '/movie/' + enc(c.usuario) + '/' + enc(c.senha) + '/' +
             streamId + '.' + (ext || 'mp4');
    },
    urlEpisodio: function (epId, ext) {
      var c = cred();
      return c.origem + '/series/' + enc(c.usuario) + '/' + enc(c.senha) + '/' +
             epId + '.' + (ext || 'mp4');
    }
  };

  function enc(s) { return encodeURIComponent(s); }

  function base64(s) {
    if (!s) return '';
    try { return decodeURIComponent(escape(w.atob(s))); }
    catch (e) { return String(s); }
  }

  w.Xtream = Xtream;

})(window);


/* ===== catalog.js ================================================ */
/* =========================================================
   CATÁLOGO — ClaudeTV
   =========================================================
   Camada única entre as telas e o servidor. Três trabalhos:

     · buscar pela API, com cache por chave granular no
       IndexedDB — nunca um blob único;
     · agrupar canais duplicados numa escada de qualidade;
     · filtrar conteúdo adulto NA ORIGEM, para que ele nunca
       apareça em recomendação, busca ou histórico.

   O que mudou desde a versão anterior: ela baixava uma lista
   M3U de 81,5 MB e montava 290 mil objetos na memória da TV.
   Aqui a maior chamada tem 820 kB, e é a única que carrega
   tudo de uma vez.
   ========================================================= */
(function (w) {
  'use strict';

  var memoria = {};        /* cache da sessão, por cima do IndexedDB */

  /* ---------------------------------------------------------
     Cache
     --------------------------------------------------------- */
  function guardado(chave, produtor, validade) {
    if (memoria[chave]) return Promise.resolve(memoria[chave]);
    return w.IDB.getFresh(chave, validade || w.CFG.CACHE_TTL_MS).then(function (achado) {
      if (achado) { memoria[chave] = achado; return achado; }
      return produtor().then(function (novo) {
        memoria[chave] = novo;
        w.IDB.putFresh(chave, novo);
        return novo;
      });
    });
  }

  /* ---------------------------------------------------------
     Conteúdo adulto
     ---------------------------------------------------------
     Detectado pelo nome da categoria. Nada disso é padronizado
     entre provedores, então a lista é editável nos Ajustes.
     No provedor medido, as oito categorias adultas foram
     pegas corretamente.
     --------------------------------------------------------- */
  var ADULTO = /(^|\W)(adulto?s?|adultas?|xxx|\+?18\+?|adult|porn|erotic|eroticos?|hentai)(\W|$)/i;

  function semAcento(s) {
    var t = String(s || '');
    return t.normalize ? t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : t;
  }

  function ehAdulta(nome) {
    var extras = w.Store.get('adulto.categorias', []) || [];
    var liberadas = w.Store.get('adulto.liberadas', []) || [];
    var n = String(nome || '').trim();
    if (liberadas.indexOf(n) >= 0) return false;
    if (extras.indexOf(n) >= 0) return true;
    return ADULTO.test(semAcento(n));
  }

  /* Um Set com os ids das categorias adultas, para filtrar itens. */
  var idsAdultas = null;
  function marcarAdultas(cats) {
    if (!idsAdultas) idsAdultas = {};
    cats.forEach(function (c) { if (ehAdulta(c.nome)) idsAdultas[c.id] = true; });
    return cats;
  }

  function esconder() { return !!w.Store.get('adulto.ocultar', false); }

  function filtraCats(cats) {
    marcarAdultas(cats);
    return esconder() ? cats.filter(function (c) { return !ehAdulta(c.nome); }) : cats;
  }

  /* ---------------------------------------------------------
     Conexão
     --------------------------------------------------------- */
  var Catalog = {

    ehAdulta: ehAdulta,

    /* A categoria de um item é adulta? Usado pelo player e pelo
       histórico para NÃO gravar nada desse conteúdo. */
    itemAdulto: function (item) {
      if (!item) return false;
      if (item.adulto) return true;
      return !!(idsAdultas && item.groupId && idsAdultas[item.groupId]);
    },

    conectar: function (url, passo) {
      var diz = passo || function () {};
      url = String(url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        return Promise.reject(new Error('O endereço precisa começar com http:// ou https://'));
      }

      var c = w.M3U.credentialsFrom(url);
      if (!c) {
        return Promise.reject(new Error(
          'Não consegui achar usuário e senha nesse endereço. ' +
          'Ele precisa ser do tipo get.php?username=…&password=…'));
      }

      w.Store.set('source.url', url);
      w.Store.set('source.origin', c.origin);
      w.Store.set('source.username', c.username);
      w.Store.set('source.password', c.password);
      w.Store.set('source.mode', 'xtream');
      memoria = {}; idsAdultas = null;

      diz('Falando com o servidor…');
      return w.Xtream.conta().then(function (conta) {
        w.Store.set('source.account', {
          status: conta.status,
          vence: conta.vence ? conta.vence.toISOString() : null,
          conexoes: conta.conexoes,
          fuso: conta.fuso
        });
        diz('Conectado. ' + conta.conexoes +
            (conta.conexoes === 1 ? ' conexão simultânea.' : ' conexões simultâneas.'));
        return w.IDB.clear().then(function () { return conta; });
      });
    },

    /* ---------------------------------------------------------
       Categorias
       --------------------------------------------------------- */
    categorias: function (tipo) {
      var fn = tipo === 'live' ? w.Xtream.catAoVivo
             : tipo === 'movie' ? w.Xtream.catFilmes
             : w.Xtream.catSeries;
      return guardado('cat:' + tipo, fn).then(filtraCats);
    },

    /* ---------------------------------------------------------
       Canais: baixa TODOS uma vez (820 kB) e agrupa.
       É o que viabiliza busca instantânea, ordenação por hábito,
       zapping por número e a escada de qualidade.
       --------------------------------------------------------- */
    canais: function () {
      return guardado('canais', function () {
        return w.Xtream.canais('').then(function (crus) {
          return w.Xtream.agrupar(crus);
        });
      }).then(function (lista) {
        if (!idsAdultas) {
          /* garante que as categorias já foram lidas ao menos uma vez */
          return Catalog.categorias('live').then(function () { return lista; });
        }
        return lista;
      }).then(function (lista) {
        return esconder()
          ? lista.filter(function (g) { return !(idsAdultas && idsAdultas[g.groupId]); })
          : lista;
      });
    },

    /* Canais de uma categoria. A variante de abertura passa a ser a
       DAQUELA categoria — é o que faz abrir a Globo pela pasta
       `Canais | 4K` já começar travada em 4K, sem menu nenhum. */
    canaisDaCategoria: function (catId) {
      return Catalog.canais().then(function (todos) {
        return todos
          .filter(function (g) {
            return g.variantes.some(function (v) { return v.catId === String(catId); });
          })
          .map(function (g) {
            var v = w.Xtream.variantePreferida(g, catId);
            var copia = {};
            Object.keys(g).forEach(function (k) { copia[k] = g[k]; });
            copia.streamId = v.streamId;
            copia.qualidade = v.qualidade;
            copia.url = w.Xtream.urlAoVivo(v.streamId);
            /* Abrir por uma pasta de qualidade entra travado naquela
               qualidade até você trocar de canal.

               "Travado" quer dizer apenas: comece aqui e NÃO troque
               sozinho. Não quer dizer esconder o resto — copia.variantes
               continua sendo a escada inteira do canal lógico, vinda de
               todas as pastas. É de propósito: se o 4K engasgar, os
               degraus menores estão ali no menu do player, e você não
               precisa sair caçando o mesmo canal em outra pasta. */
            copia.travada = ehPastaDeQualidade(catId) ? v.qualidade : '';
            return copia;
          });
      });
    },

    /* Escada de qualidade, da melhor para a pior. Inclui o 4K:
       quem trava numa qualidade é o usuário, pelo menu do player. */
    escada: function (grupo) { return w.Xtream.escada(grupo); },

    /* A mesma escada, agrupada por qualidade. É esta que o menu do
       player mostra — e é dela que sai a regra de "tenta a outra
       fonte do mesmo degrau antes de perder resolução". */
    degraus: function (grupo) { return w.Xtream.degraus(grupo); },

    /* ---------------------------------------------------------
       Filmes e séries: por categoria, sob demanda
       --------------------------------------------------------- */
    itens: function (tipo, catId) {
      if (tipo === 'live') return Catalog.canaisDaCategoria(catId);
      var fn = tipo === 'movie' ? w.Xtream.filmes : w.Xtream.series;
      return guardado('itens:' + tipo + ':' + catId, function () { return fn(catId); });
    },

    serie: function (seriesId) {
      return guardado('serie:' + seriesId, function () { return w.Xtream.serie(seriesId); });
    },

    filme: function (streamId) {
      return guardado('filme:' + streamId, function () { return w.Xtream.filme(streamId); })
        .catch(function () { return null; });
    },

    epg: function (streamId) {
      /* validade curta: o que está passando muda o tempo todo */
      return guardado('epg:' + streamId, function () {
        return w.Xtream.epgCurto(streamId, 2);
      }, 5 * 60 * 1000);
    },

    /* ---------------------------------------------------------
       Busca
       ---------------------------------------------------------
       Os canais já estão todos em memória. Filmes e séries entram
       no índice conforme as categorias vão sendo abertas — e há
       um comando para carregar tudo, que é caro e explícito.
       --------------------------------------------------------- */
    indice: function () {
      var pedacos = [Catalog.canais()];
      Object.keys(memoria).forEach(function (k) {
        if (k.indexOf('itens:') === 0) pedacos.push(Promise.resolve(memoria[k]));
      });
      return Promise.all(pedacos).then(function (grupos) {
        var saida = [];
        grupos.forEach(function (g) {
          (g || []).forEach(function (it) {
            saida.push({
              id: it.id, kind: it.kind, title: it.title, poster: it.poster,
              url: it.url, seriesId: it.seriesId, streamId: it.streamId,
              groupId: it.groupId, n: normaliza(it.title)
            });
          });
        });
        return saida;
      });
    },

    /* Índice completo: pede todas as categorias de filmes e séries.
       Custa alguns megabytes, então só quando o usuário mandar. */
    indiceCompleto: function (passo) {
      var diz = passo || function () {};
      return Catalog.categorias('movie').then(function (cats) {
        return emSerie(cats, function (c, i) {
          diz('Filmes: ' + (i + 1) + ' de ' + cats.length + ' categorias…');
          return Catalog.itens('movie', c.id).catch(function () { return []; });
        });
      }).then(function () {
        return Catalog.categorias('series');
      }).then(function (cats) {
        return emSerie(cats, function (c, i) {
          diz('Séries: ' + (i + 1) + ' de ' + cats.length + ' categorias…');
          return Catalog.itens('series', c.id).catch(function () { return []; });
        });
      }).then(function () {
        diz('Índice pronto.');
        return Catalog.indice();
      });
    },

    buscar: function (termo, indice) {
      var q = normaliza(termo);
      if (q.length < 2) return [];
      var partes = q.split(' ').filter(Boolean);
      var achados = [];
      for (var i = 0; i < indice.length && achados.length < 300; i++) {
        var it = indice[i];
        var alvo = it.n || (it.n = normaliza(it.title));
        var serve = true;
        for (var p = 0; p < partes.length; p++) {
          if (alvo.indexOf(partes[p]) < 0) { serve = false; break; }
        }
        if (serve) achados.push(it);
      }
      achados.sort(function (a, b) {
        var A = a.n.indexOf(partes[0]) === 0 ? 0 : 1;
        var B = b.n.indexOf(partes[0]) === 0 ? 0 : 1;
        return A - B || a.title.length - b.title.length;
      });
      return achados;
    },

    /* ---------------------------------------------------------
       Relacionados — franquia, depois semelhança, depois gênero
       --------------------------------------------------------- */
    relacionados: function (item, universo, quantos) {
      var base = normaliza(item.title);
      var meuGenero = (item.genero || '').toLowerCase();
      var saida = [];

      universo.forEach(function (o) {
        if (o.id === item.id) return;
        if (esconder() && idsAdultas && idsAdultas[o.groupId]) return;
        var alvo = normaliza(o.title);
        var nota = 0;

        var pref = prefixoComum(base, alvo);
        if (pref.length >= 8 && pref.trim().split(' ').length >= 2) nota += 100;

        nota += jaroWinkler(base, alvo) * 40;

        if (meuGenero && o.genero) {
          var meus = meuGenero.split(/[,\/]/).map(trim);
          var dele = o.genero.toLowerCase().split(/[,\/]/).map(trim);
          var comuns = meus.filter(function (g) { return g && dele.indexOf(g) >= 0; });
          nota += comuns.length * 12;
        }
        if (o.groupId && item.groupId && o.groupId === item.groupId) nota += 6;
        if (o.ano && item.ano) nota += Math.max(0, 5 - Math.abs(Number(o.ano) - Number(item.ano)));

        if (nota > 30) saida.push({ item: o, nota: nota });
      });

      saida.sort(function (a, b) { return b.nota - a.nota; });
      return saida.slice(0, quantos || 20).map(function (x) { return x.item; });
    },

    /* ---------------------------------------------------------
       Manutenção
       --------------------------------------------------------- */
    limparCache: function () {
      memoria = {}; idsAdultas = null;
      return w.IDB.clear();
    },

    emMemoria: function () { return Object.keys(memoria).length; }
  };

  /* ---------------------------------------------------------
     Auxiliares
     --------------------------------------------------------- */
  function trim(s) { return String(s || '').trim(); }

  /* Categorias que são um recorte de QUALIDADE e não de assunto,
     tipo `Canais | 4K`. Abrir por elas é um pedido explícito. */
  var CATS_QUALIDADE = /(^|\W)(4k|uhd|ultra ?hd|fhd|h265|hevc)(\W|$)/i;
  function ehPastaDeQualidade(nome) {
    var cats = memoria['cat:live'] || [];
    var achada = cats.filter(function (c) { return c.id === String(nome); })[0];
    return achada ? CATS_QUALIDADE.test(semAcento(achada.nome)) : false;
  }

  /* Minúsculas, sem acento, sem marcações de qualidade e sem o
     ano entre parênteses. Metade do trabalho de "relacionados"
     é limpar o título antes de comparar. */
  function normaliza(s) {
    var t = String(s || '').toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t
      .replace(/\b(4k|uhd|fhd|full ?hd|hd|sd|h265|hevc|h264|1080p|720p|480p|dub|dublado|leg|legendado)\b/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\((\d{4})\)/g, ' ')
      .replace(/[^a-z0-9+ ]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function prefixoComum(a, b) {
    var n = Math.min(a.length, b.length), i = 0;
    while (i < n && a[i] === b[i]) i++;
    return a.slice(0, i);
  }

  /* Jaro-Winkler favorece prefixos iguais, que é exatamente o
     caso de franquia e continuação. */
  function jaroWinkler(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var alcance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    var marcaA = new Array(a.length), marcaB = new Array(b.length);
    var iguais = 0;

    for (var i = 0; i < a.length; i++) {
      var ini = Math.max(0, i - alcance), fim = Math.min(i + alcance + 1, b.length);
      for (var j = ini; j < fim; j++) {
        if (marcaB[j] || a[i] !== b[j]) continue;
        marcaA[i] = marcaB[j] = true; iguais++; break;
      }
    }
    if (!iguais) return 0;

    var trocas = 0, k = 0;
    for (var x = 0; x < a.length; x++) {
      if (!marcaA[x]) continue;
      while (!marcaB[k]) k++;
      if (a[x] !== b[k]) trocas++;
      k++;
    }
    trocas /= 2;

    var jaro = (iguais / a.length + iguais / b.length + (iguais - trocas) / iguais) / 3;
    var pref = 0;
    while (pref < 4 && pref < a.length && pref < b.length && a[pref] === b[pref]) pref++;
    return jaro + pref * 0.1 * (1 - jaro);
  }

  /* Uma promessa de cada vez: o servidor tem 1 conexão e não
     gosta de rajada. */
  function emSerie(lista, fn) {
    var saida = [];
    return lista.reduce(function (p, item, i) {
      return p.then(function () {
        return fn(item, i).then(function (r) { saida.push(r); });
      });
    }, Promise.resolve()).then(function () { return saida; });
  }

  w.Catalog = Catalog;

})(window);


/* ===== nav.js ==================================================== */
/* =========================================================
   MOTOR DE NAVEGAÇÃO — ClaudeTV
   =========================================================
   Substitui a busca geométrica global, que era a causa de o
   app inteiro se comportar como uma coluna só.

   A tela é uma árvore de REGIÕES declaradas no HTML. O foco
   anda dentro da região conforme o eixo dela. Ao chegar na
   borda, ou existe um vizinho declarado naquela direção, ou o
   foco PARA. Não há busca global. "Não há para onde ir" é uma
   resposta legítima.

   ---------------------------------------------------------
   CONTRATO DO HTML
   ---------------------------------------------------------
     <div data-region="cats"
          data-axis="y"              x | y | grid | rows
          data-nb-left="rail"        vizinho ao sair pela esquerda
          data-nb-right="grid"
          data-enter="last"          last | first | seletor CSS
          data-wrap="y">             eixos em que dá a volta
       <button data-focusable>…</button>
     </div>

   Eixo `rows`: a região contém elementos [data-row]; esquerda
   e direita andam dentro da fileira, cima e baixo trocam de
   fileira mantendo a posição horizontal.

   Rolagem: o elemento com [data-scroll="x|y"] é o trilho que
   se move; o pai dele é a janela. A janela precisa ter
   `overflow: hidden`, e o trilho `position: relative`.
   ========================================================= */
(function (w) {
  'use strict';

  var doc = document;

  w.KEY = w.KEY || {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    OK: 13, BACK: 461, ESC: 27, BACKSPACE: 8,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 179, STOP: 413,
    FF: 417, RW: 412, CH_UP: 33, CH_DOWN: 34, INFO: 457
  };

  var MARGEM = { topo: 120, base: 160, lado: 96 };   // px absolutos

  var atual = null;
  var escopo = null;
  var ouvintes = [];
  var pendente = null;
  var quadro = null;

  /* ---------------------------------------------------------
     Consultas
     --------------------------------------------------------- */
  function todos(sel, raiz) {
    return Array.prototype.slice.call((raiz || escopo || doc).querySelectorAll(sel));
  }

  /* Visível = está no layout. Estar recortado por overflow NÃO
     desqualifica: é justamente para esses que a rolagem serve. */
  function visivel(el) {
    if (!el || el.offsetParent === null) return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0;
  }

  function focaveis(raiz) {
    return todos('[data-focusable]', raiz).filter(visivel);
  }

  function regiaoDe(el) {
    var n = el;
    while (n && n !== doc.body) {
      if (n.hasAttribute && n.hasAttribute('data-region')) {
        if (escopo && !escopo.contains(n)) return null;
        return n;
      }
      n = n.parentElement;
    }
    return null;
  }

  function regiaoPorNome(nome) {
    return (escopo || doc).querySelector('[data-region="' + nome + '"]');
  }

  function eixoDe(reg) { return reg.getAttribute('data-axis') || 'y'; }

  function daVolta(reg, eixo) {
    return (reg.getAttribute('data-wrap') || '').indexOf(eixo) >= 0;
  }

  function fileiraDe(el, reg) {
    var n = el;
    while (n && n !== reg) {
      if (n.hasAttribute && n.hasAttribute('data-row')) return n;
      n = n.parentElement;
    }
    return null;
  }

  /* ---------------------------------------------------------
     Geometria — só dentro de uma região
     --------------------------------------------------------- */
  function r(el) { return el.getBoundingClientRect(); }
  function centroX(b) { return (b.left + b.right) / 2; }

  function sobreposicaoX(a, b) {
    var ini = Math.max(a.left, b.left), fim = Math.min(a.right, b.right);
    var base = Math.min(a.width, b.width) || 1;
    return Math.max(0, fim - ini) / base;
  }

  function mesmaLinha(a, b) {
    return Math.abs(a.top - b.top) < Math.max(a.height, b.height, 1) * 0.5;
  }

  /* ---------------------------------------------------------
     Movimento dentro da região
     --------------------------------------------------------- */
  function passoInterno(reg, el, dir) {
    var eixo = eixoDe(reg);
    if (eixo === 'rows') return passoFileiras(reg, el, dir);

    var lista = focaveis(reg);
    var i = lista.indexOf(el);
    if (i < 0) return null;

    if (eixo === 'x') {
      if (dir === 'right') return lista[i + 1] || null;
      if (dir === 'left') return lista[i - 1] || null;
      return null;
    }
    if (eixo === 'y') {
      if (dir === 'down') return lista[i + 1] || null;
      if (dir === 'up') return lista[i - 1] || null;
      return null;
    }
    if (eixo === 'grid') {
      if (dir === 'left' || dir === 'right') {
        var viz = lista[i + (dir === 'right' ? 1 : -1)];
        /* só anda para o lado dentro da MESMA linha; na ponta, para */
        return (viz && mesmaLinha(r(viz), r(el))) ? viz : null;
      }
      return gradeVertical(lista, i, dir);
    }
    return null;
  }

  /* Cima/baixo numa grade: linha vizinha, escolhida por
     sobreposição de projeção — não por distância em diagonal.
     É isso que faz o foco descer em coluna. */
  function gradeVertical(lista, i, dir) {
    var meu = r(lista[i]);
    var cand = [];
    for (var k = 0; k < lista.length; k++) {
      if (k === i) continue;
      var b = r(lista[k]);
      if (mesmaLinha(b, meu)) continue;
      if (dir === 'down' && b.top <= meu.top) continue;
      if (dir === 'up' && b.top >= meu.top) continue;
      cand.push({ el: lista[k], b: b });
    }
    if (!cand.length) return null;

    var alvo = cand[0].b.top;
    cand.forEach(function (c) {
      if (dir === 'down' ? c.b.top < alvo : c.b.top > alvo) alvo = c.b.top;
    });
    var linha = cand.filter(function (c) {
      return Math.abs(c.b.top - alvo) < Math.max(c.b.height, 1) * 0.5;
    });

    var melhor = null, nota = -1;
    linha.forEach(function (c) {
      var s = sobreposicaoX(meu, c.b);
      if (s > nota) { nota = s; melhor = c.el; }
    });
    if (nota >= 0.3) return melhor;

    var perto = null, dist = Infinity;
    linha.forEach(function (c) {
      var d = Math.abs(centroX(c.b) - centroX(meu));
      if (d < dist) { dist = d; perto = c.el; }
    });
    return perto || melhor;
  }

  function passoFileiras(reg, el, dir) {
    var fileiras = todos('[data-row]', reg).filter(function (f) {
      return focaveis(f).length > 0;
    });
    var minha = fileiraDe(el, reg);
    var fi = fileiras.indexOf(minha);
    if (fi < 0) return null;

    if (dir === 'left' || dir === 'right') {
      var itens = focaveis(minha);
      var i = itens.indexOf(el);
      return itens[i + (dir === 'right' ? 1 : -1)] || null;
    }

    var prox = fileiras[fi + (dir === 'down' ? 1 : -1)];
    if (!prox) return null;
    var alvos = focaveis(prox);
    if (!alvos.length) return null;

    /* mantém a posição horizontal ao trocar de fileira */
    var cx = centroX(r(el));
    var melhor = alvos[0], dist = Infinity;
    alvos.forEach(function (a) {
      var d = Math.abs(centroX(r(a)) - cx);
      if (d < dist) { dist = d; melhor = a; }
    });
    return melhor;
  }

  function volta(reg, el, dir) {
    var eixo = eixoDe(reg);
    var horizontal = (dir === 'left' || dir === 'right');
    if (!daVolta(reg, horizontal ? 'x' : 'y')) return null;

    var lista;
    if (eixo === 'rows') {
      if (!horizontal) return null;
      var minha = fileiraDe(el, reg);
      if (!minha) return null;
      lista = focaveis(minha);
    } else {
      if (eixo === 'x' && !horizontal) return null;
      if (eixo === 'y' && horizontal) return null;
      lista = focaveis(reg);
    }
    if (lista.length < 2 || lista.indexOf(el) < 0) return null;
    return (dir === 'right' || dir === 'down') ? lista[0] : lista[lista.length - 1];
  }

  /* ---------------------------------------------------------
     Entrar numa região vizinha
     --------------------------------------------------------- */
  function entrarNa(nome) {
    return entrarNaRegiao(regiaoPorNome(nome));
  }

  function entrarNaRegiao(reg) {
    if (!reg) return null;
    var lista = focaveis(reg);
    if (!lista.length) return null;

    var modo = reg.getAttribute('data-enter') || 'last';
    if (modo === 'first') return lista[0];
    if (modo !== 'last') {
      var alvo = reg.querySelector(modo);
      return (alvo && visivel(alvo)) ? alvo : lista[0];
    }
    var lembrado = reg._ultimoFoco;
    if (lembrado && doc.contains(lembrado) && lista.indexOf(lembrado) >= 0) return lembrado;
    return lista[0];
  }

  var OPOSTO = { left: 'right', right: 'left', up: 'down', down: 'up' };

  /* Grava, na região de destino, o caminho de volta. */
  function marcarRetorno(destino, dir, origem) {
    if (!destino || destino === origem) return;
    destino._retorno = { dir: OPOSTO[dir], reg: origem };
  }

  /* ---------------------------------------------------------
     Rolagem — determinística
     ---------------------------------------------------------
     Mede por offsetTop/offsetLeft, que não mudam durante uma
     transição. O motor antigo media com getBoundingClientRect
     no meio da animação e acumulava erro a cada tecla.
     --------------------------------------------------------- */
  function trilhos(el) {
    var out = [], n = el.parentElement;
    while (n && n !== doc.body) {
      if (n.hasAttribute && n.hasAttribute('data-scroll')) out.push(n);
      n = n.parentElement;
    }
    return out;
  }

  function posicaoEm(el, ancestral) {
    var x = 0, y = 0, n = el, guarda = 0;
    while (n && n !== ancestral && n !== doc.body && guarda++ < 50) {
      x += n.offsetLeft; y += n.offsetTop;
      n = n.offsetParent;
    }
    return { x: x, y: y };
  }

  function desloc(t) {
    return { x: Number(t.getAttribute('data-off-x') || 0),
             y: Number(t.getAttribute('data-off-y') || 0) };
  }

  function aplicaDesloc(t, x, y) {
    x = Math.round(x); y = Math.round(y);
    t.setAttribute('data-off-x', x);
    t.setAttribute('data-off-y', y);
    t.style.transform = 'translate3d(' + (-x) + 'px,' + (-y) + 'px,0)';
  }

  function areaUtil(janela) {
    var cs = w.getComputedStyle(janela);
    return {
      largura: janela.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0),
      altura:  janela.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0)
    };
  }

  function garanteVisivel(el) {
    trilhos(el).forEach(function (t) {
      var janela = t.parentElement;
      if (!janela) return;
      var eixo = t.getAttribute('data-scroll');
      var util = areaUtil(janela);
      var pos = posicaoEm(el, t);
      var off = desloc(t);

      if (eixo === 'x' || eixo === 'xy') {
        var e1 = pos.x, e2 = pos.x + el.offsetWidth;
        var maxX = Math.max(0, t.scrollWidth - util.largura);
        var x = off.x;
        if (e1 - MARGEM.lado < x) x = e1 - MARGEM.lado;
        else if (e2 + MARGEM.lado > x + util.largura) x = e2 + MARGEM.lado - util.largura;
        off.x = Math.max(0, Math.min(maxX, x));
      }
      if (eixo === 'y' || eixo === 'xy') {
        var t1 = pos.y, t2 = pos.y + el.offsetHeight;
        var maxY = Math.max(0, t.scrollHeight - util.altura);
        var y = off.y;
        if (t1 - MARGEM.topo < y) y = t1 - MARGEM.topo;
        else if (t2 + MARGEM.base > y + util.altura) y = t2 + MARGEM.base - util.altura;
        off.y = Math.max(0, Math.min(maxY, y));
      }
      aplicaDesloc(t, off.x, off.y);
    });
  }

  /* ---------------------------------------------------------
     API
     --------------------------------------------------------- */
  var Nav = {

    MARGEM: MARGEM,

    focar: function (el, opcoes) {
      if (!el || !visivel(el)) return false;
      if (escopo && !escopo.contains(el)) return false;
      if (atual === el) { garanteVisivel(el); return true; }

      if (atual) atual.classList.remove('focused');
      atual = el;
      el.classList.add('focused');

      var reg = regiaoDe(el);
      if (reg) reg._ultimoFoco = el;

      if (!(opcoes && opcoes.semRolar)) garanteVisivel(el);

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        try { el.focus(); } catch (e) {}
      } else if (doc.activeElement && doc.activeElement.blur &&
                 doc.activeElement !== doc.body) {
        try { doc.activeElement.blur(); } catch (e) {}
      }
      if (Nav.aoFocar) Nav.aoFocar(el, reg);
      return true;
    },

    atual: function () { return atual; },
    regiaoAtual: function () { return atual ? regiaoDe(atual) : null; },

    focarPrimeiro: function (seletor) {
      var lista = seletor ? todos(seletor).filter(visivel) : focaveis();
      return Nav.focar(lista[0]);
    },

    entrar: function (nome) { return Nav.focar(entrarNa(nome)); },

    /* O coração. true = moveu; false = a borda parou. */
    mover: function (dir) {
      if (!atual || !doc.contains(atual) || !visivel(atual)) return Nav.focarPrimeiro();
      var reg = regiaoDe(atual);
      if (!reg) return Nav.focarPrimeiro();

      var alvo = passoInterno(reg, atual, dir);
      if (alvo) return Nav.focar(alvo);

      alvo = volta(reg, atual, dir);
      if (alvo) return Nav.focar(alvo);

      /* Voltar por onde se veio.
         Se você saiu da grade para o menu apertando ←, então →
         tem de devolver você à grade — mesmo que o menu declare
         outro vizinho à direita. É o que todo app de TV faz, e a
         falta disso é o tipo de coisa que faz a pessoa perder o
         lugar e desistir de procurar. O vizinho declarado é o
         padrão; o retorno é a exceção que vale mais. */
      if (reg._retorno && reg._retorno.dir === dir &&
          doc.contains(reg._retorno.reg) && reg._retorno.reg !== reg) {
        alvo = entrarNaRegiao(reg._retorno.reg);
        if (alvo) { marcarRetorno(regiaoDe(alvo), dir, reg); return Nav.focar(alvo); }
      }

      var vizinho = reg.getAttribute('data-nb-' + dir);
      if (vizinho) {
        var destino = regiaoPorNome(vizinho);
        alvo = entrarNaRegiao(destino);
        if (alvo) { marcarRetorno(destino, dir, reg); return Nav.focar(alvo); }
      }
      return false;          /* borda: isto é sucesso, não falha */
    },

    /* No máximo um movimento por quadro. O auto-repeat do
       controle dispara 10 a 15 eventos por segundo. */
    pedirMovimento: function (dir) {
      pendente = dir;
      if (quadro) return;
      quadro = w.requestAnimationFrame(function () {
        quadro = null;
        var d = pendente; pendente = null;
        if (d) Nav.mover(d);
      });
    },

    definirEscopo: function (raiz, primeiro) {
      escopo = raiz || null;
      if (raiz) {
        if (atual) atual.classList.remove('focused');
        atual = null;
        Nav.focarPrimeiro(primeiro);
      }
    },
    limparEscopo: function (voltarPara) {
      escopo = null;
      if (voltarPara) Nav.focar(voltarPara);
    },
    escopo: function () { return escopo; },

    zerarRolagem: function (raiz) {
      todos('[data-scroll]', raiz || doc).forEach(function (t) { aplicaDesloc(t, 0, 0); });
    },

    reiniciar: function () {
      if (atual) atual.classList.remove('focused');
      atual = null; pendente = null;
    },

    /* Se o elemento em foco sumiu, cai no vizinho da mesma
       região — nunca no menu. */
    revalidar: function () {
      if (atual && doc.contains(atual) && visivel(atual)) return true;
      var reg = atual ? regiaoDe(atual) : null;
      atual = null;
      if (reg && doc.contains(reg)) {
        var lista = focaveis(reg);
        if (lista.length) return Nav.focar(lista[0]);
      }
      return false;
    },

    adicionarTecla: function (fn) { ouvintes.unshift(fn); },
    removerTecla: function (fn) {
      ouvintes = ouvintes.filter(function (h) { return h !== fn; });
    },

    aoFocar: null
  };

  /* ---------------------------------------------------------
     Ponte com os nomes antigos.
     As telas ainda chamam Nav.focus, Nav.move e companhia. Estes
     apelidos evitam que o app estoure enquanto a camada 4 —
     reescrita das telas — não declara as regiões. Some quando
     `views.js` e `app.js` estiverem convertidos.
     --------------------------------------------------------- */
  Nav.focus            = Nav.focar;
  Nav.move             = Nav.mover;
  Nav.current          = Nav.atual;
  Nav.focusFirst       = Nav.focarPrimeiro;
  Nav.resetScroll      = Nav.zerarRolagem;
  Nav.setScope         = Nav.definirEscopo;
  Nav.clearScope       = Nav.limparEscopo;
  Nav.scoped           = Nav.escopo;
  Nav.addKeyHandler    = Nav.adicionarTecla;
  Nav.removeKeyHandler = Nav.removerTecla;
  Object.defineProperty(Nav, 'onFocusHook', {
    get: function () { return Nav.aoFocar; },
    set: function (fn) { Nav.aoFocar = fn; },
    configurable: true
  });

  w.Nav = Nav;

  /* ---------------------------------------------------------
     Teclado
     --------------------------------------------------------- */
  var DIR = {};
  DIR[w.KEY.LEFT] = 'left'; DIR[w.KEY.RIGHT] = 'right';
  DIR[w.KEY.UP] = 'up';     DIR[w.KEY.DOWN] = 'down';

  doc.addEventListener('keydown', function (ev) {
    var k = ev.keyCode;

    for (var i = 0; i < ouvintes.length; i++) {
      if (ouvintes[i](k, ev) === true) { ev.preventDefault(); return; }
    }

    /* Com campo de texto em foco, as setas horizontais pertencem
       ao cursor — MAS só enquanto houver texto e o cursor não
       estiver na ponta. Com o campo vazio, ou com o cursor no
       fim, a seta volta a ser navegação.

       Sem esta regra o campo virava uma armadilha: os botões ao
       lado dele (a ordenação da pasta) eram inalcançáveis pelo
       controle, porque a seta nunca saía do texto. */
    var alvo = doc.activeElement;
    var campo = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA');
    var digitando = false;
    if (campo) {
      var texto = String(alvo.value || '');
      var cursor = typeof alvo.selectionStart === 'number' ? alvo.selectionStart : texto.length;
      if (texto.length) {
        if (k === w.KEY.LEFT) digitando = cursor > 0;
        else if (k === w.KEY.RIGHT) digitando = cursor < texto.length;
        else digitando = true;              /* Backspace continua sendo do campo */
      }
    }

    if (DIR[k]) {
      if (digitando && (k === w.KEY.LEFT || k === w.KEY.RIGHT)) return;
      Nav.pedirMovimento(DIR[k]);
      ev.preventDefault();
      return;
    }
    if (k === w.KEY.OK) {
      if (digitando) return;
      if (atual) atual.click();
      ev.preventDefault();
    }
  }, true);

})(window);


/* ===== virt.js =================================================== */
/* =========================================================
   VIRTUALIZAÇÃO — fileiras e grades
   =========================================================
   O problema, em números da lista real: 20.478 filmes,
   266.823 episódios, 1.910 canais lógicos. A versão anterior
   criava um nó de DOM para cada item da categoria aberta e
   deixava o navegador se virar. Uma categoria de 1.650 filmes
   virava 1.650 cartões, 1.650 <img>, e a TV engasgava antes
   mesmo de você apertar a primeira tecla.

   Aqui só existe no DOM o que cabe na tela, mais uma margem
   de segurança. O resto são números.

   ---------------------------------------------------------
   COMO CONVIVE COM O MOTOR DE NAVEGAÇÃO

   O `nav.js` anda entre os elementos que EXISTEM. Se o
   próximo cartão não estiver montado, a tecla não tem para
   onde ir e a borda para — o que seria um bug cruel, porque
   pareceria "a lista acabou".

   A garantia é a margem: a janela montada sempre passa
   MARGEM itens além do que se vê, dos dois lados. Como uma
   tecla move exatamente um item, o alvo sempre existe. E o
   `nav.js` chama `Nav.aoFocar` depois de rolar, que é onde
   a gente remonta a janela — então a margem se renova antes
   de acabar.

   ---------------------------------------------------------
   POR QUE POSIÇÃO ABSOLUTA

   Duas razões, as duas medidas:

     · o trilho precisa manter o tamanho TOTAL da lista, senão
       o `scrollWidth`/`scrollHeight` que o nav.js usa para
       limitar a rolagem encolhe quando os itens são reciclados
       e a lista "trava" no meio;

     · com posição absoluta, criar e remover um cartão não
       reposiciona os vizinhos. Em fluxo normal, cada reciclagem
       custaria um refluxo da fileira inteira.

   O trilho recebe largura e altura explícitas — o tamanho que
   a lista TERIA inteira. É a única mentira necessária, e é
   uma mentira consistente.
   ========================================================= */
(function (w) {
  'use strict';

  var doc = w.document;

  /* Quantos itens montar além do que se vê, de cada lado.
     Precisa ser ≥ 2 para a navegação nunca ficar sem alvo;
     4 dá folga para o auto-repeat do controle, que dispara
     de 10 a 15 teclas por segundo. */
  var MARGEM = 4;

  function px(n) { return Math.round(n) + 'px'; }

  /* -----------------------------------------------------------
     Medida do passo
     -----------------------------------------------------------
     Não dá para chutar o tamanho do cartão: ele vem do CSS, em
     rem, e a raiz é calculada a partir da largura da tela. Então
     monta-se UM cartão de verdade, mede-se, e joga-se fora.
     Uma vez por fileira, não por item.
     ----------------------------------------------------------- */
  function medir(trilho, desenhar, item) {
    var sonda = desenhar(item, 0);
    sonda.style.position = 'absolute';
    sonda.style.left = '0px';
    sonda.style.top = '0px';
    sonda.style.visibility = 'hidden';
    trilho.appendChild(sonda);
    var m = { largura: sonda.offsetWidth, altura: sonda.offsetHeight };
    trilho.removeChild(sonda);
    return m;
  }

  /* -----------------------------------------------------------
     Base comum
     ----------------------------------------------------------- */
  function Controlador(cfg) {
    this.janela = cfg.janela;
    this.itens = cfg.itens || [];
    this.desenhar = cfg.desenhar;
    this.colunas = cfg.colunas || 0;      /* 0 = fileira; 'auto' = grade calculada */
    this.gap = cfg.gap || 0;
    this.nos = {};                        /* índice → elemento montado */
    this.fixo = null;                     /* nó que não pode ser reciclado */
    this.faixa = null;                    /* última janela montada */

    var trilho = doc.createElement('div');
    trilho.className = 'trilho';
    trilho.setAttribute('data-scroll', this.colunas ? 'y' : 'x');
    trilho.style.position = 'relative';
    this.trilho = trilho;
    trilho._virt = this;

    this.janela.appendChild(trilho);
    this.medida = this.itens.length
      ? medir(trilho, this.desenhar, this.itens[0])
      : { largura: 0, altura: 0 };

    this.passoX = this.medida.largura + this.gap;
    this.passoY = this.medida.altura + this.gap;

    /* -------------------------------------------------------
       Colunas calculadas, não chutadas
       -------------------------------------------------------
       Eu tinha fixado 7 colunas para cartaz e 6 para logo. Deu
       no que tinha de dar: a grade vazava pela direita, porque
       a conta certa depende da largura DAQUELA janela, que muda
       conforme a tela tem ou não coluna de categorias, e do
       padding interno.

       Com `colunas: 'auto'`, a conta é feita aqui, depois de
       medir o cartão de verdade. Um número a menos para eu
       errar.
       ------------------------------------------------------- */
    if (this.colunas === 'auto') {
      var cs = w.getComputedStyle(this.janela);
      var util = this.janela.clientWidth -
                 parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      this.colunas = Math.max(1, Math.floor((util + this.gap) / this.passoX));
    }

    if (this.colunas) {
      this.linhas = Math.ceil(this.itens.length / this.colunas);
      trilho.style.width = px(this.colunas * this.passoX - this.gap);
      trilho.style.height = px(Math.max(0, this.linhas * this.passoY - this.gap));
    } else {
      trilho.style.width = px(Math.max(0, this.itens.length * this.passoX - this.gap));
      trilho.style.height = px(this.medida.altura);
    }

    this.atualizar();
  }

  /* Deslocamento atual do trilho, escrito pelo nav.js. */
  Controlador.prototype.desloc = function () {
    return {
      x: Number(this.trilho.getAttribute('data-off-x') || 0),
      y: Number(this.trilho.getAttribute('data-off-y') || 0)
    };
  };

  /* Qual faixa de índices precisa existir agora. */
  Controlador.prototype.faixaNecessaria = function () {
    var off = this.desloc();
    var total = this.itens.length;
    if (!total) return { de: 0, ate: -1 };

    if (this.colunas) {
      var altura = this.janela.clientHeight || 0;
      var lin1 = Math.floor(off.y / this.passoY) - MARGEM;
      var lin2 = Math.ceil((off.y + altura) / this.passoY) + MARGEM;
      return {
        de: Math.max(0, lin1 * this.colunas),
        ate: Math.min(total - 1, lin2 * this.colunas + this.colunas - 1)
      };
    }
    var largura = this.janela.clientWidth || 0;
    return {
      de: Math.max(0, Math.floor(off.x / this.passoX) - MARGEM),
      ate: Math.min(total - 1, Math.ceil((off.x + largura) / this.passoX) + MARGEM)
    };
  };

  Controlador.prototype.posicaoDe = function (i) {
    if (this.colunas) {
      return { x: (i % this.colunas) * this.passoX,
               y: Math.floor(i / this.colunas) * this.passoY };
    }
    return { x: i * this.passoX, y: 0 };
  };

  /* -----------------------------------------------------------
     Inserção EM ORDEM — não é capricho, é requisito.
     -----------------------------------------------------------
     O `nav.js` anda de um item para o vizinho usando a posição
     na lista de focáveis, e essa lista sai de `querySelectorAll`,
     ou seja, na ordem do DOM. Se um cartão reciclado voltasse com
     `appendChild`, ele entraria no fim e a seta para a direita
     saltaria para o outro extremo da fileira.

     Um bug desses só aparece depois de rolar bastante — que é
     exatamente quando ninguém está mais olhando o código.
     ----------------------------------------------------------- */
  Controlador.prototype.inserir = function (no, i) {
    var proximo = null, menor = Infinity;
    for (var k in this.nos) {
      var j = Number(k);
      if (j > i && j < menor) { menor = j; proximo = this.nos[j]; }
    }
    this.nos[i] = no;
    if (proximo) this.trilho.insertBefore(no, proximo);
    else this.trilho.appendChild(no);
  };

  Controlador.prototype.montar = function (i) {
    var no = this.desenhar(this.itens[i], i);
    var p = this.posicaoDe(i);
    no.style.position = 'absolute';
    no.style.left = px(p.x);
    no.style.top = px(p.y);
    no.setAttribute('data-i', i);
    this.inserir(no, i);
    return no;
  };

  Controlador.prototype.atualizar = function () {
    var f = this.faixaNecessaria();
    if (this.faixa && this.faixa.de === f.de && this.faixa.ate === f.ate) return;
    this.faixa = f;

    var self = this;

    /* recicla o que saiu — menos o nó em foco, que sumir por
       baixo do pé é a pior coisa que uma lista pode fazer */
    Object.keys(this.nos).forEach(function (k) {
      var i = Number(k);
      if (i >= f.de && i <= f.ate) return;
      var no = self.nos[i];
      if (no === self.fixo) return;
      if (no.parentNode) no.parentNode.removeChild(no);
      delete self.nos[i];
    });

    /* monta o que entrou */
    for (var i = f.de; i <= f.ate; i++) {
      if (!this.nos[i]) this.montar(i);
    }
  };

  /* O nó em foco vira intocável até outro tomar o lugar. É o que
     faz `data-enter="last"` continuar funcionando: o nav.js guarda
     a REFERÊNCIA do último foco da região, e uma referência para
     um nó reciclado não serve para nada. */
  Controlador.prototype.fixar = function (no) {
    if (this.fixo === no) return;
    var antigo = this.fixo;
    this.fixo = no;
    if (antigo && this.faixa) {
      var i = Number(antigo.getAttribute('data-i'));
      if ((i < this.faixa.de || i > this.faixa.ate) && antigo.parentNode) {
        antigo.parentNode.removeChild(antigo);
        delete this.nos[i];
      }
    }
  };

  Controlador.prototype.no = function (i) { return this.nos[i] || null; };

  /* Traz um índice para o DOM mesmo fora da faixa — usado para
     restaurar o foco ao voltar de uma tela. */
  Controlador.prototype.garantir = function (i) {
    if (i < 0 || i >= this.itens.length) return null;
    return this.nos[i] || this.montar(i);
  };

  Controlador.prototype.destruir = function () {
    this.nos = {}; this.fixo = null; this.faixa = null;
    if (this.trilho.parentNode) this.trilho.parentNode.removeChild(this.trilho);
    this.trilho._virt = null;
  };

  /* -----------------------------------------------------------
     API
     ----------------------------------------------------------- */
  var Virt = {

    MARGEM: MARGEM,

    /* Fileira horizontal. `janela` é o elemento com overflow
       escondido; o trilho é criado aqui dentro. */
    fileira: function (janela, itens, desenhar, gap) {
      return new Controlador({ janela: janela, itens: itens,
                               desenhar: desenhar, gap: gap || 0 });
    },

    /* Grade. `colunas` é fixo — em TV a largura não muda no meio
       do uso, então não há motivo para recalcular. */
    grade: function (janela, itens, desenhar, colunas, gap) {
      return new Controlador({ janela: janela, itens: itens, desenhar: desenhar,
                               colunas: colunas, gap: gap || 0 });
    },

    /* Chamado a cada mudança de foco. Sobe até achar o trilho
       virtualizado que contém o elemento, remonta a janela e
       fixa o nó em foco. */
    aoFocar: function (el) {
      var n = el;
      while (n && n !== doc.body) {
        if (n._virt) { n._virt.fixar(el); n._virt.atualizar(); return n._virt; }
        n = n.parentElement;
      }
      return null;
    },

    /* Todos os controladores vivos dentro de uma raiz. */
    dentroDe: function (raiz) {
      return Array.prototype.slice
        .call((raiz || doc).querySelectorAll('.trilho'))
        .map(function (t) { return t._virt; })
        .filter(Boolean);
    }
  };

  w.Virt = Virt;

})(window);


/* ===== dom.js ==================================================== */
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


/* ===== ui.js ===================================================== */
/* =========================================================
   PEÇAS DE INTERFACE
   =========================================================
   O vocabulário visual do app: cartão, fileira, grade, tela
   vazia, tela de erro, esqueleto de carregamento.

   Está separado das telas por um motivo prático: quase todo
   bug de foco e de rolagem que a versão anterior teve nasceu
   de uma fileira montada de um jeito aqui e de outro ali. Com
   uma peça só, corrigir uma vez corrige em todo lugar.

   Duas regras que valem para tudo neste arquivo:

     · nenhuma lista longa é montada inteira — tudo passa pelo
       `virt.js`;

     · nada de conteúdo adulto marcado como assistido, em
       andamento ou recente. A decisão 5 da spec de experiência
       diz que "desbloqueado" é sobre visibilidade, não sobre
       registro. Aqui isso vira código: `marcasDe()` devolve
       vazio para item adulto, sempre.
   ========================================================= */
(function (w) {
  'use strict';

  var doc = w.document;

  /* -----------------------------------------------------------
     Imagens: só carrega quando o cartão é montado
     -----------------------------------------------------------
     Com virtualização isso já é quase automático — o cartão só
     existe perto da tela. O que falta é não deixar uma imagem
     quebrada estragar o cartão: no erro, cai para as iniciais.
     ----------------------------------------------------------- */
  function poster(url, nome, classe) {
    var casca = doc.createElement('div');
    casca.className = 'shell ' + (classe || '');
    if (url) {
      var img = doc.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.onerror = function () {
        img.remove();
        casca.appendChild(iniciais(nome));
      };
      /* Cartaz em pé dentro de moldura deitada.
         -----------------------------------------------------
         Medido no app real: em "continuar assistindo" a moldura
         é 285×160 e quase todos os cartazes chegam 600×900. Com
         `cover`, o que aparece é uma faixa do meio do cartaz —
         sem título, sem rosto, sem nada. O provedor só manda a
         arte deitada em parte do acervo.

         Quando a imagem chega em pé, o cartão passa a mostrá-la
         inteira, centrada, com fundo sólido. Cabe menos, mas o
         que cabe se entende. */
      img.onload = function () {
        if (img.naturalHeight > img.naturalWidth * 1.1) casca.classList.add('retrato');
      };
      img.src = url;
      casca.appendChild(img);
    } else {
      casca.appendChild(iniciais(nome));
    }
    return casca;
  }

  function iniciais(nome) {
    var d = doc.createElement('div');
    d.className = 'card-fallback';
    d.textContent = w.initials ? w.initials(nome || '') : (nome || '?').slice(0, 2);
    return d;
  }

  /* -----------------------------------------------------------
     Marcas na capa
     -----------------------------------------------------------
     Você pediu faixa ou etiqueta em cima da capa do que está
     assistindo ou já assistiu. São três estados, e o quarto —
     adulto — é a ausência deliberada de todos eles.
     ----------------------------------------------------------- */
  function marcasDe(item) {
    if (!item || item.kind === 'live') return null;
    if (w.Catalog && w.Catalog.itemAdulto && w.Catalog.itemAdulto(item)) return null;

    var p = w.Store.progressOf(item.id);
    if (!p) return null;

    var frac = p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
    if (p.completed || frac >= 0.95) return { tipo: 'visto', frac: 1 };

    /* ---------------------------------------------------------
       O limiar de "comecei a assistir"
       ---------------------------------------------------------
       Era só percentual: 2% da duração. Medido no aparelho de
       verdade, isso NUNCA marcava nada — num filme de 2h26, 2%
       são quase 3 minutos, e os registros reais tinham 4, 11,
       16, 31 segundos. A etiqueta existia no código e não
       aparecia na tela por causa de uma conta, não de um bug de
       desenho.

       Agora vale o que vier primeiro: 30 segundos de relógio ou
       2% do filme. Trinta segundos é tempo de já ter passado da
       abertura e ter decidido ficar; abaixo disso foi só espiar.
       --------------------------------------------------------- */
    if (p.position >= 30 || frac > 0.02) {
      return { tipo: 'andamento', frac: Math.max(frac, 0.01), rotulo: p.label || '' };
    }
    return null;
  }

  /* -----------------------------------------------------------
     Cartão
     -----------------------------------------------------------
     `forma` decide a proporção: 'poster' (retrato, filmes e
     séries), 'wide' (paisagem, destaques) e 'logo' (canais).
     ----------------------------------------------------------- */
  function cartao(item, forma, extra) {
    forma = forma || 'poster';
    var b = doc.createElement('button');
    b.className = 'card card-' + forma;
    b.setAttribute('data-focusable', '');
    b.setAttribute('data-id', item.id);
    b._item = item;

    var casca = poster(item.poster || item.backdrop || '', item.title, '');

    var m = marcasDe(item);
    if (m) {
      if (m.tipo === 'visto') {
        var tag = doc.createElement('span');
        tag.className = 'card-tag visto';
        tag.innerHTML = w.icon('check') + '<span>Assistido</span>';
        casca.appendChild(tag);
      } else {
        var barra = doc.createElement('div');
        barra.className = 'card-progress';
        var i = doc.createElement('i');
        i.style.width = Math.round(m.frac * 100) + '%';
        barra.appendChild(i);
        casca.appendChild(barra);
        var et = doc.createElement('span');
        et.className = 'card-tag andamento';
        et.textContent = m.rotulo ? 'Continuar · ' + m.rotulo : 'Continuar';
        casca.appendChild(et);
      }
    }

    /* Estrela de favorito: sinal de que segurar OK funcionou, e
       de que este canal está na pasta Favoritos. */
    if (w.Store.isFavorite(item.id)) {
      b.classList.add('favorito');
      var fav = doc.createElement('span');
      fav.className = 'card-fav';
      fav.innerHTML = w.icon('star', 'solid');
      casca.appendChild(fav);
    }

    /* Qualidade do canal: útil e barato, sai do próprio nome. */
    if (item.kind === 'live' && item.qualidade) {
      var q = doc.createElement('span');
      q.className = 'card-qual' + (item.travada ? ' travada' : '');
      q.textContent = item.qualidade;
      casca.appendChild(q);
    }

    b.appendChild(casca);

    var meta = doc.createElement('div');
    meta.className = 'card-meta';
    var nome = doc.createElement('div');
    nome.className = 'card-name';
    nome.textContent = item.title || '';
    meta.appendChild(nome);
    if (extra && extra.nota) {
      var n = doc.createElement('div');
      n.className = 'card-note';
      n.textContent = extra.nota;
      meta.appendChild(n);
    }
    b.appendChild(meta);
    return b;
  }

  /* -----------------------------------------------------------
     Fileira horizontal virtualizada
     -----------------------------------------------------------
     Devolve a <section data-row>, com o controlador pendurado
     em `.ctrl` para quem precisar mexer depois.
     ----------------------------------------------------------- */
  function fileira(titulo, itens, opts) {
    opts = opts || {};
    var sec = doc.createElement('section');
    sec.className = 'row';
    sec.setAttribute('data-row', '');

    if (titulo) {
      var h = doc.createElement('h2');
      h.className = 'row-title';
      h.textContent = titulo;
      if (opts.subtitulo) {
        var s = doc.createElement('span');
        s.className = 'row-sub';
        s.textContent = opts.subtitulo;
        h.appendChild(s);
      }
      sec.appendChild(h);
    }

    var janela = doc.createElement('div');
    janela.className = 'janela fileira forma-' + (opts.forma || 'poster');
    sec.appendChild(janela);

    /* O controlador precisa da janela já medida, então a fileira
       só é ligada depois de entrar no documento. Quem monta a tela
       chama `UI.ligar(sec)`. */
    sec._ligar = function () {
      sec.ctrl = w.Virt.fileira(janela, itens, function (item, i) {
        var c = cartao(item, opts.forma, { nota: opts.nota ? opts.nota(item, i) : '' });
        if (opts.aoAbrir) c.onclick = function () { opts.aoAbrir(item, i); };
        return c;
      }, opts.gap || 16);
    };
    return sec;
  }

  /* -----------------------------------------------------------
     Grade virtualizada
     ----------------------------------------------------------- */
  function grade(itens, opts) {
    opts = opts || {};
    var janela = doc.createElement('div');
    janela.className = 'janela cheia grade forma-' + (opts.forma || 'poster');
    janela._ligar = function () {
      janela.ctrl = w.Virt.grade(janela, itens, function (item, i) {
        var c = cartao(item, opts.forma, { nota: opts.nota ? opts.nota(item, i) : '' });
        if (opts.aoAbrir) c.onclick = function () { opts.aoAbrir(item, i); };
        return c;
      }, opts.colunas || 6, opts.gap || 16);
    };
    return janela;
  }

  /* -----------------------------------------------------------
     Blocos de estado
     ----------------------------------------------------------- */
  function vazio(titulo, texto) {
    var d = doc.createElement('div');
    d.className = 'empty';
    d.innerHTML = '<h2>' + w.esc(titulo) + '</h2>' +
                  (texto ? '<p>' + w.esc(texto) + '</p>' : '');
    return d;
  }

  function erro(e, tentar) {
    var d = doc.createElement('div');
    d.className = 'empty erro';
    d.innerHTML = '<h2>Não consegui carregar</h2>' +
                  '<p>' + w.esc((e && e.message) || String(e || '')) + '</p>';
    if (tentar) {
      var box = doc.createElement('div');
      box.className = 'row-btns';
      box.setAttribute('data-region', 'erro');
      box.setAttribute('data-axis', 'x');
      box.setAttribute('data-enter', 'first');
      var b = doc.createElement('button');
      b.className = 'btn';
      b.setAttribute('data-focusable', '');
      b.textContent = 'Tentar de novo';
      b.onclick = tentar;
      box.appendChild(b);
      d.appendChild(box);
    }
    return d;
  }

  /* Esqueleto: ocupa o espaço certo enquanto a lista não chega,
     para a tela não pular quando ela chegar. */
  function esqueleto(quantos, forma) {
    var sec = doc.createElement('section');
    sec.className = 'row esqueleto';
    var janela = doc.createElement('div');
    janela.className = 'janela fileira forma-' + (forma || 'poster');
    var trilho = doc.createElement('div');
    trilho.className = 'trilho';
    for (var i = 0; i < (quantos || 8); i++) {
      var c = doc.createElement('div');
      c.className = 'card card-' + (forma || 'poster') + ' vazio';
      c.innerHTML = '<div class="shell"></div>';
      trilho.appendChild(c);
    }
    janela.appendChild(trilho);
    sec.appendChild(janela);
    return sec;
  }

  /* -----------------------------------------------------------
     Montagem
     -----------------------------------------------------------
     Tudo o que for virtualizado precisa estar no documento antes
     de ser medido. Esta função percorre o que foi montado e liga
     os controladores na ordem certa.
     ----------------------------------------------------------- */
  function ligar(raiz) {
    if (raiz._ligar) raiz._ligar();
    w.$$('*', raiz).forEach(function (n) { if (n._ligar) n._ligar(); });
  }

  function tela(cls) {
    var s = doc.createElement('div');
    s.className = 'screen enter ' + (cls || '');
    return s;
  }

  /* -----------------------------------------------------------
     Troca o conteúdo do palco — e diz ao menu para onde ir
     -----------------------------------------------------------
     O menu lateral não tem vizinho à direita fixo: depende da
     tela. Sem declarar isso, a seta para a direita não saía do
     menu — o motor procurava `data-nb-right` no `#rail`, não
     achava, e parava na borda. Corretíssimo do ponto de vista
     do algoritmo, e péssimo para quem está com o controle na
     mão.

     Cada tela informa aqui qual é a sua região principal.
     ----------------------------------------------------------- */
  function trocar(elemento, regiaoPrincipal) {
    var palco = w.$('#stage');
    w.Virt.dentroDe(palco).forEach(function (c) { c.destruir(); });
    w.clear(palco);
    palco.appendChild(elemento);
    ligar(elemento);
    apontarMenu(regiaoPrincipal);
    return elemento;
  }

  function apontarMenu(regiao) {
    var rail = w.$('#rail');
    if (!rail) return;
    if (regiao) rail.setAttribute('data-nb-right', regiao);
    else rail.removeAttribute('data-nb-right');
  }

  w.UI = {
    cartao: cartao,
    fileira: fileira,
    grade: grade,
    vazio: vazio,
    erro: erro,
    esqueleto: esqueleto,
    tela: tela,
    ligar: ligar,
    trocar: trocar,
    apontarMenu: apontarMenu,
    marcasDe: marcasDe
  };

})(window);


/* ===== player.js ================================================= */
/* =========================================================
   O PLAYER
   =========================================================
   Reescrito para resolver, em ordem, o que você apontou:

     · "ao terminar um episódio de uma série não vai pra
       próxima, simplesmente para tudo";

     · "ao apertar pra baixo no player não tem um menu pra
       pausar/play, voltar ao início, ir para o próximo
       episódio ou o anterior, ver lista de episódios e
       temporadas daquela série ou até idioma";

     · a escada de qualidade dos canais, com as versões
       listadas para você travar uma à mão;

     · o painel de aferição no topo (§4.2-A da spec de
       experiência), que responde "o que está chegando aqui,
       de verdade?".

   ---------------------------------------------------------
   TRÊS DECISÕES QUE VALE LER ANTES DE MEXER

   1. O FIM DO CONTEÚDO É ESTADO DERIVADO, NÃO O EVENTO
      `ended`. O Chromium não emite `ended` de forma confiável
      em stream progressivo — foi por isso que o episódio
      "simplesmente parava". Aqui o fim é uma conta: passou de
      COMPLETED_RATIO da duração E o relógio parou de andar por
      mais de 1,5 s sem estar pausado. O `ended`, quando vem,
      é só mais um gatilho para a mesma conta.

   2. TODA TROCA É FECHAR-E-ABRIR. A conta tem
      `max_connections: 1` — uma transmissão por vez. Não dá
      para pré-carregar o próximo episódio nem a variante de
      qualidade antes de encerrar a atual: o servidor recusaria.
      Por isso `desligar()` é chamado antes de qualquer
      abertura, e não só na saída.

   3. O PAINEL DE AFERIÇÃO SÓ MEDE COM O OSD ABERTO. Fechou,
      o cronômetro para. Durante o filme não existe nada
      contando quadros por trás.
   ========================================================= */
(function (w) {
  'use strict';

  var layer, video, ui, spinner, errBox, errMsg, painel;
  var hls = null;

  var item = null;              /* o que está tocando */
  var fila = [], iFila = -1;    /* episódios da temporada */
  var serie = null;

  var aoVivo = false;
  var grupo = null;             /* canal lógico, com a escada */
  var degraus = [];             /* [{rotulo, fontes:[variante]}] */
  var iDegrau = 0, iFonte = 0;
  var travado = false;          /* qualidade fixada à mão */

  var comecarEm = 0;
  var salvar = null, esconder = null, medidor = null;
  var pulo = 0, relogioPulo = null;
  var arrastando = false, alvoArraste = 0;   /* estado do arraste da timeline */
  var ultimoToque = 0, nivelPasso = 0;
  var aoFechar = null;
  var osdAberto = false;

  /* -----------------------------------------------------------
     Detecção de engasgo — os números e o porquê deles
     -----------------------------------------------------------
     Ficam aqui e não no config.js porque só fazem sentido
     juntos: mexer num sem os outros desregula a escada.
     ----------------------------------------------------------- */
  var JANELA_MS      = 30000;  /* memória da contagem de travadas */
  var TRAVA_TOTAL_MS = 4000;   /* somando mais que isso na janela → age */
  var CARENCIA_MS    = 8000;   /* silêncio no começo: é buffer normal de abertura */
  var INTERVALO_MS   = 20000;  /* nunca troca duas vezes seguidas mais rápido */
  var SUBIR_MS       = 60000;  /* estável por isso → tenta subir um degrau */
  var TETO_ESPERA_MS = 600000; /* recuo progressivo, com teto de 10 min */

  var travadas = [];           /* [{em, ms, aberta}] */
  var abriuEm = 0, trocouEm = 0;
  var esperaSubida = SUBIR_MS;
  var estavelDesde = 0;
  var parouEm = 0, ultimoTempo = -1;

  /* -----------------------------------------------------------
     Montagem
     ----------------------------------------------------------- */
  function iniciar() {
    layer   = w.$('#player-layer');
    video   = w.$('#video');
    ui      = w.$('#player-ui');
    spinner = w.$('#player-spinner');
    errBox  = w.$('#player-error');
    errMsg  = w.$('#pl-error-msg');
    painel  = w.$('#osd-panel');

    video.addEventListener('loadedmetadata', aoTerMeta);
    video.addEventListener('timeupdate', aoAndar);
    video.addEventListener('progress', aoBufferizar);
    video.addEventListener('waiting', comecouAEngasgar);
    video.addEventListener('stalled', comecouAEngasgar);
    video.addEventListener('playing', function () {
      errBox.classList.add('hidden');
      terminouDeEngasgar();
    });
    video.addEventListener('ended', function () { conferirFim(true); });
    video.addEventListener('error', function () { falhar(descreverErro()); });

    w.$('#pl-retry').addEventListener('click', function () {
      errBox.classList.add('hidden');
      w.Nav.limparEscopo();
      abrirFonte(comecarEm);
    });
    w.$('#pl-back').addEventListener('click', function () { w.Player.close(); });

    ligarTransporte();
  }

  /* -----------------------------------------------------------
     Abertura
     ----------------------------------------------------------- */
  function abrir(alvo, opts) {
    opts = opts || {};
    if (!layer) iniciar();

    item     = alvo;
    fila     = opts.queue || [];
    iFila    = typeof opts.index === 'number' ? opts.index : -1;
    serie    = opts.serie || null;
    aoFechar = opts.onClose || null;
    aoVivo   = item.kind === 'live';

    /* A escada só existe para canal, e só quando o item veio do
       catálogo agrupado — um canal achado pela busca também traz
       as variantes, porque é o mesmo objeto. */
    grupo   = aoVivo && item.variantes ? item : null;
    degraus = grupo ? w.Catalog.degraus(grupo) : [];
    travado = !!item.travada;
    iDegrau = degrauDe(item.qualidade);
    iFonte  = 0;
    zerarMedidas();

    layer.classList.remove('hidden');
    errBox.classList.add('hidden');
    spinner.classList.remove('hidden');

    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !aoVivo);
    w.$('#pl-dur').textContent = aoVivo ? '' : '00:00';
    w.$('#pl-cur').textContent = '00:00';
    barra(0, 0);

    /* Ao vivo não grava progresso, mas grava hábito: é o que
       leva os canais que você usa para a frente da lista. */
    if (aoVivo && w.Store.touchChannel) w.Store.touchChannel(item);

    montarContexto();
    fecharOSD();
    ui.classList.remove('hidden', 'fade');
    w.Nav.adicionarTecla(teclas);
    adiarSumico();

    var guardado = w.Store.progressOf(item.id);
    var podeRetomar = !aoVivo && guardado && !guardado.completed &&
      guardado.position >= w.CFG.RESUME_MIN_SEC &&
      (!guardado.duration || guardado.duration - guardado.position > w.CFG.RESUME_TAIL_SEC);

    if (podeRetomar && !opts.forceStart) perguntarRetomada(guardado);
    else abrirFonte(opts.startAt || 0);
  }

  function degrauDe(qualidade) {
    var q = qualidade === '4K' ? 'UHD' : qualidade;
    for (var i = 0; i < degraus.length; i++) if (degraus[i].rotulo === q) return i;
    return 0;
  }

  function perguntarRetomada(guardado) {
    var caixa = w.$('#resume-layer');
    var antes = w.Nav.atual();
    w.$('#resume-desc').textContent =
      w.cleanName(item.title) + (item.subtitle ? ' · ' + item.subtitle : '') +
      ' — você parou em ' + w.fmtTime(guardado.position) +
      (guardado.duration ? ' de ' + w.fmtTime(guardado.duration) : '') + '.';
    caixa.classList.remove('hidden');
    w.Nav.definirEscopo(caixa);

    function fim(de) {
      caixa.classList.add('hidden');
      w.Nav.limparEscopo(antes);
      w.$('#resume-yes').onclick = null;
      w.$('#resume-no').onclick = null;
      abrirFonte(de);
    }
    w.$('#resume-yes').onclick = function () { fim(Math.max(0, guardado.position - 5)); };
    w.$('#resume-no').onclick  = function () { fim(0); };
  }

  /* -----------------------------------------------------------
     Carregamento
     ----------------------------------------------------------- */
  function urlAtual() {
    if (!grupo || !degraus[iDegrau]) return item.url;
    var d = degraus[iDegrau];
    var v = d.fontes[iFonte % d.fontes.length];
    return w.Xtream.urlAoVivo(v.streamId);
  }

  function nativoTocaria(url) {
    if (/\.m3u8(\?|$)/i.test(url)) {
      var t = video.canPlayType('application/vnd.apple.mpegurl') ||
              video.canPlayType('application/x-mpegURL');
      return t === 'probably' || t === 'maybe';
    }
    return true;   /* mp4/mkv/ts vão direto para o motor da TV */
  }

  function abrirFonte(de) {
    comecarEm = de || 0;
    desligar();                      /* max_connections: 1 — sempre fecha antes */
    spinner.classList.remove('hidden');

    var url = urlAtual();

    if (nativoTocaria(url)) {
      video.src = url;
      video.load();
    } else if (w.Hls && w.Hls.isSupported()) {
      hls = new w.Hls({
        maxBufferLength: aoVivo ? 12 : 30,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 30000
      });
      hls.on(w.Hls.Events.ERROR, function (e, d) {
        if (!d || !d.fatal) return;
        if (d.type === w.Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
        if (d.type === w.Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        falhar('O fluxo de vídeo falhou (' + (d.details || 'erro desconhecido') + ').');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
      video.load();
    }

    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay bloqueado no navegador */ });

    abriuEm = Date.now();
    estavelDesde = abriuEm;
    parouEm = 0; ultimoTempo = -1;
    comecarASalvar();
    atualizarContexto();
  }

  /* Encerra de verdade: solta a conexão com o servidor. Com uma
     transmissão por vez, deixar o <video> segurando o socket faz
     a próxima abertura ser recusada. */
  function desligar() {
    pararDeSalvar();
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { video.pause(); } catch (e) {}
    try { video.removeAttribute('src'); video.load(); } catch (e) {}
  }

  /* -----------------------------------------------------------
     Eventos
     ----------------------------------------------------------- */
  function aoTerMeta() {
    spinner.classList.add('hidden');
    if (comecarEm > 0 && isFinite(video.duration) && video.duration > comecarEm) {
      try { video.currentTime = comecarEm; } catch (e) {}
    }
    if (!aoVivo && isFinite(video.duration)) {
      w.$('#pl-dur').textContent = w.fmtTime(video.duration);
    }
  }

  function aoAndar() {
    /* Enquanto você arrasta, quem manda na barra é o arraste.
       Sem esta guarda o `timeupdate` reescrevia a posição a cada
       quarto de segundo e a barra piscava entre onde o vídeo está
       e para onde você está indo — a oscilação que você viu. */
    if (arrastando) { conferirEscada(); return; }

    w.$('#pl-cur').textContent = w.fmtTime(video.currentTime);
    if (!aoVivo && isFinite(video.duration) && video.duration) {
      barra(video.currentTime / video.duration, null);
    }
    julgarSuspeita();
    conferirFim(false);
    conferirEscada();
  }

  function aoBufferizar() {
    if (arrastando) return;
    if (!video.buffered || !video.buffered.length || !isFinite(video.duration)) return;
    var fim = video.buffered.end(video.buffered.length - 1);
    barra(null, fim / video.duration);
  }

  function barra(preenche, buffer) {
    if (preenche != null)
      w.$('#pl-fill').style.width = Math.min(100, Math.max(0, preenche * 100)) + '%';
    if (buffer != null)
      w.$('#pl-buf').style.width = Math.min(100, Math.max(0, buffer * 100)) + '%';
  }

  /* -----------------------------------------------------------
     O FIM DO CONTEÚDO — estado derivado
     -----------------------------------------------------------
     Duas condições, e as duas precisam valer:

       a) já passou de COMPLETED_RATIO da duração;
       b) o relógio parou de andar há mais de 1,5 s sem que o
          vídeo esteja pausado.

     A (a) sozinha não serve: faltando 5% ainda há vídeo. A (b)
     sozinha também não: um engasgo no meio do filme trava o
     relógio e não é fim de nada.

     Juntas, pegam o caso que o `ended` deixava passar — o que
     fazia o episódio "simplesmente parar tudo".
     ----------------------------------------------------------- */
  function conferirFim(veioDoEvento) {
    if (aoVivo || !item) return;
    var dur = isFinite(video.duration) ? video.duration : 0;
    var pos = video.currentTime || 0;
    if (!dur) return;

    var perto = pos / dur >= w.CFG.COMPLETED_RATIO;

    if (!veioDoEvento) {
      if (video.paused) { parouEm = 0; ultimoTempo = pos; return; }
      if (Math.abs(pos - ultimoTempo) < 0.05) {
        if (!parouEm) parouEm = Date.now();
      } else {
        parouEm = 0; ultimoTempo = pos;
      }
      if (!perto || !parouEm || Date.now() - parouEm < 1500) return;
    } else if (!perto) {
      /* `ended` cedo demais é sinal de arquivo truncado, não de
         episódio terminado. Não avança sozinho nisso. */
      return;
    }

    gravar(true);
    proximoDaFila(1, true);
  }

  /* -----------------------------------------------------------
     A ESCADA DE QUALIDADE
     -----------------------------------------------------------
     Regra de descida, na ordem: outra FONTE do mesmo degrau
     primeiro; só quando as fontes acabam é que se perde
     resolução. A sonda mostrou que a lista tem canais com duas
     fontes na mesma qualidade — servidores diferentes — e trocar
     de servidor é a correção mais barata que existe.
     ----------------------------------------------------------- */
  /* -----------------------------------------------------------
     ENGASGO É O RELÓGIO PARADO, NÃO O EVENTO
     -----------------------------------------------------------
     Medido na TV: num canal ao vivo em `.ts`, o `waiting` e o
     `stalled` disparam o tempo todo — a cada reenchimento de
     buffer — mesmo com a imagem perfeita. E o `playing`, que era
     quem apagava o rodinha e fechava a contagem, só volta depois
     de uma pausa de verdade.

     O resultado era o que você viu: a rodinha laranja acesa o
     tempo inteiro, e a escada descendo de FHD até SD sem que
     nada tivesse travado um segundo sequer.

     Agora o evento só ABRE uma suspeita. Ela vira engasgo de
     verdade se o `currentTime` ficar parado mais de 1,2 s. Se o
     relógio andar, a suspeita é descartada e a rodinha apaga.
     ----------------------------------------------------------- */
  var SUSPEITA_MS = 1200;
  var suspeita = null;          /* { em, tempoNoInicio } */

  function comecouAEngasgar() {
    if (suspeita) return;
    suspeita = { em: Date.now(), tempo: video.currentTime || 0 };
  }

  function terminouDeEngasgar() {
    spinner.classList.add('hidden');
    if (suspeita) {
      /* Só vira registro a suspeita CONFIRMADA — aquela em que o
         relógio realmente ficou parado. Uma suspeita que morreu
         porque o vídeo continuou andando não foi travamento
         nenhum, por mais tempo que o evento tenha demorado a ser
         desmentido. */
      if (suspeita.confirmada) {
        travadas.push({ em: suspeita.em, ms: Date.now() - suspeita.em, aberta: false });
      }
      suspeita = null;
    }
  }

  /* Chamado a cada `timeupdate`: é o juiz. */
  function julgarSuspeita() {
    if (!suspeita) { spinner.classList.add('hidden'); return; }
    var agora = Date.now();
    var andou = (video.currentTime || 0) - suspeita.tempo > 0.15;

    if (andou) { terminouDeEngasgar(); return; }
    /* parado de verdade: aí sim confirma e mostra que carrega */
    if (agora - suspeita.em >= SUSPEITA_MS) {
      suspeita.confirmada = true;
      spinner.classList.remove('hidden');
    }
  }
  function zerarMedidas() {
    travadas = []; suspeita = null; trocouEm = 0; esperaSubida = SUBIR_MS;
  }

  function msTravadosNaJanela() {
    var agora = Date.now(), total = 0;
    travadas = travadas.filter(function (t) { return agora - t.em < JANELA_MS; });
    travadas.forEach(function (t) { total += t.ms; });
    /* a suspeita em curso conta enquanto o relógio estiver parado */
    if (suspeita && suspeita.confirmada) total += agora - suspeita.em;
    return total;
  }

  function temOutraFonte() {
    var d = degraus[iDegrau];
    return !!(d && d.fontes.length > 1 && iFonte < d.fontes.length - 1);
  }

  function conferirEscada() {
    if (!aoVivo || travado) return;
    if (degraus.length < 2 && !temOutraFonte()) return;

    var agora = Date.now();
    if (agora - abriuEm < CARENCIA_MS) return;
    if (trocouEm && agora - trocouEm < INTERVALO_MS) return;

    if (msTravadosNaJanela() > TRAVA_TOTAL_MS) {
      estavelDesde = agora;
      if (temOutraFonte()) {
        iFonte++;
        w.toast('Conexão engasgou — tentando outra fonte do mesmo ' +
                degraus[iDegrau].rotulo + '.', 3500);
      } else if (iDegrau < degraus.length - 1) {
        iDegrau++; iFonte = 0;
        w.toast('Conexão engasgou — mudei para ' + degraus[iDegrau].rotulo + '.', 3500);
      } else {
        return;                     /* já está no degrau mais baixo */
      }
      trocouEm = agora;
      travadas = [];
      abrirFonte(0);
      return;
    }

    /* Subir de volta, com recuo progressivo: um canal cronicamente
       instável ficaria pulando de qualidade a cada minuto, e o
       corte da troca incomoda mais que a resolução menor. */
    if (iDegrau > 0 && agora - estavelDesde > esperaSubida) {
      iDegrau--; iFonte = 0;
      estavelDesde = agora; trocouEm = agora;
      esperaSubida = Math.min(TETO_ESPERA_MS, esperaSubida * 3);
      travadas = [];
      abrirFonte(0);
    }
  }

  /* Escolha manual: fixa e desliga o automático até trocar de canal. */
  function fixarDegrau(i) {
    iDegrau = i; iFonte = 0; travado = true;
    zerarMedidas();
    w.toast('Fixado em ' + degraus[i].rotulo + ' até você trocar de canal.', 3500);
    abrirFonte(0);
    atualizarContexto();
  }

  function descreverErro() {
    var e = video.error;
    if (!e) return 'O vídeo parou sem dizer o motivo.';
    switch (e.code) {
      case 1: return 'A reprodução foi interrompida.';
      case 2: return 'A conexão caiu durante a transmissão.';
      case 3: return 'O arquivo chegou corrompido ou em um formato que a TV não decodifica.';
      case 4: return 'A TV não conseguiu abrir este endereço. Pode ser o formato do stream ou o servidor recusando a conexão.';
      default: return 'Erro de mídia (código ' + e.code + ').';
    }
  }

  function falhar(msg) {
    /* Antes de mostrar erro, a escada tem uma carta na manga:
       outra fonte, ou um degrau abaixo. */
    if (aoVivo && !travado) {
      if (temOutraFonte()) { iFonte++; abrirFonte(0); return; }
      if (iDegrau < degraus.length - 1) { iDegrau++; iFonte = 0; abrirFonte(0); return; }
    }
    spinner.classList.add('hidden');
    errMsg.textContent = msg;
    errBox.classList.remove('hidden');
    ui.classList.remove('fade');
    w.Nav.definirEscopo(errBox);
  }

  /* -----------------------------------------------------------
     Progresso
     ----------------------------------------------------------- */
  function comecarASalvar() {
    pararDeSalvar();
    salvar = setInterval(function () { gravar(false); }, w.CFG.SAVE_EVERY_MS);
  }
  function pararDeSalvar() { if (salvar) { clearInterval(salvar); salvar = null; } }

  function gravar(forcar) {
    if (!item) return;

    /* Ao vivo não tem "onde parei": quando você volta, o programa
       é outro. E conteúdo adulto não é gravado em lugar nenhum —
       nem aqui, nem na nuvem, nem como recente. */
    if (aoVivo) return;
    if (w.Catalog.itemAdulto && w.Catalog.itemAdulto(item)) return;

    var pos = video.currentTime || 0;
    var dur = isFinite(video.duration) ? video.duration : 0;
    if (!forcar && pos < 5) return;

    w.Store.saveProgress({
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle || '',
      poster: item.poster || '',
      stream_url: item.url || '',
      position: pos,
      duration: dur,
      completed: dur > 0 && pos / dur >= w.CFG.COMPLETED_RATIO,
      series_id: item.seriesId || (serie && serie.seriesId) || '',
      series_title: item.seriesTitle || (serie && serie.title) || '',
      season: item.temporada || item.season || 0,
      episode: item.episodio || item.episode || 0
    });
  }

  /* -----------------------------------------------------------
     OSD
     -----------------------------------------------------------
     ↑ e ↓ ABREM o menu, sem pausar. Com ele aberto, trocam de
     linha. Era o que faltava: antes ↑/↓ pulavam 5 minutos, e não
     havia como chegar a coisa nenhuma.
     ----------------------------------------------------------- */
  function mostrarOSD() {
    ui.classList.remove('hidden', 'fade');
    adiarSumico();
  }

  function abrirOSD() {
    if (osdAberto) return;
    osdAberto = true;
    ui.classList.remove('hidden', 'fade');
    ui.classList.add('osd-on');
    /* Em filme e episódio o menu abre na LINHA DO TEMPO: é o
       controle mais pedido, e ficar a uma tecla dele seria um
       degrau a mais sem motivo. Ao vivo abre no transporte,
       porque não há linha do tempo para arrastar. */
    w.Nav.entrar(aoVivo ? 'transport' : 'timeline');
    comecarAMedir();
    adiarSumico();
  }

  function fecharOSD() {
    osdAberto = false;
    if (ui) ui.classList.remove('osd-on');
    if (painel) {
      painel.classList.add('hidden');
      painel.removeAttribute('data-region');
    }
    if (ui) ui.classList.remove('com-painel');
    pararDeMedir();
  }

  function adiarSumico() {
    clearTimeout(esconder);
    esconder = setTimeout(function () {
      if (!errBox.classList.contains('hidden')) return;
      if (!painel.classList.contains('hidden')) return;
      ui.classList.add('fade');
      fecharOSD();
    }, w.CFG.UI_HIDE_MS);
  }

  function ligarTransporte() {
    w.$('#osd-restart').onclick = function () { irPara(0); };
    w.$('#osd-back10').onclick  = function () { pularSegundos(-w.CFG.SEEK_SMALL_SEC); };
    w.$('#osd-fwd10').onclick   = function () { pularSegundos(w.CFG.SEEK_SMALL_SEC); };
    w.$('#osd-play').onclick    = alternarPausa;
    w.$('#osd-prev').onclick    = function () { proximoDaFila(-1); };
    w.$('#osd-next').onclick    = function () { proximoDaFila(1); };
  }

  /* Linha de contexto: muda conforme o que está tocando. */
  function montarContexto() {
    var ctx = w.$('#osd-context');
    ctx.innerHTML = '';

    function chip(id, rotulo, ic, acao, ativo) {
      var b = document.createElement('button');
      b.className = 'osd-chip' + (ativo ? ' ativo' : '');
      b.id = id;
      b.setAttribute('data-focusable', '');
      b.innerHTML = (ic ? w.icon(ic) : '') + '<span>' + w.esc(rotulo) + '</span>';
      b.onclick = acao;
      ctx.appendChild(b);
      return b;
    }

    if (aoVivo) {
      /* Os degraus daquele canal, o ativo marcado. Escolher fixa.
         O número entre parênteses é quantas fontes o degrau tem —
         é a informação que explica por que um "UHD" às vezes
         se recupera sozinho sem perder resolução. */
      degraus.forEach(function (d, i) {
        chip('osd-q-' + i,
             d.rotulo + (d.fontes.length > 1 ? ' (' + d.fontes.length + ')' : ''),
             null, function () { fixarDegrau(i); }, i === iDegrau);
      });
      if (degraus.length) {
        chip('osd-auto', travado ? 'Automático desligado' : 'Automático', 'layers',
             function () {
               travado = !travado;
               zerarMedidas();
               w.toast(travado ? 'Qualidade fixa.' : 'Qualidade automática de volta.');
               atualizarContexto();
             }, !travado);
      }
      chip('osd-fav', w.Store.isFavorite(item.id) ? 'Nos favoritos' : 'Favoritar', 'star',
           function () {
             var agora = w.Store.toggleFavorite(item);
             w.toast(agora ? '★ nos favoritos' : 'fora dos favoritos');
             montarContexto();
             w.Nav.entrar('context');
           }, w.Store.isFavorite(item.id));
    } else {
      if (fila.length > 1) chip('osd-eps', 'Episódios', 'list', abrirListaEpisodios);
      var alvoFav = serie || item;
      chip('osd-fav', w.Store.isFavorite(alvoFav.id) ? 'Nos favoritos' : 'Favoritar', 'star',
           function () {
             var agora = w.Store.toggleFavorite(alvoFav);
             w.toast(agora ? '★ nos favoritos' : 'fora dos favoritos');
             montarContexto();
             w.Nav.entrar('context');
           }, w.Store.isFavorite(alvoFav.id));
    }
  }

  function atualizarContexto() {
    if (!aoVivo) return;
    degraus.forEach(function (d, i) {
      var b = w.$('#osd-q-' + i);
      if (b) b.classList.toggle('ativo', i === iDegrau);
    });
    var a = w.$('#osd-auto');
    if (a) {
      a.classList.toggle('ativo', !travado);
      a.querySelector('span').textContent = travado ? 'Automático desligado' : 'Automático';
    }
  }

  /* Painel sobreposto com os episódios. O vídeo continua atrás. */
  /* -----------------------------------------------------------
     Painel de episódios
     -----------------------------------------------------------
     Duas correções em relação à primeira versão, as duas visíveis
     na tela:

       · a lista precisa de TRILHO. Sem um elemento com
         `data-scroll="x"`, o `nav.js` não tem o que deslocar e os
         episódios além do sexto ficavam fora da tela, sem jeito
         de alcançar;

       · e precisa dizer a TEMPORADA. A fila é a temporada inteira
         achatada, então "Episódios" sozinho não localiza ninguém.
     ----------------------------------------------------------- */
  function abrirListaEpisodios() {
    painel.innerHTML = '';

    /* Agrupa a fila por temporada. A fila é a série achatada — sem
       isto ela vira uma tripa única de 60 episódios, que foi o que
       você viu. Com o agrupamento, a lista mostra uma temporada de
       cada vez, e as outras ficam a uma tecla. */
    var porTemp = {}, ordem = [];
    fila.forEach(function (ep, i) {
      var t = ep.temporada || 1;
      if (!porTemp[t]) { porTemp[t] = []; ordem.push(t); }
      porTemp[t].push({ ep: ep, i: i });
    });
    ordem.sort(function (a, b) { return a - b; });
    var atualT = (fila[iFila] && fila[iFila].temporada) || ordem[0] || 1;

    var titulo = document.createElement('h3');
    titulo.textContent = 'Episódios';
    var conta = document.createElement('span');
    conta.className = 'osd-conta';
    conta.textContent = ordem.length > 1
      ? ordem.length + ' temporadas · ' + fila.length + ' episódios'
      : fila.length + ' episódios';
    titulo.appendChild(conta);
    painel.appendChild(titulo);

    /* Linha das temporadas. Só aparece quando há mais de uma —
       um seletor com uma opção só é ruído. */
    var linhaT = document.createElement('div');
    linhaT.className = 'osd-temps';
    if (ordem.length > 1) {
      linhaT.setAttribute('data-region', 'ptemp');
      linhaT.setAttribute('data-axis', 'x');
      linhaT.setAttribute('data-enter', '.osd-temp.ativo');
      linhaT.setAttribute('data-nb-down', 'peps');
      painel.appendChild(linhaT);
    }

    var janela = document.createElement('div');
    janela.className = 'osd-janela';
    janela.setAttribute('data-region', 'peps');
    janela.setAttribute('data-axis', 'x');
    janela.setAttribute('data-enter', '.osd-ep.ativo');
    if (ordem.length > 1) janela.setAttribute('data-nb-up', 'ptemp');
    var trilho = document.createElement('div');
    trilho.className = 'trilho osd-lista';
    trilho.setAttribute('data-scroll', 'x');
    janela.appendChild(trilho);
    painel.appendChild(janela);

    var dica = document.createElement('div');
    dica.className = 'osd-dica';
    dica.innerHTML = '<b>▲</b> volta para o player  ·  <b>OK</b> assiste este episódio';
    painel.appendChild(dica);

    function pintarEpisodios(t) {
      atualT = t;
      Array.prototype.slice.call(linhaT.children).forEach(function (b) {
        b.classList.toggle('ativo', Number(b.getAttribute('data-t')) === t);
      });
      trilho.innerHTML = '';
      (porTemp[t] || []).forEach(function (par) {
        var b = document.createElement('button');
        b.className = 'osd-ep' + (par.i === iFila ? ' ativo' : '');
        b.setAttribute('data-focusable', '');
        b.innerHTML = '<b>T' + (par.ep.temporada || t) + ' E' +
                      (par.ep.episodio || (par.i + 1)) + '</b>' +
                      '<span>' + w.esc(w.cleanName(par.ep.title || '')) + '</span>';
        b.onclick = function () { fecharPainel(); irParaIndice(par.i); };
        trilho.appendChild(b);
      });
    }

    ordem.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'osd-temp';
      b.setAttribute('data-focusable', '');
      b.setAttribute('data-t', t);
      b.textContent = 'T' + t;
      b.onclick = function () { pintarEpisodios(t); w.Nav.entrar('peps'); };
      linhaT.appendChild(b);
    });

    pintarEpisodios(atualT);

    painel.classList.remove('hidden');
    ui.classList.add('com-painel');
    w.Nav.entrar('peps');
    clearTimeout(esconder);
  }

  function fecharPainel() {
    painel.classList.add('hidden');
    ui.classList.remove('com-painel');
    painel.removeAttribute('data-region');
    /* as regiões internas somem com o conteúdo */
    painel.innerHTML = '';
    w.Nav.entrar('context');
    adiarSumico();
  }

  /* -----------------------------------------------------------
     Painel de aferição — §4.2-A
     -----------------------------------------------------------
     1 Hz, e só enquanto o OSD está aberto. Nada de
     requestAnimationFrame: medir não pode competir com decodificar.
     ----------------------------------------------------------- */
  function comecarAMedir() {
    pararDeMedir();
    medir();
    medidor = setInterval(medir, 1000);
  }
  function pararDeMedir() { if (medidor) { clearInterval(medidor); medidor = null; } }

  function medir() {
    if (!item) return;
    var decl = (aoVivo && degraus[iDegrau]) ? degraus[iDegrau].rotulo : (item.qualidade || '');
    var lw = video.videoWidth || 0, lh = video.videoHeight || 0;

    w.$('#afer-decl').textContent = decl ? decl + ' declarado' : 'sem marcador';
    w.$('#afer-real').textContent = lw && lh ? lw + '×' + lh + ' real' : 'medindo…';

    /* A comparação que denuncia canal mentiroso: "UHD" que chega
       abaixo de 1440 linhas não é UHD coisa nenhuma. */
    var prometeuAlto = /UHD|4K|2160/.test(decl);
    w.$('#afer').querySelector('.afer-l1')
      .classList.toggle('mentiu', prometeuAlto && lh > 0 && lh < 1440);

    var d = degraus[iDegrau];
    w.$('#afer-fonte').textContent = (d && d.fontes.length > 1)
      ? 'fonte ' + ((iFonte % d.fontes.length) + 1) + ' de ' + d.fontes.length
      : (travado ? 'fixo' : 'automático');

    var buf = 0;
    try {
      if (video.buffered && video.buffered.length) {
        buf = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
      }
    } catch (e) {}
    w.$('#afer-buf').textContent = 'buffer ' + Math.round(buf) + 's';

    var q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    var perdidos = q ? q.droppedVideoFrames : (video.webkitDroppedFrameCount || 0);
    var total = q ? q.totalVideoFrames : 0;
    w.$('#afer-quedas').textContent = total
      ? perdidos + ' quedas em ' + total
      : perdidos + ' quedas';
    w.$('#afer').querySelector('.afer-l2')
      .classList.toggle('ruim', total > 0 && perdidos / total > 0.02);

    w.$('#afer-hora').textContent = w.horaAgora();
  }

  /* -----------------------------------------------------------
     Transporte
     ----------------------------------------------------------- */
  function alternarPausa() {
    if (video.paused) video.play();
    else { video.pause(); gravar(true); }
    var b = w.$('#osd-play');
    if (b) b.innerHTML = w.icon(video.paused ? 'play' : 'pause');
    mostrarOSD();
  }

  function irPara(seg) {
    if (aoVivo || !isFinite(video.duration)) return;
    try { video.currentTime = Math.max(0, Math.min(video.duration - 1, seg)); } catch (e) {}
    mostrarOSD();
  }

  /* -----------------------------------------------------------
     ARRASTAR A LINHA DO TEMPO
     -----------------------------------------------------------
     Isto não existia direito, e você sentiu: com o menu aberto,
     ←/→ pertenciam à linha de botões; com ele fechado, davam
     saltos fixos de 10 s que não davam para acompanhar. Não
     havia como percorrer um filme.

     Agora são duas coisas distintas:

       · com a LINHA DO TEMPO em foco, ←/→ arrastam um cursor
         fantasma. O vídeo não sai do lugar enquanto você
         arrasta — só quando você para ou confirma com OK. Isso
         importa muito aqui: cada `currentTime` novo derruba o
         buffer e reabre a conexão, e com `max_connections: 1`
         reabrir dez vezes seguidas é a receita para o servidor
         recusar;

       · o passo ACELERA enquanto você segura. Uma tecla isolada
         anda 10 s; segurando, vira 30, 60, 120 e 300 s. Sem
         isso, atravessar um filme de duas horas custaria 720
         toques.
     ----------------------------------------------------------- */
  var PASSOS = [10, 30, 60, 120, 300];

  function passoAtual() {
    var agora = Date.now();
    /* toques em sequência (menos de 400 ms) sobem o degrau; uma
       pausa devolve o passo curto, que é o de precisão */
    if (agora - ultimoToque < 400) nivelPasso = Math.min(PASSOS.length - 1, nivelPasso + 1);
    else nivelPasso = 0;
    ultimoToque = agora;
    return PASSOS[nivelPasso];
  }

  function arrastar(direcao) {
    if (aoVivo || !isFinite(video.duration) || !video.duration) return;
    if (!arrastando) { arrastando = true; alvoArraste = video.currentTime || 0; }

    var passo = passoAtual();
    alvoArraste = Math.max(0, Math.min(video.duration - 1, alvoArraste + direcao * passo));
    pintarArraste(passo);
    mostrarOSD();

    clearTimeout(relogioPulo);
    relogioPulo = setTimeout(aplicarArraste, 700);
  }

  function pintarArraste(passo) {
    var frac = alvoArraste / video.duration;
    var f = w.$('#pl-fantasma');
    f.classList.remove('hidden');
    f.style.left = Math.min(100, Math.max(0, frac * 100)) + '%';
    f.setAttribute('data-t', w.fmtTime(alvoArraste) +
      (passo > 10 ? '  ·  ' + passo + 's' : ''));
    w.$('#pl-cur').textContent = w.fmtTime(alvoArraste);
    w.$('#pl-bar').classList.add('arrastando');
  }

  function aplicarArraste() {
    if (!arrastando) return;
    arrastando = false;
    nivelPasso = 0;
    clearTimeout(relogioPulo);
    w.$('#pl-fantasma').classList.add('hidden');
    w.$('#pl-bar').classList.remove('arrastando');
    try { video.currentTime = alvoArraste; } catch (e) {}
    barra(alvoArraste / video.duration, null);
  }

  /* Salto rápido, sem entrar no modo de arraste — é o que ←/→
     fazem com o menu fechado. */
  function pularSegundos(seg) {
    if (aoVivo || !isFinite(video.duration) || !video.duration) return;
    pulo += seg;
    var alvo = Math.max(0, Math.min(video.duration - 1, (video.currentTime || 0) + pulo));
    barra(alvo / video.duration, null);
    w.$('#pl-cur').textContent = w.fmtTime(alvo);
    mostrarOSD();

    clearTimeout(relogioPulo);
    relogioPulo = setTimeout(function () {
      try { video.currentTime = alvo; } catch (e) {}
      pulo = 0;
    }, 380);
  }

  function irParaIndice(i) {
    if (i < 0 || i >= fila.length) return;
    gravar(false);
    iFila = i;
    item = fila[i];
    aoVivo = item.kind === 'live';
    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !aoVivo);
    montarContexto();
    abrirFonte(0);
    mostrarOSD();
  }

  function proximoDaFila(passo, automatico) {
    if (!fila.length || iFila < 0) { if (automatico) w.Player.close(); return; }
    var i = iFila + passo;
    if (i < 0 || i >= fila.length) { if (automatico) w.Player.close(); return; }
    if (automatico) w.toast('A seguir: ' + w.cleanName(fila[i].title), 4000);
    irParaIndice(i);
  }

  /* -----------------------------------------------------------
     Teclas
     ----------------------------------------------------------- */
  function teclas(k) {
    if (!layer || layer.classList.contains('hidden')) return false;
    if (!errBox.classList.contains('hidden')) return false;
    if (!w.$('#resume-layer').classList.contains('hidden')) return false;

    /* Com o painel de episódios aberto, a navegação é dele. */
    if (!painel.classList.contains('hidden')) {
      /* Sair da lista de episódios: Voltar, ou ↑, que é o
         movimento intuitivo — a lista está por cima do player,
         então subir é sair dela. Sem isto a pessoa ficava presa
         percorrendo episódios sem caminho de volta. */
      if (k === w.KEY.BACK || k === w.KEY.ESC) { fecharPainel(); return true; }

      /* ↑ sobe um nível de cada vez: dos episódios para as
         temporadas, e das temporadas para o player. Se não houver
         seletor de temporada, ↑ já sai direto. */
      if (k === w.KEY.UP) {
        var noTopo = w.Nav.atual() && w.Nav.atual().classList.contains('osd-temp');
        var temSeletor = !!painel.querySelector('.osd-temp');
        if (noTopo || !temSeletor) { fecharPainel(); return true; }
        return false;                       /* nav leva aos botões de temporada */
      }
      adiarSumico();
      return false;
    }

    if (osdAberto) {
      if (k === w.KEY.BACK || k === w.KEY.ESC) {
        if (arrastando) { aplicarArraste(); return true; }
        fecharOSD(); return true;
      }

      /* Com a linha do tempo em foco, ←/→ são dela — não da
         navegação. É o que devolve o controle do filme. */
      var naLinha = w.Nav.atual() && w.Nav.atual().id === 'pl-bar';
      if (naLinha && (k === w.KEY.LEFT || k === w.KEY.RIGHT)) {
        arrastar(k === w.KEY.RIGHT ? 1 : -1);
        return true;
      }
      if (naLinha && k === w.KEY.OK) { aplicarArraste(); return true; }
      if (naLinha && (k === w.KEY.UP || k === w.KEY.DOWN) && arrastando) aplicarArraste();

      if (k === w.KEY.UP || k === w.KEY.DOWN || k === w.KEY.LEFT ||
          k === w.KEY.RIGHT || k === w.KEY.OK) {
        adiarSumico();
        return false;                                   /* navegação normal do OSD */
      }
    } else {
      switch (k) {
        case w.KEY.UP:
        case w.KEY.DOWN: abrirOSD(); return true;        /* ABRE o menu, não pula */
        case w.KEY.OK:
        case w.KEY.PLAYPAUSE: alternarPausa(); return true;
        case w.KEY.LEFT:  pularSegundos(-w.CFG.SEEK_SMALL_SEC); return true;
        case w.KEY.RIGHT: pularSegundos(w.CFG.SEEK_SMALL_SEC);  return true;
        default: break;
      }
    }

    switch (k) {
      case w.KEY.PLAY:  video.play();  mostrarOSD(); return true;
      case w.KEY.PAUSE: video.pause(); gravar(true); mostrarOSD(); return true;
      case w.KEY.STOP:
      case w.KEY.BACK:  w.Player.close(); return true;
      case w.KEY.RW:    pularSegundos(-w.CFG.SEEK_BIG_SEC); return true;
      case w.KEY.FF:    pularSegundos(w.CFG.SEEK_BIG_SEC);  return true;
      case w.KEY.CH_UP:   proximoDaFila(1);  return true;
      case w.KEY.CH_DOWN: proximoDaFila(-1); return true;
      default: mostrarOSD(); return false;
    }
  }

  /* -----------------------------------------------------------
     API
     ----------------------------------------------------------- */
  w.Player = {
    open: abrir,

    /* Booleano de verdade: antes de o player ser usado uma vez,
       `layer` é indefinido e isto devolvia `undefined` — que é
       falso o bastante para um `if`, e veneno para um teste. */
    isOpen: function () { return !!(layer && !layer.classList.contains('hidden')); },

    /* Expostos para o banco de provas dirigir o player sem
       depender de vídeo real tocando em tempo real. */
    _estado: function () {
      return {
        aoVivo: aoVivo, osd: osdAberto, travado: travado,
        degrau: degraus[iDegrau] ? degraus[iDegrau].rotulo : null,
        degraus: degraus.map(function (d) { return d.rotulo; }),
        fontes: degraus[iDegrau] ? degraus[iDegrau].fontes.length : 0,
        iFonte: iFonte, iFila: iFila, titulo: item ? item.title : null
      };
    },
    _engasgar: function (ms) {
      abriuEm = Date.now() - CARENCIA_MS - 1000;
      trocouEm = 0;
      travadas.push({ em: Date.now() - ms, ms: ms, aberta: false });
      conferirEscada();
    },
    _fixar: fixarDegrau,
    _travas: function () {
      return { registradas: travadas.length, suspeitaAberta: !!suspeita,
               msNaJanela: Math.round(msTravadosNaJanela()),
               rodinha: !spinner.classList.contains('hidden') };
    },
    _arraste: function () {
      return { ativo: arrastando, alvo: Math.round(alvoArraste), passo: PASSOS[nivelPasso] };
    },
    _abrirOSD: abrirOSD,

    close: function () {
      if (!layer || layer.classList.contains('hidden')) return;
      if (arrastando) { arrastando = false; }
      gravar(true);
      desligar();
      clearTimeout(esconder);
      fecharOSD();
      w.Nav.removerTecla(teclas);
      if (w.Nav.escopo() === errBox) w.Nav.limparEscopo();
      errBox.classList.add('hidden');
      layer.classList.add('hidden');
      var cb = aoFechar;
      aoFechar = null; item = null; fila = []; iFila = -1; serie = null;
      grupo = null; degraus = []; travado = false;
      if (cb) cb();
    }
  };

})(window);


/* ===== views.js ================================================== */
/* =========================================================
   AS TELAS
   =========================================================
   Reescritas sobre três coisas que não existiam antes: o motor
   de regiões (`nav.js`), a virtualização (`virt.js`) e a camada
   de dados por POST com cache granular (`catalog.js`).

   O defeito que motivou tudo isto, nas suas palavras: "as
   colunas visuais do sidebar era na realidade tudo uma única
   grande coluna". A causa principal era o motor antigo, mas as
   telas ajudavam — nenhuma declarava onde uma região terminava
   e a outra começava, então não havia o que respeitar.

   Aqui toda tela declara suas regiões e seus vizinhos.
   ========================================================= */
(function (w) {
  'use strict';

  var el = w.el;

  /* A grade calcula as próprias colunas a partir da largura da
     janela — ver o comentário no `virt.js`. Números fixos aqui
     foram o motivo de a grade vazar pela direita. */
  var COLUNAS = 'auto';

  /* -----------------------------------------------------------
     Abrir conteúdo
     ----------------------------------------------------------- */
  function tocar(item, opts) { w.Player.open(item, opts || {}); }

  /* -----------------------------------------------------------
     Tomar o foco só quando ele é nosso
     -----------------------------------------------------------
     As telas montam em duas etapas: o esqueleto entra na hora, o
     conteúdo chega depois da rede. Se a segunda etapa chamasse
     `Nav.entrar` sem perguntar, ela arrancaria o foco de onde a
     pessoa já tivesse levado nesse meio tempo — quase sempre o
     menu lateral, que é o primeiro lugar para onde se anda.

     Regra: só assume o foco se ninguém tem, se quem tinha saiu do
     documento (é o caso quando o palco é trocado), ou se o foco
     ainda está dentro do palco. Foco no menu é do menu.
     ----------------------------------------------------------- */
  function podeAssumir() {
    var atual = w.Nav.atual();
    return !(atual && document.body.contains(atual) && !atual.closest('#stage'));
  }
  function assumirFoco(regiao) {
    return podeAssumir() ? w.Nav.entrar(regiao) : false;
  }
  function assumirFocoEm(elemento) {
    return (elemento && podeAssumir()) ? w.Nav.focar(elemento) : false;
  }

  function abrir(item) {
    if (!item) return;
    if (item.kind === 'live')   return tocar(item);
    if (item.kind === 'movie')  return w.App.go('movie-detail',  { id: item.streamId, item: item });
    if (item.kind === 'series') return w.App.go('series-detail', { id: item.seriesId, item: item });
    return tocar(item);
  }

  /* -----------------------------------------------------------
     Coluna de categorias
     -----------------------------------------------------------
     Comum a Ao Vivo, Filmes e Séries. A categoria é carregada
     quando o foco DESCANSA nela — não a cada tecla. Sem essa
     espera, atravessar 50 categorias dispara 50 carregamentos,
     e era isso que fazia a lista engasgar ao rolar rápido.
     ----------------------------------------------------------- */
  var esperaCat = null;
  var ESPERA = 320;

  /* Id reservado da pasta de mentira. Começa com dois sublinhados
     porque nenhum category_id do provedor é assim. */
  var FAVORITOS = '__favoritos__';

  /* "Todos": a pasta que faltava. Entrar em Filmes e cair numa
     pasta arbitrária do provedor é uma escolha que ninguém pediu;
     o natural é ver o acervo inteiro e afunilar depois, com o
     filtro ou com as pastas. Custa uma chamada maior (o painel
     devolve o catálogo inteiro do tipo), mas ela é cacheada e a
     grade é virtualizada — 20 mil itens no ar dão 50 nós no DOM. */
  var TODOS = '__todos__';

  /* "Histórico": os últimos assistidos daquele tipo. Nunca inclui
     adulto — o filtro é o mesmo da tela inicial, e a origem é o
     Store, que já não grava adulto nenhum. */
  var HISTORICO = '__historico__';

  function historicoDe(tipo) {
    var alvo = tipo === 'series' ? 'episode' : tipo === 'movie' ? 'movie' : 'live';
    var vistos = {};
    var lista = w.Store.historyList(200).filter(function (r) {
      if (!r || r.kind !== alvo) return false;
      if (w.Catalog.itemAdulto && w.Catalog.itemAdulto(r)) return false;
      /* uma série entra uma vez só, pelo episódio mais recente */
      var chave = (tipo === 'series' && r.series_id) ? 's:' + r.series_id : r.id;
      if (vistos[chave]) return false;
      vistos[chave] = true;
      return true;
    });
    return Promise.resolve(lista.map(function (r) { return itemDoHistorico(r, tipo); }));
  }

  function itemDoHistorico(r, tipo) {
    return {
      id: r.id,
      kind: tipo === 'series' ? 'series' : r.kind,
      seriesId: r.series_id || '',
      streamId: String(r.id || '').replace(/^movie:/, ''),
      title: (tipo === 'series' && r.series_title) ? r.series_title : r.title,
      subtitle: r.season ? 'T' + r.season + ' E' + r.episode : '',
      poster: r.poster || '',
      url: r.stream_url || ''
    };
  }

  /* Os canais marcados, com o objeto COMPLETO — o favorito
     guardado no Store tem só o essencial para a lista, e para
     tocar é preciso a escada de qualidade inteira. */
  /* Qual "kind" de favorito pertence a cada seção. */
  function kindDe(tipo) {
    return tipo === 'series' ? 'series' : tipo === 'movie' ? 'movie' : 'live';
  }

  function temFavoritosDe(tipo) {
    var k = kindDe(tipo);
    return w.Store.favorites().some(function (f) { return f.kind === k; });
  }

  function favoritosDe(tipo) {
    if (tipo === 'live') return canaisFavoritos();
    var k = kindDe(tipo);
    return Promise.resolve(w.Store.favorites().filter(function (f) {
      return f.kind === k && naoAdulto(f);
    }));
  }

  function canaisFavoritos() {
    var marcados = {};
    w.Store.favorites().forEach(function (f) {
      if (f.kind === 'live') marcados[f.id] = true;
    });
    if (!Object.keys(marcados).length) return Promise.resolve([]);
    return w.Catalog.canais().then(function (todos) {
      return todos.filter(function (c) { return marcados[c.id]; });
    });
  }

  function colunaCategorias(cats, aoEscolher) {
    var aside = el('div', {
      class: 'coluna-cats',
      'data-region': 'cats', 'data-axis': 'y',
      'data-nb-left': 'rail', 'data-nb-right': 'grid',
      'data-enter': 'last'
    });
    var janela = el('div', { class: 'janela cheia' });
    var trilho = el('div', { class: 'trilho', 'data-scroll': 'y' });

    cats.forEach(function (c, i) {
      var b = el('button', { class: 'cat-item', 'data-focusable': '', text: c.nome });
      b._cat = c;
      b._escolher = function () {
        w.$$('.cat-item', aside).forEach(function (o) { o.classList.remove('ativa'); });
        b.classList.add('ativa');
        aoEscolher(c);
      };
      /* Recarregar a MESMA pasta. Existe para a pasta Favoritos:
         quando você desmarca um canal olhando para ela, a lista
         tem de se refazer, e `_escolher` sozinho não faz nada
         porque a pasta já é a atual. */
      b._recarregar = function () { aoEscolher(c, true); };
      b.onclick = b._escolher;
      if (i === 0) b.classList.add('ativa');
      trilho.appendChild(b);
    });

    janela.appendChild(trilho);
    aside.appendChild(janela);
    return aside;
  }

  /* Chamado pelo roteador a cada mudança de foco. */
  function aoFocarCategoria(elemento) {
    clearTimeout(esperaCat);
    if (!elemento || !elemento._escolher) return;
    esperaCat = setTimeout(function () {
      if (w.Nav.atual() === elemento) elemento._escolher();
    }, ESPERA);
  }

  /* -----------------------------------------------------------
     Navegar: coluna de categorias + grade
     ----------------------------------------------------------- */
  function navegar(tipo, forma) {
    var tela = w.UI.tela('nav-' + tipo);
    var conteudo = el('div', { class: 'conteudo' });

    /* ---------------------------------------------------------
       Filtrar DENTRO da pasta
       ---------------------------------------------------------
       A busca do menu varre o catálogo inteiro e é para quando
       você não sabe onde a coisa está. Este campo é outra coisa:
       a pasta já está aberta e carregada na memória, então
       filtrar é instantâneo e não toca na rede.

       Fica acima da grade e é vizinho dela para cima — ↑ na
       primeira linha chega nele, ↓ volta. E a tecla vermelha
       pula direto para cá de qualquer lugar da tela.
       --------------------------------------------------------- */
    var barra = el('div', {
      class: 'filtro-barra',
      'data-region': 'filtro', 'data-axis': 'x',
      'data-nb-left': 'cats', 'data-nb-down': 'grid', 'data-enter': 'first'
    });
    var campo = el('input', { class: 'filtro-campo', 'data-focusable': '', type: 'text',
                              placeholder: 'Filtrar nesta pasta' });
    var conta = el('span', { class: 'filtro-conta' });
    barra.appendChild(campo);
    barra.appendChild(conta);

    /* -------------------------------------------------------
       Ordenação
       -------------------------------------------------------
       O provedor manda a lista na ordem dele, que não é ordem
       nenhuma. Três critérios cobrem o uso real: como veio,
       o que entrou por último, e o que é bem avaliado. A nota
       vem do próprio painel, então é de graça.
       ------------------------------------------------------- */
    var ORDENS = [
      { id: 'padrao',   nome: 'Da pasta' },
      { id: 'recentes', nome: 'Recentes' },
      { id: 'nota',     nome: 'Nota' }
    ];
    var ordemAtual = 'padrao';
    var botoesOrdem = [];

    if (tipo !== 'live') {
      var caixaOrdem = el('div', { class: 'filtro-ordem' });
      ORDENS.forEach(function (o) {
        var b = el('button', { class: 'ordem-btn' + (o.id === 'padrao' ? ' ativo' : ''),
                               'data-focusable': '', text: o.nome });
        b.onclick = function () {
          ordemAtual = o.id;
          botoesOrdem.forEach(function (x) { x.classList.remove('ativo'); });
          b.classList.add('ativo');
          aplicarFiltro();
        };
        botoesOrdem.push(b);
        caixaOrdem.appendChild(b);
      });
      barra.appendChild(caixaOrdem);
    }

    function ordenar(lista) {
      if (ordemAtual === 'padrao') return lista;
      var copia = lista.slice();
      if (ordemAtual === 'recentes') {
        copia.sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
      } else {
        copia.sort(function (a, b) {
          return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
        });
      }
      return copia;
    }

    var caixaGrade = el('div', {
      class: 'grade-caixa',
      'data-region': 'grid', 'data-axis': 'grid',
      'data-nb-left': 'cats', 'data-nb-up': 'filtro', 'data-enter': 'last'
    });
    caixaGrade.appendChild(el('div', { class: 'carregando', text: 'Carregando…' }));

    conteudo.appendChild(barra);
    conteudo.appendChild(caixaGrade);

    var atual = null;
    var itensDaPasta = [];

    function normal(s) {
      return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function pintar(itens, cat) {
      w.Virt.dentroDe(caixaGrade).forEach(function (c) { c.destruir(); });
      w.clear(caixaGrade);
      if (!itens.length) {
        caixaGrade.appendChild(campo.value.trim()
          ? w.UI.vazio('Nada com "' + campo.value.trim() + '"',
                       'Nenhum item desta pasta bate com o filtro.')
          : atual === HISTORICO
            ? w.UI.vazio('Nada por aqui ainda',
                         'O que você assistir aparece nesta pasta. Conteúdo adulto ' +
                         'nunca entra — nem aqui, nem em recentes, nem em relacionados.')
          : atual === FAVORITOS
            ? w.UI.vazio('Nada favoritado ainda',
                         tipo === 'live'
                           ? 'Segure OK sobre um canal em qualquer pasta para marcá-lo. ' +
                             'Ele aparece aqui na hora.'
                           : 'Use o botão Favoritar na tela do título. ' +
                             'Ele aparece aqui na hora.')
            : w.UI.vazio('Nada nesta pasta',
                         'A categoria "' + (cat ? cat.nome : '') + '" veio vazia do provedor.'));
        return;
      }
      var g = w.UI.grade(itens, { forma: forma, colunas: COLUNAS, aoAbrir: abrir });
      caixaGrade.appendChild(g);
      w.UI.ligar(g);
    }

    function aplicarFiltro() {
      var termo = normal(campo.value.trim());
      var lista = !termo ? itensDaPasta : itensDaPasta.filter(function (i) {
        return normal(i.title).indexOf(termo) >= 0;
      });
      conta.textContent = termo
        ? lista.length + ' de ' + itensDaPasta.length
        : itensDaPasta.length + ' itens';
      pintar(ordenar(lista), null);
    }
    campo.oninput = w.debounce(aplicarFiltro, 160);

    function mostrar(cat, forcar) {
      if (atual === cat.id && !forcar) return;
      atual = cat.id;
      campo.value = '';
      conta.textContent = '';
      w.Virt.dentroDe(caixaGrade).forEach(function (c) { c.destruir(); });
      w.clear(caixaGrade);
      caixaGrade.appendChild(el('div', { class: 'carregando', text: 'Carregando…' }));

      (cat.id === FAVORITOS ? favoritosDe(tipo)
        : cat.id === HISTORICO ? historicoDe(tipo)
        : cat.id === TODOS ? w.Catalog.itens(tipo, '')
        : w.Catalog.itens(tipo, cat.id))
      .then(function (itens) {
        if (atual !== cat.id) return;                 /* já mudou de categoria */
        itensDaPasta = itens;
        conta.textContent = itens.length + ' itens';
        pintar(ordenar(itens), cat);
      }).catch(function (e) {
        if (atual !== cat.id) return;
        w.clear(caixaGrade);
        caixaGrade.appendChild(w.UI.erro(e, function () { atual = null; mostrar(cat); }));
      });
    }

    /* tecla vermelha: vai direto para o filtro desta pasta */
    tela._tecla = function (k) {
      if (k !== w.KEY.RED) return false;
      w.Nav.focar(campo);
      return true;
    };

    w.Catalog.categorias(tipo).then(function (cats) {
      /* ---------------------------------------------------------
         A pasta Favoritos
         ---------------------------------------------------------
         Ideia sua, e é a forma certa: em vez de uma lista de
         favoritos escondida noutro canto do app, uma PASTA no
         mesmo lugar das outras, primeira da coluna. Você entra
         em Ao Vivo e os seus canais estão ali, antes de tudo.

         É uma pasta de mentira: não existe no provedor, é montada
         a partir do que você marcou. Por isso o id reservado. */
      /* Favorito tem UM lugar: a pasta. Ele estava também em duas
         fileiras da tela inicial, e você viu o resultado — o mesmo
         canal aparecendo duas vezes na abertura. Uma pasta em cada
         seção é suficiente e é onde a pessoa procura. */
      var virtuais = [];
      if (tipo !== 'live') virtuais.push({ id: TODOS, nome: 'Todos' });
      virtuais.push({ id: FAVORITOS, nome: '★ Favoritos' });
      virtuais.push({ id: HISTORICO, nome: 'Histórico' });
      cats = virtuais.concat(cats);
      if (!cats.length) {
        var vaz = w.UI.tela();
        vaz.appendChild(w.UI.vazio('Sem categorias',
          'O provedor não devolveu nenhuma pasta para esta seção.'));
        w.UI.trocar(vaz);
        return;
      }
      var coluna = colunaCategorias(cats, mostrar);
      tela.appendChild(coluna);
      tela.appendChild(conteudo);
      w.UI.trocar(tela, 'cats');

      /* A pasta Favoritos fica sempre visível — é assim que se
         descobre que ela existe. Mas abrir Ao Vivo numa pasta
         vazia seria uma recepção ruim, então a seleção inicial
         só cai nela quando há o que mostrar. */
      /* A seleção inicial pula as pastas virtuais VAZIAS — e o
         vazio é por tipo. O teste antigo perguntava "existe
         algum histórico?", e como havia histórico de filmes, a
         pasta Histórico de CANAIS era escolhida e a tela de Ao
         Vivo abria em branco. Medido no app real: 53 focáveis na
         coluna e zero cartões. */
      var vaziaAgora = function (id) {
        if (id === FAVORITOS) return !temFavoritosDe(tipo);
        if (id === HISTORICO) {
          var kind = tipo === 'series' ? 'episode' : tipo === 'movie' ? 'movie' : 'live';
          return !w.Store.historyList(200).some(function (r) { return r && r.kind === kind; });
        }
        return false;
      };
      var inicial = 0;
      while (inicial < cats.length - 1 && vaziaAgora(cats[inicial].id)) inicial++;
      var botoes = w.$$('.cat-item', coluna);
      botoes.forEach(function (b) { b.classList.remove('ativa'); });
      if (botoes[inicial]) botoes[inicial].classList.add('ativa');
      mostrar(cats[inicial]);

      /* O foco tem de cair na pasta ATIVA, não na primeira da
         coluna. Sem isto acontecia uma coisa que parecia
         fantasma: a grade carregava a pasta certa, o foco ia
         para Favoritos (vazia), e 320 ms depois o carregamento
         por descanso de foco trocava tudo por uma tela em
         branco. Levava a culpa a virtualização, e a culpa era
         daqui. */
      assumirFocoEm(botoes[inicial]);
    }).catch(function (e) {
      var t = w.UI.tela();
      t.appendChild(w.UI.erro(e, function () { navegar(tipo, forma); }));
      w.UI.trocar(t);
    });

    return tela;
  }

  /* -----------------------------------------------------------
     Início
     -----------------------------------------------------------
     O destaque não é mais um carrossel que troca sozinho. Ele
     mostra o que você estava assistindo — que é a coisa que uma
     pessoa mais quer ao ligar a TV — e só cai para uma novidade
     quando não há nada em andamento.

     E ficou LARGO. Você notou que parecia estreito e errado:
     era, porque dividia espaço com um carrossel que já não
     existe mais.
     ----------------------------------------------------------- */
  function destaque(item, aoTocar, aoDetalhe) {
    var sec = el('div', {
      class: 'hero',
      'data-region': 'hero', 'data-axis': 'x',
      'data-nb-left': 'rail', 'data-nb-down': 'rows', 'data-enter': 'first'
    });

    if (item.backdrop || item.poster) {
      var arte = el('div', { class: 'hero-arte' });
      arte.style.backgroundImage = 'url("' +
        String(item.backdrop || item.poster).replace(/"/g, '%22') + '")';
      sec.appendChild(arte);
      sec.appendChild(el('div', { class: 'hero-veu' }));
    }

    var texto = el('div', { class: 'hero-texto' });
    texto.appendChild(el('h1', { class: 'hero-titulo', text: w.cleanName(item.title || '') }));
    if (item.subtitle) texto.appendChild(el('div', { class: 'hero-sub', text: item.subtitle }));
    if (item.plot) texto.appendChild(el('p', { class: 'hero-plot', text: item.plot }));

    var botoes = el('div', { class: 'hero-btns' });
    var b1 = el('button', { class: 'btn primary', 'data-focusable': '' });
    b1.innerHTML = w.icon('play') + '<span>' + (item.retomar ? 'Continuar' : 'Assistir') + '</span>';
    b1.onclick = function () { aoTocar(item); };
    botoes.appendChild(b1);

    if (aoDetalhe && item.kind !== 'live') {
      var b2 = el('button', { class: 'btn ghost', 'data-focusable': '' });
      b2.innerHTML = w.icon('info') + '<span>Mais informações</span>';
      b2.onclick = function () { aoDetalhe(item); };
      botoes.appendChild(b2);
    }
    texto.appendChild(botoes);
    sec.appendChild(texto);
    return sec;
  }

  function inicio() {
    var tela = w.UI.tela('home');
    var janela = el('div', { class: 'janela cheia' });
    var coluna = el('div', { class: 'trilho', 'data-scroll': 'y' });
    var fileiras = el('div', {
      'data-region': 'rows', 'data-axis': 'rows',
      'data-nb-left': 'rail', 'data-nb-up': 'hero', 'data-enter': 'last'
    });

    /* enquanto os dados não chegam, o esqueleto segura o espaço
       para a tela não pular quando eles chegarem */
    fileiras.appendChild(w.UI.esqueleto(8, 'poster'));
    coluna.appendChild(fileiras);
    janela.appendChild(coluna);
    tela.appendChild(janela);
    w.UI.trocar(tela, 'rows');

    var continuar = agruparPorSerie(w.Store.continueList(40).filter(naoAdulto)).slice(0, 20);

    /* O destaque precisa de arte. Um registro antigo sem capa
       deixava a tela de abertura preta com um título solto —
       foi o que apareceu com "Moana". Se o primeiro não tem,
       pega o primeiro que tiver. */
    var comArte = continuar.filter(comCapa)[0];
    var promessaDestaque = comArte
      ? Promise.resolve(marcarRetomar(comArte))
      : w.Catalog.categorias('movie')
          .then(function (cs) { return cs.length ? w.Catalog.itens('movie', cs[0].id) : []; })
          .then(function (fs) { return fs.filter(comCapa)[0] || null; })
          .catch(function () { return null; });

    Promise.all([
      promessaDestaque,
      w.Catalog.canais().catch(function () { return []; }),
      pastasEscolhidas('movie'),
      pastasEscolhidas('series')
    ]).then(function (r) {
      var dest = r[0], canais = r[1], filmes = r[2], series = r[3];
      /* Tudo o que é "voltar a assistir" mora numa fileira só.
         Três fileiras quase iguais na abertura era ruído — e as
         capas em pé no meio das deitadas ficavam desalinhadas. */
      continuar = juntarComRecentes(continuar);
      recuperarCapas(continuar, fileiras);

      w.clear(fileiras);
      w.clear(coluna);

      if (dest) coluna.appendChild(destaque(dest, tocarDoDestaque, abrir));
      coluna.appendChild(fileiras);

      if (continuar.length) {
        fileiras.appendChild(w.UI.fileira('Continuar assistindo', continuar,
          { forma: 'wide', aoAbrir: tocarDoDestaque }));
      }
      if (canais.length) {
        fileiras.appendChild(w.UI.fileira('Canais ao vivo', porHabito(canais).slice(0, 120),
          { forma: 'logo', aoAbrir: abrir, subtitulo: canais.length + ' canais' }));
      }
      filmes.concat(series).forEach(function (bloco) {
        if (bloco.itens.length) {
          fileiras.appendChild(w.UI.fileira(bloco.nome, bloco.itens,
            { forma: 'poster', aoAbrir: abrir }));
        }
      });

      if (!fileiras.children.length) {
        fileiras.appendChild(w.UI.vazio('Sua lista está vazia',
          'Não consegui montar nenhuma fileira com o que o provedor devolveu.'));
      }

      w.UI.ligar(tela);
      w.UI.apontarMenu(dest ? 'hero' : 'rows');
      if (dest) assumirFoco('hero'); else assumirFoco('rows');
    }).catch(function (e) {
      var t = w.UI.tela();
      t.appendChild(w.UI.erro(e, inicio));
      w.UI.trocar(t);
    });

    return tela;
  }

  /* Últimos assistidos de um tipo, sem repetir série e sem
     adulto. É a fonte das fileiras "recentes" da inicial. */
  /* Continuar assistindo = o que está em andamento, e logo atrás
     o que já foi assistido. Uma fileira só, sempre em formato
     deitado. */
  function juntarComRecentes(emAndamento) {
    var tem = {};
    emAndamento.forEach(function (r) {
      tem[r.series_id ? 's:' + r.series_id : r.id] = true;
    });
    var recentes = historicoCurto('episode').concat(historicoCurto('movie'))
      .filter(function (r) {
        /* assistido até o fim não é "continuar" — sai da abertura
           e fica no Histórico, com a etiqueta na capa */
        var p = w.Store.progressOf(r.id);
        if (p && p.completed) return false;
        var chave = r.seriesId ? 's:' + r.seriesId : r.id;
        if (tem[chave]) return false;
        tem[chave] = true;
        return true;
      });
    return emAndamento.concat(recentes).slice(0, 30);
  }

  /* Canais na ordem em que você usa. Os abertos recentemente vão
     para a frente; o resto mantém a ordem do provedor. */
  function porHabito(canais) {
    var quando = {};
    w.Store.recentChannels(40).forEach(function (r, i) { quando[r.id] = i; });
    var usados = [], resto = [];
    canais.forEach(function (c) {
      if (quando[c.id] !== undefined) usados.push(c); else resto.push(c);
    });
    usados.sort(function (a, b) { return quando[a.id] - quando[b.id]; });
    return usados.concat(resto);
  }

  function historicoCurto(kind) {
    var vistos = {};
    return w.Store.historyList(120).filter(function (r) {
      if (!r || r.kind !== kind) return false;
      if (w.Catalog.itemAdulto && w.Catalog.itemAdulto(r)) return false;
      var chave = r.series_id ? 's:' + r.series_id : r.id;
      if (vistos[chave]) return false;
      vistos[chave] = true;
      return true;
    }).slice(0, 20).map(function (r) {
      return itemDoHistorico(r, r.kind === 'episode' ? 'series' : 'movie');
    });
  }

  /* Quais pastas viram fileira na inicial.
     -------------------------------------------------------
     Pegar "as duas primeiras" era arbitrário: a ordem é a do
     provedor. Agora há uma lista de preferências por nome — 4K,
     lançamentos, os catálogos grandes — e o resto entra por
     ordem, até completar. */
  var PREFERIDAS = [/\b4k\b/i, /lan[çc]amento/i, /netflix/i, /prime/i,
                    /hbo/i, /disney/i, /a[çc][ãa]o/i];

  function pastasEscolhidas(tipo, quantas) {
    quantas = quantas || 3;
    return w.Catalog.categorias(tipo).then(function (cats) {
      var uteis = cats.filter(function (c) { return !w.Catalog.ehAdulta(c.nome); });
      var nota = function (c) {
        for (var i = 0; i < PREFERIDAS.length; i++) {
          if (PREFERIDAS[i].test(c.nome)) return i;
        }
        return PREFERIDAS.length;
      };
      var ordenadas = uteis.slice().sort(function (a, b) { return nota(a) - nota(b); });
      return Promise.all(ordenadas.slice(0, quantas).map(function (c) {
        return w.Catalog.itens(tipo, c.id)
          .then(function (its) { return { nome: c.nome, itens: its.slice(0, 60) }; })
          .catch(function () { return { nome: c.nome, itens: [] }; });
      }));
    }).catch(function () { return []; });
  }

  function primeirasPastas(tipo, quantas) {
    return w.Catalog.categorias(tipo).then(function (cats) {
      var uteis = cats.filter(function (c) { return !w.Catalog.ehAdulta(c.nome); })
                      .slice(0, quantas);
      return Promise.all(uteis.map(function (c) {
        return w.Catalog.itens(tipo, c.id)
          .then(function (its) { return { nome: c.nome, itens: its.slice(0, 60) }; })
          .catch(function () { return { nome: c.nome, itens: [] }; });
      }));
    }).catch(function () { return []; });
  }

  /* Uma série não pode ocupar cinco lugares em "continuar
     assistindo" com cinco episódios. Fica o mais recente de cada
     série, com o rótulo da temporada e do episódio — que é o que
     faltava para as séries aparecerem de forma útil na inicial. */
  function agruparPorSerie(lista) {
    var vistos = {}, saida = [];
    lista.forEach(function (r) {
      var chave = r.series_id ? 's:' + r.series_id : r.id;
      if (vistos[chave]) return;
      vistos[chave] = true;
      if (r.series_id) {
        var c = {};
        Object.keys(r).forEach(function (k) { c[k] = r[k]; });
        c.title = r.series_title || r.title;
        c.subtitle = (r.season ? 'T' + r.season : '') +
                     (r.episode ? ' E' + r.episode : '');
        saida.push(c);
      } else saida.push(r);
    });
    return saida;
  }

  /* Registro sem capa
     -------------------------------------------------------
     O progresso guarda a capa no momento em que você dá play.
     Quem tocou por um caminho sem capa (busca antiga, registro
     de uma versão anterior) ficou com o campo vazio, e o cartão
     virava duas letras num quadrado. A capa está a uma chamada
     de distância e ela é cacheada — então busca e conserta,
     inclusive no registro, para não repetir amanhã. */
  function recuperarCapas(lista, raiz) {
    /* O registro de progresso guarda só `id`, `kind`, `title` e
       `poster` — não guarda `streamId`. Eu filtrava por
       `streamId` e o item nunca entrava na recuperação. O número
       está dentro do próprio id (`movie:640392`), então é de lá
       que ele sai. */
    lista.filter(function (i) { return !i.poster && i.id; })
      .slice(0, 8)
      .forEach(function (item) {
        var num = String(item.id).replace(/^[a-z]+:/, '');
        var ehSerie = item.seriesId || /^series:/.test(item.id);
        if (!num) return;
        var busca = ehSerie
          ? w.Catalog.serie(item.seriesId || num)
          : w.Catalog.filme(item.streamId || num);
        busca.then(function (info) {
          var capa = info && (info.poster || info.fundo);
          if (!capa) return;
          item.poster = capa;
          var p = w.Store.progressOf(item.id);
          if (p) { p.poster = capa; w.Store.saveProgress(p); }
          var no = raiz.querySelector('.card[data-id="' + item.id + '"]');
          if (no) {
            var casca = no.querySelector('.shell');
            if (casca && !casca.querySelector('img')) {
              w.clear(casca);
              var img = document.createElement('img');
              img.decoding = 'async';
              img.onload = function () {
                if (img.naturalHeight > img.naturalWidth * 1.1) casca.classList.add('retrato');
              };
              img.src = capa;
              casca.appendChild(img);
            }
          }
        }).catch(function () {});
      });
  }

  function naoAdulto(item) {
    return !(w.Catalog.itemAdulto && w.Catalog.itemAdulto(item));
  }
  function comCapa(i) { return !!(i.backdrop || i.poster); }
  function marcarRetomar(i) {
    var c = {}; Object.keys(i).forEach(function (k) { c[k] = i[k]; });
    c.retomar = true; return c;
  }
  function tocarDoDestaque(item) {
    if (item.kind === 'series' || item.seriesId) return abrir(item);
    tocar(item);
  }

  /* -----------------------------------------------------------
     Detalhe de filme
     ----------------------------------------------------------- */
  function detalheFilme(params) {
    var base = params.item || {};
    var tela = w.UI.tela('detalhe');
    var janela = el('div', { class: 'janela cheia' });
    var coluna = el('div', { class: 'trilho', 'data-scroll': 'y' });
    janela.appendChild(coluna);
    tela.appendChild(janela);
    w.UI.trocar(tela, 'acoes');

    w.Catalog.filme(params.id).then(function (info) {
      var item = mesclar(base, info);
      var acoesFilme = [
        { rotulo: 'Assistir', icone: 'play', primario: true,
          acao: function () { tocar(item); } },
        botaoFavorito(item)
      ];
      acoesFilme.abaixo = 'rows';
      coluna.appendChild(cabecalhoDetalhe(item, acoesFilme));

      /* Relacionados de verdade: franquia primeiro, depois nome
         parecido, depois gênero. A versão anterior sorteava. */
      var pasta = item.categoryId || item.groupId;
      if (pasta) {
        w.Catalog.itens('movie', pasta).then(function (universo) {
          var rel = w.Catalog.relacionados(item, universo, 20);
          if (!rel.length) return;
          var cxF = caixaRelacionados(rel, 'acoes');
          coluna.appendChild(cxF);
          w.UI.ligar(cxF);          /* sem isto a fileira existe e fica vazia */
        }).catch(function () {});
      }
      assumirFoco('acoes');
    }).catch(function (e) {
      coluna.appendChild(w.UI.erro(e, function () { detalheFilme(params); }));
    });

    return tela;
  }

  /* -----------------------------------------------------------
     Detalhe de série
     ----------------------------------------------------------- */
  function detalheSerie(params) {
    var base = params.item || {};
    var tela = w.UI.tela('detalhe');
    var janela = el('div', { class: 'janela cheia' });
    var coluna = el('div', { class: 'trilho', 'data-scroll': 'y' });
    janela.appendChild(coluna);
    tela.appendChild(janela);
    w.UI.trocar(tela, 'acoes');

    w.Catalog.serie(params.id).then(function (info) {
      var item = mesclar(base, info);
      var todos = [];
      info.temporadas.forEach(function (t) { todos = todos.concat(t.episodios); });

      var ultimo = w.Store.lastEpisodeOf(params.id);
      var proximo = proximoEpisodio(todos, ultimo);

      var acoesSerie = [
        { rotulo: proximo.rotulo, icone: 'play', primario: true,
          acao: function () { tocarEpisodio(proximo.ep, todos, item); } },
        botaoFavorito(item)
      ];
      acoesSerie.abaixo = 'seasons';
      coluna.appendChild(cabecalhoDetalhe(item, acoesSerie));

      var caixaT = el('div', {
        class: 'temporadas',
        'data-region': 'seasons', 'data-axis': 'x',
        'data-nb-left': 'rail', 'data-nb-up': 'acoes', 'data-nb-down': 'episodes',
        'data-enter': 'last'
      });
      var caixaE = el('div', {
        class: 'episodios',
        'data-region': 'episodes', 'data-axis': 'x',
        'data-nb-left': 'rail', 'data-nb-up': 'seasons',
        'data-nb-down': 'rows', 'data-enter': 'last'
      });

      /* Fileira horizontal mesmo. No detalhe ela funciona: as
         temporadas ficam logo acima, ↑ sai para elas e o cartaz
         largo do episódio se lê bem passando de lado. */
      function mostrarTemporada(t, botao) {
        w.$$('.temp-btn', caixaT).forEach(function (o) { o.classList.remove('ativa'); });
        if (botao) botao.classList.add('ativa');
        w.Virt.dentroDe(caixaE).forEach(function (c) { c.destruir(); });
        w.clear(caixaE);
        var f = w.UI.fileira('', t.episodios, {
          forma: 'wide',
          aoAbrir: function (ep) { tocarEpisodio(ep, todos, item); },
          nota: function (ep) { return 'T' + ep.temporada + ' E' + ep.episodio; }
        });
        caixaE.appendChild(f);
        w.UI.ligar(f);
      }

      /* As caixas entram no documento ANTES de montar a fileira.
         A virtualização mede um cartão de verdade para saber o
         passo — e um cartão medido fora do documento tem largura
         zero, o que empilha todos os episódios um por cima do
         outro. Foi exatamente o que apareceu na tela. */
      coluna.appendChild(caixaT);
      coluna.appendChild(caixaE);

      /* Relacionados também em série, abaixo dos episódios —
         mesma lógica de franquia, nome parecido e gênero. */
      var pastaS = item.categoryId || item.groupId || params.catId;
      if (pastaS) {
        w.Catalog.itens('series', pastaS).then(function (universo) {
          var rel = w.Catalog.relacionados(item, universo, 20);
          if (!rel.length) return;
          var cx = caixaRelacionados(rel, 'episodes');
          coluna.appendChild(cx);
          w.UI.ligar(cx);
        }).catch(function () {});
      }

      info.temporadas.forEach(function (t, i) {
        var b = el('button', { class: 'temp-btn', 'data-focusable': '',
                               text: 'Temporada ' + t.temporada });
        b.onclick = function () { mostrarTemporada(t, b); };
        caixaT.appendChild(b);
        if (i === 0) mostrarTemporada(t, b);
      });
      assumirFoco('acoes');
    }).catch(function (e) {
      coluna.appendChild(w.UI.erro(e, function () { detalheSerie(params); }));
    });

    return tela;
  }

  /* Fileira de relacionados, com o vizinho de cima declarado —
     em filme vem das ações, em série vem dos episódios. Sem essa
     declaração a região existia e não havia como chegar nela. */
  function caixaRelacionados(rel, acima) {
    var caixa = el('div', {
      'data-region': 'rows', 'data-axis': 'rows',
      'data-nb-left': 'rail', 'data-nb-up': acima
    });
    caixa.appendChild(w.UI.fileira('Relacionados', rel,
      { forma: 'poster', aoAbrir: abrir }));
    return caixa;
  }

  function botaoFavorito(item) {
    return {
      rotulo: w.Store.isFavorite(item.id) ? 'Nos favoritos' : 'Favoritar',
      icone: 'star',
      acao: function (b) {
        var agora = w.Store.toggleFavorite(item);
        b.querySelector('span').textContent = agora ? 'Nos favoritos' : 'Favoritar';
        b.classList.toggle('ativo', agora);
      }
    };
  }

  /* Qual episódio o botão principal deve tocar.
     A conta é sobre estado derivado — posição sobre duração —
     e não sobre o evento `ended`, que o Chromium engole em
     alguns arquivos. Mesmo critério do avanço automático. */
  function proximoEpisodio(todos, ultimo) {
    if (!todos.length) return { ep: null, rotulo: 'Assistir' };
    if (!ultimo) return { ep: todos[0], rotulo: 'Assistir T1 E1' };

    var i = -1;
    for (var k = 0; k < todos.length; k++) {
      if (String(todos[k].id) === String(ultimo.id)) { i = k; break; }
    }
    if (i < 0) return { ep: todos[0], rotulo: 'Assistir T1 E1' };

    var p = w.Store.progressOf(ultimo.id);
    var terminou = !!(p && (p.completed ||
      (p.duration > 0 && p.position / p.duration >= 0.95)));

    var alvo = terminou ? (todos[i + 1] || todos[i]) : todos[i];
    return {
      ep: alvo,
      rotulo: (terminou ? 'Assistir T' : 'Continuar T') + alvo.temporada + ' E' + alvo.episodio
    };
  }

  function tocarEpisodio(ep, todos, serie) {
    if (!ep) return;
    tocar(ep, { queue: todos, index: todos.indexOf(ep), serie: serie });
  }

  /* Cabeçalho comum aos dois detalhes. */
  function cabecalhoDetalhe(item, acoes) {
    var topo = el('div', { class: 'det-topo' });
    if (item.backdrop || item.poster) {
      var arte = el('div', { class: 'det-arte' });
      arte.style.backgroundImage = 'url("' +
        String(item.backdrop || item.poster).replace(/"/g, '%22') + '")';
      topo.appendChild(arte);
      topo.appendChild(el('div', { class: 'det-veu' }));
    }
    var txt = el('div', { class: 'det-texto' });
    txt.appendChild(el('h1', { class: 'det-titulo', text: w.cleanName(item.title || '') }));

    /* Os campos vêm do catálogo em português (`sinopse`, `elenco`,
       `direcao`, `ano`, `genero`). Eu estava lendo `plot`, `genre`
       e `year`, que não existem — por isso a tela do detalhe só
       mostrava o título e a nota. */
    var ano    = item.ano || item.year || '';
    var genero = item.genero || item.genre || '';
    var nota   = item.rating || '';
    var dur    = item.duracao ? Math.round(item.duracao / 60) + ' min' : '';

    var linha = [];
    if (ano) linha.push(ano);
    if (dur) linha.push(dur);
    if (genero) linha.push(genero);
    if (nota) linha.push('★ ' + nota);
    if (item.idade) linha.push(item.idade);
    if (linha.length) txt.appendChild(el('div', { class: 'det-meta', text: linha.join('  ·  ') }));

    var sinopse = item.sinopse || item.plot || '';
    if (sinopse) txt.appendChild(el('p', { class: 'det-plot', text: sinopse }));

    /* Elenco e direção: duas linhas curtas, com rótulo. É a
       informação que faz decidir se vale a pena, e ela já vinha
       na resposta do painel sem custo nenhum. */
    if (item.elenco) txt.appendChild(ficha('Elenco', item.elenco));
    if (item.direcao) txt.appendChild(ficha('Direção', item.direcao));

    /* Para onde ↓ leva depende da tela: em série, para as
       temporadas; em filme, direto para os relacionados. Antes
       apontava sempre para `seasons`, que em filme não existe —
       e por isso os relacionados eram inalcançáveis. */
    var caixa = el('div', {
      class: 'row-btns', 'data-region': 'acoes', 'data-axis': 'x',
      'data-nb-left': 'rail', 'data-enter': 'first',
      'data-nb-down': (acoes.abaixo || 'rows')
    });
    acoes.forEach(function (a) {
      var b = el('button', { class: 'btn ' + (a.primario ? 'primary' : 'ghost'),
                             'data-focusable': '' });
      b.innerHTML = w.icon(a.icone) + '<span>' + w.esc(a.rotulo) + '</span>';
      b.onclick = function () { a.acao(b); };
      caixa.appendChild(b);
    });
    txt.appendChild(caixa);
    topo.appendChild(txt);
    return topo;
  }

  function ficha(rotulo, valor) {
    var d = el('div', { class: 'det-ficha' });
    d.appendChild(el('span', { class: 'det-ficha-k', text: rotulo }));
    d.appendChild(el('span', { class: 'det-ficha-v', text: String(valor) }));
    return d;
  }

  function mesclar(a, b) {
    var o = {};
    Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { if (b[k] != null && b[k] !== '') o[k] = b[k]; });
    return o;
  }

  /* -----------------------------------------------------------
     Busca
     ----------------------------------------------------------- */
  function busca() {
    var tela = w.UI.tela('busca');

    var topo = el('div', {
      class: 'busca-topo', 'data-region': 'field', 'data-axis': 'x',
      'data-nb-left': 'rail', 'data-nb-down': 'grid', 'data-enter': 'first'
    });
    var campo = el('input', { class: 'busca-campo', 'data-focusable': '',
                              type: 'text', placeholder: 'Buscar filmes, séries e canais' });
    topo.appendChild(campo);

    var conteudo = el('div', {
      class: 'conteudo busca-res', 'data-region': 'grid', 'data-axis': 'grid',
      'data-nb-left': 'rail', 'data-nb-up': 'field', 'data-enter': 'first'
    });
    conteudo.appendChild(w.UI.vazio('O que você quer ver?',
      'Digite pelo menos duas letras.'));

    tela.appendChild(topo);
    tela.appendChild(conteudo);
    w.UI.trocar(tela, 'field');
    w.Nav.entrar('field');

    var indice = null;
    w.Catalog.indice().then(function (ix) { indice = ix; });

    var procurar = w.debounce(function () {
      var termo = campo.value.trim();
      w.Virt.dentroDe(conteudo).forEach(function (c) { c.destruir(); });
      w.clear(conteudo);

      if (termo.length < 2) {
        conteudo.appendChild(w.UI.vazio('O que você quer ver?', 'Digite pelo menos duas letras.'));
        return;
      }
      if (!indice) {
        conteudo.appendChild(el('div', { class: 'carregando', text: 'Montando o índice…' }));
        return;
      }
      var achados = w.Catalog.buscar(termo, indice);
      if (!achados.length) {
        conteudo.appendChild(w.UI.vazio('Nada encontrado',
          'Nenhum resultado para "' + termo + '".'));
        return;
      }
      var g = w.UI.grade(achados, { forma: 'poster', colunas: COLUNAS, aoAbrir: abrir });
      conteudo.appendChild(g);
      w.UI.ligar(g);
    }, 260);

    campo.oninput = procurar;
    return tela;
  }

  /* -----------------------------------------------------------
     Ajustes
     ----------------------------------------------------------- */
  function painel(titulo, sub) {
    var p = el('div', { class: 'painel' });
    p.appendChild(el('h2', { class: 'painel-titulo', text: titulo }));
    if (sub) p.appendChild(el('p', { class: 'painel-sub', text: sub }));
    return p;
  }

  function linha(k, v) {
    var d = el('div', { class: 'linha' });
    d.appendChild(el('span', { class: 'linha-k', text: k }));
    d.appendChild(el('span', { class: 'linha-v', text: String(v) }));
    return d;
  }

  function ajustes() {
    var tela = w.UI.tela('ajustes');
    var janela = el('div', { class: 'janela cheia' });
    var coluna = el('div', { class: 'trilho', 'data-scroll': 'y' });
    var caixa = el('div', {
      class: 'paineis',
      'data-region': 'opcoes', 'data-axis': 'y',
      'data-nb-left': 'rail', 'data-enter': 'last'
    });

    /* --- atualização --- */
    var pAtu = painel('Atualização',
      'O app se atualiza pelo código no GitHub, sem pen drive.');
    /* O nome do método é `install`, não `apply`. Eu chamei
       `Updater.apply(info)` e o botão estourava com
       "is not a function" — sem sair do lugar, sem dizer nada.
       O nome certo está em `app/js/boot.js`, que é a casca e não
       muda pela atualização. */
    var carregada = (w.Updater && w.Updater.loaded) || {};
    pAtu.appendChild(linha('Versão instalada', carregada.version || '—'));
    pAtu.appendChild(linha('Origem', carregada.source || '—'));

    var bAtu = el('button', { class: 'btn', 'data-focusable': '' });
    var passo = el('div', { class: 'painel-sub', text: '' });
    bAtu.innerHTML = w.icon('refresh') + '<span>Procurar atualização</span>';

    bAtu.onclick = function () {
      var txt = bAtu.querySelector('span');
      if (!w.Updater || !w.Updater.configured || !w.Updater.configured()) {
        txt.textContent = 'Sem repositório configurado';
        passo.textContent = 'O .ipk instalado não trouxe o campo "update" do ' +
                            'nebula.config.json. Um "npm run deploy" resolve, uma vez só.';
        return;
      }
      txt.textContent = 'Procurando…';
      passo.textContent = '';
      w.Updater.check().then(function (info) {
        if (!info.isNew) {
          txt.textContent = 'Já está atualizado';
          passo.textContent = 'Versão no GitHub: ' + info.version;
          return;
        }
        txt.textContent = 'Instalar versão ' + info.version;
        bAtu.onclick = function () {
          txt.textContent = 'Instalando…';
          w.Updater.install(info, function (m) { passo.textContent = m; })
            .then(function () {
              txt.textContent = 'Instalada — reiniciando';
              setTimeout(function () { w.Updater.reload(); }, 900);
            })
            .catch(function (e) {
              txt.textContent = 'Falhou ao instalar';
              passo.textContent = e.message;
            });
        };
      }).catch(function (e) {
        txt.textContent = 'Falhou ao procurar';
        passo.textContent = e.message;
      });
    };
    pAtu.appendChild(bAtu);
    pAtu.appendChild(passo);

    if (w.Updater && w.Updater.hasPrevious && w.Updater.hasPrevious()) {
      var bVolta = el('button', { class: 'btn ghost', 'data-focusable': '' });
      bVolta.innerHTML = '<span>Voltar para a versão anterior</span>';
      bVolta.onclick = function () {
        if (w.Updater.rollback()) w.Updater.reload();
      };
      pAtu.appendChild(bVolta);
    }
    caixa.appendChild(pAtu);

    /* --- conteúdo adulto --- */
    var pAd = painel('Conteúdo adulto',
      'Independentemente desta opção, nada de conteúdo adulto é gravado como ' +
      'assistido, recente ou em andamento — nem entra em relacionados.');
    var oculto = !!w.Store.get('adulto.ocultar');
    var bAd = el('button', { class: 'btn ghost' + (oculto ? ' ativo' : ''), 'data-focusable': '' });
    bAd.innerHTML = '<span>' + (oculto ? 'Escondendo do catálogo' : 'Aparece no catálogo') + '</span>';
    bAd.onclick = function () {
      oculto = !oculto;
      w.Store.set('adulto.ocultar', oculto);
      bAd.classList.toggle('ativo', oculto);
      bAd.querySelector('span').textContent =
        oculto ? 'Escondendo do catálogo' : 'Aparece no catálogo';
      w.Catalog.limparCache();
    };
    pAd.appendChild(bAd);
    caixa.appendChild(pAd);

    /* --- dados --- */
    var pD = painel('Dados', 'Cache do catálogo e sincronização do histórico.');
    pD.appendChild(linha('Blocos em memória', w.Catalog.emMemoria()));

    /* Estado do banco, escrito em português claro. Ele estava
       desligado na TV e não havia como saber olhando a tela. */
    pD.appendChild(linha('Banco de dados',
      w.Cloud.enabled() ? 'conectado' : 'desligado (sem credenciais)'));
    pD.appendChild(linha('Fila para enviar', w.Cloud.pending()));
    if (w.Cloud.lastError && w.Cloud.lastError()) {
      pD.appendChild(linha('Último erro', w.Cloud.lastError()));
    }

    if (w.Cloud.enabled()) {
      var bTeste = el('button', { class: 'btn ghost', 'data-focusable': '' });
      bTeste.innerHTML = '<span>Testar conexão com o banco</span>';
      bTeste.onclick = function () {
        var t = bTeste.querySelector('span');
        t.textContent = 'Testando…';
        w.Cloud.test()
          .then(function () { t.textContent = 'Conexão ok'; })
          .catch(function (e) { t.textContent = 'Falhou: ' + e.message; });
      };
      pD.appendChild(bTeste);

      /* -------------------------------------------------------
         Reenviar TUDO
         -------------------------------------------------------
         `Cloud.queue` descarta em silêncio quando o banco está
         desligado — e o banco esteve desligado esse tempo todo,
         por causa do bug das credenciais. Ou seja: tudo o que
         você assistiu até agora nunca chegou a entrar na fila.
         Conectar depois não recupera sozinho; precisa reenviar.
         ------------------------------------------------------- */
      var bTudo = el('button', { class: 'btn ghost', 'data-focusable': '' });
      bTudo.innerHTML = '<span>Enviar todo o histórico para o banco</span>';
      bTudo.onclick = function () {
        var t = bTudo.querySelector('span');
        var todos = w.Store.allProgress();
        var ids = Object.keys(todos);
        if (!ids.length) { t.textContent = 'Não há histórico para enviar'; return; }
        t.textContent = 'Enfileirando ' + ids.length + '…';
        ids.forEach(function (k) { w.Cloud.queue(todos[k]); });
        Promise.resolve(w.Cloud.flush())
          .then(function () {
            var faltam = w.Cloud.pending();
            t.textContent = faltam
              ? 'Enviado — ' + faltam + ' ainda na fila'
              : 'Enviado: ' + ids.length + ' registros';
          })
          .catch(function (e) { t.textContent = 'Falhou: ' + e.message; });
      };
      pD.appendChild(bTudo);

      var bEnviar = el('button', { class: 'btn ghost', 'data-focusable': '' });
      bEnviar.innerHTML = '<span>Enviar agora o que está na fila</span>';
      bEnviar.onclick = function () {
        var t = bEnviar.querySelector('span');
        t.textContent = 'Enviando…';
        Promise.resolve(w.Cloud.flush())
          .then(function () { t.textContent = 'Fila vazia — ' + w.Cloud.pending() + ' pendentes'; })
          .catch(function (e) { t.textContent = 'Falhou: ' + e.message; });
      };
      pD.appendChild(bEnviar);
    }
    var bL = el('button', { class: 'btn ghost', 'data-focusable': '' });
    bL.innerHTML = '<span>Limpar cache do catálogo</span>';
    bL.onclick = function () {
      w.Catalog.limparCache().then(function () { w.toast('Cache limpo.'); });
    };
    pD.appendChild(bL);
    caixa.appendChild(pD);

    coluna.appendChild(caixa);
    janela.appendChild(coluna);
    tela.appendChild(janela);
    w.UI.trocar(tela, 'opcoes');
    w.Nav.entrar('opcoes');
    return tela;
  }

  /* -----------------------------------------------------------
     Primeira configuração
     ----------------------------------------------------------- */
  function configurar() {
    var tela = w.UI.tela('setup');
    var caixa = el('div', {
      class: 'setup-caixa', 'data-region': 'setup', 'data-axis': 'y', 'data-enter': 'first'
    });
    caixa.appendChild(el('h1', { text: 'Vamos conectar sua lista' }));
    caixa.appendChild(el('p', { class: 'painel-sub',
      text: 'Cole o endereço da sua lista M3U ou Xtream. Fica só nesta TV.' }));

    var campo = el('input', { class: 'busca-campo', 'data-focusable': '', type: 'text',
                              placeholder: 'http://servidor/get.php?username=…' });
    campo.value = w.Store.get('source.url', '');
    caixa.appendChild(campo);

    var aviso = el('div', { class: 'setup-aviso' });
    caixa.appendChild(aviso);

    var b = el('button', { class: 'btn primary', 'data-focusable': '' });
    b.innerHTML = '<span>Conectar</span>';
    b.onclick = function () {
      aviso.textContent = 'Conectando…';
      w.Catalog.conectar(campo.value.trim(), function (m) { aviso.textContent = m; })
        .then(function () { w.App.go('home', null, { replace: true }); })
        .catch(function (e) { aviso.textContent = 'Não deu: ' + e.message; });
    };
    caixa.appendChild(b);

    tela.appendChild(caixa);
    w.UI.trocar(tela, 'setup');
    w.Nav.entrar('setup');
    return tela;
  }

  /* -----------------------------------------------------------
     Segurar OK sobre um cartão
     -----------------------------------------------------------
     Canal não tem tela de detalhe: aperta OK e já está tocando.
     Então o gesto que sobra para "eu gosto deste" é o toque
     longo, que é o mesmo de qualquer celular e não gasta uma
     tela nova nem uma tecla colorida.

     A mecânica precisa de cuidado: `keydown` repete sozinho
     enquanto a tecla fica presa (10 a 15 vezes por segundo no
     controle da LG), então há uma trava para o toque longo não
     disparar quinze vezes. E o OK curto só age no `keyup` —
     senão o canal começaria a tocar enquanto você ainda decide
     se vai segurar.
     ----------------------------------------------------------- */
  var SEGURAR = 550;
  var segurando = false, relogioToque = null, jaAgiu = false;

  function itemDoFoco() {
    var a = w.Nav.atual();
    return (a && a._item) ? a : null;
  }

  function alternarFavorito(cartao) {
    var item = cartao._item;
    var agora = w.Store.toggleFavorite(item);
    cartao.classList.toggle('favorito', agora);
    w.toast(agora
      ? '★ ' + w.cleanName(item.title) + ' nos favoritos'
      : w.cleanName(item.title) + ' fora dos favoritos');

    /* Se você tirou um favorito enquanto olha a pasta Favoritos,
       ele tem de sumir dali na hora — deixar um cartão morto na
       lista é o tipo de coisa que faz duvidar se funcionou. */
    var ativa = w.$('.cat-item.ativa');
    if (!agora && ativa && ativa._cat && ativa._cat.id === FAVORITOS && ativa._recarregar) {
      ativa._recarregar();
    }
  }

  w.Nav.adicionarTecla(function (k, ev) {
    if (k !== w.KEY.OK) return false;
    if (w.Player && w.Player.isOpen()) return false;

    var cartao = itemDoFoco();
    if (!cartao) return false;                  /* botões comuns seguem o caminho normal */
    if (ev && ev.repeat) return true;           /* auto-repeat: já estamos contando */
    if (segurando) return true;

    segurando = true; jaAgiu = false;
    relogioToque = setTimeout(function () {
      jaAgiu = true;
      var c = itemDoFoco();
      if (c) alternarFavorito(c);
    }, SEGURAR);
    return true;
  });

  document.addEventListener('keyup', function (ev) {
    if (ev.keyCode !== w.KEY.OK || !segurando) return;
    segurando = false;
    clearTimeout(relogioToque);
    if (jaAgiu) return;                         /* já favoritou: OK curto não abre */
    var c = itemDoFoco();
    if (c) c.click();
  }, true);

  /* -----------------------------------------------------------
     API
     ----------------------------------------------------------- */
  w.Views = {
    home:         inicio,
    live:         function () { return navegar('live',   'logo'); },
    movies:       function () { return navegar('movie',  'poster'); },
    series:       function () { return navegar('series', 'poster'); },
    search:       busca,
    settings:     ajustes,
    setup:        configurar,
    movieDetail:  detalheFilme,
    seriesDetail: detalheSerie,

    aoFocarCategoria: aoFocarCategoria,
    stopBillboard: function () { clearTimeout(esperaCat); }
  };

})(window);


/* ===== app.js ==================================================== */
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
          if (info.isNew) w.toast('Versão ' + info.version + ' disponível — veja em Ajustes.', 5000);
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
