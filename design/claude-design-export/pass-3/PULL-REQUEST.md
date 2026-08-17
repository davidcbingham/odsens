# PR: Design pass 3 — DESIGN.md v1.3 + feature screens

Branch: `design/pass-3` → `main`
Commit message: `Design pass 3: DESIGN.md v1.3, new screens (workrooms, seen on, notifications matrix, email/Discord templates, leaderboard)`

Design files only. No app scaffold, no framework, no build config. Nothing deleted or renamed; `docs/`, `assets/brand/`, `README.md`, `CLAUDE.md`, `.env*` and the pass-1/pass-2 exports are untouched. **Delete this file before committing.**

## Screens added

- **Workroom** — desktop + phone, plus five states (new / active / review / delivered / closed) and the first-entry email opt-in. PRIVATE badge, posts with WIP eyebrows, milestone pills, files with kind tags + client upload well, participants with a visible MOD, member-scoped comments.
- **SEEN ON row** on project detail (in situ, desktop + phone) with the loaded-YouTube state and link-out cards.
- **Home IN THE WILD strip**, the **Seen on page** (desktop + phone), and **Admin → Mentions** with the paste-URL flow and the v1.5 Suggested tab.
- **Admin Settings — Notifications matrix** (desktop + phone): webhook + Test, admin-email chips, the event × channel grid with coming-later rows.
- **Admin → Orders & Workrooms**: engagement list, order detail with CREATE WORKROOM, room controls (add participant, close room).
- **Emails** (New comment / Held for review / Sync failed) + one plain-text version, and **Discord embeds** shown in a channel.
- **Supporters leaderboard** on Support (+ empty state + phone), replacing the dashed slot.
- Leftovers: handle guidance (name detection removed), Privacy additions, **How comments work** page, per-version changelog expander, Custom orders confirmation + "Your orders" in the profile menu.

## Components added to the spec (§12.1)

Notification matrix · mention card · reach line · PRIVATE badge · milestone pills · participants row · client upload well variant · leaderboard row · email template rules · Discord embed rules.

## Corrections applied

- **Nav order decided:** wordmark = Home (Home item removed); Projects · Videos · Skins · Art · Seen on · Commissions; Support stays the gold button; on phone everything collapses behind the burger, Support last. Applied in §5 and the new mocks (older mocks show the old order — not re-exported).
- **Handle field:** "looks like a real name / email" rejection removed — no name detection. Guidance copy carries it (§12.5).
- **Admin Settings:** "Email me about" switches retired for the notifications matrix.
- **Footer:** Site column gains Seen on; new dry line "Creators featuring the mods aren't affiliated with odsens."
- v1.1/v1.2 corrections preserved verbatim.

## New source art

None. Every image in `pass-3/assets/` is an existing file copied so the prototypes render.

## Open questions

- **Allay render** — notifications send as allay@odsens.com and speak as the allay; the one imagery asset (a pixel allay render for the email header, Discord avatar and Settings) is pending. It's Mojang's mob — same fan-content footing as the rest of the site, but flagging it.

- **Platform marks** — mention cards need the official YouTube/TikTok/Twitch/Reddit marks as real assets (mocks use coloured placeholder squares). Brand-guideline downloads, one 24px asset each.
- **View counts** — fetched once at publish or refreshed on a schedule? The reach line's honesty depends on the answer.
- **"About OddSense generally"** mentions — the Seen on page shows project tags on every card; general mentions need a tag treatment (suggest the ODSENS wordmark chip).
- **Workroom limits** — 25 MB / 200 MB are from the brief; confirm before build. Also: max participants per room?
- **Leaderboard linking** — matching Ko-fi email to Google sign-in email is a backend decision with privacy weight; the design only assumes it exists.
- **Discord** — the bot posts as "allay". One webhook = one channel. If held/reported should go to a private mod channel instead, that's a second webhook field, not a redesign.
- **Suggested mentions (v1.5)** — where candidates come from (YouTube search? mentions of the Modrinth slug?) is a build decision; the design only shows the queue.

## Files I wasn't sure where to put

- `CHANGELOG.md` sits inside `design/claude-design-export/pass-3/` again, per pass-2 convention.
- Pass-1/2 files are duplicated into `pass-3/` unchanged so the folder stays a self-contained snapshot — same convention as pass 2; say the word and future passes will stop carrying them.
