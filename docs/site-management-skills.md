# Site Management Skills — "the site management team"

Rewritten 2026-08-17 from a fresh look at **the moments Oliver will actually open Claude Code on this repo** and what a
specialist would need to know to help him well. Skills live in `.claude/skills/<name>/SKILL.md`, committed (not
gitignored) so they travel with the repo to any machine. Shared conventions live in `CLAUDE.md`. Skills are written after
the first build exists (they reference real files/commands); this doc is their spec.

## 1. Oliver's moments → who helps

| # | Moment (in his words) | Skill | Why Claude Code (not the admin UI) |
|---|---|---|---|
| 1 | "How do I run this on my laptop / what's git doing / I broke something" | **`start-here`** | Setup, env, local run, git in plain words. Recovery from common git messes. |
| 2 | "Ship it" / "why isn't my change live?" / "undo that deploy" | **`ship`** | Branch → preview URL → PR → merge → production; env vars; rollback. |
| 3 | "Something's broken" (site down, deploy failed, comments won't post, sign-in loops, sync stale) | **`whats-wrong`** | Triage: logs, `sync_runs`, Vercel status, Supabase status, common causes → fix or escalate. |
| 4 | "Make the cards purple-er / move the download button / change the font size" | **`restyle`** | Change UI safely inside `DESIGN.md`: token vs component decision, contrast check, screenshot before/after, update DESIGN.md if a rule changed. |
| 5 | "I want a new thing" (a poll, a Discord widget, a changelog page, a new project type) | **`new-feature`** | Idea → scoped plan → spec/questions update → migration → UI per DESIGN.md → tests → PR. Keeps him from bolting things on. |
| 6 | "I need a new table/column / change what comments store" | **`db-change`** | Migrations, RLS, regenerate types, seed, never edit prod by hand. Usually called *by* `new-feature`. |
| 7 | "Here are 12 skins and 30 art files — put them on the site" / "prep this exclusive mod listing" | **`add-content`** | Bulk ingest with format/dimension checks, renames, DB rows, uploads; drafts listing text. Bulk is painful in a form UI. |
| 8 | "My new Modrinth mod isn't showing / downloads look wrong / link CurseForge" | **`sync-now`** | Force a sync, read `sync_runs`, fix type mapping or `project_links`, explain the numbers. |
| 9 | "Write the description for this / an announcement / better error text" | **`write-copy`** | Voice & tone from `DESIGN.md` §7 applied to real copy; no hype, no emoji, handles only. |
| 10 | "What's popular? Did the video bump downloads?" | **`stats`** | Queries `stats_daily`/`projects`/`comments`; short plain-English report, optional chart in admin style. |
| 11 | "Update stuff / there's a security warning / Next.js is old" | **`upkeep`** | Dependency + platform updates, advisories, monthly checklist, backups; safe order of operations. |
| 12 | (any decision changes) "we decided X" | **`keep-docs`** | Updates `docs/spec.md`, `docs/questions.md`, `DESIGN.md` changelog, `CHANGELOG.md`; the memory of the project. |

Moderation, featuring, hiding, settings, and single uploads stay in the **admin UI** — no skill needed; `whats-wrong`
and `add-content` know how to fall back to SQL if the UI is the thing that's broken.

## 2. Team-wide rules (go in `CLAUDE.md`, every skill inherits)
0. **Boundaries & hand-offs follow `docs/skill-handoffs.md`** — every skill has Owns / Does-not-own / triggers / stop-and-ask, writes a hand-off note, and gate skills return verdicts instead of taking over.
1. **Talk to Oliver like a smart 15-year-old who builds mods, not like a web developer.** Name the concept once, then use it. Show, don't lecture.
2. **Never destructive without a one-line confirm**: force-push, dropping tables/columns, deleting Storage files, rollback of production, editing prod data by hand.
3. **Preview before production, always.** Every change gets a Vercel preview URL; production only via merged PR.
4. **DESIGN.md is law for anything visible.** Restyles cite the token/component; new UI reuses components; if a rule must change, change `DESIGN.md` in the same PR.
5. **Docs stay true.** If a skill changes behaviour, scope, or a decision, it calls `keep-docs` (or does the update inline).
6. **Secrets never in git.** `.env` local, Vercel env for deploys; skills never print secret values.
7. **Small PRs, plain commit messages** ("Add Discord widget to home rail"), Co-authored-by Claude line.
8. **Leave a breadcrumb.** Each skill ends with "what I did / where it is / how to undo".

## 3. Skill specs

Each `SKILL.md` = frontmatter (`name`, `description` tuned so Claude auto-triggers on Oliver's phrasing) + **When to use** ·
**Inputs it needs** · **Steps** (checklist) · **Guardrails** · **Done looks like** · **Hand-offs**. Keep each under ~150 lines;
put long references in `docs/`.

### `start-here`
- Triggers: setup, clone, install, run locally, "how do I", git confusion (detached HEAD, merge conflict, "I committed to main", "it says diverged").
- Steps: check Node/pnpm/git/Supabase CLI; `pnpm i`; `.env` from `.env.example` (ask David for values, never paste secrets into chat); `pnpm dev`; explain branch/commit/push/PR in 6 lines; git rescue recipes.
- Guardrails: no history rewrites without confirm; never `git push --force` to main.

### `ship`
- Triggers: deploy, publish, "is it live", preview, rollback, env var.
- Steps: ensure branch + clean tree → push → find Vercel preview URL → checklist (build passed, screenshot key pages, `pnpm test`) → open PR (template) → after merge, verify production → if bad, `vercel rollback` (confirm) and open a fix branch.
- Knows: Vercel project name, env var names (`.env.example`), cron routes to smoke-test after deploy.

### `whats-wrong`
- Triggers: broken, error, 500, down, blank, "won't", stale, sync, sign-in loop, can't comment.
- Steps: classify (build/deploy · runtime · data/sync · auth · third-party) → check Vercel deploy status/logs, Supabase logs, `sync_runs`, `notification_events`, statuspages → known-cause table (expired API key, RLS denied, missing env var, Modrinth 429, YouTube quota, Google OAuth redirect mismatch, cron not firing) → fix or write a precise report for David.
- Guardrails: read-only until cause is confirmed; no prod data edits without confirm.

### `restyle`
- Triggers: colour, spacing, font, size, layout, "make it look", "move the", "bigger", "uglier/prettier".
- Steps: locate the component/token; decide **token change** (global) vs **component change** (local); apply per DESIGN.md rules (0 radius, 2px lines, offset shadows, type minimums); run contrast calc if colour changed; screenshot before/after (Playwright) at desktop + phone; if a rule changed, edit `DESIGN.md` + changelog; PR via `ship`.
- Guardrails: never introduce Tailwind/UI kits/gradients/blur; never a new colour outside tokens without adding a token.

### `new-feature`
- Triggers: "add", "I want", "can the site", "new page/section/button that does".
- Steps: restate the idea in one line → check spec/questions (already decided? conflicts?) → write a 10-line plan (data, UI, routes, admin, tests, docs) → confirm with Oliver → `db-change` if needed → build UI from DESIGN.md components (never invent) → tests → `keep-docs` → `ship`.
- Guardrails: scope creep check ("is this one feature?"); no PII; comments/uploads go through server actions with RLS.

### `db-change`
- Triggers: table, column, migration, RLS, "store", "save", types.
- Steps: write migration in `supabase/migrations/`; RLS policies included; `supabase db reset` locally + seed; regenerate types; `pnpm test`; note reversibility; apply to prod only via the deploy pipeline / `supabase db push` after preview verified.
- Guardrails: no `DROP` without confirm + backup; every new table gets RLS on day one.

### `add-content`
- Triggers: bulk skins/art/thumbnails, "put these on the site", exclusive project prep, "here's the jar", rename files.
- Steps: inspect files (type, dimensions, size; skins must be 64×64 PNG; art any size, no forced crop; icons square) → normalize names (kebab-case) → upload via server script/API to correct bucket → create DB rows (draft) → render skin busts → draft listing copy with `write-copy` → hand Oliver the admin URL to review/publish.
- Guardrails: never overwrite existing files; drafts only — publishing is a human click.

### `sync-now`
- Triggers: Modrinth, CurseForge, YouTube, "not showing", downloads, "wrong type", "link", "sync".
- Steps: run the sync route locally or hit the cron endpoint with the secret; read `sync_runs`; explain diff (new/updated/hidden); fix `project_type` mapping edge cases; add/adjust `project_links` for CF ids; revalidate pages.
- Guardrails: respect rate limits; never delete synced rows (hide instead).

### `write-copy`
- Triggers: description, blurb, announcement, error message, "sounds better", "how should I say".
- Steps: read DESIGN.md §7 do/don't; ask what it's for and where it appears (char limits); produce 2–3 options; no emoji/hype/vlogger voice; handles only; state limits honestly ("untested").

### `stats`
- Triggers: stats, numbers, popular, trend, "how many", "did the video".
- Steps: query `stats_daily`, `projects`, `videos`, `comments`; answer in ≤8 lines with the number that matters; optional flat SVG chart snippet or link to admin Stats.
- Guardrails: read-only.

### `upkeep`
- Triggers: update, upgrade, outdated, security, dependabot, backup, monthly.
- Steps: `pnpm outdated`/audit → group (patch/minor/major) → update in a branch → run build+tests → preview → ship; Supabase/Next major upgrades follow their guides; monthly checklist (backups exist, cron ran, keys not expiring, error rate, disk/storage size).
- Guardrails: one major upgrade per PR; never on a Friday night before he wants to publish something (joke, but: ask).

### `keep-docs`
- Triggers: "we decided", "change the spec", after any feature/design change; called by other skills.
- Steps: locate the relevant section in `docs/spec.md` / `docs/questions.md` / `DESIGN.md` / `docs/data-model.md`; make the smallest true edit; add a dated line to the spec revision log; strike answered questions.

## 4. Build & major-update specialists (exist now, in `.claude/skills/`)

These persist alongside Oliver's team and are pulled in for the initial build and any major update. Oliver's
`new-feature`, `restyle`, `db-change`, and `ship` call them as gates; the built-in `/security-review`, `/code-review`,
and `/simplify` remain the generic layer underneath.

| Skill | Specialization | Gate it owns |
|---|---|---|
| **`build-phase`** | Foreman: turns a scope into ordered vertical slices, pulls in the specialists, gates each slice, writes the phase report | Nothing merges with an open ❌ from a specialist |
| **`supabase-ops`** | Migrations, RLS-on-day-one, helpers/views/triggers, Storage policies, Auth config, types, staging→prod promotion | Every table has tested RLS; no ad-hoc prod SQL |
| **`vercel-ops`** | Env per environment, cron routes + `CRON_SECRET`, ISR/revalidate tags, domain/DNS, analytics, rollback, troubleshooting map | Preview smoke passed; secrets not in bundle |
| **`security-check`** | Project threat model: PII leakage, authZ defense-in-depth, upload/download hardening (magic bytes, signed URLs, sha512), comment abuse, webhook verification, CSP/headers, rate limits | Pass/fail table in the PR |
| **`design-fidelity`** | Tokens-only CSS, component state parity with `DESIGN.md`, look rules, computed contrast, Playwright screenshots vs prototypes, voice | Screenshots + checklist in PR; deviations edit DESIGN.md |
| **`backend-robustness`** | Idempotent sync, retries/timeouts/quotas, `sync_runs`, zod-validated actions and env, download route, notifications queue, fixture-based tests | Robustness checklist in PR |

### Gate agents (`.claude/agents/`, exist now)
`spec-drift-reviewer` (every PR; checks `docs/build/00–05` + ADRs) · `design-fidelity-reviewer` · `frontend-reviewer` · `security-reviewer` · `backend-reviewer` · `supabase-reviewer` · `deploy-checker` — read-only,
background, parallel-safe counterparts of the specialist gates. `build-phase`, `new-feature`, and `ship` spawn them in
batches and paste the `GATE:` verdicts into the PR. See `docs/skill-handoffs.md` §4.

## 5. Later / optional
- `land-design-pass` — unpack/verify/place a Claude Design export (done by hand ×3; encode if a pass 4 happens).
- `moderate-cli` — bulk moderation from the terminal (only if the admin UI proves insufficient).
- `orders` — help draft replies to custom-order requests in voice; track status.
- `kofi` — webhook debugging, supporters wall maintenance (phase 2).
- `design-pass` — prep a prompt + bundle for a new Claude Design session and land the export (we did this by hand twice; worth automating if a pass 3 happens).

## 6. `CLAUDE.md` at build time (outline)
Project one-liner · where things are (`app/ components/ lib/ styles/ supabase/ docs/ design/ assets/brand/`) · commands (`pnpm dev/build/test`, `supabase start/db reset`) · the team-wide rules above · the skills table with one line each · "if unsure which skill, describe the moment and I'll pick".
