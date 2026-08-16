# Open Questions (running list)

Answered items get folded into `spec.md` and struck here.

## Content & ownership
1. **Source of truth for projects** — Should the site pull the project list **live from Modrinth's API** (zero maintenance, always current) and let Oliver *enrich* entries (extra art, write-ups, featured flag) — or should he curate everything manually in the site's own database? Hybrid recommended: Modrinth as base, Supabase overrides on top.
2. **CurseForge overlap** — Are the CurseForge projects the same as Modrinth ones (cross-posted) or different? Do we want a CurseForge API key (free) to pull those too?
3. **Scratch games and YouTube** — Are Scratch projects and videos part of the portfolio (embedded playable Scratch projects? YouTube embeds?), or just links?
4. **Skins** — Where do his skins live today (NameMC? Planet Minecraft? Skindex?) and should the site display/download them?
5. **Non-Minecraft work** — Anything else (Roblox, art, code) that belongs here, or Minecraft-only?
6. **Blog / posts / devlogs** — Does Oliver want to write updates (like YouTube's Posts tab), or is the site purely a catalog?

## Editing workflow
7. **How does Oliver edit content?** Options: (a) a small admin UI in the site (login → forms) — most friendly; (b) markdown/JSON files in the repo edited via GitHub — teaches git, no UI to build; (c) Supabase dashboard directly — zero build, but clunky. Preference?
8. **Will Oliver code?** Is part of the goal for him to learn web dev on this project (affects framework choice and how much we document), or should it be a finished tool he uses?

## Comments & moderation
9. **Moderation model** — Auto-publish comments from Google-authenticated users, or hold first-time commenters for approval? Should Oliver be able to ban users? Should David also have moderator access?
10. **Replies / threads / reactions** — Flat comments, or threaded replies? Emoji reactions/likes on projects?
11. **Notifications** — Should Oliver get an email/Discord ping when a comment arrives?

## Donations
12. **Platform** — Ko-fi, Buy Me a Coffee, GitHub Sponsors, Patreon, PayPal? Note: most require age 18 for the account holder — likely needs to be under David's/StudioBing's name with funds passed to Oliver. Which platform, and just a link/button vs. embedded widget?

## Identity & aesthetic
13. **Name presentation** — "OddSense" everywhere, with odsens.com as the short URL? Or lean into "odsens" as the brand?
14. **Existing art assets** — Can Oliver gather a folder of source art (avatar at high res / original pixel size, banners, project icons, textures) into the repo (e.g. `assets/brand/`)?
15. **Tone** — Playful/troll-humor (matches Metal Pipe Mace, Troll Resources) vs. polished portfolio? Probably both — but which leads?
16. **Reference sites** — Any creator sites Oliver likes the look of (other modders' pages, game sites) we should use as inspiration?

## Technical / accounts
17. **Framework** — OK with Next.js (App Router) on Vercel + Supabase? Alternatives: Astro (great for content sites, lighter) with a small island for comments.
18. **Google OAuth** — Needs a Google Cloud project for the OAuth client. Under David's Google account, or a new one? Which email should own it?
19. **Vercel/Supabase org access** — Will Oliver eventually get his own logins to these, or always operate through StudioBing?
20. **Analytics** — Vercel Analytics (privacy-friendly, built-in) fine? Anything else wanted (download stats over time?).
21. **Squarespace DNS** — Confirm the domain is *only* registered there (no Squarespace site attached), so we just point DNS at Vercel.

## Privacy
22. **What personal info is OK to publish?** First name? Age? Nothing beyond the handle? (Scratch bio currently says "I'm 15 and in 9th grade.")
