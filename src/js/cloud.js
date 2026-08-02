/* =========================================================
   SINCRONIZAÇÃO COM O SUPABASE
   =========================================================
   Regra de ouro, a mesma de sempre: a TV nunca espera a nuvem.
   Tudo é gravado primeiro em localStorage; a nuvem recebe
   depois, em fila, e tenta de novo sozinha se a rede falhar.

   O que mudou nesta versão: eram cinco tabelas no banco e uma
   só chegava a ser usada. `favorites`, `channel_usage`,
   `series_state` e `settings_sync` existiam no `schema-v2.sql`
   e nenhuma linha de código escrevia nelas — ou seja, a lista
   que você montava continuava morrendo na reinstalação, que é
   exatamente o problema que o banco existia para resolver.

   Agora o motor é genérico: uma fila por tabela, um POST por
   tabela no flush, um GET por tabela no pull. Acrescentar a
   sexta tabela um dia é acrescentar uma linha em `TABELAS`.

   PRIVACIDADE: nada de conteúdo adulto passa por aqui. O corte
   é na origem, no `store.js` e no `player.js` — o que não é
   gravado não precisa ser filtrado depois.
   ========================================================= */
(function (w) {
  'use strict';

  var K_QUEUE = 'nebula.cloudq';
  var flushTimer = null;
  var flushing = false;
  var lastError = null;
  var erroDe = {};          /* último erro por tabela */

  /* -----------------------------------------------------------
     As tabelas
     -----------------------------------------------------------
     `conflito` é a lista de colunas do índice único que o
     PostgREST usa para transformar o POST num upsert. Tem de
     bater com a chave primária declarada no schema — se não
     bater, o Supabase responde 42P10 e a fila nunca esvazia.
     ----------------------------------------------------------- */
  var TABELAS = {
    progresso: { nome: 'watch_progress', conflito: 'id',                rotulo: 'Progresso' },
    favoritos: { nome: 'favorites',      conflito: 'profile,id',        rotulo: 'Favoritos' },
    canais:    { nome: 'channel_usage',  conflito: 'profile,chave',     rotulo: 'Canais'    },
    series:    { nome: 'series_state',   conflito: 'profile,series_id', rotulo: 'Séries'    },
    ajustes:   { nome: 'settings_sync',  conflito: 'profile,chave',     rotulo: 'Ajustes'   }
  };
  var CHAVES = Object.keys(TABELAS);

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

  function agora() { return new Date().toISOString(); }

  /* -----------------------------------------------------------
     A fila
     -----------------------------------------------------------
     Formato: { tabela: { chaveDaLinha: linha } }. A versão
     anterior guardava `{ id: linha }` direto, só de progresso —
     a migração abaixo recolhe aquilo para dentro de `progresso`
     em vez de descartar, senão o que estivesse na fila no
     momento da atualização se perderia em silêncio.
     ----------------------------------------------------------- */
  function loadQueue() {
    var q;
    try { q = JSON.parse(localStorage.getItem(K_QUEUE) || '{}'); }
    catch (e) { q = {}; }
    if (!q || typeof q !== 'object') q = {};

    var precisaMigrar = false;
    Object.keys(q).forEach(function (k) {
      if (CHAVES.indexOf(k) < 0) precisaMigrar = true;
    });
    if (precisaMigrar) {
      var antigo = q;
      q = { progresso: {} };
      Object.keys(antigo).forEach(function (k) {
        var linha = antigo[k];
        if (linha && typeof linha === 'object' && linha.id) q.progresso[linha.id] = linha;
      });
      saveQueue(q);
    }
    CHAVES.forEach(function (k) { if (!q[k]) q[k] = {}; });
    return q;
  }

  function saveQueue(q) {
    try { localStorage.setItem(K_QUEUE, JSON.stringify(q)); } catch (e) {}
  }

  function agendar(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { w.Cloud.flush(); }, ms);
  }

  /* -----------------------------------------------------------
     Tradução: formato da TV → formato do banco
     ----------------------------------------------------------- */
  var linhaDe = {

    progresso: function (r) {
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
        updated_at:    r.updated_at || agora()
      };
    },

    favoritos: function (r) {
      return {
        profile:    profile(),
        id:         r.id,
        kind:       r.kind || 'movie',
        title:      r.title || '',
        poster:     r.poster || null,
        chave:      r.chave || null,
        ordem:      r.ordem || 0,
        created_at: r.at || r.created_at || agora()
      };
    },

    canais: function (r) {
      return {
        profile:      profile(),
        chave:        r.chave || r.id,
        title:        r.title || '',
        aberturas:    Math.round(r.aberturas || 0),
        segundos:     Math.round(r.segundos || 0),
        ultima_em:    r.at || r.ultima_em || agora(),
        ultimo_posto: r.posto || r.ultimo_posto || null
      };
    },

    series: function (r) {
      return {
        profile:      profile(),
        series_id:    String(r.series_id || r.seriesId),
        series_title: r.series_title || r.title || '',
        poster:       r.poster || null,
        ultimo_ep_id: r.ultimo_ep_id || null,
        temporada:    r.temporada || null,
        episodio:     r.episodio || null,
        concluida:    !!r.concluida,
        updated_at:   r.updated_at || agora()
      };
    },

    ajustes: function (r) {
      return {
        profile:    profile(),
        chave:      r.chave,
        valor:      r.valor === undefined ? null : r.valor,
        updated_at: r.updated_at || agora()
      };
    }
  };

  /* Tradução: formato do banco → o que o `store.js` entende. */
  var vindoDe = {

    progresso: function (row) {
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
    },

    favoritos: function (row) {
      return {
        id: row.id, kind: row.kind, title: row.title || '',
        poster: row.poster || '', chave: row.chave || '',
        ordem: row.ordem || 0, at: row.created_at
      };
    },

    canais: function (row) {
      return {
        id: row.chave, chave: row.chave, title: row.title || '',
        aberturas: Number(row.aberturas) || 0,
        segundos: Number(row.segundos) || 0,
        posto: row.ultimo_posto || '',
        at: row.ultima_em
      };
    },

    series: function (row) {
      return {
        series_id: String(row.series_id),
        series_title: row.series_title || '',
        poster: row.poster || '',
        ultimo_ep_id: row.ultimo_ep_id || '',
        temporada: row.temporada || 0,
        episodio: row.episodio || 0,
        concluida: !!row.concluida,
        updated_at: row.updated_at
      };
    },

    ajustes: function (row) {
      return { chave: row.chave, valor: row.valor, updated_at: row.updated_at };
    }
  };

  /* Para onde cada tabela deságua ao voltar do banco. */
  var funde = {
    progresso: function (rs) { return w.Store.mergeProgress(rs); },
    favoritos: function (rs) { return w.Store.mergeFavorites(rs); },
    canais:    function (rs) { return w.Store.mergeChannels(rs); },
    series:    function (rs) { return w.Store.mergeSeries(rs); },
    ajustes:   function (rs) { return w.Store.mergeSettings(rs); }
  };

  /* Quantas linhas trazer de cada tabela, e por qual coluna
     ordenar. Progresso é o que mais cresce; ajustes cabem numa
     mão. */
  var LIMITE = { progresso: 400, favoritos: 500, canais: 400, series: 300, ajustes: 60 };
  var ORDEM  = {
    progresso: 'updated_at.desc', favoritos: 'created_at.desc',
    canais: 'ultima_em.desc', series: 'updated_at.desc', ajustes: 'updated_at.desc'
  };

  function endpoint(chave) { return cfg().url + '/rest/v1/' + TABELAS[chave].nome; }
  function filtroPerfil()  { return 'profile=eq.' + encodeURIComponent(profile()); }

  /* O carimbo que diz se a linha na fila ainda é a mesma que foi
     enviada. Cada tabela tem o seu nome para a hora. */
  function carimbo(linha) {
    return String(linha.updated_at || linha.ultima_em || linha.created_at || '');
  }

  function primeiraColuna(chave) {
    if (chave === 'progresso' || chave === 'favoritos') return 'id';
    if (chave === 'series') return 'series_id';
    return 'chave';
  }

  w.Cloud = {

    tabelas: TABELAS,
    chaves: CHAVES,

    enabled:   function () { return !!cfg(); },
    lastError: function () { return lastError; },
    errorDe:   function (chave) { return erroDe[chave] || null; },

    /* Total na fila, ou o total de uma tabela só. */
    pending: function (chave) {
      var q = loadQueue();
      if (chave) return Object.keys(q[chave] || {}).length;
      return CHAVES.reduce(function (n, k) {
        return n + Object.keys(q[k] || {}).length;
      }, 0);
    },

    /* -------------------------------------------------------
       Escrita
       -------------------------------------------------------
       `gravar` é o caminho novo e genérico. `queue` e `remove`
       continuam existindo com a assinatura antiga porque é
       assim que o resto do app chama — e porque uma versão já
       instalada na TV pode estar no meio de um flush quando a
       atualização chegar.
       ------------------------------------------------------- */
    gravar: function (chave, id, dados) {
      if (!cfg() || !TABELAS[chave] || !dados) return;
      var q = loadQueue();
      q[chave][String(id)] = linhaDe[chave](dados);
      saveQueue(q);
      agendar(1200);
    },

    queue: function (rec) { w.Cloud.gravar('progresso', rec.id, rec); },

    /* Apaga uma linha. `filtro` é um mapa coluna→valor; o perfil
       entra sozinho, porque nenhuma tabela aqui é global. */
    apagar: function (chave, filtro) {
      var c = cfg();
      if (!c || !TABELAS[chave]) return;

      var q = loadQueue();
      var idLocal = filtro && (filtro.id || filtro.chave || filtro.series_id);
      if (idLocal) delete q[chave][String(idLocal)];
      saveQueue(q);

      var qs = [filtroPerfil()];
      Object.keys(filtro || {}).forEach(function (col) {
        qs.push(col + '=eq.' + encodeURIComponent(filtro[col]));
      });
      w.fetchText(endpoint(chave) + '?' + qs.join('&'),
                  { method: 'DELETE', raw: true,
                    headers: headers({ 'Prefer': 'return=minimal' }) })
       .catch(function () {});
    },

    remove: function (id) { w.Cloud.apagar('progresso', { id: id }); },

    /* -------------------------------------------------------
       Envio
       -------------------------------------------------------
       Um POST por tabela que tem fila. Cada tabela falha por si:
       se uma delas recusar, o resto continua subindo em vez de
       a fila inteira travar por causa de uma só.
       ------------------------------------------------------- */
    flush: function () {
      var c = cfg();
      if (!c || flushing) return Promise.resolve(false);

      var q = loadQueue();
      var pendentes = CHAVES.filter(function (k) { return Object.keys(q[k]).length > 0; });
      if (!pendentes.length) return Promise.resolve(true);

      flushing = true;
      var algumFalhou = false;

      return Promise.all(pendentes.map(function (k) {
        var linhas = Object.keys(q[k]).map(function (id) { return q[k][id]; });
        return w.fetchText(endpoint(k) + '?on_conflict=' + TABELAS[k].conflito,
          {
            method: 'POST', raw: true,
            headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
            body: JSON.stringify(linhas)
          })
          .then(function () {
            erroDe[k] = null;
            /* Tira da fila só o que subiu: algo pode ter entrado
               enquanto a requisição estava no ar. */
            var atual = loadQueue();
            Object.keys(q[k]).forEach(function (id) {
              var antes = q[k][id], depois = atual[k][id];
              if (depois && carimbo(depois) === carimbo(antes)) delete atual[k][id];
            });
            saveQueue(atual);
          })
          .catch(function (e) {
            algumFalhou = true;
            erroDe[k] = e.message;
            lastError = TABELAS[k].rotulo + ': ' + e.message;
          });
      })).then(function () {
        flushing = false;
        if (algumFalhou) agendar(30000);
        else lastError = null;
        return !algumFalhou;
      });
    },

    /* -------------------------------------------------------
       Leitura
       -------------------------------------------------------
       Traz as cinco tabelas em paralelo e devolve quantos
       registros mudaram alguma coisa na TV. Uma tabela que
       falha vale zero e não derruba as outras.
       ------------------------------------------------------- */
    pull: function () {
      var c = cfg();
      if (!c) return Promise.resolve(0);

      return Promise.all(CHAVES.map(function (k) {
        var url = endpoint(k) + '?select=*&' + filtroPerfil() +
                  '&order=' + ORDEM[k] + '&limit=' + LIMITE[k];
        return w.fetchJSON(url, { headers: headers(), raw: true })
          .then(function (rows) {
            erroDe[k] = null;
            if (!rows || !rows.length) return 0;
            return funde[k](rows.map(vindoDe[k])) || 0;
          })
          .catch(function (e) {
            erroDe[k] = e.message;
            lastError = TABELAS[k].rotulo + ': ' + e.message;
            return 0;
          });
      })).then(function (ns) {
        return ns.reduce(function (a, b) { return a + b; }, 0);
      });
    },

    /* -------------------------------------------------------
       Conferência
       -------------------------------------------------------
       Devolve o estado de cada tabela, uma a uma. É o que os
       Ajustes mostram: "conectado" sem dizer a QUAL tabela não
       ajudava ninguém a descobrir o que faltava.
       ------------------------------------------------------- */
    test: function () {
      var c = cfg();
      if (!c) return Promise.reject(new Error('Preencha a URL e a chave do Supabase.'));
      return Promise.all(CHAVES.map(function (k) {
        return w.fetchJSON(endpoint(k) + '?select=' + primeiraColuna(k) + '&limit=1',
                           { headers: headers(), raw: true })
          .then(function () {
            erroDe[k] = null;
            return { chave: k, rotulo: TABELAS[k].rotulo, ok: true };
          })
          .catch(function (e) {
            erroDe[k] = e.message;
            return { chave: k, rotulo: TABELAS[k].rotulo, ok: false, erro: e.message };
          });
      }));
    },

    /* Reenfileira tudo o que existe na TV. Serve para o dia em
       que o banco esteve desligado e a fila nunca chegou a
       receber nada — conectar depois não recupera sozinho. */
    reenviarTudo: function () {
      if (!cfg()) return 0;
      var n = 0;
      var prog = w.Store.allProgress();
      Object.keys(prog).forEach(function (k) { w.Cloud.gravar('progresso', k, prog[k]); n++; });
      w.Store.favorites().forEach(function (f) { w.Cloud.gravar('favoritos', f.id, f); n++; });
      w.Store.allChannels().forEach(function (ch) {
        w.Cloud.gravar('canais', ch.chave || ch.id, ch); n++;
      });
      w.Store.allSeries().forEach(function (s) { w.Cloud.gravar('series', s.series_id, s); n++; });
      w.Store.syncedSettings().forEach(function (s) { w.Cloud.gravar('ajustes', s.chave, s); n++; });
      return n;
    }
  };

  /* Tenta esvaziar a fila ao abrir e sempre que a rede voltar. */
  w.addEventListener('online', function () { w.Cloud.flush(); });

})(window);
