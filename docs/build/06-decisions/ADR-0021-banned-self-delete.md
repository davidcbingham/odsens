# ADR-0021 — Banned accounts may delete themselves

## Status
Accepted (2026-08-27 — merged with PR #3 / superseding squash in the S1.2 v0.3 merge)

## Date
2026-08-27

## Slice
S1.1 (follow-up PR `fix/S1.1-banned-delete`)

## Context
Kind: product (David's merge-time decision) with a security seam
- Spec says: `docs/build/04-server-contracts.md` SC-05 (as amended by ADR-0019) — "Banned check: **every user action** returns `error.code='banned'` …"; 04 §1.1 `deleteAccount` Returns — "`banned` (ADR-0019 — a banned account cannot delete itself; removal under a ban is an admin act)"; ADR-0019 Consequences carried the same line.
- Decided (David, 2026-08-21, on merging S1.1 / PR #2 — recorded as the ADR-0019 dated follow-up and in `docs/questions.md`): **banned accounts may delete themselves** — "`deleteAccount` allowed for banned callers (`requireOnboarded` gains an opt-in that skips the ban check for that one action; D4's 'every user action' becomes 'every user action except `deleteAccount`') and the Delete account control (inline confirm) lands on `/banned`; recorded as its own ADR when built."
- Related: ADR-0019 (the `/banned` page, SC-05 "every user action", proxy M4b — all otherwise unchanged) · ADR-0020 (the DB guard is a BEFORE **UPDATE** trigger and the delete path is service-role throughout — no schema change is needed here) · ADR-0017 (leave with a document navigation) · ADR-0018 (delete signs the browser out) · supersedes nothing.

## Decision
1. **`lib/auth.ts`** — `requireOnboarded(opts?: { allowBanned?: boolean })`: `{ allowBanned: true }` skips the ADR-0019 ban check (`assertNotBanned`); everything else — strict own-row read, `unauthenticated`, `onboarding_required`, the return shape — is identical, and 04 SC-04's export set is unchanged (an optional parameter, not a new export). `requireUser()` is untouched.
2. **`deleteAccount`** (`lib/actions/accounts.ts`) calls `requireOnboarded({ allowBanned: true })` — the only caller of the opt-in. SC-05 becomes "**every user action except `deleteAccount`**". Rate limit (1 / day), avatar removal (`deleteAvatarQuietly`, service role), `auth.admin.deleteUser` cascade, local cookie sign-out: all unchanged. **No migration**: `profiles_guard` (ADR-0020) binds UPDATEs by the banned account's own JWT; the delete is `auth.admin.deleteUser` (service) + FK cascade, which the guard never sees.
3. **The onboarding check stays.** A banned account whose `handle` is still NULL gets `onboarding_required` as before: it has nothing of its own to delete (no handle, no avatar — later no comments), it cannot onboard while banned (ADR-0019 D4), and its removal remains an admin act (ADR-0019 Consequences). The opt-in widens exactly what David decided, nothing more.
4. **UI** — new client island `components/accounts/BannedDelete.tsx` (+ `.module.css`), rendered inside the `/banned` slab **only when `viewer.profile.handle !== null`** (Decision 3 — never a dead-end control): the `/profile` Delete account trigger look (2px `--danger-line` bordered button, `--danger` text) + `InlineConfirm` (§11.2 danger strip; same question and labels as `/profile`: "Delete your account? Your handle, picture and comments go with it." / "Delete it" / "Keep it") + an inline `role="alert"` error line. On success it leaves with a **document navigation** (`window.location.assign('/')`): the onboarding shell mounts no `ViewerProvider` to notify and a full load lands anon with nothing stale (the ADR-0017 lesson); the action already cleared the auth cookies. 03 C-21 kept `/banned` page markup in the route file — an interactive control needs a client island, so the component is registered in `_registry.md` (Accounts row).
5. **Tests** (no new IDs): 05 **T-ACT-65** banned cell → **A** — factory banned user with an avatar: object removed, `auth.users` row + profile gone, cookies cleared, one `delete_account` hit; banned with a NULL handle → **D `onboarding_required`** (auth user survives, no hit); the seed-banned refusal case is dropped (the behaviour it froze is gone, and a deletable `seed_banned` must never actually be deleted — factories cover both sides). 05 **T-E2E-32** banned flow: `main`'s one control is Delete account (count assertions updated: two buttons on the page — shell Sign out + slab Delete account); new delete leg on a **factory** banned user (`Keep it` closes the strip; `Delete it` → anon `/`, auth cookies gone, the dead session cannot re-enter `/banned`; axe re-run with the strip open) and a NULL-handle case (no control in `main`). Proxy T-ACT-10 is unchanged (M3b already passes Server Action POSTs; M4b never blocked them).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Opt-out at `requireUser` level too (banned + un-onboarded may delete) | Expands the decision beyond what David made; an un-onboarded account has nothing of its own to delete and `/welcome` already offers Sign out; removal stays an admin act (ADR-0019). |
| A separate service-path "delete banned account" action | A second code path for the same effect — one action, one rate limit, one test matrix is the point of the opt-in. |
| Router navigation after delete (the `ProfilePanel` pattern) | `/banned`'s shell has no `ViewerProvider` to notify and a soft navigation can replay prefetched answers (ADR-0017); a document navigation is the simpler correct exit. |
| Show the Delete control to NULL-handle banned accounts too | The action would answer `onboarding_required` — a control that can only fail. |
| Skip the ban check inside `deleteAccount` itself (call `getProfile()` + hand-rolled checks) | Re-implements `requireOnboarded`'s strict-read semantics in one action; the opt-in keeps the seam in `lib/auth.ts` where every gate already looks. |

## Consequences
- Positive: a ban no longer forces a person to keep the account — self-serve deletion under a ban (the right default for a minor's audience); no schema change; `profiles_guard` still freezes every own-row UPDATE while banned; one seam, one exception, named in SC-05.
- Negative: a banned account can now record `delete_account` rate-limit hits (1 / day — harmless); SC-05 carries an exception future actions must not copy without their own ADR (S1.4 comment actions still refuse banned callers); `/banned` now has interactive UI, so its axe/a11y surface is real (covered in T-E2E-32).
- Follow-ups: unchanged from ADR-0019 — S1.4 `banUser` session-revocation decision; deleting a banned account's data on request (`docs/questions.md`).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/04-server-contracts.md` | SC-05 | "every user action **except `deleteAccount`**" + the opt-in named (contains the string ADR-0021) |
| `docs/build/04-server-contracts.md` | §1.0 actions table `deleteAccount` row; §1.1 `deleteAccount` Trigger / Auth / Returns | auth guard = `requireOnboarded({allowBanned:true})`; trigger gains the `/banned` control; `banned` removed from the error list (contains the string ADR-0021) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0021 (2026-08-27)" (README ADR-R2) |
| `docs/build/02-routes-and-pages.md` | §1.2 `/banned` row | components cell gains `BannedDelete` (onboarded banned only) (contains the string ADR-0021) |
| `docs/build/03-components.md` | §1.4 C-16a machine list; §2.5 `BannedDelete` row; §3 states row; §10 changelog | the new client island registered (`scripts/check-client-islands.mjs` reads the list); fixture `tests/fixtures/ui/bannedDelete.ts` + `/dev/components` specimen (contains the string ADR-0021) |
| `docs/build/03-components.md` | `Status:` line | appended "— amended by ADR-0021 (2026-08-27)" (README ADR-R2) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0021 (2026-08-27)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §7.2 T-ACT-65; §7.3 T-E2E-32 | banned cells → A / `onboarding_required`; the delete leg + control counts (contains the string ADR-0021) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0021 (2026-08-27)" (README ADR-R2) |
| `DESIGN.md` | header (v1.5); §11.3 #19 | the slab gains the Delete account control (inline confirm; onboarded banned only) (contains the string ADR-0021) |
| `docs/build/_registry.md` | Component registry Accounts row | `BannedDelete` (C) (contains the string ADR-0021) |
| `docs/build/00-build-plan.md` | §6 Changelog; `Status:` line | new row; Status appended (contains the string ADR-0021) |
| `docs/questions.md` | S1.1 notes 2026-08-21 merge-decision line | done marker naming this ADR |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0021 |

## Gate impact
| Gate | Now checks |
|---|---|
| security-reviewer | the `allowBanned` opt-in is passed by exactly one caller (`grep -rn "allowBanned" lib app components` → `lib/auth.ts` + `lib/actions/accounts.ts` `deleteAccount`); every other action still answers `banned` (T-ACT-1/4/7 banned cells unchanged); `BannedDelete` initiates no network beyond the `deleteAccount` Server Action call (01 INV-09); no schema change |
| backend-reviewer | `deleteAccount` still: rate limit after auth, avatar delete under `isOwnAvatarPath`, `auth.admin.deleteUser`, local sign-out; the opt-in changes only the ban check; T-ACT-65 banned = A with the full effect list |
| frontend-reviewer | `BannedDelete` is a `'use client'` island receiving no props and reading nothing (its one network call is the action); the page still renders it conditionally server-side; document navigation on success; axe clean with the strip open |
| design-fidelity-reviewer | the control matches `/profile`'s Delete account trigger (2px `--danger-line`, `--danger` text, 44px min height) + the §11.2 `InlineConfirm` strip; tokens only; DESIGN.md v1.5 §11.3 #19 |
| spec-drift-reviewer | 04 SC-05 / §1.0 / §1.1, 02 §1.2, 05 T-ACT-65 / T-E2E-32, DESIGN.md §11.3 #19, `_registry.md`, 00 §6 carry ADR-0021; this ADR listed under `## ADRs in this PR` |
| supabase-reviewer, deploy-checker | none (no schema, policy or deploy change) |
