-- ============================================================
-- LOCKOUT — Supabase setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  host_id        uuid not null,
  status         text not null default 'lobby' check (status in ('lobby','active','finished')),
  settings       jsonb not null default '{}'::jsonb,
  challenges     jsonb not null default '[]'::jsonb,
  team_names     jsonb not null default '[]'::jsonb,
  board          jsonb,
  started_at     timestamptz,
  ends_at        timestamptz,
  pending_winner int,
  pending_reason text,
  finalize_at    timestamptz,
  winner         int,
  end_reason     text,
  finished_at    timestamptz,
  next_code      text,
  created_at     timestamptz not null default now()
);

create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  client_id  uuid not null,
  name       text not null,
  team       int,
  created_at timestamptz not null default now(),
  unique (game_id, client_id)
);
create unique index if not exists players_unique_name on public.players (game_id, lower(name));

create table if not exists public.submissions (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  square     int not null,
  team       int not null,
  player_id  uuid references public.players(id) on delete set null,
  video_path text,
  thumb_path text,
  status     text not null default 'active' check (status in ('active','rejected')),
  created_at timestamptz not null default now()
);
-- Lockout rule: only one live claim per square.
create unique index if not exists submissions_one_owner on public.submissions (game_id, square) where status = 'active';
create index if not exists submissions_game on public.submissions (game_id);

create table if not exists public.contests (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  opened_by     uuid references public.players(id) on delete set null,
  reason        text,
  status        text not null default 'open' check (status in ('open','upheld','rejected')),
  resolved_by   text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists contests_game on public.contests (game_id);

create table if not exists public.votes (
  contest_id uuid not null references public.contests(id) on delete cascade,
  game_id    uuid not null references public.games(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  legit      boolean not null,
  created_at timestamptz not null default now(),
  primary key (contest_id, player_id)
);
create index if not exists votes_game on public.votes (game_id);

-- ---------- Access (friends-only game: anyone with the app can play) ----------

do $$
declare t text;
begin
  foreach t in array array['games','players','submissions','contests','votes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lockout_all" on public.%I', t);
    execute format('create policy "lockout_all" on public.%I for all to anon, authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- ---------- Live updates ----------

do $$
declare t text;
begin
  foreach t in array array['games','players','submissions','contests','votes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Video storage ----------

insert into storage.buckets (id, name, public, file_size_limit)
values ('clips', 'clips', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit;

drop policy if exists "lockout clips upload" on storage.objects;
create policy "lockout clips upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'clips');

drop policy if exists "lockout clips read" on storage.objects;
create policy "lockout clips read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'clips');

select 'Lockout is set up ✅' as result;
