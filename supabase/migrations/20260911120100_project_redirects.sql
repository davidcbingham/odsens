-- 20260911120100_project_redirects.sql — slice S1.5a (Cross-posted projects), ADR-0037 Decision 4
-- + Decision 9 (05 T-RLS-136; 00 S1.5a.AC3 "the old URL resolves to the canonical page"; registry
-- Table registry). One concern (01 INV-06): the table `project_redirects` that keeps a folded
-- project's slug resolving — `fold_project` (20260911120300) upserts `(old_slug → canonical id)` and
-- `/projects/[slug]` (`resolveProjectPage`, lib/data/projects.ts) issues `permanentRedirect` to the
-- canonical slug before any `notFound()`. A live `projects.slug` always wins over a redirect row
-- (projects are read first); `createExclusiveProject` / `updateExclusiveProject` refuse a slug present
-- here (`conflict`). Redirect rows never appear in the sitemap. `old_slug` is citext like
-- `projects.slug` (case-insensitive, one row per old slug). The FK cascade removes the redirect with
-- its canonical project (nothing would resolve anyway). FK index per the ADR-0030 D11 precedent
-- (20260903120300_fk_indexes.sql).
-- Grants (revoke-first house pattern; ADR-0037 D4 verbatim): select anon + authenticated; all to
-- service_role; NO JWT write grant — the fold RPC (service) is the only writer. RLS on with one
-- select policy: visible-or-admin, so a redirect never reveals a draft / hidden target (the
-- security-reviewer line of ADR-0037 "Gate impact").
-- Idempotent: `if not exists` / `drop … if exists` throughout.
-- Reversibility (the old-slug map is lost — folded URLs 404 afterwards):
--   drop table if exists public.project_redirects;

create table if not exists public.project_redirects (
  old_slug   extensions.citext primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.project_redirects is
  'Old project slugs → the canonical project after a fold (ADR-0037 D4). Written only by fold_project.';

-- FK index (ADR-0030 D11 precedent): the cascade from `projects` and "redirects of this project"
-- reads never scan the table.
create index if not exists project_redirects_project_id_idx
  on public.project_redirects (project_id);

-- Privileges (ADR-0037 D4 verbatim). Matrix: 05 T-RLS-136 — select visible-or-admin; insert/update/
-- delete denied to every JWT role (no grant, no policy); service_role all.
revoke all on table public.project_redirects from public, anon, authenticated, service_role;
grant select on table public.project_redirects to anon, authenticated;
grant all on table public.project_redirects to service_role;

alter table public.project_redirects enable row level security;

drop policy if exists project_redirects_select_visible_or_admin on public.project_redirects;
create policy project_redirects_select_visible_or_admin
  on public.project_redirects
  for select
  to anon, authenticated
  using (public.project_is_visible(project_id) or public.is_admin());

-- No insert / update / delete policy on purpose: the fold writes through service_role (T-RLS-136).
