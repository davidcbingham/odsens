-- 20260903120000_notification_matrix.sql — slice S1.5 (Notifications), docs/build/00-build-plan.md
-- "S1.5 — Notifications". One concern (01 INV-06): the admin Settings grid `notification_matrix`
-- (docs/notifications.md "Data" + "Default matrix"; data-model §2.6 / §4; 05 SEED-2, T-RLS-98..101;
-- ADR-0030 D10) plus the shared enum `notification_channel` (docs/notifications.md "Data" — the
-- recipients table in 20260903120100 uses it too). The 16 default rows are seeded HERE with
-- `on conflict (kind, channel) do nothing`: production and the persistent `staging` branch never run
-- seed.sql (the ADR-0015 `site_settings` precedent). seed.sql SEED-2 re-asserts the same values
-- locally with `do update`, and `lib/notify/matrix.ts` `matrixDefaults` is the TypeScript twin —
-- 05 T-UNIT-27 keeps all three equal, so edit the three together.
-- Idempotent: `duplicate_object` guard on the enum, `if not exists` / `drop … if exists` throughout,
-- the seed insert is `on conflict do nothing`. Re-runnable (`supabase db reset` twice).
-- Reversibility (the admin's toggle choices are lost — take a backup note first; the enum is shared,
-- so drop `notification_recipients` (20260903120100) before it):
--   drop table if exists public.notification_matrix;
--   drop type if exists public.notification_channel;   -- only once notification_recipients is gone

-- ---------------------------------------------------------------------------------------------
-- enum public.notification_channel (docs/notifications.md "Data": email | discord | inapp | push).
-- v1 delivers `email` and `discord`; `inapp` / `push` are the Phase 2 values, present so the
-- recipients queue never needs an enum migration later ("names are permanent").
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.notification_channel as enum ('email', 'discord', 'inapp', 'push');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.notification_matrix — one row per (kind, channel); `enabled` is the admin's switch.
-- `kind` is bound to the permanent event catalog (the same list as
-- `notification_events_kind_catalog` in 20260903090300) so a typo can never land; the composite PK
-- is the data-model / 01 INV-97 named exception (no surrogate `id`).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.notification_matrix (
  kind       text not null
             constraint notification_matrix_kind_catalog check (
               kind in (
                 'comment.new', 'comment.held', 'comment.reported', 'comment.reply',
                 'comment.approved', 'sync.failed', 'sync.stale', 'mention.suggested',
                 'order.new', 'tip.new', 'workroom.post', 'workroom.file', 'workroom.comment'
               )
             ),
  channel    public.notification_channel not null,
  enabled    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_matrix_pkey primary key (kind, channel)
);

comment on table public.notification_matrix is
  'Admin Settings grid: which (kind, channel) pairs the allay delivers (docs/notifications.md). Admin read/write; delete service only.';

-- ---------------------------------------------------------------------------------------------
-- Default matrix (docs/notifications.md "Default matrix"; 05 SEED-2; ADR-0030 D10). 16 rows =
-- 8 kinds × (email, discord). `do nothing` keeps an admin's later choices on every re-apply.
-- ---------------------------------------------------------------------------------------------
insert into public.notification_matrix (kind, channel, enabled) values
  ('comment.new',       'email',   true),
  ('comment.new',       'discord', true),
  ('comment.held',      'email',   true),
  ('comment.held',      'discord', true),
  ('comment.reported',  'email',   true),
  ('comment.reported',  'discord', true),
  ('sync.failed',       'email',   true),
  ('sync.failed',       'discord', false),
  ('sync.stale',        'email',   true),
  ('sync.stale',        'discord', false),
  ('mention.suggested', 'email',   false),
  ('mention.suggested', 'discord', true),
  ('order.new',         'email',   true),
  ('order.new',         'discord', true),
  ('tip.new',           'email',   false),
  ('tip.new',           'discord', true)
on conflict (kind, channel) do nothing;

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-98..101 — select / insert / update admin;
-- delete service only (no JWT delete grant and no delete policy — T-RLS-101 admin = D). anon nothing.
-- `updateSettings` writes through the service client after `requireRole('admin')` (04 SC-06); the
-- admin JWT cells describe direct table access only.
revoke all on table public.notification_matrix from public, anon, authenticated, service_role;
grant select, insert, update on table public.notification_matrix to authenticated;
grant all on table public.notification_matrix to service_role;

alter table public.notification_matrix enable row level security;

drop policy if exists notification_matrix_select_admin on public.notification_matrix;
create policy notification_matrix_select_admin
  on public.notification_matrix
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists notification_matrix_insert_admin on public.notification_matrix;
create policy notification_matrix_insert_admin
  on public.notification_matrix
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists notification_matrix_update_admin on public.notification_matrix;
create policy notification_matrix_update_admin
  on public.notification_matrix
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- (no delete policy: service only — T-RLS-101.)

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists notification_matrix_set_updated_at on public.notification_matrix;
create trigger notification_matrix_set_updated_at
  before update on public.notification_matrix
  for each row execute function public.set_updated_at();
