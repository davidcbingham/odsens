# CLAUDE.md — orientation for any Claude session on this repo

This is **odsens.com**, a portfolio site for OddSense (Minecraft creator). It is in the **planning/design phase** — read
`docs/spec.md` first, then `docs/platform-audit.md`. Design work follows `docs/design-process.md`; the visual system will
live in `DESIGN.md` at repo root once derived from the Claude Design handoff bundle.

Ground rules
- **OddSense** = person/character; **odsens** = brand. Never reference "Odd Sense NYC".
- No PII in code, content, or designs. Users are handles only.
- Tone: playful, cartoony, fun, relaxed, inviting; readable over flashy; dark-first.
- Content principle: curate from native hosts (Modrinth, YouTube, CurseForge) + host only what has no home (exclusive projects, skins, art).
- Framework not yet chosen — don't scaffold an app until `docs/spec.md` says the spec is frozen.
- Keep `docs/questions.md` updated when decisions are made.
- Secrets go in `.env` (gitignored); template in `.env.example`.
