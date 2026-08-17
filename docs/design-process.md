# Design Process — DESIGN.md, inspiration hunt, and asset IA

## 1. DESIGN.md via Claude Design (with Oliver)

**What it is / where.** [Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs) (Anthropic Labs,
Apr 2026; Pro/Max/Team) is a **separate visual tool in the Design tab of claude.ai** (browser or Claude desktop app) —
**not** inside VS Code. Oliver describes/uploads/iterates and sees live, clickable HTML designs; he refines via voice/text,
inline comments on elements, direct text edits, and sliders for spacing/color/layout. It builds a **persistent design
system** for the project (tokens, typography, components) and exports HTML / PDF / PPTX / Canva / a **handoff bundle
for Claude Code**.

**Where `DESIGN.md` fits.** `DESIGN.md` is a *community convention* (see
[awesome-claude-design](https://github.com/VoltAgent/awesome-claude-design)), not a Claude Design export button: a
single repo-root markdown file describing the visual language so any Claude session can act on it. We **derive it in a
Claude Code session here** from the exported bundle/HTML, then commit it.

**Flow:** claude.ai Design tab (Oliver iterates visually) → export bundle → Claude Code in VS Code on this repo →
`DESIGN.md` committed → build + skills read it.

**Why do it this way (advantages).**
- **Oliver owns the look.** He can talk/iterate visually with Claude without knowing CSS; the output is a spec, not a mockup that rots.
- **One source of truth for every future session.** Any Claude Code session (his desktop, David's, a skill) reads `DESIGN.md` and produces on-brand UI — consistency without a human design reviewer.
- **Portable & versioned.** It lives in the repo, diffs in git, travels with the site-management skills.
- **Framework-agnostic.** Tokens/components are described abstractly, so the framework choice (deferred) isn't blocked.
- **Fits the "curate, don't duplicate" spirit** — his existing art feeds the system rather than being redrawn.

**Suggested process.**
1. **Gather** — Oliver drops source art into `assets/brand/` (avatar at native pixel size + upscales, banners, project icons, textures he likes, screenshots of Modrinth pages / YouTube thumbnails he's proud of).
2. **Session with Claude Design (Oliver + Claude, David optional)** — upload the art, state the tone (*playful, cartoony, fun, relaxed, inviting*) and constraints (dark-first, purple/gold/green, pixel motifs but readable). Iterate on: palette, type pairing, spacing scale, corner/border style, card + button + badge components, project card, comment bubble, hero with 3D skin.
3. **Export the handoff bundle → derive `DESIGN.md`** at repo root (Claude Code session, this repo). Sections: brand & voice · color tokens (light/dark) · typography · spacing/radius/shadow · iconography & pixel rules · core components with states · layout grid · motion · do/don't list · asset specs.
4. **Review pass (David + Claude Code)** — check for accessibility (contrast on purple/black, glowing-green text), responsiveness rules, and that every component the functional spec needs has a definition.
5. **Handoff bundle → Claude Code** for the actual build once the functional spec is frozen. `DESIGN.md` then becomes the reference the site-management skills read.

**Prereq to check:** Claude Design availability on David's/Oliver's plan (Pro/Max/Team). If unavailable, the same
`DESIGN.md` can be authored in a Claude Code session with visual iteration through Artifacts — slower but equivalent output.

## 2. Inspiration hunt (after functional spec is complete)

Rather than starting from named references, we will:
1. **Abstract** the finished functional spec into *site types* and *functionality types* — e.g. "creator portfolio", "mod showcase / download hub", "video-forward creator hub", "playful game-adjacent brand site", "commission intake", "authenticated comment threads", "supporter wall / leaderboard".
2. **Search** for strong examples of each (Claude runs the search) and present a shortlist with screenshots/notes.
3. **Oliver reacts** — good/bad per site — and those reactions get folded into `DESIGN.md` and the spec.

## 3. Asset information architecture (later session)

Once `assets/brand/` is populated, define categories, file types, and pixel dimensions per use (favicon, avatar,
OG image, hero, project card, gallery, thumbnails, skin PNGs, art), plus naming conventions. Output: `docs/assets.md`.
