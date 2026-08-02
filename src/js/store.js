/* =========================================================
   ESTADO PERSISTENTE
   =========================================================
   Ajustes, favoritos, progresso, hábito de canal e estado de
   série. Tudo mora em localStorage — rápido e síncrono, que é
   o que a interface precisa — e tudo é espelhado na nuvem pelo
   `cloud.js`, que trabalha em fila e nunca faz a TV esperar.

   Até esta versão só o progresso subia. Os favoritos moravam
   apenas aqui, e por isso desapareciam na reinstalação — o
   problema que motivou o projeto inteiro. Agora cada coisa que
   se grava tem um destino no banco:

     favoritos       → favorites
     hábito de canal → channel_usage
     estado de série → series_state
     preferências    → settings_sync   (uma lista curta, ver SYNC)

   PRIVACIDADE — a regra que vale acima de todas as outras:
   conteúdo de categoria marcada como adulta NÃO É GRAVADO. Nem
   local, nem na nuvem, nem como favorito, nem como hábito. Não
   é "gravar e esconder", não é "apagar depois". Apagar depois
   deixa rastro; não gravar, não.
   ========================================================= */
(function (w) {
  'use strict';

  var K_SETTINGS  = 'nebula.settings';
  var K_PROGRESS  = 'nebula.progress';
  var K_FAVORITES = 'nebula.favorites';
  var K_CHANNELS  = 'nebula.channels';
  var K_SERIES    = 'nebula.series';
  var K_SYNCAT    = 'nebula.syncat';    /* quando cada ajuste mudou */
  var MAX_PROGRESS = 300;

  /* -----------------------------------------------------------
     Quais preferências valem uma viagem ao banco
     -----------------------------------------------------------
     Não é tudo. Credenciais da lista NÃO entram aqui — se um dia
     a chave anon vazar, o que se achar no banco tem de ser
     inofensivo. Só o que é preferência de uso, e o que dói
     reconfigurar à mão depois de uma reinstalação.
     ----------------------------------------------------------- */
  var SYNC = [
    'adulto.ocultar',
    'adulto.categorias',
    'adulto.liberadas',
    'update.auto',
    'hero.trailer',
    'hero.som',
    'player.autoplay'
  ];

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
  var syncAt    = read(K_SYNCAT, {});

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
  var series    = read(K_SERIES, {});

  function agora() { return new Date().toISOString(); }
  function maisNovo(a, b) { return String(a || '') > String(b || ''); }

  /* O corte de privacidade, num lugar só. `Catalog` pode ainda
     não existir quando isto roda no boot, daí a guarda. */
  function adulto(item) {
    return !!(item && w.Catalog && w.Catalog.itemAdulto && w.Catalog.itemAdulto(item));
  }

  function nuvem() {
    return (w.Cloud && w.Cloud.enabled && w.Cloud.enabled()) ? w.Cloud : null;
  }

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

    /* `semSync` existe para o caminho de volta: quando o valor
       ACABOU de chegar do banco, gravá-lo de novo no banco seria
       um eco. */
    set: function (path, value, semSync) {
      var parts = path.split('.'), node = settings;
      for (var i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = value;
      write(K_SETTINGS, settings);

      if (!semSync && SYNC.indexOf(path) >= 0) {
        syncAt[path] = agora();
        write(K_SYNCAT, syncAt);
        var c = nuvem();
        if (c) c.gravar('ajustes', path, { chave: path, valor: value, updated_at: syncAt[path] });
      }
      return value;
    },

    /* As preferências sincronizáveis, no formato que a nuvem
       espera. Usado pelo "reenviar tudo". */
    syncedSettings: function () {
      var saida = [];
      SYNC.forEach(function (p) {
        var v = w.Store.get(p, undefined);
        if (v === undefined) return;
        saida.push({ chave: p, valor: v, updated_at: syncAt[p] || agora() });
      });
      return saida;
    },

    /* Só aceita o que veio do banco se for mais recente do que a
       última mudança feita nesta TV. Sem isso, desligar uma opção
       aqui e abrir o app amanhã traria a opção ligada de volta. */
    mergeSettings: function (rows) {
      var mudou = 0;
      (rows || []).forEach(function (r) {
        if (!r || SYNC.indexOf(r.chave) < 0) return;
        if (!maisNovo(r.updated_at, syncAt[r.chave])) return;
        w.Store.set(r.chave, r.valor, true);
        syncAt[r.chave] = r.updated_at;
        mudou++;
      });
      if (mudou) write(K_SYNCAT, syncAt);
      return mudou;
    },

    isConfigured: function () {
      return !!w.Store.get('source.url');
    },

    /* ---------------- Favoritos ----------------
       Sincronizados desde esta versão. Antes viviam só aqui e
       morriam na reinstalação. */
    isFavorite: function (id) { return !!favorites[id]; },

    toggleFavorite: function (item) {
      if (!item || !item.id) return false;

      if (favorites[item.id]) {
        delete favorites[item.id];
        write(K_FAVORITES, favorites);
        var fora = nuvem();
        if (fora) fora.apagar('favoritos', { id: item.id });
        return false;
      }

      /* Não grava o que não pode ser gravado. Devolve falso: a
         estrela não acende, e é o comportamento pedido. */
      if (adulto(item)) return false;

      var r = {
        id: item.id,
        kind: item.kind || 'movie',
        title: item.title || '',
        poster: item.poster || item.backdrop || '',
        chave: item.chave || '',
        ordem: 0,
        at: agora()
      };
      favorites[item.id] = r;
      write(K_FAVORITES, favorites);
      var c = nuvem();
      if (c) c.gravar('favoritos', r.id, r);
      return true;
    },

    favorites: function () {
      return Object.keys(favorites).map(function (k) { return favorites[k]; })
        .sort(function (a, b) {
          if ((a.ordem || 0) !== (b.ordem || 0)) return (a.ordem || 0) - (b.ordem || 0);
          return String(b.at || '').localeCompare(String(a.at || ''));
        });
    },

    mergeFavorites: function (rows) {
      var mudou = 0;
      (rows || []).forEach(function (r) {
        if (!r || !r.id) return;
        var meu = favorites[r.id];
        if (!meu || maisNovo(r.at, meu.at)) { favorites[r.id] = r; mudou++; }
      });
      if (mudou) write(K_FAVORITES, favorites);
      return mudou;
    },

    /* ---------------- Hábito de canal ----------------
       Ao vivo não tem "onde parei", mas TEM "o que eu vejo".
       Aberturas ordenam a lista; segundos dizem o que você
       realmente assiste — zapear por cima de um canal não é
       assistir a ele, e só o contador de cliques não separa uma
       coisa da outra. */
    touchChannel: function (item) {
      if (!item || !item.id || adulto(item)) return;
      var chave = item.chave || item.id;
      var r = channels[chave] || { id: chave, chave: chave, aberturas: 0, segundos: 0 };
      r.title = item.title || r.title || '';
      r.aberturas = (r.aberturas || 0) + 1;
      r.at = agora();
      if (item.qualidade) r.posto = item.qualidade;
      channels[chave] = r;
      write(K_CHANNELS, channels);
      var c = nuvem();
      if (c) c.gravar('canais', chave, r);
    },

    /* Chamado pelo player enquanto o canal está tocando. Não sobe
       a cada tique: acumula aqui e manda a cada minuto, senão
       seriam seis POSTs por minuto de canal aberto para gravar um
       número que ninguém olha em tempo real. */
    addChannelSeconds: function (item, segundos, posto) {
      if (!item || !item.id || !segundos || adulto(item)) return;
      var chave = item.chave || item.id;
      var r = channels[chave] || { id: chave, chave: chave, aberturas: 1, segundos: 0 };
      r.title = r.title || item.title || '';
      r.segundos = (r.segundos || 0) + segundos;
      r.at = agora();
      if (posto) r.posto = posto;
      channels[chave] = r;
      write(K_CHANNELS, channels);

      r._desde = r._desde || 0;
      if (r.segundos - r._desde >= 60) {
        r._desde = r.segundos;
        var c = nuvem();
        if (c) c.gravar('canais', chave, r);
      }
    },

    channelUsage: function (id) { return channels[id] || null; },

    allChannels: function () {
      return Object.keys(channels).map(function (k) { return channels[k]; });
    },

    recentChannels: function (limit) {
      return w.Store.allChannels()
        .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); })
        .slice(0, limit || 30);
    },

    /* Os canais que você mais vê, por tempo. É a ordenação que a
       tabela `channel_usage` existe para permitir. */
    topChannels: function (limit) {
      return w.Store.allChannels()
        .filter(function (r) { return (r.segundos || 0) > 0 || (r.aberturas || 0) > 1; })
        .sort(function (a, b) {
          var d = (b.segundos || 0) - (a.segundos || 0);
          return d !== 0 ? d : (b.aberturas || 0) - (a.aberturas || 0);
        })
        .slice(0, limit || 20);
    },

    mergeChannels: function (rows) {
      var mudou = 0;
      (rows || []).forEach(function (r) {
        if (!r || !r.chave) return;
        var meu = channels[r.chave];
        if (!meu) { channels[r.chave] = r; mudou++; return; }
        /* O contador é cumulativo dos dois lados; fica o maior.
           É o que sobrevive a duas TVs somando em paralelo sem
           inventar um número menor do que os dois. */
        var novo = {
          id: r.chave, chave: r.chave,
          title: meu.title || r.title,
          aberturas: Math.max(meu.aberturas || 0, r.aberturas || 0),
          segundos:  Math.max(meu.segundos || 0, r.segundos || 0),
          posto: meu.posto || r.posto || '',
          at: maisNovo(r.at, meu.at) ? r.at : meu.at
        };
        if (novo.aberturas !== meu.aberturas || novo.segundos !== meu.segundos ||
            novo.at !== meu.at) { channels[r.chave] = novo; mudou++; }
      });
      if (mudou) write(K_CHANNELS, channels);
      return mudou;
    },

    /* ---------------- Estado da série ----------------
       Responde "em que ponto da série eu estou", que é outra
       pergunta que "quanto deste episódio eu vi". Sem isto o
       botão principal do detalhe tem de varrer o histórico
       inteiro para adivinhar. */
    seriesState: function (seriesId) { return series[String(seriesId)] || null; },

    allSeries: function () {
      return Object.keys(series).map(function (k) { return series[k]; });
    },

    setSeriesState: function (r) {
      if (!r || !r.series_id) return null;
      var id = String(r.series_id);
      var atual = series[id] || {};
      var novo = {
        series_id: id,
        series_title: r.series_title || atual.series_title || '',
        poster: r.poster || atual.poster || '',
        ultimo_ep_id: r.ultimo_ep_id || atual.ultimo_ep_id || '',
        temporada: r.temporada || atual.temporada || 0,
        episodio: r.episodio || atual.episodio || 0,
        concluida: r.concluida === undefined ? !!atual.concluida : !!r.concluida,
        updated_at: agora()
      };
      series[id] = novo;
      write(K_SERIES, series);
      var c = nuvem();
      if (c) c.gravar('series', id, novo);
      return novo;
    },

    mergeSeries: function (rows) {
      var mudou = 0;
      (rows || []).forEach(function (r) {
        if (!r || !r.series_id) return;
        var meu = series[r.series_id];
        if (!meu || maisNovo(r.updated_at, meu.updated_at)) {
          series[r.series_id] = r; mudou++;
        }
      });
      if (mudou) write(K_SERIES, series);
      return mudou;
    },

    /* ---------------- Progresso ---------------- */
    progressOf: function (id) { return progress[id] || null; },

    allProgress: function () { return progress; },

    mergeProgress: function (records) {
      var changed = 0;
      (records || []).forEach(function (r) {
        if (!r || !r.id) return;
        var mine = progress[r.id];
        if (!mine || maisNovo(r.updated_at, mine.updated_at)) {
          progress[r.id] = r;
          changed++;
        }
      });
      if (changed) { w.Store._trim(); write(K_PROGRESS, progress); }
      return changed;
    },

    saveProgress: function (rec) {
      if (!rec || !rec.id) return null;
      if (rec.kind === 'live') return null;      /* canal não tem posição */
      if (adulto(rec)) return null;

      rec.updated_at = agora();
      if (rec.duration > 0) {
        rec.completed = (rec.position / rec.duration) >= w.CFG.COMPLETED_RATIO;
      }
      progress[rec.id] = rec;
      w.Store._trim();
      write(K_PROGRESS, progress);
      if (w.Cloud) w.Cloud.queue(rec);

      /* Um episódio salvo é também o ponto em que a série está.
         Fazer isto aqui, e não no player, garante que vale para
         qualquer caminho que grave progresso. */
      if (rec.kind === 'episode' && rec.series_id) {
        w.Store.setSeriesState({
          series_id: rec.series_id,
          series_title: rec.series_title || '',
          poster: rec.poster || '',
          ultimo_ep_id: rec.id,
          temporada: rec.season || 0,
          episodio: rec.episode || 0
        });
      }
      return rec;
    },

    clearProgress: function (id) {
      delete progress[id];
      write(K_PROGRESS, progress);
      if (w.Cloud) w.Cloud.remove(id);
    },

    /* Marcar à mão, nos dois sentidos. Toda detecção automática
       erra, e sem estas duas ações a pessoa fica presa ao erro. */
    marcarAssistido: function (item, sim) {
      if (!item || !item.id || adulto(item)) return null;
      var r = progress[item.id] || {
        id: item.id, kind: item.kind || 'movie', title: item.title || '',
        subtitle: item.subtitle || '', poster: item.poster || '',
        position: 0, duration: 0,
        series_id: item.seriesId || item.series_id || '',
        series_title: item.seriesTitle || item.series_title || '',
        season: item.temporada || item.season || 0,
        episode: item.episodio || item.episode || 0
      };
      r.completed = sim !== false;
      r.position = r.completed ? (r.duration || r.position || 1) : 0;
      r.updated_at = agora();
      progress[r.id] = r;
      write(K_PROGRESS, progress);
      if (w.Cloud) w.Cloud.queue(r);
      return r;
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

    /* Ultimo episodio visto de uma serie, para sugerir o proximo.
       O estado da série responde isso direto agora; a varredura
       fica como rede de segurança para o histórico antigo, de
       antes de a tabela existir. */
    lastEpisodeOf: function (seriesId) {
      var st = series[String(seriesId)];
      if (st && st.ultimo_ep_id && progress[st.ultimo_ep_id]) return progress[st.ultimo_ep_id];

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

    /* Apaga tudo (usado no botao "recomeçar do zero" nos ajustes).
       Só na TV: o banco continua com o que tem, e é de lá que dá
       para trazer de volta. */
    wipe: function () {
      settings = {}; progress = {}; favorites = {}; channels = {}; series = {}; syncAt = {};
      try {
        localStorage.removeItem(K_SETTINGS);
        localStorage.removeItem(K_PROGRESS);
        localStorage.removeItem(K_FAVORITES);
        localStorage.removeItem(K_CHANNELS);
        localStorage.removeItem(K_SERIES);
        localStorage.removeItem(K_SYNCAT);
      } catch (e) {}
      if (w.IDB) w.IDB.clear();
    }
  };

})(window);
