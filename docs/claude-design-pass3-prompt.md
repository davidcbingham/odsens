# Claude Design — Pass 3 prompt (paste everything below the line into the existing odsens Design project)

---

Third pass on the odsens design system. v1.2 is solid — keep the Crate Poster direction, palette, type, spacing, and every existing component exactly as they are. This pass adds **new features that were decided after pass 2**, one **settings redesign**, **email/Discord templates**, and a handful of small leftovers. Same rules as always: no personal info anywhere (handles only), phones + desktop, playful-cartoony through shape and copy, readable over flashy, no framework/code. If something is already covered by a component, reuse it — don't invent parallel ones.

Read the current spec's decisions baked into this brief; where I say "decided", don't re-open it.

## 1. Admin Settings — Notifications matrix (replaces the four email switches)
Decided: notifications are **admin-only** in v1, **site-level** (one grid for all admins, not per-admin), two channels: **Email** and **Discord**.
- A grid: rows = events, columns = channels, each cell the existing square worded ON/OFF toggle. Rows for v1: New comment · Held for review · Reported · Sync failed/stale. Rows greyed "coming later": Suggested mention · New order · New tip.
- Above the grid: **Discord webhook URL** field (masked, with a "Test" secondary button that sends a sample and shows an inline result), and **Admin emails** (chips: add by typing an address, remove ×) — we never silently reuse anyone's Google email.
- Column headers in Silkscreen; row labels 14px 700; a one-line helper under the grid in the site voice.
- Phone: rows stack; toggles stay inline. Desktop + phone mockups.

## 2. "Seen on" — third-party coverage of Oliver's work (v1)
Decided: content stays on its platform (YouTube/Shorts, Twitch clips, TikTok, Reddit, articles); we curate. Manual in v1: Oliver pastes a URL in admin.
Design four surfaces:
- **On each item** (project detail; also skins/art later): a **SEEN ON** row — mention cards = the existing video click-to-load facade + a creator line (creator name 14px 700, platform glyph in a neutral slab using the official mark, view count in Silkscreen emerald, date in mute-dim). Click = embed inline for YouTube (facade behaviour) with an "on YouTube ↗" ghost link; other platforms link out. Show nothing when there are no mentions (no empty state).
- **Home**: an **IN THE WILD** strip — 3–4 featured mentions + a reach line in Silkscreen: "1.2M VIEWS · 6 VIDEOS · 4 CREATORS".
- **A top-level "Seen on" page** aggregating everything: filter row (all / by project / by platform), reach totals up top, then a grid of mention cards each tagged with the project it's about (type badge + title link). Sort newest first.
- **Admin → Mentions**: paste URL → auto-fetched preview card (title, creator, thumbnail, date, views) → assign to a project (or "About OddSense generally") → publish; a table of existing mentions with hide/feature/reorder; and a **Suggested** tab (v1.5) where auto-found candidates wait for approve/dismiss — never auto-published.
- Copy: "Seen on", "In the wild" — the numbers brag, the copy doesn't. Footer gains one dry line: "Creators featuring the mods aren't affiliated with odsens."
- **Nav decision needed from you**: the top nav is getting fuller (Projects · Videos · Skins · Art · Seen on · Support). Propose an order and what collapses on phone.

## 3. Workrooms — private commission spaces (Phase 2, designing ahead)
Decided: a commission (from the Custom Orders form) becomes a **workroom**: a private page for Oliver + the client, reusing the site's existing patterns behind a membership wall. Payment stays on Ko-fi. Safety is structural: **an admin (Oliver's dad) is automatically a member of every workroom, visibly**, as a moderator.
Design:
- **Workroom page** = the project-detail layout with: a **PRIVATE** badge (same construction as the exclusive badge, gold-wash, lock glyph from the icon set — no emoji); header line, honest voice: "Private workroom. Payment happens on Ko-fi. No contracts, no invoices yet."; body = Oliver's **posts** (markdown + gallery, newest first, "WIP" pixel eyebrow); the right rail replaces GET IT with **STATUS** (milestone pills, worded, one accent: BRIEF · QUOTE · IN PROGRESS · REVIEW · DELIVERED · CLOSED — show current + done + upcoming), **FILES** (files table with who-uploaded + kind: brief / WIP / deliverable; download buttons; and an upload well with a **client-upload variant** that prints its limits: png/jpg/webp/zip/txt/md/pdf, 25 MB per file, 200 MB per room), and **PARTICIPANTS** (avatar + handle + role tag; the moderator row reads "MOD · here to keep things safe"). Comments = the standard thread, scoped to members; the composer notes "Only people in this room can see this."
- **States**: brand-new room (only the brief, empty files, a "first update coming" line), active, **review** (a "Mark as done / Ask for changes" pair for the client), delivered (deliverable files pinned top), **closed/read-only** (composer replaced with "This room is closed. Files stay downloadable.").
- **Email updates opt-in**: when a client first enters a room, a small panel: "Get an email when Oliver posts here?" ON/OFF toggle + one line about privacy. Also in the participants rail as a per-person toggle (own row only).
- **Admin → Orders & Workrooms**: list of engagements (client handle, type, status pill, last activity, unread marker), "Open room", "Add participant by handle", "Close room"; order detail (from pass 2) gains a "Create workroom" primary button.
- Phone: rails stack under the posts (Status → Files → Participants → Comments).

## 4. Email + Discord templates
- **Email** (built later with React Email; design it as email-safe): dark-first — ink background, slab card, 0 radius, 2px borders, no shadows/hatch/motion; the `ODSENS` wordmark as an image; display font falls back to Impact/Arial Black and body to Arial (web fonts don't load in Gmail/Outlook); one bulletproof button (gold or indigo); footer with "Manage in Settings" and a dry sign-off. Show three: **New comment** (excerpt, project, handle, "View comment" button), **Held for review** ("Approve" primary + "View" secondary), **Sync failed** (plain, technical, one line of cause). Also a plain-text version of one.
- **Discord embed**: same family — title, project, excerpt, a colour bar (indigo default; gold for held/reported; alert for failures), a "View" link. One image of how each event looks in a Discord channel.

## 5. Supporters leaderboard (Support page — replaces the dashed placeholder)
Decided: **handle + amount**, sorted by total; unlinked tips show as "Anonymous · $X"; only linked or Ko-fi-public tips show amounts. Design the block: top 3 with the avatar + gold accent, then a compact list; a "how to get on the board" line ("Tip on Ko-fi with the same email as your Google sign-in, or put your handle in the message"). Empty state in voice ("Nobody yet. Be first.").

## 6. Small leftovers
- **Handle onboarding**: remove the "looks like a real name / email" rejection state (decided: no name detection). Instead, strengthen the **guidance copy** on the panel — a short block explaining what a handle is for and why not to use a real name — and add the same guidance line to the Privacy page and a "How comments work" page.
- **Privacy page**: add the line that sign-in requires a Google account and Google's age rules apply; we store only handle, optional picture, comments.
- **Versions & Files table**: add a per-version **changelog** — an expander row or a "Changes" link opening the markdown inline.
- **Custom Orders**: the **post-submit confirmation** state ("Sent. I reply in a few days. No promises yet.") and where the person sees their order afterward (a "Your orders" entry in the profile menu).
- **Nav**: apply the order you propose in §2 across all mocks.

## Deliverables
1. Updated design system doc **v1.3** with new components (notification matrix, mention card, reach line, PRIVATE badge, milestone pills, participants row, client-upload well variant, leaderboard row, email/Discord templates) and the corrections above.
2. Mockups desktop + phone: Admin Settings (matrix), Project detail with SEEN ON, Home with IN THE WILD, the Seen on page, Admin Mentions (+ Suggested), Workroom page (active + closed), Admin Orders & Workrooms, Support page with leaderboard, three emails + Discord embeds, Custom Orders confirmation.
3. **CHANGELOG.md** since v1.2, and a **repo-commit/** package laid out exactly like pass 2 (root `DESIGN.md` with `assets/brand/…` paths and all v1.1/v1.2 corrections preserved, `design/README.md` append-only section, `design/claude-design-export/pass-3/…`, `FILE-LIST.txt`, `PULL-REQUEST.md`). Export as a zip; we'll land it in `design/claude-design-export/pass-3/`.

Start with the Workroom page and the Seen on row — show me those first.
