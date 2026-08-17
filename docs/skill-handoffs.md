# Skill Boundaries & Hand-off Protocol

Applies to every skill in `.claude/skills/` (build specialists now; Oliver's team when written). Goal: a multi-step task
that starts in one skill always knows **when to stop**, **who to hand to**, **what to pass**, and **who owns the PR**.

## 1. Protocol (every skill follows this)
1. **Own one thing.** Each skill has an *Owns* list and a *Does not own* list. Work outside *Owns* is a hand-off, not a detour.
2. **Stop conditions are explicit.** A skill stops when (a) its *Done looks like* is met, (b) it hits a *Hand-off trigger*, or (c) it hits a *Stop-and-ask* condition (destructive action, spec conflict, missing decision).
3. **Hand-off = a note, not a vibe.** When handing off, the skill writes a short **hand-off note** (see §2) into the PR body / task notes, then invokes the target skill by name with that note. It does not do the target's job "quickly."
4. **Return path.** Gate skills (specialists) return a **verdict** (✅ / ❌ with file:line + fix) to the caller; they don't merge, deploy, or expand scope. The caller (usually `build-phase` or `new-feature`) decides what's next.
5. **One PR owner.** The skill that opened the branch/PR owns it until merge; others append sections to its PR body. `ship` is the only skill that merges/promotes.
6. **Docs closer.** Any skill that changes a decision, scope, or rule ends by handing to `keep-docs` (or does the edit inline and says so).
7. **Retries are bounded.** A gate ❌ goes back to the caller once; if it fails again on the same item, stop and ask the human.

## 2. Hand-off note format
```
HANDOFF → <target-skill>
From: <this-skill>   Branch/PR: <ref>
Why: <one line: trigger that fired>
Done so far: <2–4 bullets>
Need from you: <the specific thing>
Return to: <skill or human>   Blocking? yes/no
```

## 3. Hand-off matrix

### Build specialists
| Skill | Owns | Does NOT own | Hand-off triggers → target |
|---|---|---|---|
| **build-phase** (foreman) | scope restatement, slice ordering, invoking gates, phase report, tags | writing migrations, UI, deploy config, merges | slice needs DB → `supabase-ops` · needs server code → `backend-robustness` · needs UI → `design-fidelity` · slice touches auth/uploads/webhooks/comments/admin → `security-check` (before merge) · slice ready → `ship`/`vercel-ops` · decision changed → `keep-docs` · spec conflict → **stop, ask human** |
| **supabase-ops** | migrations, RLS, helpers/views/triggers, Storage policies, Auth config, types, seed, staging→prod DB promotion | app code that *uses* the schema, deploy, UI | schema done + types regenerated → return to caller · a policy needs an app-side role check → note for `security-check` · migration would DROP → **stop, confirm** · prod push → only via `ship` after preview |
| **backend-robustness** | adapters, cron/job code, server actions, download route, notification queue, env validation, backend tests | schema (asks `supabase-ops`), UI, deploy config | needs a table/column → `supabase-ops` (with the exact shape) · needs cron schedule/env var → `vercel-ops` · touches auth/uploads/webhooks → `security-check` · done → return checklist to caller |
| **design-fidelity** | tokens.css parity, component/state parity, look rules, contrast, screenshots, voice check | writing features, backend, deciding new design rules alone | raw hex/rule break found → ❌ back to caller with fix · deliberate deviation needed → requires `DESIGN.md` edit + `keep-docs` in same PR · new component not in DESIGN.md → **stop, ask** (or a Claude Design pass) |
| **security-check** | the threat-model checklist, headers/CSP, rate limits, upload/download hardening review | fixing everything itself, deploy | ❌ items → back to caller (owner fixes; may route to `supabase-ops` for RLS or `backend-robustness` for validation) · systemic gap → `docs/questions.md` via `keep-docs` · run generic `/security-review` first |
| **vercel-ops** | project config, env per environment, cron schedules, ISR strategy, domain, rollback, deploy troubleshooting | app code, DB | missing env var *value* → **ask human** (never invent) · deploy fails from code → back to caller · prod bad → rollback **after confirm** then hand to `whats-wrong`/caller with logs |

### Oliver's team (spec; same protocol when written)
| Skill | Owns | Does NOT own | Hand-off triggers → target |
|---|---|---|---|
| **start-here** | local setup, git literacy, rescue recipes | any site change | wants to change something → `restyle`/`new-feature`/`add-content` · wants to publish → `ship` · something errors → `whats-wrong` |
| **ship** | branch hygiene, preview URL, PR, merge, promote, rollback, post-deploy smoke | writing the change | build/preview red → `whats-wrong` (with logs) · gates missing on a non-trivial PR → run `design-fidelity`/`security-check` first · after merge → `keep-docs` if docs changed |
| **whats-wrong** | triage + diagnosis; small safe fixes | features, restyles, DB changes | fix needs schema → `db-change` · needs deploy/env → `vercel-ops` · needs sync → `sync-now` · fix is real code → `new-feature` (mini) then `ship` · can't confirm cause → **report to David** |
| **restyle** | UI changes within DESIGN.md | new components/features, backend | change needs new behaviour → `new-feature` · rule must change → edit DESIGN.md + `keep-docs` · done → `design-fidelity` gate → `ship` |
| **new-feature** | plan, scope check, UI build from components, orchestrating the others for one feature | schema writing, deploy, design rules | data → `db-change` · server code → `backend-robustness` (gate) · UI → `design-fidelity` (gate) · sensitive → `security-check` (gate) · docs → `keep-docs` · ship → `ship` · scope grows → **stop, split** |
| **db-change** | migrations/RLS/types for one change (delegates standards to `supabase-ops`) | app usage of the schema | done → return to `new-feature` · DROP → **confirm** · prod → via `ship` |
| **add-content** | file checks, renames, uploads, draft rows, bust renders | publishing, design, code | copy needed → `write-copy` · upload path broken → `whats-wrong` · new content *type* → `new-feature` · done → hand Oliver the admin URL (human publishes) |
| **sync-now** | run/inspect syncs, mapping fixes, project_links | adapter rewrites | adapter bug → `backend-robustness` (via `new-feature` mini) · cron not firing → `vercel-ops` · numbers question → `stats` |
| **write-copy** | words | placing them | wants it on the site → back to caller (`add-content`/`restyle`/`new-feature`) |
| **stats** | read-only reports | changing anything | wants a new metric/chart → `new-feature` · numbers look wrong → `sync-now` |
| **upkeep** | dependency/platform updates, monthly checklist | features | major upgrade breaks build → `whats-wrong` · Supabase/Next major → follow `supabase-ops`/`vercel-ops` · ship → `ship` |
| **keep-docs** | spec/questions/DESIGN changelog/data-model edits | anything else | contradiction found → **ask human** |

## 4. Stop-and-ask list (no skill proceeds past these alone)
Force-push · DROP table/column · delete Storage objects · production rollback · editing prod data by hand · publishing content · adding a colour/rule not in DESIGN.md · anything that changes what the site stores about people · a spec conflict · a missing secret value.
