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

## 2. Identity

| Item | Value |
|---|---|
| Domain | **odsens.com** (purchased via Squarespace; DNS to be pointed at Vercel) |
| Handle | **OddSense** (Modrinth, CurseForge, Scratch), **@OdSens** (YouTube) |
| Display name | OddSense |
| Avatar | Pixel-art Minecraft character: **purple** hoodie/armor, **gold crown**, **glowing green eyes**, black face, white outline. Oliver has lots of original art across his mods and can supply more. |
| Disambiguation | **NOT** related to *oddsensenyc.com* (a NYC creative studio, 2018–2024, now closed). Zero overlap, no references, no shared branding. |

## 3. Existing presence (sources of truth for content)

| Platform | URL | Notes |
|---|---|---|
| YouTube | https://www.youtube.com/@OdSens | 666 subscribers, 21 videos, description "mincraf" |
| Modrinth | https://modrinth.com/user/OddSense/mods | **18 projects**, ~8.9k total downloads. Public JSON API (`api.modrinth.com/v2/user/OddSense/projects`) — no auth needed. Joined Dec 2024. |
| CurseForge | https://www.curseforge.com/members/oddsense/projects | Bot-protected page; official API requires a key. Need to check overlap with Modrinth list. |
| Scratch | https://scratch.mit.edu/users/OddSense/ | Games since Oct 2022 (BedWars 1k views, Super Scratch Bros, Orb Royale, …). Public API available. |

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

1. **Showcase** — Browse all projects with art, description, type, MC version/loader, and download counts.
2. **Link out to downloads** — Each project links to Modrinth / CurseForge / other hosts (no self-hosting of files, at least initially).
3. **Discussion** — Visitors can comment on projects, **only when signed in with Google** (spam/bot/abuse prevention).
4. **Donations (later)** — Connect to a donation platform so people can support his work.
5. **Oliver-maintainable** — He can add projects, art, posts, and updates without touching code (or with minimal, well-documented code touches).
6. **Fun, on-brand aesthetic** — purple / gold crown / glowing green; pixel-art sensibility without being unusable.

## 5. Functional scope (initial thinking — to be confirmed)

- **Home** — hero with avatar/brand, featured projects, latest activity, links to YouTube/Modrinth/CurseForge/Scratch.
- **Projects** — grid/list, filterable by type (mod / datapack / resource pack / plugin / skin / other) and MC version. Detail page per project with gallery, description, changelog/versions, download links, comments.
- **About** — who OddSense is (age-appropriate; see privacy notes below).
- **Comments** — Google sign-in via Supabase Auth; comments stored in Supabase; moderation controls for Oliver (delete, hide, ban).
- **Admin / content editing** — TBD approach (see open questions).
- **Donations** — placeholder / later phase.

## 6. Non-goals (for now)

- Self-hosting mod files or replacing Modrinth/CurseForge.
- Forums / general community beyond per-project comments.
- Anything about oddsensenyc.

## 7. Infrastructure (given)

| Layer | Choice |
|---|---|
| Hosting | **Vercel** (paid, StudioBing account) |
| Database / Auth / Storage | **Supabase** (paid, StudioBing account) — Postgres, Google OAuth via Supabase Auth, Storage for images |
| Domain | odsens.com — DNS at Squarespace → Vercel |
| Repo | github.com/davidcbingham/odsens |
| Framework | TBD (leaning Next.js on Vercel — to confirm) |

## 8. Aesthetic direction (early)

- Palette from avatar: deep purple, gold, glowing green accent, near-black background, white outline highlights.
- Pixel/blocky motifs (Minecraft-adjacent) used tastefully — chunky borders, pixel icons — but readable typography and clean layout.
- Dark theme first (matches YouTube/Modrinth vibe). Light theme optional.
- Original art from Oliver's mods for hero/backgrounds/project cards.

## 9. Content & safety considerations

- Oliver is a minor. Site should avoid publishing personal details beyond first name/handle unless David/Oliver decide otherwise (no school, location, etc.).
- Comment moderation must be easy and default-safe (e.g. new commenters' posts held for approval, or a block/report flow).
- Some project names/themes ("Disabilities", "Shizophrenia") may draw criticism — worth a family conversation on how they're presented, not a technical concern.

## 10. Open questions

See `docs/questions.md` (running list, answered items migrate into this spec).

---

*Revision log*
- 2026-08-16 — Initial draft from David's brief + Modrinth/Scratch public data.
