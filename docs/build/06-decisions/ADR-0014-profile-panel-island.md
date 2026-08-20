# ADR-0014 — Profile page island and own-row columns

## Status
Proposed

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: addition
- Spec says: `docs/build/03-components.md` C-16 / C-16a — "`'use client'` appears only in the files listed in the machine-readable client-island list below (C-16a), which is the single source of truth"; §2.5 Accounts lists `HandleField`, `AvatarUpload`, `ProfileMenu`, `OnboardingPanel` (no `/profile` form island); `docs/build/_registry.md` Component registry Accounts names the same four + `ViewerProvider`. `docs/build/01-architecture.md` INV-45 / `docs/build/04-server-contracts.md` SC-04 — a user's own `profiles` row is "`id, handle, avatar_path, role, is_banned` … only via `getProfile()` or `ViewerProvider`". 03 §2.10 `AdminShell` `viewer: { handle; role }`; 03 §2.2 `GoogleSignInButton` rest = "`--chalk` fill, `--ink` text, Google mark"; C-08 — "Raw hex outside `tokens.css` = ❌".
- Found: `/profile` (02 `/profile` row; 04 `updateProfile` / `deleteAccount`) needs the same kind of island `OnboardingPanel` is for `/welcome` (`useActionState`, `InlineConfirm`, `Toast`), and `scripts/check-client-islands.mjs` (01 INV-94) fails on `components/accounts/ProfilePanel.tsx` until its C-16a row exists. The proactive 7-day rename line (ADR-0002 #27) needs `profiles.handle_changed_at`, which the own-row select does not carry. The admin header trigger needs the picture; the nav "Sign in" block (N-04) and the chalk button are one component with two looks; the Google mark's brand colours have no token. None of this changes a contract — each item adds a component, a column, a prop, an attribute or a note.
- Related: D1–D5 in `docs/questions.md` S1.1 build notes (2026-08-20) are the design details David still decides; no `Q<nn>` changes · supersedes none.

## Decision
1. `components/accounts/ProfilePanel.tsx` exports `ProfilePanel` (`C`), the `/profile` client island — the `/profile` counterpart of `OnboardingPanel`: `useActionState(updateProfile)`; `deleteAccount({ confirm: true })` runs inside `startTransition`, which drives `InlineConfirm`'s `pending`; `HandleField` (`onValidity`) / `AvatarUpload` (`onChange`) / `InlineConfirm` callbacks; `Toast` "Saved." on success. Props `{ handle: string; avatarUrl: string | null; limitedUntil: string | null }`; `data-state="idle" | "submitting" | "error"`. `limitedUntil` is computed server-side in `app/(public)/profile/page.tsx` from `profile.handle_changed_at` (`lib/format/date.ts` `formatDay`, `'YYYY-MM-DD'`; `null` when not limited) — the panel renders the string, no `Date.now()` in render; `tests/fixtures/ui/profilePanel.ts` passes a fixed string. Rows: `_registry.md` Accounts; 03 §1.4 C-16a; 03 §2.5; 03 §3.
2. `lib/auth.ts` `Profile` type and `PROFILE_COLUMNS` (the `getProfile()` own-row select) = `id, handle, avatar_path, role, is_banned, handle_changed_at` — server-side only. `ViewerProvider` (03 C-17a) keeps the five columns `id, handle, avatar_path, role, is_banned`; the 01 INV-45 grep is unchanged.
3. `AdminShell` `viewer` prop = `{ handle; role; avatarUrl?: string | null }`; `app/admin/layout.tsx` passes the public-bucket URL (same template as `ViewerProvider`) so the header `ProfileMenu` trigger shows the picture.
4. `GoogleSignInButton` renders `data-variant="outlined"` when `label="Sign in"` (the N-04 nav block) and `data-variant="chalk"` otherwise; its `.module.css` selects on that attribute; the state set is unchanged (rest · hover · active · focus · pending — no `failed` state, no client-side error copy). The Google mark is an inline `<svg aria-hidden>` in the TSX whose four fills (`#4285F4`, `#34A853`, `#FBBC05`, `#EA4335`) are Google's brand asset — the one permitted non-token colour source; C-08 (raw hex in `.module.css` = ❌) is untouched and those values appear nowhere else.
5. Additive pass-through props recorded in 03 C-03: `Button` `ref` (React 19 prop) and `aria-describedby`; `AdminShell` `mainLandmark?: boolean` (default `true`); `PixelLabel` `as` gains `'h1'`; `HandleField.onValidity` and `AvatarUpload.onChange` are optional. No §2 prop row is replaced.
6. `safeNext('/admin')` → `/` stands (02 RP-20): after signing in from `AdminGate` (`next="/admin"`, 03 §2.10) the admin lands on `/` and reaches `/admin` via the `ProfileMenu` Admin item. No code change; a different return target (David's question D4) is a later ADR (`Kind: security`) amending RP-20.
7. `/dev/components` renders `InlineConfirm`, the `checking` / `available` states of `HandleField` and the `cropping` state of `AvatarUpload` as static descriptions, because those states need a live action or a real file — the `Toast` precedent (03 §7).
8. `playwright.config.ts` is owned by `test-engineer`: `webServer.env` = every name in `.env.test` as defaults + the shell's values on top + `E2E=1` (05 §1.1 harness note; no rule change).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Give `OnboardingPanel` a `mode="profile"` prop instead of a second island | Two pages, two actions and two state shapes in one component; `OnboardingPanel` takes no props by design (Q34). |
| Let `ViewerProvider` select `handle_changed_at` too | A client-side column nothing renders there; the C-17a shape and the INV-45 grep stay smaller when only the server page reads it. |
| Compute the 7-day date in the client with `Date.now()` | Hydration mismatch and a date in the visitor's clock; the server already holds the row and the fixture needs a fixed value. |
| A second component for the nav "Sign in" block | One `signInWithOAuth` + `track('sign_in')` path (ADR-0002 C3); a `data-variant` attribute is the `Button` / `PixelLabel` precedent. |
| Google mark as an image file under `public/` | The brand colours would still be non-token, plus an extra request for an 18px mark; an inline `aria-hidden` SVG is the smallest form. |

## Consequences
- Positive: `scripts/check-client-islands.mjs` passes with the 03 list as the single source of truth; the 7-day line is server-computed and testable with a fixed date; the admin header shows the picture; both looks of the sign-in button are selectable in CSS without a second component.
- Negative: the server `Profile` and the client `ViewerProvider` shape now differ by one column — readers must know `handle_changed_at` never crosses to the client; an admin signing in from the gate makes one extra click (D4).
- Follow-ups: D1–D5 → David (`docs/questions.md` S1.1 build notes; a change = `Kind: design` ADR, D4 = `Kind: security` ADR) · S1.4 `ModActionRow` / comment delete reuse `InlineConfirm` under the same static-preview rule → `test-engineer`, `design-fidelity`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/_registry.md` | Component registry, Accounts line | `ProfilePanel` added (contains the string ADR-0014) |
| `docs/build/03-components.md` | §1.1 C-03 | S1.1 additive props: `Button` `ref` / `aria-describedby`, `AdminShell.mainLandmark`, `PixelLabel as="h1"`, optional `HandleField.onValidity` / `AvatarUpload.onChange` (contains the string ADR-0014) |
| `docs/build/03-components.md` | §1.2 C-08 | exception: the Google mark's inline SVG brand fills in `GoogleSignInButton.tsx` are the one non-token colour source (contains the string ADR-0014) |
| `docs/build/03-components.md` | §1.4 C-16a client-island table | row `components/accounts/ProfilePanel.tsx` · `ProfilePanel` (contains the string ADR-0014) |
| `docs/build/03-components.md` | §2.2 `GoogleSignInButton` row | `data-variant="outlined"` / `"chalk"` sentence (contains the string ADR-0014) |
| `docs/build/03-components.md` | §2.5 Accounts table | new `ProfilePanel` row (contains the string ADR-0014) |
| `docs/build/03-components.md` | §2.10 `AdminShell` row | `viewer.avatarUrl?: string \| null` (contains the string ADR-0014) |
| `docs/build/03-components.md` | §3 State vocabulary | `ProfilePanel` row `idle` \| `submitting` \| `error` (contains the string ADR-0014) |
| `docs/build/03-components.md` | §7 Preview / story approach | live-state exception note for `InlineConfirm` / `HandleField` / `AvatarUpload` (contains the string ADR-0014) |
| `docs/build/03-components.md` | §12 Changelog; `Status:` line | new row; appended "— amended by ADR-0014 (2026-08-20)" (README ADR-R2) |
| `docs/build/01-architecture.md` | §10 INV-45 | own-row column list + `handle_changed_at` in the server-side `getProfile()` select only (contains the string ADR-0014) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0014 (2026-08-20)" (README ADR-R2) |
| `docs/build/04-server-contracts.md` | §0 SC-04 | `getProfile()` own-row columns incl. `handle_changed_at`; `ViewerProvider` keeps five (contains the string ADR-0014) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0014 (2026-08-20)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §1.1 Tooling — harness note | `playwright.config.ts` ownership + `webServer.env` composition (contains the string ADR-0014) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0014 (2026-08-20)" (README ADR-R2) |
| `docs/build/00-build-plan.md` | §6 Changelog | new row "ADR-0014 — profile page island and own-row columns" (contains the string ADR-0014) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0014 (2026-08-20)" (README ADR-R2) |
| `docs/questions.md` | S1.1 build notes | ADR list line names ADR-0014; "David to decide" list D1–D5 (contains the string ADR-0014) |
| `docs/spec.md` | Revision log 2026-08-20 line | ADR-0014 named (contains the string ADR-0014) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0014 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `components/accounts/ProfilePanel.tsx` is on the C-16a list, in `_registry.md` Accounts and in 03 §2.5 / §3; `lib/auth.ts` own-row select = the six columns of Decision 2; this ADR listed under `## ADRs in this PR` |
| frontend-reviewer | `node scripts/check-client-islands.mjs` exits 0 (the `ProfilePanel` row is present); `limitedUntil` is a string prop — no `Date.now()` / `new Date()` in `ProfilePanel` render; `deleteAccount` runs inside `startTransition`; `data-variant` is the only look switch in `GoogleSignInButton` |
| design-fidelity-reviewer | `GoogleSignInButton` `[data-variant="outlined"]` = the N-04 nav block and `[data-variant="chalk"]` = the DESIGN.md §5 chalk button, same state set; the four Google brand hexes appear only as inline SVG fills in `GoogleSignInButton.tsx` (brand asset) — raw hex in any `.module.css` is still ❌ (C-08) |
| security-reviewer | `handle_changed_at` is selected only in `lib/auth.ts` (server); `components/accounts/ViewerProvider.tsx` still selects exactly `id, handle, avatar_path, role, is_banned`; the INV-45 grep is unchanged and still empty |
| backend-reviewer, supabase-reviewer, deploy-checker | none |
