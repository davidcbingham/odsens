# ADR-0009 — Middleware file is `proxy.ts` (Next 16 convention)

## Status
Proposed

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: deviation
- Spec says: `docs/build/02-routes-and-pages.md` §3 — "Middleware (`middleware.ts` at repo root)"; RP-19 / RP-20 name "middleware"; `docs/build/01-architecture.md` INV-30 — "`middleware.ts` implements exactly 02 §3 M1–M8"; INV-32 — "`lib/auth.ts` and `middleware.ts` (session refresh) are the only modules that call `auth.getUser()`"; `docs/build/_registry.md` Route files — "`middleware.ts` (02 §3 M1–M8)".
- Found *(addendum 2026-08-20)*: `proxy.ts` must import `@supabase/ssr` directly, which 01 INV-13 / §23 INV-85 allow only in `lib/supabase/*.ts` (Decision 6).
- Found: Next 16 (the pinned framework, INV-78) renamed the root middleware file to `proxy.ts` and the exported function to `proxy`; a `middleware.ts` file still builds but is the deprecated path and its `runtime` export semantics differ. Supabase's `@supabase/ssr` Next 16 sample uses `proxy.ts` with the named export. The frozen docs name the old file, so gate greps (INV-14, INV-32, INV-42) and the registry would look at a file that does not exist.
- Related: `docs/questions.md` S0 build notes 2026-08-17 "S1.1 heads-up: Next 16 renamed `middleware.ts` → `proxy.ts` — decide by ADR at S1.1" · supersedes none.

## Decision
1. The middleware file is **`proxy.ts` at the repo root**; no `middleware.ts` exists (`ls middleware.ts` → no such file; `ls proxy.ts` → exists).
2. `proxy.ts` uses the **named export** `export async function proxy(request: NextRequest)` plus `export const config = { matcher: [...] }` with the 02 §3 matcher verbatim. No `runtime` export (Next 16 throws on it in `proxy.ts`); it runs on Node.js.
3. Rules M1–M8, RP-19 (never reads `role`, never renders; refresh via `auth.getUser()`), RP-20 (`safeNext`) and 01 INV-30/INV-32 apply to `proxy.ts` **unchanged** — every "middleware" / "`middleware.ts`" in 00–05, `_registry.md` and DESIGN.md reads as `proxy.ts`; the behavioural term "middleware" stays in prose.
4. Gate greps that named the file now name `proxy.ts`: 01 INV-14 (`grep -rln "supabase/admin" … proxy.ts`), INV-32 (`grep -v "lib/auth.ts\|^proxy.ts"`, `getSession(` over `proxy.ts`), INV-42 (`console.*` over `proxy.ts`). `eslint.config.mjs` globs that named `middleware.ts` name `proxy.ts` (backend agent).
5. Tests: 05 T-ACT-10 invokes the exported `proxy(request)` directly (`tests/db/proxy.test.ts`); the ID and its assertions are unchanged.
6. *(addendum 2026-08-20)* `proxy.ts` is the session-refresh seam and imports `@supabase/ssr` directly: `createServerClient` with a cookie adapter bound to the request→response pair, because 02 §3 M2 requires refreshed cookies to ride on *this* response and `lib/supabase/server.ts` (bound to `next/headers`) cannot provide that. 01 INV-13 / §23 INV-85 "only `lib/supabase/*.ts` imports the Supabase packages" gain the exception "+ `proxy.ts` (`@supabase/ssr` only, never `@supabase/supabase-js`, never the admin client)". `eslint.config.mjs` carries it as its own `files: ['proxy.ts']` block (as built): `@supabase/ssr` unrestricted; `@supabase/supabase-js`, `@/lib/supabase/admin`, `@/lib/supabase/client`, `@/lib/supabase/server` and the markdown packages banned. `proxy.ts` adds no fifth client kind to INV-13's list — it is the cookie server client with a request-bound adapter. `grep -n "supabase-js\|supabase/admin\|supabase/client\|supabase/server" proxy.ts` → none.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep `middleware.ts` (still accepted by Next 16) | Deprecated path; Next's docs and the Supabase SSR sample use `proxy.ts`; a later Next minor may drop the old name mid-build, and the `runtime` export rules differ between the two files. |
| `proxy.ts` re-exporting from a `middleware.ts` module | Two files for one concern; the greps in INV-14/32/42 would have to name both; no gain. |
| Default export instead of the named `proxy` | Both work; the named export matches the Next 16 docs' primary form and Supabase's sample, and a named export is what T-ACT-10 imports. |

## Consequences
- Positive: the file name matches the framework's current convention; gate greps point at a real file; T-ACT-10 can import the function by name.
- Negative: prose in 00–05 still says "middleware" (the concept) while the file is `proxy.ts` — readers must know the mapping (Decision 3 states it once).
- Follow-ups: none beyond the doc edits in this PR; if Next renames again, a new ADR supersedes this one → owner `keep-docs`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/02-routes-and-pages.md` | §3 heading | `middleware.ts` → `proxy.ts` (contains the string ADR-0009) |
| `docs/build/02-routes-and-pages.md` | §3 RP-19, RP-20 | file named `proxy.ts` (named export `proxy`) (contains the string ADR-0009) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0011, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/01-architecture.md` | §1 repo tree; §3 INV-14 Check; §6 INV-30; §6 INV-32 + Check; §9 INV-42 Check | `middleware.ts` → `proxy.ts` (contains the string ADR-0009) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/01-architecture.md` | §3 INV-13 statement + Check | `proxy.ts` `@supabase/ssr`-only exception; `grep -v "proxy.ts"` in the check (contains the string ADR-0009; addendum 2026-08-20) |
| `docs/build/01-architecture.md` | §23 INV-85 Rule | same exception, own `files` block (contains the string ADR-0009; addendum 2026-08-20) |
| `docs/build/_registry.md` | Route files line; repo tree line | `middleware.ts` → `proxy.ts` (contains the string ADR-0009) |
| `docs/build/00-build-plan.md` | §2 S1.1 Scope IN (Auth line); §6 Changelog | `middleware.ts` → `proxy.ts`; new changelog row (contains the string ADR-0009) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0012 (2026-08-20)" (README ADR-R2) |
| `docs/build/04-server-contracts.md` | §0 SC-04 | "session refresh is `proxy.ts`'s job" (contains the string ADR-0009) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0012, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/questions.md` | S0 build notes (2026-08-17 heads-up line) | marked answered by ADR-0009 |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0009 |
| `docs/build/01-architecture.md` | §10 INV-45 Check parenthetical | `proxy.ts` M4 added to the permitted `from('profiles')` sites (selects only `handle`) (contains the string ADR-0009) |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `proxy.ts` exists, `middleware.ts` does not; matcher string equals 02 §3 verbatim; named export `proxy` + `config`; `eslint.config.mjs` has the `files: ['proxy.ts']` block of Decision 6 (addendum); this ADR listed under `## ADRs in this PR` |
| security-reviewer | INV-14 / INV-32 / INV-42 greps run against `proxy.ts` (not `middleware.ts`); `proxy.ts` reads only `profiles.handle` (M4), never `role`; INV-13 / INV-85 (addendum): `proxy.ts` imports `@supabase/ssr` only — `grep -n "^import.*\(supabase-js\|supabase/admin\|supabase/client\|supabase/server\)" proxy.ts` → none (the file's header comment may name `lib/supabase/server.ts` to explain why it is not used) |
| frontend-reviewer | INV-30 "middleware shape" review targets `proxy.ts` |
| backend-reviewer | T-ACT-10 imports `proxy` from `@/proxy`; no `runtime` export in `proxy.ts` |
| design-fidelity-reviewer, supabase-reviewer, deploy-checker | none |
