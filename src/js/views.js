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

     ---------------------------------------------------------
     A EXCEÇÃO: quando foi o menu que PEDIU para entrar
     ---------------------------------------------------------
     A regra acima, sozinha, custava um OK a mais. Você aperta OK
     em "Ao Vivo", a tela monta — e o foco fica no menu, porque a
     regra vê "foco fora do palco" e cede o lugar. Aí precisa de
     um segundo OK para finalmente entrar nas pastas. Medido no
     aparelho: dois toques para uma ação só.

     A diferença entre os dois casos é a intenção, e ela dá para
     registrar: `pedirEntrada()` guarda QUAL elemento pediu. Se,
     quando o conteúdo chegar, o foco ainda estiver exatamente
     nele, a pessoa não mexeu — ela está esperando entrar, e a
     tela entra. Se ela andou no menu nesse meio tempo, o foco é
     dela e a regra original vale.

     Guardar o elemento, e não um "sim" solto, é o que faz isso
     se limpar sozinho: andar uma tecla já invalida o pedido.
     ----------------------------------------------------------- */
  var pedidoDeEntrada = null;

  function pedirEntrada() {
    var atual = w.Nav.atual();
    pedidoDeEntrada = (atual && document.body.contains(atual)) ? atual : null;
  }

  function podeAssumir() {
    var atual = w.Nav.atual();
    if (!(atual && document.body.contains(atual) && !atual.closest('#stage'))) return true;
    if (pedidoDeEntrada && pedidoDeEntrada === atual) { pedidoDeEntrada = null; return true; }
    return false;
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
    /* ---------------------------------------------------------
       A coluna de pastas
       ---------------------------------------------------------
       Não tem mais vizinho à direita. A seta para a direita
       atravessando para a grade era o terceiro degrau de um
       caminho que o OK já faz num toque só — e gastava o eixo
       horizontal, que numa coluna de 60 pastas com 20 visíveis
       tem uso muito melhor: `data-page` faz ←/→ andarem uma
       janela inteira.

       O ← continua saindo para o menu, mas só a partir da
       primeira página. Enquanto houver página anterior, ele
       volta uma página. Como num livro.
       --------------------------------------------------------- */
    var aside = el('div', {
      class: 'coluna-cats',
      'data-region': 'cats', 'data-axis': 'y',
      'data-nb-left': 'rail',
      'data-page': '',
      'data-enter': 'last'
    });
    var janela = el('div', { class: 'janela cheia' });
    var trilho = el('div', { class: 'trilho', 'data-scroll': 'y' });

    cats.forEach(function (c, i) {
      var b = el('button', { class: 'cat-item', 'data-focusable': '', text: c.nome });
      b._cat = c;
      /* `_escolher` é o que o DESCANSO do foco dispara: carrega a
         pasta e fica onde está. Sem `entrar`, senão passar o foco
         por cima de uma pasta jogaria você na grade. */
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

      /* O OK é outra coisa: é "quero ESTA pasta, me leve até ela".
         Carrega, se ainda não estiver carregada, e leva o foco
         para os cartões quando eles chegarem. Sem isto o OK na
         pasta não fazia nada visível — a pasta já estava aberta
         pelo descanso do foco — e não havia como chegar à grade
         depois que a seta parou de atravessar colunas. */
      b.onclick = function () {
        w.$$('.cat-item', aside).forEach(function (o) { o.classList.remove('ativa'); });
        b.classList.add('ativa');
        aoEscolher(c, false, true);
      };
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
  /* -----------------------------------------------------------
     O que a tela de pastas lembra entre uma visita e outra
     -----------------------------------------------------------
     Abrir um filme e voltar refazia a tela do zero: a pasta
     voltava a ser a primeira, a ordenação voltava a "Da pasta" e
     o filtro digitado sumia. Ordenar por nota, entrar num título
     e perder a ordenação é perder o trabalho de escolher.

     A memória é de UMA VIAGEM, não da sessão: ela é escrita no
     instante em que você abre um título e consumida na primeira
     montagem seguinte da tela. Depois disso some.

     Essa validade curta é o ponto. Guardar para sempre entraria
     em conflito com uma decisão anterior que continua certa —
     entrar em Filmes pelo menu abre em "Todos", porque cair numa
     pasta arbitrária do provedor é uma escolha que ninguém pediu.
     Uma coisa é "eu voltei do filme que abri"; outra é "eu entrei
     em Filmes de novo". Só a primeira pede continuidade.
     ----------------------------------------------------------- */
  var memoriaPasta = {};

  function navegar(tipo, forma) {
    var tela = w.UI.tela('nav-' + tipo);
    var conteudo = el('div', { class: 'conteudo' });
    /* Consome de uma vez: esta montagem é a única que restaura. */
    var mem = memoriaPasta[tipo] || {};
    delete memoriaPasta[tipo];

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
    var ordemAtual = mem.ordem || 'padrao';
    var botoesOrdem = [];

    if (tipo !== 'live') {
      var caixaOrdem = el('div', { class: 'filtro-ordem' });
      ORDENS.forEach(function (o) {
        var b = el('button', { class: 'ordem-btn' + (o.id === ordemAtual ? ' ativo' : ''),
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

    /* Tira uma fotografia da tela no instante em que um título é
       aberto. É a única coisa que escreve na memória, e é o que
       torna a restauração previsível: o que volta é exatamente o
       que estava na tela quando você apertou OK. */
    function anotarSaida(foco) {
      memoriaPasta[tipo] = {
        catId: atual, ordem: ordemAtual, filtro: campo.value, foco: foco || ''
      };
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

    /* A grade não sai mais pela esquerda. Dentro do conteúdo, as
       setas navegam o conteúdo e nada mais — sair é com Voltar,
       que sobe para as pastas (ver `tela._voltar`), ou com ↑, que
       chega à barra de filtro e de lá tem ← para as pastas. */
    var caixaGrade = el('div', {
      class: 'grade-caixa',
      'data-region': 'grid', 'data-axis': 'grid',
      'data-nb-up': 'filtro', 'data-enter': 'last'
    });
    caixaGrade.appendChild(el('div', { class: 'carregando', text: 'Carregando…' }));

    conteudo.appendChild(barra);
    conteudo.appendChild(caixaGrade);

    var atual = null;
    var itensDaPasta = [];
    var aRestaurar = mem.foco || '';

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
      var g = w.UI.grade(itens, {
        forma: forma, colunas: COLUNAS,
        /* Abrir um título é o momento exato de anotar onde a
           pessoa estava — é para cá que ela volta. */
        aoAbrir: function (item) { anotarSaida(item.id); abrir(item); }
      });
      caixaGrade.appendChild(g);
      w.UI.ligar(g);

      /* A volta: recoloca o foco no cartaz que foi aberto. A grade
         é virtualizada, então o cartão pode nem existir no DOM —
         `garantir` monta aquele índice sob demanda. */
      if (aRestaurar) {
        var alvo = aRestaurar;
        aRestaurar = '';
        for (var i = 0; i < itens.length; i++) {
          if (String(itens[i].id) !== String(alvo)) continue;
          var no = g.ctrl && g.ctrl.garantir ? g.ctrl.garantir(i) : null;
          if (no) assumirFocoEm(no);
          break;
        }
      }
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

    /* Leva o foco para os cartões. Se a pasta veio vazia não há
       o que focar, e aí o foco fica onde está — na pasta — em vez
       de sumir para lugar nenhum. */
    function entrarNaGrade() {
      return w.Nav.entrar('grid');
    }

    function mostrar(cat, forcar, entrar, manterFiltro) {
      if (atual === cat.id && !forcar) {
        if (entrar) entrarNaGrade();
        return;
      }
      atual = cat.id;
      /* Trocar de pasta zera o filtro — senão a pasta nova abre
         escondida atrás de um termo que era da anterior. A
         exceção é a restauração: ali a pasta é a MESMA de antes e
         o filtro faz parte do que se está devolvendo. */
      if (!manterFiltro) campo.value = '';
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
        if (campo.value.trim()) { aplicarFiltro(); }
        else {
          conta.textContent = itens.length + ' itens';
          pintar(ordenar(itens), cat);
        }
        if (entrar) entrarNaGrade();
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

    /* -----------------------------------------------------------
       A escada do Voltar
       -----------------------------------------------------------
       Grade → filtro? Não: filtro é um desvio, não um nível. A
       escada real desta tela tem três degraus, e Voltar desce um
       de cada vez:

         conteúdo → pastas → menu → (tela anterior)

       Sem isto, o Voltar dentro da grade sumia com a tela inteira
       e a pessoa perdia a pasta que tinha aberto — o que já era
       ruim antes e ficaria pior agora que a seta esquerda não sai
       mais do conteúdo.
       ----------------------------------------------------------- */
    tela._voltar = function () {
      var foco = w.Nav.atual();
      if (!foco || !tela.contains(foco)) return false;

      var reg = w.Nav.regiaoAtual();
      var nome = reg && reg.getAttribute('data-region');

      if (nome === 'grid' || nome === 'filtro') {
        /* volta para a pasta que está aberta, não para a primeira */
        var ativa = w.$('.cat-item.ativa', tela);
        return w.Nav.focar(ativa) || w.Nav.entrar('cats');
      }
      if (nome === 'cats') {
        return w.Nav.focusFirst('.rail-item.active') || w.Nav.focusFirst('.rail-item');
      }
      return false;
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

      /* A pasta lembrada vence a seleção automática: voltar de um
         título tem de cair na pasta em que você estava, não na
         primeira útil da coluna. */
      var voltando = false;
      if (mem.catId) {
        for (var ci = 0; ci < cats.length; ci++) {
          if (String(cats[ci].id) === String(mem.catId)) { inicial = ci; voltando = true; break; }
        }
      }

      var botoes = w.$$('.cat-item', coluna);
      botoes.forEach(function (b) { b.classList.remove('ativa'); });
      if (botoes[inicial]) botoes[inicial].classList.add('ativa');

      if (voltando && mem.filtro) campo.value = mem.filtro;
      mostrar(cats[inicial], false, false, voltando);

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
  /* A arte certa para uma caixa larga é a DEITADA. O campo se
     chama `fundo` no catálogo (vem de `backdrop_path`) e este
     código lia só `backdrop`, que não existe em item nenhum — por
     isso o hero sempre caía no cartaz em pé esticado, que é a
     causa real de ele "parecer errado". */
  function arteLarga(item) {
    return item.backdrop || item.fundo || item.poster || '';
  }

  function destaque(item, aoTocar, aoDetalhe) {
    /* `data-topo`: subir para o destaque traz ele INTEIRO, não o
       tanto que faz o botão caber. Ver o comentário da rolagem no
       nav.js — sem isto, voltar de uma fileira de baixo deixava a
       arte cortada na metade. */
    var sec = el('div', {
      class: 'hero',
      'data-region': 'hero', 'data-axis': 'x', 'data-topo': '',
      'data-nb-left': 'rail', 'data-nb-down': 'rows', 'data-enter': 'first'
    });

    var arteUrl = arteLarga(item);
    if (arteUrl) {
      var arte = el('div', { class: 'hero-arte' });
      arte.style.backgroundImage = 'url("' + String(arteUrl).replace(/"/g, '%22') + '")';
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

    ligarTrailer(sec, item, botoes);
    return sec;
  }

  /* -----------------------------------------------------------
     Trailer na abertura
     -----------------------------------------------------------
     `youtube_trailer` sempre veio na resposta do painel e nunca
     foi usado. Agora vira o que o hero mostra depois de alguns
     segundos de arte parada — mudo, em laço, atrás do degradê.

     Três decisões, todas por causa de como isso falha numa TV:

     · nunca entra de cara. Se a rede está ruim, o primeiro
       quadro tem de ser uma imagem inteira, não um retângulo
       preto carregando;

     · se o iframe não subir em 9 segundos, desiste e some. Um
       trailer que não veio é invisível; um trailer travado é uma
       mancha preta em cima da abertura;

     · morre junto com a tela. O <iframe> continuaria tocando som
       — quando você tirasse o mudo — dentro de um nó que já saiu
       do documento.
     ----------------------------------------------------------- */
  var ATRASO_TRAILER = 3200;
  var LIMITE_TRAILER = 9000;

  /* Aceita o que o painel mandar: id cru, link normal, link
     curto, /embed/. Provedor nenhum é consistente nisto. */
  function idYoutube(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    var m = s.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
            s.match(/(?:youtu\.be\/|\/embed\/|\/shorts\/|\/v\/)([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{6,20}$/.test(s)) return s;
    return '';
  }

  function ligarTrailer(sec, item, botoes) {
    if (!item || item.kind === 'live') return;
    if (w.Store.get('hero.trailer', true) === false) return;

    var vid = idYoutube(item.trailer);
    if (!vid) return;

    /* Com som por padrão. O iframe SOBE mudo mesmo assim, e o som
       entra logo depois por postMessage — não é firula: navegador
       nenhum deixa um vídeo embutido começar com áudio sem gesto
       do usuário, e a resposta a isso é recusar a reprodução
       inteira. Subir mudo e tirar o mudo em seguida é o que faz o
       trailer tocar em todo caso: com som quando o aparelho
       permite, sem som quando não permite. Nunca uma caixa preta
       parada. */
    var mudo = w.Store.get('hero.som', true) !== true;
    var caixa = null, quadro = null, relogio = null, vigia = null, morto = false;

    function parar() {
      clearTimeout(relogio); clearTimeout(vigia);
      /* Zerar as alças, e não só cancelar: `armar()` usa `relogio`
         para saber se já há uma contagem em curso, e um número
         velho ali faria o trailer nunca mais voltar. */
      relogio = null; vigia = null;
      if (quadro) { try { quadro.src = 'about:blank'; } catch (e) {} }
      if (caixa && caixa.parentNode) caixa.parentNode.removeChild(caixa);
      caixa = null; quadro = null;
      sec.classList.remove('tocando');
    }

    /* A API do YouTube por postMessage. Só serve para o som: o
       resto (laço, sem controles) já vai na própria URL. */
    function comandar(func) {
      if (!quadro || !quadro.contentWindow) return;
      try {
        quadro.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: func, args: [] }), '*');
      } catch (e) {}
    }

    function botaoSom() {
      var b = el('button', { class: 'btn ghost', 'data-focusable': '' });
      var pinta = function () {
        b.innerHTML = w.icon(mudo ? 'mute' : 'volume') +
                      '<span>' + (mudo ? 'Ativar som' : 'Sem som') + '</span>';
      };
      pinta();
      b.onclick = function () {
        mudo = !mudo;
        w.Store.set('hero.som', !mudo);
        comandar(mudo ? 'mute' : 'unMute');
        pinta();
      };
      return b;
    }

    function comecar() {
      if (morto) return;
      caixa = el('div', { class: 'hero-trailer' });
      quadro = document.createElement('iframe');
      quadro.setAttribute('frameborder', '0');
      quadro.setAttribute('allow', 'autoplay; encrypted-media');
      quadro.setAttribute('tabindex', '-1');
      quadro.src = 'https://www.youtube.com/embed/' + vid +
        '?autoplay=1&mute=1' +
        '&controls=0&disablekb=1&fs=0&rel=0&modestbranding=1' +
        '&iv_load_policy=3&playsinline=1&enablejsapi=1' +
        '&loop=1&playlist=' + vid;

      quadro.onload = function () {
        if (morto) return;
        clearTimeout(vigia);
        caixa.classList.add('on');
        sec.classList.add('tocando');
        if (botoes && !botoes.querySelector('.hero-som')) {
          var b = botaoSom();
          b.classList.add('hero-som');
          botoes.appendChild(b);
        }
        /* O som entra depois que o player do YouTube existe do
           outro lado — mandar antes é falar sozinho. Um segundo
           é folga suficiente e ninguém percebe. */
        if (!mudo) setTimeout(function () { if (!morto) comandar('unMute'); }, 1000);
      };

      caixa.appendChild(quadro);
      /* Antes do véu e do texto: o degradê tem de continuar por
         cima, senão o título fica ilegível sobre o vídeo. */
      sec.insertBefore(caixa, sec.firstChild);

      vigia = setTimeout(function () {
        if (!sec.classList.contains('tocando')) parar();
      }, LIMITE_TRAILER);
    }

    /* -----------------------------------------------------------
       O trailer só toca enquanto o destaque está em cena
       -----------------------------------------------------------
       Descer para as fileiras de baixo tira o destaque da tela, e
       um vídeo tocando fora de vista é o pior dos dois mundos: não
       se vê e continua gastando rede, decodificador e som. Pior
       ainda quando o destaque troca junto com o foco — vira uma
       sucessão de trailers de meio segundo.

       Então o trailer é armado e desarmado de fora, por quem sabe
       onde está o foco. Desarmar volta para a arte parada; armar
       recomeça a contagem do atraso, e não o vídeo do zero no
       mesmo instante — quem só passa de raspão não dispara nada.
       ----------------------------------------------------------- */
    sec._trailer = {
      armar: function () {
        if (morto || caixa || relogio) return;
        relogio = setTimeout(comecar, ATRASO_TRAILER);
      },
      parar: function () { parar(); },
      tocando: function () { return !!caixa; }
    };

    relogio = setTimeout(comecar, ATRASO_TRAILER);
    sec._desligar = function () { morto = true; parar(); };
  }

  /* -----------------------------------------------------------
     O destaque acompanha o que você está olhando
     -----------------------------------------------------------
     Enquanto você anda pelo "Continuar assistindo", o hero troca
     junto: a arte grande, a sinopse, os botões e o trailer passam
     a ser do item em foco. É a fileira certa para isto — ela fica
     logo abaixo do hero, então os dois estão na tela ao mesmo
     tempo e a troca se vê. Nas fileiras de baixo o hero já saiu
     de cena e trocá-lo seria trabalho para ninguém ver.

     Duas cautelas, as duas por causa do que custa numa TV:

     · troca no DESCANSO do foco, não a cada tecla. Passar rápido
       por dez cartazes não pode disparar dez trocas de arte e dez
       chamadas ao painel — foi assim que o fundo ambiente da
       versão anterior derrubou a taxa de quadros;

     · o hero antigo é DESLIGADO antes de sair. Ele pode ter um
       trailer tocando atrás, e um <iframe> do YouTube removido
       sem aviso continua consumindo rede e som.
     ----------------------------------------------------------- */
  var heroVivo = null;
  var esperaHero = null;
  var ESPERA_HERO = 380;

  function chaveDoDestaque(item) {
    if (!item) return '';
    var s = item.series_id || item.seriesId;
    return s ? 's:' + s : String(item.id || '');
  }

  /* O destaque está em cena? Ele fica no topo da coluna, então a
     resposta é: o foco está nele, ou na fileira logo abaixo dele.
     Dali para baixo o destaque já saiu da tela. */
  function destaqueEmCena(elemento) {
    if (!heroVivo || !elemento) return false;
    if (heroVivo.no && heroVivo.no.contains(elemento)) return true;
    return !!(heroVivo.fileira && heroVivo.fileira.contains(elemento));
  }

  function aoFocarCartao(elemento) {
    clearTimeout(esperaHero);
    if (!heroVivo) return;
    if (!heroVivo.no || !document.body.contains(heroVivo.no)) { heroVivo = null; return; }

    /* O menu lateral não conta. Ele não rola a tela — o destaque
       continua inteiro ali atrás — e cortar o trailer a cada
       passada pelo menu, com os três segundos de espera de novo
       na volta, seria pior do que deixar tocando. */
    if (elemento && elemento.closest && elemento.closest('#rail')) return;

    /* Liga e desliga o trailer conforme o destaque entra e sai de
       cena, para qualquer foco dentro do palco. */
    var perto = destaqueEmCena(elemento);
    var tr = heroVivo.no._trailer;
    if (tr) { if (perto) tr.armar(); else tr.parar(); }

    if (!elemento || !elemento._item) return;
    if (!heroVivo.fileira || !heroVivo.fileira.contains(elemento)) return;

    var item = elemento._item;
    if (chaveDoDestaque(item) === heroVivo.id) return;

    esperaHero = setTimeout(function () {
      if (w.Nav.atual() !== elemento) return;
      trocarDestaque(item);
    }, ESPERA_HERO);
  }

  function trocarDestaque(item) {
    if (!heroVivo) return;
    var id = chaveDoDestaque(item);
    heroVivo.id = id;

    enriquecerDestaque(marcarRetomar(item)).then(function (cheio) {
      /* Entre o pedido e a resposta a pessoa pode ter andado mais,
         ou trocado de tela. Só pinta se ainda for este o alvo. */
      if (!heroVivo || heroVivo.id !== id) return;
      if (!heroVivo.no || !document.body.contains(heroVivo.no)) { heroVivo = null; return; }

      var novo = destaque(cheio || item, tocarDoDestaque, abrir);
      w.UI.desligar(heroVivo.no);
      heroVivo.no.parentNode.replaceChild(novo, heroVivo.no);
      heroVivo.no = novo;
    }).catch(function () {});
  }

  /* O destaque merece uma chamada a mais: o registro de progresso
     guarda só título e cartaz, e o hero quer a arte deitada, a
     sinopse e o trailer. É uma requisição, cacheada, e é ela que
     separa um hero bonito de um cartaz esticado com o nome em
     cima. */
  function enriquecerDestaque(item) {
    if (!item) return Promise.resolve(null);
    if (item.kind === 'live') return Promise.resolve(item);

    var id = String(item.id || '');
    var num = id.replace(/^[a-z]+:/, '');
    var serieId = item.seriesId || item.series_id || (/^series:/.test(id) ? num : '');
    var busca = serieId
      ? w.Catalog.serie(serieId)
      : (/^movie:/.test(id) || item.kind === 'movie')
        ? w.Catalog.filme(item.streamId || num)
        : null;
    if (!busca) return Promise.resolve(item);

    return busca.then(function (info) {
      if (!info) return item;
      var c = {};
      Object.keys(item).forEach(function (k) { c[k] = item[k]; });
      c.backdrop = item.backdrop || item.fundo || info.fundo || '';
      c.poster   = item.poster || info.poster || '';
      c.plot     = item.plot || item.sinopse || info.sinopse || '';
      c.trailer  = item.trailer || info.trailer || '';
      return c;
    }).catch(function () { return item; });
  }

  /* -----------------------------------------------------------
     Top 10 novidades
     -----------------------------------------------------------
     Um painel Xtream não tem dado de popularidade — não existe
     "mais assistido" para pedir, e inventar um ranking com número
     aleatório seria mentira desenhada com capricho. O que ele TEM
     é a data em que cada coisa entrou no acervo (`added` nos
     filmes, `last_modified` nas séries). "Chegou agora" é um
     ranking honesto, e é o que a fileira numerada mostra.

     Sai do material que a abertura já baixou para montar as
     outras fileiras: nenhuma requisição a mais.

     ---------------------------------------------------------
     O erro que isto conserta
     ---------------------------------------------------------
     A conta era feita sobre `bloco.itens`, que é a pasta CORTADA
     nos 60 primeiros — e os 60 primeiros vêm na ordem do
     provedor, que não é ordem de chegada. Resultado: a abertura
     anunciava como novidade o que era simplesmente o começo da
     lista, e abrir a mesma pasta ordenando por "Recentes"
     mostrava coisas mais novas que não estavam no Top 10. Você
     viu a contradição e ela era real.

     Agora a conta é sobre `bloco.todos`, a pasta inteira. Ordenar
     antes de cortar, e não o contrário.
     ----------------------------------------------------------- */
  function topNovidades(blocos, quantos) {
    var todos = [];
    (blocos || []).forEach(function (b) {
      todos = todos.concat((b && (b.todos || b.itens)) || []);
    });

    var vistos = {};
    return todos.filter(function (i) {
      if (!i || !i.added) return false;
      if (!naoAdulto(i)) return false;
      if (!i.poster && !i.fundo) return false;
      var chave = i.seriesId ? 's:' + i.seriesId : i.id;
      if (vistos[chave]) return false;
      vistos[chave] = true;
      return true;
    }).sort(function (a, b) {
      return (b.added || 0) - (a.added || 0);
    }).slice(0, quantos || 10);
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
    var promessaDestaque = (comArte
      ? Promise.resolve(marcarRetomar(comArte))
      : w.Catalog.categorias('movie')
          .then(function (cs) { return cs.length ? w.Catalog.itens('movie', cs[0].id) : []; })
          .then(function (fs) { return fs.filter(comCapa)[0] || null; })
          .catch(function () { return null; })
      ).then(enriquecerDestaque);

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

      var noHero = null;
      if (dest) {
        noHero = destaque(dest, tocarDoDestaque, abrir);
        coluna.appendChild(noHero);
      }
      coluna.appendChild(fileiras);

      var fileiraContinuar = null;
      if (continuar.length) {
        fileiraContinuar = w.UI.fileira('Continuar assistindo', continuar,
          { forma: 'wide', aoAbrir: tocarDoDestaque });
        fileiras.appendChild(fileiraContinuar);
      }

      /* A partir daqui o destaque segue o foco desta fileira. */
      heroVivo = (noHero && fileiraContinuar)
        ? { no: noHero, id: chaveDoDestaque(dest), fileira: fileiraContinuar }
        : null;

      /* A fileira numerada vem logo depois do que está em
         andamento e antes das pastas: é a única fileira em que a
         ordem quer dizer alguma coisa, e ela se perde no meio de
         seis fileiras iguais lá embaixo. */
      var novidades = topNovidades(filmes.concat(series), 10);
      if (novidades.length >= 5) {
        fileiras.appendChild(w.UI.fileira('Top 10 novidades', novidades, {
          forma: 'poster', numerada: true, aoAbrir: abrir,
          subtitulo: 'o que chegou por último'
        }));
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
          /* `itens` é o recorte que vira fileira; `todos` é a pasta
             inteira, e é dela que sai o Top 10. Ver o comentário
             em `topNovidades`: cortar antes de ordenar por data
             era a razão de a abertura mostrar novidades mais
             velhas que as da própria pasta. */
          .then(function (its) {
            return { nome: c.nome, itens: its.slice(0, 60), todos: its };
          })
          .catch(function () { return { nome: c.nome, itens: [], todos: [] }; });
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
  function comCapa(i) { return !!(i.backdrop || i.fundo || i.poster); }
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
    var arteDet = arteLarga(item);
    if (arteDet) {
      var arte = el('div', { class: 'det-arte' });
      arte.style.backgroundImage = 'url("' + String(arteDet).replace(/"/g, '%22') + '")';
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

    /* Liga/desliga a instalação sozinha. Ligada por padrão. */
    var auto = w.Store.get('update.auto', true) !== false;
    var bAuto = el('button', { class: 'btn ghost' + (auto ? ' ativo' : ''),
                               'data-focusable': '' });
    var pintaAuto = function () {
      bAuto.querySelector('span').textContent = auto
        ? 'Atualizar sozinho: ligado'
        : 'Atualizar sozinho: desligado';
      bAuto.classList.toggle('ativo', auto);
    };
    bAuto.innerHTML = '<span></span>';
    pintaAuto();
    bAuto.onclick = function () {
      auto = !auto;
      w.Store.set('update.auto', auto);
      pintaAuto();
    };
    pAtu.appendChild(bAuto);

    if (w.Updater && w.Updater.hasPrevious && w.Updater.hasPrevious()) {
      var bVolta = el('button', { class: 'btn ghost', 'data-focusable': '' });
      bVolta.innerHTML = '<span>Voltar para a versão anterior</span>';
      bVolta.onclick = function () {
        if (w.Updater.rollback()) w.Updater.reload();
      };
      pAtu.appendChild(bVolta);
    }
    caixa.appendChild(pAtu);

    /* --- abertura --- */
    var pIni = painel('Tela inicial',
      'O trailer entra depois de alguns segundos de arte parada, sem som. ' +
      'Se o vídeo não subir em nove segundos, o app desiste e a arte fica.');

    var trOn = w.Store.get('hero.trailer', true) !== false;
    var bTr = el('button', { class: 'btn ghost' + (trOn ? ' ativo' : ''), 'data-focusable': '' });
    var pintaTr = function () {
      bTr.innerHTML = w.icon(trOn ? 'play' : 'pause') + '<span>' +
        (trOn ? 'Trailer no destaque: ligado' : 'Trailer no destaque: desligado') + '</span>';
      bTr.classList.toggle('ativo', trOn);
    };
    pintaTr();
    bTr.onclick = function () {
      trOn = !trOn;
      w.Store.set('hero.trailer', trOn);
      pintaTr();
      w.toast(trOn ? 'Trailer ligado — vale na próxima abertura.'
                   : 'Trailer desligado.', 3000);
    };
    pIni.appendChild(bTr);

    var somOn = w.Store.get('hero.som', true) === true;
    var bSom = el('button', { class: 'btn ghost' + (somOn ? ' ativo' : ''), 'data-focusable': '' });
    var pintaSom = function () {
      bSom.innerHTML = w.icon(somOn ? 'volume' : 'mute') + '<span>' +
        (somOn ? 'Trailer com som' : 'Trailer sem som') + '</span>';
      bSom.classList.toggle('ativo', somOn);
    };
    pintaSom();
    bSom.onclick = function () {
      somOn = !somOn;
      w.Store.set('hero.som', somOn);
      pintaSom();
    };
    pIni.appendChild(bSom);
    caixa.appendChild(pIni);

    /* O painel de conteúdo adulto saiu daqui de propósito.
       -------------------------------------------------------
       O comportamento continua exatamente o mesmo, e é o certo:
       as categorias aparecem no catálogo normalmente, e NADA
       delas é gravado — nem progresso, nem favorito, nem hábito
       de canal, nem relacionado. Isso é regra de código, no
       `store.js` e no `player.js`, não uma preferência.

       Ter um botão para uma coisa que já está resolvida só
       convida a mexer no que não precisa. O interruptor de
       ocultar continua existindo em `adulto.ocultar` para quem
       quiser ligar à mão um dia; ele só não ocupa mais uma
       tela. */

    /* --- dados --- */
    var pD = painel('Dados',
      'O banco é a fonte da verdade: o que você apagar lá some da TV na ' +
      'próxima leitura. Sem banco, o app funciona igual — só não guarda ' +
      'favoritos nem retomada.');
    pD.appendChild(linha('Blocos em memória', w.Catalog.emMemoria()));

    var lida = w.Cloud.ultimaLeitura && w.Cloud.ultimaLeitura();
    pD.appendChild(linha('Última leitura do banco',
      lida ? new Date(lida).toLocaleTimeString('pt-BR') : 'ainda não'));

    /* Estado do banco, escrito em português claro. Ele estava
       desligado na TV e não havia como saber olhando a tela. */
    pD.appendChild(linha('Banco de dados',
      w.Cloud.enabled() ? 'conectado' : 'desligado (sem credenciais)'));

    /* -------------------------------------------------------
       Uma linha por tabela
       -------------------------------------------------------
       "Conectado" sozinho escondia o problema real: quatro das
       cinco tabelas nunca recebiam nada, e a tela dizia que
       estava tudo bem. Agora cada uma responde por si — o que
       tem na TV, o que está esperando para subir e, depois do
       teste, se ela existe mesmo lá.
       ------------------------------------------------------- */
    var CONTAGEM = {
      progresso: function () { return Object.keys(w.Store.allProgress()).length; },
      favoritos: function () { return w.Store.favorites().length; },
      canais:    function () { return w.Store.allChannels().length; },
      series:    function () { return w.Store.allSeries().length; },
      ajustes:   function () { return w.Store.syncedSettings().length; }
    };
    var linhasTab = {};
    (w.Cloud.chaves || []).forEach(function (k) {
      var fila = w.Cloud.pending(k);
      var txt = CONTAGEM[k]() + ' na TV' + (fila ? ' · ' + fila + ' na fila' : '');
      var l = linha(w.Cloud.tabelas[k].rotulo, txt);
      linhasTab[k] = l.querySelector('.linha-v');
      pD.appendChild(l);
    });

    if (w.Cloud.lastError && w.Cloud.lastError()) {
      pD.appendChild(linha('Último erro', w.Cloud.lastError()));
    }

    if (w.Cloud.enabled()) {
      var bTeste = el('button', { class: 'btn ghost', 'data-focusable': '' });
      bTeste.innerHTML = '<span>Conferir as cinco tabelas</span>';
      bTeste.onclick = function () {
        var t = bTeste.querySelector('span');
        t.textContent = 'Conferindo…';
        w.Cloud.test()
          .then(function (res) {
            var faltam = res.filter(function (r) { return !r.ok; });
            res.forEach(function (r) {
              var alvo = linhasTab[r.chave];
              if (!alvo) return;
              alvo.textContent = alvo.textContent.split(' · ')[0] +
                (r.ok ? ' · tabela ok' : ' · NÃO EXISTE no banco');
            });
            t.textContent = faltam.length
              ? faltam.length + ' tabela(s) faltando — rode o supabase/schema-v2.sql'
              : 'As cinco tabelas respondem';
          })
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
      /* -------------------------------------------------------
         Ler o banco agora
         -------------------------------------------------------
         O caminho normal já faz isso sozinho — ao abrir o app, ao
         voltar para a tela inicial, ao sair do segundo plano e de
         cinco em cinco minutos. Este botão é para quando você
         acabou de mexer no Supabase e quer ver o efeito sem
         esperar.
         ------------------------------------------------------- */
      var bLer = el('button', { class: 'btn', 'data-focusable': '' });
      bLer.innerHTML = w.icon('down') + '<span>Ler o banco agora</span>';
      bLer.onclick = function () {
        var t = bLer.querySelector('span');
        t.textContent = 'Lendo…';
        w.Cloud.sincronizar()
          .then(function (n) {
            t.textContent = n
              ? n + ' registro(s) mudaram — a TV está igual ao banco'
              : 'A TV já estava igual ao banco';
          })
          .catch(function (e) { t.textContent = 'Falhou: ' + e.message; });
      };
      pD.appendChild(bLer);

      /* Este é o inverso, e é perigoso de propósito: manda para o
         banco o que existe na TV. Serve para a primeira carga, ou
         para o dia em que o banco esteve desligado. Depois que a
         reconciliação está funcionando, usar isto ressuscita no
         banco o que você tiver apagado lá e ainda estiver aqui. */
      var bTudo = el('button', { class: 'btn ghost', 'data-focusable': '' });
      bTudo.innerHTML = '<span>Enviar tudo o que está na TV</span>';
      bTudo.onclick = function () {
        var t = bTudo.querySelector('span');
        var n = w.Cloud.reenviarTudo();
        if (!n) { t.textContent = 'Não há nada para enviar'; return; }
        t.textContent = 'Enfileirando ' + n + '…';
        Promise.resolve(w.Cloud.flush())
          .then(function () {
            var faltam = w.Cloud.pending();
            t.textContent = faltam
              ? 'Enviado — ' + faltam + ' ainda na fila'
              : 'Enviado: ' + n + ' registros nas cinco tabelas';
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
    aoFocarCartao: aoFocarCartao,
    pedirEntrada: pedirEntrada,
    /* Chamado a cada troca de tela: mata o que a tela anterior
       deixou agendado. Sem isto, um destaque pedido meio segundo
       antes de sair pintaria por cima da tela nova. */
    stopBillboard: function () {
      clearTimeout(esperaCat);
      clearTimeout(esperaHero);
      heroVivo = null;
    }
  };

})(window);
