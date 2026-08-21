-- 20260821090000_profiles_guard_reserved_and_banned.sql — slice S1.1 (Accounts), gate-round-3 security
-- fix (ADR-0020; 04 §1.1 H3 / H5; 01 INV-49, INV-97; data-model §2.1, §2.11, §4; 05 T-RLS-4, T-RLS-5).
-- One concern (01 INV-06): reserved handles + bans bind the owner's DIRECT write, not only the RPC.
-- Why: the H3 reserved list lived only inside `check_handle` (and its TS mirror), so the actions refused
-- `oddsense` / `admin` / … but RLS + `profiles_guard` let any signed-in user's own-row PATCH (anon key +
-- own JWT, no action involved) set a FIRST handle to any value matching the format CHECK — impersonation
-- of the owner/staff, and the unique index would then also block the owner-bootstrap SQL. Advisory row
-- 20: `profiles_guard` was ban-unaware — a banned JWT could still set its own `avatar_path` / first handle.
-- What changes:
--   1. new `public.is_reserved_handle(text)` — the 22-entry H3 list in SQL ONCE (pure, immutable);
--      `lib/validation/handle.ts` `RESERVED_HANDLES` mirrors it (05 T-UNIT-2; T-ACT-7 parity reads it);
--   2. `public.check_handle(text)` — same body, the inline array replaced by a call to (1);
--   3. `public.profiles_guard()` — same body plus, for non-admin JWT callers: a banned row refuses every
--      write, and a reserved first handle (NULL → value) is refused — both insufficient_privilege (42501).
--      Sessions without a JWT (migrations, seed, psql, the SQL editor), `service_role` and admin JWTs
--      still pass — the owner bootstrap (`.claude/skills/supabase-ops/SKILL.md`) runs as `postgres`.
--      The trigger object `profiles_guard` on `public.profiles` is untouched (`create or replace` keeps
--      the function OID); no table, policy or index changes.
-- Idempotent: `create or replace` throughout; grants are revoked and re-stated after each replace so a
-- re-run can never widen them.
-- Reversibility (no data loss — only writes that used to succeed are refused):
--   re-run the previous definitions from 20260820120000_profiles.sql — `profiles_guard()` (lines
--   100-125) and `check_handle(text)` (lines 178-211, incl. its revoke/grant) — then
--   `drop function if exists public.is_reserved_handle(text);` (only after `check_handle` no longer
--   references it).

-- ---------------------------------------------------------------------------------------------
-- public.is_reserved_handle(p_handle text) returns boolean — 04 §1.1 H3, the 22 entries in document
-- order (ADR-0002 #63), case-insensitive; NULL → false (total function, never NULL). Pure SQL, no
-- table access, invoker rights — safe to expose to every API role (the list is public: it ships in the
-- client bundle as `RESERVED_HANDLES`). `check_handle` (security definer) and `profiles_guard` call it.
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_reserved_handle(p_handle text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(
    lower(p_handle) = any (array[
      'admin', 'administrator', 'oddsense', 'odsens', 'moderator', 'mod', 'mods', 'root', 'system',
      'support', 'allay', 'api', 'staff', 'help', 'null', 'undefined', 'anonymous', 'deleted',
      'me', 'you', 'everyone', 'here'
    ]),
    false
  );
$$;

revoke all on function public.is_reserved_handle(text) from public;
grant execute on function public.is_reserved_handle(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- public.check_handle(p_handle text) returns text — 'invalid' | 'reserved' | 'taken' | 'available'
-- (04 §1.1 checkHandle; H1 regex, H3 via is_reserved_handle(), "taken" excludes the caller's own row).
-- Body identical to 20260820120000_profiles.sql except the reserved test. authenticated only
-- (T-RLS-129). The citext `=` operator lives in `extensions`, hence `operator(extensions.=)` under
-- search_path = public.
-- ---------------------------------------------------------------------------------------------
create or replace function public.check_handle(p_handle text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_handle is null or p_handle !~ '^[A-Za-z0-9_]{3,20}$' then
    return 'invalid';
  end if;
  if public.is_reserved_handle(p_handle) then
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

-- ---------------------------------------------------------------------------------------------
-- public.profiles_guard() — BEFORE UPDATE column guard (data-model §4 "update" cell).
-- A JWT caller that is not admin may only touch `avatar_path` and fill a NULL `handle` — and, from this
-- migration, not at all while banned, and not with a reserved first handle. Changing role / is_banned /
-- banned_reason / comment_count / email_hash / handle_changed_at, or renaming a non-null handle, still
-- raises insufficient_privilege (42501) with the original message. Sessions without a JWT (migrations,
-- seed, psql), `service_role`, and admin JWTs pass — those writes are the service-client paths of
-- updateProfile / renameUserHandle / banUser (04 SC-06) and the owner bootstrap.
-- ---------------------------------------------------------------------------------------------
create or replace function public.profiles_guard()
returns trigger
language plpgsql
as $$
declare
  v_role text := auth.role();
begin
  if v_role is not null and v_role <> 'service_role' and not public.is_admin() then
    if old.is_banned then
      raise insufficient_privilege
        using message = 'profiles: banned accounts cannot change their profile';
    end if;
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
    if old.handle is null and new.handle is not null and public.is_reserved_handle(new.handle::text) then
      raise insufficient_privilege
        using message = 'profiles: that handle is reserved';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_guard() from public;
grant execute on function public.profiles_guard() to anon, authenticated, service_role;
