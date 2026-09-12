# ADR-0039 — S1.5c Project editor v2: a slice inserted before the Support page

## Status
Accepted (2026-09-12 — planning PR #20)

## Date
2026-09-12

## Slice
S1.5c (new — inserted between S1.5a and S1.5b in build order)

## Context
Kind: addition
- Spec says: 00 §2 orders the remaining v1 work S1.5b Support page → S1.6 Videos → … (ADR-0036); the admin project editor (`/admin/projects/[id]`, 02 §1.3, 03 §2.10) is one long page of sections (DETAILS / OVERRIDES, LISTINGS, ICON, GALLERY, VERSIONS & FILES, PUBLISH), every field a plain `Field`, saves through PRG forms (03 C-17); the description and notes are bare textareas rendered by the server-only `lib/markdown.ts`.
- Reality / ask: Oliver's second-use list (2026-09-12, items 6 and 7 — `docs/questions.md`): a sidebar to jump between editor sections instead of scrolling everything (his example: Modrinth's General / Description / Tags / Versions / Gallery / Links …), and a Markdown toolbar with Preview for the description. David's decisions: one section at a time; an unsaved-changes indicator on the section title and a modal when leaving a section with unsaved edits; toolbar on the description and notes fields with Preview; this is a **redesign, not a fix** — planned as its own slice with documentation, and slotted **before the Support page** so Oliver can keep adding content and getting value from the site while the rest of the plan proceeds (ADR-0038 D6).

## Decision
1. **A new slice `S1.5c — Project editor v2` is inserted in build order between S1.5a and S1.5b, tag `v0.6.2`; S1.5b — Support page moves to tag `v0.6.3`.** The slice letter records insertion order (ADR-0036 D1's `S<phase>.<n><letter>` form), not build order — the 00 §1 tag table and §2 section order are the build order. S1.6 and everything after keep their IDs, tags and content. Full slice section in 00 §2 (this ADR's PR).
2. **Sections + sidebar (UI only — no server contract changes).** `/admin/projects/[id]` renders **one section at a time**, chosen by the query `?section=<id>` (default `general`; unknown → `general`): `general` (DETAILS on an odsens row / OVERRIDES on a synced row, with the comments toggle), `description` (the long description `body_md` on an odsens row / `notes_md` on a synced row), `gallery` (ICON + GALLERY), `versions` (VERSIONS & FILES), `listings` (LISTINGS), `publish` (PUBLISH — odsens rows). A synced row lists the sections it has. The sidebar is the §9 admin sidebar recipe (220px column at ≥900px; a horizontally scrollable chip row above the editor below 900px), active item with the gold left bar. Every PRG redirect keeps `?section=` (with `?saved=` / `?form=` as today), so a save lands back on the same section with the "Saved." toast (ADR-0038 D1). `/admin/projects/new` stays a single create form. The page stays a Server Component; forms stay `<form action>` server functions (03 C-17).
3. **Unsaved-changes guard.** A client island `EditorSections` (03 C-16a list) wraps the active section: it snapshots each form's `FormData` at mount and, on `input` / `change`, compares (pure helper `formIsDirty(initial, current)` in `lib/forms/dirty.ts`); dirty → an 8px gold dot after the active item's label plus visually-hidden "Unsaved changes", and the browser `beforeunload` prompt. A click on another section while dirty opens a `Dialog` (new primitive, native `<dialog>` with a scrim) — "Unsaved changes" / "You changed something here and didn't save." — **Stay** (primary, default, Esc) or **Leave anyway** (ghost → navigates, edits discarded). Submitting a form clears the state (the PRG reload resets it). Uploads commit at once and never count as unsaved.
4. **Markdown editor.** A client island `MarkdownEditor` replaces the plain textarea for `body_md` (odsens description) and `notes_md` (synced notes): a toolbar strip — H1 H2 H3 · Bold Italic Strike Code · bullet list, numbered list, quote · link, image, YouTube — and a Write / Preview `Toggle`. Buttons wrap or insert Markdown at the caret/selection through the pure `applyMarkdownCommand(value, selectionStart, selectionEnd, command)` in `lib/markdown/edit.ts` (Ctrl/Cmd+B and +I too); the image button inserts `![alt](url)` for an existing URL (uploads stay in the Gallery section); the YouTube button inserts the link on its own line (the public renderer shows a link; embeds are S1.6's call). **Preview renders through the site's own renderer** so it matches the public page: `lib/markdown.ts` loses its `server-only` marker (its renderer has no server dependency — react-markdown + remark-gfm + rehype-sanitize + `next/image`), `Markdown` (03 `S`) is unchanged, and `MarkdownEditor` is the one client importer (01 INV-65 amended: `react-markdown` is imported by `lib/markdown.ts` only, which may now be bundled into the admin editor island — no other client file imports it). The stored value stays plain Markdown; the sanitize schema is unchanged (raw HTML still skipped).
5. **Design (DESIGN.md v1.10, written in Session A by the design-fidelity skill unless a Claude Design pass lands first).** §11.3 #20 "Admin — Project editor v2": section sidebar = §9 admin sidebar recipe (Space Grotesk 15px items, 4px `--gold` left bar on the active item, the unsaved dot); the phone chip row = §5 filter-bar chips, active chip gold-wash; `Dialog` = 480px `--slab`, 2px `--line-soft`, `6px 6px 0 --ink-deep`, Bungee 22px title, one plain line, two right-aligned buttons, scrim `--ink` at .6 (token `--scrim`), focus trapped, Esc = Stay; Markdown toolbar = `--slab-sunk` strip above the textarea, 36px square ghost buttons with text glyphs in Space Grotesk 700 (H1 H2 H3 B I S `</>`) and list / quote / link / image / video glyphs from the existing `Icon` set, 2px `--line` separators, the Preview `Toggle` right-aligned; Preview pane = the public `Markdown` look inside a `--slab-sunk` well under a `PREVIEW` Silkscreen eyebrow. Voice: "Unsaved changes", "You changed something here and didn't save.", "Stay", "Leave anyway", "Preview".
6. **Tests (05 §8 row S1.5c; IDs assigned at Session A, H-13 append-only).** T-UNIT: `applyMarkdownCommand` (every command, empty / caret / selection cases, shortcut parity) and `formIsDirty`; T-E2E: sections + `?section=` deep link + PRG keeps the section, dirty dot, the dialog (Stay / Leave anyway), `beforeunload`, toolbar insertions, Preview parity with the public page, phone chip row, axe at 1280 + 390 for admin and moderator; T-E2E-35/42/51/53/54 amended in place where they navigate the editor (a `?section=` on the URL). Gates: all seven — `frontend-reviewer` focus: the island boundary (forms stay server functions, no fetch) and the admin-route bundle growth from the client renderer; `design-fidelity-reviewer`: DESIGN.md v1.10; `security-reviewer`: Preview never renders raw HTML, the toolbar inserts text only.
7. **Order after this ADR:** S1.5c → S1.5b (`v0.6.3`) → S1.6 Videos → S1.7 → S1.8 → S1.9 → S1.10.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Jump links on the long page | David chose one section at a time (Oliver's example); shorter pages also load faster. |
| Client-side tabs holding every section's form at once | Dirty state across six sections and one giant island; the server-rendered `?section=` keeps forms as they are (C-17) and the guard trivially per section. |
| Inline strip instead of a modal for the leave guard | David asked for a modal; `InlineConfirm` stays for destructive row actions. |
| Preview through a server action returning HTML | Would need `dangerouslySetInnerHTML` (banned, INV-86); the renderer is already React and safe to bundle for the admin route. |
| Build it inside fix pass 3 | A redesign with new primitives and a DESIGN.md pass, not a fix (ADR-0038 D6). |
| Slot it after the Support page | David: Oliver adding content is the value right now; Support follows. |

## Consequences
- Positive: Oliver edits one thing at a time, sees what's unsaved, can't lose edits by mis-clicking, and writes Markdown with buttons and a live preview that matches the site.
- Negative: the admin editor route's client bundle grows by the Markdown renderer (~40–60 KB gz, admin only); e2e specs that open the editor gain a `?section=`; two new primitives (`Dialog`, `MarkdownEditor`) and one island (`EditorSections`) to keep in DESIGN.md / 03.
- Follow-ups: S1.6 decides YouTube embeds in Markdown; `/admin/projects/new` could adopt the Markdown editor for its description later.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/00-build-plan.md` | §1 tag table (S1.5c `v0.6.2`, S1.5b `v0.6.3`); §1 gate matrix row; §2 new section "S1.5c — Project editor v2" (before S1.5b; S1.5b's tag line); §4.2 tables row; §4 sections/nav row; §6 changelog + Status | contains ADR-0039 |
| `docs/build/01-architecture.md` | INV-65 (`react-markdown` importer rule); Status line | Decision 4 |
| `docs/build/02-routes-and-pages.md` | §1.3 `/admin/projects/[id]` row (S1.5c: `?section=`, sidebar, guard, Markdown editor); §8 row S1.5c; Status line | Decisions 2–4 |
| `docs/build/03-components.md` | §2 rows `EditorSections`, `Dialog`, `MarkdownEditor` (C); §2.10; Status line (island-list paths added at Session A) | Decisions 3–4 |
| `docs/build/05-test-plan.md` | §8 row S1.5c (IDs at Session A); §12 note; Status line | Decision 6 |
| `docs/build/_registry.md` | Slice table row S1.5c; Modules (`lib/forms/dirty.ts`, `lib/markdown/edit.ts`); Admin components | names |
| `docs/build/START-BUILD.md` | Current position → S1.5c next | Decision 7 |
| `DESIGN.md` | v1.10 written at Session A (this ADR pins the rules) | Decision 5 |
| `docs/build/06-decisions/README.md` | §7 Index | new row |
| `docs/questions.md` | Oliver's second-use list (2026-09-12) — the plan recorded | decision recorded |

## Gate impact
| Gate agent | What it now checks differently |
|---|---|
| `spec-drift-reviewer` | S1.5c section in 00; `?section=` in 02; the three components in 03 + island list at Session A; INV-65's new importer rule; S1.5b tag `v0.6.3` |
| `frontend-reviewer` | `EditorSections` / `MarkdownEditor` islands receive data as props and call nothing but the existing server functions; `beforeunload` + `<dialog>` a11y; bundle delta on `/admin/projects/[id]` only |
| `design-fidelity-reviewer` | DESIGN.md v1.10 recipes (sidebar, chip row, `Dialog`, toolbar, Preview pane) |
| `security-reviewer` | Preview uses the same sanitize schema; no raw HTML path; toolbar inserts text only |
