-- 20260827090000_projects.sql — slice S1.2 (Projects, synced), docs/build/00-build-plan.md "S1.2 — Projects (synced)".
-- One concern (01 INV-06): the `projects` table (data-model §2.2) + its enums, RLS, indexes and the
-- shared visibility helper `project_is_visible()` used by every S1.2 policy (data-model §4 row
-- "projects / versions / files / links / overrides"; 05 T-RLS-16..21).
-- The `projects_public` view lands in 20260827090300 (it joins `project_overrides`, created in
-- 20260827090200 — SQL views cannot reference tables that do not exist yet).
-- Idempotent: `if not exists` / `create or replace` / `drop … if exists` throughout.
-- Reversibility (drop children first: project_versions/project_files, project_links/project_overrides,
-- view projects_public — see their migrations):
--   drop function if exists public.project_is_visible(uuid);
--   drop table if exists public.projects;
--   drop type if exists public.project_status, public.project_type, public.project_source;

-- ---------------------------------------------------------------------------------------------
-- Enums (data-model §2.2): source `modrinth|odsens`, project_type `mod|datapack|resourcepack|plugin`,
-- status `draft|published|hidden`.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.project_source as enum ('modrinth', 'odsens');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.project_type as enum ('mod', 'datapack', 'resourcepack', 'plugin');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.project_status as enum ('draft', 'published', 'hidden');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.projects — one table for both sources (data-model §2.2, Principle 1). Sync-owned columns
-- are rewritten by `syncModrinth`/`syncCurseforge` (upsert key `(source, external_id)`); Oliver's
-- curation lives in `project_overrides` (Principle 2). `search` is generated from title+description
-- (unused by v1 pages — 00 S1.2 "search = client-side substring"). `gallery` defaults to `[]` because
-- `createExclusiveProject` (04 §1.4) inserts without it.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.projects (
  id                   uuid primary key default gen_random_uuid(),
  source               public.project_source not null,
  external_id          text,
  slug                 extensions.citext not null unique,
  project_type         public.project_type not null,
  title                text not null,
  description          text not null,
  body_md              text not null,
  icon_url             text,
  gallery              jsonb not null default '[]'::jsonb,
  categories           text[] not null,
  loaders              text[] not null,
  game_versions        text[] not null,
  license              text,
  source_url           text,
  issues_url           text,
  discord_url          text,
  downloads_modrinth   integer not null default 0,
  downloads_curseforge integer not null default 0,
  downloads_direct     integer not null default 0,
  followers            integer not null default 0,
  published_at         timestamptz,
  external_updated_at  timestamptz,
  status               public.project_status not null default 'published',
  synced_at            timestamptz,
  search               tsvector generated always as
                         (to_tsvector('english', title || ' ' || description)) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint projects_source_external_id_key unique (source, external_id)
);

comment on table public.projects is
  'Modrinth-synced and odsens-exclusive projects in one shape (data-model §2.2). Visibility = status=published and not overrides.hidden.';

-- Indexes (00 S1.2 Scope IN: `slug`, `status`, `(source, external_id)`; slug and (source, external_id)
-- are the unique constraints above).
create index if not exists projects_status_idx on public.projects (status);

-- ---------------------------------------------------------------------------------------------
-- public.project_is_visible(p_project_id) — the data-model §4 visibility predicate in one place:
-- `status='published' and not coalesce(overrides.hidden, false)`. SECURITY DEFINER on purpose:
-- `projects` policies must consult `project_overrides` (T-RLS-18) while `project_overrides`
-- policies must consult `projects` (T-RLS-39/40) — plain cross-referencing policies recurse
-- (SQLSTATE 42P17), so both sides read through this definer helper instead. plpgsql resolves table
-- references lazily at first execution (same pattern as is_admin() before `profiles` existed), so
-- creating it here, two migrations before `project_overrides`, is fine.
-- ---------------------------------------------------------------------------------------------
create or replace function public.project_is_visible(p_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.projects p
    left join public.project_overrides o on o.project_id = p.id
    where p.id = p_project_id
      and p.status = 'published'
      and not coalesce(o.hidden, false)
  );
end;
$$;

revoke all on function public.project_is_visible(uuid) from public;
grant execute on function public.project_is_visible(uuid) to anon, authenticated, service_role;

-- Privileges (same revoke-first pattern as profiles). anon reads the grid under RLS; write
-- privileges for authenticated are gated to admin by the policies below; sync writes use
-- service_role (bypasses RLS).
revoke all on table public.projects from public, anon, authenticated, service_role;
grant select on table public.projects to anon, authenticated;
grant insert, update, delete on table public.projects to authenticated;
grant all on table public.projects to service_role;

-- RLS (01 INV-28 — same file as the table). Matrix: 05 T-RLS-16..21.
-- select: visible to all, admin sees all · insert/update: admin (exclusives) / service (sync) ·
-- delete: admin (data-model §4).
alter table public.projects enable row level security;

drop policy if exists projects_select_visible_or_admin on public.projects;
create policy projects_select_visible_or_admin
  on public.projects
  for select
  to anon, authenticated
  using (public.project_is_visible(id) or public.is_admin());

drop policy if exists projects_insert_admin on public.projects;
create policy projects_insert_admin
  on public.projects
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists projects_update_admin on public.projects;
create policy projects_update_admin
  on public.projects
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists projects_delete_admin on public.projects;
create policy projects_delete_admin
  on public.projects
  for delete
  to authenticated
  using (public.is_admin());

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
