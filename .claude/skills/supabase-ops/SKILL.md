---
name: supabase-ops
description: Supabase specialist for odsens.com — schema migrations, RLS policies, Auth (Google) config, Storage buckets and policies, generated types, local dev via Supabase CLI, and safe promotion to production. Use for any database, auth, or storage change; called by build-phase, new-feature, and db-change.
---

# supabase-ops

## Source of truth
`docs/data-model.md` (tables, buckets, RLS outline), `docs/setup-google-cloud.md` (Google provider), `.env.example` (var names).

## Conventions
- Migrations in `supabase/migrations/<timestamp>_<slug>.sql`; one concern per file; idempotent where possible (`create table if not exists`, `create or replace function`, `drop policy if exists … ; create policy …`).
- **RLS enabled on every table in the same migration that creates it.** No table ships without policies.
- Helpers: `public.is_admin()`, `public.is_moderator()` (security definer, read `profiles.role`). Policies call helpers, never inline role logic.
- Public reads go through **views** (`public_profiles`, `projects_public`) that omit sensitive columns; the client never selects from `profiles` for other users.
- Triggers for: profile creation on `auth.users` insert; `like_count`, `comment_count` maintenance; `updated_at`.
- Storage: buckets per `docs/data-model.md` §3; `project-files` private (signed URLs only); upload policies allow **service role only** — browsers upload via server actions.
- Types: `supabase gen types typescript --local > lib/supabase/types.ts` after every migration; commit it.
- Seed: `supabase/seed.sql` creates the settings row, an admin profile placeholder, and a couple of sample projects for local dev.

## Steps for a change
1. Write migration (+ RLS + indexes + trigger if needed). 2. `supabase db reset` locally; run seed. 3. Regen types; fix TS errors. 4. Add/adjust tests that hit RLS as anon/user/mod/admin (Vitest against local Supabase). 5. Preview deploys use the persistent **`staging` Supabase branch** (git branch `staging`; `ship` pushes the PR branch there fast-forward-only and the GitHub integration applies its migrations + `config.toml` `[remotes.staging]` — ADR-0010); production gets migrations when the PR merges to `main` (branching promotes) — verify in the dashboard; never `db push` by hand except to recover. 6. Note reversibility in the PR.

## Auth checklist
Google provider enabled with client id/secret · Site URL + redirect URLs: `https://odsens.com/**`, `https://www.odsens.com/**`, `https://odsens-git-*-studiobing.vercel.app/**`, `http://localhost:3000/**` — never a bare `*.vercel.app` wildcard; the base `[auth]` block (local + Supabase preview branches) also lists the `odsens-git-*-studiobing` pattern; `[remotes.production]` is applied on merge by the GitHub integration (ADR-0011) · email confirmations off (OAuth only) · `profiles` trigger creates row with null handle · `proxy.ts` (middleware, ADR-0009) forces onboarding when handle is null · JWT contains no PII beyond sub.

## Guardrails
- Never `DROP TABLE/COLUMN` or delete Storage objects without an explicit confirm and a backup note.
- Never run ad-hoc SQL against production; migrations only.
- Service-role key exists only in server env; grep the client bundle for it in CI.

## Boundaries & hand-offs (see `docs/skill-handoffs.md`)
- **Owns:** schema, RLS, helpers/views/triggers, Storage policies, Auth config, types, seed, staging→prod DB. **Does not own:** app code using the schema, deploy, UI.
- **Done → return to caller** with: migration file(s), regenerated types path, RLS test results, reversibility note.
- **Hand off:** app-side role check needed → note for `security-check` · env/cron → `vercel-ops` · prod push → only through `ship` after preview.
- **Stop & ask:** any DROP, any prod data edit, policy that widens reads of `profiles`.
