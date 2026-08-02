-- =========================================================
-- Nebula — banco de histórico e retomada
--
-- Cole tudo isto no SQL Editor do Supabase e clique em Run.
-- Uma vez só. Depois é só preencher a URL e a chave anon
-- na tela de Ajustes da TV.
-- =========================================================

create table if not exists public.watch_progress (
  id            text        primary key,   -- ex.: 'movie:1234' ou 'ep:98765'
  profile       text        not null default 'gabriel',
  kind          text        not null,      -- live | movie | episode
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

-- Busca rápida do "continuar assistindo" e do histórico.
create index if not exists watch_progress_recent_idx
  on public.watch_progress (profile, updated_at desc);

create index if not exists watch_progress_series_idx
  on public.watch_progress (profile, series_id, updated_at desc);


-- =========================================================
-- Permissões
--
-- A chave anon fica gravada dentro do aplicativo na TV, então
-- qualquer pessoa que abrisse o código veria essa chave. Por
-- isso as regras abaixo liberam SOMENTE esta tabela, e nada
-- mais do projeto. Não guarde nada sensível aqui.
--
-- Se um dia você quiser fechar de verdade, o caminho é ligar
-- autenticação no Supabase e trocar 'anon' por 'authenticated'
-- nas quatro policies.
-- =========================================================

alter table public.watch_progress enable row level security;

drop policy if exists "nebula lê"      on public.watch_progress;
drop policy if exists "nebula insere"  on public.watch_progress;
drop policy if exists "nebula atualiza" on public.watch_progress;
drop policy if exists "nebula apaga"   on public.watch_progress;

create policy "nebula lê"       on public.watch_progress for select to anon using (true);
create policy "nebula insere"   on public.watch_progress for insert to anon with check (true);
create policy "nebula atualiza" on public.watch_progress for update to anon using (true) with check (true);
create policy "nebula apaga"    on public.watch_progress for delete to anon using (true);


-- =========================================================
-- Consultas úteis (opcional, rode quando quiser espiar)
-- =========================================================

-- O que está em andamento agora:
--   select title, subtitle,
--          round(position_sec/60) as minuto_atual,
--          round(duration_sec/60) as duracao_min,
--          updated_at
--     from public.watch_progress
--    where not completed and kind <> 'live'
--    order by updated_at desc;

-- Quanto tempo de tela por mês:
--   select date_trunc('month', updated_at) as mes,
--          round(sum(position_sec)/3600, 1) as horas
--     from public.watch_progress
--    group by 1 order by 1 desc;
