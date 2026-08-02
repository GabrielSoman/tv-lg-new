/* =========================================================
   Navegacao por controle remoto.

   Estrategia hibrida: dentro de um container com eixo definido
   (uma fileira, uma grade, uma coluna de categorias) o movimento
   segue a ordem dos elementos - previsivel e sem surpresas.
   Quando nao ha para onde ir dentro do container, cai para uma
   busca geometrica pela tela inteira, que e o que permite sair
   de uma fileira e chegar no menu lateral, por exemplo.
   ========================================================= */
(function (w) {
  'use strict';

  var current = null;
  var scope = null;          // elemento que limita o foco (dialogos)
  var handlers = [];         // ouvintes extras de tecla

  function focusables() {
    var root = scope || document;
    return w.$$('[data-focusable]', root).filter(function (e) {
      return e.offsetParent !== null || e === current;
    });
  }

  function rect(e) { return e.getBoundingClientRect(); }
  function center(r) { return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }

  /* ---------- Rolagem: move o container, nao a pagina ---------- */
  function scrollers(el) {
    var out = [], n = el.parentElement;
    while (n && n !== document.body) {
      if (n.hasAttribute && n.hasAttribute('data-scroll')) out.push(n);
      n = n.parentElement;
    }
    return out;
  }

  function offsetOf(sc) {
    return { x: Number(sc.getAttribute('data-off-x') || 0),
             y: Number(sc.getAttribute('data-off-y') || 0) };
  }

  function applyOffset(sc, x, y) {
    sc.setAttribute('data-off-x', x);
    sc.setAttribute('data-off-y', y);
    sc.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
  }

  function ensureVisible(el) {
    scrollers(el).forEach(function (sc) {
      var vp = sc.parentElement;
      if (!vp) return;
      var axis = sc.getAttribute('data-scroll');
      var off = offsetOf(sc);
      var er = rect(el), vr = rect(vp);

      if (axis === 'x' || axis === 'xy') {
        var mx = vr.width * 0.08, dx = 0;
        if (er.left  < vr.left  + mx) dx = (vr.left + mx) - er.left;
        else if (er.right > vr.right - mx) dx = (vr.right - mx) - er.right;
        if (dx) {
          var minX = Math.min(0, vp.clientWidth - sc.scrollWidth - 8);
          off.x = Math.max(minX, Math.min(0, off.x + dx));
        }
      }
      if (axis === 'y' || axis === 'xy') {
        var mTop = vr.height * 0.22, mBot = vr.height * 0.26, dy = 0;
        if (er.top < vr.top + mTop) dy = (vr.top + mTop) - er.top;
        else if (er.bottom > vr.bottom - mBot) dy = (vr.bottom - mBot) - er.bottom;
        if (dy) {
          var minY = Math.min(0, vp.clientHeight - sc.scrollHeight - 8);
          off.y = Math.max(minY, Math.min(0, off.y + dy));
        }
      }
      applyOffset(sc, off.x, off.y);
    });
  }

  /* ---------- Container e eixo ---------- */
  function containerOf(el) {
    var n = el.parentElement;
    while (n && n !== document.body) {
      if (n.hasAttribute && n.hasAttribute('data-nav-axis')) return n;
      n = n.parentElement;
    }
    return null;
  }

  function siblingsIn(container) {
    return w.$$('[data-focusable]', container).filter(function (e) {
      return e.offsetParent !== null;
    });
  }

  function stepInContainer(el, dir) {
    var c = containerOf(el);
    if (!c) return null;
    var axis = c.getAttribute('data-nav-axis');
    var list = siblingsIn(c);
    var i = list.indexOf(el);
    if (i < 0) return null;

    if (axis === 'x' && (dir === 'left' || dir === 'right'))
      return list[i + (dir === 'right' ? 1 : -1)] || null;

    if (axis === 'y' && (dir === 'up' || dir === 'down'))
      return list[i + (dir === 'down' ? 1 : -1)] || null;

    if (axis === 'grid') {
      if (dir === 'left' || dir === 'right')
        return list[i + (dir === 'right' ? 1 : -1)] || null;
      /* Cima/baixo numa grade: elemento mais alinhado na linha vizinha. */
      return gridVertical(list, i, dir);
    }
    return null;
  }

  function gridVertical(list, i, dir) {
    var cr = rect(list[i]), cc = center(cr);
    var best = null, bestScore = Infinity;
    for (var k = 0; k < list.length; k++) {
      if (k === i) continue;
      var r = rect(list[k]);
      var sameLine = Math.abs(r.top - cr.top) < cr.height * 0.5;
      if (sameLine) continue;
      if (dir === 'down' && r.top <= cr.top) continue;
      if (dir === 'up'   && r.top >= cr.top) continue;
      var s = Math.abs(r.top - cr.top) * 2 + Math.abs(center(r).x - cc.x);
      if (s < bestScore) { bestScore = s; best = list[k]; }
    }
    return best;
  }

  /* ---------- Busca geometrica global ---------- */
  function geometric(el, dir) {
    var cr = rect(el), cc = center(cr);
    var best = null, bestScore = Infinity;

    focusables().forEach(function (t) {
      if (t === el) return;
      var r = rect(t);
      if (!r.width || !r.height) return;
      var tc = center(r), main, cross;

      if (dir === 'right')      { if (r.left   < cr.right - 2) return; main = r.left - cr.right;   cross = Math.abs(tc.y - cc.y); }
      else if (dir === 'left')  { if (r.right  > cr.left + 2)  return; main = cr.left - r.right;   cross = Math.abs(tc.y - cc.y); }
      else if (dir === 'down')  { if (r.top    < cr.bottom - 2) return; main = r.top - cr.bottom;  cross = Math.abs(tc.x - cc.x); }
      else                      { if (r.bottom > cr.top + 2)   return; main = cr.top - r.bottom;   cross = Math.abs(tc.x - cc.x); }

      var s = Math.max(0, main) + cross * 2.2;
      if (s < bestScore) { bestScore = s; best = t; }
    });
    return best;
  }

  /* ---------- API ---------- */
  w.Nav = {

    focus: function (el, opts) {
      if (!el) return false;
      if (current === el) { ensureVisible(el); return true; }
      if (current) current.classList.remove('focused');
      current = el;
      el.classList.add('focused');
      if (!(opts && opts.noScroll)) ensureVisible(el);
      if (el.tagName === 'INPUT') { try { el.focus(); } catch (e) {} }
      else if (document.activeElement && document.activeElement.blur) {
        try { document.activeElement.blur(); } catch (e) {}
      }
      if (w.Nav.onFocusHook) w.Nav.onFocusHook(el);
      return true;
    },

    current: function () { return current; },

    /* Foca o primeiro elemento disponivel (ou um seletor especifico). */
    focusFirst: function (selector) {
      var list = selector ? w.$$(selector, scope || document) : focusables();
      list = list.filter(function (e) { return e.offsetParent !== null; });
      return w.Nav.focus(list[0]);
    },

    move: function (dir) {
      if (!current || current.offsetParent === null) return w.Nav.focusFirst();
      var next = stepInContainer(current, dir) || geometric(current, dir);
      if (next) { w.Nav.focus(next); return true; }
      return false;
    },

    /* Limita o foco a um pedaco da tela (dialogos, erro do player). */
    setScope: function (root, firstSelector) {
      scope = root || null;
      if (root) {
        if (current) current.classList.remove('focused');
        current = null;
        w.Nav.focusFirst(firstSelector);
      }
    },

    clearScope: function (restoreTo) {
      scope = null;
      if (restoreTo) w.Nav.focus(restoreTo);
    },

    scoped: function () { return scope; },

    /* Zera as rolagens de um container (ao trocar de tela). */
    resetScroll: function (root) {
      w.$$('[data-scroll]', root || document).forEach(function (sc) {
        applyOffset(sc, 0, 0);
      });
    },

    /* Ouvintes extras: recebem (keyCode, event) e devolvem true se trataram. */
    addKeyHandler: function (fn) { handlers.unshift(fn); },
    removeKeyHandler: function (fn) {
      handlers = handlers.filter(function (h) { return h !== fn; });
    }
  };

  /* ---------- Teclado ---------- */
  document.addEventListener('keydown', function (ev) {
    var k = ev.keyCode;

    for (var i = 0; i < handlers.length; i++) {
      if (handlers[i](k, ev) === true) { ev.preventDefault(); return; }
    }

    /* Enquanto digita num campo de texto, as setas pertencem ao campo -
       exceto cima/baixo, que continuam navegando entre os campos. */
    var typing = current && current.tagName === 'INPUT';

    switch (k) {
      case w.KEY.LEFT:  if (typing) return; w.Nav.move('left');  break;
      case w.KEY.RIGHT: if (typing) return; w.Nav.move('right'); break;
      case w.KEY.UP:    w.Nav.move('up');    break;
      case w.KEY.DOWN:  w.Nav.move('down');  break;
      case w.KEY.OK:
        if (current) {
          if (current.tagName === 'INPUT') return;   // deixa o teclado da TV abrir
          current.click();
        }
        break;
      default: return;
    }
    ev.preventDefault();
  }, true);

})(window);
