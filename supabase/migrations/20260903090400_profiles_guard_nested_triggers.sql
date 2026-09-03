-- 20260903090400_profiles_guard_nested_triggers.sql — slice S1.4 (Comments), ADR-0028 D3
-- (data-model §2.1 `comment_count` "maintained by trigger"; 05 T-RLS-126; ADR-0020).
-- One concern (01 INV-06): `profiles_guard()` must let the S1.4 counter trigger through.
-- Why: `comments_bump_comment_count()` (20260903090000) updates `profiles.comment_count` from
-- inside the JWT session that inserted or approved the comment, so `profiles_guard()` sees
-- `auth.role() = 'authenticated'` and — as written in 20260821090000 — refuses the change (and,
-- for a banned author whose held comment a moderator approves, refuses every own-row write).
-- What changes: the whole JWT-caller block is skipped when `pg_trigger_depth() > 1` — a write
-- issued by another trigger is a system write; a browser PATCH always runs at depth 1 and users
-- cannot create triggers, so nothing a client can do reaches the pass. Every ADR-0020 rule is
-- otherwise verbatim (banned refusal, protected columns, reserved first handle). The trigger
-- object `profiles_guard` on `public.profiles` is untouched (`create or replace` keeps the OID).
-- Idempotent: `create or replace`; grants revoked and re-stated.
-- Reversibility (no data loss): re-run the `profiles_guard()` definition from
--   20260821090000_profiles_guard_reserved_and_banned.sql (the comment_count trigger then fails
--   under JWT sessions — revert S1.4 first).

create or replace function public.profiles_guard()
returns trigger
language plpgsql
as $$
declare
  v_role text := auth.role();
begin
  if v_role is not null
     and v_role <> 'service_role'
     and not public.is_admin()
     and pg_trigger_depth() <= 1  -- ADR-0028 D3: nested trigger writes are system writes
  then
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
