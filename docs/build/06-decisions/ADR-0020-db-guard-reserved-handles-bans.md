# ADR-0020 — Reserved handles and bans bind the owner's direct `profiles` write

## Status
Proposed

## Date
2026-08-21

## Slice
S1.1

## Context
Kind: security
- Spec says: `docs/build/04-server-contracts.md` §1.1 Handle rules — "H3 not in `RESERVED_HANDLES` (case-insensitive) … H5 the same list lives in SQL function `check_handle` and in `lib/validation/handle.ts` `RESERVED_HANDLES`"; `docs/data-model.md` §4 `profiles` update cell — "own row: handle (only if null→value), avatar_path"; `docs/build/05-test-plan.md` §7.1 T-RLS-4 banned = A and T-RLS-5 "— | A (as `nohandle`) | — | — | A (own row) | A".
- Found (security gate round 3, row 19 — must fix): reserved handles (04 H3, the 22-entry list in `supabase/migrations/20260820120000_profiles.sql` `check_handle` `v_reserved`, mirrored by `lib/validation/handle.ts` `RESERVED_HANDLES`) were enforced only by the RPC / the actions. The DB let any signed-in user's own-row write set a FIRST handle to anything matching the format CHECK (`profiles_guard` allows null→value for non-admin JWTs): a PostgREST PATCH with the anon key + own JWT could take `oddsense`, `admin`, `moderator`, `support`, … — impersonation of the owner/staff — and, through the unique index, it would also block the owner-bootstrap SQL. Advisory row 20: `profiles_guard` was ban-unaware — a banned JWT could still set its own `avatar_path` / first handle directly, although every account action already refuses a banned caller (ADR-0019).
- Related: ADR-0002 #63 (the 22-entry list) · ADR-0015 (the `profiles` write matrix; the CHECK-to-owner precedent "the DB binds what the action assumes") · ADR-0019 (`banned` in every action) · 01 INV-49 · supersedes none.

## Decision
1. Migration `supabase/migrations/20260821090000_profiles_guard_reserved_and_banned.sql` — one concern (01 INV-06), idempotent (`create or replace`; grants revoked and re-stated after each replace), reversibility note in its header (re-run `20260820120000_profiles.sql` lines 100–125 and 178–211, then `drop function if exists public.is_reserved_handle(text)`). No table, policy or index changes; the trigger object `profiles_guard` on `public.profiles` is untouched (`create or replace` keeps the function OID). `20260820120000_profiles.sql` is not edited (applied on `staging`); its inline array stays as history.
2. New `public.is_reserved_handle(p_handle text) returns boolean` — `language sql immutable parallel safe`, invoker rights, no table access: `coalesce(lower(p_handle) = any (array[<the 22 H3 entries in 04 order>]), false)`, so NULL → false. `revoke all … from public; grant execute … to anon, authenticated, service_role` (the list is public: it ships in the client bundle as `RESERVED_HANDLES`). It is the ONE SQL copy of the list.
3. `public.check_handle(text)` — body identical to `20260820120000_profiles.sql` lines 178–211 except `if public.is_reserved_handle(p_handle) then return 'reserved'` replaces the inline `v_reserved` array; still `stable security definer set search_path = public`; `revoke … from public, anon; grant execute … to authenticated` re-stated after the replace. Verdict order invalid → reserved → taken → available unchanged (04 §1.1).
4. `public.profiles_guard()` — body identical to `20260820120000_profiles.sql` lines 100–122 plus, inside the non-admin-JWT branch (`auth.role()` not null, not `service_role`, not `public.is_admin()`), in this order: (a) `old.is_banned` → `raise insufficient_privilege using message = 'profiles: banned accounts cannot change their profile'`; (b) the existing column guard, message unchanged; (c) `old.handle is null and new.handle is not null and public.is_reserved_handle(new.handle::text)` → `raise insufficient_privilege using message = 'profiles: that handle is reserved'`. All three are SQLSTATE 42501 (PostgREST 403). A BEFORE UPDATE trigger precedes the CHECK, so a banned account's foreign `avatar_path` is 42501, not 23514.
5. Who still passes: sessions without a JWT (migrations, seed, psql, the dashboard SQL editor), `service_role`, and admin JWTs — the owner bootstrap in `.claude/skills/supabase-ops/SKILL.md` ("NULL-handle row → `oddsense` + `admin`, run as `postgres`") is unchanged. Proved in a rolled-back psql transaction (UPDATE 1) and asserted by T-RLS-5 for both a no-JWT psql session and the service client.
6. `lib/supabase/types.ts` regenerated — the only diff is `is_reserved_handle: { Args: { p_handle: string }; Returns: boolean }` under `Functions`. No app code changes: `lib/validation/handle.ts` `RESERVED_HANDLES` stays the TS mirror; `completeOnboarding` still writes the first handle through the cookie client after the `check_handle` RPC, so the guard is a twin behind the action, not a new code path; a banned caller is already refused by `requireUser()` (ADR-0019) before any write.
7. Tests (no new IDs): 05 T-RLS-4 banned cell → **D** (set / clear / foreign path all 42501, row unchanged; `user` / `mod` / `admin` stay A); T-RLS-5 `nohandle` + reserved first handle (`admin`, `OddSense`, `mods`) → **D** 42501 row unchanged, non-reserved → A (existing cell), a factory banned account with a NULL handle → **D**, no-JWT psql and service sessions set a reserved first handle on a NULL row → **A** (seed rows restored, H-1); T-ACT-7 parity reads the array inside `is_reserved_handle` (live definition and the migration file) and asserts `check_handle` / `profiles_guard` carry no second copy; T-RLS-129 gains the `is_reserved_handle` grant row (every API role, never PUBLIC, immutable, not definer). Files: `tests/db/rls/profiles.test.ts`, `tests/db/actions/checkHandle.test.ts`, `tests/db/rls/_rpc-grants.test.ts`.

## Alternatives considered
| Alternative | Why not |
|---|---|
| A CHECK constraint on `profiles.handle` carrying the list (`check (handle is null or lower(handle::text) <> all (array[…]))`) | Binds every session incl. `postgres` / service — the owner bootstrap (`oddsense`) and any later admin rename onto a reserved name would fail; a CHECK cannot tell callers apart, cannot cleanly reference a function the list would otherwise live in (parity with the mutable TS list), and `lower()` over citext inside a constraint is one more place to keep identical. |
| An RLS `with check` clause on `profiles_update_own_or_admin` (`… and (handle is null or not is_reserved_handle(handle))`) | Silent: a failed `with check` answers 0 rows / a bare policy violation with no message, and the policy's `or public.is_admin()` arm makes the exemption hard to read; the guard raises a named 42501 with a message the gate can probe. |
| Keep RPC-only enforcement and rely on the actions | The gap itself: the browser holds the anon key + its own JWT and can PATCH `profiles` directly (01 INV-20 forbids client RPC calls, not the table writes the RLS matrix allows); every rule an action implements on an own-row write needs a DB twin — the systemic lesson of this round (`docs/questions.md`). |
| Leave the list inline in both `check_handle` and `profiles_guard` | Two SQL copies + the TS mirror = three lists to keep in parity; one pure function is the single SQL source and the parity test reads it. |
| Make the guard ban-aware for `handle` only (still allow `avatar_path` while banned) | A banned account's picture is as visible as its handle on existing comments (S1.4); ADR-0019 already refuses both in every action — the DB twin matches it. |

## Consequences
- Positive: the H3 list cannot be bypassed by a direct own-row write; the owner/staff handles cannot be squatted on any environment before the bootstrap; a ban freezes the row against the account's own JWT at the DB (defence in depth under ADR-0019); the list lives in SQL once + the TS mirror, with a parity test on each side (T-UNIT-2, T-ACT-7).
- Negative: `profiles_guard` calls `is_reserved_handle` on every own-row first-handle write (a constant-array membership test — negligible); `is_reserved_handle` is visible as a public RPC (pure, no data, the list is public); the guard does not bind service writes, so S1.4 `renameUserHandle` must keep asking `check_handle` for the reserved verdict (as 04 §1.2 already says).
- Follow-ups: every future rule implemented in an RPC/action on an owner-writable row gets a DB twin + T-RLS cell at build time → owner `supabase-ops` (checked by `supabase-reviewer`) · every future `/api/**` handler needs its own banned check because proxy M4b exempts `/api/*` → owner `backend-robustness` · S1.4 `renameUserHandle` (service client) keeps calling `check_handle` before the write, T-ACT-24 asserts `handle_reserved` → owner `backend-robustness`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/data-model.md` | §2.1 `handle` row | the reserved list lives in SQL once as `is_reserved_handle(text)`; `profiles_guard` refuses a reserved first handle and every own-row write while banned (contains the string ADR-0020) |
| `docs/data-model.md` | §2.11 object table | new `is_reserved_handle(text)` row; the `check_handle` row names it (contains the string ADR-0020) |
| `docs/data-model.md` | §4 `profiles` update cell | owner: `avatar_path` + first handle — not a reserved handle, and not while banned (contains the string ADR-0020) |
| `docs/build/04-server-contracts.md` | §1.1 Handle rules H3, H5 | the DB twin `is_reserved_handle()` binds the owner's direct write too; H5 = the list lives in SQL once (contains the string ADR-0020) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0020 (2026-08-21)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §7.1 T-RLS-4, T-RLS-5 rows | banned cell D; reserved → D, banned → D, svc A incl. a reserved first handle (contains the string ADR-0020) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0020 (2026-08-21)" (README ADR-R2) |
| `docs/build/01-architecture.md` | INV-49 Statement; INV-97 Statement + Check | the list inside `is_reserved_handle` (called by `check_handle` + `profiles_guard`); the helper listed with its grep (contains the string ADR-0020) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0020 (2026-08-21)" (README ADR-R2) |
| `docs/build/_registry.md` | SQL line | `is_reserved_handle(text)` helper; `profiles_guard()` trigger fn registered (contains the string ADR-0020) |
| `docs/build/00-build-plan.md` | §6 Changelog; `Status:` line | new row; Status appended (contains the string ADR-0020) |
| `docs/questions.md` | S1.1 build notes | security gate round 3 systemic-gaps line (contains the string ADR-0020) |
| `.claude/skills/supabase-ops/SKILL.md` | Owner bootstrap line | the database refuses `oddsense` too; the owner's SQL runs as `postgres`, which the guard lets through (contains the string ADR-0020) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0020 |

## Gate impact
| Gate | Now checks |
|---|---|
| security-reviewer | probe as the `nohandle` JWT (anon key + own session): `PATCH /rest/v1/profiles?id=eq.<own id>` with `{"handle":"oddsense"}` / `"admin"` / `"OddSense"` → 403, SQLSTATE 42501, message `profiles: that handle is reserved`, row unchanged; as the `banned` JWT any own-row PATCH (`avatar_path` set / clear, first handle) → 42501 `profiles: banned accounts cannot change their profile`; `pg_get_functiondef('public.profiles_guard()')` contains `old.is_banned` and `public.is_reserved_handle(`; `check_handle` carries no inline list; `is_reserved_handle` reads no table (`language sql immutable`, not definer) |
| supabase-reviewer | `supabase/migrations/20260821090000_profiles_guard_reserved_and_banned.sql` = Decisions 1–5 (one concern, idempotent, grants re-stated after each `create or replace`, reversibility note naming `20260820120000_profiles.sql` lines 100–125 / 178–211); `20260820120000_profiles.sql` unchanged; after `supabase db reset` the trigger `profiles_guard` is still attached (`pg_trigger`), ACLs: `check_handle` = authenticated only, `is_reserved_handle` = anon / authenticated / service_role, never PUBLIC; owner bootstrap as `postgres` → UPDATE 1 in a rolled-back transaction; `lib/supabase/types.ts` diff = the one `Functions` line; `tests/db/rls/profiles.test.ts` T-RLS-4 / T-RLS-5 cells and `tests/db/rls/_rpc-grants.test.ts` T-RLS-129 row green |
| spec-drift-reviewer | data-model §2.1 / §2.11 / §4, 04 H3 / H5, 05 T-RLS-4 / T-RLS-5, 01 INV-49 / INV-97, `_registry.md` SQL line, 00 §6 carry ADR-0020; this ADR listed under `## ADRs in this PR` |
| backend-reviewer | no `lib/actions/**` change; `completeOnboarding` still calls `check_handle` before the cookie-client write (the guard is the twin behind it, not the first line); T-ACT-7 parity reads `is_reserved_handle` and the migration file |
| design-fidelity-reviewer, frontend-reviewer, deploy-checker | none |
