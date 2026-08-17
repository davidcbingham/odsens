# Claude Design — Pass 2 prompt (paste everything below the line into the existing odsens Design project)

---

Back for a second pass on the odsens design system. My dad and I reviewed the v1 handoff (`DESIGN.md`) against the site's functional spec. The system itself is solid — keep the Crate Poster direction, palette, type, and components exactly as they are. This pass is about **filling coverage gaps and fixing a few consistency issues**. Same rules as before: no personal info anywhere, phones + desktop, playful-cartoony through shape and copy, readable over flashy, no framework/code.

## Small corrections to bake into the system (already decided)
1. Add a token **`--alert #CC3A2A`** and use it for the notification-badge fill and any red/alert fills (the old `#E1493B` failed contrast with white small text).
2. Type minimums: Bungee is 16px+ for titles; 12–15px is allowed **only** for button / filter / support-button labels. Silkscreen floor is **10px**, and **≥11px** whenever the label carries information (download counts, HELD FOR REVIEW, unread count).
3. Note in the system that the three fonts will be self-hosted (no CDN).
4. Correct the contrast note: `--indigo` text on `--ink` is 2.8:1 (not 3.2) — still "never".

## New screens / states to design (the gaps)

### 1. Handle onboarding (first sign-in) — most important
After "Continue with Google", the user must pick a handle before they can do anything.
- Panel: Bungee title, one dry line ("Pick a handle. It's all anyone will ever see."), handle field, optional profile picture (upload → square crop, or "skip"), and a "Done" primary button.
- Handle rules shown as helper text: 3–20 characters, letters/numbers/underscore, unique. Don't accept things that look like a real name/email.
- States: available ✔ (emerald), taken ("Taken. Try another."), invalid characters, too short/long, checking… (subtle). Picture states: empty, uploading, error ("That didn't upload. Try again?"), done.
- Also design the tiny **profile menu** in the nav after sign-in (handle + picture, "Change handle/picture", "Sign out") and a minimal **Your profile** panel where they can edit those two things.

### 2. Comment thread — actions and edge states
Extend the comment bubble/reply components with:
- Own comment: **Edit** and **Delete** (ghost actions; delete asks once, inline, plain words).
- Anyone: **Report** (ghost; opens a tiny inline reason picker: spam / rude / other; confirms with one line).
- Moderator view (OddSense/mods only): inline **Hide**, **Approve** (for held), **Ban user** — small outlined actions, one accent max, danger styling for Ban. A subtle "MOD" Silkscreen tag on their own comments.
- States: **banned user** trying to comment ("You can't comment here." — no lecture), **comments closed** on a project, **hidden comment** placeholder in the thread ("Hidden by a moderator."), **empty thread** ("No comments yet. Say something."), composer error state, and a **comment count** in the project header.
- Deleted comment with replies: keep the slot, "Deleted." in mute.

### 3. Admin — Settings, upload states, Stats, Orders
- **Settings page**: moderation mode toggle (Auto-publish signed-in users / Hold first-time commenters), notification toggles (new comment, new reply to me, new order, new tip — on/off each), moderator list (handles with role user/mod/admin, add by handle, remove), and a Ko-fi section (page name, webhook status LIVE/NOT SET). Toggles are square, worded ON/OFF, never colour-only.
- **File-upload well** states: idle (dashed), drag-over, uploading with progress, done (file name + size + remove), error (too big / wrong type — plain words), and the size/type limits printed under it.
- **Stats tab** (simple): four stat tiles (downloads this week, all-time, comments, tips) + one flat bar chart of downloads over the last 30 days per source (Modrinth / CurseForge / direct). Same flat 2px-edge style; no gradients.
- **Orders**: list table (handle, type, date, status NEW/REPLIED/CLOSED) and a detail view showing the request with a "Reply by email" action and a status selector.
- **Admin sign-in gate**: a plain "Admins only" panel with the Google button and nothing else.

### 4. Global states
- **404** page ("That page doesn't exist. Probably never did." + a link home and to Projects).
- **Generic error** page.
- **Loading skeletons** for the project card grid, project detail header/gallery, and comment thread — flat slab blocks, no shimmer gradient (a slow opacity pulse is fine).
- **Empty states**: no videos, no skins yet, no art yet, no orders (admin), no notifications.
- **Toast / inline confirmation**: "Comment posted.", "Saved.", "Copied." — slab with 2px line, gold left bar, auto-dismiss, bottom-left so it doesn't fight the support button.

### 5. Privacy page + footer links
- A short **Privacy** page in the site's voice: what we store (Google account ID for sign-in only, your handle, optional picture, your comments), what we never show (real name, email), how to delete your account. Plain headings, no legalese.
- Add **Privacy** and **How comments work** to the footer "Site" links.

### 6. Support panel — implementation-aware version
Ko-fi's embeddable panel is an iframe with Ko-fi's own look; we can't restyle it. Design the Support section so our $1/$3/$5/Other picker is a **wrapper**: pick an amount → a "Continue on Ko-fi" primary (gold) button opens Ko-fi's panel/overlay. Show what the Ko-fi panel slot looks like inside our slab (a labelled placeholder is fine). Keep the "What it pays for" copy and the reserved supporters-wall slot.

### 7. Video embeds
Add a **click-to-load facade** for videos: thumbnail with a flat play button and duration chip; the YouTube player only loads on click. Same for the "Up next" list.

## Questions I'll answer inline if you ask
- Card borders: keep the quiet `--line` outlines or lift them a bit for visibility?
- Keep the user notification bell/inbox in v1?
- Show YouTube Shorts on the Videos page?

## Deliverables
1. Updated design system doc (v1.2) with the corrections above and any new components (handle field, toggle, toast, skeleton, upload well, stat tile, facade).
2. Mockups (desktop + phone) for: Handle onboarding, Comment thread with all states, Admin Settings, Admin Stats, 404, and one skeleton page.
3. A short **changelog** of what changed since v1.
4. Export a **handoff bundle for Claude Code** again — we'll drop it into `design/claude-design-export/pass-2/`.

Start with the handle-onboarding panel and the comment-thread states — show me those first.
