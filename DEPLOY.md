# Subir o ClaudeTV na TV

Passo a passo, na ordem. A ordem importa no primeiro item.

## 1. Tirar o app antigo (só uma vez)

O identificador mudou de `com.gabriel.nebula` para `com.gabriel.claudetv`.
Para a TV, são dois aplicativos diferentes — o antigo ficaria lá ocupando
espaço e confundindo.

    npm run tv:remove-antigo

Se responder que não encontrou, tudo bem: significa que já não estava lá.

## 2. Parear a TV (se esta sessão do Modo Desenvolvedor for nova)

    npm run tv:setup      # pede IP, porta 9922 e a chave do Developer Mode
    npm run tv:check      # confirma que responde

## 3. Instalar

    npm run deploy        # empacota, instala e abre na TV

## 4. Acompanhar

    npm run log           # abre a aba de depuração apontando para o app NA TV

É essa aba que mostra erro de verdade. Se algo quebrar no aparelho,
é por aqui que se vê — console, rede e o DOM do app rodando lá.

---

## Antes de publicar no GitHub

    npm run check         # confere que nenhuma credencial entrou nos arquivos versionados
    npm run publish       # build + check + commit + push

O `nebula.config.json` e o `app/defaults.js` estão no `.gitignore`.
O `check` aborta a publicação se algo escapar.

---

## O que a TV precisa saber

- O Modo Desenvolvedor tem sessão de **1000 horas**. Ao expirar, ou se você
  desligar o modo, os apps instalados por ele saem junto. Renovar é abrir o
  Developer Mode na TV e estender.
- A conta do provedor tem `max_connections: 1`: **uma transmissão por vez**.
  Se o app estiver tocando algo, nada mais toca.
- O app se atualiza sozinho pelo GitHub — Ajustes → Procurar atualização.
  Reinstalar pelo `.ipk` só é necessário quando muda algo da casca
  (`app/`), não quando muda tela ou lógica (`src/`).

---

## O que ficou de fora desta versão

Registrado para não virar surpresa:

- **Favoritos e hábito de canal ainda vivem só na TV.** O `schema-v2.sql` já
  está rodado no Supabase, mas o `cloud.js` ainda não escreve nas tabelas
  novas. Reinstalar o app perde essas duas listas. O histórico de filmes e
  séries, esse já sincroniza.
- **Seletor de áudio e legenda no player.** Limitação do Chromium 108:
  `HTMLMediaElement.audioTracks` está desabilitado. Só existe em canal
  `.m3u8` cujas faixas venham declaradas na playlist.
- **EPG (guia de programação).** A lista tem `xmltv`, mas a leitura ainda
  não foi construída.
- **Catch-up.** Medido: os 2.846 canais têm `tv_archive: 0`. O provedor não
  oferece.
