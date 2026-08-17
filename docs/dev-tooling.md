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

Oliver's laptop: install the table top-to-bottom; he needs **read/write on the GitHub repo**, a `.env` from David (never via chat), and — only if he'll run migrations locally — Docker + Supabase CLI. For day-to-day (`pnpm dev` against the **staging** Supabase project) Docker is not required.

No CLI exists or is needed for Resend, Ko-fi, YouTube, Modrinth, CurseForge — SDK/HTTP from the app; keys in `.env`.

## Supabase project (2026-08-17)
- **`odsens`** — ref `dllbekulbimblrsrxuyv`, region us-east-2, org StudioBing → treated as **production**. Linked from the repo: `supabase link --project-ref dllbekulbimblrsrxuyv` (already done on David's Mac; Oliver's laptop repeats `supabase login` + `link` only if he runs migrations).
- URL + anon/service keys are in David's `.env`; the CLI also exposes newer `publishable`/`secret` keys — may switch at scaffold.
- **Staging for previews — open choice:** (a) second project `odsens-staging` (simple, isolated), or (b) **Supabase Branching** on this project (preview branch per PR, integrates with Vercel previews; Pro plan feature). Decide before the first preview deploy; local stack (`supabase start`) covers dev until then.
