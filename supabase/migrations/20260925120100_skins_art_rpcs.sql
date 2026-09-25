-- 20260925120100_skins_art_rpcs.sql — slice S1.7 (Skins + Art), docs/build/00-build-plan.md
-- "S1.7 — Skins + Art"; ADR-0048 (D5). One concern (01 INV-06): the three RPCs the S1.7 server
-- code issues through the service client — every one service_role only, `security definer` +
-- `search_path = public` (01 INV-49), VOLATILE (they write); 05 T-RLS-129 grants + behaviour.
--
--   record_skin_download(p_skin_id uuid) returns void
--     04 §2.3 D4 for kind `skin` (ADR-0002 C8; data-model §2.4): `skins.downloads + 1` for a
--     PUBLISHED skin, in one statement. No row matched (unknown id, or a draft) → raises — the
--     `record_download` fail-closed twin (20260827200100): `/api/download/[fileId]` resolves
--     visibility first (`resolveDownloadable`), this is the backstop, and the route maps the raise
--     to 500 `internal` (T-ACT-76). No log table: skin downloads are a counter only (data-model
--     §2.4 — `project_downloads` is the exclusive-file log, not a skin one).
--
--   reorder_skins(p_items jsonb) / reorder_art(p_items jsonb) returns integer
--     Copies of `reorder_mentions` (20260919120100) over `skins` / `art`: `updateSkin({ reorder })`
--     / `updateArt({ reorder })` (04 §1.5) set every listed row's `sort_order` in ONE
--     `update … from jsonb_to_recordset(p_items)` statement (ADR-0002 A11: one call, one
--     revalidate). `p_items` = the action's validated array, verbatim: `[{ "id": uuid,
--     "sort_order": int }]` (≤ 200 items). Only `sort_order` is written; `status` and the rest are
--     untouched. Returns the number of rows reordered. Nothing is half-applied — plpgsql, so any
--     raise rolls the whole call back:
--       * a listed id that is not a row → P0002 with a plain message (the action → `not_found`);
--       * a payload the schema would never send (not a JSON array; an item without `id` or
--         `sort_order`; one id listed twice) → 22023 (the action lets it surface as `internal`).
--     An empty array is a no-op → 0.
--
-- Grants = the `fold_project` / `reorder_mentions` pattern: revoked from every role (the Supabase
-- default-ACL lesson, 20260903120200), EXECUTE to `service_role` only — the actions and the route
-- call them through the service client after their own auth check; no JWT role can reach them.
-- Idempotent: `create or replace`; grants revoked and re-stated.
-- Reversibility (no data): drop function if exists public.reorder_art(jsonb);
--   drop function if exists public.reorder_skins(jsonb);
--   drop function if exists public.record_skin_download(uuid);

-- ---------------------------------------------------------------------------------------------
-- record_skin_download
-- ---------------------------------------------------------------------------------------------
create or replace function public.record_skin_download(p_skin_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.skins
     set downloads = downloads + 1
   where id = p_skin_id
     and status = 'published';
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'record_skin_download: unknown or unpublished skin %', p_skin_id;
  end if;
end;
$$;

comment on function public.record_skin_download(uuid) is
  'S1.7: skins.downloads + 1 for a PUBLISHED skin (04 §2.3 D4, kind skin — ADR-0002 C8). Raises on an unknown or draft id (fail-closed). service_role only.';

revoke all on function public.record_skin_download(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_skin_download(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- reorder_skins
-- ---------------------------------------------------------------------------------------------
create or replace function public.reorder_skins(p_items jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_listed   integer;
  v_distinct integer;
  v_updated  integer;
begin
  -- ---- Payload shape (nothing written before these pass) --------------------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'reorder_skins: p_items must be a JSON array of {id, sort_order}.'
      using errcode = '22023';
  end if;

  select count(*), count(distinct i.id)
    into v_listed, v_distinct
  from jsonb_to_recordset(p_items) as i (id uuid, sort_order integer);

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as i (id uuid, sort_order integer)
    where i.id is null or i.sort_order is null
  ) then
    raise exception 'reorder_skins: every item needs an id and a sort_order.'
      using errcode = '22023';
  end if;
  if v_distinct <> v_listed then
    raise exception 'reorder_skins: a skin is listed twice.' using errcode = '22023';
  end if;

  -- ---- The reorder: one statement over every listed row ---------------------------------------
  update public.skins s
     set sort_order = i.sort_order
    from jsonb_to_recordset(p_items) as i (id uuid, sort_order integer)
   where s.id = i.id;
  get diagnostics v_updated = row_count;

  -- A listed id matched no row: raise, so the rows that did match roll back with it.
  if v_updated <> v_listed then
    raise exception 'One of those skins could not be found.' using errcode = 'P0002';
  end if;

  return v_updated;
end;
$$;

comment on function public.reorder_skins(jsonb) is
  'S1.7: sets skins.sort_order for every {id, sort_order} item in ONE statement (04 §1.5 updateSkin reorder). P0002 when a listed id is missing — nothing applied. service_role only.';

revoke all on function public.reorder_skins(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.reorder_skins(jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- reorder_art
-- ---------------------------------------------------------------------------------------------
create or replace function public.reorder_art(p_items jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_listed   integer;
  v_distinct integer;
  v_updated  integer;
begin
  -- ---- Payload shape (nothing written before these pass) --------------------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'reorder_art: p_items must be a JSON array of {id, sort_order}.'
      using errcode = '22023';
  end if;

  select count(*), count(distinct i.id)
    into v_listed, v_distinct
  from jsonb_to_recordset(p_items) as i (id uuid, sort_order integer);

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as i (id uuid, sort_order integer)
    where i.id is null or i.sort_order is null
  ) then
    raise exception 'reorder_art: every item needs an id and a sort_order.'
      using errcode = '22023';
  end if;
  if v_distinct <> v_listed then
    raise exception 'reorder_art: a piece is listed twice.' using errcode = '22023';
  end if;

  -- ---- The reorder: one statement over every listed row ---------------------------------------
  update public.art a
     set sort_order = i.sort_order
    from jsonb_to_recordset(p_items) as i (id uuid, sort_order integer)
   where a.id = i.id;
  get diagnostics v_updated = row_count;

  -- A listed id matched no row: raise, so the rows that did match roll back with it.
  if v_updated <> v_listed then
    raise exception 'One of those pieces could not be found.' using errcode = 'P0002';
  end if;

  return v_updated;
end;
$$;

comment on function public.reorder_art(jsonb) is
  'S1.7: sets art.sort_order for every {id, sort_order} item in ONE statement (04 §1.5 updateArt reorder). P0002 when a listed id is missing — nothing applied. service_role only.';

revoke all on function public.reorder_art(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.reorder_art(jsonb) to service_role;
