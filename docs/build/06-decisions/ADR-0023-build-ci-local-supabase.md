# ADR-0023 — CI `build` job starts local Supabase (build-time reads exist from S1.2)

## Status
Proposed (flips to Accepted at merge — ship step 8)

## Date
2026-08-27

## Slice
S1.2

## Context
Kind: CI/process (05 CI-4 amendment)
- Spec says: 05 CI-4 — `pnpm build` with `.env.test`, no Supabase step (the job as frozen has no database). But 02 §2.3 mandates `generateStaticParams` = "all published non-hidden slugs at build", and 01 INV-38 mandates the ten public pages be ISR — `next build` prerenders them, and from S1.2 `/projects` + `/projects/[slug]` read `projects_public` through `lib/data/projects.ts` during that prerender. The two rules collided the first time a slice shipped a build-time DB read: CI run 33115724979 `build` failed with `lib/data/projects: list read failed — TypeError: fetch failed` (`.env.test` points at the local stack, which the job never started). S1.1 and earlier never tripped this because no page read the DB at build.
- The `e2e` job (CI-5) already runs `supabase start` → `pnpm build` and is green — the pattern is proven in this same workflow.
- Related: ADR-0002 A13 (route-table artifact from this job) · 01 INV-38 (ISR prerender) · 02 §2.3 (`generateStaticParams`). Supersedes none.

## Decision
1. The CI `build` job gains three steps, copied from the `e2e` job: `supabase/setup-cli@v1`, `Start local Supabase` (`supabase start` — applies migrations + `seed.sql`, so `generateStaticParams` prerenders the seed slugs deterministically) before the build, and `Stop local Supabase` (`if: always()`) after the artifact upload.
2. Everything else in CI-4 is unchanged: `.env.test` env, `build-output.txt` artifact, `scripts/check-bundle-secrets.mjs`. The route table now shows the seed slugs as prerendered paths under `/projects/[slug]`; the INV-10 baseline diff (`frontend-reviewer`) compares like with like once this lands on `main`.
3. Not chosen instead: making `generateStaticParams`/page reads tolerate an unreachable DB (return `[]` / catch). That would also have masked the real staging-race failure on the same commit's Vercel build, and INV-38's prerender means every ISR page read would need the same swallowing — a DB-less build is simply no longer a truthful build of this app.

## Alternatives considered
| Alternative | Why not |
|---|---|
| `generateStaticParams` returns `[]` when the DB is unreachable | Swallows genuine misconfiguration (the same day's Vercel failure was a real missing view); doesn't help the INV-38 prerender of `/projects`, which still throws. |
| Set a `BUILD_NO_DB=1` flag in CI and branch in code | Ships app code whose only purpose is to lie to one CI job; route table would differ from real builds (INV-10 baseline diff breaks). |
| Drop build-time prerender (`dynamic = 'force-dynamic'`) | Violates INV-38/02 RP-03 outright — far larger deviation. |

## Consequences
- Positive: CI-4 exercises the real build path (build-time reads included); route-table artifact reflects production shape; no app-code change.
- Negative: `build` job gains ~1–2 min (image pulls are cached by GitHub's registry mirror most runs); one more job depends on Docker on the runner (the same dependency `db`/`e2e` already carry).
- Follow-ups: ship step 3 ordering note — push `staging` and let the Supabase check go green **before** pushing the PR branch when a PR carries migrations, so the Vercel preview build doesn't race migration application (this run's Vercel failure: `projects_public` not yet in staging's schema cache).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/05-test-plan.md` | §4 CI-4 row; `Status:` line | Supabase CLI + `supabase start` added to the job (contains the string ADR-0023); Status appended |
| `docs/build/00-build-plan.md` | §6 Changelog; `Status:` line | new row; Status appended (README ADR-R2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0023 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `.github/workflows/ci.yml` `build` job matches the amended CI-4 row; this ADR listed under `## ADRs in this PR` |
| frontend-reviewer | INV-10 route-table diff: aware the baseline (`main`, pre-ADR) has no prerendered slugs — first diff after merge is the new baseline |
| supabase-reviewer, security-reviewer, backend-reviewer, design-fidelity-reviewer, deploy-checker | none |
