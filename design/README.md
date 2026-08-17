# design/ — Claude Design handoff materials

**Export:** "Three design directions" — 2026-08-16, from Oliver's Claude Design session (claude.ai Design tab).
**Chosen direction: C — Crate Poster** (blocky poster type on flat colour slabs, hard 2px edges, offset block shadows,
zero blur). Directions A (Pixel Crown) and B (Soft Blocky) kept for reference.
Claude Design project share URL: _(add)_

## `claude-design-export/` — raw export (reference only; do not edit)
| File | What |
|---|---|
| `Direction A/B/C - *.dc.html` | The three explored directions |
| `odsens Design System.dc.html` | Tokens, type, components with states |
| `odsens Screens - Core.dc.html` | Home, Projects grid, Project detail (desktop 1280 + phone 390) |
| `odsens Screens - Sections.dc.html` | Videos, Skins (reserved), Art, Support, Custom Orders, Admin |
| `handoff/DESIGN.md` | Handoff spec as exported (canonical copy lives at repo-root `DESIGN.md`) |
| `assets/` | Art used by the prototypes (kept here so the HTML renders; canonical copies in `assets/brand/`) |
| `uploads/` | Only the two unique screenshots Oliver uploaded; other uploads were byte-identical to `assets/` and dropped |
| `github.md`, `support.js`, `.thumbnail` | Export metadata / prototype runtime |

Open the `.dc.html` files in a browser to view the prototypes.

## Where things went
- `handoff/DESIGN.md` → **`/DESIGN.md`** (paths repointed to `assets/brand/…`) — the source of truth from here on.
- `assets/avatar.png` → `assets/brand/avatar/oddsense-avatar-5000.png`
- `assets/skin-*.png` → `assets/brand/skins/` (64×64 source textures — render as 3D, never display flat)
- `assets/art-*.png` → `assets/brand/art/` (PFPs / renders for the Art gallery)
- `assets/thumb-*.png` → `assets/brand/thumbnails/` (video thumbnails)

If the design is iterated again in Claude Design, re-export into a dated subfolder here and update `DESIGN.md`.
