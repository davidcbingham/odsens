# ADR-0013 — Action error surfacing: `runAction` + `AuthError` export

## Status
Accepted

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: addition
- Spec says: `docs/build/04-server-contracts.md` SC-03 — "Actions **never throw** to the client; unexpected exceptions are caught, logged (SC-15), and returned as `error.code='internal'`"; SC-04 / `docs/build/01-architecture.md` INV-32 — "`lib/auth.ts` exports exactly `getUser()`, `getViewer()`, `getProfile()`, `requireUser()`, `requireOnboarded()`, `requireRole(role)`, `safeNext(next)`"; `docs/build/02-routes-and-pages.md` RP-20 — "`next` validation (shared helper `lib/auth.ts` `safeNext(next)`)"; `_registry.md` Modules lists `actions/result.ts` and `validation/{handle,comment,moderation,files,slug}.ts`.
- Found: (a) `requireUser` / `requireOnboarded` / `requireRole` throw an `AuthError` (S0, class internal to `lib/auth.ts`); with four S1.1 actions each needing the same catch → `fail(code, message)` mapping, the spec has no named home for that wrapper, and tests cannot `instanceof` an unexported class. (b) `lib/auth.ts` imports `server-only`, yet `GoogleSignInButton` (client) must build `redirectTo` with `safeNext` (02 §4) — the pure function needs a client-safe module. Neither changes a contract; both add a module/export the registry did not name. (c) *(addendum 2026-08-20)* Next 16 rejects non-function exports from a `'use server'` module (`ensureServerEntryExports`: "Only async functions are allowed to be exported in a 'use server' file"), so the `<actionName>Input` schemas that 04 SC-02 / 01 INV-18 / 05 T-ACT-0 (2) place "in the same file" cannot live in `lib/actions/accounts.ts` (Decision 5).
- Related: none in `docs/questions.md` · supersedes none.

## Decision
1. `lib/auth.ts` **value-exports** `class AuthError` (the existing class; `code` ∈ `ActionErrorCode`: `unauthenticated` | `onboarding_required` | `forbidden`). The **function** export set stays exactly the seven names in SC-04 / INV-32; `safeNext` is now a re-export: `export { safeNext } from '@/lib/validation/next'`.
2. New module **`lib/validation/next.ts`** (plain, client-safe) holds the pure `safeNext(next)` with the RP-20 rules unchanged (T-UNIT-44 tests it there). Client code (`GoogleSignInButton`, `OnboardingPanel`) imports `@/lib/validation/next`; server code may use either path.
3. New module **`lib/actions/run.ts`** (`server-only`) exports `runAction<TIn, TOut>(name, schema, raw, fn)`: `FormData` → plain object (`File` values kept; booleans stay strings — schemas coerce); `schema.safeParse` failure → `fail('validation', 'Check the form.', { issues: [{ path, message }] })` with plain messages (no zod internals); `fn` throwing an error whose string `code` is a member of `ActionErrorCode` (`AuthError`, `RateLimitError`, …) → `fail(code, message)`; `ZodError` → `validation`; anything else → one `log.error({ action: name, id, msg: 'unhandled', meta: { name } })` + `fail('internal', 'Something broke.')`. Every S1.1 action body is `return runAction(...)`; later slices follow (backend-reviewer checks).
4. Registry Modules line gains `actions/run.ts` and `validation/next.ts`; `format/date.ts` (`formatDay`, `relativeTime`) is already covered by the existing `format/*.ts` entry. No registry name is renamed (README ADR-R4: additions only).
5. *(addendum 2026-08-20)* The `<actionName>Input` zod schemas live in the action file's sibling module **`lib/actions/accounts.schema.ts`** (plain module, no directive; pattern `lib/actions/<area>.schema.ts` for later slices): `checkHandleInput`, `completeOnboardingInput`, `updateProfileInput`, `deleteAccountInput`, their `…Input` types and `fileSchema`. `lib/actions/accounts.ts` imports them and still exports only the registry actions (01 INV-04); tests import the schema from the `.schema.ts` module (`tests/db/actions/*.test.ts`). 04 SC-02, 01 INV-18 (1) and 05 T-ACT-0 (2) read "sibling `lib/actions/<area>.schema.ts`" instead of "the same file"; `_registry.md` Modules gains `actions/<area>.schema.ts`.
6. *(addendum 2026-08-20)* `lib/validation/handle.ts` is zod-free so the client island `HandleField` can import it (ADR-0008 D3: zod never ships to the browser); it exports `HANDLE_RE`, `RESERVED_HANDLES`, `isReserved`, `handleReason` and the pure `validateHandle()`; the zod `handleSchema` lives in `lib/actions/accounts.schema.ts` (server) on top of `validateHandle()` with identical messages; the same zod-free rule applies to every module under `lib/validation/` reachable from `components/**`.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Per-action try/catch with a local mapping | Four copies in S1.1, ~20 by S1.9; one missed catch = a thrown error reaching the client (SC-03 breach). |
| Put `safeNext` in `lib/auth/safe-next.ts` | Creates a `lib/auth/` folder beside `lib/auth.ts` (two homes for one seam); `lib/validation/*` is the registry's home for pure validators. |
| Export `AuthError` as a type only | Tests and `runAction` need `instanceof` / the runtime `code`; a type export cannot be checked at runtime. |

## Consequences
- Positive: one place maps thrown auth / rate-limit / validation errors to `ActionResult`; T-ACT-0 (server-side role re-check) can assert `AuthError`; the client builds `redirectTo` without importing a `server-only` module.
- Negative: two import paths for `safeNext` (`lib/auth.ts` re-export and `lib/validation/next.ts`); `runAction` is an extra call frame in every action (negligible).
- Follow-ups: S1.2+ actions use `runAction` → owner `backend-robustness`; `backend-reviewer` agent file names the rule → owner `keep-docs` (README OPEN-4).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/04-server-contracts.md` | §0 SC-03 | "caught by `lib/actions/run.ts` `runAction`" wording (contains the string ADR-0013) |
| `docs/build/04-server-contracts.md` | §0 SC-04 | `AuthError` value export; `safeNext` re-exported from `lib/validation/next.ts` (contains the string ADR-0013) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0012, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/01-architecture.md` | §6 INV-32 | export sentence: seven functions + `AuthError` class; `safeNext` home (contains the string ADR-0013) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/02-routes-and-pages.md` | §3 RP-20 | helper location `lib/validation/next.ts` (re-exported by `lib/auth.ts`) (contains the string ADR-0013) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0011, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §7.4 T-UNIT-44 row | `safeNext` home = `lib/validation/next.ts`, re-exported by `lib/auth.ts` (contains the string ADR-0013) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0010, ADR-0012, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/_registry.md` | Modules line | `actions/run.ts` (`runAction`), `validation/next.ts` (`safeNext`), `auth.ts` `AuthError`; `actions/<area>.schema.ts` (addendum 2026-08-20) (contains the string ADR-0013) |
| `docs/build/04-server-contracts.md` | §0 SC-02 | schemas exported as `<actionName>Input` from the sibling `lib/actions/<area>.schema.ts`, not the `'use server'` file (contains the string ADR-0013; addendum 2026-08-20) |
| `docs/build/01-architecture.md` | §3 INV-18 step (1) | same wording (contains the string ADR-0013; addendum 2026-08-20) |
| `docs/build/05-test-plan.md` | §7.2 T-ACT-0 (2) | "exported from the same file" → sibling `lib/actions/<area>.schema.ts` (contains the string ADR-0013; addendum 2026-08-20) |
| `docs/build/01-architecture.md` | §10 INV-49 | `lib/validation/handle.ts` mirrors as `validateHandle`, `RESERVED_HANDLES` (zod-free); the zod `handleSchema` in `lib/actions/accounts.schema.ts` (contains the string ADR-0013; addendum 2026-08-20) |
| `docs/build/05-test-plan.md` | §7.4 T-UNIT-1 row | `handleSchema` home = `lib/actions/accounts.schema.ts`, on top of `validateHandle` in `lib/validation/handle.ts` (contains the string ADR-0013; addendum 2026-08-20) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0013 |

## Gate impact
| Gate | Now checks |
|---|---|
| backend-reviewer | every `lib/actions/*.ts` action body is `return runAction(...)`; `runAction` maps coded errors / `ZodError` / unknown exactly as Decision 3; no action throws to the client; `lib/actions/<area>.ts` exports only async functions — the `<actionName>Input` schemas come from `<area>.schema.ts` (addendum) |
| security-reviewer | `runAction`'s `internal` branch logs only `{ action, id, msg, meta.name }` — never the error message or stack with user data (INV-43); `AuthError` carries no PII |
| spec-drift-reviewer | `lib/auth.ts` function exports = the seven SC-04 names (+ the `AuthError` class only); `lib/validation/next.ts`, `lib/actions/run.ts` and `lib/actions/<area>.schema.ts` are in `_registry.md` Modules before use; `<actionName>Input` is exported from the `.schema.ts` sibling, never from the `'use server'` file (addendum) |
| frontend-reviewer | client files import `safeNext` from `@/lib/validation/next`, never from `@/lib/auth` (`server-only`) |
| design-fidelity-reviewer, supabase-reviewer, deploy-checker | none |
