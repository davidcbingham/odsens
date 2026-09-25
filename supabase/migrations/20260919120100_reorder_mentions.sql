-- 20260919120100_reorder_mentions.sql — slice S1.8 (Seen on), ADR-0045 (the reorder RPC; 05
-- T-RLS-129 grants, T-ACT-64 behaviour; registry SQL "RPC reorder_mentions"). One concern
-- (01 INV-06): the RPC `reorder_mentions(p_items jsonb)` that `updateMention({ reorder })` (04 §1.6)
-- issues — "reorder runs in one transaction" (04 §1.6; ADR-0002 A11: one call, one revalidate).
--
-- Why an RPC: PostgREST has no per-row bulk UPDATE, and the built batch pattern — `curateProject`'s
-- partial-row upsert on `project_overrides` — cannot work here: Postgres checks NOT NULL on the
-- proposed insert tuple before ON CONFLICT arbitration, so `upsert([{ id, sort_order }])` raises
-- 23502 on `mentions` (`platform`, `url`, `title`, `creator_name` have no default — and must not
-- get one). Sequential updates would not be one transaction.
--
-- `p_items` = the action's validated `reorder` array, verbatim: `[{ "id": uuid, "sort_order": int }]`
-- (`updateMentionInput`, ≤ 200 items). ONE `update … from jsonb_to_recordset(p_items)` sets every
-- listed row's `sort_order`; `featured` / `status` are not touched. Returns the number of rows
-- reordered (= the number of items). Nothing is half-applied — plpgsql, so any raise rolls the
-- whole call back:
--   * a listed id that is not a `mentions` row → P0002 with a plain message (the action maps it to
--     `not_found`);
--   * a payload the action's schema would never send (not a JSON array; an item without `id` or
--     `sort_order`; one id listed twice) → 22023 (the action lets it surface as `internal`).
-- An empty array is a no-op → 0.
-- `security definer` + `search_path = public` (01 INV-49); `volatile`. Grants = the `fold_project`
-- pattern (20260911120300): revoked from every role (the Supabase default-ACL lesson,
-- 20260903120200), EXECUTE to `service_role` only — the action calls it through the service client
-- after `requireRole('admin')`; no JWT role can reach it.
-- Idempotent: `create or replace`; grants revoked and re-stated.
-- Reversibility (no data): drop function if exists public.reorder_mentions(jsonb);

create or replace function public.reorder_mentions(p_items jsonb)
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
    raise exception 'reorder_mentions: p_items must be a JSON array of {id, sort_order}.'
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
    raise exception 'reorder_mentions: every item needs an id and a sort_order.'
      using errcode = '22023';
  end if;
  if v_distinct <> v_listed then
    raise exception 'reorder_mentions: a mention is listed twice.' using errcode = '22023';
  end if;

  -- ---- The reorder: one statement over every listed row ---------------------------------------
  update public.mentions m
     set sort_order = i.sort_order
    from jsonb_to_recordset(p_items) as i (id uuid, sort_order integer)
   where m.id = i.id;
  get diagnostics v_updated = row_count;

  -- A listed id matched no row: raise, so the rows that did match roll back with it.
  if v_updated <> v_listed then
    raise exception 'One of those mentions could not be found.' using errcode = 'P0002';
  end if;

  return v_updated;
end;
$$;

comment on function public.reorder_mentions(jsonb) is
  'S1.8: sets mentions.sort_order for every {id, sort_order} item in ONE statement (04 §1.6 updateMention reorder). P0002 when a listed id is missing — nothing applied. service_role only.';

revoke all on function public.reorder_mentions(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.reorder_mentions(jsonb) to service_role;
