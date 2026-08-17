# odsens.com — Project Specification (DRAFT)

> Status: **Planning — not yet building.** This document is the working spec. It will be revised over several
> conversation cycles until mature enough to start implementation.

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
| Display name | OddSense |
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
5. **Donations (Phase 2) — Ko-fi.** Embedded Ko-fi panel on a `/support` page + floating button; later, Ko-fi webhook → Supabase for a supporters wall / goal bar. Account under David/StudioBing (Ko-fi requires 18+). Details in `platform-audit.md`. (Decided 2026-08-16.)
6. **Oliver-maintainable** — Two editing surfaces: (a) an **Admin UI** (primary for content) with an add/edit menu for **every content type the site hosts** — exclusive projects (mod / datapack / resource pack / plugin), skins, art — plus curation of synced items, moderation, and settings; (b) **Claude Code in VS Code** on his own clone of this repo (primary for changing the site itself). (Decided 2026-08-16.)
7. **Fun, on-brand aesthetic** — purple / gold crown / glowing green; pixel-art sensibility without being unusable.

## 5. Functional scope (initial thinking — to be confirmed)

- **Home** — hero with avatar/brand, featured projects, latest activity, links to YouTube/Modrinth/CurseForge/Scratch.
- **Projects** — grid/list, filterable by type (**mod / datapack / resource pack / plugin**) and MC version. Detail page per project with icon, gallery, markdown body, versions/files, download buttons (Modrinth / CurseForge / direct for exclusives), combined download count, comments. **Exclusive** projects badged as "only on odsens.com".
  - Project schema mirrors Modrinth: `slug, title, description (short), body (markdown), project_type, categories[], loaders[], game_versions[], icon, gallery[], versions[] {version_number, changelog, files[], game_versions, loaders, date}, downloads, source (modrinth | odsens)`.
- **About** — who OddSense is (age-appropriate; see privacy notes below).
- **Videos** — YouTube channel feed with embedded player.
- **Skins** — native section highlighting skins he's made (3D viewer, download). **Details deferred to a dedicated design discussion.**
- **Art** — native section: profile pictures, thumbnails, and other original art.
- ~~Games (Scratch)~~ — **excluded** per Oliver.
- **Comments** — Google sign-in via Supabase Auth; comments stored in Supabase.
  - **Moderation mode is an admin setting**: *auto-publish for signed-in users* vs. *hold first-time commenters for approval*. Start permissive; tighten if abuse appears.
  - **Multiple moderators**: Oliver can grant mod access to others (e.g. David). Mods can delete/hide comments and ban users.
  - **Notifications**: on/off toggle for new-comment alerts (email initially; Discord webhook optional).
- **Admin UI** (auth-gated; Oliver + moderators/admins) — a menu with one section per hosted content type:
  - **Projects** — create/edit exclusive projects (Modrinth-shaped form: metadata, gallery, versions + file upload); curate synced Modrinth projects (feature / hide / reorder / extra art).
  - **Skins** — add/edit (details per future skins design).
  - **Art** — add/edit profile pictures, thumbnails, other art.
  - **Comments** — moderation queue, delete/hide, ban.
  - **Settings** — moderation mode, notifications, moderator/admin list, site config.
  Site-code changes (layout, new features) happen via Claude Code on the repo.
- **Posts / devlogs** — deferred, maybe never.
- **Support** — Ko-fi panel embed + floating button (Phase 2); supporters wall via webhook (Phase 2b).

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
| Domain | odsens.com — Squarespace **registration only**, no site attached; DNS → Vercel |
| Repo | github.com/davidcbingham/odsens (Oliver will get his own clone; he is new to GitHub/Supabase — keep the workflow simple and documented) |
| Legacy | An old Cloudflare project exists for a prior attempt — **deprecated, ignore**. Clean sheet. |
| Framework | **Deferred** — choose after the design/experience spec is settled (David is indifferent; pick what best fits). |

## 8. Aesthetic direction (early)

- Palette from avatar: deep purple, gold, glowing green accent, near-black background, white outline highlights.
- Pixel/blocky motifs (Minecraft-adjacent) used tastefully — chunky borders, pixel icons — but readable typography and clean layout.
- Dark theme first (matches YouTube/Modrinth vibe). Light theme optional.
- Original art from Oliver's mods for hero/backgrounds/project cards. Oliver will populate `assets/brand/` (to create); we will then help him define the information architecture, asset categories, file types, and pixel dimensions.
- Idea: hero uses **skinview3d** to render his real Minecraft skin in 3D.

## 9. Content & safety considerations

- Oliver is a minor. **Decision (2026-08-16): publish handle only** — no real name, age, school, or location on the site.
- Comment moderation must be easy and default-safe (e.g. new commenters' posts held for approval, or a block/report flow).
- Some project names/themes ("Disabilities", "Shizophrenia") may draw criticism — worth a family conversation on how they're presented, not a technical concern.

## 10. Open questions

See `docs/questions.md` (running list, answered items migrate into this spec).

---

*Revision log*
- 2026-08-16 — Initial draft from David's brief + Modrinth/Scratch public data.
- 2026-08-16 — Folded in David's answers to Q1–3, 5–9; added platform audit (`platform-audit.md`).
- 2026-08-16 — Ko-fi chosen. Oliver's input: exclusive on-site projects (Modrinth-shaped schema, file hosting), CurseForge download totals, no Scratch, Skins + Art sections native. `.env.example` added.
