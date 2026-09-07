# ADR-0033 — The admin header carries the odsens mark as the way back to the public site

## Status
Proposed

## Date
2026-09-06

## Slice
cross-cutting (fixes a gap present since S1.1, when `AdminShell` landed)

## Context
Kind: deviation
- Spec says: `docs/build/03-components.md` §2.10 `AdminShell` — "Header strip: \"ADMIN\" `PixelLabel` + `ProfileMenu`". `DESIGN.md` §9 (9) describes the Admin screen as the 220px sidebar, queue table, forms and file well, and says nothing about the header strip at all.
- Found: **the admin section has no control that returns to the public site.** The sidebar links are all `/admin/*`, the "ADMIN" label links to `/admin`, and `ProfileMenu` offers Your profile · Admin · Sign out (ADR-0018) — none of them reach `/`. A moderator or admin who wants to look at the live site has to edit the URL or use the browser's history. Every other shell on the site opens with the odsens mark linking home (03 N-02 for `Nav`, and the onboarding shell's wordmark, 02 RP-11), so admin is the one place the established way home is missing.
- Related: David, 2026-09-06 ("The Admin section of the site has no button to get back to the main site") · ADR-0032 (the crown is the site mark — this ADR places that mark in the admin header) · ADR-0018 (`ProfileMenu` items, which is why the menu is not the place for it).

## Decision
1. **The header strip opens with the odsens mark linking to `/`.** `components/admin/AdminShell.tsx` renders, left to right: `<Link href="/" aria-label="odsens home">` containing `Avatar size={28} src="/brand/avatar-80.png" alt="OddSense"` + a `ODSENS` wordmark span, then the existing `<Link href="/admin" aria-label="Admin home">` "ADMIN" `PixelLabel`, then `ProfileMenu` on the right. The two left links are wrapped in one `admin-shell-header-left` flex group so the strip's `justify-content: space-between` stays a two-way split (brand+section vs. the menu) instead of spreading three children across the bar.
2. **It mirrors `Nav` N-02, at admin scale.** Same composition (avatar + wordmark, one link, one `aria-label`), same `--font-display` / `--text-wordmark` / `--white` wordmark, same 44px minimum target (03 C-24). The avatar is `size={28}` rather than the nav's 40: the admin strip's other elements are a 12px `PixelLabel` and the 28px `ProfileMenu` trigger picture, so 40 would make the mark the largest thing in the bar and outweigh the section it labels. No new component (03 C-22/C-23 — `Avatar` and the wordmark pattern are both described), no new token.
3. **The ADMIN label keeps its own link and meaning.** It still points at `/admin` with `aria-label="Admin home"`; the two links are distinguishable by accessible name, and the section identity is unchanged.
4. **`DESIGN.md` §9 (9) gains the header-strip sentence** so `design-fidelity-reviewer` has a source of truth to check against — the pass-2/pass-3 admin frames predate this and show the strip without the mark, which would otherwise read as drift. Changelog entry v1.7.
5. **T-E2E-33 asserts it**: inside the admin header, a link named "odsens home" with `href="/"`, containing the `ODSENS` wordmark and the `avatar-80.png` image, alongside the existing "Admin home" → `/admin` link.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Add a "Back to site" item to `ProfileMenu` | ADR-0018 deliberately cut that menu to three items (Your profile · Admin · Sign out) after David found redundant entries confusing; a navigation escape hatch hidden behind a menu is also weaker than a persistent control, and the menu is shared with the public nav where `/` is already one click away. |
| Add a "Site" item to the admin sidebar | The sidebar is the admin section's own map (02 RP-14, a fixed order the specs and T-E2E-33 pin); an outbound link in it would break that reading and sit oddly among items that all carry counts and active state. |
| Make the existing "ADMIN" label link to `/` | Loses the `/admin` dashboard link, and a label reading ADMIN that navigates away from admin is a trap. |
| A plain "← odsens.com" text link | Works, but the mark is what every other shell uses for home; inventing a second convention for one screen is the drift, not the fix. |
| Leave it — the browser has a back button | Back only helps if you arrived from the site; a bookmarked `/admin` or a fresh sign-in has no history to go back to. |

## Consequences
- Positive: admin has a persistent, conventional way back to the public site; the shell now matches every other shell's opening element; the crown mark (ADR-0032) appears consistently across public, onboarding and admin chrome.
- Negative: the header strip carries two links where it carried one, so screen-reader users tab through one more control before the page; the admin frames in `design/claude-design-export/pass-2|3/` no longer match the built header until they are re-exported (recorded as the follow-up).
- Follow-ups: re-export the admin frames with the mark when the design export is next regenerated → owner `design-fidelity`; if a third left-side element is ever proposed for this strip, revisit the grouping rather than adding a fourth flex child.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/03-components.md` | §2.10 `AdminShell` row; Status line | header strip is odsens mark → `/` + ADMIN → `/admin` + `ProfileMenu` (contains ADR-0033) |
| `DESIGN.md` | §9 (9) Admin; changelog v1.7 | the header-strip sentence (contains ADR-0033) |
| `docs/build/05-test-plan.md` | §7.3 T-E2E-33; Status line | the home-link assertion (contains ADR-0033) |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0033 row |
| `docs/questions.md` | 2026-09-06 entry | the decision recorded |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `AdminShell`'s header renders the `/` mark link before the ADMIN label; 03 §2.10, DESIGN.md §9 (9) and 05 T-E2E-33 all state it and cite ADR-0033 |
| design-fidelity-reviewer | the admin strip is mark + ADMIN + `ProfileMenu`; wordmark in `--font-display` at `--text-wordmark` in `--white`, avatar `size=28`, 44px targets; the pass-2/3 admin frames are known-stale here (Consequences) |
| frontend-reviewer | two distinctly-named links in the header (`odsens home`, `Admin home`), no new client component, axe clean on `/admin` |
