/* =========================================================
   Configuracoes globais do app.
   Mexa aqui se quiser mudar comportamento sem caçar no codigo.
   ========================================================= */
window.CFG = {
  APP_ID: 'com.gabriel.claudetv',
  VERSION: '1.0.0',

  /* Quando o app roda em http:// (servidor de desenvolvimento no Mac) as
     requisicoes passam por um proxy local, porque o Chrome bloqueia
     chamadas para outro dominio. Na TV o app roda em file:// e vai direto. */
  DEV: location.protocol === 'http:' || location.protocol === 'https:',

  /* Player */
  SAVE_EVERY_MS:      10000,  // grava a posicao a cada 10 segundos
  RESUME_MIN_SEC:     45,     // so pergunta "continuar?" depois de 45s
  RESUME_TAIL_SEC:    90,     // se faltam menos que isso pro fim, recomeça
  COMPLETED_RATIO:    0.93,   // acima disso o item conta como assistido
  SEEK_SMALL_SEC:     10,     // setas esquerda/direita
  SEEK_BIG_SEC:       300,    // setas cima/baixo
  UI_HIDE_MS:         4000,   // tempo ate a barra do player sumir

  /* Catalogo */
  PAGE_SIZE:          90,     // itens renderizados por vez numa grade
  CACHE_TTL_MS:       6 * 60 * 60 * 1000,   // 6 horas
  HISTORY_LIMIT:      60,

  /* Rede */
  REQUEST_TIMEOUT_MS: 20000,
  PREFER_HLS_FOR_LIVE: true   // usa .m3u8 no lugar de .ts nos canais ao vivo
};
