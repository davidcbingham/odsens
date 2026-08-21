-- 20260820120000_profiles.sql — slice S1.1 (Accounts), docs/build/00-build-plan.md "S1.1 — Accounts".
-- One concern (01 INV-06): identity — `profiles` + enum `user_role`, its RLS, the `public_profiles` view,
-- the `auth.users` → `profiles` trigger, the column guard trigger, and the `check_handle` RPC
-- (data-model §2.1 / §2.11 / §4; 04 §1.1 H1–H5; 01 INV-28, INV-45..49, INV-97).
-- Idempotent: `if not exists` / `create or replace` / `drop … if exists` throughout.
-- Reversibility (all data in `profiles` is lost — only with an explicit backup note):
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_user(), public.profiles_guard(), public.check_handle(text);
--   drop view if exists public.public_profiles;
--   drop table if exists public.profiles;     -- `site_settings.owner_profile_id` FK must go first (next migration)
--   drop type if exists public.user_role;
--   (leave `extensions.citext` installed — harmless, other slices may use it.)

-- ---------------------------------------------------------------------------------------------
-- citext — case-insensitive handle uniqueness (04 H2). Lives in `extensions` like every other ext.
-- ---------------------------------------------------------------------------------------------
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- enum public.user_role (data-model §2.1).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.user_role as enum ('user', 'moderator', 'admin');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.profiles — one row per auth user, created by trigger; `handle` null until onboarding.
-- `email_hash` is written only by /auth/callback (server, service client) — never by SQL (A14).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  handle            extensions.citext unique
                    constraint profiles_handle_format check (handle ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar_path       text,
  role              public.user_role not null default 'user',
  is_banned         boolean not null default false,
  banned_reason     text,
  comment_count     integer not null default 0,
  handle_changed_at timestamptz,
  email_hash        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.profiles is
  'One per auth user (trigger-created). Own row only under RLS; other users are read via public_profiles.';

-- Privileges (new entities are not auto-exposed — config.toml [api] note; the CLI default ACL still
-- hands TRUNCATE/REFERENCES/TRIGGER to the API roles, so revoke everything first). anon gets
-- nothing; authenticated may select/update/delete subject to the policies below; no insert for
-- anyone but the trigger (definer) and service_role.
revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select, update, delete on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

-- RLS (01 INV-28 — same file as the table). Matrix: 05 T-RLS-1..9.
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin
  on public.profiles
  for delete
  to authenticated
  using (public.is_admin());
-- (no insert policy: creation is trigger-only — T-RLS-3.)

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- public.profiles_guard() — BEFORE UPDATE column guard (data-model §4 "update" cell).
-- A JWT caller that is not admin may only touch `avatar_path` and fill a NULL `handle`;
-- changing role / is_banned / banned_reason / comment_count / email_hash / handle_changed_at, or
-- renaming a non-null handle, raises insufficient_privilege (42501). Sessions without a JWT
-- (migrations, seed, psql), `service_role`, and admin JWTs pass — those writes are the
-- service-client paths of updateProfile / renameUserHandle / banUser (04 SC-06).
-- ---------------------------------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql
as $$
declare
  v_role text := auth.role();
begin
  if v_role is not null and v_role <> 'service_role' and not public.is_admin() then
    if new.role is distinct from old.role
       or new.is_banned is distinct from old.is_banned
       or new.banned_reason is distinct from old.banned_reason
       or new.comment_count is distinct from old.comment_count
       or new.email_hash is distinct from old.email_hash
       or new.handle_changed_at is distinct from old.handle_changed_at
       or (old.handle is not null and new.handle::text is distinct from old.handle::text)
    then
      raise insufficient_privilege
        using message = 'profiles: only avatar_path and a first handle may be set by the owner';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_guard() from public;
grant execute on function public.profiles_guard() to anon, authenticated, service_role;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------------------------
-- public.public_profiles — the only cross-user read (data-model §2.1; 01 INV-45, INV-97).
-- Definer view on purpose: it reads past `profiles` RLS and exposes exactly id, handle,
-- avatar_path, role (T-RLS-10/11). Never add email_hash / is_banned / banned_reason here.
-- ---------------------------------------------------------------------------------------------
create or replace view public.public_profiles
  with (security_invoker = off)
as
  select p.id, p.handle, p.avatar_path, p.role
  from public.profiles p;

revoke all on table public.public_profiles from public, anon, authenticated, service_role;
grant select on table public.public_profiles to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- public.handle_new_user() — AFTER INSERT ON auth.users → profiles row with handle NULL.
-- Does NOT set email_hash (Postgres cannot read env — ADR-0002 A14; /auth/callback does it).
-- ---------------------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to supabase_auth_admin, service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- public.check_handle(p_handle text) returns text — 'invalid' | 'reserved' | 'taken' | 'available'
-- (04 §1.1 checkHandle; H1 regex, H3 reserved list = lib/validation/handle.ts RESERVED_HANDLES,
-- T-UNIT-2 parity; "taken" excludes the caller's own row). authenticated only (T-RLS-129).
-- The citext `=` operator lives in `extensions`, hence `operator(extensions.=)` under
-- search_path = public.
-- ---------------------------------------------------------------------------------------------
create or replace function public.check_handle(p_handle text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reserved constant text[] := array[
    'admin', 'administrator', 'oddsense', 'odsens', 'moderator', 'mod', 'mods', 'root', 'system',
    'support', 'allay', 'api', 'staff', 'help', 'null', 'undefined', 'anonymous', 'deleted',
    'me', 'you', 'everyone', 'here'
  ];
begin
  if p_handle is null or p_handle !~ '^[A-Za-z0-9_]{3,20}$' then
    return 'invalid';
  end if;
  if lower(p_handle) = any (v_reserved) then
    return 'reserved';
  end if;
  if exists (
    select 1
    from public.profiles p
    where p.handle operator(extensions.=) p_handle::extensions.citext
      and p.id is distinct from auth.uid()
  ) then
    return 'taken';
  end if;
  return 'available';
end;
$$;

revoke all on function public.check_handle(text) from public, anon;
grant execute on function public.check_handle(text) to authenticated;
