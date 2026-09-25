-- LOCAL/PREVIEW ONLY — never run against production (05 SEED-14)
-- supabase/seed.sql — applied by `supabase db reset` via supabase/config.toml [db.seed] sql_paths.
-- Contents follow docs/build/05-test-plan.md §3 (SEED-1..SEED-14). Idempotent; fixed UUIDs
-- (scheme 00000000-0000-4000-8000-0000000<gg><nn>) mirrored by tests/helpers/seedIds.ts.
-- Each SEED block arrives with the slice that creates its table:
--   SEED-1  site_settings (1 row)                         — S1.1 (below)
--   SEED-2  notification_matrix (16 rows)                 — S1.5 (below)
--   SEED-3  auth.users (6) + profiles                     — S1.1 (below)
--   SEED-4  projects (3)                                  — S1.2 (below)
--   SEED-5  project_versions (4) + project_files (5)      — S1.2 (below)
--   SEED-6  project_links (1) + project_overrides (2)     — S1.2 (below)
--   SEED-7  skins (2)                                     — arrives in S1.7
--   SEED-8  art (2)                                       — arrives in S1.7
--   SEED-9  comments (5) + comment_likes + comment_reports — S1.4 (below)
--   SEED-10 mentions (2)                                  — S1.8 (below; ADR-0045)
--   SEED-11 videos (7)                                    — S1.6 (below; ADR-0043 D8)
--   SEED-12 sync_runs (3) — S1.2 (below); stats_daily (6) — arrives in S1.9
--   SEED-13 Storage objects — not SQL; uploaded by the e2e/db globalSetup (`uploadFixture`)
--   SEED-14 this guard line (first line of the file) — present from S0

-- =============================================================================================
-- SEED-3 — six auth users (local password `seed-password`, email provider) + their profiles.
-- The `on_auth_user_created` trigger creates each `profiles` row (handle NULL, email_hash NULL);
-- the UPDATE below sets handles/roles per 05 §3. Runs without a JWT, so `profiles_guard` passes.
-- GoTrue scans the *_token / email_change columns as non-null strings — keep them ''.
-- =============================================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id::uuid,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('seed-password', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false,
  false,
  '', '', '', '', '', '', '', '',
  now(),
  now()
from (values
  ('00000000-0000-4000-8000-000000000001', 'seed-admin@localhost.test'),
  ('00000000-0000-4000-8000-000000000002', 'seed-mod@localhost.test'),
  ('00000000-0000-4000-8000-000000000003', 'seed-user@localhost.test'),
  ('00000000-0000-4000-8000-000000000004', 'seed-user2@localhost.test'),
  ('00000000-0000-4000-8000-000000000005', 'seed-banned@localhost.test'),
  ('00000000-0000-4000-8000-000000000006', 'seed-newbie@localhost.test')
) as u (id, email)
on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006'
)
on conflict (provider_id, provider) do nothing;

-- Profiles per 05 SEED-3 (handle_changed_at NULL, no avatar_path on any).
update public.profiles set handle = 'oddsense',    role = 'admin',     comment_count = 1 where id = '00000000-0000-4000-8000-000000000001';
update public.profiles set handle = 'seed_mod',    role = 'moderator', comment_count = 0 where id = '00000000-0000-4000-8000-000000000002';
update public.profiles set handle = 'seed_user',   role = 'user',      comment_count = 2 where id = '00000000-0000-4000-8000-000000000003';
update public.profiles set handle = 'seed_user2',  role = 'user',      comment_count = 0 where id = '00000000-0000-4000-8000-000000000004';
update public.profiles set handle = 'seed_banned', role = 'user',      comment_count = 1,
                           is_banned = true, banned_reason = 'seed'                     where id = '00000000-0000-4000-8000-000000000005';
update public.profiles set handle = null,          role = 'user',      comment_count = 0 where id = '00000000-0000-4000-8000-000000000006';
-- Re-runs restore the seed shape (tests that mutate seed rows also restore in afterAll):
-- all six lose handle_changed_at / avatar_path; the five non-banned also lose any ban flags
-- (seed_banned …0005 keeps is_banned/banned_reason as set above).
update public.profiles
   set handle_changed_at = null, avatar_path = null
 where id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
              '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
              '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006');
update public.profiles
   set is_banned = false, banned_reason = null
 where id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
              '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
              '00000000-0000-4000-8000-000000000006');

-- =============================================================================================
-- SEED-1 — site_settings (1 row). `kofi_page` is the literal 'oddsense' (seed.sql is static SQL;
-- KOFI_PAGE env is not read here). owner_profile_id = oddsense (…0001) → CREATOR tag.
-- =============================================================================================
insert into public.site_settings (
  id, moderation_mode, admin_notify_emails, discord_webhook_url, kofi_page,
  comments_closed_default, announcement_md, owner_profile_id
)
values (
  1, 'auto', '{}', null, 'oddsense', false, null, '00000000-0000-4000-8000-000000000001'
)
on conflict (id) do update
  set moderation_mode         = excluded.moderation_mode,
      admin_notify_emails     = excluded.admin_notify_emails,
      discord_webhook_url     = excluded.discord_webhook_url,
      kofi_page               = excluded.kofi_page,
      comments_closed_default = excluded.comments_closed_default,
      announcement_md         = excluded.announcement_md,
      owner_profile_id        = excluded.owner_profile_id;

-- =============================================================================================
-- SEED-2 — notification_matrix (16 rows) = the default matrix in docs/notifications.md, 8 kinds ×
-- (email, discord). Migration 20260903120000_notification_matrix.sql seeds the same 16 rows with
-- `do nothing` (production / staging never run this file — ADR-0030 D10); this block re-asserts the
-- documented values on every local reset with `do update`, so a test that flipped a switch and
-- failed before its afterAll cannot leak into the next run. `lib/notify/matrix.ts` `matrixDefaults`
-- is the TypeScript twin — 05 T-UNIT-27 parses this block, the migration and the module and asserts
-- all three agree: keep one tuple per line, `(kind, channel, enabled)`.
-- =============================================================================================
insert into public.notification_matrix (kind, channel, enabled) values
  ('comment.new',       'email',   true),
  ('comment.new',       'discord', true),
  ('comment.held',      'email',   true),
  ('comment.held',      'discord', true),
  ('comment.reported',  'email',   true),
  ('comment.reported',  'discord', true),
  ('sync.failed',       'email',   true),
  ('sync.failed',       'discord', false),
  ('sync.stale',        'email',   true),
  ('sync.stale',        'discord', false),
  ('mention.suggested', 'email',   false),
  ('mention.suggested', 'discord', true),
  ('order.new',         'email',   true),
  ('order.new',         'discord', true),
  ('tip.new',           'email',   false),
  ('tip.new',           'discord', true)
on conflict (kind, channel) do update
  set enabled = excluded.enabled;

-- =============================================================================================
-- SEED-4 — projects (3) per 05 §3. Two Modrinth-synced rows (external_id values are the ids the
-- S1.2 fixture `tests/fixtures/modrinth/user-projects.json` must carry for these two projects —
-- SEED-4 "external_id from modrinth/user-projects.json") + one published odsens exclusive whose
-- body_md carries an h2, list, link and <script> tag for the sanitizer e2e. Titles/types/downloads
-- match the docs/spec.md §3 Modrinth snapshot. downloads on …0102: 1568 + 120 + 0 = 1688 (T-RLS-23).
-- =============================================================================================
insert into public.projects (
  id, source, external_id, slug, project_type, title, description, body_md, icon_url,
  gallery, categories, loaders, game_versions, license,
  downloads_modrinth, downloads_curseforge, downloads_direct,
  published_at, external_updated_at, status, synced_at
) values
  (
    '00000000-0000-4000-8000-000000000101', 'modrinth', 'sd000101', 'metal-pipe-mace', 'resourcepack',
    'Metal Pipe Mace', 'The mace, but it is a metal pipe. Sound included.',
    E'## What it does\n\nSwaps the mace model and swing sound for a metal pipe. That is the whole pack.',
    'https://cdn.modrinth.com/data/sd000101/icon.png',
    '[{"url":"https://cdn.modrinth.com/data/sd000101/images/gallery-1.png","title":"In hand","description":null,"ordering":0,"featured":true},
      {"url":"https://cdn.modrinth.com/data/sd000101/images/gallery-2.png","title":"Bonk","description":null,"ordering":1,"featured":false}]'::jsonb,
    '{audio,themed}', '{minecraft}', '{1.21,1.21.1}', null,
    2531, 0, 0,
    '2025-01-10 12:00:00+00', '2026-06-01 12:00:00+00', 'published', now() - interval '30 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000000102', 'modrinth', 'sd000102', 'pixel-chameleon', 'mod',
    'Pixel Chameleon', 'A tiny chameleon that blends into whatever block it sits on.',
    E'## Pixel Chameleon\n\nAdds one very small chameleon. It blends. That is its whole deal.',
    'https://cdn.modrinth.com/data/sd000102/icon.png',
    '[]'::jsonb,
    '{mobs}', '{fabric}', '{1.21.1}', null,
    1568, 120, 0,
    '2025-03-10 12:00:00+00', '2026-07-15 12:00:00+00', 'published', now() - interval '30 minutes'
  ),
  (
    '00000000-0000-4000-8000-000000000103', 'odsens', null, 'seed-exclusive-pack', 'datapack',
    'Seed Exclusive Pack', 'A datapack that lives only on odsens.com.',
    E'## About the pack\n\n- Adds a seed marker\n- Runs one load function\n- Exists only here\n\nMore on [Modrinth](https://modrinth.com/user/OddSense).\n\n<script>alert(''seed'')</script>',
    'project-media/00000000-0000-4000-8000-000000000103/icon/b64a4e0e96965d51.png', -- <hash16 of images/icon-256.png>
    '[]'::jsonb,
    '{}', '{datapack}', '{1.21}', null,
    0, 0, 7,
    '2026-05-20 12:00:00+00', null, 'published', null
  )
on conflict (id) do nothing;

-- =============================================================================================
-- SEED-5 — project_versions (4) + project_files (5) per 05 §3. …0101 two release versions, one CDN
-- file each; …0102 one beta with changelog_md and two files (primary jar + -sources.jar); …0103 one
-- release whose file …0501 is the exclusive zip (sha512 + size_bytes of tests/fixtures/files/pack.zip,
-- storage_path per SC-16 `project-files/{project_id}/{version_id}/{filename}` — bytes uploaded by the
-- e2e/db globalSetup from S1.3, SEED-13). File ids …0502..0505 extend seed group 05 for idempotency.
-- =============================================================================================
insert into public.project_versions (
  id, project_id, external_id, version_number, name, changelog_md,
  game_versions, loaders, version_type, date_published, downloads
) values
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000101', 'sdv00402', '1.1.0',
   null, null, '{1.21,1.21.1}', '{minecraft}', 'release', '2026-06-01 12:00:00+00', 1300),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000101', 'sdv00403', '1.0.0',
   null, null, '{1.21}', '{minecraft}', 'release', '2025-01-10 12:00:00+00', 1231),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000102', 'sdv00404', '2.0.0-beta.1',
   null, E'## 2.0.0-beta.1\n\n- New blending engine\n- Fixed the invisible tail',
   '{1.21.1}', '{fabric}', 'beta', '2026-07-15 12:00:00+00', 210),
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000103', null, '1.0.0',
   null, null, '{1.21}', '{datapack}', 'release', '2026-05-20 12:00:00+00', 7)
on conflict (id) do nothing;

insert into public.project_files (
  id, version_id, filename, size_bytes, sha512, url, storage_path, "primary", download_count
) values
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000402',
   'metal-pipe-mace-1.1.0.zip', 24576, null,
   'https://cdn.modrinth.com/data/sd000101/versions/sdv00402/metal-pipe-mace-1.1.0.zip', null, true, 0),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000403',
   'metal-pipe-mace-1.0.0.zip', 23040, null,
   'https://cdn.modrinth.com/data/sd000101/versions/sdv00403/metal-pipe-mace-1.0.0.zip', null, true, 0),
  ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000404',
   'pixel-chameleon-2.0.0-beta.1.jar', 181248, null,
   'https://cdn.modrinth.com/data/sd000102/versions/sdv00404/pixel-chameleon-2.0.0-beta.1.jar', null, true, 0),
  ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000404',
   'pixel-chameleon-2.0.0-beta.1-sources.jar', 92160, null,
   'https://cdn.modrinth.com/data/sd000102/versions/sdv00404/pixel-chameleon-2.0.0-beta.1-sources.jar', null, false, 0),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000401',
   'seed-exclusive-pack-1.0.0.zip', 769,
   '59544b340b772ee3b334eecc19e9ac8e258263ec8250437766c01e33b903a01d54551004debd2d2a89d6469863df05900d0b8aad7cb02f98652ffd42566121a7',
   null, 'project-files/00000000-0000-4000-8000-000000000103/00000000-0000-4000-8000-000000000401/seed-exclusive-pack-1.0.0.zip', true, 7)
on conflict (id) do nothing;

-- =============================================================================================
-- SEED-6 — project_links (1) + project_overrides (2) per 05 §3. CF link on pixel-chameleon
-- (external_id '900001' = `data.id` in tests/fixtures/curseforge/mod.json, url = its
-- links.websiteUrl). Overrides: hero = pixel-chameleon (featured_order 1), Featured 4-up =
-- seed-exclusive-pack (order 2, comments off for the S1.4 closed-thread cell T-RLS-69).
-- =============================================================================================
insert into public.project_links (project_id, platform, external_id, url, downloads, synced_at)
values (
  '00000000-0000-4000-8000-000000000102', 'curseforge', '900001',
  'https://www.curseforge.com/minecraft/mc-mods/pixel-chameleon', 120, now() - interval '30 minutes'
)
on conflict (project_id, platform) do nothing;

insert into public.project_overrides (
  project_id, featured, featured_order, hidden, title_override, description_override,
  extra_gallery, notes_md, comments_enabled
) values
  ('00000000-0000-4000-8000-000000000102', true, 1, false, null, null, '[]'::jsonb, 'seed note', true),
  ('00000000-0000-4000-8000-000000000103', true, 2, false, null, null, '[]'::jsonb, null, false)
on conflict (project_id) do nothing;

-- =============================================================================================
-- SEED-9 — comments (5) on project …0102 (pixel-chameleon) + 1 like + 1 report per 05 §3
-- (ids from tests/helpers/seedIds.ts SEED_COMMENTS). This file runs without a JWT, so the
-- `comments_set_status()` trigger keeps the statuses written here (held / hidden / deleted rows
-- are seed truths for T-RLS-63..66 / T-RLS-128 / T-E2E-3). `…0204` carries the moderator stamp;
-- `…0205` was created 2 days ago. The like insert bumps `…0201.like_count` to 1 through the
-- `comment_likes_count()` trigger; the report id is generated (unique per (comment, reporter)
-- keeps the block idempotent).
-- =============================================================================================
insert into public.comments (
  id, target_type, target_id, author_id, parent_id, body, status,
  moderated_by, moderated_at, created_at
) values
  ('00000000-0000-4000-8000-000000000201', 'project', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000003', null,
   'The chameleon blends into my kitchen floor. Ten out of ten.', 'published',
   null, null, now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000202', 'project', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201',
   'The kitchen floor is a valid biome.', 'published',
   null, null, now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000203', 'project', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000004', null,
   'first comment here, the tail is great', 'held',
   null, null, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-000000000204', 'project', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000005', null,
   'cheap diamonds at totally-legit.example, no questions asked', 'hidden',
   '00000000-0000-4000-8000-000000000001', now() - interval '1 day', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000205', 'project', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000003', null,
   'never mind, found the setting', 'deleted',
   null, null, now() - interval '2 days')
on conflict (id) do nothing;

insert into public.comment_likes (comment_id, user_id)
values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000004')
on conflict (comment_id, user_id) do nothing;

insert into public.comment_reports (comment_id, reporter_id, reason)
values ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000003', 'spam')
on conflict (comment_id, reporter_id) do nothing;

-- The published inserts above bump `profiles.comment_count` (T-RLS-126); re-assert the SEED-3
-- values so the seed shape is the documented one (oddsense 1 · seed_mod 0 · seed_user 2 ·
-- seed_user2 0 · seed_banned 1 · seed_newbie 0).
update public.profiles as p
   set comment_count = v.comment_count
  from (values
    ('00000000-0000-4000-8000-000000000001'::uuid, 1),
    ('00000000-0000-4000-8000-000000000002'::uuid, 0),
    ('00000000-0000-4000-8000-000000000003'::uuid, 2),
    ('00000000-0000-4000-8000-000000000004'::uuid, 0),
    ('00000000-0000-4000-8000-000000000005'::uuid, 1),
    ('00000000-0000-4000-8000-000000000006'::uuid, 0)
  ) as v (id, comment_count)
 where p.id = v.id;

-- =============================================================================================
-- SEED-10 — mentions (2) per 05 §3; the columns the 05 row leaves open are pinned by ADR-0045.
--   …0301  youtube, on project …0101 (metal-pipe-mace — a `source='modrinth'` row), external_id
--          `seedvid0001` (11 chars — `mentions_youtube_external_id_format`; the id `refreshMentions`
--          asks the Data API for, 04 §3.4), 1,200,000 views, published, FEATURED, sort_order 1 — the
--          one card of the Home IN THE WILD strip and of the SEEN ON row on /projects/metal-pipe-mace.
--   …0302  tiktok, project_id NULL ("About OddSense generally" — the ODSENS chip on /seen-on),
--          view_count NULL, published, not featured, sort_order 2. thumbnail_url NULL: a non-YouTube
--          thumbnail is never rendered (ADR-0002 #33 — `PlatformMark` placeholder).
-- ReachLine over all published = `1.2M VIEWS · 2 VIDEOS · 2 CREATORS` (05 §3).
-- `published_at` values are fixed literals older than 7 days at build time (2026-09-19; the SEED-11
-- rule — `relativeTime` prints the absolute form, no screenshot depends on the clock) and the
-- YouTube row is the newer one, so "newest first" on /seen-on is deterministic (T-E2E-10).
-- Both are `source='manual'`, created by the seed admin (…0001). Creator data = public channel
-- name + link only (00 S1.8.AC11). The YouTube thumbnail uses the i.ytimg.com hqdefault shape
-- (01 INV-54 host; e2e fulfils it locally like SEED-11, H-10). Idempotent on id.
-- =============================================================================================
insert into public.mentions (
  id, project_id, platform, url, external_id, title, creator_name, creator_url, thumbnail_url,
  published_at, view_count, status, source, featured, sort_order, created_by
) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000101', 'youtube',
   'https://www.youtube.com/watch?v=seedvid0001', 'seedvid0001',
   'Metal Pipe Mace is the loudest mod I have ever installed', 'Seed Creator',
   'https://www.youtube.com/@seedcreator', 'https://i.ytimg.com/vi/seedvid0001/hqdefault.jpg',
   '2026-06-14 16:00:00+00', 1200000, 'published', 'manual', true, 1,
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000302', null, 'tiktok',
   'https://www.tiktok.com/@seedtok/video/1', null,
   'this mod makes no sense and I love it', 'Seed Tok',
   'https://www.tiktok.com/@seedtok', null,
   '2026-05-02 12:00:00+00', null, 'published', 'manual', false, 2,
   '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- =============================================================================================
-- SEED-11 — videos (7) per 05 §3 as amended by ADR-0043 D8 (05's three rows + four older long ones,
-- so AC4's Up next swap, AC5's grid and AC6's Home 2-up are provable on seed — T-E2E-6 / T-E2E-1 are
-- smoke specs and may not mutate). Newest first:
--   seedvid0002  long 480 s, HIDDEN — the newest row overall on purpose: a reader that forgets the
--                hidden filter would put it in the big player / Home 2-up (T-RLS-49, T-E2E-6).
--   seedvid0001  long 600 s — the newest VISIBLE long video (T-E2E-6 plays it; T-ACT-68 hides it and
--                restores). Its multi-paragraph description feeds the hero blurb (first paragraph).
--   seedvid0003  short 45 s, is_short true — dated between …0001 and …0004, so a reader that forgets
--                the is_short filter would show it in the Home 2-up instead of …0004.
--   seedvid0004..0007  long, visible, strictly older, distinct published_at. With UP_NEXT_COUNT = 4:
--                Home 2-up = 0001 + 0004 · Up next = 0001, 0004, 0005, 0006 · MORE VIDEOS = 0007.
--                …0004 is 724 s ("12:04" / "12 minutes 4 seconds", the 03 §2.6 sr example), …0005 is
--                3723 s (the h:mm:ss arm, T-UNIT-12), …0006 has a NULL description (degraded-data
--                arm: no blurb), …0007 is 61 s — one second past the 04 §5.3 Shorts threshold.
-- Every date is a fixed literal older than 7 days at build time (2026-09-18), so `relativeTime`
-- prints the absolute `formatDate` form and no screenshot depends on the clock. Thumbnails use the
-- 04 §3.3 hqdefault shape on i.ytimg.com (01 INV-54 host; e2e never reaches it — next/image fetches
-- server-side and tests/e2e/fixtures.ts fulfils it locally, H-10). `is_short_override` is NULL on
-- every row (nothing is overridden on seed — ADR-0043 D1). youtube_id values are exactly 11 chars
-- (`videos_youtube_id_format`; 04 §1.8 `updateVideoInput`). Fixed ids extend the seed uuid scheme
-- with group 09 (videos); idempotent on id.
-- =============================================================================================
insert into public.videos (
  id, youtube_id, title, description, thumbnail_url, published_at,
  duration_seconds, is_short, is_short_override, view_count, like_count, synced_at, hidden
) values
  ('00000000-0000-4000-8000-000000000901', 'seedvid0001', 'Seed Long Video One',
   E'I gave the mace a metal pipe sound and then could not stop swinging it.\n\nThis is the whole build, start to finish: the model swap, the sound file, and the part where I broke my own world twice.\n\nThe pack is on the projects page.',
   'https://i.ytimg.com/vi/seedvid0001/hqdefault.jpg', '2026-09-01 12:00:00+00',
   600, false, null, 12345, 321, '2026-09-17 12:00:00+00', false),
  ('00000000-0000-4000-8000-000000000902', 'seedvid0002', 'Seed Long Video Two (hidden)',
   'Hidden by the admin.',
   'https://i.ytimg.com/vi/seedvid0002/hqdefault.jpg', '2026-09-08 12:00:00+00',
   480, false, null, 999, 12, '2026-09-17 12:00:00+00', true),
  ('00000000-0000-4000-8000-000000000903', 'seedvid0003', 'Seed Short: Pipe Bonk',
   'A 45 second seed short.',
   'https://i.ytimg.com/vi/seedvid0003/hqdefault.jpg', '2026-08-25 12:00:00+00',
   45, true, null, 54321, 987, '2026-09-17 12:00:00+00', false),
  ('00000000-0000-4000-8000-000000000904', 'seedvid0004', 'Seed Long Video Four',
   E'A very small chameleon, a very large problem.\n\nSecond paragraph that the blurb never shows.',
   'https://i.ytimg.com/vi/seedvid0004/hqdefault.jpg', '2026-08-15 12:00:00+00',
   724, false, null, 8200, 210, '2026-09-17 12:00:00+00', false),
  ('00000000-0000-4000-8000-000000000905', 'seedvid0005',
   'Seed Long Video Five: The One With The Really Long Title That Has To Wrap Onto Two Lines',
   'An hour of bad decisions, lightly edited.',
   'https://i.ytimg.com/vi/seedvid0005/hqdefault.jpg', '2026-07-30 12:00:00+00',
   3723, false, null, 4100, 95, '2026-09-17 12:00:00+00', false),
  ('00000000-0000-4000-8000-000000000906', 'seedvid0006', 'Seed Long Video Six',
   null,
   'https://i.ytimg.com/vi/seedvid0006/hqdefault.jpg', '2026-07-04 12:00:00+00',
   185, false, null, 2050, 40, '2026-09-17 12:00:00+00', false),
  ('00000000-0000-4000-8000-000000000907', 'seedvid0007', 'Seed Long Video Seven',
   'Sixty-one seconds. Not a short. Barely.',
   'https://i.ytimg.com/vi/seedvid0007/hqdefault.jpg', '2026-06-12 12:00:00+00',
   61, false, null, 1024, 16, '2026-09-17 12:00:00+00', false)
on conflict (id) do nothing;

-- =============================================================================================
-- SEED-12 (S1.2 part) — sync_runs (3): one ok=true run per source (modrinth, curseforge, youtube)
-- finished 30 minutes ago, so the 04 J-F edge fires on the first failing test run. Fixed ids extend
-- the seed uuid scheme with group 08 (sync_runs) for idempotency. stats_daily rows arrive in S1.9.
-- =============================================================================================
insert into public.sync_runs (id, source, started_at, finished_at, ok, items, error) values
  ('00000000-0000-4000-8000-000000000801', 'modrinth',
   now() - interval '35 minutes', now() - interval '30 minutes', true, 18, null),
  ('00000000-0000-4000-8000-000000000802', 'curseforge',
   now() - interval '35 minutes', now() - interval '30 minutes', true, 1, null),
  ('00000000-0000-4000-8000-000000000803', 'youtube',
   now() - interval '35 minutes', now() - interval '30 minutes', true, 21, null)
on conflict (id) do nothing;
