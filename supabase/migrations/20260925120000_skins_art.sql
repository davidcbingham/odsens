-- 20260925120000_skins_art.sql — slice S1.7 (Skins + Art), docs/build/00-build-plan.md "S1.7 — Skins + Art".
-- One concern (01 INV-06): the two native-content stores — the `skins` and `art` tables (data-model
-- §2.4) with their four enums, RLS (data-model §4 row "videos, skins, art"; 05 T-RLS-53..62), the
-- status/sort indexes and updated_at triggers — and the two public-read Storage buckets those rows
-- point into (data-model §3: `skins` 64 KB texture / 512 KB bust, `art` 10 MB; 05 T-RLS-121/122).
-- Written by `createSkin` / `updateSkin` / `createArt` / `updateArt` (04 §1.5, service role after
-- requireRole('admin') — ADR-0002 C7), by the `renderSkinBust` job (04 §3.8: `render_bust_path`
-- only) and by RPC `record_skin_download` (`downloads` only — 20260925120100). Nothing deletes a
-- row but the admin (01 INV-24).
--
-- Owner-scoped path CHECKs (the S1.2 security-round rule, docs/questions.md 2026-08-20; the
-- `profiles_avatar_path_own` pattern — 20260820120400): every `*_path` column may only name an
-- object inside ITS OWN row's folder — `skins/<id>/texture.png`, `skins/<id>/bust.png`,
-- `art/<id>/<hash16>.<png|jpg|webp>` (04 SC-21; DB-stored paths are bucket-prefixed like
-- `project-media/…`). Why: the actions delete / overwrite objects with the service-role client, and a
-- row pointed at another row's object would have that object deleted or served. `lib/files.ts`
-- `isOwnSkinPath` / `isOwnArtPath` mirror the regexes app-side and every service-role Storage
-- delete re-checks the CALLER's id first (defence in depth — ADR-0048 D2).
--
-- Buckets: `public = true` (the `<img>` / skinview3d / `/api/download` 302 target read them by URL)
-- with ONE select policy each on `storage.objects` and NO insert/update/delete policy — only the
-- service role (the actions, the render job, the bulk script) writes here (01 INV-33; T-RLS-121/122
-- "write D for every JWT role"). MIME allow-lists are a first fence only (`skins` accepts PNG only —
-- both the 64×64 texture and the rendered bust are PNG; the bust ceiling 512 KB is the bucket's
-- `file_size_limit`, the 64 KB texture ceiling is `validateUpload(bytes, 'skin')`, 04 U4); the
-- commit phase re-validates magic bytes + dimensions and deletes the object on failure (SC-19).
-- Additive only: four new enums, two new tables, two new bucket rows; nothing existing is altered.
-- Idempotent: `duplicate_object` guards on the enums; `if not exists` / `drop … if exists` (policy +
-- trigger guards only) / `on conflict (id) do update` on the bucket rows throughout.
-- Reversibility: delete the objects, then the two storage policies, then the bucket rows
--   (`delete from storage.buckets where id in ('skins','art')`); drop table if exists public.art;
--   drop table if exists public.skins; drop type if exists public.art_status, public.art_kind,
--   public.skin_status, public.skin_model. No other table references either (comments on skins/art
--   are Scope OUT until S2.x — `comments.target_type` is a free enum value, not an FK).

-- ---------------------------------------------------------------------------------------------
-- Enums (data-model §2.4; naming = the house `<entity>_<column>` convention — `mention_status`,
-- `project_source`). `skin_model` = `createSkinInput.model`; `art_kind` = `createArtInput.kind`
-- (04 §1.5). `skin_status` / `art_status` are separate two-value enums so a later status on one
-- store (e.g. `hidden`) never widens the other.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.skin_model as enum ('classic', 'slim');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.skin_status as enum ('draft', 'published');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.art_kind as enum ('avatar', 'thumbnail', 'icon', 'render', 'other');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.art_status as enum ('draft', 'published');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.skins — one row per skin Oliver posts (data-model §2.4). `slug` is the public key
-- (`/skins?skin=<slug>`, the download's file name) with the 04 "Shared" slug regex as a CHECK;
-- `createSkin` maps the plain unique's 23505 to `conflict` (04 §1.5). The CHECKs mirror
-- `createSkinInput` (name 1..60, description_md ≤ 5000; `char_length` counts code points and zod
-- counts UTF-16 units, so the table never rejects what the schema accepted). `texture_path` is
-- NOT NULL — a skin without its 64×64 PNG is not a skin; `render_bust_path` is NULL until
-- `renderSkinBust` writes the cached bust (the public card renders a live fallback meanwhile —
-- 00 S1.7.AC10). `downloads` is the `record_skin_download` counter (never negative). `status` /
-- `model` / `is_exclusive` / `sort_order` have defaults so a minimal insert is a classic draft.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.skins (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null
                   constraint skins_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$'),
  name             text not null
                   constraint skins_name_length check (char_length(name) between 1 and 60),
  description_md   text
                   constraint skins_description_md_length check (char_length(description_md) <= 5000),
  texture_path     text not null
                   constraint skins_texture_path_own
                     check (texture_path ~ ('^skins/' || id::text || '/texture\.png$')),
  model            public.skin_model not null default 'classic',
  render_bust_path text
                   constraint skins_render_bust_path_own
                     check (render_bust_path is null
                            or render_bust_path ~ ('^skins/' || id::text || '/bust\.png$')),
  is_exclusive     boolean not null default false,
  status           public.skin_status not null default 'draft',
  sort_order       integer not null default 0,
  downloads        integer not null default 0
                   constraint skins_downloads_check check (downloads >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint skins_slug_key unique (slug)
);

comment on table public.skins is
  'Minecraft skins Oliver posts (data-model §2.4; 04 §1.5). Public = status=published; drafts are admin-only. texture_path / render_bust_path may only name objects in the row''s own skins/<id>/ folder (ADR-0048).';
comment on column public.skins.render_bust_path is
  'Cached bust PNG (skins/<id>/bust.png) written by the renderSkinBust job (04 §3.8); NULL = not rendered yet, the card shows a live 3D fallback.';
comment on column public.skins.downloads is
  'DOWNLOAD PNG count — incremented only by RPC record_skin_download (20260925120100), called from /api/download/[fileId] for kind skin (ADR-0002 C8).';

-- The public reader + the admin ORDER list: published rows by sort_order, newest created breaks a tie.
create index if not exists skins_status_sort_idx
  on public.skins (status, sort_order, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- public.art — one row per picture (data-model §2.4). `image_path` carries the content hash the
-- commit phase derives (`art/<id>/<hash16>.<ext>`, 04 SC-21) and its own-folder CHECK; `width` /
-- `height` are server-derived at commit (04 §1.5; sharp), capped at 8192 a side (the decode-bomb
-- fence). `year` is optional, 2015 (the channel's first year) to 2100; `credit` is a HANDLE, never
-- a real name (00 S1.7 / CLAUDE.md "no PII") — ≤ 40 chars of `[A-Za-z0-9_ .-]`. The masonry never
-- crops: the natural size is what the reader hands `next/image`.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.art (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null
               constraint art_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$'),
  title        text not null
               constraint art_title_length check (char_length(title) between 1 and 80),
  kind         public.art_kind not null,
  image_path   text not null
               constraint art_image_path_own
                 check (image_path ~ ('^art/' || id::text || '/[0-9a-f]{16}\.(png|jpg|webp)$')),
  width        integer not null
               constraint art_width_check check (width between 1 and 8192),
  height       integer not null
               constraint art_height_check check (height between 1 and 8192),
  year         integer
               constraint art_year_check check (year is null or year between 2015 and 2100),
  credit       text
               constraint art_credit_format
                 check (credit is null or (char_length(credit) <= 40 and credit ~ '^[A-Za-z0-9_ .-]*$')),
  downloadable boolean not null default false,
  status       public.art_status not null default 'draft',
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint art_slug_key unique (slug)
);

comment on table public.art is
  'Art pieces Oliver hosts (data-model §2.4; 04 §1.5). Public = status=published; drafts are admin-only. image_path may only name an object in the row''s own art/<id>/ folder (ADR-0048). credit is a handle, never a real name.';
comment on column public.art.image_path is
  'art/<id>/<hash16>.<png|jpg|webp> — content-addressed at commit (04 SC-21); width/height are the object''s natural size, derived server-side.';

-- The public reader + the admin ORDER list: published rows by sort_order, newest created breaks a tie.
create index if not exists art_status_sort_idx
  on public.art (status, sort_order, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- Privileges + RLS (01 INV-28 — same file as the tables). Matrix: 05 T-RLS-53..62 — select
-- status='published' to all, everything to admin; insert/update/delete admin (ADR-0002 C7 — a
-- moderator is a plain D, so the policies call is_admin(), never is_moderator(); `/admin/skins` and
-- `/admin/art` show a moderator the published rows read-only) and service. Revoke first so the
-- grants below are the whole story (the `videos` / `mentions` pattern).
-- ---------------------------------------------------------------------------------------------
revoke all on table public.skins from public, anon, authenticated, service_role;
grant select on table public.skins to anon, authenticated;
grant insert, update, delete on table public.skins to authenticated;
grant all on table public.skins to service_role;

alter table public.skins enable row level security;

drop policy if exists skins_select_published_or_admin on public.skins;
create policy skins_select_published_or_admin
  on public.skins
  for select
  to anon, authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists skins_insert_admin on public.skins;
create policy skins_insert_admin
  on public.skins
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists skins_update_admin on public.skins;
create policy skins_update_admin
  on public.skins
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists skins_delete_admin on public.skins;
create policy skins_delete_admin
  on public.skins
  for delete
  to authenticated
  using (public.is_admin());

revoke all on table public.art from public, anon, authenticated, service_role;
grant select on table public.art to anon, authenticated;
grant insert, update, delete on table public.art to authenticated;
grant all on table public.art to service_role;

alter table public.art enable row level security;

drop policy if exists art_select_published_or_admin on public.art;
create policy art_select_published_or_admin
  on public.art
  for select
  to anon, authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists art_insert_admin on public.art;
create policy art_insert_admin
  on public.art
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists art_update_admin on public.art;
create policy art_update_admin
  on public.art
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists art_delete_admin on public.art;
create policy art_delete_admin
  on public.art
  for delete
  to authenticated
  using (public.is_admin());

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists skins_set_updated_at on public.skins;
create trigger skins_set_updated_at
  before update on public.skins
  for each row execute function public.set_updated_at();

drop trigger if exists art_set_updated_at on public.art;
create trigger art_set_updated_at
  before update on public.art
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Storage buckets `skins` (public-read; PNG only; 512 KB = the bust ceiling, the texture's 64 KB
-- is enforced at validation) and `art` (public-read; png/jpeg/webp; 10 MB) — data-model §3;
-- 01 INV-33; the `project-media` pattern (20260827200200). storage.objects already has RLS enabled
-- (Supabase). Read policies for anon + authenticated; NO write policy on either bucket — service
-- role only (T-RLS-121/122). Browser uploads of art go through a server-issued signed upload URL
-- (04 §1.4.5 two-phase; a signed upload token is not a policy); skin textures never leave the
-- server action (the 64 KB file rides the FormData — 04 §1.5).
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('skins', 'skins', true, 524288, array['image/png'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('art', 'art', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists skins_public_read on storage.objects;
create policy skins_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'skins');

drop policy if exists art_public_read on storage.objects;
create policy art_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'art');

-- No insert/update/delete policies on either bucket (service role only — T-RLS-121/122).
