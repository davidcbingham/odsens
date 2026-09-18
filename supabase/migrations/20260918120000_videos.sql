-- 20260918120000_videos.sql — slice S1.6 (Videos), docs/build/00-build-plan.md "S1.6 — Videos".
-- One concern (01 INV-06): the `videos` table (data-model §2.3) + its RLS (data-model §4 row
-- "videos, skins, art"; 05 T-RLS-48..52), newest-first index and updated_at trigger.
-- Written by `syncYoutube` (04 §3.3, service role, upsert key `youtube_id`, never deletes — J-D) and
-- by `updateVideo` (04 §1.8, service role after requireRole('admin')): `hidden` and
-- `is_short_override` are Oliver's and are never part of a sync payload; `is_short` stays the
-- effective flag every reader filters on (02 §2.1 item 4; = coalesce(override, 04 §5.3 heuristic) —
-- ADR-0043 D1). Live/upcoming uploads are never inserted by a keyed sync (ADR-0002 #77; ADR-0043
-- D2); a no-key run cannot tell (D18) — there is no column for live state.
-- `description`, `duration_seconds`, `view_count`, `like_count` are NULL on an RSS-only row
-- (04 §3.3; no YOUTUBE_API_KEY → 05 T-ACT-71) and when `statistics` is missing (05 T-ADP-12).
-- created_at/updated_at follow the data-model header convention ("on every table"; 01 INV-97) even
-- though the §2.3 column row omits them (same as sync_runs).
-- Additive only: one new table, nothing existing is altered.
-- Idempotent: `if not exists` / `drop … if exists` (policy + trigger guards only) throughout.
-- Reversibility: drop table if exists public.videos;

-- ---------------------------------------------------------------------------------------------
-- public.videos — `youtube_id` is the natural key (04 §3.3 idempotency key; `updateVideoInput`
-- regex, 04 §1.8) and carries the non-partial unique PostgREST needs for
-- `.upsert(rows, { onConflict: 'youtube_id' })`. `hidden` / `is_short` have defaults so an
-- RSS-minimal insert is valid; counts are bigint like `mentions.view_count` (data-model §2.3b).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.videos (
  id                uuid primary key default gen_random_uuid(),
  youtube_id        text not null
                    constraint videos_youtube_id_format check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title             text not null,
  description       text,
  thumbnail_url     text not null,
  published_at      timestamptz not null,
  duration_seconds  integer
                    constraint videos_duration_seconds_check check (duration_seconds >= 0),
  is_short          boolean not null default false,
  is_short_override boolean,
  view_count        bigint constraint videos_view_count_check check (view_count >= 0),
  like_count        bigint constraint videos_like_count_check check (like_count >= 0),
  synced_at         timestamptz,
  hidden            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint videos_youtube_id_key unique (youtube_id)
);

comment on table public.videos is
  'YouTube uploads synced hourly (data-model §2.3; 04 §3.3). Public = hidden=false; hidden / is_short_override are admin-owned (04 §1.8).';
comment on column public.videos.is_short_override is
  'Admin override of the 04 §5.3 Shorts heuristic (ADR-0043 D1): NULL = heuristic applies; set/cleared only by updateVideo, never by sync.';

-- Newest-first lists (/videos, Home Latest videos, the /admin videos list).
create index if not exists videos_published_at_idx on public.videos (published_at desc);

-- Privileges + RLS (01 INV-28 — same file as the table). Matrix: 05 T-RLS-48..52 — select
-- hidden=false to all, everything to admin; insert/update/delete admin (direct, unlike sync_runs)
-- and service. Revoke first so the grants below are the whole story.
revoke all on table public.videos from public, anon, authenticated, service_role;
grant select on table public.videos to anon, authenticated;
grant insert, update, delete on table public.videos to authenticated;
grant all on table public.videos to service_role;

alter table public.videos enable row level security;

drop policy if exists videos_select_visible_or_admin on public.videos;
create policy videos_select_visible_or_admin
  on public.videos
  for select
  to anon, authenticated
  using (hidden = false or public.is_admin());

drop policy if exists videos_insert_admin on public.videos;
create policy videos_insert_admin
  on public.videos
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists videos_update_admin on public.videos;
create policy videos_update_admin
  on public.videos
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists videos_delete_admin on public.videos;
create policy videos_delete_admin
  on public.videos
  for delete
  to authenticated
  using (public.is_admin());

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at
  before update on public.videos
  for each row execute function public.set_updated_at();
