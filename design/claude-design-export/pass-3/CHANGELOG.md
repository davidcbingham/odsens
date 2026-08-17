# Changelog — design pass 3 (since v1.2)

Date: 2026-08-17. Spec: DESIGN.md v1.3, §12. Same Crate Poster direction; nothing existing redrawn.

## Added
- **Seen on** — mention card (facade + creator line), reach line, project-detail SEEN ON row, Home IN THE WILD strip, the Seen on page, Admin → Mentions with paste-URL → preview → publish and a v1.5 Suggested tab (approve/dismiss, never auto-published). Footer line: "Creators featuring the mods aren't affiliated with odsens."
- **Workrooms (Phase 2)** — private commission rooms on the project-detail layout: PRIVATE badge, posts with WIP eyebrows, milestone pills (BRIEF → CLOSED), files with kind tags + client upload well (limits printed), participants rows with a visible MOD, member-scoped comments, five states (new / active / review / delivered / closed), first-entry email opt-in. Admin → Orders & Workrooms list, room controls, CREATE WORKROOM on the order detail.
- **Notifications matrix** — replaces the four admin email switches. Site-level, admin-only, Email + Discord columns, square worded toggles, coming-later rows greyed. Webhook field (masked, Test with inline result) + admin-email chips.
- **Email + Discord templates** — email-safe rules (ink, slab, 0 radius, 2px solid borders, wordmark as image, Impact/Arial Black + Arial fallbacks, one bulletproof button); New comment / Held for review / Sync failed + a plain-text version; Discord embeds with indigo/gold/alert colour bars.
- **Supporters leaderboard** — top 3 cards + compact list, Anonymous rows, how-to line, empty state. Replaces the dashed slot.
- **How comments work** page; per-version changelog expander in Versions & Files; Custom orders post-submit confirmation; "Your orders" in the profile menu.

## Changed
- **Notifications get a character:** everything sends from allay@odsens.com. Emails and the Discord bot speak as the allay (Minecraft's item-delivery mob — it picks things up and brings them to you): "The allay picked this up", "The allay is holding it until you decide", "The allay came back empty-handed." Settings panels read "Where the allay delivers" / "What it picks up". One pending asset: a pixel allay render (email header, Discord avatar, Settings).
- **Nav order decided:** wordmark = Home; Projects · Videos · Skins · Art · Seen on · Commissions; Support stays the gold button; phone collapses everything behind the burger, Support last.
- **Handle rules:** the "looks like a real name / email" rejection is removed — no name detection. Guidance copy on the onboarding panel, Privacy and How comments work does that job.
- **Admin Settings:** "Email me about" section retired in favour of the notifications matrix.
- **Footer:** Site column gains Seen on; second dry line added.

## Unchanged
Palette, type, spacing, radius/border/shadow rules, all v1.1/v1.2 corrections, every existing component.
