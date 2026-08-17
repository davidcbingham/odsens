# Routes & Pages
Every URL odsens.com serves — its slice, rendering mode, auth requirement, data, DESIGN.md section, components, route files, metadata and nav placement — plus middleware, the auth flows, revalidation triggers and the deploy smoke list.
Status: DRAFT v0.2 (2026-08-17) — becomes v1.0 at freeze

Sources: `docs/build/_registry.md` (IDs verbatim), `docs/spec.md`, `docs/data-model.md`, `docs/notifications.md`, `DESIGN.md` v1.3, `docs/design-review.md`, `.claude/skills/{web-quality,vercel-ops,security-check}/SKILL.md`, `.claude/agents/*.md`, `supabase/config.toml`. Siblings: `00-build-plan.md` (slice acceptance), `01-architecture.md` (invariants, headers/CSP, env — **wins on rendering/data-access rules**), `03-components.md` (component props/states), `04-server-contracts.md` (action/handler shapes, rate limits, cron table — **wins on handler contracts and revalidation tags**), `05-test-plan.md` (test IDs).

---

## 0. Conventions used in this doc

### 0.1 Rendering modes (column "Render")
| Mode | Meaning | Checkable by |
|---|---|---|
| `ISR(600; tags)` | `export const revalidate = 600` (01 INV-38); every read goes through `lib/data/<area>.ts` using the **anon server client without cookies** or the public views `projects_public` / `public_profiles` / `site_settings_public` (INV-12, INV-15) and is wrapped in `unstable_cache`/`cacheTag` with the listed tags (§5). **Never** `lib/supabase/admin.ts` (INV-14), never `cookies()`/`headers()`/`searchParams`/`noStore()` outside a `<Suspense>` boundary listed in RP-01. `ISR(600; —)` = no data read (page still exports `revalidate = 600` so INV-38's grep passes). | `next build` route table shows `○/●`, not `ƒ`; `grep -rn "cookies()" app/(public)` → only inside RP-01 components; `grep -rln "supabase/admin" app/(public) lib/data` → none |
| `dynamic` | `export const dynamic = 'force-dynamic'` (or reads cookies/searchParams). Session-aware. `Cache-Control: no-store`. | route table shows `ƒ` |

**RP-01** (restates 01 INV-39, INV-09) Session-dependent parts of an ISR page are **Server Components rendered inside a `<Suspense>` boundary**; the ISR shell never varies by user. Exactly two such components exist in v1: (a) `NavSession` (registry addition §10) in `app/(public)/layout.tsx` — calls `lib/auth.ts` `getProfile()` and renders `Nav` with `viewer` (03 `Nav` props); fallback = `Nav viewer={null}`; (b) `CommentThreadSection` (registry addition §10) on `/projects/[slug]` — calls `getProfile()` + `lib/data/comments.ts` (session server client, RLS: published + viewer's own held/hidden + mods see all), computes `commentsEnabled`, and renders `CommentThread` with `comments`, `total`, `viewer`, `commentsEnabled` as props (03); fallback = `CommentThreadSkeleton`. Client islands (`Composer`, `LikeButton`, `ModActionRow`, `ProfileMenu`, …) receive everything as props and NEVER query Supabase (INV-09); `lib/supabase/client.ts` is used only by auth UI/session refresh (INV-13). Implementation note: this partial model needs Next.js partial prerendering (`experimental.ppr` / `cacheComponents`) or the boundary makes the route dynamic — 01 owns the `next.config.ts` flag (Open O-1).
**RP-02** ISR pages ignore `searchParams`. Filters/sort/search/selection are client-side over the full published list; the URL is the state (`useSearchParams` inside a `<Suspense>` boundary; `router.replace` with `scroll:false`). `SearchField` submits a native GET (`/projects?q=`) which the client reads the same way.
**RP-03** Public content pages MUST NOT accidentally opt into dynamic rendering (no `cookies()`, `headers()`, `searchParams`, `noStore()`, `fetch(..., {cache:'no-store'})` outside RP-01 boundaries). Verified by reading the `next build` route table on every PR (web-quality).

### 0.2 Auth requirement (column "Auth")
| Level | Rule | Enforced by |
|---|---|---|
| `anon` | none | — |
| `user` | Supabase session exists (handle may still be null) | middleware (§3) + page-level `lib/auth.ts` `requireUser()` |
| `onboarded` | session AND `profiles.handle IS NOT NULL` | middleware (§3) + page-level `lib/auth.ts` `requireOnboarded()` (04 C-04; registry addition §10 — 01 INV-32 export list must add it) |
| `moderator` | onboarded AND `profiles.role IN ('moderator','admin')` | `app/admin/layout.tsx` via `lib/auth.ts` `requireRole('moderator')` (**not** middleware) + every action re-checks (04) |
| `admin` | onboarded AND `role = 'admin'` | page-level `requireRole('admin')` + action re-check |
| `cron-secret` | `Authorization: Bearer ${CRON_SECRET}` exact match (`crypto.timingSafeEqual`) | the route handler itself; 401 otherwise (04 C-12) |

**RP-04** Auth failures on pages: `anon` hitting `user`/`onboarded` routes → 307 to `/` (§3 M1). `anon` hitting `/admin/*` → HTTP 200 rendering `AdminGate reason="signed-out"` (DESIGN §11.3 #18) at the same URL, no shell. Signed-in role `user` on `/admin/*` → HTTP 200 rendering `AdminGate reason="not-allowed"` (03; 00 S1.1.AC8), no shell, `noindex`. Role `moderator` on `/admin/settings` → HTTP 200 `AdminGate reason="not-allowed"` rendered by the page inside `AdminShell` (the only place the gate appears within the shell). Never a 403 page, never a 404 for role reasons (05 T-E2E-33 / OPEN-11 must change to match — see Review notes).

### 0.3 Cache tags (registry names)
`projects` · `project:<slug>` · `videos` · `skins` · `art` · `mentions` · `settings`. No other tags in v1 (see §5).

### 0.4 Metadata rules
**RP-05** `metadataBase = new URL(env.NEXT_PUBLIC_SITE_URL)` in `app/layout.tsx` (INV-37). Title pattern: **`<X> — odsens`** via `title.template = '%s — odsens'`; Home uses `title.absolute = 'odsens'`. Description default: "Mods and other odd things, made by OddSense." (footer line, DESIGN §5 Footer).
**RP-06** OG image: static `public/brand/og-default.png` (1200×630) on every public page (`/api/og` is **not built in v1** per 00 O-7). `/projects/[slug]` sets `openGraph.images` to the featured gallery image when one exists, else the default. If 00 O-7 flips, `openGraph.images = /api/og?slug=<slug>` (04 §2.5). Every public page sets `openGraph.title/description/images` and `alternates.canonical = <path>`.
**RP-07** `robots: { index: false, follow: false }` metadata on `/welcome`, `/profile`, `/admin/*`; **plus** response header `X-Robots-Tag: noindex, nofollow` on `/admin/**` and `/api/**` via `next.config.ts` `headers()` (01 INV-76). `app/robots.ts` disallows `/admin`, `/api`, `/auth`, `/welcome`, `/profile`; `app/sitemap.ts` lists `/`, `/projects`, `/projects/<slug>` (published, not hidden), `/videos`, `/skins`, `/art`, `/seen-on`, `/support`, `/privacy`, `/how-comments-work`. (Registry additions §10: `/robots.txt`, `/sitemap.xml`; 01 INV-03 convention list must add `robots.ts`, `sitemap.ts`.)
**RP-08** No PII in any metadata (no real names, emails). Project OG uses `title_override ?? title` and `description_override ?? description`.

### 0.5 Route files (web-quality)
**RP-09** Required at root: `app/layout.tsx` (fonts via `next/font/local`, `styles/tokens.css` + `globals.css`, `Toast` live region, `SkipLink`, Analytics + Speed Insights from S1.10), `app/not-found.tsx` (DESIGN §11.3 #13), `app/error.tsx` (client; DESIGN §11.3 #14, RELOAD + Go home, no codes), `app/global-error.tsx` (same design, self-contained), `app/loading.tsx` (skeleton per §11.1). `app/(public)/layout.tsx` = `NavSession`→`Nav`, `<main id="main">`, `Footer`, `FloatingSupportButton`.
**RP-10** Every route segment that reads data has its own `loading.tsx` using the matching `Skeleton*` component (listed per route in §1). `/privacy`, `/how-comments-work` (`ISR(600; —)`, no data) have none.
**RP-11** File locations (01 §1 tree): public routes under `app/(public)/<path>/`; `/profile` under `app/(public)/profile/`; `/welcome` under `app/(onboarding)/welcome/` with `app/(onboarding)/layout.tsx` = minimal shell (wordmark + Sign out form only; registry addition §10 — 01 tree must add `app/(onboarding)/*`; Open O-2); admin under `app/admin/` (`app/admin/layout.tsx` = role gate + `AdminShell`; `app/admin/loading.tsx` present); auth handlers under `app/auth/<name>/route.ts`; API under `app/api/**/route.ts`.

### 0.6 Nav placement (DESIGN §12.2, §5 Nav, §11.6 Footer)
**RP-12** Nav order (desktop and phone burger; 03 N-03/N-04): wordmark→`/` · **Projects** `/projects` · **Videos** `/videos` · **Skins** `/skins` · **Art** `/art` · **Seen on** `/seen-on` · *Commissions* `/commissions` rendered only when `FLAGS.commissions` (01 INV-74) passed as `commissionsEnabled` (03) — **false in v1** · right side: `SearchField placement="nav"` (only on `/projects`, `showSearch=true`; submits `?q=`) · `GoogleSignInButton label="Sign in"` / `ProfileMenu` · gold **Support** button → `/support` (phone: last in the burger). No "Home" item. Active item = pathname `===` href or `startsWith(href + '/')`. `ProfileMenu` items → routes: "Your profile" → `/profile`; "Change handle" → `/profile#handle`; "Change picture" → `/profile#picture`; "Admin" → `/admin` (role ≥ moderator only, 03 N-06); "Sign out" → `<form method="post" action="/auth/sign-out">`.
**RP-13** Footer "Site" column: Projects · Seen on · *Custom orders* (`/commissions`, rendered only when `FLAGS.commissions` — INV-74) · Support · How comments work · Privacy. "Find me": Modrinth (`https://modrinth.com/user/OddSense/mods` — spec §3), CurseForge (`https://www.curseforge.com/members/oddsense/projects`), YouTube (`https://www.youtube.com/@OdSens`). Two dry lines: "Mods and other odd things, made by OddSense. Not affiliated with Mojang." and "Creators featuring the mods aren't affiliated with odsens." (second line only once S1.8 ships).
**RP-14** Admin sidebar (`AdminShell`, DESIGN §6.9 + §12.2): Comments (held count) · Projects · Skins · Art · Mentions · Stats · Settings (admin only; hidden for moderators) · *Orders* rendered only when `FLAGS.commissions` (`ordersEnabled`, 03). Sidebar order for Mentions/Stats is proposed (Open O-3).
**RP-15** `FloatingSupportButton` renders on every public route except `/support`; not under `/admin/*` or `/welcome`.
**RP-16** From S0, `/projects`, `/videos`, `/skins`, `/art`, `/seen-on` exist as placeholder pages (title + `EmptyState` with the section's DESIGN.md §11.7 string; `/seen-on` = title only per §12.1) and `/support` as title + one `--mute` line "Tips open soon." (Open O-8), each replaced in its slice — closes 00 O-8 (nav is stable and never links to a 404).

---

## 1. Route table

Legend: **Render** per §0.1; **Auth** per §0.2; **Data** = tables/views read by the page through `lib/data/*` (adapters are only used by jobs — see API table); **Files** = required route files beyond `page.tsx` (root files from RP-09 assumed); **Title** = value of `%s` unless absolute.

### 1.1 Public routes (all files under `app/(public)/`)
| Path | Slice | Render | Auth | Data (tables/views) | DESIGN.md | Components (registry) | Files | Title / OG | Nav |
|---|---|---|---|---|---|---|---|---|---|
| `/` | S0 shell; S1.2 hero+featured; S1.6 videos; S1.8 wild strip; S1.9 tip panel | ISR(600; `projects`,`videos`,`mentions`) | anon | `projects_public`, `project_overrides` (featured), `videos`, `mentions` (published, featured) | §6.1, §12.2 (IN THE WILD) | `Nav`, `FeaturedHero`, `ProjectCard`×4, `InTheWildStrip`+`MentionCard`+`ReachLine`, `VideoFacade`×2, `TipPanel`, `Footer`, `FloatingSupportButton` | `app/loading.tsx` | absolute `odsens`; OG default | wordmark |
| `/projects` | S0 placeholder (RP-16); S1.2 | ISR(600; `projects`) | anon | `projects_public` (+ overrides applied in view), counts per type | §6.2, §5 Filter bar, §11.7 empty | `SearchField`, `FilterBar`, `ActiveFilterChips`, `ProjectCard`, `ProjectCardSkeleton`, `TypeBadge`, `Chip`, `ExclusiveBadge`, `EmptyState` | `app/(public)/projects/loading.tsx` | `Projects` | Projects |
| `/projects/[slug]` | S1.2 base; S1.3 exclusive DL; S1.4 comments; S1.8 SEEN ON; S1.9 tip panel | ISR(600; `projects`,`project:<slug>`,`mentions`,`settings`) + RP-01 `CommentThreadSection` | anon (comment actions need `onboarded`) | `projects_public`, `project_versions`, `project_files`, `project_links`, `project_overrides`, `mentions` (published for project), `site_settings_public.comments_closed_default`; RP-01 boundary: `comments` (RLS) + `public_profiles`, `comment_likes` | §6.3, §5 Gallery/Comment bubble/Reply/Held/Sign-in prompt, §11.2, §12.2 SEEN ON, §12.5 changelog | `Breadcrumb`, `Gallery`+`Lightbox`, `TypeBadge`, `ExclusiveBadge`, `Chip`, `Markdown`, `VersionsTable`+`ChangelogExpander`, `GetItPanel`, `DetailsList`, `TipPanel`, `SeenOnRow`+`MentionCard`, `CommentThread`,`Comment`,`Reply`,`Composer`,`LikeButton`,`ModActionRow`,`HeldNotice`,`SignInPrompt`,`ReportPicker`, `ProjectDetailSkeleton`, `CommentThreadSkeleton` | `app/(public)/projects/[slug]/loading.tsx`; `generateStaticParams` (published slugs); `dynamicParams = true`; unknown/hidden/draft → `notFound()` | `<title_override ?? title>`; OG title+desc from project, image = featured gallery image if any else default | Projects (active) |
| `/videos` | S0 placeholder; S1.6 | ISR(600; `videos`) | anon | `videos` (not hidden) | §6.4, §11.1 Video facade, §11.5 Shorts row, §11.7 empty | `VideoFacade`, `UpNextList`, `ShortsRow`, `PixelLabel`, `EmptyState` | `app/(public)/videos/loading.tsx` | `Videos` | Videos |
| `/skins` | S0 placeholder; S1.7 | ISR(600; `skins`) | anon | `skins` (published) | §6.5, §11.7 empty | `SkinViewer3D` (client, lazy), `SkinCard`, `ExclusiveBadge`, `Toggle` (Slim), `Button`, `EmptyState` | `app/(public)/skins/loading.tsx` | `Skins` | Skins |
| `/art` | S0 placeholder; S1.7 | ISR(600; `art`) | anon | `art` (published) | §6.6, §11.7 empty | `ArtMasonry`, `ArtCard`, `Lightbox`, `FilterBar` (kind row), `EmptyState` | `app/(public)/art/loading.tsx` | `Art` | Art |
| `/seen-on` | S0 placeholder; S1.8 | ISR(600; `mentions`,`projects`) | anon | `mentions` (published), `projects_public` (titles/types for tags + project select) | §12.2 Seen on page, §12.1 Mention card/Reach line, §11.1 Stat tile | `StatTile`×3, `FilterBar`, `MentionCard`, `TypeBadge`, `ReachLine` | `app/(public)/seen-on/loading.tsx` | `Seen on` | Seen on |
| `/support` | S0 placeholder; S1.9 | ISR(600; —) (S2.1: + `settings` for `supporters`) | anon | — (Ko-fi page = `KOFI_PAGE` env, 01 INV-58 / 00 S1.9); S2.1: `supporters` | §6.7, §11.4, §12.4 (empty state) | `AmountPicker`, `KofiPanelSlot`, `Leaderboard` (empty state), `Button` (gold) | — | `Support` | gold button |
| `/privacy` | S1.1 | ISR(600; —) | anon | — | §11.3 #12, §12.5 | `Markdown` or JSX, `PixelLabel` (NOTE) | — | `Privacy` | footer |
| `/how-comments-work` | S1.1 | ISR(600; —) | anon | — | §12.5 | JSX blocks SIGN IN · FIRST COMMENT · THE RULES · LEAVING | — | `How comments work` | footer |
| `/profile` | S1.1 | dynamic | `onboarded` | own `profiles` row via `getProfile()` | §11.3 #11 | `AvatarUpload`, `HandleField`, `Button`, `InlineConfirm` | `app/(public)/profile/loading.tsx`; noindex | `Your profile` | ProfileMenu → "Your profile" / `#handle` / `#picture` |

### 1.2 Auth routes
| Path | Slice | Render | Auth | Data | DESIGN.md | Components | Files | Title | Nav |
|---|---|---|---|---|---|---|---|---|---|
| `/welcome` | S1.1 | dynamic | `user` (redirects: anon → `/`; onboarded → `next` or `/`) | own `profiles` row (`getProfile()`) | §11.3 #10, §11.1 Handle field / Picture upload, §12.5 guidance | `OnboardingPanel`, `HandleField`, `AvatarUpload`, `Button`, `PixelLabel` | `app/(onboarding)/layout.tsx` (minimal shell), `app/(onboarding)/welcome/page.tsx`; noindex | `Pick a handle` | none (blocking) |
| `/auth/sign-in` | S0 shell; S1.1 wired | route handler (POST only; GET → 405) | anon | — | §5 Sign-in prompt / Nav Sign in / §11.3 #18 | (target of `GoogleSignInButton` form, 03) | `app/auth/sign-in/route.ts` (registry addition §10) | — | — |
| `/auth/callback` | S0 shell; S1.1 wired | route handler (GET) | anon (carries `code`) | — | — | — | `app/auth/callback/route.ts` | — | — |
| `/auth/sign-out` | S0 shell; S1.1 wired | route handler (POST only; GET → 405) | `user` | — | §11.1 Profile menu (Sign out) | — | `app/auth/sign-out/route.ts` | — | ProfileMenu → Sign out |

### 1.3 Admin routes (all `dynamic`, all under `app/admin/layout.tsx` gate; all `noindex` + `X-Robots-Tag`; `frame-ancestors 'none'` site-wide per 01 INV-77)
Auth rule (04 §1.0): moderators get **read access** to every admin page except `/admin/settings`; **content mutations require `admin`** (`curateProject`, `setProjectLink`, `createExclusiveProject`, `updateExclusiveProject`, `publishProject`, uploads, skins/art/mentions actions, `triggerSync`); moderation actions (`moderateComment`, `banUser`, `deleteComment`) require `moderator`. Pages MUST render mutation controls **disabled** (with `aria-disabled` and title "Admin only") for moderators so no control leads to a `forbidden` error (Open O-12 for the 00 S1.2.AC8 wording).
| Path | Slice | Auth | Data | DESIGN.md | Components | Files | Title | Sidebar |
|---|---|---|---|---|---|---|---|---|
| `/admin` | S1.1 gate; S1.2 `SyncStatus`; S1.4 held count; S1.6 videos list | moderator (view); `triggerSync`/`updateVideo` admin | `sync_runs` (latest per source), `comments` count where `status='held'`, `projects` count where `status='draft'`, `videos` (S1.6: hide/unhide list — 00 O-5 default; action `updateVideo` per 04 §11) | §6.9, §11.3 #18 | `AdminShell`, `AdminGate`, `SyncStatus`, `StatTile`, `Table` (videos), `Toggle` (hidden) | `app/admin/layout.tsx`, `app/admin/loading.tsx` | `Admin` | (home of shell) |
| `/admin/projects` | S1.2 | moderator (view) / admin (all mutations per 04) | `projects` (all statuses), `project_overrides`, `project_links`, `sync_runs` (modrinth/curseforge) | §6.9, §11.1 Admin table, §5 Admin field | `Table`, `StatusPill`, `Toggle`, `Field`, `SyncStatus`, `Button` | `app/admin/projects/loading.tsx` | `Projects · Admin` | Projects |
| `/admin/projects/new` | S1.3 | admin | — | §6.9 add/edit forms, §11.1 Upload well | `Field`, `Select`, `Chip`, `UploadWell`, `Markdown` (preview), `Button` | — | `New project · Admin` | Projects → "New exclusive project" |
| `/admin/projects/[id]` | S1.2 (curate synced); S1.3 (edit exclusive) | moderator (view) / admin (all mutations per 04: curate, edit, publish, upload) | `projects` by id (any status), `project_versions`, `project_files`, `project_links`, `project_overrides` | §6.9, §11.1 Upload well, §5 Gallery | `Field`, `Select`, `Toggle`, `UploadWell`, `Gallery`, `VersionsTable`, `Markdown`, `StatusPill`, `Button` | `app/admin/projects/[id]/loading.tsx`; unknown id → `notFound()` | `<title> · Admin` | Projects |
| `/admin/comments` | S1.4 | moderator (moderation actions allowed) | `comments` (all statuses) + `public_profiles`, `comment_reports` (unresolved), `projects_public` (target titles) | §6.9 moderation queue, §11.1 Mod action row, §11.2 | `Table`, `StatusPill`, `ModActionRow`, `Comment`, `Button` | `app/admin/comments/loading.tsx` | `Comments · Admin` | Comments (held count) |
| `/admin/skins` | S1.7 | moderator (view) / admin (create/update) | `skins` (all) | §6.9, §11.1 Upload well | `Table`, `Field`, `Select`, `Toggle`, `UploadWell`, `SkinCard`, `StatusPill` | `app/admin/skins/loading.tsx` | `Skins · Admin` | Skins |
| `/admin/art` | S1.7 | moderator (view) / admin (create/update) | `art` (all) | §6.9, §11.1 Upload well | `Table`, `Field`, `Select`, `Toggle`, `UploadWell`, `ArtCard`, `StatusPill` | `app/admin/art/loading.tsx` | `Art · Admin` | Art |
| `/admin/mentions` | S1.8 | moderator (view) / admin (`createMention`, `updateMention`, `fetchMentionPreview`) | `mentions` (all statuses), `projects_public` (assign select) | §12.2 Admin → Mentions | `Field` (URL), `MentionPreview`, `Select`, `Table`, `StatusPill`, `Button` | `app/admin/mentions/loading.tsx` | `Mentions · Admin` | Mentions |
| `/admin/stats` | S1.9 | moderator | `stats_daily`, `projects` (totals), `comments` (counts), `sync_runs` (latest per source) | §11.3 #16, §11.1 Stat tile / Flat bar chart | `StatTile`×4, `FlatBarChart`, `SyncStatus` | `app/admin/stats/loading.tsx` | `Stats · Admin` | Stats |
| `/admin/settings` | S1.5 (route does not exist before S1.5 — registry, 00 S1.1 Scope OUT; Open O-13) | **admin** (moderator → `AdminGate not-allowed`, RP-04) | `site_settings`, `notification_matrix`, `public_profiles` where `role <> 'user'` (INV-45) | §11.3 #15, §12.1 Notification matrix | `Toggle` (radios + matrix), `NotificationMatrix`, `Field`, `Chip` (admin emails), `Table` (moderators), `StatusPill` (Ko-fi LIVE/NOT SET), `Button`, `Toast` | `app/admin/settings/loading.tsx` | `Settings · Admin` | Settings (admin only) |

**Admin empty rows** (`Table empty=` copy, 03 G-05 — strings OPEN for confirmation, Open O-14): `/admin/comments` "Nothing held. Nice." · `/admin/projects` "No projects yet. Run a sync." · `/admin/mentions` "Nothing pasted yet." · `/admin/skins`, `/admin/art` "Nothing here yet." · `/admin` videos list "No videos yet."

### 1.4 API routes (all `dynamic`, `runtime = 'nodejs'` — 01 INV-22; JSON unless noted; `Cache-Control: no-store` unless 04 says otherwise)
| Path | Slice | Method | Auth | Reads / writes (via job or handler) | Adapters | Cron schedule (`vercel.json`, = 04 §6) | Revalidates | Response |
|---|---|---|---|---|---|---|---|---|
| `/api/download/[fileId]` | S1.3 | GET; HEAD per 04 D6 (checks only, no increment, 200 empty); others 405 | anon | R: `project_files`, `project_versions`, `projects`, `project_overrides` · W: `project_files.download_count`, `projects.downloads_direct`, `project_downloads` (RPC `record_download`) | — (Supabase Storage signed URL) | — | none (counts surface at next ISR ≤600s) | 302 → signed URL (TTL 60s, `download=<filename>`); 404 unpublished/hidden/not-exclusive/unknown; 429 JSON `{ok:false,error:{code:'rate_limited',message}}` + `Retry-After: 60` (04 D3, INV-44) |
| `/api/cron/sync-modrinth` | S1.2 | GET (POST 405) | cron-secret | job `syncModrinth` → `projects`, `project_versions`, `project_files`, `sync_runs`; on failure `notification_events(sync.failed)` (S1.5) | `modrinth` | `7 * * * *` | `projects`; `project:<slug>` for each changed slug | 200 `{ok, source, run_id, items, ms}` / 500 `{ok:false, source, run_id, error}` / 401 (04 C-12) |
| `/api/cron/sync-curseforge` | S1.2 | GET | cron-secret | job `syncCurseforge` → `project_links`, `projects.downloads_curseforge`, `sync_runs` | `curseforge` | `17 * * * *` | `projects`; `project:<slug>` for changed | same |
| `/api/cron/sync-youtube` | S1.6 | GET; query `?full=1` (manual full re-sync, 04 §2.4) | cron-secret | job `syncYoutube` → `videos`, `sync_runs` | `youtube` | `27 * * * *` | `videos` | same |
| `/api/cron/refresh-mentions` | S1.8 | GET | cron-secret | job `refreshMentions` → `mentions.view_count`, `sync_runs` | `youtube` | `37 * * * *` | `mentions` | same |
| `/api/cron/stats-snapshot` | S1.9 | GET | cron-secret | job `snapshotStats` → `stats_daily`; aggregates + purges `project_downloads` >90d; `sync_runs` | — | `0 3 * * *` | none | same |
| `/api/cron/notify` | S1.5 | GET | cron-secret | jobs `notifyFanOut` + `notifyDeliver` → `notification_recipients`; reads `notification_matrix`, `site_settings`; also emits `sync.stale` if no ok `sync_runs` in 6h per source | `resend`, `discord` | `*/5 * * * *` | none | same (`items` = delivered count) |
| `/api/webhooks/kofi` | **S2.1** | POST | Ko-fi `verification_token` | `kofi_events`, `supporters`, `notification_events(tip.new)` | — | — | `settings` (leaderboard on `/support`) | stub only in v1 (route absent, INV-75) |
| `/api/og` | **not in v1** (00 O-7); optional ≥ S1.2 if flipped | GET `?slug=<published slug>` | anon | `projects_public` by slug | — | — | — | per 04 §2.5: `ImageResponse` 1200×630; unknown/unpublished slug → 404; `Cache-Control: public, s-maxage=86400`; runtime nodejs (INV-22) |
| `/robots.txt`, `/sitemap.xml` | S0 / S1.2 | GET | anon | `projects_public` slugs (sitemap) | — | — | — | text / xml (`app/robots.ts`, `app/sitemap.ts` — registry additions §10) |

**RP-17** All `/api/cron/*` handlers: `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, `maxDuration` per 04 C-12 (300; 60 if unsupported). 401 returns before any DB write; exactly one `sync_runs` row per authorised invocation (04 C-11/C-12); concurrency lock per 04 C-13 → 200 `{ok:true, skipped:'running'}`. Each handler is a thin wrapper: auth check → call the `lib/jobs/*` function → return its JSON summary. The same job functions are called by the admin `triggerSync` action (04) — never the HTTP route from inside the app.
**RP-18** `vercel.json` `crons[]` = exactly the `{path, schedule}` rows of 04 §6 once each slice ships (S0 ships an empty list). Any schedule change → ADR (04 V4).

### 1.5 Phase 2 stubs (routes reserved; not built in v1) and non-production routes
| Path | Slice | Render/Auth | One line |
|---|---|---|---|
| `/commissions` | S2.2 | dynamic / onboarded (form) | Custom Orders intake per DESIGN §6.8; post-submit "SENT." (§12.5). `FLAGS.commissions` flips → nav + footer item render. |
| `/profile/orders` (proposed) | S2.2 | dynamic / onboarded | "Your orders" from ProfileMenu (§12.5). Registry addition. |
| `/workrooms/[id]` | S2.3 | dynamic / member (RLS) | Project-detail layout behind membership wall (§12.3). |
| `/admin/orders`, `/admin/orders/[id]` | S2.2/S2.3 | dynamic / moderator | Orders & Workrooms (§11.3 #17, §12.3). Registry addition (path from `docs/data-model.md` §2.7b). |
| `/api/webhooks/kofi` | S2.1 | POST / token | see 1.4. |
| `/dev/components` | dev only (03 O-1) | `notFound()` in production and on any Vercel deployment | Component preview surface; absent from production builds. |
| `/__test/throw` | E2E only (05 OPEN-10) | exists only when `NODE_ENV==='test'`/`E2E=1` | Error-boundary test route; absent from production builds. |

---

## 2. Page details

### 2.1 Home `/`
Sections in DOM order (each is a `<section>` with a heading; hero `h1`):
1. `FeaturedHero` — the published, non-hidden project with `project_overrides.featured = true` and the **lowest** `featured_order`; if none is featured, the published project with the highest `downloads_total` (00 O-3 default, adopted here — closes 00 O-3). Shows badges (`ExclusiveBadge` if `source='odsens'`; "NEW" if `published_at` < 30 days — threshold OPEN, O-15), title (`title_override ?? title`), description, gold DOWNLOAD (→ exclusive: `/api/download/<primary file id of latest version>`; synced: Modrinth project URL) + secondary "See the project" (→ `/projects/<slug>`), version chips (max 4, then `+N`), right rail 16:9 image (featured gallery image, else first gallery image, else icon in a well) + intro strip ("OddSense makes things for Minecraft" + avatar 56px).
2. **Featured projects** (4-up) — next featured projects by `featured_order` (excluding the hero); if nothing is featured, the next four by `downloads_total` (00 O-3 default); fewer than 4 → render what exists; **0 published projects → section not rendered**.
3. `InTheWildStrip` (S1.8) — up to 4 `mentions` where `status='published' AND featured=true` ordered by `sort_order`, then `ReachLine` (totals over **all** published mentions: sum `view_count`, count, distinct `creator_name`), then ghost link "All mentions →" (`/seen-on`). **0 featured mentions → strip not rendered** (DESIGN §12.1: no empty state).
4. **Latest videos** (2-up, S1.6) — 2 newest `videos` where `hidden=false AND is_short=false` as `VideoFacade` (click → inline `youtube-nocookie` player), beside "Find me" list (RP-13 links) and compact `TipPanel` (S1.9; links to `/support`; always rendered from S1.9 since `KOFI_PAGE` is required from S1.9 — 01 env matrix). 0 videos → the videos column shows the §11.7 empty state ("NO VIDEOS YET" → channel link).
5. `Footer`.

States: **loading** `app/loading.tsx` (hero + 4 `ProjectCardSkeleton`); **error** root `error.tsx`; **empty (no published projects, pre-first-sync)** — hero not rendered, intro strip renders alone, Featured hidden (transient; no design). Query params: none honoured; `?auth_error=1` (set by `/auth/callback` on failure, 04 §2.1) is ignored in v1 — no UI surface (Open O-9); `?signin=1` reserved and ignored (Open O-4).

### 2.2 Projects `/projects`
Sections: page title `PROJECTS` + count line (copy OPEN — DESIGN §6.2 says only "count line"; proposed "<N> things. Some useful, some not." — Open O-16) → `SearchField placement="page"` on phone (nav on desktop) → `FilterBar` → `ActiveFilterChips` + "Showing <n> of <N>" → 3-up grid (2-up tablet, 1-up phone) of `ProjectCard` → empty state.
**Data:** all rows of `projects_public` (status published, not `overrides.hidden`) with `title_override/description_override` applied by the view, `downloads_total`, `loaders`, `game_versions`, `project_type`, `source`, `external_updated_at`, `published_at`. Fetched server-side via `lib/data/projects.ts` under tag `projects`; passed as props to the client filter/grid component (RP-02).
**Query params (client-side, all optional):**
| Param | Values | Default | Notes |
|---|---|---|---|
| `type` | `mod` \| `datapack` \| `resourcepack` \| `plugin` | none = ALL | single-select (filter bar shows ALL + one active) |
| `version` | one entry from the union of `game_versions` grouped by `major.minor` prefix and labelled `<major.minor>.x` (e.g. `1.21.x`; snapshot strings kept verbatim) — prototype pass-1 "1.21.x ▾" | none | single |
| `sort` | `downloads` \| `updated` \| `newest` \| `title` (option set OPEN — O-11) | `downloads` (prototype "Downloads ▾") | `updated` = `external_updated_at desc`, `newest` = `published_at desc`, `title` = A→Z |
| `q` | free text | none | client substring match on title + description (case-insensitive) — proposed default; 00 S1.2 says `search` tsvector (Open O-17) |
| `page` | — | — | **not supported**; no pagination in v1 (≤ ~50 projects) |
**States:** loading (`ProjectCardSkeleton` × 6); empty ("NOTHING MATCHES / Try fewer filters." + Clear filters — DESIGN §11.7); zero projects at all (pre-sync / S0 placeholder) → same empty state without the Clear action.

### 2.3 Project detail `/projects/[slug]`
Sections in DOM order (phone order per DESIGN §6.3: header, gallery, about, files, seen on, comments; rail becomes sections):
1. `Breadcrumb` (Projects › title) · header: 104px icon, `h1` title, description, row = `TypeBadge` + `ExclusiveBadge`(if `source='odsens'`) + up to 4 `Chip`s (versions/loaders) + `downloads_total`.
2. `Gallery` (`gallery` ∪ `overrides.extra_gallery`, featured first) + `Lightbox`. 0 images → gallery not rendered.
3. **ABOUT** — `Markdown(body_md)` then, if `overrides.notes_md`, a second `Markdown` block under a `NoteCallout`.
4. **VERSIONS & FILES** — `VersionsTable` rows from `project_versions` (newest first) × `project_files`; columns file · Minecraft · loader · size · Download; per-version `ChangelogExpander` ("Changes ▾", one open at a time, collapsed by default). Download href: exclusive → `/api/download/<file id>`; synced → `project_files.url` (Modrinth CDN) with `rel="noopener"` — proposed; spec Goal 3 / platform-audit say "link out to Modrinth" (Open O-18).
5. **SEEN ON** (S1.8) — `SeenOnRow`: title + count Silkscreen + 2-up `MentionCard` for `mentions` where `project_id = this AND status='published'`, `featured` first then newest. **0 → row not rendered.**
6. **COMMENTS** — `<Suspense fallback={<CommentThreadSkeleton/>}><CommentThreadSection/></Suspense>` (RP-01) → `CommentThread` (states below).
Right rail (sticky ≥900px): `GetItPanel` (big primary: exclusive → direct download of latest version primary file; synced → Modrinth "Download on Modrinth"; rows: Modrinth count, CurseForge count if `project_links` has curseforge, direct count if exclusive; combined-count line), `DetailsList` (type, updated = `external_updated_at ?? updated_at`, licence, source: Modrinth / CurseForge / "Only on odsens" + `source_url` if any), `TipPanel` (S1.9; S1.2–S1.8 placeholder slab linking `/support`, 00 §6).
**Data (ISR shell):** one server fetch per page keyed by slug via `lib/data/projects.ts` under tags `projects`, `project:<slug>` (+ `mentions` via `lib/data/mentions.ts`; `settings` for `site_settings_public.comments_closed_default`). `generateStaticParams`: all published non-hidden slugs at build; `dynamicParams = true` so new slugs render on demand.
**Data (RP-01 `CommentThreadSection`, per request, uncached, RLS):** `viewer` = `getProfile()` (own row: `id, handle, avatar_path, role, is_banned` — never `public_profiles` for self); `comments` for `target_type='project', target_id` via `lib/data/comments.ts` with the session server client (RLS returns published + own held/hidden + all for mods) joined to `public_profiles`, with `like_count` and `liked` (own `comment_likes`); `total`; `commentsEnabled = coalesce(overrides.comments_enabled, not site_settings_public.comments_closed_default)`. `CommentThread` and its islands receive these as props (03) and never query.
**Not found:** unknown slug, `status <> 'published'`, or `overrides.hidden = true` → `notFound()` (root 404). No draft preview URL in v1 (Open O-5).
**Comment thread states (DESIGN §5, §11.2) — all must exist:** signed-out → `SignInPrompt next="/projects/<slug>#comments"` (`GoogleSignInButton` form → POST `/auth/sign-in`, §4); signed-in, not onboarded → cannot reach (middleware); onboarded → `Composer` (1000 chars, ≤1 link, error line inline); own comment → Edit (≤15 min since `created_at`, sets `edited_at`) / Delete (inline confirm); own held → `HeldNotice` (dashed gold-deep, "Only you can see this until OddSense approves it. Usually quick."); hidden → "Hidden by a moderator." slot; deleted-with-replies → "Deleted." slot; banned viewer → composer replaced by "You can't comment here."; comments closed (`commentsEnabled=false`) → CLOSED slab, thread still visible; empty → "NO COMMENTS YET / Say something."; moderator viewer → `Moderate ON/OFF` toggle in thread header, `ModActionRow` on held/reported always, `FIRST COMMENT` tag on held first-timers; report → `ReportPicker` (Spam / Rude / Something else) → "Reported. OddSense will look at it."; count "N TOTAL" beside the title.
**Query params:** none honoured. Fragment `#comments` scrolls to the thread.
**Loading:** `ProjectDetailSkeleton`; `CommentThreadSkeleton` inside the `<Suspense>` around the thread.

### 2.4 Onboarding `/welcome`
Layout: route group `app/(onboarding)/` with its own `layout.tsx` — wordmark + a Sign out form only; no nav links, no footer links, no `FloatingSupportButton` (Open O-2; registry addition §10). Page: `OnboardingPanel` per DESIGN §11.3 #10 + §12.5 guidance block: `STEP 1 OF 1` → "PICK A HANDLE" → line → `HandleField` (validation via `checkHandle` action: 3–20, `^[A-Za-z0-9_]+$`, unique, reserved list per 04 H3, no `@`; states resting/checking/available/invalid) → "What's a handle?" block → `AvatarUpload` (Upload / Skip; square crop) → footer strip: **DONE** (`completeOnboarding`; disabled until available) + "You can change both later. Your Google name and email stay hidden."
**Redirects:** anon → 307 `/`; onboarded → 307 to `next` (validated by `safeNext`, default `/`); success → `router.replace(next ?? '/')` and `Toast` "Saved." is **not** shown (page changes). **Query:** `next` (RP-20). **States:** handle taken → inline reason; upload error → inline "That didn't upload. Try again?"; server error → inline under DONE (never a modal/toast).

### 2.5 Profile `/profile`
DESIGN §11.3 #11: picture row (`AvatarUpload` Change/Remove → `updateProfile`; anchor `id="picture"`), handle row + SAVE (`updateProfile`; consequence line "Changing it renames you on every comment you've left."; same `HandleField` states; anchor `id="handle"`), footer strip: what we store (Google account ID, handle, optional picture, comments/likes/reports) + link `/privacy` + **Delete account** (danger; `InlineConfirm`) → `deleteAccount` (`lib/actions/accounts.ts`; semantics per 04 §1 / 04 OPEN-9). Auth: onboarded (anon → 307 `/`). No query params.

### 2.6 Seen on `/seen-on`
Sections: title `SEEN ON` → 3 `StatTile` (VIEWS = Σ `view_count`, MENTIONS = count, CREATORS = distinct `creator_name`) → `FilterBar` (ALL + one button per platform with counts; project `Select` at right listing projects that have ≥1 published mention + "About OddSense") → 3-up `MentionCard` grid (footer strip = `TypeBadge` + project title link, or the `ODSENS` wordmark chip when `project_id IS NULL`), newest `published_at` first; 1-up phone.
**Query (client-side):** `platform` ∈ `youtube|tiktok|twitch|reddit|article|other` (single); `project` = slug or `odsens` (general). **States:** loading skeleton (3 tiles + 6 card shells); **zero published mentions** → title only, tiles/filter/grid not rendered; **filter yields none → grid renders nothing** (03 G-05: Seen-on surfaces have no empty state — closes O-7). YouTube cards embed inline on click; other platforms link out (`target=_blank rel=noopener`).

### 2.7 Support `/support`
Sections: gold hatched panel `AmountPicker` ($1 / $3 / $5 / Other; **$3 preselected** — prototype "SEND $3 →") + **CONTINUE ON KO-FI** (gold-ink on gold) → mounts `KofiPanelSlot` `loaded` with iframe `https://ko-fi.com/<KOFI_PAGE>/?hidefeed=true&widget=true&embed=true[&amount=<n>]` (03 `KofiPanelSlot`; 01 INV-58; preset-amount support unverified per `docs/design-review.md` #13) → `KofiPanelSlot` (labelled dashed slot; **click-to-load** like other embeds; only page allowed to frame Ko-fi) → "What it pays for" slab → `Leaderboard` in **empty state** "NOBODY YET / Be first." + how-to line (S1.9; live rows arrive S2.1 behind `FLAGS.leaderboard`).
**Data:** none — Ko-fi page name is the `KOFI_PAGE` env var (required from S1.9, 01 env matrix; 00 S1.9); `site_settings.kofi_page` is not read by public pages in v1 (Open O-19). No query params. `FloatingSupportButton` hidden here (RP-15). S0–S1.8 placeholder per RP-16.

### 2.8 Admin — Settings `/admin/settings` (S1.5)
Auth admin (moderator → `AdminGate reason="not-allowed"`, RP-04). Sections (DESIGN §11.3 #15 + §12.1), one form, **SAVE SETTINGS** → `updateSettings` → `Toast` "Saved.":
1. **Moderation** — two square radios: "Hold first-time commenters" (`moderation_mode='hold_first_time'`) / "Auto-publish signed-in users" (`'auto'`), each with a consequence line. `site_settings.comments_closed_default` has **no DESIGN surface** — proposed square `Toggle` under Moderation labelled "Comments off by default on new projects" (OPEN O-20; needs a DESIGN.md §11.3 #15 line); not built until decided.
2. **Notifications — "Where the allay delivers"**: Discord webhook URL (`Field`, masked after save; **Test** secondary → `testDiscordWebhook` → inline ✔/✕ line), Admin emails (`Chip`s, add/remove; stored `admin_notify_emails`; never prefilled from Google). **"What it picks up"**: `NotificationMatrix` rows `comment.new` · `comment.held` · `comment.reported` · `sync.failed`+`sync.stale` (one row toggles both kinds) × columns EMAIL · DISCORD; greyed COMING LATER rows `mention.suggested` · `order.new` · `tip.new` (rendered, disabled). Helper line under grid per §12.1.
3. **Moderators** — `Table` of `public_profiles` where `role <> 'user'` (handle, role) + Remove / Make mod; add by handle → `setUserRole` (04 §11). Admin cannot demote self (04).
4. **Ko-fi** — page name `Field` (`kofi_page`, stored for S2.1; v1 public pages use `KOFI_PAGE` env — Open O-19); webhook `StatusPill` LIVE / NOT SET (v1 always NOT SET + "Arrives with Phase 2.").
`announcement_md` has no DESIGN surface → not exposed in v1. **States:** unsaved changes → SAVE enabled; validation errors inline per field; Test webhook result never a toast. Until S1.5 ships, `moderation_mode` is the seeded default (data-model) — Open O-13.

### 2.9 Download `/api/download/[fileId]`
Flow (04 §2.3 D1–D8, data-model §6): (1) `fileId` must be a uuid else 404; (2) load `project_files` → `project_versions` → `projects` + `project_overrides` (service role, after no auth — anon route); require `storage_path IS NOT NULL` (exclusive), `projects.status='published'`, `overrides.hidden` not true → else 404 (no distinction between reasons); (3) rate limit per `ip_hash` (30 / min, 04 D3) → **429** JSON `{ok:false,error:{code:'rate_limited',message}}` (INV-44) + `Retry-After: 60`; (4) increment `project_files.download_count` + `projects.downloads_direct` and insert `project_downloads(project_id,file_id,ip_hash,ua_hash)` in **one** SQL call (RPC `record_download`); (5) create signed URL from `project-files` bucket, TTL **60s**, with `download: <filename>` (Content-Disposition attachment); (6) `302` with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (04 D6). Methods: GET; **HEAD → same checks, no counter increment, 200 empty body** (04 D6); other methods 405. No revalidation. Analytics: client `track('download', {project, source:'direct'})` fires on click, not here.

### 2.10 Cron `/api/cron/*`
Common (04 C-11–C-13, §2.4): GET; `Authorization: Bearer ${CRON_SECRET}` (`timingSafeEqual`) else **401 JSON, body per 04 C-12** (`{error:'unauthorized'}`; 01 INV-44 shape reconciliation belongs to 04/01) with no side effects; runtime nodejs; `maxDuration` per C-12; lock per C-13 → 200 `{ok:true, skipped:'running'}`; job writes one `sync_runs` row (start/finish/ok/items/error) on every path after auth; returns the job's JSON summary (shape in 04); 500 when `ok=false`. `sync-youtube` accepts `?full=1`. Revalidation per §5. Idempotency keys per 04. `sync-modrinth` also feeds `sync.failed` events (S1.5) and `notify` derives `sync.stale`.

---

## 3. Middleware (`middleware.ts` at repo root)
**Matcher (literal):**
```
matcher: ['/((?!_next/static|_next/image|favicon\\.ico|fonts/|brand/|robots\\.txt|sitemap\\.xml|api/cron/|api/webhooks/|api/download/|api/og|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2|txt|xml)$).*)']
```
Rules, in order (all use `@supabase/ssr` `createServerClient` with the request cookies; response cookies always propagated):
| # | Condition | Action |
|---|---|---|
| M1 | No Supabase auth cookie present (`sb-*-auth-token`) | Skip DB; if path ∈ {`/welcome`, `/profile`} → 307 `/`; else pass through (public pages stay cacheable, no session work) |
| M2 | Cookie present | `supabase.auth.getUser()` (refreshes tokens; sets cookies on response). Invalid/expired → treat as M1. |
| M3 | Authenticated AND path starts with `/auth/` | pass through |
| M4 | Authenticated → read `profiles.handle` for `user.id` (one query) | — |
| M5 | `handle IS NULL` AND path ∉ {`/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*`} | 307 → `/welcome?next=<pathname+search>` (encoded; only if `next` passes RP-20) |
| M6 | `handle IS NOT NULL` AND path `=== '/welcome'` | 307 → validated `next` param or `/` |
| M7 | path starts with `/admin` | pass through — role check happens in `app/admin/layout.tsx` (INV-31); anon renders `AdminGate` there |
| M8 | else | pass through |
**RP-19** Middleware never reads `role` and never renders; it only refreshes the session and enforces the onboarding rule (M5/M6) and the anon redirects for `/welcome`, `/profile` (M1). Role decisions live in `lib/auth.ts` (server, `app/admin/layout.tsx`) and in every action (04). **Note for 00:** S1.1 Scope IN "blocking `/admin/*` for role < moderator" is not middleware's job (01 INV-31) — 00 to amend (registry additions §10).
**RP-20** `next` validation (shared helper `lib/auth.ts` `safeNext(next)` — registry addition §10; 04 §2.1 must reference it): must start with `/`, must not start with `//` or `/\`, must not start with `/api`, `/auth`, `/admin`; else `/`. Used by middleware, `/auth/sign-in`, `/auth/callback`, `/welcome`.
**RP-21** Un-onboarded users can still call `/auth/sign-out` and view `/privacy`, `/how-comments-work` (M5 list agrees with 04 §2.1; 01 INV-30's exclusion list must add these two paths + the M1 anon redirects — registry additions §10; Open O-21).
Performance note: M1 keeps anonymous traffic free of DB calls; the M4 query is one indexed PK read per authenticated request. Replacing it with a JWT claim requires an ADR.

---

## 4. Auth flows
**Sign-in (POST `/auth/sign-in`, `app/auth/sign-in/route.ts` — registry addition §10; 04 must add §2.x; 01 INV-12/INV-17 exception lists must add it):** target of every `GoogleSignInButton` form (03: nav "Sign in", `SignInPrompt`, `AdminGate`). Body: form field `next` → `safeNext`. Server: `createServerClient()` (`lib/supabase/server.ts`) → `supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`, skipBrowserRedirect: true } })` (PKCE; verifier cookie set by `@supabase/ssr`) → 303 to `data.url`. GET → 405. `redirectTo` is built from `NEXT_PUBLIC_SITE_URL` (INV-37), never from `Origin`/`Host`. Redirect URL allow-list is in `supabase/config.toml` (`[remotes.production.auth].additional_redirect_urls`: `https://odsens.com/**`, `https://www.odsens.com/**`, `https://*.vercel.app/**`, `http://localhost:3000/**`); adding a URL = config change, not app change. Client fires `track('sign_in')` on the button click (04 events).
**`/auth/callback` (GET, 04 §2.1):**
1. Read `code`, `next` (`safeNext`). No `code` → 307 `/`.
2. `supabase.auth.exchangeCodeForSession(code)`; on error → 307 `/?auth_error=1` (04 §2.1; logged via `lib/log.ts`; no UI surface in v1 — Open O-9).
3. → 307 `<next>` (default `/`). The callback does **not** read `profiles`; middleware M5 then redirects a null-handle session to `/welcome?next=<next>` (04 §2.1).
4. Response carries the session cookies set by the SSR client. `Cache-Control: no-store`.
**Sign-out (`/auth/sign-out`, POST):** form POST from `ProfileMenu` / onboarding shell; behaviour per 04 §2.2 (`supabase.auth.signOut()` → 303 `/`; GET → 405). CSRF is covered by CSP `form-action 'self'` (01 INV-77).
**Admin gate (`app/admin/layout.tsx`):** `getUser()` null → render `AdminGate reason="signed-out"` (200, no shell, `noindex`); user without handle → 307 `/welcome?next=/admin` (middleware already does this); role `user` → render `AdminGate reason="not-allowed"` (200, no shell); `moderator|admin` → `AdminShell` with sidebar per RP-14. `/admin/settings/page.tsx` additionally `requireRole('admin')` → moderator gets `AdminGate reason="not-allowed"` inside the shell (RP-04).

---

## 5. Revalidation matrix (who calls `revalidateTag`)
**RP-22** This table MUST equal the "Tags revalidated" column of 04 §1.0 for actions and 04 §3 for jobs; **04 wins on conflict**. Nothing calls `revalidatePath` in v1 (04 C-07) — deviation → ADR.
| Trigger (job/action) | Tags | Also revalidates path? |
|---|---|---|
| `syncModrinth` (cron) | `projects`; `project:<slug>` for every upserted/hidden project | no |
| `syncCurseforge` (cron) | `projects`; `project:<slug>` for changed counts | no |
| `syncYoutube` (cron) | `videos` | no |
| `refreshMentions` (cron) | `mentions` | no |
| `snapshotStats`, `notifyFanOut/Deliver` (cron) | — | — |
| `curateProject`, `setProjectLink`, `publishProject`, `updateExclusiveProject`, `uploadProjectMedia`, `uploadProjectFile` | `projects`, `project:<slug>` | no |
| `createExclusiveProject` | — (draft; 04) | no |
| `postComment`, `editComment`, `deleteComment`, `moderateComment` | target tag = `project:<slug>` (v1 comment surface = projects only); `postComment` also `projects` only if `ProjectCard` shows a comment count (04 §1.2 note; not in v1 unless 03 adds it) | no |
| `toggleLike`, `reportComment`, `banUser` | — (04: like state/count are read per request inside `CommentThreadSection`) | no |
| `updateSettings` | `settings` (04) — `/projects/[slug]` carries `settings`, so a `comments_closed_default` change refreshes detail pages | no |
| `setUserRole`, `testDiscordWebhook` | — | no |
| `deleteAccount` | `projects`, `skins`, `art`, `videos` (04) | no |
| `createSkin`, `updateSkin` | `skins` | no |
| `createArt`, `updateArt` | `art` | no |
| `createMention`, `updateMention` | `mentions`; `project:<slug>` if attached to a project | no |
| `updateVideo` (04 §11) | `videos` | no |
| `completeOnboarding`, `updateProfile` | — (04); handle/avatar render inside the per-request `CommentThreadSection`, so no cached comment HTML goes stale (closes former O-10) | — |
| `triggerSync` (admin action) | same as the underlying job | no |
| `/api/download/[fileId]` | none | no |
**RP-23** Home (`/`) carries `projects`,`videos`,`mentions` so it refreshes with any of them. `/seen-on` carries `mentions`,`projects`. `/projects/[slug]` carries `projects`,`project:<slug>`,`mentions`,`settings`.

---

## 6. Loading / error / not-found matrix
| Route | `loading.tsx` content | error boundary | not-found trigger |
|---|---|---|---|
| `/` | hero slab + 4 `ProjectCardSkeleton` | root | — |
| `/projects` | filter bar shell + 6 `ProjectCardSkeleton` | root | — |
| `/projects/[slug]` | `ProjectDetailSkeleton` (+ `CommentThreadSkeleton` in Suspense) | root | unknown/hidden/draft slug |
| `/videos` | player well + 4 facade shells | root | — |
| `/skins` | viewer slab + 4 bust shells | root | — |
| `/art` | 8 masonry shells | root | — |
| `/seen-on` | 3 tile shells + 6 card shells | root | — |
| `/support` | none (no data in v1) | root | — |
| `/profile` | 720px column shells | root | — |
| `/welcome` | none (form renders immediately) | root | — |
| `/admin/*` | `app/admin/loading.tsx` (table shell) + per-route as listed in §1.3 | root (renders outside shell — acceptable) | unknown `[id]` only (wrong role → `AdminGate not-allowed`, RP-04) |
**RP-24** Skeletons obey DESIGN §11.1 (two flat depths, 1.6s opacity pulse, no shimmer, ≤ one screenful).

---

## 7. Smoke list (deploy-checker; 05 T-E2E-43/44 run the same list on previews — column "T-E2E" maps rows to 05 ids)
`<base>` = deployment URL. Status is the final status after redirects unless "no-redirect". Titles are the rendered `<title>` text.
| # | Request | Expect | T-E2E |
|---|---|---|---|
| SM-01 | GET `/` | 200; title `odsens`; `<h1>` present; nav has Projects·Videos·Skins·Art·Seen on; **no** "Commissions"; gold Support link → `/support` | T-E2E-1, 44 |
| SM-02 | GET `/projects` | 200; title `Projects — odsens`; ≥1 `ProjectCard` after first sync (0 → empty state text "NOTHING MATCHES") | T-E2E-44 |
| SM-03 | GET `/projects/<first slug from sitemap>` | 200; title `<title> — odsens`; contains "VERSIONS & FILES" and "COMMENTS" | T-E2E-44 |
| SM-04 | GET `/projects/does-not-exist-404` | 404; body contains "THAT PAGE DOESN'T EXIST" | T-E2E-14 |
| SM-05 | GET `/videos` | 200; title `Videos — odsens`; no `<iframe>` in initial HTML (facades) | T-E2E-44 |
| SM-06 | GET `/skins` | 200; title `Skins — odsens` | T-E2E-44 |
| SM-07 | GET `/art` | 200; title `Art — odsens` | T-E2E-44 |
| SM-08 | GET `/seen-on` | 200; title `Seen on — odsens` | T-E2E-44 |
| SM-09 | GET `/support` | 200; title `Support — odsens`; no Ko-fi `<iframe>` in initial HTML | T-E2E-44 |
| SM-10 | GET `/privacy` | 200; title `Privacy — odsens` | — |
| SM-11 | GET `/how-comments-work` | 200; title `How comments work — odsens` | — |
| SM-12 | GET `/welcome` (anon, no-redirect) | 307 → `/` | — |
| SM-13 | GET `/profile` (anon, no-redirect) | 307 → `/` | — |
| SM-14 | GET `/admin` (anon) | 200; body contains "ADMINS ONLY"; no sidebar; `X-Robots-Tag: noindex, nofollow` | T-E2E-33 |
| SM-15 | GET `/admin/settings` (anon) | 200; "ADMINS ONLY" (gate). (Signed-in role `user` → same page with "This account isn't an admin." — Playwright only, T-E2E-33) | T-E2E-33 |
| SM-16 | GET `/api/cron/sync-modrinth` (no header) | 401; `content-type: application/json` (body per 04 C-12) | T-E2E-43 |
| SM-17 | GET `/api/cron/sync-modrinth` with `Authorization: Bearer $CRON_SECRET` | 200 JSON with `ok:true` and `run_id` (or `skipped:'running'`) (preview only if safe; deploy-checker may skip on prod) | T-E2E-43 |
| SM-18 | GET each other `/api/cron/*` (no header) | 401 | T-E2E-43 |
| SM-19 | POST `/api/cron/notify` (with header) | 405 | — |
| SM-20 | GET `/api/download/00000000-0000-0000-0000-000000000000` | 404 | — |
| SM-21 | GET `/api/download/not-a-uuid` | 404 | — |
| SM-22 | GET `/auth/sign-out`; GET `/auth/sign-in` | 405; 405 | — |
| SM-23 | GET `/auth/callback` (no code, no-redirect) | 307 → `/` | — |
| SM-24 | GET `/robots.txt` | 200; contains `Disallow: /admin` | — |
| SM-25 | GET `/sitemap.xml` | 200; contains `<loc>…/projects</loc>` | — |
| SM-26 | Click "Sign in" on `/` (Playwright) | POST `/auth/sign-in` → 303 → navigation begins to `accounts.google.com` (do not complete) | T-E2E-16, 44 |
| SM-27 | GET `/` headers | all 01 INV-76 headers present: `Content-Security-Policy` (includes `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security` | T-E2E-20 |
| SM-28 | GET `/admin` and `/api/cron/notify` (no header) headers | `X-Robots-Tag: noindex, nofollow` (INV-76) | T-E2E-20 |
| SM-29 | `next build` route table (CI) | `/`, `/projects`, `/projects/[slug]`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support`, `/privacy`, `/how-comments-work` are ISR (`revalidate` 600); `/welcome`, `/profile`, `/admin/*`, `/api/*` are dynamic | — |
| SM-30 | client bundle grep (`.next/static`) | `grep -rEl "SERVICE_ROLE\|CURSEFORGE_API_KEY\|YOUTUBE_API_KEY\|RESEND_API_KEY\|DISCORD_WEBHOOK\|KOFI_\|CRON_SECRET\|GOOGLE_OAUTH"` → empty (01 INV-29 verbatim) | T-E2E-44, CI-4 |
Per-slice applicability: SM-01, 04, 10–16, 20–30 from S1.1 (SM-02/03 from S1.2); SM-05–09 return 200 from S0 as placeholders (RP-16) and gain their content checks in S1.6/S1.7/S1.8/S1.9; SM-17/18 as each cron ships.

---

## 8. Slice → routes checklist (for `00-build-plan.md` acceptance)
| Slice | Routes that must exist and pass smoke |
|---|---|
| S0 | `/` (shell, hero placeholder), placeholder pages `/projects`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support` (RP-16), `/auth/sign-in`, `/auth/callback`, `/auth/sign-out` (shells wired to Supabase SSR — 00 S0), `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/loading.tsx`, `/robots.txt`; nav per RP-12 with Commissions off (`FLAGS.commissions=false`); empty `vercel.json` crons |
| S1.1 | `/welcome`, `/profile`, `/auth/*` wired, `/privacy`, `/how-comments-work`, `/admin` (gate + shell), middleware §3 |
| S1.2 | `/projects`, `/projects/[slug]`, `/` hero + featured, `/admin/projects`, `/admin/projects/[id]` (curate), `/api/cron/sync-modrinth`, `/api/cron/sync-curseforge`, `/sitemap.xml` |
| S1.3 | `/admin/projects/new`, `/admin/projects/[id]` (exclusive edit), `/api/download/[fileId]` |
| S1.4 | `/projects/[slug]` comments (`CommentThreadSection`), `/admin/comments` |
| S1.5 | `/admin/settings` (moderation mode, matrix, webhook + Test, admin emails, moderators — full route), `/api/cron/notify` |
| S1.6 | `/videos`, `/` latest videos, `/admin` videos hide/unhide list, `/api/cron/sync-youtube` |
| S1.7 | `/skins`, `/art`, `/admin/skins`, `/admin/art` |
| S1.8 | `/seen-on`, `/admin/mentions`, SEEN ON row, IN THE WILD strip, `/api/cron/refresh-mentions`, footer line 2 |
| S1.9 | `/support`, `/admin/stats`, `/api/cron/stats-snapshot`, `FloatingSupportButton`, `TipPanel` |
| S1.10 | Sentry on `error.tsx`, Analytics + Speed Insights components in `app/layout.tsx` (`/api/og` only if 00 O-7 flips) |

---

## 9. Open (proposed defaults; decide before freeze)
| ID | Question | Proposed default | Status |
|---|---|---|---|
| O-1 | Session-aware UI on ISR pages — **decided by 01 INV-39** (Suspense-wrapped server components, RP-01). Remaining: the Next.js flag that makes the boundary partial instead of forcing the route dynamic. | 01 adds `experimental.ppr` (or `cacheComponents`) to `next.config.ts` at S0 with an ADR if the flag is experimental; if unavailable, `/projects/[slug]` comments become a dynamic child route segment (ADR) | OPEN (01) |
| O-2 | `/welcome` minimal layout (route group) vs. full nav | Route group `app/(onboarding)/` with wordmark + Sign out only; 01 tree amended (§10) | OPEN |
| O-3 | Admin sidebar order for Mentions/Stats (not in DESIGN §6.9) | Comments · Projects · Skins · Art · Mentions · Stats · Settings | OPEN |
| O-4 | Anonymous user hits an `onboarded` route — land on `/` silently or trigger sign-in | Silent 307 `/` (no `?signin` handling in v1) | OPEN |
| O-5 | Draft/hidden project preview URL for admins | None in v1; admin edits at `/admin/projects/[id]`; add `?preview=<token>` only via ADR | OPEN |
| O-6 | Delete account semantics | Per 04 OPEN-9 (`deleteAccount`, `lib/actions/accounts.ts`); 02 does not re-propose | OPEN (04) |
| O-7 | — closed: Seen-on surfaces render nothing when empty/filtered (03 G-05) | — | CLOSED |
| O-8 | Placeholder-page copy for `/support` before S1.9 ("Tips open soon.") and reuse of the same line when Ko-fi is unavailable | As written; needs a DESIGN.md §11.7 line | OPEN |
| O-9 | OAuth callback error surface (`/?auth_error=1`, 04 §2.1) | Home ignores the param in v1 (no design); revisit with a `Toast` "Sign-in didn't finish. Try again?" (needs DESIGN copy) | OPEN |
| O-10 | — closed: comment author handle/avatar are per-request (RP-01), no stale cached HTML | — | CLOSED |
| O-11 | Sort default `downloads`, single-select type filter, and the sort **option set** `downloads|updated|newest|title` (prototype shows only "Downloads ▾"/"Sort ▾") | As specified in §2.2 | OPEN (confirm) |
| O-12 | 00 S1.2.AC8 says role ≥ moderator can toggle feature/hide on `/admin/projects`; 04 makes `curateProject` admin-only | 04 wins (admin); moderators see disabled controls; 00 AC8 wording to change to "role admin" | OPEN (00/04) |
| O-13 | `/admin/settings` slice: registry + 00 say S1.5 (no S1.1 stub, no Moderators UI in S1.1); 04 says `updateSettings` "mode+emails S1.1" and `setUserRole` S1.1 | Route ships whole in S1.5; `moderation_mode` = seeded default until then; 04 moves `setUserRole` + mode/emails to S1.5 | OPEN (04) |
| O-14 | Admin `Table empty=` copy (§1.3) | Strings as listed | OPEN (copy) |
| O-15 | Hero "NEW" badge threshold | `published_at` < 30 days | OPEN |
| O-16 | `/projects` count-line copy | "<N> things. Some useful, some not." | OPEN (copy) |
| O-17 | `/projects` `q`: client substring (keeps ISR, RP-02) vs 00 S1.2 "search on `search` tsvector" | Client substring in v1; tsvector reserved for later (00 S1.2 wording amended) — else a Suspense-wrapped server search segment | OPEN (00) |
| O-18 | Synced file Download cell → Modrinth CDN file URL (`project_files.url`) vs Modrinth version page URL (spec Goal 3 / platform-audit "link out") | CDN file URL (one click, still Modrinth-hosted); GET IT rail keeps the Modrinth project link | OPEN |
| O-19 | Ko-fi page source: `KOFI_PAGE` env (00 S1.9, 01 INV-58/env matrix) vs `site_settings.kofi_page` (DESIGN §11.3 #15 field, data-model, 04 `updateSettings`) | v1 public pages read env; the settings field is stored but unused until S2.1 (or a `site_settings_public` view exposes it — see §10) | OPEN |
| O-20 | `site_settings.comments_closed_default` has no DESIGN surface on `/admin/settings` | Square toggle under Moderation labelled "Comments off by default on new projects" — needs DESIGN.md §11.3 #15 line; not built until then | OPEN (DESIGN) |
| O-21 | Middleware exceptions `/privacy`, `/how-comments-work` and anon redirects for `/welcome`, `/profile` are not in 01 INV-30's text | Keep (matches 04 §2.1); 01 amends INV-30 | OPEN (01) |

---

## 10. Registry additions (proposed for `_registry.md`; not edited here)
| Kind | Name | Why |
|---|---|---|
| Route | `/robots.txt` (`app/robots.ts`), `/sitemap.xml` (`app/sitemap.ts`) — 01 INV-03 convention list must add `robots.ts`, `sitemap.ts` | RP-07 |
| Route | `/auth/sign-in` (POST, `app/auth/sign-in/route.ts`) — 04 to add §2.x; 01 INV-12 (allowed `@/lib/supabase/server` importers) and INV-17 (route-handler allow-list) to add it | §4 sign-in; 03 `GoogleSignInButton` |
| Route (P2) | `/profile/orders`, `/admin/orders`, `/admin/orders/[id]` | §1.5 (paths implied by DESIGN §11.3 #17, §12.5, data-model §2.7b) |
| Directory | `app/(onboarding)/` (layout + `welcome/`) — 01 §1 tree to add `app/(onboarding)/*` (ADR at S1.1 if 01 prefers) | RP-11, O-2 |
| View | `site_settings_public` (`comments_closed_default`; optionally `kofi_page` — O-19), `select` for anon — data-model §4 row + migration | §1.1 `/projects/[slug]`, RP-01 |
| Helper | `lib/auth.ts` `requireOnboarded()` (04 C-04) and `safeNext(next)` — 01 INV-32 export list to add both | §0.2, RP-20 |
| Component | `NavSession` (server, `components/layout/`) and `CommentThreadSection` (server, `components/comments/`) — Suspense-wrapped session wrappers; 03 may rename | RP-01 |
| Doc amendments | 01 INV-30 (exception list + anon redirects, O-21); 00 S1.1 Scope IN (drop "middleware blocking `/admin/*`"; role gate = `app/admin/layout.tsx`); 00 S1.2.AC8 (O-12); 05 T-E2E-33 / OPEN-11 (role `user` → `AdminGate not-allowed`, not 404) | RP-04, RP-19 |
| Rule IDs | `RP-01…RP-24` (this doc) | so gates can cite them; candidates for `INV-*` promotion in 01: RP-02, RP-03, RP-04, RP-16, RP-17, RP-19, RP-22 |

---

## Review notes (v0.2)
- Rendering model: v0.1's client-side session reads were replaced by 01 INV-39's Suspense model (RP-01); no alternative is kept — 01 wins on architecture.
- Wrong-role on `/admin/*`: v0.1's 404 was replaced by `AdminGate reason="not-allowed"` because 00 S1.1.AC8 (acceptance) and 03 `AdminGate` both specify it; 05 T-E2E-33 and 05 OPEN-11 are the outliers and are asked to change (§10).
- Cron 401 body: 04 C-12 (`{error:'unauthorized'}`) and 01 INV-44 (`{ok:false,error:{code,message}}`) still disagree; this doc defers to 04 for the shape and asserts only status + content-type in SM-16.
- `/api/og`: kept as a row for completeness but marked not in v1 (00 O-7); contract per 04 §2.5.
- Ko-fi page source: env (`KOFI_PAGE`) chosen because 00 S1.9 and 01 INV-58/env matrix both name it; the DESIGN settings field is preserved for S2.1 (O-19).
- `/admin/settings` S1.1 stub dropped (registry + 00 win over 04's partial slice note; O-13).
