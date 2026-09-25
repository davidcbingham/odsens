-- 20260919120000_mentions.sql — slice S1.8 (Seen on), docs/build/00-build-plan.md "S1.8 — Seen on".
-- One concern (01 INV-06): the `mentions` table (data-model §2.3b) + its three enums, RLS
-- (data-model §4 row "mentions"; 05 T-RLS-102..106), FK / newest-first indexes and updated_at trigger.
-- Written by `createMention` / `updateMention` (04 §1.6, service role after requireRole('admin') —
-- ADR-0002 C7; `source='manual'`, `created_by` = the admin) and by `refreshMentions` (04 §3.4,
-- service role, hourly: `view_count` only, for `platform='youtube'` rows with an `external_id` and
-- `status in ('draft','published')`; never deletes — 01 INV-24 / 04 J-D). `status='suggested'` +
-- `source='auto'` are reserved for the v1.5 discovery job (S2.4) — nothing in S1.8 writes them.
-- `project_id` NULL = "About OddSense generally" (data-model §2.3b). The FK is `on delete set null`
-- (ADR-0045): a mention is never deleted with its project (INV-24); `fold_project` re-parents
-- the duplicate's mentions before it deletes the row (20260919120200).
-- created_at/updated_at follow the data-model header convention ("on every table"; 01 INV-97) even
-- though the §2.3b column row omits `updated_at` (same as `videos` — ADR-0043 D20; ADR-0045).
-- Additive only: three new enums + one new table, nothing existing is altered.
-- Idempotent: `duplicate_object` guards on the enums; `if not exists` / `drop … if exists` (policy +
-- trigger guards only) throughout.
-- Reversibility: drop table if exists public.mentions;
--   drop type if exists public.mention_source, public.mention_status, public.mention_platform;

-- ---------------------------------------------------------------------------------------------
-- Enums (data-model §2.3b: platform / status / source are enums; naming = the house
-- `<entity>_<column>` convention — `project_source`, `comment_status`, `link_platform`).
-- `mention_platform` = `createMentionInput.platform` (04 §1.6) = `detectPlatform` (04 §4).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.mention_platform as enum
    ('youtube', 'tiktok', 'twitch', 'reddit', 'article', 'other');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mention_status as enum ('draft', 'suggested', 'published', 'hidden');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mention_source as enum ('manual', 'auto');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.mentions — `url` is the natural key: `createMention` canonicalises it first (04 §1.6 —
-- tracking params stripped, YouTube → the watch form, http upgraded) and maps the plain unique's
-- 23505 to `conflict`. The CHECKs mirror `createMentionInput` (url https ≤ 2048, external_id ≤ 64,
-- title 1..200, creator_name 1..80, view_count ≥ 0); `char_length` counts code points and zod counts
-- UTF-16 units, so the table never rejects what the schema accepted. A YouTube `external_id` is the
-- 11-char video id `refreshMentions` puts in `videos?id=…` (same regex as
-- `videos_youtube_id_format`); it may be NULL (04 §3.4 skips those rows). `status` / `source` /
-- `featured` / `sort_order` have defaults so a minimal insert is a manual draft; `view_count` is
-- bigint like `videos.view_count` and NULL when the platform gives none. `created_by` is nullable
-- (`on delete set null` — every nullable profile FK in the schema; S2.4 auto rows have no creator).
-- Creator data = public channel name + link only (00 S1.8.AC11) — no other creator column.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.mentions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects (id) on delete set null,
  platform      public.mention_platform not null,
  url           text not null
                constraint mentions_url_format check (url ~ '^https://' and char_length(url) <= 2048),
  external_id   text
                constraint mentions_external_id_length check (char_length(external_id) between 1 and 64),
  title         text not null
                constraint mentions_title_length check (char_length(title) between 1 and 200),
  creator_name  text not null
                constraint mentions_creator_name_length check (char_length(creator_name) between 1 and 80),
  creator_url   text,
  thumbnail_url text,
  published_at  timestamptz,
  view_count    bigint constraint mentions_view_count_check check (view_count >= 0),
  status        public.mention_status not null default 'draft',
  source        public.mention_source not null default 'manual',
  featured      boolean not null default false,
  sort_order    integer not null default 0,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint mentions_url_key unique (url),
  constraint mentions_youtube_external_id_format check
    (platform <> 'youtube' or external_id is null or external_id ~ '^[A-Za-z0-9_-]{11}$')
);

comment on table public.mentions is
  'Third-party coverage curated by the admin (data-model §2.3b; 04 §1.6). Public = status=published; draft / suggested / hidden are admin-only. project_id NULL = about OddSense generally. view_count refreshed hourly for YouTube rows (04 §3.4).';
comment on column public.mentions.external_id is
  'Platform-native id; for platform=youtube the 11-char video id refreshMentions sends to the Data API (04 §3.4). NULL = never refreshed.';
comment on column public.mentions.sort_order is
  'Order of the featured mentions on the Home IN THE WILD strip (ascending); written by reorder_mentions (20260919120100).';

-- FK columns get their own btree (ADR-0030 D11 / 20260903120300): `project_id` also serves the
-- project-detail SEEN ON row; `created_by` the `on delete set null` from profiles.
create index if not exists mentions_project_id_idx on public.mentions (project_id);
create index if not exists mentions_created_by_idx on public.mentions (created_by);
-- /seen-on + the public reader: every published row, newest first.
create index if not exists mentions_status_published_at_idx
  on public.mentions (status, published_at desc);

-- Privileges + RLS (01 INV-28 — same file as the table). Matrix: 05 T-RLS-102..106 — select
-- status='published' to all, everything to admin; insert/update/delete admin (ADR-0002 C7 — a
-- moderator is a plain D, so the policies call is_admin(), never is_moderator(); ADR-0045)
-- and service. Revoke first so the grants below are the whole story.
revoke all on table public.mentions from public, anon, authenticated, service_role;
grant select on table public.mentions to anon, authenticated;
grant insert, update, delete on table public.mentions to authenticated;
grant all on table public.mentions to service_role;

alter table public.mentions enable row level security;

drop policy if exists mentions_select_published_or_admin on public.mentions;
create policy mentions_select_published_or_admin
  on public.mentions
  for select
  to anon, authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists mentions_insert_admin on public.mentions;
create policy mentions_insert_admin
  on public.mentions
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists mentions_update_admin on public.mentions;
create policy mentions_update_admin
  on public.mentions
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists mentions_delete_admin on public.mentions;
create policy mentions_delete_admin
  on public.mentions
  for delete
  to authenticated
  using (public.is_admin());

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists mentions_set_updated_at on public.mentions;
create trigger mentions_set_updated_at
  before update on public.mentions
  for each row execute function public.set_updated_at();
