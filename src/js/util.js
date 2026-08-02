/* =========================================================
   Utilidades gerais: DOM, tempo, rede, teclas do controle remoto.
   ========================================================= */
(function (w) {
  'use strict';

  /* ---- Teclas do controle remoto da LG ---- */
  w.KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    OK: 13, ENTER: 13,
    BACK: 461, ESC: 27, BACKSPACE: 8,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 179, STOP: 413,
    FF: 417, RW: 412,
    CH_UP: 33, CH_DOWN: 34,
    INFO: 457
  };

  /* ---- DOM ---- */
  w.$  = function (sel, root) { return (root || document).querySelector(sel); };
  w.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  w.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.indexOf('data-') === 0) node.setAttribute(k, v === true ? '' : v);
        else if (k === 'style') node.setAttribute('style', v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  w.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); };

  /* ---- Texto e tempo ---- */
  w.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  w.fmtTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600),
        m = Math.floor((sec % 3600) / 60),
        s = sec % 60,
        p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  };

  w.fmtLeft = function (sec) {
    var m = Math.round(sec / 60);
    if (m < 1) return 'menos de 1 min';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + 'h ' + r + 'min' : h + 'h';
  };

  w.relTime = function (iso) {
    var t = new Date(iso).getTime();
    if (!t) return '';
    var d = (Date.now() - t) / 1000;
    if (d < 60) return 'agora há pouco';
    if (d < 3600) return 'há ' + Math.floor(d / 60) + ' min';
    if (d < 86400) return 'há ' + Math.floor(d / 3600) + 'h';
    if (d < 604800) return 'há ' + Math.floor(d / 86400) + ' dias';
    return new Date(t).toLocaleDateString('pt-BR');
  };

  /* Remove prefixos de país/qualidade comuns em listas IPTV, só para exibição.
     Ex.: "BR| HBO MAX FHD" -> "HBO MAX" */
  w.cleanName = function (name) {
    return String(name || '')
      .replace(/^[A-Z]{2,4}\s*[|:\-]\s*/, '')
      .replace(/\s*\[(FHD|HD|SD|4K|H265|HEVC)\]\s*/gi, ' ')
      .replace(/\s+(FHD|UHD|4K|H265|HEVC)\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim() || String(name || '');
  };

  w.initials = function (name) {
    var parts = w.cleanName(name).split(/[\s\-|]+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  };

  w.debounce = function (fn, ms) {
    var t;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* ---- Rede ---- */

  /* Em desenvolvimento passa pelo proxy local. Na TV vai direto,
     a menos que um proxy tenha sido configurado nos Ajustes - o que
     resolve o caso do servidor da lista recusar a origem da TV. */
  w.viaProxy = function (url) {
    if (w.CFG.DEV) return '/proxy?url=' + encodeURIComponent(url);
    var p = w.Store ? w.Store.get('source.proxy', '') : '';
    if (!p) return url;
    return p + (p.indexOf('?') >= 0 ? '&' : '?') + 'url=' + encodeURIComponent(url);
  };

  w.fetchText = function (url, opts) {
    opts = opts || {};
    var target = opts.raw ? url : w.viaProxy(url);
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try { xhr.abort(); } catch (e) {}
        reject(new Error('Tempo esgotado ao contatar o servidor.'));
      }, opts.timeout || w.CFG.REQUEST_TIMEOUT_MS);

      xhr.open(opts.method || 'GET', target, true);
      if (opts.headers) {
        Object.keys(opts.headers).forEach(function (h) {
          xhr.setRequestHeader(h, opts.headers[h]);
        });
      }
      xhr.onload = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 400) { resolve(xhr.responseText); return; }
        /* O código e o corpo viajam junto com o erro.
           -----------------------------------------------------
           "O servidor respondeu 400." não diz nada a quem está
           olhando a tela, e a diferença entre 4xx e 5xx é o que
           decide se vale a pena tentar de novo: 4xx é uma recusa
           definitiva, 5xx é um tropeço. Sem essa distinção, uma
           linha que o banco NUNCA vai aceitar fica sendo
           reenviada para sempre. */
        var err = new Error('O servidor respondeu ' + xhr.status + '.');
        err.status = xhr.status;
        err.corpo = String(xhr.responseText || '').slice(0, 300);
        reject(err);
      };
      xhr.onerror = function () {
        if (done) return;
        done = true; clearTimeout(timer);
        reject(new Error('Não foi possível alcançar o servidor.'));
      };
      xhr.send(opts.body || null);
    });
  };

  w.fetchJSON = function (url, opts) {
    return w.fetchText(url, opts).then(function (txt) {
      if (!txt || !txt.trim()) return null;
      try { return JSON.parse(txt); }
      catch (e) { throw new Error('O servidor devolveu algo que não é JSON.'); }
    });
  };

  /* ---- Feedback visual ---- */
  var toastTimer;
  w.toast = function (msg, ms) {
    var t = w.$('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  };

  w.boot = function (show, msg) {
    var b = w.$('#boot');
    if (!b) return;
    if (msg) b.querySelector('span').textContent = msg;
    b.classList.toggle('hidden', !show);
  };

})(window);
