-- 20260903120400_migration_versions.sql — slice S1.5 (Notifications), ADR-0029 D3 (05 T-RLS-129;
-- registry "SQL"). One concern (01 INV-06): the RPC `public.migration_versions()` that
-- `scripts/wait-for-schema.mjs` polls before `next build` (ADR-0029 D1/D2) — the applied migration
-- version list from `supabase_migrations.schema_migrations`, which only the CLI / the Supabase
-- GitHub integration writes. `security definer` because the API roles have no access to that
-- schema (and must not get any); `stable` so PostgREST also serves it over GET; `search_path =
-- public` per 01 INV-49's definer rule (the one table read is schema-qualified). EXECUTE goes to
-- `service_role` only — the build's key; nothing else needs it (anon / authenticated / PUBLIC never).
-- The RPC lands with the same merge as the first wait, so the first production build waits for
-- this version like any other (ADR-0029 D3).
-- Idempotent: `create or replace`; grants revoked from every role and re-stated.
-- Reversibility (no data): drop function if exists public.migration_versions();
--   (then remove the wait from `package.json` `build` — the script treats a missing function as
--   "no versions applied" and would wait out its deadline.)

create or replace function public.migration_versions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select version from supabase_migrations.schema_migrations order by version
$$;

revoke all on function public.migration_versions() from public, anon, authenticated, service_role;
grant execute on function public.migration_versions() to service_role;
