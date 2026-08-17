# Data Model & Sync Design

Postgres on Supabase. Written 2026-08-17 against `docs/spec.md` v-current and `DESIGN.md` v1.2. This is the plan;
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
| comment_count | int default 0 | maintained by trigger; used for "first-time commenter" hold logic |
| email_hash | text null | sha256 of lowercased auth email, set by trigger; server-side use only (Ko-fi matching); **never selected into any view** |
| created_at, updated_at | | |

Public view **`public_profiles`** (`id, handle, avatar_path, role`) — the only thing the client reads about other users.

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

**`project_downloads`** — raw log for exclusive direct downloads (for stats + abuse checks); `project_id, file_id, ip_hash, ua_hash, created_at`. Aggregated nightly into `stats_daily`; rows purged after 90 days.

### 2.3 Videos (synced)
**`videos`** — `id uuid; youtube_id text unique; title; description; thumbnail_url; published_at; duration_seconds; is_short bool; view_count; like_count; synced_at; hidden bool` (hidden set by Oliver). Shorts detection: duration ≤ 60s or `#shorts` — Data API has no flag; refine at build.

### 2.4 Native content
**`skins`** — `id; slug unique; name; description_md; texture_path` (Storage `skins/…png` 64×64) `; model enum classic|slim; render_bust_path` (cached PNG) `; is_exclusive bool; status draft|published; sort_order; downloads int`.
**`art`** — `id; slug; title; kind enum avatar|thumbnail|icon|render|other; image_path; width; height; year int null; credit text null` (commissioned artist handle, optional) `; downloadable bool; status; sort_order`.
**`site_settings`** — single row (`id = 1`): `moderation_mode enum auto|hold_first_time; notify_new_comment bool; notify_reply bool; notify_new_order bool; notify_new_tip bool; notify_email text; kofi_page text; comments_closed_default bool; announcement_md text null`.

### 2.5 Comments & likes
**`comments`**
| col | notes |
|---|---|
| id uuid PK | |
| target_type enum `project|skin|art|video` ; target_id uuid | polymorphic; index (target_type, target_id, created_at) |
| author_id FK profiles | |
| parent_id uuid null FK comments | one level: replies to replies store the *root* as parent and prefix `@handle` in body |
| body text | ≤ 1000 chars (check); server strips HTML; ≤ 1 link (server rule) |
| status enum `published|held|hidden|deleted` | held = awaiting approval; deleted keeps slot |
| like_count int default 0 | trigger-maintained |
| edited_at timestamptz null | |
| moderated_by uuid null; moderated_at | |

**`comment_likes`** — PK (comment_id, user_id). Trigger updates `comments.like_count`.
**`comment_reports`** — `id; comment_id; reporter_id; reason enum spam|rude|other; note; created_at; resolved_at; resolved_by`. Unique (comment_id, reporter_id).

Moderation rules (server): on insert, `status = 'held'` if `site_settings.moderation_mode = 'hold_first_time' AND author.comment_count = 0`, else `published`. Banned users can't insert (RLS). Any comment with ≥ N reports auto-`held` (N=3, tunable).

**Build-vs-buy (decided 2026-08-17): built in-house.** Hosted widgets (Disqus, Hyvor, Commento, Cusdis) impose their
UI/identity/moderation and can't do handle-only Google-via-Supabase; GitHub-backed ones (Giscus) are GitHub-only;
self-hosted servers (Remark42, Isso) need their own host and user store. Our version: tables above + ~6 Server Actions
(`postComment, editComment(15 min), deleteComment(soft), toggleLike, reportComment, moderate`) + `<CommentThread>` components
mapped to DESIGN.md states; optimistic UI via React 19 `useOptimistic`; plain-text bodies auto-linkified; rate limit in SQL;
Supabase Realtime optional later. Remark42's data model is a good reference, not a dependency.

### 2.6 Notifications (admin only, v1)
**`notification_events`** — `id; kind enum new_comment|reply|new_order|new_tip|report; payload jsonb; emailed_at null; created_at`. A worker (cron every 5 min or DB webhook → route) emails admins per `site_settings` toggles. Keeps a log even when a toggle is off.

### 2.7 Custom orders
**`orders`** — `id; user_id FK; kind enum mod|plugin|skin|pack|art; brief text; mc_version text null; loader text null; budget text null; public_ok bool; status enum new|replied|closed; admin_notes text; created_at; updated_at`.

### 2.8 Support (Ko-fi, phase 2)
**`kofi_events`** — raw webhook payloads: `id; kofi_message_id text unique; type text; from_name; message; amount numeric; currency; is_public bool; email_hash text null; timestamp; raw jsonb`.
**`supporters`** — link table `kofi_event_id → profile_id` for the leaderboard (handle + amount). Linking (Q33, decided): on webhook, `email_hash = sha256(lower(email))` compared to a per-profile `email_hash` computed at sign-in from `auth.users.email` (server-side only; raw email never stored in `profiles`) → else parse a `@handle` from the Ko-fi message → else unlinked ("Anonymous"). Amount displayed if linked or `is_public`. Leaderboard = sum(amount) per profile.

### 2.9 Stats
**`stats_daily`** — `day date; metric text; source text; entity_type; entity_id uuid null; value bigint` — PK (day, metric, source, entity_type, entity_id). Metrics: `downloads` (modrinth/curseforge/direct, per project + total), `views`/`subs` (youtube), `comments`, `tips`. Written by the daily snapshot cron from current totals; deltas computed at read time.

**`sync_runs`** — `id; source; started_at; finished_at; ok bool; items int; error text` — for the admin "sync status" and the `sync-sources` skill.

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
| profiles | own row (full) | trigger only | own row: handle (only if null→value or admin), avatar_path | admin |
| projects / versions / files / links / overrides | all where `status='published'` and not `overrides.hidden`; admin sees all | admin (exclusives) / service role (sync) | same | admin |
| videos, skins, art | published to all; admin all | admin/service | admin | admin |
| site_settings | admin | — | admin | — |
| comments | published to all; own held/hidden rows to author; mods/admins all | authenticated, not banned, target has comments enabled | author (body, within 15 min → sets edited_at) ; mods (status) | author (soft → status deleted) / mods |
| comment_likes | all | authenticated | — | own |
| comment_reports | mods | authenticated | mods | — |
| orders | own; mods all | authenticated | mods (status/notes) | — |
| notification_events, kofi_events, supporters, stats_daily, sync_runs | admin | service role | service/admin | admin |
Role checks via a `is_moderator()` / `is_admin()` SQL helper reading `profiles.role`. Sensitive mutations (moderate, ban, settings) go through Server Actions that re-check role server-side in addition to RLS.

---

## 5. Sync design
| Job | Cadence | Source → tables | Notes |
|---|---|---|---|
| **Modrinth** | hourly (Vercel Cron) + manual button | `GET /v2/user/OddSense/projects` → `projects`; per project `GET /v2/project/{id}` (gallery, body, license) and `GET /v2/project/{id}/version` → `project_versions`, `project_files` | Upsert by (source, external_id). Map `project_type`: `mod`+loader `datapack`→datapack; `mod`+paper/spigot/bukkit/purpur/folia/velocity/bungeecord→plugin; `resourcepack`→resourcepack; else mod. Respect 300 req/min; send `User-Agent`. New projects default `published`; deleted-upstream → mark `hidden`, never delete. |
| **CurseForge** | hourly | For each `project_links` row with platform curseforge: `GET /v1/mods/{id}` → `downloadCount` → `projects.downloads_curseforge`, `project_links.downloads` | Discovery of CF ids: admin enters CF project id/URL once (or `GET /v1/mods/search?gameId=432&authorId=…` at build if the API allows by author). |
| **YouTube** | hourly | RSS (`feeds/videos.xml?channel_id=`) for cheap new-video detection; Data API `search`/`playlistItems` on uploads playlist + `videos` for stats/duration | Upsert by `youtube_id`. Data API budget: ~few hundred units/day. |
| **Stats snapshot** | daily 03:00 UTC | reads current totals from `projects`, `videos`, `comments`, `kofi_events` → `stats_daily` | Also aggregates `project_downloads` and purges >90d. |
| **Skin renders** | on skin insert/update (server action) | render bust PNG via headless skinview3d (or `minecraft-skin-render` on Node/canvas) → `skins.render_bust_path` | Fallback: render client-side and cache on first view. |
| **Notifications** | every 5 min | `notification_events` unemailed → Resend | Batched digest if >5 pending. |
| **Ko-fi webhook** | on event | `POST /api/webhooks/kofi` verifies `verification_token` → `kofi_events`, `notification_events(new_tip)` | Phase 2. |
Every run writes a `sync_runs` row; failures don't touch existing data. Public pages use ISR (`revalidate` ~10 min) and revalidate tags after each sync so nothing waits on an API at request time.

---

## 6. Key flows
- **First sign-in:** Google → Supabase Auth → trigger creates `profiles` row (handle null) → app middleware redirects any authenticated user with null handle to `/welcome` (onboarding) → handle uniqueness checked via RPC → avatar upload → done.
- **Comment:** Server Action: check auth + not banned + comments enabled → sanitize/limits → compute status per moderation mode → insert → `notification_events(new_comment)` → revalidate target page.
- **Exclusive download:** `/api/download/[fileId]` → verify published → increment `project_files.download_count` + `projects.downloads_direct` + log `project_downloads` → 302 to short-lived signed Storage URL.
- **Add exclusive project (admin):** form (Modrinth-shaped) → server action creates `projects(source=odsens, status=draft)` → uploads via `project-media`/`project-files` → publish toggle.
- **Curate synced project (admin):** upsert `project_overrides` (featured/hidden/extra gallery/notes).

---

## 7. Open build-time decisions (tracked in `docs/questions.md`)
- ~~Handle heuristic~~ decided: structural only. ~~Comment limits~~ decided: 1000 chars, 1 link, 15-min edit window, auto-hold ≥3 reports, manual CF ids.
- Ko-fi tip → supporters linking (Q33).
- Whether report threshold auto-hold (N=3) is wanted.
- CurseForge id discovery: manual entry vs API author search.
