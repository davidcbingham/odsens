# ADR-0041 — S1.5b Session A build findings

## Status
Accepted (2026-09-18 — S1.5b merge, v0.6.3)

## Date
2026-09-18

## Slice
S1.5b

## Context
Kind: deviation
- Spec says: `docs/build/00-build-plan.md` §S1.5b Scope IN — "CSP `frame-src` for the Ko-fi origin on `/support` only (01 §20)"; `docs/build/01-architecture.md` §20 INV-77 — "CSP baseline (v1) is exactly the directive set below" with `frame-src` = `https://www.youtube-nocookie.com https://ko-fi.com` on every route; `docs/build/03-components.md` §2.9 `AmountPicker` — "`{ …; kofiPage: string; onContinue: (amount: number | null) => void }`"; §2.3 `TipPanel` — "`Button variant="gold-ink"` … link via `TrackedLink event="tip_click"`"; §2.1 `FloatingSupportButton` — "`<a href aria-label="Support OddSense on Ko-fi">` … `data-state` … Wraps `TrackedLink`"; `docs/build/02-routes-and-pages.md` §2.7 / `docs/build/04-server-contracts.md` §5.7 — "mute line "Tips open soon.""; 02 §2.1 item 4 — the compact `TipPanel` sits "beside "Find me" list" in the Latest videos row (S1.6).
- Found (Session A build pass, branch `feat/S1.5b-support-page`): (1) 00's scope line and 01 §20 disagree, and a per-route CSP cannot work here: the CSP that governs an iframe is the one delivered with the **document**, and the site reaches `/support` by client-side navigation (`Nav` Support `Button` and `Footer` link are `next/link`) — a visitor who lands on `/` and clicks Support keeps `/`'s policy, so a `/support`-only `frame-src` would block the Ko-fi panel for most visitors; the Ko-fi entry has been in the site-wide baseline since S0 (05 T-E2E-20 asserts it on every route). (2) `/support` is a Server Component and cannot hand `AmountPicker` an `onContinue` function, and 03 §1.4 lists exactly two support islands — nothing owns the `loaded` flag between them. (3) `TipPanel`'s link must be the tracked element, but `Button` renders `next/link` and carries no click hook for links; `TrackedLink`'s `data-variant` pass-through only allowed `'primary'` and it had no `aria-label`. (4) `--mute` on the gold slab fails contrast (DESIGN.md §9). (5) Latest videos / Find me do not exist until S1.6, but 00 S1.5b.AC4 needs the Home compact panel now.
- Related: ADR-0036 (the slice), ADR-0002 C19 / #50 (mount in place, 712/620), ADR-0002 A16 (`tip_click` shape), 01 INV-58; no Q<nn>; supersedes nothing.

## Decision
1. **The Ko-fi `frame-src` entry stays in the site-wide CSP baseline (01 §20 unchanged); "only on `/support`" is a code rule, not a header rule.** `next.config.ts` is not touched. What keeps Ko-fi on one page is 01 INV-58: a `ko-fi.com` URL is built in `lib/support.ts` only (the admin Settings field shows `ko-fi.com/` as an input prefix — text, not a link — and `next.config.ts` carries the CSP entry), the iframe is rendered by `KofiPanelSlot` only, `KofiPanelSlot` is rendered by `AmountPicker` only, and `AmountPicker` is rendered by `/support` only (the `/dev/components` gallery shows `KofiPanelSlot` idle and `AmountPicker` closed — never a frame). 00 §S1.5b's scope line and AC wording now say so. T-E2E-11 asserts no `iframe` and no request to `ko-fi.com` before CONTINUE; T-E2E-49 asserts nothing opens in place elsewhere.
2. **`AmountPicker` owns the `loaded` flag and renders `KofiPanelSlot` under its slab.** Props become `{ amounts?: number[]; preselected?: number; kofiPage: string | null; onContinue?: (amount: number | null) => void }` — `kofiPage: null` is the tips-closed state (chips + CONTINUE `disabled`, the line "Tips open soon.", no "on Ko-fi ↗" link, no slot); `onContinue` is an optional observer. No third island. `KofiPanelSlot` keeps its 03 props (`amount` accepted, not in the URL — 04 §5.7).
3. **`TrackedLink` gains `'gold-ink'` on `data-variant` and an `aria-label` pass-through; `TipPanel`'s button is a `TrackedLink` with the gold-ink recipe in `TipPanel.module.css`** (the `GetItPanel` pattern, S1.2) — `<a data-variant="gold-ink" href="/support">`, `tip_click {from:'tip-panel'}`. Being a plain `<a>`, it is a document navigation. `FloatingSupportButton` uses the same `TrackedLink` with `aria-label="Support OddSense on Ko-fi"`.
4. **`FloatingSupportButton`'s `data-state` / `data-compact` live on a fixed-position wrapper `<div>` around the `<a>`.** `hidden` = the wrapper translated below the viewport, still focusable; `:focus-within` brings it back (03's "`:focus-visible` forces `visible`"). Reduced motion: no transform, `opacity: 0` + `pointer-events: none`. `data-compact` mirrors the ≤599px media query via `useSyncExternalStore(matchMedia)`; the 52px square itself is CSS, so there is no flash before hydration. `/support` opts out by `usePathname()` inside the island. One passive scroll listener, one read per animation frame, state changes only on a direction flip past 8px.
5. **"Tips open soon." is `--gold-ink` 700 on the gold slab**, not `--mute` — "mute line" in 02 §2.7 / 04 §5.7 reads "the line". Focus rings inside the gold slabs (`AmountPicker`, `TipPanel`) are `--ink`, because the global gold ring disappears on gold.
6. **The Home compact `TipPanel` renders in its own row under Featured projects until S1.6** (right-aligned, 320px; full width on phones), and also on the empty Home; S1.6 moves Latest videos + Find me into the same row beside it. 02 §2.1 item 4 says so.
7. **Copy pinned from the prototypes** (pass-2 "Support wrapper", pass-3 "Sections"): lead "Everything here is free. This is just if you feel like it."; slab title "BUY ME A BLOCK"; "Tips go through Ko-fi. Pick an amount, then finish there."; beside CONTINUE "Loads below. No account needed." (the prototype's "Opens Ko-fi." predates ADR-0002 C19); "What it pays for" / "The domain, the hosting, and the occasional texture pack I buy to take one block out of it."; Other field label "Amount in dollars".
8. **Tests.** New **T-UNIT-54** (`lib/support.ts`: both URLs, path-segment containment, `normalizeKofiPage`). **T-E2E-11** is two tests: the public page in `tests/e2e/smoke/support.spec.ts` (1280 + 390) and the Settings → `/support` leg (renamed page, empty page → "Tips open soon.", restore) in `tests/e2e/admin/projects.spec.ts`, because it writes `site_settings` and the `admin` project is the serial one. **T-E2E-49** in `tests/e2e/flows/floating-support.spec.ts`. `tests/helpers/vaStub.ts` is the shared `window.va` stub. `/support` leaves T-E2E-46's placeholder list.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Per-route CSP: drop `ko-fi.com` from the baseline, add it on `source: '/support'` | Breaks the panel after any client-side navigation into `/support` (the document's policy wins); would need every link to `/support` to be a hard navigation forever, enforced by nothing. |
| A third client island (`SupportPanel`) holding `loaded` between the two | A new registry name + island row for ten lines of state the picker already has. |
| Give `Button` an `onClick` for links | Widens a primitive used everywhere for one caller; `TrackedLink` + module CSS is the existing pattern. |
| Build "Find me" now so the Home row is complete | S1.6 scope; the list belongs with the videos column it sits beside. |

## Consequences
- Positive: Ko-fi works however the visitor arrives; no CSP change to review; two islands as specified; the tracked links are real `<a>`s.
- Negative: the CSP allows a Ko-fi frame on routes that never render one (as it has since S0); `TipPanel` repeats the gold-ink button recipe in its own CSS.
- Follow-ups: verify Ko-fi's preset-amount parameter once Oliver's page is live (04 §5.7, ADR-0002 #50) → owner `build-phase` at S1.9 or a fix pass; S1.6 fills the Home row → owner S1.6 Session A.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/00-build-plan.md` | §S1.5b Scope IN (CSP bullet), Tests required; §S1.9 AC4 (= S1.5b.AC1: "code rule, 01 INV-58" and "the line … `--gold-ink`"); §6 Changelog; Status line | D1, D5, D8 (contains ADR-0041) |
| `docs/build/01-architecture.md` | §13 INV-58 Check cell (the grep now names `lib/support.ts`, the Settings prefix text and the render chain); Status line | D1 (contains ADR-0041) |
| `docs/build/02-routes-and-pages.md` | §2.1 item 4 and States (empty Home = intro strip + compact `TipPanel`); §2.7 Data; Status line | D6, D5 (contains ADR-0041) |
| `docs/build/03-components.md` | §2.1 `FloatingSupportButton`; §2.2 `TrackedLink` props; §2.3 `TipPanel`; §2.9 `AmountPicker`; Status line | D2, D3, D4 (contains ADR-0041) |
| `docs/build/04-server-contracts.md` | §5.7 CONTINUE + Empty rows; Status line | D1, D5 (contains ADR-0041) |
| `docs/build/05-test-plan.md` | §7 T-UNIT-54 (new), T-E2E-11, T-E2E-49 (`TipPanel` = `TrackedLink` `<a>`, on `/` always); §8 row S1.5b; Status line | D3, D8 (contains ADR-0041) |
| `docs/build/_registry.md` | Modules (`lib/support.ts` exports), test helpers | D8 (contains ADR-0041) |
| `scripts/check-test-ids.mjs` | `SHIPPED_SLICES` gains `S1.5b`; T-UNIT-54 required | D8 |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0041 row |
| `docs/questions.md` | S1.5b build notes | Session A record |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `next.config.ts` CSP unchanged vs 01 §20; `AmountPicker` / `TrackedLink` props per the amended 03 rows; T-UNIT-54 exists |
| security-reviewer | 01 INV-58 by grep: `ko-fi.com` URLs only in `lib/support.ts` (plus the Settings input prefix text and the CSP line); `<iframe` for Ko-fi only in `KofiPanelSlot`; page name encoded into one path segment (T-UNIT-54); no Ko-fi script anywhere |
| frontend-reviewer | one passive, rAF-coalesced scroll listener in `FloatingSupportButton`; no layout read outside the frame callback; no hydration flash for the phone square |
| design-fidelity-reviewer | "Tips open soon." and gold-slab focus rings per D5; Home row per D6; copy per D7 |
