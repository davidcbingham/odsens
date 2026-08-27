-- 20260827090300_projects_public_view.sql — slice S1.2 (Projects, synced), docs/build/00-build-plan.md
-- "S1.2 — Projects (synced)". One concern (01 INV-06): the public read surface `projects_public`
-- (00 §4.2 row S1.2; registry Table registry) — created after `project_overrides` (20260827090200)
-- because the view joins it.
-- Idempotent: `create or replace` throughout.
-- Reversibility: drop view if exists public.projects_public;

-- ---------------------------------------------------------------------------------------------
-- public.projects_public — the ISR/public read of `projects` (01 INV-15; 02 §0.1). Definer view on
-- purpose (same as public_profiles): the WHERE clause is the whole visibility rule, so every role —
-- including admin JWTs — sees only published, non-hidden rows through it (05 T-RLS-22; admin reads
-- drafts from the base table). Applies `title_override`/`description_override` (02 §2.2) and derives
-- `downloads_total = downloads_modrinth + downloads_curseforge + downloads_direct` (data-model §2.2
-- "view column"; 00 S1.2.AC6; T-RLS-23). Never expose `status` (constant here) or `search`
-- (unused by v1 pages); no profile/auth columns exist to leak (01 INV-97).
-- ---------------------------------------------------------------------------------------------
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
    p.updated_at
  from public.projects p
  left join public.project_overrides o on o.project_id = p.id
  where p.status = 'published'
    and not coalesce(o.hidden, false);

revoke all on table public.projects_public from public, anon, authenticated, service_role;
grant select on table public.projects_public to anon, authenticated, service_role;
