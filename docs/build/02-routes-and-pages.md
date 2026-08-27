# Routes & Pages
Every URL odsens.com serves — its slice, rendering mode, auth requirement, data, DESIGN.md section, components, route files, metadata and nav placement — plus middleware, the auth flows, revalidation triggers and the deploy smoke list.
Status: **v1.0 — FROZEN 2026-08-17** (changes only via ADR + doc edit in the same PR; `spec-drift-reviewer` enforces) — amended by ADR-0005 (2026-08-17) — amended by ADR-0007 (2026-08-20) — amended by ADR-0009, ADR-0011, ADR-0013 (2026-08-20; ADR-0009 addendum 2026-08-21) — amended by ADR-0017 (2026-08-21) — amended by ADR-0018 (2026-08-21) — amended by ADR-0019 (2026-08-21) — amended by ADR-0021 (2026-08-27)

Sources: `docs/build/_registry.md` (IDs verbatim), `docs/spec.md`, `docs/data-model.md`, `docs/notifications.md`, `DESIGN.md` v1.3, `docs/design-review.md`, `.claude/skills/{web-quality,vercel-ops,security-check}/SKILL.md`, `.claude/agents/*.md`, `supabase/config.toml`, `docs/build/06-decisions/ADR-0002-spec-reconciliation.md` (binding reconciliation — cited as "ADR-0002 <ref>"). Siblings: `00-build-plan.md` (slice acceptance), `01-architecture.md` (invariants, headers/CSP, env — **wins on cross-cutting invariants and data-access rules; 02 §1 wins for a route's rendering mode** — ADR-0002 precedence, 01 §0), `03-components.md` (component props/states), `04-server-contracts.md` (action/handler shapes, rate limits, cron table — **wins on handler contracts and revalidation tags**), `05-test-plan.md` (test IDs).

---

## 0. Conventions used in this doc

### 0.1 Rendering modes (column "Render")
| Mode | Meaning | Checkable by |
|---|---|---|
| `ISR(600; tags)` | `export const revalidate = 600` (01 INV-38); every read goes through `lib/data/<area>.ts` using the **anon server client without cookies** or the public views `projects_public` / `public_profiles` / `site_settings_public` (INV-12, INV-15) and is wrapped in `unstable_cache`/`cacheTag` with the listed tags (§5). **Never** `lib/supabase/admin.ts` (INV-14), never `cookies()`/`headers()`/`searchParams`/`noStore()` anywhere in the page tree — session-aware UI is a client seam (RP-01). `ISR(600; —)` = no data read; the page still exports `revalidate = 600` (registry Rendering line: `/privacy`, `/how-comments-work` = ISR(600; no data reads); 01 INV-38 agrees). The C20 placeholder pages (RP-16) are **static** — no data reads and no `revalidate` export (01 INV-38) (confirmed by ADR-0005); they show `○` in the route table until their slice replaces them. | `next build` route table shows `○/●`, not `ƒ`; `grep -rn "cookies()" app/(public)` → none; `grep -rln "supabase/admin" app/(public) lib/data` → none |
| `dynamic` | `export const dynamic = 'force-dynamic'` (or reads cookies/searchParams). Session-aware. `Cache-Control: no-store`. | route table shows `ƒ` |

**RP-01** (restates 01 INV-39, INV-09; ADR-0002 C1) Session-dependent parts of an ISR page are **client islands hydrated after load**; the ISR shell never varies by user and no Server Component in the page tree reads a session. Exactly two client components read Supabase directly, both only the viewer's own rows through `lib/supabase/client.ts` under RLS: (a) `ViewerProvider` (`components/accounts/ViewerProvider.tsx`, mounted in `app/(public)/layout.tsx`) — exposes `useViewer()` → `{ status: 'loading'|'anon'|'signed-in'; viewer: { id; handle; avatarUrl; role; isBanned } | null }` (03 C-17a, verbatim) to `Nav`/`ProfileMenu`/`SignInPrompt`/`Composer`; server-rendered HTML always shows the signed-out state, the signed-in nav swaps in on hydration; (b) `CommentThread` (`components/comments/CommentThread.tsx`, `'use client'`) on `/projects/[slug]` — receives the **public** thread as props (server-side via `lib/data/comments.ts` + view `comments_public`, cached under `project:<slug>`) and, once hydrated, reads the viewer's own held/hidden comments and own `comment_likes` client-side and merges them into the list (moderators additionally call RPC `moderator_thread(target_type, target_id)` for this target's held/hidden/reported rows — the one allowed exception, ADR-0002 A2). Every other island (`Composer`, `LikeButton`, `ModActionRow`, `ProfileMenu`, …) receives everything as props from `CommentThread`/`ViewerProvider` and never queries Supabase (INV-09). **No PPR, no `experimental.*` flag** (`NavSession`, `Nav.Viewer`, `CommentThreadSection` do not exist).
**RP-02** ISR pages ignore `searchParams`. Filters/sort/search/selection are client-side over the full published list; the URL is the state (`useSearchParams` inside a `<Suspense>` boundary; `router.replace` with `scroll:false`). `SearchBox` submits a native GET (`/projects?q=`) which the client reads the same way (250 ms debounce, Enter immediate — ADR-0002 #59). On `/projects` that client is `ProjectGrid` (`components/projects/ProjectGrid.tsx`, `'use client'`; ADR-0002 A7), which owns the filter/search/sort state and renders `FilterBar`/`SearchBox`/`ActiveFilterChips` as children.
**RP-03** Public content pages MUST NOT accidentally opt into dynamic rendering (no `cookies()`, `headers()`, `searchParams`, `noStore()`, `fetch(..., {cache:'no-store'})` anywhere under `app/(public)/`). Verified by reading the `next build` route table on every PR (web-quality).

### 0.2 Auth requirement (column "Auth")
| Level | Rule | Enforced by |
|---|---|---|
| `anon` | none | — |
| `user` | Supabase session exists (handle may still be null) | middleware (§3) + page-level `lib/auth.ts` `requireUser()` |
| `onboarded` | session AND `profiles.handle IS NOT NULL` | middleware (§3) + page-level `lib/auth.ts` `requireOnboarded()` (04 SC-04) |
| `moderator` | onboarded AND `profiles.role IN ('moderator','admin')` | `app/admin/layout.tsx` via `lib/auth.ts` `requireRole('moderator')` (**not** middleware) + every action re-checks (04) |
| `admin` | onboarded AND `role = 'admin'` | page-level `requireRole('admin')` + action re-check |
| `cron-secret` | `Authorization: Bearer ${CRON_SECRET}` exact match (`crypto.timingSafeEqual`) | the route handler itself; 401 otherwise (04 SC-12) |

**RP-04** (ADR-0002 C4) Auth failures on pages: `anon` hitting `user`/`onboarded` routes → silent 307 to `/` (§3 M1; ADR-0002 #37). `anon` hitting `/admin/*` → HTTP 200 rendering `AdminGate` ("Admins only" + Google button, DESIGN §11.3 #18) at the same URL, no shell, `noindex`. **Signed-in role `user` on `/admin/*` → `notFound()` → root 404 page** (00 S1.1.AC8, 01 INV-31, 03 `AdminGate`, 05 T-E2E-33). Role `moderator` on `/admin/settings` → `notFound()` as well (the sidebar hides Settings for moderators). Never a 403 body, never a "not-allowed" gate variant — `AdminGate` has no `reason` prop and renders only for anon.

### 0.3 Cache tags (registry names)
`projects` · `project:<slug>` · `videos` · `skins` · `art` · `mentions` · `settings`. No other tags in v1 (see §5).

### 0.4 Metadata rules
**RP-05** `metadataBase = new URL(env.NEXT_PUBLIC_SITE_URL)` in `app/layout.tsx` (INV-37). Title pattern: **`<X> — odsens`** via `title.template = '%s — odsens'`; Home uses `title.absolute = 'odsens'`. Description default: "Mods and other odd things, made by OddSense." (footer line, DESIGN §5 Footer).
**RP-06** OG image: static `public/brand/og-default.png` (1200×630) on every public page (`/api/og` is **not built in v1** — ADR-0002 #22). `/projects/[slug]` sets `openGraph.images` to the featured gallery image when one exists, else the default. Every public page sets `openGraph.title/description/images` and `alternates.canonical = <path>`.
**RP-07** `robots: { index: false, follow: false }` metadata on `/welcome`, `/profile`, `/admin/*`; **plus** response header `X-Robots-Tag: noindex, nofollow` on `/admin/**`, `/welcome`, `/profile` and `/api/**` via `next.config.ts` `headers()` (01 INV-76). `app/robots.ts` disallows `/admin`, `/api`, `/auth`, `/welcome`, `/profile`; `app/sitemap.ts` lists `/`, `/projects`, `/projects/<slug>` (published, not hidden), `/videos`, `/skins`, `/art`, `/seen-on`, `/support`, `/privacy`, `/how-comments-work`. (Both routes are in `_registry.md`.)
**RP-08** No PII in any metadata (no real names, emails). Project OG uses `title_override ?? title` and `description_override ?? description`.

### 0.5 Route files (web-quality)
**RP-09** (ADR-0002 C5) Required at root: `app/layout.tsx` = **html/body, fonts via `next/font/local`, `styles/tokens.css` + `globals.css` only** (no UI, no providers), `app/not-found.tsx` (DESIGN §11.3 #13), `app/error.tsx` (client; DESIGN §11.3 #14, RELOAD + Go home, no codes), `app/global-error.tsx` (same design, self-contained). The Home skeleton lives at `app/(public)/loading.tsx` (03 G-01; skeleton per §11.1) — there is **no** root `app/loading.tsx` (registry repo layout). Group layouts own the chrome: `app/(public)/layout.tsx` = `SkipLink`, `ToastProvider` (`Toast` live region), `ViewerProvider`, `Nav`, `<main id="main">`, `Footer`, `FloatingSupportButton`, and (from S1.10) Vercel Analytics + Speed Insights; `app/(onboarding)/layout.tsx` = `SkipLink`, `ToastProvider`, wordmark + Sign out form; `app/admin/layout.tsx` = `SkipLink`, `ToastProvider`, role gate + `AdminShell`.
**RP-10** Every route segment that reads data has its own `loading.tsx` using the matching `Skeleton*` component (listed per route in §1). `/privacy`, `/how-comments-work` (`ISR(600; —)`, no data) have none.
**RP-11** File locations (01 §1 tree): public routes under `app/(public)/<path>/`; `/profile` under `app/(public)/profile/`; `/welcome` under `app/(onboarding)/welcome/` and `/banned` under `app/(onboarding)/banned/` (ADR-0019) with `app/(onboarding)/layout.tsx` = minimal shell (wordmark + Sign out form only; ADR-0002 C5); admin under `app/admin/` (`app/admin/layout.tsx` = role gate + `AdminShell`; `app/admin/loading.tsx` present); auth handlers = exactly `app/auth/callback/route.ts` and `app/auth/sign-out/route.ts` under `app/auth/**` — **not** inside `app/(public)/` (ADR-0002 A17; registry aligned); no `/auth/sign-in` — ADR-0002 C3; API under `app/api/**/route.ts`.

### 0.6 Nav placement (DESIGN §12.2, §5 Nav, §11.6 Footer)
**RP-12** Nav order (desktop and phone burger; 03 N-03/N-04): wordmark→`/` · **Projects** `/projects` · **Videos** `/videos` · **Skins** `/skins` · **Art** `/art` · **Seen on** `/seen-on` · *Commissions* `/commissions` rendered only when `FLAGS.commissions` — `Nav` takes no props and reads `FLAGS.commissions` from `lib/flags.ts` directly (03 N-09; 01 INV-74) — **false in v1** · right side: `SearchBox placement="nav"` (self-renders only on `/projects` via `usePathname`, 03 `SearchBox`; submits `?q=`) · `GoogleSignInButton label="Sign in"` / `ProfileMenu` · gold **Support** button → `/support` (in the burger menu ≤599px, in the bar 600–899px — ADR-0002 #51; link/Support metrics per pass-3, ADR-0002 #52). No "Home" item. Active item = pathname `===` href or `startsWith(href + '/')`. `ProfileMenu` items → routes: "Your profile" → `/profile` (the former "Change handle" → `/profile#handle` and "Change picture" → `/profile#picture` items are removed — ADR-0018; the anchors stay on `/profile`); "Admin" → `/admin` (role ≥ moderator only, 03 N-06); "Sign out" → `<form method="post" action="/auth/sign-out">`.
**RP-13** Footer "Site" column: Projects · Seen on · *Custom orders* (`/commissions`, rendered only when `FLAGS.commissions` — `Footer` takes no props and reads the flag directly, 03; INV-74) · Support · How comments work · Privacy. "Find me": Modrinth (`https://modrinth.com/user/OddSense/mods` — spec §3), CurseForge (`https://www.curseforge.com/members/oddsense/projects`), YouTube (`https://www.youtube.com/@OdSens`). Two dry lines: "Mods and other odd things, made by OddSense. Not affiliated with Mojang." and "Creators featuring the mods aren't affiliated with odsens." (second line only once S1.8 ships).
**RP-14** Admin sidebar (`AdminShell`, DESIGN §6.9 + §12.2): Comments (held count) · Projects · Skins · Art · Mentions · Stats · Settings (admin only; hidden for moderators) · *Orders* rendered only when `FLAGS.commissions` (`AdminShell` reads the flag directly; props are `{viewer, counts, children}` — 03). Sidebar order Comments · Projects · Skins · Art · Mentions · Stats · Settings — DECIDED (ADR-0002 #36).
**RP-15** `FloatingSupportButton` renders on every public route except `/support`; not under `/admin/*` or `/welcome`.
**RP-16** (ADR-0002 C20) From S0, `/projects`, `/videos`, `/skins`, `/art`, `/seen-on` and `/support` exist as placeholder pages — page title + one voice line "Not yet. Soon." (DESIGN.md §12.7) — each replaced by the real page in its slice; nav is stable and never links to a 404. Placeholders are **static** (no data reads, no `revalidate` export — 01 INV-38) (confirmed by ADR-0005), carry the real `<title>`, and have no `loading.tsx`.

---

## 1. Route table

Legend: **Render** per §0.1; **Auth** per §0.2; **Data** = tables/views read by the page through `lib/data/*` (adapters are only used by jobs — see API table); **Files** = required route files beyond `page.tsx` (root files from RP-09 assumed); **Title** = value of `%s` unless absolute.

### 1.1 Public routes (all files under `app/(public)/`)
| Path | Slice | Render | Auth | Data (tables/views) | DESIGN.md | Components (registry) | Files | Title / OG | Nav |
|---|---|---|---|---|---|---|---|---|---|
| `/` | S0 shell; S1.2 hero+featured; S1.6 videos; S1.8 wild strip; S1.9 tip panel | ISR(600; `projects`,`videos`,`mentions`) | anon | `projects_public`, `project_overrides` (featured), `videos`, `mentions` (published, featured). No `site_settings_public` read — the compact `TipPanel` is static and always rendered (00 S1.9.AC7/AC11, 00-O-19; 03 `TipPanel` `S`, props `{ compact?: boolean }`) | §6.1, §12.2 (IN THE WILD) | `Nav`, `FeaturedHero`, `ProjectCard`×4, `InTheWildStrip`+`MentionCard`+`ReachLine`, `VideoFacade`×2, `TipPanel`, `Footer`, `FloatingSupportButton` | `app/(public)/loading.tsx` | absolute `odsens`; OG default | wordmark |
| `/projects` | S0 placeholder (RP-16); S1.2 | ISR(600; `projects`) | anon | `projects_public` (+ overrides applied in view), counts per type | §6.2, §5 Filter bar, §11.7 empty | `ProjectGrid` (C — owns filter/search/sort state, ADR-0002 A7) → `SearchBox`, `FilterBar`, `ActiveFilterChips`, `ProjectCard`, `ProjectCardSkeleton`, `TypeBadge`, `Chip`, `ExclusiveBadge`, `EmptyState` | `app/(public)/projects/loading.tsx` | `Projects` | Projects |
| `/projects/[slug]` | S1.2 base; S1.3 exclusive DL; S1.4 comments; S1.8 SEEN ON; S1.9 tip panel | ISR(600; `projects`,`project:<slug>`,`mentions`,`settings`) + RP-01 client seam (`CommentThread`) | anon (comment actions need `onboarded`) | `projects_public`, `project_versions`, `project_files`, `project_links`, `project_overrides`, `mentions` (published for project), `site_settings_public` (`comments_closed_default`, `owner_profile_id`; `moderation_mode` is also exposed by the view — ADR-0002 A3 — read by `postComment` and by `CommentThread`'s optimistic-insert rule), `comments_public` (+ `public_profiles`, like counts); client-side under RLS (RP-01): own `comments` (held/hidden), own `comment_likes`; moderators: RPC `moderator_thread` (ADR-0002 A2) | §6.3, §5 Gallery/Comment bubble/Reply/Held/Sign-in prompt, §11.2, §12.2 SEEN ON, §12.5 changelog | `Breadcrumb`, `Gallery`+`Lightbox`, `TypeBadge`, `ExclusiveBadge`, `Chip`, `Markdown`, `VersionsTable`+`ChangelogExpander`, `GetItPanel`, `DetailsList`, `TipPanel`, `SeenOnRow`+`MentionCard`, `CommentThread` (C),`Comment`,`Reply`,`Composer`,`LikeButton`,`ModActionRow`,`HeldNotice`,`SignInPrompt`,`ReportPicker`, `ProjectDetailSkeleton`, `CommentThreadSkeleton` | `app/(public)/projects/[slug]/loading.tsx`; `generateStaticParams` (published slugs); `dynamicParams = true`; unknown/hidden/draft → `notFound()` | `<title_override ?? title>`; OG title+desc from project, image = featured gallery image if any else default | Projects (active) |
| `/videos` | S0 placeholder; S1.6 | ISR(600; `videos`) | anon | `videos` (not hidden) | §6.4, §11.1 Video facade, §11.5 Shorts row, §11.7 empty | `VideoFacade`, `VideoCard`, `UpNextList`, `ShortsRow`, `PixelLabel`, `EmptyState` | `app/(public)/videos/loading.tsx` | `Videos` | Videos |
| `/skins` | S0 placeholder; S1.7 | ISR(600; `skins`) | anon | `skins` (published) | §6.5, §11.7 empty | `SkinViewer3D` (client, lazy), `SkinCard`, `ExclusiveBadge`, `Toggle` (Slim), `Button`, `EmptyState` | `app/(public)/skins/loading.tsx` | `Skins` | Skins |
| `/art` | S0 placeholder; S1.7 | ISR(600; `art`) | anon | `art` (published) | §6.6, §11.7 empty | `ArtMasonry`, `ArtCard`, `Lightbox`, `FilterBar` (kind row), `EmptyState` | `app/(public)/art/loading.tsx` | `Art` | Art |
| `/seen-on` | S0 placeholder; S1.8 | ISR(600; `mentions`,`projects`) | anon | `mentions` (published), `projects_public` (titles/types for tags + project select) | §12.2 Seen on page, §12.1 Mention card/Reach line, §11.1 Stat tile | `StatTile`×3, `FilterBar`, `MentionCard`, `TypeBadge`, `ReachLine`, `EmptyState` | `app/(public)/seen-on/loading.tsx` | `Seen on` | Seen on |
| `/support` | S0 placeholder; S1.9 | ISR(600; `settings`) (S2.1: + `supporters` under `settings`) | anon | `site_settings_public.kofi_page` (ADR-0002 C19; env `KOFI_PAGE` only seeds the row); S2.1: `supporters` | §6.7, §11.4, §12.4 (empty state) | `AmountPicker`, `KofiPanelSlot`, `Leaderboard` (empty state), `Button` (gold) | `app/(public)/support/loading.tsx` (S1.9) | `Support` | gold button |
| `/privacy` | S1.1 | ISR(600; —) | anon | — | §11.3 #12, §12.5 | `Markdown` or JSX, `PixelLabel` (NOTE) | — | `Privacy` | footer |
| `/how-comments-work` | S1.1 | ISR(600; —) | anon | — | §12.5 | JSX blocks SIGN IN · FIRST COMMENT · THE RULES · LEAVING | — | `How comments work` | footer |
| `/profile` | S1.1 | dynamic | `onboarded` | own `profiles` row via `getProfile()` | §11.3 #11 | `AvatarUpload`, `HandleField`, `Button`, `InlineConfirm` | `app/(public)/profile/loading.tsx`; noindex | `Your profile` | ProfileMenu → "Your profile" (ADR-0018: no `#handle` / `#picture` menu items; the page keeps both anchors) |

### 1.2 Auth routes
| Path | Slice | Render | Auth | Data | DESIGN.md | Components | Files | Title | Nav |
|---|---|---|---|---|---|---|---|---|---|
| `/welcome` | S1.1 | dynamic | `user` (redirects: anon → `/`; onboarded → `next` or `/`) | own `profiles` row (`getProfile()`) | §11.3 #10, §11.1 Handle field / Picture upload, §12.5 guidance | `OnboardingPanel`, `HandleField`, `AvatarUpload`, `Button`, `PixelLabel` | `app/(onboarding)/layout.tsx` (minimal shell), `app/(onboarding)/welcome/page.tsx`; noindex | `Pick a handle` | none (blocking) |
| `/banned` | S1.1 (ADR-0019) | dynamic | `user`, banned (redirects: anon → `/`; signed in and not banned → `/`) | own `profiles` row (`getViewer()`) | §11.3 #19 (the #18 admin-gate slab; + the Delete account control since ADR-0021) | `BannedDelete` (C, the Delete account inline confirm — rendered only when `handle` is non-null; page-level markup otherwise stays in the route file, 03 C-21 — ADR-0021) | `app/(onboarding)/layout.tsx` (minimal shell — wordmark + Sign out only), `app/(onboarding)/banned/page.tsx`; noindex | `Banned` | none (the proxy sends every navigation of a banned account here — §3 M4b) |
| `/auth/callback` | S0 shell; S1.1 wired | route handler (GET) | anon (carries `code`) | `profiles.handle` for the new session (ADR-0002 C18); sets `profiles.email_hash` when null (service client, ADR-0002 A14) | — | — | `app/auth/callback/route.ts` | — | — |
| `/auth/sign-out` | S0 shell; S1.1 wired | route handler (POST only; GET → 405; `Origin`/`Referer` host ≠ site → 403, 04 §2.2) | `user` | — | §11.1 Profile menu (Sign out) | — | `app/auth/sign-out/route.ts` | — | ProfileMenu → Sign out |

There is **no `/auth/sign-in` route** (ADR-0002 C3): sign-in starts client-side in `GoogleSignInButton` (§4).

### 1.3 Admin routes (all `dynamic`, all under `app/admin/layout.tsx` gate; all `noindex` + `X-Robots-Tag`; `frame-ancestors 'none'` site-wide per 01 INV-77)
Auth rule (ADR-0002 C7; 04 §1.0): moderators get **read access** to every admin page except `/admin/settings` (→ `notFound()`); **content mutations require `admin`** (`curateProject`, `setProjectLink`, `triggerSync`, `uploadProjectMedia`, `createExclusiveProject`, `updateExclusiveProject`, `publishProject`, `uploadProjectFile`, `updateVideo`, `create/updateSkin`, `create/updateArt`, `createMention`, `updateMention`, `fetchMentionPreview`); **moderator** suffices only for comment moderation (`moderateComment`, `banUser`, `renameUserHandle`, `deleteComment` on others' comments). Pages MUST render admin-only controls **disabled** (with `aria-disabled` and title "Admin only") for moderators so no control leads to a `forbidden` error. RLS stays admin for content tables (actions use the service client).
| Path | Slice | Auth | Data | DESIGN.md | Components | Files | Title | Sidebar |
|---|---|---|---|---|---|---|---|---|
| `/admin` | S1.1 gate; S1.2 `SyncStatus`; S1.4 held count; S1.6 videos list | moderator (view); `triggerSync`/`updateVideo` admin | `sync_runs` (latest per source), `comments` count where `status='held'`, `projects` count where `status='draft'`, `videos` (S1.6: hide/unhide list — ADR-0002 #20, no `/admin/videos`; action `updateVideo`, admin) | §6.9, §11.3 #18 | `AdminShell`, `AdminGate`, `SyncStatus`, `StatTile`, `Table` (videos), `Toggle` (hidden) | `app/admin/layout.tsx`, `app/admin/loading.tsx` | `Admin` | (home of shell) |
| `/admin/projects` | S1.2 | moderator (view) / admin (all mutations per 04) | `projects` (all statuses), `project_overrides`, `project_links`, `sync_runs` (modrinth/curseforge) | §6.9, §11.1 Admin table, §5 Admin field | `Table`, `StatusPill`, `Toggle`, `Field`, `SyncStatus`, `Button`, `ReorderableList` (feature / hide / reorder controls live **on this list** — ADR-0002 A11; reorder = one `curateProject` call with `reorder: [{project_id, featured_order}]`, one revalidate) | `app/admin/projects/loading.tsx` | `Projects · Admin` | Projects |
| `/admin/projects/new` | S1.3 | admin | — | §6.9 add/edit forms, §11.1 Upload well | `Field`, `Select`, `Chip`, `UploadWell`, `Markdown` (preview), `Button` | — | `New project · Admin` | Projects → "New exclusive project" |
| `/admin/projects/[id]` | S1.2 (curate synced); S1.3 (edit exclusive) | moderator (view) / admin (all mutations per 04: curate, edit, publish, upload) | `projects` by id (any status), `project_versions`, `project_files`, `project_links`, `project_overrides` (per-project extras only: extra gallery, notes, CF id — feature/hide/reorder are on `/admin/projects`, ADR-0002 A11) | §6.9, §11.1 Upload well, §5 Gallery | `Field`, `Select`, `Toggle`, `UploadWell`, `Gallery`, `VersionsTable`, `Markdown`, `StatusPill`, `Button` | `app/admin/projects/[id]/loading.tsx`; unknown id → `notFound()` | `<title> · Admin` | Projects |
| `/admin/comments` | S1.4 | moderator (moderation actions allowed) | `comments` (all statuses) + `public_profiles`, `comment_reports` (unresolved), `projects_public` (target titles) | §6.9 moderation queue, §11.1 Mod action row, §11.2 | `Table`, `StatusPill`, `ModActionRow`, `Comment`, `Button` | `app/admin/comments/loading.tsx` | `Comments · Admin` | Comments (held count) |
| `/admin/skins` | S1.7 | moderator (view) / admin (create/update) | `skins` (all) | §6.9, §11.1 Upload well | `Table`, `Field`, `Select`, `Toggle`, `UploadWell`, `SkinCard`, `StatusPill` | `app/admin/skins/loading.tsx` | `Skins · Admin` | Skins |
| `/admin/art` | S1.7 | moderator (view) / admin (create/update) | `art` (all) | §6.9, §11.1 Upload well | `Table`, `Field`, `Select`, `Toggle`, `UploadWell`, `ArtCard`, `StatusPill` | `app/admin/art/loading.tsx` | `Art · Admin` | Art |
| `/admin/mentions` | S1.8 | moderator (view) / admin (`createMention`, `updateMention`, `fetchMentionPreview`) | `mentions` (all statuses), `projects_public` (assign select) | §12.2 Admin → Mentions | `Field` (URL), `MentionPreview`, `Select`, `Table`, `StatusPill`, `Button` | `app/admin/mentions/loading.tsx` | `Mentions · Admin` | Mentions |
| `/admin/stats` | S1.9 | moderator | `stats_daily`, `projects` (totals), `comments` (counts), `sync_runs` (latest per source) | §11.3 #16, §11.1 Stat tile / Flat bar chart | `StatTile`×4, `FlatBarChart`, `SyncStatus` | `app/admin/stats/loading.tsx` | `Stats · Admin` | Stats |
| `/admin/settings` | S1.5 (whole route incl. `setUserRole` + moderators table — ADR-0002 C2; no S1.1 stub, roles bootstrapped by SQL until then) | **admin** (moderator → `notFound()`, RP-04) | `site_settings`, `notification_matrix`, `public_profiles` where `role <> 'user'` (INV-45) | §11.3 #15, §12.1 Notification matrix | `Toggle` (radios + matrix + `comments_closed_default`), `NotificationMatrix`, `Field`, `Chip` (admin emails), `Table` (moderators), `StatusPill` (Ko-fi LIVE/NOT SET), `Button`, `Toast` | `app/admin/settings/loading.tsx` | `Settings · Admin` | Settings (admin only) |

**Admin empty rows** (`Table empty=` copy, 03 G-05 — DECIDED ADR-0002 #40; `write-copy` may polish before S1.10): `/admin/comments` "Nothing held. Nice." · `/admin/projects` "No projects yet. Run a sync." · `/admin/mentions` "Nothing pasted yet." · `/admin/skins`, `/admin/art` "Nothing here yet." · `/admin` videos list "No videos yet."

### 1.4 API routes (all `dynamic`, `runtime = 'nodejs'` — 01 INV-22; JSON unless noted; `Cache-Control: no-store` unless 04 says otherwise)
| Path | Slice | Method | Auth | Reads / writes (via job or handler) | Adapters | Cron schedule (`vercel.json`, = 04 §6) | Revalidates | Response |
|---|---|---|---|---|---|---|---|---|
| `/api/download/[fileId]` | S1.3 (kind `project_file`); S1.7 (kind `skin` → RPC `record_skin_download`, ADR-0002 C8) | GET only; HEAD and all other methods → 405 (ADR-0002 C17) | anon | R: `project_files`, `project_versions`, `projects`, `project_overrides` (or `skins`) · W: `project_files.download_count`, `projects.downloads_direct`, `project_downloads` (RPC `record_download`) / `skins.downloads` (RPC `record_skin_download`) | — (Supabase Storage signed URL) | — | none (counts surface at next ISR ≤600s) | 302 → signed URL (TTL 60s, `download=<filename>`); 404 unpublished/hidden/not-exclusive/unknown; 429 JSON `{ok:false,error:{code:'rate_limited',message}}` + `Retry-After: 60` (ADR-0002 C14/C17) |
| `/api/cron/sync-modrinth` | S1.2 | GET (POST 405) | cron-secret | job `syncModrinth` → `projects`, `project_versions`, `project_files`, `sync_runs`; on failure `notification_events(sync.failed)` (S1.5) | `modrinth` | `7 * * * *` | `projects`; `project:<slug>` for each changed slug | 200 `{ok, source, run_id, items, ms}` / 500 `{ok:false, source, run_id, error:{code:'job_failed', message}}` (04 SC-12) / 401 `{ok:false,error:{code:'unauthorized',message}}` (ADR-0002 C14) |
| `/api/cron/sync-curseforge` | S1.2 | GET | cron-secret | job `syncCurseforge` → `project_links`, `projects.downloads_curseforge`, `sync_runs` | `curseforge` | `17 * * * *` | `projects`; `project:<slug>` for changed | same |
| `/api/cron/sync-youtube` | S1.6 | GET; query `?full=1` (manual full re-sync, 04 §2.4) | cron-secret | job `syncYoutube` → `videos`, `sync_runs` | `youtube` | `27 * * * *` | `videos` | same |
| `/api/cron/refresh-mentions` | S1.8 | GET | cron-secret | job `refreshMentions` → `mentions.view_count`, `sync_runs` | `youtube` | `37 * * * *` | `mentions`; `project:<slug>` for mentions whose `view_count` changed (04 §3.4) | same |
| `/api/cron/stats-snapshot` | S1.9 | GET | cron-secret | job `snapshotStats` → `stats_daily`; aggregates + purges `project_downloads` >90d; `sync_runs` | — | `0 3 * * *` | none | same |
| `/api/cron/notify` | S1.5 | GET | cron-secret | jobs `notifyFanOut` + `notifyDeliver` → `notification_recipients`; reads `notification_matrix`, `site_settings`; also emits `sync.stale` if no ok `sync_runs` in 6h per source | `resend`, `discord` | `*/5 * * * *` | none | same (`items` = delivered count) |
| `/api/webhooks/kofi` | **S2.1** | POST | Ko-fi `verification_token` | `kofi_events`, `supporters`, `notification_events(tip.new)` | — | — | `settings` (leaderboard on `/support`) | stub only in v1 (route absent, INV-75) |
| `/api/og` | **not in v1** (ADR-0002 #22 — static `public/brand/og-default.png`); reintroduce only via ADR | — | — | — | — | — | — | — |
| `/robots.txt`, `/sitemap.xml` | S0 (T-E2E-45a) / S1.2 (T-E2E-45b) — ADR-0002 A9 | GET | anon | `projects_public` slugs (sitemap) | — | — | — | text / xml (`app/robots.ts`, `app/sitemap.ts`) |

**RP-17** All `/api/cron/*` handlers: `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, `maxDuration = 300` for the sync/stats/refresh routes and `60` for `notify` (ADR-0002 C15; Vercel Pro). 401 returns before any DB write; exactly one `sync_runs` row per authorised invocation (04 SC-11/SC-12); concurrency lock per 04 SC-13 → 200 `{ok:true, skipped:'running'}`. Each handler is a thin wrapper: auth check → call the `lib/jobs/*` function → return its JSON summary. The same job functions are called by the admin `triggerSync` action (04) — never the HTTP route from inside the app.
**RP-18** `vercel.json` `crons[]` = exactly the `{path, schedule}` rows of 04 §6 once each slice ships (S0 ships an empty list). Any schedule change → ADR (04 V4).

### 1.5 Phase 2 stubs (routes reserved; not built in v1) and non-production routes
| Path | Slice | Render/Auth | One line |
|---|---|---|---|
| `/commissions` | S2.2 | dynamic / onboarded (form) | Custom Orders intake per DESIGN §6.8; post-submit "SENT." (§12.5). `FLAGS.commissions` flips → nav + footer item render. |
| `/profile/orders` | S2.2 | dynamic / onboarded | "Your orders" from ProfileMenu (§12.5). |
| `/workrooms/[id]` | S2.3 | dynamic / member (RLS) | Project-detail layout behind membership wall (§12.3). |
| `/admin/orders`, `/admin/orders/[id]` | S2.2/S2.3 | dynamic / moderator | Orders & Workrooms (§11.3 #17, §12.3; path from `docs/data-model.md` §2.7b). |
| `/api/webhooks/kofi` | S2.1 | POST / token | see 1.4. |
| `/dev/components` | S0, dev only (ADR-0002 #44) | `notFound()` in production and on any Vercel deployment | Component preview surface (05 T-E2E-48); absent from production builds. |
| `/__test/throw` | E2E only (ADR-0002 #74) | exists only when `E2E=1` | Error-boundary test route; absent from production builds. |

---

## 2. Page details

### 2.1 Home `/`
Sections in DOM order (each is a `<section>` with a heading; hero `h1`):
1. `FeaturedHero` — the published, non-hidden project with `project_overrides.featured = true` and the **lowest** `featured_order`; if none is featured, the published project with the highest `downloads_total` (00 O-3 default). Shows badges (`ExclusiveBadge` if `source='odsens'`; "NEW" if `published_at` < 30 days — ADR-0002 #41), title (`title_override ?? title`), description, gold DOWNLOAD (→ exclusive: `/api/download/<primary file id of latest version>`; synced: Modrinth project URL) + secondary "See the project" (→ `/projects/<slug>`), version chips (max 4, then `+N`), right rail 16:9 image (featured gallery image, else first gallery image, else icon in a well) + intro strip ("OddSense makes things for Minecraft" + avatar 56px).
2. **Featured projects** (4-up) — next featured projects by `featured_order` (excluding the hero); if nothing is featured, the next four by `downloads_total` (00 O-3 default); fewer than 4 → render what exists; **0 published projects → section not rendered**.
3. `InTheWildStrip` (S1.8) — up to 4 `mentions` where `status='published' AND featured=true` ordered by `sort_order`, then `ReachLine` (totals over **all** published mentions: sum `view_count`, count, distinct `creator_name`), then ghost link "All mentions →" (`/seen-on`). **0 featured mentions → strip not rendered** (DESIGN §12.1: no empty state).
4. **Latest videos** (2-up, S1.6) — 2 newest `videos` where `hidden=false AND is_short=false` as `VideoFacade` (click → inline `youtube-nocookie` player), beside "Find me" list (RP-13 links) and compact `TipPanel` (S1.9; static server slab, **always rendered**, links to `/support` — 00 S1.9.AC7/AC11, 00-O-19; 03 `TipPanel` `S` `{ compact?: boolean }`; only `/support` reacts to an empty `kofi_page`, 04 §5.7). 0 videos → the videos column shows the §11.7 empty state ("NO VIDEOS YET" → channel link).
5. `Footer`.

States: **loading** `app/(public)/loading.tsx` (hero + 4 `ProjectCardSkeleton`, 03 G-01); **error** root `error.tsx`; **empty (no published projects, pre-first-sync)** — hero not rendered, intro strip renders alone, Featured hidden (transient; no design). Query params: none honoured. A failed OAuth callback lands on `/` with **no** query param and no UI surface (ADR-0002 C18); anon users bounced from `onboarded` routes also land here silently (ADR-0002 #37).

### 2.2 Projects `/projects`
Sections: page title `PROJECTS` + count line "<N> things. Some useful, some not." (`1 thing. Useful or not.` when N = 1 — 03 V-02; ADR-0002 #39) → `SearchBox placement="page"` on phone (nav on desktop) → `FilterBar` → `ActiveFilterChips` + "Showing <n> of <N>" → 3-up grid (2-up tablet, 1-up phone) of `ProjectCard` → empty state.
**Data:** all rows of `projects_public` (status published, not `overrides.hidden`) with `title_override/description_override` applied by the view, `downloads_total`, `loaders`, `game_versions`, `project_type`, `source`, `external_updated_at`, `published_at`. Fetched server-side via `lib/data/projects.ts` under tag `projects`; passed as props to **`ProjectGrid`** (`components/projects/ProjectGrid.tsx`, `'use client'` — ADR-0002 A7), which owns filter/search/sort state over the list, renders the `ProjectCard`s, "Showing <n> of <N>" and the empty state; `FilterBar`/`SearchBox`/`ActiveFilterChips` are its children (RP-02).
**Query params (client-side, all optional):**
| Param | Values | Default | Notes |
|---|---|---|---|
| `type` | `mod` \| `datapack` \| `resourcepack` \| `plugin` | none = ALL | single-select (filter bar shows ALL + one active) |
| `version` | one entry from the union of `game_versions` grouped per 03 V-01 (`lib/versions.ts` `groupGameVersions()`): `major.minor` → label `<major.minor>.x` (e.g. `1.21.x`), snapshots (`24w10a`, `1.21-pre1`) grouped under `snapshots`, newest group first — prototype pass-1 "1.21.x ▾" | none | single |
| `sort` | `downloads` \| `updated` \| `newest` \| `title` (ADR-0002 #39) | `downloads` (prototype "Downloads ▾") | `updated` = `external_updated_at desc`, `newest` = `published_at desc`, `title` = A→Z |
| `q` | free text | none | client substring match on title + description (case-insensitive); tsvector search not in v1 (00 S1.2 agrees) |
| `page` | — | — | **not supported**; no pagination in v1 (≤ ~50 projects) |
**States:** loading (`ProjectCardSkeleton` × 6); empty ("NOTHING MATCHES / Try fewer filters." + Clear filters — DESIGN §11.7); zero projects at all (pre-sync / S0 placeholder) → same empty state without the Clear action.

### 2.3 Project detail `/projects/[slug]`
Sections in DOM order (phone order per DESIGN §6.3: header, gallery, about, files, seen on, comments; rail becomes sections):
1. `Breadcrumb` (Projects › title) · header: 104px icon, `h1` title, description, row = `TypeBadge` + `ExclusiveBadge`(if `source='odsens'`) + up to 4 `Chip`s (versions/loaders) + `downloads_total`.
2. `Gallery` (`gallery` ∪ `overrides.extra_gallery`, featured first) + `Lightbox`. 0 images → gallery not rendered.
3. **ABOUT** — `Markdown(body_md)` then, if `overrides.notes_md`, a second `Markdown` block under a `NoteCallout`.
4. **VERSIONS & FILES** — `VersionsTable` rows from `project_versions` (newest first) × `project_files`; columns file · Minecraft · loader · size · Download; per-version `ChangelogExpander` ("Changes ▾", one open at a time, collapsed by default). Download href: exclusive → `/api/download/<file id>`; synced → `project_files.url` (Modrinth CDN) with `rel="noopener"` (ADR-0002 #42; the GET IT rail keeps the Modrinth project link).
5. **SEEN ON** (S1.8) — `SeenOnRow`: title + count Silkscreen + 2-up `MentionCard` for `mentions` where `project_id = this AND status='published'`, `featured` first then newest. **0 → row not rendered.**
6. **COMMENTS** — `CommentThread` (client, RP-01): the public thread is server-rendered from `comments_public` inside the ISR HTML; the viewer's own held/hidden comments and likes merge in after hydration (states below).
Right rail (sticky ≥900px): `GetItPanel` (big primary: exclusive → direct download of latest version primary file; synced → Modrinth "Download on Modrinth"; rows: Modrinth count, CurseForge count if `project_links` has curseforge, direct count if exclusive; combined-count line), `DetailsList` (type, updated = `external_updated_at ?? updated_at`, licence, source: Modrinth / CurseForge / "Only on odsens" + `source_url` if any), `TipPanel` (S1.9; S1.2–S1.8 placeholder slab linking `/support`, 00 §6).
**Data (ISR shell):** one server fetch per page keyed by slug via `lib/data/projects.ts` under tags `projects`, `project:<slug>` (+ `mentions` via `lib/data/mentions.ts`; `settings` for `site_settings_public.comments_closed_default` / `owner_profile_id`; public comments via `lib/data/comments.ts` + view `comments_public` under `project:<slug>` — published rows plus "Hidden by a moderator."/"Deleted." slots, `public_profiles` joins, `like_count`, `edited_at`, `is_first_comment`). `generateStaticParams`: all published non-hidden slugs at build; `dynamicParams = true` so new slugs render on demand.
**Data (RP-01 client seam, after hydration, RLS via `lib/supabase/client.ts`):** `viewer` = `useViewer()` (03 C-17a shape `{ status; viewer: { id; handle; avatarUrl; role; isBanned } | null }`; `ViewerProvider` reads the session + **one read of the viewer's own `profiles` row** (`id, handle, avatar_path, role, is_banned`, own-row RLS select; never `public_profiles` for self — 03 C-17a, owner; data-model §4 `profiles` select = own row); own `comments` where `author_id = auth.uid()` and `status IN ('held','hidden')` for this target (merged into the list in place); own `comment_likes` for the listed comment ids (→ `liked`). **One further read, moderators only** (ADR-0002 A2 — the allowed exception to 01 INV-09 / 03 C-17): when `viewer.role IN ('moderator','admin')`, `CommentThread` calls RPC `moderator_thread(target_type, target_id)` (security definer; requires `is_moderator()`; returns this target's held/hidden/reported rows + `is_first_comment` + `report_count`) through the same client seam and merges those rows in place, so `ModActionRow`/`FIRST COMMENT` render in the public thread; `comments_public` is unchanged and non-moderators never call it. **Nothing else is read through the seam** (ADR-0002 C1, 01 INV-09, 03 C-17). `commentsEnabled = coalesce(overrides.comments_enabled, not site_settings_public.comments_closed_default)` is computed server-side and passed as a prop. `CommentThread`'s child islands receive these as props (03) and never query.
**Not found:** unknown slug, `status <> 'published'`, or `overrides.hidden = true` → `notFound()` (root 404). No draft preview URL in v1 (ADR-0002 #38).
**Comment thread states (DESIGN §5, §11.2) — all must exist:** signed-out → `SignInPrompt next="/projects/<slug>#comments"` (`GoogleSignInButton`, client `signInWithOAuth` — §4); signed-in, not onboarded → cannot reach (middleware); onboarded → `Composer` (1000 chars, ≤1 link, error line inline); own comment → Edit (≤15 min since `created_at`, sets `edited_at`) / Delete (inline confirm); own held → `HeldNotice` (dashed gold-deep, "Only you can see this until OddSense approves it. Usually quick."); hidden → "Hidden by a moderator." slot; deleted-with-replies → "Deleted." slot; banned viewer → composer replaced by "You can't comment here."; comments closed (`commentsEnabled=false`) → CLOSED slab, thread still visible; empty → "NO COMMENTS YET / Say something."; moderator viewer → `Moderate ON/OFF` toggle in thread header, `ModActionRow` on held/reported always, `FIRST COMMENT` tag on held first-timers; report → `ReportPicker` (Spam / Rude / Something else) → "Reported. OddSense will look at it."; count "N TOTAL" beside the title (= the slots the viewer sees: published + own held/hidden + "Deleted."/"Hidden." slots — ADR-0002 #76).
**Query params:** none honoured. Fragment `#comments` scrolls to the thread.
**Loading:** `ProjectDetailSkeleton` (`loading.tsx`); `CommentThreadSkeleton` is the thread's own placeholder only while `CommentThread` merges the viewer's rows after hydration (public rows are already in the HTML).

### 2.4 Onboarding `/welcome`
Layout: route group `app/(onboarding)/` with its own `layout.tsx` — wordmark + a Sign out form only; no nav links, no footer links, no `FloatingSupportButton` (ADR-0002 C5). Page: `OnboardingPanel` per DESIGN §11.3 #10 + §12.5 guidance block: `STEP 1 OF 1` → "PICK A HANDLE" → line → `HandleField` (validation via `checkHandle` action: 3–20, `^[A-Za-z0-9_]+$`, unique, reserved list per 04 H3, no `@`; states resting/checking/available/invalid) → "What's a handle?" block → `AvatarUpload` (Upload; square crop — no Skip button: leaving the picture empty and pressing DONE is the skip, ADR-0017) → footer strip: **DONE** (`completeOnboarding`; disabled until available) + "You can change both later. Your Google name and email stay hidden."
**Redirects:** anon → 307 `/`; onboarded → 307 to `next` (validated by `safeNext`, default `/`); success → a **document navigation** `window.location.assign(next ?? '/')`, not `router.replace` (the client router's prefetch cache can hold `/` as the proxy's M5 answer "307 → /welcome", so a soft navigation landed back on `/welcome`; the onboarding layout's wordmark link has `prefetch={false}` — ADR-0017) and `Toast` "Saved." is **not** shown (page changes). **Query:** `next` (RP-20). **States:** handle taken → inline reason; upload error → inline "That didn't upload. Try again?"; server error → inline under DONE (never a modal/toast).

### 2.5 Profile `/profile`
DESIGN §11.3 #11: picture row (`AvatarUpload` Change/Remove → `updateProfile`; anchor `id="picture"`), handle row + SAVE (`updateProfile`; consequence line "Changing it renames you on every comment you've left."; same `HandleField` states; anchor `id="handle"`), footer strip: what we store (Google account ID, handle, optional picture, comments/likes/reports) + link `/privacy` + **Delete account** (danger; `InlineConfirm`) → `deleteAccount` (`lib/actions/accounts.ts`; ADR-0002 #28: comments → `deleted`, likes/reports removed, avatar removed, `auth.admin.deleteUser`). Handle rename via `updateProfile` is limited to 1 per 7 days (`profiles.handle_changed_at`, ADR-0002 #27) — the SAVE row shows the next allowed date inline when limited. Auth: onboarded (anon → 307 `/`). No query params.

### 2.6 Seen on `/seen-on`
Sections: title `SEEN ON` → 3 `StatTile` (VIEWS = Σ `view_count`, MENTIONS = count, CREATORS = distinct `creator_name`) → `FilterBar` (ALL + one button per platform with counts; project `Select` at right listing projects that have ≥1 published mention + "About OddSense") → 3-up `MentionCard` grid (footer strip = `TypeBadge` + project title link, or the `ODSENS` wordmark chip when `project_id IS NULL`), newest `published_at` first; 1-up phone.
**Query (client-side):** `platform` ∈ `youtube|tiktok|twitch|reddit|article|other` (single); `project` = slug or `odsens` (general). **States:** loading skeleton (3 tiles + 6 card shells); **zero published mentions** → title only, tiles/filter/grid not rendered; **filter yields none → `EmptyState` "NOTHING HERE / Try another filter."** (ADR-0002 #62; DESIGN §11.7 line). Non-YouTube thumbnails render the `PlatformMark` placeholder (ADR-0002 #33). YouTube cards embed inline on click; other platforms link out (`target=_blank rel=noopener`).

### 2.7 Support `/support`
Sections: gold hatched panel `AmountPicker` ($1 / $3 / $5 / Other; **$3 preselected** — prototype "SEND $3 →") + **CONTINUE ON KO-FI** (gold-ink on gold) → mounts `KofiPanelSlot` `loaded` **in place** (no new tab — ADR-0002 C19) with iframe `https://ko-fi.com/<site_settings.kofi_page>/?hidefeed=true&widget=true&embed=true` (03 `KofiPanelSlot`; 01 INV-58; 712/620 px — ADR-0002 #50). The chosen amount is **not** passed in the URL in v1 (04 §5.7; no documented preset-amount param — verify when the account exists, then `lib/support.ts` `kofiUrl(page, amount)`); it is used only for `tip_click {amount, from}` analytics (ADR-0002 C12); an "on Ko-fi ↗" ghost link opens the page itself → `KofiPanelSlot` (labelled dashed slot; **click-to-load** like other embeds; only page allowed to frame Ko-fi) → "What it pays for" slab → `Leaderboard` in **empty state** "NOBODY YET / Be first." + how-to line (S1.9; live rows arrive S2.1 behind `FLAGS.leaderboard`).
**Data:** `site_settings_public.kofi_page` via `lib/data/settings.ts` under tag `settings` (ADR-0002 C19; env `KOFI_PAGE` only seeds the row). Empty `kofi_page` → picker + CONTINUE button **disabled**, mute line "Tips open soon.", panel slot hidden (04 §5.7; 00 S1.9.AC4) — "Not yet. Soon." is the C20 placeholder-page line only (DESIGN.md §12.7). No query params. `FloatingSupportButton` hidden here (RP-15). S0–S1.8 placeholder per RP-16.

### 2.8 Admin — Settings `/admin/settings` (S1.5)
Auth admin (moderator → `notFound()`, RP-04). Ships whole in S1.5 (ADR-0002 C2); until then roles are bootstrapped by SQL (local seed; one documented SQL for prod after first sign-in — ADR-0002 #23). Sections (DESIGN §11.3 #15 + §12.1), one form, **SAVE SETTINGS** → `updateSettings` → `Toast` "Saved.":
1. **Moderation** — two square radios: "Hold first-time commenters" (`moderation_mode='hold_first_time'`) / "Auto-publish signed-in users" (`'auto'`), each with a consequence line. `site_settings.comments_closed_default` = square `Toggle` under Moderation with the 03 V-03 label (ADR-0002 #43; DESIGN.md §12.7 build clarification).
2. **Notifications — "Where the allay delivers"**: Discord webhook URL (`Field`, masked after save; **Test** secondary → `testDiscordWebhook` → inline ✔/✕ line), Admin emails (`Chip`s, add/remove; stored `admin_notify_emails`; never prefilled from Google). **"What it picks up"**: `NotificationMatrix` rows `comment.new` · `comment.held` · `comment.reported` · `sync.failed`+`sync.stale` (one row toggles both kinds) × columns EMAIL · DISCORD; greyed COMING LATER rows `mention.suggested` · `order.new` · `tip.new` (rendered, disabled). Helper line under grid per §12.1.
3. **Moderators** — `Table` of `public_profiles` where `role <> 'user'` (handle, role) + Remove / Make mod; add by handle → `setUserRole` (04 §1.3). Admin cannot demote self (04).
4. **Ko-fi** — page name `Field` (`kofi_page`; read by `/support` through `site_settings_public` — ADR-0002 C19; `TipPanel` is static and does not read it; saving revalidates `settings`); webhook `StatusPill` LIVE / NOT SET (v1 always NOT SET + "Arrives with Phase 2.").
`announcement_md` has no DESIGN surface → not exposed in v1. **States:** unsaved changes → SAVE enabled; validation errors inline per field; Test webhook result never a toast. Until S1.5 ships, `moderation_mode` is the seeded default (data-model) — ADR-0002 C2. `moderation_mode` is exposed (non-sensitive) by `site_settings_public` (ADR-0002 A3): `postComment` reads it via the RLS server client; the `CommentThread` client optimistic-insert rule reads it from the same view.

### 2.9 Download `/api/download/[fileId]`
Flow (04 §2.3 D1–D7, data-model §6): (1) `fileId` must be a uuid else 404; (2) load `project_files` → `project_versions` → `projects` + `project_overrides` (service role, after no auth — anon route); require `storage_path IS NOT NULL` (exclusive), `projects.status='published'`, `overrides.hidden` not true → else 404 (no distinction between reasons); (3) rate limit per `ip_hash` (30 / min, 04 D3; `ipHash = HMAC-SHA256(HASH_SECRET, ip|utcDay)` — ADR-0002 C13) → **429** JSON `{ok:false,error:{code:'rate_limited',message}}` (ADR-0002 C14) + `Retry-After: 60`; (4) increment `project_files.download_count` + `projects.downloads_direct` and insert `project_downloads(project_id,file_id,ip_hash,ua_hash)` in **one** SQL call (RPC `record_download`); (5) create signed URL from `project-files` bucket, TTL **60s**, with `download: <filename>` (Content-Disposition attachment); (6) `302` with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (04 D6). Methods: **GET only; HEAD and every other method → 405** (ADR-0002 C17). Kind `skin` (S1.7, 04 D2–D5; ADR-0002 C8): same shape with two differences — the rate limit keeps scope `download` (30 / min per `ip_hash`) but is **counted in `rate_limit_hits`** for kind `skin` (04 D3 / §5.5; `project_downloads.ip_hash` for `project_file`) and the response is a 302 to the **public** object URL + `?download=<filename>` (04 D5; 01 INV-55), not a signed `project-files` URL; counter via RPC `record_skin_download` (`skins.downloads`). No revalidation. Analytics: client `trackEvent('download', {project, source:'direct', from})` fires on click, not here (ADR-0002 C12).

### 2.10 Cron `/api/cron/*`
Common (04 SC-11–SC-13, §2.4): GET; `Authorization: Bearer ${CRON_SECRET}` (`timingSafeEqual`) else **401 JSON** `{ok:false,error:{code:'unauthorized',message}}` (ADR-0002 C14) with no side effects; runtime nodejs; `maxDuration` 300 / 60 for `notify` (ADR-0002 C15); lock per SC-13 → 200 `{ok:true, skipped:'running'}`; job writes one `sync_runs` row (start/finish/ok/items/error) on every path after auth; returns the job's JSON summary (shape in 04); 500 when `ok=false`. `sync-youtube` accepts `?full=1`. Revalidation per §5. Idempotency keys per 04. `sync-modrinth` also feeds `sync.failed` events (S1.5) and `notify` derives `sync.stale`.

---

## 3. Middleware (`proxy.ts` at repo root — the Next 16 middleware file, named export `proxy`; ADR-0009)
**Matcher (literal):**
```
matcher: ['/((?!_next/static|_next/image|favicon\\.ico|fonts/|brand/|robots\\.txt|sitemap\\.xml|api/cron/|api/webhooks/|api/download/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2|txt|xml)$).*)']
```
Rules, in order (all use `@supabase/ssr` `createServerClient` with the request cookies; response cookies always propagated):
| # | Condition | Action |
|---|---|---|
| M1 | No Supabase auth cookie present (`sb-*-auth-token`) | Skip DB; if path ∈ {`/welcome`, `/profile`} → 307 `/`; else pass through (public pages stay cacheable, no session work) |
| M2 | Cookie present | `supabase.auth.getUser()` (refreshes tokens; sets cookies on response). Invalid/expired → treat as M1. |
| M3 | Authenticated AND path starts with `/auth/` | pass through |
| M3b | Request method is not GET/HEAD (a Server Action POST) | pass through with the refreshed cookies — the action re-checks auth and onboarding itself (04 SC-04); a 307 would make the browser re-POST the action body to the redirect target (ADR-0009 addendum 2026-08-21). M1's anon redirect is likewise GET/HEAD-only. |
| M4 | Authenticated → read `profiles.handle, is_banned` for `user.id` (one query; still never `role` — ADR-0019) | — |
| M4b | `is_banned` (ADR-0019) | path ∉ {`/banned`, `/auth/*` (already passed at M3), `/api/*`} → 307 `/banned`; else pass through. Evaluated before M5, and M5–M8 never run for a banned account — so a banned account with a null handle lands on `/banned` too (never `/welcome`, no loop); M3b still precedes it (an action POST passes through and the action answers `banned`, 04 SC-05). |
| M5 | `handle IS NULL` AND path ∉ {`/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*`} | 307 → `/welcome?next=<pathname+search>` (encoded; only if `next` passes RP-20) |
| M6 | `handle IS NOT NULL` AND path `=== '/welcome'` | 307 → validated `next` param or `/` |
| M7 | path starts with `/admin` | pass through — role check happens in `app/admin/layout.tsx` (INV-31); anon renders `AdminGate` there |
| M8 | else | pass through |
**RP-19** Middleware never reads `role` and never renders; its one `profiles` read is `handle, is_banned` (M4 — ADR-0019); it only refreshes the session and enforces the banned rule (M4b), the onboarding rule (M5/M6) and the anon redirects for `/welcome`, `/profile` (M1). Those redirects apply to page navigations only — GET/HEAD documents and RSC fetches; a non-GET request (a Server Action POST) passes through after the refresh (M3b, ADR-0009 addendum 2026-08-21). Role decisions live in `lib/auth.ts` (server, `app/admin/layout.tsx`) and in every action (04). `lib/auth.ts` exports `getViewer()` (built on `getUser()`), `requireRole()`, `safeNext()` among 04 SC-04's names; **`getSession()` does not exist and `auth.getSession()` is never called** (ADR-0002 A15) — the middleware refresh uses `auth.getUser()` (M2). The file is `proxy.ts` (ADR-0009).
**RP-20** `next` validation (shared helper `safeNext(next)` — pure function in the client-safe `lib/validation/next.ts`, re-exported by `lib/auth.ts` — ADR-0013; S0; 05 T-UNIT-44): must start with `/`, must not start with `//` or `/\`, must not start with `/api`, `/auth`, `/admin`; else `/`. Used by `proxy.ts` (ADR-0009), `/auth/callback`, `/welcome`, and `GoogleSignInButton` when building `redirectTo`.
**RP-21** Un-onboarded users can still call `/auth/sign-out` and view `/privacy`, `/how-comments-work` (M5 list agrees with 04 §2.1 and 01 INV-30 as amended by ADR-0002; encoded in 05 T-ACT-10). A banned account may load only `/banned`, `/auth/*` (sign-out) and `/api/*` — every other navigation is 307 `/banned` (M4b, ADR-0019; T-ACT-10).
Performance note: M1 keeps anonymous traffic free of DB calls; the M4 query is one indexed PK read per authenticated request. Replacing it with a JWT claim requires an ADR.

---

## 4. Auth flows
**Sign-in (client-side; ADR-0002 C3, 04 §2.0):** there is **no route handler**. Every `GoogleSignInButton` (nav "Sign in", `SignInPrompt`, `AdminGate`) is a client component that calls `supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: `${NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(safeNext(next))}` } })` via `lib/supabase/client.ts` (PKCE; verifier stored by `@supabase/ssr`) and lets the browser follow Supabase's `/auth/v1/authorize?provider=google` redirect to Google. `redirectTo` is built from `NEXT_PUBLIC_SITE_URL` (`lib/env/public.ts`, INV-37), never from `window.location`. Redirect URL allow-list is in `supabase/config.toml` (`[remotes.production.auth].additional_redirect_urls`: `https://odsens.com/**`, `https://www.odsens.com/**`, `https://odsens-git-*-studiobing.vercel.app/**`, `http://localhost:3000/**` — no `*.vercel.app` wildcard; the base `[auth]` block, which config.toml syncs to local + Supabase preview branches, additionally lists `https://odsens-git-*-studiobing.vercel.app/**`; `[remotes.production]` is applied to production by the Supabase GitHub integration on merge — ADR-0011); adding a URL = config change + a `Kind: security` ADR, not app change. The button fires `trackEvent('sign_in', {from})` on click (ADR-0002 C12).
**`/auth/callback` (GET, 04 §2.1; ADR-0002 C18):**
1. Read `code`, `next` (`safeNext`). No `code` → 307 `/`.
2. `supabase.auth.exchangeCodeForSession(code)`; on error → 307 `/` (**no query param**; logged via `lib/log.ts`; no UI surface in v1).
3. Read `profiles.handle` for the new session (one query). `null` → 307 `/welcome?next=<next>`; else → 307 `<next>` (default `/`; same-origin only via `safeNext`).
3a. (ADR-0002 A14) If `profiles.email_hash` is null, set it = `emailHash(user.email)` (`lib/hash.ts`, HMAC-SHA256 with `HASH_SECRET` — required from S1.1) via the **service client**, server-side only; the DB trigger never sets it. The email itself is never logged or returned (01 INV-32/46).
4. Response carries the session cookies set by the SSR client. `Cache-Control: no-store`.
**Sign-out (`/auth/sign-out`, POST):** form POST from `ProfileMenu` / onboarding shell; behaviour per 04 §2.2: verify `Origin` (fallback `Referer`) host equals the `NEXT_PUBLIC_SITE_URL` host else **403** (CSRF), then `supabase.auth.signOut()` → 303 `/`; GET → 405. CSP `form-action 'self'` (01 INV-77) is the second layer, not the only one.
**Admin gate (`app/admin/layout.tsx`; ADR-0002 C4):** `getUser()` null → render `AdminGate` (200, no shell, `noindex`, `<title>` `Admin — odsens`); user without handle → 307 `/welcome?next=/admin` (middleware already does this); role `user` → `notFound()` (root 404, no shell); `moderator|admin` → `AdminShell` with sidebar per RP-14. `/admin/settings/page.tsx` additionally `requireRole('admin')` → moderator gets `notFound()` (RP-04).

---

## 5. Revalidation matrix (who calls `revalidateTag`)
**RP-22** This table MUST equal the "Tags revalidated" column of 04 §1.0 for actions and 04 §3 for jobs; **04 wins on conflict**. Nothing calls `revalidatePath` in v1 (04 SC-07) — deviation → ADR.
| Trigger (job/action) | Tags | Also revalidates path? |
|---|---|---|
| `syncModrinth` (cron) | `projects`; `project:<slug>` for every upserted/hidden project | no |
| `syncCurseforge` (cron) | `projects`; `project:<slug>` for changed counts | no |
| `syncYoutube` (cron) | `videos` | no |
| `refreshMentions` (cron) | `mentions`; `project:<slug>` for mentions whose `view_count` changed (04 §3.4) | no |
| `snapshotStats`, `notifyFanOut/Deliver` (cron) | — | — |
| `curateProject`, `setProjectLink`, `publishProject`, `updateExclusiveProject`, `uploadProjectMedia`, `uploadProjectFile` | `projects`, `project:<slug>` | no |
| `createExclusiveProject` | — (draft; 04) | no |
| `postComment`, `editComment`, `deleteComment`, `moderateComment` | target tag = `project:<slug>` (v1 comment surface = projects only); `postComment` also `projects` only if `ProjectCard` shows a comment count (04 §1.2 note; not in v1 unless 03 adds it) | no |
| `toggleLike` | `project:<slug>` (`like_count` is in the cached `comments_public` HTML — ADR-0002) | no |
| `reportComment`, `banUser` | — (04) | no |
| `updateSettings` | `settings` **only** (04 §1.3, owner — no extra `projects` tag; `/projects/[slug]` and `/support` carry `settings`, so a `comments_closed_default` / `kofi_page` change already refreshes them; listing pages show no comments state) | no |
| `setUserRole`, `testDiscordWebhook` | — | no |
| `deleteAccount` | `project:<slug>` for every distinct comment target (04 §1.1; not the four site tags) | no |
| `createSkin`, `updateSkin` | `skins` | no |
| `createArt`, `updateArt` | `art` | no |
| `createMention`, `updateMention` | `mentions`; `project:<slug>` if attached to a project | no |
| `updateVideo` (04 §1.8) | `videos` | no |
| `completeOnboarding`, `updateProfile` | — (04); a renamed handle/avatar in cached `comments_public` HTML catches up at the next ISR interval (≤600 s) — accepted, no tag | — |
| `triggerSync` (admin action) | same as the underlying job | no |
| `/api/download/[fileId]` | none | no |
**RP-23** Home (`/`) carries `projects`,`videos`,`mentions` so it refreshes with any of them (no `settings` — the compact `TipPanel` is static, 00 S1.9.AC7). `/seen-on` carries `mentions`,`projects`. `/projects/[slug]` carries `projects`,`project:<slug>`,`mentions`,`settings`. `/support` carries `settings` (ADR-0002 C19; 01 INV-38).

---

## 6. Loading / error / not-found matrix
| Route | `loading.tsx` content | error boundary | not-found trigger |
|---|---|---|---|
| `/` | hero slab + 4 `ProjectCardSkeleton` | root | — |
| `/projects` | filter bar shell + 6 `ProjectCardSkeleton` | root | — |
| `/projects/[slug]` | `ProjectDetailSkeleton` (`CommentThreadSkeleton` only while `CommentThread` merges own rows client-side) | root | unknown/hidden/draft slug |
| `/videos` | player well + 4 facade shells | root | — |
| `/skins` | viewer slab + 4 bust shells | root | — |
| `/art` | 8 masonry shells | root | — |
| `/seen-on` | 3 tile shells + 6 card shells | root | — |
| `/support` | panel + slot shells (`app/(public)/support/loading.tsx`, S1.9; placeholder before that has none) | root | — |
| `/profile` | 720px column shells | root | — |
| `/welcome` | none (form renders immediately) | root | — |
| `/admin/*` | `app/admin/loading.tsx` (table shell) + per-route as listed in §1.3 | root (renders outside shell — acceptable) | unknown `[id]`; signed-in non-moderator on any `/admin/*` and moderator on `/admin/settings` (`notFound()`, RP-04) |
**RP-24** Skeletons obey DESIGN §11.1 (two flat depths, 1.6s opacity pulse, no shimmer, ≤ one screenful).

---

## 7. Smoke list (deploy-checker; 05 T-E2E-43/44 run the same list on previews — column "T-E2E" = 05 §7's SM→T-E2E mapping, copied verbatim — 05 owns T-* IDs)
`<base>` = deployment URL. Status is the final status after redirects unless "no-redirect". Titles are the rendered `<title>` text.
| # | Request | Expect | T-E2E |
|---|---|---|---|
| SM-01 | GET `/` | 200; title `odsens`; `<h1>` present; nav has Projects·Videos·Skins·Art·Seen on; **no** "Commissions"; gold Support link → `/support`; `FloatingSupportButton` present | T-E2E-1, 44 |
| SM-02 | GET `/projects` | 200; title `Projects — odsens`; ≥1 `ProjectCard` after first sync (0 → empty state text "NOTHING MATCHES") | T-E2E-2, 44 |
| SM-03 | GET `/projects/<first slug from sitemap>` | 200; title `<title> — odsens`; contains "VERSIONS & FILES" and "COMMENTS" | T-E2E-3, 44 |
| SM-04 | GET `/projects/does-not-exist-404` | 404; body contains "THAT PAGE DOESN'T EXIST" | T-E2E-14 |
| SM-05 | GET `/videos` | 200; title `Videos — odsens`; no `<iframe>` in initial HTML (facades) | T-E2E-6, 44, 46 |
| SM-06 | GET `/skins` | 200; title `Skins — odsens` | T-E2E-7, 44 |
| SM-07 | GET `/art` | 200; title `Art — odsens` | T-E2E-9, 44 |
| SM-08 | GET `/seen-on` | 200; title `Seen on — odsens` | T-E2E-10, 44 |
| SM-09 | GET `/support` | 200; title `Support — odsens`; no Ko-fi `<iframe>` in initial HTML | T-E2E-11, 44 |
| SM-10 | GET `/privacy` | 200; title `Privacy — odsens` | T-E2E-12, 44 |
| SM-11 | GET `/how-comments-work` | 200; title `How comments work — odsens` | T-E2E-13, 44 |
| SM-12 | GET `/welcome` (anon, no-redirect) | 307 → `/` | T-E2E-46 |
| SM-13 | GET `/profile` (anon, no-redirect) | 307 → `/` | T-E2E-46 |
| SM-14 | GET `/admin` (anon) | 200; title `Admin — odsens`; body contains "ADMINS ONLY"; no sidebar; `X-Robots-Tag: noindex, nofollow` | T-E2E-33 |
| SM-15 | GET `/admin/comments` (anon; **from S1.4**) and `/admin/settings` (anon; **from S1.5**) | 200; "ADMINS ONLY" (gate), title `Admin — odsens`, `X-Robots-Tag`. Before those slices the routes do not exist → **404** (`/admin/settings` has no S1.1 stub — ADR-0002 C2; 05 T-E2E-33). (Signed-in role `user` on any `/admin/*` → **404** root page; moderator on `/admin/settings` → 404 — Playwright only, T-E2E-33) | T-E2E-33 |
| SM-16 | GET `/api/cron/sync-modrinth` (no header) | 401; `content-type: application/json`; body `{ok:false,error:{code:'unauthorized',…}}` (ADR-0002 C14) | T-E2E-43 |
| SM-17 | GET `/api/cron/sync-modrinth` with `Authorization: Bearer $CRON_SECRET` | 200 JSON with `ok:true` and `run_id` (or `skipped:'running'`) (preview only if safe; deploy-checker may skip on prod) | T-E2E-43 |
| SM-18 | GET each other `/api/cron/*` (no header) | 401 | T-E2E-43 |
| SM-19 | POST `/api/cron/notify` (with header) | 405 | T-E2E-46 |
| SM-20 | GET `/api/download/00000000-0000-0000-0000-000000000000` | 404 | T-E2E-46 |
| SM-21 | GET `/api/download/not-a-uuid` | 404 | T-E2E-46 |
| SM-21b | HEAD `/api/download/00000000-0000-0000-0000-000000000000` | 405 (ADR-0002 C17) | T-E2E-46 |
| SM-22 | GET `/auth/sign-out` | 405 (there is no `/auth/sign-in` route → 404) | T-E2E-46 |
| SM-23 | GET `/auth/callback` (no code, no-redirect) | 307 → `/` | T-E2E-46 |
| SM-24 | GET `/robots.txt` | 200; contains `Disallow: /admin` | T-E2E-45a |
| SM-25 | GET `/sitemap.xml` (**from S1.2**) | 200; contains `<loc>…/projects</loc>` | T-E2E-45b |
| SM-26 | Click "Sign in" on `/` (Playwright) | client `signInWithOAuth` → request to `<supabase>/auth/v1/authorize?provider=google` observed → navigation begins to `accounts.google.com` (do not complete) | T-E2E-16, 44 |
| SM-27 | GET `/` headers | all 01 INV-76 headers present: `Content-Security-Policy` (includes `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security` | T-E2E-20 |
| SM-28 | GET `/admin`, `/welcome`, `/profile` (no-redirect) and `/api/cron/notify` (no header) headers | `X-Robots-Tag: noindex, nofollow` (INV-76) | T-E2E-20 |
| SM-29 | `next build` route table (CI) | `/`, `/projects`, `/projects/[slug]`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support`, `/privacy`, `/how-comments-work` are ISR (`revalidate` 600) once their slice ships (C20 placeholders are static `○` before that — RP-16); `/welcome`, `/banned` (ADR-0019), `/profile`, `/admin/*`, `/api/*` are dynamic | T-E2E-8, CI-4 |
| SM-30 | client bundle grep (`.next/static`) | the 01 INV-29 list (owner; superset of 05 CI-4: `SERVICE_ROLE`, `sb_secret`, `CURSEFORGE_API_KEY`, `YOUTUBE_API_KEY`, `RESEND_API_KEY`, `DISCORD_WEBHOOK`, `KOFI_`, `CRON_SECRET`, `GOOGLE_OAUTH`, `HASH_SECRET`, plus `[^_]SENTRY_DSN` from S1.10) → empty (01 INV-29 as amended by ADR-0002 C13; `scripts/check-bundle-secrets.mjs`; the supabase-js key-format literal `sb_secret_"` is the one ignored match — ADR-0007) | T-E2E-44, CI-4 |
| SM-31 | GET `/support`, `/welcome` (signed in), `/admin` (mod) | no `FloatingSupportButton` (RP-15); on `/` it is an `<a href="/support">` that hides on scroll-down (`data-state="hidden"`) and returns on scroll-up (`visible`) — 03 `FloatingSupportButton`, 00 S1.9.AC6; `TipPanel` present on one detail page and on `/` (always rendered, links to `/support`), from S1.9 | T-E2E-49 (05 row to be rewritten to this behaviour — see Review notes) |
| SM-32 | GET `/dev/components` on any Vercel deployment | 404 (ADR-0002 #44) | T-E2E-43, 44 (05 §7; T-E2E-48 is the local `/dev/components` render check) |
Per-slice applicability: SM-01, 04, 10–14, 16, 20–30, 32 from S1.1 (SM-02/03 from S1.2; SM-21b from S1.3; SM-15 `/admin/comments` from S1.4 and `/admin/settings` from S1.5 — 404 expected before; SM-31 from S1.9); SM-05–09 return 200 from S0 as placeholders (RP-16) and gain their content checks in S1.6/S1.7/S1.8/S1.9; SM-17/18 as each cron ships. The preview DB is not seeded before S1.10 — SM assertions on seeded content (SM-02/03 card/title checks) are local-only until then.

---

## 8. Slice → routes checklist (for `00-build-plan.md` acceptance)
| Slice | Routes that must exist and pass smoke |
|---|---|
| S0 | `/` (shell, hero placeholder), placeholder pages `/projects`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support` (RP-16), `/auth/callback`, `/auth/sign-out` (shells wired to Supabase SSR — 00 S0), `/dev/components` (dev-only), `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/(public)/loading.tsx`, `/robots.txt`; nav per RP-12 with Commissions off (`FLAGS.commissions=false`); empty `vercel.json` crons |
| S1.1 | `/welcome`, `/profile`, `/auth/*` wired, `/privacy`, `/how-comments-work`, `/admin` (gate + shell; **no** `/admin/settings` — ADR-0002 C2), middleware §3 |
| S1.2 | `/projects`, `/projects/[slug]`, `/` hero + featured, `/admin/projects`, `/admin/projects/[id]` (curate), `/api/cron/sync-modrinth`, `/api/cron/sync-curseforge`, `/sitemap.xml` |
| S1.3 | `/admin/projects/new`, `/admin/projects/[id]` (exclusive edit + `uploadProjectMedia`/`project-media` bucket — ADR-0002 C10), `/api/download/[fileId]` (kind `project_file`) |
| S1.4 | `/projects/[slug]` comments (`CommentThread` client seam + `comments_public`), `/admin/comments` |
| S1.5 | `/admin/settings` (moderation mode, matrix, webhook + Test, admin emails, moderators — full route), `/api/cron/notify` |
| S1.6 | `/videos`, `/` latest videos, `/admin` videos hide/unhide list, `/api/cron/sync-youtube` |
| S1.7 | `/skins`, `/art`, `/admin/skins`, `/admin/art`, `/api/download/[fileId]` kind `skin` |
| S1.8 | `/seen-on`, `/admin/mentions`, SEEN ON row, IN THE WILD strip, `/api/cron/refresh-mentions`, footer line 2 |
| S1.9 | `/support` (reads `site_settings_public.kofi_page`), `/admin/stats`, `/api/cron/stats-snapshot`, `FloatingSupportButton`, `TipPanel` |
| S1.10 | Sentry on `error.tsx`, Analytics + Speed Insights components in `app/(public)/layout.tsx` (no `/api/og` — ADR-0002 #22) |

---

## 9. Open items (settled by ADR-0002 unless marked OPEN)
| ID | Question | Resolution | Status |
|---|---|---|---|
| O-1 | Session-aware UI on ISR pages | Client seam: `ViewerProvider` + `CommentThread` read own rows via `lib/supabase/client.ts` under RLS; no PPR / `experimental.*` (RP-01) | DECIDED (ADR-0002 C1) |
| O-2 | `/welcome` minimal layout (route group) vs. full nav | `app/(onboarding)/` with wordmark + Sign out only; `app/(public)/` adopted for public routes | DECIDED (ADR-0002 C5) |
| O-3 | Admin sidebar order for Mentions/Stats | Comments · Projects · Skins · Art · Mentions · Stats · Settings | DECIDED (ADR-0002 #36) |
| O-4 | Anonymous user hits an `onboarded` route | Silent 307 `/` (no `?signin` handling in v1) | DECIDED (ADR-0002 #37) |
| O-5 | Draft/hidden project preview URL for admins | None in v1; admin edits at `/admin/projects/[id]` | DECIDED (ADR-0002 #38) |
| O-6 | Delete account semantics | `deleteAccount` (`lib/actions/accounts.ts`): comments → `deleted`, likes/reports removed, avatar removed, `auth.admin.deleteUser` | DECIDED (ADR-0002 #28) |
| O-7 | Seen-on surfaces when empty/filtered | Zero mentions → title only; filter yields none → `EmptyState` "NOTHING HERE / Try another filter." | DECIDED (ADR-0002 #62) |
| O-8 | Placeholder-page copy before a slice ships | Title + "Not yet. Soon." (DESIGN.md §12.7) for all six nav targets incl. `/support` | DECIDED (ADR-0002 C20) |
| O-9 | OAuth callback error surface | 307 `/` with no query param; no UI surface in v1 | DECIDED (ADR-0002 C18) |
| O-10 | Stale author handle/avatar in cached comment HTML | Accepted ≤600 s ISR staleness; `updateProfile` revalidates nothing (04) | CLOSED |
| O-11 | `/projects` sort default + option set | `downloads` default; `downloads|updated|newest|title` | DECIDED (ADR-0002 #39) |
| O-12 | Role for curation/mention/sync actions | **admin**; moderators see disabled controls; `moderator` only for comment moderation | DECIDED (ADR-0002 C7 — confirmed by David 2026-08-17) |
| O-13 | `/admin/settings` slice | Whole route in S1.5 (incl. `setUserRole`, moderators table); no S1.1 stub; roles bootstrapped by SQL until then | DECIDED (ADR-0002 C2) |
| O-14 | Admin `Table empty=` copy (§1.3) | Strings as listed; `write-copy` may polish before S1.10 | DECIDED (ADR-0002 #40) |
| O-15 | Hero "NEW" badge threshold | `published_at` < 30 days | DECIDED (ADR-0002 #41) |
| O-16 | `/projects` count-line copy | "<N> things. Some useful, some not." | DECIDED (ADR-0002 #39) |
| O-17 | `/projects` `q`: client substring vs tsvector | Client substring in v1 (00 v0.2 agrees) | CLOSED |
| O-18 | Synced file Download cell target | Modrinth CDN file URL (`project_files.url`); GET IT rail keeps the Modrinth project link | DECIDED (ADR-0002 #42) |
| O-19 | Ko-fi page source | `site_settings.kofi_page` via view `site_settings_public`; `/support` carries tag `settings`; env `KOFI_PAGE` seeds only; CONTINUE mounts the iframe in place | DECIDED (ADR-0002 C19) |
| O-20 | `comments_closed_default` toggle surface on `/admin/settings` | Build with the 03 V-03 label; DESIGN.md §12.7 line | DECIDED (ADR-0002 #43) |
| O-21 | Middleware exceptions `/privacy`, `/how-comments-work` + anon redirects for `/welcome`, `/profile` vs 01 INV-30 | Keep as §3 M1/M5; 01 INV-30 amended in the ADR-0002 PR; encoded in 05 T-ACT-10 | DECIDED (ADR-0002) |

No item in this doc remains OPEN. Product-level flags for David live in ADR-0002 (C7 roles, About page removal, `users` aggregate metric).

---

## Review notes (v0.3)
- **v0.4 (2026-08-17, ADR-0002 Amendment A):** §2.3 moderator view of held/reported rows in the public thread = mods-only client RPC `moderator_thread` (A2); `site_settings_public` exposes `moderation_mode` (A3); `/projects` client component `ProjectGrid` owns filter/search/sort (A7); `robots.txt` S0 T-E2E-45a / `sitemap.xml` S1.2 T-E2E-45b (A9); `/admin/projects` list carries feature/hide/reorder + `ReorderableList`, batch `curateProject.reorder`, per-project extras on `[id]` (A11); `/auth/callback` step 3a sets `profiles.email_hash` (A14); RP-19 no `getSession()`, `getViewer()` (A15); RP-11 auth handlers under `app/auth/**` not `(public)` (A17).
- v0.3 applies `docs/build/06-decisions/ADR-0002-spec-reconciliation.md`: rendering model = client seam (C1; `NavSession`/`CommentThreadSection` removed), `app/(public)/` group and thin root layout (C5), no `/auth/sign-in` route (C3), callback reads `profiles.handle` and never sets a query param (C18), wrong role on `/admin/*` → `notFound()` (C4), `/admin/settings` whole in S1.5 (C2), curation/mention/sync/upload actions admin-only (C7), download route GET-only + JSON 429 + `HASH_SECRET` HMAC (C13/C14/C17) + kind `skin` (C8), cron `maxDuration` 300/60 (C15), Ko-fi page from `site_settings_public.kofi_page` with `/support` under tag `settings` and in-place iframe (C19), placeholder pages "Not yet. Soon." (C20), `toggleLike` revalidates `project:<slug>`, `SearchField` → `SearchBox`, `/api/og` dropped (#22).
- Every former O-* row is DECIDED/CLOSED (§9).
- Registry additions folded into _registry.md (ADR-0002)
- **RP numbering (v0.3):** RP-16 (C20 placeholder pages) was inserted in v0.3, shifting the former RP-16…RP-23 → RP-17…RP-24 (crons = RP-17, `vercel.json` = RP-18, middleware = RP-19, `safeNext` = RP-20, un-onboarded users = RP-21, revalidation/`revalidatePath` = RP-22, page tags = RP-23, skeletons = RP-24). Siblings now cite the new numbers (01 INV-18 → RP-22, INV-30 → RP-19; 04 SC-04 → RP-20, RP-21/RP-22/RP-17); the IDs in this doc are frozen.
- Rule IDs `RP-01…RP-24` and smoke IDs `SM-01…SM-32` are stable and citable by gate agents; 05 owns T-* numbers.
- **Consistency pass (2026-08-17, critic + dry-run applied):** `updateSettings` → `settings` only (04 §1.3, owner); SM-15 split per route (`/admin/comments` from S1.4, `/admin/settings` from S1.5, 404 before — ADR-0002 C2, 05 T-E2E-33); Home compact `TipPanel` static/always rendered, `/` no longer carries `settings` or reads `site_settings_public` (00 S1.9.AC7/AC11, 00-O-19, 03 `TipPanel`); `ViewerProvider` reads the own `profiles` row (03 C-17a); skin download keeps rate-limit scope `download` counted in `rate_limit_hits` (04 D3/§5.5); C20 placeholders are static (01 INV-38); SM-30 cites 01 INV-29 as list owner; SM-21b/SM-32 T-E2E columns match 05 §7.
- **Sibling corrections still outstanding (this doc follows registry/ADR-0002; not edited here):** (a) 01 INV-40 still says settings actions revalidate `settings` "(+ `projects` if `comments_closed_default` changed)" — 04 §1.3 (owner) and §5 here say `settings` only; drop the clause. (b) 01 INV-09/INV-45 still describe `ViewerProvider` reading own `public_profiles` + `profiles.is_banned`; 03 C-17a (owner) = one own-`profiles`-row read — align INV-09/INV-45. (c) 01 INV-59 mounts `@vercel/analytics`/`@vercel/speed-insights` in `app/layout.tsx`; ADR-0002 C5 + registry keep the root layout to html/body/fonts/tokens only, so this doc (RP-09, §8 S1.10) mounts both in `app/(public)/layout.tsx` — admin/onboarding routes get no analytics (accepted); amend INV-59 statement + grep. (d) 01 INV-74's statement/grep names a `commissionsEnabled` prop; 03 N-09 (owner) has `Nav`/`Footer` read `FLAGS.commissions` directly (RP-12/RP-13) — reword INV-74 to `grep -n "FLAGS.commissions" components/layout/Nav.tsx components/layout/Footer.tsx`. (e) 05 T-E2E-49 describes a `sessionStorage` dismiss control, click → `TipPanel` + `AmountPicker`, `from:'fsb'`, compact bar 600–899; 03 `FloatingSupportButton` + 00 S1.9.AC6/AC11 + SM-31 = `<a href="/support">`, scroll-direction hide/show, `from:'floating'`, `data-compact` ≤599 — rewrite T-E2E-49; SM-31 keeps the mapping. (f) 03 `KofiPanelSlot` still shows `[&amount]` in the iframe URL; 04 §5.7 (owner) does not pass the amount in v1 — this doc follows 04. (g) `_registry.md` Component registry Comments row still lists `CommentThread` (server shell) + `CommentList` — ADR-0002 C1 / 03 O-22 / 04 §11.2 dropped `CommentList`; `CommentThread` is one client file (RP-01); fix the registry row (and 05 §1.4 client-island list if it names `CommentList`). — **RESOLVED (v0.4, ADR-0002 Amendment A applied; historical note only).**
