---
name: vercel-ops
description: Vercel specialist for odsens.com — project config, environment variables, preview vs production, Vercel Cron routes, ISR/revalidation, Web Analytics + Speed Insights, custom domain (odsens.com from Squarespace DNS), rollback, and deploy troubleshooting. Use for anything deploy/hosting related; called by build-phase and ship.
---

# vercel-ops

## Facts
Project: odsens (StudioBing team) · Framework: Next.js App Router · Domain: odsens.com (registrar Squarespace, DNS → Vercel: A `76.76.21.21` / CNAME `cname.vercel-dns.com`, verify in dashboard) · Env var names: see `.env.example`.

## Environments
- **Preview**: every branch push; uses staging Supabase + test keys; `NEXT_PUBLIC_SITE_URL` = preview URL.
- **Production**: `main` only; production Supabase; analytics on.
- Env vars are set per-environment in the dashboard (or `vercel env pull/add`); never hardcode.

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
Build fails → read the exact error, check Node version (22), env var missing at build · 500 in prod only → env var missing in Production scope · Sign-in loop → redirect URLs / Site URL mismatch · Cron not running → vercel.json path typo or missing `CRON_SECRET` · Stale pages → revalidate tag not called.
