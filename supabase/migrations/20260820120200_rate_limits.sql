-- 20260820120200_rate_limits.sql — slice S1.1 (Accounts), docs/build/00-build-plan.md "S1.1 — Accounts".
-- One concern (01 INV-06): SQL rate limiting — `rate_limit_hits` (service-role only) + RPCs
-- `rate_limit_ok` / `purge_rate_limit_hits` (data-model §2.10 / §4; 04 §5.5; ADR-0002 #14 / A4;
-- 01 INV-28, INV-97 — keyless `scope, key, ts` is the named exception).
-- Idempotent: `if not exists` / `create or replace` / `drop … if exists` throughout.
-- Reversibility (hits are transient housekeeping data; safe to drop):
--   drop function if exists public.rate_limit_ok(text, text, integer, interval);
--   drop function if exists public.purge_rate_limit_hits(integer);
--   drop table if exists public.rate_limit_hits;

-- ---------------------------------------------------------------------------------------------
-- public.rate_limit_hits — one row per rate-limited call (also on a rejected call).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.rate_limit_hits (
  scope text not null,
  key   text not null,
  ts    timestamptz not null default now()
);

create index if not exists rate_limit_hits_scope_key_ts_idx
  on public.rate_limit_hits (scope, key, ts);

comment on table public.rate_limit_hits is
  'Service-role only. The single source for every rate limit (04 §5.5); counted by rate_limit_ok().';

-- Privileges: service_role only (data-model §4). anon/authenticated get nothing.
revoke all on table public.rate_limit_hits from public, anon, authenticated, service_role;
grant all on table public.rate_limit_hits to service_role;

-- RLS (01 INV-28; T-RLS-123 wants ≥ 1 policy — service_role bypasses RLS anyway). Matrix: T-RLS-130.
alter table public.rate_limit_hits enable row level security;

drop policy if exists rate_limit_hits_service_all on public.rate_limit_hits;
create policy rate_limit_hits_service_all
  on public.rate_limit_hits
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------------------------
-- public.rate_limit_ok(p_scope, p_key, p_max, p_window) returns boolean — records the hit, then
-- counts atomically: insert (scope, key, now()), return count over the window <= p_max.
-- With p_max = 2: calls 1 and 2 → true, call 3 → false (T-RLS-130). Counts ONLY this table (A4).
-- ---------------------------------------------------------------------------------------------
create or replace function public.rate_limit_ok(
  p_scope  text,
  p_key    text,
  p_max    integer,
  p_window interval
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  insert into public.rate_limit_hits (scope, key) values (p_scope, p_key);

  select count(*)
    into v_count
  from public.rate_limit_hits h
  where h.scope = p_scope
    and h.key = p_key
    and h.ts >= now() - p_window;

  return v_count <= p_max;
end;
$$;

revoke all on function public.rate_limit_ok(text, text, integer, interval) from public, anon, authenticated;
grant execute on function public.rate_limit_ok(text, text, integer, interval) to service_role;

-- ---------------------------------------------------------------------------------------------
-- public.purge_rate_limit_hits(p_days) returns integer — deletes rows older than p_days, returns
-- the number removed. Called by snapshotStats (`purge_rate_limit_hits(1)`, 04 §3.5).
-- ---------------------------------------------------------------------------------------------
create or replace function public.purge_rate_limit_hits(p_days integer)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_hits
  where ts < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_rate_limit_hits(integer) from public, anon, authenticated;
grant execute on function public.purge_rate_limit_hits(integer) to service_role;
