-- 20260903120300_fk_indexes.sql — slice S1.5 (Notifications), ADR-0030 D11 (the S1.4
-- supabase-reviewer follow-up). One concern (01 INV-06): btree indexes on four foreign-key columns
-- that had none, so `on delete set null` / `cascade` from `profiles` (account deletion — 04 §1.1
-- `deleteAccount`, ADR-0030 D4) and the moderation-queue reads never scan the child tables:
--   comments.moderated_by, comment_reports.reporter_id, comment_reports.resolved_by,
--   notification_events.actor_id.
-- (`comment_reports (comment_id, reporter_id)` is unique, but `reporter_id` is its second column,
-- so a lookup by reporter alone still needs its own index.)
-- Idempotent: `create index if not exists` throughout. No data change.
-- Reversibility (no data loss):
--   drop index if exists public.comments_moderated_by_idx;
--   drop index if exists public.comment_reports_reporter_id_idx;
--   drop index if exists public.comment_reports_resolved_by_idx;
--   drop index if exists public.notification_events_actor_id_idx;

create index if not exists comments_moderated_by_idx
  on public.comments (moderated_by);
create index if not exists comment_reports_reporter_id_idx
  on public.comment_reports (reporter_id);
create index if not exists comment_reports_resolved_by_idx
  on public.comment_reports (resolved_by);
create index if not exists notification_events_actor_id_idx
  on public.notification_events (actor_id);
