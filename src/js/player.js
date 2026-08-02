/* =========================================================
   O PLAYER
   =========================================================
   Reescrito para resolver, em ordem, o que você apontou:

     · "ao terminar um episódio de uma série não vai pra
       próxima, simplesmente para tudo";

     · "ao apertar pra baixo no player não tem um menu pra
       pausar/play, voltar ao início, ir para o próximo
       episódio ou o anterior, ver lista de episódios e
       temporadas daquela série ou até idioma";

     · a escada de qualidade dos canais, com as versões
       listadas para você travar uma à mão;

     · o painel de aferição no topo (§4.2-A da spec de
       experiência), que responde "o que está chegando aqui,
       de verdade?".

   ---------------------------------------------------------
   TRÊS DECISÕES QUE VALE LER ANTES DE MEXER

   1. O FIM DO CONTEÚDO É ESTADO DERIVADO, NÃO O EVENTO
      `ended`. O Chromium não emite `ended` de forma confiável
      em stream progressivo — foi por isso que o episódio
      "simplesmente parava". Aqui o fim é uma conta: passou de
      COMPLETED_RATIO da duração E o relógio parou de andar por
      mais de 1,5 s sem estar pausado. O `ended`, quando vem,
      é só mais um gatilho para a mesma conta.

   2. TODA TROCA É FECHAR-E-ABRIR. A conta tem
      `max_connections: 1` — uma transmissão por vez. Não dá
      para pré-carregar o próximo episódio nem a variante de
      qualidade antes de encerrar a atual: o servidor recusaria.
      Por isso `desligar()` é chamado antes de qualquer
      abertura, e não só na saída.

   3. O PAINEL DE AFERIÇÃO SÓ MEDE COM O OSD ABERTO. Fechou,
      o cronômetro para. Durante o filme não existe nada
      contando quadros por trás.
   ========================================================= */
(function (w) {
  'use strict';

  var layer, video, ui, spinner, errBox, errMsg, painel;
  var hls = null;

  var item = null;              /* o que está tocando */
  var fila = [], iFila = -1;    /* episódios da temporada */
  var serie = null;

  var aoVivo = false;
  var grupo = null;             /* canal lógico, com a escada */
  var degraus = [];             /* [{rotulo, fontes:[variante]}] */
  var iDegrau = 0, iFonte = 0;
  var travado = false;          /* qualidade fixada à mão */

  var comecarEm = 0;
  var salvar = null, esconder = null, medidor = null;
  var pulo = 0, relogioPulo = null;
  var arrastando = false, alvoArraste = 0;   /* estado do arraste da timeline */
  var ultimoToque = 0, nivelPasso = 0;
  var aoFechar = null;
  var osdAberto = false;

  /* -----------------------------------------------------------
     Detecção de engasgo — os números e o porquê deles
     -----------------------------------------------------------
     Ficam aqui e não no config.js porque só fazem sentido
     juntos: mexer num sem os outros desregula a escada.
     ----------------------------------------------------------- */
  var JANELA_MS      = 30000;  /* memória da contagem de travadas */
  var TRAVA_TOTAL_MS = 4000;   /* somando mais que isso na janela → age */
  var CARENCIA_MS    = 8000;   /* silêncio no começo: é buffer normal de abertura */
  var INTERVALO_MS   = 20000;  /* nunca troca duas vezes seguidas mais rápido */
  var SUBIR_MS       = 60000;  /* estável por isso → tenta subir um degrau */
  var TETO_ESPERA_MS = 600000; /* recuo progressivo, com teto de 10 min */

  var travadas = [];           /* [{em, ms, aberta}] */
  var abriuEm = 0, trocouEm = 0;
  var esperaSubida = SUBIR_MS;
  var estavelDesde = 0;
  var parouEm = 0, ultimoTempo = -1;

  /* -----------------------------------------------------------
     Montagem
     ----------------------------------------------------------- */
  function iniciar() {
    layer   = w.$('#player-layer');
    video   = w.$('#video');
    ui      = w.$('#player-ui');
    spinner = w.$('#player-spinner');
    errBox  = w.$('#player-error');
    errMsg  = w.$('#pl-error-msg');
    painel  = w.$('#osd-panel');

    video.addEventListener('loadedmetadata', aoTerMeta);
    video.addEventListener('timeupdate', aoAndar);
    video.addEventListener('progress', aoBufferizar);
    video.addEventListener('waiting', comecouAEngasgar);
    video.addEventListener('stalled', comecouAEngasgar);
    video.addEventListener('playing', function () {
      errBox.classList.add('hidden');
      terminouDeEngasgar();
    });
    video.addEventListener('ended', function () { conferirFim(true); });
    video.addEventListener('error', function () { falhar(descreverErro()); });

    w.$('#pl-retry').addEventListener('click', function () {
      errBox.classList.add('hidden');
      w.Nav.limparEscopo();
      abrirFonte(comecarEm);
    });
    w.$('#pl-back').addEventListener('click', function () { w.Player.close(); });

    ligarTransporte();
  }

  /* -----------------------------------------------------------
     Abertura
     ----------------------------------------------------------- */
  function abrir(alvo, opts) {
    opts = opts || {};
    if (!layer) iniciar();

    item     = alvo;
    fila     = opts.queue || [];
    iFila    = typeof opts.index === 'number' ? opts.index : -1;
    serie    = opts.serie || null;
    aoFechar = opts.onClose || null;
    aoVivo   = item.kind === 'live';

    /* A escada só existe para canal, e só quando o item veio do
       catálogo agrupado — um canal achado pela busca também traz
       as variantes, porque é o mesmo objeto. */
    grupo   = aoVivo && item.variantes ? item : null;
    degraus = grupo ? w.Catalog.degraus(grupo) : [];
    travado = !!item.travada;
    iDegrau = degrauDe(item.qualidade);
    iFonte  = 0;
    zerarMedidas();

    layer.classList.remove('hidden');
    errBox.classList.add('hidden');
    spinner.classList.remove('hidden');

    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !aoVivo);
    w.$('#pl-dur').textContent = aoVivo ? '' : '00:00';
    w.$('#pl-cur').textContent = '00:00';
    barra(0, 0);

    /* Ao vivo não grava progresso, mas grava hábito: é o que
       leva os canais que você usa para a frente da lista. */
    if (aoVivo && w.Store.touchChannel) w.Store.touchChannel(item);

    montarContexto();
    fecharOSD();
    ui.classList.remove('hidden', 'fade');
    w.Nav.adicionarTecla(teclas);
    adiarSumico();

    var guardado = w.Store.progressOf(item.id);
    var podeRetomar = !aoVivo && guardado && !guardado.completed &&
      guardado.position >= w.CFG.RESUME_MIN_SEC &&
      (!guardado.duration || guardado.duration - guardado.position > w.CFG.RESUME_TAIL_SEC);

    if (podeRetomar && !opts.forceStart) perguntarRetomada(guardado);
    else abrirFonte(opts.startAt || 0);
  }

  function degrauDe(qualidade) {
    var q = qualidade === '4K' ? 'UHD' : qualidade;
    for (var i = 0; i < degraus.length; i++) if (degraus[i].rotulo === q) return i;
    return 0;
  }

  function perguntarRetomada(guardado) {
    var caixa = w.$('#resume-layer');
    var antes = w.Nav.atual();
    w.$('#resume-desc').textContent =
      w.cleanName(item.title) + (item.subtitle ? ' · ' + item.subtitle : '') +
      ' — você parou em ' + w.fmtTime(guardado.position) +
      (guardado.duration ? ' de ' + w.fmtTime(guardado.duration) : '') + '.';
    caixa.classList.remove('hidden');
    w.Nav.definirEscopo(caixa);

    function fim(de) {
      caixa.classList.add('hidden');
      w.Nav.limparEscopo(antes);
      w.$('#resume-yes').onclick = null;
      w.$('#resume-no').onclick = null;
      abrirFonte(de);
    }
    w.$('#resume-yes').onclick = function () { fim(Math.max(0, guardado.position - 5)); };
    w.$('#resume-no').onclick  = function () { fim(0); };
  }

  /* -----------------------------------------------------------
     Carregamento
     ----------------------------------------------------------- */
  function urlAtual() {
    if (!grupo || !degraus[iDegrau]) return item.url;
    var d = degraus[iDegrau];
    var v = d.fontes[iFonte % d.fontes.length];
    return w.Xtream.urlAoVivo(v.streamId);
  }

  function nativoTocaria(url) {
    if (/\.m3u8(\?|$)/i.test(url)) {
      var t = video.canPlayType('application/vnd.apple.mpegurl') ||
              video.canPlayType('application/x-mpegURL');
      return t === 'probably' || t === 'maybe';
    }
    return true;   /* mp4/mkv/ts vão direto para o motor da TV */
  }

  function abrirFonte(de) {
    comecarEm = de || 0;
    desligar();                      /* max_connections: 1 — sempre fecha antes */
    spinner.classList.remove('hidden');

    var url = urlAtual();

    if (nativoTocaria(url)) {
      video.src = url;
      video.load();
    } else if (w.Hls && w.Hls.isSupported()) {
      hls = new w.Hls({
        maxBufferLength: aoVivo ? 12 : 30,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 15000,
        fragLoadingTimeOut: 30000
      });
      hls.on(w.Hls.Events.ERROR, function (e, d) {
        if (!d || !d.fatal) return;
        if (d.type === w.Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
        if (d.type === w.Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        falhar('O fluxo de vídeo falhou (' + (d.details || 'erro desconhecido') + ').');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
      video.load();
    }

    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay bloqueado no navegador */ });

    abriuEm = Date.now();
    estavelDesde = abriuEm;
    parouEm = 0; ultimoTempo = -1;
    comecarASalvar();
    atualizarContexto();
  }

  /* Encerra de verdade: solta a conexão com o servidor. Com uma
     transmissão por vez, deixar o <video> segurando o socket faz
     a próxima abertura ser recusada. */
  function desligar() {
    pararDeSalvar();
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { video.pause(); } catch (e) {}
    try { video.removeAttribute('src'); video.load(); } catch (e) {}
  }

  /* -----------------------------------------------------------
     Eventos
     ----------------------------------------------------------- */
  function aoTerMeta() {
    spinner.classList.add('hidden');
    if (comecarEm > 0 && isFinite(video.duration) && video.duration > comecarEm) {
      try { video.currentTime = comecarEm; } catch (e) {}
    }
    if (!aoVivo && isFinite(video.duration)) {
      w.$('#pl-dur').textContent = w.fmtTime(video.duration);
    }
  }

  function aoAndar() {
    /* Enquanto você arrasta, quem manda na barra é o arraste.
       Sem esta guarda o `timeupdate` reescrevia a posição a cada
       quarto de segundo e a barra piscava entre onde o vídeo está
       e para onde você está indo — a oscilação que você viu. */
    if (arrastando) { conferirEscada(); return; }

    w.$('#pl-cur').textContent = w.fmtTime(video.currentTime);
    if (!aoVivo && isFinite(video.duration) && video.duration) {
      barra(video.currentTime / video.duration, null);
    }
    julgarSuspeita();
    conferirFim(false);
    conferirEscada();
  }

  function aoBufferizar() {
    if (arrastando) return;
    if (!video.buffered || !video.buffered.length || !isFinite(video.duration)) return;
    var fim = video.buffered.end(video.buffered.length - 1);
    barra(null, fim / video.duration);
  }

  function barra(preenche, buffer) {
    if (preenche != null)
      w.$('#pl-fill').style.width = Math.min(100, Math.max(0, preenche * 100)) + '%';
    if (buffer != null)
      w.$('#pl-buf').style.width = Math.min(100, Math.max(0, buffer * 100)) + '%';
  }

  /* -----------------------------------------------------------
     O FIM DO CONTEÚDO — estado derivado
     -----------------------------------------------------------
     Duas condições, e as duas precisam valer:

       a) já passou de COMPLETED_RATIO da duração;
       b) o relógio parou de andar há mais de 1,5 s sem que o
          vídeo esteja pausado.

     A (a) sozinha não serve: faltando 5% ainda há vídeo. A (b)
     sozinha também não: um engasgo no meio do filme trava o
     relógio e não é fim de nada.

     Juntas, pegam o caso que o `ended` deixava passar — o que
     fazia o episódio "simplesmente parar tudo".
     ----------------------------------------------------------- */
  function conferirFim(veioDoEvento) {
    if (aoVivo || !item) return;
    var dur = isFinite(video.duration) ? video.duration : 0;
    var pos = video.currentTime || 0;
    if (!dur) return;

    var perto = pos / dur >= w.CFG.COMPLETED_RATIO;

    if (!veioDoEvento) {
      if (video.paused) { parouEm = 0; ultimoTempo = pos; return; }
      if (Math.abs(pos - ultimoTempo) < 0.05) {
        if (!parouEm) parouEm = Date.now();
      } else {
        parouEm = 0; ultimoTempo = pos;
      }
      if (!perto || !parouEm || Date.now() - parouEm < 1500) return;
    } else if (!perto) {
      /* `ended` cedo demais é sinal de arquivo truncado, não de
         episódio terminado. Não avança sozinho nisso. */
      return;
    }

    gravar(true);
    proximoDaFila(1, true);
  }

  /* -----------------------------------------------------------
     A ESCADA DE QUALIDADE
     -----------------------------------------------------------
     Regra de descida, na ordem: outra FONTE do mesmo degrau
     primeiro; só quando as fontes acabam é que se perde
     resolução. A sonda mostrou que a lista tem canais com duas
     fontes na mesma qualidade — servidores diferentes — e trocar
     de servidor é a correção mais barata que existe.
     ----------------------------------------------------------- */
  /* -----------------------------------------------------------
     ENGASGO É O RELÓGIO PARADO, NÃO O EVENTO
     -----------------------------------------------------------
     Medido na TV: num canal ao vivo em `.ts`, o `waiting` e o
     `stalled` disparam o tempo todo — a cada reenchimento de
     buffer — mesmo com a imagem perfeita. E o `playing`, que era
     quem apagava o rodinha e fechava a contagem, só volta depois
     de uma pausa de verdade.

     O resultado era o que você viu: a rodinha laranja acesa o
     tempo inteiro, e a escada descendo de FHD até SD sem que
     nada tivesse travado um segundo sequer.

     Agora o evento só ABRE uma suspeita. Ela vira engasgo de
     verdade se o `currentTime` ficar parado mais de 1,2 s. Se o
     relógio andar, a suspeita é descartada e a rodinha apaga.
     ----------------------------------------------------------- */
  var SUSPEITA_MS = 1200;
  var suspeita = null;          /* { em, tempoNoInicio } */

  function comecouAEngasgar() {
    if (suspeita) return;
    suspeita = { em: Date.now(), tempo: video.currentTime || 0 };
  }

  function terminouDeEngasgar() {
    spinner.classList.add('hidden');
    if (suspeita) {
      /* Só vira registro a suspeita CONFIRMADA — aquela em que o
         relógio realmente ficou parado. Uma suspeita que morreu
         porque o vídeo continuou andando não foi travamento
         nenhum, por mais tempo que o evento tenha demorado a ser
         desmentido. */
      if (suspeita.confirmada) {
        travadas.push({ em: suspeita.em, ms: Date.now() - suspeita.em, aberta: false });
      }
      suspeita = null;
    }
  }

  /* Chamado a cada `timeupdate`: é o juiz. */
  function julgarSuspeita() {
    if (!suspeita) { spinner.classList.add('hidden'); return; }
    var agora = Date.now();
    var andou = (video.currentTime || 0) - suspeita.tempo > 0.15;

    if (andou) { terminouDeEngasgar(); return; }
    /* parado de verdade: aí sim confirma e mostra que carrega */
    if (agora - suspeita.em >= SUSPEITA_MS) {
      suspeita.confirmada = true;
      spinner.classList.remove('hidden');
    }
  }
  function zerarMedidas() {
    travadas = []; suspeita = null; trocouEm = 0; esperaSubida = SUBIR_MS;
  }

  function msTravadosNaJanela() {
    var agora = Date.now(), total = 0;
    travadas = travadas.filter(function (t) { return agora - t.em < JANELA_MS; });
    travadas.forEach(function (t) { total += t.ms; });
    /* a suspeita em curso conta enquanto o relógio estiver parado */
    if (suspeita && suspeita.confirmada) total += agora - suspeita.em;
    return total;
  }

  function temOutraFonte() {
    var d = degraus[iDegrau];
    return !!(d && d.fontes.length > 1 && iFonte < d.fontes.length - 1);
  }

  function conferirEscada() {
    if (!aoVivo || travado) return;
    if (degraus.length < 2 && !temOutraFonte()) return;

    var agora = Date.now();
    if (agora - abriuEm < CARENCIA_MS) return;
    if (trocouEm && agora - trocouEm < INTERVALO_MS) return;

    if (msTravadosNaJanela() > TRAVA_TOTAL_MS) {
      estavelDesde = agora;
      if (temOutraFonte()) {
        iFonte++;
        w.toast('Conexão engasgou — tentando outra fonte do mesmo ' +
                degraus[iDegrau].rotulo + '.', 3500);
      } else if (iDegrau < degraus.length - 1) {
        iDegrau++; iFonte = 0;
        w.toast('Conexão engasgou — mudei para ' + degraus[iDegrau].rotulo + '.', 3500);
      } else {
        return;                     /* já está no degrau mais baixo */
      }
      trocouEm = agora;
      travadas = [];
      abrirFonte(0);
      return;
    }

    /* Subir de volta, com recuo progressivo: um canal cronicamente
       instável ficaria pulando de qualidade a cada minuto, e o
       corte da troca incomoda mais que a resolução menor. */
    if (iDegrau > 0 && agora - estavelDesde > esperaSubida) {
      iDegrau--; iFonte = 0;
      estavelDesde = agora; trocouEm = agora;
      esperaSubida = Math.min(TETO_ESPERA_MS, esperaSubida * 3);
      travadas = [];
      abrirFonte(0);
    }
  }

  /* Escolha manual: fixa e desliga o automático até trocar de canal. */
  function fixarDegrau(i) {
    iDegrau = i; iFonte = 0; travado = true;
    zerarMedidas();
    w.toast('Fixado em ' + degraus[i].rotulo + ' até você trocar de canal.', 3500);
    abrirFonte(0);
    atualizarContexto();
  }

  function descreverErro() {
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

  function falhar(msg) {
    /* Antes de mostrar erro, a escada tem uma carta na manga:
       outra fonte, ou um degrau abaixo. */
    if (aoVivo && !travado) {
      if (temOutraFonte()) { iFonte++; abrirFonte(0); return; }
      if (iDegrau < degraus.length - 1) { iDegrau++; iFonte = 0; abrirFonte(0); return; }
    }
    spinner.classList.add('hidden');
    errMsg.textContent = msg;
    errBox.classList.remove('hidden');
    ui.classList.remove('fade');
    w.Nav.definirEscopo(errBox);
  }

  /* -----------------------------------------------------------
     Progresso
     ----------------------------------------------------------- */
  function comecarASalvar() {
    pararDeSalvar();
    salvar = setInterval(function () {
      /* Ao vivo não tem posição para guardar, mas tem TEMPO — e
         é o tempo, não o número de cliques, que separa "eu vejo
         este canal" de "passei por ele zapeando". É a coluna
         `segundos` da tabela `channel_usage`, e sem alguém
         somando aqui ela ficaria zerada para sempre. */
      if (aoVivo) {
        if (!video.paused && w.Store.addChannelSeconds) {
          w.Store.addChannelSeconds(item, w.CFG.SAVE_EVERY_MS / 1000,
            degraus[iDegrau] ? degraus[iDegrau].rotulo : '');
        }
        return;
      }
      gravar(false);
    }, w.CFG.SAVE_EVERY_MS);
  }
  function pararDeSalvar() { if (salvar) { clearInterval(salvar); salvar = null; } }

  function gravar(forcar) {
    if (!item) return;

    /* Ao vivo não tem "onde parei": quando você volta, o programa
       é outro. E conteúdo adulto não é gravado em lugar nenhum —
       nem aqui, nem na nuvem, nem como recente. */
    if (aoVivo) return;
    if (w.Catalog.itemAdulto && w.Catalog.itemAdulto(item)) return;

    var pos = video.currentTime || 0;
    var dur = isFinite(video.duration) ? video.duration : 0;
    if (!forcar && pos < 5) return;

    w.Store.saveProgress({
      id: item.id,
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle || '',
      poster: item.poster || '',
      stream_url: item.url || '',
      position: pos,
      duration: dur,
      completed: dur > 0 && pos / dur >= w.CFG.COMPLETED_RATIO,
      series_id: item.seriesId || (serie && serie.seriesId) || '',
      series_title: item.seriesTitle || (serie && serie.title) || '',
      season: item.temporada || item.season || 0,
      episode: item.episodio || item.episode || 0
    });
  }

  /* -----------------------------------------------------------
     OSD
     -----------------------------------------------------------
     ↑ e ↓ ABREM o menu, sem pausar. Com ele aberto, trocam de
     linha. Era o que faltava: antes ↑/↓ pulavam 5 minutos, e não
     havia como chegar a coisa nenhuma.
     ----------------------------------------------------------- */
  function mostrarOSD() {
    ui.classList.remove('hidden', 'fade');
    adiarSumico();
  }

  function abrirOSD() {
    if (osdAberto) return;
    osdAberto = true;
    ui.classList.remove('hidden', 'fade');
    ui.classList.add('osd-on');
    /* Em filme e episódio o menu abre na LINHA DO TEMPO: é o
       controle mais pedido, e ficar a uma tecla dele seria um
       degrau a mais sem motivo. Ao vivo abre no transporte,
       porque não há linha do tempo para arrastar. */
    w.Nav.entrar(aoVivo ? 'transport' : 'timeline');
    comecarAMedir();
    adiarSumico();
  }

  function fecharOSD() {
    osdAberto = false;
    if (ui) ui.classList.remove('osd-on');
    if (painel) {
      painel.classList.add('hidden');
      painel.removeAttribute('data-region');
    }
    if (ui) ui.classList.remove('com-painel');
    pararDeMedir();
  }

  function adiarSumico() {
    clearTimeout(esconder);
    esconder = setTimeout(function () {
      if (!errBox.classList.contains('hidden')) return;
      if (!painel.classList.contains('hidden')) return;
      ui.classList.add('fade');
      fecharOSD();
    }, w.CFG.UI_HIDE_MS);
  }

  function ligarTransporte() {
    w.$('#osd-restart').onclick = function () { irPara(0); };
    w.$('#osd-back10').onclick  = function () { pularSegundos(-w.CFG.SEEK_SMALL_SEC); };
    w.$('#osd-fwd10').onclick   = function () { pularSegundos(w.CFG.SEEK_SMALL_SEC); };
    w.$('#osd-play').onclick    = alternarPausa;
    w.$('#osd-prev').onclick    = function () { proximoDaFila(-1); };
    w.$('#osd-next').onclick    = function () { proximoDaFila(1); };
  }

  /* Linha de contexto: muda conforme o que está tocando. */
  function montarContexto() {
    var ctx = w.$('#osd-context');
    ctx.innerHTML = '';

    function chip(id, rotulo, ic, acao, ativo) {
      var b = document.createElement('button');
      b.className = 'osd-chip' + (ativo ? ' ativo' : '');
      b.id = id;
      b.setAttribute('data-focusable', '');
      b.innerHTML = (ic ? w.icon(ic) : '') + '<span>' + w.esc(rotulo) + '</span>';
      b.onclick = acao;
      ctx.appendChild(b);
      return b;
    }

    if (aoVivo) {
      /* Os degraus daquele canal, o ativo marcado. Escolher fixa.
         O número entre parênteses é quantas fontes o degrau tem —
         é a informação que explica por que um "UHD" às vezes
         se recupera sozinho sem perder resolução. */
      degraus.forEach(function (d, i) {
        chip('osd-q-' + i,
             d.rotulo + (d.fontes.length > 1 ? ' (' + d.fontes.length + ')' : ''),
             null, function () { fixarDegrau(i); }, i === iDegrau);
      });
      if (degraus.length) {
        chip('osd-auto', travado ? 'Automático desligado' : 'Automático', 'layers',
             function () {
               travado = !travado;
               zerarMedidas();
               w.toast(travado ? 'Qualidade fixa.' : 'Qualidade automática de volta.');
               atualizarContexto();
             }, !travado);
      }
      chip('osd-fav', w.Store.isFavorite(item.id) ? 'Nos favoritos' : 'Favoritar', 'star',
           function () {
             var agora = w.Store.toggleFavorite(item);
             w.toast(agora ? '★ nos favoritos' : 'fora dos favoritos');
             montarContexto();
             w.Nav.entrar('context');
           }, w.Store.isFavorite(item.id));
    } else {
      if (fila.length > 1) chip('osd-eps', 'Episódios', 'list', abrirListaEpisodios);
      var alvoFav = serie || item;
      chip('osd-fav', w.Store.isFavorite(alvoFav.id) ? 'Nos favoritos' : 'Favoritar', 'star',
           function () {
             var agora = w.Store.toggleFavorite(alvoFav);
             w.toast(agora ? '★ nos favoritos' : 'fora dos favoritos');
             montarContexto();
             w.Nav.entrar('context');
           }, w.Store.isFavorite(alvoFav.id));
    }
  }

  function atualizarContexto() {
    if (!aoVivo) return;
    degraus.forEach(function (d, i) {
      var b = w.$('#osd-q-' + i);
      if (b) b.classList.toggle('ativo', i === iDegrau);
    });
    var a = w.$('#osd-auto');
    if (a) {
      a.classList.toggle('ativo', !travado);
      a.querySelector('span').textContent = travado ? 'Automático desligado' : 'Automático';
    }
  }

  /* Painel sobreposto com os episódios. O vídeo continua atrás. */
  /* -----------------------------------------------------------
     Painel de episódios
     -----------------------------------------------------------
     Duas correções em relação à primeira versão, as duas visíveis
     na tela:

       · a lista precisa de TRILHO. Sem um elemento com
         `data-scroll="x"`, o `nav.js` não tem o que deslocar e os
         episódios além do sexto ficavam fora da tela, sem jeito
         de alcançar;

       · e precisa dizer a TEMPORADA. A fila é a temporada inteira
         achatada, então "Episódios" sozinho não localiza ninguém.
     ----------------------------------------------------------- */
  function abrirListaEpisodios() {
    painel.innerHTML = '';

    /* Agrupa a fila por temporada. A fila é a série achatada — sem
       isto ela vira uma tripa única de 60 episódios, que foi o que
       você viu. Com o agrupamento, a lista mostra uma temporada de
       cada vez, e as outras ficam a uma tecla. */
    var porTemp = {}, ordem = [];
    fila.forEach(function (ep, i) {
      var t = ep.temporada || 1;
      if (!porTemp[t]) { porTemp[t] = []; ordem.push(t); }
      porTemp[t].push({ ep: ep, i: i });
    });
    ordem.sort(function (a, b) { return a - b; });
    var atualT = (fila[iFila] && fila[iFila].temporada) || ordem[0] || 1;

    var titulo = document.createElement('h3');
    titulo.textContent = 'Episódios';
    var conta = document.createElement('span');
    conta.className = 'osd-conta';
    conta.textContent = ordem.length > 1
      ? ordem.length + ' temporadas · ' + fila.length + ' episódios'
      : fila.length + ' episódios';
    titulo.appendChild(conta);
    painel.appendChild(titulo);

    /* Linha das temporadas. Só aparece quando há mais de uma —
       um seletor com uma opção só é ruído. */
    var linhaT = document.createElement('div');
    linhaT.className = 'osd-temps';
    if (ordem.length > 1) {
      linhaT.setAttribute('data-region', 'ptemp');
      linhaT.setAttribute('data-axis', 'x');
      linhaT.setAttribute('data-enter', '.osd-temp.ativo');
      linhaT.setAttribute('data-nb-down', 'peps');
      painel.appendChild(linhaT);
    }

    var janela = document.createElement('div');
    janela.className = 'osd-janela';
    janela.setAttribute('data-region', 'peps');
    janela.setAttribute('data-axis', 'x');
    janela.setAttribute('data-enter', '.osd-ep.ativo');
    if (ordem.length > 1) janela.setAttribute('data-nb-up', 'ptemp');
    var trilho = document.createElement('div');
    trilho.className = 'trilho osd-lista';
    trilho.setAttribute('data-scroll', 'x');
    janela.appendChild(trilho);
    painel.appendChild(janela);

    var dica = document.createElement('div');
    dica.className = 'osd-dica';
    dica.innerHTML = '<b>▲</b> volta para o player  ·  <b>OK</b> assiste este episódio';
    painel.appendChild(dica);

    function pintarEpisodios(t) {
      atualT = t;
      Array.prototype.slice.call(linhaT.children).forEach(function (b) {
        b.classList.toggle('ativo', Number(b.getAttribute('data-t')) === t);
      });
      trilho.innerHTML = '';
      (porTemp[t] || []).forEach(function (par) {
        var b = document.createElement('button');
        b.className = 'osd-ep' + (par.i === iFila ? ' ativo' : '');
        b.setAttribute('data-focusable', '');
        b.innerHTML = '<b>T' + (par.ep.temporada || t) + ' E' +
                      (par.ep.episodio || (par.i + 1)) + '</b>' +
                      '<span>' + w.esc(w.cleanName(par.ep.title || '')) + '</span>';
        b.onclick = function () { fecharPainel(); irParaIndice(par.i); };
        trilho.appendChild(b);
      });
    }

    ordem.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'osd-temp';
      b.setAttribute('data-focusable', '');
      b.setAttribute('data-t', t);
      b.textContent = 'T' + t;
      b.onclick = function () { pintarEpisodios(t); w.Nav.entrar('peps'); };
      linhaT.appendChild(b);
    });

    pintarEpisodios(atualT);

    painel.classList.remove('hidden');
    ui.classList.add('com-painel');
    w.Nav.entrar('peps');
    clearTimeout(esconder);
  }

  function fecharPainel() {
    painel.classList.add('hidden');
    ui.classList.remove('com-painel');
    painel.removeAttribute('data-region');
    /* as regiões internas somem com o conteúdo */
    painel.innerHTML = '';
    w.Nav.entrar('context');
    adiarSumico();
  }

  /* -----------------------------------------------------------
     Painel de aferição — §4.2-A
     -----------------------------------------------------------
     1 Hz, e só enquanto o OSD está aberto. Nada de
     requestAnimationFrame: medir não pode competir com decodificar.
     ----------------------------------------------------------- */
  function comecarAMedir() {
    pararDeMedir();
    medir();
    medidor = setInterval(medir, 1000);
  }
  function pararDeMedir() { if (medidor) { clearInterval(medidor); medidor = null; } }

  function medir() {
    if (!item) return;
    var decl = (aoVivo && degraus[iDegrau]) ? degraus[iDegrau].rotulo : (item.qualidade || '');
    var lw = video.videoWidth || 0, lh = video.videoHeight || 0;

    w.$('#afer-decl').textContent = decl ? decl + ' declarado' : 'sem marcador';
    w.$('#afer-real').textContent = lw && lh ? lw + '×' + lh + ' real' : 'medindo…';

    /* A comparação que denuncia canal mentiroso: "UHD" que chega
       abaixo de 1440 linhas não é UHD coisa nenhuma. */
    var prometeuAlto = /UHD|4K|2160/.test(decl);
    w.$('#afer').querySelector('.afer-l1')
      .classList.toggle('mentiu', prometeuAlto && lh > 0 && lh < 1440);

    var d = degraus[iDegrau];
    w.$('#afer-fonte').textContent = (d && d.fontes.length > 1)
      ? 'fonte ' + ((iFonte % d.fontes.length) + 1) + ' de ' + d.fontes.length
      : (travado ? 'fixo' : 'automático');

    var buf = 0;
    try {
      if (video.buffered && video.buffered.length) {
        buf = Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
      }
    } catch (e) {}
    w.$('#afer-buf').textContent = 'buffer ' + Math.round(buf) + 's';

    var q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    var perdidos = q ? q.droppedVideoFrames : (video.webkitDroppedFrameCount || 0);
    var total = q ? q.totalVideoFrames : 0;
    w.$('#afer-quedas').textContent = total
      ? perdidos + ' quedas em ' + total
      : perdidos + ' quedas';
    w.$('#afer').querySelector('.afer-l2')
      .classList.toggle('ruim', total > 0 && perdidos / total > 0.02);

    w.$('#afer-hora').textContent = w.horaAgora();
  }

  /* -----------------------------------------------------------
     Transporte
     ----------------------------------------------------------- */
  function alternarPausa() {
    if (video.paused) video.play();
    else { video.pause(); gravar(true); }
    var b = w.$('#osd-play');
    if (b) b.innerHTML = w.icon(video.paused ? 'play' : 'pause');
    mostrarOSD();
  }

  function irPara(seg) {
    if (aoVivo || !isFinite(video.duration)) return;
    try { video.currentTime = Math.max(0, Math.min(video.duration - 1, seg)); } catch (e) {}
    mostrarOSD();
  }

  /* -----------------------------------------------------------
     ARRASTAR A LINHA DO TEMPO
     -----------------------------------------------------------
     Isto não existia direito, e você sentiu: com o menu aberto,
     ←/→ pertenciam à linha de botões; com ele fechado, davam
     saltos fixos de 10 s que não davam para acompanhar. Não
     havia como percorrer um filme.

     Agora são duas coisas distintas:

       · com a LINHA DO TEMPO em foco, ←/→ arrastam um cursor
         fantasma. O vídeo não sai do lugar enquanto você
         arrasta — só quando você para ou confirma com OK. Isso
         importa muito aqui: cada `currentTime` novo derruba o
         buffer e reabre a conexão, e com `max_connections: 1`
         reabrir dez vezes seguidas é a receita para o servidor
         recusar;

       · o passo ACELERA enquanto você segura. Uma tecla isolada
         anda 10 s; segurando, vira 30, 60, 120 e 300 s. Sem
         isso, atravessar um filme de duas horas custaria 720
         toques.
     ----------------------------------------------------------- */
  var PASSOS = [10, 30, 60, 120, 300];

  function passoAtual() {
    var agora = Date.now();
    /* toques em sequência (menos de 400 ms) sobem o degrau; uma
       pausa devolve o passo curto, que é o de precisão */
    if (agora - ultimoToque < 400) nivelPasso = Math.min(PASSOS.length - 1, nivelPasso + 1);
    else nivelPasso = 0;
    ultimoToque = agora;
    return PASSOS[nivelPasso];
  }

  function arrastar(direcao) {
    if (aoVivo || !isFinite(video.duration) || !video.duration) return;
    if (!arrastando) { arrastando = true; alvoArraste = video.currentTime || 0; }

    var passo = passoAtual();
    alvoArraste = Math.max(0, Math.min(video.duration - 1, alvoArraste + direcao * passo));
    pintarArraste(passo);
    mostrarOSD();

    clearTimeout(relogioPulo);
    relogioPulo = setTimeout(aplicarArraste, 700);
  }

  function pintarArraste(passo) {
    var frac = alvoArraste / video.duration;
    var f = w.$('#pl-fantasma');
    f.classList.remove('hidden');
    f.style.left = Math.min(100, Math.max(0, frac * 100)) + '%';
    f.setAttribute('data-t', w.fmtTime(alvoArraste) +
      (passo > 10 ? '  ·  ' + passo + 's' : ''));
    w.$('#pl-cur').textContent = w.fmtTime(alvoArraste);
    w.$('#pl-bar').classList.add('arrastando');
  }

  function aplicarArraste() {
    if (!arrastando) return;
    arrastando = false;
    nivelPasso = 0;
    clearTimeout(relogioPulo);
    w.$('#pl-fantasma').classList.add('hidden');
    w.$('#pl-bar').classList.remove('arrastando');
    try { video.currentTime = alvoArraste; } catch (e) {}
    barra(alvoArraste / video.duration, null);
  }

  /* Salto rápido, sem entrar no modo de arraste — é o que ←/→
     fazem com o menu fechado. */
  function pularSegundos(seg) {
    if (aoVivo || !isFinite(video.duration) || !video.duration) return;
    pulo += seg;
    var alvo = Math.max(0, Math.min(video.duration - 1, (video.currentTime || 0) + pulo));
    barra(alvo / video.duration, null);
    w.$('#pl-cur').textContent = w.fmtTime(alvo);
    mostrarOSD();

    clearTimeout(relogioPulo);
    relogioPulo = setTimeout(function () {
      try { video.currentTime = alvo; } catch (e) {}
      pulo = 0;
    }, 380);
  }

  function irParaIndice(i) {
    if (i < 0 || i >= fila.length) return;
    gravar(false);
    iFila = i;
    item = fila[i];
    aoVivo = item.kind === 'live';
    w.$('#pl-title').textContent = w.cleanName(item.title);
    w.$('#pl-sub').textContent = item.subtitle || '';
    w.$('#pl-badge').classList.toggle('hidden', !aoVivo);
    montarContexto();
    abrirFonte(0);
    mostrarOSD();
  }

  function proximoDaFila(passo, automatico) {
    if (!fila.length || iFila < 0) { if (automatico) w.Player.close(); return; }
    var i = iFila + passo;
    if (i < 0 || i >= fila.length) { if (automatico) w.Player.close(); return; }
    if (automatico) w.toast('A seguir: ' + w.cleanName(fila[i].title), 4000);
    irParaIndice(i);
  }

  /* -----------------------------------------------------------
     Teclas
     ----------------------------------------------------------- */
  function teclas(k) {
    if (!layer || layer.classList.contains('hidden')) return false;
    if (!errBox.classList.contains('hidden')) return false;
    if (!w.$('#resume-layer').classList.contains('hidden')) return false;

    /* Com o painel de episódios aberto, a navegação é dele. */
    if (!painel.classList.contains('hidden')) {
      /* Sair da lista de episódios: Voltar, ou ↑, que é o
         movimento intuitivo — a lista está por cima do player,
         então subir é sair dela. Sem isto a pessoa ficava presa
         percorrendo episódios sem caminho de volta. */
      if (k === w.KEY.BACK || k === w.KEY.ESC) { fecharPainel(); return true; }

      /* ↑ sobe um nível de cada vez: dos episódios para as
         temporadas, e das temporadas para o player. Se não houver
         seletor de temporada, ↑ já sai direto. */
      if (k === w.KEY.UP) {
        var noTopo = w.Nav.atual() && w.Nav.atual().classList.contains('osd-temp');
        var temSeletor = !!painel.querySelector('.osd-temp');
        if (noTopo || !temSeletor) { fecharPainel(); return true; }
        return false;                       /* nav leva aos botões de temporada */
      }
      adiarSumico();
      return false;
    }

    if (osdAberto) {
      if (k === w.KEY.BACK || k === w.KEY.ESC) {
        if (arrastando) { aplicarArraste(); return true; }
        fecharOSD(); return true;
      }

      /* Com a linha do tempo em foco, ←/→ são dela — não da
         navegação. É o que devolve o controle do filme. */
      var naLinha = w.Nav.atual() && w.Nav.atual().id === 'pl-bar';
      if (naLinha && (k === w.KEY.LEFT || k === w.KEY.RIGHT)) {
        arrastar(k === w.KEY.RIGHT ? 1 : -1);
        return true;
      }
      if (naLinha && k === w.KEY.OK) { aplicarArraste(); return true; }
      if (naLinha && (k === w.KEY.UP || k === w.KEY.DOWN) && arrastando) aplicarArraste();

      if (k === w.KEY.UP || k === w.KEY.DOWN || k === w.KEY.LEFT ||
          k === w.KEY.RIGHT || k === w.KEY.OK) {
        adiarSumico();
        return false;                                   /* navegação normal do OSD */
      }
    } else {
      switch (k) {
        case w.KEY.UP:
        case w.KEY.DOWN: abrirOSD(); return true;        /* ABRE o menu, não pula */
        case w.KEY.OK:
        case w.KEY.PLAYPAUSE: alternarPausa(); return true;
        case w.KEY.LEFT:  pularSegundos(-w.CFG.SEEK_SMALL_SEC); return true;
        case w.KEY.RIGHT: pularSegundos(w.CFG.SEEK_SMALL_SEC);  return true;
        default: break;
      }
    }

    switch (k) {
      case w.KEY.PLAY:  video.play();  mostrarOSD(); return true;
      case w.KEY.PAUSE: video.pause(); gravar(true); mostrarOSD(); return true;
      case w.KEY.STOP:
      case w.KEY.BACK:  w.Player.close(); return true;
      case w.KEY.RW:    pularSegundos(-w.CFG.SEEK_BIG_SEC); return true;
      case w.KEY.FF:    pularSegundos(w.CFG.SEEK_BIG_SEC);  return true;
      case w.KEY.CH_UP:   proximoDaFila(1);  return true;
      case w.KEY.CH_DOWN: proximoDaFila(-1); return true;
      default: mostrarOSD(); return false;
    }
  }

  /* -----------------------------------------------------------
     API
     ----------------------------------------------------------- */
  w.Player = {
    open: abrir,

    /* Booleano de verdade: antes de o player ser usado uma vez,
       `layer` é indefinido e isto devolvia `undefined` — que é
       falso o bastante para um `if`, e veneno para um teste. */
    isOpen: function () { return !!(layer && !layer.classList.contains('hidden')); },

    /* Expostos para o banco de provas dirigir o player sem
       depender de vídeo real tocando em tempo real. */
    _estado: function () {
      return {
        aoVivo: aoVivo, osd: osdAberto, travado: travado,
        degrau: degraus[iDegrau] ? degraus[iDegrau].rotulo : null,
        degraus: degraus.map(function (d) { return d.rotulo; }),
        fontes: degraus[iDegrau] ? degraus[iDegrau].fontes.length : 0,
        iFonte: iFonte, iFila: iFila, titulo: item ? item.title : null
      };
    },
    _engasgar: function (ms) {
      abriuEm = Date.now() - CARENCIA_MS - 1000;
      trocouEm = 0;
      travadas.push({ em: Date.now() - ms, ms: ms, aberta: false });
      conferirEscada();
    },
    _fixar: fixarDegrau,
    _travas: function () {
      return { registradas: travadas.length, suspeitaAberta: !!suspeita,
               msNaJanela: Math.round(msTravadosNaJanela()),
               rodinha: !spinner.classList.contains('hidden') };
    },
    _arraste: function () {
      return { ativo: arrastando, alvo: Math.round(alvoArraste), passo: PASSOS[nivelPasso] };
    },
    _abrirOSD: abrirOSD,

    close: function () {
      if (!layer || layer.classList.contains('hidden')) return;
      if (arrastando) { arrastando = false; }
      gravar(true);
      desligar();
      clearTimeout(esconder);
      fecharOSD();
      w.Nav.removerTecla(teclas);
      if (w.Nav.escopo() === errBox) w.Nav.limparEscopo();
      errBox.classList.add('hidden');
      layer.classList.add('hidden');
      var cb = aoFechar;
      aoFechar = null; item = null; fila = []; iFila = -1; serie = null;
      grupo = null; degraus = []; travado = false;
      if (cb) cb();
    }
  };

})(window);
