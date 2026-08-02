/* =========================================================
   Player em tela cheia.

   Ordem de escolha do motor de video:
   1. Se a TV souber tocar o formato nativamente, usa o <video>
      puro - e o caminho com aceleracao de hardware e menos
      travadas na LG.
   2. Se nao souber (caso do Chrome no Mac com HLS), usa hls.js.
   ========================================================= */
(function (w) {
  'use strict';

  var layer, video, ui, spinner, errBox, errMsg;
  var hls = null;
  var item = null;          // item em reproducao
  var queue = [], qIndex = -1;
  var saveTimer = null, hideTimer = null;
  var startAt = 0;          // segundo em que devemos começar
  var seeking = 0;          // acumulador de seek pelas setas
  var seekTimer = null;
  var triedAlternate = false;
  var onClose = null;
  var live = false;

  function init() {
    layer   = w.$('#player-layer');
    video   = w.$('#video');
    ui      = w.$('#player-ui');
    spinner = w.$('#player-spinner');
    errBox  = w.$('#player-error');
    errMsg  = w.$('#pl-error-msg');

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('timeupdate', onTick);
    video.addEventListener('progress', onBuffer);
    video.addEventListener('waiting', function () { spinner.classList.remove('hidden'); });
    video.addEventListener('playing', function () {
      spinner.classList.add('hidden');
      errBox.classList.add('hidden');
    });
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', function () { fail(describeMediaError()); });

    w.$('#pl-retry').addEventListener('click', function () {
      errBox.classList.add('hidden');
      w.Nav.clearScope();
      load(item.url, startAt);
    });
    w.$('#pl-back').addEventListener('click', function () { w.Player.close(); });
  }

  /* ---------------------------------------------------------
     Abertura
     --------------------------------------------------------- */
  function open(target, opts) {
    opts = opts || {};
    if (!layer) init();

    item    = target;
    queue   = opts.queue || [];
    qIndex  = typeof opts.index === 'number' ? opts.index : -1;
    onClose = opts.onClose || null;
    live    = item.kind === 'live';
    triedAlternate = false;

    layer.classList.remove('hidden');
    errBox.classList.add('hidden');
    spinner.classList.remove('hidden');
    ui.classList.remove('hidden', 'fade');

    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !live);
    w.$('#pl-dur').textContent = live ? '' : '00:00';
    w.$('#pl-cur').textContent = '00:00';
    setBar(0, 0);

    w.Nav.addKeyHandler(keys);
    scheduleHide();

    var saved = w.Store.progressOf(item.id);
    var canResume = !live && saved && !saved.completed &&
                    saved.position >= w.CFG.RESUME_MIN_SEC &&
                    (!saved.duration || saved.duration - saved.position > w.CFG.RESUME_TAIL_SEC);

    if (canResume && !opts.forceStart) askResume(saved);
    else load(item.url, opts.startAt || 0);
  }

  function askResume(saved) {
    var overlay = w.$('#resume-layer');
    var prev = w.Nav.current();
    w.$('#resume-desc').textContent =
      w.cleanName(item.title) + (item.subtitle ? ' · ' + item.subtitle : '') +
      ' — você parou em ' + w.fmtTime(saved.position) +
      (saved.duration ? ' de ' + w.fmtTime(saved.duration) : '') + '.';
    overlay.classList.remove('hidden');
    w.Nav.setScope(overlay);

    function done(from) {
      overlay.classList.add('hidden');
      w.Nav.clearScope(prev);
      w.$('#resume-yes').onclick = null;
      w.$('#resume-no').onclick = null;
      load(item.url, from);
    }
    w.$('#resume-yes').onclick = function () { done(Math.max(0, saved.position - 5)); };
    w.$('#resume-no').onclick  = function () { done(0); };
  }

  /* ---------------------------------------------------------
     Carregamento da midia
     --------------------------------------------------------- */
  function nativeCanPlay(url) {
    if (/\.m3u8(\?|$)/i.test(url)) {
      var t = video.canPlayType('application/vnd.apple.mpegurl') ||
              video.canPlayType('application/x-mpegURL');
      return t === 'probably' || t === 'maybe';
    }
    return true;   // mp4/mkv/ts vao direto para o motor da TV
  }

  function load(url, from) {
    startAt = from || 0;
    detach();
    spinner.classList.remove('hidden');

    /* O elemento <video> nao passa por CORS, entao vai sempre direto. */
    var src = url;

    if (nativeCanPlay(url)) {
      video.src = src;
      video.load();
    } else if (w.Hls && w.Hls.isSupported()) {
      hls = new w.Hls({
        maxBufferLength: live ? 12 : 30,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 30000
      });
      hls.on(w.Hls.Events.ERROR, function (e, data) {
        if (!data || !data.fatal) return;
        if (data.type === w.Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
        if (data.type === w.Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        fail('O fluxo de vídeo falhou (' + (data.details || 'erro desconhecido') + ').');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
      video.load();
    }

    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay bloqueado no navegador */ });
    startSaving();
  }

  function detach() {
    stopSaving();
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { video.pause(); } catch (e) {}
    try { video.removeAttribute('src'); video.load(); } catch (e) {}
  }

  /* ---------------------------------------------------------
     Eventos de reproducao
     --------------------------------------------------------- */
  function onMeta() {
    spinner.classList.add('hidden');
    if (startAt > 0 && isFinite(video.duration) && video.duration > startAt) {
      try { video.currentTime = startAt; } catch (e) {}
    }
    if (!live && isFinite(video.duration)) {
      w.$('#pl-dur').textContent = w.fmtTime(video.duration);
    }
  }

  function onTick() {
    if (live || !isFinite(video.duration) || !video.duration) {
      w.$('#pl-cur').textContent = w.fmtTime(video.currentTime);
      return;
    }
    var pct = video.currentTime / video.duration;
    setBar(pct, null);
    w.$('#pl-cur').textContent = w.fmtTime(video.currentTime);
  }

  function onBuffer() {
    if (!video.buffered || !video.buffered.length || !isFinite(video.duration)) return;
    var end = video.buffered.end(video.buffered.length - 1);
    setBar(null, end / video.duration);
  }

  function setBar(fill, buf) {
    if (fill !== null && fill !== undefined)
      w.$('#pl-fill').style.width = Math.min(100, Math.max(0, fill * 100)) + '%';
    if (buf !== null && buf !== undefined)
      w.$('#pl-buf').style.width = Math.min(100, Math.max(0, buf * 100)) + '%';
  }

  function onEnded() {
    save(true);
    if (queue.length && qIndex >= 0 && qIndex + 1 < queue.length) {
      qIndex++;
      var nxt = queue[qIndex];
      w.toast('A seguir: ' + w.cleanName(nxt.title), 3000);
      item = nxt;
      live = nxt.kind === 'live';
      w.$('#pl-title').textContent = w.cleanName(nxt.title);
      w.$('#pl-sub').textContent = nxt.subtitle || '';
      load(nxt.url, 0);
      showUI();
    } else {
      w.Player.close();
    }
  }

  function describeMediaError() {
    var e = video.error;
    if (!e) return 'O vídeo parou sem dizer o motivo.';
    switch (e.code) {
      case 1: return 'A reprodução foi interrompida.';
      case 2: return 'A conexão caiu durante a transmissão.';
      case 3: return 'O arquivo chegou corrompido ou em um formato que a TV não decodifica.';
      case 4: return 'A TV não conseguiu abrir este endereço. Pode ser o formato do stream ou o servidor recusando a conexão.';
      default: return 'Erro de mídia (código ' + e.code + ').';
    }
  }

  function fail(msg) {
    /* Canais ao vivo: tenta o outro formato (.ts <-> .m3u8) antes de desistir. */
    if (live && !triedAlternate && item.streamId && w.Catalog.mode() === 'xtream') {
      triedAlternate = true;
      w.toast('Tentando outro formato deste canal…');
      load(w.Xtream.liveUrlAlt(item.streamId), 0);
      return;
    }
    spinner.classList.add('hidden');
    errMsg.textContent = msg;
    errBox.classList.remove('hidden');
    showUI();
    w.Nav.setScope(errBox);
  }

  /* ---------------------------------------------------------
     Gravacao de progresso
     --------------------------------------------------------- */
  function startSaving() {
    stopSaving();
    saveTimer = setInterval(function () { save(false); }, w.CFG.SAVE_EVERY_MS);
  }
  function stopSaving() { if (saveTimer) { clearInterval(saveTimer); saveTimer = null; } }

  function save(force) {
    if (!item) return;
    var pos = video.currentTime || 0;
    var dur = isFinite(video.duration) ? video.duration : 0;
    if (!force && !live && pos < 5) return;   // ignora os primeiros segundos

    w.Store.saveProgress({
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle || '',
      poster: item.poster || '',
      stream_url: item.url || '',
      position: live ? 0 : pos,
      duration: live ? 0 : dur,
      completed: live ? false : (dur > 0 && pos / dur >= w.CFG.COMPLETED_RATIO),
      series_id: item.seriesId || '',
      series_title: item.seriesTitle || '',
      season: item.season || 0,
      episode: item.episode || 0
    });
  }

  /* ---------------------------------------------------------
     Interface e teclas
     --------------------------------------------------------- */
  function showUI() {
    ui.classList.remove('fade');
    scheduleHide();
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!errBox.classList.contains('hidden')) return;
      ui.classList.add('fade');
    }, w.CFG.UI_HIDE_MS);
  }

  function togglePlay() {
    if (video.paused) { video.play(); w.toast('Reproduzindo'); }
    else { video.pause(); save(true); w.toast('Pausado'); }
    showUI();
  }

  /* Acumula os pulos das setas e aplica uma vez so, para nao
     engasgar o buffer quando se aperta a seta varias vezes. */
  function seekBy(sec) {
    if (live || !isFinite(video.duration) || !video.duration) return;
    seeking += sec;
    var target = Math.max(0, Math.min(video.duration - 1,
                 (video.currentTime || 0) + seeking));
    setBar(target / video.duration, null);
    w.$('#pl-cur').textContent = w.fmtTime(target);
    showUI();

    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () {
      try { video.currentTime = target; } catch (e) {}
      seeking = 0;
    }, 380);
  }

  function keys(k) {
    if (layer.classList.contains('hidden')) return false;
    if (!errBox.classList.contains('hidden')) return false;   // dialogo de erro navega normal
    if (!w.$('#resume-layer').classList.contains('hidden')) return false;

    switch (k) {
      case w.KEY.OK:
      case w.KEY.PLAYPAUSE: togglePlay(); return true;
      case w.KEY.PLAY:  video.play();  showUI(); return true;
      case w.KEY.PAUSE: video.pause(); save(true); showUI(); return true;
      case w.KEY.STOP:
      case w.KEY.BACK:  w.Player.close(); return true;
      case w.KEY.LEFT:  seekBy(-w.CFG.SEEK_SMALL_SEC); return true;
      case w.KEY.RIGHT: seekBy( w.CFG.SEEK_SMALL_SEC); return true;
      case w.KEY.RW:    seekBy(-w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.FF:    seekBy( w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.UP:    seekBy( w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.DOWN:  seekBy(-w.CFG.SEEK_BIG_SEC);   return true;
      case w.KEY.CH_UP:   nextInQueue(1);  return true;
      case w.KEY.CH_DOWN: nextInQueue(-1); return true;
      default: showUI(); return false;
    }
  }

  function nextInQueue(delta) {
    if (!queue.length || qIndex < 0) return;
    var i = qIndex + delta;
    if (i < 0 || i >= queue.length) return;
    save(false);
    qIndex = i;
    item = queue[i];
    live = item.kind === 'live';
    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !live);
    triedAlternate = false;
    load(item.url, 0);
    showUI();
  }

  /* ---------------------------------------------------------
     API publica
     --------------------------------------------------------- */
  w.Player = {
    open: open,
    isOpen: function () { return layer && !layer.classList.contains('hidden'); },

    close: function () {
      if (!layer || layer.classList.contains('hidden')) return;
      save(true);
      detach();
      clearTimeout(hideTimer);
      w.Nav.removeKeyHandler(keys);
      if (w.Nav.scoped() === errBox) w.Nav.clearScope();
      errBox.classList.add('hidden');
      layer.classList.add('hidden');
      var cb = onClose; onClose = null; item = null; queue = []; qIndex = -1;
      if (cb) cb();
    }
  };

})(window);
