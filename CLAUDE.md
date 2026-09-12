# CLAUDE.md — orientation for any Claude session on this repo

This is **odsens.com**, a portfolio site for OddSense (Minecraft creator). **The spec is FROZEN (v1.0, 2026-08-17) and the build is in progress.** Start with `docs/build/START-BUILD.md`, then `docs/build/00-build-plan.md` (slices + acceptance criteria) and `docs/build/_registry.md` (names/IDs). Product context: `docs/spec.md`, `docs/platform-audit.md`. **`DESIGN.md` at repo root is the visual
source of truth** (v1.4, direction "Crate Poster"); prototypes are in `design/claude-design-export/pass-*/` (open the `.dc.html`
files in a browser), source art in `assets/brand/`. Design process: `docs/design-process.md`.

Ground rules
- **OddSense** = person/character; **odsens** = brand. Never reference "Odd Sense NYC".
- No PII in code, content, or designs. Users are handles only.
- Tone: playful, cartoony, fun, relaxed, inviting; readable over flashy; dark-first.
- Content principle: curate from native hosts (Modrinth, YouTube, CurseForge) + host only what has no home (exclusive projects, skins, art).
- Stack decided (`docs/framework-decision.md`): Next.js App Router + TS, plain CSS tokens, Supabase, Vercel. Spec is frozen — build per `docs/build/`; deviations need an ADR in `docs/build/06-decisions/`.
- Keep `docs/questions.md` updated when decisions are made.
- Secrets go in `.env` (gitignored); template in `.env.example`.

Talking to David (project owner, non-engineer — set 2026-09-12)
- **End-of-build updates are written for a visitor, not an engineer.** When a slice, fix pass or session closes, lead with what people using odsens.com can now do or see that they couldn't before — in plain English, as Oliver's audience would experience it (e.g. "A project Oliver posts here and on Modrinth is now one page: the download button hands out his own file, and the Modrinth count shows underneath"). Then, briefly, what Oliver can now do in the admin area. Only after that, and only if David must act on it, the plumbing (PR, tag, branch names, test IDs, ADR numbers).
- No engineering-speak in anything addressed to him: no spec section numbers, test IDs, invariant names, migration timestamps or gate tables in prose. Those live in the PR body and `docs/questions.md`, where engineers and gate agents read them.
- No progress updates unless he must act; asks are one plain sentence plus the concrete click or paste he needs to do. Engineering decisions are Claude's to make.

Skills follow the hand-off protocol in `docs/skill-handoffs.md` (owns / does-not-own / triggers / stop-and-ask / hand-off note).
Gate agents (in `.claude/agents/`, read-only, run in background/parallel): `spec-drift-reviewer` (every PR), `design-fidelity-reviewer`, `frontend-reviewer`, `security-reviewer`, `backend-reviewer`, `supabase-reviewer`, `deploy-checker` — spawn in a batch per slice, paste `GATE:` verdicts into the PR.
Skills (in `.claude/skills/`): build specialists exist now — `build-phase` (foreman), `supabase-ops`, `vercel-ops`,
`security-check`, `design-fidelity`, `backend-robustness`, `web-quality`, `test-engineer`. Engineering specs live in `docs/build/` (v1.0, frozen); deviations require an ADR in `docs/build/06-decisions/`. Oliver's day-to-day team (`start-here`, `ship`, `whats-wrong`,
`restyle`, `new-feature`, `db-change`, `add-content`, `sync-now`, `write-copy`, `stats`, `upkeep`, `keep-docs`) is spec'd in
`docs/site-management-skills.md` and gets written once the app exists.
