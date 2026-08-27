-- LOCAL/PREVIEW ONLY — never run against production (05 SEED-14)
-- supabase/seed.sql — applied by `supabase db reset` via supabase/config.toml [db.seed] sql_paths.
-- Contents follow docs/build/05-test-plan.md §3 (SEED-1..SEED-14). Idempotent; fixed UUIDs
-- (scheme 00000000-0000-4000-8000-0000000<gg><nn>) mirrored by tests/helpers/seedIds.ts.
-- Each SEED block arrives with the slice that creates its table:
--   SEED-1  site_settings (1 row)                         — S1.1 (below)
--   SEED-2  notification_matrix (16 rows)                 — arrives in S1.5
--   SEED-3  auth.users (6) + profiles                     — S1.1 (below)
--   SEED-4  projects (3)                                  — S1.2 (below)
--   SEED-5  project_versions (4) + project_files (5)      — S1.2 (below)
--   SEED-6  project_links (1) + project_overrides (2)     — S1.2 (below)
--   SEED-7  skins (2)                                     — arrives in S1.7
--   SEED-8  art (2)                                       — arrives in S1.7
--   SEED-9  comments (5) + comment_likes + comment_reports — arrives in S1.4
--   SEED-10 mentions (2)                                  — arrives in S1.8
--   SEED-11 videos (3)                                    — arrives in S1.6
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
