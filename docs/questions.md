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
10. ~~**Replies / threads / reactions**~~ — **Answered:** **Threaded comments + likes.** Threads let Oliver reply to people; likes surface feedback on what resonates. (Updated 2026-08-16.)
11. ~~**Notifications**~~ — **Answered:** Yes, but **channels + infrastructure need a dedicated design session** (email / Discord / in-app / push; per-event types). Added to Future Design Sessions.

## Donations
12. ~~**Platform**~~ — **Answered:** **Ko-fi**, with **maximum usability, minimum clicks** — embedded panel, no redirect where avoidable. Also: 12b **Custom Orders / commissions** (leverage Ko-fi Commissions), 12c **donor leaderboard** (idea queue).

## Identity & aesthetic
13. ~~**Name presentation**~~ — **Answered:** **OddSense** = Oliver (his username on the site) and his Minecraft character. **odsens** = the website/brand — distinct from the person and character.
14. ~~**Existing art assets**~~ — **Answered:** Yes. Oliver will work with Claude in a separate **Claude Design** session to produce a `DESIGN.md`. Process + advantages documented in `docs/design-process.md`.
15. ~~**Tone**~~ — **Answered:** **Playful and cartoony. Fun, relaxed, inviting.**
16. ~~**Reference sites**~~ — **Answered:** No named references. After the functional spec is complete: abstract it into site/functionality types → Claude searches for examples → Oliver critiques good/bad. Process in `docs/design-process.md`.

## Technical / accounts
17. ~~**Framework**~~ — **Answered 2026-08-17:** **Next.js (App Router, TS) on Vercel + Supabase**, plain CSS tokens (no Tailwind), Resend for email. Full reasoning in `docs/framework-decision.md`.
18. ~~**Google OAuth**~~ — **Answered:** Google Cloud project under **david@studiobing.com**; hosts both the OAuth client and the YouTube API key. Step-by-step in `docs/setup-google-cloud.md`.
19. ~~**Vercel/Supabase org access**~~ — **Answered:** Discussed 2026-08-16 — see tradeoffs below. **Recommendation:** start with StudioBing logins only; Oliver operates through GitHub + the admin UI (Vercel auto-deploys from GitHub). Add him to Vercel/Supabase later only if needed.
20. ~~**Analytics**~~ — **Answered:** Options + effort table in `docs/analytics-options.md`. Recommend Vercel Web Analytics + Speed Insights + custom events + own Supabase counters at launch; daily external-stats snapshots as first enhancement.
21. ~~**Squarespace DNS**~~ — **Answered:** Confirmed: registration only. Clean sheet; old Cloudflare project is deprecated.

## Privacy
22. ~~**What personal info is OK to publish?** First name? Age? Nothing beyond the handle? (Scratch bio currently says "I'm 15 and in 9th grade.")

## New (from 2026-08-16 answers)
23. ~~**Content without a native home**~~ — **Answered:** **No PII on the site.** Applies to visitors too: on first sign-in every user must **choose a handle** (+ optional profile image); Google name/email are **never** displayed or used as a display name. Oliver's own presence = handle only.
24. ~~**CurseForge API key**~~ — **Answered:** Yes — key goes in `.env` as `CURSEFORGE_API_KEY`.
25. ~~**YouTube Data API**~~ — **Answered:** Yes — same Google Cloud project as OAuth. See `docs/setup-google-cloud.md`.
26. ~~**Roblox**~~ — **Answered:** No Roblox.
27. ~~**Oliver's setup**~~ — **Answered:** VS Code + Claude Code working on his laptop; has a GitHub account (unused). David will set up the clone and give **full repo access** to both. David front-loads effort, then transitions to Oliver with minimal maintenance pushes. Skills may expand to cover major updates, design decisions, dev work.

## Future design-detail sessions (agreed, not yet scheduled)
- **Skins section** — how skins are shown, viewer, download, metadata (from Q4)
- ~~**Notifications**~~ — **designed 2026-08-17** → `docs/notifications.md`
- **Comments** — threaded + likes UX, notification hooks, moderation UX (from Q10)
- **Custom Orders + Workrooms** — intake (designed), workroom flows, safety rules, retention, client email opt-in (Phase 2)
- **Asset IA** — categories, file types, pixel dimensions for `assets/brand/` (from Q14)

## Idea queue (not committed)
- **Donor leaderboard** — ranks supporters by total tipped; **ties to site account names** (Google-authenticated users). Needs a way to link a Ko-fi payment to a site account (e.g. Ko-fi webhook `email`/`from_name` match, or a "link my Ko-fi" step / code in the tip message). Privacy: opt-in display name.
- **Custom Orders** — see design session above.

## Post-spec workstreams (agreed 2026-08-16)
- ~~**DESIGN.md** via Claude Design session with Oliver~~ — **done** (`/DESIGN.md` v1.1, Crate Poster). ~~Review pass~~ **done** → `docs/design-review.md`; gaps logged as Q28–32.
- **Inspiration hunt** from abstracted functionality → `docs/design-process.md`
- ~~**Site management skills**~~ — **spec'd 2026-08-17** (12 skills mapped to Oliver's moments) → `docs/site-management-skills.md`; written for real once the first build exists
- ~~**Framework choice**~~ — **done** → `docs/framework-decision.md`

## From the DESIGN.md review pass (2026-08-16) — see `docs/design-review.md`
28. ~~**Card border contrast**~~ — **Answered (pass 2):** Card/panel outlines lifted one step to `--line-soft #2C3A4B`; `--line` kept for internal dividers.
29. ~~**User notifications**~~ — **Answered (pass 2):** **Cut from v1** — no user inbox; admin gets email. Bell spec retained for later.
30. ~~**YouTube Shorts**~~ — **Answered (pass 2):** **Shorts row added** under the long-form grid (9:16 facades).
31. ~~**Hero**~~ — **Answered (pass 2):** Unchanged in pass 2 (featured-project takeover hero) — treated as confirmed.
32. ~~**Second Claude Design pass**~~ — **Answered (pass 2):** **Done 2026-08-17** — `design/claude-design-export/pass-2/`, `DESIGN.md` v1.2 §11.
## From pass 2 (Claude Design's open items, 2026-08-17)
33. ~~**Ko-fi tip event**~~ — **Answered 2026-08-17:** v1 supporters wall = **leaderboard: handle + amount**. Linking a tip to a site account: server-side **hashed-email match** (never displayed/stored raw) → else handle typed in the Ko-fi message → else "Anonymous · $X". Amount shown only when linked or Ko-fi `is_public`. DESIGN.md note updated (was "no amounts").
34. ~~**Handle validation heuristic**~~ — **Answered 2026-08-17:** **No name detection.** Structural validation only (3–20, `[A-Za-z0-9_]`, unique, reserved words, no `@`); heavy guidance copy at handle creation + in the privacy/comments pages. Design's "looks like a real name" state dropped.
35. ~~**Comment limits**~~ — **Answered 2026-08-17:** Yes — 1000 chars, one link per comment.
36. ~~**Under-13 line** on the Privacy page ("don't sign in") — needs David's call before ship.
37. ~~**Still-missing art**: project icons, in-game screenshots, rendered 3D skin busts (build-time via skinview3d).

## From data-model design (2026-08-17) — see `docs/data-model.md`
38. ~~**Auto-hold on reports**~~ — **Answered 2026-08-17:** Yes — auto-hold at ≥3 reports.
39. ~~**CurseForge id mapping**~~ — **Answered 2026-08-17:** Yes — manual CurseForge id entry in admin.
40. ~~**Comment edit window**~~ — **Answered 2026-08-17:** Yes — 15-minute **edit** window after posting; then delete only.

## Setup to-dos before build (David)
- [x] Google Cloud project + OAuth client + YouTube key — done, Supabase Google provider configured via `supabase config push` (`docs/setup-google-cloud.md`)
- [ ] CurseForge for Studios API key → `.env`
- [x] Supabase project **`odsens`** created (ref `dllbekulbimblrsrxuyv`, us-east-2) and linked from the repo (`supabase/config.toml`) — treated as **production**. Staging = **Supabase Branching** (decided; set up at first preview deploy)
- [x] Vercel project `odsens` linked (id `prj_fTdiX6oYxyQ8CnAmzSzKnCb74MkU`), Standard protection on, env vars seeded, `CRON_SECRET` generated
- [ ] Ko-fi account (18+, StudioBing) with page `oddsense` if available (phase 2)
- [x] Resend: Vercel integration installed (`RESEND_API_KEY` in all envs + local `.env`), domain verified (DKIM/SPF/MX), sender `allay@odsens.com`, test send OK
- [ ] **DMARC record** (Squarespace → Domains → odsens.com → DNS settings → Add record):
  - Type: `TXT` · Host/Name: `_dmarc` · Data/Value: `v=DMARC1; p=none; rua=mailto:david@studiobing.com; fo=1` · TTL: default
  - (`p=none` = monitor only; reports go to your inbox weekly. Tighten to `p=quarantine` later if desired.)
- [ ] **Inbound for allay@odsens.com** so replies to notifications don't bounce — pick one:
  - (a) *Squarespace email forwarding* (Domains → odsens.com → Email → Email forwarding): forward `allay@odsens.com` → `david@studiobing.com`. Squarespace will add its own MX records for `odsens.com` automatically (root MX only; the `send.odsens.com` MX for Resend is unaffected).
  - (b) *Resend Receiving*: Resend dashboard → Domains → odsens.com → enable receiving; add the MX record it shows (Type `MX`, Host `@`, Priority `10`, Value `inbound-smtp.<region>.amazonaws.com`) — then inbound mail arrives via Resend webhooks/dashboard.
  - Recommendation: **(a)** — simplest; you read replies in Gmail. Tell me when done and I'll set `Reply-To: allay@odsens.com` in templates.
- [ ] **Discord**: confirm Oliver has his own server; create a private `#odsens-admin` channel + webhook URL → `.env` `DISCORD_WEBHOOK_URL` (also settable in admin Settings)
- [x] Docker runtime on David's Mac — OrbStack installed, local Supabase verified (`docs/dev-tooling.md`)
- [ ] Decisions: Q33–40

## From "Seen on" + Workrooms (2026-08-17)
41. ~~**Mention click behaviour**~~ — **Answered (pass 3):** YouTube mentions embed inline (facade → player, indigo-lift outline, "on YouTube ↗" ghost link); other platforms link out.
42. ~~**Claude Design pass 3?**~~ — **Answered (pass 3):** Pass 3 done 2026-08-17 → `DESIGN.md` v1.3 §12. No pass 4 needed before build.
43. **Workroom email opt-in copy + privacy page line** — draft when Phase 2 starts.

## Design pass 3 — **landed 2026-08-17** (`design/claude-design-export/pass-3/`, `DESIGN.md` v1.3 §12)
Answers to Claude Design's open items (build decisions, no re-pass): view counts refresh hourly (data model) · general mentions tagged with the ODSENS wordmark chip · suggested-mention source = YouTube search per project title (v1.5) · one Discord webhook in v1 (a second mod-channel webhook is a field, not a redesign) · leaderboard linking = hashed-email match (decided Q33) · **nav shows "Commissions" only when Phase 2 ships**.
44. **Allay render** — Oliver to draw a pixel allay (Minecraft mob; same fan-content footing as the rest) for the email header (28px), Discord bot avatar, and Settings → Notifications. Also needed at build: official YouTube/TikTok/Twitch/Reddit marks (24px) from brand-guideline downloads. *(Oliver)*
45. **Workroom limits** — confirm 25 MB/file, 200 MB/room; **max participants per room** (proposed 6). *(Phase 2)*
46. **Future passes** — tell Claude Design to stop carrying pass-1/2 files forward (each pass re-adds ~12 MB of identical assets). Decide: self-contained snapshots (current) vs. delta-only exports.

## Engineering specs (2026-08-17)
`docs/build/00–05` + `_registry.md` + ADR-0001/0002 (with Amendment A) at **v0.4** — reconciled, gate-checkable. Next: David says **freeze** → docs bumped to v1.0, `build-phase` starts at S0.
