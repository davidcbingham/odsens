# design/ — Claude Design handoff materials

Each Claude Design cycle lands in its own folder under `claude-design-export/`. The durable artifact is repo-root
**`DESIGN.md`**; the folders are raw reference (open the `.dc.html` prototypes in a browser). Do not edit exports in place.
Claude Design project share URL: _(add)_

| Folder | Date | What | Outcome |
|---|---|---|---|
| `pass-1/` | 2026-08-16 | Three directions (A Pixel Crown, B Soft Blocky, **C Crate Poster** chosen), design system, Core screens (Home/Projects/Detail), Section screens (Videos/Skins/Art/Support/Custom Orders/Admin), `handoff/DESIGN.md` v1, prototype `assets/`, 2 unique `uploads/` screenshots | `DESIGN.md` v1 → reviewed to v1.1 (`docs/design-review.md`) |
| `pass-2/` | 2026-08-17 | Coverage pass: Accounts & Comments screens (handle onboarding, profile, comment states), Admin & States screens (Settings/Stats/Orders/gate, upload well, 404/error/skeletons/empty/toasts, support wrapper, video facades, Privacy), `handoff/DESIGN.md` v1.2, `CHANGELOG.md`, `PULL-REQUEST.md`, `FILE-LIST.txt`; pass-1 files carried forward | `DESIGN.md` v1.2 (+ v1.2a decisions) |
| `pass-3/` | _(incoming)_ | Notification settings matrix · Seen on (item row, Home strip, aggregate page, admin Mentions) · Workrooms (Phase 2, design-ahead) · Email + Discord templates · Supporters leaderboard · handle-guidance copy · privacy line · versions changelog cell · Custom Orders confirmation · nav update — brief: `docs/claude-design-pass3-prompt.md` | → `DESIGN.md` v1.3 |

## Where things went (pass 1)
- `handoff/DESIGN.md` → **`/DESIGN.md`** (paths repointed to `assets/brand/…`)
- prototype `assets/` → canonical copies in `assets/brand/{avatar,skins,art,thumbnails}/`

## Landing a new pass
Drop the export zip in `pass-N/`, then Claude Code unpacks, verifies (design files only, `assets/brand` paths, prior
corrections preserved), places files, updates `DESIGN.md`, and re-runs the coverage check. Process: `docs/design-process.md`.
