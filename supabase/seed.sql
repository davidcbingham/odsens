-- LOCAL/PREVIEW ONLY — never run against production (05 SEED-14)
-- supabase/seed.sql — applied by `supabase db reset` via supabase/config.toml [db.seed] sql_paths.
-- Contents follow docs/build/05-test-plan.md §3 (SEED-1..SEED-14). Idempotent; fixed UUIDs
-- (scheme 00000000-0000-4000-8000-0000000<gg><nn>) mirrored by tests/helpers/seedIds.ts.
-- Each SEED block arrives with the slice that creates its table:
--   SEED-1  site_settings (1 row)                         — S1.1 (below)
--   SEED-2  notification_matrix (16 rows)                 — arrives in S1.5
--   SEED-3  auth.users (6) + profiles                     — S1.1 (below)
--   SEED-4  projects (3)                                  — arrives in S1.2 / S1.3
--   SEED-5  project_versions (4) + project_files (5)      — arrives in S1.2 / S1.3
--   SEED-6  project_links (1) + project_overrides (2)     — arrives in S1.2 / S1.3
--   SEED-7  skins (2)                                     — arrives in S1.7
--   SEED-8  art (2)                                       — arrives in S1.7
--   SEED-9  comments (5) + comment_likes + comment_reports — arrives in S1.4
--   SEED-10 mentions (2)                                  — arrives in S1.8
--   SEED-11 videos (3)                                    — arrives in S1.6
--   SEED-12 sync_runs (3) + stats_daily (6) (+ empty tables) — arrives in S1.2
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
