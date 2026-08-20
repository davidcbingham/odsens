-- 20260820120100_site_settings.sql — slice S1.1 (Accounts), docs/build/00-build-plan.md "S1.1 — Accounts".
-- One concern (01 INV-06): the single-row `site_settings` table + enum `moderation_mode`, its
-- admin-only RLS, and the all-roles `site_settings_public` view (data-model §2.4 / §4; ADR-0002 C6/A3;
-- 01 INV-28, INV-97 — `id int = 1` is the named PK exception). Depends on `profiles` (owner FK).
-- Idempotent: `if not exists` / `create or replace` / `drop … if exists` throughout.
-- Reversibility (the one settings row is lost — take a backup note first):
--   drop view if exists public.site_settings_public;
--   drop table if exists public.site_settings;
--   drop type if exists public.moderation_mode;

-- ---------------------------------------------------------------------------------------------
-- enum public.moderation_mode (data-model §2.4).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.moderation_mode as enum ('auto', 'hold_first_time');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.site_settings — exactly one row (`id = 1`), seeded (05 SEED-1).
-- `discord_webhook_url` and `admin_notify_emails` are secrets/PII-adjacent: admin-only, never in a view.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.site_settings (
  id                      integer primary key
                          constraint site_settings_single_row check (id = 1),
  moderation_mode         public.moderation_mode not null default 'auto',
  admin_notify_emails     text[] not null default '{}',
  discord_webhook_url     text,
  kofi_page               text,
  comments_closed_default boolean not null default false,
  announcement_md         text,
  owner_profile_id        uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.site_settings is
  'Single row (id = 1). Admin-only; public fields are exposed through site_settings_public.';

-- Privileges: anon nothing; authenticated select/update (policies restrict to admin); no insert/
-- delete for anyone but service_role (T-RLS-13/15: admin D).
revoke all on table public.site_settings from public, anon, authenticated, service_role;
grant select, update on table public.site_settings to authenticated;
grant all on table public.site_settings to service_role;

-- RLS (01 INV-28). Matrix: 05 T-RLS-12..15.
alter table public.site_settings enable row level security;

drop policy if exists site_settings_select_admin on public.site_settings;
create policy site_settings_select_admin
  on public.site_settings
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists site_settings_update_admin on public.site_settings;
create policy site_settings_update_admin
  on public.site_settings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- (no insert / delete policies — the row is seeded; service_role only.)

-- updated_at (01 INV-97).
drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- public.site_settings_public — the public read (data-model §2.4; ADR-0002 C6 + A3; T-RLS-132).
-- Definer view on purpose; column set is exactly these four. Only SELECT is granted, so the
-- auto-updatable view cannot be written through by anon/authenticated.
-- ---------------------------------------------------------------------------------------------
create or replace view public.site_settings_public
  with (security_invoker = off)
as
  select s.comments_closed_default, s.kofi_page, s.owner_profile_id, s.moderation_mode
  from public.site_settings s;

revoke all on table public.site_settings_public from public, anon, authenticated, service_role;
grant select on table public.site_settings_public to anon, authenticated, service_role;
