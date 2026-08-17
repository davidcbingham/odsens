# Server Contracts
Purpose: the checkable contract for every Server Action, route handler, cron job, and external adapter in `_registry.md` §Server contract registry — names, files, auth, input schema, preconditions, effects, return shape, rate limits, idempotency, external calls, logging, and required tests — so gate agents can diff code against it.
Status: **v1.0 — FROZEN 2026-08-17** (changes only via ADR + doc edit in the same PR; `spec-drift-reviewer` enforces)

Decisions applied: `06-decisions/ADR-0002-spec-reconciliation.md` (binding — C1–C22 + OPEN defaults 13–80); every OPEN item below that ADR-0002 settles is marked **DECIDED (ADR-0002 <ref>)**.

Sources (binding, in this order when they conflict): `docs/build/_registry.md` · `docs/data-model.md` · `docs/notifications.md` · `docs/spec.md` / `docs/questions.md` · `docs/platform-audit.md` · `DESIGN.md` v1.3 · `.claude/skills/{backend-robustness,security-check,supabase-ops,vercel-ops}/SKILL.md` · `.env.example`. Schema/RLS shapes are owned by `01-architecture.md` + `docs/data-model.md`; page behaviour by `02-routes-and-pages.md`; UI by `03-components.md`; test IDs by `05-test-plan.md` (00 rule 0.5). This doc only *references* those. Where this doc and a sibling (01/02/03/05) stated the same fact differently, ADR-0002 settled it (04 owns names/shapes; 03 component names + S/C; 02 route rendering; data-model RLS) and every doc was amended in the same PR; §11.2 keeps the residual sibling lines that still cite this doc.

Contents: §0 Conventions (SC-01…SC-25) · §1 Server Actions · §2 Route handlers · §3 Jobs · §4 Adapters · §5 Decision tables (+ §5.6 analytics events, §5.7 Ko-fi handoff, §5.8 operational defaults) · §6 vercel.json cron table · §7 Error codes · §8 Tests map (04 → 05 IDs) · §9 Phase 2 stubs · §10 Open (all DECIDED by ADR-0002) · §11 Registry (folded) + sibling amendments + tests map · §12 Review notes

---

## 0. Conventions (apply to every contract below; IDs `SC-nn` — distinct from 03's `C-nn`)

| # | Rule (yes/no checkable) |
|---|---|
| SC-01 | Server Actions live in `lib/actions/<area>.ts` (`accounts.ts`, `comments.ts`, `settings.ts`, `projects.ts`, `uploads.ts`, `skins.ts`, `art.ts`, `mentions.ts`, `videos.ts`, `admin.ts`; shared types in `result.ts`) and are marked `'use server'`. Route handlers live under `app/api/**/route.ts` and `app/auth/**/route.ts` (`/auth/callback` GET, `/auth/sign-out` POST — there is no `/auth/sign-in` route, ADR-0002 C3). Jobs live in `lib/jobs/<name>.ts`. Adapters live in `lib/adapters/<name>.ts`. Deliverers live in `lib/notify/deliver/{email,discord}.ts`. `triggerSync` lives in `lib/actions/admin.ts` (01 INV-72 grep target; ADR-0002 C16). |
| SC-02 | Every action's input is parsed with a zod schema exported from the same file as `<actionName>Input` (01 INV-18; ADR-0002 C16) — e.g. `postCommentInput`. Parsing failure → `{ok:false, error:{code:'validation', message, issues:[{path,message}]}}` — issues are plain-language, no zod internals. |
| SC-03 | Return shape of every action (01 INV-19, types in `lib/actions/result.ts`): `ActionResult<T> = {ok:true, data:T} \| {ok:false, error:{code: ActionErrorCode, message: string, field?: string, issues?: {path:string, message:string}[]}}`. `ActionErrorCode` = the §7 union. Actions **never throw** to the client; unexpected exceptions are caught, logged (SC-15), and returned as `error.code='internal'`. Route handlers return the same JSON `{ok:false, error:{code, message}}` with 4xx/5xx (01 INV-44; ADR-0002 C14 — incl. cron 401 and the download route's 429 + `Retry-After: 60`). In this doc "Errors: `x`, `y`" means `error.code ∈ {x, y}`. |
| SC-04 | Auth is resolved with `lib/auth.ts` (01 INV-32) → **`getViewer()`** (built on `getUser()`; returns `{user, profile} \| null` — the one call pages/actions use to know who is asking — ADR-0002 A15), `getUser()` (anon → `null`), `getProfile()`, `requireUser()` (→ `unauthenticated`), `requireOnboarded()` (handle null → `onboarding_required`), `requireRole('moderator'\|'admin')` (→ `forbidden`), `safeNext(next)` (02 RP-20). **No `getSession()` export** (ADR-0002 A15) — session refresh is `middleware.ts`'s job (01 INV-32); nothing else needs the raw session. Role order: `user < moderator < admin`. Every admin/moderator action calls `requireRole` server-side even though RLS also enforces it (defense in depth). The export set is exactly `getViewer, getUser, getProfile, requireUser, requireOnboarded, requireRole, safeNext` (= 01 INV-32 + ADR-0002 A15; `_registry.md` Modules `auth.ts` names `safeNext` as the S0 export — the rest land in S1.1). Roles are bootstrapped by SQL (local `seed.sql`; one documented SQL for prod after first sign-in) until `/admin/settings` ships whole in S1.5 (ADR-0002 C2, #23). Role split per ADR-0002 C7: **admin** for curation/sync/media/mentions/videos/skins/art/exclusives/settings; **moderator** for comment moderation only. |
| SC-05 | Banned check: any action that inserts on behalf of a user (`postComment`, `editComment`, `toggleLike`, `reportComment`) returns `error.code='banned'` when `profiles.is_banned = true`, before touching the DB. |
| SC-06 | DB clients: user-scoped actions use `lib/supabase/server.ts` (anon key + cookie session, RLS enforced). Admin/moderator content mutations, uploads, jobs, route handlers, and the download route use `lib/supabase/admin.ts` (service role) **only after** the role/secret check in the same function. The service-role client is never imported from a file under `components/` or any `'use client'` module (01 INV-14). |
| SC-07 | Revalidation: after a successful write, call `revalidateTag(tag)` for every tag listed in the contract; tags are exactly the registry set `projects`, `project:<slug>`, `videos`, `skins`, `art`, `mentions`, `settings`. `revalidatePath` is not used (02 RP-22). |
| SC-08 | Rate limits are enforced in SQL (01 INV-69): `lib/rate-limit.ts` `assertRateLimit(scope, key, max, window)` → `rpc('rate_limit_ok', {scope, key, max, window})`, called **before** the write; `rate_limit_ok` counts **only `rate_limit_hits (scope, key, ts)`** over the window — never a domain table (ADR-0002 A4; data-model §2.10; table + RPC `rate_limit_ok` + `purge_rate_limit_hits` created in S1.1 — ADR-0002 #14) — and **every rate-limited action/route records a hit**: `assertRateLimit` inserts one `rate_limit_hits` row on success for every scope in §5.5 (a hit is recorded even when the write that follows fails). No in-memory limiter. Exceeding → `error.code='rate_limited'` (actions) or HTTP 429 (route handlers). Windows are stated per contract as `count / window / scope`. |
| SC-09 | Every external HTTP call goes through `lib/adapters/http.ts` → `fetchJson(url, {timeoutMs:10000, retries:3, ua})`: `AbortSignal.timeout(10000)` (**10 s**); retry on HTTP 429/5xx and network errors, backoff 1 s → 2 s → 4 s (honour `Retry-After` / `X-Ratelimit-Reset` if larger, capped at 30 s), **max 3 retries**; 4xx other than 429 is not retried; final failure throws `AdapterError {status, code, body(≤300)}`. |
| SC-10 | User-Agent for every outbound call = `MODRINTH_USER_AGENT` env value (`odsens.com/<version> (david@studiobing.com)`), also sent to CurseForge/YouTube/OG fetches. |
| SC-11 | Every job writes exactly one `sync_runs` row per invocation: insert `{source, started_at}` at start; update `{finished_at, ok, items, error}` at end **on every path including thrown errors** (try/finally). `error` ≤ 2000 chars, never contains secrets. |
| SC-12 | Cron route handlers (`app/api/cron/*/route.ts`): `GET` only (`POST`/`HEAD`/others → 405); `export const dynamic = 'force-dynamic'`; `export const runtime = 'nodejs'` (01 INV-22); `export const maxDuration = 300` for `sync-modrinth`, `sync-curseforge`, `sync-youtube`, `refresh-mentions`, `stats-snapshot` and `maxDuration = 60` for `notify` (Vercel Pro — spec §7 "Vercel (paid)"; ADR-0002 C15). Require `Authorization: Bearer ${CRON_SECRET}` compared with `crypto.timingSafeEqual` (length-checked first) → else HTTP 401 `{ok:false, error:{code:'unauthorized', message:'Nope.'}}` with no side effects. Success → HTTP 200 JSON `JobSummary` (§3); failure → HTTP 500 `{ok:false, source, run_id, error:{code:'job_failed', message}}` (still logged in `sync_runs`). |
| SC-13 | Job concurrency lock: a job returns `{ok:true, skipped:'running'}` (HTTP 200) without doing work if a `sync_runs` row for the same `source` has `finished_at IS NULL` and `started_at > now() - JOB_LOCK_MINUTES` (§5.8, default 15 min). |
| SC-14 | Timestamps: all `timestamptz`, computed as UTC (`new Date().toISOString()` / `now()`); "day" = UTC calendar date. |
| SC-15 | Structured logs (01 INV-42): `log.info\|warn\|error({job?, action?, id, msg, meta?})` from `lib/log.ts` (ADR-0002 C16) — exactly one of `job`/`action` set; `id` = `sync_runs.id` for jobs, `crypto.randomUUID()` request id for actions/route handlers. `meta` never contains request bodies with files or comment text, emails, tokens, signed URLs, or webhook URLs (01 INV-43). |
| SC-16 | Env is read only via `lib/env.ts` (zod-validated at import; 01 INV-36). Table = every name in `.env.example` (ADR-0002 #18: the boot-required set is exactly the **8 required** rows below; browser-safe names live in `lib/env/public.ts`): |
| | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **required** — `lib/supabase/client.ts`, `server.ts` |
| | `SUPABASE_URL`, `SUPABASE_ANON_KEY` — **CLI only** (Supabase CLI / `config.toml`); not read by `lib/env.ts` (ADR-0002 #18) |
| | `SUPABASE_SERVICE_ROLE_KEY` — **required** — `lib/supabase/admin.ts` only |
| | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — **not read by `lib/env.ts`** (Supabase CLI `config push` only) |
| | `YOUTUBE_API_KEY` — optional, degrades: `syncYoutube` RSS-only, `refreshMentions` skipped, §5.4 step 3 skipped, `channelStats` skipped — `lib/adapters/youtube.ts` |
| | `YOUTUBE_CHANNEL_ID` — **required** — `lib/adapters/youtube.ts` |
| | `MODRINTH_USER`, `MODRINTH_USER_AGENT` — **required** — `lib/adapters/modrinth.ts`, `http.ts` |
| | `CURSEFORGE_API_KEY` — optional, degrades: `syncCurseforge` skipped run, `setProjectLink` → `upstream_error` — `lib/adapters/curseforge.ts` |
| | `CURSEFORGE_MEMBER` — **to be removed from `.env.example` at S0** (still present in the current template; unused in v1, Q39 manual ids — `_registry.md` Env). Not read by `lib/env.ts`; T-UNIT-35 env parity runs against the S0 template |
| | `KOFI_PAGE` — optional; **seeds `site_settings.kofi_page` only** (public pages read the view `site_settings_public`, ADR-0002 C19) — seed |
| | `KOFI_WEBHOOK_VERIFICATION_TOKEN` — required from S2.1 — §9.1 |
| | `RESEND_API_KEY` — optional, degrades: email rows `failed`/`not_configured` (§3.7 N7) — `lib/adapters/resend.ts` |
| | `NOTIFY_FROM_EMAIL` — optional, default `allay@odsens.com` — `lib/notify/deliver/email.ts` |
| | `DISCORD_WEBHOOK_URL` — optional; seed/fallback for `site_settings.discord_webhook_url` (DB value wins) — `notifyFanOut` F2 |
| | `CRON_SECRET` — **required** — `app/api/cron/*` |
| | `NEXT_PUBLIC_SITE_URL` — **required** — metadata, emails, redirects, sign-out CSRF |
| | `HASH_SECRET` — **required from S1.1** (≥ 32 random bytes, server-only; `/auth/callback` sets `profiles.email_hash` with it — ADR-0002 A14) — SC-17 (ADR-0002 C13) |
| | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` — optional, S1.10 (`NEXT_PUBLIC_SENTRY_DSN` is an allowed browser var — ADR-0002 #79) — Sentry init |
| | `E2E` — test-only flag (`/__test/throw` when `E2E=1`, ADR-0002 #74) |
| | `MODRINTH_API_BASE`, `CURSEFORGE_API_BASE`, `YOUTUBE_API_BASE`, `YOUTUBE_RSS_BASE`, `OEMBED_BASE`, `DISCORD_API_BASE`, `RESEND_API_BASE` — **test-only** base-URL overrides pointing at the e2e fixture server on `:4010` (ADR-0002 #73); adapters read them via `create<Adapter>({fetch, env})`, defaults = the §4 base URLs; never set in Vercel |
| | Boot-required set = `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `MODRINTH_USER`, `MODRINTH_USER_AGENT`, `YOUTUBE_CHANNEL_ID` (ADR-0002 #18); everything else is optional-with-degradation as stated per row. `lib/env.ts` fails fast only on those 8 (05 T-UNIT-16, T-UNIT-35). |
| SC-17 | Hashing helpers (`lib/hash.ts`; 01 INV-50): `ipHash(ip) = createHmac('sha256', HASH_SECRET).update(`${ip}\|${utcDay}`).digest('hex')`; `uaHash(ua) = createHmac('sha256', HASH_SECRET).update(ua).digest('hex')`; `emailHash(email) = createHmac('sha256', HASH_SECRET).update(email.trim().toLowerCase()).digest('hex')` (ADR-0002 C13 — keyed; **the DB trigger does not set `email_hash`** (it cannot read env) — `/auth/callback` step A3 sets `profiles.email_hash` via the service client when null, and Ko-fi matching uses the same keyed hash — ADR-0002 A14, data-model §2.8). Raw IP / UA are never stored or logged. `HASH_SECRET` is the one and only hashing secret (`HASH_SALT`/`IP_HASH_SALT` do not exist — ADR-0002 C13). |
| SC-18 | Uploads ≤ 1 MB (avatars, skin textures) travel inside the action's `FormData` and are validated by `lib/validation/files.ts` `validateUpload(file, kind)` (+ `UPLOAD_KINDS`; 01 INV-51/52; ADR-0002 C16). Uploads that may exceed 1 MB (`project-files` ≤ 100 MB, `project-media` ≤ 5 MB, `art` ≤ 10 MB) use the **two-phase signed-upload pattern** (§1.4.5 — baseline per 01 INV-51 / ADR-0001 D13; DECIDED, ADR-0002 C11) because Vercel caps function request bodies at 4.5 MB. In both patterns the server validates type (magic bytes, not extension alone), size, and dimensions, generates the storage path, and writes the DB row; the browser never holds a broad Storage policy (data-model §3). |
| SC-19 | Image magic bytes accepted (`lib/validation/files.ts` `sniffMime`): PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `52 49 46 46 ?? ?? ?? ?? 57 45 42 50`. Archive magic bytes accepted: ZIP local header `50 4B 03 04` (covers `.jar`, `.zip`, `.mrpack`). SVG, GIF, HTML, executables are rejected everywhere. |
| SC-20 | Filenames stored in Storage are normalized (`lib/validation/files.ts` `sanitizeFilename`): NFKD → strip non `[A-Za-z0-9._-]` → collapse `-` → strip `..` and path separators → max 120 chars → lowercase extension; a filename may not start with `.`. Original filename is kept in `project_files.filename` after the same normalization. |
| SC-21 | Storage path patterns (bucket/`path`; builders in `lib/files.ts` — ADR-0002 C16; ids not slugs so renames never break paths; `{hash}` = first 16 hex chars of sha256 of the stored bytes): `avatars/{profile_id}/{hash}.webp` · `project-media/{project_id}/{icon\|gallery}/{hash}.{png\|jpg\|webp}` · `project-files/{project_id}/{version_id}/{filename}` · `skins/{skin_id}/texture.png` · `skins/{skin_id}/bust.png` · `art/{art_id}/{hash}.{png\|jpg\|webp}` (ADR-0002 C16). |
| SC-22 | Notification events are inserted via `lib/notify/emit.ts` → `emit(kind, {actorId?, subjectType, subjectId, payload})`; `kind` must be a member of the catalog in `docs/notifications.md` (`comment.new`, `comment.held`, `comment.reported`, `comment.reply`, `comment.approved`, `sync.failed`, `sync.stale`, P2 kinds). `payload` never contains emails or Google identity; user references are `{profile_id, handle}`. |
| SC-23 | Idempotency keys are stated per job/webhook; a re-run with the same key produces the same rows (05 "run twice"/"rerun idempotent" cases). |
| SC-24 | Admin audit line (security-check "admin actions logged"): every action that calls `requireRole` logs `log.info({action:<name>, id, msg:'admin', meta:{actor_profile_id, target_type, target_id, fields: Object.keys(input)}})` before returning `ok:true` — keys only, no values, no bodies. Gate check: each `requireRole` call site in `lib/actions/*` has a matching `msg:'admin'` log call. |
| SC-25 | Adapter factory (05 §1.3): every adapter exports `create<Adapter>({fetch, env})` (e.g. `createModrinth`, `createYoutube`) and never reads `process.env` directly (05 T-ADP-20); jobs/actions build adapters from `lib/env.ts` once per call. |

---

## 1. Server Actions

### 1.0 Summary table

| Action | File | Slice | Auth (`lib/auth.ts`) | Rate limit (count/window/scope) | Tags revalidated | Events emitted |
|---|---|---|---|---|---|---|
| `completeOnboarding` | `lib/actions/accounts.ts` | S1.1 | `requireUser()`, handle null | 10 / 10 min / user (`rate_limit_hits`) | — | — |
| `updateProfile` | `lib/actions/accounts.ts` | S1.1 | `requireOnboarded()` | handle 1 / 7 d; avatar 10 / 10 min / user | — | — |
| `checkHandle` (RPC `check_handle`) | `lib/actions/accounts.ts` → `rpc('check_handle')` | S1.1 | `requireUser()` | 60 / min / user (`rate_limit_hits`) | — | — |
| `deleteAccount` (ADR-0002 #28) | `lib/actions/accounts.ts` | S1.1 | `requireOnboarded()` | 1 / day / user | `project:<slug>` per touched target | — |
| `postComment` | `lib/actions/comments.ts` | S1.4 | `requireOnboarded()`, not banned | 5 / min + 50 / day / user | target tag | `comment.new` \| `comment.held`, `comment.reply` |
| `editComment` | `lib/actions/comments.ts` | S1.4 | author, ≤ 15 min | 20 / min / user | target tag | — |
| `deleteComment` | `lib/actions/comments.ts` | S1.4 | author or `requireRole('moderator')` | 20 / min / user | target tag | — |
| `toggleLike` | `lib/actions/comments.ts` | S1.4 | `requireOnboarded()`, not banned | 60 / min / user | target tag | — |
| `reportComment` | `lib/actions/comments.ts` | S1.4 | `requireOnboarded()`, not banned | 10 / hour / user | — | `comment.reported` (+ `comment.held` on auto-hold) |
| `moderateComment` | `lib/actions/comments.ts` | S1.4 | `requireRole('moderator')` | — | target tag | `comment.approved` |
| `banUser` | `lib/actions/comments.ts` | S1.4 | `requireRole('moderator')` | — | — | — |
| `renameUserHandle` | `lib/actions/comments.ts` | S1.4 | `requireRole('moderator')` | — | — | — |
| `setUserRole` | `lib/actions/settings.ts` | S1.5 | `requireRole('admin')` | — | — | — |
| `updateSettings` | `lib/actions/settings.ts` | S1.5 | `requireRole('admin')` | — | `settings` only (`/projects/[slug]` carries `settings`, 02 RP-23 — no extra tag) | — |
| `testDiscordWebhook` | `lib/actions/settings.ts` | S1.5 | `requireRole('admin')` | 10 / min / user (`rate_limit_hits`) | — | — |
| `createExclusiveProject` | `lib/actions/projects.ts` | S1.3 | `requireRole('admin')` | — | — (draft) | — |
| `updateExclusiveProject` | `lib/actions/projects.ts` | S1.3 | `requireRole('admin')` | — | `projects`, `project:<slug>` | — |
| `publishProject` | `lib/actions/projects.ts` | S1.3 | `requireRole('admin')` | — | `projects`, `project:<slug>` | — |
| `uploadProjectMedia` | `lib/actions/uploads.ts` | S1.3 (ADR-0002 C10 — S1.2 gallery = Modrinth URLs only) | `requireRole('admin')` | 60 / hour / user (`rate_limit_hits`) | `projects`, `project:<slug>` | — |
| `uploadProjectFile` | `lib/actions/uploads.ts` | S1.3 | `requireRole('admin')` | 30 / hour / user (`rate_limit_hits`) | `projects`, `project:<slug>` | — |
| `curateProject` | `lib/actions/projects.ts` | S1.2 | `requireRole('admin')` | — | `projects`, `project:<slug>` | — |
| `setProjectLink` | `lib/actions/projects.ts` | S1.2 | `requireRole('admin')` | 30 / hour / user (`rate_limit_hits`) | `projects`, `project:<slug>` | — |
| `createSkin` / `updateSkin` | `lib/actions/skins.ts` | S1.7 | `requireRole('admin')` | 60 / hour / user (`rate_limit_hits`) | `skins` | — |
| `createArt` / `updateArt` | `lib/actions/art.ts` | S1.7 | `requireRole('admin')` | 60 / hour / user (`rate_limit_hits`) | `art` | — |
| `fetchMentionPreview` | `lib/actions/mentions.ts` | S1.8 | `requireRole('admin')` | 30 / min / user (`rate_limit_hits`) | — | — |
| `createMention` / `updateMention` | `lib/actions/mentions.ts` | S1.8 | `requireRole('admin')` | — | `mentions`, `project:<slug>` (if assigned) | — |
| `triggerSync` | `lib/actions/admin.ts` | S1.2 | `requireRole('admin')` | — (lock SC-13, `JOB_LOCK_MINUTES` §5.8) | per job | per job |
| `updateVideo` | `lib/actions/videos.ts` | S1.6 | `requireRole('admin')` | — | `videos` | — |

Role rule (**DECIDED — ADR-0002 C7**, flagged [DAVID] for awareness): **`admin`** is required for curation, sync, media, mentions, videos, skins, art, exclusive projects, settings and roles — `curateProject`, `setProjectLink`, `triggerSync`, `uploadProjectMedia`, `uploadProjectFile`, `create/update/publish` exclusive project, `create/updateSkin`, `create/updateArt`, `fetchMentionPreview`, `createMention`, `updateMention`, `updateVideo`, `updateSettings`, `testDiscordWebhook`, `setUserRole`. **`moderator`** is required only for comment moderation — `moderateComment`, `banUser`, `renameUserHandle`, `deleteComment` (as non-author) — and for *reading* `/admin/*` pages (02's remit; wrong role → `notFound()`, ADR-0002 C4). Matches `docs/spec.md` ("mods can delete/hide comments and ban users"). RLS is unchanged (writes on `project_overrides`, `project_links`, `mentions`, `videos`, `skins`, `art`, `projects` = `is_admin()`; actions use the service client after `requireRole`).

### 1.1 Accounts (S1.1)

#### `completeOnboarding`
| Item | Contract |
|---|---|
| Trigger | `OnboardingPanel` form on `/welcome` (FormData). |
| Auth | `requireUser()`; `profiles.handle IS NULL` else `conflict` (already onboarded). |
| Input (`completeOnboardingInput`) | `handle: string` (H-rules) · `avatar?: File` (optional; ≤ 1 MB; PNG/JPEG/WebP by magic bytes; ≥ 64×64 px). |
| Handle rules (H) | H1 `^[A-Za-z0-9_]{3,20}$` (rejects `@`, spaces, dots, email-likes by construction). H2 case-insensitive unique (`citext`). H3 not in `RESERVED_HANDLES` (case-insensitive) — list: `admin, administrator, oddsense, odsens, moderator, mod, mods, root, system, support, allay, api, staff, help, null, undefined, anonymous, deleted, me, you, everyone, here` (first five mandated by `security-check`; the full 22-entry list is DECIDED — ADR-0002 #63). H4 no name/email detection (Q34; DESIGN.md §12.5). H5 the same list lives in SQL function `check_handle` and in `lib/validation/handle.ts` `RESERVED_HANDLES` (+ `handleSchema`); 05 T-UNIT-2 asserts parity. |
| Preconditions | Session valid; not banned is not checked (a banned account may still finish onboarding so it can be identified). |
| Rate limit | `assertRateLimit('onboarding', profile_id, 10, '10 minutes')` (`rate_limit_hits`). |
| Effects | Calls RPC `check_handle` → if not `available` return matching error. Update `profiles set handle = $1 where id = auth.uid() and handle is null` (RLS null→value). If avatar: `lib/files.ts` `reencodeAvatar` with `sharp` → `.rotate()` → square centre-crop → 512×512 WebP q82, metadata stripped (01 INV-47; O-5) → upload `avatars/{profile_id}/{hash}.webp` (service role) → set `avatar_path`. |
| Returns | `{ok:true, data:{handle, avatar_path}}`. Errors: `handle_taken`, `handle_reserved`, `validation`, `conflict`, `storage_error`, `rate_limited`, `unauthenticated`. |
| Tests (05) | T-ACT-1, T-ACT-2, T-ACT-3; T-RLS-5, T-RLS-6; T-UNIT-1, T-UNIT-2; T-E2E-21, T-E2E-22. |

#### `updateProfile`
| Item | Contract |
|---|---|
| Trigger | `/profile` forms (handle row SAVE; picture Change/Remove via `AvatarUpload` — there is **no** separate `uploadAvatar` action; 03 §2.5 `AvatarUpload` is a file input (`name`) inside the `updateProfile` / `completeOnboarding` `<form>` — it has **no** `action` prop). |
| Auth | `requireOnboarded()`. |
| Input (`updateProfileInput`) | `{handle?: string, avatar?: File, removeAvatar?: boolean}` — at least one present. Same H-rules. |
| Preconditions | Handle change: new handle ≠ current (case-insensitive) else no-op `ok`. |
| Effects | Handle: RPC `check_handle` → update via **service-role client** (data-model §4 RLS allows only null→value for self; renaming is a design requirement, DESIGN.md §11.3 p.11 — DECIDED, ADR-0002 #27), set `profiles.handle_changed_at = now()`. Avatar: same pipeline as `completeOnboarding`; old object deleted after new one is written. `removeAvatar`: delete object, set `avatar_path = null`. Never touches `role`/`is_banned` (unknown fields stripped by zod). |
| Returns | `{ok:true, data:{handle, avatar_path}}`. Errors: `handle_taken`, `handle_reserved`, `validation`, `rate_limited`, `storage_error`. |
| Rate limit | Handle change: 1 / 7 days / user (ADR-0002 #27), counted from `profiles.handle_changed_at`. Avatar: `assertRateLimit('avatar', profile_id, 10, '10 minutes')` (`rate_limit_hits`). |
| Tests (05) | T-ACT-4, T-ACT-5, T-ACT-6; T-RLS-6, T-RLS-8; T-E2E-23. |

#### `checkHandle` (RPC `check_handle(p_handle text) returns text`)
| Item | Contract |
|---|---|
| Trigger | `HandleField` on keystroke (debounce is 03's remit) via action `checkHandle` (thin wrapper) — never called from the browser with the anon client directly. |
| Auth | SQL: `security definer`, `grant execute to authenticated` only; action: `requireUser()`. |
| Input (`checkHandleInput`) | `handle: string` (any string ≤ 64; validated inside). |
| Rate limit | `assertRateLimit('check_handle', profile_id, 60, '1 minute')` (`rate_limit_hits`; ADR-0002 #14). |
| Logic | returns `'invalid'` (H1 fails) → `'reserved'` (H3) → `'taken'` (`exists profiles where handle = p_handle` citext, excluding `auth.uid()`) → `'available'`. Never returns the owning profile id. |
| Returns | `{ok:true, data:{status:'available'\|'taken'\|'reserved'\|'invalid'}}` — the four states map to `HandleField` states (DESIGN.md §11.1). 05 T-ACT-7 asserts `data.status`. |
| Tests (05) | T-ACT-7; T-UNIT-2. |

#### `deleteAccount` — DECIDED (ADR-0002 #28)
| Item | Contract |
|---|---|
| Trigger | `/profile` "Delete account" (danger, inline confirm; DESIGN.md §11.3 p.11; 02 O-6). |
| Auth | `requireOnboarded()`. Input (`deleteAccountInput`) `{confirm: z.literal(true)}`. Rate limit `assertRateLimit('delete_account', profile_id, 1, '1 day')`. |
| Effects (service role, one transaction where possible) | `comments where author_id = me` → `status='deleted'` (slot stays, body retained per §1.2 `deleteComment`); `comment_likes where user_id = me` deleted (trigger fixes `like_count`); `comment_reports where reporter_id = me` deleted; avatar object removed; `profiles` row deleted via `auth.admin.deleteUser(id)` cascade — comments keep `author_id` as a dangling reference rendered as `author: null` ("Deleted." slot). `revalidateTag('project:<slug>')` for every distinct comment target (not the four site tags). Sign the user out (cookies cleared) → client redirects `/`. |
| Returns | `{ok:true, data:{deleted:true}}`. Errors: `unauthenticated`, `rate_limited`, `internal`. |
| Tests (05) | T-ACT-65 (auth matrix, cascade, sign-out, rate limit). |

### 1.2 Comments (S1.4)

Shared definitions:
- `TARGET = z.object({target_type: z.literal('project'), target_id: z.string().uuid()})` in v1 — the **DB column** `comments.target_type` keeps all four values (`project|skin|art|video`, data-model), but the v1 zod schema accepts only `'project'`, so a non-project `target_type` fails parsing → `validation` (05 T-ACT-15) and **v1 UI mounts comment threads on projects only** (ADR-0002 C21). Widening `TARGET` to `z.enum(['project','skin','art','video'])` is the Phase-2 change (no v1 e2e path); the skin/art/video rules below are kept for that reason.
- **Reads (ADR-0002 C1, #71):** public thread HTML comes server-side from `lib/data/comments.ts` over the view **`comments_public`** (every status as a slot; `body`/`author_id`/`edited_at` non-NULL only for `published` rows or the caller's own — 05 T-RLS-128) under tag `project:<slug>`; the viewer's own held/hidden rows and own likes are read client-side by `CommentThread` (`'use client'`) via `lib/supabase/client.ts` under RLS. No PPR.
- **Moderator read (ADR-0002 A2) — RPC `moderator_thread(p_target_type text, p_target_id uuid)`** (`security definer`; raises/returns empty unless `is_moderator()`; created S1.4): returns for the target every `held`, `hidden` and reported (`comment_reports` unresolved > 0) comment as `CommentView` rows plus `is_first_comment` (`profiles.comment_count = 0` for the author) and `report_count` (unresolved reports). Called client-side by `CommentThread` for moderators only — the allowed exception to 01 INV-09 / 03 C-17. `comments_public` is unchanged. Tests (05): RLS matrix row for `moderator_thread` (user/anon → empty/forbidden, moderator → rows).
- **`moderation_mode` (ADR-0002 A3):** view `site_settings_public` also exposes `moderation_mode` (non-sensitive). `postComment` reads it through the **RLS server client** from `site_settings_public` (never the service client / `site_settings`); the page passes it to `CommentThread` for the client optimistic-insert rule (03 §2.4).
- **Insert policies** use the SQL helper `can_comment(p_target_type text, p_target_id uuid) returns boolean` (`security definer`; = target visible AND comments enabled AND `not profiles.is_banned` for `auth.uid()`) on `comments`, `comment_likes`, `comment_reports` (ADR-0002; 05 T-RLS-67/69/70/80/86). Actions still check the same preconditions first (defense in depth).
- **Status trigger:** `comments_set_status()` (BEFORE INSERT on `comments`) recomputes `status` from `site_settings.moderation_mode`, `profiles.comment_count` and author role, ignoring the client value (ADR-0002 #72; 05 T-RLS-131).
- **Target visible** = project: `projects.status='published'` and not `project_overrides.hidden`; skin/art: `status='published'`; video: `hidden=false`.
- **Comments enabled** = project: `coalesce(project_overrides.comments_enabled, not site_settings.comments_closed_default)`; skin/art/video: `not site_settings.comments_closed_default`. Not enabled → `comments_closed`.
- **Body rules (B)** (`lib/validation/comment.ts` `commentBodySchema`, `stripHtml`, `countLinks`): B1 strip HTML tags (`/<[^>]*>/g` → ''), then trim; B2 length 1..1000 code points (after B1) — DB check `char_length(body) <= 1000`; B3 links counted with `/(https?:\/\/[^\s]+|www\.[^\s]+)/gi` → count ≤ 1 else `too_many_links`; B4 stored as plain text; rendering auto-linkifies with `linkify()` from `lib/validation/comment.ts` (never `lib/markdown.ts`, which is server-only — ADR-0002 C16); error copy per code from `commentErrorLine(code)` in the same module (05 T-UNIT-40); B5 no ` `; B6 message copy for B2/B3 as per DESIGN.md §11.2 ("Too many links.").
- **Target tag** for revalidation: project → `project:<slug>` only (cards do not show comment counts in v1); skin → `skins`; art → `art`; video → `videos`.
- **First-time commenter** = `profiles.comment_count = 0`. **Trigger rule (decided here; 00 O-13):** `comment_count` increments when a comment row becomes `status='published'` (insert as published, or `held → published` on approve); it is **never** decremented (deletes/hides do not change it). A held first-timer who posts again while still held is still first-time → held again. data-model §2.1 and 05 T-ACT-15/T-ACT-19/T-RLS-126 state the same rule (ADR-0002).
- **`CommentView`** (type home `lib/data/comments.ts`; returned by `postComment`/`editComment` and consumed by 03 `CommentThread`/`Comment`/`Composer.onPosted`): `{id: string, body: string, status: 'published'\|'held'\|'hidden'\|'deleted', createdAt: string, editedAt: string\|null, parentId: string\|null, likeCount: number, likedByViewer: boolean, isFirstComment?: boolean, author: {id: string, handle: string, avatarUrl: string\|null, role: 'user'\|'moderator'\|'admin'} \| null}`. `avatarUrl` = public URL of `avatar_path` or null. **CREATOR tag** (03 `Comment`): `author.id === site_settings.owner_profile_id` (ADR-0002 #55; read via view `site_settings_public` → `lib/data/settings.ts` `getOwnerProfileId()`, C6).

#### `postComment`
| Item | Contract |
|---|---|
| Trigger | `Composer` (root) / `Reply` composer. |
| Auth | `requireOnboarded()`; not banned (SC-05). |
| Input (`postCommentInput`) | `TARGET & {body: string, parent_id?: uuid}`. |
| Preconditions | Target exists + visible → else `not_found`. Comments enabled → else `comments_closed`. If `parent_id`: parent exists on the same `target_type/target_id` and has `status='published'` (else `not_found`); if the parent itself has a `parent_id`, the stored `parent_id` = the parent's root (one level, data-model §2.5); client prefixes `@handle ` in body (not enforced server-side). |
| Rate limit | `assertRateLimit('comment', profile_id, 5, '1 minute')` and `assertRateLimit('comment_day', profile_id, 50, '24 hours')` (both count `rate_limit_hits`; a hit is recorded per call regardless of resulting status — ADR-0002 A4). |
| Moderation | Status per §5.1 decision table (`lib/validation/moderation.ts` `decideCommentStatus({mode, authorCommentCount, authorRole})`), where `mode` = `site_settings_public.moderation_mode` read via the RLS server client (ADR-0002 A3). |
| Effects | Insert `comments {target_type,target_id,author_id,parent_id,body,status}` with the action-computed status; the BEFORE INSERT trigger `comments_set_status()` recomputes it and the action returns the row **as stored** (`insert … returning`), so the UI never shows `published` for a held comment — the client does **no** optimistic insert for a first-timer under `hold_first_time` (ADR-0002 #72). Emit `comment.new` (status published) or `comment.held` (held) with `subject_type='comment'`, `payload {comment_id, target_type, target_id, target_title, target_slug, excerpt(140), author:{profile_id,handle}, first_time}`. If `parent_id` and status published and parent author ≠ actor: also emit `comment.reply` (log only). `revalidateTag(targetTag)`. |
| Returns | `{ok:true, data:{comment: CommentView}}` (`likeCount:0`, `likedByViewer:false`). Errors: `unauthenticated`, `onboarding_required`, `banned`, `not_found`, `comments_closed`, `validation`, `too_many_links`, `rate_limited`. |
| Tests (05) | T-ACT-11, T-ACT-12, T-ACT-13, T-ACT-14, T-ACT-15, T-ACT-16; T-UNIT-4, T-UNIT-5, T-UNIT-6; T-RLS-67, T-RLS-68, T-RLS-69, T-RLS-70; T-E2E-24, T-E2E-25, T-E2E-26. |

#### `editComment`
| Item | Contract |
|---|---|
| Auth | `requireOnboarded()`; not banned; `comments.author_id = auth.uid()` (moderators may **not** edit bodies → `forbidden`). |
| Input (`editCommentInput`) | `{comment_id: uuid, body: string}` (B-rules). |
| Preconditions | `created_at > now() - interval '15 minutes'` (`isWithinEditWindow`, `EDIT_WINDOW_MS = 900000`, boundary exclusive) else `edit_window_expired`; `status in ('published','held')` else `not_found`. |
| Rate limit | `assertRateLimit('comment_edit', profile_id, 20, '1 minute')` (`rate_limit_hits`). |
| Effects | Update `body`, `edited_at = now()` — set by the action, **no trigger** (ADR-0002); status unchanged (a held comment stays held). `revalidateTag(targetTag)`. |
| Returns | `{ok:true, data:{comment: CommentView}}`. Errors: `forbidden`, `edit_window_expired`, `validation`, `too_many_links`, `banned`, `not_found`, `rate_limited`. |
| Tests (05) | T-ACT-17, T-ACT-18; T-RLS-71, T-RLS-72, T-RLS-73; T-UNIT-8. |

#### `deleteComment`
| Item | Contract |
|---|---|
| Auth | author (`requireOnboarded()`, not banned) **or** `requireRole('moderator')` — moderators may delete **others'** comments (ADR-0002 A6; part of the moderator action set `moderateComment, banUser, renameUserHandle, deleteComment(others)`). |
| Input (`deleteCommentInput`) | `{comment_id: uuid}`. |
| Rate limit | `assertRateLimit('comment_delete', profile_id, 20, '1 minute')` (`rate_limit_hits`; applied on the author path; the moderator path is not rate-limited). |
| Effects | Soft delete: `status='deleted'` (body retained in DB, never returned to non-mods; slot renders "Deleted." per DESIGN.md §11.2), `moderated_by = auth.uid()`, `moderated_at = now()` set when actor ≠ author (moderator path — ADR-0002 A6). Likes/reports untouched; `comment_count` untouched. `revalidateTag(targetTag)`. Author delete has no time window. |
| Returns | `{ok:true, data:{comment_id, status:'deleted'}}`. Errors: `forbidden`, `not_found`, `banned`, `rate_limited` (author path; ADR-0002). |
| Tests (05) | T-ACT-19; T-RLS-74, T-RLS-78. |

#### `toggleLike`
| Item | Contract |
|---|---|
| Auth | `requireOnboarded()`; not banned. |
| Input (`toggleLikeInput`) | `{comment_id: uuid}`. |
| Preconditions | Comment `status='published'` and target visible → else `not_found`. |
| Rate limit | `assertRateLimit('like', profile_id, 60, '1 minute')` (`rate_limit_hits`; every call — like or unlike — records a hit, ADR-0002 A4). |
| Effects | If row `(comment_id, user_id)` exists → delete; else insert. `like_count` maintained by trigger. `revalidateTag(targetTag)` = `project:<slug>` (ADR-0002; like_count is in cached HTML, optimistic UI covers the gap). |
| Returns | `{ok:true, data:{liked: boolean, like_count: number}}`. Errors: `banned`, `not_found`, `rate_limited`. |
| Tests (05) | T-ACT-20; T-RLS-80, T-RLS-83, T-RLS-84. |

#### `reportComment`
| Item | Contract |
|---|---|
| Auth | `requireOnboarded()`; not banned. |
| Input (`reportCommentInput`) | `{comment_id: uuid, reason: z.enum(['spam','rude','other']), note?: string ≤ 300}` (`ReportPicker`: Spam / Rude / Something else). |
| Preconditions | Comment `status='published'`; not own comment (`validation`, "You can't report your own comment."). |
| Rate limit | `assertRateLimit('report', profile_id, 10, '1 hour')` (`rate_limit_hits`; ADR-0002 #69, A4). |
| Effects | Insert `comment_reports` (unique `(comment_id, reporter_id)` → duplicate = `ok:true` no-op, idempotent — 00 S1.4.AC9 "no error to UI"; there is **no** `already_reported` code). Count unresolved reports; if `>= AUTO_HOLD_REPORTS (3)` and comment `status='published'` → set `status='held'`, `moderated_by = null`, `moderated_at = now()` (auto-hold, Q38) and emit `comment.held` (`payload.reason='reports'`). Always emit `comment.reported` `payload {comment_id, report_count, reason, excerpt(140), target…}`. |
| Returns | `{ok:true, data:{report_count}}` (UI shows "Reported. OddSense will look at it."). Errors: `banned`, `not_found`, `validation`, `rate_limited`. |
| Tests (05) | T-ACT-21, T-ACT-22; T-RLS-86, T-RLS-87; T-UNIT-7; T-E2E-27. |

#### `moderateComment`
| Item | Contract |
|---|---|
| Trigger | `ModActionRow` (thread) and `/admin/comments` queue. |
| Auth | `requireRole('moderator')`. |
| Input (`moderateCommentInput`) | `{comment_id: uuid, action: z.enum(['approve','hide','unhide','delete'])}`. |
| Transitions | approve: `held → published`; hide: `published\|held → hidden`; unhide: `hidden → published`; delete: any non-deleted → `deleted`. Illegal transition → `conflict`. |
| Effects | Update `status, moderated_by = auth.uid(), moderated_at = now()`; on approve/hide/delete set `resolved_at/resolved_by` on all unresolved `comment_reports` for the comment. On approve emit `comment.approved` (log only, `payload {comment_id, author:{profile_id,handle}}`); the trigger increments the author's `comment_count`. `revalidateTag(targetTag)`. SC-24 audit line. |
| Returns | `{ok:true, data:{comment_id, status}}`. Errors: `forbidden`, `not_found`, `conflict`. |
| Tests (05) | T-ACT-23; T-RLS-75, T-RLS-76; T-E2E-36. |

#### `banUser`
| Item | Contract |
|---|---|
| Trigger | `ModActionRow` "Ban user" (inline confirm) and `/admin/comments`. |
| Auth | `requireRole('moderator')`. |
| Input (`banUserInput`) | `{profile_id: uuid, banned: boolean, reason?: string ≤ 200}`. |
| Preconditions | Target `role = 'user'` (mods/admins cannot be banned by this action, by any actor → `forbidden`; demote first via `setUserRole`); target ≠ self. |
| Effects | Update `profiles.is_banned, banned_reason` (service role). No cascade on existing comments (DECIDED — ADR-0002 #64). No revalidation. Ban is reversible from `/admin/comments` (`banned:false`). SC-24 audit line. |
| Returns | `{ok:true, data:{profile_id, is_banned}}`. Errors: `forbidden`, `not_found`. |
| Tests (05) | T-ACT-24; T-E2E-28. |

#### `renameUserHandle` (spec §9 "moderators can rename")
| Item | Contract |
|---|---|
| Trigger | `/admin/comments` row action "Rename handle" = `Field` (handle rules) + `InlineConfirm` "Rename @old to @new?" → this action (03 §2.4 `ModActionRow` — rendered by the admin queue row, not in the public thread; composed from existing primitives, no new DESIGN.md state). |
| Auth | `requireRole('moderator')`. |
| Input (`renameUserHandleInput`) | `{profile_id: uuid, handle: string (H-rules)}`. |
| Preconditions | Target exists; target `role='user'` unless actor is `admin` (mods cannot rename mods/admins → `forbidden`); RPC `check_handle` (evaluated as the target) → `handle_taken` / `handle_reserved` / `validation`. |
| Effects | Update `profiles.handle`, `handle_changed_at = now()` (service role). No event, no revalidation (handles are joined at read time; cached HTML refreshes ≤ 600 s, 02 O-10). SC-24 audit line. |
| Returns | `{ok:true, data:{profile_id, handle}}`. Errors: `forbidden`, `not_found`, `handle_taken`, `handle_reserved`, `validation`. |
| Tests (05) | T-ACT-67; T-E2E-36. |

### 1.3 Settings (S1.5 — `/admin/settings` ships **whole** in S1.5 incl. `setUserRole` and the moderators table, DECIDED ADR-0002 C2; no S1.1 stub; S1.4 reads the seeded `moderation_mode='auto'`; roles bootstrapped by SQL until then, #23)

#### `updateSettings`
| Item | Contract |
|---|---|
| Trigger | `/admin/settings` SAVE SETTINGS. |
| Auth | `requireRole('admin')`. |
| Input (`updateSettingsInput`) | all optional (partial update): `moderation_mode: z.enum(['auto','hold_first_time'])` · `admin_notify_emails: z.array(email).max(10)` (each `z.string().email().max(254)`, lowercased, de-duplicated; never pre-filled from the session — 00 S1.5.AC4) · `discord_webhook_url: z.string().regex(/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/).or(z.literal(''))` — omitted = unchanged (UI shows it masked), `''` = clear · `kofi_page: /^[A-Za-z0-9_-]{1,40}$/ \| ''` · `comments_closed_default: boolean` · `announcement_md: string ≤ 2000 \| null` · `matrix: z.array({kind: catalogKind, channel: z.enum(['email','discord']), enabled: boolean})` — kinds outside the v1 `notification_matrix` set (`comment.new, comment.held, comment.reported, sync.failed, sync.stale`) rejected with `validation` (COMING LATER rows are display-only). |
| Effects | Update `site_settings where id = 1`; upsert `notification_matrix` rows; `revalidateTag('settings')` **only** — no extra `projects` tag: `/projects/[slug]` carries `settings` (02 RP-23), so a `comments_closed_default` change already refreshes detail pages, and listing pages do not show comments state (04 owns tags per 02 RP-22; 01 INV-40 / 02 §5 / 05 T-ACT-27 still carry the old "+ `projects`" clause — see §12 outstanding list). `discord_webhook_url` is never returned to the client — action returns `discord_webhook_set: boolean` and `discord_webhook_tail` (last 4 chars, `maskSecret`). SC-24 audit line. |
| Returns | `{ok:true, data:{settings: {…without discord_webhook_url, discord_webhook_set, discord_webhook_tail}, matrix}}`. Errors: `forbidden`, `validation`. |
| Tests (05) | T-ACT-25, T-ACT-26, T-ACT-27; T-RLS-12, T-RLS-14; T-UNIT-25, T-UNIT-27, T-UNIT-28; T-E2E-37. |

#### `testDiscordWebhook`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Rate limit `assertRateLimit('discord_test', profile_id, 10, '1 minute')` (`rate_limit_hits`). |
| Input (`testDiscordWebhookInput`) | `{url?: string}` (same regex); absent → stored `site_settings.discord_webhook_url`; neither → `validation`. |
| Effects | `adapters/discord.postEmbed(url, {title:'Test — odsens', description:'The allay says hi.', color: INDIGO})` (§4.6); nothing stored; URL never logged. |
| Returns | `{ok:true, data:{status:number}}` or `{ok:false, error:{code:'upstream_error', message}}` (inline ✔/✕ line, DESIGN.md §12.1). |
| Tests (05) | T-ACT-28. |

#### `setUserRole`
| Item | Contract |
|---|---|
| Trigger | `/admin/settings` Moderators table (Make mod / Remove; add by handle) — DESIGN.md §11.3 p.15; 00 S1.5.AC11. |
| Auth | `requireRole('admin')`. |
| Input (`setUserRoleInput`) | `{handle: string (H1), role: z.enum(['user','moderator','admin'])}`. |
| Preconditions | Target exists (`not_found`); target ≠ self when demoting (`forbidden`, avoids locking out the last admin); at least one admin must remain (`conflict`). |
| Effects | Update `profiles.role` (service role). SC-24 audit line. |
| Returns | `{ok:true, data:{profile_id, handle, role}}`. Errors: `not_found`, `forbidden`, `conflict`. |
| Tests (05) | T-ACT-66 (mod cannot promote, last-admin guard); T-E2E-37. |

### 1.4 Projects (S1.2 curation, S1.3 exclusives)

Shared: `PROJECT_TYPE = z.enum(['mod','datapack','resourcepack','plugin'])` · `LOADERS = z.enum(['fabric','forge','neoforge','quilt','paper','spigot','bukkit','purpur','folia','velocity','bungeecord','waterfall','sponge','datapack','minecraft'])` · `GAME_VERSION = /^[0-9][0-9A-Za-z.\-+_]{0,19}$/` · `SLUG = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/` (3–64; `lib/validation/slug.ts` `slugSchema`) and not in `RESERVED_SLUGS = ['new','edit','admin','api','projects']` · `URL = z.string().url().startsWith('https://').max(512)`.

#### `createExclusiveProject`
| Item | Contract |
|---|---|
| Trigger | `/admin/projects/new` form. |
| Auth | `requireRole('admin')`. |
| Input (`createExclusiveProjectInput`) | `{slug: SLUG, title: 1..80, description: 1..256, body_md: ≤ 65536, project_type: PROJECT_TYPE, categories: string[≤32][] max 10, loaders: LOADERS[] max 10, game_versions: GAME_VERSION[] max 60, license?: ≤ 64, source_url?, issues_url?, discord_url?: URL}`. |
| Effects | Insert `projects {source:'odsens', external_id:null, status:'draft', downloads_* 0, published_at:null}`; slug conflict (citext, incl. Modrinth slugs) → `conflict`. No revalidation (draft invisible). SC-24. |
| Returns | `{ok:true, data:{id, slug}}`. Errors: `forbidden`, `validation`, `conflict`. |
| Tests (05) | T-ACT-34, T-ACT-35; T-RLS-17, T-RLS-19; T-UNIT-20. |

#### `updateExclusiveProject`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Input (`updateExclusiveProjectInput`) `{id: uuid} & Partial<createExclusiveProject input>` (slug change allowed while `status='draft'` only, else `conflict`); `source`, `external_id`, `downloads_*` never accepted. |
| Preconditions | `projects.source = 'odsens'` else `forbidden` (synced rows are curated via `curateProject`). |
| Effects | Update columns; `revalidateTag('projects')`, `revalidateTag('project:<slug>')` (old and new slug if changed). SC-24. |
| Returns | `{ok:true, data:{id, slug}}`. Tests (05): T-ACT-36. |

#### `publishProject`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Input (`publishProjectInput`) `{id: uuid, status: z.enum(['draft','published','hidden'])}`. |
| Preconditions | `source='odsens'`. To `published`: `icon_url` not null AND ≥ 1 `project_versions` with ≥ 1 `project_files` (`storage_path` not null) → else `precondition_failed` with message listing what's missing ("Nothing to download yet." when no file; DECIDED — ADR-0002 #65). |
| Effects | Update `status`; on first publish set `published_at = now()`. `revalidateTag('projects')`, `revalidateTag('project:<slug>')`. SC-24. |
| Returns | `{ok:true, data:{id, status}}`. Tests (05): T-ACT-37; T-E2E-35. |

#### `curateProject`
| Item | Contract |
|---|---|
| Trigger | `/admin/projects` **list** (feature/hide toggles + `ReorderableList` drag-reorder — ADR-0002 A11) and `/admin/projects/[id]` curate panel (per-project extras: extra gallery, notes, CF id, comments toggle). |
| Auth | `requireRole('admin')` (ADR-0002 C7). |
| Input (`curateProjectInput`) | **either** the batch shape `{reorder: [{project_id: uuid, featured_order: int 1..99}] max 99}` (one call, one transaction, one revalidate — ADR-0002 A11) **or** the per-project shape `{project_id: uuid, featured?: boolean, featured_order?: int 1..99 \| null, hidden?: boolean, title_override?: 1..80 \| null, description_override?: 1..256 \| null, extra_gallery?: [{path: string, title?: ≤120, description?: ≤ 500, ordering: int}] max 20, notes_md?: ≤ 20000 \| null, comments_enabled?: boolean}` — every `extra_gallery.path` must match `^project-media/<this project_id>/gallery/[A-Za-z0-9._-]+\.(png\|jpg\|webp)$` and exist in bucket `project-media` (HEAD check); this action **reorders/edits/removes** gallery entries — adding one is `uploadProjectMedia kind='gallery'`. |
| Effects | Per-project: upsert `project_overrides` (PK project_id); `revalidateTag('projects')`, `revalidateTag('project:<slug>')`. Batch `reorder`: upsert `project_overrides.featured_order` for every listed id in one transaction, then **one** `revalidateTag('projects')` (no per-slug tags — cards/home strip read the `projects` tag). SC-24. |
| Returns | `{ok:true, data:{override}}` (per-project) / `{ok:true, data:{reordered: n}}` (batch). Errors: `forbidden`, `not_found`, `validation`. Tests (05): T-ACT-40 (mod = D `forbidden`, admin = A); T-RLS-41, T-RLS-42; T-E2E-34. |

#### `setProjectLink`
| Item | Contract |
|---|---|
| Trigger | `/admin/projects/[id]` "CurseForge id" field (Q39 manual entry). |
| Auth | `requireRole('admin')` (ADR-0002 C7). Rate limit `assertRateLimit('project_link', profile_id, 30, '1 hour')`. |
| Input (`setProjectLinkInput`) | `{project_id: uuid, platform: z.literal('curseforge'), ref: string ≤ 300 \| null}` — `ref` is either digits (`/^\d{1,10}$/`) or a CurseForge URL `^https://(www\.)?curseforge\.com/minecraft/(mc-mods|texture-packs|data-packs|bukkit-plugins|modpacks|shaders)/([a-z0-9-]+)`; `null` removes the link. |
| Preconditions | `CURSEFORGE_API_KEY` set else `upstream_error` message "CurseForge key not configured". |
| Effects | URL → resolve id via `adapters/curseforge.searchBySlug(slug)` (§4.2); id → `adapters/curseforge.getMod(id)`; upsert `project_links {project_id, platform:'curseforge', external_id: String(id), url: data.links.websiteUrl, downloads: data.downloadCount, synced_at: now()}` **and set `projects.downloads_curseforge` immediately** (05 T-ACT-41). `null` → delete the row and set `downloads_curseforge = 0`. `revalidateTag('projects')`, `revalidateTag('project:<slug>')`. SC-24. |
| Returns | `{ok:true, data:{link}}`. Errors: `not_found` (no CF mod), `upstream_error`, `validation`, `rate_limited`. |
| Tests (05) | T-ACT-41; T-ADP-7 (fixtures `mod.json`, `search.json`). |

#### 1.4.5 Uploads — two-phase signed-upload pattern (SC-18) — DECIDED (ADR-0002 C11: baseline per 01 INV-51 / ADR-0001 D13; **no further ADR**)
Rationale: the Vercel 4.5 MB request-body cap makes single-shot 100 MB uploads impossible. Rules that follow from the baseline: browsers may `PUT` to a **server-issued** signed upload URL for a **server-generated** path only; the commit phase validates before any DB row; `createSignedUploadUrl` is called only inside `lib/files.ts` (invoked from `lib/actions/uploads.ts` / `lib/actions/art.ts` — 01 INV-51 grep target; `_registry.md` Modules); storage policies stay service-role only (signed upload tokens are not policies, 01 INV-33; data-model §3); `security-check` Uploads checklist includes the commit-phase re-validation line. Avatars/skins (inline) are unaffected. The pre-assigned name `ADR-0002-signed-uploads.md` is **retired**; the slug `signed-uploads` is reserved only (06 README numbering).

Applies to `uploadProjectMedia`, `uploadProjectFile`, `createArt`/`updateArt` image. Both phases are the **same action name** with a discriminated `phase`:

| Phase | Input | Server does | Returns |
|---|---|---|---|
| `begin` | `{phase:'begin', …target ids, filename, size_bytes, mime}` | role check → `assertRateLimit('upload:<bucket>', profile_id, …)` (§5.5) → validate declared size ≤ cap and extension allowlist → compute path (SC-21; `{hash}` is not known yet, so `begin` uses a `crypto.randomUUID()` placeholder segment which `commit` renames to `{hash}` via `storage.move`) → `lib/files.ts` signed-URL builder → `storage.from(bucket).createSignedUploadUrl(path)` (service role, token valid `UPLOAD_TOKEN_HOURS`, default 2 h; the only call site is `lib/files.ts`, 01 INV-51) → insert **no DB row yet** | `{ok:true, data:{path, token, signed_url}}` |
| (browser) | `PUT` the file to `signed_url` with the token (Supabase `uploadToSignedUrl`) | — | — |
| `commit` | `{phase:'commit', path, …metadata}` | role check → path must match the pattern for the caller's target ids → `download` the object (streaming) → check magic bytes (SC-19), actual size ≤ cap, image dimensions (`sharp.metadata()`), sha512 (files) → on failure **delete the object** and return error → on success `move` to the final `{hash}` path (media/art), write DB row(s) → revalidate | `{ok:true, data:{row}}` |

Rules: U1 an object with no committed row is garbage — `snapshotStats` (S1.9; the orphan-cleanup acceptance moved from S1.3.AC11 to S1.9 — ADR-0002 #80) deletes objects older than 24 h whose path is not referenced by `project_files.storage_path`, `projects.icon_url`, `projects.gallery[].url`, `project_overrides.extra_gallery[].path`, `art.image_path` (avatars `profiles.avatar_path` and skins `skins.texture_path`/`render_bust_path` are **excluded** — inline uploads never orphan). U2 `begin` rate limits apply per §5.5 (`rate_limit_hits`). U3 commit is idempotent on `path` (`conflict` → return existing row). U4 Client `UploadWell` shows the printed limits from `UPLOAD_KINDS` (03's remit).

#### `uploadProjectMedia`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')` for every `kind`/source (ADR-0002 C7). Slice **S1.3** together with the `project-media` bucket (ADR-0002 C10; in S1.2 gallery = Modrinth URLs only). Bucket `project-media` (public-read). |
| Input (begin) | `{phase:'begin', project_id: uuid, kind: z.enum(['icon','gallery']), filename, size_bytes ≤ 5_242_880, mime ∈ image/png\|jpeg\|webp}`. |
| Input (commit) | `{phase:'commit', project_id, kind, path, title?: ≤120, description?: ≤500}`. |
| Validation (commit) | Magic bytes PNG/JPEG/WebP; `icon`: square, 64..1024 px; `gallery`: max 4096×4096, min 320 px wide. |
| Effects | `icon`: `projects.icon_url = path` — `source='odsens'` only; modrinth rows → `forbidden`. `gallery`: `source='odsens'` → append `{url: path, title, description, ordering: max+1, featured:false}` to `projects.gallery`; `source='modrinth'` → upsert `project_overrides` and append `{path, title, description, ordering: max+1}` to `extra_gallery`. Revalidate `projects`, `project:<slug>`. SC-24. |
| Returns | `{ok:true, data:{path, entry}}`. Errors: `forbidden`, `not_found`, `validation`, `storage_error`, `rate_limited`, `conflict`. |
| Tests (05) | T-ACT-38 (S1.3; path pattern per SC-21), T-ACT-73; T-UNIT-17, T-UNIT-18. |

#### `uploadProjectFile`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Bucket `project-files` (**private**). Only `source='odsens'` projects (`forbidden` otherwise). |
| Input (begin) | `{phase:'begin', project_id, version_number: /^[0-9A-Za-z.\-+_]{1,32}$/, filename (ext ∈ .jar .zip .mrpack after SC-20), size_bytes ≤ 104_857_600, mime}` — `begin` computes `version_id` = existing `project_versions (project_id, version_number)` id or a fresh uuid reserved in the returned path; the version row is upserted only at commit. |
| Input (commit) | `{phase:'commit', project_id, path, version: {version_number, name?: ≤80, changelog_md?: ≤20000, game_versions: GAME_VERSION[] min 1, loaders: LOADERS[] min 1, version_type: z.enum(['release','beta','alpha']), date_published?: iso (default now)}, primary?: boolean}`. |
| Validation (commit) | ZIP magic bytes; size ≤ 100 MB (ADR-0002 #31); sha512 computed by streaming; filename unique within version (`conflict`). |
| Effects | Upsert `project_versions` (external_id null); insert `project_files {version_id, filename, size_bytes, sha512, url:null, storage_path: path, primary, download_count:0}`; if `primary` true → clear `primary` on siblings; if version has no primary → this file becomes primary. Revalidate `projects`, `project:<slug>`. SC-24. |
| Returns | `{ok:true, data:{version_id, file:{id, filename, size_bytes, sha512}}}` — sha512 is displayed in `VersionsTable` (security-check). |
| Tests (05) | T-ACT-39 (path per SC-21), T-ACT-73; T-UNIT-17, T-UNIT-18, T-UNIT-22; T-RLS-117, T-RLS-119. |

### 1.5 Skins + Art (S1.7)

#### `createSkin` / `updateSkin`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Bucket `skins` (public-read). Texture travels inline (≤ 64 KB) — SC-18. |
| Input (`createSkinInput` / `updateSkinInput`) | `{id?: uuid (update), slug: SLUG, name: 1..60, description_md?: ≤ 5000, model: z.enum(['classic','slim']), is_exclusive: boolean, status: z.enum(['draft','published']), sort_order: int, texture?: File}` (`texture` required on create). |
| Validation | PNG magic bytes; exactly 64×64 px (`pngDimensions`/`isSkinTexture`; 64×32 legacy rejected with message "Skins need to be 64×64."); ≤ 65_536 bytes. |
| Effects | Insert/update `skins`; upload `skins/{skin_id}/texture.png` (`upsert:true`, cache-control 1 y); on texture replace clear `render_bust_path`. Then **await** `jobs/renderSkinBust(skin_id)` (§3.8) — on failure `render_bust_path` stays null and the action still returns `ok` with `data.bust_rendered:false` (client falls back to live render). `revalidateTag('skins')`. SC-24. |
| Returns | `{ok:true, data:{skin, bust_rendered}}`. Errors: `forbidden`, `validation`, `conflict` (slug), `storage_error`, `rate_limited`. |
| Tests (05) | T-ACT-57, T-ACT-58, T-ACT-59; T-UNIT-19; T-RLS-54; T-E2E-38. |

Skin download: `DOWNLOAD PNG` (DESIGN.md §6 p.5) links to `/api/download/[fileId]` with the **skin id** — the generic route resolves kind `skin` (§2.3 D2) and increments `skins.downloads` via RPC `record_skin_download` (DECIDED — ADR-0002 C8; 05 T-ACT-76). Art download (`art.downloadable=true`) is a direct public-bucket link with `?download=<slug>.<ext>`; art has no counter column in v1.

#### `createArt` / `updateArt`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Bucket `art` (public-read); image via two-phase (≤ 10 MB) — image optional on update. |
| Input (metadata) | `{id?, slug: SLUG, title: 1..80, kind: z.enum(['avatar','thumbnail','icon','render','other']), year?: int 2015..currentYear+1 \| null, credit?: ≤ 40 (`/^[A-Za-z0-9_ .-]*$/` — a handle, never a real name/PII; helper copy states this), downloadable: boolean, status: draft\|published, sort_order: int}`; begin/commit fields per §1.4.5 with `size_bytes ≤ 10_485_760`, mime png/jpeg/webp. |
| Validation (commit) | Magic bytes; `sharp.metadata()` → `width`,`height` written by server (client-supplied ignored); max 8192 px per side. Images are stored as uploaded (no re-encode; natural aspect preserved — DESIGN.md §6 p.6). |
| Effects | Insert/update `art {image_path, width, height, …}`; old object deleted on replace. `revalidateTag('art')`. SC-24. |
| Returns | `{ok:true, data:{art}}`. Errors: `forbidden`, `validation`, `conflict`, `storage_error`, `rate_limited`. |
| Tests (05) | T-ACT-60, T-ACT-61 (`credit ≤ 40`, `year 2015..`), T-ACT-73; T-E2E-38. |

### 1.6 Mentions (S1.8)

#### `fetchMentionPreview`
| Item | Contract |
|---|---|
| Trigger | `/admin/mentions` paste URL → `MentionPreview`. Nothing stored. |
| Auth | `requireRole('admin')` (ADR-0002 C7). Rate limit `assertRateLimit('mention_preview', profile_id, 30, '1 minute')` (`rate_limit_hits`). |
| Input (`fetchMentionPreviewInput`) | `{url: z.string().url().max(2048)}` — scheme `https:` (or `http:` upgraded to https), host must not resolve to a private/loopback/link-local range (SSRF guard, checked after DNS in `adapters/oembed.assertPublicHost`), no credentials in URL. |
| Logic | §5.4 metadata chain. |
| Returns | `{ok:true, data:{platform, external_id, canonical_url, title, creator_name, creator_url, thumbnail_url, published_at, view_count, source:'oembed'\|'data_api'\|'og'}}`; unknown/unsupported → `{ok:false, error:{code:'upstream_error', message:"Couldn't read that page. You can fill the fields by hand."}}`. |
| Tests (05) | T-ACT-62 (mod = D `forbidden`); T-ADP-14, T-ADP-15, T-ADP-16; T-E2E-39. |

#### `createMention`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')` (ADR-0002 C7). |
| Input (`createMentionInput`) | `{url (as above), project_id: uuid \| null (null = "About OddSense generally"), platform: z.enum(['youtube','tiktok','twitch','reddit','article','other']), external_id?: ≤ 64, title: 1..200, creator_name: 1..80, creator_url?: URL, thumbnail_url?: URL, published_at?: iso, view_count?: int ≥ 0, status: z.enum(['draft','published']) default draft, featured: boolean, sort_order?: int}`. |
| Preconditions | `url` unique (canonicalised: strip `utm_*`, `si`, `feature` params; YouTube → `https://www.youtube.com/watch?v=<id>`) → `conflict`. `project_id` must exist (`validation`). |
| Effects | Insert `mentions {…, source:'manual', created_by: auth.uid()}`. `revalidateTag('mentions')`; if `project_id` → `revalidateTag('project:<slug>')`. SC-24. |
| Returns | `{ok:true, data:{mention}}`. Errors: `forbidden`, `validation`, `conflict`. Non-YouTube `thumbnail_url` is stored but the UI renders the `PlatformMark` placeholder (no remote fetch — ADR-0002 #33). Tests (05): T-ACT-63 (mod = D); T-RLS-104; T-E2E-39. |

#### `updateMention`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')` (ADR-0002 C7). |
| Input (`updateMentionInput`) | either `{id: uuid, patch: Partial<createMention input minus url> & {status?: draft\|published\|hidden}}` **or** `{reorder: [{id, sort_order:int}] max 200}` (drag-reorder; runs in one transaction). |
| Effects | Update; `revalidateTag('mentions')` + affected `project:<slug>` tags. Suggested-tab Approve (S2.4) = `patch.status='published'` on a `status='suggested'` row — never automatic. SC-24. |
| Returns | `{ok:true, data:{mention}}` / `{ok:true, data:{reordered:n}}`. Tests (05): T-ACT-64 (mod = D); T-RLS-103, T-RLS-105. |

### 1.7 Sync (S1.2)

#### `triggerSync`
| Item | Contract |
|---|---|
| Trigger | `SyncStatus` "Sync now" buttons in `/admin/projects` (and `sync-now` skill via cron route instead). |
| Auth | `requireRole('admin')` (ADR-0002 C7). |
| Input (`triggerSyncInput`) | `{source: z.enum(['modrinth','curseforge','youtube','mentions','stats']), full?: boolean}` (`full` only meaningful for `youtube` = walk the uploads playlist). `notify` is not triggerable here (the Test button covers Discord; email is exercised by real events). |
| Effects | Calls the job function directly (`lib/jobs/*`; 01 INV-72), not the HTTP route; job lock (SC-13) applies; writes `sync_runs`; job's own revalidations. SC-24. |
| Returns | `{ok:true, data:<JobSummary>}` or `{ok:false, error:{code:'conflict', message:'Already running.'}}` / `upstream_error`. |
| Tests (05) | T-ACT-42 (mod = D `forbidden`, admin = A), T-ACT-70 (lock); T-E2E-41. |

### 1.8 Videos (S1.6)

#### `updateVideo` (DECIDED — ADR-0002 #20: hide from the `/admin` dashboard video list; there is no `/admin/videos` route)
| Item | Contract |
|---|---|
| Trigger | `/admin` dashboard video list (Hide / Show, and `is_short` override toggle). |
| Auth | `requireRole('admin')`. |
| Input (`updateVideoInput`) | `{youtube_id: /^[A-Za-z0-9_-]{11}$/, hidden?: boolean, is_short?: boolean \| null}` — at least one of `hidden`/`is_short` present; `is_short: null` clears the override (heuristic §5.3 applies again). |
| Preconditions | Row exists → else `not_found`. |
| Effects | Update `videos.hidden` / `is_short` (service role); `syncYoutube` never overwrites `hidden`, and keeps an admin `is_short` override (§3.3 step 4). `revalidateTag('videos')`. SC-24 audit line. |
| Returns | `{ok:true, data:{youtube_id, hidden, is_short}}`. Errors: `forbidden`, `not_found`, `validation`. |
| Tests (05) | T-ACT-68. |

---

## 2. Route handlers

### 2.0 Sign-in (S1.1) — no route handler (DECIDED — ADR-0002 C3)
Sign-in is client-side: `GoogleSignInButton` (client leaf) calls `supabase.auth.signInWithOAuth({provider:'google', options:{redirectTo: `${NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(safeNext(currentPathAndHash))}`}})`. There is **no** `/auth/sign-in` route and no `signInWithGoogle` action; CSP `form-action 'self'` (the only POST form is sign-out). Analytics `sign_in` event per §5.6.

### 2.1 `/auth/callback` (S1.1) — `app/auth/callback/route.ts`, `GET` — DECIDED (ADR-0002 C18; 02 §4 mirrors this table)
| Step | Rule |
|---|---|
| A1 | Read `code`, `next` → `next = safeNext(next)` (`lib/auth.ts`, 02 RP-20: must start with `/`, not `//` or `/\`, not `/api`, `/auth`, `/admin`; else `/`). No `code` → 307 `/`. |
| A2 | `supabase.auth.exchangeCodeForSession(code)` (`@supabase/ssr` cookie client); on error → 307 `/` and `log.warn({action:'auth_callback', id, msg:'exchange_failed'})` (no error page, **no `?auth_error` param** — ADR-0002 C18). |
| A3 | Read `profiles.handle` (trigger has created the row); **if `profiles.email_hash` is null, set it = `emailHash(user.email)` (SC-17, `HASH_SECRET`) via the service client — the DB trigger cannot read env (ADR-0002 A14)**; then null handle → 307 `/welcome?next=<next>`; else → 307 `<next>` (same-origin only via `safeNext`). |
| A4 | Response carries the session cookies set by the SSR client; `Cache-Control: no-store`. |
| Tests (05) | T-ACT-8; T-ACT-10 (middleware); T-UNIT-44 (`safeNext`); T-E2E-21, T-E2E-46. |

### 2.2 `/auth/sign-out` (S1.1) — `app/auth/sign-out/route.ts`, `POST` only
Verify `Origin` (fallback `Referer`) host equals `NEXT_PUBLIC_SITE_URL` host (CSRF) else 403; `supabase.auth.signOut()` → 303 redirect `/`. `GET`/others → 405. Un-onboarded users may call it (02 RP-21). Tests (05): T-ACT-9; T-E2E-32.

### 2.3 `/api/download/[fileId]` (S1.3; kind `skin` from S1.7, ADR-0002 C8) — `app/api/download/[fileId]/route.ts`, `GET`, dynamic, nodejs (ADR-0002 C17)
| Step | Rule |
|---|---|
| D1 | `fileId` must be a uuid else 404. Methods: **GET only; HEAD/POST/others → 405** (ADR-0002 C17 — HEAD would double-count). |
| D2 | `lib/files.ts` `resolveDownloadable(id)` (generic — 01 INV-56; bucket + owner scope come from data): (a) `project_files f join project_versions v join projects p left join project_overrides o where f.id = $1` → require `f.storage_path IS NOT NULL` (synced Modrinth files have `url` and are never proxied), `p.status='published'`, `coalesce(o.hidden,false)=false` → `{kind:'project_file', bucket:'project-files', path, filename, counter:'record_download'}`; else (b) `skins where id = $1 and status='published'` → `{kind:'skin', bucket:'skins', path: texture_path, filename:'<slug>.png', counter:'record_skin_download'}`; else **404** (never 403; do not reveal drafts). S2.3 adds `workroom_files` + membership check here. |
| D3 | Rate limit: `assertRateLimit('download', ipHash, 30, '1 minute')` — counted on `rate_limit_hits` for both kinds (ADR-0002 A4; `project_downloads` is analytics only, never a limiter source) → **429**, `Retry-After: 60`, JSON body `{ok:false, error:{code:'rate_limited', message:'Slow down a little.'}}` (SC-03 / ADR-0002 C14, C17). |
| D4 | Counters + log in **one SQL statement**: `project_file` → RPC `record_download(p_file_id, p_ip_hash, p_ua_hash)` = `update project_files set download_count = download_count+1; update projects set downloads_direct = downloads_direct+1; insert project_downloads(project_id, file_id, ip_hash, ua_hash)` (single transaction, `security definer`, executable by service role only). `skin` → RPC `record_skin_download(p_skin_id)` = `update skins set downloads = downloads+1`. |
| D5 | `project_file`: `storage.from('project-files').createSignedUrl(path, 60, {download: filename})` → **60 s** TTL, `Content-Disposition: attachment; filename="<filename>"`. `skin`: public object URL + `?download=<filename>`. |
| D6 | Respond **302** `Location: <url>`, headers `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. |
| D7 | Analytics: the *client* button fires `track('download', …)` per §5.6 before navigating (03 `TrackedLink`); the route itself does no analytics call. |
| Errors | 404 (unknown/unpublished/synced), 405, 429, 500 `{ok:false, error:{code:'internal', message}}` (signed URL failure; counters already incremented — acceptable, logged). |
| Tests (05) | T-ACT-43 (HEAD/POST 405), T-ACT-44 (429 JSON + `Retry-After: 60`), T-ACT-76 (kind `skin`); T-RLS-117, T-RLS-118, T-RLS-129; T-UNIT-23 (HMAC per SC-17); T-E2E-31, T-E2E-46. |

### 2.4 Cron routes (S1.2, S1.5, S1.6, S1.8, S1.9) — `app/api/cron/<name>/route.ts`
All follow SC-12/SC-13 and are thin wrappers: `route → lib/jobs/<job>()`. Table in §6. Query params: `?full=1` (youtube only, admin/manual use). Each handler is also callable by `triggerSync` through the job function, never via internal HTTP.

| Route | Job | `sync_runs.source` |
|---|---|---|
| `/api/cron/sync-modrinth` | `syncModrinth` | `modrinth` |
| `/api/cron/sync-curseforge` | `syncCurseforge` | `curseforge` |
| `/api/cron/sync-youtube` | `syncYoutube` | `youtube` |
| `/api/cron/refresh-mentions` | `refreshMentions` | `mentions` |
| `/api/cron/stats-snapshot` | `snapshotStats` | `stats` |
| `/api/cron/notify` | `notifyFanOut` then `notifyDeliver` (one run row) | `notify` |

Tests (05): T-ACT-33 (GET only; POST → 405; 401 JSON; `maxDuration` 300/60), T-ACT-70 (lock `skipped:'running'`), T-ACT-71 (no-key runs), T-UNIT-24; T-E2E-43.

### 2.5 `/api/og` — **not in v1** (DECIDED — ADR-0002 #22)
No route. `metadata.openGraph.images` uses the static `public/brand/og-default.png` (02 RP-06). A dynamic OG route would be a Phase-2 addition (`runtime='nodejs'`, 01 INV-22).

### 2.6 `/api/webhooks/kofi` — Phase 2 (S2.1) — see §9.1.

---

## 3. Jobs (`lib/jobs/*.ts`)

Common signature: `export async function <job>(opts: {runId?: string, trigger: 'cron'\|'manual', full?: boolean}): Promise<JobSummary>` where `JobSummary = {ok: boolean, source, run_id, items: number, ms: number, error?: string, skipped?: string, [k: string]: unknown}`. Each job: acquire lock (SC-13) → insert `sync_runs` → work → finalize row (SC-11) → revalidate tags → on failure emit `sync.failed` per rule J-F below (**from S1.5** — `sync.failed`/`sync.stale` emission starts when `notifyFanOut` lands; jobs in S1.2 log the failure only via `log.error({job, id, msg})`, ADR-0002 A8) → return summary.

| # | Rule |
|---|---|
| J-F | `sync.failed` is **edge-triggered** (this doc owns the rule; 01 INV-71 defers to J-F/J-S; 05 T-ACT-74): emitted only when this run fails **and** the previous `sync_runs` row for the same `source` has `ok = true` (or none exists). Payload `{source, run_id, error(≤300), started_at}`. 05 T-ACT-45 must seed the previous run `ok=true` (SEED-12 does). |
| J-S | `sync.stale` is emitted by `notifyFanOut` step F0 for each source in `('modrinth', 'youtube', 'curseforge'*, 'mentions'**)` with no `sync_runs` row `ok=true` in the last **6 h**, at most once per 6 h per source (dedupe: last `sync.stale` event for `subject_id = source` older than 6 h). Excluded: `stats` (daily cadence — a 6 h window is meaningless), `notify` (it is the emitter), `skins` (script only). *`curseforge` only when `CURSEFORGE_API_KEY` is set and ≥ 1 `project_links` curseforge row exists. **`mentions` only when `YOUTUBE_API_KEY` is set and ≥ 1 YouTube mention exists. |
| J-P | Partial failure keeps old data: a per-item error is caught, counted in `summary.errors[]` (≤ 20 entries), and the run is `ok = false` only if the **list** call failed or > 50 % of items failed. |
| J-I | Idempotent: keys per job below; a run with unchanged upstream data changes no row except `synced_at`. |
| J-D | Jobs never `.delete(` synced rows (01 INV-24). The only deletions in `lib/jobs/` are `snapshotStats` housekeeping: RPC `purge_project_downloads(90)`, `purge_rate_limit_hits(1)` and Storage `remove()` of orphan objects (U1) — 01 INV-24's grep exempts these. |

### 3.1 `syncModrinth` (S1.2) — hourly
| Item | Contract |
|---|---|
| Idempotency key | `projects (source='modrinth', external_id)`; `project_versions.external_id` (Modrinth version id); `project_files (version_id, filename)`. |
| Steps | 1. `adapters/modrinth.listUserProjects(MODRINTH_USER)` → full Project objects. `/v2/user/{user}/projects` returns full Project objects (gallery, body, license, links included), so the per-project `GET /v2/project/{id}` in data-model §5 is unnecessary — verified against fixture `user-projects.json`. 2. For each object with `status in ('approved','archived')` (Modrinth status enum: `approved, archived, rejected, draft, unlisted, processing, withheld, scheduled, private, unknown` — only the first two are publicly listable): map (§5.2) → upsert `projects` sync-owned columns: `slug, project_type, title, description, body_md, icon_url, gallery[{url,title,description,ordering,featured}], categories (Modrinth categories ∪ additional_categories), loaders, game_versions, license (license.id), source_url, issues_url, discord_url, downloads_modrinth, followers, published_at, external_updated_at, status:'published', synced_at`. Never touch `project_overrides`. 3. `adapters/modrinth.listVersions(projectId)` → upsert `project_versions {external_id, version_number, name, changelog_md, game_versions, loaders, version_type, date_published, downloads}` and `project_files {filename, size_bytes, sha512 (hashes.sha512), url, primary, storage_path:null}`. Versions/files absent upstream are **not deleted** (DECIDED — ADR-0002 #66). 4. Any `projects (source='modrinth')` row whose `external_id` was not in the list this run → `status='hidden'` (never delete). Skipped only if step 1 failed. 5. Skipped Modrinth types (`modpack`, `shader`) counted in `summary.skipped`. |
| External calls | 1 list + N version calls (N ≈ 18) per run; ≤ 300 req/min limit is far away; sequential with 100 ms spacing. |
| Revalidate | `projects`; `project:<slug>` for every upserted/hidden slug (none on a no-change run). |
| Summary | `{items: upserted, hidden, skipped, versions, files, errors[]}`. |
| Tests (05) | T-ACT-45, T-ACT-46, T-ACT-47, T-ACT-48, T-ACT-49, T-ACT-50, T-ACT-51; T-ADP-1, T-ADP-2, T-ADP-3, T-ADP-4, T-ADP-5, T-ADP-6. |

### 3.2 `syncCurseforge` (S1.2) — hourly
| Item | Contract |
|---|---|
| Precondition | `CURSEFORGE_API_KEY` set; else summary `{ok:true, items:0, skipped:'not_configured'}`, `sync_runs.ok=true, error='not configured'` (01 env matrix wording), no `sync.failed`. |
| Idempotency key | `project_links (project_id, platform='curseforge')`. |
| Steps | For each `project_links` row platform `curseforge`: `adapters/curseforge.getMod(external_id)` → `downloads = data.downloadCount`, `url = data.links.websiteUrl` → update `project_links.downloads, synced_at` and `projects.downloads_curseforge`. Item error keeps old numbers (J-P). |
| Revalidate | `projects`; `project:<slug>` per changed row. |
| Tests (05) | T-ACT-52; T-ADP-7, T-ADP-8. |

### 3.3 `syncYoutube` (S1.6) — hourly
| Item | Contract |
|---|---|
| Idempotency key | `videos.youtube_id`. |
| Steps | 1. RSS `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}` (keyless) → ids, titles, published dates → upsert minimal rows (`title, published_at, thumbnail_url = https://i.ytimg.com/vi/<id>/hqdefault.jpg`). 2. If `YOUTUBE_API_KEY` set: `videos.list part=snippet,contentDetails,statistics id=<all known ids in batches of 50>` → `title, description, thumbnail_url (maxres ▸ standard ▸ high ▸ medium ▸ default), duration_seconds (ISO 8601 parse), view_count, like_count, published_at`. `is_short` per §5.3. 3. If `full` **or** `videos` table empty: walk `playlistItems.list part=contentDetails playlistId="UU"+channelId.slice(2)` (50/page) to collect all ids first. 4. Videos absent from a `full` walk are **not** deleted; `hidden` and an admin `is_short` override are owned by `updateVideo` (§1.8, ADR-0002 #20) and never overwritten by sync. |
| Quota | Per run: 1 RSS (0 units) + ceil(N/50) `videos.list` (1 unit each) ≈ 1 unit; `full` walk adds ceil(N/50) units. Daily ≈ 25–50 units of 10,000. If `YOUTUBE_API_KEY` missing → RSS-only, `summary.degraded='no_key'`, run `ok=true`. |
| Revalidate | `videos`. |
| Tests (05) | T-ACT-53; T-ADP-9, T-ADP-10, T-ADP-11, T-ADP-12, T-ADP-13; T-UNIT-29. |

### 3.4 `refreshMentions` (S1.8) — hourly
| Item | Contract |
|---|---|
| Steps | Select `mentions where platform='youtube' and external_id is not null and status in ('draft','published')` → `videos.list part=statistics id=<batches of 50>` → update `view_count`. Requires `YOUTUBE_API_KEY` (else `skipped:'not_configured'`, ok=true). Non-YouTube mentions are never refreshed in v1. |
| Idempotency | `mentions.id`; overwrite `view_count` only when API returns the id (missing id → unchanged). |
| Revalidate | `mentions`; `project:<slug>` for mentions whose `view_count` changed. |
| Tests (05) | T-ACT-54; T-ADP-13. |

### 3.5 `snapshotStats` (S1.9) — daily 03:00 UTC
| Item | Contract |
|---|---|
| Idempotency key | `stats_daily (day, metric, source, entity_type, entity_id)` — `insert … on conflict do update set value = excluded.value` (date-idempotent; re-run overwrites). `day` = UTC date of the run. Site-level rows use `entity_id = '00000000-0000-0000-0000-000000000000'` (sentinel — `_registry.md`, because PK columns cannot be null). |
| Metrics written (`stats_daily.metric` values per `_registry.md` Table registry) | (a) per project (`entity_type='project'`): `downloads/modrinth`, `downloads/curseforge`, `downloads/direct` = current totals; (b) site (`entity_type='site'`): `downloads/modrinth\|curseforge\|direct` = sums; `comments/odsens` = count `status='published'`; `comments_held/odsens` = count `status='held'`; `likes/odsens` = sum `like_count`; `users/odsens` = count `profiles where handle is not null` (aggregate count only, no ids — DECIDED ADR-0002 #68, flagged [DAVID]); `reach/youtube` = sum `mentions.view_count where status='published'`; `mentions/odsens` = count published; (c) per video (`entity_type='video'`): `views/youtube`, `likes/youtube`; (d) channel (`entity_type='channel'`, entity sentinel): `views/youtube`, `subs/youtube` from `channels.list part=statistics id=${YOUTUBE_CHANNEL_ID}` (1 unit; skipped if no key); (e) `direct_downloads_day/direct` per project for **day − 1** = count of `project_downloads` rows on that UTC day; (f) `tips/kofi` site = 0 in v1 (S2.1 fills from `kofi_events`). |
| Housekeeping | RPC `purge_project_downloads(90)` (deletes `project_downloads where created_at < now() - interval '90 days'`, 01 INV-50); RPC `purge_rate_limit_hits(1)` (rows older than 1 day); orphan Storage objects per U1 (older than 24 h, no referencing column) removed via `storage.remove()`, capped at `ORPHAN_CLEANUP_MAX` (§5.8, default 200) per run — logged in summary. |
| Revalidate | none (admin stats page is dynamic). |
| Tests (05) | T-ACT-45, T-ACT-55, T-ACT-75 (orphan cleanup, S1.9). |

### 3.6 `notifyFanOut` (S1.5) — every 5 min (step 1 of `/api/cron/notify`)
| Step | Rule |
|---|---|
| F0 | Stale check (J-S) — emits `sync.stale` events before fan-out. |
| F1 | Select `notification_events e where not exists (select 1 from notification_recipients r where r.event_id = e.id) and e.created_at > now() - FANOUT_WINDOW_DAYS` order by `created_at` limit `FANOUT_BATCH` (§5.8; defaults 7 d / 500). |
| F2 | For each event: for each channel in `('email','discord')`: `enabled = coalesce((select enabled from notification_matrix where kind = e.kind and channel = c), false)`. **email**: if enabled and `site_settings.admin_notify_emails` non-empty → one row per address `{event_id, profile_id:null, channel:'email', address, status:'pending', attempts:0}`; else one row `{channel:'email', address:null, status:'skipped'}`. **discord**: if enabled and `site_settings.discord_webhook_url` non-empty → one row `{channel:'discord', address: <the webhook URL>, status:'pending'}` (docs/notifications.md Pipeline 2 "address = webhook"; the value is masked to `…<last 4>` in every admin view and never logged — INV-43); else `status:'skipped'`. Kinds absent from the matrix (`comment.reply`, `comment.approved`, P2 kinds) → both rows `skipped`. |
| F3 | Result: every event has ≥ 2 recipient rows after F2 → F1 never re-selects it (idempotency key = `(event_id, channel, coalesce(address,''))`; unique index in schema, data-model §2). |
| Tests (05) | T-ACT-29 (Discord `address` = webhook URL, masked — ADR-0002 C9; matrix OFF → skipped rows; run twice → no duplicates), T-ACT-32. |

### 3.7 `notifyDeliver` (S1.5) — same tick (step 2)
| Step | Rule |
|---|---|
| N1 | Eligible = `status='pending' and attempts < 5 and (attempts = 0 or updated_at <= now() - backoff(attempts))`, `backoff(a) = 5 min × 2^(a−1)` (5, 10, 20, 40, 80 min). Order `created_at asc`, limit `DELIVER_BATCH` per tick (§5.8, default 100). |
| N2 | Group **per channel** (email: per `address`; discord: one group) — refines notifications.md "per channel". If a group has **> 5** eligible rows → one **digest** message (subject/title "N things from the allay", list of kind + target + excerpt, link `/admin/comments` or `/admin/settings`); else one message per row. |
| N3 | Send via `lib/notify/deliver/email.ts` (`adapters/resend`) or `deliver/discord.ts` (`adapters/discord`, URL = the row's `address`) — both implement `Deliverer = (rows: RecipientRow[], ctx) => Promise<{sent: string[], failed: {id, error}[]}>`. Timeout 10 s per call (SC-09), retries per SC-09 inside a single attempt. |
| N4 | Mark: sent → `status='sent', sent_at=now(), attempts+1`; failed → `attempts+1, error(≤500)`; `status='failed'` when `attempts` reaches 5 (max 5 — notifications.md). Digest marks all its rows together. |
| N5 | Email content: React Email templates in `emails/` (`CommentNew`, `CommentHeld`, `CommentReported`, `SyncFailed`; digest uses `EmailLayout` with a list) + plain-text alternative always; From `odsens <${NOTIFY_FROM_EMAIL}>`; `Reply-To` = `NOTIFY_FROM_EMAIL` **only after** inbound forwarding exists (questions.md setup to-do; until then no Reply-To header); subject formats: `comment.new` "New comment on <target title>" · `comment.held` "Held for review: <target title>" · `comment.reported` "Reported comment on <target title>" · `sync.failed` "Sync failed: <source>" · `sync.stale` "Sync stale: <source>" · digest "<N> things from the allay" (05 T-UNIT-26). Every email footer: "The allay emails you because <switch> is on." + link `${NEXT_PUBLIC_SITE_URL}/admin/settings`. |
| N6 | Discord embed (§4.6): `username:'allay'`, `avatar_url: ${SITE_URL}/brand/allay.png` (asset pending Q44 — omit field until the file exists), embed `{title: '<Event> — <target title>', description: excerpt(200), url: link, color}` with color indigo `0x4B45D6` default · gold `0xFFC61F` for `comment.held`/`comment.reported` · alert `0xCC3A2A` for `sync.failed`/`sync.stale`. |
| N7 | Missing provider config at send time (`RESEND_API_KEY` unset / row `address` empty) → rows marked `failed` immediately with `error='not_configured'` (no retries). |
| Summary | `{items: sent, failed, digests, skipped}`. |
| Tests (05) | T-ACT-30, T-ACT-31, T-ACT-72 (`not_configured`); T-ADP-17, T-ADP-18, T-ADP-19; T-UNIT-3, T-UNIT-26. |

### 3.8 `renderSkinBust` (S1.7) — on skin create/update (awaited by action) + `scripts/render-skins.mjs` for backfill
| Item | Contract |
|---|---|
| Input | `skin_id`. Reads `skins.texture_path`, `model`. |
| Logic | Render a 3:4 bust PNG (default 600×800 px, transparent background) → **output ≤ 512 KB** (data-model §3; re-encode with `sharp` `png({compressionLevel:9, palette:true})` if larger) → upload `skins/{skin_id}/bust.png` (`upsert:true`) → set `render_bust_path`. Timeout 20 s. On failure: log, leave `render_bust_path` unchanged, return `{ok:false}` — never throws to the caller. Renderer: **DECIDED (ADR-0002 C22, #26)** — `skinview3d` on headless WebGL (`gl` package) in `lib/skins/render.ts`; the native dependency gets its dependency ADR at S1.7 (ADR-R5); fallback = client render + cache on first view. |
| Idempotency | Path is fixed per skin; re-render overwrites. Writes a `sync_runs` row `source='skins'` **only** when run from the script (batch), not per action call. |
| Tests (05) | T-ACT-56 (path per SC-21; size ≤ 512 KB; failure non-fatal), T-UNIT-45 (`scripts/render-skins.mjs` idempotency — ADR-0002 #80). |

---

## 4. Adapters (`lib/adapters/*.ts`) — pure I/O + mapping; no DB access

| Adapter | Base URL (overridable in tests only via `*_API_BASE`, ADR-0002 #73) | Auth | Functions (export names — `_registry.md`) | Timeout / retry | Quota / limits | Fixtures |
|---|---|---|---|---|---|---|
| **4.1 `modrinth`** (`createModrinth`) | `https://api.modrinth.com/v2` | none; `User-Agent` SC-10 **required** | `listUserProjects(user)` → `GET /user/{user}/projects` · `listVersions(projectId)` → `GET /project/{id}/version` · `mapProject(raw) → ProjectRow` (§5.2) · `mapVersion(raw) → {version, files[]}` · `mapProjectType(project_type, loaders)` | SC-09 | 300 req/min; honour `X-Ratelimit-Remaining/Reset` (sleep until reset when remaining < 5) | `tests/fixtures/modrinth/user-projects.json`, `versions.json`, `project-shader.json`, `error-429.json` |
| **4.2 `curseforge`** (`createCurseforge`) | `https://api.curseforge.com/v1` | header `x-api-key: ${CURSEFORGE_API_KEY}` | `getMod(id)` → `GET /mods/{id}` → `{id, slug, downloadCount, links.websiteUrl}` · `searchBySlug(slug)` → `GET /mods/search?gameId=432&slug={slug}&pageSize=5` → first `data[]` whose `slug` equals · `parseRef(ref)` → `{id}\|{slug}` | SC-09 | key-scoped; unknown → treat as ≥ 60 req/min: sequential calls only | `curseforge/mod.json`, `search.json`, `error-403.json`, `error-404.json` |
| **4.3 `youtube`** (`createYoutube`) | RSS `https://www.youtube.com/feeds/videos.xml` · Data API `https://www.googleapis.com/youtube/v3` | RSS none · Data API `key=${YOUTUBE_API_KEY}` (redacted from errors/logs) | `fetchRss(channelId)` → `[{youtube_id, title, published_at, thumbnail_url, description}]` · `listVideos(ids[])` (batches ≤ 50, `part=snippet,contentDetails,statistics`) · `listUploads(channelId)` (playlistItems paging) · `channelStats(channelId)` · `parseDuration(iso8601) → seconds` · `pickThumbnail(thumbnails)` · `isShort(v)` (§5.3) · `mapVideo(item)` · `oembed(url)` → `GET https://www.youtube.com/oembed?url=<enc>&format=json` (no key) · `videoIdFromUrl(url)` (handles `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`) · exposes `unitsUsed` | SC-09 | 10,000 units/day; each `list` call 1 unit | `youtube/rss.xml`, `rss-malformed.xml`, `videos-list.json`, `videos-mentions.json`, `playlist-items.json`, `oembed.json`, `channels.json` |
| **4.4 `oembed`** (`createOembed`) | any | none | `fetchOpenGraph(url)` → GET with UA, `Accept: text/html`, follow ≤ 3 redirects (each hop re-checked by SSRF guard), read ≤ 1 MB, parse `og:title, og:image, og:site_name, og:url, og:type, article:published_time, <title>` → `{title, image, site_name, canonical, published_at, og_type}` · `assertPublicHost(url)` → resolves DNS; rejects loopback, RFC1918, link-local, CGNAT, IPv6 ULA/loopback, `.local`; rejects non-`http(s)`; rejects userinfo · `detectPlatform(url)` → hostname map: `youtube.com\|youtu.be → youtube`, `tiktok.com → tiktok`, `twitch.tv\|clips.twitch.tv → twitch`, `reddit.com\|redd.it → reddit`, else `article` (05 T-ADP-16; the admin can change the platform in the form; `other` is reachable by hand) | 10 s, **no retry** (interactive) | — | `oembed/og-page.html` |
| **4.5 `resend`** (`createResend`) | `https://api.resend.com` via `resend` SDK | `RESEND_API_KEY` | `sendEmail({to, subject, react, text, from, replyTo?, headers:{'X-Entity-Ref-ID': recipient_row_id}})` → `{id}`; `from` defaults `odsens <${NOTIFY_FROM_EMAIL}>` (05 T-ADP-17; the template → `react`/`text` mapping lives in `deliver/email.ts`) | 10 s; retry per SC-09 (Resend 429) | free tier 3k/mo; ≤ 2 req/s → deliverer sends sequentially | `resend/send-ok.json` (mocked SDK) |
| **4.6 `discord`** (`createDiscord`) | webhook URL passed per call (the row's `address` / the tested URL) | URL is the secret; never logged; regex in §1.3 | `postEmbed(url, {title, description, url?, color, fields?})` → `POST {url}?wait=true` body `{username:'allay', avatar_url?, embeds:[…]}` → `{status}`; 429 → respect `retry_after` (ms) once (05 T-ADP-18) | 10 s; SC-09 | Discord webhook ~30 req/min per webhook — deliverer sends ≤ `DISCORD_PER_TICK` (§5.8, default 20) per tick | `discord/webhook-ok.json` |

Adapter rules: A1 adapters never import Supabase; A2 every adapter function is tested only against fixtures (no live calls in CI, `test-engineer` policy); A3 mapping functions are pure and exported for T-UNIT/T-ADP tests; A4 raw error bodies from upstream are truncated to 300 chars before storage/logging; A5 factory `create<Adapter>({fetch, env})` (SC-25). Tests (05): T-ADP-1, T-ADP-20 for all adapters.

---

## 5. Decision tables

### 5.1 Comment moderation — status on insert (`postComment`) and after reports (`reportComment`)
Inputs: `mode = site_settings_public.moderation_mode` (read via the RLS server client — ADR-0002 A3; the trigger `comments_set_status()` reads `site_settings` directly), `first = (profiles.comment_count = 0)`, `role = author role`, `banned`, `reports = unresolved report count`.

| # | banned | role | mode | first-time | reports ≥ 3 | Resulting status / outcome | Event |
|---|---|---|---|---|---|---|---|
| M1 | yes | any | any | any | — | rejected `banned` (no row) | — |
| M2 | no | moderator/admin | any | any | — | `published` ¹ | `comment.new` |
| M3 | no | user | `auto` | any | — | `published` | `comment.new` (+`comment.reply` if reply) |
| M4 | no | user | `hold_first_time` | yes | — | `held` (author sees `HeldNotice`; mods see `FIRST COMMENT` tag) | `comment.held` (`payload.reason='first_time'`) |
| M5 | no | user | `hold_first_time` | no | — | `published` | `comment.new` |
| M6 | (existing published comment) | any non-mod | any | — | yes | `held` (auto-hold, `moderated_by=null`) | `comment.held` (`reason='reports'`) + `comment.reported` |
| M7 | (existing published comment) | moderator/admin author | any | — | yes | stays `published` ¹ | `comment.reported` only |
| M8 | (held/hidden/deleted comment) | — | — | — | any | reports accepted (unique) but no status change | `comment.reported` |

¹ M2/M7 role exemption is a build decision not in data-model §2.5 (05 T-UNIT-6 `decideCommentStatus` takes `authorRole`, so 05 assumes it); recorded here and in data-model §2.5 ("moderators/admins are never held or auto-held"); the trigger `comments_set_status()` applies the same table (ADR-0002 #72). `hidden` and `deleted` are reachable only via `moderateComment`/`deleteComment` (§1.2). Approving M4/M6 → `published` + `comment.approved`. Tests (05): T-ACT-14, T-ACT-22, T-UNIT-6, T-UNIT-7.

### 5.2 Modrinth `project_type` mapping (`adapters/modrinth.mapProjectType`)
Constants: `PLUGIN_LOADERS = {paper, spigot, bukkit, purpur, folia, velocity, bungeecord, waterfall, sponge}`, `MOD_LOADERS = {fabric, forge, neoforge, quilt, liteloader, rift, modloader}`.

| # | Modrinth `project_type` | `loaders` condition (evaluated in order, first match wins) | → `projects.project_type` |
|---|---|---|---|
| P1 | `resourcepack` | any | `resourcepack` |
| P2 | `mod` | non-empty and every loader ∈ `{datapack}` | `datapack` |
| P3 | `mod` | ∩ `PLUGIN_LOADERS` ≠ ∅ **and** ∩ `MOD_LOADERS` = ∅ | `plugin` |
| P4 | `mod` | anything else (incl. `fabric+datapack`, empty) | `mod` |
| P5 | `modpack`, `shader`, other | — | **skipped** (not imported; `summary.skipped++`) |

Examples (05 T-ADP-2; resolves 05 OPEN-7 = P4): Heavy Spear datapack `[datapack]` → datapack · Legacy Manhunts Reworked `[paper]` → plugin · Pixel Chameleon `[fabric]` → mod · Metal Pipe Mace `resourcepack` → resourcepack · hypothetical `[fabric, datapack]` → mod · `[paper, fabric]` → mod.

### 5.3 YouTube Shorts heuristic (`adapters/youtube.isShort`) — DECIDED (ADR-0002 #67)
Rule (matches data-model §2.3): `is_short = duration_seconds <= 60 || /\B#shorts\b/i.test(title + ' ' + description)`. Rows: `PT45S` no tag → true · `PT61S` no tag → false · `PT2M` with `#Shorts` in description → true · `PT10M` → false · `duration_seconds` null → false. Refinement (e.g. `HEAD https://www.youtube.com/shorts/<id>` 200-vs-redirect probe, or duration ≤ 180 s) requires an ADR with slug `shorts-detection` (number assigned per 06 README). Admin override of `is_short` = `updateVideo` (§1.8). Tests (05): T-ADP-11.

### 5.4 Mention metadata fetch chain (`fetchMentionPreview`)
| Step | Condition | Call | Fields taken | On failure |
|---|---|---|---|---|
| 1 | always | `oembed.assertPublicHost(url)` | — | `upstream_error` (SSRF) |
| 2 | `detectPlatform(url) = youtube` | `youtube.oembed(url)` (keyless) | `title, author_name → creator_name, author_url → creator_url, thumbnail_url`; `external_id = videoIdFromUrl(url)`; `canonical_url = https://www.youtube.com/watch?v=<id>` | continue to 3 |
| 3 | youtube and `YOUTUBE_API_KEY` set | `youtube.listVideos([id])` | `view_count = statistics.viewCount, published_at = snippet.publishedAt`; fills any field missing from 2 (title, channelTitle → creator_name, `https://www.youtube.com/channel/<channelId>` → creator_url, best thumbnail) | continue to 4 with what we have |
| 4 | any platform (non-YouTube always; YouTube only if 2 **and** 3 both failed) | `oembed.fetchOpenGraph(url)` | `title ← og:title\|<title>`, `thumbnail_url ← og:image`, `creator_name ← og:site_name` (admin edits), `canonical_url ← og:url\|url`, `published_at ← article:published_time` | `upstream_error` (admin fills by hand) |
| 5 | always | normalise: trim, title ≤ 200, creator ≤ 80, https-only thumbnail | return `data.source` = highest step that supplied `title` | — |

TikTok/Twitch/Reddit have their own oEmbed endpoints; **not used in v1** (spec: "Open Graph elsewhere"); adding one = adapter change, no ADR (A-rules) but a 05 fixture.

### 5.5 Rate-limit summary (SC-08; all via `assertRateLimit(scope, key, max, window)` → `rate_limit_ok`)
| Where | scope | Rule | Counted on |
|---|---|---|---|
| `postComment` | `comment`, `comment_day` | 5 / min and 50 / 24 h per user | `rate_limit_hits` (ADR-0002 A4) |
| `editComment` | `comment_edit` | 20 / min per user | `rate_limit_hits` |
| `deleteComment` (author) | `comment_delete` | 20 / min per user | `rate_limit_hits` |
| `reportComment` | `report` | 10 / h per user | `rate_limit_hits` (ADR-0002 A4) |
| `toggleLike` | `like` | 60 / min per user | `rate_limit_hits` (ADR-0002 A4) |
| `/api/download/[fileId]` | `download` | 30 / min per `ip_hash` | `rate_limit_hits` (both kinds — ADR-0002 A4) |
| `completeOnboarding` | `onboarding` | 10 / 10 min per user | `rate_limit_hits` |
| `checkHandle` | `check_handle` | 60 / min per user | `rate_limit_hits` |
| `updateProfile` handle | — | 1 / 7 d per user (ADR-0002 #27) | `profiles.handle_changed_at` |
| `updateProfile` avatar | `avatar` | 10 / 10 min per user | `rate_limit_hits` |
| `deleteAccount` | `delete_account` | 1 / day per user | `rate_limit_hits` |
| uploads (`begin`) | `upload:project-media`, `upload:art`, `upload:project-files` | 60 / h media, 60 / h art, 30 / h files, per admin | `rate_limit_hits` (a `begin` counts even without commit) |
| `setProjectLink` | `project_link` | 30 / h per user | `rate_limit_hits` |
| `fetchMentionPreview` | `mention_preview` | 30 / min per user | `rate_limit_hits` |
| `testDiscordWebhook` | `discord_test` | 10 / min per user | `rate_limit_hits` |
| `triggerSync` | — | lock SC-13 | `sync_runs` |
| `skins`/`art` create/update | `upload:skins`, `upload:art` | 60 / h per admin | `rate_limit_hits` |

`rate_limit_hits` (created S1.1, service-role only — ADR-0002 #14) is the **only** table `rate_limit_ok` counts, and every row above records a hit per call (ADR-0002 A4; the `updateProfile` handle row and `triggerSync` lock are not `rate_limit_ok` scopes). Purged by `snapshotStats` (`purge_rate_limit_hits(1)`). 01 INV-69's surface list = this table verbatim (05 T-UNIT-37 asserts `SCOPES`). Copy for `rate_limited`: "Slow down a little." (01 INV-69).

### 5.6 Analytics events — client-side `track()` payload contract (01 INV-59; DECIDED — ADR-0002 C12; fired by 03 `TrackedLink` / `VideoFacade` / `GoogleSignInButton`)
| Event | Payload keys (all strings/numbers; **no handles, ids of users, or emails**) | Fired by |
|---|---|---|
| `download` | `{project: <slug>, source: 'modrinth'\|'curseforge'\|'direct', from: 'get-it'\|'hero'\|'versions'\|'skin'}` (skins: `{project:'skin:<slug>', source:'direct', from:'skin'}`) | `GetItPanel`, `FeaturedHero`, `VersionsTable`, `SkinCard` DOWNLOAD PNG |
| `tip_click` | `{amount?: 1\|3\|5\|'other', from: 'support'\|'tip-panel'\|'floating'}` (binding shape — ADR-0002 A16; `amount` = the chosen preset, or the literal `'other'` when the "Other" input is used — the typed value is never sent; absent when no amount is chosen yet, e.g. `FloatingSupportButton`, `TipPanel`). The nav Support button is a plain `<a href="/support">` and emits nothing (03 N-04) | `AmountPicker` (`support`), `TipPanel` (`tip-panel`), `FloatingSupportButton` (`floating`) |
| `video_play` | `{youtube_id: <id>, kind: 'video'\|'short'\|'mention'}` (`kind` = what is playing, not the placement — an up-next row plays a `video`; there is no `upnext` kind) | `VideoFacade` on play (all variants) |
| `sign_in` | `{from: 'nav'\|'prompt'\|'admin'}` (`nav` = Nav sign-in, `prompt` = `SignInPrompt` in a comment thread, `admin` = `AdminGate`) | `GoogleSignInButton` |
| (rejected) `external_out` | not a v1 event — the union is exactly the four names above | — |
Rule: `track()` is called only from `components/**` client leaves via `lib/analytics.ts` `trackEvent(name, props)` (typed union of the four names); the value sets above **are** the runtime allowlist (`TrackProps` in `lib/analytics.ts`; 03 `TrackedLink` mirrors this table verbatim — this doc owns it, ADR-0002 C12/C16; 03 v0.3.1 already matches); test 05 T-UNIT-38 (event names/keys) — 05 T-E2E-49 must observe `from:'floating'` (see §12).

### 5.7 Ko-fi handoff (`/support`, S1.9; DECIDED — ADR-0002 C19, #50)
| Item | Rule |
|---|---|
| Page name | **`site_settings.kofi_page`** read through the view `site_settings_public` (`lib/data/settings.ts`); `/support` is ISR and carries tag `settings`. Env `KOFI_PAGE` seeds the row only (SC-16). |
| CONTINUE ON KO-FI | Mounts the `KofiPanelSlot` iframe **in place** (no new tab): `https://ko-fi.com/<kofi_page>/?hidefeed=true&widget=true&embed=true`, 712/620 px, click-to-load, `/support` only (CSP `frame-src`). The chosen amount is **not** passed in v1 (no documented preset-amount URL param — ADR-0002 #50: verify when the account exists; if one appears, `lib/support.ts` `kofiUrl(page, amount)` + a T-UNIT). |
| "on Ko-fi ↗" ghost link | Opens `https://ko-fi.com/<kofi_page>` in a new tab (`rel="noopener noreferrer"`). |
| Empty `kofi_page` | picker + button disabled, mute line "Tips open soon.", panel slot hidden (00 S1.9.AC4; DESIGN.md §12.7 build clarifications — not the C20 placeholder copy). |
| Server side | none in v1 (no action/route); S2.1 adds §9.1. |

### 5.8 Operational defaults (tunable **without** ADR; constants in `lib/jobs/constants.ts` and `lib/notify/constants.ts`; ADR-R6 numbers are the *rules* above — cadences, retry max 5, digest > 5, caps — not these)
| Constant | Default | Used by |
|---|---|---|
| `JOB_LOCK_MINUTES` | 15 | SC-13 |
| `FANOUT_WINDOW_DAYS` / `FANOUT_BATCH` | 7 / 500 | §3.6 F1 |
| `DELIVER_BATCH` | 100 per tick | §3.7 N1 |
| `DISCORD_PER_TICK` | 20 | §4.6 |
| `ORPHAN_CLEANUP_MAX` / `ORPHAN_MIN_AGE_HOURS` | 200 / 24 | U1, §3.5 |
| `UPLOAD_TOKEN_HOURS` | 2 | §1.4.5 |
| `MODRINTH_CALL_SPACING_MS` | 100 | §3.1 |
| `RENDER_TIMEOUT_MS` | 20000 | §3.8 |

---

## 6. `vercel.json` cron table (S0 empty list → filled per slice; this doc fixes the strings — 00 §4.1; 02 §1.4 copies them verbatim)

| Path | Schedule (UTC cron) | Added in | Notes |
|---|---|---|---|
| `/api/cron/sync-modrinth` | `7 * * * *` | S1.2 | hourly, :07 |
| `/api/cron/sync-curseforge` | `17 * * * *` | S1.2 | hourly, :17 (offset from Modrinth) |
| `/api/cron/sync-youtube` | `27 * * * *` | S1.6 | hourly, :27 |
| `/api/cron/refresh-mentions` | `37 * * * *` | S1.8 | hourly, :37 |
| `/api/cron/stats-snapshot` | `0 3 * * *` | S1.9 | daily 03:00 UTC (data-model §5) |
| `/api/cron/notify` | `*/5 * * * *` | S1.5 | every 5 min |

Rules: V1 `vercel.json` `crons[]` entries are exactly `{path, schedule}` from this table (deploy-checker compares). V2 Vercel sends `Authorization: Bearer ${CRON_SECRET}` — routes accept nothing else (SC-12). V3 Preview deployments do not run crons; manual pings use the same header. V4 Changing a schedule = ADR-R6. V5 `maxDuration` per SC-12 (300 / 60 — ADR-0002 C15).

---

## 7. Error code list (`lib/actions/result.ts` `ActionErrorCode` union — exhaustive; 05 uses these names verbatim)

| Code | HTTP (route handlers) | Meaning / user copy owner |
|---|---|---|
| `unauthenticated` | 401 | no session → UI shows `SignInPrompt` |
| `unauthorized` | 401 | cron secret missing/wrong (route handlers only) |
| `onboarding_required` | 403 | handle null → redirect `/welcome` |
| `forbidden` | 403 | role/ownership/CSRF check failed |
| `banned` | 403 | `profiles.is_banned` — UI "You can't comment here." |
| `not_found` | 404 | target/row missing or not visible to caller (never distinguishes draft vs absent) |
| `validation` | 400 | zod failure; `error.issues[]` |
| `too_many_links` | 400 | B3 — "That didn't post. Too many links." |
| `comments_closed` | 409 | comments disabled on target |
| `edit_window_expired` | 409 | > 15 min |
| `handle_taken` / `handle_reserved` | 409 | `HandleField` invalid state copy |
| `conflict` | 409 | unique violation / illegal transition / already running |
| `precondition_failed` | 409 | publish requirements (ADR-0002 #65) |
| `rate_limited` | 429 | SC-08 — "Slow down a little." (route handlers: JSON body + `Retry-After: 60`, ADR-0002 C14) |
| `upstream_error` | 502 | external API failed (message is safe to show) |
| `storage_error` | 500 | Storage upload/signing failed |
| `job_failed` | 500 | cron route wrapping a failed job |
| `internal` | 500 | unexpected; logged with `id` |

---

## 8. Tests map — 04 contract → 05 test IDs (05 owns the IDs, 00 rule 0.5; this doc introduces none)

| 04 contract | 05 IDs |
|---|---|
| SC-02/SC-03 shape, never throws | T-ACT-0 |
| SC-13 lock · SC-16 no-key runs · SC-24 audit line | T-ACT-70 · T-ACT-71 · T-ACT-69 |
| §1.1 accounts | T-ACT-1…7, 65 (`deleteAccount`); T-RLS-5, 6, 8; T-UNIT-1, 2, 44 (`safeNext`); T-E2E-21, 22, 23 |
| §1.2 comments | T-ACT-11…24, 67 (`renameUserHandle`); T-RLS-67…78, 80, 83, 84, 86, 87, 128 (`comments_public`), 131 (`comments_set_status`), 133 (`can_comment()` matrix); T-UNIT-4…8, 40 (`commentErrorLine`); T-E2E-24…28, 36 |
| §1.3 settings | T-ACT-25…28, 66 (`setUserRole`); T-RLS-12, 14, 132 (`site_settings_public` column set); T-UNIT-25, 27, 28, 41; T-E2E-37 |
| §1.4 projects, uploads (§1.4.5 U1–U3) | T-ACT-34…41, 73; T-RLS-17, 19, 41, 42, 117, 119; T-UNIT-17, 18, 20, 22, 36; T-E2E-34, 35 |
| §1.5 skins, art | T-ACT-56…61, 73; T-UNIT-19, 45 (`render-skins.mjs`); T-RLS-54; T-E2E-38 |
| §1.6 mentions | T-ACT-62…64; T-ADP-14…16; T-RLS-103…105; T-E2E-39 |
| §1.7 triggerSync · §1.8 updateVideo | T-ACT-42, 70; T-E2E-41 · T-ACT-68 |
| §2.1–2.2 auth routes | T-ACT-8, 9, 10; T-E2E-32, 46 |
| §2.3 download route | T-ACT-43, 44, 76 (kind `skin`); T-RLS-117, 118, 129; T-UNIT-23; T-E2E-31, 46 |
| §2.4 cron auth | T-ACT-33; T-UNIT-24; T-E2E-43 |
| §3 jobs | T-ACT-45…56, 70…75; T-ADP-1…13, 20 |
| §3.6–3.7 notify | T-ACT-29…32, 72, 74 (J-F edge); T-ADP-17…19; T-UNIT-3, 26 |
| §5.1 moderation table | T-ACT-14, 22; T-UNIT-6, 7; T-RLS-131 |
| §5.2 mapping | T-ADP-2; T-ACT-47 |
| §5.3 shorts | T-ADP-11 |
| §5.5 rate-limit scopes | T-UNIT-37; T-RLS-130 (`rate_limit_hits`) |
| §5.6 analytics | T-UNIT-38 |
| §5.7 Ko-fi (`/support`) | T-E2E-11, T-E2E-49 (`FloatingSupportButton`/`TipPanel`) |
| SC-15 log redaction · SC-16 env | T-UNIT-33 · T-UNIT-16, T-UNIT-35 |
| Gaps (unnumbered) | §11.3 |

Coverage rule: every action in §1.0 has ≥ 1 T-ACT auth-matrix test (anon/user/banned/mod/admin); every job has a run-twice idempotency test; every adapter has a fixture mapping test.

---

## 9. Phase 2 stubs (detail when the slice opens)

### 9.1 `/api/webhooks/kofi` (S2.1) — `POST`, `application/x-www-form-urlencoded`, field `data` = JSON
| Item | Contract |
|---|---|
| Verify | `data.verification_token` vs `KOFI_WEBHOOK_VERIFICATION_TOKEN` with `timingSafeEqual` (length-checked first) → else **401**; missing env → 503 (never accept). |
| Dedupe | idempotency key `kofi_events.kofi_message_id = data.message_id` (unique) → duplicate → **200** `{ok:true, duplicate:true}` and no side effects. |
| Effects | Insert `kofi_events {type, from_name, message, amount (numeric from string), currency, is_public, email_hash = emailHash(data.email), timestamp, raw (email removed)}` — raw email is **never** stored. Link: `profiles.email_hash` match → else `@handle` regex `/@([A-Za-z0-9_]{3,20})/` in `message` → `supporters {kofi_event_id, profile_id}`; else unlinked. Emit `tip.new` (payload: amount, currency, handle\|null — no names, no email). Never trust `amount` for anything privileged. |
| Response | 200 `{ok:true}` within 10 s; body ≤ 64 KB; other methods 405; `runtime='nodejs'`. |
| Tests | §11.3 unnumbered (bad token 401; replay dedupe; linking chain; fixture `kofi/donation.json`). |

### 9.2 Others
- **S2.2** `createOrder` (`orders`, rate limit 3 / day / user, `order.new` event, `/commissions` visible) · **S2.3** workroom actions (`createWorkroom`, `postWorkroomUpdate`, `uploadWorkroomFile` via §1.4.5 with allowlist png/jpg/webp/zip/txt/md/pdf, 25 MB/file, 200 MB/room; `/api/download/[fileId]` gains kind `workroom_file` (bucket `workroom-files`) + membership check through `resolveDownloadable`; `workroom.*` events to members with `email_updates`) · **S2.4** `syncMentionsSuggested` cron (YouTube `search.list` per project title + "OddSense", 100 units/call — budget cap 2,000 units/day; inserts `status='suggested'`, `mention.suggested` event) · **S2.5** deliverer `inapp` reading `notification_recipients`.

---

## 10. Open — all settled (ADR-0002); kept for ID stability

| # | Item | Decision |
|---|---|---|
| OPEN-1 | Reserved handle list | **DECIDED (ADR-0002 #63)** — the 22-entry list in §1.1 H3 |
| OPEN-2 | Own handle rename vs RLS null→value | **DECIDED (ADR-0002 #27)** — `updateProfile` via service client, 1 / 7 days, `profiles.handle_changed_at` |
| OPEN-3 | `banUser` cascade | **DECIDED (ADR-0002 #64)** — none in v1 |
| OPEN-4 | Rate-limit source without a natural table (= 01 O-4) | **DECIDED (ADR-0002 #14)** — `rate_limit_hits` + `rate_limit_ok` + `purge_rate_limit_hits`, created S1.1 |
| OPEN-5 | `publishProject` preconditions | **DECIDED (ADR-0002 #65)** — icon + ≥ 1 version with ≥ 1 file |
| OPEN-6 | Upstream-removed Modrinth versions | **DECIDED (ADR-0002 #66)** — keep, never delete |
| OPEN-7 | Admin video hide / `is_short` override | **DECIDED (ADR-0002 #20)** — `updateVideo` (§1.8) from the `/admin` dashboard list; no `/admin/videos` |
| OPEN-8 | Shorts heuristic | **DECIDED (ADR-0002 #67)** — ≤ 60 s or `#shorts`; refinement = ADR slug `shorts-detection` |
| OPEN-9 | `deleteAccount` semantics | **DECIDED (ADR-0002 #28)** — as §1.1 |
| OPEN-10 | `project-files` cap | **DECIDED (ADR-0002 #31)** — 100 MB; `config.toml` `100MiB` |
| OPEN-11 | Two-phase signed uploads ADR | **DECIDED (ADR-0002 C11)** — baseline (01 INV-51, ADR-0001 D13); no further ADR |
| OPEN-12 | `stats_daily.metric='users'` | **DECIDED (ADR-0002 #68, [DAVID])** — aggregate count only |
| OPEN-13 | Skin bust renderer | **DECIDED (ADR-0002 C22 / #26)** — `skinview3d` + `gl` (dependency ADR at S1.7); fallback client render + cache |
| OPEN-14 | Ko-fi preset amount | **DECIDED (ADR-0002 C19 / #50)** — none in v1; iframe 712/620 mounts in place |
| OPEN-15 | `reportComment` limit | **DECIDED (ADR-0002 #69)** — 10 / h |

---

## 11. Sibling amendments + tests map

Registry additions folded into `_registry.md` (ADR-0002).

### 11.1 Former registry-additions pointer (all folded — see `_registry.md`)

Contracts that v0.2 drafted under the retired ID-introducing heading now live in their sections — sibling citations of "04 §11.1" resolve as: `deleteAccount` → §1.1 · `renameUserHandle` → §1.2 · `site_settings.owner_profile_id` / `getOwnerProfileId()` → §1.2 (`CommentView` CREATOR note) · `setUserRole` → §1.3 · `updateVideo` → §1.8 · adapter export names → §4 · `rate_limit_hits` → SC-08 / §5.5. This section introduces no IDs.

### 11.2 Sibling amendments (applied by ADR-0002 in the same PR and verified against the sibling text on 2026-08-17 — one truth per fact; listed so gates can spot regressions)

| Doc | Line / section | Now reads |
|---|---|---|
| 01 | INV-18, INV-19, INV-23, INV-42, INV-44 | `<actionName>Input`; `ActionResult<T>` object error (SC-03); cron 401 JSON; `log.*({… id})` (ADR-0002 C14/C16) |
| 01 | INV-24 Check | `.delete(` in `lib/jobs` only in `snapshotStats` (RPC purges + Storage `remove()`, J-D) |
| 01 | INV-32 | `lib/auth.ts` exports exactly `getUser, getProfile, requireUser, requireOnboarded, requireRole, safeNext` — no `getSession()` (SC-04) |
| 01 | INV-47, INV-53, INV-51/33 | storage paths per SC-21; two-phase uploads baseline (§1.4.5); `createSignedUploadUrl` only in `lib/files.ts` |
| 01 | INV-50, INV-69, INV-71, INV-59 | `HASH_SECRET` HMAC (SC-17); rate-limit surfaces = §5.5; `sync.failed` per J-F/J-S; analytics per §5.6 |
| 01 | §7 env matrix, O-3, O-4, O-5 | per SC-16 (8 boot-required names; test-only `*_API_BASE`); DECIDED |
| 02 | §1.4 / RP-17 / §2.10 | cron strings = §6; `maxDuration` 300/60 |
| 02 | §1.3, §8, §4, §2.9, §5, §2.7 | `/admin/settings` whole in S1.5; callback per §2.1; download 429 JSON + HEAD 405 (D1–D7); `toggleLike` → `project:<slug>`, `banUser` → none, `deleteAccount` → `project:<slug>` per touched target, `updateVideo` (§1.8) → `videos`; Ko-fi per §5.7 (empty `kofi_page` = "Tips open soon.") |
| 03 | `GoogleSignInButton`, `AvatarUpload` (file input `name`, no `action` prop), `Comment` CREATOR (O-15 → `owner_profile_id`), `TrackedLink` allowlist + emitters (v0.3.1), `ReportPicker` note (300), `ModActionRow` "Rename handle" (§2.4), N-04 nav Support = plain link | per §2.0, §1.1, §1.2 (`ownerProfileId`), §5.6 (value sets verbatim: `download.from` incl. `skin` + `SkinCard` emitter; `tip_click {amount?: 1\|3\|5\|'other', from: support\|tip-panel\|floating}`; `video_play.kind` without `upnext`; `sign_in.from` = `nav\|prompt\|admin`), §1.2 |
| 05 | T-ACT-0/3/7/15/17/19/21/28/38/39/40/41/42/45/56/58/61/62–68, T-ADP-5/7/9/14–18, T-UNIT-16/23/26/38, T-E2E-11/27, SEED-13 | shapes/names/roles per this doc (mod = D `forbidden` on curation/mentions/sync — ADR-0002 C7; download 429 JSON; `video_play {youtube_id, kind}`; `/support` iframe in place; T-ACT-15 `target_type ≠ 'project'` → `validation` (§1.2 `TARGET`); T-ACT-65/66/67/68 cite §1.1/§1.3/§1.2/§1.8) |
| data-model | §2.1 `comment_count`; §2.5 M2/M7; §2/§4 `rate_limit_hits`, views `comments_public`/`site_settings_public`, `comments_set_status()`, `can_comment()`, RPCs, `profiles.handle_changed_at`, `site_settings.owner_profile_id` | as stated in §1.2, §5.1, SC-08 (ADR-0002 Consequences) |
| `security-check` SKILL.md | Uploads: commit-phase re-validation line; Abuse: SC-24 audit line | §1.4.5, SC-24 |

Not yet applied (tracked in §12 "still disagree"): 01 INV-40 / 02 §5 / 05 T-ACT-27 `updateSettings` tags; 05 T-E2E-49 `from:'fsb'`; `.env.example` `CURSEFORGE_MEMBER` (S0) + `HASH_SECRET=` (S1.1 — ADR-0002 A14); `_registry.md` Comments row + `app/auth/` route files; 00 S0/S1.4 wording. — **RESOLVED (v0.4, ADR-0002 Amendment A applied; historical note only).**

### 11.3 Tests map (05 owns IDs under its H-13 rule — append-only numbering; every former "to add" item now has a number unless listed under *unnumbered*)
- SC-13 lock → T-ACT-70 · SC-24 audit → T-ACT-69 · no-key runs → T-ACT-71 · `not_configured` → T-ACT-72 · two-phase U1–U3 → T-ACT-73 · J-F edge → T-ACT-74 · orphan cleanup → T-ACT-75 (S1.9) · skin download → T-ACT-76 · `deleteAccount` → T-ACT-65 · `setUserRole` → T-ACT-66 · `renameUserHandle` → T-ACT-67 · `updateVideo` → T-ACT-68 · log redaction → T-UNIT-33 · env parity → T-UNIT-35 · rate-limit scopes → T-UNIT-37 · analytics payloads → T-UNIT-38 · `commentErrorLine` → T-UNIT-40 · `safeNext` → T-UNIT-44 · `render-skins.mjs` idempotency → T-UNIT-45 · `comments_public` → T-RLS-128 · RPC grants → T-RLS-129 · `rate_limit_hits` → T-RLS-130 · `comments_set_status` → T-RLS-131 · `site_settings_public` view (anon selects exactly `comments_closed_default, kofi_page, owner_profile_id`) → T-RLS-132 · `can_comment()` helper matrix (target hidden / comments closed / banned → insert denied at RLS) → T-RLS-133 · non-page smoke (HEAD 405, callback 307) → T-E2E-46 · `FloatingSupportButton`/`TipPanel` → T-E2E-49.
- Unnumbered (05 to append under H-13 when the slice opens): notify backoff schedule 5/10/20/40/80 and attempts 5 → `failed`; digest > 5 per (channel, address); §5.4 chain order with fixtures (oEmbed → Data API → OG); `renderSkinBust` output ≤ 512 KB / failure non-fatal; `comment_count` trigger (held first-timer posts again while held → held; approve → +1); `setProjectLink` URL path via `curseforge/search.json`; `snapshotStats` run-twice same day + `purge_rate_limit_hits`; `lib/env.ts` optional rows do not fail boot; §9.1 Ko-fi webhook (S2.1).

---

## 12. Review notes

v0.4 (2026-08-17, ADR-0002 Amendment A applied): A2 RPC `moderator_thread` contract (§1.2 Reads) · A3 `postComment` reads `moderation_mode` via the RLS server client from `site_settings_public` (§1.2, §5.1) · A4 `rate_limit_ok` counts only `rate_limit_hits`, every limited action/route records a hit (SC-08, `postComment`/`toggleLike`/`reportComment`, D3, §5.5) · A6 `deleteComment` moderator rule (`moderated_by`) · A8 job preamble: `sync.failed`/`sync.stale` from S1.5, S1.2 jobs log only · A11 `curateProject` batch `reorder: [{project_id, featured_order}]` shape, trigger = `/admin/projects` list · A14 `HASH_SECRET` required from S1.1, `/auth/callback` A3 sets `profiles.email_hash` (SC-16/17) · A15 SC-04 `getViewer()` export · A16 `tip_click` shape marked binding (§5.6).

v0.3 consistency pass 2 (2026-08-17, after ADR-0002 + whole-set critic) — applied in this doc: SC-04 export set = 01 INV-32 verbatim (**`getSession()` dropped**; 00 S0's "`lib/auth.ts` (`getSession`, …)" is stale — see below); §1.4.5 `createSignedUploadUrl` call site = `lib/files.ts` (01 INV-51 gate grep, registry Modules); §5.6 `tip_click` = `{amount?: 1|3|5|'other', from: support|tip-panel|floating}` (03 v0.3.1 / N-04 nav Support = plain link; the earlier `amount?: number` + `'nav'` emitter is withdrawn — the "Other" value is never sent); §1.0 `triggerSync` rate cell = lock SC-13 / `JOB_LOCK_MINUTES` (the "1 / 60 s" figure existed nowhere else; 05 T-ACT-70 tests the 15-min window); SC-16 `CURSEFORGE_MEMBER` = "to be removed at S0" (still in the template today); §11.1 renamed to a pointer (no ID-introducing "Registry additions" heading remains); §11.2 now lists only amendments verified in the sibling text, with a "not yet applied" line; §11.3 cites 05 H-13 (there is no 05 rule "RA-10"); §12 "still disagree" list pruned to what is genuinely outstanding.

Earlier v0.3 pass (kept for history): 02 rule numbers re-cited (`safeNext` = RP-20, un-onboarded sign-out = RP-21, no `revalidatePath` = RP-22, cron `maxDuration` = RP-17); SC-08 `rate_limit_hits (scope, key, ts)` per data-model §2.10; §1.1 `updateProfile` trigger = `AvatarUpload` file input (no `action` prop, 03 §2.5); §1.2 `TARGET` = `z.literal('project')` in v1 (matches 05 T-ACT-15; DB column keeps four values, ADR-0002 C21); §1.2 `renameUserHandle` control = 03 §2.4 `ModActionRow`; §1.0/§1.3 `updateSettings` revalidates `settings` only (02 RP-23 — `/projects/[slug]` carries `settings`); §5.7 empty-`kofi_page` copy cites 00 S1.9.AC4 (not 02 O-8); §8/§11.3 number `site_settings_public` → T-RLS-132 and `can_comment()` → T-RLS-133.

Sibling / registry lines that **still disagree** with this doc (04 or ADR-0002 owns the fact; **not** edited from here — work list for the owners of 00/01/02/03/05/`_registry.md`/`.env.example`; each becomes a §11.2 row once applied):
- `_registry.md` Component registry, Comments row: "`CommentThread` (server shell) + `CommentList` (`CommentThread.List.tsx`, C leaf)" → must read "`CommentThread` (C, session seam, `components/comments/CommentThread.tsx`)"; move `CommentList`/`CommentThread.List.tsx` to the Dropped list (ADR-0002 C1, 03 §2.4, this doc §1.2 reads). 00 S1.4 scope + risk lines ("`CommentList` performs no optimistic insert") → `CommentThread`.
- `_registry.md` Route registry / Route files / repo layout: `/auth/callback` + `/auth/sign-out` are route handlers at `app/auth/callback/route.ts` and `app/auth/sign-out/route.ts` (SC-01, §2.1/§2.2, 02 RP-11) — give them their own "Auth (`app/auth/`)" line, add both files to "Route files" and `app/auth/` to the repo layout tree; they are not under `app/(public)/`.
- `_registry.md` Modules `auth.ts` line: `(safeNext)` is the S0 export only — full set per SC-04 (`getUser, getProfile, requireUser, requireOnboarded, requireRole, safeNext`); registry Test row cites "RA-10 mapping" — no such 05 rule; cite H-13.
- 00 S0 Scope IN: "`lib/auth.ts` (`getSession`, `requireRole`, and a **real** `safeNext`)" → "`lib/auth.ts` (`safeNext` real at S0; `getUser`/`getProfile`/`require*` at S1.1 — no `getSession()`, SC-04 / 01 INV-32)".
- 01 INV-40, 02 §5 `updateSettings` row, 05 T-ACT-27: "`settings` (+ `projects` when `comments_closed_default` changed)" → **`settings` only** (§1.0/§1.3; 02 RP-22 says the matrix equals §1.0). Also 02 §5 `updateVideo` row cite `04 §1.8` (not "§11").
- 05 T-E2E-49: `tip_click` observed on the `window.va` stub must be `from:'floating'` (`'fsb'` is outside the §5.6 allowlist).
- 03 O-15: cite `04 §1.2` (`CommentView` CREATOR note) rather than the retired `04 §11.1` (the §11.1 pointer redirects meanwhile — cosmetic).
- `.env.example`: drop `CURSEFORGE_MEMBER=` at S0; add `HASH_SECRET=` at S1.1 (SC-16/17, ADR-0002 A14; T-UNIT-35 env parity).

v0.3 (ADR-0002 applied): roles → admin for curation/sync/media/mentions/videos (C7, supersedes the v0.2 "moderator" rule and the v0.2 notes below where they differ) · `uploadProjectMedia` + `project-media` → S1.3 (C10) · download 429 → JSON (C14/C17) · `emailHash` keyed HMAC (C13) · Ko-fi CONTINUE mounts the iframe (C19) · `/api/og` dropped (#22) · module homes per C16 (`lib/files.ts`, `lib/validation/files.ts`, `linkify`/`commentErrorLine` in `lib/validation/comment.ts`) · `updateVideo` contract added (§1.8) · all OPEN-1…15 DECIDED · registry additions folded into `_registry.md`.

v0.2 — findings applied / declined:

- **Return shape**: two findings proposed opposite fixes (keep 04's flat `error:string` vs adopt 01's object). Adopted **01 INV-19's object shape** (SC-03) with `field?`/`issues?` added — INV-44 already uses `{code,message}` for route handlers, so one shape now covers actions and routes; 05 T-ACT-0 to be amended (§11.2).
- **Discord recipient `address`**: the "keep `address:null` + ADR" recommendation was **declined** — `docs/notifications.md` (binding source) and 00 S1.5 say `address = webhook`; F2 now stores it and requires masking (never logged, INV-43).
- **`maxDuration`**: one finding proposed 60 everywhere, another 300/60. Chose **300 for the five sync/stats routes, 60 for notify** (Vercel Pro per spec §7); now ADR-0002 C15.
- **Two-phase uploads**: kept (now baseline — ADR-0002 C11) rather than dropping it (a Route-Handler upload would breach 01 INV-17 and still hit the 4.5 MB cap).
- **Skin download counter**: chose extending the generic route (kind `skin`) over "no counter in v1" because 00 S1.7.AC4 and data-model `skins.downloads` require it.
- **`external_out`**: rejected as an analytics event (01 INV-59 lists four; `download` with `source` covers outbound platform clicks); 03 to drop it.
- **Sign-in entry point**: no route/action — 02 §4 already decides client `signInWithOAuth`; 03's `GoogleSignInButton` becomes a client leaf.
- **`triggerSync` `notify` source**: dropped (05 T-ACT-42's five sources).
- **`banUser`** admin→anyone: kept 04's rule (mods/admins are never banned by this action; demote first) and closed 05 OPEN-14 that way.
- **Adapter names**: kept 04's (owner) and listed the 05 rows to rename; added the `create<Adapter>` factory (SC-25).
- **Modrinth status filter**: kept with the enum cited (only `approved`/`archived` are publicly listable).
- **Numbers vs 03/05** (debounce, note 300, credit 40, year 2015…, subject text, detectPlatform): kept 04's as owner of input schemas; debounce number removed from 04 (03's remit).
