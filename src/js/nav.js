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
          data-wrap="y"              eixos em que dá a volta
          data-page>                 ←/→ paginam a coluna
       <button data-focusable>…</button>
     </div>

   Eixo `rows`: a região contém elementos [data-row]; esquerda
   e direita andam dentro da fileira, cima e baixo trocam de
   fileira mantendo a posição horizontal.

   `data-page`, numa região de eixo `y`: ←/→ deixam de ser
   "sair para o vizinho" e passam a andar uma janela inteira
   dentro da própria coluna.

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

      /* -------------------------------------------------------
         Paginar uma coluna com ←/→
         -------------------------------------------------------
         Numa coluna longa, o eixo horizontal não tem uso: não há
         nada ao lado. Numa região que declara `data-page`, ele
         passa a valer uma TELA de cada vez — que é a distância
         que interessa quando a lista tem 60 pastas e a janela
         mostra 20.

         Na ponta devolve null de propósito. Assim a última
         página não engole a tecla, e a primeira deixa o ← cair
         no vizinho declarado (o menu) em vez de prender a pessoa
         na coluna.
         ------------------------------------------------------- */
      if (reg.hasAttribute('data-page') && (dir === 'left' || dir === 'right')) {
        var passo = tamanhoDaPagina(lista);
        var j = i + (dir === 'right' ? passo : -passo);
        if (dir === 'right') {
          if (i >= lista.length - 1) return null;
          return lista[Math.min(j, lista.length - 1)];
        }
        if (i <= 0) return null;
        return lista[Math.max(j, 0)];
      }
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

  /* Quantos itens cabem na janela da coluna — medido, não
     chutado. O passo entre dois itens já inclui margem e borda,
     e é por isso que ele sai da diferença de `offsetTop` em vez
     de `offsetHeight`. Um a menos no fim: uma página que começa
     no item seguinte ao último visível salta uma linha; deixar
     uma de sobreposição é o que faz a leitura ter continuidade,
     e é o que qualquer leitor de página longa faz. */
  function tamanhoDaPagina(lista) {
    if (lista.length < 2) return 1;
    var passo = Math.abs(lista[1].offsetTop - lista[0].offsetTop) || lista[0].offsetHeight;
    if (!passo) return 1;
    var t = trilhos(lista[0])[0];
    var janela = t && t.parentElement;
    var altura = janela ? janela.clientHeight : 0;
    if (!altura) return 1;
    return Math.max(1, Math.floor(altura / passo) - 1);
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
