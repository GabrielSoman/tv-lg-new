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
  function temFavoritosDeCanal() {
    return w.Store.favorites().some(function (f) { return f.kind === 'live'; });
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
            ? w.UI.vazio('Nenhum canal favoritado ainda',
                         'Segure OK sobre um canal em qualquer pasta para marcá-lo. ' +
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

      (cat.id === FAVORITOS ? canaisFavoritos()
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
      var virtuais = [];
      if (tipo === 'live') virtuais.push({ id: FAVORITOS, nome: '★ Favoritos' });
      else virtuais.push({ id: TODOS, nome: 'Todos' });
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
        if (id === FAVORITOS) return !temFavoritosDeCanal();
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
    var favoritos = w.Store.favorites().filter(naoAdulto);

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
      if (favoritos.length) {
        fileiras.appendChild(w.UI.fileira('Favoritos', favoritos,
          { forma: 'poster', aoAbrir: abrir }));
      }
      var favCanais = canais.filter(function (c) { return w.Store.isFavorite(c.id); });
      if (favCanais.length) {
        fileiras.appendChild(w.UI.fileira('Canais favoritos', favCanais,
          { forma: 'logo', aoAbrir: abrir }));
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
    pAtu.appendChild(linha('Versão instalada',
      (w.Updater && w.Updater.version && w.Updater.version()) || '—'));
    var bAtu = el('button', { class: 'btn', 'data-focusable': '' });
    bAtu.innerHTML = w.icon('refresh') + '<span>Procurar atualização</span>';
    bAtu.onclick = function () {
      var txt = bAtu.querySelector('span');
      txt.textContent = 'Procurando…';
      w.Updater.check().then(function (info) {
        if (!info.isNew) { txt.textContent = 'Já está atualizado'; return; }
        txt.textContent = 'Instalar versão ' + info.version;
        bAtu.onclick = function () { w.Updater.apply(info); };
      }).catch(function (e) { txt.textContent = 'Falhou: ' + e.message; });
    };
    pAtu.appendChild(bAtu);
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
    var pD = painel('Dados', 'Cache do catálogo e fila do histórico.');
    pD.appendChild(linha('Blocos em memória', w.Catalog.emMemoria()));
    pD.appendChild(linha('Fila para a nuvem', w.Cloud.pending()));
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
