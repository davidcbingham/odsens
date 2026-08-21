# ADR-0018 — Profile menu items: Your profile, Admin, Sign out

## Status
Accepted

## Date
2026-08-21

## Slice
S1.1

## Context
Kind: design
- Spec says: `DESIGN.md` §11.1 Profile menu — "Open: 236px slab, `4px 4px 0`, header with 40px picture + handle + `SIGNED IN` in Silkscreen, then Your profile / Change handle / Change picture, and **Sign out** in `--danger` behind a 2px top border." `docs/build/03-components.md` §2.5 `ProfileMenu` row — "items: Your profile · Change handle (own rename via `updateProfile`, 1 per 7 days — ADR-0002 #27) · Change picture · [Admin — role ≥ moderator: link `/admin`, O-6] · [Your orders (n) — S2.2, only when `FLAGS.commissions`]". `docs/build/02-routes-and-pages.md` RP-12 — "`ProfileMenu` items → routes: "Your profile" → `/profile`; "Change handle" → `/profile#handle`; "Change picture" → `/profile#picture`; "Admin" → `/admin` (role ≥ moderator only, 03 N-06); …"; §1 `/profile` row Notes — "ProfileMenu → "Your profile" / `#handle` / `#picture`".
- Found: David reviewed the S1.1 preview on 2026-08-21: "Once logged in, 'Your Profile', 'Change Handle', and 'Change Picture' are redundant — they all go to the same page. Remove 'Change Handle' and 'Change Picture', keep just 'Your Profile' in the menu." The three items differ only by a fragment on `/profile`, and that page is the picture row + the handle row + a footer strip (DESIGN.md §11.3 #11; ADR-0014 `ProfilePanel`) — the menu loses nothing a visitor can reach. A change to an existing `DESIGN.md` rule = DESIGN.md edit + changelog line + an ADR (`Kind: design`) in the same PR (README ADR-R8).
- Related: no `Q<nn>` changes — the product decision is recorded in `docs/questions.md` S1.1 build notes (2026-08-21); D1–D5 of ADR-0014 are unaffected · supersedes none.

## Decision
1. `components/accounts/ProfileMenu.tsx` renders exactly these `role="menuitem"` entries, in order: **Your profile** → `/profile`; **Admin** → `/admin` only when `viewer.role` is `moderator` or `admin` (03 N-06, unchanged); **Sign out** as the submit of `<form method="post" action="/auth/sign-out">` (01 INV-17, unchanged). No "Change handle" and no "Change picture" item; no `/profile#handle` / `/profile#picture` link anywhere in the menu (`grep -n "profile#" components/accounts/ProfileMenu.tsx` is empty).
2. `/profile` keeps the `id="handle"` and `id="picture"` form anchors (`components/accounts/ProfilePanel.tsx`) — harmless and still linkable; nothing else on `/profile` changes.
3. The S2.2 "Your orders (n)" item (03 §2.5, `FLAGS.commissions`) is untouched — it arrives in its own slice between Admin and Sign out, as 03 already says.
4. `DESIGN.md` is v1.4: §11.1 Profile menu reads "then Your profile (and Admin for moderators/admins), and **Sign out** …" with a header changelog line naming this ADR. The trigger, the 236px slab, its header, the tokens and the Sign out treatment are unchanged — no token, state or component is added or removed.
5. `tests/e2e/flows/sign-out.spec.ts` (T-E2E-32) asserts the menu items `['Your profile', 'Sign out']` for a plain user; `tests/fixtures/ui/profileMenu.ts` (T-E2E-48) is unchanged — its moderator / admin fixtures already exercise the Admin item.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep the three items as designed (pass-2 / pass-3 prototypes) | The owner reviewed them on the preview and asked for the change; three links to one page are noise in a 236px slab. |
| Keep "Change handle" / "Change picture" but drop them on phone only | The same redundancy at every width; the phone panel renders the same item list (03 `ProfileMenu`: "Phone: inside the `NavMenuButton` panel"). |
| Turn the two items into in-menu controls (rename / upload inside the popover) | Forms inside `role="menu"` break the menu a11y contract (03 `ProfileMenu` a11y cell: `menuitem`s only); `/profile` already is that form (ADR-0014 `ProfilePanel`). |

## Consequences
- Positive: a shorter menu (two or three links + Sign out); one fewer list to keep in sync between DESIGN.md, 02 RP-12 and the component; `/profile` is the single place the handle and the picture are edited.
- Negative: the pass-2 / pass-3 prototypes (`design/claude-design-export/pass-*/`) still draw the three items — snapshots are not re-exported; DESIGN.md v1.4 wins (`docs/design-process.md`).
- Follow-ups: none → `design-fidelity` checks the open menu against DESIGN.md v1.4 §11.1 from this PR on; `keep-docs` flips this ADR to `Accepted` at merge.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `DESIGN.md` | header — title `(v1.3a)` → `(v1.4)`; changelog line | `> v1.4 (2026-08-21): … ADR-0018` (contains the string ADR-0018) |
| `DESIGN.md` | §11.1 Profile menu | items = Your profile (and Admin for moderators/admins) + Sign out; Change handle / Change picture removed (contains the string ADR-0018) |
| `docs/build/03-components.md` | §2.5 `ProfileMenu` row | items list rewritten (contains the string ADR-0018) |
| `docs/build/03-components.md` | §12 Changelog; `Status:` line | new row; appended "— amended by ADR-0018 (2026-08-21)" (README ADR-R2) |
| `docs/build/02-routes-and-pages.md` | RP-12 | `ProfileMenu` items → routes without the two `#` items (contains the string ADR-0018) |
| `docs/build/02-routes-and-pages.md` | §1 `/profile` row, Notes cell | "ProfileMenu → "Your profile"" (contains the string ADR-0018) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0018 (2026-08-21)" (README ADR-R2) |
| `docs/build/00-build-plan.md` | §6 Changelog | new row "ADR-0018 — profile menu items" (contains the string ADR-0018) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0018 (2026-08-21)" (README ADR-R2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0018 |
| `docs/questions.md` | S1.1 build notes | 2026-08-21 line: David's decision + ADR-0018 (contains the string ADR-0018) |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `components/accounts/ProfileMenu.tsx` `links` = Your profile + conditional Admin only (`grep -rn "Change handle\|Change picture\|profile#" components/` is empty); 02 RP-12, the 02 `/profile` row, 03 §2.5 and DESIGN.md §11.1 agree with Decision 1; this ADR listed under `## ADRs in this PR` |
| design-fidelity-reviewer | the open menu matches DESIGN.md v1.4 §11.1: header, then Your profile (+ Admin for role ≥ moderator), then Sign out in `--danger` behind the 2px top `--line` — no other items; geometry and tokens unchanged |
| frontend-reviewer | `role="menu"` still holds only `menuitem` children (axe `aria-required-children`); arrow / Home / End navigation spans the shorter list; T-E2E-32's item assertion is `['Your profile', 'Sign out']` |
| security-reviewer, backend-reviewer, supabase-reviewer, deploy-checker | none |
