# CLAUDE.md — orientation for any Claude session on this repo

This is **odsens.com**, a portfolio site for OddSense (Minecraft creator). It is in the **planning/design phase** — read
`docs/spec.md` first, then `docs/platform-audit.md`. **`DESIGN.md` at repo root is the visual
source of truth** (v1, direction "Crate Poster"); prototypes are in `design/claude-design-export/` (open the `.dc.html`
files in a browser), source art in `assets/brand/`. Design process: `docs/design-process.md`.

Ground rules
- **OddSense** = person/character; **odsens** = brand. Never reference "Odd Sense NYC".
- No PII in code, content, or designs. Users are handles only.
- Tone: playful, cartoony, fun, relaxed, inviting; readable over flashy; dark-first.
- Content principle: curate from native hosts (Modrinth, YouTube, CurseForge) + host only what has no home (exclusive projects, skins, art).
- Stack decided (`docs/framework-decision.md`): Next.js App Router + TS, plain CSS tokens, Supabase, Vercel. **Don't scaffold yet** — wait until `docs/spec.md` says the spec is frozen.
- Keep `docs/questions.md` updated when decisions are made.
- Secrets go in `.env` (gitignored); template in `.env.example`.

Skills (in `.claude/skills/`): build specialists exist now — `build-phase` (foreman), `supabase-ops`, `vercel-ops`,
`security-check`, `design-fidelity`, `backend-robustness`. Oliver's day-to-day team (`start-here`, `ship`, `whats-wrong`,
`restyle`, `new-feature`, `db-change`, `add-content`, `sync-now`, `write-copy`, `stats`, `upkeep`, `keep-docs`) is spec'd in
`docs/site-management-skills.md` and gets written once the app exists.
