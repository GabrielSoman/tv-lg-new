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
