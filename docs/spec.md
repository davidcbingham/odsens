# odsens.com — Project Specification (DRAFT)

> Status: **FROZEN v1.0 (2026-08-17) — building.** Product spec (this file), design system (`DESIGN.md` v1.3a), data model, notifications, and the engineering specs (`docs/build/00–05`, `_registry.md`, ADR-0001/0002) are the contract. Changes go through an ADR in `docs/build/06-decisions/` + a doc edit in the same PR; the `spec-drift-reviewer` gate enforces it. Build starts at slice **S0**.

---

## 1. Purpose

A personal portfolio and project-showcase site for **Oliver ("OddSense")**, age 15, a Minecraft creator who makes
mods, datapacks, resource/texture packs, plugins, skins, and other game extensions. The site is the canonical home
for his work: a place to browse what he's made, link out to download it, discuss it, and (later) support it financially.

David (dad) is bootstrapping the project; **Oliver will take over** content direction and ongoing updates soon.
Design and tooling decisions should favor Oliver being able to add/edit content himself without a developer.

The site is an **outlet for creative expression** first; learning web development is a bonus, not the point.
Oliver already builds his mods with **Claude Code inside VS Code**, so that is the expected primary editing surface.

## 2. Identity

| Item | Value |
|---|---|
| Domain | **odsens.com** (purchased via Squarespace; DNS to be pointed at Vercel) |
| Handle | **OddSense** (Modrinth, CurseForge, Scratch, Roblox display name), **@OdSens** (YouTube), Minecraft IGN `oddsense` (UUID `36a329d1-4a13-41dc-a3d4-1ea956c2956d`) |
| Naming model | **OddSense** = Oliver the person (his username on the site) and his Minecraft character. **odsens** = the website/brand. Keep these distinct in copy and UI. |
| Avatar | Pixel-art Minecraft character: **purple** hoodie/armor, **gold crown**, **glowing green eyes**, black face, white outline. Oliver has lots of original art across his mods and can supply more. |
| Disambiguation | **NOT** related to *oddsensenyc.com* (a NYC creative studio, 2018–2024, now closed). Zero overlap, no references, no shared branding. |

## 3. Existing presence (sources of truth for content)

| Platform | URL | Notes |
|---|---|---|
| YouTube | https://www.youtube.com/@OdSens | Channel ID `UCo3X_c7MqfC_ub-sMJZmmOA`. 666 subscribers, 21 videos. Keyless RSS + Data API available. |
| Modrinth | https://modrinth.com/user/OddSense/mods | **18 projects**, ~8.9k total downloads. Public JSON API (`api.modrinth.com/v2/user/OddSense/projects`) — no auth needed. Joined Dec 2024. |
| CurseForge | https://www.curseforge.com/members/oddsense/projects | Small subset, all also on Modrinth. Pull via API key to **sum downloads** with Modrinth. |
| Scratch | https://scratch.mit.edu/users/OddSense/ | **Excluded from the site** per Oliver (2026-08-16). |

See **`docs/platform-audit.md`** for the full pull/embed/key audit of every platform.

### Modrinth snapshot (Aug 2026)

| Project | Type | Loader | Downloads |
|---|---|---|---|
| Metal Pipe Mace | resource pack | – | 2,531 |
| Pixel Chameleon | mod | fabric | 1,568 |
| Essential Dark Pack Fix | resource pack | – | 1,201 |
| Heavy Spear (pack) | resource pack | – | 752 |
| Golden Hotbar Selector | resource pack | – | 699 |
| Heavy Spear (datapack) | datapack | – | 514 |
| Troll Resources | resource pack | – | 343 |
| Duck Crosshair | resource pack | – | 310 |
| Disabilities | mod | fabric | 274 |
| Visible Powder Snow | resource pack | – | 236 |
| Revamped Glow Lichen | resource pack | – | 98 |
| Mob Swap | datapack | – | 79 |
| Infested World | mod | fabric | 60 |
| I'm Not Your Edition | resource pack | – | 59 |
| Somewhat Warm | mod | fabric | 52 |
| Shizophrenia | datapack | – | 51 |
| Legacy Manhunts Reworked | plugin | paper (1.12.2 / Eaglercraft) | 38 |
| Ruined Speedrunning | datapack | – | 18 |

Takeaway: content is a mix of **mods, datapacks, resource packs, and plugins** — the site's taxonomy should reflect
that rather than calling everything a "mod."

## 4. Goals

1. **Curate, don't duplicate** — Content that lives on a native host (Modrinth, YouTube, CurseForge) is pulled into odsens.com via APIs and presented in one consistent, clean format. (Decided 2026-08-16.)
1b. **Exclusive content** — The site will also carry **projects available nowhere else**. For these, Oliver needs to author name, description, gallery media, and **upload the file itself** (hosted on odsens.com via Supabase Storage). Native and exclusive projects share one schema, **modeled on Modrinth's project parameters**, across four categories: **mod, datapack, resource pack, plugin**. (Decided 2026-08-16.)
2. **Showcase** — Browse all projects with art, description, type, MC version/loader, and download counts.
3. **Downloads** — Modrinth-hosted projects link out to Modrinth (and CurseForge where cross-posted); exclusive projects download directly from odsens.com. Display **combined download totals** (Modrinth + CurseForge) per project.
4. **Discussion** — Visitors can comment on projects, **only when signed in with Google** (spam/bot/abuse prevention).
5. **Support (Phase 2) — Ko-fi.** Tipping must be **maximum usability, minimum clicks** — embedded Ko-fi panel on the site (no bounce to Ko-fi where avoidable) + floating button. Later: Ko-fi webhook → Supabase for a supporters wall / goal bar / **donor leaderboard tied to site accounts** (idea queue). Account under David/StudioBing (Ko-fi requires 18+). Details in `platform-audit.md`. (Decided 2026-08-16.)
5b. **Custom Orders (Phase 2)** — visitors can describe a mod/skin/etc. they want and **hire Oliver** to make it. Intake form designed (pass 2); payment via **Ko-fi Commissions**; expectations copy honest ("no contracts, no invoices yet").
5c. **Workrooms (Phase 2, added 2026-08-17)** — a **private space per commission** reusing the site's primitives behind a membership wall: brief + milestones (brief → quote → in progress → review → delivered → closed), Oliver's WIP posts, **files both ways** (private bucket, signed URLs, allowlist, small caps), and the existing comment pattern scoped to members. Admin "Orders & Workrooms" manages multiple engagements. **Safety is structural:** an admin (David) is automatically a silent, *visible* member of every workroom; no DMs outside the room; client uploads magic-byte checked, never executables. Client email updates are **opt-in** on joining (first user-facing notification; privacy page updated). Payment stays on Ko-fi. **v1 groundwork:** comments stay polymorphic, files/download route generic (owner scope + bucket, not project-hardwired), admin Orders route designed to grow.
6. **Oliver-maintainable** — Two editing surfaces plus a helper team: (a) an **Admin UI** (primary for content) with an add/edit menu for **every content type the site hosts** — exclusive projects (mod / datapack / resource pack / plugin), skins, art — plus curation of synced items, moderation, and settings; (b) **Claude Code in VS Code** on his own clone of this repo (primary for changing the site itself); (c) **repo-committed Claude skills** — "the site management team" — 12 specialists mapped to the moments Oliver opens Claude Code: `start-here`, `ship`, `whats-wrong`, `restyle`, `new-feature`, `db-change`, `add-content`, `sync-now`, `write-copy`, `stats`, `upkeep`, `keep-docs` (`docs/site-management-skills.md`). (Decided 2026-08-16.)
7. **Fun, on-brand aesthetic** — purple / gold crown / glowing green; pixel-art sensibility without being unusable.

## 5. Functional scope (initial thinking — to be confirmed)

- **Nav (decided pass 3)** — wordmark = Home; Projects · Videos · Skins · Art · Seen on · (Commissions, Phase 2); Support = gold button; phone: burger, Support last.
- **Home** — featured-project hero, featured projects, IN THE WILD strip, latest videos, Find-me links, compact tip panel.
- **Projects** — grid/list, filterable by type (**mod / datapack / resource pack / plugin**) and MC version. Detail page per project with icon, gallery, markdown body, versions/files, download buttons (Modrinth / CurseForge / direct for exclusives), combined download count, comments. **Exclusive** projects badged as "only on odsens.com".
  - Project schema mirrors Modrinth: `slug, title, description (short), body (markdown), project_type, categories[], loaders[], game_versions[], icon, gallery[], versions[] {version_number, changelog, files[], game_versions, loaders, date}, downloads, source (modrinth | odsens)`.
- ~~**About** — who OddSense is (age-appropriate; see privacy notes below).~~ — **no About page in v1**; covered by the Home intro strip (ADR-0002 #30).
- **Videos** — YouTube channel feed with click-to-load facades + embedded player; **Shorts row** below long-form.
- **Seen on (v1, added 2026-08-17)** — third-party coverage of Oliver's work (YouTube videos/Shorts, Twitch clips, TikToks, Reddit, articles) attached to a project or to OddSense generally. **Manual curation in v1**: Oliver pastes a URL in admin → metadata auto-fetched (YouTube oEmbed/Data API; Open Graph elsewhere) → assign project → publish. Shown as a "SEEN ON" row on project detail and an "IN THE WILD" strip on Home with a reach line ("1.2M views · 6 videos · 4 creators"); YouTube view counts refreshed hourly and snapshotted. Content stays on its platform (facade/embed + "on YouTube ↗" link); creators are public channels — name + link only; mods can hide on request. **v1.5:** assisted discovery — daily YouTube search per project → admin *Suggested* queue, never auto-publish.
- **Skins** — native section highlighting skins he's made (3D viewer, download). **Details deferred to a dedicated design discussion.**
- **Art** — native section: profile pictures, thumbnails, and other original art.
- ~~Games (Scratch)~~ — **excluded** per Oliver.
- **Accounts** — Google sign-in via Supabase Auth → mandatory onboarding step: pick a **handle** (unique) + optional profile image. Profile = handle + image only. Roles: user / moderator / admin.
- **Comments** — by signed-in users; stored in Supabase. **v1: comment threads on projects only** (skins/art/videos later; schema keeps the polymorphic target — ADR-0002 C21).
  - **Moderation mode is an admin setting**: *auto-publish for signed-in users* vs. *hold first-time commenters for approval*. Start permissive; tighten if abuse appears.
  - **Multiple moderators**: Oliver can grant mod access to others (e.g. David). Mods can delete/hide comments and ban users.
  - **Notifications**: v1 = **admins only**, via **Discord webhook + email (Resend)**, controlled by a Settings **matrix** (event × channel ON/OFF). One event log, pluggable delivery; user-facing notifications arrive in Phase 2 (workrooms, opt-in). Full design: `docs/notifications.md`.
  - **Threaded replies** (so Oliver can respond in-thread) and **likes** on comments (feedback signal). Details in the comments design session.
- **Admin UI** (auth-gated; Oliver + moderators/admins) — a menu with one section per hosted content type:
  - **Projects** — create/edit exclusive projects (Modrinth-shaped form: metadata, gallery, versions + file upload); curate synced Modrinth projects (feature / hide / reorder / extra art).
  - **Skins** — add/edit (details per future skins design).
  - **Art** — add/edit profile pictures, thumbnails, other art.
  - **Comments** — moderation queue, delete/hide, ban.
  - **Settings** — moderation mode, notifications, moderator/admin list, site config.
  Site-code changes (layout, new features) happen via Claude Code on the repo.
- **Posts / devlogs** — deferred, maybe never.
- **Support** — Ko-fi panel embed + floating button (Phase 2); supporters wall / donor leaderboard via webhook (Phase 2b).
- **Custom Orders + Workrooms** — Phase 2 (see 5b/5c).
- **Seen on** — v1 slice (see Goal list).

## 6. Non-goals (for now)

- Replacing Modrinth/CurseForge for content already published there (we host files **only** for odsens-exclusive projects).
- Scratch games/projects.
- Forums / general community beyond per-project comments.
- Written posts/devlogs (deferred).
- Anything about oddsensenyc.

## 7. Infrastructure (given)

| Layer | Choice |
|---|---|
| Hosting | **Vercel** (paid, StudioBing account) |
| Database / Auth / Storage | **Supabase** (paid, StudioBing account) — Postgres, Google OAuth via Supabase Auth, Storage for images, skins, art, and **exclusive project files** |
| Secrets | `.env` (gitignored) — template in `.env.example`; David pastes keys as they're obtained |
| Google Cloud | Project `odsens` under david@studiobing.com — OAuth client (via Supabase Auth) + YouTube Data API key. Setup: `docs/setup-google-cloud.md` |
| Accounts | Vercel/Supabase stay under StudioBing for now; Oliver's control plane is **GitHub + the admin UI** (Vercel deploys from GitHub). Revisit adding him to Vercel/Supabase later. |
| Analytics | Vercel Web Analytics + Speed Insights + custom events (downloads, tips, plays) + own Supabase counters; daily snapshots of Modrinth/CF/YouTube stats as first enhancement. See `docs/analytics-options.md`. |
| Domain | odsens.com — Squarespace **registration only**, no site attached; DNS → Vercel |
| Repo | github.com/davidcbingham/odsens — **David and Oliver both have full access**; Oliver's laptop already runs VS Code + Claude Code, has an unused GitHub account. David front-loads, then hands off; Oliver's git workflow should be simple and documented (skills + `CLAUDE.md`). |
| Legacy | An old Cloudflare project exists for a prior attempt — **deprecated, ignore**. Clean sheet. |
| Framework | **Next.js (App Router, TypeScript)** — plain CSS tokens from `DESIGN.md` (no Tailwind/UI kit), self-hosted fonts, Vercel Cron for sync, Resend for admin email, skinview3d for skins. Decision + alternatives: `docs/framework-decision.md` (2026-08-17). |

## 8. Aesthetic direction (early)

- **Tone: playful and cartoony — fun, relaxed, inviting.** (Decided 2026-08-16.)
- **Design system v1 exists: repo-root `DESIGN.md`** (from Oliver's Claude Design session, 2026-08-16). Direction **"Crate Poster"** — blocky poster type (Bungee) on flat colour slabs, hard 2px edges, offset block shadows, zero blur; body Space Grotesk, pixel accent Silkscreen. Palette sampled from the avatar (ink `#0D131B`, indigo `#4B45D6`, gold `#FFC61F`, emerald `#17B94F`). Prototypes in `design/claude-design-export/`. Reviewed → `docs/design-review.md` (v1.1); **pass 2 → v1.2** adds accounts/onboarding, comment moderation states, admin settings/stats/orders, global states, privacy page (`design/claude-design-export/pass-2/`); **pass 3 → v1.3** adds Seen on, Workrooms (P2), notifications matrix, email/Discord templates (**the allay** as notification character), supporters leaderboard, nav order, How-comments-work page (`design/claude-design-export/pass-3/`). Inspiration hunt still to come.
- Palette from avatar: deep purple, gold, glowing green accent, near-black background, white outline highlights.
- Pixel/blocky motifs (Minecraft-adjacent) used tastefully — chunky borders, pixel icons — but readable typography and clean layout.
- Dark theme first (matches YouTube/Modrinth vibe). Light theme optional.
- Original art from Oliver's mods for hero/backgrounds/project cards. Oliver will populate `assets/brand/` (to create); we will then help him define the information architecture, asset categories, file types, and pixel dimensions.
- Idea: hero uses **skinview3d** to render his real Minecraft skin in 3D.

## 9. Content & safety considerations

- **No PII on the site — anyone's.** Oliver appears as **OddSense** only (no real name, age, school, location).
- **Visitors' identity**: Google sign-in is for authentication only. On first sign-in the user must **choose a handle** and may add an optional profile image; **Google name/email/avatar are never displayed or used as a display name.** Handles must be unique; moderators can rename/ban.
- Comment moderation must be easy and default-safe (e.g. new commenters' posts held for approval, or a block/report flow).
- Some project names/themes ("Disabilities", "Shizophrenia") may draw criticism — worth a family conversation on how they're presented, not a technical concern.

## 10. Open questions, future design sessions, idea queue

See `docs/questions.md` — running list of open questions (answered items migrate here), the agreed list of **future design-detail sessions** (Skins, Notifications, Comments, Custom Orders, Asset IA), and the **idea queue** (donor leaderboard, …).

---

*Revision log*
- 2026-08-27 — S1.2 Projects (synced) built on `feat/S1.2-projects` (Session A): Modrinth/CurseForge sync + cron, `/projects` grid + detail, Home hero/featured, admin curation; ADR-0022 (`project_is_visible` RLS helper) filed. PR opens at Session-A close; gates + merge in Session B.
- 2026-08-27 — S1.1 follow-up: banned accounts may delete themselves (ADR-0021, `fix/S1.1-banned-delete` — `deleteAccount` open to banned callers via `requireOnboarded({allowBanned:true})` + the Delete account control on `/banned`; DESIGN.md v1.5). S1.1 close-out recorded in `docs/questions.md`.
- 2026-08-21 — **S1.1 Accounts merged** (PR #2 → `464d429` on `main`, tag `v0.2`; ADR-0009..0020 Accepted — incl. ADR-0017 no-Skip onboarding, ADR-0018 profile-menu items, ADR-0019 banned page, ADR-0020 DB guard for reserved handles + bans). Production verified: **www.odsens.com live and public** (the custom domain is outside Vercel Deployment Protection, which guards `*.vercel.app` + previews only); production Supabase migrated via the GitHub integration; Google sign-in live.
- 2026-08-20 — S1.1 Accounts built on `feat/S1.1-accounts` (ADR-0009 `proxy.ts`, ADR-0010 preview env from the persistent `staging` Supabase branch — supersedes ADR-0006, ADR-0011 OAuth redirect allow-list narrowed, ADR-0012 `HASH_SECRET` boot-required, ADR-0013 `runAction` + `AuthError`, ADR-0014 `ProfilePanel` island + own-row `handle_changed_at`, ADR-0015 admin/mod writes to other users' profiles via the service client only, ADR-0016 `/auth/callback` stamps `email_hash` with the service client); Branching + integrations live; Q47 (Google sign-in on previews) answered 2026-08-20 — persistent `staging` branch (ADR-0010).
- 2026-08-20 — S0 scaffold built on `feat/S0-scaffold` (ADR-0003 CSP `unsafe-inline`, ADR-0004 `/dev/components`, ADR-0005 placeholder pages static, ADR-0006 preview env fallback); Supabase Branching required before S1.1.
- 2026-08-17 — **FROZEN v1.0.** Engineering specs `docs/build/` at v1.0; build begins (S0 scaffold).
- 2026-08-17 — Engineering specs `docs/build/` 00–06 + ADR-0001/0002; spec aligned (About page struck, comments v1 = projects).
- 2026-08-16 — Initial draft from David's brief + Modrinth/Scratch public data.
- 2026-08-16 — Folded in David's answers to Q1–3, 5–9; added platform audit (`platform-audit.md`).
- 2026-08-17 — Design pass 3 landed: `DESIGN.md` v1.3 (Seen on, Workrooms, notifications matrix, allay templates, leaderboard, nav). Q41–42 resolved; Q44–46 added.
- 2026-08-17 — Notifications designed (`docs/notifications.md`): admin-only, Discord + email, settings matrix.
- 2026-08-17 — Added **Seen on** (v1) and **Workrooms** (Phase 2, with v1 schema hooks).
- 2026-08-17 — Q33–40 decided (leaderboard handle+amount, structural handle validation, comment limits/edit window, auto-hold, manual CF ids, privacy defers to Google age rules).
- 2026-08-17 — Site-management skills spec'd from Oliver's moments (`docs/site-management-skills.md`).
- 2026-08-17 — Data model + sync design: `docs/data-model.md`.
- 2026-08-17 — Framework decided: Next.js + Supabase (`docs/framework-decision.md`).
- 2026-08-17 — Design pass 2 landed: `DESIGN.md` v1.2 (§11), new screens; Q28–32 resolved; Q33–37 added.
- 2026-08-16 — Claude Design export landed: `DESIGN.md` v1 (Crate Poster), prototypes in `design/`, art in `assets/brand/`.
- 2026-08-16 — Threaded comments + likes; naming model; tone; DESIGN.md/Claude Design process; inspiration-hunt process; site-management skills plan.
- 2026-08-16 — Ko-fi chosen. Oliver's input: exclusive on-site projects (Modrinth-shaped schema, file hosting), CurseForge download totals, no Scratch, Skins + Art sections native. `.env.example` added.
