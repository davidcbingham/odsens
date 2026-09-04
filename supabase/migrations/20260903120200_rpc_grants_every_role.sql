-- 20260903120200_rpc_grants_every_role.sql — slice S1.5 (Notifications), ADR-0030 D11 (the S1.4
-- follow-up from PR #8's CI; 05 T-RLS-129). One concern (01 INV-06): make the EXECUTE grants on
-- `check_handle(text)` and `can_comment(text, uuid)` deterministic across Supabase images.
-- Why: newer `supabase/postgres` images carry a default ACL for role `postgres` in schema `public`
-- that grants EXECUTE on every new function to anon, authenticated AND service_role. The two
-- migrations that create these functions (20260821090000, 20260903090000) revoke only
-- `public, anon`, so on those images `service_role` silently keeps EXECUTE on `check_handle` —
-- which the server never calls through the service client (`checkHandle` runs as the signed-in
-- user, 04 §1.1). `can_comment` is granted to `service_role` on purpose (the insert policies and
-- the S1.4 actions' precondition read it — T-RLS-133), so its intended set is re-stated as-is.
-- Precedent: 20260903090500_moderator_thread_revoke_service_role.sql.
-- Idempotent: revoke everything from every API role, then re-state exactly the intended grants.
-- Reversibility: none needed — re-running the two originating migrations' grant lines yields the
-- same intended sets on images without the default ACL.

-- check_handle(text): authenticated only (T-RLS-129 — anon D · authenticated A · service_role D).
revoke all on function public.check_handle(text) from public, anon, authenticated, service_role;
grant execute on function public.check_handle(text) to authenticated;

-- can_comment(text, uuid): authenticated + service_role (T-RLS-129 / T-RLS-133 — anon D).
revoke all on function public.can_comment(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_comment(text, uuid) to authenticated, service_role;
