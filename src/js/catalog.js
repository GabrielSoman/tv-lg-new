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
