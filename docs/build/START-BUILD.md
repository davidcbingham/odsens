# START-BUILD — how a build session begins (read this first)

Spec is **FROZEN v1.0 (2026-08-17)**. Every build session follows this order:

1. **Orient (5 min):** `CLAUDE.md` → this file → `docs/build/00-build-plan.md` (find the current slice; its acceptance criteria are the target) → `docs/build/_registry.md` (names/IDs — use verbatim) → the sections of `01–05` the slice cites → `DESIGN.md` for anything visible → `docs/build/06-decisions/` (accepted ADRs amend the specs).
2. **Run the foreman:** invoke the **`build-phase`** skill with the slice ID. It restates scope, orders the work, and pulls in the specialists: `supabase-ops` (schema/RLS/auth/storage), `backend-robustness` (jobs/actions/adapters), `web-quality` (how UI is engineered), `design-fidelity` (how it looks), `security-check`, `vercel-ops` (env/cron/deploy), `test-engineer` (harness/tests). Skills follow `docs/skill-handoffs.md` (owns / hand-off note / stop-and-ask).
3. **Branch per slice:** `feat/<slice-id>-<slug>` (e.g. `feat/S0-scaffold`). One PR per slice; PR body per 00 §1.3 (slice ID, spec sections, `## ADRs in this PR`, gate verdicts, screenshots, `## Bundle` if needed).
4. **Gates before merge — spawn the agents in one background batch** (`.claude/agents/`): `spec-drift-reviewer` (always), `design-fidelity-reviewer` + `frontend-reviewer` (UI touched), `security-reviewer` (auth/uploads/webhooks/comments/admin), `backend-reviewer` (server code), `supabase-reviewer` (`supabase/` touched); `deploy-checker` on the preview URL after deploy. Paste each `GATE:` verdict into the PR. Nothing merges with an open ❌; a second ❌ on the same item → stop and ask David.
5. **Deviations:** anything not matching `00–05`/`DESIGN.md`/`data-model` → ADR (`06-decisions/ADR-TEMPLATE.md`) + doc edit in the same PR. Never decide-and-move-on silently.
6. **Ship:** preview → PR → gates → merge (`main` auto-deploys to Vercel production, still behind Deployment Protection until S1.10). Tag `v0.<n>` per slice.
7. **Close the slice:** acceptance criteria demonstrated on the preview, docs/`questions.md` updated (`keep-docs`), phase report posted, next slice named.

Environment facts: repo linked to Vercel project `odsens` (studiobing) and Supabase project `odsens` (`dllbekulbimblrsrxuyv`, Google auth configured via `supabase config push`); env vars seeded in Vercel; local `.env` from `.env.example` (David holds secrets); tooling per `docs/dev-tooling.md` (pnpm, Supabase CLI + OrbStack, Playwright). Staging = Supabase Branching (set up in S0/S1.10 with the GitHub + Vercel integrations).

Current slice: **S0 — Scaffold** (see 00 §2 S0). S0 also writes the `ship` and `keep-docs` skills and CI.
