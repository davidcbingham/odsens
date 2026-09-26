-- 20260926120000_stats_daily.sql — slice S1.9 (Stats), docs/build/00-build-plan.md "S1.9 — Stats"
-- (AC1 / AC9). One concern (01 INV-06): the `stats_daily` table (data-model §2.9) + RLS
-- (data-model §4 grouped row; 05 T-RLS-107..110), its lookup index and updated_at trigger.
-- One row per (day, metric, source, entity_type, entity_id) — the 04 §3.5 idempotency key of
-- `snapshotStats` (daily 03:00 UTC, service role: `insert … on conflict do update set value =
-- excluded.value`, so two runs on one day leave the same rows). `day` is the UTC calendar date of
-- the run (01 INV-68). Site and channel rows carry the sentinel `entity_id`
-- `00000000-0000-0000-0000-000000000000` (registry "Conventions"); the data-model §2.9 column line
-- says `entity_id uuid null`, but a PK column cannot be NULL, so the column is `not null` and the
-- sentinel IS the site / channel id — ADR-0049 D1. `metric` / `source` / `entity_type` are text with CHECKs
-- on the closed registry lists (like `sync_runs.source`), not enums — later slices add no values
-- without a migration. `value` is bigint (external totals; `views` can pass int4) and never negative.
-- Deltas are computed at read time (`lib/stats.ts`), never stored.
-- created_at/updated_at follow the data-model header convention ("on every table"; 01 INV-97 —
-- composite PK allowed for this table).
-- Additive only: one new table, nothing existing is altered.
-- Idempotent: `if not exists` / `drop … if exists` (policy + trigger guards) throughout.
-- Reversibility: drop table if exists public.stats_daily;

-- ---------------------------------------------------------------------------------------------
-- public.stats_daily — the metric / source / entity_type lists are the registry's ("Conventions":
-- `stats_daily.metric ∈ downloads, direct_downloads_day, views, subs, comments, comments_held,
-- likes, users, reach, mentions, tips`; sources = the 04 §3.5 metric pairs; entity types = the
-- 04 §3.5 groups site / project / video / channel). `users` is an aggregate count only (ADR-0002 #68).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.stats_daily (
  day          date not null,
  metric       text not null
               constraint stats_daily_metric_check check
                 (metric in ('downloads', 'direct_downloads_day', 'views', 'subs', 'comments',
                             'comments_held', 'likes', 'users', 'reach', 'mentions', 'tips')),
  source       text not null
               constraint stats_daily_source_check check
                 (source in ('modrinth', 'curseforge', 'direct', 'odsens', 'youtube', 'kofi')),
  entity_type  text not null
               constraint stats_daily_entity_type_check check
                 (entity_type in ('site', 'project', 'video', 'channel')),
  entity_id    uuid not null,
  value        bigint not null
               constraint stats_daily_value_check check (value >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint stats_daily_pkey primary key (day, metric, source, entity_type, entity_id)
);

comment on table public.stats_daily is
  'One snapshot row per UTC day × metric × source × entity (data-model §2.9; 04 §3.5). Written by snapshotStats (service role, upsert on the PK); site / channel rows use the sentinel entity_id 00000000-0000-0000-0000-000000000000. Admin-only read; deltas are computed at read time.';

-- The reader (`lib/data/stats.ts`) and the per-entity series read one (metric, source, entity_type)
-- newest-first; the PK already serves the upsert and the day-first scans.
create index if not exists stats_daily_metric_entity_day_idx
  on public.stats_daily (metric, source, entity_type, day desc);

-- Privileges + RLS (01 INV-28 — same file as the table). Matrix: 05 T-RLS-107..110 = the
-- `sync_runs` matrix (20260827090400): select admin · insert service only (no insert grant and
-- no insert policy for JWT roles, T-RLS-108 admin = D — rows are only ever written by the job)
-- · update service/admin · delete admin (data-model §4 grouped row). anon gets nothing. Revoke
-- first so the grants below are the whole story — ADR-0049 D2.
revoke all on table public.stats_daily from public, anon, authenticated, service_role;
grant select, update, delete on table public.stats_daily to authenticated;
grant all on table public.stats_daily to service_role;

alter table public.stats_daily enable row level security;

drop policy if exists stats_daily_select_admin on public.stats_daily;
create policy stats_daily_select_admin
  on public.stats_daily
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists stats_daily_update_admin on public.stats_daily;
create policy stats_daily_update_admin
  on public.stats_daily
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists stats_daily_delete_admin on public.stats_daily;
create policy stats_daily_delete_admin
  on public.stats_daily
  for delete
  to authenticated
  using (public.is_admin());

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists stats_daily_set_updated_at on public.stats_daily;
create trigger stats_daily_set_updated_at
  before update on public.stats_daily
  for each row execute function public.set_updated_at();
