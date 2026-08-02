/* =========================================================
   VIRTUALIZAÇÃO — fileiras e grades
   =========================================================
   O problema, em números da lista real: 20.478 filmes,
   266.823 episódios, 1.910 canais lógicos. A versão anterior
   criava um nó de DOM para cada item da categoria aberta e
   deixava o navegador se virar. Uma categoria de 1.650 filmes
   virava 1.650 cartões, 1.650 <img>, e a TV engasgava antes
   mesmo de você apertar a primeira tecla.

   Aqui só existe no DOM o que cabe na tela, mais uma margem
   de segurança. O resto são números.

   ---------------------------------------------------------
   COMO CONVIVE COM O MOTOR DE NAVEGAÇÃO

   O `nav.js` anda entre os elementos que EXISTEM. Se o
   próximo cartão não estiver montado, a tecla não tem para
   onde ir e a borda para — o que seria um bug cruel, porque
   pareceria "a lista acabou".

   A garantia é a margem: a janela montada sempre passa
   MARGEM itens além do que se vê, dos dois lados. Como uma
   tecla move exatamente um item, o alvo sempre existe. E o
   `nav.js` chama `Nav.aoFocar` depois de rolar, que é onde
   a gente remonta a janela — então a margem se renova antes
   de acabar.

   ---------------------------------------------------------
   POR QUE POSIÇÃO ABSOLUTA

   Duas razões, as duas medidas:

     · o trilho precisa manter o tamanho TOTAL da lista, senão
       o `scrollWidth`/`scrollHeight` que o nav.js usa para
       limitar a rolagem encolhe quando os itens são reciclados
       e a lista "trava" no meio;

     · com posição absoluta, criar e remover um cartão não
       reposiciona os vizinhos. Em fluxo normal, cada reciclagem
       custaria um refluxo da fileira inteira.

   O trilho recebe largura e altura explícitas — o tamanho que
   a lista TERIA inteira. É a única mentira necessária, e é
   uma mentira consistente.
   ========================================================= */
(function (w) {
  'use strict';

  var doc = w.document;

  /* Quantos itens montar além do que se vê, de cada lado.
     Precisa ser ≥ 2 para a navegação nunca ficar sem alvo;
     4 dá folga para o auto-repeat do controle, que dispara
     de 10 a 15 teclas por segundo. */
  var MARGEM = 4;

  function px(n) { return Math.round(n) + 'px'; }

  /* -----------------------------------------------------------
     Medida do passo
     -----------------------------------------------------------
     Não dá para chutar o tamanho do cartão: ele vem do CSS, em
     rem, e a raiz é calculada a partir da largura da tela. Então
     monta-se UM cartão de verdade, mede-se, e joga-se fora.
     Uma vez por fileira, não por item.
     ----------------------------------------------------------- */
  function medir(trilho, desenhar, item) {
    var sonda = desenhar(item, 0);
    sonda.style.position = 'absolute';
    sonda.style.left = '0px';
    sonda.style.top = '0px';
    sonda.style.visibility = 'hidden';
    trilho.appendChild(sonda);
    var m = { largura: sonda.offsetWidth, altura: sonda.offsetHeight };
    trilho.removeChild(sonda);
    return m;
  }

  /* -----------------------------------------------------------
     Base comum
     ----------------------------------------------------------- */
  function Controlador(cfg) {
    this.janela = cfg.janela;
    this.itens = cfg.itens || [];
    this.desenhar = cfg.desenhar;
    this.colunas = cfg.colunas || 0;      /* 0 = fileira; 'auto' = grade calculada */
    this.gap = cfg.gap || 0;
    this.nos = {};                        /* índice → elemento montado */
    this.fixo = null;                     /* nó que não pode ser reciclado */
    this.faixa = null;                    /* última janela montada */

    var trilho = doc.createElement('div');
    trilho.className = 'trilho';
    trilho.setAttribute('data-scroll', this.colunas ? 'y' : 'x');
    trilho.style.position = 'relative';
    this.trilho = trilho;
    trilho._virt = this;

    this.janela.appendChild(trilho);
    this.medida = this.itens.length
      ? medir(trilho, this.desenhar, this.itens[0])
      : { largura: 0, altura: 0 };

    this.passoX = this.medida.largura + this.gap;
    this.passoY = this.medida.altura + this.gap;

    /* -------------------------------------------------------
       Colunas calculadas, não chutadas
       -------------------------------------------------------
       Eu tinha fixado 7 colunas para cartaz e 6 para logo. Deu
       no que tinha de dar: a grade vazava pela direita, porque
       a conta certa depende da largura DAQUELA janela, que muda
       conforme a tela tem ou não coluna de categorias, e do
       padding interno.

       Com `colunas: 'auto'`, a conta é feita aqui, depois de
       medir o cartão de verdade. Um número a menos para eu
       errar.
       ------------------------------------------------------- */
    if (this.colunas === 'auto') {
      var cs = w.getComputedStyle(this.janela);
      var util = this.janela.clientWidth -
                 parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
      this.colunas = Math.max(1, Math.floor((util + this.gap) / this.passoX));
    }

    if (this.colunas) {
      this.linhas = Math.ceil(this.itens.length / this.colunas);
      trilho.style.width = px(this.colunas * this.passoX - this.gap);
      trilho.style.height = px(Math.max(0, this.linhas * this.passoY - this.gap));
    } else {
      trilho.style.width = px(Math.max(0, this.itens.length * this.passoX - this.gap));
      trilho.style.height = px(this.medida.altura);
    }

    this.atualizar();
  }

  /* Deslocamento atual do trilho, escrito pelo nav.js. */
  Controlador.prototype.desloc = function () {
    return {
      x: Number(this.trilho.getAttribute('data-off-x') || 0),
      y: Number(this.trilho.getAttribute('data-off-y') || 0)
    };
  };

  /* Qual faixa de índices precisa existir agora. */
  Controlador.prototype.faixaNecessaria = function () {
    var off = this.desloc();
    var total = this.itens.length;
    if (!total) return { de: 0, ate: -1 };

    if (this.colunas) {
      var altura = this.janela.clientHeight || 0;
      var lin1 = Math.floor(off.y / this.passoY) - MARGEM;
      var lin2 = Math.ceil((off.y + altura) / this.passoY) + MARGEM;
      return {
        de: Math.max(0, lin1 * this.colunas),
        ate: Math.min(total - 1, lin2 * this.colunas + this.colunas - 1)
      };
    }
    var largura = this.janela.clientWidth || 0;
    return {
      de: Math.max(0, Math.floor(off.x / this.passoX) - MARGEM),
      ate: Math.min(total - 1, Math.ceil((off.x + largura) / this.passoX) + MARGEM)
    };
  };

  Controlador.prototype.posicaoDe = function (i) {
    if (this.colunas) {
      return { x: (i % this.colunas) * this.passoX,
               y: Math.floor(i / this.colunas) * this.passoY };
    }
    return { x: i * this.passoX, y: 0 };
  };

  /* -----------------------------------------------------------
     Inserção EM ORDEM — não é capricho, é requisito.
     -----------------------------------------------------------
     O `nav.js` anda de um item para o vizinho usando a posição
     na lista de focáveis, e essa lista sai de `querySelectorAll`,
     ou seja, na ordem do DOM. Se um cartão reciclado voltasse com
     `appendChild`, ele entraria no fim e a seta para a direita
     saltaria para o outro extremo da fileira.

     Um bug desses só aparece depois de rolar bastante — que é
     exatamente quando ninguém está mais olhando o código.
     ----------------------------------------------------------- */
  Controlador.prototype.inserir = function (no, i) {
    var proximo = null, menor = Infinity;
    for (var k in this.nos) {
      var j = Number(k);
      if (j > i && j < menor) { menor = j; proximo = this.nos[j]; }
    }
    this.nos[i] = no;
    if (proximo) this.trilho.insertBefore(no, proximo);
    else this.trilho.appendChild(no);
  };

  Controlador.prototype.montar = function (i) {
    var no = this.desenhar(this.itens[i], i);
    var p = this.posicaoDe(i);
    no.style.position = 'absolute';
    no.style.left = px(p.x);
    no.style.top = px(p.y);
    no.setAttribute('data-i', i);
    this.inserir(no, i);
    return no;
  };

  Controlador.prototype.atualizar = function () {
    var f = this.faixaNecessaria();
    if (this.faixa && this.faixa.de === f.de && this.faixa.ate === f.ate) return;
    this.faixa = f;

    var self = this;

    /* recicla o que saiu — menos o nó em foco, que sumir por
       baixo do pé é a pior coisa que uma lista pode fazer */
    Object.keys(this.nos).forEach(function (k) {
      var i = Number(k);
      if (i >= f.de && i <= f.ate) return;
      var no = self.nos[i];
      if (no === self.fixo) return;
      if (no.parentNode) no.parentNode.removeChild(no);
      delete self.nos[i];
    });

    /* monta o que entrou */
    for (var i = f.de; i <= f.ate; i++) {
      if (!this.nos[i]) this.montar(i);
    }
  };

  /* O nó em foco vira intocável até outro tomar o lugar. É o que
     faz `data-enter="last"` continuar funcionando: o nav.js guarda
     a REFERÊNCIA do último foco da região, e uma referência para
     um nó reciclado não serve para nada. */
  Controlador.prototype.fixar = function (no) {
    if (this.fixo === no) return;
    var antigo = this.fixo;
    this.fixo = no;
    if (antigo && this.faixa) {
      var i = Number(antigo.getAttribute('data-i'));
      if ((i < this.faixa.de || i > this.faixa.ate) && antigo.parentNode) {
        antigo.parentNode.removeChild(antigo);
        delete this.nos[i];
      }
    }
  };

  Controlador.prototype.no = function (i) { return this.nos[i] || null; };

  /* Traz um índice para o DOM mesmo fora da faixa — usado para
     restaurar o foco ao voltar de uma tela. */
  Controlador.prototype.garantir = function (i) {
    if (i < 0 || i >= this.itens.length) return null;
    return this.nos[i] || this.montar(i);
  };

  Controlador.prototype.destruir = function () {
    this.nos = {}; this.fixo = null; this.faixa = null;
    if (this.trilho.parentNode) this.trilho.parentNode.removeChild(this.trilho);
    this.trilho._virt = null;
  };

  /* -----------------------------------------------------------
     API
     ----------------------------------------------------------- */
  var Virt = {

    MARGEM: MARGEM,

    /* Fileira horizontal. `janela` é o elemento com overflow
       escondido; o trilho é criado aqui dentro. */
    fileira: function (janela, itens, desenhar, gap) {
      return new Controlador({ janela: janela, itens: itens,
                               desenhar: desenhar, gap: gap || 0 });
    },

    /* Grade. `colunas` é fixo — em TV a largura não muda no meio
       do uso, então não há motivo para recalcular. */
    grade: function (janela, itens, desenhar, colunas, gap) {
      return new Controlador({ janela: janela, itens: itens, desenhar: desenhar,
                               colunas: colunas, gap: gap || 0 });
    },

    /* Chamado a cada mudança de foco. Sobe até achar o trilho
       virtualizado que contém o elemento, remonta a janela e
       fixa o nó em foco. */
    aoFocar: function (el) {
      var n = el;
      while (n && n !== doc.body) {
        if (n._virt) { n._virt.fixar(el); n._virt.atualizar(); return n._virt; }
        n = n.parentElement;
      }
      return null;
    },

    /* Todos os controladores vivos dentro de uma raiz. */
    dentroDe: function (raiz) {
      return Array.prototype.slice
        .call((raiz || doc).querySelectorAll('.trilho'))
        .map(function (t) { return t._virt; })
        .filter(Boolean);
    }
  };

  w.Virt = Virt;

})(window);
