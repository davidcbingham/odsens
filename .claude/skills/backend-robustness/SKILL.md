---
name: backend-robustness
description: Backend robustness specialist for odsens.com — sync adapters (Modrinth, CurseForge, YouTube), cron jobs, webhooks, server actions, download route, and notifications. Ensures idempotency, retries, rate-limit handling, timeouts, error reporting, and tests. Use when building or changing any server-side code; called by build-phase and new-feature.
---

# backend-robustness

## Sources
`docs/data-model.md` §5 (sync design), `docs/platform-audit.md` (API facts), `.env.example`.

## Rules
- **Idempotent upserts** keyed on external ids; sync never deletes — marks `hidden`; partial failure keeps old data.
- **Every external call**: timeout (10s), retry with backoff on 429/5xx (max 3), descriptive `User-Agent` (Modrinth requires), quota awareness (YouTube units, Modrinth 300/min).
- **Every job** writes a `sync_runs` row (start/finish/ok/items/error) and returns a JSON summary; errors are captured with context, never swallowed.
- **Server actions**: validate input with zod; check auth/role; do the DB write; `revalidateTag`; return typed result `{ok, error?}` — never throw raw errors to the client.
- **Download route**: verify published + file exists → increment counters in one SQL statement → signed URL (60s) → 302; log for stats; rate-limit.
- **Notifications**: queue rows, batch send, mark `emailed_at`; failure leaves the row for the next tick.
- **Time**: all timestamps UTC; snapshot job is date-idempotent (`on conflict do update`).
- **Config**: read env once via a validated `lib/env.ts` (zod); fail fast at boot if required vars are missing.

## Tests (Vitest)
- Adapters: fixture JSON from real API responses (record once into `tests/fixtures/`) → mapping tests (project_type mapping edge cases: datapack/plugin loaders; version/file shapes).
- Jobs: run against local Supabase; assert upsert idempotency (run twice → same rows) and hidden-on-removal.
- Server actions: auth matrix (anon/user/banned/mod/admin) and validation failures.
- Download route: counters increment once; unpublished → 404.

## Observability
Structured logs (`{job, run_id, level, msg, meta}`) → Vercel logs; Sentry after launch; admin "Sync status" reads `sync_runs`.

## Output
Checklist in the PR: idempotency ✅ · retries/timeouts ✅ · sync_runs ✅ · validation ✅ · tests ✅ · env validated ✅.
