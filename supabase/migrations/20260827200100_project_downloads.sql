-- S1.3 — project_downloads + RPCs record_download / purge_project_downloads
-- (docs/data-model.md §2.2 "project_downloads", §2.11; 04 §2.3 D4; ADR-0002 #75, C13).
-- One concern: the direct-download log and its counters.
-- project_downloads is the raw log for exclusive direct downloads (stats + abuse checks).
-- Rows hold HMAC hashes only (lib/hash.ts, SC-17) — never raw IP/UA. Written only by the
-- security-definer RPC record_download (service role); purged after 90 days by
-- purge_project_downloads from the S1.9 stats job.
-- Reversibility: drop the two functions, then the table.

create table if not exists public.project_downloads (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  file_id    uuid not null references public.project_files (id) on delete cascade,
  ip_hash    text not null,
  ua_hash    text not null,
  created_at timestamptz not null default now()
);

-- Aggregation reads scan per project and day; the purge scans by age alone.
create index if not exists project_downloads_project_id_created_at_idx
  on public.project_downloads (project_id, created_at);
create index if not exists project_downloads_created_at_idx
  on public.project_downloads (created_at);
create index if not exists project_downloads_file_id_idx
  on public.project_downloads (file_id);

-- Grants (revoke-first house pattern): data-model §4 — select admin; insert/update
-- service role only (no JWT grant at all); delete admin (manual) / service (purge).
revoke all on table public.project_downloads from public, anon, authenticated, service_role;
grant select, delete on table public.project_downloads to authenticated;
grant all on table public.project_downloads to service_role;

alter table public.project_downloads enable row level security;

drop policy if exists project_downloads_select_admin on public.project_downloads;
create policy project_downloads_select_admin
  on public.project_downloads
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists project_downloads_delete_admin on public.project_downloads;
create policy project_downloads_delete_admin
  on public.project_downloads
  for delete
  to authenticated
  using (public.is_admin());

-- No insert or update policy: those paths are service-role only (T-RLS-45/46).

-- record_download(p_file_id, p_ip_hash, p_ua_hash) — 04 §2.3 D4: counters + log in one
-- SQL statement (single transaction): project_files.download_count + 1,
-- projects.downloads_direct + 1, one project_downloads row. Fails (raises) on an unknown
-- file or a synced file (storage_path IS NULL) — the route resolves visibility first
-- (lib/files.ts resolveDownloadable), this is the fail-closed backstop.
create or replace function public.record_download(
  p_file_id uuid,
  p_ip_hash text,
  p_ua_hash text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_version_id uuid;
  v_project_id uuid;
begin
  update public.project_files
     set download_count = download_count + 1
   where id = p_file_id
     and storage_path is not null
  returning version_id into v_version_id;

  if v_version_id is null then
    raise exception 'record_download: unknown or non-direct file %', p_file_id;
  end if;

  select v.project_id
    into v_project_id
  from public.project_versions v
  where v.id = v_version_id;

  update public.projects
     set downloads_direct = downloads_direct + 1
   where id = v_project_id;

  insert into public.project_downloads (project_id, file_id, ip_hash, ua_hash)
  values (v_project_id, p_file_id, p_ip_hash, p_ua_hash);
end;
$$;

revoke all on function public.record_download(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_download(uuid, text, text) to service_role;

-- purge_project_downloads(p_days) — housekeeping twin of purge_rate_limit_hits;
-- called by the S1.9 stats job as purge_project_downloads(90).
create or replace function public.purge_project_downloads(p_days integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.project_downloads
  where created_at < now() - make_interval(days => p_days);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_project_downloads(integer) from public, anon, authenticated;
grant execute on function public.purge_project_downloads(integer) to service_role;
