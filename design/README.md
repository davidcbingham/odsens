# design/ — Claude Design handoff materials

Each Claude Design cycle lands in its own folder under `claude-design-export/`. The durable artifact is repo-root
**`DESIGN.md`**; the folders are raw reference (open the `.dc.html` prototypes in a browser). Do not edit exports in place.
Claude Design project share URL: _(add)_

| Folder | Date | What | Outcome |
|---|---|---|---|
| `pass-1/` | 2026-08-16 | Three directions (A Pixel Crown, B Soft Blocky, **C Crate Poster** chosen), design system, Core screens (Home/Projects/Detail), Section screens (Videos/Skins/Art/Support/Custom Orders/Admin), `handoff/DESIGN.md` v1, prototype `assets/`, 2 unique `uploads/` screenshots | `DESIGN.md` v1 → reviewed to v1.1 (`docs/design-review.md`) |
| `pass-2/` | 2026-08-17 | Coverage pass: Accounts & Comments screens (handle onboarding, profile, comment states), Admin & States screens (Settings/Stats/Orders/gate, upload well, 404/error/skeletons/empty/toasts, support wrapper, video facades, Privacy), `handoff/DESIGN.md` v1.2, `CHANGELOG.md`, `PULL-REQUEST.md`, `FILE-LIST.txt`; pass-1 files carried forward | `DESIGN.md` v1.2 (+ v1.2a decisions) |
| `pass-3/` | 2026-08-17 | Notification settings matrix · Seen on (item row, Home strip, aggregate page, admin Mentions) · Workrooms (Phase 2, design-ahead) · Email + Discord templates · Supporters leaderboard · handle-guidance copy · privacy line · versions changelog cell · Custom Orders confirmation · nav update — brief: `docs/claude-design-pass3-prompt.md`; `CHANGELOG.md`, `PULL-REQUEST.md`, `FILE-LIST.txt` | `DESIGN.md` **v1.3** |

## Where things went (pass 1)
- `handoff/DESIGN.md` → **`/DESIGN.md`** (paths repointed to `assets/brand/…`)
- prototype `assets/` → canonical copies in `assets/brand/{avatar,skins,art,thumbnails}/`

## Landing a new pass
Drop the export zip in `pass-N/`, then Claude Code unpacks, verifies (design files only, `assets/brand` paths, prior
corrections preserved), places files, updates `DESIGN.md`, and re-runs the coverage check. Process: `docs/design-process.md`.

---

## Pass 3 (2026-08-17) — `claude-design-export/pass-3/`

Third Claude Design session: features decided after pass 2 — Seen on, workrooms, the notifications matrix, email/Discord templates, the supporters leaderboard — plus small leftovers.
Claude Design project share URL: _(add)_

| File | What |
|---|---|
| `handoff/DESIGN.md` | Spec as exported, v1.3 (canonical copy at repo-root `DESIGN.md`, paths repointed to `assets/brand/…`) |
| `CHANGELOG.md` | What changed since v1.2 |
| `odsens Screens - Workrooms and Seen On.dc.html` | Nav proposal, workroom (desktop, phone, five states, email opt-in), SEEN ON row in situ, footer line |
| `odsens Screens - Seen On.dc.html` | Home IN THE WILD strip, Seen on page desktop + phone, Admin Mentions + Suggested tab (v1.5) |
| `odsens Screens - Admin Pass 3.dc.html` | Notifications matrix desktop + phone, Orders & Workrooms, order detail → Create workroom, room controls |
| `odsens Screens - Email and Discord.dc.html` | New comment / Held for review / Sync failed emails + plain-text, Discord embeds in channel |
| `odsens Screens - Support and Leftovers.dc.html` | Supporters leaderboard, handle guidance, Privacy additions, How comments work, changelog expander, orders confirmation |
| earlier `.dc.html` files | Carried forward from passes 1–2 unchanged, so the folder is a self-contained snapshot |
| `assets/`, `support.js`, `github.md`, `.thumbnail` | Art the prototypes reference (canonical copies in `assets/brand/`) + export metadata / runtime |

Highlights: nav order decided (wordmark = Home; Projects · Videos · Skins · Art · Seen on · Commissions; Support stays the gold button) · handle name-detection removed in favour of guidance copy · admin email switches replaced by the site-level notifications matrix (Email + Discord) · new components: notification matrix, mention card, reach line, PRIVATE badge, milestone pills, participants row, client upload well, leaderboard row, email/Discord template rules.

Still missing before build: project icons, in-game screenshots, rendered 3D skin previews, official platform marks for mention cards, and a pixel allay render (the notification mails send as allay@odsens.com and speak as the allay).
