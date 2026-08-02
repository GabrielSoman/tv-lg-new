/* =========================================================
   PEÇAS DE INTERFACE
   =========================================================
   O vocabulário visual do app: cartão, fileira, grade, tela
   vazia, tela de erro, esqueleto de carregamento.

   Está separado das telas por um motivo prático: quase todo
   bug de foco e de rolagem que a versão anterior teve nasceu
   de uma fileira montada de um jeito aqui e de outro ali. Com
   uma peça só, corrigir uma vez corrige em todo lugar.

   Duas regras que valem para tudo neste arquivo:

     · nenhuma lista longa é montada inteira — tudo passa pelo
       `virt.js`;

     · nada de conteúdo adulto marcado como assistido, em
       andamento ou recente. A decisão 5 da spec de experiência
       diz que "desbloqueado" é sobre visibilidade, não sobre
       registro. Aqui isso vira código: `marcasDe()` devolve
       vazio para item adulto, sempre.
   ========================================================= */
(function (w) {
  'use strict';

  var doc = w.document;

  /* -----------------------------------------------------------
     Imagens: só carrega quando o cartão é montado
     -----------------------------------------------------------
     Com virtualização isso já é quase automático — o cartão só
     existe perto da tela. O que falta é não deixar uma imagem
     quebrada estragar o cartão: no erro, cai para as iniciais.
     ----------------------------------------------------------- */
  function poster(url, nome, classe) {
    var casca = doc.createElement('div');
    casca.className = 'shell ' + (classe || '');
    if (url) {
      var img = doc.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.onerror = function () {
        img.remove();
        casca.appendChild(iniciais(nome));
      };
      /* Cartaz em pé dentro de moldura deitada.
         -----------------------------------------------------
         Medido no app real: em "continuar assistindo" a moldura
         é 285×160 e quase todos os cartazes chegam 600×900. Com
         `cover`, o que aparece é uma faixa do meio do cartaz —
         sem título, sem rosto, sem nada. O provedor só manda a
         arte deitada em parte do acervo.

         Quando a imagem chega em pé, o cartão passa a mostrá-la
         inteira, centrada, com fundo sólido. Cabe menos, mas o
         que cabe se entende. */
      img.onload = function () {
        if (img.naturalHeight > img.naturalWidth * 1.1) casca.classList.add('retrato');
      };
      img.src = url;
      casca.appendChild(img);
    } else {
      casca.appendChild(iniciais(nome));
    }
    return casca;
  }

  function iniciais(nome) {
    var d = doc.createElement('div');
    d.className = 'card-fallback';
    d.textContent = w.initials ? w.initials(nome || '') : (nome || '?').slice(0, 2);
    return d;
  }

  /* -----------------------------------------------------------
     Marcas na capa
     -----------------------------------------------------------
     Você pediu faixa ou etiqueta em cima da capa do que está
     assistindo ou já assistiu. São três estados, e o quarto —
     adulto — é a ausência deliberada de todos eles.
     ----------------------------------------------------------- */
  function marcasDe(item) {
    if (!item || item.kind === 'live') return null;
    if (w.Catalog && w.Catalog.itemAdulto && w.Catalog.itemAdulto(item)) return null;

    var p = w.Store.progressOf(item.id);
    if (!p) return null;

    var frac = p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
    if (p.completed || frac >= 0.95) return { tipo: 'visto', frac: 1 };

    /* ---------------------------------------------------------
       O limiar de "comecei a assistir"
       ---------------------------------------------------------
       Era só percentual: 2% da duração. Medido no aparelho de
       verdade, isso NUNCA marcava nada — num filme de 2h26, 2%
       são quase 3 minutos, e os registros reais tinham 4, 11,
       16, 31 segundos. A etiqueta existia no código e não
       aparecia na tela por causa de uma conta, não de um bug de
       desenho.

       Agora vale o que vier primeiro: 30 segundos de relógio ou
       2% do filme. Trinta segundos é tempo de já ter passado da
       abertura e ter decidido ficar; abaixo disso foi só espiar.
       --------------------------------------------------------- */
    if (p.position >= 30 || frac > 0.02) {
      return { tipo: 'andamento', frac: Math.max(frac, 0.01), rotulo: p.label || '' };
    }
    return null;
  }

  /* -----------------------------------------------------------
     Cartão
     -----------------------------------------------------------
     `forma` decide a proporção: 'poster' (retrato, filmes e
     séries), 'wide' (paisagem, destaques) e 'logo' (canais).
     ----------------------------------------------------------- */
  function cartao(item, forma, extra) {
    forma = forma || 'poster';
    extra = extra || {};
    var b = doc.createElement('button');
    b.className = 'card card-' + forma;
    b.setAttribute('data-focusable', '');
    b.setAttribute('data-id', item.id);
    b._item = item;

    /* -----------------------------------------------------------
       Fileira numerada
       -----------------------------------------------------------
       O número entra ANTES da capa e vive fora dela: é o desenho
       do "Top 10" que todo mundo reconhece de longe, e é a única
       fileira em que a ordem quer dizer alguma coisa.

       O algarismo tem largura fixa no CSS de propósito. A
       virtualização mede UM cartão para deduzir o passo da
       fileira; se o "1" fosse mais estreito que o "10", todos os
       cartões depois do nono ficariam deslocados — e o defeito só
       apareceria a partir do décimo, que é o pior lugar para um
       defeito aparecer.
       ----------------------------------------------------------- */
    if (extra.rank) b.classList.add('card-rank');

    var casca = poster(item.poster || item.backdrop || '', item.title, '');

    var m = marcasDe(item);
    if (m) {
      if (m.tipo === 'visto') {
        var tag = doc.createElement('span');
        tag.className = 'card-tag visto';
        tag.innerHTML = w.icon('check') + '<span>Assistido</span>';
        casca.appendChild(tag);
      } else {
        var barra = doc.createElement('div');
        barra.className = 'card-progress';
        var i = doc.createElement('i');
        i.style.width = Math.round(m.frac * 100) + '%';
        barra.appendChild(i);
        casca.appendChild(barra);
        var et = doc.createElement('span');
        et.className = 'card-tag andamento';
        et.textContent = m.rotulo ? 'Continuar · ' + m.rotulo : 'Continuar';
        casca.appendChild(et);
      }
    }

    /* Estrela de favorito: sinal de que segurar OK funcionou, e
       de que este canal está na pasta Favoritos. */
    if (w.Store.isFavorite(item.id)) {
      b.classList.add('favorito');
      var fav = doc.createElement('span');
      fav.className = 'card-fav';
      fav.innerHTML = w.icon('star', 'solid');
      casca.appendChild(fav);
    }

    /* Qualidade do canal: útil e barato, sai do próprio nome. */
    if (item.kind === 'live' && item.qualidade) {
      var q = doc.createElement('span');
      q.className = 'card-qual' + (item.travada ? ' travada' : '');
      q.textContent = item.qualidade;
      casca.appendChild(q);
    }

    b.appendChild(casca);

    var meta = doc.createElement('div');
    meta.className = 'card-meta';
    var nome = doc.createElement('div');
    nome.className = 'card-name';
    nome.textContent = item.title || '';
    meta.appendChild(nome);
    if (extra.nota) {
      var nt = doc.createElement('div');
      nt.className = 'card-note';
      nt.textContent = extra.nota;
      meta.appendChild(nt);
    }
    b.appendChild(meta);

    /* A capa e o nome viram uma coluna só, e o algarismo fica ao
       lado dela. Sem este embrulho o cartão é um flex de três
       filhos e o nome vai parar À DIREITA da capa, não embaixo. */
    if (extra.rank) {
      var corpo = doc.createElement('div');
      corpo.appendChild(casca);
      corpo.appendChild(meta);
      var num = doc.createElement('span');
      num.className = 'num';
      num.textContent = String(extra.rank);
      b.appendChild(num);
      b.appendChild(corpo);
    }
    return b;
  }

  /* -----------------------------------------------------------
     Fileira horizontal virtualizada
     -----------------------------------------------------------
     Devolve a <section data-row>, com o controlador pendurado
     em `.ctrl` para quem precisar mexer depois.
     ----------------------------------------------------------- */
  function fileira(titulo, itens, opts) {
    opts = opts || {};
    var sec = doc.createElement('section');
    sec.className = 'row';
    sec.setAttribute('data-row', '');

    if (titulo) {
      var h = doc.createElement('h2');
      h.className = 'row-title';
      h.textContent = titulo;
      if (opts.subtitulo) {
        var s = doc.createElement('span');
        s.className = 'row-sub';
        s.textContent = opts.subtitulo;
        h.appendChild(s);
      }
      sec.appendChild(h);
    }

    var janela = doc.createElement('div');
    janela.className = 'janela fileira forma-' + (opts.forma || 'poster') +
                       (opts.numerada ? ' numerada' : '');
    sec.appendChild(janela);

    /* O controlador precisa da janela já medida, então a fileira
       só é ligada depois de entrar no documento. Quem monta a tela
       chama `UI.ligar(sec)`. */
    sec._ligar = function () {
      sec.ctrl = w.Virt.fileira(janela, itens, function (item, i) {
        var c = cartao(item, opts.forma, {
          nota: opts.nota ? opts.nota(item, i) : '',
          rank: opts.numerada ? (i + 1) : 0
        });
        if (opts.aoAbrir) c.onclick = function () { opts.aoAbrir(item, i); };
        return c;
      }, opts.gap || 16);
    };
    return sec;
  }

  /* -----------------------------------------------------------
     Grade virtualizada
     ----------------------------------------------------------- */
  function grade(itens, opts) {
    opts = opts || {};
    var janela = doc.createElement('div');
    janela.className = 'janela cheia grade forma-' + (opts.forma || 'poster');
    janela._ligar = function () {
      janela.ctrl = w.Virt.grade(janela, itens, function (item, i) {
        var c = cartao(item, opts.forma, { nota: opts.nota ? opts.nota(item, i) : '' });
        if (opts.aoAbrir) c.onclick = function () { opts.aoAbrir(item, i); };
        return c;
      }, opts.colunas || 6, opts.gap || 16);
    };
    return janela;
  }

  /* -----------------------------------------------------------
     Blocos de estado
     ----------------------------------------------------------- */
  function vazio(titulo, texto) {
    var d = doc.createElement('div');
    d.className = 'empty';
    d.innerHTML = '<h2>' + w.esc(titulo) + '</h2>' +
                  (texto ? '<p>' + w.esc(texto) + '</p>' : '');
    return d;
  }

  function erro(e, tentar) {
    var d = doc.createElement('div');
    d.className = 'empty erro';
    d.innerHTML = '<h2>Não consegui carregar</h2>' +
                  '<p>' + w.esc((e && e.message) || String(e || '')) + '</p>';
    if (tentar) {
      var box = doc.createElement('div');
      box.className = 'row-btns';
      box.setAttribute('data-region', 'erro');
      box.setAttribute('data-axis', 'x');
      box.setAttribute('data-enter', 'first');
      var b = doc.createElement('button');
      b.className = 'btn';
      b.setAttribute('data-focusable', '');
      b.textContent = 'Tentar de novo';
      b.onclick = tentar;
      box.appendChild(b);
      d.appendChild(box);
    }
    return d;
  }

  /* Esqueleto: ocupa o espaço certo enquanto a lista não chega,
     para a tela não pular quando ela chegar. */
  function esqueleto(quantos, forma) {
    var sec = doc.createElement('section');
    sec.className = 'row esqueleto';
    var janela = doc.createElement('div');
    janela.className = 'janela fileira forma-' + (forma || 'poster');
    var trilho = doc.createElement('div');
    trilho.className = 'trilho';
    for (var i = 0; i < (quantos || 8); i++) {
      var c = doc.createElement('div');
      c.className = 'card card-' + (forma || 'poster') + ' vazio';
      c.innerHTML = '<div class="shell"></div>';
      trilho.appendChild(c);
    }
    janela.appendChild(trilho);
    sec.appendChild(janela);
    return sec;
  }

  /* -----------------------------------------------------------
     Montagem
     -----------------------------------------------------------
     Tudo o que for virtualizado precisa estar no documento antes
     de ser medido. Esta função percorre o que foi montado e liga
     os controladores na ordem certa.
     ----------------------------------------------------------- */
  function ligar(raiz) {
    if (raiz._ligar) raiz._ligar();
    w.$$('*', raiz).forEach(function (n) { if (n._ligar) n._ligar(); });
  }

  function tela(cls) {
    var s = doc.createElement('div');
    s.className = 'screen enter ' + (cls || '');
    return s;
  }

  /* -----------------------------------------------------------
     Troca o conteúdo do palco — e diz ao menu para onde ir
     -----------------------------------------------------------
     O menu lateral não tem vizinho à direita fixo: depende da
     tela. Sem declarar isso, a seta para a direita não saía do
     menu — o motor procurava `data-nb-right` no `#rail`, não
     achava, e parava na borda. Corretíssimo do ponto de vista
     do algoritmo, e péssimo para quem está com o controle na
     mão.

     Cada tela informa aqui qual é a sua região principal.
     ----------------------------------------------------------- */
  /* Nem tudo o que uma tela cria morre sozinho quando o nó sai do
     documento. O trailer da abertura, por exemplo, é um <iframe>
     do YouTube com um temporizador atrás: remover o nó para o
     vídeo, mas deixa o temporizador vivo para recriar o iframe
     numa tela que já não existe. Quem tem o que desligar pendura
     `_desligar` no próprio nó e isto aqui chama. */
  function desligarTudo(raiz) {
    if (!raiz) return;
    if (raiz._desligar) { try { raiz._desligar(); } catch (e) {} }
    w.$$('*', raiz).forEach(function (n) {
      if (n._desligar) { try { n._desligar(); } catch (e) {} }
    });
  }

  function trocar(elemento, regiaoPrincipal) {
    var palco = w.$('#stage');
    w.Virt.dentroDe(palco).forEach(function (c) { c.destruir(); });
    desligarTudo(palco.firstChild);
    w.clear(palco);
    palco.appendChild(elemento);
    ligar(elemento);
    apontarMenu(regiaoPrincipal);
    return elemento;
  }

  function apontarMenu(regiao) {
    var rail = w.$('#rail');
    if (!rail) return;
    if (regiao) rail.setAttribute('data-nb-right', regiao);
    else rail.removeAttribute('data-nb-right');
  }

  w.UI = {
    cartao: cartao,
    fileira: fileira,
    grade: grade,
    vazio: vazio,
    erro: erro,
    esqueleto: esqueleto,
    tela: tela,
    ligar: ligar,
    desligar: desligarTudo,
    trocar: trocar,
    apontarMenu: apontarMenu,
    marcasDe: marcasDe
  };

})(window);
