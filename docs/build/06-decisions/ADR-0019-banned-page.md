# ADR-0019 — Banned accounts land on `/banned`

## Status
Proposed

## Date
2026-08-21

## Slice
S1.1

## Context
Kind: security
- Spec says: `docs/build/04-server-contracts.md` SC-05 — "Banned check: any action that inserts on behalf of a user (`postComment`, `editComment`, `toggleLike`, `reportComment`) returns `error.code='banned'` when `profiles.is_banned = true`, before touching the DB."; 04 §1.1 `completeOnboarding` Preconditions — "Session valid; not banned is not checked (a banned account may still finish onboarding so it can be identified)."; `docs/build/02-routes-and-pages.md` §3 M4 — "Authenticated → read `profiles.handle` for `user.id` (one query)" and no rule at all for a banned session; `DESIGN.md` §11.2 — the only banned surface is the comment composer slab "You can't comment here."
- Found (David's preview review, 2026-08-21): "When a user is banned, that user's Google login directs them to a banned page with no functionality." As built, a banned account signed in to a normal site — full nav, `/profile` with rename, picture and Delete account, `/welcome` if the handle was still null; the ban would only have bitten at S1.4's comment actions. The security gate (round 2, open item 3 in `docs/questions.md`) had already asked whether a ban should freeze the handle and picture (ban evasion by renaming on existing comments).
- Related: `docs/questions.md` S1.1 notes (2026-08-21 preview review item 5; security open item 3) · ADR-0009 (proxy rules M1–M8, M3b) · ADR-0002 C4 / DESIGN.md §11.3 #18 (the admin gate, the visual sibling) · supersedes none.

## Decision
1. **Route `/banned`** — `app/(onboarding)/banned/page.tsx` (+ `page.module.css`), `dynamic`, `robots: { index: false, follow: false }`, title `Banned` ("Banned — odsens"). `getViewer()`: anon → `redirect('/')`; signed in and not banned → `redirect('/')`; banned → the page. It lives in the `(onboarding)` route group on purpose: that layout is the minimal shell — wordmark + the Sign out POST form (01 INV-17) — which is exactly "no functionality" except leaving. No new component (03 C-21: page-level markup stays in the route file) and no `loading.tsx` (no data beyond the session, like `/welcome`).
2. **Look** (DESIGN.md §11.3 #19, the visual sibling of the admin gate #18): a 400px `--slab` slab centred on `--ink` — 2px `--line-soft` border, `6px 6px 0 --ink-deep` shadow, radius 0 — Bungee h1 "YOU'RE BANNED" (`--text-section-title`, `--white`) and one line in `--mute`: "This account can't use odsens any more." Nothing else: no links, no Google button, no appeal form (§7 voice: state the thing, stop). Tokens only.
3. **Proxy M4 / M4b** (`proxy.ts`): M4 selects `handle, is_banned` (still one own-row query, still never `role`); new **M4b** — `is_banned` and path ∉ {`/banned`, `/auth/*`, `/api/*`} → 307 `/banned`, else pass through. M4b runs before M5, and M5–M8 never run for a banned account, so a banned account whose handle is still null lands on `/banned` too (never on `/welcome`, never in a redirect loop). M3 (`/auth/*`) and M3b (action POSTs pass through) precede it: the Sign out POST works, and an action POST from a banned browser reaches the action, which refuses (Decision 4). M1 is unchanged: anon on `/banned` passes through without DB work and the page sends it home.
4. **Server side** (`lib/auth.ts`): `requireUser()` and `requireOnboarded()` throw `AuthError('banned', "This account is banned.")` when the caller's own `profiles.is_banned` is true — after `unauthenticated`, before `onboarding_required`. `requireUser()` therefore makes one own-row PK read under RLS (it read the session only before); its `{ id }` return and 04 SC-04's export set are unchanged; `getUser` / `getViewer` / `getProfile` / `requireRole` are untouched. Consequently every S1.1 account action — `checkHandle`, `completeOnboarding`, `updateProfile`, `deleteAccount` — answers `{ ok:false, error:{ code:'banned' } }` for a banned caller before the rate limiter records a hit and before any write. 04 SC-05 becomes "every user action", not only inserts: a banned account can no longer finish onboarding, rename, change its picture or delete itself.
5. **Tests**: 05 T-ACT-10 gains the M4b cases (`tests/db/proxy.test.ts`: banned on `/`, `/projects`, `/profile`, `/welcome`, `/admin`, `/privacy` → 307 `/banned`; `/banned`, `/auth/*`, `/api/*` pass; a factory banned-with-null-handle account → `/banned`; `user` on `/banned` passes; a banned action POST passes; the RP-19 spy expects `select=handle,is_banned`); the T-ACT-1 / T-ACT-4 / T-ACT-7 / T-ACT-65 banned cells → D `banned` (row unchanged, no hit recorded); the e2e flow is `tests/e2e/flows/banned.spec.ts` under **T-E2E-32** (sign-out — the only control on the page).
6. **Not changed**: `/auth/callback` (it still redirects to `next` or `/welcome`; the proxy turns the very next navigation into `/banned` — one extra hop, no code in the callback); `ViewerProvider.isBanned` and the S1.4 comment-composer banned slab (DESIGN.md §11.2); `next.config.ts` `X-Robots-Tag` list and `app/robots.ts` (anon never reaches the page — it is 307'd home — so the metadata `noindex` suffices); `requireRole` (no S1.1 action uses it).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Rely on SC-05 only (comment actions refuse; everything else stays open) | What was built; David rejected it — a banned account kept the nav, `/profile` (rename, picture, delete) and `/welcome`; renaming on existing comments is ban evasion (security gate open item 3). |
| `notFound()` / 404 on every page while banned | Says nothing — the person would think the site is broken; the admin-gate precedent (ADR-0002 C4) reserves the root 404 for "you are not meant to be here", not "you were told to leave". |
| A banner on every page with the site still browsable | Browsing signed-in has no value over browsing signed-out, and every signed-in surface (profile, picture, onboarding) would need its own banned state — more states, more to get wrong. |
| Sign the banned account out on sign-in (force anon) | They would sign in again and again with no explanation; also hides the ban from them. |
| Check the ban in `/auth/callback` only | Covers the sign-in hop but not a session that is banned while signed in; the proxy sees every navigation. |
| A 403 body from pages / the admin layout | 04 §7 already has the `banned` code and 01 INV-31 forbids 403 bodies on `/admin`; one page is simpler than per-route bodies. |

## Consequences
- Positive: a ban means what it says everywhere, from the first navigation after Google sign-in; no rename / picture / onboarding / self-delete under a ban; one page, one proxy rule (M4b) and one check in the auth seam — no action needs its own banned branch; the proxy still issues one PK read and never reads `role`.
- Negative: `requireUser()` costs one own-row read per `checkHandle` / `completeOnboarding` call (it read only the session before; `completeOnboarding` reads the row a second time for its `conflict` check); a banned account cannot delete itself — removal under a ban is an admin act; the sign-in hop is two redirects (`/auth/callback` → `next` or `/welcome` → `/banned`).
- Follow-ups: S1.4 `banUser` — decide whether a ban also revokes the account's sessions (today M4b catches the next navigation) and keep the composer's own "You can't comment here." slab → owner `backend-robustness` · whether `requireRole` gets the same check (a banned moderator is resolved by demoting) → with the S1.4 moderation actions, owner `security-check` · deleting a banned account's data on request → `docs/questions.md`, owner `keep-docs`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/02-routes-and-pages.md` | §1.2 route table | new `/banned` row after `/welcome` (contains the string ADR-0019) |
| `docs/build/02-routes-and-pages.md` | §3 M4, new M4b row, RP-19, RP-21 | M4 reads `handle, is_banned`; the M4b rule; RP-19 reads `handle`, `is_banned` only — never `role`; RP-21 banned exemptions (contains the string ADR-0019) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0019 (2026-08-21)" (README ADR-R2) |
| `docs/build/01-architecture.md` | INV-30 Statement; INV-45 Check | the M-list gains M4b; the proxy M4 select is `handle, is_banned` (contains the string ADR-0019) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0019 (2026-08-21)" (README ADR-R2) |
| `docs/build/04-server-contracts.md` | SC-04, SC-05 | `requireUser` / `requireOnboarded` → `banned`; `AuthError` code set gains `banned`; SC-05 = every user action (contains the string ADR-0019) |
| `docs/build/04-server-contracts.md` | §1.1 `completeOnboarding` Preconditions + Returns; `updateProfile` Returns; `checkHandle` Auth; `deleteAccount` Returns | not banned is checked; `banned` in the error lists (contains the string ADR-0019) |
| `docs/build/04-server-contracts.md` | §7 `banned` row | accounts copy "This account is banned."; the comments copy stays (contains the string ADR-0019) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0019 (2026-08-21)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §7.2 T-ACT-1, T-ACT-4, T-ACT-7, T-ACT-10, T-ACT-65 | banned cells → D `banned`; T-ACT-10 M4b cases (contains the string ADR-0019) |
| `docs/build/05-test-plan.md` | §7.3 T-E2E-32 | banned flow appended to the sign-out row (contains the string ADR-0019) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0019 (2026-08-21)" (README ADR-R2) |
| `DESIGN.md` | §11.3 #19 (new item) | Banned page (contains the string ADR-0019); the header changelog line is the slice's combined v1.4 entry |
| `docs/build/_registry.md` | Route registry Onboarding line; Route files line; repo layout | `/banned` beside `/welcome` (contains the string ADR-0019) |
| `docs/build/00-build-plan.md` | S1.1 Scope IN Routes; §6 Changelog; `Status:` line | `/banned` route; new row; Status appended (contains the string ADR-0019) |
| `docs/questions.md` | S1.1 notes, 2026-08-21 preview review item 5 | already names ADR-0019 — no further edit |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0019 |

## Gate impact
| Gate | Now checks |
|---|---|
| security-reviewer | `proxy.ts` M4 selects exactly `handle, is_banned` (no `role`, no `*`) and M4b 307s every non-exempt navigation of a banned session to `/banned` before M5; `lib/auth.ts` `requireUser` / `requireOnboarded` throw `banned` before the rate limiter (`tests/db/actions/*` banned cells: no hit, no write); `/banned` renders nothing interactive beyond the shell's Sign out; no PII on the page (01 INV-45 — it reads `getViewer()` only) |
| spec-drift-reviewer | 02 §1.2 / §3, 01 INV-30 / INV-45, 04 SC-04 / SC-05 / §1.1 / §7, 05 T-ACT-1/4/7/10/65 + T-E2E-32, DESIGN.md §11.3 #19, `_registry.md`, 00 S1.1 + §6 carry ADR-0019; this ADR listed under `## ADRs in this PR` |
| design-fidelity-reviewer | `/banned` = the §11.3 #18 slab (400px, `--slab`, 2px `--line-soft`, `6px 6px 0 --ink-deep`, radius 0), Bungee "YOU'RE BANNED" `--text-section-title` `--white`, one `--mute` line, tokens only (`node scripts/contrast.mjs --check styles/`), nothing else on the page |
| frontend-reviewer | `app/(onboarding)/banned/page.tsx` is a Server Component (`force-dynamic`, `noindex` metadata, `getViewer()` only, no Supabase import); the onboarding shell is unchanged; `tests/e2e/flows/banned.spec.ts` (axe clean, no nav / footer / links in `main`) |
| backend-reviewer | every S1.1 action answers `banned` for a banned caller through `runAction`'s `AuthError` mapping (04 SC-03) — no per-action branch; `requireUser()` adds exactly one own-row PK read and nothing else |
| supabase-reviewer, deploy-checker | none (no schema, policy or deploy change) |
