# ADR-0025 — unknown ISR slug routes: accept HTTP 200 + 404 body until the Next streaming fix (interim)

## Status
Proposed (flips to Accepted at merge — ship step 8) — **interim**: superseded automatically when the upstream fix lands (see Follow-ups)

## Date
2026-08-27

## Slice
S1.2

## Context
Kind: frozen-test-expectation amendment (02 SM-04 / 05 T-E2E-14, T-E2E-34)
- Spec says: 02 SM-04 — GET `/projects/does-not-exist-404` → **404**; 05 T-E2E-14 asserts the same, T-E2E-34's hide-leg asserts `/projects/metal-pipe-mace` → 404 after Hide.
- Found at S1.2 build: Next 16.3.1 upstream bug (vercel/next.js #45801, #76474) — when any ancestor `loading.tsx` exists (02 RP-10 / 03 G-01 / T-E2E-18 **require** one for the projects segment), the streamed shell commits HTTP 200 before `notFound()` runs. The code path is spec-correct (`getProjectDetail` miss → `notFound()` → the G-02 404 shell renders); only the status line is wrong, and no code change can fix it without breaking RP-10/G-01. Logged as OPEN in `docs/questions.md` (2026-08-27) with options + owners; this ADR resolves it as **accept-and-monitor**.
- Related: ADR-0005 (placeholder pages), 02 RP-10 (loading.tsx), 03 G-01/G-02. Supersedes none.

## Decision
1. **Accept-and-monitor.** The `loading.tsx` files stay (RP-10/G-01 unbroken). For ISR slug routes rendered through a loading boundary, the contract is: unknown/hidden/draft slug → the G-02 404 shell **body**, status ∈ {200, 404} while the upstream bug stands. Static unmatched routes (`/nope-*`) still must answer a real 404 status.
2. 02 SM-04 and 05 T-E2E-14/T-E2E-34 are amended to that wording; the loud spec-header comments in `tests/e2e/smoke/shells.spec.ts` stay and now cite this ADR.
3. **SEO mitigation:** `app/not-found.tsx` gains `robots: { index: false }` metadata, so every 404-shell render — whatever its status — tells crawlers not to index; the sitemap already lists only real published slugs.
4. The known side-effect stands as accepted risk, monitored: each well-formed garbage slug writes one ISR cache entry (~57 KB); malformed slugs are short-circuited by `SLUG_RE` before cache/DB. If crawler-driven cache growth shows up in Vercel usage, the recorded fallback is the proxy-level slug-existence check (option d in questions.md) as its own ADR.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Drop the affected `loading.tsx` files | Breaks 02 RP-10 / 03 G-01 / T-E2E-18 — trades a status code for the loading-skeleton contract on every real page view. |
| In-page `<Suspense>` workaround | Same commit-before-notFound mechanics under streaming; still breaks the G-01 skeleton placement. |
| Proxy-level slug allowlist (reject unknown slugs in `proxy.ts` with a real 404) | Puts a DB/cache read in the middleware hot path for every project request and duplicates the visibility rule outside RLS/`projects_public`; kept as the recorded fallback if cache growth materialises. |
| Wait, spec unamended | Leaves a permanent ❌ on a frozen check no code can satisfy — CC-1 requires the ADR. |

## Consequences
- Positive: spec, tests, and reality agree; RP-10/G-01 intact; crawlers de-index garbage URLs via `noindex`; a single revert point when upstream fixes.
- Negative: unknown project URLs serve 200 to non-crawler clients until the upstream fix; ISR cache can accumulate garbage-slug entries (monitored, `SLUG_RE`-bounded, fallback recorded).
- Follow-ups: `upkeep` checks the two Next issues on each dependency bump; when the fix ships, restore strict 404 assertions in shells.spec.ts/admin projects spec, revert the 02/05 wording (one line each), and mark this ADR Superseded.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/02-routes-and-pages.md` | §7 SM-04 row; `Status:` line | status ∈ {200,404} for ISR slug routes, 404 body required (contains the string ADR-0025); Status appended |
| `docs/build/05-test-plan.md` | §7.3 T-E2E-14, T-E2E-34; `Status:` line | same tolerance on the slug-route legs (contains the string ADR-0025); Status appended |
| `docs/build/00-build-plan.md` | §6 Changelog; `Status:` line | new row; Status appended |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0025 |
| `docs/questions.md` | S1.2 notes | OPEN item marked DECIDED by ADR-0025 (accept-and-monitor + noindex) |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | shells.spec.ts tolerance matches the amended SM-04/T-E2E-14; `app/not-found.tsx` carries `robots: { index: false }` |
| frontend-reviewer | 404 shell body + noindex metadata render on unknown slugs; `/nope-*` still a real 404 status |
| security-reviewer | cache-growth risk accepted-and-monitored here; `SLUG_RE` short-circuit present |
| deploy-checker | SM-04 leg: body + noindex asserted, status ∈ {200,404} on the deployment |
| backend-reviewer, design-fidelity-reviewer, supabase-reviewer | none |
