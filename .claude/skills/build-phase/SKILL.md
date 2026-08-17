---
name: build-phase
description: Orchestrates a build phase or major site update for odsens.com — turns a scope into ordered work, pulls in the specialist skills (supabase-ops, vercel-ops, security-check, design-fidelity, backend-robustness) at the right moments, and gates each phase on their checklists. Use when starting the initial build, a new phase, or any multi-day change.
---

# build-phase — the foreman

## When to use
Initial build, a new phase (e.g. "Phase 2: Ko-fi"), or any change touching ≥2 of: DB, auth, uploads, sync, admin, public UI.

## Inputs
- Scope statement (one paragraph) and which spec sections it implements (`docs/spec.md`, `docs/data-model.md`, `DESIGN.md` §).
- Current state: `git status`, last deploy, open questions in `docs/questions.md` that block the scope.

## Steps
1. **Restate scope** in ≤5 bullets; list spec/questions items that are unresolved → ask before building on an assumption.
2. **Order the work** (default): migrations + RLS (`supabase-ops`) → server data layer + sync adapters (`backend-robustness`) → UI from `DESIGN.md` components (`design-fidelity`) → auth/uploads/webhooks hardening (`security-check`) → deploy config, env, cron (`vercel-ops`) → docs (`keep-docs` or inline).
3. **Work in vertical slices** where possible (one feature end-to-end) rather than all-DB-then-all-UI; each slice = one PR with preview URL.
4. **Gate each slice — spawn the gate agents in parallel, in the background** (`.claude/agents/`): `design-fidelity-reviewer` (if UI touched), `security-reviewer` (if auth/uploads/webhooks/comments/admin touched), `backend-reviewer` (if server code touched), `supabase-reviewer` (if `supabase/` touched). Launch all applicable ones in one Agent call batch, keep working on the next slice while they run, then paste each verdict table into the PR body. After deploy, spawn `deploy-checker` on the preview URL. A slice doesn't merge with an open ❌; a second ❌ on the same item → stop and ask.
5. **Freeze points**: after each phase, tag (`v0.x`), update `docs/spec.md` revision log, list what's deferred.
6. **End of phase report**: what shipped, what's deferred, what Oliver should try, any new questions → `docs/questions.md`.

## Guardrails
- No feature outside the stated scope without noting it as deferred.
- Never skip a specialist gate "because it's small" — run it, it's fast.
- If a spec conflict is found mid-build, stop, write it down, ask.

## Done looks like
Merged PRs with green gates, production verified, docs updated, tag pushed, report posted.

## Boundaries & hand-offs (see `docs/skill-handoffs.md`)
- **Owns:** scope, ordering, gates, phase report, tags. **Does not own:** migrations, UI, deploy config, merges.
- **Hand off:** DB → `supabase-ops` · server code → `backend-robustness` · UI → `design-fidelity` · auth/uploads/webhooks/comments/admin → `security-check` before merge · ready → `ship` (Oliver's) / `vercel-ops` · decision changed → `keep-docs`.
- **Stop & ask:** spec conflict, missing decision in `docs/questions.md`, any item on the stop-and-ask list.
- **Return path:** gates return ✅/❌; a second ❌ on the same item → stop and ask.
- Always write the hand-off note (format in `docs/skill-handoffs.md` §2).
