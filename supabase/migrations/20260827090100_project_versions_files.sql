-- 20260827090100_project_versions_files.sql — slice S1.2 (Projects, synced), docs/build/00-build-plan.md
-- "S1.2 — Projects (synced)". One concern (01 INV-06): the per-version tables `project_versions` +
-- `project_files` (data-model §2.2) with enum `version_type`, RLS (data-model §4; 05 T-RLS-24..33)
-- and FK indexes. `project_files."primary"` keeps the data-model column name — quoted identifier
-- (reserved word), no rename.
-- Idempotent: `if not exists` / `drop … if exists` throughout.
-- Reversibility:
--   drop table if exists public.project_files;
--   drop table if exists public.project_versions;
--   drop type if exists public.version_type;

-- ---------------------------------------------------------------------------------------------
-- Enum (data-model §2.2): version_type `release|beta|alpha`. Unknown upstream values are mapped to
-- 'release' by the adapter (`mapVersion`, ADR-0002 #77) — never at the DB layer.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.version_type as enum ('release', 'beta', 'alpha');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.project_versions — one per version (Modrinth version or exclusive release), data-model §2.2.
-- Upstream-removed versions are kept (ADR-0002 #66) — sync never deletes rows here.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.project_versions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  external_id    text,
  version_number text not null,
  name           text,
  changelog_md   text,
  game_versions  text[] not null,
  loaders        text[] not null,
  version_type   public.version_type not null,
  date_published timestamptz not null,
  downloads      integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint project_versions_project_id_version_number_key unique (project_id, version_number)
);

comment on table public.project_versions is
  'One row per project version (data-model §2.2); visible when the parent project is (T-RLS-24/25).';

-- FK index (00 S1.2 Scope IN indexes note; the unique (project_id, version_number) already leads
-- on project_id — this explicit index keeps the FK lookup independent of that constraint).
create index if not exists project_versions_project_id_idx on public.project_versions (project_id);

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-24..28.
revoke all on table public.project_versions from public, anon, authenticated, service_role;
grant select on table public.project_versions to anon, authenticated;
grant insert, update, delete on table public.project_versions to authenticated;
grant all on table public.project_versions to service_role;

alter table public.project_versions enable row level security;

drop policy if exists project_versions_select_visible_or_admin on public.project_versions;
create policy project_versions_select_visible_or_admin
  on public.project_versions
  for select
  to anon, authenticated
  using (public.project_is_visible(project_id) or public.is_admin());

drop policy if exists project_versions_insert_admin on public.project_versions;
create policy project_versions_insert_admin
  on public.project_versions
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists project_versions_update_admin on public.project_versions;
create policy project_versions_update_admin
  on public.project_versions
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists project_versions_delete_admin on public.project_versions;
create policy project_versions_delete_admin
  on public.project_versions
  for delete
  to authenticated
  using (public.is_admin());

drop trigger if exists project_versions_set_updated_at on public.project_versions;
create trigger project_versions_set_updated_at
  before update on public.project_versions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- public.project_files — files per version (data-model §2.2). Synced files carry `url` (Modrinth
-- CDN); exclusives carry `storage_path` (bucket `project-files`, S1.3) and `download_count`
-- (incremented only by RPC `record_download`, S1.3).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.project_files (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.project_versions (id) on delete cascade,
  filename       text not null,
  size_bytes     bigint not null,
  sha512         text,
  url            text,
  storage_path   text,
  "primary"      boolean not null default false,
  download_count integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.project_files is
  'Files per version (data-model §2.2). "primary" is the data-model name, quoted (reserved word).';

-- FK index (00 S1.2 Scope IN indexes note).
create index if not exists project_files_version_id_idx on public.project_files (version_id);

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-29..33. The select policy joins up through
-- project_versions (its own RLS applies inside the subquery and agrees with the predicate).
revoke all on table public.project_files from public, anon, authenticated, service_role;
grant select on table public.project_files to anon, authenticated;
grant insert, update, delete on table public.project_files to authenticated;
grant all on table public.project_files to service_role;

alter table public.project_files enable row level security;

drop policy if exists project_files_select_visible_or_admin on public.project_files;
create policy project_files_select_visible_or_admin
  on public.project_files
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.project_versions v
      where v.id = version_id
        and public.project_is_visible(v.project_id)
    )
    or public.is_admin()
  );

drop policy if exists project_files_insert_admin on public.project_files;
create policy project_files_insert_admin
  on public.project_files
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists project_files_update_admin on public.project_files;
create policy project_files_update_admin
  on public.project_files
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists project_files_delete_admin on public.project_files;
create policy project_files_delete_admin
  on public.project_files
  for delete
  to authenticated
  using (public.is_admin());

drop trigger if exists project_files_set_updated_at on public.project_files;
create trigger project_files_set_updated_at
  before update on public.project_files
  for each row execute function public.set_updated_at();
