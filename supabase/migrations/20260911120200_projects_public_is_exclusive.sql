-- 20260911120200_projects_public_is_exclusive.sql — slice S1.5a (Cross-posted projects), ADR-0037
-- Decision 7 + Decision 9 (05 T-RLS-22 amended row; 00 S1.5a.AC5; 03 §2.2 `ExclusiveBadge` rule).
-- One concern (01 INV-06): `projects_public` gains the TRAILING column
--   is_exclusive = (p.source = 'odsens' and not exists (select 1 from project_links l where l.project_id = p.id))
-- so cards, hero and detail read one predicate (list reads no longer infer from `source` alone):
-- the badge renders only while `is_exclusive`; linking a listing removes it everywhere at the
-- action's revalidate, unlinking brings it back. `lib/data/projects.ts isExclusive(source, links)`
-- keeps the same predicate for unit parity (T-UNIT-36).
-- `create or replace view` may only append columns, so the S1.2 column list (20260827090300) is
-- restated verbatim and `is_exclusive` is last. The WHERE clause still gates the row before the
-- boolean is computed — nothing about hidden projects leaks (the link subquery runs inside the
-- definer view on rows the view already exposes). Definer view (`security_invoker = off`) as before:
-- the WHERE clause IS the visibility rule for every role (T-RLS-22).
-- Grants re-stated (revoke-first house pattern) — a replace must never widen them.
-- Idempotent: `create or replace` + revoke/grant re-stated.
-- Reversibility: re-run 20260827090300_projects_public_view.sql after
--   `drop view if exists public.projects_public;` (a replace cannot drop a column).

create or replace view public.projects_public
  with (security_invoker = off)
as
  select
    p.id,
    p.source,
    p.external_id,
    p.slug,
    p.project_type,
    coalesce(o.title_override, p.title) as title,
    coalesce(o.description_override, p.description) as description,
    p.body_md,
    p.icon_url,
    p.gallery,
    p.categories,
    p.loaders,
    p.game_versions,
    p.license,
    p.source_url,
    p.issues_url,
    p.discord_url,
    p.downloads_modrinth,
    p.downloads_curseforge,
    p.downloads_direct,
    p.downloads_modrinth + p.downloads_curseforge + p.downloads_direct as downloads_total,
    p.followers,
    p.published_at,
    p.external_updated_at,
    p.synced_at,
    p.created_at,
    p.updated_at,
    (
      p.source = 'odsens'
      and not exists (select 1 from public.project_links l where l.project_id = p.id)
    ) as is_exclusive
  from public.projects p
  left join public.project_overrides o on o.project_id = p.id
  where p.status = 'published'
    and not coalesce(o.hidden, false);

revoke all on table public.projects_public from public, anon, authenticated, service_role;
grant select on table public.projects_public to anon, authenticated, service_role;
