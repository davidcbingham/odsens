---
name: vercel-ops
description: Vercel specialist for odsens.com — project config, environment variables, preview vs production, Vercel Cron routes, ISR/revalidation, Web Analytics + Speed Insights, custom domain (odsens.com from Squarespace DNS), rollback, and deploy troubleshooting. Use for anything deploy/hosting related; called by build-phase and ship.
---

# vercel-ops

## Facts
Project: **odsens** (team `studiobing`, id `prj_fTdiX6oYxyQ8CnAmzSzKnCb74MkU`; linked via `.vercel/`) · Framework: Next.js App Router · Node 24.x · Deployment Protection: Standard — guards `*.vercel.app` URLs + previews only; production is public on www.odsens.com (domain attached, live since the S1.1 merge 2026-08-21) · Domain: odsens.com (registrar Squarespace, DNS → Vercel: A `76.76.21.21` / CNAME `cname.vercel-dns.com`, verify in dashboard) · Env var names: see `.env.example`.

## Environments
- **Preview**: every branch push; uses the persistent **`staging` Supabase branch** (git branch `staging`, ADR-0010) — the Preview environment carries staging's `NEXT_PUBLIC_SUPABASE_URL` + the new key names `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` (set once by David via the REST API below; accepted by `lib/env.ts` as aliases for `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`); no branch-scoped Supabase vars (the S0 `feat/S0-scaffold` placeholders are removed); `NEXT_PUBLIC_SITE_URL` is **derived** in code from `VERCEL_BRANCH_URL` (needs "Enable access to System Environment Variables" on) — never set it per branch (ADR-0010). `deploy-checker` fetches protected previews with the `x-vercel-protection-bypass` header (`VERCEL_AUTOMATION_BYPASS_SECRET`, tooling-only).
- **Production**: `main` only; production Supabase; analytics on.
- Env vars are set per-environment (`vercel env add NAME production --force` with the value on stdin; for **preview** the CLI prompts for a branch even with `--yes` → use the REST API `POST /v10/projects/<id>/env?upsert=true` with `target:["preview"]`, see `docs/dev-tooling.md`); never hardcode. `vercel env pull .env.vercel.local` to compare with `.env`.

## Cron (vercel.json)
| path | schedule |
|---|---|
| `/api/cron/sync-modrinth` | hourly |
| `/api/cron/sync-curseforge` | hourly (offset) |
| `/api/cron/sync-youtube` | hourly (offset) |
| `/api/cron/stats-snapshot` | daily 03:00 UTC |
| `/api/cron/notify` | every 5 min |
All cron routes check `Authorization: Bearer $CRON_SECRET`, are idempotent, log to `sync_runs`, and return JSON summaries.

## ISR / caching
Public pages: `revalidate` 600s + `revalidateTag('projects'|'videos'|…)` called at the end of each sync. Admin and anything authenticated: dynamic, `no-store`. Download route: dynamic.

## Checklist per deploy
Build green · preview smoke: home, projects, a project detail, sign-in round-trip, one cron route hit manually · Speed Insights not regressed · no secret in client bundle · after prod: cron list shows schedules, domain healthy.

## Rollback
`vercel rollback` (or promote a previous deployment in the dashboard) → confirm with the human → open a fix branch. Never hotfix on `main` directly.

## Troubleshooting map
Build fails on `wait-for-schema: … not ready` → the Supabase integration has not applied the branch's migrations yet (ADR-0029): check `supabase migration list --linked` (production) or the staging branch, then `vercel redeploy <url>`; a relation missing forever means a migration never applied · Build fails → read the exact error, check Node version (24), env var missing at build · 500 in prod only → env var missing in Production scope · Sign-in loop → redirect URLs / Site URL mismatch · Cron not running → vercel.json path typo or missing `CRON_SECRET` · Stale pages → revalidate tag not called.

## Boundaries & hand-offs (see `docs/skill-handoffs.md`)
- **Owns:** project config, env per environment, cron, ISR strategy, domain, rollback, deploy troubleshooting. **Does not own:** app code, DB, merging feature PRs (that's `ship`).
- **Hand off:** deploy fails from code → back to caller with the exact error · runtime bug → `whats-wrong` · schema → `supabase-ops`.
- **Stop & ask:** missing secret *value* (never invent), production rollback, DNS changes.
- **Return path:** deploy checklist ✅/❌ + preview/prod URLs.
