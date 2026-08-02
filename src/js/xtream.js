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
