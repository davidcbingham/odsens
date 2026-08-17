# PR: Design pass 2 — DESIGN.md v1.2 + coverage screens

Branch: `design/pass-2` → `main`
Commit message: `Design pass 2: DESIGN.md v1.2, new screens (onboarding, comment states, admin settings/stats, global states)`

Design files only. No app scaffold, no framework, no build config. Nothing deleted or renamed; `docs/`, `assets/brand/`, `README.md`, `CLAUDE.md`, `.env*` and the pass-1 export are untouched.

## Screens added

- **Handle onboarding** (first sign-in, blocking) — desktop + phone. Handle field with every state: resting, checking, available, taken, invalid characters, too short/long, looks-like-a-real-name, looks-like-an-email; DONE disabled until valid.
- **Picture upload** — empty, uploading, error, done, plus the square crop step.
- **Profile menu** in the nav (handle + picture, change handle/picture, sign out) and a minimal **Your profile** panel with Delete account.
- **Comment thread** — desktop + phone, mixed live states, and every action/edge state: edit, delete (asks once inline), report with reason picker, moderator row (Approve / Hide / Ban user), ban confirm, banned user, hidden comment, deleted-with-replies, comments closed, empty thread, composer error, comment count in the header, `MOD` tag.
- **Admin Settings** — moderation mode, four email switches, moderator list with roles, Ko-fi page + webhook status. Desktop + phone.
- **Admin Stats** — four stat tiles + flat stacked 30-day bar chart by source. Desktop + phone.
- **Admin Orders** — list table with status filters, plus detail view with Reply by email and a status selector.
- **Admin sign-in gate** — "Admins only" and the Google button, nothing else.
- **404** (desktop + phone) and **generic error**.
- **Loading skeletons** — project grid, project detail header/gallery, comment thread. Desktop + phone.
- **Empty states** — videos, skins, art, filtered projects, admin orders.
- **Privacy page** + footer with `Privacy` and `How comments work` added to the Site column.
- **Support wrapper** — our amount picker + "Continue on Ko-fi", with a labelled slot showing where Ko-fi's own iframe renders.
- **Video facades** — click-to-load thumbnails with duration chips, for the main player, "Up next", and the new Shorts row.

## Components added to the spec (§11.1)

Handle field · square toggle (worded ON/OFF) · picture upload + square crop · toast · loading skeleton · file-upload well · stat tile · flat stacked bar chart · video click-to-load facade · profile menu · moderator action row.

## Corrections applied

- `--orange #E8762A` added; **source colours are now fixed app-wide**: Modrinth green (`--emerald`), CurseForge orange (`--orange`), direct/odsens indigo (`--indigo-lift`).
- **Card and panel outlines lifted** from `--line #263242` to `--line-soft #2C3A4B`; `--line` stays for internal dividers and footer strips.
- **User notification bell cut from v1** — no user inbox in the first release; admin gets email instead. The v1.1 bell spec stays in git history.
- **Shorts row added** to Videos.
- **Mod actions are contextual** — always on held and reported comments, otherwise behind a square `Moderate ON/OFF` toggle.
- v1.1 corrections preserved verbatim: `--alert #CC3A2A`, Bungee/Silkscreen minimums, self-hosted fonts, indigo-on-ink 2.8:1.

## New source art

None. Every image in `pass-2/assets/` is an existing file from `assets/brand/` (avatar, art, skins, thumbnails), copied so the prototypes render. Nothing new to place.

## Open questions

- **3D skin renders** — Skins slots are still labelled placeholders. Needs skinview3d (or equivalent) at build time reading `assets/brand/skins/skin-*.png`, plus a cached bust render per skin.
- **Project icons and in-game screenshots** — still missing; reserved slots in the mockups.
- **Ko-fi webhook** — the Settings panel shows `LIVE` / `NOT SET`, but what we do on a tip event (supporters wall entry? nothing?) isn't decided. Supporters wall is still a reserved dashed slot.
- **Handle validation** — "looks like a real name / email" is designed as a rejection with a plain-words reason; the actual heuristic is a build decision.
- **Comment limits** — the composer error shows "One link per comment" and a 1000-character counter as placeholders; real limits not set.
- **Under-13 line** on the Privacy page ("don't sign in") needs your call before it ships.

## Files I wasn't sure where to put

- `CHANGELOG.md` went inside `design/claude-design-export/pass-2/` (it documents the pass, not the repo). Move it to `design/` if you'd rather it sat one level up.
- `github.md`, `support.js` and `.thumbnail` are export metadata/runtime — copied in per the pass-1 convention.
- Pass-1 files (`Direction A/B/C`, `odsens Design System`, `Screens - Core`, `Screens - Sections`) are duplicated into `pass-2/` unchanged, so the folder is a self-contained snapshot. Say the word and I'll drop them from `pass-2/` and let the pass-1 folder carry them.
