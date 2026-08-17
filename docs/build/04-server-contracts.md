# Server Contracts
Purpose: the checkable contract for every Server Action, route handler, cron job, and external adapter in `_registry.md` §Server contract registry — names, files, auth, input schema, preconditions, effects, return shape, rate limits, idempotency, external calls, logging, and required tests — so gate agents can diff code against it.
Status: DRAFT v0.2 (2026-08-17) — becomes v1.0 at freeze

Sources (binding, in this order when they conflict): `docs/build/_registry.md` · `docs/data-model.md` · `docs/notifications.md` · `docs/spec.md` / `docs/questions.md` · `docs/platform-audit.md` · `DESIGN.md` v1.3 · `.claude/skills/{backend-robustness,security-check,supabase-ops,vercel-ops}/SKILL.md` · `.env.example`. Schema/RLS shapes are owned by `01-architecture.md` + `docs/data-model.md`; page behaviour by `02-routes-and-pages.md`; UI by `03-components.md`; test IDs by `05-test-plan.md` (00 rule 0.5). This doc only *references* those. Where this doc and a sibling (01/02/03/05) state the same fact differently, §11.2 names the sibling line that must change — one truth per fact.

Contents: §0 Conventions (SC-01…SC-25) · §1 Server Actions · §2 Route handlers · §3 Jobs · §4 Adapters · §5 Decision tables (+ §5.6 analytics events, §5.7 Ko-fi handoff, §5.8 operational defaults) · §6 vercel.json cron table · §7 Error codes · §8 Tests map (04 → 05 IDs) · §9 Phase 2 stubs · §10 Open · §11 Registry additions + sibling amendments · §12 Review notes

---

## 0. Conventions (apply to every contract below; IDs `SC-nn` — distinct from 03's `C-nn`)

| # | Rule (yes/no checkable) |
|---|---|
| SC-01 | Server Actions live in `lib/actions/<area>.ts` (`accounts.ts`, `comments.ts`, `settings.ts`, `projects.ts`, `uploads.ts`, `skins.ts`, `art.ts`, `mentions.ts`, `admin.ts`) and are marked `'use server'`. Route handlers live under `app/api/**/route.ts` and `app/auth/**/route.ts`. Jobs live in `lib/jobs/<name>.ts`. Adapters live in `lib/adapters/<name>.ts`. Deliverers live in `lib/notify/deliver/{email,discord}.ts`. `triggerSync` lives in `lib/actions/admin.ts` (01 INV-72 grep target). |
| SC-02 | Every action's input is parsed with a zod schema exported from the same file as `<actionName>Input` (01 INV-18) — e.g. `postCommentInput`. Parsing failure → `{ok:false, error:{code:'validation', message, issues:[{path,message}]}}` — issues are plain-language, no zod internals. |
| SC-03 | Return shape of every action (01 INV-19, types in `lib/actions/result.ts`): `ActionResult<T> = {ok:true, data:T} \| {ok:false, error:{code: ActionErrorCode, message: string, field?: string, issues?: {path:string, message:string}[]}}`. `ActionErrorCode` = the §7 union. Actions **never throw** to the client; unexpected exceptions are caught, logged (SC-15), and returned as `error.code='internal'`. Route handlers return JSON `{ok:false, error:{code, message}}` with 4xx/5xx (01 INV-44). In this doc "Errors: `x`, `y`" means `error.code ∈ {x, y}`. |
| SC-04 | Auth is resolved with `lib/auth.ts` (01 INV-32) → `getUser()` (anon → `null`), `getProfile()`, `requireUser()` (→ `unauthenticated`), `requireOnboarded()` (handle null → `onboarding_required`), `requireRole('moderator'\|'admin')` (→ `forbidden`), `safeNext(next)` (02 RP-19). Role order: `user < moderator < admin`. Every admin/moderator action calls `requireRole` server-side even though RLS also enforces it (defense in depth). `requireOnboarded` and `safeNext` are registry additions to the INV-32 export list (§11.1). |
| SC-05 | Banned check: any action that inserts on behalf of a user (`postComment`, `editComment`, `toggleLike`, `reportComment`) returns `error.code='banned'` when `profiles.is_banned = true`, before touching the DB. |
| SC-06 | DB clients: user-scoped actions use `lib/supabase/server.ts` (anon key + cookie session, RLS enforced). Admin/moderator content mutations, uploads, jobs, route handlers, and the download route use `lib/supabase/admin.ts` (service role) **only after** the role/secret check in the same function. The service-role client is never imported from a file under `components/` or any `'use client'` module (01 INV-14). |
| SC-07 | Revalidation: after a successful write, call `revalidateTag(tag)` for every tag listed in the contract; tags are exactly the registry set `projects`, `project:<slug>`, `videos`, `skins`, `art`, `mentions`, `settings`. `revalidatePath` is not used (02 RP-21). |
| SC-08 | Rate limits are enforced in SQL (01 INV-69): `lib/rate-limit.ts` `assertRateLimit(scope, key, max, window)` → `rpc('rate_limit_ok', {scope, key, max, window})`, called **before** the write; `rate_limit_ok` counts rows in the scope's source table over the window (§5.5 names the table per scope; scopes with no natural table count `rate_limit_hits (scope, key, at)` — 01 O-4 adopted, §11.1 — and `assertRateLimit` inserts one `rate_limit_hits` row on success for those scopes). No in-memory limiter. Exceeding → `error.code='rate_limited'` (actions) or HTTP 429 (route handlers). Windows are stated per contract as `count / window / scope`. |
| SC-09 | Every external HTTP call goes through `lib/adapters/http.ts` → `fetchJson(url, {timeoutMs:10000, retries:3, ua})`: `AbortSignal.timeout(10000)` (**10 s**); retry on HTTP 429/5xx and network errors, backoff 1 s → 2 s → 4 s (honour `Retry-After` / `X-Ratelimit-Reset` if larger, capped at 30 s), **max 3 retries**; 4xx other than 429 is not retried; final failure throws `AdapterError {status, code, body(≤300)}`. |
| SC-10 | User-Agent for every outbound call = `MODRINTH_USER_AGENT` env value (`odsens.com/<version> (david@studiobing.com)`), also sent to CurseForge/YouTube/OG fetches. |
| SC-11 | Every job writes exactly one `sync_runs` row per invocation: insert `{source, started_at}` at start; update `{finished_at, ok, items, error}` at end **on every path including thrown errors** (try/finally). `error` ≤ 2000 chars, never contains secrets. |
| SC-12 | Cron route handlers (`app/api/cron/*/route.ts`): `GET` only (`POST`/`HEAD`/others → 405); `export const dynamic = 'force-dynamic'`; `export const runtime = 'nodejs'` (01 INV-22); `export const maxDuration = 300` for `sync-modrinth`, `sync-curseforge`, `sync-youtube`, `refresh-mentions`, `stats-snapshot` and `maxDuration = 60` for `notify` (Vercel Pro — spec §7 "Vercel (paid)"; 02 RP-16/§2.10 to be amended, §11.2). Require `Authorization: Bearer ${CRON_SECRET}` compared with `crypto.timingSafeEqual` (length-checked first) → else HTTP 401 `{ok:false, error:{code:'unauthorized', message:'Nope.'}}` with no side effects. Success → HTTP 200 JSON `JobSummary` (§3); failure → HTTP 500 `{ok:false, source, run_id, error:{code:'job_failed', message}}` (still logged in `sync_runs`). |
| SC-13 | Job concurrency lock: a job returns `{ok:true, skipped:'running'}` (HTTP 200) without doing work if a `sync_runs` row for the same `source` has `finished_at IS NULL` and `started_at > now() - JOB_LOCK_MINUTES` (§5.8, default 15 min). |
| SC-14 | Timestamps: all `timestamptz`, computed as UTC (`new Date().toISOString()` / `now()`); "day" = UTC calendar date. |
| SC-15 | Structured logs (01 INV-42): `log.info\|warn\|error({job?, action?, id, msg, meta?})` from `lib/log.ts` — exactly one of `job`/`action` set; `id` = `sync_runs.id` for jobs, `crypto.randomUUID()` request id for actions/route handlers. `meta` never contains request bodies with files or comment text, emails, tokens, signed URLs, or webhook URLs (01 INV-43). |
| SC-16 | Env is read only via `lib/env.ts` (zod-validated at import; 01 INV-36). Table = every name in `.env.example` (+ `HASH_SECRET`, §11.1): |
| | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **required** — `lib/supabase/client.ts`, `server.ts` |
| | `SUPABASE_URL`, `SUPABASE_ANON_KEY` — **required**; must equal the public pair — `lib/supabase/server.ts` |
| | `SUPABASE_SERVICE_ROLE_KEY` — **required** — `lib/supabase/admin.ts` only |
| | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — **not read by `lib/env.ts`** (Supabase CLI `config push` only) |
| | `YOUTUBE_API_KEY` — optional, degrades: `syncYoutube` RSS-only, `refreshMentions` skipped, §5.4 step 3 skipped, `channelStats` skipped — `lib/adapters/youtube.ts` |
| | `YOUTUBE_CHANNEL_ID` — **required** — `lib/adapters/youtube.ts` |
| | `MODRINTH_USER`, `MODRINTH_USER_AGENT` — **required** — `lib/adapters/modrinth.ts`, `http.ts` |
| | `CURSEFORGE_API_KEY` — optional, degrades: `syncCurseforge` skipped run, `setProjectLink` → `upstream_error` — `lib/adapters/curseforge.ts` |
| | `CURSEFORGE_MEMBER` — optional; **unused by any v1 contract** (Q39: manual ids) — proposed for removal from `.env.example` (§11.2) |
| | `KOFI_PAGE` — optional; seed/fallback for `site_settings.kofi_page` (DB value wins) — `/support` (§5.7) |
| | `KOFI_WEBHOOK_VERIFICATION_TOKEN` — required from S2.1 — §9.1 |
| | `RESEND_API_KEY` — optional, degrades: email rows `failed`/`not_configured` (§3.7 N7) — `lib/adapters/resend.ts` |
| | `NOTIFY_FROM_EMAIL` — optional, default `allay@odsens.com` — `lib/notify/deliver/email.ts` |
| | `DISCORD_WEBHOOK_URL` — optional; seed/fallback for `site_settings.discord_webhook_url` (DB value wins) — `notifyFanOut` F2 |
| | `CRON_SECRET` — **required** — `app/api/cron/*` |
| | `NEXT_PUBLIC_SITE_URL` — **required** — metadata, emails, redirects, sign-out CSRF |
| | `HASH_SECRET` — **required from S1.3** (≥ 32 random bytes) — SC-17 |
| | Delta vs 01 §7 env matrix (01 to amend, §11.2): `YOUTUBE_API_KEY`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `KOFI_PAGE`, `CURSEFORGE_MEMBER` are **optional-with-degradation** here (01 lists R / R from S1.x). `lib/env.ts` fails fast only on the **required** rows above (05 T-UNIT-16 follows this list). |
| SC-17 | Hashing helpers (`lib/hash.ts`; 01 INV-50): `ipHash(ip) = createHmac('sha256', HASH_SECRET).update(`${ip}\|${utcDay}`).digest('hex')`; `uaHash(ua) = createHmac('sha256', HASH_SECRET).update(ua).digest('hex')`; `emailHash(email) = sha256hex(email.trim().toLowerCase())` — **unsalted, unkeyed on purpose** (must match the DB trigger and Ko-fi matching, data-model §2.8). Raw IP / UA are never stored or logged. 00 §6 `IP_HASH_SALT` is superseded by `HASH_SECRET`. |
| SC-18 | Uploads ≤ 1 MB (avatars, skin textures) travel inside the action's `FormData` and are validated by `lib/uploads.ts` `validateUpload(file, kind)` (01 INV-51/52). Uploads that may exceed 1 MB (`project-files` ≤ 100 MB, `project-media` ≤ 5 MB, `art` ≤ 10 MB) use the **two-phase signed-upload pattern** (§1.4.5 — **OPEN-11 / 00 O-9, decision required before freeze**) because Vercel caps function request bodies at 4.5 MB. In both patterns the server validates type (magic bytes, not extension alone), size, and dimensions, generates the storage path, and writes the DB row; the browser never holds a broad Storage policy (data-model §3). |
| SC-19 | Image magic bytes accepted (`lib/validation/files.ts` `sniffMime`): PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `52 49 46 46 ?? ?? ?? ?? 57 45 42 50`. Archive magic bytes accepted: ZIP local header `50 4B 03 04` (covers `.jar`, `.zip`, `.mrpack`). SVG, GIF, HTML, executables are rejected everywhere. |
| SC-20 | Filenames stored in Storage are normalized (`lib/validation/files.ts` `sanitizeFilename`): NFKD → strip non `[A-Za-z0-9._-]` → collapse `-` → strip `..` and path separators → max 120 chars → lowercase extension; a filename may not start with `.`. Original filename is kept in `project_files.filename` after the same normalization. |
| SC-21 | Storage path patterns (bucket/`path`; builders in `lib/uploads.ts`, ids not slugs so renames never break paths; `{hash}` = first 16 hex chars of sha256 of the stored bytes): `avatars/{profile_id}/{hash}.webp` · `project-media/{project_id}/{icon\|gallery}/{hash}.{png\|jpg\|webp}` · `project-files/{project_id}/{version_id}/{filename}` · `skins/{skin_id}/texture.png` · `skins/{skin_id}/bust.png` · `art/{art_id}/{hash}.{png\|jpg\|webp}`. 01 INV-47/53 and 05 T-ACT-3/38/39/56/58 + SEED-13 to match (§11.2). |
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
| `deleteAccount` (§11.1, OPEN-9) | `lib/actions/accounts.ts` | S1.1 | `requireOnboarded()` | 1 / day / user | `project:<slug>` per touched target | — |
| `postComment` | `lib/actions/comments.ts` | S1.4 | `requireOnboarded()`, not banned | 5 / min + 50 / day / user | target tag | `comment.new` \| `comment.held`, `comment.reply` |
| `editComment` | `lib/actions/comments.ts` | S1.4 | author, ≤ 15 min | 20 / min / user | target tag | — |
| `deleteComment` | `lib/actions/comments.ts` | S1.4 | author or `requireRole('moderator')` | 20 / min / user | target tag | — |
| `toggleLike` | `lib/actions/comments.ts` | S1.4 | `requireOnboarded()`, not banned | 60 / min / user | target tag | — |
| `reportComment` | `lib/actions/comments.ts` | S1.4 | `requireOnboarded()`, not banned | 10 / hour / user | — | `comment.reported` (+ `comment.held` on auto-hold) |
| `moderateComment` | `lib/actions/comments.ts` | S1.4 | `requireRole('moderator')` | — | target tag | `comment.approved` |
| `banUser` | `lib/actions/comments.ts` | S1.4 | `requireRole('moderator')` | — | — | — |
| `renameUserHandle` (§11.1) | `lib/actions/comments.ts` | S1.4 | `requireRole('moderator')` | — | — | — |
| `setUserRole` (§11.1) | `lib/actions/settings.ts` | S1.5 | `requireRole('admin')` | — | — | — |
| `updateSettings` | `lib/actions/settings.ts` | S1.5 | `requireRole('admin')` | — | `settings` (+ `projects` if `comments_closed_default` changed) | — |
| `testDiscordWebhook` | `lib/actions/settings.ts` | S1.5 | `requireRole('admin')` | 10 / min / user (`rate_limit_hits`) | — | — |
| `createExclusiveProject` | `lib/actions/projects.ts` | S1.3 | `requireRole('admin')` | — | — (draft) | — |
| `updateExclusiveProject` | `lib/actions/projects.ts` | S1.3 | `requireRole('admin')` | — | `projects`, `project:<slug>` | — |
| `publishProject` | `lib/actions/projects.ts` | S1.3 | `requireRole('admin')` | — | `projects`, `project:<slug>` | — |
| `uploadProjectMedia` | `lib/actions/uploads.ts` | S1.2 (`gallery` for synced) / S1.3 (`icon`, exclusives) | `requireRole('moderator')` for `gallery` on synced rows; `requireRole('admin')` otherwise | 60 / hour / user (`rate_limit_hits`) | `projects`, `project:<slug>` | — |
| `uploadProjectFile` | `lib/actions/uploads.ts` | S1.3 | `requireRole('admin')` | 30 / hour / user (`rate_limit_hits`) | `projects`, `project:<slug>` | — |
| `curateProject` | `lib/actions/projects.ts` | S1.2 | `requireRole('moderator')` | — | `projects`, `project:<slug>` | — |
| `setProjectLink` | `lib/actions/projects.ts` | S1.2 | `requireRole('moderator')` | 30 / hour / user (`rate_limit_hits`) | `projects`, `project:<slug>` | — |
| `createSkin` / `updateSkin` | `lib/actions/skins.ts` | S1.7 | `requireRole('admin')` | 60 / hour / user (`rate_limit_hits`) | `skins` | — |
| `createArt` / `updateArt` | `lib/actions/art.ts` | S1.7 | `requireRole('admin')` | 60 / hour / user (`rate_limit_hits`) | `art` | — |
| `fetchMentionPreview` | `lib/actions/mentions.ts` | S1.8 | `requireRole('moderator')` | 30 / min / user (`rate_limit_hits`) | — | — |
| `createMention` / `updateMention` | `lib/actions/mentions.ts` | S1.8 | `requireRole('moderator')` | — | `mentions`, `project:<slug>` (if assigned) | — |
| `triggerSync` | `lib/actions/admin.ts` | S1.2 | `requireRole('moderator')` | 1 / 60 s / source (lock SC-13) | per job | per job |

Role rule (decided here; closes 05 OPEN-5): **curation and moderation require `moderator`** — `curateProject`, `setProjectLink`, `triggerSync`, `uploadProjectMedia` (gallery on synced rows), `fetchMentionPreview`, `createMention`, `updateMention`, `moderateComment`, `banUser`, `renameUserHandle`, `deleteComment` (00 S1.2.AC8 "role ≥ moderator", 02 §1.3 `/admin/projects` + `/admin/mentions` moderator, spec §5 "mods can hide", spec §9 "moderators can rename/ban"). **Exclusive project CRUD/publish/uploads, skins, art, settings, roles require `admin`** (data-model §4 "admin (exclusives)"). RLS: `project_overrides`, `project_links`, `mentions` writes must allow `is_moderator()` (05 T-RLS-41/42 already say mod = A; supabase-ops hand-off, §11.2). Read access to `/admin/*` pages is 02's remit.

### 1.1 Accounts (S1.1)

#### `completeOnboarding`
| Item | Contract |
|---|---|
| Trigger | `OnboardingPanel` form on `/welcome` (FormData). |
| Auth | `requireUser()`; `profiles.handle IS NULL` else `conflict` (already onboarded). |
| Input (`completeOnboardingInput`) | `handle: string` (H-rules) · `avatar?: File` (optional; ≤ 1 MB; PNG/JPEG/WebP by magic bytes; ≥ 64×64 px). |
| Handle rules (H) | H1 `^[A-Za-z0-9_]{3,20}$` (rejects `@`, spaces, dots, email-likes by construction). H2 case-insensitive unique (`citext`). H3 not in `RESERVED_HANDLES` (case-insensitive) — list: `admin, administrator, oddsense, odsens, moderator, mod, mods, root, system, support, allay, api, staff, help, null, undefined, anonymous, deleted, me, you, everyone, here` (first five mandated by `security-check`; the rest are this doc's default, OPEN-1). H4 no name/email detection (Q34; DESIGN.md §12.5). H5 the same list lives in SQL function `check_handle` and in `lib/validation/handle.ts` `RESERVED_HANDLES` (+ `handleSchema`); 05 T-UNIT-2 asserts parity. |
| Preconditions | Session valid; not banned is not checked (a banned account may still finish onboarding so it can be identified). |
| Rate limit | `assertRateLimit('onboarding', profile_id, 10, '10 minutes')` (`rate_limit_hits`). |
| Effects | Calls RPC `check_handle` → if not `available` return matching error. Update `profiles set handle = $1 where id = auth.uid() and handle is null` (RLS null→value). If avatar: `lib/uploads.ts` re-encode with `sharp` → `.rotate()` → square centre-crop → 512×512 WebP q82, metadata stripped (01 INV-47; O-5) → upload `avatars/{profile_id}/{hash}.webp` (service role) → set `avatar_path`. |
| Returns | `{ok:true, data:{handle, avatar_path}}`. Errors: `handle_taken`, `handle_reserved`, `validation`, `conflict`, `storage_error`, `rate_limited`, `unauthenticated`. |
| Tests (05) | T-ACT-1, T-ACT-2, T-ACT-3; T-RLS-5, T-RLS-6; T-UNIT-1, T-UNIT-2; T-E2E-21, T-E2E-22. |

#### `updateProfile`
| Item | Contract |
|---|---|
| Trigger | `/profile` forms (handle row SAVE; picture Change/Remove via `AvatarUpload` — there is **no** separate `uploadAvatar` action; 03 `AvatarUpload.action` prop = `typeof updateProfile`, §11.2). |
| Auth | `requireOnboarded()`. |
| Input (`updateProfileInput`) | `{handle?: string, avatar?: File, removeAvatar?: boolean}` — at least one present. Same H-rules. |
| Preconditions | Handle change: new handle ≠ current (case-insensitive) else no-op `ok`. |
| Effects | Handle: RPC `check_handle` → update via **service-role client** (data-model §4 RLS allows only null→value for self; renaming is a design requirement, DESIGN.md §11.3 p.11 — OPEN-2), set `profiles.handle_changed_at = now()`. Avatar: same pipeline as `completeOnboarding`; old object deleted after new one is written. `removeAvatar`: delete object, set `avatar_path = null`. Never touches `role`/`is_banned` (unknown fields stripped by zod). |
| Returns | `{ok:true, data:{handle, avatar_path}}`. Errors: `handle_taken`, `handle_reserved`, `validation`, `rate_limited`, `storage_error`. |
| Rate limit | Handle change: 1 / 7 days / user (OPEN-2 default), counted from `profiles.handle_changed_at` (§11.1). Avatar: `assertRateLimit('avatar', profile_id, 10, '10 minutes')` (`rate_limit_hits`). |
| Tests (05) | T-ACT-4, T-ACT-5, T-ACT-6; T-RLS-6, T-RLS-8; T-E2E-23. |

#### `checkHandle` (RPC `check_handle(p_handle text) returns text`)
| Item | Contract |
|---|---|
| Trigger | `HandleField` on keystroke (debounce is 03's remit) via action `checkHandle` (thin wrapper) — never called from the browser with the anon client directly. |
| Auth | SQL: `security definer`, `grant execute to authenticated` only; action: `requireUser()`. |
| Input (`checkHandleInput`) | `handle: string` (any string ≤ 64; validated inside). |
| Rate limit | `assertRateLimit('check_handle', profile_id, 60, '1 minute')` (`rate_limit_hits`; 01 O-4 adopted). |
| Logic | returns `'invalid'` (H1 fails) → `'reserved'` (H3) → `'taken'` (`exists profiles where handle = p_handle` citext, excluding `auth.uid()`) → `'available'`. Never returns the owning profile id. |
| Returns | `{ok:true, data:{status:'available'\|'taken'\|'reserved'\|'invalid'}}` — the four states map to `HandleField` states (DESIGN.md §11.1). 05 T-ACT-7 (`{available, reason}`) to be amended to `data.status` (§11.2). |
| Tests (05) | T-ACT-7; T-UNIT-2. |

#### `deleteAccount` — **OPEN-9** (proposed default; registry addition §11.1)
| Item | Contract |
|---|---|
| Trigger | `/profile` "Delete account" (danger, inline confirm; DESIGN.md §11.3 p.11; 02 O-6). |
| Auth | `requireOnboarded()`. Input (`deleteAccountInput`) `{confirm: z.literal(true)}`. Rate limit `assertRateLimit('delete_account', profile_id, 1, '1 day')`. |
| Effects (service role, one transaction where possible) | `comments where author_id = me` → `status='deleted'` (slot stays, body retained per §1.2 `deleteComment`); `comment_likes where user_id = me` deleted (trigger fixes `like_count`); `comment_reports where reporter_id = me` deleted; avatar object removed; `profiles` row deleted via `auth.admin.deleteUser(id)` cascade — comments keep `author_id` as a dangling reference rendered as `author: null` ("Deleted." slot). `revalidateTag('project:<slug>')` for every distinct comment target (not the four site tags). Sign the user out (cookies cleared) → client redirects `/`. |
| Returns | `{ok:true, data:{deleted:true}}`. Errors: `unauthenticated`, `rate_limited`, `internal`. |
| Tests | none in 05 yet → §11.3 "Tests to add". |

### 1.2 Comments (S1.4)

Shared definitions:
- `TARGET = z.object({target_type: z.enum(['project','skin','art','video']), target_id: z.string().uuid()})`.
- **Target visible** = project: `projects.status='published'` and not `project_overrides.hidden`; skin/art: `status='published'`; video: `hidden=false`.
- **Comments enabled** = project: `coalesce(project_overrides.comments_enabled, not site_settings.comments_closed_default)`; skin/art/video: `not site_settings.comments_closed_default`. Not enabled → `comments_closed`.
- **Body rules (B)** (`lib/validation/comment.ts` `commentBodySchema`, `stripHtml`, `countLinks`): B1 strip HTML tags (`/<[^>]*>/g` → ''), then trim; B2 length 1..1000 code points (after B1) — DB check `char_length(body) <= 1000`; B3 links counted with `/(https?:\/\/[^\s]+|www\.[^\s]+)/gi` → count ≤ 1 else `too_many_links`; B4 stored as plain text; rendering auto-linkifies (03's remit); B5 no ` `; B6 message copy for B2/B3 as per DESIGN.md §11.2 ("Too many links.").
- **Target tag** for revalidation: project → `project:<slug>` only (cards do not show comment counts in v1); skin → `skins`; art → `art`; video → `videos`.
- **First-time commenter** = `profiles.comment_count = 0`. **Trigger rule (decided here; 00 O-13 default):** `comment_count` increments when a comment row becomes `status='published'` (insert as published, or `held → published` on approve); it is **never** decremented (deletes/hides do not change it). A held first-timer who posts again while still held is still first-time → held again. data-model §2.1, 05 T-ACT-15/T-ACT-19/T-RLS-126 to be amended (§11.2).
- **`CommentView`** (type home `lib/data/comments.ts`; returned by `postComment`/`editComment` and consumed by 03 `CommentThread`/`Comment`/`Composer.onPosted`): `{id: string, body: string, status: 'published'\|'held'\|'hidden'\|'deleted', createdAt: string, editedAt: string\|null, parentId: string\|null, likeCount: number, likedByViewer: boolean, isFirstComment?: boolean, author: {id: string, handle: string, avatarUrl: string\|null, role: 'user'\|'moderator'\|'admin'} \| null}`. `avatarUrl` = public URL of `avatar_path` or null. **CREATOR tag** (03 `Comment`): `author.id === site_settings.owner_profile_id` (registry addition §11.1; exposed read-only via `lib/data/settings.ts` `getOwnerProfileId()`).

#### `postComment`
| Item | Contract |
|---|---|
| Trigger | `Composer` (root) / `Reply` composer. |
| Auth | `requireOnboarded()`; not banned (SC-05). |
| Input (`postCommentInput`) | `TARGET & {body: string, parent_id?: uuid}`. |
| Preconditions | Target exists + visible → else `not_found`. Comments enabled → else `comments_closed`. If `parent_id`: parent exists on the same `target_type/target_id` and has `status='published'` (else `not_found`); if the parent itself has a `parent_id`, the stored `parent_id` = the parent's root (one level, data-model §2.5); client prefixes `@handle ` in body (not enforced server-side). |
| Rate limit | `assertRateLimit('comment', profile_id, 5, '1 minute')` and `assertRateLimit('comment_day', profile_id, 50, '24 hours')` (both count `comments.author_id, created_at`, all statuses). |
| Moderation | Status per §5.1 decision table (`lib/validation/moderation.ts` `decideCommentStatus({mode, authorCommentCount, authorRole})`). |
| Effects | Insert `comments {target_type,target_id,author_id,parent_id,body,status}`. Emit `comment.new` (status published) or `comment.held` (held) with `subject_type='comment'`, `payload {comment_id, target_type, target_id, target_title, target_slug, excerpt(140), author:{profile_id,handle}, first_time}`. If `parent_id` and status published and parent author ≠ actor: also emit `comment.reply` (log only). `revalidateTag(targetTag)`. |
| Returns | `{ok:true, data:{comment: CommentView}}` (`likeCount:0`, `likedByViewer:false`). Errors: `unauthenticated`, `onboarding_required`, `banned`, `not_found`, `comments_closed`, `validation`, `too_many_links`, `rate_limited`. |
| Tests (05) | T-ACT-11, T-ACT-12, T-ACT-13, T-ACT-14, T-ACT-15, T-ACT-16; T-UNIT-4, T-UNIT-5, T-UNIT-6; T-RLS-67, T-RLS-68, T-RLS-69, T-RLS-70; T-E2E-24, T-E2E-25, T-E2E-26. |

#### `editComment`
| Item | Contract |
|---|---|
| Auth | `requireOnboarded()`; not banned; `comments.author_id = auth.uid()` (moderators may **not** edit bodies → `forbidden`). |
| Input (`editCommentInput`) | `{comment_id: uuid, body: string}` (B-rules). |
| Preconditions | `created_at > now() - interval '15 minutes'` (`isWithinEditWindow`, `EDIT_WINDOW_MS = 900000`, boundary exclusive) else `edit_window_expired`; `status in ('published','held')` else `not_found`. |
| Rate limit | `assertRateLimit('comment_edit', profile_id, 20, '1 minute')` (`rate_limit_hits`). |
| Effects | Update `body`, `edited_at = now()`; status unchanged (a held comment stays held). `revalidateTag(targetTag)`. |
| Returns | `{ok:true, data:{comment: CommentView}}`. Errors: `forbidden`, `edit_window_expired`, `validation`, `too_many_links`, `banned`, `not_found`, `rate_limited`. 05 T-ACT-17 `edit_window_closed` → `edit_window_expired` (§11.2). |
| Tests (05) | T-ACT-17, T-ACT-18; T-RLS-71, T-RLS-72, T-RLS-73; T-UNIT-8. |

#### `deleteComment`
| Item | Contract |
|---|---|
| Auth | author (`requireOnboarded()`, not banned) **or** `requireRole('moderator')`. |
| Input (`deleteCommentInput`) | `{comment_id: uuid}`. |
| Rate limit | `assertRateLimit('comment_delete', profile_id, 20, '1 minute')` (`rate_limit_hits`; not applied to moderators). |
| Effects | Soft delete: `status='deleted'` (body retained in DB, never returned to non-mods; slot renders "Deleted." per DESIGN.md §11.2), `moderated_by/moderated_at` set when actor ≠ author. Likes/reports untouched; `comment_count` untouched. `revalidateTag(targetTag)`. Author delete has no time window. |
| Returns | `{ok:true, data:{comment_id, status:'deleted'}}`. Errors: `forbidden`, `not_found`, `banned`. |
| Tests (05) | T-ACT-19; T-RLS-74, T-RLS-78. |

#### `toggleLike`
| Item | Contract |
|---|---|
| Auth | `requireOnboarded()`; not banned. |
| Input (`toggleLikeInput`) | `{comment_id: uuid}`. |
| Preconditions | Comment `status='published'` and target visible → else `not_found`. |
| Rate limit | `assertRateLimit('like', profile_id, 60, '1 minute')` counting `comment_likes.user_id, created_at` (unlikes not counted). |
| Effects | If row `(comment_id, user_id)` exists → delete; else insert. `like_count` maintained by trigger. `revalidateTag(targetTag)` (02 §5: like_count is in cached HTML; optimistic UI covers the gap). |
| Returns | `{ok:true, data:{liked: boolean, like_count: number}}`. Errors: `banned`, `not_found`, `rate_limited`. |
| Tests (05) | T-ACT-20; T-RLS-80, T-RLS-83, T-RLS-84. |

#### `reportComment`
| Item | Contract |
|---|---|
| Auth | `requireOnboarded()`; not banned. |
| Input (`reportCommentInput`) | `{comment_id: uuid, reason: z.enum(['spam','rude','other']), note?: string ≤ 300}` (`ReportPicker`: Spam / Rude / Something else). |
| Preconditions | Comment `status='published'`; not own comment (`validation`, "You can't report your own comment."). |
| Rate limit | `assertRateLimit('report', profile_id, 10, '1 hour')` counting `comment_reports.reporter_id, created_at` (supersedes 00 O-1's "3 / 60 s"). |
| Effects | Insert `comment_reports` (unique `(comment_id, reporter_id)` → duplicate = `ok:true` no-op, idempotent — 00 S1.4.AC9 "no error to UI"; there is **no** `already_reported` code; 05 T-ACT-21/T-E2E-27 to be amended, §11.2). Count unresolved reports; if `>= AUTO_HOLD_REPORTS (3)` and comment `status='published'` → set `status='held'`, `moderated_by = null`, `moderated_at = now()` (auto-hold, Q38) and emit `comment.held` (`payload.reason='reports'`). Always emit `comment.reported` `payload {comment_id, report_count, reason, excerpt(140), target…}`. |
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
| Preconditions | Target `role = 'user'` (mods/admins cannot be banned by this action, by any actor → `forbidden`; resolves 05 OPEN-14 "admin→anyone" as **no** — demote first via `setUserRole`); target ≠ self. |
| Effects | Update `profiles.is_banned, banned_reason` (service role). No cascade on existing comments (OPEN-3). No revalidation (02 §5 `banUser` row to be dropped, §11.2). Ban is reversible from `/admin/comments` (`banned:false`). SC-24 audit line. |
| Returns | `{ok:true, data:{profile_id, is_banned}}`. Errors: `forbidden`, `not_found`. |
| Tests (05) | T-ACT-24; T-E2E-28. |

#### `renameUserHandle` (registry addition §11.1; spec §9 "moderators can rename")
| Item | Contract |
|---|---|
| Trigger | `/admin/comments` row menu "Rename handle" (03 to add the control; DESIGN.md has no dedicated state — plain `Field` + inline confirm). |
| Auth | `requireRole('moderator')`. |
| Input (`renameUserHandleInput`) | `{profile_id: uuid, handle: string (H-rules)}`. |
| Preconditions | Target exists; target `role='user'` unless actor is `admin` (mods cannot rename mods/admins → `forbidden`); RPC `check_handle` (evaluated as the target) → `handle_taken` / `handle_reserved` / `validation`. |
| Effects | Update `profiles.handle`, `handle_changed_at = now()` (service role). No event, no revalidation (handles are joined at read time; cached HTML refreshes ≤ 600 s, 02 O-10). SC-24 audit line. |
| Returns | `{ok:true, data:{profile_id, handle}}`. Errors: `forbidden`, `not_found`, `handle_taken`, `handle_reserved`, `validation`. |
| Tests | none in 05 yet → §11.3. |

### 1.3 Settings (S1.5 — `/admin/settings` ships whole in S1.5 per `_registry.md`; S1.4 reads the seeded `moderation_mode='auto'`; 02 §1.3/§8 "S1.1 stub" to be removed, §11.2)

#### `updateSettings`
| Item | Contract |
|---|---|
| Trigger | `/admin/settings` SAVE SETTINGS. |
| Auth | `requireRole('admin')`. |
| Input (`updateSettingsInput`) | all optional (partial update): `moderation_mode: z.enum(['auto','hold_first_time'])` · `admin_notify_emails: z.array(email).max(10)` (each `z.string().email().max(254)`, lowercased, de-duplicated; never pre-filled from the session — 00 S1.5.AC4) · `discord_webhook_url: z.string().regex(/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/).or(z.literal(''))` — omitted = unchanged (UI shows it masked), `''` = clear · `kofi_page: /^[A-Za-z0-9_-]{1,40}$/ \| ''` · `comments_closed_default: boolean` · `announcement_md: string ≤ 2000 \| null` · `matrix: z.array({kind: catalogKind, channel: z.enum(['email','discord']), enabled: boolean})` — kinds outside the v1 `notification_matrix` set (`comment.new, comment.held, comment.reported, sync.failed, sync.stale`) rejected with `validation` (COMING LATER rows are display-only). |
| Effects | Update `site_settings where id = 1`; upsert `notification_matrix` rows; `revalidateTag('settings')`; **plus `revalidateTag('projects')` when `comments_closed_default` changed** (02 §5). `discord_webhook_url` is never returned to the client — action returns `discord_webhook_set: boolean` and `discord_webhook_tail` (last 4 chars, `maskSecret`). SC-24 audit line. |
| Returns | `{ok:true, data:{settings: {…without discord_webhook_url, discord_webhook_set, discord_webhook_tail}, matrix}}`. Errors: `forbidden`, `validation`. |
| Tests (05) | T-ACT-25, T-ACT-26, T-ACT-27; T-RLS-12, T-RLS-14; T-UNIT-25, T-UNIT-27, T-UNIT-28; T-E2E-37. |

#### `testDiscordWebhook`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Rate limit `assertRateLimit('discord_test', profile_id, 10, '1 minute')` (`rate_limit_hits`). |
| Input (`testDiscordWebhookInput`) | `{url?: string}` (same regex); absent → stored `site_settings.discord_webhook_url`; neither → `validation`. |
| Effects | `adapters/discord.postEmbed(url, {title:'Test — odsens', description:'The allay says hi.', color: INDIGO})` (§4.6); nothing stored; URL never logged. |
| Returns | `{ok:true, data:{status:number}}` or `{ok:false, error:{code:'upstream_error', message}}` (inline ✔/✕ line, DESIGN.md §12.1). 05 T-ACT-28 `webhook_rejected` → `upstream_error` (§11.2). |
| Tests (05) | T-ACT-28. |

#### `setUserRole` (registry addition §11.1)
| Item | Contract |
|---|---|
| Trigger | `/admin/settings` Moderators table (Make mod / Remove; add by handle) — DESIGN.md §11.3 p.15; 00 S1.5.AC11. |
| Auth | `requireRole('admin')`. |
| Input (`setUserRoleInput`) | `{handle: string (H1), role: z.enum(['user','moderator','admin'])}`. |
| Preconditions | Target exists (`not_found`); target ≠ self when demoting (`forbidden`, avoids locking out the last admin); at least one admin must remain (`conflict`). |
| Effects | Update `profiles.role` (service role). SC-24 audit line. |
| Returns | `{ok:true, data:{profile_id, handle, role}}`. Errors: `not_found`, `forbidden`, `conflict`. |
| Tests | 05 has none → §11.3 (00 S1.5.AC11 "a moderator cannot promote"). |

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
| Preconditions | `source='odsens'`. To `published`: `icon_url` not null AND ≥ 1 `project_versions` with ≥ 1 `project_files` (`storage_path` not null) → else `precondition_failed` with message listing what's missing ("Nothing to download yet." when no file; OPEN-5 = 05 OPEN-8). |
| Effects | Update `status`; on first publish set `published_at = now()`. `revalidateTag('projects')`, `revalidateTag('project:<slug>')`. SC-24. |
| Returns | `{ok:true, data:{id, status}}`. Tests (05): T-ACT-37; T-E2E-35. |

#### `curateProject`
| Item | Contract |
|---|---|
| Trigger | `/admin/projects/[id]` curate panel (feature/hide/reorder/extra gallery/notes/comments toggle). |
| Auth | `requireRole('moderator')`. |
| Input (`curateProjectInput`) | `{project_id: uuid, featured?: boolean, featured_order?: int 1..99 \| null, hidden?: boolean, title_override?: 1..80 \| null, description_override?: 1..256 \| null, extra_gallery?: [{path: string, title?: ≤120, description?: ≤ 500, ordering: int}] max 20, notes_md?: ≤ 20000 \| null, comments_enabled?: boolean}` — every `extra_gallery.path` must match `^project-media/<this project_id>/gallery/[A-Za-z0-9._-]+\.(png\|jpg\|webp)$` and exist in bucket `project-media` (HEAD check); this action **reorders/edits/removes** gallery entries — adding one is `uploadProjectMedia kind='gallery'`. |
| Effects | Upsert `project_overrides` (PK project_id). `revalidateTag('projects')`, `revalidateTag('project:<slug>')`. SC-24. |
| Returns | `{ok:true, data:{override}}`. Errors: `forbidden`, `not_found`, `validation`. Tests (05): T-ACT-40 (mod = A, §11.2); T-RLS-41, T-RLS-42; T-E2E-34. |

#### `setProjectLink`
| Item | Contract |
|---|---|
| Trigger | `/admin/projects/[id]` "CurseForge id" field (Q39 manual entry). |
| Auth | `requireRole('moderator')`. Rate limit `assertRateLimit('project_link', profile_id, 30, '1 hour')`. |
| Input (`setProjectLinkInput`) | `{project_id: uuid, platform: z.literal('curseforge'), ref: string ≤ 300 \| null}` — `ref` is either digits (`/^\d{1,10}$/`) or a CurseForge URL `^https://(www\.)?curseforge\.com/minecraft/(mc-mods|texture-packs|data-packs|bukkit-plugins|modpacks|shaders)/([a-z0-9-]+)`; `null` removes the link. |
| Preconditions | `CURSEFORGE_API_KEY` set else `upstream_error` message "CurseForge key not configured". |
| Effects | URL → resolve id via `adapters/curseforge.searchBySlug(slug)` (§4.2); id → `adapters/curseforge.getMod(id)`; upsert `project_links {project_id, platform:'curseforge', external_id: String(id), url: data.links.websiteUrl, downloads: data.downloadCount, synced_at: now()}` **and set `projects.downloads_curseforge` immediately** (05 T-ACT-41 "untouched until sync" to be amended, §11.2). `null` → delete the row and set `downloads_curseforge = 0`. `revalidateTag('projects')`, `revalidateTag('project:<slug>')`. SC-24. |
| Returns | `{ok:true, data:{link}}`. Errors: `not_found` (no CF mod), `upstream_error`, `validation`, `rate_limited`. |
| Tests (05) | T-ACT-41; T-ADP-7 (fixture `mod.json`); `search.json` path → §11.3. |

#### 1.4.5 Uploads — two-phase signed-upload pattern (SC-18) — **OPEN-11 (= 00 O-9): decision required before freeze**
Proposed default: **adopt** (Vercel 4.5 MB request-body cap makes single-shot 100 MB uploads impossible), recorded as `ADR-0002-signed-uploads.md` (ADR-R7, security gate) with these amendments in the same PR: 01 INV-51 → "browsers may `PUT` to a **server-issued** signed upload URL for a **server-generated** path only; the commit phase validates before any DB row; check: `createSignedUploadUrl` appears only in `lib/actions/uploads.ts` and `lib/actions/art.ts`"; 01 INV-33 → storage policies still service-role only (signed upload tokens are not policies); data-model §3 sentence → "never direct-from-browser with broad policies; two-phase signed uploads per 04 §1.4.5"; `security-check` Uploads checklist gains the commit-phase re-validation line. Until decided, avatars/skins (inline) are unaffected.

Applies to `uploadProjectMedia`, `uploadProjectFile`, `createArt`/`updateArt` image. Both phases are the **same action name** with a discriminated `phase`:

| Phase | Input | Server does | Returns |
|---|---|---|---|
| `begin` | `{phase:'begin', …target ids, filename, size_bytes, mime}` | role check → `assertRateLimit('upload:<bucket>', profile_id, …)` (§5.5) → validate declared size ≤ cap and extension allowlist → compute path (SC-21; `{hash}` is not known yet, so `begin` uses a `crypto.randomUUID()` placeholder segment which `commit` renames to `{hash}` via `storage.move`) → `storage.from(bucket).createSignedUploadUrl(path)` (service role, token valid `UPLOAD_TOKEN_HOURS`, default 2 h) → insert **no DB row yet** | `{ok:true, data:{path, token, signed_url}}` |
| (browser) | `PUT` the file to `signed_url` with the token (Supabase `uploadToSignedUrl`) | — | — |
| `commit` | `{phase:'commit', path, …metadata}` | role check → path must match the pattern for the caller's target ids → `download` the object (streaming) → check magic bytes (SC-19), actual size ≤ cap, image dimensions (`sharp.metadata()`), sha512 (files) → on failure **delete the object** and return error → on success `move` to the final `{hash}` path (media/art), write DB row(s) → revalidate | `{ok:true, data:{row}}` |

Rules: U1 an object with no committed row is garbage — `snapshotStats` deletes objects older than 24 h whose path is not referenced by `project_files.storage_path`, `projects.icon_url`, `projects.gallery[].url`, `project_overrides.extra_gallery[].path`, `art.image_path` (avatars `profiles.avatar_path` and skins `skins.texture_path`/`render_bust_path` are **excluded** — inline uploads never orphan). U2 `begin` rate limits apply per §5.5 (`rate_limit_hits`). U3 commit is idempotent on `path` (`conflict` → return existing row). U4 Client `UploadWell` shows the printed limits from `UPLOAD_KINDS` (03's remit).

#### `uploadProjectMedia`
| Item | Contract |
|---|---|
| Auth | `kind='gallery'` on a `source='modrinth'` row → `requireRole('moderator')` (S1.2 curation, 00 S1.2.AC8); everything else → `requireRole('admin')` (S1.3). Bucket `project-media` (public-read). |
| Input (begin) | `{phase:'begin', project_id: uuid, kind: z.enum(['icon','gallery']), filename, size_bytes ≤ 5_242_880, mime ∈ image/png\|jpeg\|webp}`. |
| Input (commit) | `{phase:'commit', project_id, kind, path, title?: ≤120, description?: ≤500}`. |
| Validation (commit) | Magic bytes PNG/JPEG/WebP; `icon`: square, 64..1024 px; `gallery`: max 4096×4096, min 320 px wide. |
| Effects | `icon`: `projects.icon_url = path` — `source='odsens'` only; modrinth rows → `forbidden`. `gallery`: `source='odsens'` → append `{url: path, title, description, ordering: max+1, featured:false}` to `projects.gallery`; `source='modrinth'` → upsert `project_overrides` and append `{path, title, description, ordering: max+1}` to `extra_gallery`. Revalidate `projects`, `project:<slug>`. SC-24. |
| Returns | `{ok:true, data:{path, entry}}`. Errors: `forbidden`, `not_found`, `validation`, `storage_error`, `rate_limited`, `conflict`. |
| Tests (05) | T-ACT-38 (path pattern per SC-21, §11.2); T-UNIT-17, T-UNIT-18. |

#### `uploadProjectFile`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Bucket `project-files` (**private**). Only `source='odsens'` projects (`forbidden` otherwise). |
| Input (begin) | `{phase:'begin', project_id, version_number: /^[0-9A-Za-z.\-+_]{1,32}$/, filename (ext ∈ .jar .zip .mrpack after SC-20), size_bytes ≤ 104_857_600, mime}` — `begin` computes `version_id` = existing `project_versions (project_id, version_number)` id or a fresh uuid reserved in the returned path; the version row is upserted only at commit. |
| Input (commit) | `{phase:'commit', project_id, path, version: {version_number, name?: ≤80, changelog_md?: ≤20000, game_versions: GAME_VERSION[] min 1, loaders: LOADERS[] min 1, version_type: z.enum(['release','beta','alpha']), date_published?: iso (default now)}, primary?: boolean}`. |
| Validation (commit) | ZIP magic bytes; size ≤ 100 MB (OPEN-10); sha512 computed by streaming; filename unique within version (`conflict`). |
| Effects | Upsert `project_versions` (external_id null); insert `project_files {version_id, filename, size_bytes, sha512, url:null, storage_path: path, primary, download_count:0}`; if `primary` true → clear `primary` on siblings; if version has no primary → this file becomes primary. Revalidate `projects`, `project:<slug>`. SC-24. |
| Returns | `{ok:true, data:{version_id, file:{id, filename, size_bytes, sha512}}}` — sha512 is displayed in `VersionsTable` (security-check). |
| Tests (05) | T-ACT-39 (path per SC-21, §11.2); T-UNIT-17, T-UNIT-18, T-UNIT-22; T-RLS-117, T-RLS-119. |

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

Skin download: `DOWNLOAD PNG` (DESIGN.md §6 p.5) links to `/api/download/[fileId]` with the **skin id** — the generic route resolves kind `skin` (§2.3 D2) and increments `skins.downloads` (00 S1.7.AC4). Art download (`art.downloadable=true`) is a direct public-bucket link with `?download=<slug>.<ext>`; art has no counter column in v1.

#### `createArt` / `updateArt`
| Item | Contract |
|---|---|
| Auth | `requireRole('admin')`. Bucket `art` (public-read); image via two-phase (≤ 10 MB) — image optional on update. |
| Input (metadata) | `{id?, slug: SLUG, title: 1..80, kind: z.enum(['avatar','thumbnail','icon','render','other']), year?: int 2015..currentYear+1 \| null, credit?: ≤ 40 (`/^[A-Za-z0-9_ .-]*$/` — a handle, never a real name/PII; helper copy states this), downloadable: boolean, status: draft\|published, sort_order: int}`; begin/commit fields per §1.4.5 with `size_bytes ≤ 10_485_760`, mime png/jpeg/webp. |
| Validation (commit) | Magic bytes; `sharp.metadata()` → `width`,`height` written by server (client-supplied ignored); max 8192 px per side. Images are stored as uploaded (no re-encode; natural aspect preserved — DESIGN.md §6 p.6). |
| Effects | Insert/update `art {image_path, width, height, …}`; old object deleted on replace. `revalidateTag('art')`. SC-24. |
| Returns | `{ok:true, data:{art}}`. Errors: `forbidden`, `validation`, `conflict`, `storage_error`, `rate_limited`. |
| Tests (05) | T-ACT-60, T-ACT-61 (`credit ≤ 40`, `year 2015..`, §11.2); T-E2E-38. |

### 1.6 Mentions (S1.8)

#### `fetchMentionPreview`
| Item | Contract |
|---|---|
| Trigger | `/admin/mentions` paste URL → `MentionPreview`. Nothing stored. |
| Auth | `requireRole('moderator')`. Rate limit `assertRateLimit('mention_preview', profile_id, 30, '1 minute')` (`rate_limit_hits`). |
| Input (`fetchMentionPreviewInput`) | `{url: z.string().url().max(2048)}` — scheme `https:` (or `http:` upgraded to https), host must not resolve to a private/loopback/link-local range (SSRF guard, checked after DNS in `adapters/oembed.assertPublicHost`), no credentials in URL. |
| Logic | §5.4 metadata chain. |
| Returns | `{ok:true, data:{platform, external_id, canonical_url, title, creator_name, creator_url, thumbnail_url, published_at, view_count, source:'oembed'\|'data_api'\|'og'}}`; unknown/unsupported → `{ok:false, error:{code:'upstream_error', message:"Couldn't read that page. You can fill the fields by hand."}}`. |
| Tests (05) | T-ACT-62; T-ADP-14, T-ADP-15, T-ADP-16; T-E2E-39. Chain order → §11.3. |

#### `createMention`
| Item | Contract |
|---|---|
| Auth | `requireRole('moderator')`. |
| Input (`createMentionInput`) | `{url (as above), project_id: uuid \| null (null = "About OddSense generally"), platform: z.enum(['youtube','tiktok','twitch','reddit','article','other']), external_id?: ≤ 64, title: 1..200, creator_name: 1..80, creator_url?: URL, thumbnail_url?: URL, published_at?: iso, view_count?: int ≥ 0, status: z.enum(['draft','published']) default draft, featured: boolean, sort_order?: int}`. |
| Preconditions | `url` unique (canonicalised: strip `utm_*`, `si`, `feature` params; YouTube → `https://www.youtube.com/watch?v=<id>`) → `conflict`. `project_id` must exist (`validation`). |
| Effects | Insert `mentions {…, source:'manual', created_by: auth.uid()}`. `revalidateTag('mentions')`; if `project_id` → `revalidateTag('project:<slug>')`. SC-24. |
| Returns | `{ok:true, data:{mention}}`. Errors: `forbidden`, `validation`, `conflict`. Tests (05): T-ACT-63; T-RLS-104; T-E2E-39. |

#### `updateMention`
| Item | Contract |
|---|---|
| Auth | `requireRole('moderator')`. |
| Input (`updateMentionInput`) | either `{id: uuid, patch: Partial<createMention input minus url> & {status?: draft\|published\|hidden}}` **or** `{reorder: [{id, sort_order:int}] max 200}` (drag-reorder; runs in one transaction). |
| Effects | Update; `revalidateTag('mentions')` + affected `project:<slug>` tags. Suggested-tab Approve (S2.4) = `patch.status='published'` on a `status='suggested'` row — never automatic. SC-24. |
| Returns | `{ok:true, data:{mention}}` / `{ok:true, data:{reordered:n}}`. Tests (05): T-ACT-64; T-RLS-103, T-RLS-105. |

### 1.7 Sync (S1.2)

#### `triggerSync`
| Item | Contract |
|---|---|
| Trigger | `SyncStatus` "Sync now" buttons in `/admin/projects` (and `sync-now` skill via cron route instead). |
| Auth | `requireRole('moderator')`. |
| Input (`triggerSyncInput`) | `{source: z.enum(['modrinth','curseforge','youtube','mentions','stats']), full?: boolean}` (`full` only meaningful for `youtube` = walk the uploads playlist). `notify` is not triggerable here (the Test button covers Discord; email is exercised by real events). |
| Effects | Calls the job function directly (`lib/jobs/*`; 01 INV-72), not the HTTP route; job lock (SC-13) applies; writes `sync_runs`; job's own revalidations. SC-24. |
| Returns | `{ok:true, data:<JobSummary>}` or `{ok:false, error:{code:'conflict', message:'Already running.'}}` / `upstream_error`. |
| Tests (05) | T-ACT-42 (mod = A, §11.2); T-E2E-41. |

---

## 2. Route handlers

### 2.0 Sign-in (S1.1) — no route handler
Sign-in is client-side per 02 §4: `GoogleSignInButton` (client leaf) calls `supabase.auth.signInWithOAuth({provider:'google', options:{redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext(currentPathAndHash))}`}})`. There is **no** `/auth/sign-in` route and no `signInWithGoogle` action (03 `GoogleSignInButton` "form posting to 04 §auth" → client `C` calling `signInWithOAuth`, §11.2). Analytics `sign_in` event per §5.6.

### 2.1 `/auth/callback` (S1.1) — `app/auth/callback/route.ts`, `GET` — behaviour = 02 §4 verbatim
| Step | Rule |
|---|---|
| A1 | Read `code`, `next` → `next = safeNext(next)` (`lib/auth.ts`, 02 RP-19: must start with `/`, not `//` or `/\`, not `/api`, `/auth`, `/admin`; else `/`). No `code` → 307 `/`. |
| A2 | `supabase.auth.exchangeCodeForSession(code)` (`@supabase/ssr` cookie client); on error → 307 `/` and `log.warn({action:'auth_callback', id, msg:'exchange_failed'})` (no error page — 02 O-9; no `?auth_error` param). |
| A3 | Read `profiles.handle` (trigger has created the row): null → 307 `/welcome?next=<next>`; else → 307 `<next>`. |
| A4 | Response carries the session cookies set by the SSR client; `Cache-Control: no-store`. |
| Tests (05) | T-ACT-8; T-ACT-10 (middleware); T-E2E-21. |

### 2.2 `/auth/sign-out` (S1.1) — `app/auth/sign-out/route.ts`, `POST` only
Verify `Origin` (fallback `Referer`) host equals `NEXT_PUBLIC_SITE_URL` host (CSRF) else 403; `supabase.auth.signOut()` → 303 redirect `/`. `GET`/others → 405. Un-onboarded users may call it (02 RP-20). Tests (05): T-ACT-9; T-E2E-32.

### 2.3 `/api/download/[fileId]` (S1.3; kind `skin` from S1.7) — `app/api/download/[fileId]/route.ts`, `GET`, dynamic, nodejs
| Step | Rule |
|---|---|
| D1 | `fileId` must be a uuid else 404. Methods: **GET only; HEAD/POST/others → 405** (02 §2.9 — HEAD would double-count). |
| D2 | `lib/files.ts` `resolveDownloadable(id)` (generic — 01 INV-56; bucket + owner scope come from data): (a) `project_files f join project_versions v join projects p left join project_overrides o where f.id = $1` → require `f.storage_path IS NOT NULL` (synced Modrinth files have `url` and are never proxied), `p.status='published'`, `coalesce(o.hidden,false)=false` → `{kind:'project_file', bucket:'project-files', path, filename, counter:'record_download'}`; else (b) `skins where id = $1 and status='published'` → `{kind:'skin', bucket:'skins', path: texture_path, filename:'<slug>.png', counter:'record_skin_download'}`; else **404** (never 403; do not reveal drafts). S2.3 adds `workroom_files` + membership check here. |
| D3 | Rate limit: `assertRateLimit('download', ipHash, 30, '1 minute')` — scope source `project_downloads.ip_hash` for `project_file`; `rate_limit_hits` for `skin` → **429**, `Retry-After: 60`, `Content-Type: text/plain`, body `Slow down a little.` |
| D4 | Counters + log in **one SQL statement**: `project_file` → RPC `record_download(p_file_id, p_ip_hash, p_ua_hash)` = `update project_files set download_count = download_count+1; update projects set downloads_direct = downloads_direct+1; insert project_downloads(project_id, file_id, ip_hash, ua_hash)` (single transaction, `security definer`, executable by service role only). `skin` → RPC `record_skin_download(p_skin_id)` = `update skins set downloads = downloads+1` (§11.1). |
| D5 | `project_file`: `storage.from('project-files').createSignedUrl(path, 60, {download: filename})` → **60 s** TTL, `Content-Disposition: attachment; filename="<filename>"`. `skin`: public object URL + `?download=<filename>`. |
| D6 | Respond **302** `Location: <url>`, headers `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. |
| D7 | Analytics: the *client* button fires `track('download', …)` per §5.6 before navigating (03 `TrackedLink`); the route itself does no analytics call. |
| Errors | 404 (unknown/unpublished/synced), 405, 429, 500 `{ok:false, error:{code:'internal', message}}` (signed URL failure; counters already incremented — acceptable, logged). |
| Tests (05) | T-ACT-43, T-ACT-44; T-RLS-117, T-RLS-118; T-UNIT-23 (HMAC per SC-17, §11.2); T-E2E-31. Skin kind, HEAD 405, 429 body → §11.3. |

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

Tests (05): T-ACT-33 (GET only; POST → 405), T-UNIT-24; T-E2E-43. Lock `skipped:'running'` → §11.3.

### 2.5 `/api/og` (optional, S1.10) — `app/api/og/route.ts`
`GET ?title=<≤80 chars>&type=<project_type|''>` (02 §1.4) → `ImageResponse` 1200×630 (title, `TypeBadge` colours from tokens, wordmark); `runtime='nodejs'` (01 INV-22 — 02's "edge runtime" to be amended, §11.2); `Cache-Control: public, max-age=86400, s-maxage=86400`; no DB reads/writes; invalid params → default image (never 500). If not built, `metadata.openGraph.images` falls back to `public/brand/og-default.png` (02 RP-06). Test: §11.3 (only if built).

### 2.6 `/api/webhooks/kofi` — Phase 2 (S2.1) — see §9.1.

---

## 3. Jobs (`lib/jobs/*.ts`)

Common signature: `export async function <job>(opts: {runId?: string, trigger: 'cron'\|'manual', full?: boolean}): Promise<JobSummary>` where `JobSummary = {ok: boolean, source, run_id, items: number, ms: number, error?: string, skipped?: string, [k: string]: unknown}`. Each job: acquire lock (SC-13) → insert `sync_runs` → work → finalize row (SC-11) → revalidate tags → on failure emit `sync.failed` per rule J-F below → return summary.

| # | Rule |
|---|---|
| J-F | `sync.failed` is **edge-triggered** (this doc owns the rule; 01 INV-71 "dedupe on (kind, source, day)" to be replaced by "per 04 J-F/J-S", §11.2): emitted only when this run fails **and** the previous `sync_runs` row for the same `source` has `ok = true` (or none exists). Payload `{source, run_id, error(≤300), started_at}`. 05 T-ACT-45 must seed the previous run `ok=true` (SEED-12 does). |
| J-S | `sync.stale` is emitted by `notifyFanOut` step F0 for each source in `('modrinth', 'youtube', 'curseforge'*, 'mentions'**)` with no `sync_runs` row `ok=true` in the last **6 h**, at most once per 6 h per source (dedupe: last `sync.stale` event for `subject_id = source` older than 6 h). Excluded: `stats` (daily cadence — a 6 h window is meaningless), `notify` (it is the emitter), `skins` (script only). *`curseforge` only when `CURSEFORGE_API_KEY` is set and ≥ 1 `project_links` curseforge row exists. **`mentions` only when `YOUTUBE_API_KEY` is set and ≥ 1 YouTube mention exists. |
| J-P | Partial failure keeps old data: a per-item error is caught, counted in `summary.errors[]` (≤ 20 entries), and the run is `ok = false` only if the **list** call failed or > 50 % of items failed. |
| J-I | Idempotent: keys per job below; a run with unchanged upstream data changes no row except `synced_at`. |
| J-D | Jobs never `.delete(` synced rows (01 INV-24). The only deletions in `lib/jobs/` are `snapshotStats` housekeeping: RPC `purge_project_downloads(90)` (§11.1) and Storage `remove()` of orphan objects (U1) — 01 INV-24's grep must exempt these (§11.2). |

### 3.1 `syncModrinth` (S1.2) — hourly
| Item | Contract |
|---|---|
| Idempotency key | `projects (source='modrinth', external_id)`; `project_versions.external_id` (Modrinth version id); `project_files (version_id, filename)`. |
| Steps | 1. `adapters/modrinth.listUserProjects(MODRINTH_USER)` → full Project objects. `/v2/user/{user}/projects` returns full Project objects (gallery, body, license, links included), so the per-project `GET /v2/project/{id}` in data-model §5 is unnecessary — verified against fixture `user-projects.json`. 2. For each object with `status in ('approved','archived')` (Modrinth status enum: `approved, archived, rejected, draft, unlisted, processing, withheld, scheduled, private, unknown` — only the first two are publicly listable): map (§5.2) → upsert `projects` sync-owned columns: `slug, project_type, title, description, body_md, icon_url, gallery[{url,title,description,ordering,featured}], categories (Modrinth categories ∪ additional_categories), loaders, game_versions, license (license.id), source_url, issues_url, discord_url, downloads_modrinth, followers, published_at, external_updated_at, status:'published', synced_at`. Never touch `project_overrides`. 3. `adapters/modrinth.listVersions(projectId)` → upsert `project_versions {external_id, version_number, name, changelog_md, game_versions, loaders, version_type, date_published, downloads}` and `project_files {filename, size_bytes, sha512 (hashes.sha512), url, primary, storage_path:null}`. Versions/files absent upstream are **not deleted** (OPEN-6). 4. Any `projects (source='modrinth')` row whose `external_id` was not in the list this run → `status='hidden'` (never delete). Skipped only if step 1 failed. 5. Skipped Modrinth types (`modpack`, `shader`) counted in `summary.skipped`. |
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
| Steps | 1. RSS `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}` (keyless) → ids, titles, published dates → upsert minimal rows (`title, published_at, thumbnail_url = https://i.ytimg.com/vi/<id>/hqdefault.jpg`). 2. If `YOUTUBE_API_KEY` set: `videos.list part=snippet,contentDetails,statistics id=<all known ids in batches of 50>` → `title, description, thumbnail_url (maxres ▸ standard ▸ high ▸ medium ▸ default), duration_seconds (ISO 8601 parse), view_count, like_count, published_at`. `is_short` per §5.3. 3. If `full` **or** `videos` table empty: walk `playlistItems.list part=contentDetails playlistId="UU"+channelId.slice(2)` (50/page) to collect all ids first. 4. Videos absent from a `full` walk are **not** deleted; `hidden` is admin-owned (no v1 action — OPEN-7). |
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
| Idempotency key | `stats_daily (day, metric, source, entity_type, entity_id)` — `insert … on conflict do update set value = excluded.value` (date-idempotent; re-run overwrites). `day` = UTC date of the run. Site-level rows use `entity_id = '00000000-0000-0000-0000-000000000000'` (sentinel — §11.1, because PK columns cannot be null). |
| Metrics written (`stats_daily.metric` values listed in §11.1) | (a) per project (`entity_type='project'`): `downloads/modrinth`, `downloads/curseforge`, `downloads/direct` = current totals; (b) site (`entity_type='site'`): `downloads/modrinth\|curseforge\|direct` = sums; `comments/odsens` = count `status='published'`; `comments_held/odsens` = count `status='held'`; `likes/odsens` = sum `like_count`; `users/odsens` = count `profiles where handle is not null` (aggregate only, no ids — flagged for David, §11.1); `reach/youtube` = sum `mentions.view_count where status='published'`; `mentions/odsens` = count published; (c) per video (`entity_type='video'`): `views/youtube`, `likes/youtube`; (d) channel (`entity_type='channel'`, entity sentinel): `views/youtube`, `subs/youtube` from `channels.list part=statistics id=${YOUTUBE_CHANNEL_ID}` (1 unit; skipped if no key); (e) `direct_downloads_day/direct` per project for **day − 1** = count of `project_downloads` rows on that UTC day; (f) `tips/kofi` site = 0 in v1 (S2.1 fills from `kofi_events`). |
| Housekeeping | RPC `purge_project_downloads(90)` (deletes `project_downloads where created_at < now() - interval '90 days'`, 01 INV-50); RPC `purge_rate_limit_hits(1)` (rows older than 1 day); orphan Storage objects per U1 (older than 24 h, no referencing column) removed via `storage.remove()`, capped at `ORPHAN_CLEANUP_MAX` (§5.8, default 200) per run — logged in summary. |
| Revalidate | none (admin stats page is dynamic). |
| Tests (05) | T-ACT-45, T-ACT-55. Purge > 90 d only, orphan cleanup ignores committed objects, run-twice same day → §11.3. |

### 3.6 `notifyFanOut` (S1.5) — every 5 min (step 1 of `/api/cron/notify`)
| Step | Rule |
|---|---|
| F0 | Stale check (J-S) — emits `sync.stale` events before fan-out. |
| F1 | Select `notification_events e where not exists (select 1 from notification_recipients r where r.event_id = e.id) and e.created_at > now() - FANOUT_WINDOW_DAYS` order by `created_at` limit `FANOUT_BATCH` (§5.8; defaults 7 d / 500). |
| F2 | For each event: for each channel in `('email','discord')`: `enabled = coalesce((select enabled from notification_matrix where kind = e.kind and channel = c), false)`. **email**: if enabled and `site_settings.admin_notify_emails` non-empty → one row per address `{event_id, profile_id:null, channel:'email', address, status:'pending', attempts:0}`; else one row `{channel:'email', address:null, status:'skipped'}`. **discord**: if enabled and `site_settings.discord_webhook_url` non-empty → one row `{channel:'discord', address: <the webhook URL>, status:'pending'}` (docs/notifications.md Pipeline 2 "address = webhook"; the value is masked to `…<last 4>` in every admin view and never logged — INV-43); else `status:'skipped'`. Kinds absent from the matrix (`comment.reply`, `comment.approved`, P2 kinds) → both rows `skipped`. |
| F3 | Result: every event has ≥ 2 recipient rows after F2 → F1 never re-selects it (idempotency key = `(event_id, channel, coalesce(address,''))`; unique index in schema, §11.1). |
| Tests (05) | T-ACT-29, T-ACT-32. Matrix OFF → skipped rows; run twice → no duplicates → §11.3. |

### 3.7 `notifyDeliver` (S1.5) — same tick (step 2)
| Step | Rule |
|---|---|
| N1 | Eligible = `status='pending' and attempts < 5 and (attempts = 0 or updated_at <= now() - backoff(attempts))`, `backoff(a) = 5 min × 2^(a−1)` (5, 10, 20, 40, 80 min). Order `created_at asc`, limit `DELIVER_BATCH` per tick (§5.8, default 100). |
| N2 | Group **per channel** (email: per `address`; discord: one group) — refines notifications.md "per channel". If a group has **> 5** eligible rows → one **digest** message (subject/title "N things from the allay", list of kind + target + excerpt, link `/admin/comments` or `/admin/settings`); else one message per row. |
| N3 | Send via `lib/notify/deliver/email.ts` (`adapters/resend`) or `deliver/discord.ts` (`adapters/discord`, URL = the row's `address`) — both implement `Deliverer = (rows: RecipientRow[], ctx) => Promise<{sent: string[], failed: {id, error}[]}>`. Timeout 10 s per call (SC-09), retries per SC-09 inside a single attempt. |
| N4 | Mark: sent → `status='sent', sent_at=now(), attempts+1`; failed → `attempts+1, error(≤500)`; `status='failed'` when `attempts` reaches 5 (max 5 — notifications.md). Digest marks all its rows together. |
| N5 | Email content: React Email templates in `emails/` (`CommentNew`, `CommentHeld`, `CommentReported`, `SyncFailed`; digest uses `EmailLayout` with a list) + plain-text alternative always; From `odsens <${NOTIFY_FROM_EMAIL}>`; `Reply-To` = `NOTIFY_FROM_EMAIL` **only after** inbound forwarding exists (questions.md setup to-do; until then no Reply-To header); subject formats: `comment.new` "New comment on <target title>" · `comment.held` "Held for review: <target title>" · `comment.reported` "Reported comment on <target title>" · `sync.failed` "Sync failed: <source>" · `sync.stale` "Sync stale: <source>" · digest "<N> things from the allay" (05 T-UNIT-26 "Reported: comment on" → this text, §11.2). Every email footer: "The allay emails you because <switch> is on." + link `${NEXT_PUBLIC_SITE_URL}/admin/settings`. |
| N6 | Discord embed (§4.6): `username:'allay'`, `avatar_url: ${SITE_URL}/brand/allay.png` (asset pending Q44 — omit field until the file exists), embed `{title: '<Event> — <target title>', description: excerpt(200), url: link, color}` with color indigo `0x4B45D6` default · gold `0xFFC61F` for `comment.held`/`comment.reported` · alert `0xCC3A2A` for `sync.failed`/`sync.stale`. |
| N7 | Missing provider config at send time (`RESEND_API_KEY` unset / row `address` empty) → rows marked `failed` immediately with `error='not_configured'` (no retries). |
| Summary | `{items: sent, failed, digests, skipped}`. |
| Tests (05) | T-ACT-30, T-ACT-31; T-ADP-17, T-ADP-18, T-ADP-19; T-UNIT-3, T-UNIT-26. Backoff schedule, attempts 5 → failed, not_configured path → §11.3. |

### 3.8 `renderSkinBust` (S1.7) — on skin create/update (awaited by action) + `scripts/render-skins.mjs` for backfill
| Item | Contract |
|---|---|
| Input | `skin_id`. Reads `skins.texture_path`, `model`. |
| Logic | Render a 3:4 bust PNG (default 600×800 px, transparent background) → **output ≤ 512 KB** (data-model §3; re-encode with `sharp` `png({compressionLevel:9, palette:true})` if larger) → upload `skins/{skin_id}/bust.png` (`upsert:true`) → set `render_bust_path`. Timeout 20 s. On failure: log, leave `render_bust_path` unchanged, return `{ok:false}` — never throws to the caller. Renderer: **OPEN-13** (= 00 O-14) — proposed default `skinview3d` on headless WebGL (`gl` package) in `lib/skins/render.ts`; if not viable in the S1.7 PR → ADR (ADR-R5, new native dependency) switching to client-render + cache. |
| Idempotency | Path is fixed per skin; re-render overwrites. Writes a `sync_runs` row `source='skins'` **only** when run from the script (batch), not per action call. |
| Tests (05) | T-ACT-56 (path per SC-21, §11.2). Size ≤ 512 KB, failure non-fatal → §11.3. |

---

## 4. Adapters (`lib/adapters/*.ts`) — pure I/O + mapping; no DB access

| Adapter | Base URL | Auth | Functions (export names — 05 to adopt, §11.2) | Timeout / retry | Quota / limits | Fixtures |
|---|---|---|---|---|---|---|
| **4.1 `modrinth`** (`createModrinth`) | `https://api.modrinth.com/v2` | none; `User-Agent` SC-10 **required** | `listUserProjects(user)` → `GET /user/{user}/projects` · `listVersions(projectId)` → `GET /project/{id}/version` · `mapProject(raw) → ProjectRow` (§5.2) · `mapVersion(raw) → {version, files[]}` · `mapProjectType(project_type, loaders)` | SC-09 | 300 req/min; honour `X-Ratelimit-Remaining/Reset` (sleep until reset when remaining < 5) | `tests/fixtures/modrinth/user-projects.json`, `versions.json`, `project-shader.json`, `error-429.json` |
| **4.2 `curseforge`** (`createCurseforge`) | `https://api.curseforge.com/v1` | header `x-api-key: ${CURSEFORGE_API_KEY}` | `getMod(id)` → `GET /mods/{id}` → `{id, slug, downloadCount, links.websiteUrl}` · `searchBySlug(slug)` → `GET /mods/search?gameId=432&slug={slug}&pageSize=5` → first `data[]` whose `slug` equals · `parseRef(ref)` → `{id}\|{slug}` | SC-09 | key-scoped; unknown → treat as ≥ 60 req/min: sequential calls only | `curseforge/mod.json`, `search.json`, `error-403.json`, `error-404.json` |
| **4.3 `youtube`** (`createYoutube`) | RSS `https://www.youtube.com/feeds/videos.xml` · Data API `https://www.googleapis.com/youtube/v3` | RSS none · Data API `key=${YOUTUBE_API_KEY}` (redacted from errors/logs) | `fetchRss(channelId)` → `[{youtube_id, title, published_at, thumbnail_url, description}]` · `listVideos(ids[])` (batches ≤ 50, `part=snippet,contentDetails,statistics`) · `listUploads(channelId)` (playlistItems paging) · `channelStats(channelId)` · `parseDuration(iso8601) → seconds` · `pickThumbnail(thumbnails)` · `isShort(v)` (§5.3) · `mapVideo(item)` · `oembed(url)` → `GET https://www.youtube.com/oembed?url=<enc>&format=json` (no key) · `videoIdFromUrl(url)` (handles `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`) · exposes `unitsUsed` | SC-09 | 10,000 units/day; each `list` call 1 unit | `youtube/rss.xml`, `rss-malformed.xml`, `videos-list.json`, `videos-mentions.json`, `playlist-items.json`, `oembed.json`, `channels.json` |
| **4.4 `oembed`** (`createOembed`) | any | none | `fetchOpenGraph(url)` → GET with UA, `Accept: text/html`, follow ≤ 3 redirects (each hop re-checked by SSRF guard), read ≤ 1 MB, parse `og:title, og:image, og:site_name, og:url, og:type, article:published_time, <title>` → `{title, image, site_name, canonical, published_at, og_type}` · `assertPublicHost(url)` → resolves DNS; rejects loopback, RFC1918, link-local, CGNAT, IPv6 ULA/loopback, `.local`; rejects non-`http(s)`; rejects userinfo · `detectPlatform(url)` → hostname map: `youtube.com\|youtu.be → youtube`, `tiktok.com → tiktok`, `twitch.tv\|clips.twitch.tv → twitch`, `reddit.com\|redd.it → reddit`, else `article` (05 T-ADP-16 "`article` only when `og:type=article`, else `other`" → 04's rule, §11.2: the admin can change the platform in the form; `other` is reachable by hand) | 10 s, **no retry** (interactive) | — | `oembed/og-page.html` |
| **4.5 `resend`** (`createResend`) | `https://api.resend.com` via `resend` SDK | `RESEND_API_KEY` | `sendEmail({to, subject, react, text, from, replyTo?, headers:{'X-Entity-Ref-ID': recipient_row_id}})` → `{id}`; `from` defaults `odsens <${NOTIFY_FROM_EMAIL}>` (05 T-ADP-17 `{template,to,props}` → this signature, §11.2; the template → `react`/`text` mapping lives in `deliver/email.ts`) | 10 s; retry per SC-09 (Resend 429) | free tier 3k/mo; ≤ 2 req/s → deliverer sends sequentially | `resend/send-ok.json` (mocked SDK) |
| **4.6 `discord`** (`createDiscord`) | webhook URL passed per call (the row's `address` / the tested URL) | URL is the secret; never logged; regex in §1.3 | `postEmbed(url, {title, description, url?, color, fields?})` → `POST {url}?wait=true` body `{username:'allay', avatar_url?, embeds:[…]}` → `{status}`; 429 → respect `retry_after` (ms) once (05 T-ADP-18 `postWebhook` → `postEmbed`, §11.2) | 10 s; SC-09 | Discord webhook ~30 req/min per webhook — deliverer sends ≤ `DISCORD_PER_TICK` (§5.8, default 20) per tick | `discord/webhook-ok.json` |

Adapter rules: A1 adapters never import Supabase; A2 every adapter function is tested only against fixtures (no live calls in CI, `test-engineer` policy); A3 mapping functions are pure and exported for T-UNIT/T-ADP tests; A4 raw error bodies from upstream are truncated to 300 chars before storage/logging; A5 factory `create<Adapter>({fetch, env})` (SC-25). Tests (05): T-ADP-1, T-ADP-20 for all adapters.

---

## 5. Decision tables

### 5.1 Comment moderation — status on insert (`postComment`) and after reports (`reportComment`)
Inputs: `mode = site_settings.moderation_mode`, `first = (profiles.comment_count = 0)`, `role = author role`, `banned`, `reports = unresolved report count`.

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

¹ M2/M7 role exemption is a build decision not in data-model §2.5 (05 T-UNIT-6 `decideCommentStatus` takes `authorRole`, so 05 assumes it); recorded here — data-model §2.5 to gain the sentence "moderators/admins are never held or auto-held" (§11.2). `hidden` and `deleted` are reachable only via `moderateComment`/`deleteComment` (§1.2). Approving M4/M6 → `published` + `comment.approved`. Tests (05): T-ACT-14, T-ACT-22, T-UNIT-6, T-UNIT-7.

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

### 5.3 YouTube Shorts heuristic (`adapters/youtube.isShort`) — **OPEN-8**
Proposed default (matches data-model §2.3): `is_short = duration_seconds <= 60 || /\B#shorts\b/i.test(title + ' ' + description)`. Rows: `PT45S` no tag → true · `PT61S` no tag → false · `PT2M` with `#Shorts` in description → true · `PT10M` → false · `duration_seconds` null → false. Refinement (e.g. `HEAD https://www.youtube.com/shorts/<id>` 200-vs-redirect probe, or duration ≤ 180 s) requires `ADR-0003-shorts-detection.md` (registry's example ADR name). Admin override of `is_short` is not in v1 (OPEN-7). Tests (05): T-ADP-11.

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
| `postComment` | `comment`, `comment_day` | 5 / min and 50 / 24 h per user | `comments.author_id, created_at` |
| `editComment` | `comment_edit` | 20 / min per user | `rate_limit_hits` |
| `deleteComment` (author) | `comment_delete` | 20 / min per user | `rate_limit_hits` |
| `reportComment` | `report` | 10 / h per user | `comment_reports.reporter_id, created_at` |
| `toggleLike` | `like` | 60 / min per user | `comment_likes.user_id, created_at` |
| `/api/download/[fileId]` | `download` | 30 / min per `ip_hash` | `project_downloads.ip_hash, created_at` (project files) · `rate_limit_hits` (skins) |
| `completeOnboarding` | `onboarding` | 10 / 10 min per user | `rate_limit_hits` (01 O-4) |
| `checkHandle` | `check_handle` | 60 / min per user | `rate_limit_hits` (01 O-4) |
| `updateProfile` handle | — | 1 / 7 d per user (OPEN-2) | `profiles.handle_changed_at` (§11.1) |
| `updateProfile` avatar | `avatar` | 10 / 10 min per user | `rate_limit_hits` |
| `deleteAccount` | `delete_account` | 1 / day per user | `rate_limit_hits` |
| uploads (`begin`) | `upload:project-media`, `upload:art`, `upload:project-files` | 60 / h media, 60 / h art, 30 / h files, per admin | `rate_limit_hits` (a `begin` counts even without commit) |
| `setProjectLink` | `project_link` | 30 / h per user | `rate_limit_hits` |
| `fetchMentionPreview` | `mention_preview` | 30 / min per user | `rate_limit_hits` |
| `testDiscordWebhook` | `discord_test` | 10 / min per user | `rate_limit_hits` |
| `triggerSync` | — | lock SC-13 | `sync_runs` |
| `skins`/`art` create/update | `upload:skins`, `upload:art` | 60 / h per admin | `rate_limit_hits` |

`rate_limit_hits` is purged by `snapshotStats` (`purge_rate_limit_hits(1)`). 01 INV-69's surface list is a subset of this table (01 to add the rest, §11.2). Copy for `rate_limited`: "Slow down a little." (01 INV-69).

### 5.6 Analytics events — client-side `track()` payload contract (01 INV-59; fired by 03 `TrackedLink` / `VideoFacade` / `GoogleSignInButton`)
| Event | Payload keys (all strings/numbers; **no handles, ids of users, or emails**) | Fired by |
|---|---|---|
| `download` | `{project: <slug>, source: 'modrinth'\|'curseforge'\|'direct'}` (skins: `{project:'skin:<slug>', source:'direct'}`) | `GetItPanel`, `FeaturedHero`, `SkinCard` DOWNLOAD PNG |
| `tip_click` | `{amount: 1\|3\|5\|'other', from: 'support'\|'tip-panel'\|'floating'}` | `AmountPicker`, `TipPanel`, `FloatingSupportButton` |
| `video_play` | `{youtube_id: <id>, kind: 'video'\|'short'\|'mention'}` | `VideoFacade` on play |
| `sign_in` | `{from: 'nav'\|'prompt'\|'admin'}` | `GoogleSignInButton` |
| (rejected) `external_out` | not a v1 event — 03 `TrackedLink` union to drop it (§11.2) | — |
Rule: `track()` is called only from `components/**` client leaves via `lib/analytics.ts` `trackEvent(name, props)` (typed union of the four names); test → §11.3.

### 5.7 Ko-fi handoff (`/support`, S1.9; 02 §2.7)
| Item | Rule |
|---|---|
| Page URL | `https://ko-fi.com/<site_settings.kofi_page>` — CONTINUE ON KO-FI opens it in a new tab (`rel="noopener noreferrer"`); the chosen amount is **not** passed in v1 (Ko-fi has no documented preset-amount URL param — `docs/design-review.md` #13; **OPEN-14**: if Ko-fi supports one, append it via `lib/support.ts` `kofiUrl(page, amount)` and cover with T-UNIT). |
| Panel iframe | `https://ko-fi.com/<kofi_page>/?hidefeed=true&widget=true&embed=true` inside `KofiPanelSlot`, click-to-load, `/support` only (CSP `frame-src`). |
| Empty `kofi_page` | picker + button disabled, "Tips open soon.", panel slot hidden (02 O-8). |
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

## 6. `vercel.json` cron table (S0 empty list → filled per slice; this doc fixes the strings — 00 §4.1; 02 §1.4 to copy them verbatim, §11.2)

| Path | Schedule (UTC cron) | Added in | Notes |
|---|---|---|---|
| `/api/cron/sync-modrinth` | `7 * * * *` | S1.2 | hourly, :07 |
| `/api/cron/sync-curseforge` | `17 * * * *` | S1.2 | hourly, :17 (offset from Modrinth) |
| `/api/cron/sync-youtube` | `27 * * * *` | S1.6 | hourly, :27 |
| `/api/cron/refresh-mentions` | `37 * * * *` | S1.8 | hourly, :37 |
| `/api/cron/stats-snapshot` | `0 3 * * *` | S1.9 | daily 03:00 UTC (data-model §5) |
| `/api/cron/notify` | `*/5 * * * *` | S1.5 | every 5 min |

Rules: V1 `vercel.json` `crons[]` entries are exactly `{path, schedule}` from this table (deploy-checker compares). V2 Vercel sends `Authorization: Bearer ${CRON_SECRET}` — routes accept nothing else (SC-12). V3 Preview deployments do not run crons; manual pings use the same header. V4 Changing a schedule = ADR-R6. V5 `maxDuration` per SC-12 (300 / 60).

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
| `precondition_failed` | 409 | publish requirements (OPEN-5) |
| `rate_limited` | 429 | SC-08 — "Slow down a little." |
| `upstream_error` | 502 | external API failed (message is safe to show) |
| `storage_error` | 500 | Storage upload/signing failed |
| `job_failed` | 500 | cron route wrapping a failed job |
| `internal` | 500 | unexpected; logged with `id` |

---

## 8. Tests map — 04 contract → 05 test IDs (05 owns the IDs, 00 rule 0.5; this doc introduces none)

| 04 contract | 05 IDs |
|---|---|
| SC-02/SC-03 shape, never throws | T-ACT-0 (05 wording `error?:string` → `error.code`, §11.2) |
| §1.1 accounts | T-ACT-1…7; T-RLS-5, 6, 8; T-UNIT-1, 2; T-E2E-21, 22, 23 |
| §1.2 comments | T-ACT-11…24; T-RLS-67…78, 80, 83, 84, 86, 87; T-UNIT-4…8; T-E2E-24…28, 36 |
| §1.3 settings | T-ACT-25…28; T-RLS-12, 14; T-UNIT-25, 27, 28; T-E2E-37 |
| §1.4 projects, uploads | T-ACT-34…41; T-RLS-17, 19, 41, 42, 117, 119; T-UNIT-17, 18, 20, 22; T-E2E-34, 35 |
| §1.5 skins, art | T-ACT-56…61; T-UNIT-19; T-RLS-54; T-E2E-38 |
| §1.6 mentions | T-ACT-62…64; T-ADP-14…16; T-RLS-103…105; T-E2E-39 |
| §1.7 triggerSync | T-ACT-42; T-E2E-41 |
| §2.1–2.2 auth routes | T-ACT-8, 9, 10; T-E2E-32 |
| §2.3 download route | T-ACT-43, 44; T-RLS-117, 118; T-UNIT-23; T-E2E-31 |
| §2.4 cron auth | T-ACT-33; T-UNIT-24; T-E2E-43 |
| §3 jobs | T-ACT-45…56; T-ADP-1…13, 20 |
| §3.6–3.7 notify | T-ACT-29…32; T-ADP-17…19; T-UNIT-3, 26 |
| §5.1 moderation table | T-ACT-14, 22; T-UNIT-6, 7 |
| §5.2 mapping | T-ADP-2; T-ACT-47 |
| §5.3 shorts | T-ADP-11 |
| SC-16 env | T-UNIT-16 |
| Gaps | §11.3 "Tests to add in 05" |

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
| Tests | §11.3 (bad token 401; replay dedupe; linking chain; fixture `kofi/donation.json`). |

### 9.2 Others
- **S2.2** `createOrder` (`orders`, rate limit 3 / day / user, `order.new` event, `/commissions` visible) · **S2.3** workroom actions (`createWorkroom`, `postWorkroomUpdate`, `uploadWorkroomFile` via §1.4.5 with allowlist png/jpg/webp/zip/txt/md/pdf, 25 MB/file, 200 MB/room; `/api/download/[fileId]` gains kind `workroom_file` (bucket `workroom-files`) + membership check through `resolveDownloadable`; `workroom.*` events to members with `email_updates`) · **S2.4** `syncMentionsSuggested` cron (YouTube `search.list` per project title + "OddSense", 100 units/call — budget cap 2,000 units/day; inserts `status='suggested'`, `mention.suggested` event) · **S2.5** deliverer `inapp` reading `notification_recipients`.

---

## 10. Open (proposed defaults; not decided in the sources)

| # | Item | Proposed default | Owner |
|---|---|---|---|
| OPEN-1 | Reserved handle list beyond the five named by `security-check` (`admin, oddsense, odsens, moderator, mod`) | adopt the list in §1.1 H3 | David / `keep-docs` (Q34 addendum) |
| OPEN-2 | Users renaming their own handle: DESIGN.md §11.3 "Change handle" vs data-model §4 RLS "handle only null→value" (= 05 OPEN-2) | allow via `updateProfile` with the service-role client, limit 1 change / 7 days (`profiles.handle_changed_at`); data-model §4 note amended | `keep-docs`, `supabase-ops` |
| OPEN-3 | `banUser` cascade on the user's existing comments | none in v1 (mods hide manually) | David |
| OPEN-4 | = 01 O-4 (single decision): rate-limit source for scopes with no natural table | **the `rate_limit_hits` table** (adopted throughout §5.5) | `security-check` |
| OPEN-5 | `publishProject` preconditions (= 05 OPEN-8) | require icon + ≥ 1 version with ≥ 1 file | Oliver |
| OPEN-6 | Modrinth versions/files removed upstream: keep (never delete) vs delete rows | keep in v1; add `project_versions.hidden` in a later migration if stale rows show | `supabase-ops` |
| OPEN-7 | Admin action to hide a video / override `is_short` (`videos.hidden` exists, no action in registry) | add `updateVideo {youtube_id, hidden?, is_short?}` (admin) in S1.6 — see §11.1 | David |
| OPEN-8 | Shorts heuristic (§5.3) | duration ≤ 60 s or `#shorts` tag; refine via `ADR-0003-shorts-detection.md` | `backend-robustness` |
| OPEN-9 | `deleteAccount` semantics (DESIGN.md §11.3 p.11 has the action; = 02 O-6) | as specified in §1.1 `deleteAccount` | David (privacy) |
| OPEN-10 | `project-files` size cap: data-model §3 says 100 MB; DESIGN.md upload-well copy example says "The limit is 50"; local `supabase/config.toml` `file_size_limit = "50MiB"` (= 05 OPEN-6, 01 O-7) | 100 MB (data-model wins); raise `config.toml` limit to `100MiB` and print "100 MB" under the well | `supabase-ops`, `design-fidelity` |
| OPEN-11 | Two-phase signed-upload pattern (§1.4.5) vs 01 INV-51/INV-33 + data-model §3 wording (= 00 O-9) — **decision required before freeze** | adopt §1.4.5 with `ADR-0002-signed-uploads.md` (ADR-R7) + amendments listed in §1.4.5 | David, `security-check` |
| OPEN-12 | `stats_daily.metric='users'` (aggregate count of onboarded profiles) — new stored aggregate about people (stop-and-ask list) | write it (aggregate only, no ids); drop if David objects | David |
| OPEN-13 | Skin bust renderer (= 00 O-14) | `skinview3d` on headless WebGL; ADR to client-render + cache if not viable in S1.7 | `backend-robustness` |
| OPEN-14 | Ko-fi preset amount in the handoff URL (`docs/design-review.md` #13) | none in v1; add `kofiUrl(page, amount)` if a documented param exists | David |
| OPEN-15 | 00 O-1's "3 reports / 60 s" vs §5.5 "10 / h" for `reportComment` | §5.5 supersedes 00 O-1 (00 to note) | `security-check` |

---

## 11. Registry additions + sibling amendments

### 11.1 Registry additions (add to `_registry.md` before use; ADR-R4 — no ADR needed)

| Kind | Addition | Why |
|---|---|---|
| Action | `deleteAccount` (`lib/actions/accounts.ts`, S1.1) — 02 §10 lists it under `lib/actions/profile.ts`; **04's file wins** | DESIGN.md §11.3 p.11 "Delete account" |
| Action | `setUserRole` (`lib/actions/settings.ts`, S1.5) | DESIGN.md §11.3 p.15 Moderators table; 00 S1.5.AC11 |
| Action | `renameUserHandle` (`lib/actions/comments.ts`, S1.4, moderator) | spec §9 "moderators can rename" |
| Action | `updateVideo` (`lib/actions/videos.ts`, S1.6) — OPEN-7 | `videos.hidden` / `is_short` override |
| RPC | `check_handle(text) returns text`, `record_download(uuid, text, text)`, `record_skin_download(uuid)`, `purge_project_downloads(int)`, `purge_rate_limit_hits(int)`, `rate_limit_ok(text, text, int, interval)` (01) | §1.1, §2.3, §3.5, SC-08 |
| Table | `rate_limit_hits (scope text, key text, at timestamptz)` index `(scope, key, at)`; RLS: service role only (01 O-4 adopted) | SC-08, §5.5 |
| Column | `profiles.handle_changed_at timestamptz null` | OPEN-2 rate limit, `renameUserHandle` |
| Column | `site_settings.owner_profile_id uuid null references profiles` (set by seed/SQL; read via `lib/data/settings.ts getOwnerProfileId()`) | CREATOR tag (§1.2 `CommentView`; 03 `Comment`) |
| Column / index | `notification_recipients` unique index `(event_id, channel, coalesce(address,''))`; `updated_at` used for backoff | §3.6 F3, §3.7 N1 |
| Convention | `stats_daily.entity_id` sentinel `00000000-0000-0000-0000-000000000000` for site/channel rows (PK cannot contain null) | §3.5 |
| `stats_daily.metric` values | `downloads, direct_downloads_day, views, subs, comments, comments_held, likes, users (OPEN-12), reach, mentions, tips` — extends data-model §2.9 | §3.5 |
| `sync_runs.source` values | `modrinth, curseforge, youtube, mentions, stats, notify, skins` | §2.4, §3.8 |
| Download route kinds | `resolveDownloadable` kinds `project_file` (S1.3), `skin` (S1.7), `workroom_file` (S2.3) | §2.3 |
| Env | `HASH_SECRET` (server-only, ≥ 32 random bytes) → `.env.example` + Vercel prod/preview at S1.3 (supersedes 00 §6 `IP_HASH_SALT`; = 01 O-3) | SC-17 |
| Env | `CURSEFORGE_MEMBER` — proposed **removal** from `.env.example` (unused in v1) | SC-16 |
| Storage | `project-files` bucket limit 100 MiB (prod + `config.toml`) | OPEN-10 |
| Storage paths | SC-21 patterns (04 owns) | §1.4, §1.5 |
| `lib/auth.ts` exports | `requireOnboarded()`, `safeNext()` added to 01 INV-32's list | SC-04 |
| Types | `ActionResult<T>`, `ActionErrorCode` (`lib/actions/result.ts`, shape SC-03, union §7); `CommentView` (`lib/data/comments.ts`); `JobSummary` (`lib/jobs/types.ts`); `AdapterError` (`lib/adapters/http.ts`) | SC-03, §1.2, §3, SC-09 |
| Files | `lib/adapters/http.ts` (`fetchJson`, `AdapterError`), `lib/hash.ts` (`ipHash`, `uaHash`, `emailHash`), `lib/log.ts` (`log`, 01), `lib/rate-limit.ts` (`assertRateLimit`, 01), `lib/uploads.ts` (`validateUpload`, `UPLOAD_KINDS`, path builders, avatar re-encode — 01), `lib/validation/handle.ts` (`handleSchema`, `RESERVED_HANDLES`, `isReserved`), `lib/validation/comment.ts` (`commentBodySchema`, `stripHtml`, `countLinks`), `lib/validation/moderation.ts` (`decideCommentStatus`, `shouldAutoHold`, `AUTO_HOLD_REPORTS`, `isWithinEditWindow`, `EDIT_WINDOW_MS`), `lib/validation/files.ts` (`sniffMime`, `pngDimensions`, `isSkinTexture`, `sanitizeFilename`), `lib/validation/slug.ts` (`slugSchema`, `slugify`), `lib/files.ts` (`resolveDownloadable`), `lib/notify/emit.ts`, `lib/notify/constants.ts`, `lib/jobs/constants.ts`, `lib/skins/render.ts`, `lib/analytics.ts` (`trackEvent`), `lib/support.ts` (`kofiUrl`), `lib/actions/admin.ts` (`triggerSync`) | shared helpers named in this doc; 05 COV-3 `lib/validation/**` |
| Adapter export names (05 to adopt) | `modrinth.{createModrinth, listUserProjects, listVersions, mapProject, mapVersion, mapProjectType}` · `curseforge.{createCurseforge, getMod, searchBySlug, parseRef}` · `youtube.{createYoutube, fetchRss, listVideos, listUploads, channelStats, parseDuration, pickThumbnail, isShort, mapVideo, oembed, videoIdFromUrl}` · `oembed.{createOembed, fetchOpenGraph, assertPublicHost, detectPlatform}` · `resend.{createResend, sendEmail}` · `discord.{createDiscord, postEmbed}` | §4 |
| Analytics events | `download`, `tip_click`, `video_play`, `sign_in` — payloads §5.6 (`external_out` rejected) | 01 INV-59 |
| Error codes | the §7 union (adds `unauthorized`, `job_failed` for route handlers) | 01/03 reference |
| ADR slugs (reserved) | `ADR-0002-signed-uploads.md` (OPEN-11), `ADR-0003-shorts-detection.md` (OPEN-8) | ADR-R7 / ADR-R6 |

### 11.2 Sibling amendments required (one truth per fact; the named doc line changes to match this doc — done in the freeze PR)

| Doc | Line / section | Change to |
|---|---|---|
| 01 | INV-19 | add `field?`/`issues?` to the error object as in SC-03 (shape otherwise identical) |
| 01 | INV-32 | export list += `requireOnboarded()`, `safeNext()` |
| 01 | INV-24 Check | `grep "\.delete(" lib/jobs` → none **except** `lib/jobs/snapshotStats.ts` (RPC purge + Storage `remove()`, J-D) |
| 01 | INV-47, INV-53 | storage paths per SC-21 (`{hash}` = 16 hex of sha256; `project-media/{project_id}/{icon\|gallery}/{hash}.{ext}`; project files by ids) |
| 01 | INV-51, INV-33 | per §1.4.5 (if OPEN-11 adopted): browser `PUT` to server-issued signed URL allowed; check `createSignedUploadUrl` only in `lib/actions/uploads.ts`, `lib/actions/art.ts` |
| 01 | INV-69 | limited-surface list = §5.5 table |
| 01 | INV-71 | replace dedupe sentence with "per 04 J-F/J-S" |
| 01 | INV-59, §28 | events + payloads per §5.6 |
| 01 | §7 env matrix | `YOUTUBE_API_KEY`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `KOFI_PAGE`, `CURSEFORGE_MEMBER` → O (degrade rules SC-16); `HASH_SECRET` row R from S1.3 |
| 01 | O-3, O-4 | mark decided (`HASH_SECRET`; `rate_limit_hits`) |
| 02 | §1.4 cron column, RP-16, §2.10 | schedules = §6 strings verbatim; `maxDuration` 300 (sync/stats) / 60 (notify) |
| 02 | §1.4 `/api/og` | `runtime='nodejs'`; cache header per §2.5 |
| 02 | §1.3, §8 | `/admin/settings` S1.1 stub removed (S1.5 whole) |
| 02 | §5 revalidation | `banUser` → none; `toggleLike`, `updateSettings` already match |
| 02 | §10 | `deleteAccount` file → `lib/actions/accounts.ts` |
| 02 | §2.9 | 429 body "Slow down a little." (already plain text) — no change; HEAD 405 — matches |
| 03 | `GoogleSignInButton` | `Sh` form → `C` client leaf calling `signInWithOAuth` (§2.0); `sign_in` track payload §5.6 |
| 03 | `AvatarUpload.action` | `typeof updateProfile` (no `uploadAvatar`) |
| 03 | `Comment` CREATOR | `author.id === ownerProfileId` prop from `site_settings.owner_profile_id` |
| 03 | `TrackedLink.event` | drop `external_out` |
| 03 | `ReportPicker` note field | 200 → 300 chars (§1.2 `reportComment`) |
| 03 | `ModActionRow` / `/admin/comments` | add "Rename handle" control → `renameUserHandle` |
| 05 | T-ACT-0 | `error.code` (SC-03) |
| 05 | T-ACT-3, 38, 39, 56, 58; SEED-13 | storage paths per SC-21 (seed objects at id-based paths) |
| 05 | T-ACT-7 | asserts `data.status ∈ {available, taken, reserved, invalid}` |
| 05 | T-ACT-15, 19; T-RLS-126 | `comment_count` +1 only on `published` (insert or approve); never −1 |
| 05 | T-ACT-17 | code `edit_window_expired` |
| 05 | T-ACT-21; T-E2E-27 | duplicate report → `{ok:true, data:{report_count}}` and "Reported." line again; `note` cap 300 |
| 05 | T-ACT-28 | code `upstream_error` |
| 05 | T-ACT-40, 42, 62, 63, 64 | mod = A (curation is moderator) |
| 05 | T-ACT-41 | `downloads_curseforge` set immediately on link |
| 05 | T-ACT-45 | previous run `ok=true` seeded so J-F edge fires |
| 05 | T-ACT-61 | `credit ≤ 40`, `year 2015..currentYear+1` |
| 05 | T-ADP-5, 7, 9, 14, 15, 17, 18 | function names per §11.1 adapter export list (`mapVersion`, `getMod`, `fetchRss`, `youtube.videoIdFromUrl`, `youtube.oembed`, `sendEmail({react,text,…})`, `postEmbed`) |
| 05 | T-ADP-16 | `detectPlatform` else → `article` |
| 05 | T-UNIT-16 | required set = SC-16 required rows |
| 05 | T-UNIT-23 | HMAC-SHA256 keyed by `HASH_SECRET` (`ipHash`/`uaHash`) |
| 05 | T-UNIT-26 | `comment.reported` subject "Reported comment on <title>" |
| 05 | OPEN-5, OPEN-7, OPEN-8, OPEN-14 | closed by §1.0 role rule, §5.2 P4, §1.4 `publishProject`, §1.2 `banUser` |
| 00 | §6 `IP_HASH_SALT`; O-1; O-9; O-13; O-14 | `HASH_SECRET`; reports 10 / h (OPEN-15); OPEN-11; decided per §1.2; OPEN-13 |
| data-model | §2.1 `comment_count`; §2.5 M2/M7 sentence; §3 uploads sentence (if OPEN-11 adopted); §4 RLS moderator on `project_overrides`/`project_links`/`mentions` (supabase-ops hand-off) | as stated in §1.2, §5.1, §1.4.5, §1.0 |
| `.env.example` | add `HASH_SECRET=`; drop `CURSEFORGE_MEMBER` (proposed) | SC-16/17 |
| `security-check` SKILL.md | Uploads: commit-phase re-validation line (if OPEN-11 adopted); Abuse: SC-24 audit line | §1.4.5, SC-24 |

### 11.3 Tests to add in 05 (no numbers assigned here — 05 owns IDs)
- SC-13 lock: second concurrent run → `{ok:true, skipped:'running'}`, no second `sync_runs` row.
- SC-24: every `requireRole` action emits one `msg:'admin'` log line with keys only.
- `deleteAccount`: cascade effects, sign-out, rate limit; `setUserRole`: mod cannot promote, last-admin guard; `renameUserHandle`: role matrix, reserved/taken.
- `/api/download/[fileId]` kind `skin`: `skins.downloads` +1, 302 to public URL with `download`, draft skin → 404; HEAD → 405; 429 body text + `Retry-After: 60`.
- `snapshotStats`: `purge_project_downloads(90)` deletes only > 90 d; U1 orphan cleanup ignores referenced objects and objects < 24 h; run twice same day → same row count; `purge_rate_limit_hits`.
- notify: matrix OFF → `skipped` rows; fan-out twice → no duplicates; backoff schedule 5/10/20/40/80; attempts 5 → `failed`; `not_configured` path; digest > 5 per (channel, address).
- J-F edge: two consecutive failing runs → one `sync.failed`.
- §5.4 chain order with fixtures (oEmbed → Data API → OG), YouTube URL with both 2 and 3 failing → OG.
- §1.4.5 commit: wrong-magic object deleted; commit twice on same path → `conflict` returns existing row; `begin` counts against `rate_limit_hits`.
- `renderSkinBust` output ≤ 512 KB; failure non-fatal to `createSkin`.
- `comment_count` trigger: held first-timer posts again while held → held; approve → +1.
- §5.6 `trackEvent` payload keys per event; no user id/handle keys.
- `setProjectLink` URL path via `curseforge/search.json`.
- `/api/og` (if built): params, `image/png`, cache header.
- §9.1 Ko-fi webhook (S2.1): bad token 401, replay dedupe, linking chain, fixture `kofi/donation.json`.
- `lib/env.ts`: optional-with-degradation rows do not fail boot.

---

## 12. Review notes (v0.2 — findings applied / declined)

- **Return shape**: two findings proposed opposite fixes (keep 04's flat `error:string` vs adopt 01's object). Adopted **01 INV-19's object shape** (SC-03) with `field?`/`issues?` added — INV-44 already uses `{code,message}` for route handlers, so one shape now covers actions and routes; 05 T-ACT-0 to be amended (§11.2).
- **Discord recipient `address`**: the "keep `address:null` + ADR" recommendation was **declined** — `docs/notifications.md` (binding source) and 00 S1.5 say `address = webhook`; F2 now stores it and requires masking (never logged, INV-43).
- **`maxDuration`**: one finding proposed 60 everywhere, another 300/60. Chose **300 for the five sync/stats routes, 60 for notify** (Vercel Pro per spec §7); 02 to amend (§11.2).
- **Two-phase uploads**: kept and escalated to a pre-freeze decision (OPEN-11 = 00 O-9) with the ADR + amendment list stated in §1.4.5, rather than dropping it (a Route-Handler upload would breach 01 INV-17 and still hit the 4.5 MB cap).
- **Skin download counter**: chose extending the generic route (kind `skin`) over "no counter in v1" because 00 S1.7.AC4 and data-model `skins.downloads` require it.
- **`external_out`**: rejected as an analytics event (01 INV-59 lists four; `download` with `source` covers outbound platform clicks); 03 to drop it.
- **Sign-in entry point**: no route/action — 02 §4 already decides client `signInWithOAuth`; 03's `GoogleSignInButton` becomes a client leaf.
- **`triggerSync` `notify` source**: dropped (05 T-ACT-42's five sources).
- **`banUser`** admin→anyone: kept 04's rule (mods/admins are never banned by this action; demote first) and closed 05 OPEN-14 that way.
- **Adapter names**: kept 04's (owner) and listed the 05 rows to rename; added the `create<Adapter>` factory (SC-25).
- **Modrinth status filter**: kept with the enum cited (only `approved`/`archived` are publicly listable).
- **Numbers vs 03/05** (debounce, note 300, credit 40, year 2015…, subject text, detectPlatform): kept 04's as owner of input schemas; debounce number removed from 04 (03's remit).
