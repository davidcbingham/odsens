-- 20260926120100_list_stale_objects.sql — slice S1.9 (Stats), docs/build/00-build-plan.md
-- "S1.9 — Stats" (AC1, the U1 orphan cleanup — 04 §1.4.5 / §3.5). One concern (01 INV-06): the RPC
-- `public.list_stale_objects(p_bucket, p_min_age_hours, p_limit)` that `snapshotStats` calls through
-- the service client to find the candidates for the U1 sweep — every object of one bucket older than
-- the given age, oldest first, capped. The job then subtracts the referenced paths (`project_files.
-- storage_path`, `projects.icon_url`, `projects.gallery[].url`, `project_overrides.extra_gallery[].path`,
-- `art.image_path`) and removes the rest with `storage.remove()` — the RPC lists, it never deletes
-- (01 INV-24: the only deletions in `lib/jobs/` are that housekeeping).
-- Why an RPC (ADR-0049 D3): Storage's REST `list` is one folder level at a time with no recursion and no age
-- filter, while every bucket the scan covers nests objects two or three levels deep
-- (`{id}/{kind}/{file}`) — one read per bucket beats a folder walk of unbounded fan-out.
-- `security definer` because the API roles have no grant on `storage.objects` (and get none here);
-- `stable` so PostgREST serves it over GET too; `search_path = public` per 01 INV-49's definer rule
-- (the one table read is schema-qualified). Only the three columns every storage-api schema version
-- carries are touched (`bucket_id`, `name`, `created_at`) — the migration must apply on a hosted
-- project whose storage schema may lag the local image. `name` is nullable in `storage.objects`,
-- hence the guard; `p_limit` below 0 reads as 0 (never a negative LIMIT).
-- EXECUTE goes to `service_role` only — the job's client; anon / authenticated / PUBLIC never
-- (05 T-RLS-129 leg: 42501 for every JWT role; prosecdef + search_path asserted in the catalog).
-- Idempotent: `create or replace`; grants revoked from every role and re-stated (the Supabase
-- default-ACL lesson, 20260903120200).
-- Reversibility (no data): drop function if exists public.list_stale_objects(text, integer, integer);

create or replace function public.list_stale_objects(
  p_bucket text,
  p_min_age_hours integer,
  p_limit integer
)
returns table (name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = p_bucket
    and o.name is not null
    and o.created_at < now() - make_interval(hours => p_min_age_hours)
  order by o.created_at asc
  limit greatest(p_limit, 0)
$$;

comment on function public.list_stale_objects(text, integer, integer) is
  'S1.9: the objects of one bucket older than p_min_age_hours, oldest first, at most p_limit — the U1 orphan-sweep candidates snapshotStats filters against the referencing columns (04 §1.4.5 / §3.5). Lists only; service_role only.';

revoke all on function public.list_stale_objects(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_stale_objects(text, integer, integer) to service_role;
