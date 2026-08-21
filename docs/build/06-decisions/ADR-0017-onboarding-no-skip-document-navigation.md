# ADR-0017 — Onboarding panel: no Skip button; document navigation after DONE

## Status
Accepted

## Date
2026-08-21

## Slice
S1.1

## Context
Kind: design
- Spec says: `DESIGN.md` §11.3 #10 — "optional picture with Upload / Skip, then a footer strip with **DONE** (disabled until the handle validates)"; `docs/build/03-components.md` §2.5 `OnboardingPanel` — "optional `AvatarUpload name=\"avatar\"` + Upload / Skip"; `docs/build/02-routes-and-pages.md` §2.4 — "`AvatarUpload` (Upload / Skip; square crop)" and "success → `router.replace(next ?? '/')`".
- Found (David's preview review, 2026-08-21): (1) "For adding a picture, we don't need a Skip button. The user can simply not put in an image and continue by pressing Done. The Skip does not add any value, please remove it." — the built Skip only moved focus to DONE. (2) "Adding a Handle is required to activate the Done button, adding a photo is not." — already how the code gates DONE (`disabled` until `HandleField` reports valid; the picture is never part of it); the spec wording is made explicit. (3) After a successful DONE with a picture the page did not advance: the onboarding layout's wordmark `<Link href="/">` had prefetched `/`, the proxy answered that prefetch with M5's "307 → `/welcome?next=/`" (the handle was still null), and the client router's prefetch cache kept that redirect — so `router.replace('/')` after the action landed right back on `/welcome` (reproduced on the preview: `POST /welcome` 200 → client navigation to `/welcome?next=%2F`; the row carried the new handle and picture). The second DONE then hit the proxy's redirect on an action POST (ADR-0009 addendum D7).
- Related: ADR-0009 D7 (proxy redirects are GET/HEAD-only) · ADR-0002 C5 (onboarding layout) · `docs/questions.md` S1.1 notes (David's D1–D5 list) · supersedes none.

## Decision
1. **No Skip button.** `OnboardingPanel` renders `AvatarUpload` (Upload) only; leaving the picture empty and pressing DONE is the skip. The guidance text is unchanged. DESIGN.md §11.3 #10, 03 §2.5 and 02 §2.4 say "Upload" (no "/ Skip").
2. **DONE is gated on the handle only** — `disabled` until `HandleField` reports valid (`available` from the server); the picture never arms or disarms it. 03 §2.5 / 02 §2.4 say so explicitly.
3. **Success leaves with a document navigation**: `window.location.assign(next)` (`next` via `safeNext`), not `router.replace(next)` — a document load asks the server fresh (the proxy sees the handle and serves `next`), cannot be answered from the router's prefetch cache, and the public layout's `ViewerProvider` starts with the new handle so `ProfileMenu` shows it at once.
4. **No prefetch on the onboarding layout's wordmark link** (`<Link href="/" prefetch={false}>`): while the handle is null the proxy would answer the prefetch with a redirect to `/welcome` and seed the poisoned cache entry.
5. Tests: `tests/e2e/smoke/welcome.spec.ts` asserts the Skip button is absent; `tests/e2e/flows/onboarding.spec.ts` T-E2E-22 "DONE without a picture completes" replaces the Skip path (05 row amended); T-E2E-21 / T-E2E-22 keep asserting the landing URL (`expectLanded`), which now follows a document navigation.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep `router.replace(next)` and only drop the prefetch | Works today, but any future link on the onboarding shell (privacy, support) would reintroduce the poisoned entry; the document navigation is immune and costs one page load once per account. |
| Stop the proxy from redirecting RSC prefetches | The prefetched `/` payload would then let an un-onboarded user reach `/` client-side without the M5 rule — onboarding is mandatory (01 INV-30). |
| `router.refresh()` then `router.replace()` | Refresh invalidates the current segment, not a cached redirect for another route; behaviour depends on router internals. |
| Keep Skip as a ghost button that does nothing but move focus | David's call: it adds no value and suggests a step that does not exist. |

## Consequences
- Positive: one control fewer on the only blocking screen; the post-DONE landing is deterministic on every host (local, preview, production); the nav shows the handle immediately after onboarding.
- Negative: one full page load after onboarding (the ISR shell is ~190 KB gz, cached); `Toast "Saved."` stays unused here (02 §2.4 already said the page changes).
- Follow-ups: none. If a later slice adds links to the onboarding shell, keep `prefetch={false}` on them → owner `web-quality`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `DESIGN.md` | §11.3 #10 Handle onboarding; header changelog | "optional picture (Upload)" — no Skip; DONE gated on the handle only (contains the string ADR-0017) |
| `docs/build/03-components.md` | §2.5 `OnboardingPanel` row | Upload only; DONE gated on the handle; document navigation on ok (contains the string ADR-0017) |
| `docs/build/03-components.md` | `Status:` line | appended "— amended by ADR-0017 (2026-08-21)" (README ADR-R2) |
| `docs/build/02-routes-and-pages.md` | §2.4 Onboarding | Upload only; success → `window.location.assign(next)`; wordmark `prefetch={false}` (contains the string ADR-0017) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0017 (2026-08-21)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §7.3 T-E2E-22 row; `Status:` line | "DONE without a picture also completes (no Skip button)"; Status appended (contains the string ADR-0017) |
| `docs/build/00-build-plan.md` | §6 Changelog; `Status:` line | new row; Status appended (contains the string ADR-0017) |
| `docs/questions.md` | S1.1 build notes | David's preview-review decisions (contains the string ADR-0017) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0017 |

## Gate impact
| Gate | Now checks |
|---|---|
| design-fidelity-reviewer | `/welcome` has no Skip control; the picture block shows Upload only; DONE disabled until the handle is `available`, enabled with or without a picture (DESIGN.md §11.3 #10 as amended) |
| frontend-reviewer | `components/accounts/OnboardingPanel.tsx` calls `window.location.assign(next)` on `result.ok` (no `useRouter`); `app/(onboarding)/layout.tsx` wordmark `Link` has `prefetch={false}`; after DONE on the preview the document navigates to `next` and the nav shows the handle |
| spec-drift-reviewer | 02 §2.4, 03 §2.5, 05 T-E2E-22, DESIGN.md §11.3 #10 carry ADR-0017; this ADR listed under `## ADRs in this PR` |
| security-reviewer, backend-reviewer, supabase-reviewer, deploy-checker | none |
