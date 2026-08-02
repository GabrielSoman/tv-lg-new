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
