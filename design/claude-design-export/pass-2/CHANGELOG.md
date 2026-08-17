# odsens design system — changelog

## v1.2 — pass 2 (August 2026)

### Corrections to v1
- **New token `--alert #CC3A2A`** for red/alert fills behind white micro-text. The old `#E1493B` failed contrast and is retired.
- **Type minimums tightened.** Bungee titles are 16px+; 12–15px Bungee is allowed only on button / filter / support-button labels. Silkscreen floor is 10px, and ≥11px whenever the label carries information (download counts, HELD FOR REVIEW, unread counts, statuses).
- **Fonts are self-hosted** woff2 — Bungee, Space Grotesk, Silkscreen. No font CDN.
- **Contrast note fixed:** `--indigo` text on `--ink` is 2.8:1, not 3.2:1. Still never.

### Decisions taken this pass
- **Card and panel outlines lifted** one step from `--line #263242` to `--line-soft #2C3A4B`. `--line` stays for internal dividers and footer strips.
- **User notification bell cut from v1.** No user inbox in the first release; the admin gets email instead. Spec kept for later, re-coloured to `--alert`.
- **Source colour coding fixed app-wide:** Modrinth green (`--emerald`), CurseForge orange (new `--orange #E8762A`), direct green→indigo (`--indigo-lift`).
- **Shorts row added** to the Videos page (9:16 facades, own row under the long-form grid).
- **Mod actions are contextual:** always shown on held and reported comments, otherwise behind a square `Moderate ON/OFF` toggle.

### New components
Handle field (with all validation states) · square toggle (worded ON/OFF) · picture upload + square crop · toast · loading skeleton · file-upload well · stat tile · flat stacked bar chart · video click-to-load facade · profile menu · moderator action row.

### New screens
Handle onboarding · Your profile · comment thread action and edge states (edit, delete, report, hide, ban, banned, closed, deleted-with-replies, empty, composer error) · Admin Settings · Admin Stats · Admin Orders (list + detail) · Admin sign-in gate · 404 · generic error · loading skeletons · empty states · Privacy · support wrapper around Ko-fi's panel.

### Unchanged
Crate Poster direction, palette, three-face type system, spacing and depth rules, iconography, project cards, gallery, filter bar, nav, footer structure, voice and tone, motion, accessibility checklist.
