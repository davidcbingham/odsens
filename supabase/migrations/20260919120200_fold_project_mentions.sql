-- 20260919120200_fold_project_mentions.sql — slice S1.8 (Seen on), ADR-0045 (mentions follow a
-- fold; 05 T-ACT-81 mentions leg, T-RLS-137 grants unchanged). One concern (01 INV-06):
-- `create or replace` of the S1.5a RPC `fold_project(p_duplicate_id, p_canonical_id)` so a fold
-- carries the duplicate's `mentions` onto the canonical row.
--
-- Why: `mentions.project_id` (20260919120000) is `on delete set null` — a mention is on the 01 INV-24
-- never-deleted list and the ADR-0037 D3 fold exception names only the duplicate `projects` row, the
-- merged `project_versions` rows and CDN-only sha512-duplicate `project_files` rows. Left alone,
-- step (h) of the fold would silently turn every mention of the folded listing into "About OddSense
-- generally" (the ODSENS chip, no SEEN ON row on the canonical project). A `source='modrinth'` row
-- with curated mentions is exactly the foldable kind.
--
-- The body below is 20260911120300_fold_project.sql VERBATIM (read that header for the (a)–(h)
-- contract, preconditions and the merge order) plus ONE added statement, step (g2), between (g) and
-- (h): `update public.mentions set project_id = canonical where project_id = duplicate`. `featured`,
-- `sort_order`, `status` ride the row untouched. The returned jsonb keeps its nine ADR-0037 D3 keys
-- (no `mentions_moved` — `linkProjectListing` and T-ACT-81 pin the shape).
-- Signature, `returns jsonb`, plpgsql, `volatile`, `security definer`, `search_path = public`
-- (01 INV-49) and the grants are unchanged (T-RLS-137): revoked from every role, EXECUTE to
-- `service_role` only — re-stated here so the file stands alone.
-- Idempotent: `create or replace`; grants revoked and re-stated.
-- Reversibility (no data): re-run the `create or replace function` statement of
-- 20260911120300_fold_project.sql.

create or replace function public.fold_project(p_duplicate_id uuid, p_canonical_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_dup                    public.projects%rowtype;
  v_can                    public.projects%rowtype;
  v_version                public.project_versions%rowtype;
  v_file                   public.project_files%rowtype;
  v_link                   public.project_links%rowtype;
  v_dup_overrides          public.project_overrides%rowtype;
  v_target_id              uuid;
  v_match_id               uuid;
  v_versions_moved         integer := 0;
  v_versions_merged        integer := 0;
  v_files_moved            integer := 0;
  v_files_deduped          integer := 0;
  v_comments_moved         integer := 0;
  v_downloads_moved        integer := 0;
  v_downloads_direct_moved integer := 0;
  v_links_moved            integer := 0;
begin
  -- ---- Preconditions (nothing written before these pass) ------------------------------------
  if p_duplicate_id is null or p_canonical_id is null then
    raise exception 'Both projects are needed to fold.' using errcode = 'P0002';
  end if;
  if p_duplicate_id = p_canonical_id then
    raise exception 'A project cannot be folded into itself.' using errcode = 'P0002';
  end if;

  select * into v_dup from public.projects where id = p_duplicate_id for update;
  if not found then
    raise exception 'That duplicate project is gone already.' using errcode = 'P0002';
  end if;
  select * into v_can from public.projects where id = p_canonical_id for update;
  if not found then
    raise exception 'That project could not be found.' using errcode = 'P0002';
  end if;
  if v_dup.source <> 'modrinth' then
    raise exception 'Only a project synced from Modrinth can be folded.' using errcode = 'P0002';
  end if;
  if v_can.source <> 'odsens' then
    raise exception 'A listing can only be folded into an odsens project.' using errcode = 'P0002';
  end if;

  -- ---- (a) merge + (b) move: every duplicate version, one at a time ---------------------------
  -- Order: by version_number, then the same-numbered duplicate sharing a sha512 with the canonical
  -- hosted version first (D2 tie-break), then newest first. A version merged earlier in the loop
  -- gives the canonical row its external_id, so a later same-numbered duplicate finds no
  -- `external_id IS NULL` target and is moved instead. A synced version the sync already
  -- re-parented onto the canonical (a failed fold, then an hourly run) joins the loop when a
  -- hosted row of its number is still there; with no target it is left where it is.
  for v_version in
    select v.*
    from public.project_versions v
    where v.project_id = p_duplicate_id
       or (
         v.project_id = p_canonical_id
         and v.external_id is not null
         -- … only when it belongs to the listing being folded (a synced file row's CDN url names
         -- its listing id) — an un-adopt leftover from another listing is never glued onto a
         -- hosted row here (it follows its own listing on the next run).
         and exists (
           select 1
           from public.project_files lf
           where lf.version_id = v.id
             and lf.url like 'https://cdn.modrinth.com/data/' || v_dup.external_id || '/%'
         )
         and exists (
           select 1
           from public.project_versions hv
           where hv.project_id = p_canonical_id
             and hv.external_id is null
             and hv.version_number = v.version_number
         )
       )
    order by
      v.version_number,
      (
        exists (
          select 1
          from public.project_files df
          join public.project_versions cv
            on cv.project_id = p_canonical_id
           and cv.external_id is null
           and cv.version_number = v.version_number
          join public.project_files cf on cf.version_id = cv.id
          where df.version_id = v.id
            and df.sha512 is not null
            and df.sha512 = cf.sha512
        )
      ) desc,
      v.date_published desc,
      v.id
  loop
    v_target_id := null;
    select cv.id
      into v_target_id
    from public.project_versions cv
    where cv.project_id = p_canonical_id
      and cv.external_id is null
      and cv.version_number = v_version.version_number;

    if v_target_id is not null then
      -- (a) merge: files first (CDN-only sha512 duplicates dropped, everything else moved) …
      for v_file in
        select f.*
        from public.project_files f
        where f.version_id = v_version.id
        order by f.created_at, f.id
      loop
        v_match_id := null;
        if v_file.storage_path is null and v_file.sha512 is not null then
          select cf.id
            into v_match_id
          from public.project_files cf
          where cf.version_id = v_target_id
            and cf.sha512 = v_file.sha512
          order by cf.created_at, cf.id
          limit 1;
        end if;

        if v_match_id is not null then
          -- The same bytes live in both homes: the canonical row gains the CDN url (when it had
          -- none), the CDN-only duplicate row goes (the D3 exception).
          update public.project_files
             set url = coalesce(url, v_file.url)
           where id = v_match_id;
          delete from public.project_files where id = v_file.id;
          v_files_deduped := v_files_deduped + 1;
        else
          update public.project_files
             set version_id = v_target_id,
                 "primary" = (
                   v_file."primary"
                   and not exists (
                     select 1
                     from public.project_files pf
                     where pf.version_id = v_target_id
                       and pf."primary"
                       and (pf.storage_path is not null) = (v_file.storage_path is not null)
                   )
                 )
           where id = v_file.id;
          v_files_moved := v_files_moved + 1;
        end if;
      end loop;

      -- … then the duplicate version row goes (frees its external_id under the plain unique) …
      delete from public.project_versions where id = v_version.id;

      -- … then the canonical row takes the saved external_id (when not null) + sync-owned columns.
      update public.project_versions
         set external_id    = coalesce(v_version.external_id, external_id),
             name           = v_version.name,
             changelog_md   = v_version.changelog_md,
             game_versions  = v_version.game_versions,
             loaders        = v_version.loaders,
             version_type   = v_version.version_type,
             date_published = v_version.date_published,
             downloads      = v_version.downloads
       where id = v_target_id;
      v_versions_merged := v_versions_merged + 1;
    elsif v_version.project_id = p_duplicate_id then
      -- (b) move: the version row follows its listing; `primary` per home, canonical wins.
      update public.project_versions
         set project_id = p_canonical_id
       where id = v_version.id;
      v_versions_moved := v_versions_moved + 1;
    end if;
    -- (a synced row already on the canonical whose hosted twin an earlier merge took stays put)
  end loop;

  -- ---- (c) project_links: re-parent unless the canonical already has that platform -----------
  for v_link in
    select l.*
    from public.project_links l
    where l.project_id = p_duplicate_id
    order by l.platform
  loop
    if exists (
      select 1
      from public.project_links c
      where c.project_id = p_canonical_id
        and c.platform = v_link.platform
    ) then
      delete from public.project_links
       where project_id = p_duplicate_id
         and platform = v_link.platform;
    else
      update public.project_links
         set project_id = p_canonical_id
       where project_id = p_duplicate_id
         and platform = v_link.platform;
      v_links_moved := v_links_moved + 1;
      if v_link.platform = 'curseforge' then
        update public.projects
           set downloads_curseforge = v_link.downloads
         where id = p_canonical_id;
      end if;
    end if;
  end loop;

  -- ---- (d) comments: re-target (likes / reports ride the comment ids) -------------------------
  update public.comments
     set target_id = p_canonical_id
   where target_type = 'project'
     and target_id = p_duplicate_id;
  get diagnostics v_comments_moved = row_count;

  -- ---- (e) project_downloads + downloads_direct carried ---------------------------------------
  update public.project_downloads
     set project_id = p_canonical_id
   where project_id = p_duplicate_id;
  get diagnostics v_downloads_moved = row_count;

  v_downloads_direct_moved := v_dup.downloads_direct;
  update public.projects
     set downloads_direct = downloads_direct + v_dup.downloads_direct
   where id = p_canonical_id;

  -- ---- (f) project_overrides: re-key or merge (canonical wins where non-default) --------------
  select * into v_dup_overrides
  from public.project_overrides
  where project_id = p_duplicate_id;
  if found then
    if not exists (select 1 from public.project_overrides where project_id = p_canonical_id) then
      update public.project_overrides
         set project_id = p_canonical_id
       where project_id = p_duplicate_id;
    else
      update public.project_overrides c
         set featured             = c.featured or v_dup_overrides.featured,
             featured_order       = coalesce(c.featured_order, v_dup_overrides.featured_order),
             hidden               = c.hidden or v_dup_overrides.hidden,
             title_override       = coalesce(c.title_override, v_dup_overrides.title_override),
             description_override = coalesce(c.description_override,
                                             v_dup_overrides.description_override),
             extra_gallery        = coalesce(c.extra_gallery, '[]'::jsonb)
                                    || coalesce(v_dup_overrides.extra_gallery, '[]'::jsonb),
             notes_md             = coalesce(c.notes_md, v_dup_overrides.notes_md),
             comments_enabled     = c.comments_enabled and v_dup_overrides.comments_enabled
       where c.project_id = p_canonical_id;
      delete from public.project_overrides where project_id = p_duplicate_id;
    end if;
  end if;

  -- ---- (g) project_redirects: the old slug keeps resolving ------------------------------------
  update public.project_redirects
     set project_id = p_canonical_id
   where project_id = p_duplicate_id;
  insert into public.project_redirects (old_slug, project_id)
  values (v_dup.slug, p_canonical_id)
  on conflict (old_slug) do update set project_id = excluded.project_id;

  -- ---- (g2) mentions: re-parent (S1.8, ADR-0045 — a mention is never deleted, 01 INV-24) -------
  -- Without this the `on delete set null` FK would turn each one into "about OddSense generally"
  -- at (h). Not counted in the returned jsonb (its keys are the ADR-0037 D3 contract).
  update public.mentions
     set project_id = p_canonical_id
   where project_id = p_duplicate_id;

  -- ---- (h) the duplicate projects row goes (children moved above) -----------------------------
  delete from public.projects where id = p_duplicate_id;

  return jsonb_build_object(
    'versions_moved',         v_versions_moved,
    'versions_merged',        v_versions_merged,
    'files_moved',            v_files_moved,
    'files_deduped',          v_files_deduped,
    'comments_moved',         v_comments_moved,
    'downloads_moved',        v_downloads_moved,
    'downloads_direct_moved', v_downloads_direct_moved,
    'links_moved',            v_links_moved,
    'redirect_slug',          v_dup.slug::text
  );
end;
$$;

revoke all on function public.fold_project(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.fold_project(uuid, uuid) to service_role;
