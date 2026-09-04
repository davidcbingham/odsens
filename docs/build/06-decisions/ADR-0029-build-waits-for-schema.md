# ADR-0029 — Builds wait for the database schema (`scripts/wait-for-schema.mjs`)

## Status
Proposed

## Date
2026-09-03

## Slice
S1.5 (cross-cutting — every slice that adds a table or view a public page reads at build)

## Context
Kind: addition
- Spec says: `docs/build/01-architecture.md` INV-38 — the public content pages are ISR and are prerendered by `next build`; `docs/build/02-routes-and-pages.md` §2.3 — `generateStaticParams` = "all published non-hidden slugs at build"; `docs/build/05-test-plan.md` §4 CI-4 — the build job runs `pnpm build`; ADR-0010 — production migrations are applied by the Supabase GitHub integration when a PR merges to `main`, previews run on the persistent `staging` branch; ADR-0023 — the CI build starts a local stack because build-time reads exist from S1.2, and its follow-up asked `ship` to push `staging` and wait for the Supabase check before pushing a PR branch.
- Found: three merges in a row (S1.2 `aeaf2b3`, S1.3 `a21f443`, S1.4 `0c92ef0`) the Vercel production build started the moment `main` moved, while the Supabase integration took up to ten minutes to apply the slice's migrations. `next build` prerendered `/`, `/projects` and the detail pages against the OLD schema, PostgREST answered `PGRST205 Could not find the table 'public.<new relation>' in the schema cache`, the build failed, production kept serving the previous tag, and David or the session had to notice and run one manual `vercel redeploy` once `supabase migration list --linked` showed the migrations applied (`docs/questions.md` 2026-08-27 S1.2/S1.3 and 2026-09-03 S1.4 merge records). The same race hits preview builds when a branch is pushed before `staging`. Every remaining v1 slice that adds a relation read at build (`videos` S1.6, `mentions` S1.8, `stats_daily` S1.9, `skins`/`art` S1.7) would hit it again.
- Related: `docs/questions.md` 2026-09-03 S1.4 merge record (options a/b/c) · ADR-0023 (rejected build-tolerant reads for CI) · ADR-0010 (staging pattern).

## Decision
1. **`pnpm build` waits for the schema before building.** `package.json` `build` = `node scripts/wait-for-schema.mjs && next build`. Vercel runs the package `build` script for both production and preview deployments; CI-4/CI-5 and the local e2e-truth build run the same command against the local stack, where the wait passes at once.
2. **What "ready" means.** The script reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (alias `SUPABASE_SECRET_KEY` — ADR-0010) from the environment, lists `supabase/migrations/*.sql` in the checkout, and derives (a) the migration **version set** (the filename prefixes) and (b) every **relation** the migrations create in `public` (`create table [if not exists] public.<name>`, `create [or replace] view public.<name>`). The database is ready when (a) every version is returned by the RPC `public.migration_versions()` and (b) every relation appears in `definitions` of the PostgREST OpenAPI root (`GET /rest/v1/` with the service key) — the same schema cache the prerender reads, so a reload lag after DDL is covered too.
3. **RPC `public.migration_versions()`** (`returns setof text`, `security definer`, `set search_path = public`, `stable`) reads `supabase_migrations.schema_migrations.version`; `revoke all … from public, anon, authenticated, service_role` then `grant execute … to service_role` (the build's key; nothing else needs it). Created by migration `20260903120400_migration_versions.sql`; asserted in 05 T-RLS-129 (anon/authenticated denied, service allowed, never PUBLIC). The RPC lands with the same merge as the first wait, so the first production build waits for it like any other version.
4. **Polling and failure.** Poll every 15 s; deadline 20 min when `VERCEL_ENV` is set, 60 s elsewhere (a local or CI stack is either right or wrong). On the deadline the script exits 1 with one plain line naming the missing versions/relations; the Vercel build fails visibly with that line instead of a `PGRST205` mystery, production keeps serving the previous deployment, and the documented fallback is one `vercel redeploy` once `supabase migration list --linked` catches up (`ship` step 10 keeps that ritual as the fallback, no longer the routine). `SKIP_SCHEMA_WAIT=1` bypasses the wait (local only; never set in Vercel or CI). Missing `NEXT_PUBLIC_SUPABASE_URL`/key → the script prints why and exits 0 so a plain `next build` still fails on its own terms (`lib/env.ts`).
5. **Pure parts are unit-tested** (05 T-UNIT-46, new ID appended to §7.4 and the S1.5 §8 row): migration parsing (versions, relations incl. `if not exists`/`or replace`/quoted names), the readiness decision over an OpenAPI `definitions` map + an applied-versions list, and the deadline choice; the network loop is a thin wrapper.
6. **Not chosen:** build-tolerant reads (ADR-0023's objection stands — an empty prerender would ship visibly empty pages for up to an ISR interval and hide a genuinely failed migration), and the Vercel "Ignored Build Step" (an unversioned dashboard setting that needs the Supabase CLI or a personal access token inside the build container).

## Alternatives considered
| Alternative | Why not |
|---|---|
| `lib/data/*` reads return empty on `PGRST205` during `next build` | Ships empty Home/`/projects` for up to 600 s after every affected merge; masks a migration that never applies (ADR-0023 rejected the CI variant for the same reason). |
| Vercel "Ignored Build Step" polling `supabase migration list --linked` | Dashboard-only, unversioned, needs the Supabase CLI + DB password or a personal access token in the Vercel env; cannot express "wait", only skip/proceed. |
| Keep the manual `vercel redeploy` as the ritual | The status quo: one human step per slice, easy to forget, no signal when the schema never lands. Kept only as the fallback (Decision 4). |
| Hold the Vercel deploy by making `main` a protected "deploy after checks" branch | Vercel builds on push regardless; the Supabase integration runs as a separate GitHub App with no shared gate. |

## Consequences
- Positive: a merge to `main` is hands-off again; a preview no longer depends on the staging-first push order (kept as a nicety); a stale schema fails the build with a named cause.
- Negative: a production build that carries migrations waits (up to ~10 min of build minutes, once per such slice); one more security-definer RPC in the schema (service-role only); the build needs the service key at build time (already present in every Vercel environment).
- Follow-ups: Session B verifies the first production build log shows `wait-for-schema: ready` and the merge needs no redeploy → owner `vercel-ops`; `deploy-checker` may quote the log line.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/05-test-plan.md` | §4 CI-4 row; §7.1 T-RLS-129; §7.4 T-UNIT-46 (new); §8 row S1.5; Status line | build command includes the wait; `migration_versions()` grant row; new unit test ID (contains ADR-0029) |
| `docs/build/_registry.md` | Repo layout `scripts/` line; SQL line | `wait-for-schema.mjs`; `migration_versions()` |
| `docs/build/00-build-plan.md` | §6 changelog; Status line | new row (contains ADR-0029) |
| `.claude/skills/ship/SKILL.md` | step 10 | the wait + the redeploy fallback (contains ADR-0029) |
| `.claude/skills/vercel-ops/SKILL.md` | Troubleshooting map | "build fails on `wait-for-schema`" row (contains ADR-0029) |
| `docs/dev-tooling.md` | Vercel project notes | one line on the wait |
| `docs/questions.md` | S1.5 build notes | decision record |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0029 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `package.json` `build` script = `node scripts/wait-for-schema.mjs && next build`; migration `20260903120400_migration_versions.sql` present; T-UNIT-46 exists; this ADR listed under `## ADRs in this PR` |
| supabase-reviewer | `migration_versions()` is security definer, `search_path = public`, EXECUTE granted to `service_role` only (T-RLS-129) |
| deploy-checker | the production build log contains `wait-for-schema: ready` after the S1.5 merge (Session B follow-up) |
| security-reviewer | the script never prints the key; the OpenAPI probe uses the service key only inside the build container |
| backend-reviewer, frontend-reviewer, design-fidelity-reviewer | none |
