# ADR-0016 — Auth callback writes email_hash with the service client

## Status
Accepted

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: security
- Spec says: `docs/build/04-server-contracts.md` §2.1 A3 — "if `profiles.email_hash` is null, set it = `emailHash(user.email)` (SC-17, `HASH_SECRET`) via the service client — the DB trigger cannot read env (ADR-0002 A14)"; `docs/build/02-routes-and-pages.md` §4 3a — the same, "via the **service client**, server-side only … The email itself is never logged or returned"; `docs/build/01-architecture.md` INV-46 — "written only by `/auth/callback` (server, service client …)". But 01 INV-14 / §23 INV-84 — "`@/lib/supabase/admin` … imported only from `lib/actions/**`, `lib/jobs/**`, `lib/notify/**`, `lib/files.ts`, `lib/rate-limit.ts`, `app/api/**`"; INV-12 exception — "`app/auth/callback/route.ts` … (import `@/lib/supabase/server` only)"; INV-45 Check greps `components app lib/data` for `from('profiles')`, `email_hash`, `.email` → none; INV-46 Check greps `email_hash` over `app` → none.
- Found: the contract (A3 / 3a / A14) requires the callback to hold the service client, but the fences (INV-12 / INV-14 / INV-84) do not allow it there, and the INV-45 / INV-46 greps flag `email_hash`, `data.user.email` and `from('profiles')` in `app/auth/callback/route.ts`. Built as the contract says: `stampEmailHash()` → `createAdminClient().from('profiles').update({ email_hash: emailHash(email) }).eq('id', userId).is('email_hash', null)`; a failure logs `{ action: 'auth_callback', msg: 'email_hash_failed', meta: { profile_id, code } }` — never the address. Without an ADR the spec-drift and security gates would fail a spec-mandated write, or the build would need a silent `eslint-disable`.
- Related: ADR-0002 A14 · ADR-0012 (`HASH_SECRET` boot-required) · supersedes none.

## Decision
1. `app/auth/callback/route.ts` is the **single** non-`app/api/**` file under `app/**` that may import `@/lib/supabase/admin`. The INV-14 / INV-84 allow-list = `lib/actions/**`, `lib/jobs/**`, `lib/notify/**`, `lib/files.ts`, `lib/rate-limit.ts`, `app/api/**`, `app/auth/callback/route.ts`. `eslint.config.mjs` carries it as its own `files: ['app/auth/callback/route.ts']` block (as built): `@/lib/supabase/admin` is not restricted there; `@supabase/supabase-js`, `@supabase/ssr`, `@/lib/supabase/client` and the markdown packages stay banned. `app/auth/sign-out/route.ts` keeps `@/lib/supabase/server` only.
2. The admin client in that file runs exactly one statement: `update profiles set email_hash = emailHash(user.email) where id = <signed-in user> and email_hash is null` (idempotent across sign-ins). The file never logs, returns, redirects with, or stores the address; `data.user.email` is read once, to pass it to `stampEmailHash()` → `emailHash()`; a failed stamp logs `profile_id` + the Postgres error `code` through `lib/log.ts` and does not block the redirect.
3. 01 INV-45 Check and INV-46 Check exclude that one file (`… \| grep -v "app/auth/callback/route.ts"` → none). INV-45's permitted `from('profiles')` sites = `lib/auth.ts`, `components/accounts/ViewerProvider.tsx` (own-row reads) + `app/auth/callback/route.ts` (the service-client `email_hash` write on the signed-in user's own row). INV-14 Check: `grep -rln "supabase/admin" components app lib/data proxy.ts` → only `app/api/**` + `app/auth/callback/route.ts`. INV-12's exception sentence names both clients for the callback.
4. `security-reviewer` verifies the exception is exactly one file: `grep -rln "supabase/admin" app | grep -v ^app/api/` → `app/auth/callback/route.ts` only; `grep -n "\.email\b" app/auth/callback/route.ts` → the one `data.user.email` argument; no `log.*` call or response in that file carries an address.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Stamp `email_hash` from the `handle_new_user` trigger | Postgres cannot read `HASH_SECRET` (ADR-0002 A14; 01 INV-46). |
| Move the stamp into a Server Action in `lib/actions/accounts.ts` called from the callback | A route handler invoking an action is not a UI mutation (01 INV-17) and adds a hop on every sign-in; the write still needs the service client in the same request. |
| A security-definer RPC `stamp_email_hash(hash)` granted to `authenticated` | Puts the hash on the wire from the cookie client and adds a privileged SQL path for one write; the service client in the handler is the path 04 A3 already names. |
| Widen INV-84 to `app/**/route.ts` | Would admit every route handler; the allow-list stays one named file. |

## Consequences
- Positive: the callback does exactly what 04 A3 / 02 3a / ADR-0002 A14 say; the gates have a precise exception (one file, one statement) instead of a lint suppression; the address never leaves `stampEmailHash()`.
- Negative: one more file holds the service role outside `lib/actions/**` / `app/api/**` — the INV-14 grep output has two shapes; the INV-45 / INV-46 greps carry an exclusion that must stay exactly one file.
- Follow-ups: `security-reviewer` agent file names the one-file exception (README OPEN-4) → owner `keep-docs` · S2.1 Ko-fi matching reads `email_hash` only in `lib/jobs/*` with the admin client (INV-46, unchanged) → owner `backend-robustness`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/01-architecture.md` | §3 INV-12 | exception sentence: the callback imports `@/lib/supabase/server` + `@/lib/supabase/admin` (one A3 stamp) (contains the string ADR-0016) |
| `docs/build/01-architecture.md` | §3 INV-14 statement + Check | allow-list and grep expectation gain `app/auth/callback/route.ts` (contains the string ADR-0016) |
| `docs/build/01-architecture.md` | §10 INV-45 Check | permitted `from('profiles')` sites + `grep -v "app/auth/callback/route.ts"` (contains the string ADR-0016) |
| `docs/build/01-architecture.md` | §10 INV-46 Check | `grep -v "app/auth/callback/route.ts"` (contains the string ADR-0016) |
| `docs/build/01-architecture.md` | §23 INV-84 Rule | allow-list gains `app/auth/callback/route.ts` (own `files` block) (contains the string ADR-0016) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0016 (2026-08-20)" (README ADR-R2) |
| `docs/build/00-build-plan.md` | §6 Changelog | new row "ADR-0016 — `/auth/callback` writes `email_hash` with the service client" (contains the string ADR-0016) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0015, ADR-0016 (2026-08-20)" (README ADR-R2) |
| `docs/questions.md` | S1.1 build notes | ADR list line names ADR-0016 (contains the string ADR-0016) |
| `docs/spec.md` | Revision log 2026-08-20 line | ADR-0016 named (contains the string ADR-0016) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0016 |

`docs/build/04-server-contracts.md` §2.1 A3 and `docs/build/02-routes-and-pages.md` §4 3a already state the service-client write — no edit; this ADR cites them.

## Gate impact
| Gate | Now checks |
|---|---|
| security-reviewer | the INV-14 / INV-84 exception is exactly one file (`grep -rln "supabase/admin" app \| grep -v ^app/api/` → `app/auth/callback/route.ts` only); in that file the admin client runs the single `email_hash` update, `data.user.email` reaches only `emailHash()`, and no log line or response carries it; the INV-45 / INV-46 greps with the one exclusion → none |
| spec-drift-reviewer | 01 INV-12 / INV-14 / INV-45 / INV-46 / INV-84 carry ADR-0016; `eslint.config.mjs` has the `files: ['app/auth/callback/route.ts']` block with `@/lib/supabase/admin` unrestricted and the Supabase packages still banned; this ADR listed under `## ADRs in this PR` |
| backend-reviewer | `stampEmailHash` is idempotent (`.is('email_hash', null)`), awaited, and its failure is logged by `profile_id` + `code` without blocking the redirect (04 A3) |
| design-fidelity-reviewer, frontend-reviewer, supabase-reviewer, deploy-checker | none |
