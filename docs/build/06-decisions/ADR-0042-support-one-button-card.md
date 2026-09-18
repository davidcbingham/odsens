# ADR-0042 — Support: one button, no amount picker

## Status
Proposed

## Date
2026-09-18

## Slice
cross-cutting (fix pass after S1.5b — no slice, no tag)

## Context
Kind: design
- Spec says: `DESIGN.md` §6 #7 — "gold hatched panel with $1 / $3 / $5 / Other (one preselected) and a single send button"; §11.4 — "the gold hatched slab holds the copy and the $1 / $3 / $5 / Other picker … Under it, a labelled dashed slot shows where Ko-fi's own panel renders"; `docs/build/00-build-plan.md` §S1.9 AC4 (= S1.5b.AC1) — "picker preselects $3, CONTINUE ON KO-FI mounts the `KofiPanelSlot` iframe in place"; `docs/build/03-components.md` §2.9 `AmountPicker` — "`{ amounts?; preselected?; kofiPage; onContinue? }` … $1 / $3 / $5 / Other as `<button role="radio">` chips"; `docs/build/04-server-contracts.md` §5.7 — "The chosen amount is **not** passed in v1 (no documented preset-amount URL param — ADR-0002 #50: verify when the account exists)".
- Found (David, using the live page the day S1.5b merged): he picked **$1**, pressed CONTINUE, and Ko-fi's panel opened underneath saying **$5** — two boxes on one page, the second contradicting the first. ADR-0002 #50's open check was then run against the live panel (`ko-fi.com/odsens`, 2026-09-18, a real browser): it opens at Ko-fi's own default whatever the URL says (`amount`, `donationAmount`, `value`, `coffees`, `qty`, `a`, `price` all ignored); the page reads neither `location.search` nor `message` events; and Ko-fi's developer surface is the payment **webhook** only (it reports a tip after it happens — S2.1) plus the iframe we already use and an overlay **script** (01 INV-58 forbids loading it: third-party code on every page before anyone asks). There is no way to take the payment in our own form, restyle the panel, or hand it an amount. So our picker was a choice the site could not honour.
- Related: David's decision, recorded in `docs/questions.md` "Support page after first use (2026-09-18)" — option "A + (a)": one button that swaps the card for Ko-fi's panel; the floating button stays a link to `/support` (opening a pop-up of our own in place is a possible later step, to be discussed with Oliver). Closes ADR-0002 #50. Amends ADR-0041 D2 (the props) and D7 (two copy lines). Supersedes nothing.

## Decision
1. **No amount picker.** The $1 / $3 / $5 / Other chips, the Other `Field`, `amounts`, `preselected` and `onContinue` are removed. The amount is chosen once, in Ko-fi's panel; the default and suggested amounts there are the creator's own Ko-fi settings (Oliver sets the default to $3). `KofiPanelSlot` loses its unused `amount` prop.
2. **One box, never two — the button swaps the card for the panel.** The gold slab keeps the title BUY ME A BLOCK, one line and a single `Button variant="gold-ink"` **TIP ON KO-FI**. Pressing it **replaces** the slab with `KofiPanelSlot` `loaded` (712 / 620 px, in place, same tab — ADR-0002 C19 stands) under a bar on `--slab`: "← Back" (returns the slab) and the "on Ko-fi ↗" ghost link. The always-visible dashed "KO-FI PANEL LOADS HERE" slot is no longer rendered on any page; `KofiPanelSlot`'s `idle` state stays for `/dev/components` only, which never frames Ko-fi. Focus follows the swap (to Back on open, to the button on close, never on first render). Click-to-load is unchanged: nothing is requested from ko-fi.com before the click (01 INV-58).
3. **`tip_click` from `/support` is `{from:'support'}`.** No emitter sends `amount` any more. The allowlist shape in `lib/analytics.ts` / 04 §5.6 (`amount?: 1|3|5|'other'`) is left as it is — optional, unused — so ADR-0002 A16 and T-UNIT-38 do not move.
4. **The component is renamed `AmountPicker` → `KofiCard`** (`components/support/KofiCard.tsx` + `.module.css`; 03 §1.4 island row, §2.9 row, §3 ARIA row; `_registry.md`). A thing called "amount picker" that picks no amount would mislead every later reader. Props: `{ kofiPage: string | null }`; `null` is still the tips-closed state (button disabled, "Tips open soon.", no ghost link, no panel).
5. **Copy** (DESIGN.md §7 voice): slab line "Tips go through Ko-fi. You pick the amount there." (was "…Pick an amount, then finish there."); beside the button "Loads right here. No account needed." (was "Loads below…"); button TIP ON KO-FI (was CONTINUE ON KO-FI); bar "← Back". Everything else from ADR-0041 D7 stands.
6. **The `/support` loading shell follows the page**: title + lead, the card slab (title, one line, button), the "What it pays for" slab — no chip shells, no dashed slot. It keeps `min-height: 100svh`.
7. **Tests.** T-E2E-11 (smoke, 1280 + 390) asserts: no `radiogroup`, one TIP ON KO-FI button, no slot / iframe / ko-fi.com request before the click; after it the iframe (src, size, same tab), the card gone, Back focused, exactly one `tip_click {from:'support'}`; Back restores the card, focuses the button and removes the frame; axe in both states; screenshots `support` and `support-panel`. The Settings leg asserts the disabled button instead of disabled chips. `.env.example` seeds `KOFI_PAGE=odsens` (the live page name; tests keep the SEED-1 value `oddsense`).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep the chips, swap on CONTINUE (David's first idea) | Tidier, but the chosen amount is still dropped — the visitor picks $1 and Ko-fi says $5. |
| Show Ko-fi's panel straight away, no card, no click | Loads a third party for every visitor before they ask — against click-to-load (01 INV-58, DESIGN.md §11.4), on a minor's site. |
| Ko-fi's `overlay-widget.js` floating pop-up | Third-party script on every page, a looser `script-src`, only the button colour and text are ours — and still no preset amount. 01 INV-58 already forbids it. |
| Our own pop-up from the floating button (frame in a dialog, on any page) | Possible — the `frame-src` entry is already site-wide (ADR-0041 D1) — but it rewrites INV-58's "one page" rule, needs an accessible dialog and a 712px frame on small screens. David: not now; discuss with Oliver. |
| A processor with a real checkout API (Stripe) | New account held by an adult, fees, and the S2.1 supporters plan redone — for a preset amount. |
| Keep the name `AmountPicker` | Misleading; the rename is ten doc rows and two files. |

## Consequences
- Positive: what the page shows is what happens; one box; one click to Ko-fi's panel; less client code (no chips, no `Field`); ADR-0002 #50 is closed with evidence.
- Negative: no $1 / $3 / $5 nudge of our own — the nudge now lives in Oliver's Ko-fi settings; `tip_click` no longer records an intended amount (it never matched what was paid).
- Follow-ups: Oliver sets his Ko-fi panel's default amount to $3 → owner David/Oliver; the floating-button pop-up → `docs/questions.md`, David + Oliver; the iframe `sandbox` test and the read-side `kofi_page` re-validation stay on the "S1.5b follow-ups" list → owner the next fix pass.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `DESIGN.md` | header (v1.11 changelog line), §6 #7, §11.4, §12.7 C19 | D1, D2, D5 (contains ADR-0042) |
| `docs/build/00-build-plan.md` | §S1.5b Scope IN (two bullets), S1.5b.AC6; §S1.9 Scope marker + AC4 (= S1.5b.AC1); §6 Changelog; Status line | D1, D2, D3, D4 (contains ADR-0042) |
| `docs/build/01-architecture.md` | §13 INV-58 Statement + Check cell; Status line | D2, D4 (contains ADR-0042) |
| `docs/build/02-routes-and-pages.md` | §1.1 `/support` row; §2.7 Sections + Data; §6 `/support` loading row; Status line | D1, D2, D6 (contains ADR-0042) |
| `docs/build/03-components.md` | C-13; §1.4 island row; §2.2 `Button` + `TrackedLink` emitter lists; §2.9 `KofiCard` (was `AmountPicker`) + `KofiPanelSlot`; §3 ARIA row; Status line | D1–D5 (contains ADR-0042) |
| `docs/build/04-server-contracts.md` | §5.6 `tip_click` row; §5.7 button + Empty rows; Status line | D1, D3 (contains ADR-0042) |
| `docs/build/05-test-plan.md` | §7 T-E2E-11; Status line | D7 (contains ADR-0042) |
| `docs/build/_registry.md` | slice table row S1.5b; Component registry "Support" | D4 (contains ADR-0042) |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0042 row |
| `docs/questions.md` | "Support page after first use (2026-09-18)" | David's decision + the Ko-fi findings |
| `.env.example` | `KOFI_PAGE` | `odsens` (D7) |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | no `AmountPicker` name or amount-picker text left operative in 00–05 / `_registry.md` / DESIGN.md; `KofiCard` props `{ kofiPage }`; `KofiPanelSlot` props `{ kofiPage; loaded }`; `lib/analytics.ts` unchanged |
| design-fidelity-reviewer | DESIGN.md v1.11 §11.4: slab recipe unchanged, the bar (`--slab`, 2px `--line-soft`, "← Back" `--white` 700, ghost link `--indigo-lift`), one box at a time, copy per D5, contrast of the bar pairs |
| frontend-reviewer | focus hand-off on the swap; the swap is user-initiated (no CLS); Back unmounts the frame; phone rows still font-swap-stable; island list still 42 |
| security-reviewer | 01 INV-58 by grep unchanged in substance — `ko-fi.com` URLs only in `lib/support.ts`, the one `<iframe` in `KofiPanelSlot`, rendered only by `KofiCard`, rendered only by `/support`; no Ko-fi script; no request before the click |
