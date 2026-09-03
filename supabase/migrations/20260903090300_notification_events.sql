-- 20260903090300_notification_events.sql — slice S1.4 (Comments), docs/build/00-build-plan.md
-- "S1.4 — Comments". One concern (01 INV-06): the notification event log `notification_events`
-- (docs/notifications.md "Data"; data-model §2.6 / §4; 04 SC-22; 05 T-RLS-90..93). Written by
-- `lib/notify/emit.ts` through the service client only; nothing is delivered until S1.5
-- (`notification_recipients` / `notification_matrix` arrive there and reference this table).
-- Idempotent: `if not exists` throughout.
-- Reversibility (the event log is lost — explicit backup note first; S1.5's recipients table
-- must be dropped before this one):
--   drop table if exists public.notification_events;

-- ---------------------------------------------------------------------------------------------
-- public.notification_events — `kind` is the permanent catalog name (docs/notifications.md
-- "names are permanent"; the CHECK lists every v1 / v1.5 / P2 kind so a typo never lands);
-- `actor_id` = the profile that caused the event (null for jobs); `subject_type/subject_id` name
-- the row the event is about (`comment` / `sync_run` …); `payload` never holds emails or Google
-- identity — user references are `{profile_id, handle}` (04 SC-22).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.notification_events (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null
               constraint notification_events_kind_catalog check (
                 kind in (
                   'comment.new', 'comment.held', 'comment.reported', 'comment.reply',
                   'comment.approved', 'sync.failed', 'sync.stale', 'mention.suggested',
                   'order.new', 'tip.new', 'workroom.post', 'workroom.file', 'workroom.comment'
                 )
               ),
  actor_id     uuid references public.profiles (id) on delete set null,
  subject_type text not null,
  subject_id   uuid not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.notification_events is
  'The notification event log (docs/notifications.md). Service-role writes; admins read. No PII in payload (04 SC-22).';

create index if not exists notification_events_kind_created_at_idx
  on public.notification_events (kind, created_at);
create index if not exists notification_events_subject_idx
  on public.notification_events (subject_type, subject_id);

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-90..93 — select/update/delete admin; insert
-- service only (no JWT insert grant and no insert policy).
revoke all on table public.notification_events from public, anon, authenticated, service_role;
grant select, update, delete on table public.notification_events to authenticated;
grant all on table public.notification_events to service_role;

alter table public.notification_events enable row level security;

drop policy if exists notification_events_select_admin on public.notification_events;
create policy notification_events_select_admin
  on public.notification_events
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists notification_events_update_admin on public.notification_events;
create policy notification_events_update_admin
  on public.notification_events
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists notification_events_delete_admin on public.notification_events;
create policy notification_events_delete_admin
  on public.notification_events
  for delete
  to authenticated
  using (public.is_admin());
-- (no insert policy: `lib/notify/emit.ts` writes through the service role — T-RLS-91.)
