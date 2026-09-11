# ADR-0035 — Look-and-feel fixes from Oliver's first use: themed `Select`, 2 px avatar outline, page fade, loader checkbox grid

## Status
Proposed

## Date
2026-09-11

## Slice
cross-cutting (fix pass 2 on `main` after v0.6; touches S0 primitives, S1.1 nav/profile, S1.2 filter bar, S1.3 admin forms)

## Context
Kind: design
- Spec says: 03 §2.2 `Select` — `Sh` "native `<select>`" (DESIGN.md §5 Filter bar "3px-radius selects", §5 Admin field); 03 §2.2 `Avatar` — `border?: 2|3 /* default 3 */`, DESIGN.md §3 "3px white border on avatars and portraits", §5 Nav "Avatar (40px, white border)"; DESIGN.md §8 Motion — "120–180ms, ease-out … Respect `prefers-reduced-motion`" and nothing about route changes; 03 §2.3 `TipPanel` "one dry line"; 04 §1.4 `createExclusiveProject` / `updateExclusiveProject` / `uploadProjectFile` take `loaders: string[]` (the 04 shared `LOADERS` enum) and the admin forms collect it as a comma-separated text field (02 §1.3 `/admin/projects/new`; `UploadWell` version fields).
- Found (Oliver, 2026-09-11): (4) the Version / Sort / Type / Channel dropdowns open the device's native picker, which looks nothing like the rest of the site (the profile menu is the reference); (5) the 3 px white avatar outline reads as a thick frame — the crown mark especially; (9) the tip-panel line "Keeps the mods free and the pipe loud." should go; (8) moving between sections is a hard cut; (11) typing loaders as a comma list is error-prone when the set is fixed. David's calls: every dropdown, admin included, becomes the themed version; the outline becomes the card/button outline width (2 px) on every avatar and the mark; a subtle page fade; one plain line "Support OddSense on Ko-fi"; loaders become a fixed-list checkbox grid, game versions stay typed.
- Related: ADR-0018 (`ProfileMenu` — the popover pattern the listbox mirrors), ADR-0032/0033 (the crown mark this outline change touches), ADR-0034 (fix pass 1), 03 C-16a (client-island list), `docs/questions.md` 2026-09-11.

## Decision
1. **`Select` is a themed listbox and a client island (D1).** `components/primitives/Select.tsx` gains `'use client'` and renders a trigger `<button aria-haspopup="listbox" aria-expanded>` in the admin-field/filter recipe (unchanged rest look: `--slab-sunk`, 2 px `--line-soft`, 3 px radius, `▾` glyph) and, open, a `role="listbox"` panel in the profile-menu recipe (`--slab`, 2 px `--line-soft`, `4px 4px 0 --ink-deep`, `--dur-fast` fade-in) with `role="option"` rows (44 px, hover/active `--slab-raised`, selected = `--indigo-lift` text + `✔`). Keyboard: Enter/Space/ArrowDown open; Arrow/Home/End move; type-ahead; Enter selects; Esc closes and refocuses; Tab closes; click outside closes. A hidden `<input type="hidden" name value>` keeps server forms and `FormData.get(name)` working unchanged; `label`/`name`/`options`/`value`/`defaultValue`/`onChange`/`compact`/`disabled` props are unchanged (03 C-03 additive: none). The trigger carries `id="select-<name>"` and `aria-labelledby` the label so `getByLabel('Type')` still resolves. Native `<select>` is gone; `selectOption` in e2e becomes click + option.
2. **Avatar outline is 2 px everywhere (D2).** `Avatar` drops the `border` prop; the CSS border is `2px solid var(--white)` for every size, the same width as card and button outlines (DESIGN.md §3). Callers that passed `border={2}` lose the prop; the brand-file `unoptimized` comment updates its arithmetic (36 px content box at size 40). The `/welcome` picture-upload "Done" preview (`AvatarUpload`, DESIGN.md §11.1) follows the same rule — 2 px.
3. **Route changes fade in (D3).** `app/(public)/template.tsx` and `app/admin/template.tsx` wrap the page in a `div` with a `page-in` animation: opacity 0 → 1 and translateY 3 px → 0 over `--dur-fast` (150 ms) ease-out; under `prefers-reduced-motion: reduce` the transform is dropped and only the opacity runs (DESIGN.md §8 "drop transforms, keep colour changes"). `template.tsx` remounts per navigation, which is what replays it; layouts are untouched, so nav/footer never fade. No `experimental.*`, no View Transitions API (ADR-0002 C1).
4. **Loaders are a checkbox grid (D4).** New primitive `CheckGrid` (03 §2.2; `Sh`): a `<fieldset>` with the field label as `<legend>` and one square checkbox per option (the §11.1 square-toggle look: 22 px, `--line-strong`, on = `--indigo-lift` + `✔`), name repeated per box so `formData.getAll(name)` yields the list. Used for Loaders on `/admin/projects/new`, the `/admin/projects/[id]` DETAILS form and the `UploadWell` version form; options = the 04 shared `LOADERS` enum in its order, labels via `loaderLabel` (ADR-0034 D2). The page glue reads `formData.getAll('loaders')` instead of splitting a comma string; the `UploadWell` client state becomes `string[]` (controlled `value`/`onChange`); options = `LOADER_OPTIONS` in `lib/format/loader.ts`. The 04 §1.4 action inputs (`loaders: string[]`) are unchanged. Game versions and categories stay comma text fields.
5. **`TipPanel` copy (D5, copy only — ADR-R9, recorded here for the trail).** The dry line is "Support OddSense on Ko-fi."; the button stays "Tip a dollar" → `/support`.

## Alternatives considered
| Alternative | Why not |
|---|---|
| `appearance: base-select` (customisable select, CSS-only) | Chromium-only today; Safari/Firefox keep the device picker, which is the complaint. |
| Style the native `<select>` harder | The open picker is OS-drawn; no CSS reaches it. |
| Keep `border` prop with default 2 | Nothing would pass 3 any more; a dead option in a primitive is drift waiting to happen. |
| View Transitions API for the fade | Behind `experimental.viewTransition` in Next (ADR-0002 C1 forbids `experimental.*`); `template.tsx` + CSS is enough for a 150 ms fade. |
| Fade inside `layout.tsx` | Layouts persist across navigations, so the animation would run once; `template.tsx` exists for exactly this. |
| Multi-select `<select multiple>` for loaders | The device picker again, and a poor phone experience; the square-toggle grid is already the site's multi-choice idiom (notification matrix). |

## Consequences
- Positive: every dropdown matches the profile menu; avatars and the crown sit lighter; sections ease in; loaders are picked, not typed; the tip line is plain.
- Negative: `Select` ships ~2 KB gz of client code to `/projects` (it was already inside the `FilterBar` island) and now to the admin forms; a custom listbox needs its own a11y care (axe + keyboard e2e cover it); admin e2e that used `selectOption` changes.
- Follow-ups: `UploadWell`'s Channel select and the `/admin/settings` radios are untouched (radios are already square toggles); when the cross-posting slice adds a "Modrinth listing" field it uses `Field`, not `Select`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/03-components.md` | §2.2 `Select`, `Avatar`, `AvatarUpload`, new `CheckGrid` row; §1.4 client-island list; §2.3 `TipPanel`; §4 N-02; C-08 note; Status line | listbox + `C`; 2 px border everywhere, no `border` prop; the grid; the plain line (contains ADR-0035) |
| `docs/build/02-routes-and-pages.md` | §1.3 `/admin/projects/new`, `/admin/projects/[id]` rows; Status line | `CheckGrid` Loaders + themed `Select` (contains ADR-0035) |
| `docs/build/01-architecture.md` | §1 tree `app/(public)/`, `app/admin/` | `template.tsx` route fade (contains ADR-0035) |
| `DESIGN.md` | §3 borders; §5 Filter bar, Nav; §8 Motion; §11.1 Picture upload; changelog v1.8 | 2 px avatar outline (incl. the upload preview); themed listbox; route fade rule (contains ADR-0035) |
| `docs/build/05-test-plan.md` | §7.5 T-E2E-2 (listbox leg), T-E2E-35 (combobox + grid steps), T-E2E-50 (new); §8 S1.2/S1.3; Status line | the new assertions (contains ADR-0035) |
| `docs/build/_registry.md` | Components; Modules | `CheckGrid`; `format/loader.ts` `LOADER_IDS`/`LOADER_OPTIONS` |
| `docs/build/00-build-plan.md` | §6 Changelog | row for ADR-0035 |
| `docs/build/06-decisions/README.md` | §7 Index | new ADR-0035 row |
| `docs/questions.md` | 2026-09-11 entries | fix pass 2 recorded |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `Select` on the C-16a list; `Avatar` props; `template.tsx` files in 01 §1; `CheckGrid` row; `getAll('loaders')` in 04 §1.4; T-E2E rows for the listbox |
| design-fidelity-reviewer | listbox panel = profile-menu recipe; 2 px `--white` avatar border at every size; fade 150 ms / reduced-motion opacity-only; `CheckGrid` = square-toggle look; tip line copy |
| frontend-reviewer | listbox keyboard + `aria-*`, focus return, axe clean on `/projects` + admin forms; `template.tsx` does not remount providers; no layout shift from the fade |
