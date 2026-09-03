-- S1.4 follow-up (CI, PR #8): make the `moderator_thread` grant state deterministic across
-- Supabase images. Newer `supabase/postgres` images carry a default ACL for role `postgres`
-- in schema `public` that grants EXECUTE on every new function to anon, authenticated AND
-- service_role; 20260903090200 revoked only `public, anon`, so `service_role` kept EXECUTE
-- on those images (05 T-RLS-134 asserts it is NOT granted — the server never calls
-- `moderator_thread` through the service client; `listModerationQueue` reads it with the
-- cookie client, ADR-0028 D7/D9). Idempotent: revoke + re-state the one intended grant.
revoke all on function public.moderator_thread(text, uuid) from public, anon, service_role;
grant execute on function public.moderator_thread(text, uuid) to authenticated;
