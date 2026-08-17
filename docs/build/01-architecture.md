# Architecture & Invariants
The numbered, gate-checkable rules every odsens.com PR must satisfy — repo layout, rendering model, data access, security, caching, styling, and dependencies — so read-only gate agents can diff code against a fixed contract.
Status: DRAFT v0.2 (2026-08-17) — becomes v1.0 at freeze

Sources this doc restates (it decides nothing they settle): `docs/build/_registry.md` (IDs, names, layout), `docs/spec.md`, `docs/questions.md`, `docs/data-model.md` (§1 principles, §3 buckets, §4 RLS, §5 sync), `docs/notifications.md`, `docs/framework-decision.md` (stack, guardrails), `docs/analytics-options.md`, `DESIGN.md` v1.3, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `docs/dev-tooling.md`, `.env.example`, `supabase/config.toml`.
Sibling docs: `00-build-plan.md` (slices, acceptance), `02-routes-and-pages.md` (per-route rendering/auth), `03-components.md` (inventory), `04-server-contracts.md` (action/route/job shapes), `05-test-plan.md` (T-* ids), `06-decisions/` (ADRs).

## 0. How to read this doc
- Every invariant is `INV-nn` with: **Statement** (MUST/NEVER, one sentence), **Rationale** (one line), **Check** (grep/command/inspection a gate runs), **Gate** (owning agent; `spec-drift` = `spec-drift-reviewer`, `security` = `security-reviewer`, `frontend` = `frontend-reviewer`, `backend` = `backend-reviewer`, `schema` = `supabase-reviewer`, `design` = `design-fidelity-reviewer`, `deploy` = `deploy-checker`).
- Paths are repo-relative. `@/` is the TS path alias for the repo root (`tsconfig.json` `paths: {"@/*": ["./*"]}`).
- "v1" = S0–S1.10. Phase 2 (S2.x) rules are stubs in §26; they bind only when that slice starts.
- Deviating from any INV requires an ADR in `docs/build/06-decisions/` **and** an edit to this doc in the same PR (INV-95).
- Rules that belong to sibling docs are cross-referenced, not restated. **Precedence between siblings:** where 01 and 04 state the same contract, **04 wins for shapes and names** (action result types, error codes, helper names, per-surface rate-limit numbers, cron schedules); where 01 and 03 state the same fact, **03 §2 wins for the Server/Client mark of a component**; where 01 and 02 state the same fact, **02 §1 wins for a route's rendering mode**. 01 owns the cross-cutting rule and its check.
- Greps in this doc assume the tree in §1 (public routes are `app/<segment>/…` with no `(public)` route group; the only route group is `app/(onboarding)/`).

## 1. Repo layout & file naming

Canonical tree (from `_registry.md` "Repo layout", refined by 02/04/05; a gate treats any top-level directory or `lib/` module not listed here as drift):

```
app/                                   routes: app/<public segment>/*, app/(onboarding)/welcome/*, app/profile/*, app/admin/*, app/api/*, app/auth/*
app/layout.tsx app/page.tsx app/loading.tsx app/error.tsx app/global-error.tsx app/not-found.tsx app/robots.ts app/sitemap.ts
components/<area>/                     <area> ∈ layout|primitives|projects|comments|accounts|videos|skins-art|seen-on|support|admin  (registry groups; P2 adds workrooms|orders)
lib/actions/<area>.ts                  Server Actions (all mutations); files exactly: accounts, comments, settings, projects, uploads, skins, art, mentions, sync, videos (04 C-01 + 04 §11) + result.ts
lib/data/<area>.ts                     read-side queries used by Server Components and route handlers   (registry addition §28)
lib/jobs/<job>.ts                      cron/job bodies (syncModrinth … renderSkinBust)
lib/adapters/<source>.ts               HTTP adapters (modrinth, curseforge, youtube, oembed, resend, discord) + lib/adapters/http.ts (fetchJson)
lib/supabase/{server,anon,client,admin,types}.ts
lib/notify/emit.ts lib/notify/deliver/{email,discord}.ts
lib/validation/{handle,files,comments}.ts   zod schemas + pure validators (RESERVED_HANDLES, sniffMime, UPLOAD_KINDS, comment rules)
lib/format/*.ts                        formatDate, relativeTime, formatCount
lib/env.ts lib/env/public.ts lib/log.ts lib/flags.ts lib/markdown.ts lib/auth.ts lib/hash.ts lib/files.ts lib/rate-limit.ts
emails/                                React Email templates + preview
styles/tokens.css styles/globals.css
public/fonts/ public/brand/ public/brand/marks/
supabase/migrations/ supabase/seed.sql supabase/config.toml
tests/unit tests/db tests/e2e tests/fixtures tests/helpers
scripts/contrast.mjs scripts/render-skins.mjs scripts/check-client-islands.mjs scripts/check-fixtures.mjs scripts/check-test-ids.mjs scripts/check-bundle-secrets.mjs scripts/record-fixture.mjs
middleware.ts next.config.ts vercel.json eslint.config.mjs .nvmrc
docs/build/ docs/ design/ assets/brand/ DESIGN.md CLAUDE.md
```

Module ownership (so no helper is invented twice): handle rules → `lib/validation/handle.ts` (`handleSchema`, `RESERVED_HANDLES`; 04's `lib/handles.ts` is this file — see §30); file sniffing/caps → `lib/validation/files.ts` (`sniffMime`, `UPLOAD_KINDS`, `validateUpload`); storage paths, signed URLs, avatar re-encode, `resolveDownloadable` → `lib/files.ts`; hashing → `lib/hash.ts`; rate limits → `lib/rate-limit.ts`; notification events → `lib/notify/emit.ts`; logging → `lib/log.ts`; feature flags → `lib/flags.ts`.

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-01 | Every source file MUST live in one of the directories/modules in the tree above; new top-level directories or `lib/*.ts` leaf modules NEVER appear without an ADR (or a "Registry additions" row in 01–05 that names them). | One layout for Oliver + Claude Code; gates know where to look. | `ls` repo root, `app/`, `lib/`, `components/` vs the tree; anything extra → ❌ | spec-drift |
| INV-02 | Every component MUST be `components/<area>/<Name>.tsx` + `components/<area>/<Name>.module.css`, `<Name>` = the registry PascalCase name (e.g. `TypeBadge`, `MentionCard`); one exported component per file; sub-parts are `<Name>.<Part>.tsx` (03 C-02); a component with no styles of its own (03 marks it) needs no `.module.css`. | Names in code = names in DESIGN.md = names in `03-components.md`. | `ls components/*/` — every `.tsx` has a same-name `.module.css` unless its 03 row says "no styles"; every name appears in the component registry or 03 §10 | spec-drift, design |
| INV-03 | Route files MUST be App Router conventions only (`page.tsx`, `layout.tsx`, `template.tsx`, `default.tsx`, `loading.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `route.ts`, `robots.ts`, `sitemap.ts`, `manifest.ts`, `opengraph-image.tsx`, `icon.tsx`); no `pages/` directory. | One routing model. | `find pages -type f` → must be empty; `find app -name "*.tsx" -o -name "*.ts"` basenames ⊆ the list | spec-drift, frontend |
| INV-04 | Server Actions MUST live in `lib/actions/<area>.ts` with a top-of-file `'use server'`; the set of files is exactly the 04 C-01 list (+ `videos.ts` per 04 §11, + `result.ts` which has no directive) and each file exports only the actions named in the registry / 04 §11. | The action list is the mutation surface; gates diff it. | `grep -rl "'use server'" --include=*.ts --include=*.tsx .` → only `lib/actions/*.ts`; `ls lib/actions` == list; exported names ⊆ registry "Actions" ∪ 04 §11 | spec-drift, backend |
| INV-05 | Jobs live in `lib/jobs/<name>.ts` and adapters in `lib/adapters/<source>.ts`; a cron route (`app/api/cron/<x>/route.ts`) MUST contain no sync logic other than auth + calling the job(s) 04 §2.4 names for that route (`/api/cron/notify` = `notifyFanOut` then `notifyDeliver`; every other route = one job). | Jobs are testable without HTTP; routes are thin. | Read each `app/api/cron/*/route.ts`: ≤ auth check + the `lib/jobs` import(s) 04 §2.4 lists + JSON response | backend |
| INV-06 | Non-code names MUST follow: migrations `supabase/migrations/<timestamp>_<slug>.sql` (one concern each), tests `tests/<layer>/<subject>.test.ts`, ADRs `docs/build/06-decisions/ADR-<nnnn>-<slug>.md`, fixtures `tests/fixtures/<source>/*.{json,xml,html}` with `<source>` ∈ `modrinth, curseforge, youtube, oembed, resend, discord, kofi`. | Predictable paths for skills and gates. | `ls` each directory against the patterns | spec-drift, schema |
| INV-07 | Package manager is pnpm (`pnpm-lock.yaml` committed; no `package-lock.json`/`yarn.lock`), Node version pinned in `.nvmrc` and `package.json#engines` (see Open O-1 for 22 vs 24). | One toolchain on David's, Oliver's, CI, Vercel. | `ls package-lock.json yarn.lock` → absent; `cat .nvmrc` | spec-drift, deploy |

## 2. Rendering model — Server Components default, enumerated client islands

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-08 | Every component is a Server Component unless its 03 §2 row is marked `` `C` `` (or it is a `<Name>.<Part>.tsx` client leaf that row names); the only `'use client'` files outside those are `app/error.tsx`, `app/global-error.tsx`, and `app/**/error.tsx` (Next requirement). `'use client'` NEVER appears elsewhere without an ADR + 03 row change. **03 §2 is the single machine-readable owner of the list; this doc does not repeat it.** | Ship HTML, not JS; keep patterns simple (framework-decision guardrails). | `scripts/check-client-islands.mjs` (INV-94): parses 03 §2 tables (rows whose S/C cell starts with `` `C` `` and client leaves named in the same cell), then `grep -rl "'use client'" app components lib` ⊆ that set ∪ `app/**/error.tsx`, `app/global-error.tsx` | frontend, spec-drift |
| INV-09 | Client islands MUST receive data as props and NEVER fetch (no `fetch`, no Supabase query, no `use(promise)` of a DB call) — the only network they may initiate is a Server Action call, an upload PUT to a signed URL from `UploadWell` (INV-51), `track()`, `SkinViewer3D`'s texture load, and **the RP-01 exception**: `ViewerProvider` (registry addition §28; mounted once in `app/layout.tsx`) and `CommentThread` read *session-scoped rows only* through `lib/supabase/client.ts` (anon key + RLS) after hydration — session, own `public_profiles` row (`handle, avatar_path, role`), own `profiles.is_banned`, own comments with `status IN ('held','hidden')` for the current target, own `comment_likes` for visible comments (02 §2.3). Every other client component gets viewer state from `useViewer()`. | Data access stays server-side (web-quality) except where ISR makes a server read impossible (02 RP-01); one seam for client reads. | `grep -rln "supabase/client" components app lib` → only `components/accounts/ViewerProvider.tsx`, `components/comments/CommentThread.tsx`, auth UI (`GoogleSignInButton`, `AdminGate` sign-in form) and `lib/supabase/client.ts`; in every other `'use client'` file `grep -n "fetch(\|from('\|createClient\|@/lib/supabase\|@/lib/data"` → none | frontend, security |
| INV-10 | Heavy client code MUST be lazy-loaded via `next/dynamic` with `ssr:false` where the lib needs `window`: `SkinViewer3D` (skinview3d) and `Lightbox` (dynamic import on first open) — 03 C-18; nothing else in v1 (`Markdown` and `FlatBarChart` are Server Components). | Bundle discipline; first-load JS of public routes stays small. | `grep -rn "next/dynamic" components` → only those two; `pnpm build` route table: no public route first-load JS grows > 20 KB gz in a PR without a note | frontend |
| INV-11 | Every route segment that reads data MUST have `loading.tsx` rendering the matching `Skeleton*` component (02 §6); `app/error.tsx`, `app/not-found.tsx` (DESIGN.md §11.3 pages 13–14) and `app/global-error.tsx` MUST exist. | Global states are designed; no blank flashes. | `find app -name loading.tsx` per data segment listed in 02 §6; `ls app/error.tsx app/not-found.tsx app/global-error.tsx` | frontend, design |

## 3. Data access — only through `lib/`

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-12 | Reads MUST go through `lib/data/<area>.ts` (functions taking a Supabase client) and writes through `lib/actions/*` or `lib/jobs/*`; `app/**` pages/layouts and `components/**` NEVER import `@supabase/*` or call `.from(`/`.rpc(`/`.storage.` directly. Exceptions: `app/auth/callback/route.ts` and `app/auth/sign-out/route.ts` (import `@/lib/supabase/server` only), `app/api/**/route.ts` (import `@/lib/supabase/admin` and call Storage only through `lib/files.ts`), and the INV-09 RP-01 components (import `@/lib/supabase/client` only). | Data model principle 5 (browser = anon + RLS; server = service role only for sync/admin); one place to audit queries. | `grep -rn "@supabase/\|\.from('\|\.rpc(\|\.storage\." app components` → hits only in `app/auth/*/route.ts`, `app/api/**/route.ts`, `ViewerProvider.tsx`, `CommentThread.tsx`; `grep -rn "createSignedUrl\|createSignedUploadUrl" app` → none (those live in `lib/files.ts`) | spec-drift, security |
| INV-13 | `@supabase/supabase-js` / `@supabase/ssr` MUST be imported only inside `lib/supabase/*.ts`; the **four** clients are: `createServerClient()` in `lib/supabase/server.ts` (cookies + anon key; dynamic routes and user-scoped actions only), `createAnonClient()` in `lib/supabase/anon.ts` (anon key, **no cookies**; ISR page reads via `lib/data/**`, registry addition), `createBrowserClient()` in `lib/supabase/client.ts` (anon key; auth UI, session refresh, and the INV-09 RP-01 reads), `createAdminClient()` in `lib/supabase/admin.ts` (service role). | Four clients, three keys, greppable call sites; the cookie client is what opts a route into dynamic rendering, so ISR reads never touch it. | `grep -rln "@supabase/supabase-js\|@supabase/ssr" --include=*.ts --include=*.tsx . \| grep -v ^lib/supabase/` → empty; `ls lib/supabase` == `server.ts anon.ts client.ts admin.ts types.ts` | security, spec-drift |
| INV-14 | `lib/supabase/admin.ts` MUST import `server-only` and MUST be imported only from `lib/actions/**`, `lib/jobs/**`, `lib/notify/**`, `lib/files.ts`, `lib/rate-limit.ts`, `app/api/**`, and `lib/data/settings.ts` (INV-15 carve-out); NEVER from `components/**`, `app/**/page.tsx`, `app/**/layout.tsx`, other `lib/data/**`, `middleware.ts`. | Service role never reaches a page render path or the client bundle. | ESLint `no-restricted-imports` (INV-84) + `grep -rln "supabase/admin" components app lib/data middleware.ts` → only `app/api/**` and `lib/data/settings.ts` | security |
| INV-15 | Every read that renders an ISR/public page MUST use `createAnonClient()` (RLS enforced) or the public views `public_profiles` / `projects_public`; the one carve-out is `lib/data/settings.ts` `getPublicSettings()`, which uses the admin client to select **only** `kofi_page, comments_closed_default` from `site_settings` (RLS: admin-select only, data-model §4) — no other admin-client read serves a public page. The cookie server client is NEVER used by an ISR page. | Public pages break loudly if RLS is wrong instead of silently bypassing it; the ISR shell never varies by user (02 §0.1). | `grep -n createAdminClient lib/data` → only `settings.ts` (one function, two columns); `grep -rn "supabase/server\|cookies()" app` → hits only under `app/(onboarding)`, `app/profile`, `app/admin`, `app/auth`, `app/api` | security, schema |
| INV-16 | Generated DB types (`lib/supabase/types.ts` via `supabase gen types typescript --local`) MUST be regenerated and committed in the same PR as any migration; every client is typed `SupabaseClient<Database>`. | Type drift between schema and app is caught at typecheck. | Diff includes `supabase/migrations/*` ⇒ diff includes `lib/supabase/types.ts`; `grep -n "SupabaseClient<Database>" lib/supabase/*.ts` | schema, backend |

## 4. Server Actions — the only mutation path

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-17 | Every mutation from UI MUST be a Server Action in `lib/actions/*` (contract in 04); NEVER `POST` route handlers for UI forms (route handlers are only for cron, download, webhooks, auth callback/sign-out, `/api/og`, `robots`, `sitemap`). | One mutation surface with one shape. | `find app/api -name route.ts` ⊆ registry API list + `app/auth/*`; `grep -rn "method=\"post\"\|method='post'" components app` → only `GoogleSignInButton`'s sign-in form and `ProfileMenu`'s sign-out form (04 §2.2); every other form uses `action={serverAction}` | spec-drift, backend |
| INV-18 | Every action MUST, in order: (1) parse input with a zod schema exported from the same file as `<actionName>Schema` (04 C-02), (2) resolve the session via `lib/auth.ts` (`requireUser()` / `requireOnboarded()` / `requireRole('moderator'|'admin')` per the 04 row) and re-check role/ban server-side even though RLS also enforces it, (3) perform the write, (4) call `revalidateTag` for every affected tag from §8 (never `revalidatePath`, 02 RP-21), (5) return the 04 C-03 result. | Defense in depth + typed results (backend-robustness, security-check). | Read each exported action: `<actionName>Schema.safeParse` first; `requireUser|requireOnboarded|requireRole` before any write; `revalidateTag(` present; return type `Ok<T> \| Err` | backend, security |
| INV-19 | Action results are exactly 04 C-03: `Ok<T> = {ok:true, data:T}` \| `Err = {ok:false, error:ErrorCode, message?:string, issues?:Issue[]}` (types in `lib/actions/result.ts`; `ErrorCode` = the exhaustive union in 04 §7); actions NEVER throw to the client, NEVER return raw Supabase/Postgres errors, and `message` is plain-language DESIGN.md §7 copy. | Errors render inline in the design's voice; no stack traces or "Code 500". | `grep -n "throw " lib/actions/*.ts` → only inside try blocks that map to `ok:false`; `grep -n "error.message" lib/actions` → not passed through from Supabase; `grep -n "export type ErrorCode" lib/actions/result.ts` == 04 §7 | backend, design |
| INV-20 | Read-only RPCs invoked from client islands (v1: `checkHandle` → SQL `check_handle`) MUST be exposed as Server Actions with the same zod + auth rules; the browser NEVER calls Supabase RPC directly. | Same surface, same audit. | `grep -rn "\.rpc(" components` → none | security |
| INV-21 | Actions/jobs that create user-visible events MUST insert `notification_events` only via `lib/notify/emit.ts` `emit(kind, …)` (04 C-22) inside the same request; the catalog names in `docs/notifications.md` are the only allowed `kind` values. | One event log, permanent names, one insert site. | `grep -rn "emit('" lib/actions lib/jobs` first args ⊆ catalog; `grep -rn "notification_events" lib \| grep -v "lib/notify/emit.ts\|lib/jobs/notify"` → none | backend, spec-drift |

## 5. Route handlers, cron, webhooks

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-22 | Every `app/api/**/route.ts` MUST export `const dynamic = 'force-dynamic'` and `const runtime = 'nodejs'`; the single exception is `app/api/og/route.ts` (no secrets, no DB) which MAY export `runtime = 'edge'`. | Magic-byte sniffing, `crypto.timingSafeEqual`, sharp, and service role need Node. | `grep -L "force-dynamic" app/api/**/route.ts` → none; `grep -rln "runtime = 'edge'" app` → ⊆ `app/api/og/route.ts` | backend, deploy |
| INV-23 | Every `/api/cron/*` route MUST: require `Authorization: Bearer <CRON_SECRET>` compared with `crypto.timingSafeEqual` (else `401` `{ok:false, error:'unauthorized'}` with no side effects); export `maxDuration = 60`; respond per 04 C-12/C-13 (`200` `{ok:true, source, run_id, items, ms, …summary}`; `200` `{ok:true, skipped:'running'}` on lock; `500` `{ok:false, source, run_id, error}` on failure); and appear in `vercel.json` `crons[]` with exactly the schedule in **04 §6** (deploy-checker compares). | Cron routes are public URLs; one schedule table. | Read each route; `cat vercel.json` == 04 §6 rows for shipped slices; deploy-checker hits each with/without the header | security, deploy |
| INV-24 | Cron routes and jobs MUST be idempotent (re-running with no upstream change writes the same rows: upsert on `(source, external_id)` / `youtube_id` / `mentions.url` / `stats_daily` PK with `on conflict do update`) and NEVER delete rows from synced tables (`projects`, `project_versions`, `project_files`, `project_links`, `videos`, `mentions`; removed upstream ⇒ `status='hidden'`/kept per 04 OPEN-6). The only deletes in `lib/jobs` are `snapshotStats`' housekeeping (04 §3.5: `project_downloads` > 90 d, orphan Storage objects > 24 h). | Data-model §5. | Tests `T-ADP-*` "run twice" + `T-RLS-*` in 05; `grep -rn "\.delete(\|delete from" lib/jobs` → only in `lib/jobs/snapshotStats.ts` | backend |
| INV-25 | Every job MUST insert a `sync_runs` row at start (`started_at, source`) and update it on every exit path (`finished_at, ok, items, error`), including thrown errors (try/finally); a failed run MUST leave previously synced data untouched. | Admin `SyncStatus` and `whats-wrong` read `sync_runs`. | Read job bodies: `sync_runs` insert before first external call, update in `finally` | backend |
| INV-26 | Every external HTTP call MUST go through `lib/adapters/*` via `lib/adapters/http.ts` `fetchJson` (04 C-09: 10 s timeout, retry with backoff on 429/5xx max 3) with the `MODRINTH_USER_AGENT` header on every outbound call (04 C-10); adapters NEVER touch the DB. | Platform limits (Modrinth 300/min, YouTube quota); testable against fixtures. | `grep -rn "fetch(" lib` → only `lib/adapters/http.ts` (+ Storage PUT in `UploadWell` per INV-51); `grep -n "supabase" lib/adapters` → none | backend |
| INV-27 | Webhook routes (`/api/webhooks/kofi`, S2.1) MUST verify the shared secret with `timingSafeEqual`, dedupe on `kofi_message_id`, and treat the payload as untrusted for anything privileged (Phase 2 stub — see §26). | Forged tips. | Read route | security |

## 6. Auth, RLS, keys, schema conventions

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-28 | Every table created in `supabase/migrations/` MUST have `alter table … enable row level security` and its policies in the **same** migration file; policies call `public.is_admin()` / `public.is_moderator()` (security definer) — NEVER inline `role =` checks; no table ships with RLS off. | Data-model §4; supabase-ops conventions. | For each `create table` in a migration file: same file contains `enable row level security` + ≥1 `create policy` for it; `grep -n "role = '" supabase/migrations` only inside the helper function bodies | schema |
| INV-29 | The browser MUST only ever hold `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `NEXT_PUBLIC_SITE_URL`; no other variable's name or value appears in `.next/static/**`. | Service role = full DB. | CI step (05 CI-4 `scripts/check-bundle-secrets.mjs`): `pnpm build && ! grep -rEl "SERVICE_ROLE|sb_secret|CURSEFORGE_API_KEY|YOUTUBE_API_KEY|RESEND_API_KEY|KOFI_|CRON_SECRET|DISCORD_WEBHOOK|GOOGLE_OAUTH|HASH_SALT" .next/static` (superset of 05's list; see §30); deploy-checker repeats on the deployment | security, deploy |
| INV-30 | Session handling MUST be `@supabase/ssr` cookie sessions: `middleware.ts` implements exactly 02 §3 M1–M8 (refresh on every matched request; anon on `/welcome`/`/profile` → 307 `/`; authenticated with `profiles.handle IS NULL` → 307 `/welcome?next=…` except `/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*`, static; onboarded on `/welcome` → `next`) and NEVER reads `role` or renders. | Onboarding is mandatory (spec §5, data-model §6); 02 RP-18. | Read `middleware.ts` + its `matcher` vs 02 §3; e2e `T-E2E-*` onboarding redirect in 05 | security, frontend |
| INV-31 | Admin routes MUST be gated twice: `app/admin/layout.tsx` (`getUser()` null → render `AdminGate`, DESIGN.md §11.3 p.18; role `user` → `notFound()`) and `/admin/settings/page.tsx` `requireRole('admin')` (moderator → `notFound()`, 02 RP-04); every admin action re-checks role (INV-18). Admin pages MUST send `X-Robots-Tag: noindex` and are NEVER linked from public nav/footer (the entry is `ProfileMenu`, 03 O-6). | Takeover = defacement; UI gates are not security. | Read `app/admin/layout.tsx`, `app/admin/settings/page.tsx`; `grep -rn "/admin" components/layout` → only `ProfileMenu` | security |
| INV-32 | `lib/auth.ts` and `middleware.ts` (session refresh) are the only modules that call `auth.getUser()`/`auth.getSession()`; `lib/auth.ts` exports exactly `getUser()`, `getSession()`, `getProfile()`, `requireUser()`, `requireOnboarded()`, `requireRole(role)`, `safeNext(next)` (04 C-04, 02 RP-19) and NEVER returns `email`, `user_metadata` name/picture, or any Google identity field to callers. | PII containment at one seam. | `grep -rn "auth.getUser()\|auth.getSession()" lib app components \| grep -v "lib/auth.ts\|^middleware.ts"` → none; `grep -n "email\|user_metadata\|full_name\|avatar_url" lib/auth.ts` → none | security |
| INV-33 | Storage policies MUST grant insert/update/delete to the service role only (browsers never write with the anon key; the only browser write is a PUT to a single signed upload URL per INV-51); `project-files` (and P2 `workroom-files`) are private buckets; `avatars`, `project-media`, `skins`, `art` are public-read. | Data-model §3. | Read storage policies in migrations; `grep -rn "storage.from(.*).upload(" components app` → none | schema, security |
| INV-34 | Supabase Auth config MUST match `supabase/config.toml`: Google provider only, email confirmations off, `[remotes.production.auth]` `site_url = "https://odsens.com"` and the four `additional_redirect_urls`; the app's callback is `/auth/callback` (code exchange) and sign-out is `POST /auth/sign-out`. | Sign-in loops are the #1 troubleshooting item. | `cat supabase/config.toml`; `ls app/auth/callback/route.ts app/auth/sign-out/route.ts` | deploy, security |
| INV-97 | Every table MUST follow data-model conventions: `snake_case`; `id uuid primary key default gen_random_uuid()` unless data-model names a composite PK (`stats_daily`, `notification_matrix`, `comment_likes`); `created_at timestamptz not null default now()`; `updated_at timestamptz` maintained by the shared `set_updated_at()` trigger; triggers exist for `handle_new_user` (`auth.users` insert → `profiles` row + `email_hash`), `comments.like_count`, `profiles.comment_count` (published comments only), `updated_at`; views `public_profiles` and `projects_public` NEVER include `email_hash`, `email`, or `auth.users` columns; `supabase/seed.sql` creates the `site_settings` row, an admin profile placeholder, and sample projects (supabase-ops). | data-model header conventions; supabase-ops triggers/seed. | `grep -n "create table" supabase/migrations` each followed by `id uuid primary key default gen_random_uuid()` or the named composite PK, `created_at timestamptz`; `grep -n "create trigger" supabase/migrations` includes the four; `grep -n "email" supabase/migrations` → only `profiles.email_hash` + trigger body; `cat supabase/seed.sql` | schema |

## 7. Environment & configuration

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-35 | All `process.env` reads MUST go through `lib/env.ts` (server; imports `server-only`; parses with zod at module load and throws when a required-at-boot variable is missing) and `lib/env/public.ts` (`publicEnv`, only `NEXT_PUBLIC_*`, importable from client code). | No "works locally, 500 in prod". | `grep -rn "process.env" --include=*.ts --include=*.tsx . \| grep -v "^lib/env.ts\|^lib/env/public.ts\|^next.config.ts\|^tests/\|^scripts/"` → none | backend, deploy |
| INV-36 | The env schema MUST cover every variable in the table below except rows marked "CLI only" (mirrors `.env.example`); required-at-boot vs optional-degrade status is exactly 04 C-16; adding a variable = edit `.env.example` + `lib/env.ts` + Vercel envs in the same PR (`vercel-ops`); values are NEVER committed and NEVER printed by skills/gates. | `.env.example` is the checklist for David/Oliver/deploy-checker; 05 T-UNIT-16 tests the same lists. | Diff `.env.example` var names vs zod keys in `lib/env.ts` vs `vercel env ls` names; required list == 04 C-16 | deploy, backend |
| INV-37 | Environment detection MUST use `VERCEL_ENV` (`production` / `preview` / `development`), never hostname sniffing; `NEXT_PUBLIC_SITE_URL` is the canonical origin used for absolute URLs (metadata, emails, OAuth redirects). | Vercel-ops environments. | `grep -rn "VERCEL_ENV\|NEXT_PUBLIC_SITE_URL" lib/env.ts`; `grep -rn "location.host\|headers().get('host')" lib app` → none | deploy |

Env matrix (R = required at boot, O = optional — feature degrades, never crashes, "from S1.x" = the variable is added in that slice; — = not read by the app). Local = `.env`; Preview/Prod = Vercel envs (Supabase preview values injected by the Supabase↔Vercel integration once Branching is on). Status column mirrors 04 C-16.

| Variable | Client-safe | Status | Consumer / degrade behaviour |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | R | `lib/supabase/{server,anon,client}.ts` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | no | CLI only (present in `.env.example` for the Supabase CLI/integration; not read by `lib/env.ts`) | — |
| `SUPABASE_SERVICE_ROLE_KEY` | no | R | `lib/supabase/admin.ts` only |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | no | CLI only (`supabase config push`; `config.toml` reads `env(GOOGLE_OAUTH_CLIENT_SECRET)`) | — |
| `NEXT_PUBLIC_SITE_URL` | yes | R | metadata, emails, redirects |
| `CRON_SECRET` | no | R | `app/api/cron/*` |
| `MODRINTH_USER`, `MODRINTH_USER_AGENT` | no | R | `lib/adapters/modrinth.ts`, `lib/adapters/http.ts` (UA on every call) |
| `YOUTUBE_CHANNEL_ID` | no | R | `lib/adapters/youtube.ts` |
| `YOUTUBE_API_KEY` | no | O (from S1.6) | `lib/adapters/youtube.ts`, `oembed.ts`; unset → RSS-only sync, no view counts, `snapshotStats` skips channel metrics (04 §3.3/§3.5) |
| `CURSEFORGE_API_KEY` | no | O (value pending) | `syncCurseforge`; unset → `sync_runs` row `ok=true, items=0, error='not configured'`, no `sync.failed` (04 §3.2) |
| `CURSEFORGE_MEMBER` | no | O (default = `.env.example` value; read only when `CURSEFORGE_API_KEY` is set) | `lib/adapters/curseforge.ts` |
| `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` | no | O (from S1.5; `NOTIFY_FROM_EMAIL` defaults to `allay@odsens.com`) | `lib/adapters/resend.ts`, `lib/notify/deliver/email.ts`; unset key → rows `failed`, `error='not_configured'` (04 N7) |
| `DISCORD_WEBHOOK_URL` | no | O | seed/fallback for `site_settings.discord_webhook_url`; the DB value wins; read only in `lib/data/settings.ts` |
| `KOFI_PAGE` | no | O (from S1.9) | seed/fallback for `site_settings.kofi_page`; the DB value wins; both read only in `lib/data/settings.ts`; empty → `/support` disabled state (02 §2.7) |
| `KOFI_WEBHOOK_VERIFICATION_TOKEN` | no | — until S2.1 (then R) | `/api/webhooks/kofi` |
| `HASH_SALT` | no | O per 04 C-16 (must be set from S1.3 for `/api/download`; missing → download route returns 500 `internal` and logs) | `lib/hash.ts` only (INV-50) |
| `VERCEL_ENV`, `VERCEL_URL` | no | O (set by Vercel) | `lib/env.ts` env detection |

## 8. Caching, ISR, dynamic

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-38 | Public content pages (`/`, `/projects`, `/projects/[slug]`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support`) MUST be ISR with `export const revalidate = 600` and read via `unstable_cache`/`cacheTag` tagged with the registry tags (`projects`, `project:<slug>`, `videos`, `skins`, `art`, `mentions`, `settings`); routes 02 marks `static` (`/privacy`, `/how-comments-work`) have no data reads and no `revalidate` export; NEVER `no-store`/`force-dynamic`/`cookies()`/`headers()`/`searchParams` on any of these (02 RP-03). | Pages never wait on Modrinth/YouTube at request time (data-model §5). | `grep -rn "export const revalidate" app/page.tsx app/projects app/videos app/skins app/art app/seen-on app/support` == 600 on each; none under `app/privacy app/how-comments-work`; `pnpm build` route table shows `○/●` for all ten and `ƒ` for none; tag names ⊆ registry list | frontend, deploy |
| INV-39 | Session-dependent rendering happens only on `dynamic` routes (`/welcome`, `/profile`, `/admin/**`, `/auth/*`, `/api/**`); on ISR pages the shell NEVER varies by user and session-aware UI (nav sign-in state, `ProfileMenu`, `Composer` enablement, own held comments, mod toggles) is rendered client-side after hydration under RLS via `ViewerProvider`/`CommentThread` (02 RP-01, INV-09). Next PPR is NOT used (Open O-9). | Cached HTML must never contain another user's data; ISR stays ISR. | `grep -rln "cookies()\|headers()\|supabase/server" app \| grep -v "app/(onboarding)\|app/profile\|app/admin\|app/auth\|app/api"` → empty; `grep -n "ppr" next.config.ts` → none | security, frontend |
| INV-40 | Every job/action that changes public content MUST call `revalidateTag` for the affected tags at the end, exactly per 02 §5 (jobs: `projects` + each `project:<slug>` touched; `videos`; `mentions`; settings actions: `settings` (+ `projects` if `comments_closed_default` changed); comment actions: `project:<slug>` of the target; skin/art actions: `skins`/`art`; mention actions: `mentions` + `project:<slug>` if attached). | Stale pages = "why isn't it live". | `grep -n "revalidateTag" lib/jobs/*.ts lib/actions/*.ts` present in each mutating function; deploy-checker sees fresh content after a manual sync | backend, deploy |
| INV-41 | `/api/download/[fileId]` and all cron/auth/webhook routes are dynamic and set `Cache-Control: no-store` (download: `private, no-store`, 04 D6). | Counters and signed URLs must not be cached by CDN. | `grep -n "no-store" app/api/download app/api/cron app/auth` | backend |

## 9. Error handling & logging

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-42 | All server-side logging MUST use `lib/log.ts` exporting `logger.info/warn/error(entry)` (name per 04 C-15), where `entry = { job?: string, action?: string, run_id?: string, msg: string, meta?: Record<string, unknown> }` — exactly one of `job`/`action` set; `run_id` = `sync_runs.id` for jobs/cron/webhooks and the request id (`crypto.randomUUID()`) for Server Actions; the helper adds `level` and `ts` (ISO-8601 UTC) and writes one JSON line to stdout with keys `job|action, run_id, level, msg, meta, ts`; `console.log/error` NEVER used directly outside `lib/log.ts`, `scripts/`, `tests/`. | Vercel logs are searchable; Sentry (S1.10) hooks in one place; 04 C-15 and 05 T-UNIT test the same keys. | `grep -rn "console\.\(log\|error\|warn\)" app lib components middleware.ts` → only `lib/log.ts`; unit test asserts the emitted keys | backend |
| INV-43 | `meta` NEVER contains: email, Google name/picture, `email_hash`, raw IP, request bodies with comment text or files, secrets, webhook URLs, or Storage signed URLs; user references are `profile_id`/`handle` only. | Logs are viewable by David/Oliver and Vercel; no PII in logs (spec §9). | Review `logger.*(` call sites in the diff for those keys; unit test `T-UNIT-*` on `lib/log.ts` redaction of known keys | security |
| INV-44 | Errors surface as: actions → `Err` (INV-19); route handlers → flat JSON `{ ok:false, error:<ErrorCode>, message? }` with the 04 §7 HTTP status and no stack (cron 401 = `{ok:false, error:'unauthorized'}`); pages → `error.tsx` per DESIGN.md §11.3 p.14 (no codes shown); jobs → `sync_runs.error` + `emit('sync.failed')` per 04 J-F. Uncaught exceptions are captured by the log helper (and Sentry after S1.10) with the same shape. | One error shape per surface, all in voice. | Read `app/error.tsx` copy vs DESIGN.md; `grep -n "stack" app/api` → none in responses; route JSON keys ⊆ `{ok, error, message, source, run_id, items, ms, skipped}` | backend, design |

## 10. No-PII rules

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-45 | Client-reachable code (`components/**`, `app/**` pages, `lib/data/**`) NEVER selects from `profiles` for other users, `auth.users`, or any column named `email`, `email_hash`, `full_name`, `raw_user_meta_data`; cross-user reads use `public_profiles` (`id, handle, avatar_path, role`) only, and a user's own row via `getProfile()`/`ViewerProvider`. Copy text containing the word "email" and the `admin_notify_emails` setting UI (INV-48) are allowed; a Supabase select on any `email*` column of `profiles`/`auth.users` is not. | Spec §9: Google identity is never displayed or used. | `grep -rn "from('profiles')\|auth\.users\|email_hash\|raw_user_meta_data\|user_metadata\|\.email\b" components app lib/data` → none (own-row reads are in `lib/auth.ts` and `ViewerProvider` via `public_profiles`) | security, schema |
| INV-46 | `profiles.email_hash` is written only by the `handle_new_user` trigger and read only by server code in `lib/jobs/*`/`lib/actions/*` running as the admin client (S2.1 Ko-fi matching); it NEVER appears in a view, a type exported to a client island, a log, or an API response. | Q33 decision: hashed match, never displayed/stored raw. | `grep -rn "email_hash" components app lib/data lib/auth.ts` → none; view definitions in migrations omit it | security, schema |
| INV-47 | Avatars MUST be re-encoded server-side (`completeOnboarding`/`updateProfile` via `lib/files.ts` `reencodeAvatar()` using `sharp`): decode → `.rotate()` (apply EXIF orientation) → square centre-crop → resize 512×512 → WebP q82 with all metadata (EXIF/ICC/XMP) stripped → upload to `avatars/{profile_id}/{uuid}.webp` (04 C-21); original bytes are never stored. | Photos carry GPS/device metadata; a minor's audience. | `grep -n "sharp\|withMetadata\|rotate()\|webp(" lib/files.ts` — `withMetadata` absent, `.rotate()` + `.webp({quality: 82})` present; test T-ACT-03 asserts 512×512 WebP with no EXIF | security |
| INV-48 | Handles are the only user identity rendered anywhere (pages, emails, Discord embeds, logs, admin tables); admin UI shows "handle + role" for moderators and NEVER Google emails; `site_settings.admin_notify_emails` is entered explicitly and shown only on `/admin/settings` (masked in logs). | Notifications design: "Google emails are never reused silently". | `grep -rn "email" components emails` → only `admin_notify_emails` UI in `NotificationMatrix`/`/admin/settings` and DESIGN.md copy strings | security, design |
| INV-49 | Handle validation MUST be structural only (`^[A-Za-z0-9_]{3,20}$`, unique via citext, no `@`, `RESERVED_HANDLES` = the 04 §1.1 H3 list, minimum `admin, oddsense, odsens, moderator, mod`) enforced in SQL (check constraint + the list inside `check_handle`) and mirrored in `lib/validation/handle.ts` (`handleSchema`, `RESERVED_HANDLES`); the two lists MUST be identical (T-UNIT-01 parity); NEVER a "looks like a real name" heuristic. The `security-check` checklist line "reject obvious real-name patterns" is superseded by Q34 — the gate must not require it (`keep-docs` edits the skill). | Q34 decided. | Read migration for `profiles.handle` check + `check_handle`; `lib/validation/handle.ts` regex + list; T-UNIT-01 green | schema, security |
| INV-50 | `project_downloads.ip_hash`/`ua_hash` are computed only by `lib/hash.ts` per 04 C-17 (`ipHash = sha256hex(ip|utcDay|HASH_SALT)`, `uaHash = sha256hex(ua|HASH_SALT)`); raw IP/UA are never stored or logged; rows are purged after 90 days by `snapshotStats`. | Abuse checks without an IP log of minors' visitors. | `grep -rn "createHash\|createHmac" lib app \| grep -v lib/hash.ts` → none; `grep -n "HASH_SALT" lib` → only `lib/env.ts`, `lib/hash.ts`; job has the purge statement | security, backend |

## 11. Uploads

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-51 | Every upload MUST be initiated and committed by a Server Action (04 §1.4.5): files ≤ 1 MB (avatar, skin texture) travel in the action's `FormData`; larger kinds (`project-files` ≤ 100 MB, `project-media` ≤ 5 MB, `art` ≤ 10 MB) use the two-phase pattern — `begin` action (role check, declared size/extension check, path from `lib/files.ts`, `createSignedUploadUrl` with the service role, token 2 h) → browser PUTs to that one signed URL (`UploadWell` is the only component allowed to call `uploadToSignedUrl`/fetch-to-Storage) → `commit` action re-validates magic bytes, actual size, dimensions and sha512 from the stored object, deletes it on failure, then writes the DB row. The browser never holds a Storage policy broader than that single signed path (data-model §3 "never direct-from-browser with broad policies" holds). | Vercel caps function bodies at 4.5 MB (04 C-18); validation stays server-side. | `grep -rn "createSignedUploadUrl" . --include=*.ts*` → only `lib/files.ts` (called from `lib/actions/uploads.ts`, `lib/actions/art.ts`); `grep -rn "uploadToSignedUrl" components app` → only `components/admin/UploadWell.tsx`; each `commit` calls `validateUpload` before the DB write | security, backend |
| INV-52 | Allowlists and caps are fixed app-wide in `lib/validation/files.ts` (`UPLOAD_KINDS`): `avatar` png/jpg/webp ≤ 1 MB → re-encoded (INV-47); `project-media` png/jpg/webp ≤ 5 MB; `project-file` jar/zip/mrpack (ZIP magic `50 4B 03 04`, extension must match one of the three) ≤ 100 MB, sha512 stored in `project_files.sha512`; `skin` PNG exactly 64×64 ≤ 64 KB, bust render ≤ 512 KB; `art` png/jpg/webp ≤ 10 MB. SVG, GIF, HTML, executables NEVER accepted (04 C-19). `UploadWell` prints the same limits (DESIGN.md §11.1); `supabase/config.toml` `[storage] file_size_limit` and the prod `project-files` bucket limit MUST be ≥ `100MiB` (04 OPEN-10). | One table, printed under every well. | Read `UPLOAD_KINDS`; UI limit copy matches; `grep -n file_size_limit supabase/config.toml` ≥ 100MiB; T-UNIT-17 + T-ACT-52 reject a PNG renamed `.jar` and an SVG | security, design |
| INV-53 | Storage object paths are generated server-side in `lib/files.ts` per 04 C-20/C-21 (`avatars/{profile_id}/{uuid}.webp`, `project-media/{project_id}/{uuid}.{ext}`, `project-files/{project_id}/{version_id}/{filename}` with the filename normalized to `[A-Za-z0-9._-]`, `skins/{skin_id}/texture.png|bust.png`, `art/{art_id}/{uuid}.{ext}`), never taken from the client; `commit` rejects a `path` that does not match the caller's target ids. | Path traversal / overwrite. | Read path builders in `lib/files.ts`; commit path check present | security |
| INV-54 | User-uploaded and remote images are served only via `next/image` with `remotePatterns` restricted to the Supabase project host, `cdn.modrinth.com`, `cdn-raw.modrinth.com`, `i.ytimg.com`, `yt3.ggpht.com`; nothing user-uploaded is ever served inline as HTML/SVG. | Content-type confusion; hotlinking policy. | `cat next.config.ts` `images.remotePatterns` == that list (additions need 02/ADR + §20 CSP edit); `grep -rn "dangerouslyAllowSVG" next.config.ts` → absent | security, frontend |

## 12. Downloads

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-55 | `/api/download/[fileId]` MUST follow 04 §2.3 D1–D7: uuid check; `lib/files.ts` `resolveDownloadable(fileId)` joined to a **published**, not-hidden project with `storage_path` (404 otherwise); per-`ip_hash` limit via `lib/rate-limit.ts` (429 + `Retry-After: 60`); counters + log in **one** RPC `record_download(p_file_id, p_ip_hash, p_ua_hash)`; signed URL `expiresIn: 60`, `download: <filename>`; `302` with `Cache-Control: private, no-store`; the direct download button in `GetItPanel` links to this route, never to a Storage URL. | Data-model §6; backend-robustness "counters once, 60 s". | Read the route; `grep -rn "supabase.co/storage" components` → none; T-ACT-90…94 | backend, security |
| INV-56 | The route is generic (file id → bucket + owner scope in `resolveDownloadable`), not project-hardwired, so P2 `workroom-files` reuses it behind a membership check. | Spec §5c v1 groundwork. | Read `lib/files.ts`: bucket comes from data, not a literal in the route | spec-drift |

## 13. Third-party embeds & scripts

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-57 | YouTube MUST load only from `https://www.youtube-nocookie.com/embed/<id>` inside `VideoFacade` after a click; nothing from YouTube (script, iframe, thumbnail via `youtube.com`) loads before interaction; thumbnails come from `i.ytimg.com` via `next/image`. | Privacy + LCP (design-review #19, DESIGN.md §11.1). | `grep -rn "youtube.com/embed\|youtube.com/iframe_api" components` → none; iframe only inside `VideoFacade` after state change | security, frontend |
| INV-58 | Ko-fi appears only as an iframe (`https://ko-fi.com/<site_settings.kofi_page>/?hidefeed=true&widget=true&embed=true`) inside `KofiPanelSlot` on `/support`, mounted on click of CONTINUE ON KO-FI; the Ko-fi floating-button **script** is NEVER loaded — `FloatingSupportButton` is ours and links to `/support`. | Minimum third-party code; DESIGN.md §11.4 wrapper. | `grep -rn "ko-fi.com" app components lib` → only `KofiPanelSlot`, `AmountPicker` URL builder | security, frontend |
| INV-59 | The only third-party scripts allowed site-wide are `@vercel/analytics` and `@vercel/speed-insights` (mounted once in `app/layout.tsx`); custom events go through `track()` (via `TrackedLink` or direct) with names ⊆ the `TrackedLink` event union in 03 (`download`, `tip_click`, `video_play`, `sign_in`, `external_out`; 04 owns payloads); no GA, PostHog, pixels, or consent banners. | analytics-options decision (1+2+3+4). | `grep -rn "<script\|next/script" app components` → only the two Vercel components; `grep -rn "track(" components lib` names ⊆ the union | security, frontend |
| INV-60 | Third-party marks (Modrinth, CurseForge, YouTube, Ko-fi, TikTok, Twitch, Reddit) are local SVG/PNG in `public/brand/marks/` rendered by `PlatformMark`; no remote logo URLs. | CSP + offline reliability. | `ls public/brand/marks`; `grep -rn "https://.*\.(svg\|png)" components` → none for marks | design, frontend |

## 14. Styling — tokens only, CSS Modules, DESIGN.md names

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-61 | `styles/tokens.css` MUST define every DESIGN.md §1 token verbatim (`--ink … --white`) **plus the derived tokens in 03 §9 with those exact names and values** (`--indigo-hover #5D57E8`, `--disabled-fill #22293A`, `--disabled-text #5D6779`, `--mod-badge-text #CFCCFF`, `--plugin-wash #243040`, `--skeleton-media #1E2938`, `--skeleton-text #1A2432`, `--danger-wash #1A1416`, `--table-divider #1B2531`, `--alert-deep #7A1F14`, `--ink-deep #0A0F16`, `--scrim-92`, `--scrim-35`, `--hatch`), and is the only file containing raw hex/rgba colours; no other colour token may be added without a DESIGN.md edit + `keep-docs`. Radius values are `0` or `3px` only; shadows are `Npx Npx 0 var(--…)` (no blur radius, no `rgba` glows); no gradients except `var(--hatch)`. | DESIGN.md is law; design-fidelity method step 1–3; one owner for derived names (03 §9). | `grep -rEn "#[0-9a-fA-F]{3,8}\|rgba\(" styles components app --include=*.css \| grep -v tokens.css` → none; `grep -rEn "border-radius:" --include=*.css . \| grep -vE "border-radius: *(0\|3px\|var\(--radius-(input\|chip)\))( \|;)"` → none; `grep -rn "blur\|drop-shadow\|linear-gradient" --include=*.css . \| grep -v tokens.css` → none; token names in `tokens.css` == DESIGN.md §1 ∪ 03 §9 | design |
| INV-62 | Styling MUST be CSS Modules (`Name.module.css`) + `styles/globals.css` (reset, base type, focus ring, skip link, `prefers-reduced-motion`); NEVER Tailwind, CSS-in-JS, styled-components, inline `style={{}}` for design values (allowed only for computed geometry like masonry spans/aspect ratios/chart bar heights, 03 C-05), or `!important`. Class names in modules mirror DESIGN.md names in kebab-case (`.type-badge`, `.exclusive-badge`, `.filter-bar`). | framework-decision guardrails. | `grep -rn "tailwind\|styled-components\|@emotion\|@stitches" package.json` → none; `grep -rn "style={{" components app` → only geometry cases annotated `/* geometry */`; `grep -rn "!important" --include=*.css` → none | design, frontend |
| INV-63 | Fonts MUST be self-hosted WOFF2 in `public/fonts/` loaded via `next/font/local` in `app/layout.tsx` (Bungee 400; Space Grotesk 400/500/700; Silkscreen 400/700), `display: 'swap'`, exposed as CSS variables `--font-display`, `--font-ui`, `--font-pixel` (03 §9 names); no `fonts.googleapis.com`/`fonts.gstatic.com` request; emails use the §12.1 fallbacks (Impact/Arial Black, Arial). | DESIGN.md §2 self-host; privacy; CLS. | `ls public/fonts/*.woff2`; `grep -rn "googleapis\|gstatic" app components styles emails` → none; deploy-checker: no font requests to third-party hosts | design, frontend, deploy |
| INV-64 | Pixel art (skins textures, project icons ≤ 64px, avatar in nav) renders with `image-rendering: pixelated` at integer scales; photos/screenshots do not. | DESIGN.md §4/§10. | `grep -rn "image-rendering" components` on `SkinCard`, `Avatar`, icon wells | design |

## 15. Markdown & user text

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-65 | `react-markdown` + `remark-gfm` are imported only in `lib/markdown.ts` (which the `Markdown` Server Component wraps) with: `skipHtml: true` (no `rehype-raw`, ever), `urlTransform` allowing only `http:`, `https:`, `mailto:` (else dropped — covers `javascript:`/`data:`), links rendered `rel="noopener noreferrer nofollow ugc" target="_blank"`, `<img>` rendered only for hosts in the image allowlist (v1 = INV-54 hosts; widening is Open O-10), headings demoted so the page keeps one `h1`; `dangerouslySetInnerHTML` NEVER appears in the repo (except `app/layout.tsx` JSON-LD if 02 adds it). `rehype-sanitize` is not required (nothing to sanitise with `skipHtml`) — 05 T-UNIT-14 asserts the behaviours, not the mechanism (§30). | XSS via Modrinth bodies/admin notes; one sanitizer. | `grep -rln "react-markdown\|remark-gfm" . --include=*.ts* \| grep -v lib/markdown.ts` → empty; `grep -rn "rehype-raw\|dangerouslySetInnerHTML" app components lib` → none; T-UNIT-14 green | security, frontend |
| INV-66 | Comment bodies are **plain text**: server strips any HTML tags on write (`postComment`/`editComment` via `lib/validation/comments.ts` `sanitizeComment()`), enforces ≤ 1000 chars and ≤ 1 URL, and the client renders them as text with `linkify()` from `lib/markdown.ts` (same URL rules as INV-65); markdown is NEVER rendered for comments. | Q35 decided; data-model §2.5. | Read `postComment`; `grep -n "Markdown" components/comments` → none | security, backend |
| INV-67 | Every string shown to users lives in the component/page (no i18n layer) and follows DESIGN.md §7 (no emoji, no exclamation stacking, no error codes); Silkscreen labels ≥ 10 px (≥ 11 px when informational). | Voice is part of the design contract. | design-fidelity voice step on the diff | design |

## 16. Time

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-68 | All timestamps are `timestamptz` written as UTC (`now()` in SQL, `new Date().toISOString()` in TS); `stats_daily.day` is the UTC calendar date; servers never call `toLocaleString` — human formatting happens in `lib/format/*.ts` (`formatDate`, `relativeTime`, `formatCount`; registry addition) using `Intl` with an explicit `timeZone: 'UTC'` on the server and the viewer's zone only inside client islands via `suppressHydrationWarning`. | Cron is UTC; hydration mismatches. | `grep -rn "toLocale" lib app components \| grep -v lib/format/` → none; `grep -rn "timestamp without" supabase/migrations` → none | backend, frontend |

## 17. Rate limiting

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-69 | Rate limits are enforced with **SQL counts** over existing tables (no Redis/KV, no in-memory limiter — 04 C-08); the limited surfaces, counts, windows and counted tables are **exactly 04 §5.5** (v1: `postComment`, `reportComment`, `toggleLike`, `/api/download/[fileId]` per `ip_hash`, `updateProfile` handle change, upload `begin` actions, avatar uploads, `triggerSync` lock; `checkHandle`/`fetchMentionPreview`/`testDiscordWebhook` = none, 04 OPEN-4); every limit runs through one helper `lib/rate-limit.ts` `assertRateLimit(scope, key)` (registry addition) that executes the per-scope count **before** the write; exceeding → `error:'rate_limited'` / HTTP 429 with §7 copy ("Slow down a little."). | security-check "Abuse"; data-model "rate limit in SQL"; one helper, one table of numbers. | `grep -rn "assertRateLimit(" lib/actions app/api/download` present in every 04 §5.5 surface and nowhere else; scopes in `lib/rate-limit.ts` == 04 §5.5 rows; T-ACT-13/21/22/44/93 | security, backend |

## 18. Jobs, idempotency, sync status (see also INV-24/25)

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-70 | `notifyFanOut`/`notifyDeliver` MUST be re-runnable: fan-out inserts `notification_recipients` under the unique index `(event_id, channel, coalesce(address,''))` with `on conflict do nothing` (04 §11), deliver claims rows per 04 N1 (`status='pending'`, `attempts < 5`, backoff), marks `sent`/`failed` with `error`, and sends a single digest per `(channel, address)` group when > 5 rows are eligible; `deliver/<channel>.ts` modules share the 04 N3 `Deliverer` interface and are the only files importing `lib/adapters/resend.ts` / `discord.ts` (plus `testDiscordWebhook`). | notifications.md pipeline. | Read `lib/jobs/notifyDeliver.ts`; `grep -rln "adapters/resend\|adapters/discord" lib \| grep -v notify/deliver` → only `lib/actions/settings.ts` | backend |
| INV-71 | `sync.failed` is **edge-triggered** (04 J-F: emitted only when this run fails and the previous `sync_runs` row for the same `source` has `ok = true` or none exists); `sync.stale` is emitted by `notifyFanOut` step 0 (04 J-S) for each source with no `sync_runs.ok=true` in 6 h, at most once per 6 h per source (dedupe on the last `sync.stale` event with `subject_id = source`). | Oliver learns about broken syncs from the allay, not from stale pages. | Read `lib/jobs/*` + `notifyFanOut`; T-ADP-63 | backend |
| INV-72 | `triggerSync` (`lib/actions/sync.ts`) MUST call the same `lib/jobs/*` function as the cron route (never a copy, never internal HTTP) and rely on the 04 C-13 lock (`conflict` while running). | One code path. | `grep -n "lib/jobs" lib/actions/sync.ts` present; `grep -n "fetch(" lib/actions/sync.ts` → none | backend |
| INV-73 | `renderSkinBust` writes `skins.render_bust_path`; if the render fails the skin still saves and `SkinCard` falls back to the client viewer — the action never fails on render errors. | data-model §5 fallback. | Read `createSkin`/`updateSkin` | backend |

## 19. Feature flags (Phase 2 surfaces in a v1 build)

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-74 | Phase 2 surfaces are gated by compile-time constants in `lib/flags.ts` (`FLAGS = { commissions: false, workrooms: false, leaderboard: false, kofiWebhook: false, suggestedMentions: false, inAppNotifications: false } as const`); `FLAGS.commissions` is the only value ever passed as `Nav`'s / `Footer`'s `commissionsEnabled` prop (03) so the "Commissions" nav item and footer "Custom orders" appear only when true (DESIGN.md §12.2 + pass-3 build note); `Leaderboard` renders its empty state ("NOBODY YET / Be first.") when `!FLAGS.leaderboard`; `NotificationMatrix` renders P2 rows greyed 45 % (COMING LATER) regardless. Flags flip only in the slice that ships the feature, with the doc edit. | Nav/footer designed with P2 items; v1 hides them. | `cat lib/flags.ts`; `grep -rn "commissionsEnabled=" app components` → only `app/layout.tsx` with `FLAGS.commissions`; e2e asserts no "Commissions" link in v1 | spec-drift, design |
| INV-75 | Phase 2 routes (`/commissions`, `/workrooms/[id]`, `/api/webhooks/kofi`, `/profile/orders`, `/admin/orders`) do NOT exist in the v1 tree (no placeholder pages, no 404 stubs beyond the global one). | Nothing half-built is reachable. | `ls app/commissions app/workrooms app/api/webhooks app/profile/orders app/admin/orders` → absent until S2.x | spec-drift |

## 20. Security headers & CSP baseline

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-76 | `next.config.ts` `headers()` MUST send on every route: `Content-Security-Policy` (below), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`; `/admin/**`, `/welcome`, `/profile` and `/api/**` additionally `X-Robots-Tag: noindex, nofollow`. | security-check "Secrets & headers". | `curl -sI <preview>/ \| grep -i "content-security-policy\|x-content-type\|referrer\|x-frame\|permissions-policy\|strict-transport"` all present; deploy-checker | deploy, security |
| INV-77 | CSP baseline (v1) is exactly the directive set below; any new host/directive needs an ADR + this table edited. | Allowlist is the contract. | Diff header string vs table | security, deploy |

CSP baseline (one line in `next.config.ts`; `<supabase-host>` = `dllbekulbimblrsrxuyv.supabase.co` in prod, the branch host in preview — built from `NEXT_PUBLIC_SUPABASE_URL` at config time):

| Directive | Value |
|---|---|
| `default-src` | `'self'` |
| `script-src` | `'self' 'unsafe-inline'` (Next.js inline bootstrap; strict nonces are incompatible with ISR — see Open O-2); dev adds `'unsafe-eval'` |
| `style-src` | `'self' 'unsafe-inline'` (next/font + React inline geometry) |
| `img-src` | `'self' data: blob: https://<supabase-host> https://cdn.modrinth.com https://cdn-raw.modrinth.com https://i.ytimg.com https://yt3.ggpht.com` |
| `font-src` | `'self'` |
| `connect-src` | `'self' https://<supabase-host> wss://<supabase-host> https://vitals.vercel-insights.com https://va.vercel-scripts.com` (Storage signed-upload PUT and browser RLS reads both target `<supabase-host>`) |
| `frame-src` | `https://www.youtube-nocookie.com https://ko-fi.com` |
| `media-src` | `'self' blob:` |
| `worker-src` | `'self' blob:` (skinview3d/canvas crop) |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |
| `form-action` | `'self' https://<supabase-host> https://accounts.google.com` (sign-in form → Supabase OAuth → Google) |
| `frame-ancestors` | `'none'` |
| `upgrade-insecure-requests` | (present in preview/prod) |

## 21. Dependency policy

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-78 | Allowed runtime dependencies (v1): `next`, `react`, `react-dom`, `typescript`, `zod`, `@supabase/supabase-js`, `@supabase/ssr`, `react-markdown`, `remark-gfm`, `skinview3d`, `resend`, `@react-email/components` (+ `react-email` dev), `@vercel/analytics`, `@vercel/speed-insights`, `sharp` (server, avatar/bust re-encode), `server-only`, `@sentry/nextjs` (S1.10). Dev: `eslint` + `eslint-config-next` + `@typescript-eslint/*`, `prettier`, `vitest`, `@playwright/test`, `@axe-core/playwright`, `supabase` CLI (brew, not npm). Anything else needs an ADR before `pnpm add`. | Small, legible surface for Oliver; bundle discipline. | Diff `package.json` deps against this list | spec-drift, frontend |
| INV-79 | NEVER: Tailwind or any utility CSS, UI kits (MUI/Chakra/shadcn/Radix themes), CSS-in-JS, chart libs (chart.js/recharts/d3), date kitchen sinks (moment/dayjs/date-fns), lodash/underscore, axios, form libs (react-hook-form/formik), state libs (redux/zustand/jotai), tRPC/Prisma/Drizzle, `rehype-raw`, `dompurify` (not needed with `skipHtml`). | framework-decision; hand-rolled `FlatBarChart` (SVG). | `grep -E "tailwind|@mui|@chakra|@radix-ui|styled|emotion|chart|recharts|d3|moment|dayjs|date-fns|lodash|axios|react-hook-form|formik|redux|zustand|jotai|trpc|prisma|drizzle|rehype-raw|dompurify" package.json` → none | spec-drift |
| INV-80 | Any client-side dependency > 50 KB gzipped (skinview3d is the one pre-approved exception and is lazy) requires an ADR that states the route-level bundle delta from `pnpm build`; the frontend gate blocks without it. | web-quality stop-and-ask. | `pnpm build` route table + ADR present | frontend |
| INV-81 | Dependencies are pinned by `pnpm-lock.yaml`; `upkeep` bumps in their own PR (one major per PR); no `postinstall` scripts from new deps without review (`pnpm` `onlyBuiltDependencies` allowlist: `sharp`, `esbuild`, `@parcel/watcher` if present). | Supply chain. | `cat pnpm-workspace.yaml`/`package.json#pnpm.onlyBuiltDependencies` | security |

## 22. TypeScript strictness

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-82 | `tsconfig.json` MUST set `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `forceConsistentCasingInFileNames: true`, `isolatedModules: true`, `moduleResolution: "bundler"`, `paths: {"@/*": ["./*"]}`; `pnpm typecheck` (`tsc --noEmit`) runs inside `pnpm lint` (05 CI-1) and is also a standalone script (00 DoD-2). | Catch nulls at compile time; Oliver gets red squiggles, not runtime 500s. | `cat tsconfig.json`; `package.json#scripts.typecheck` present; CI-1 includes `tsc --noEmit` | spec-drift, frontend |
| INV-83 | `any` NEVER appears (`@typescript-eslint/no-explicit-any: error`); external JSON (adapters, webhooks, form data) is parsed with zod schemas in `lib/adapters/<source>.ts` / `lib/actions/*` before use; DB rows use generated `Database` types (`Tables<'projects'>`). | Unknown-in, typed-out. | `grep -rn ": any\|as any\|<any>" lib app components` → none; each adapter exports its zod schemas | backend, frontend |

## 23. Lint rules that encode invariants

`eslint.config.mjs` (flat config, `eslint-config-next` + `@typescript-eslint`) MUST contain these rules; a gate treats a disabled rule (`eslint-disable` comment) touching them as ❌ unless an ADR names it.

| ID | Rule (as configured) | Encodes |
|---|---|---|
| INV-84 | `no-restricted-imports` — `@/lib/supabase/admin` allowed only in `lib/actions/**`, `lib/jobs/**`, `lib/notify/**`, `lib/files.ts`, `lib/rate-limit.ts`, `lib/data/settings.ts`, `app/api/**` (use ESLint `files` overrides: the restriction applies everywhere else) | INV-14 |
| INV-85 | `no-restricted-imports` — `@supabase/supabase-js`, `@supabase/ssr` allowed only in `lib/supabase/**`; `@/lib/supabase/client` allowed only in `components/accounts/ViewerProvider.tsx`, `components/comments/CommentThread.tsx`, `components/primitives/GoogleSignInButton.tsx`, `components/admin/AdminGate.tsx`; `@/lib/supabase/server` banned in `components/**` | INV-13, INV-09 |
| INV-86 | `no-restricted-imports` — `react-markdown`, `remark-gfm` allowed only in `lib/markdown.ts`; `rehype-raw` banned everywhere | INV-65 |
| INV-87 | `no-restricted-imports` — `@/lib/env` banned in `components/**` and `'use client'` files (they import `publicEnv` from `@/lib/env/public`) | INV-35/INV-29 |
| INV-88 | `no-restricted-syntax` — `MemberExpression[object.name='process'][property.name='env']` outside `lib/env.ts`, `lib/env/public.ts`, `next.config.ts`, `tests/**`, `scripts/**` | INV-35 |
| INV-89 | `no-console` (allow: none) outside `lib/log.ts`, `scripts/**`, `tests/**` | INV-42 |
| INV-90 | `react/no-danger` (`dangerouslySetInnerHTML`) → error | INV-65 |
| INV-91 | `@typescript-eslint/no-explicit-any` → error; `@typescript-eslint/no-floating-promises` → error (actions/jobs must await writes and revalidations) | INV-83, INV-18 |
| INV-92 | `@next/next/no-img-element` → error (use `next/image`); `@next/next/no-page-custom-font` + custom rule/grep for `googleapis` | INV-54, INV-63 |
| INV-93 | `no-restricted-properties` — `Date.prototype.toLocaleString/toLocaleDateString/toLocaleTimeString` outside `lib/format/**` | INV-68 |
| INV-94 | Client-boundary check: the repo script `scripts/check-client-islands.mjs` (registry addition; runs inside `pnpm lint`) parses `docs/build/03-components.md` §2 tables (S/C cell starts with `` `C` `` → the row's `<Name>` and any `<Name>.<Part>` named as a client leaf in that cell) and fails when a `'use client'` file under `app/`, `components/`, `lib/` is not in that set ∪ {`app/error.tsx`, `app/global-error.tsx`, `app/**/error.tsx`}. No ESLint plugin is used for this. | INV-08 |

## 24. CI gates (summary; details in 05)

`pnpm lint` (05 CI-1 = eslint INV-84–93 + prettier + `tsc --noEmit` INV-82 + `scripts/contrast.mjs` INV-61 + `scripts/check-fixtures.mjs` + `scripts/check-test-ids.mjs` + `scripts/check-client-islands.mjs` INV-94) · `pnpm test:unit` · `pnpm test:db` (RLS matrix, INV-28) · `pnpm build` + `scripts/check-bundle-secrets.mjs` (INV-29) + route-table check (INV-38/39) · `pnpm test:e2e` (+ axe). All required for merge; gate agents run in parallel per `build-phase` §4. (`pnpm typecheck` also exists as a standalone script for 00 DoD-2.)

## 25. Change control

| ID | Statement | Rationale | Check | Gate |
|---|---|---|---|---|
| INV-95 | Any code that contradicts an INV, a registry name, `docs/data-model.md`, or `DESIGN.md` MUST ship with an ADR (`docs/build/06-decisions/ADR-<nnnn>-<slug>.md`, template there) that names the doc it amends **and** the doc edit, in the same PR; the ADR number is the next sequential one (ADR-0001 is the accepted baseline). | build-phase 2b; spec-drift step 8. | `ls docs/build/06-decisions` diff vs `git log`; PR body cites the ADR | spec-drift |
| INV-96 | Registry names (routes, components, actions, jobs, tables, event kinds, tags) are used verbatim in code; a new name is added to `_registry.md` in the same PR before use. | Every doc, PR, and gate uses the same words. | Diff exported/route names vs `_registry.md` | spec-drift |

## 26. Phase 2 stubs (bind when the slice starts)

- **S2.1 Ko-fi webhook** — `/api/webhooks/kofi` follows INV-22/27; `kofi_events` insert idempotent on `kofi_message_id`; `email_hash` match runs only in `lib/jobs/*` with the admin client (INV-46); leaderboard reads a view exposing `handle, amount` only; `FLAGS.kofiWebhook/leaderboard` flip.
- **S2.2 Custom Orders** — `orders` behind `requireOnboarded()`; intake is a Server Action with INV-18/69; admin "REPLY BY EMAIL": the address is never rendered as text; the `mailto:` href is emitted only on the admin (dynamic, noindex) page — decide at S2.2 whether to proxy via a server route instead (OPEN, O-11); `FLAGS.commissions` flips (nav item appears).
- **S2.3 Workrooms** — RLS keyed on `workroom_members`; `workroom-files` private, downloads via the generic INV-55/56 route + membership check; client uploads reuse the INV-51 two-phase pattern with kind `workroom` (types/limits per data-model §2.7b, pending Q45); admin auto-member trigger; `notification_prefs` opt-in; `/privacy` copy update (Q43).
- **S2.4 Suggested mentions** — new cron follows INV-23–26; inserts `status='suggested'` only; never publishes.
- **S2.5 In-app notifications** — reads `notification_recipients` channel `inapp`; `--alert` badge; no new invariants expected.

## 27. Gate mapping (INV → owning gate agent)

Rule: every INV has exactly one primary owner; secondary agents may also cite it.

| Gate agent | Owns (primary) | Also checks (secondary) |
|---|---|---|
| `spec-drift-reviewer` | INV-01, 02, 03, 04, 06, 07, 12, 17, 21, 56, 74, 75, 78, 79, 82, 95, 96 | INV-08, 13 |
| `security-reviewer` | INV-13, 14, 15, 20, 23, 27, 29, 30, 31, 32, 33, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 57, 58, 59, 65, 66, 69, 76, 77, 81 | INV-09, 18, 34, 39, 42 |
| `frontend-reviewer` | INV-08, 09, 10, 11, 38, 39, 62, 63, 80, 84–94 (lint config present) | INV-03, 54, 57, 58, 59, 60, 65, 68, 82, 83 (client code) |
| `backend-reviewer` | INV-05, 16, 18, 19, 22, 24, 25, 26, 35, 36, 40, 41, 42, 44, 68, 70, 71, 72, 73, 83 | INV-04, 17, 21, 50, 55, 66, 69 |
| `supabase-reviewer` | INV-28, 34, 97 | INV-06, 15, 16, 33, 45, 46, 49 |
| `design-fidelity-reviewer` | INV-60, 61, 64, 67 | INV-02, 11, 19, 44, 48, 52, 62, 63, 74 |
| `deploy-checker` | INV-37 | INV-07, 22, 23 (cron ping), 29 (bundle grep on deployment), 34, 36, 38 (revalidate/route table), 40, 41, 63 (font hosts), 76, 77 |

## 28. Registry additions (to be added to `_registry.md`; not edited here)

| Kind | Name | Used by |
|---|---|---|
| Module | `lib/data/<area>.ts` (read layer: `projects.ts`, `videos.ts`, `skins.ts`, `art.ts`, `mentions.ts`, `comments.ts`, `settings.ts` (incl. `getPublicSettings()`), `stats.ts`, `profiles.ts`) | INV-12, 15 |
| Module | `lib/supabase/anon.ts` (`createAnonClient()` — anon key, no cookies) | INV-13, 15 |
| Module | `lib/log.ts` (`logger.info/warn/error`) | INV-42 |
| Module | `lib/flags.ts` (`FLAGS`) | INV-74 |
| Module | `lib/validation/{handle,files,comments}.ts` (`handleSchema`, `RESERVED_HANDLES`, `sniffMime`, `UPLOAD_KINDS`, `validateUpload`, `sanitizeComment`; 04's `lib/handles.ts` and 01 v0.1's `lib/uploads.ts` fold in here) | INV-49, 52, 66 |
| Module | `lib/files.ts` (storage path builders, `createSignedUploadUrl`/`createSignedUrl` wrappers, `reencodeAvatar`, `resolveDownloadable`) — 04 §11 | INV-47, 51, 53, 55 |
| Module | `lib/hash.ts` (`sha256hex`, `emailHash`, `ipHash`, `uaHash`) — 04 §11 | INV-50 |
| Module | `lib/rate-limit.ts` (`assertRateLimit(scope, key)`; scopes = 04 §5.5 rows) | INV-69 |
| Module | `lib/format/*.ts` (`formatDate`, `relativeTime`, `formatCount`) | INV-68 |
| Module | `lib/actions/result.ts` (`Ok<T>`, `Err`, `ErrorCode`, `Issue`) — 04 §11 | INV-19 |
| Module | `lib/env/public.ts` (`publicEnv`, client-safe) | INV-35, 87 |
| Module | `lib/notify/emit.ts` (`emit(kind, …)`) — 04 §11 | INV-21 |
| Component | `ViewerProvider` + `useViewer()` (`components/accounts/ViewerProvider.tsx`, client; mounted in `app/layout.tsx`; the RP-01 seam) | INV-09, 39 |
| SQL function | `public.record_download(p_file_id, p_ip_hash, p_ua_hash)` (04 §11) | INV-55 |
| SQL trigger fns | `handle_new_user()`, `set_updated_at()` | INV-97 |
| Script | `scripts/check-client-islands.mjs` (in `pnpm lint`; 05 CI-1 to list it) | INV-94 |
| Files | `middleware.ts`, `next.config.ts`, `eslint.config.mjs`, `.nvmrc`, `app/global-error.tsx`, `app/robots.ts`, `app/sitemap.ts` | INV-30, 76, 84, 07, 11, 03 |
| Assets | `public/brand/marks/` (third-party marks) | INV-60 |
| Env var | `HASH_SALT` (04 §11; replaces v0.1's `HASH_SECRET` and 00's `IP_HASH_SALT`) | INV-50 |
| Tokens | derived tokens exactly as 03 §9 (`--indigo-hover`, `--disabled-fill`, `--disabled-text`, `--mod-badge-text`, `--plugin-wash`, `--skeleton-media`, `--skeleton-text`, `--danger-wash`, `--table-divider`, `--alert-deep`, `--ink-deep`, `--scrim-92`, `--scrim-35`, `--hatch`) | INV-61 |
| Analytics events | `download`, `tip_click`, `video_play`, `sign_in`, `external_out` (03 `TrackedLink` union; 04 owns payloads) | INV-59 |
| Error code | `rate_limited` (04 §7 owns the full `ErrorCode` union) | INV-69 |

## 29. Open (OPEN — proposed defaults, decide before freeze)

| # | Item | Proposed default |
|---|---|---|
| O-1 | Node version: `docs/framework-decision.md` says 22 LTS, `docs/dev-tooling.md` + Vercel project say 24.x. | Pin **24** in `.nvmrc`/`engines` (matches Vercel + David's machine); `keep-docs` updates framework-decision. |
| O-2 | CSP `script-src` uses `'unsafe-inline'` because nonce-based CSP forces every page dynamic and breaks ISR (INV-38). | Accept for v1 (no HTML injection paths exist: INV-65/66); revisit hash-based CSP post-launch. Record as the next sequential ADR (`ADR-000n-csp-unsafe-inline.md`) at S0 if accepted. |
| O-3 | `HASH_SALT` handling (INV-50): 04 C-16 lists it optional; the download route cannot hash without it. | Treat as required from S1.3 in `lib/env.ts` (throw at boot once S1.3 ships); 04 C-16 / 05 T-UNIT-16 to move it to the required list at S1.3. |
| O-4 | Rate limits with no natural table (`checkHandle`, `fetchMentionPreview`, `testDiscordWebhook`). | Owned by 04 OPEN-4 (none in v1; all auth-gated); no `rate_limit_hits` table in v1. |
| O-5 | Cron `maxDuration`: 02 RP-16 says 60, 04 C-12 says 300 (Pro; 60 if unsupported). | 60 (works on every plan; INV-23); raise per-route to 300 by ADR if a job measurably needs it and the plan supports it; 04 C-12 to align. |
| O-6 | Non-YouTube mention thumbnails (`mentions.thumbnail_url` from OG tags) come from arbitrary hosts, violating INV-54/CSP `img-src`. | v1: render the platform mark placeholder for non-allowlisted hosts (no remote fetch); revisit a server-side thumbnail cache into `project-media` later. |
| O-7 | Upload-well design copy says "The limit is 50." while data-model caps project files at 100 MB; local `config.toml` `file_size_limit` is 50MiB. | Copy prints the real cap from `UPLOAD_KINDS` (100 MB); raise `config.toml` + prod bucket to 100MiB (04 OPEN-10; INV-52 check). |
| O-8 | ISR page reads for tables without a public RLS policy (`site_settings`). | `lib/data/settings.ts` `getPublicSettings()` admin-client carve-out (INV-15) — vs. a `site_settings_public` view (schema change; `supabase-ops` to decide at S1.1). |
| O-9 | Next PPR (partial prerendering) as an alternative to client-side session reads (02 O-1). | Not used in v1 (INV-39); enabling PPR requires an ADR that rewrites INV-09/39. |
| O-10 | Markdown `<img>` host allowlist (INV-65): Modrinth bodies commonly embed images from GitHub/imgur; with the INV-54 list they degrade to plain links. | v1 default = INV-54 hosts; widening (e.g. `raw.githubusercontent.com`, `i.imgur.com`) needs one ADR that edits INV-54, INV-65 and the CSP `img-src` row together. |
| O-11 | S2.2 "REPLY BY EMAIL": `mailto:` href on the admin page vs. server-side proxy route. | Decide at S2.2 (§26). |

## 30. Review notes (v0.2 — findings applied, declined, or pushed to siblings)

Applied (blocker/major): four-client model + `createAnonClient()` and the RP-01 client-read seam (INV-09/13/15/39; PPR → O-9); two-phase signed uploads (INV-51); action shapes/names deferred to 04 (INV-18/19/32; §0 precedence line); client-island list owned by 03 §2 (INV-08/94; `error.tsx` files exempt; INV-10 trimmed to `SkinViewer3D`/`Lightbox`); derived tokens per 03 §9 (INV-61); `lib/hash.ts` + `HASH_SALT` (INV-50, env matrix, O-3); INV-45 grep narrowed; INV-69 defers to 04 §5.5 (SQL function `rate_limit_ok` dropped); INV-22 `/api/og` edge exception, INV-23 responses/schedules per 04; INV-24 purge exception; INV-38 static pages; INV-42 logger shape/name; env matrix aligned to 04 C-16 (+ `HASH_SALT`, `KOFI_PAGE` precedence, CLI-only rows); §1 tree union + INV-03/05/06/12 checks; hedged rules resolved (INV-02/47/49/70/87/94, O-8); INV-97 schema conventions; INV-71 per 04 J-F/J-S; INV-30 exception list; INV-72 `lib/actions/sync.ts`; §24 CI per 05 CI-1; INV-54/CSP add `cdn-raw.modrinth.com`; INV-21 `emit(` check; INV-74 prop check; INV-59 `external_out`; INV-61 grep syntax; INV-31/32 wording; INV-52 config.toml; O-2 ADR numbering; gate mapping (every INV one primary; INV-60/02 assigned; duplicate 74 removed).

Declined / narrowed (with reason):
- **`rehype-sanitize` (05 T-UNIT-14)** — not adopted: with `skipHtml: true` + `urlTransform` there is no HTML to sanitise; INV-78 stays closed. 05 should read T-UNIT-14's "(rehype-sanitize schema)" as the behaviours listed (script/iframe removed, `javascript:`/`data:` hrefs dropped, image host allowlist), which INV-65 satisfies.
- **INV-15 admin client on ISR pages** — 02 §0.1 allows "admin client restricted to published/public views"; 01 narrows this to one function (`getPublicSettings()`) because every other public read has an RLS policy (data-model §4) and should exercise it. 02 §0.1 to reference INV-15.
- **INV-29 grep list** — kept as a superset of 05 CI-4 (adds `sb_secret`, `DISCORD_WEBHOOK`, `GOOGLE_OAUTH`, `HASH_SALT`); superset ≠ conflict. 05 CI-4 may adopt the longer list.
- **INV-36 `CURSEFORGE_MEMBER`, `SUPABASE_URL`/`SUPABASE_ANON_KEY`** — 04 C-16 omits them; 01 marks them optional / CLI-only rather than asking 04 to add required vars.

Asks to sibling docs (no ADR needed; consistency edits):
- 02: §0.1 ISR reads → `createAnonClient()` + `getPublicSettings()`; RP-16 `maxDuration` matches O-5 (60); §1.4 cron minutes → 04 §6 offsets (:07/:17/:27/:37); §2.10 401 body already matches INV-44.
- 03: `Nav`/`CommentThread` `viewer` props are `null` on ISR pages — client leaves (`Nav.Menu`, `ProfileMenu`, `CommentThread`) take viewer state from `useViewer()`; add `ViewerProvider` row (registry addition here); C-17 exception list = INV-09's; C-18 unchanged.
- 04: C-12 `maxDuration` → 60 (O-5) and 401 body → `{ok:false, error:'unauthorized'}`; `lib/handles.ts` → `lib/validation/handle.ts`; C-16 `HASH_SALT` required from S1.3 (O-3); C-15 log entry gains `run_id` for actions = request id.
- 05: CI-1 adds `scripts/check-client-islands.mjs`; T-UNIT-16 required list gains `HASH_SALT` from S1.3; T-ACT-3 avatar path = `avatars/{profile_id}/{uuid}.webp` (drop "or png/jpg"); RA-8 `RESERVED_HANDLES` path = `lib/validation/handle.ts` (already consistent).
- 00: `IP_HASH_SALT` → `HASH_SALT`; reserved slug `ADR-0001-branching-preview-env.md` → next free number; DoD-2 note that `pnpm typecheck` also runs inside `pnpm lint`.
- `security-check/SKILL.md`: drop "reject obvious real-name patterns" (Q34) — `keep-docs`.
