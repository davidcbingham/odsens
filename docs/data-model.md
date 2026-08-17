# Data Model & Sync Design

Postgres on Supabase. Written 2026-08-17 against `docs/spec.md` v-current and `DESIGN.md` v1.2; amended 2026-08-17 per
`docs/build/06-decisions/ADR-0002-spec-reconciliation.md` (rate limits, views, RPCs, trigger, RLS rows). This is the plan;
the actual SQL lives in `supabase/migrations/` once we build. Conventions: `snake_case`, `uuid` PKs (`gen_random_uuid()`),
`created_at/updated_at timestamptz` on every table, RLS enabled on every table.

---

## 1. Principles
1. **One projects table for both sources.** Modrinth-synced and odsens-exclusive projects share one shape (Modrinth's), distinguished by `source`. Public pages never care where a project came from.
2. **Sync writes to sync-owned columns; humans write to override columns.** A synced row is re-written by the next sync; Oliver's curation lives in `project_overrides` (never clobbered).
3. **Store snapshots, not just totals.** External platforms expose current numbers only; `stats_daily` keeps history.
4. **Auth identity ≠ display identity.** `auth.users` (Supabase) holds the Google identity; `profiles` holds handle + picture. Nothing from Google is ever selected into a public view.
5. **Browser = anon key + RLS. Server = service role for sync/admin only.**

---

## 2. Tables

### 2.1 Identity & roles
**`profiles`** — one per auth user, created by trigger on sign-up; `handle` is null until onboarding completes.
| col | type | notes |
|---|---|---|
| id | uuid PK → auth.users.id | |
| handle | citext unique, null | 3–20, `^[A-Za-z0-9_]+$`; check constraint; null = onboarding incomplete |
| avatar_path | text null | Storage path in `avatars` bucket |
| role | enum `user|moderator|admin` default user | admins set via SQL/admin UI |
| is_banned | bool default false | |
| banned_reason | text null | |
| comment_count | int default 0 | maintained by trigger (+1 when a comment first reaches `published`; never decrements); used for "first-time commenter" hold logic |
| handle_changed_at | timestamptz null | set by `updateProfile`/`renameUserHandle` (service role); own rename limited to 1 per 7 days (ADR-0002 #27) |
| email_hash | text null | `HMAC-SHA256(HASH_SECRET, lower(email))` (ADR-0002 C13; was plain sha256), set by trigger; server-side use only (Ko-fi matching); **never selected into any view** |
| created_at, updated_at | | |

Public view **`public_profiles`** (`id, handle, avatar_path, role`) — the only thing the client reads about other users.
Handle availability is checked via RPC **`check_handle(p_handle text) returns text`** (`security definer`, `authenticated` only; enforces format, citext uniqueness and the reserved list — same list as `lib/validation/handle.ts`).

### 2.2 Projects
**`projects`**
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| source | enum `modrinth|odsens` | |
| external_id | text null | Modrinth project id; unique with source |
| slug | citext unique | Modrinth slug or Oliver's for exclusives |
| project_type | enum `mod|datapack|resourcepack|plugin` | mapped from Modrinth `project_type` + loaders (Modrinth calls datapacks "mod" w/ loader `datapack`, plugins "mod" w/ `paper|spigot|bukkit…`) |
| title, description | text | short description |
| body_md | text | markdown |
| icon_url | text null | Modrinth CDN URL, or Storage path for exclusives |
| gallery | jsonb | `[{url, title, description, ordering, featured}]` |
| categories | text[] | Modrinth categories |
| loaders | text[] | `fabric, neoforge, forge, paper, datapack, minecraft…` |
| game_versions | text[] | |
| license | text null | |
| source_url, issues_url, discord_url | text null | |
| downloads_modrinth | int default 0 | sync |
| downloads_curseforge | int default 0 | sync (matched via `project_links`) |
| downloads_direct | int default 0 | counted by our download route (exclusives) |
| followers | int default 0 | Modrinth |
| published_at, external_updated_at | timestamptz null | |
| status | enum `draft|published|hidden` default published | exclusives start `draft`; sync rows `published` |
| synced_at | timestamptz null | |
| search | tsvector generated | title + description |

Generated/derived: `downloads_total = modrinth + curseforge + direct` (view column).

**`project_versions`** — one per version (Modrinth version or exclusive release)
| col | notes |
|---|---|
| id uuid PK; project_id FK cascade | |
| external_id text null | Modrinth version id |
| version_number text; name text null; changelog_md text null | |
| game_versions text[]; loaders text[]; version_type enum `release|beta|alpha` | |
| date_published timestamptz | |
| downloads int | Modrinth per-version |
| unique(project_id, version_number) | |

**`project_files`** — files per version
| col | notes |
|---|---|
| id uuid PK; version_id FK cascade | |
| filename text; size_bytes bigint; sha512 text null | |
| url text null | Modrinth CDN (synced) |
| storage_path text null | Storage `project-files/{project}/{version}/{filename}` (exclusives) |
| primary bool | |
| download_count int default 0 | direct downloads (exclusives) |

**`project_links`** — cross-posting map, maintained by Oliver in admin (or auto-matched by slug/title)
| col | notes |
|---|---|
| project_id FK; platform enum `modrinth|curseforge`; external_id text; url text; downloads int; synced_at | PK (project_id, platform) |

**`project_overrides`** — Oliver's curation on top of any project (mostly synced ones)
| col | notes |
|---|---|
| project_id PK/FK | |
| featured bool; featured_order int null | home hero / featured 4-up |
| hidden bool | hide a synced project from the site |
| title_override, description_override text null | |
| extra_gallery jsonb | additional images (Storage) |
| notes_md text null | site-only write-up appended under About |
| comments_enabled bool default true | |

**`project_downloads`** — raw log for exclusive direct downloads (for stats + abuse checks); `project_id, file_id, ip_hash, ua_hash, created_at`. Written only by RPC **`record_download(p_file_id, p_ip_hash, p_ua_hash)`** (one transaction: `project_files.download_count+1`, `projects.downloads_direct+1`, insert log row; `security definer`, service role only). `ip_hash = HMAC-SHA256(HASH_SECRET, ip|utcDay)`. Aggregated nightly into `stats_daily`; rows purged after 90 days by RPC `purge_project_downloads(90)`. Also the rate-limit source for the download route (30 / min per `ip_hash`).

### 2.3 Videos (synced)
**`videos`** — `id uuid; youtube_id text unique; title; description; thumbnail_url; published_at; duration_seconds; is_short bool; view_count; like_count; synced_at; hidden bool` (hidden set by Oliver). Shorts detection: duration ≤ 60s or `#shorts` — Data API has no flag; refine at build.

### 2.3b Mentions — "Seen on" (v1)
**`mentions`** — `id; project_id uuid null` (null = about OddSense generally) `; platform enum youtube|tiktok|twitch|reddit|article|other; url text unique; external_id text null` (YouTube video id) `; title; creator_name; creator_url; thumbnail_url; published_at; view_count bigint null; status enum draft|suggested|published|hidden; source enum manual|auto; featured bool; sort_order; created_by; created_at`.
- Admin flow: paste URL → server action fetches metadata (YouTube oEmbed / Data API `videos`; generic Open Graph fallback) → preview → assign project → publish.
- Hourly job refreshes `view_count` for YouTube mentions (batched `videos?id=…`, ~1 unit per 50 ids); daily snapshot to `stats_daily` (`metric='reach'`).
- v1.5: `sync-mentions` cron runs YouTube `search` per project title (+ "OddSense") → inserts `status='suggested'`, admin approves. Never auto-publish.
- RLS: published readable by all; drafts/suggested admin only.

### 2.4 Native content
**`skins`** — `id; slug unique; name; description_md; texture_path` (Storage `skins/…png` 64×64) `; model enum classic|slim; render_bust_path` (cached PNG) `; is_exclusive bool; status draft|published; sort_order; downloads int` (incremented by RPC **`record_skin_download(p_skin_id)`**, called from `/api/download/[fileId]` when the id resolves to kind `skin` — ADR-0002 C8).
**`art`** — `id; slug; title; kind enum avatar|thumbnail|icon|render|other; image_path; width; height; year int null; credit text null` (commissioned artist handle, optional) `; downloadable bool; status; sort_order`.
**`site_settings`** — single row (`id = 1`): `moderation_mode enum auto|hold_first_time; admin_notify_emails text[]; discord_webhook_url text (secret); kofi_page text; comments_closed_default bool; announcement_md text null; owner_profile_id uuid null FK profiles` (Oliver's profile → CREATOR tag on comments, ADR-0002 #55). (Per-event toggles live in `notification_matrix`.)
Public view **`site_settings_public`** (`comments_closed_default, kofi_page, owner_profile_id`) — readable by all roles; the base table stays admin-only (ADR-0002 C6). `KOFI_PAGE` env only seeds `kofi_page`.

### 2.5 Comments & likes
**`comments`**
| col | notes |
|---|---|
| id uuid PK | |
| target_type enum `project|skin|art|video` ; target_id uuid | polymorphic; index (target_type, target_id, created_at). **v1 threads exist on projects only** (ADR-0002 C21); the enum stays for later targets (`workroom` in Phase 2) |
| author_id FK profiles | |
| parent_id uuid null FK comments | one level: replies to replies store the *root* as parent and prefix `@handle` in body |
| body text | ≤ 1000 chars (check); server strips HTML; ≤ 1 link (server rule) |
| status enum `published|held|hidden|deleted` | held = awaiting approval; deleted keeps slot |
| like_count int default 0 | trigger-maintained |
| edited_at timestamptz null | |
| moderated_by uuid null; moderated_at | |

**`comment_likes`** — PK (comment_id, user_id). Trigger updates `comments.like_count`.
**`comment_reports`** — `id; comment_id; reporter_id; reason enum spam|rude|other; note; created_at; resolved_at; resolved_by`. Unique (comment_id, reporter_id).

Moderation rules (server): on insert, `status = 'held'` if `site_settings.moderation_mode = 'hold_first_time' AND author.comment_count = 0`, else `published`; moderators/admins are never held or auto-held. The rule is enforced by trigger **`comments_set_status()`** (BEFORE INSERT on `comments`; recomputes `status` from `site_settings.moderation_mode`, `profiles.comment_count` and author role, ignoring the client value — ADR-0002 #72); the Server Action inserts its computed status and returns the row as stored. Banned users can't insert (RLS). Any comment with ≥ N reports auto-`held` (N=3, tunable).

SQL helper **`can_comment(p_target_type text, p_target_id uuid) returns boolean`** (`security definer`; = target visible AND comments enabled (override or `site_settings.comments_closed_default`) AND `not profiles.is_banned` for `auth.uid()`) is used by the insert policies on `comments`, `comment_likes`, `comment_reports`.

Public view **`comments_public`** (ADR-0002 #71) — what public pages render (server-side, tag `project:<slug>`): every row of a visible target as a slot with `id, target_type, target_id, parent_id, status, created_at, like_count`; `body`, `author_id`, `edited_at` are non-NULL only for `published` rows **or** the caller's own rows (so held/hidden/deleted rows appear as slots with `body null`). Own held/hidden rows and own likes are read client-side under RLS.

**Build-vs-buy (decided 2026-08-17): built in-house.** Hosted widgets (Disqus, Hyvor, Commento, Cusdis) impose their
UI/identity/moderation and can't do handle-only Google-via-Supabase; GitHub-backed ones (Giscus) are GitHub-only;
self-hosted servers (Remark42, Isso) need their own host and user store. Our version: tables above + ~6 Server Actions
(`postComment, editComment(15 min), deleteComment(soft), toggleLike, reportComment, moderate`) + `<CommentThread>` components
mapped to DESIGN.md states; optimistic UI via React 19 `useOptimistic` (except a first-timer's post under hold mode); plain-text bodies auto-linkified; rate limit in SQL (`rate_limit_ok`, §2.10);
Supabase Realtime optional later. Remark42's data model is a good reference, not a dependency.

### 2.6 Notifications (admin only, v1)
See **`docs/notifications.md`** (decided 2026-08-17). Tables: `notification_events (kind text catalog, actor_id, subject_type/id, payload)`, `notification_recipients (event_id, profile_id, channel, address, status, attempts, sent_at, error)`, `notification_matrix (kind, channel, enabled)`; `site_settings` gains `discord_webhook_url`, `admin_notify_emails`. Admin-only in v1 (Discord + Resend email); Phase 2 adds `notification_prefs` for users.

### 2.7 Custom orders
**`orders`** — `id; user_id FK; kind enum mod|plugin|skin|pack|art; brief text; mc_version text null; loader text null; budget text null; public_ok bool; status enum new|replied|closed; admin_notes text; created_at; updated_at`.

### 2.7b Workrooms (Phase 2 — schema sketch; v1 only keeps hooks)
`workrooms (id, order_id FK, title, status enum brief|quote|in_progress|review|delivered|closed, brief_md, kofi_url, created_at, closed_at)` · `workroom_members (workroom_id, profile_id, role enum owner|client|moderator|viewer, email_updates bool default false, PK(workroom_id, profile_id))` · `workroom_posts (id, workroom_id, author_id, body_md, images jsonb, created_at)` · `workroom_files (id, workroom_id, uploaded_by, filename, size_bytes, sha512, storage_path, kind enum brief|wip|deliverable, created_at)` · comments via `comments.target_type='workroom'`.
Rules: **an admin is auto-added as `moderator` to every workroom** (visible in the participants row); RLS on every table keys on membership; bucket `workroom-files` private, signed URLs after membership check; client uploads allowlisted (png/jpg/webp/zip/txt/md/pdf), 25 MB/file, 200 MB/room; notifications to clients only if `email_updates`. **v1 hooks:** keep `comments` polymorphic (done), make the file table + download route generic (owner scope + bucket), keep admin `/admin/orders` route extensible.

### 2.8 Support (Ko-fi, phase 2)
**`kofi_events`** — raw webhook payloads: `id; kofi_message_id text unique; type text; from_name; message; amount numeric; currency; is_public bool; email_hash text null; timestamp; raw jsonb`.
**`supporters`** — link table `kofi_event_id → profile_id` for the leaderboard (handle + amount). Linking (Q33, decided): on webhook, `email_hash = HMAC-SHA256(HASH_SECRET, lower(email))` compared to a per-profile `email_hash` computed at sign-in from `auth.users.email` (server-side only; raw email never stored in `profiles`) → else parse a `@handle` from the Ko-fi message → else unlinked ("Anonymous"). Amount displayed if linked or `is_public`. Leaderboard = sum(amount) per profile.

### 2.9 Stats
**`stats_daily`** — `day date; metric text; source text; entity_type; entity_id uuid null; value bigint` — PK (day, metric, source, entity_type, entity_id). Metrics: `downloads` (modrinth/curseforge/direct, per project + total), `views`/`subs` (youtube), `comments`, `tips`. Written by the daily snapshot cron from current totals; deltas computed at read time.

**`sync_runs`** — `id; source; started_at; finished_at; ok bool; items int; error text` — for the admin "sync status" and the `sync-sources` skill.

### 2.10 Rate limits (ADR-0002 #14)
**`rate_limit_hits`** — `scope text; key text; ts timestamptz default now()` — index (scope, key, ts). **Service-role only** (no policies for other roles). Created in S1.1. Used for scopes without a natural source table (onboarding, `check_handle`, avatar, comment edit/delete, uploads, skin downloads, …); scopes with a natural table (`comments`, `comment_likes`, `comment_reports`, `project_downloads`) count that table instead. Full scope table: `docs/build/04-server-contracts.md` §5.5.
- RPC **`rate_limit_ok(scope, key, max, window) returns boolean`** — counts rows over the window; called before every limited write (`lib/rate-limit.ts` `assertRateLimit`); on success for hit-based scopes the caller inserts one `rate_limit_hits` row. Exceeding → `rate_limited` (actions) / HTTP 429 JSON + `Retry-After: 60` (routes).
- RPC **`purge_rate_limit_hits(days)`** — housekeeping from the daily stats job (`purge_rate_limit_hits(1)`), alongside `purge_project_downloads(90)`.

### 2.11 SQL functions, views, triggers (summary)
| object | kind | callable by | purpose |
|---|---|---|---|
| `check_handle(text)` | RPC, security definer | authenticated | handle available / taken / reserved / invalid |
| `record_download(file_id, ip_hash, ua_hash)` | RPC, security definer | service role | exclusive-file counters + `project_downloads` log |
| `record_skin_download(skin_id)` | RPC, security definer | service role | `skins.downloads + 1` |
| `rate_limit_ok(scope, key, max, window)` | RPC | service role | SQL rate limiting |
| `purge_project_downloads(days)`, `purge_rate_limit_hits(days)` | RPC | service role | nightly housekeeping |
| `can_comment(target_type, target_id)` | helper, security definer | authenticated (inside policies) | comment/like/report insert precondition |
| `is_moderator()`, `is_admin()` | helpers | policies | role checks on `profiles.role` |
| `comments_set_status()` | trigger BEFORE INSERT on `comments` | — | authoritative held/published status |
| `public_profiles`, `comments_public`, `site_settings_public` | views | all roles | the only public reads of `profiles`, non-published comment slots, settings |

---

## 3. Storage buckets
| bucket | public? | contents | limits |
|---|---|---|---|
| `avatars` | public-read | profile pictures, 512×512 JPEG/PNG/WebP after crop | 1 MB |
| `project-files` | **private**; served via signed URL from `/api/download/[fileId]` (counts the download) | exclusive project files (.jar, .zip) | 100 MB, allowlisted extensions, sha512 recorded |
| `project-media` | public-read | exclusive project icons/gallery/screenshots | 5 MB/img |
| `skins` | public-read | 64×64 texture PNGs + cached bust renders | 64 KB / 512 KB |
| `art` | public-read | art pieces | 10 MB |
Uploads go through server routes/actions (validate type/size, generate paths, write DB row) — never direct-from-browser with broad policies.

---

## 4. Row-level security (outline)
| table | select | insert | update | delete |
|---|---|---|---|---|
| public_profiles (view) | all | — | — | — |
| profiles | own row (full); admin does **not** select other rows via RLS (admin client in actions — ADR-0002 #70) | trigger only | own row: handle (only if null→value), avatar_path; renames + `handle_changed_at`, `role`, `is_banned`, `comment_count`, `email_hash` = admin/service only | admin |
| projects / versions / files / links / overrides | all where `status='published'` and not `overrides.hidden`; admin sees all | admin (exclusives) / service role (sync) | same | admin |
| project_downloads | admin | service role (RPC `record_download`) | service role | admin / service (purge) |
| mentions | published to all; admin all (drafts/suggested/hidden) | admin / service (v1.5 suggested) | admin | admin |
| videos, skins, art | published to all; admin all | admin/service | admin | admin |
| site_settings | admin (public read via view `site_settings_public`) | service role (seeded) | admin | service only |
| site_settings_public (view) | all | — | — | — |
| comments | published to all; own held/hidden rows to author; mods/admins all (public slot rendering via view `comments_public`) | authenticated + `can_comment(target_type, target_id)` (not banned, target visible, comments enabled); status set by trigger `comments_set_status()` | author (body, within 15 min → sets edited_at) ; mods (status) | author (soft → status deleted) / mods |
| comments_public (view) | all (own non-published bodies visible only to their author) | — | — | — |
| comment_likes | all | authenticated, `user_id = auth.uid()`, `can_comment()` | — | own |
| comment_reports | mods | authenticated, `reporter_id = auth.uid()`, `can_comment()`; unique (comment_id, reporter_id) | mods (`resolved_at/by`) | service only |
| orders | own; mods all | authenticated | mods (status/notes) | — |
| notification_events, kofi_events, supporters, stats_daily, sync_runs | admin | service role | service/admin | admin |
| notification_recipients | admin (`address` masked in the app; Discord recipient `address` = webhook URL) | service role | service/admin | admin |
| notification_matrix | admin | admin | admin (`enabled`) | service only |
| rate_limit_hits | **service role only** (all other roles denied on every op) | service role | service role | service role (purge) |
Role checks via a `is_moderator()` / `is_admin()` SQL helper reading `profiles.role`. Sensitive mutations (moderate, ban, settings) go through Server Actions that re-check role server-side in addition to RLS. Action-level roles (ADR-0002 C7): content curation, sync, mentions, uploads, skins/art, settings = **admin**; comment moderation, ban, handle rename = **moderator**. RPC grants: `check_handle` → authenticated; `record_download`, `record_skin_download`, `purge_*`, `rate_limit_ok` → service role only; `can_comment` → authenticated. The full expected matrix is `docs/build/05-test-plan.md` §7.1 (T-RLS); this table is the source it follows.

---

## 5. Sync design
| Job | Cadence | Source → tables | Notes |
|---|---|---|---|
| **Modrinth** | hourly (Vercel Cron) + manual button | `GET /v2/user/OddSense/projects` → `projects`; per project `GET /v2/project/{id}` (gallery, body, license) and `GET /v2/project/{id}/version` → `project_versions`, `project_files` | Upsert by (source, external_id). Map `project_type`: `mod`+loader `datapack`→datapack; `mod`+paper/spigot/bukkit/purpur/folia/velocity/bungeecord→plugin; `resourcepack`→resourcepack; else mod. Respect 300 req/min; send `User-Agent`. New projects default `published`; deleted-upstream → mark `hidden`, never delete. |
| **CurseForge** | hourly | For each `project_links` row with platform curseforge: `GET /v1/mods/{id}` → `downloadCount` → `projects.downloads_curseforge`, `project_links.downloads` | Discovery of CF ids: admin enters CF project id/URL once (or `GET /v1/mods/search?gameId=432&authorId=…` at build if the API allows by author). |
| **YouTube** | hourly | RSS (`feeds/videos.xml?channel_id=`) for cheap new-video detection; Data API `search`/`playlistItems` on uploads playlist + `videos` for stats/duration | Upsert by `youtube_id`. Data API budget: ~few hundred units/day. |
| **Mentions refresh** | hourly | YouTube `videos` for `mentions.external_id` → `view_count` | v1.5 adds `search` → suggested queue |
| **Stats snapshot** | daily 03:00 UTC | reads current totals from `projects`, `videos`, `comments`, `kofi_events` → `stats_daily` | Also aggregates `project_downloads` and purges >90d. |
| **Skin renders** | on skin insert/update (server action) | render bust PNG via headless skinview3d (or `minecraft-skin-render` on Node/canvas) → `skins.render_bust_path` | Fallback: render client-side and cache on first view. |
| **Notifications** | every 5 min | fan-out per `notification_matrix` → deliver via `lib/notify/deliver/{email,discord}` → mark | digest if >5 pending per channel; retries w/ backoff |
| **Ko-fi webhook** | on event | `POST /api/webhooks/kofi` verifies `verification_token` → `kofi_events`, `notification_events(new_tip)` | Phase 2. |
Every run writes a `sync_runs` row; failures don't touch existing data. Public pages use ISR (`revalidate` ~10 min) and revalidate tags after each sync so nothing waits on an API at request time.

---

## 6. Key flows
- **First sign-in:** Google → Supabase Auth → trigger creates `profiles` row (handle null) → app middleware redirects any authenticated user with null handle to `/welcome` (onboarding) → handle uniqueness checked via RPC → avatar upload → done.
- **Comment:** Server Action: check auth + not banned + comments enabled → sanitize/limits → `rate_limit_ok` → compute status per moderation mode → insert (trigger `comments_set_status()` recomputes; row returned as stored) → `notification_events(comment.new|comment.held)` → revalidate `project:<slug>`.
- **Exclusive download:** `/api/download/[fileId]` (GET only) → resolve id (project file → kind `project_file`; skin → kind `skin`; else 404) → verify published → rate limit (30 / min per `ip_hash`) → RPC `record_download` (counters + `project_downloads` log) or `record_skin_download` → 302 to short-lived signed Storage URL (skins: public bucket URL).
- **Add exclusive project (admin):** form (Modrinth-shaped) → server action creates `projects(source=odsens, status=draft)` → uploads via `project-media`/`project-files` → publish toggle.
- **Curate synced project (admin):** upsert `project_overrides` (featured/hidden/extra gallery/notes).

---

## 7. Open build-time decisions (tracked in `docs/questions.md`)
- ~~Handle heuristic~~ decided: structural only. ~~Comment limits~~ decided: 1000 chars, 1 link, 15-min edit window, auto-hold ≥3 reports, manual CF ids.
- ~~Ko-fi tip → supporters linking (Q33)~~ decided: email-hash match → `@handle` in message → unlinked (§2.8).
- ~~Whether report threshold auto-hold (N=3) is wanted~~ decided: yes, N=3 (Q33–40).
- ~~CurseForge id discovery~~ decided: manual entry (`setProjectLink`).
- Build-time defaults settled by ADR-0002 (2026-08-17): `rate_limit_hits` + `rate_limit_ok`, views `comments_public`/`site_settings_public`, `comments_set_status()`, `can_comment()`, `handle_changed_at`, `owner_profile_id`, HMAC `HASH_SECRET`, comments v1 on projects only, admin/moderator action split (C7, [DAVID]-flagged).
