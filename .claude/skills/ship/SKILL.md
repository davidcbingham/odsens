---
name: ship
description: Gets a change from a branch onto odsens.com safely — push, find the Vercel preview URL, open the PR with the standard body, run the gate agents, merge, tag, verify production, roll back if it's bad. Use when Oliver says deploy, publish, "is it live", preview, "where's the preview", rollback, or asks about an env var.
---

# ship — preview → PR → gates → merge → production

The only skill that merges or promotes. It carries the change; it does not write it.
Talk to Oliver like a smart 15-year-old who builds mods: name a thing once, then use it. Show, don't lecture.

## When to use
"Deploy this", "publish", "is it live yet", "where's the preview", "roll it back", "add/change an env var", or a build skill (`build-phase`, `new-feature`, `restyle`, `upkeep`) hands over a finished branch.

## Inputs it needs
- The branch (or the change, if no branch exists yet) and the slice / fix it belongs to (`docs/build/00-build-plan.md` §1.2 naming).
- What "working" looks like: the slice's acceptance criteria (00 §2) or Oliver's one-line description.
- For env vars: the NAME only (it must exist in `.env.example`). Values come from David, never through chat.

### Facts it knows
- Vercel project `odsens`, team `studiobing`, id `prj_fTdiX6oYxyQ8CnAmzSzKnCb74MkU`. A branch push deploys a preview automatically (GitHub integration). Preview URL pattern: `https://odsens-git-<branch-slug>-studiobing.vercel.app`.
- Deployment Protection = Standard until S1.10: previews and production need a Vercel login to view. `deploy-checker` needs "Protection Bypass for Automation" (David-side to-do below).
- Env var names = `.env.example`. Preview env needs no per-branch step (ADR-0010): every preview runs on the persistent **`staging`** Supabase branch (git branch `staging`); the Vercel Preview environment carries staging's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` (set once by David; the new names are accepted as aliases) and `NEXT_PUBLIC_SITE_URL` is derived from `VERCEL_BRANCH_URL` on previews.
- Cron routes to smoke-test after deploy = `docs/build/04-server-contracts.md` §6 table (empty at S0).
- Required CI checks on `main`: `lint`, `unit`, `db`, `build`, `e2e` (05 CI-8). Tags per 00 §1.4: S0 `v0.1`, S1.1 `v0.2` … S1.9 `v0.10`, S1.10 `v1.0.0`; Phase 2 `v1.<n>`. Fix branches get no tag.

## Steps
1. **Branch + clean tree.** `git status`. On `main`? → `git switch -c feat/<SliceID>-<slug>` (fix after merge: `fix/<SliceID>-<slug>`; docs only: `docs/<slug>`). Uncommitted work → commit it with a plain message ("Add Discord widget to home rail") ending in the `Co-Authored-By: Claude <noreply@anthropic.com>` line. Never commit on `main`.
2. **Push.** `git push -u origin <branch>`. Vercel starts the preview build on its own.
3. **Push the PR branch to `staging`** (ADR-0010) before anyone reviews the preview: `git push origin <branch>:staging` — fast-forward only, **never force**; if it is not a fast-forward, rebase the branch onto `main` first (one PR in flight at a time). That is how the PR's migrations + `supabase/config.toml` reach the persistent `staging` Supabase branch every preview runs on; `main` still promotes to production on merge. Nothing else to set by hand: `NEXT_PUBLIC_SITE_URL` is derived from `VERCEL_BRANCH_URL`. Until David's three dashboard steps are done (automatic branching off · staging vars in Vercel Preview · Google-console redirect URI) a preview may still run on an ephemeral branch — `deploy-checker` reports which ref it found.
4. **Find the preview URL.** `vercel ls odsens --scope studiobing` or the PR's "Vercel" check. It should match the pattern above. Open it (Vercel login needed while Protection is on).
5. **Pre-PR checklist.** CI green on the branch (`gh pr checks` once the PR exists, or the Actions tab); `pnpm test` locally; screenshots of every touched page at 1280 + 390: `pnpm test:e2e --project=smoke-desktop --project=smoke-phone` (files land in `test-results/`; dark theme).
6. **Open the PR** with the 00 §1.3 template VERBATIM (copy below) — write the body to a file, then `gh pr create --title "<SliceID> — <name>" --body-file <file>`. Fill every section. `## ADRs in this PR` is the word `none` or one line per ADR. `## Bundle` is `none` unless a route's first-load JS grew >20 KB gz.
7. **Gates — one background batch, Session B only** (`docs/build/START-BUILD.md` step 4, ultracode OFF): never run gates in the same session as the build pass — Session A ends at step 6 with the checkpoint prompt ("Build pass complete for S<x>. Turn ultracode off (`/config`), start a new session, paste: <Session-B prompt>"). Then spawn `spec-drift-reviewer` (always) + `design-fidelity-reviewer`, `frontend-reviewer`, `security-reviewer`, `backend-reviewer`, `supabase-reviewer` — all seven run on every v1 slice (00 §1.7; a gate with nothing in scope returns PASS) — then `deploy-checker` on the preview URL. Paste each `GATE:` block into the PR body verbatim. A ❌ goes back to the owner once; a second ❌ on the same item → stop and ask David. Nothing merges with an open ❌.
8. **Merge.** `gh pr merge --squash --delete-branch`. `main` auto-deploys to production (still behind Deployment Protection until S1.10).
9. **Tag** (slice merges only, 00 §1.4): `git switch main && git pull`, then `git tag -a v0.<n> -m "S1.x <name>"` and `git push origin v0.<n>`.
10. **Verify production** (`https://odsens.com` from S1.10; the production Vercel URL before that): `/`, `/projects`, one project detail (from S1.2), the sign-in round-trip start (from S1.1), headers via `curl -sI` (CSP, `X-Frame-Options: DENY`, `Strict-Transport-Security`), and each cron route in the 04 §6 table using `CRON_SECRET` from Vercel — never paste the value.
11. **If production is bad:** `vercel rollback` ONLY after a one-line human confirm ("Roll back production? y/n"). Then `git switch -c fix/<SliceID>-<slug>` and hand to `whats-wrong` with the logs.
12. **Close out.** Docs touched (spec, questions, `DESIGN.md`, 00–05, an ADR to flip to Accepted)? → `keep-docs`. Then the breadcrumb: what I did / where it is (PR number, preview URL, tag) / how to undo (`git revert <merge-sha>` + push, or step 11).

### David-side prerequisites (dashboard clicks a build session can't do)
- ~~Enable Supabase Branching on `odsens` + install the Supabase GitHub integration (`davidcbingham/odsens`) + the Supabase Vercel integration — REQUIRED before S1.1 (ADR-0006).~~ Done 2026-08-20 (ADR-0010).
- ~~Vercel → Project → Deployment Protection → enable "Protection Bypass for Automation" so `deploy-checker` can fetch protected previews.~~ Done 2026-08-20 (`VERCEL_AUTOMATION_BYPASS_SECRET`, tooling-only; a commented line in `.env.example`, never a schema name).
- ~~Vercel → remove `CURSEFORGE_MEMBER` from all environments (dropped from `.env.example` at S0, 04 SC-16).~~ Done 2026-08-20.
- Persistent `staging` branch (ADR-0010): Supabase → GitHub integration → turn **off** automatic per-PR branching · Vercel → Preview environment → paste staging's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` · Google Cloud console → OAuth client → add `https://oihrxwqarwllvsyllczo.supabase.co/auth/v1/callback`.

### PR body template (`docs/build/00-build-plan.md` §1.3, verbatim)
```
## Slice
S<id> — <name>            Preview: <vercel url>
## Spec sections implemented
docs/spec.md §…, DESIGN.md §…, docs/build/01 §…, 02 §…, 03 §…, 04 §…, 05 §…
## Acceptance criteria
- [ ] S<id>.AC1 …   (every AC from 00-build-plan.md, ticked when verified on the preview)
## Tests
T-RLS-… ✔ · T-ACT-… ✔ · T-ADP-… ✔ · T-E2E-… ✔ · T-UNIT-… ✔   (IDs from 05-test-plan.md)
## ADRs in this PR
none   (the literal word `none` when the PR carries no ADR — 06 ADR-R11; otherwise one line per ADR:)
ADR-<nnnn>-<slug>.md (amends: <doc §>)
## Gate verdicts (pasted verbatim)
GATE: spec-drift … Verdict: PASS
GATE: … (each required gate)
GATE: deploy … Verdict: PASS
## Screenshots
1280 + 390 for each touched page
## Bundle
none   (required when any route's first-load JS grows >20 KB gz vs `main` — one line naming the route, the delta and why; enforced by `frontend-reviewer`, ADR-0002 "Also")
## Deferred / out of slice
<items noticed but not built, with the slice or questions.md entry that owns them>
## Docs updated
docs/spec.md revision log · docs/questions.md · DESIGN.md changelog (if any)
```

## Guardrails
- No force-push. No direct push to `main`. One slice per branch; a branch that grows past its slice gets split.
- No rollback, DNS change, or env var deletion without a one-line human confirm.
- Never print a secret value — not in chat, the PR body, screenshots, or logs. Env vars are names only.
- Preview before production, always. CI red or a gate ❌ = not mergeable, however small the change.
- Don't "fix it quickly" on the way past: a red build goes to `whats-wrong`, a missing gate goes to its specialist.

## Done looks like
PR merged with every required `GATE:` verdict PASS and CI green; production verified (pages + headers + crons); tag pushed for a slice; docs handed to `keep-docs`; breadcrumb written.

## Hand-offs
- Build or preview red → `whats-wrong` (with the Vercel / CI logs).
- Gate verdicts missing on a non-trivial PR → `design-fidelity` / `security-check` first.
- After merge, docs changed → `keep-docs`.

## Boundaries & hand-offs (see `docs/skill-handoffs.md`)
- **Owns:** branch hygiene, preview URL, PR body, gate spawning, merge, tag, rollback, post-deploy smoke. **Does not own:** writing the change, design rules, schema, deploy config beyond env var names (`vercel-ops`), doc edits (`keep-docs`).
- **Hand off:** red build/preview → `whats-wrong` · missing gate → `design-fidelity` / `security-check` · project config, cron, domain → `vercel-ops` · docs → `keep-docs`.
- **Stop & ask:** force-push, rollback, DNS, a missing env var value, a second ❌ on the same gate item, anything on `docs/skill-handoffs.md` §5.
- **Return path:** gates return ✅ / ❌ with file:line + fix; the PR owner fixes; `ship` re-runs that gate once.
- Always write the hand-off note (format in `docs/skill-handoffs.md` §2).
