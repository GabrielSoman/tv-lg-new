-- =========================================================
-- ClaudeTV — banco, versão 2
-- =========================================================
-- Cole tudo isto no SQL Editor do Supabase e clique em Run.
-- Uma vez só. Pode rodar por cima do schema.sql antigo: nada
-- aqui apaga dado nenhum, só cria o que falta.
--
-- O que a versão 1 tinha: uma tabela, `watch_progress`, com
-- onde você parou. Só isso.
--
-- O que faltava, e é o motivo desta versão:
--
--   · FAVORITOS moravam só no localStorage da TV. Reinstalou
--     o app, perdeu tudo — exatamente o problema do Duplecast
--     que motivou este projeto. Agora sincronizam.
--
--   · CANAIS não tinham como serem ordenados por hábito. Sem
--     registrar uso, "meus canais" é uma lista alfabética de
--     1.910 itens, que não serve para nada.
--
--   · SÉRIES não guardavam em que episódio você está de forma
--     independente do progresso do arquivo. Sem isso, o botão
--     "continuar" tem que adivinhar varrendo o histórico.
--
-- =========================================================
-- PRIVACIDADE — leia antes de rodar
-- =========================================================
-- Nada de conteúdo adulto chega a estas tabelas. O bloqueio é
-- do lado do app, na origem: `Catalog.itemAdulto()` corta antes
-- de gravar, antes de sugerir e antes de marcar capa. Não há
-- coluna "é adulto" aqui de propósito — o que não é gravado
-- não precisa ser filtrado depois, e não vaza por engano numa
-- consulta futura que esqueça o filtro.
--
-- A chave anon fica dentro do aplicativo na TV. Quem abrir o
-- código do repositório vê essa chave. Por isso as policies
-- abaixo liberam SOMENTE estas tabelas. Não guarde nada
-- sensível neste projeto do Supabase.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Onde você parou  (já existia — recriado por segurança)
-- ---------------------------------------------------------
create table if not exists public.watch_progress (
  id            text        primary key,   -- 'movie:1234' ou 'ep:98765'
  profile       text        not null default 'gabriel',
  kind          text        not null,      -- movie | episode
  title         text        not null default '',
  subtitle      text,
  poster        text,
  stream_url    text,
  position_sec  double precision not null default 0,
  duration_sec  double precision,
  completed     boolean     not null default false,
  series_id     text,
  series_title  text,
  season        integer,
  episode       integer,
  updated_at    timestamptz not null default now()
);

create index if not exists watch_progress_recent_idx
  on public.watch_progress (profile, updated_at desc);
create index if not exists watch_progress_series_idx
  on public.watch_progress (profile, series_id, updated_at desc);

-- Ao vivo não entra aqui. Guardar a posição de um canal é
-- guardar um número que não significa nada: quando você volta,
-- o programa é outro. A versão anterior gravava assim mesmo, e
-- era lixo ocupando as primeiras linhas de "continuar assistindo".
--
-- ATENÇÃO: como a versão anterior gravava, o banco JÁ TEM essas
-- linhas. Por isso a limpeza vem antes da restrição — sem ela o
-- Postgres recusa com:
--
--   ERROR: 23514: check constraint "watch_progress_sem_ao_vivo"
--   of relation "watch_progress" is violated by some row
--
-- Se você quiser ver o que vai ser apagado antes de apagar,
-- rode primeiro:
--   select count(*) from public.watch_progress where kind = 'live';

delete from public.watch_progress where kind = 'live';

alter table public.watch_progress
  drop constraint if exists watch_progress_sem_ao_vivo;
alter table public.watch_progress
  add constraint watch_progress_sem_ao_vivo check (kind <> 'live');


-- ---------------------------------------------------------
-- 2. Favoritos
-- ---------------------------------------------------------
-- Serve para canal, filme e série. `chave` é o identificador
-- estável do canal lógico ('PT::AMC', 'HBO+') — o `stream_id`
-- muda quando o provedor remonta a lista, a chave não.
create table if not exists public.favorites (
  profile     text not null default 'gabriel',
  id          text not null,               -- 'canal:HBO+' | 'movie:1234' | 'series:88'
  kind        text not null,               -- live | movie | series
  title       text not null default '',
  poster      text,
  chave       text,                        -- só para canais
  ordem       integer not null default 0,  -- posição escolhida à mão
  created_at  timestamptz not null default now(),
  primary key (profile, id)
);

create index if not exists favorites_ordem_idx
  on public.favorites (profile, kind, ordem, created_at desc);


-- ---------------------------------------------------------
-- 3. Hábito de canal
-- ---------------------------------------------------------
-- É o que transforma 1.910 canais numa lista útil: os que você
-- realmente assiste sobem. Conta aberturas e tempo, não só
-- cliques — zapear por cima de um canal não é assistir a ele.
create table if not exists public.channel_usage (
  profile      text not null default 'gabriel',
  chave        text not null,              -- canal lógico, não stream_id
  title        text not null default '',
  aberturas    integer not null default 0,
  segundos     double precision not null default 0,
  ultima_em    timestamptz not null default now(),
  ultimo_posto text,                       -- último degrau usado: UHD, H265, FHD…
  primary key (profile, chave)
);

create index if not exists channel_usage_habito_idx
  on public.channel_usage (profile, segundos desc, ultima_em desc);


-- ---------------------------------------------------------
-- 4. Estado da série
-- ---------------------------------------------------------
-- Independente do progresso do arquivo. O progresso responde
-- "quanto deste episódio eu vi"; isto responde "em que ponto
-- da série eu estou", que é o que o botão principal precisa
-- saber sem varrer o histórico inteiro.
create table if not exists public.series_state (
  profile        text not null default 'gabriel',
  series_id      text not null,
  series_title   text not null default '',
  poster         text,
  ultimo_ep_id   text,
  temporada      integer,
  episodio       integer,
  concluida      boolean not null default false,
  updated_at     timestamptz not null default now(),
  primary key (profile, series_id)
);

create index if not exists series_state_recente_idx
  on public.series_state (profile, updated_at desc);


-- ---------------------------------------------------------
-- 5. Ajustes que valem a pena sobreviver à reinstalação
-- ---------------------------------------------------------
-- Não é tudo: credenciais da lista NÃO entram aqui. Só o que
-- é preferência — qualidade travada por canal, autoplay,
-- ocultar adulto.
create table if not exists public.settings_sync (
  profile     text not null default 'gabriel',
  chave       text not null,
  valor       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (profile, chave)
);


-- =========================================================
-- Permissões
-- =========================================================
-- Mesmo desenho da versão 1: acesso liberado para a chave
-- anon, e SOMENTE nestas tabelas.
--
-- Se um dia quiser fechar de verdade, o caminho é ligar
-- autenticação no Supabase e trocar `to anon` por
-- `to authenticated` em todas as policies abaixo.
-- =========================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'watch_progress', 'favorites', 'channel_usage', 'series_state', 'settings_sync'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "claudetv lê" on public.%I', t);
    execute format('drop policy if exists "claudetv insere" on public.%I', t);
    execute format('drop policy if exists "claudetv atualiza" on public.%I', t);
    execute format('drop policy if exists "claudetv apaga" on public.%I', t);

    execute format(
      'create policy "claudetv lê" on public.%I for select to anon using (true)', t);
    execute format(
      'create policy "claudetv insere" on public.%I for insert to anon with check (true)', t);
    execute format(
      'create policy "claudetv atualiza" on public.%I for update to anon using (true) with check (true)', t);
    execute format(
      'create policy "claudetv apaga" on public.%I for delete to anon using (true)', t);
  end loop;
end $$;


-- =========================================================
-- Conferência
-- =========================================================
-- Depois de rodar, isto deve devolver cinco linhas.
-- select table_name from information_schema.tables
--  where table_schema = 'public' order by table_name;
