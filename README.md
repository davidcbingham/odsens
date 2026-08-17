# odsens.com

Portfolio and project site for **OddSense** — Minecraft mods, datapacks, resource packs, plugins, skins, art, and videos.
**Status: spec frozen (v1.0, 2026-08-17) — building.** Engineering specs in `docs/build/`; start at `docs/build/START-BUILD.md`.

## Start here
| Doc | Purpose |
|---|---|
| [docs/spec.md](docs/spec.md) | The project specification — purpose, identity, goals, functional scope, infra, aesthetic, privacy |
| [docs/platform-audit.md](docs/platform-audit.md) | Which external platforms we pull from / embed (Modrinth, YouTube, CurseForge, Ko-fi…) and what stays native |
| [docs/framework-decision.md](docs/framework-decision.md) | Stack decision: Next.js + Supabase, and why |
| [docs/data-model.md](docs/data-model.md) | Tables, storage buckets, RLS outline, sync jobs, key flows |
| [docs/design-process.md](docs/design-process.md) | How the design system (`DESIGN.md`) is produced with Claude Design and handed off to Claude Code |
| [docs/claude-design-seed-prompt.md](docs/claude-design-seed-prompt.md) | The kickoff prompt for the Claude Design session |
| [docs/site-management-skills.md](docs/site-management-skills.md) | Planned repo-committed Claude skills for maintaining the site |
| [docs/questions.md](docs/questions.md) | Open questions, future design sessions, idea queue |

## Key facts
- **Naming:** OddSense = the person/character; **odsens** = the site/brand. Unrelated to "Odd Sense NYC".
- **Tone:** playful, cartoony, fun, relaxed, inviting. Dark-first. Purple / gold crown / glowing green from the avatar.
- **Stack (given):** Vercel hosting, Supabase (Postgres, Google auth, storage). Framework TBD after design.
- **Privacy:** no PII anywhere; users are shown by chosen handle only.

## Layout
```
docs/            spec and planning docs
assets/brand/    source art: avatar, skins (64×64 textures), art, thumbnails
DESIGN.md        design system v1 (Crate Poster) — source of truth for all UI
design/          Claude Design export: prototypes (.dc.html), handoff
.env.example     env var template (copy to .env, gitignored)
```
