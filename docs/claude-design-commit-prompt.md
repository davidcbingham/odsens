# Claude Design — "commit to the repo" prompt (paste after a pass is finished)

---

We're done with this pass. Please commit the results to the connected GitHub repo `davidcbingham/odsens` following the repo's conventions. Read the repo's `CLAUDE.md`, `design/README.md`, and `docs/design-process.md` first — they define where design materials live.

## Rules
- Work on a **new branch** named `design/pass-2` (never commit directly to `main`) and open a **pull request** into `main` when done. My dad reviews and merges.
- **Design files only.** Do not scaffold an app, add a framework, package.json, build config, or any code outside `design/`. The framework hasn't been chosen.
- Do not modify anything under `docs/`, `assets/brand/`, `.env*`, `README.md`, or `CLAUDE.md`. Do not touch existing `design/claude-design-export/pass-1/` or `pass-2/` files.
- Do not delete or rename anything.

## Where things go
1. **Raw export bundle** → `design/claude-design-export/pass-2/`
   - all `.dc.html` files (design system, screens, directions/mockups)
   - `handoff/DESIGN.md` (the updated v1.2 spec, as exported)
   - `assets/` used by the prototypes (only what the HTML references — skip duplicate uploads)
   - `github.md`, `support.js`, `.thumbnail`, and a `CHANGELOG.md` listing what changed since v1
2. **Repo-root `DESIGN.md`** → replace it with the new v1.2 spec, **but**:
   - keep the top note block format (`# odsens.com — Design System (v1.2)` + a one-line "v1.2 (date): …" note),
   - keep asset paths pointing at `assets/brand/…` (e.g. `assets/brand/avatar/oddsense-avatar-5000.png`, `assets/brand/skins/skin-*.png`, `assets/brand/art/`, `assets/brand/thumbnails/`) — not `assets/…`,
   - preserve the v1.1 corrections already in the file (`--alert #CC3A2A`, Bungee/Silkscreen minimums, self-hosted fonts, indigo-on-ink 2.8:1).
3. **New source art** (if any new icons/renders/images were created that aren't just prototype fixtures) → list them in the PR description; do **not** copy them into `assets/brand/` — my dad will place them.
4. Update `design/README.md` **only** by appending a short "Pass 2 (date)" section: what's in `pass-2/`, the changelog highlights, and the Claude Design project share URL.

## Commit
- One commit (or a few logical ones), message like: `Design pass 2: DESIGN.md v1.2, new screens (onboarding, comment states, admin settings/stats, global states)`
- PR title: `Design pass 2 — DESIGN.md v1.2 + coverage screens`
- PR body: bullet list of screens/components added, corrections applied, any open questions you had, and any files you weren't sure where to put.

Before pushing, print the list of files you're adding/changing so I can sanity-check it. Then push the branch and open the PR.
