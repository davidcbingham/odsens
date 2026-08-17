# Site Management Skills — "the site management team" (to define after spec is complete)

Goal: a set of **Claude Code skills committed to this repo** (`.claude/skills/<name>/SKILL.md`, *not* gitignored) so
they travel with the site to any computer/session. They are helper-bots for Oliver's day-to-day management and
upkeep from VS Code + Claude Code. Each skill encodes the site's conventions so Oliver can say what he wants without
knowing where things live.

Candidate skills (to refine once the spec is frozen):

| Skill | What it helps Oliver do |
|---|---|
| `add-project` | Create an exclusive project (Modrinth-shaped metadata, gallery, file) — or curate a synced Modrinth one (feature/hide/extra art) |
| `add-skin` | Add a skin (PNG + metadata) to the Skins section |
| `add-art` | Add profile pics / thumbnails / art with correct dimensions & naming (uses `docs/assets.md`) |
| `sync-sources` | Trigger/verify the Modrinth / CurseForge / YouTube sync; diagnose failures |
| `moderate` | Review comment queue, hide/delete/ban from the CLI when the admin UI is inconvenient |
| `deploy` | Preview → production on Vercel; check env vars; roll back |
| `db-migrate` | Create/apply Supabase migrations safely; regenerate types |
| `design-check` | Verify new UI follows `DESIGN.md` (tokens, components, tone) |
| `site-health` | Run lint/tests/build, check broken links, sync freshness, error logs |
| `release-notes` | Summarize what changed for a project's version / the site |

Possible higher-level skills (from David, 2026-08-16) — for **major site updates, design decisions, and development work**, so Oliver can drive bigger changes after David steps back:

| Skill | What it helps Oliver do |
|---|---|
| `plan-feature` | Turn an idea into a scoped plan (spec update, DB changes, UI, skills) before code |
| `design-decision` | Walk through a design choice against `DESIGN.md` and the spec; record the decision |
| `dev-workflow` | Branch → change → preview deploy → PR → merge, explained simply; git safety rails |
| `update-spec` | Keep `docs/spec.md` and `questions.md` current when things change |

Notes:
- Skills read `DESIGN.md`, `docs/spec.md`, and `docs/assets.md` as their source of truth.
- Keep each skill short and procedural; put shared conventions in `CLAUDE.md`.
- Also consider a project `CLAUDE.md` describing repo layout and commands so any session is oriented instantly.
