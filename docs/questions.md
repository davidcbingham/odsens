# Open Questions (running list)

Answered items get folded into `spec.md` and struck here.

## Content & ownership
1. ~~**Source of truth for projects**~~ — **Answered:** Everything on Modrinth appears on the site, **plus exclusive on-site projects** (Oliver authors name/description/gallery and uploads the file). Modrinth parameters = the schema. Four categories: mod, datapack, resource pack, plugin.
2. ~~**CurseForge overlap**~~ — **Answered:** Little content on CF, all also on Modrinth. **Get an API key**; sum download counts across both. Placeholder in `.env`.
3. ~~**Scratch games and YouTube**~~ — **Answered:** **No Scratch** on the site. YouTube: yes (embed).
4. ~~**Skins**~~ — **Answered:** He doesn't use any skin site. **Native Skins section** — design deferred to a dedicated discussion.
5. ~~**Non-Minecraft work**~~ — **Answered:** See #1.
6. ~~**Blog / posts / devlogs**~~ — **Answered:** Deferred, maybe never.

## Editing workflow
7. ~~**How does Oliver edit content?** Options: (a) a small admin UI in the site (login → forms) — most friendly; (b) markdown/JSON files in the repo edited via GitHub — teaches git, no UI to build; (c) Supabase dashboard directly — zero build, but clunky. Preference?
8. ~~**Will Oliver code?** Is part of the goal for him to learn web dev on this project (affects framework choice and how much we document), or should it be a finished tool he uses?

## Comments & moderation
9. ~~**Moderation model**~~ — **Answered:** See earlier batch — admin setting; multi-mod; notifications toggle.
10. ~~**Replies / threads / reactions**~~ — **Answered:** Considered answered (David, 2026-08-16). Working assumption: **flat comments** to start; threading/reactions decided in the comments design-detail session.
11. ~~**Notifications**~~ — **Answered:** Yes, but **channels + infrastructure need a dedicated design session** (email / Discord / in-app / push; per-event types). Added to Future Design Sessions.

## Donations
12. ~~**Platform**~~ — **Answered:** **Ko-fi**, with **maximum usability, minimum clicks** — embedded panel, no redirect where avoidable. Also: 12b **Custom Orders / commissions** (leverage Ko-fi Commissions), 12c **donor leaderboard** (idea queue).

## Identity & aesthetic
13. **Name presentation** — "OddSense" everywhere, with odsens.com as the short URL? Or lean into "odsens" as the brand?
14. **Existing art assets** — *(David: yes)* Oliver will gather a folder of source art (avatar at high res / original pixel size, banners, project icons, textures) into the repo (e.g. `assets/brand/`)?
15. **Tone** — Playful/troll-humor (matches Metal Pipe Mace, Troll Resources) vs. polished portfolio? Probably both — but which leads?
16. **Reference sites** — Any creator sites Oliver likes the look of (other modders' pages, game sites) we should use as inspiration?

## Technical / accounts
17. ~~**Framework**~~ — **Answered:** Deferred until design spec settles; pick best fit.
18. **Google OAuth** — Needs a Google Cloud project for the OAuth client. Under David's Google account, or a new one? Which email should own it?
19. **Vercel/Supabase org access** — Will Oliver eventually get his own logins to these, or always operate through StudioBing?
20. **Analytics** — Vercel Analytics (privacy-friendly, built-in) fine? Anything else wanted (download stats over time?).
21. ~~**Squarespace DNS**~~ — **Answered:** Confirmed: registration only. Clean sheet; old Cloudflare project is deprecated.

## Privacy
22. **What personal info is OK to publish?** First name? Age? Nothing beyond the handle? (Scratch bio currently says "I'm 15 and in 9th grade.")

## New (from 2026-08-16 answers)
23. ~~**Content without a native home**~~ — **Answered:** Exclusive projects (with files), skins, art (profile pics, thumbnails). Not posts.
24. ~~**CurseForge API key**~~ — **Answered:** Yes — key goes in `.env` as `CURSEFORGE_API_KEY`.
25. **YouTube Data API** — OK to create a Google Cloud project (same one as the OAuth client, Q18) for a YouTube API key? Keyless RSS covers "latest videos" only.
26. **Roblox** — include a link/section, or leave off the site?
27. **Oliver's setup** — Does he have `git`, GitHub account, and Claude Code working on his desktop already (for mods) or only VS Code + Claude Code without git?

## Future design-detail sessions (agreed, not yet scheduled)
- **Skins section** — how skins are shown, viewer, download, metadata (from Q4)
- **Notifications** — channels (email / Discord / in-app / push), which events, infrastructure (from Q11)
- **Comments** — threading vs flat, reactions, moderation UX (from Q10)
- **Custom Orders** — intake form, scope, pricing, payment, communication, tying to Ko-fi Commissions (from Q12b)
- **Asset IA** — categories, file types, pixel dimensions for `assets/brand/` (from Q14)

## Idea queue (not committed)
- **Donor leaderboard** — ranks supporters by total tipped; **ties to site account names** (Google-authenticated users). Needs a way to link a Ko-fi payment to a site account (e.g. Ko-fi webhook `email`/`from_name` match, or a "link my Ko-fi" step / code in the tip message). Privacy: opt-in display name.
- **Custom Orders** — see design session above.
