-- 20260903120100_notification_recipients.sql — slice S1.5 (Notifications), docs/build/00-build-plan.md
-- "S1.5 — Notifications". One concern (01 INV-06): the delivery queue + audit table
-- `notification_recipients` (docs/notifications.md "Data" / "Pipeline"; data-model §2.6 / §4;
-- 04 §3.6 F2/F3, §3.7 N1/N4; 01 INV-70; 05 T-RLS-94..97, T-RLS-126) and its enum
-- `notification_status`. Depends on `notification_events` (20260903090300), `profiles` and the enum
-- `notification_channel` (20260903120000). Written by `notifyFanOut` (inserts) and `notifyDeliver`
-- (status marks) through the service client only; admins read it in `/admin` views with `address`
-- masked to `…<last 4>` by the app (04 F2 — an app rule, not a column rule: the Discord row's
-- `address` IS the webhook URL, docs/notifications.md Pipeline 2).
-- Idempotent: `duplicate_object` guard on the enum, `if not exists` / `drop … if exists` throughout.
-- Re-runnable (`supabase db reset` twice).
-- Reversibility (the delivery audit is lost — take a backup note first):
--   drop table if exists public.notification_recipients;
--   drop type if exists public.notification_status;

-- ---------------------------------------------------------------------------------------------
-- enum public.notification_status (docs/notifications.md "Data": pending | sent | failed | skipped).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.notification_status as enum ('pending', 'sent', 'failed', 'skipped');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.notification_recipients — one row per (event, channel, address). `profile_id` is NULL for
-- every v1 row (admin delivery goes to `site_settings.admin_notify_emails` / the webhook, not to a
-- profile; Phase 2 `notification_prefs` fills it) and nulls through the FK when an account goes.
-- `address` is NULL for a `skipped` row and for the Phase 2 in-app channel; `error` ≤ 500 chars is
-- enforced job-side (04 N4). Rows cascade with their event.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.notification_recipients (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.notification_events (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  channel    public.notification_channel not null,
  address    text,
  status     public.notification_status not null default 'pending',
  attempts   integer not null default 0,
  sent_at    timestamptz,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_recipients is
  'Delivery queue + audit (docs/notifications.md). Service-role writes; admins read with address masked in the app (04 F2). One row per (event, channel, address).';

-- The 04 §3.6 F3 / 01 INV-70 idempotency key: fan-out inserts under this index, so a second run
-- over the same event is a no-op and two `skipped` rows (address NULL) for one (event, channel)
-- collide too — `coalesce(address, '')` makes NULL addresses equal, which a plain unique
-- constraint would not (NULLs are distinct).
create unique index if not exists notification_recipients_event_channel_address_key
  on public.notification_recipients (event_id, channel, coalesce(address, ''));
-- 04 N1: the deliverer's eligibility scan (`status = 'pending'` … order by created_at).
create index if not exists notification_recipients_status_created_at_idx
  on public.notification_recipients (status, created_at);
-- 04 F1's "events without recipients" anti-join and the FK cascade lookup use the unique index
-- above (it leads on event_id) — no separate (event_id) index (ADR-0030 D16).

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-94..97 — select / update / delete admin; insert
-- service only (no JWT insert grant and no insert policy — T-RLS-95 admin = D). anon nothing.
-- Same shape as `notification_events` (20260903090300).
revoke all on table public.notification_recipients from public, anon, authenticated, service_role;
grant select, update, delete on table public.notification_recipients to authenticated;
grant all on table public.notification_recipients to service_role;

alter table public.notification_recipients enable row level security;

drop policy if exists notification_recipients_select_admin on public.notification_recipients;
create policy notification_recipients_select_admin
  on public.notification_recipients
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists notification_recipients_update_admin on public.notification_recipients;
create policy notification_recipients_update_admin
  on public.notification_recipients
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists notification_recipients_delete_admin on public.notification_recipients;
create policy notification_recipients_delete_admin
  on public.notification_recipients
  for delete
  to authenticated
  using (public.is_admin());
-- (no insert policy: `notifyFanOut` writes through the service role — T-RLS-95.)

-- updated_at (01 INV-97; 05 T-RLS-126 names this trigger — the 04 N1 backoff reads `updated_at`).
drop trigger if exists notification_recipients_set_updated_at on public.notification_recipients;
create trigger notification_recipients_set_updated_at
  before update on public.notification_recipients
  for each row execute function public.set_updated_at();
