/* =========================================================
   CASCA / CARREGADOR
   Este arquivo vai dentro do .ipk e quase nunca muda. Ele:

   1. escolhe qual versao do app carregar (a baixada do GitHub
      ou a copia local que veio no pacote);
   2. injeta o CSS e o JS dessa versao;
   3. desfaz a atualizacao sozinho se a versao nova nao
      conseguir iniciar - assim uma atualizacao ruim nunca
      deixa a TV com um app quebrado;
   4. expõe window.Updater para a tela de Ajustes.

   Só é preciso reinstalar o .ipk se ESTE arquivo mudar.
   ========================================================= */
(function (w) {
  'use strict';

  var K_CUR    = 'nebula.bundle.current';
  var K_PREV   = 'nebula.bundle.previous';
  var K_VERIFY = 'nebula.bundle.verify';
  var K_SET    = 'nebula.settings';
  var FALLBACK_VERSION = '0.0.0-local';

  var rolledBackFrom = null;

  /* ---------- localStorage tolerante a falhas ---------- */
  function lsGet(k, d) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
    catch (e) { return d; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function sub(msg) {
    var n = document.getElementById('shell-sub');
    if (n) n.textContent = msg || '';
  }

  /* ---------- Endereco do pacote no GitHub ---------- */
  function settings() { return lsGet(K_SET, {}) || {}; }

  function updateBase() {
    var s = settings().update || {};
    if (s.customUrl) return String(s.customUrl).replace(/\/+$/, '');
    var repo   = s.repo   || '';
    var branch = s.branch || 'main';
    var dir    = s.dir === undefined ? 'build' : s.dir;
    if (!repo) return null;
    return 'https://raw.githubusercontent.com/' + repo + '/' + branch +
           (dir ? '/' + dir : '');
  }

  function get(url, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest(), done = false;
      var t = setTimeout(function () {
        if (done) return; done = true;
        try { xhr.abort(); } catch (e) {}
        reject(new Error('Tempo esgotado ao falar com o GitHub.'));
      }, timeout || 20000);
      /* O parametro _ derruba o cache do raw.githubusercontent (5 min). */
      var bust = url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now();
      xhr.open('GET', bust, true);
      xhr.onload = function () {
        if (done) return; done = true; clearTimeout(t);
        if (xhr.status >= 200 && xhr.status < 400) resolve(xhr.responseText);
        else reject(new Error('GitHub respondeu ' + xhr.status +
                              (xhr.status === 404 ? ' (arquivo não encontrado nesse caminho).' : '.')));
      };
      xhr.onerror = function () {
        if (done) return; done = true; clearTimeout(t);
        reject(new Error('Não consegui alcançar o GitHub.'));
      };
      xhr.send(null);
    });
  }

  /* ---------- Injecao ---------- */
  function injectCSS(text) {
    var s = document.createElement('style');
    s.id = 'nebula-style';
    s.textContent = text;
    document.head.appendChild(s);
  }
  function injectJS(text, label) {
    var s = document.createElement('script');
    s.setAttribute('data-bundle', label || '');
    s.textContent = text;
    document.head.appendChild(s);
  }
  function injectFileCSS(href) {
    return new Promise(function (resolve, reject) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      l.onload = function () { resolve(); };
      l.onerror = function () { reject(new Error('CSS local não carregou.')); };
      document.head.appendChild(l);
    });
  }
  function injectFileJS(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('JS local não carregou.')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- Reversao automatica ---------- */
  function checkRollback() {
    var pending = lsGet(K_VERIFY, null);
    if (!pending) return;
    /* A versao "pending" foi injetada no boot anterior e o app nunca
       confirmou que subiu. Volta para a anterior. */
    lsDel(K_VERIFY);
    var prev = lsGet(K_PREV, null);
    rolledBackFrom = pending;
    if (prev) { lsSet(K_CUR, prev); lsDel(K_PREV); }
    else lsDel(K_CUR);
  }

  /* ---------- Sequencia de inicializacao ---------- */
  function start() {
    checkRollback();

    var cur = lsGet(K_CUR, null);

    if (cur && cur.js) {
      sub('versão ' + cur.version);
      lsSet(K_VERIFY, cur.version);
      /* Registra a procedencia ANTES de injetar: se o pacote estourar
         durante a propria injecao, o tratador de erro la embaixo ja
         sabe que a culpa e da versao baixada. */
      afterInject(cur.version, 'github');
      try {
        injectCSS(cur.css || '');
        injectJS(cur.js, cur.version);
        return;
      } catch (e) {
        /* Erro de sintaxe: cai para a copia local imediatamente. */
        lsDel(K_VERIFY);
        lsDel(K_CUR);
      }
    }

    loadFallback();
  }

  function loadFallback() {
    sub('usando a cópia que veio no aplicativo');
    afterInject('?', 'local');
    injectFileCSS('fallback/app.css')
      .then(function () { return injectFileJS('fallback/app.js'); })
      .then(function () { afterInject(fallbackVersion(), 'local'); })
      .catch(function (e) {
        var b = document.getElementById('shell-boot');
        if (b) b.innerHTML =
          '<div style="text-align:center;max-width:640px;padding:0 40px">' +
          '<h1 style="font-size:28px;margin-bottom:12px">Não consegui iniciar</h1>' +
          '<p style="color:#8B93A1;line-height:1.6">' + e.message +
          ' Reinstale o aplicativo pelo Mac com <b>npm run deploy</b>.</p></div>';
      });
  }

  function fallbackVersion() {
    return (w.NEBULA_FALLBACK_VERSION || FALLBACK_VERSION);
  }

  function afterInject(version, source) {
    w.Updater.loaded = { version: version, source: source, rolledBackFrom: rolledBackFrom };
    /* A partir daqui quem manda e o app: se ele nao chamar Updater.ok(),
       a marca K_VERIFY continua gravada e o proximo boot desfaz sozinho. */
  }

  /* ---------- API para a tela de Ajustes ---------- */
  w.Updater = {
    loaded: { version: '?', source: '?', rolledBackFrom: null },
    confirmed: false,

    /* Some com a tela de carregamento. O app chama isto assim que
       desenha a primeira tela — antes ainda de a versão ser aprovada. */
    ready: function () {
      var b = document.getElementById('shell-boot');
      if (b && b.parentNode) b.parentNode.removeChild(b);
    },

    /* Aprova a versão. O app só chama isto alguns segundos depois de
       ter subido, então uma versão que quebra no meio do caminho nunca
       chega aqui — e o boot seguinte a desfaz. */
    ok: function () {
      w.Updater.confirmed = true;
      lsDel(K_VERIFY);
      try { sessionStorage.removeItem('nebula.autorecover'); } catch (e) {}
      w.Updater.ready();
    },

    configured: function () { return !!updateBase(); },
    baseUrl: updateBase,

    /* Le o manifest do GitHub e diz se ha versao nova. */
    check: function () {
      var base = updateBase();
      if (!base) return Promise.reject(new Error('Configure o repositório do GitHub nos Ajustes.'));
      return get(base + '/manifest.json').then(function (txt) {
        var m;
        try { m = JSON.parse(txt); }
        catch (e) { throw new Error('O manifest.json do repositório não é um JSON válido.'); }
        if (!m || !m.version) throw new Error('O manifest.json não tem o campo "version".');
        var cur = lsGet(K_CUR, null);
        var currentVersion = cur ? cur.version : fallbackVersion();
        return {
          version: m.version,
          notes: m.notes || '',
          date: m.date || '',
          current: currentVersion,
          isNew: String(m.version) !== String(currentVersion),
          manifest: m
        };
      });
    },

    /* Baixa e guarda a versao nova. Nao recarrega sozinho. */
    install: function (info, onStep) {
      var step = onStep || function () {};
      var base = updateBase();
      if (!base) return Promise.reject(new Error('Repositório não configurado.'));
      var m = (info && info.manifest) || {};
      var jsFile  = m.js  || 'app.js';
      var cssFile = m.css || 'app.css';

      step('Baixando o código…');
      return get(base + '/' + jsFile).then(function (js) {
        if (!js || js.length < 500) throw new Error('O arquivo baixado veio vazio.');
        step('Baixando o visual…');
        return get(base + '/' + cssFile).then(function (css) {
          step('Guardando na TV…');
          var prev = lsGet(K_CUR, null);
          if (prev) lsSet(K_PREV, prev);
          var okSaved = lsSet(K_CUR, {
            version: (info && info.version) || m.version,
            js: js, css: css, at: new Date().toISOString()
          });
          if (!okSaved) throw new Error('Não há espaço para guardar a atualização na TV.');
          return { version: (info && info.version) || m.version };
        });
      });
    },

    /* Volta para a versao anterior guardada. */
    rollback: function () {
      var prev = lsGet(K_PREV, null);
      if (!prev) { lsDel(K_CUR); return false; }
      lsSet(K_CUR, prev);
      lsDel(K_PREV);
      return true;
    },

    /* Apaga o pacote baixado e volta para a copia do .ipk. */
    reset: function () { lsDel(K_CUR); lsDel(K_PREV); lsDel(K_VERIFY); },

    reload: function () { w.location.reload(); },

    hasPrevious: function () { return !!lsGet(K_PREV, null); }
  };

  /* Erro fatal antes da aprovação: recarrega uma vez sozinho, para que
     a reversão automática entre em ação na hora em vez de deixar a tela
     preta até alguém desligar a TV. */
  w.addEventListener('error', function () {
    if (w.Updater.confirmed) return;
    if (w.Updater.loaded.source !== 'github') return;
    var tries = 0;
    try { tries = Number(sessionStorage.getItem('nebula.autorecover') || 0); } catch (e) {}
    if (tries >= 1) return;
    try { sessionStorage.setItem('nebula.autorecover', String(tries + 1)); } catch (e) {}
    sub('a versão nova falhou — voltando para a anterior');
    setTimeout(function () { w.location.reload(); }, 700);
  });

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start);
  else start();

})(window);
