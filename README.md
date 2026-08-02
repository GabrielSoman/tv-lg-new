# Nebula

App de IPTV para a sua LG 50NANO80TSA (webOS 24). Feito para uso pessoal, com
catálogo organizado, retomada de onde você parou guardada na nuvem, e
atualização pelo GitHub — sem pen drive.

---

## O que é cada pasta

| Pasta | O que tem |
|---|---|
| `src/` | **O código que você edita.** JavaScript e CSS do app. |
| `build/` | Gerado por `npm run build`. É o pacote que a TV baixa do GitHub. |
| `app/` | A casca que vira o `.ipk` instalado na TV. Muda quase nunca. |
| `tools/` | Scripts de apoio: build, servidor local, IPTV de mentira, testes. |
| `supabase/` | O SQL do banco de histórico. Roda uma vez e esquece. |

A ideia central: o `.ipk` instalado na TV é **só uma casca**. Ele carrega o
código de verdade de `build/` no seu repositório do GitHub. Então o ciclo do
dia a dia é editar `src/`, dar `git push`, e apertar um botão no controle
remoto. Reinstalar o `.ipk` só é necessário se você mexer em `app/index.html`
ou `app/js/boot.js`.

---

## Parte 1 — Preparar o Mac (uma vez)

Você já tem Node. Na pasta do projeto:

```bash
npm install
```

Isso instala a ferramenta da LG **dentro da pasta**, não no sistema. Nada de
global, nada espalhado pelo Mac. Apagar a pasta apaga tudo.

Confira que funcionou:

```bash
npx ares -V
```

---

## Parte 2 — Ligar o Modo Desenvolvedor na TV (uma vez)

1. Crie uma conta grátis em **https://webostv.developer.lge.com** e confirme o
   e-mail.
2. Na TV, entre na **LG Content Store**, busque por **Developer Mode** e instale.
3. Abra o app **Developer Mode**, faça login com a mesma conta.
4. Ligue **Dev Mode Status** e deixe **Key Server** ligado também.
5. A TV reinicia. Depois de voltar, abra o Developer Mode de novo e anote:
   - o **endereço IP** que aparece na tela;
   - a **Passphrase** (6 caracteres) que aparece quando o Key Server está ligado.

> **A sessão expira, e isso desinstala o app.** A LG é explícita: *"depois que o
> Modo Desenvolvedor é desativado, os apps instalados por ele são
> desinstalados"*. O app Developer Mode mostra um contador; enquanto houver
> tempo, o botão **EXTEND** (com a TV na internet) zera de novo. Se o contador
> chegar ao fim, não dá mais para estender — é preciso entrar de novo e
> reinstalar.
>
> Não é drama: veja a seção **Se a TV desinstalar o app** logo abaixo. Com o
> `nebula.config.json` preenchido, voltar é um comando só e você não perde nada.

---

## Parte 3 — Conectar o Mac na TV (uma vez)

```bash
npx ares-setup-device
```

Escolha **add**, e responda:

- **Device name:** `tv` — importante usar exatamente esse nome, os comandos do
  projeto todos usam `--device tv`.
- **IP address:** o IP que a TV mostrou.
- **Port:** `9922`
- **User:** `prisoner`
- **Authentication:** `password`

Depois pegue a chave da TV (ele pede a passphrase de 6 caracteres):

```bash
npx ares-novacom --device tv --getkey
```

Teste:

```bash
npm run tv:check
```

Se aparecerem informações da TV (inclusive a versão do webOS), está tudo certo.

---

## Parte 4 — Instalar o Nebula

```bash
npm run deploy
```

Esse comando faz três coisas: gera o pacote (`npm run build`), empacota o
`.ipk` e instala na TV, e abre o app. O Nebula aparece na fileira de apps da
TV como qualquer outro.

Para ver os erros de JavaScript enquanto o app roda na TV, com o inspetor do
Chrome apontando para ela:

```bash
npm run log
```

---

## Parte 5 — Configurar dentro do app

Na primeira abertura o app pede o endereço da lista. Cole o mesmo link que
você usava no Duplecast — aquele que começa com `http://` e tem
`username=` e `password=` no meio.

O app tenta primeiro falar com a **API Xtream** do servidor, deduzindo usuário
e senha do próprio link. Quando isso funciona, você ganha o catálogo completo:
categorias separadas, capas, sinopses, temporadas e episódios. Se o servidor
não responder à API, ele cai para a leitura do `.m3u` puro, que funciona, mas
fica mais simples.

---

## Parte 6 — Histórico na nuvem (Supabase)

Isso é o que resolve o problema que você tinha: o ponto de onde você parou
sobrevive a qualquer reinstalação do app.

1. Crie um projeto grátis em **https://supabase.com** (região South America
   deixa mais rápido).
2. No painel, vá em **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e
   clique em **Run**. Uma vez só.
3. Vá em **Project Settings → API** e copie duas coisas: a **Project URL** e a
   chave **anon public**.
4. Na TV: **Ajustes → Histórico na nuvem**, cole as duas, e aperte
   **Salvar e testar**.

Sobre segurança, sem enrolação: a chave anon fica gravada dentro do app na TV,
e o `schema.sql` libera leitura e escrita nessa tabela para quem tiver a chave.
Como lá só ficam títulos e minutagens suas, o risco é baixo — mas não use esse
projeto do Supabase para mais nada.

---

## Parte 7 — Atualizar pelo GitHub (o motivo de tudo isso)

**Preparar, uma vez:**

1. Crie um repositório **público** no GitHub, por exemplo `nebula-tv`.
   Precisa ser público: a TV baixa o arquivo sem autenticação nenhuma.
2. No Mac, dentro da pasta do projeto:

   ```bash
   git init
   git add -A
   git commit -m "primeira versao"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/nebula-tv.git
   git push -u origin main
   ```

3. Na TV: **Ajustes → Atualizar pelo GitHub**, preencha o **Repositório** com
   `SEU-USUARIO/nebula-tv`, deixe o ramo em `main` e a pasta em `build`, e
   aperte **Salvar endereço**.

**No dia a dia:**

```bash
# edite o que quiser dentro de src/
npm run publish
```

O `publish` gera o pacote, comita e envia. Na TV, vá em **Ajustes → Procurar
atualização → Instalar e reiniciar**. Uns dez segundos e a TV já está rodando
o código novo.

**O que acontece se você publicar algo quebrado.** Antes de carregar uma versão
nova, a casca marca "estou testando a versão X". O app, quando termina de
iniciar sem erro, apaga essa marca. Se a versão nova travar antes disso, na
próxima abertura a casca vê a marca pendente e volta sozinha para a versão
anterior. E se nem a anterior existir, ela usa a cópia que veio dentro do
`.ipk`. Na prática: dá para publicar sem medo, porque a TV não fica inutilizável.

Se quiser voltar de propósito, tem o botão **Voltar à versão anterior** nos
mesmos Ajustes.

---

## Se a TV desinstalar o app

Acontece quando o Modo Desenvolvedor é desligado ou quando o contador de sessão
acaba. O app some da TV e leva junto tudo o que estava gravado nele: os ajustes,
os favoritos, o histórico local e o pacote baixado do GitHub.

**O que não se perde:** o histórico e os pontos de onde você parou, porque eles
estão no Supabase. E o código, que está no seu repositório.

**Para não ter que digitar nada no controle quando isso acontecer**, preencha
uma vez o arquivo de credenciais no Mac:

```bash
cp nebula.config.example.json nebula.config.json
# abra e preencha com o link da sua lista, a URL e a chave do Supabase,
# e o seu repositório do GitHub
```

Esse arquivo está no `.gitignore` — ele nunca vai para o GitHub. Mas o
`npm run build` o embute dentro do `.ipk`. Resultado: depois de reativar o
Modo Desenvolvedor e rodar

```bash
npm run deploy
```

o Nebula abre já conectado na sua lista, já ligado no Supabase, e puxa o
histórico de volta sozinho — você cai direto em "Continuar assistindo", no
mesmo minuto de onde tinha parado. Sem teclado na tela, sem nada.

Para adiar o problema, o hábito que resolve é abrir o app **Developer Mode** na
TV de vez em quando e apertar **EXTEND**. Leva dois segundos e não mexe em nada
do que está instalado.

---

## Credenciais e o GitHub

Duas coisas nunca podem entrar no repositório público: a chave do Supabase e
o link da sua lista (que carrega usuário e senha dentro dele). Ambas moram em
`nebula.config.json`, que está no `.gitignore`.

Cuidado com o arquivo **`app/defaults.js`**: ele é gerado a cada `npm run build`
a partir do `nebula.config.json` e contém as mesmas credenciais. Também está no
`.gitignore` — se por algum motivo ele voltar a ser rastreado, rode
`git rm --cached app/defaults.js`.

Como rede de proteção, o `npm run publish` roda um verificador antes de qualquer
push. Ele vasculha os arquivos versionados atrás de chaves do Supabase e senhas
em URLs, e **cancela o publish** se achar alguma. Para conferir a qualquer
momento:

```bash
npm run check
```

**Se uma chave já foi parar no histórico**, apagar o arquivo num commit novo não
resolve — ela continua nos commits antigos. O caminho confiável, num repositório
pessoal sem forks, é apagar o repositório no GitHub e criar outro do zero (veja
abaixo). E, em qualquer caso, troque a chave no Supabase: uma chave que ficou
pública deve ser considerada queimada, mesmo que ninguém a tenha visto.

```bash
# recomeçar o histórico do zero, mantendo os arquivos como estão
rm -rf .git
git init && git add -A && git commit -m "primeira versao"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/NOVO-REPO.git
git push -u origin main
```

Depois é só corrigir o nome do repositório em **Ajustes → Atualizar pelo GitHub**
na TV.

---

## Desenvolver sem ficar mandando pra TV

```bash
node tools/mock-iptv.js    # catálogo de mentira, num terminal
npm run dev                # servidor do app, em outro terminal
```

Abra **http://localhost:8088** no Chrome. As setas do teclado funcionam como
o controle remoto, Enter é o OK e Backspace é o Voltar. Nesse modo o app
carrega os arquivos de `src/` direto, então recarregar a página já mostra a
mudança — sem build, sem TV.

Para testar com a sua lista de verdade no navegador, use o mesmo endereço; o
servidor de desenvolvimento já tem um proxy embutido que contorna o bloqueio
do Chrome.

Tem também um teste automático que abre o app num navegador sem janela,
percorre todas as telas, confere que o progresso é gravado e tira prints em
`shots/`:

```bash
node tools/smoke.js
```

---

## Se a TV não conectar na lista (mas o navegador conectar)

Esse é o único ponto onde a TV pode ser mais chata que o Mac. O app instalado
localmente não tem uma "origem" de verdade, e alguns servidores de IPTV
recusam a leitura da resposta por causa disso. O vídeo em si **não** é
afetado — só o catálogo em JSON.

A solução é um proxy próprio, gratuito, que leva uns cinco minutos: o arquivo
`tools/cloudflare-worker.js` tem o código pronto e o passo a passo comentado no
topo. Depois de publicar o worker, cole o endereço dele no campo **Proxy** em
**Ajustes → Lista de canais** e aperte **Reconectar**.

Faça isso só se precisar. Comece sem proxy.

---

## Controle remoto

| Tecla | Onde | O que faz |
|---|---|---|
| Setas | tudo | Navega |
| OK | tudo | Seleciona · no player, pausa |
| Voltar | tudo | Volta uma tela · no player, sai |
| ◀ ▶ | player | 10 segundos |
| ▲ ▼ | player | 5 minutos |
| CH +/− | player | Episódio seguinte / anterior |
| Vermelho | app | Buscar |
| Verde | app | Ao Vivo |
| Amarelo | app | Filmes |
| Azul | app | Ajustes |

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run build` | Gera `build/` a partir de `src/` |
| `npm run publish` | Build + verificação de credenciais + commit + push (dia a dia) |
| `npm run check` | Só a verificação de credenciais nos arquivos versionados |
| `npm run dev` | Servidor local em http://localhost:8088 |
| `npm run deploy` | Empacota e instala o `.ipk` na TV |
| `npm run launch` | Abre o app na TV |
| `npm run close` | Fecha o app na TV |
| `npm run log` | Abre o inspetor do Chrome apontado para a TV |
| `npm run remove` | Desinstala o app da TV |
| `npm run tv:check` | Mostra informações da TV conectada |

---

## Onde mexer para mudar as coisas

| Quero mudar | Arquivo |
|---|---|
| Cores, tamanhos, animações | `src/css/style.css` — as variáveis estão no topo |
| Telas e layout | `src/js/views.js` |
| Comportamento do player | `src/js/player.js` |
| Navegação pelo controle | `src/js/nav.js` |
| Tempos, limites, quantidades | `src/js/config.js` |
| Nome e ícone do app | `app/appinfo.json` e `tools/make-assets.py` |

Se criar um arquivo novo em `src/js/`, adicione o nome dele em
`tools/files.js` — é a lista que define a ordem do build.
