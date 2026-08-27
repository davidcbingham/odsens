# Dev Tooling (local machines: David's + Oliver's)

Checked 2026-08-17 on David's Mac. This is also the checklist `start-here` uses for Oliver's laptop.

| Tool | Install (macOS) | Why | Auth |
|---|---|---|---|
| Node 24 LTS (or 22) | https://nodejs.org or `brew install node` — pinned in `.nvmrc` | runtime | — |
| pnpm | `npm i -g pnpm` (corepack needs sudo for `/usr/local/bin`; npm -g into `~/.npm-global` avoids that) | package manager | — |
| git + GitHub CLI `gh` | `brew install gh` | repo, PRs | `gh auth login` |
| Vercel CLI | `npm i -g vercel` | deploys, env vars, cron, logs, rollback | `vercel login` → team **studiobing** |
| Supabase CLI | `brew install supabase/tap/supabase` | migrations, types, `db push`, local stack | `supabase login`; `supabase link --project-ref <ref>` (prod or staging) |
| Docker runtime | **OrbStack** (`brew install --cask orbstack`) or Docker Desktop | `supabase start` local Postgres/Auth/Storage for dev + RLS tests | — |
| Playwright browsers | `pnpm exec playwright install chromium` (after `pnpm i`) | screenshots (`design-fidelity`), smoke tests | — |
| psql (optional) | `brew install libpq && brew link --force libpq` | poke the local DB | — |
| jq, curl, python3 | preinstalled / `brew` | scripts, API probes | — |

Status on David's Mac (2026-08-17, all installed & verified): node 24.12 · pnpm 11.22 · gh · vercel 50.39 (authed, team studiobing) · supabase **2.114** (authed; no odsens projects yet) · **OrbStack** (Docker 29.4 daemon running; `supabase start` verified — Postgres 17.6 local stack boots) · **psql 18.6** (libpq) · **Playwright Chromium** (in `~/Library/Caches/ms-playwright`) · jq/curl/python.
Note: `brew trust supabase/tap` was needed before `brew upgrade supabase`. OrbStack runs as a menu-bar app; start it if `docker` says the daemon is down.

Oliver's laptop: install the table top-to-bottom; he needs **read/write on the GitHub repo**, a `.env` from David (never via chat), and — only if he'll run migrations locally — Docker + Supabase CLI. For day-to-day (`pnpm dev` against the **`staging` Supabase branch** or the local stack) Docker is only required for the local stack.

No CLI exists or is needed for Resend, Ko-fi, YouTube, Modrinth, CurseForge — SDK/HTTP from the app; keys in `.env`.

## Supabase project (2026-08-17)
- **`odsens`** — ref `dllbekulbimblrsrxuyv`, region us-east-2, org StudioBing → treated as **production**. Linked from the repo: `supabase link --project-ref dllbekulbimblrsrxuyv` (already done on David's Mac; Oliver's laptop repeats `supabase login` + `link` only if he runs migrations).
- URL + anon/service keys are in David's `.env`; the CLI also exposes newer `publishable`/`secret` keys — may switch at scaffold.
- **Staging = a persistent Supabase branch `staging`** on this project (Branching decided 2026-08-17; 2026-08-20: one persistent branch instead of a branch per PR — ADR-0010): git branch `staging` ↔ Supabase branch `staging` (ref `oihrxwqarwllvsyllczo`, us-east-2, micro, created via the CLI), no second project. Every Vercel preview runs against it — the Preview environment carries its `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`, set once by David. `ship` pushes each PR branch to `staging` (`git push origin <branch>:staging`, fast-forward only, never force) before the preview is reviewed so its migrations + `config.toml` (`[remotes.staging]`) reach the branch through the GitHub integration; `main` promotes to production on merge. Automatic per-PR branching in the Supabase GitHub integration is off; the staging Auth callback (`https://oihrxwqarwllvsyllczo.supabase.co/auth/v1/callback`) is registered once in the Google console. Local stack (`supabase start`) covers dev. Local and CI e2e require `NEXT_PUBLIC_SUPABASE_URL` = the 127.0.0.1 stack (exported from `.env.test`) so `next/image` can load stored avatars.

## Vercel project (2026-08-17)
- **`odsens`** — team `studiobing`, project id `prj_fTdiX6oYxyQ8CnAmzSzKnCb74MkU`, org `team_uH24XLt4wLRlbcqDi84oT14Y`. Git: `davidcbingham/odsens`, production branch `main`. Preset Next.js, root `.`, Node 24.x. **Deployment Protection: Standard** (Vercel Auth on all `*.vercel.app` URLs; the custom domain is public — **odsens.com is attached and live since the S1.1 merge, 2026-08-21**: `https://odsens.com` 308 → `https://www.odsens.com` 200 without any bypass).
- Linked locally: `vercel link --yes --scope studiobing --project odsens` (writes `.vercel/`, gitignored). First deploy errored by design (no `package.json`).
- **Env vars seeded** (all "Encrypted"): non-secret config (`NEXT_PUBLIC_SITE_URL`, `YOUTUBE_CHANNEL_ID`, `MODRINTH_USER`, `MODRINTH_USER_AGENT`, `CURSEFORGE_MEMBER`, `KOFI_PAGE`, `NOTIFY_FROM_EMAIL`) in prod+preview+dev; secrets (`CRON_SECRET`, `YOUTUBE_API_KEY`) in prod+preview; **Supabase vars: production values in Production only; Preview carries the persistent `staging` branch's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`, set once by David (ADR-0010)**. Still to add when obtained: `CURSEFORGE_API_KEY`, `RESEND_API_KEY`, `DISCORD_WEBHOOK_URL`, `KOFI_WEBHOOK_VERIFICATION_TOKEN`.
- CLI quirks (v50.39): `vercel env add NAME preview` insists on an interactive branch prompt even with `--yes` and `vercel api` rejects JSON bodies → for **preview** use the REST API directly: `curl -X POST https://api.vercel.com/v10/projects/<id>/env?teamId=<team>&upsert=true -H "Authorization: Bearer <token>" -d '{"key":..,"value":..,"type":"encrypted","target":["preview"]}'` (token in `~/Library/Application Support/com.vercel.cli/auth.json`). Production/development work via `printf value | vercel env add NAME production --force`.
