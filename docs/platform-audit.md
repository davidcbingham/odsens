# Platform Integration Audit

Principle (from David, 2026-08-16): **content lives where it's natively hosted; odsens.com curates and presents it.**
Only content with no natural home gets managed directly in odsens.com.

Legend — **Pull** = can we read his content programmatically? **Embed** = can the platform's own player/widget be
shown inline? **Key** = credentials needed. Verified by live probes on 2026-08-16 unless marked *(from docs)*.

| Platform | Content | Pull (API) | Embed | Key / limits | Verdict |
|---|---|---|---|---|---|
| **Modrinth** | mods, datapacks, resource packs, plugins | ✅ Public REST v2: user → projects, project → icon, **gallery images**, full markdown body, categories, versions, followers, downloads. | Link-out only (no widget). We render our own cards from API data. | None. 300 req/min; must send a `User-Agent`. | **Primary integration.** Sync on a schedule (ISR/cron), cache in Supabase, allow per-project overrides. |
| **YouTube** | videos, shorts | ✅ Keyless **RSS** per channel (`feeds/videos.xml?channel_id=UCo3X_c7MqfC_ub-sMJZmmOA`) — latest ~15 videos with title/thumb/date. Full history + view counts need **YouTube Data API v3** (free key, 10k units/day — ample). | ✅ Standard iframe embed per video (`youtube.com/embed/ID`, or `youtube-nocookie.com`). | RSS: none. Data API: Google Cloud API key. | **Integrate.** RSS for latest, Data API if we want stats/full list. Embed player on a Videos page. |
| **Scratch** | games | ✅ Public API available. | ✅ Playable iframe. | None. | **Excluded** — Oliver doesn't want Scratch on the site (2026-08-16). |
| **CurseForge** | cross-posts (all also on Modrinth) | ⚠️ "CurseForge for Studios" API requires a **free API key** (console.curseforge.com). Anonymous → 403; scraping blocked. | Link-out only. | API key → `CURSEFORGE_API_KEY` in `.env`. | **Secondary.** Pull per-project download counts to **sum with Modrinth**; show CF download button where cross-posted. |
| **Minecraft skin** (Mojang) | his current skin | ✅ Mojang profile resolves: `oddsense` → UUID `36a329d1-4a13-41dc-a3d4-1ea956c2956d`. Skin texture via sessionserver; 3D/2D renders via public services (Crafatar, mc-heads, Minotar, or Skinview3D in-browser). | ✅ Interactive 3D skin viewer via **skinview3d** (open source, client-side). | None. | **Integrate** as a hero flourish (spinning 3D avatar wearing his real skin). |
| **Skins he made** (NameMC / Planet Minecraft / Skindex) | published skins | ❌ No public APIs; pages block bots (403). | ❌ | — | **Host in odsens.com** — skins are small PNGs; store in Supabase Storage/repo, render with skinview3d, offer download. *(Need: where do his skins actually live today?)* |
| **Roblox** | (secondary) | ✅ Public APIs; user `BlackNinja8347` (display "OddSense", id 1493751949) resolves; games listable via `games.roblox.com`. | ❌ No embed. | None. | **Optional link-out** — only if Oliver wants Roblox on the site. |
| **GitHub** | mod source code | ✅ REST/GraphQL API. | Link-out. | Optional token for rate limits. | **Later** — if he publishes source, show repos + stars. |
| **Discord** | community | Widget JSON if enabled on server. | ✅ Widget iframe. | Server owner setting. | **Only if** he has/wants a server. |
| **Ko-fi** (chosen) | tips/donations | ⚠️ **No read API.** **Webhooks** push each donation (`data` JSON: `verification_token`, `type`, `from_name`, `message`, `amount`, `currency`, `is_public`, `timestamp`, `url`, tier) to a URL we host → store in Supabase. | ✅ Floating button (script), **panel/overlay widget** (iframe `ko-fi.com/<name>/?hidefeed=true&widget=true&embed=true`), static badge. | Account must be **18+** (verified in Ko-fi ToS 2026-07-13) → owned by David/StudioBing, branded OddSense. 0% platform fee on tips. | **Phase 2:** embed panel on `/support` + floating button (min-clicks). **Phase 2b:** webhook → supporters wall / goal bar / donor leaderboard. **Future:** Ko-fi **Commissions** (native request form + payment, webhook `type: "Commission"`) behind a Custom Orders page. |

## What has no natural home → managed in odsens.com

- **Exclusive projects** (mods/datapacks/resource packs/plugins not published elsewhere) — metadata + gallery + **downloadable files** in Supabase Storage. Same schema as Modrinth-sourced projects.
- **Skins** he's made (PNGs) — dedicated section, design TBD
- **Art** — profile pictures, thumbnails, banners, textures-as-art
- ~~Posts / devlogs~~ — deferred
- Curation metadata: which projects are featured, custom ordering, extra write-ups, tags for the site taxonomy
- Site settings: moderation mode, notification toggles, moderator list

## Implications for architecture

1. **Sync layer**: scheduled jobs pull Modrinth / YouTube / Scratch (/ CurseForge) into Supabase tables (`external_items`), so pages render fast and survive upstream outages/rate limits.
2. **Override layer**: `item_overrides` keyed by (source, external_id) — featured flag, custom title/blurb, extra images, hidden flag.
3. **Native content**: `projects` (source = odsens) with `project_files`, plus `skins`, `art` tables + Supabase Storage buckets.
3b. **Unified projects view**: Modrinth-sourced and odsens-exclusive rows share one shape so the Projects grid, filters, and detail page don't care where a project came from. Download count = Modrinth + CurseForge (+ odsens direct downloads for exclusives).
4. **Editing**: (a) Claude Code in VS Code on Oliver's clone for structural/content changes; (b) minimal admin UI for the fiddly bits (feature/hide/reorder, moderation, settings, upload a skin/image).
