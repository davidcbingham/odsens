# ADR-0038 — Fix pass 3 after Oliver's second use: editor feedback, gallery curation, unframed crown, analytics early

## Status
Accepted (2026-09-12 — fix pass 3 merge, PR #19)

## Date
2026-09-12

## Slice
none (fix pass 3 — Oliver's second-use list, `docs/questions.md` "Oliver's second-use list (2026-09-12)")

## Context
Kind: deviation
- Spec says: 03 C-30 keeps form errors inline and the admin pages answer a successful save with a bare PRG redirect (02 §1.3, 04 §1.4) — nothing tells Oliver a save landed; 03 §2.2 `Avatar` draws a 2px white border on every size (ADR-0035 D2) and DESIGN.md §5 Nav / §9 Admin put the crown site mark inside one; the `/admin/projects/[id]` gallery lists paths (02 §1.3, 03 §2.10) with no picture, no name box and no way to remove an image — the Modrinth-synced gallery is sync-owned (`projects.gallery`, 04 §3.1) and the uploaded extras (`project_overrides.extra_gallery`, ADR-0002 C10) can only be appended by `uploadProjectMedia`; 01 INV-59 mounts `@vercel/analytics` "from S1.10" (00 §S1.10 enables Web Analytics at launch).
- Reality / ask: Oliver (relayed by David, 2026-09-12) — no "saved" signal when editing or creating a project; no way to delete a gallery image; no gallery preview; no image names (from Modrinth or set here); the crown next to ODSENS should have no white box; and he wants visitor analytics now. David's decisions: Vercel's dashboard first (an admin page later); Modrinth names shown and editable here; thumbnails in the editor; Modrinth images are hidden (the sync would bring a deleted one back), uploaded images deleted; the two larger asks — a section sidebar with an unsaved-changes indicator + modal, and a Markdown toolbar with Preview — become their own slice, planned in a follow-up docs PR before the Support page.

## Decision
1. **"Saved." toast after every admin save (D1).** The admin PRG round-trip gains one query key: a successful action redirects to the same page with `?saved=<key>` (`saved` → "Saved.", `created` → "Project created.", `removed` → "Removed."; `uploaded` reserved). A new client island `components/admin/SavedToast.tsx` (`SavedToast { messageKey }`, 03 C-16a list; the key vocabulary + `isSavedMessageKey` live in the plain module `components/admin/savedMessages.ts` so the server pages can validate the query) calls `useToast()` once on mount and strips the query with `history.replaceState` so a reload or back-navigation does not repeat it; it renders nothing. Wired on `/admin/projects/[id]` (details, overrides, listings link/remove, status, comments toggle, gallery), `/admin/projects` (`curateAndRefresh`) and `/admin/projects/new` (→ `/admin/projects/<id>?saved=created`). Errors stay inline (03 C-30 unchanged); the toast is the `ProfilePanel` "Saved." precedent (ADR-0014), DESIGN.md §11.1 Toast.
2. **The crown site mark is unframed (D2).** `Avatar` gains `frame?: 'outline' | 'none'` (default `'outline'`); `'none'` sets `border-color` and `background` transparent (`data-frame="none"`) so the box keeps its size and the header rhythm is unchanged. `Nav` (40px) and `AdminShell` (28px) pass `frame="none"`; person avatars and the OddSense byline avatars keep the 2px white border. DESIGN.md v1.9 §5 Nav, §9 Admin.
3. **Gallery curation in the editor (D3).** (a) New column `project_overrides.gallery_overrides jsonb not null default '[]'` = `[{url, hidden?: boolean, title?: string}]` keyed by `projects.gallery[].url` (migration `20260912120000_project_overrides_gallery_overrides.sql`; RLS unchanged; `lib/supabase/types.ts` regenerated). `lib/data/projects.ts` exports `parseGalleryOverrides` + `applyGalleryOverrides(entries, overrides)`; `mergeGallery(base, extra, title, overrides)` applies them to the synced entries only — a hidden image is dropped everywhere it is read (detail gallery, hero rail, the featured/OG pick), an overridden title replaces the Modrinth caption. (b) `curateProject` accepts `gallery_overrides?: [{url: URL ≤ 2048, hidden?, title?: ≤ 120 | null}] max 40`; an `extra_gallery` path stored on the row and absent from the input has its `project-media` object removed after the upsert (`removeObjectQuietly`, best-effort). (c) `updateExclusiveProject` accepts `gallery?: [{url, title?, description?, ordering, featured?}] max 20` editing `projects.gallery` in place — every `url` must already be stored (uploads add entries; an unknown url → `validation` "That image isn't in this project's gallery."), an entry left out is removed and its Storage object deleted. (d) `/admin/projects/[id]` renders ONE `GALLERY` section on both branches: per image a 96×64 thumbnail (`next/image`), a "Name" `Field`, a home word ("From Modrinth" / "From Modrinth — hidden on odsens" / "Uploaded here" — a word, never a colour alone, 03 C-26) and one row button — Hide/Show for a Modrinth image, Delete for an uploaded one — plus "Save names"; one `<form>` carries every row as indexed hidden inputs, the row buttons are per-button server functions (`Button` gains a `formAction` pass-through, React 19). `own` rows (odsens project) → `updateExclusiveProject`, `synced` + `extra` rows → `curateProject`. The home word is the Name `Field`'s `helper` (so it is `aria-describedby` on the input). A visually-hidden default submit button stands first in the form so implicit submission (Enter in a Name field) means "Save names", never the first row's Hide/Delete. A posted form whose `gallery_count` is missing, above 60 or whose rows are incomplete is refused with an inline error and nothing is written — a save writes the rows as the whole gallery, so truncation could delete by omission. `uploadProjectMedia` refuses a 21st gallery image on either source ("20 images maximum." — the `curateProject` / `updateExclusiveProject` bound). `gallery_overrides.url` is https-only. Moderators see the fields and buttons disabled with "Admin only" (03 §2.10). `lib/data/admin.ts` exports `parseProjectGallery` (stored urls, unresolved) and `parseGalleryOverrides`; `getAdminProject.override.galleryOverrides`.
4. **Vercel Web Analytics now, not at launch (D4).** `@vercel/analytics` (already on the INV-78 list) is installed and `<Analytics />` is mounted once in `app/(public)/layout.tsx` (admin/onboarding stay without, ADR-0002 C5); the CSP already allows `va.vercel-scripts.com` / `vitals.vercel-insights.com` (01 §20). David enables Web Analytics on the Vercel project (dashboard toggle — no code); the four custom events of 04 §5.6 start flowing through the existing `window.va` path. Speed Insights and the S1.10 verification (`S1.10.AC5`) stay at launch. 01 INV-59 and 00 §S1.10 amended.
5. **Tests (D5; 05 §8 row S1.3, H-13 append-only).** T-UNIT-51 (`parseGalleryOverrides`, `applyGalleryOverrides`, `mergeGallery` with overrides), T-ACT-85 (`curateProject` `gallery_overrides` + a dropped extra deletes its object; bounds), T-ACT-86 (`updateExclusiveProject` gallery names / removal + object / unknown url), T-E2E-54 (Save → "Saved." toast + query stripped; rename + Hide/Show a Modrinth image on the seed synced project with the public gallery following; moderator disabled; axe; `gallery_overrides` reset in `afterAll`), T-E2E-50 amended (the nav mark's border colour is transparent).
6. **Deferred to its own slice (D6).** The editor section sidebar (one section at a time, an unsaved-changes dot on the section title and a modal when leaving with unsaved edits) and the Markdown toolbar + Preview on the description and notes fields are a redesign, not a fix: planned in a follow-up docs PR as a new 00 §2 slice before S1.5b (with its own ADR), so Oliver can keep adding content while the rest of the plan proceeds (David, 2026-09-12).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Delete a Modrinth image from `projects.gallery` | Sync-owned: the hourly sync re-writes it. An override keyed by url survives the sync and can be undone. |
| Toast from inside each server function | Server functions cannot toast; the PRG query + a mount-once island is the smallest client surface (renders nothing). |
| A `Nav`-only CSS override for the crown | A prop on `Avatar` keeps the rule in one place and documents it (03 C-03 additive prop). |
| Leave analytics at S1.10 | David wants visit counts now; the package and CSP entries were already reserved, so the pull-forward is a mount and a dashboard toggle. |
| Build the editor sidebar + toolbar in this pass | David: a proper redesign with a plan, not a fix — its own slice. |

## Consequences
- Positive: Oliver gets a saved signal everywhere in the projects admin, sees and names his pictures, can hide or delete them, sees visits; the crown reads as a logo.
- Negative: `gallery_overrides` entries for urls Modrinth later removes linger harmlessly (max 40); a Delete removes the Storage object at once — no undo (the row buttons are ghost, not confirmed; Oliver can re-upload); a second tab's stale gallery form can still drop a picture uploaded from the first tab (delete-by-omission is inherent to "the rows are the gallery"); `fold_project` step (f) merges override columns column-wise and does not carry a duplicate's `gallery_overrides` onto an existing canonical override row — harmless, the canonical is odsens-owned and overrides apply to synced entries only.
- Follow-ups: the editor redesign slice (D6, docs PR next); an admin Visits page once Oliver has used the Vercel dashboard; Speed Insights + `S1.10.AC5` at launch.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/00-build-plan.md` | §S1.10 Scope (analytics mounted earlier); §6 changelog + Status line | contains ADR-0038 |
| `docs/build/01-architecture.md` | INV-59; Status line | D4 |
| `docs/build/02-routes-and-pages.md` | §1.3 `/admin/projects`, `/admin/projects/new`, `/admin/projects/[id]` rows; Status line | D1, D3 |
| `docs/build/03-components.md` | §1.4 client-island list (`SavedToast`); §2 admin table (`SavedToast`), `Avatar` row (`frame`), `Button` row (`formAction`) + C-03; §2.10; Status line | D1, D2, D3 |
| `docs/build/04-server-contracts.md` | §1.4 `curateProject` Input/Effects, `updateExclusiveProject` Input/Effects, `uploadProjectMedia` Effects (the 20-image cap); Status line | D3 |
| `docs/build/05-test-plan.md` | §7.2 T-ACT-85/86, §7.4 T-UNIT-51, §7.5 T-E2E-54 + T-E2E-50 amended, §8 row S1.3, §12 note; Status line | D5 |
| `docs/build/_registry.md` | Admin components (`SavedToast`) | D1 |
| `docs/data-model.md` | §2 `project_overrides` (`gallery_overrides`); §6 curate flow | D3 |
| `DESIGN.md` | v1.9: §5 Nav, §9 Admin (crown unframed) | D2 |
| `docs/build/06-decisions/README.md` | §7 Index | new row |
| `docs/questions.md` | Oliver's second-use list (2026-09-12) | decisions recorded |

## Gate impact
| Gate agent | What it now checks differently |
|---|---|
| `spec-drift-reviewer` | `SavedToast` on the C-16a list; `Avatar.frame`; `Button.formAction`; the `gallery_overrides` column in data-model; INV-59 timing; T-UNIT-51 / T-ACT-85 / T-ACT-86 / T-E2E-54 present |
| `supabase-reviewer` | one additive migration (`add column if not exists`, default `'[]'`), no RLS change; types regenerated |
| `backend-reviewer` | `curateProject` / `updateExclusiveProject` delete Storage objects only for paths dropped from the stored row; unknown gallery url → `validation`; zod bounds |
| `security-reviewer` | `gallery_overrides.url` is stored, never fetched; object removal is scoped to the project's own folder via the stored row; `?saved=` is an allow-listed key, never echoed |
| `design-fidelity-reviewer` / `frontend-reviewer` | DESIGN.md v1.9 crown; the GALLERY rows (thumbnail, `Field`, ghost buttons, 44px targets, C-26 words); `<Analytics />` only in the public layout; `SavedToast` renders nothing and strips the query |
