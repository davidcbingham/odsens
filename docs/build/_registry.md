# Build Registry — shared backbone for the engineering specs (00–06)

Purpose: one place for **IDs and names** so every spec doc, PR, ADR, and gate uses the same words. Authors of 00–05
MUST use these IDs verbatim. If something is missing here, add it here first (PR touching `_registry.md`), then use it.

## ID conventions
| Kind | Format | Example |
|---|---|---|
| Slice | `S<phase>.<n>` (v1 = phase 1 written as `S1.x`; scaffold `S0`) | `S1.4` |
| Requirement (from `docs/spec.md`) | `R-<area>-<n>` | `R-COMMENTS-3` |
| Architecture invariant | `INV-<n>` | `INV-07` |
| Route | path literal, backticked | `/projects/[slug]` |
| Component | DESIGN.md name in PascalCase | `TypeBadge`, `MentionCard` |
| Server action / handler | `verbNoun` in `lib/actions/<area>.ts` or `app/api/...` | `postComment`, `/api/cron/sync-modrinth` |
| Table | as in `docs/data-model.md` | `project_overrides` |
| Event kind | as in `docs/notifications.md` | `comment.held` |
| Test | `T-<layer>-<n>` (layers: RLS, ACT, ADP, E2E, UNIT) | `T-RLS-12` |
| ADR | `ADR-<nnnn>-<slug>.md` | `ADR-0003-shorts-detection.md` |

## Slices (v1 = Phase 1) — order is dependency order
| ID | Name | One-line scope | Depends on |
|---|---|---|---|
| **S0** | Scaffold | Next.js App Router + TS + pnpm; `styles/tokens.css` from DESIGN.md §1; self-hosted fonts; base layout (nav/footer per DESIGN.md §5 + §12.2 nav order, Commissions hidden); `not-found`/`error`/`loading` shells; `lib/env.ts` (zod); Supabase clients (`lib/supabase/{server,client,admin}.ts`); local Supabase + first migration (helpers only); CI (lint/typecheck/test/build); Playwright + axe harness; `ship` + `keep-docs` skills; vercel.json (empty cron list); preview deploy green | — |
| **S1.1** | Accounts | `profiles` + roles + `site_settings` (+ trigger on auth.users); Google sign-in; middleware forcing onboarding; `/welcome` handle onboarding (structural validation, reserved handles, availability RPC, avatar upload+crop); profile menu; `/profile`; `/privacy`, `/how-comments-work`; admin gate `/admin` (role check) | S0 |
| **S1.2** | Projects (synced) | `projects/project_versions/project_files/project_links/project_overrides`; Modrinth adapter + `/api/cron/sync-modrinth`; CurseForge counts adapter + cron; `/projects` grid + filter bar + search; `/projects/[slug]` detail (icon, gallery+lightbox, ABOUT markdown, VERSIONS & FILES with changelog expander, GET IT rail with combined count, DETAILS); Home featured hero + Featured 4-up; admin `/admin/projects` curate (feature/hide/reorder/extra gallery/notes, CF id entry); `sync_runs`; ISR + tags | S0 |
| **S1.3** | Exclusive projects | admin create/edit exclusive project (Modrinth-shaped form, draft→published), `project-media` + `project-files` buckets, upload well, `/api/download/[fileId]` (signed URL + counters + log), `project_downloads`, exclusive badge, direct download button | S1.2 |
| **S1.4** | Comments | `comments/comment_likes/comment_reports`; actions `postComment/editComment/deleteComment/toggleLike/reportComment/moderateComment/banUser`; moderation mode logic + auto-hold ≥3 reports + 15-min edit window + limits (1000 chars, 1 link) + SQL rate limit; `CommentThread` UI with all DESIGN.md states; sign-in prompt; admin `/admin/comments` queue; `notification_events` written (`comment.new/held/reported/reply/approved`) — no delivery yet | S1.1, S1.2 |
| **S1.5** | Notifications | `notification_recipients`, `notification_matrix`; `/admin/settings` (moderation mode, matrix, Discord webhook + Test, admin emails); `/api/cron/notify` fan-out + deliver (`deliver/discord.ts`, `deliver/email.ts` via Resend + React Email allay templates: CommentNew, CommentHeld, CommentReported, SyncFailed + text versions); `sync.failed/stale` events from S1.2 jobs | S1.4 |
| **S1.6** | Videos | `videos`; YouTube adapter (RSS + Data API) + `/api/cron/sync-youtube`; `/videos` (facade player, Up next, Shorts row); Home Latest videos 2-up | S0 |
| **S1.7** | Skins + Art | `skins`, `art`; buckets `skins`, `art`; admin `/admin/skins`, `/admin/art` (add/edit, upload); skinview3d viewer (client, lazy) + cached bust render job; `/skins`; `/art` (masonry natural aspect, filter row, lightbox) | S1.1 |
| **S1.8** | Seen on | `mentions`; admin `/admin/mentions` (paste URL → metadata fetch via YouTube oEmbed/Data API + OG fallback → assign → publish; table feature/hide/reorder; Suggested tab UI stub); SEEN ON row on project detail; Home IN THE WILD strip + reach line; `/seen-on` page (stat tiles, filters, grid); `/api/cron/refresh-mentions` view counts; footer line | S1.2, S1.6 |
| **S1.9** | Stats + Support | `stats_daily` + `/api/cron/stats-snapshot`; admin `/admin/stats` (tiles + flat SVG bar chart); `/support` (amount picker wrapper → Ko-fi panel slot, "what it pays for", leaderboard block in **empty state**, floating support button site-wide); custom events (Vercel Analytics) | S1.2, S1.4 |
| **S1.10** | Launch | Supabase Branching + Vercel integration verified; DNS cutover (odsens.com → Vercel; Resend DMARC/inbound); Deployment Protection off for prod; Sentry; Web Analytics + Speed Insights; `deploy-checker` pass; seed real content (Oliver's skins/art); Oliver's laptop setup; `start-here` + remaining Oliver skills written; `CLAUDE.md` build-time version; tag `v1.0.0` | all S1.x |

Phase 2 (outline only; detailed when approached): **S2.1** Ko-fi webhook + `kofi_events`/`supporters` + leaderboard live · **S2.2** Custom Orders intake (`orders`, `/commissions`, confirmation, "Your orders", nav item shown) · **S2.3** Workrooms (`workrooms/*`, `/workrooms/[id]`, admin Orders & Workrooms, client email opt-in via `notification_prefs`) · **S2.4** Suggested mentions (YouTube search cron) · **S2.5** in-app notifications (bell/inbox).

## Route registry (v1)
Public: `/` · `/projects` · `/projects/[slug]` · `/videos` · `/skins` · `/art` · `/seen-on` · `/support` · `/privacy` · `/how-comments-work` · `/welcome` (auth, onboarding) · `/profile` (auth) · `/auth/callback` (Supabase OAuth code exchange) · `/auth/sign-out` (POST)
Admin (role ≥ moderator unless noted): `/admin` (gate/dashboard) · `/admin/projects` · `/admin/projects/new` · `/admin/projects/[id]` · `/admin/comments` · `/admin/skins` · `/admin/art` · `/admin/mentions` · `/admin/stats` · `/admin/settings` (admin only)
API: `/api/download/[fileId]` · `/api/cron/sync-modrinth` · `/api/cron/sync-curseforge` · `/api/cron/sync-youtube` · `/api/cron/refresh-mentions` · `/api/cron/stats-snapshot` · `/api/cron/notify` · `/api/webhooks/kofi` (S2.1) · `/api/og` (optional OG image)
Rendering: public content pages = ISR (`revalidate` 600 + tags `projects`, `project:<slug>`, `videos`, `skins`, `art`, `mentions`, `settings`); anything reading a session = dynamic; admin + API = dynamic.

## Component registry (v1) — DESIGN.md name → PascalCase
Layout: `Nav`, `Footer`, `FloatingSupportButton`, `Toast`, `Skeleton*` (`ProjectCardSkeleton`, `ProjectDetailSkeleton`, `CommentThreadSkeleton`)
Primitives: `Button` (primary|secondary|ghost|gold), `TypeBadge`, `ExclusiveBadge`, `PrivateBadge`(P2), `Chip` (version/loader), `Toggle` (square ON/OFF), `Field` (admin input), `Select`, `Table` (admin), `StatusPill`, `StatTile`, `FlatBarChart`, `Markdown`, `PixelLabel` (Silkscreen eyebrow)
Projects: `ProjectCard`, `FilterBar`, `ActiveFilterChips`, `Gallery` + `Lightbox`, `VersionsTable` (+ `ChangelogExpander`), `GetItPanel`, `DetailsList`, `TipPanel`, `FeaturedHero`
Comments: `CommentThread`, `Comment`, `Reply`, `Composer`, `LikeButton`, `ModActionRow`, `HeldNotice`, `SignInPrompt`, `ReportPicker`
Accounts: `HandleField`, `AvatarUpload` (+ crop), `ProfileMenu`, `OnboardingPanel`
Videos: `VideoFacade`, `UpNextList`, `ShortsRow`
Skins/Art: `SkinViewer3D`, `SkinCard`, `ArtMasonry`, `ArtCard`
Seen on: `MentionCard`, `ReachLine`, `SeenOnRow`, `InTheWildStrip`, `MentionPreview` (admin)
Support: `AmountPicker`, `KofiPanelSlot`, `Leaderboard` (+ `LeaderboardRow`)
Admin: `AdminShell` (sidebar), `UploadWell` (+ client variant P2), `NotificationMatrix`, `AdminGate`, `SyncStatus`
Email (`emails/`): `EmailLayout`, `EmailButton`, `EmailBadge`, templates `CommentNew`, `CommentHeld`, `CommentReported`, `SyncFailed`

## Server contract registry (v1) — names only; shapes in 04
Actions (`lib/actions/*.ts`): `completeOnboarding`, `updateProfile`, `checkHandle` (RPC), `postComment`, `editComment`, `deleteComment`, `toggleLike`, `reportComment`, `moderateComment`, `banUser`, `updateSettings`, `testDiscordWebhook`, `createExclusiveProject`, `updateExclusiveProject`, `publishProject`, `uploadProjectMedia`, `uploadProjectFile`, `curateProject` (override upsert), `setProjectLink`, `createSkin`, `updateSkin`, `createArt`, `updateArt`, `createMention`, `fetchMentionPreview`, `updateMention`, `triggerSync`
Route handlers: the API list above.
Jobs (`lib/jobs/*.ts`): `syncModrinth`, `syncCurseforge`, `syncYoutube`, `refreshMentions`, `snapshotStats`, `notifyFanOut`, `notifyDeliver`, `renderSkinBust`
Adapters (`lib/adapters/*.ts`): `modrinth`, `curseforge`, `youtube`, `oembed`, `resend`, `discord`

## Table registry (v1) — from `docs/data-model.md`
`profiles` (+ view `public_profiles`), `site_settings`, `projects` (+ view `projects_public`), `project_versions`, `project_files`, `project_links`, `project_overrides`, `project_downloads`, `videos`, `skins`, `art`, `comments`, `comment_likes`, `comment_reports`, `notification_events`, `notification_recipients`, `notification_matrix`, `mentions`, `stats_daily`, `sync_runs`. Buckets: `avatars`, `project-files` (private), `project-media`, `skins`, `art`.
Phase 2: `orders`, `workrooms`, `workroom_members`, `workroom_posts`, `workroom_files`, `kofi_events`, `supporters`, `notification_prefs`; bucket `workroom-files` (private).

## Repo layout (from `docs/framework-decision.md`, refined)
```
app/                     routes (public), app/admin/*, app/api/*
components/<area>/       one folder per registry group above; each component = Name.tsx + Name.module.css
lib/actions/ lib/jobs/ lib/adapters/ lib/supabase/ lib/notify/deliver/ lib/env.ts lib/markdown.ts lib/auth.ts
emails/                  React Email templates + preview
styles/tokens.css styles/globals.css   public/fonts/ public/brand/
supabase/migrations/ supabase/seed.sql supabase/config.toml
tests/unit tests/db tests/e2e tests/fixtures tests/helpers
scripts/contrast.mjs scripts/render-skins.mjs
docs/build/  docs/  design/  assets/brand/  DESIGN.md  CLAUDE.md
```
