-- 20260818000012_helpers.sql — slice S0 (Scaffold), docs/build/00-build-plan.md "S0 — Scaffold".
-- One concern (01 INV-06): the shared security-definer role helpers + the updated_at trigger function.
-- No tables here (tables start in S1.1 with RLS in the same file — 01 INV-28).
-- Idempotent: create or replace throughout.
-- Reversibility: `drop function public.is_admin(); drop function public.is_moderator();
--   drop function public.set_updated_at();` fully reverts this migration (nothing else depends on
--   them at S0; later slices' policies/triggers reference them, so drop only after those are gone).

-- ---------------------------------------------------------------------------------------------
-- public.is_admin() — true only when the caller's profiles.role = 'admin' (data-model §2.11, §4).
-- The `profiles` table lands in S1.1. plpgsql resolves table references lazily at first execution,
-- so this function creates fine before `profiles` exists; the auth.uid() guard returns false for
-- anon and service-role callers (no JWT sub) without ever touching `profiles`.
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
end;
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- public.is_moderator() — true for profiles.role in ('moderator','admin') (data-model §2.11, §4).
-- Same lazy-resolution + auth.uid() guard notes as is_admin().
-- ---------------------------------------------------------------------------------------------
create or replace function public.is_moderator()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('moderator', 'admin')
  );
end;
$$;

revoke all on function public.is_moderator() from public;
grant execute on function public.is_moderator() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- public.set_updated_at() — shared BEFORE UPDATE trigger function (01 INV-97). Tables attach it as
--   create trigger <table>_set_updated_at before update on public.<table>
--   for each row execute function public.set_updated_at();
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to anon, authenticated, service_role;
