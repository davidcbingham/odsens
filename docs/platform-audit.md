# Platform Integration Audit

Principle (from David, 2026-08-16): **content lives where it's natively hosted; odsens.com curates and presents it.**
Only content with no natural home gets managed directly in odsens.com.

Legend — **Pull** = can we read his content programmatically? **Embed** = can the platform's own player/widget be
shown inline? **Key** = credentials needed. Verified by live probes on 2026-08-16 unless marked *(from docs)*.

| Platform | Content | Pull (API) | Embed | Key / limits | Verdict |
|---|---|---|---|---|---|
| **Modrinth** | mods, datapacks, resource packs, plugins | ✅ Public REST v2: user → projects, project → icon, **gallery images**, full markdown body, categories, versions, followers, downloads. | Link-out only (no widget). We render our own cards from API data. | None. 300 req/min; must send a `User-Agent`. | **Primary integration.** Sync on a schedule (ISR/cron), cache in Supabase, allow per-project overrides. |
| **YouTube** | videos, shorts | ✅ Keyless **RSS** per channel (`feeds/videos.xml?channel_id=UCo3X_c7MqfC_ub-sMJZmmOA`) — latest ~15 videos with title/thumb/date. Full history + view counts need **YouTube Data API v3** (free key, 10k units/day — ample). | ✅ Standard iframe embed per video (`youtube.com/embed/ID`, or `youtube-nocookie.com`). | RSS: none. Data API: Google Cloud API key. | **Integrate.** RSS for latest, Data API if we want stats/full list. Embed player on a Videos page. |
| **Scratch** | games | ✅ Public API `api.scratch.mit.edu/users/OddSense/projects` — id, title, thumbnail, views/loves/faves. | ✅ Playable iframe `scratch.mit.edu/projects/{id}/embed`. | None (unofficial-but-stable; no auth). | **Integrate.** Playable games inline is a strong showcase for a "Games" section. |
| **CurseForge** | mods/packs (likely cross-posts) | ⚠️ Official "CurseForge for Studios" API requires a **free API key** (approved via console.curseforge.com). Anonymous requests → 403; page scraping blocked (Cloudflare). | Link-out only. | API key (free, needs signup). | **Secondary.** Get a key so each project can show both a Modrinth and CurseForge download button. Confirm with Oliver whether CF has anything *not* on Modrinth. |
| **Minecraft skin** (Mojang) | his current skin | ✅ Mojang profile resolves: `oddsense` → UUID `36a329d1-4a13-41dc-a3d4-1ea956c2956d`. Skin texture via sessionserver; 3D/2D renders via public services (Crafatar, mc-heads, Minotar, or Skinview3D in-browser). | ✅ Interactive 3D skin viewer via **skinview3d** (open source, client-side). | None. | **Integrate** as a hero flourish (spinning 3D avatar wearing his real skin). |
| **Skins he made** (NameMC / Planet Minecraft / Skindex) | published skins | ❌ No public APIs; pages block bots (403). | ❌ | — | **Host in odsens.com** — skins are small PNGs; store in Supabase Storage/repo, render with skinview3d, offer download. *(Need: where do his skins actually live today?)* |
| **Roblox** | (secondary) | ✅ Public APIs; user `BlackNinja8347` (display "OddSense", id 1493751949) resolves; games listable via `games.roblox.com`. | ❌ No embed. | None. | **Optional link-out** — only if Oliver wants Roblox on the site. |
| **GitHub** | mod source code | ✅ REST/GraphQL API. | Link-out. | Optional token for rate limits. | **Later** — if he publishes source, show repos + stars. |
| **Discord** | community | Widget JSON if enabled on server. | ✅ Widget iframe. | Server owner setting. | **Only if** he has/wants a server. |
| **Ko-fi / Buy Me a Coffee** | donations | — | ✅ Both offer embeddable buttons/widgets. | Account (18+ — under StudioBing). | **Phase 2.** Decision pending (question #12). |

## What has no natural home → managed in odsens.com

- Skins he's made (PNGs)
- Original art / banners / textures shown as art (not attached to a Modrinth project)
- Written posts / devlogs / announcements (unless he uses YouTube Posts, which has **no** public API)
- Curation metadata: which projects are featured, custom ordering, extra write-ups, tags for the site taxonomy
- Site settings: moderation mode, notification toggles, moderator list

## Implications for architecture

1. **Sync layer**: scheduled jobs pull Modrinth / YouTube / Scratch (/ CurseForge) into Supabase tables (`external_items`), so pages render fast and survive upstream outages/rate limits.
2. **Override layer**: `item_overrides` keyed by (source, external_id) — featured flag, custom title/blurb, extra images, hidden flag.
3. **Native content**: `posts`, `skins`, `art` tables + Supabase Storage.
4. **Editing**: (a) Claude Code in VS Code on Oliver's clone for structural/content changes; (b) minimal admin UI for the fiddly bits (feature/hide/reorder, moderation, settings, upload a skin/image).
