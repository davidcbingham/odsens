# ADR-0004 — Dev-only component preview route

## Status
Accepted

## Date
2026-08-17

## Slice
S0

## Context
Kind: addition
- Spec says: `docs/build/03-components.md` §7 Preview / story approach — "**DECIDED (ADR-0002 #44; O-1)** — a dev-only route `app/dev/components/page.tsx` (`/dev/components`) that returns `notFound()` when `process.env.NODE_ENV === 'production'` **and** on any Vercel deployment (`process.env.VERCEL_ENV` set) … The route is in `_registry.md` (Non-production); an ADR with slug `component-preview` (`Kind: addition`, number per 06 README) is filed at S0."
- Spec says: `docs/build/_registry.md` Non-production line — "`/dev/components` (dev-only component preview, `notFound()` on Vercel; S0, ADR-0002 #44)"; `02-routes-and-pages.md` §1 row `/dev/components` + SM-32; `05-test-plan.md` T-E2E-48; `00-build-plan.md` S0.AC13.
- Found: S0 builds the route. This ADR is the `Kind: addition` record 03 §7 / ADR-0002 #44 asked for (README ADR-R14 last sentence); it adds the route to the contract and fixes how it is switched off — nothing in 00–05 is contradicted.
- Related: none in `docs/questions.md` · supersedes none.

## Decision
1. Route file `app/dev/components/page.tsx` serves `/dev/components` (registry Non-production line). No other file under `app/dev/`.
2. The page calls `notFound()` **iff** the build runs on Vercel (`VERCEL_ENV` set — preview and production alike; 03 §7 "production **and** on any Vercel deployment"). Code guard: `if (isVercel && nodeEnv === 'production') notFound()`, both values read through `lib/env.ts` (`isVercel`, `nodeEnv`), never `process.env` in the page (01 INV-35, INV-37). The local production build used by Playwright (`pnpm build && pnpm start`, 05 CI-5) has no `VERCEL_ENV`, so it keeps the route and T-E2E-48 can run against it; the route therefore exists only for `pnpm dev` and local Playwright.
3. It renders every 03 §2 component built so far, in every 03 §3 `data-state` value that component declares, from fixture data in `tests/fixtures/ui/*.ts` (no DB, no network), grouped by area (03 §2.1 layout, §2.2 primitives, then feature areas as they ship). Each block is `<section data-preview="<Name>">` labelled with `PixelLabel` "<Name> · <state>" (Name = the registry component name verbatim).
4. Purposes, in this order: `design-fidelity` screenshots at 1280 and 390 (`components@1280.png`, `components@390.png`) diffed against the pass-2/pass-3 prototypes named in 03 §7; axe over the whole page (05 T-E2E-48, zero serious/critical); the contrast script (`scripts/contrast.mjs`) over the token pairs the page exercises.
5. No Storybook or other preview toolchain is added (01 INV-78 allowlist unchanged). Email previews stay on `pnpm email dev` (03 §6).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Storybook (or Ladle) | Extra toolchain, config and dependencies for Oliver to maintain (01 INV-78 would need a dependency ADR); a route is one file that uses the real layout, fonts and tokens. |
| Gate the route on `NODE_ENV === 'production'` alone (no Vercel check) | Would 404 the local production build that Playwright runs against (`pnpm build && pnpm start`, 05 CI-5), so T-E2E-48 could not run; `VERCEL_ENV` is the deployment signal 01 INV-37 mandates and SM-32 checks the deployment directly. |
| Fixture data inline in the page | Duplicates shapes that tests already own; `tests/fixtures/ui/*.ts` is the one source both e2e and the preview read (05 fixtures policy). |

## Consequences
- Positive: one URL shows every component in every state with the real CSS; `design-fidelity-reviewer` and `test-engineer` share it; nothing ships to visitors (SM-32 asserts 404 on every deployment).
- Negative: the page grows with every slice (each slice's owner adds its components' blocks and fixtures — a maintained list, checked by T-E2E-48's "every §2 component" clause); the page is excluded from any bundle-size comparison (`frontend-reviewer` route-table diff ignores `/dev/components`).
- Follow-ups: each slice adds its new components/states to `tests/fixtures/ui/*.ts` and the page → owner `test-engineer` + `design-fidelity`; if `lib/env.ts` export names change, this ADR's Decision 2 names are updated by a superseding ADR → owner `backend-robustness`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/03-components.md` | §7 Preview / story approach | appended "Filed as ADR-0004 (2026-08-17)." (contains the string ADR-0004) |
| `docs/build/03-components.md` | §12 Changelog | new line naming ADR-0004 |
| `docs/build/03-components.md` | `Status:` line | appended "— amended by ADR-0004 (2026-08-17)" (README ADR-R2) |
| `docs/build/_registry.md` | Non-production route line | appended "(ADR-0004)" |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0004 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `app/dev/components/page.tsx` exists at S0; no `process.env` in it (reads `lib/env.ts`); no Storybook/Ladle in `package.json` |
| frontend-reviewer | the page is a Server Component except for the client islands it mounts; `notFound()` guard is `isVercel && nodeEnv === 'production'` read from `lib/env.ts` (never `NODE_ENV` alone — the local `pnpm start` build must keep the route for T-E2E-48); every §2 component built in the PR's slice has a `<section data-preview="<Name>">` block; `/dev/components` excluded from the route-table/bundle comparison |
| deploy-checker | `GET <preview>/dev/components` → 404 on every Vercel deployment (02 SM-32) |
| design-fidelity-reviewer | uses `/dev/components` locally for the 1280 + 390 component screenshots and the contrast pairs (03 §7); missing block for a shipped component = ❌ |
| security-reviewer, backend-reviewer, supabase-reviewer | none |
