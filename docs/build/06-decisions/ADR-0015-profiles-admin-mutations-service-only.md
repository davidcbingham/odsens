# ADR-0015 — Profiles mutations on other rows via the service client

## Status
Proposed

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: deviation
- Spec says: `docs/build/05-test-plan.md` §7.1 — T-RLS-8 "`profiles` · update another user's row (any column) · D | D | D | D | **A** | A" and T-RLS-9 "`profiles` · delete · D | D | D | D | **A** | A" (admin JWT = A); T-RLS-5 carries an admin cell "A". `docs/data-model.md` §4 `profiles` row — delete = "admin"; update = "renames + `handle_changed_at`, `role`, `is_banned`, `comment_count`, `email_hash` = admin/service only". The same table and T-RLS-2 (ADR-0002 #70) — select = "own row (full); admin does **not** select other rows via RLS".
- Found: Postgres applies a table's SELECT policies to every UPDATE/DELETE whose WHERE or RETURNING reads a column, and PostgREST always emits both (`.eq(...)` + returning). With `profiles` select = own row only, an admin JWT's update/delete of another user's row passes `profiles_update_own_or_admin` / `profiles_delete_admin` (`is_admin()` is true) but the target row is filtered out first → 0 rows, no error. The admin-A cells of T-RLS-8/9 cannot be true while T-RLS-2 is D — 05 contradicted itself — and the built migration `supabase/migrations/20260820120000_profiles.sql` satisfies T-RLS-2. Reported by the test lane (`tests/db/rls/profiles.test.ts` header).
- Related: ADR-0002 #70 (T-RLS-2 deny) · `docs/build/04-server-contracts.md` SC-06 (service client after `requireRole`) · supersedes none.

## Decision
1. The schema stays as built in `supabase/migrations/20260820120000_profiles.sql`: `profiles_select_own` (`auth.uid() = id`), `profiles_update_own_or_admin` (`using` / `with check` = `auth.uid() = id or public.is_admin()`), `profiles_delete_admin` (`using public.is_admin()`), no insert policy (trigger-only), and the BEFORE UPDATE trigger `profiles_guard` (a non-admin JWT may only set `avatar_path` and a first `handle`). No policy is added that lets an admin JWT see other rows.
2. 05 §7.1 cells (column order anon | user | banned | mod | admin | svc): **T-RLS-5** admin = A **on the admin's own row** (a factory admin whose `handle` is still NULL sets it, null→value); **T-RLS-8** admin JWT = **D** (0 rows), svc = A; **T-RLS-9** admin JWT = **D** (0 rows on another user's row), svc = A. `tests/db/rls/profiles.test.ts` asserts those cells; no test ID changes.
3. Every admin/moderator mutation of **another** user's `profiles` row — `banUser` (`is_banned`, `banned_reason`) and `renameUserHandle` (`handle`, `handle_changed_at`) in S1.4 (`requireRole('moderator')`), `setUserRole` (`role`) in S1.5 (`requireRole('admin')`) — runs in a Server Action through `lib/supabase/admin.ts` **after** `requireRole` (04 SC-06, 01 INV-18 step 2), exactly as the 04 §1.2 / §1.3 contracts already say. No code path writes another user's row with a JWT (cookie client); a moderator JWT never could (the policies name `is_admin()` only).
4. `docs/data-model.md` §4 `profiles` row reads: update of other users' rows and delete = "service (admin actions) only" — an admin JWT cannot reach other rows. Own-row admin writes are unchanged (T-RLS-6 / T-RLS-7 admin = A stand: the admin JWT passes the update policy and `profiles_guard` on its own row).
5. No code change in this ADR; no policy or trigger is added or altered.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Add a select policy `auth.uid() = id or is_admin()` so admin JWTs reach other rows | Reverses ADR-0002 #70 / T-RLS-2 — an admin's browser session could read every profile incl. `email_hash`; widens the client-reachable surface for no product need, since every admin mutation already runs server-side after `requireRole`. |
| Security-definer RPCs for ban / rename / role (`admin_update_profile(...)`) | A second privileged path beside the service client; each would re-implement `requireRole` in SQL; 04 SC-06 already names the one path. |
| Drop the `or is_admin()` terms from the update/delete policies (own-row only) | Changes a built, gate-reviewed migration for no observable difference on other rows (they are filtered before the policy runs) and would block an admin JWT's own-row writes that T-RLS-6 / T-RLS-7 expect. |

## Consequences
- Positive: T-RLS-2 (no cross-user `profiles` reads from any JWT, incl. `email_hash`) stands unweakened; one privileged path for admin/mod profile mutations; the 05 matrix, data-model §4 and the migration agree.
- Negative: the `or is_admin()` terms in the update/delete policies are effective only on the admin's own row — a reader of the SQL may infer a power the JWT does not have (Decisions 2 and 4 say so in the docs); S1.4 / S1.5 must build `banUser`, `renameUserHandle`, `setUserRole` on the admin client (as specified).
- Follow-ups: S1.4 `banUser` / `renameUserHandle` and S1.5 `setUserRole` use `createAdminClient()` after `requireRole` (T-ACT-24 / T-ACT-66 / T-ACT-67 assert it) → owner `backend-robustness`, `supabase-ops` · `supabase-reviewer` agent file names this rule (README OPEN-4) → owner `keep-docs`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/05-test-plan.md` | §7.1 T-RLS-5 row | admin cell = A on the admin's **own** row (factory admin with a NULL handle) (contains the string ADR-0015) |
| `docs/build/05-test-plan.md` | §7.1 T-RLS-8, T-RLS-9 rows | admin JWT = D (0 rows), svc = A; case text names the select-policy filter and 04 SC-06 (contains the string ADR-0015) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0015 (2026-08-20)" (README ADR-R2) |
| `docs/data-model.md` | §4 `profiles` row | update of other users' rows / delete = service (admin actions) only — admin JWT cannot (contains the string ADR-0015) |
| `docs/build/00-build-plan.md` | §6 Changelog | new row "ADR-0015 — `profiles` mutations on other rows via the service client" (contains the string ADR-0015) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0015, ADR-0016 (2026-08-20)" (README ADR-R2) |
| `docs/questions.md` | S1.1 build notes | ADR list line names ADR-0015 (contains the string ADR-0015) |
| `docs/spec.md` | Revision log 2026-08-20 line | ADR-0015 named (contains the string ADR-0015) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0015 |

## Gate impact
| Gate | Now checks |
|---|---|
| supabase-reviewer | `supabase/migrations/20260820120000_profiles.sql` policies equal Decision 1 (select = own row only; no admin select policy; `profiles_guard` present); `tests/db/rls/profiles.test.ts` T-RLS-8 / T-RLS-9 admin-JWT cases expect 0 rows and service A; the T-RLS-5 admin case is own-row |
| spec-drift-reviewer | 05 §7.1 T-RLS-5 / 8 / 9 and `docs/data-model.md` §4 `profiles` carry ADR-0015; this ADR listed under `## ADRs in this PR` |
| security-reviewer | no policy lets any JWT select another user's `profiles` row (T-RLS-2 admin still D); every write to another user's `profiles` row under `lib/actions/**` uses `createAdminClient()` after `requireRole` (04 SC-06) — never `createServerClient()` |
| backend-reviewer | S1.4 / S1.5 `banUser`, `renameUserHandle`, `setUserRole` call `requireRole` before the admin-client write; no action writes another user's `profiles` row through the cookie client |
| design-fidelity-reviewer, frontend-reviewer, deploy-checker | none |
