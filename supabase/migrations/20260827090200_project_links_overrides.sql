-- 20260827090200_project_links_overrides.sql — slice S1.2 (Projects, synced), docs/build/00-build-plan.md
-- "S1.2 — Projects (synced)". One concern (01 INV-06): the curation side tables `project_links`
-- (cross-posting map, enum `link_platform`, composite PK per data-model §2.2 — the stated exception
-- to the uuid-PK convention, 01 INV-97) + `project_overrides` (Oliver's curation, PK = project_id),
-- with RLS per data-model §4 (05 T-RLS-34..43). created_at/updated_at follow the data-model header
-- convention ("on every table") even though the §2.2 column rows omit them.
-- Idempotent: `if not exists` / `drop … if exists` throughout.
-- Reversibility:
--   drop table if exists public.project_overrides;
--   drop table if exists public.project_links;
--   drop type if exists public.link_platform;

-- ---------------------------------------------------------------------------------------------
-- Enum (data-model §2.2): platform `modrinth|curseforge`.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.link_platform as enum ('modrinth', 'curseforge');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.project_links — cross-posting map, maintained by Oliver in admin (`setProjectLink`,
-- manual CurseForge entry — Q39). `syncCurseforge` reads the curseforge rows and writes
-- `downloads` + `projects.downloads_curseforge` (data-model §5).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.project_links (
  project_id  uuid not null references public.projects (id) on delete cascade,
  platform    public.link_platform not null,
  external_id text not null,
  url         text not null,
  downloads   integer not null default 0,
  synced_at   timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (project_id, platform)
);

comment on table public.project_links is
  'Cross-posting map (data-model §2.2); PK (project_id, platform) — the documented composite-PK exception.';

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-34..38 (insert admin only — ADR-0002 C7).
-- The composite PK leads on project_id, so no separate FK index is needed.
revoke all on table public.project_links from public, anon, authenticated, service_role;
grant select on table public.project_links to anon, authenticated;
grant insert, update, delete on table public.project_links to authenticated;
grant all on table public.project_links to service_role;

alter table public.project_links enable row level security;

drop policy if exists project_links_select_visible_or_admin on public.project_links;
create policy project_links_select_visible_or_admin
  on public.project_links
  for select
  to anon, authenticated
  using (public.project_is_visible(project_id) or public.is_admin());

drop policy if exists project_links_insert_admin on public.project_links;
create policy project_links_insert_admin
  on public.project_links
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists project_links_update_admin on public.project_links;
create policy project_links_update_admin
  on public.project_links
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists project_links_delete_admin on public.project_links;
create policy project_links_delete_admin
  on public.project_links
  for delete
  to authenticated
  using (public.is_admin());

drop trigger if exists project_links_set_updated_at on public.project_links;
create trigger project_links_set_updated_at
  before update on public.project_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- public.project_overrides — Oliver's curation on top of any project (data-model §2.2, Principle 2:
-- sync never touches this table). `featured`/`hidden`/`extra_gallery`/`comments_enabled` carry
-- defaults so `curateProject`'s partial upserts (04 §1.4) insert cleanly. `comments_enabled` is
-- consumed by `can_comment()` from S1.4; the column exists from S1.2.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.project_overrides (
  project_id           uuid primary key references public.projects (id) on delete cascade,
  featured             boolean not null default false,
  featured_order       integer,
  hidden               boolean not null default false,
  title_override       text,
  description_override text,
  extra_gallery        jsonb not null default '[]'::jsonb,
  notes_md             text,
  comments_enabled     boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.project_overrides is
  'Curation on top of a project (data-model §2.2). hidden=true removes the project from every public surface.';

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-39..43. Select joins up to the parent project via
-- project_is_visible() (a hidden=true row makes its own project invisible → denied, T-RLS-40);
-- ISR pages read visible rows through the anon server client (01 INV-15).
revoke all on table public.project_overrides from public, anon, authenticated, service_role;
grant select on table public.project_overrides to anon, authenticated;
grant insert, update, delete on table public.project_overrides to authenticated;
grant all on table public.project_overrides to service_role;

alter table public.project_overrides enable row level security;

drop policy if exists project_overrides_select_visible_or_admin on public.project_overrides;
create policy project_overrides_select_visible_or_admin
  on public.project_overrides
  for select
  to anon, authenticated
  using (public.project_is_visible(project_id) or public.is_admin());

drop policy if exists project_overrides_insert_admin on public.project_overrides;
create policy project_overrides_insert_admin
  on public.project_overrides
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists project_overrides_update_admin on public.project_overrides;
create policy project_overrides_update_admin
  on public.project_overrides
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists project_overrides_delete_admin on public.project_overrides;
create policy project_overrides_delete_admin
  on public.project_overrides
  for delete
  to authenticated
  using (public.is_admin());

drop trigger if exists project_overrides_set_updated_at on public.project_overrides;
create trigger project_overrides_set_updated_at
  before update on public.project_overrides
  for each row execute function public.set_updated_at();
