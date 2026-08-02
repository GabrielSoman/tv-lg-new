
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


/* ===== catalog.js ================================================ */
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


/* ===== nav.js ==================================================== */
/* =========================================================
   Navegacao por controle remoto.

   Estrategia hibrida: dentro de um container com eixo definido
   (uma fileira, uma grade, uma coluna de categorias) o movimento
   segue a ordem dos elementos - previsivel e sem surpresas.
   Quando nao ha para onde ir dentro do container, cai para uma
   busca geometrica pela tela inteira, que e o que permite sair
   de uma fileira e chegar no menu lateral, por exemplo.
   ========================================================= */
(function (w) {
  'use strict';

  var current = null;
  var scope = null;          // elemento que limita o foco (dialogos)
  var handlers = [];         // ouvintes extras de tecla

  function focusables() {
    var root = scope || document;
    return w.$$('[data-focusable]', root).filter(function (e) {
      return e.offsetParent !== null || e === current;
    });
  }

  function rect(e) { return e.getBoundingClientRect(); }
  function center(r) { return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }

  /* ---------- Rolagem: move o container, nao a pagina ---------- */
  function scrollers(el) {
    var out = [], n = el.parentElement;
    while (n && n !== document.body) {
      if (n.hasAttribute && n.hasAttribute('data-scroll')) out.push(n);
      n = n.parentElement;
    }
    return out;
  }

  function offsetOf(sc) {
    return { x: Number(sc.getAttribute('data-off-x') || 0),
             y: Number(sc.getAttribute('data-off-y') || 0) };
  }

  function applyOffset(sc, x, y) {
    sc.setAttribute('data-off-x', x);
    sc.setAttribute('data-off-y', y);
    sc.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
  }

  function ensureVisible(el) {
    scrollers(el).forEach(function (sc) {
      var vp = sc.parentElement;
      if (!vp) return;
      var axis = sc.getAttribute('data-scroll');
      var off = offsetOf(sc);
      var er = rect(el), vr = rect(vp);

      if (axis === 'x' || axis === 'xy') {
        var mx = vr.width * 0.08, dx = 0;
        if (er.left  < vr.left  + mx) dx = (vr.left + mx) - er.left;
        else if (er.right > vr.right - mx) dx = (vr.right - mx) - er.right;
        if (dx) {
          var minX = Math.min(0, vp.clientWidth - sc.scrollWidth - 8);
          off.x = Math.max(minX, Math.min(0, off.x + dx));
        }
      }
      if (axis === 'y' || axis === 'xy') {
        var mTop = vr.height * 0.22, mBot = vr.height * 0.26, dy = 0;
        if (er.top < vr.top + mTop) dy = (vr.top + mTop) - er.top;
        else if (er.bottom > vr.bottom - mBot) dy = (vr.bottom - mBot) - er.bottom;
        if (dy) {
          var minY = Math.min(0, vp.clientHeight - sc.scrollHeight - 8);
          off.y = Math.max(minY, Math.min(0, off.y + dy));
        }
      }
      applyOffset(sc, off.x, off.y);
    });
  }

  /* ---------- Container e eixo ---------- */
  function containerOf(el) {
    var n = el.parentElement;
    while (n && n !== document.body) {
      if (n.hasAttribute && n.hasAttribute('data-nav-axis')) return n;
      n = n.parentElement;
    }
    return null;
  }

  function siblingsIn(container) {
    return w.$$('[data-focusable]', container).filter(function (e) {
      return e.offsetParent !== null;
    });
  }

  function stepInContainer(el, dir) {
    var c = containerOf(el);
    if (!c) return null;
    var axis = c.getAttribute('data-nav-axis');
    var list = siblingsIn(c);
    var i = list.indexOf(el);
    if (i < 0) return null;

    if (axis === 'x' && (dir === 'left' || dir === 'right'))
      return list[i + (dir === 'right' ? 1 : -1)] || null;

    if (axis === 'y' && (dir === 'up' || dir === 'down'))
      return list[i + (dir === 'down' ? 1 : -1)] || null;

    if (axis === 'grid') {
      if (dir === 'left' || dir === 'right')
        return list[i + (dir === 'right' ? 1 : -1)] || null;
      /* Cima/baixo numa grade: elemento mais alinhado na linha vizinha. */
      return gridVertical(list, i, dir);
    }
    return null;
  }

  function gridVertical(list, i, dir) {
    var cr = rect(list[i]), cc = center(cr);
    var best = null, bestScore = Infinity;
    for (var k = 0; k < list.length; k++) {
      if (k === i) continue;
      var r = rect(list[k]);
      var sameLine = Math.abs(r.top - cr.top) < cr.height * 0.5;
      if (sameLine) continue;
      if (dir === 'down' && r.top <= cr.top) continue;
      if (dir === 'up'   && r.top >= cr.top) continue;
      var s = Math.abs(r.top - cr.top) * 2 + Math.abs(center(r).x - cc.x);
      if (s < bestScore) { bestScore = s; best = list[k]; }
    }
    return best;
  }

  /* ---------- Busca geometrica global ---------- */
  function geometric(el, dir) {
    var cr = rect(el), cc = center(cr);
    var best = null, bestScore = Infinity;

    focusables().forEach(function (t) {
      if (t === el) return;
      var r = rect(t);
      if (!r.width || !r.height) return;
      var tc = center(r), main, cross;

      if (dir === 'right')      { if (r.left   < cr.right - 2) return; main = r.left - cr.right;   cross = Math.abs(tc.y - cc.y); }
      else if (dir === 'left')  { if (r.right  > cr.left + 2)  return; main = cr.left - r.right;   cross = Math.abs(tc.y - cc.y); }
      else if (dir === 'down')  { if (r.top    < cr.bottom - 2) return; main = r.top - cr.bottom;  cross = Math.abs(tc.x - cc.x); }
      else                      { if (r.bottom > cr.top + 2)   return; main = cr.top - r.bottom;   cross = Math.abs(tc.x - cc.x); }

      var s = Math.max(0, main) + cross * 2.2;
      if (s < bestScore) { bestScore = s; best = t; }
    });
    return best;
  }

  /* ---------- API ---------- */
  w.Nav = {

    focus: function (el, opts) {
      if (!el) return false;
      if (current === el) { ensureVisible(el); return true; }
      if (current) current.classList.remove('focused');
      current = el;
      el.classList.add('focused');
      if (!(opts && opts.noScroll)) ensureVisible(el);
      if (el.tagName === 'INPUT') { try { el.focus(); } catch (e) {} }
      else if (document.activeElement && document.activeElement.blur) {
        try { document.activeElement.blur(); } catch (e) {}
      }
      if (w.Nav.onFocusHook) w.Nav.onFocusHook(el);
      return true;
    },

    current: function () { return current; },

    /* Foca o primeiro elemento disponivel (ou um seletor especifico). */
    focusFirst: function (selector) {
      var list = selector ? w.$$(selector, scope || document) : focusables();
      list = list.filter(function (e) { return e.offsetParent !== null; });
      return w.Nav.focus(list[0]);
    },

    move: function (dir) {
      if (!current || current.offsetParent === null) return w.Nav.focusFirst();
      var next = stepInContainer(current, dir) || geometric(current, dir);
      if (next) { w.Nav.focus(next); return true; }
      return false;
    },

    /* Limita o foco a um pedaco da tela (dialogos, erro do player). */
    setScope: function (root, firstSelector) {
      scope = root || null;
      if (root) {
        if (current) current.classList.remove('focused');
        current = null;
        w.Nav.focusFirst(firstSelector);
      }
    },

    clearScope: function (restoreTo) {
      scope = null;
      if (restoreTo) w.Nav.focus(restoreTo);
    },

    scoped: function () { return scope; },

    /* Zera as rolagens de um container (ao trocar de tela). */
    resetScroll: function (root) {
      w.$$('[data-scroll]', root || document).forEach(function (sc) {
        applyOffset(sc, 0, 0);
      });
    },

    /* Ouvintes extras: recebem (keyCode, event) e devolvem true se trataram. */
    addKeyHandler: function (fn) { handlers.unshift(fn); },
    removeKeyHandler: function (fn) {
      handlers = handlers.filter(function (h) { return h !== fn; });
    }
  };

  /* ---------- Teclado ---------- */
  document.addEventListener('keydown', function (ev) {
    var k = ev.keyCode;

    for (var i = 0; i < handlers.length; i++) {
      if (handlers[i](k, ev) === true) { ev.preventDefault(); return; }
    }

    /* Enquanto digita num campo de texto, as setas pertencem ao campo -
       exceto cima/baixo, que continuam navegando entre os campos. */
    var typing = current && current.tagName === 'INPUT';

    switch (k) {
      case w.KEY.LEFT:  if (typing) return; w.Nav.move('left');  break;
      case w.KEY.RIGHT: if (typing) return; w.Nav.move('right'); break;
      case w.KEY.UP:    w.Nav.move('up');    break;
      case w.KEY.DOWN:  w.Nav.move('down');  break;
      case w.KEY.OK:
        if (current) {
          if (current.tagName === 'INPUT') return;   // deixa o teclado da TV abrir
          current.click();
        }
        break;
      default: return;
    }
    ev.preventDefault();
  }, true);

})(window);


/* ===== dom.js ==================================================== */
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


/* ===== player.js ================================================= */
/* =========================================================
   Player em tela cheia.

   Ordem de escolha do motor de video:
   1. Se a TV souber tocar o formato nativamente, usa o <video>
      puro - e o caminho com aceleracao de hardware e menos
      travadas na LG.
   2. Se nao souber (caso do Chrome no Mac com HLS), usa hls.js.
   ========================================================= */
(function (w) {
  'use strict';

  var layer, video, ui, spinner, errBox, errMsg;
  var hls = null;
  var item = null;          // item em reproducao
  var queue = [], qIndex = -1;
  var saveTimer = null, hideTimer = null;
  var startAt = 0;          // segundo em que devemos começar
  var seeking = 0;          // acumulador de seek pelas setas
  var seekTimer = null;
  var triedAlternate = false;
  var onClose = null;
  var live = false;

  function init() {
    layer   = w.$('#player-layer');
    video   = w.$('#video');
    ui      = w.$('#player-ui');
    spinner = w.$('#player-spinner');
    errBox  = w.$('#player-error');
    errMsg  = w.$('#pl-error-msg');

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('timeupdate', onTick);
    video.addEventListener('progress', onBuffer);
    video.addEventListener('waiting', function () { spinner.classList.remove('hidden'); });
    video.addEventListener('playing', function () {
      spinner.classList.add('hidden');
      errBox.classList.add('hidden');
    });
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', function () { fail(describeMediaError()); });

    w.$('#pl-retry').addEventListener('click', function () {
      errBox.classList.add('hidden');
      w.Nav.clearScope();
      load(item.url, startAt);
    });
    w.$('#pl-back').addEventListener('click', function () { w.Player.close(); });
  }

  /* ---------------------------------------------------------
     Abertura
     --------------------------------------------------------- */
  function open(target, opts) {
    opts = opts || {};
    if (!layer) init();

    item    = target;
    queue   = opts.queue || [];
    qIndex  = typeof opts.index === 'number' ? opts.index : -1;
    onClose = opts.onClose || null;
    live    = item.kind === 'live';
    triedAlternate = false;

    layer.classList.remove('hidden');
    errBox.classList.add('hidden');
    spinner.classList.remove('hidden');
    ui.classList.remove('hidden', 'fade');

    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !live);
    w.$('#pl-dur').textContent = live ? '' : '00:00';
    w.$('#pl-cur').textContent = '00:00';
    setBar(0, 0);

    w.Nav.addKeyHandler(keys);
    scheduleHide();

    var saved = w.Store.progressOf(item.id);
    var canResume = !live && saved && !saved.completed &&
                    saved.position >= w.CFG.RESUME_MIN_SEC &&
                    (!saved.duration || saved.duration - saved.position > w.CFG.RESUME_TAIL_SEC);

    if (canResume && !opts.forceStart) askResume(saved);
    else load(item.url, opts.startAt || 0);
  }

  function askResume(saved) {
    var overlay = w.$('#resume-layer');
    var prev = w.Nav.current();
    w.$('#resume-desc').textContent =
      w.cleanName(item.title) + (item.subtitle ? ' · ' + item.subtitle : '') +
      ' — você parou em ' + w.fmtTime(saved.position) +
      (saved.duration ? ' de ' + w.fmtTime(saved.duration) : '') + '.';
    overlay.classList.remove('hidden');
    w.Nav.setScope(overlay);

    function done(from) {
      overlay.classList.add('hidden');
      w.Nav.clearScope(prev);
      w.$('#resume-yes').onclick = null;
      w.$('#resume-no').onclick = null;
      load(item.url, from);
    }
    w.$('#resume-yes').onclick = function () { done(Math.max(0, saved.position - 5)); };
    w.$('#resume-no').onclick  = function () { done(0); };
  }

  /* ---------------------------------------------------------
     Carregamento da midia
     --------------------------------------------------------- */
  function nativeCanPlay(url) {
    if (/\.m3u8(\?|$)/i.test(url)) {
      var t = video.canPlayType('application/vnd.apple.mpegurl') ||
              video.canPlayType('application/x-mpegURL');
      return t === 'probably' || t === 'maybe';
    }
    return true;   // mp4/mkv/ts vao direto para o motor da TV
  }

  function load(url, from) {
    startAt = from || 0;
    detach();
    spinner.classList.remove('hidden');

    /* O elemento <video> nao passa por CORS, entao vai sempre direto. */
    var src = url;

    if (nativeCanPlay(url)) {
      video.src = src;
      video.load();
    } else if (w.Hls && w.Hls.isSupported()) {
      hls = new w.Hls({
        maxBufferLength: live ? 12 : 30,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 30000
      });
      hls.on(w.Hls.Events.ERROR, function (e, data) {
        if (!data || !data.fatal) return;
        if (data.type === w.Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
        if (data.type === w.Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        fail('O fluxo de vídeo falhou (' + (data.details || 'erro desconhecido') + ').');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
      video.load();
    }

    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay bloqueado no navegador */ });
    startSaving();
  }

  function detach() {
    stopSaving();
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { video.pause(); } catch (e) {}
    try { video.removeAttribute('src'); video.load(); } catch (e) {}
  }

  /* ---------------------------------------------------------
     Eventos de reproducao
     --------------------------------------------------------- */
  function onMeta() {
    spinner.classList.add('hidden');
    if (startAt > 0 && isFinite(video.duration) && video.duration > startAt) {
      try { video.currentTime = startAt; } catch (e) {}
    }
    if (!live && isFinite(video.duration)) {
      w.$('#pl-dur').textContent = w.fmtTime(video.duration);
    }
  }

  function onTick() {
    if (live || !isFinite(video.duration) || !video.duration) {
      w.$('#pl-cur').textContent = w.fmtTime(video.currentTime);
      return;
    }
    var pct = video.currentTime / video.duration;
    setBar(pct, null);
    w.$('#pl-cur').textContent = w.fmtTime(video.currentTime);
  }

  function onBuffer() {
    if (!video.buffered || !video.buffered.length || !isFinite(video.duration)) return;
    var end = video.buffered.end(video.buffered.length - 1);
    setBar(null, end / video.duration);
  }

  function setBar(fill, buf) {
    if (fill !== null && fill !== undefined)
      w.$('#pl-fill').style.width = Math.min(100, Math.max(0, fill * 100)) + '%';
    if (buf !== null && buf !== undefined)
      w.$('#pl-buf').style.width = Math.min(100, Math.max(0, buf * 100)) + '%';
  }

  function onEnded() {
    save(true);
    if (queue.length && qIndex >= 0 && qIndex + 1 < queue.length) {
      qIndex++;
      var nxt = queue[qIndex];
      w.toast('A seguir: ' + w.cleanName(nxt.title), 3000);
      item = nxt;
      live = nxt.kind === 'live';
      w.$('#pl-title').textContent = w.cleanName(nxt.title);
      w.$('#pl-sub').textContent = nxt.subtitle || '';
      load(nxt.url, 0);
      showUI();
    } else {
      w.Player.close();
    }
  }

  function describeMediaError() {
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

  function fail(msg) {
    /* Canais ao vivo: tenta o outro formato (.ts <-> .m3u8) antes de desistir. */
    if (live && !triedAlternate && item.streamId && w.Catalog.mode() === 'xtream') {
      triedAlternate = true;
      w.toast('Tentando outro formato deste canal…');
      load(w.Xtream.liveUrlAlt(item.streamId), 0);
      return;
    }
    spinner.classList.add('hidden');
    errMsg.textContent = msg;
    errBox.classList.remove('hidden');
    showUI();
    w.Nav.setScope(errBox);
  }

  /* ---------------------------------------------------------
     Gravacao de progresso
     --------------------------------------------------------- */
  function startSaving() {
    stopSaving();
    saveTimer = setInterval(function () { save(false); }, w.CFG.SAVE_EVERY_MS);
  }
  function stopSaving() { if (saveTimer) { clearInterval(saveTimer); saveTimer = null; } }

  function save(force) {
    if (!item) return;
    var pos = video.currentTime || 0;
    var dur = isFinite(video.duration) ? video.duration : 0;
    if (!force && !live && pos < 5) return;   // ignora os primeiros segundos

    w.Store.saveProgress({
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle || '',
      poster: item.poster || '',
      stream_url: item.url || '',
      position: live ? 0 : pos,
      duration: live ? 0 : dur,
      completed: live ? false : (dur > 0 && pos / dur >= w.CFG.COMPLETED_RATIO),
      series_id: item.seriesId || '',
      series_title: item.seriesTitle || '',
      season: item.season || 0,
      episode: item.episode || 0
    });
  }

  /* ---------------------------------------------------------
     Interface e teclas
     --------------------------------------------------------- */
  function showUI() {
    ui.classList.remove('fade');
    scheduleHide();
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!errBox.classList.contains('hidden')) return;
      ui.classList.add('fade');
    }, w.CFG.UI_HIDE_MS);
  }

  function togglePlay() {
    if (video.paused) { video.play(); w.toast('Reproduzindo'); }
    else { video.pause(); save(true); w.toast('Pausado'); }
    showUI();
  }

  /* Acumula os pulos das setas e aplica uma vez so, para nao
     engasgar o buffer quando se aperta a seta varias vezes. */
  function seekBy(sec) {
    if (live || !isFinite(video.duration) || !video.duration) return;
    seeking += sec;
    var target = Math.max(0, Math.min(video.duration - 1,
                 (video.currentTime || 0) + seeking));
    setBar(target / video.duration, null);
    w.$('#pl-cur').textContent = w.fmtTime(target);
    showUI();

    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () {
      try { video.currentTime = target; } catch (e) {}
      seeking = 0;
    }, 380);
  }

  function keys(k) {
    if (layer.classList.contains('hidden')) return false;
    if (!errBox.classList.contains('hidden')) return false;   // dialogo de erro navega normal
    if (!w.$('#resume-layer').classList.contains('hidden')) return false;

    switch (k) {
      case w.KEY.OK:
      case w.KEY.PLAYPAUSE: togglePlay(); return true;
      case w.KEY.PLAY:  video.play();  showUI(); return true;
      case w.KEY.PAUSE: video.pause(); save(true); showUI(); return true;
      case w.KEY.STOP:
      case w.KEY.BACK:  w.Player.close(); return true;
      case w.KEY.LEFT:  seekBy(-w.CFG.SEEK_SMALL_SEC); return true;
      case w.KEY.RIGHT: seekBy( w.CFG.SEEK_SMALL_SEC); return true;
      case w.KEY.RW:    seekBy(-w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.FF:    seekBy( w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.UP:    seekBy( w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.DOWN:  seekBy(-w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.CH_UP:   nextInQueue(1);  return true;
      case w.KEY.CH_DOWN: nextInQueue(-1); return true;
      default: showUI(); return false;
    }
  }

  function nextInQueue(delta) {
    if (!queue.length || qIndex < 0) return;
    var i = qIndex + delta;
    if (i < 0 || i >= queue.length) return;
    save(false);
    qIndex = i;
    item = queue[i];
    live = item.kind === 'live';
    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !live);
    triedAlternate = false;
    load(item.url, 0);
    showUI();
  }

  /* ---------------------------------------------------------
     API publica
     --------------------------------------------------------- */
  w.Player = {
    open: open,
    isOpen: function () { return layer && !layer.classList.contains('hidden'); },

    close: function () {
      if (!layer || layer.classList.contains('hidden')) return;
      save(true);
      detach();
      clearTimeout(hideTimer);
      w.Nav.removeKeyHandler(keys);
      if (w.Nav.scoped() === errBox) w.Nav.clearScope();
      errBox.classList.add('hidden');
      layer.classList.add('hidden');
      var cb = onClose; onClose = null; item = null; queue = []; qIndex = -1;
      if (cb) cb();
    }
  };

})(window);


/* ===== views.js ================================================== */
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
    w.setAmbient('');
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
     Reações ao foco: abre a barra lateral, troca o fundo
     ambiente e pré-seleciona categorias.
     --------------------------------------------------------- */
  var catTimer = null;
  w.Nav.onFocusHook = function (el) {
    var inRail = !!(el.closest && el.closest('#rail'));
    var rail = w.$('#rail');
    if (rail) rail.classList.toggle('open', inRail);

    w.setAmbient(el.getAttribute('data-ambient') || '');

    clearTimeout(catTimer);
    if (el._select) {
      catTimer = setTimeout(function () {
        if (w.Nav.current() === el) el._select();
      }, 380);
    }
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

    w.confirmDialog('Sair do Nebula?', 'Você volta para a tela inicial da TV.', 'Sair')
      .then(function (yes) { if (yes) { try { w.close(); } catch (e) {} } });
    return true;
  });

  /* Teclas coloridas: atalhos rápidos. */
  w.Nav.addKeyHandler(function (k) {
    if (w.Player.isOpen()) return false;
    if (k === w.KEY.RED)    { w.App.go('search');   return true; }
    if (k === w.KEY.GREEN)  { w.App.go('live');     return true; }
    if (k === w.KEY.YELLOW) { w.App.go('movies');   return true; }
    if (k === w.KEY.BLUE)   { w.App.go('settings'); return true; }
    return false;
  });

  /* ---------------------------------------------------------
     Configuração embutida no pacote instalado
     --------------------------------------------------------- */
  function applyDefaults() {
    var d = w.NEBULA_DEFAULTS;
    if (!d || typeof d !== 'object') return false;
    if (!d.source || !d.source.url) return false;

    Object.keys(d).forEach(function (group) {
      var g = d[group];
      if (g === null || typeof g !== 'object') { w.Store.set(group, g); return; }
      Object.keys(g).forEach(function (k) {
        if (g[k] !== '' && g[k] !== null) w.Store.set(group + '.' + k, g[k]);
      });
    });
    return true;
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

    w.Catalog.connect(w.Store.get('source.url'), function (m) { msg.textContent = m; })
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
    if (!w.Store.isConfigured() && applyDefaults()) {
      restoreFromDefaults();
      return;
    }

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
