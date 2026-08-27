-- 20260827090400_sync_runs.sql — slice S1.2 (Projects, synced), docs/build/00-build-plan.md
-- "S1.2 — Projects (synced)". One concern (01 INV-06): `sync_runs` (data-model §2.9) — one row per
-- job invocation (04 SC-11: insert {source, started_at} at start; update {finished_at, ok, items,
-- error} at end), read by admin `SyncStatus` and the SC-13 concurrency lock (`finished_at IS NULL`).
-- created_at/updated_at follow the data-model header convention ("on every table") even though the
-- §2.9 column row omits them.
-- Idempotent: `if not exists` / `drop … if exists` throughout.
-- Reversibility: drop table if exists public.sync_runs;

-- ---------------------------------------------------------------------------------------------
-- public.sync_runs — `source` is text with a CHECK on the closed registry list (registry "Jobs":
-- `sync_runs.source ∈ modrinth, curseforge, youtube, mentions, stats, notify, skins`), not an enum —
-- later slices add no values. `finished_at`/`ok`/`items` stay NULL while a run is in flight (SC-11
-- two-step write; SC-13 lock predicate); `error` ≤ 2000 chars is enforced job-side (SC-11).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null
              constraint sync_runs_source_check check
                (source in ('modrinth', 'curseforge', 'youtube', 'mentions', 'stats', 'notify', 'skins')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  items       integer,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.sync_runs is
  'One row per job invocation (data-model §2.9; 04 SC-11/SC-13). Admin-only read; written by jobs (service role).';

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-111..114 — select admin · insert service only
-- (no insert grant/policy for JWT roles, T-RLS-112 admin = D) · update service/admin · delete admin
-- (data-model §4 grouped row). anon gets nothing.
revoke all on table public.sync_runs from public, anon, authenticated, service_role;
grant select, update, delete on table public.sync_runs to authenticated;
grant all on table public.sync_runs to service_role;

alter table public.sync_runs enable row level security;

drop policy if exists sync_runs_select_admin on public.sync_runs;
create policy sync_runs_select_admin
  on public.sync_runs
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists sync_runs_update_admin on public.sync_runs;
create policy sync_runs_update_admin
  on public.sync_runs
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists sync_runs_delete_admin on public.sync_runs;
create policy sync_runs_delete_admin
  on public.sync_runs
  for delete
  to authenticated
  using (public.is_admin());

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists sync_runs_set_updated_at on public.sync_runs;
create trigger sync_runs_set_updated_at
  before update on public.sync_runs
  for each row execute function public.set_updated_at();
