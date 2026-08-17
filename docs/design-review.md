# DESIGN.md v1 — Review Pass (2026-08-16)

Reviewed repo-root `DESIGN.md` (Crate Poster) against WCAG contrast (computed, not eyeballed), mobile rules, and
component coverage vs `docs/spec.md`. **Verdict: strong, buildable, on-brief.** Small factual fixes were applied
directly to `DESIGN.md` (listed in §D). Design *decisions* are left to Oliver and logged as questions.

## A. Contrast — computed results (WCAG AA: 4.5:1 text, 3:1 large text / UI)

All prescribed text pairs pass, most comfortably:

| Pair | Ratio |
|---|---|
| chalk on ink / slab / raised | 16.5 / 14.8 / 13.0 |
| mute on ink / slab / raised | 7.8 / 7.1 / 6.2 |
| mute-dim on ink / slab / foot (captions) | 5.2 / 4.7 / 5.0 |
| gold on ink / slab (section titles) | 11.9 / 10.7 |
| indigo-lift on ink / slab / raised (links) | 6.1 / 5.5 / 4.8 |
| white on indigo / hover / deep (primary button states) | 6.7 / 5.3 / 10.8 |
| gold-ink on gold (gold button, exclusive badge) | 10.1 |
| emerald on ink / foot / slab (download counts) · ink on emerald (Approve) | 7.2 / 6.9 / 6.5 · 7.2 |
| Type badges: mod / datapack / resource pack / plugin | 8.1 / 7.8 / 8.6 / 11.8 |
| danger on slab / ink | 6.5 / 7.3 |
| ink on indigo-lift (selected chip, liked) | 6.1 |
| Light theme: text / indigo / gold-text on paper | 15.6 / 7.6 / 4.8 |
| Focus ring gold vs ink / slab / indigo | 11.9 / 10.7 / 4.3 (≥3 ✅) |

Flags:
1. **Notification badge** `#E1493B` with white 9px text = **4.02** (< 4.5 for small text). → Fixed: token `--alert #CC3A2A` (4.99 white-on, 3.4 vs slab). *(applied)*
2. **Disabled button** text/fill = 2.55. Acceptable (WCAG exempts disabled controls) — noted, no change.
3. **`--indigo` on `--ink`** is **2.77**, not 3.2 as stated. Rule ("never") stands; number corrected. *(applied)*
4. **Card boundaries are low-contrast by design**: slab vs ink 1.1, `--line` vs slab 1.3, even `--line-strong` vs slab 1.8. WCAG 1.4.11 (3:1 for UI boundaries) applies when the boundary is *needed* to identify a control. Cards are whole-card links; hover/focus states are strong (gold ring 10.7). Low risk, but **question for Oliver:** keep the quiet borders (moody, on-brief) or lift `--line` toward ~`#3A4759`+ for card outlines?

## B. Typography / sizing consistency
5. **Bungee "never below 16px"** vs primary button "Bungee 14–15px", filter buttons "Bungee 12px", floating support "Bungee 13px". → Rule reworded to "never below 12px, and below 16px only for button/filter labels". *(applied)*
6. **"Never below 13px anywhere"** vs Silkscreen 9–11px labels and the 9px badge count. Silkscreen is exempted as "short uppercase labels", fine — but 9px is at the edge of legibility on phones. **Suggest 10px floor**, and anything that carries information a user needs (download counts, "HELD FOR REVIEW", unread count) at ≥11px. → Floor set to 10px in §2/§9; ≥11px guidance added. *(applied — Oliver may veto)*
7. Google Fonts are referenced by CDN. **Self-host** the three faces (privacy, speed, no third-party request). Build-time note added to §2. *(applied)*

## C. Coverage vs functional spec — gaps to close (design decisions, not applied)
8. **Handle onboarding** — spec requires first-sign-in "choose handle + optional picture". Copy is present in the Sign-in prompt, but there is **no screen/component**: handle field with rules (unique, allowed characters, no real names), availability check states, picture upload/crop, "skip picture" path. **Needs a mockup.**
9. **User notifications** — the design introduces a **notification bell for signed-in users** (replies, likes, approvals). The spec only had notifications *to Oliver*. This is a real feature (per-user inbox, read state). **Decision:** keep (nice; moderate build) or drop from v1? Logged for the Notifications design session.
10. **Comment actions missing**: edit/delete own comment, report/flag, moderator inline actions (hide / ban) in the public thread, "you're banned / commenting closed" state, comment count in project header, composer empty/error states.
11. **Version changelog** — schema has a changelog per version; the VERSIONS & FILES table has no changelog cell/expander.
12. **Admin — Settings** page has no design (moderation mode toggle, notification toggles, moderator list, Ko-fi/webhook config). Also missing: Orders detail view, sync status / **Stats** tab (see `docs/analytics-options.md`), ban list, file-upload well states (progress, error, size/type limits), admin sign-in gate.
13. **Support panel feasibility** — the $1/$3/$5 picker is drawn as native UI with "Ko-fi handles the payment". Ko-fi's embeddable panel is an **iframe with Ko-fi's own UI**; it can't be restyled. Likely implementation: our picker → opens Ko-fi's overlay/panel (or the Ko-fi page with the amount preselected if URL params allow). Verify Ko-fi preset-amount support before promising "1–2 clicks"; otherwise the mock is a wrapper around the Ko-fi panel.
14. **Custom Orders** — should require sign-in (spam), and note age/commission expectations copy is good. Not in mock: post-submit confirmation state, and where orders appear for the user.
15. **Global states**: 404, loading skeletons (cards, gallery), generic error page, toast/inline success ("Comment posted"), empty states beyond Projects (no comments yet, no videos, no skins).
16. **Privacy page** — Google's OAuth consent screen wants a privacy-policy URL for a production app; footer "Site" links should include **Privacy** (and probably a short "How comments work" page). Copy fits the voice.
17. **YouTube Shorts** — Videos page assumes long-form; decide whether Shorts appear (separate rail? excluded?).
18. **Hero** — design chose a featured-project takeover with the avatar in a strip, not the 3D skin from the seed prompt. Fine — the 3D skin lives on Skins. Just confirming it's deliberate.
19. **Third-party embeds & cookies** — YouTube and Ko-fi iframes set cookies. Use `youtube-nocookie.com`; consider click-to-load facades (poster + play button) that also match the flat aesthetic and speed up pages. No consent banner needed for Vercel Analytics.

## D. Edits applied to `DESIGN.md`
- Corrected indigo-on-ink ratio (3.2 → 2.8).
- Added `--alert #CC3A2A` token; notification badge and destructive fills use it (was `#E1493B`).
- Reworded Bungee minimum size; set Silkscreen floor to 10px with ≥11px for informational labels.
- Added self-hosting note for fonts.
- Bumped header to v1.1 with a change note.

## E. Suggested next steps
1. Oliver answers #4, #9, #17, #18 (quick) — see `docs/questions.md` #28–31.
2. Second Claude Design pass for the missing screens: **handle onboarding**, **comment actions/states**, **admin Settings + upload states**, **404/empty/loading**. Re-export → `design/claude-design-export/<date>/`.
3. Verify Ko-fi preset-amount / overlay behaviour (#13) when the account exists.

---
## Pass 2 outcome (2026-08-17)
All items in §C were addressed in `DESIGN.md` v1.2 / `design/claude-design-export/pass-2/`: handle onboarding + profile (8), bell cut from v1 (9), comment actions/states (10), admin Settings/Stats/Orders/upload states/gate (12), Ko-fi wrapper (13), 404/error/skeletons/empty/toasts (15), Privacy page + footer links (16), Shorts row (17), video facades (19). Item 11 (per-version changelog in the files table) and 14 (Custom Orders confirmation state) were **not** explicitly covered — carry to build or a pass 3. New open items → `docs/questions.md` #33–37.
