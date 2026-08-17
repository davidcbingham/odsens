# Build Plan
Slice-by-slice contract for building odsens.com v1 (S0–S1.10) with Phase 2 stubs: scope, acceptance criteria, tests, gates, demo, and the global rules every PR follows.
Status: DRAFT v0.2 (2026-08-17) — becomes v1.0 at freeze

Sources this doc is derived from (it re-decides nothing): `docs/build/_registry.md` (IDs — used verbatim), `docs/spec.md`, `docs/questions.md`, `docs/data-model.md`, `docs/notifications.md`, `docs/framework-decision.md`, `docs/analytics-options.md`, `DESIGN.md` v1.3, `docs/skill-handoffs.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `docs/dev-tooling.md`, `.env.example`, `supabase/config.toml`.
Sibling docs referenced: `01-architecture.md` (invariants INV-nn), `02-routes-and-pages.md` (RP-nn, M-n), `03-components.md`, `04-server-contracts.md` (C-nn, J-x, F/N/D steps), `05-test-plan.md` (T-<layer>-n, CI-n), `06-decisions/` (ADRs). Open items in this doc are cited as `00 §5 00-O-n` to avoid collision with the `O-n` lists in 01–03.

---

## 0. How to read this document

| Rule | Statement |
|---|---|
| 0.1 | Every slice below is one PR (`feat/<slice-id>-<slug>`), one preview URL, one tag on merge. A slice starts only when its "Depends on" slices are merged to `main`. |
| 0.2 | "Scope IN" is exhaustive for the slice: anything not listed and not in a later slice is out of scope; the `spec-drift-reviewer` flags extra features as "out of slice". |
| 0.3 | "Scope OUT" lists things a builder would be tempted to do in this slice but must not; they name the slice that owns them. |
| 0.4 | Acceptance criteria (AC) are numbered `<slice>.AC<n>` and are checkable on the preview URL by a human or by a gate agent. All ACs must pass before merge. |
| 0.5 | "Tests required" names layers + areas; the concrete `T-<layer>-<n>` IDs are defined in `05-test-plan.md` and must exist before the slice merges. |
| 0.6 | "Gates required" lists the agents (`.claude/agents/`) that must return `Verdict: PASS` in the PR body. `spec-drift-reviewer` runs on every PR. |
| 0.7 | Registry names (routes, components, actions, tables, event kinds) are used verbatim from `_registry.md`. Anything new is listed in §6 "Registry additions" of this doc, not invented inline. |
| 0.8 | Where a source is silent, the item is listed in §5 "Open" with a proposed default marked OPEN; builders use the proposed default and write an ADR if they diverge. Open IDs in this doc are `00-O-n` (other docs have their own `O-n`/`OPEN-n` lists). |
| 0.9 | Where 01–05 already decide something this doc previously listed as open, the sibling doc wins and the row in §5 is marked DECIDED with the owning section. |

---

## 1. Global rules

### 1.1 Definition of Done (applies to every slice)

A slice is Done when all of the following are true:

| # | Condition | Checked by |
|---|---|---|
| DoD-1 | Branch named `feat/<SliceID>-<slug>` (e.g. `feat/S1.4-comments`) merged to `main` via PR; no direct pushes to `main`; no force-push. | `ship` / human |
| DoD-2 | CI green on the merge commit: the five required checks `lint` (eslint + prettier + `tsc --noEmit` + `scripts/contrast.mjs` + `scripts/check-*.mjs`), `unit`, `db`, `build` (+ `scripts/check-bundle-secrets.mjs`), `e2e` — 05 §4 CI-1..CI-5, CI-8 (jobs defined in S0). | CI |
| DoD-3 | Every AC in the slice's list passes on the preview URL (human) — ticked in the PR body. | human / `deploy-checker` |
| DoD-4 | Every required test area has T- IDs in `05-test-plan.md` and the tests exist and pass. | `test-engineer`, `spec-drift-reviewer` |
| DoD-5 | All required gate verdicts pasted into the PR body, each `Verdict: PASS`. A ❌ goes back to the owner once; a second ❌ on the same item → stop and ask the human (`docs/skill-handoffs.md` §1.7). | `build-phase` |
| DoD-6 | `deploy-checker` run against the preview URL returned PASS. | `deploy-checker` |
| DoD-7 | Screenshots at 1280 and 390 of every touched page attached to the PR (dark theme). | `design-fidelity-reviewer` |
| DoD-8 | Any deviation from `01–05`, `DESIGN.md`, or `docs/data-model.md` has an ADR in `docs/build/06-decisions/` **and** the amended doc, in the same PR (§1.6). | `spec-drift-reviewer` |
| DoD-9 | Docs true after merge: `docs/spec.md` revision log line, `docs/questions.md` struck/added items, `DESIGN.md` changelog if a rule changed (`keep-docs`). | `keep-docs` |
| DoD-10 | Merge commit tagged per §1.4; tag pushed. | `build-phase` |
| DoD-11 | No secret value appears in the diff, PR body, screenshots, or logs (`.env` gitignored; env in Vercel). | `security-reviewer`, `deploy-checker` |
| DoD-12 | Nothing on the stop-and-ask list (`docs/skill-handoffs.md` §5) was done without a recorded human confirm in the PR. | human |

### 1.2 Branch naming

| Kind | Pattern | Example |
|---|---|---|
| Slice | `feat/<SliceID>-<slug>` | `feat/S1.4-comments`, `feat/S0-scaffold` |
| Fix inside a slice after merge | `fix/<SliceID>-<slug>` | `fix/S1.2-cf-mapping` |
| Docs only | `docs/<slug>` | `docs/build-plan-freeze` |
| Phase 2 | same, with `S2.x` | `feat/S2.1-kofi-webhook` |

Slug: kebab-case, ≤4 words. One slice per branch; a branch that grows past its slice is split (`build-phase` guardrail "scope grows → stop, split").

### 1.3 PR body template (mandatory sections, in this order)

```
## Slice
S<id> — <name>            Preview: <vercel url>
## Spec sections implemented
docs/spec.md §…, DESIGN.md §…, docs/build/01 §…, 02 §…, 03 §…, 04 §…, 05 §…
## Acceptance criteria
- [ ] S<id>.AC1 …   (every AC from 00-build-plan.md, ticked when verified on the preview)
## Tests
T-RLS-… ✔ · T-ACT-… ✔ · T-ADP-… ✔ · T-E2E-… ✔ · T-UNIT-… ✔   (IDs from 05-test-plan.md)
## ADRs: none
(heading is the literal `ADRs: none` when the PR carries no ADR — 06 ADR-R11; otherwise the heading is `## ADRs:` followed by one line per ADR:)
ADR-<nnnn>-<slug>.md (amends: <doc §>)
## Gate verdicts (pasted verbatim)
GATE: spec-drift … Verdict: PASS
GATE: … (each required gate)
GATE: deploy … Verdict: PASS
## Screenshots
1280 + 390 for each touched page
## Deferred / out of slice
<items noticed but not built, with the slice or questions.md entry that owns them>
## Docs updated
docs/spec.md revision log · docs/questions.md · DESIGN.md changelog (if any)
```

### 1.4 Tagging

| Merge of | Tag |
|---|---|
| S0 | `v0.1` |
| S1.1 | `v0.2` |
| S1.2 | `v0.3` |
| S1.3 | `v0.4` |
| S1.4 | `v0.5` |
| S1.5 | `v0.6` |
| S1.6 | `v0.7` |
| S1.7 | `v0.8` |
| S1.8 | `v0.9` |
| S1.9 | `v0.10` |
| S1.10 | `v1.0.0` (launch) |
| Phase 2 slices | `v1.<n>` per slice; `v2.0.0` when S2.1–S2.5 are all merged |

Tags are annotated (`git tag -a v0.n -m "S1.x <name>"`) on the merge commit on `main`. Fix branches do not get tags.

### 1.5 What "freeze" means

| # | Statement |
|---|---|
| F-1 | `docs/spec.md` is frozen when its status line reads "frozen" and this document plus `01–05` are marked `v1.0`. Until then no app code is scaffolded (`CLAUDE.md`: "Don't scaffold yet"). |
| F-2 | After freeze, `docs/build/00–05`, `DESIGN.md`, and `docs/data-model.md` change only through §1.6 change control. Prose clarifications that change no rule may be committed as `docs/` PRs without an ADR. |
| F-3 | Freeze does not freeze `docs/questions.md`; open items there are resolved via ADR when a slice needs them. |
| F-4 | The frozen set = this doc, `01-architecture.md`, `02-routes-and-pages.md`, `03-components.md`, `04-server-contracts.md`, `05-test-plan.md`, `_registry.md`, `DESIGN.md` v1.3, `docs/data-model.md`, `docs/notifications.md`. |
| F-5 | S0 may begin the day the freeze commit lands on `main`. |

### 1.6 Change control

| # | Rule |
|---|---|
| CC-1 | Any deviation from `00–05`, `DESIGN.md`, `docs/data-model.md`, or `docs/notifications.md` discovered during a slice requires an ADR file `docs/build/06-decisions/ADR-<nnnn>-<slug>.md` **and** the edit to the amended doc, in the same PR as the code (`build-phase` step 2b). |
| CC-2 | ADR numbering is sequential across the repo (06 ADR-N1..N3; `ADR-0001` is the engineering-spec baseline, already on `main`); the ADR names the doc + section it amends and the slice ID. Every amendment of this doc records the `ADR-<nnnn>` string in §7 Changelog (06 ADR-R2). |
| CC-3 | `spec-drift-reviewer` enforces CC-1: an unlogged deviation is a ❌ on the PR; the reviewer states whether the resolution is "fix code" or "ADR + doc". |
| CC-4 | Product decisions (things in `docs/spec.md` §4–§6, `docs/questions.md`) are not made inside a slice: stop and ask the human; record the answer in `docs/questions.md` and, if it changes a contract, an ADR. |
| CC-5 | New IDs/names (routes, components, actions, tables, events, tests) go into `_registry.md` in the same PR before use. |
| CC-6 | Design deviations additionally require the `DESIGN.md` changelog line (`design-fidelity` rule); a component with no `DESIGN.md` entry is "UNSPECIFIED" and blocks until decided (`design-fidelity-reviewer`). |
| CC-7 | Scope changes to a slice (adding or removing an AC) are ADRs that amend this doc. |

### 1.7 Gate matrix (which agents per slice)

| Slice | spec-drift | design-fidelity | frontend | security | backend | supabase | deploy-checker |
|---|---|---|---|---|---|---|---|
| S0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| S1.1 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| S1.2 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| S1.3 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| S1.4 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| S1.5 | ✔ | ✔ (emails + settings) | ✔ | ✔ | ✔ | ✔ | ✔ |
| S1.6 | ✔ | ✔ | ✔ | ✔ (embeds) | ✔ | ✔ | ✔ |
| S1.7 | ✔ | ✔ | ✔ | ✔ (uploads) | ✔ | ✔ | ✔ |
| S1.8 | ✔ | ✔ | ✔ | ✔ (admin, fetch) | ✔ | ✔ | ✔ |
| S1.9 | ✔ | ✔ | ✔ | ✔ (Ko-fi iframe, admin) | ✔ | ✔ | ✔ |
| S1.10 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (production URL) |

Rule: this plan **tightens** `build-phase` step 4 (which runs design-fidelity/frontend/security/supabase gates conditionally): all seven gates run on every v1 slice regardless of files touched — a gate with nothing in scope returns PASS with "nothing in scope"; the parenthetical notes the specific focus. All gates are spawned in one background batch (`build-phase` step 4); `deploy-checker` runs after the preview deploy.

---

## 2. Slices — v1

### S0 — Scaffold

**Goal:** an empty-but-complete Next.js app on Vercel with the design tokens, base layout, Supabase wiring, CI, test harness, and the two build-time helper skills, so every later slice is a vertical feature.

**Depends on:** — (freeze commit on `main`).

**Scope IN**
- Repo: `pnpm` workspace, Next.js App Router + TypeScript, ESLint + Prettier, `.nvmrc` (Node 24 LTS per `docs/dev-tooling.md`), `package.json` scripts `dev/build/lint/typecheck/test:unit/test:db/test:e2e/email`.
- `styles/tokens.css` (every DESIGN.md §1 dark token verbatim, §3 spacing scale) + `styles/globals.css`; `next/font/local` for Bungee, Space Grotesk (400/500/700), Silkscreen (400/700) WOFF2 in `public/fonts/`.
- Layout: `Nav` (§5 + §12.2 order Projects · Videos · Skins · Art · Seen on; **Commissions item hidden**; Support gold button; burger < 900px; 03 §4 N-01..N-08), `Footer` (§5 + §11.6 links + first dry line; the second dry line "Creators featuring the mods aren't affiliated with odsens." arrives in S1.8 per registry / 02 RP-13), `SkipLink`, `PixelLabel`, `Button` (primary|secondary|ghost|gold), `Icon`, `Avatar`, `Toast` (+ `ToastProvider` live region in `app/layout.tsx` per 02 RP-09; 03 §2.1 lists first *use* in S1.1), `Skeleton` (base) + `Skeleton*` shells; `app/not-found.tsx` (§11.3 #13), `app/error.tsx` (§11.3 #14), `app/global-error.tsx`, root `loading.tsx`. Other 03 §10 primitives arrive in the slice that first uses them.
- Routes: `/` (placeholder page using the layout; hero content arrives in S1.2), `/auth/callback`, `/auth/sign-out` (POST) shells wired to Supabase SSR, `app/robots.ts` (`/robots.txt`, 02 RP-07). Nav items for `/projects`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support` render from S0 and resolve to the root 404 page until their slice ships (§4.3; 00-O-8 DECIDED).
- `lib/env.ts` (zod-validated env, fail-fast at boot; names = `.env.example`; required-at-boot set = 04 C-16: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `MODRINTH_USER`, `MODRINTH_USER_AGENT`, `YOUTUBE_CHANNEL_ID`; every other variable is optional and becomes required in the slice that first reads it per 01 §7 env matrix "R from S1.x" — `CURSEFORGE_API_KEY` stays optional forever (04 §3.2 no-key path)), `lib/supabase/{server,client,admin}.ts`, `lib/auth.ts` helpers (`getSession`, `requireRole` stubs).
- Local Supabase (`supabase start`, `config.toml` already present) + first migration: helpers `public.is_admin()`, `public.is_moderator()`, `updated_at` trigger function only. `supabase/seed.sql` skeleton. `lib/supabase/types.ts` generated + committed.
- CI (GitHub Actions): lint, typecheck, `test:unit`, `test:db` (Supabase CLI service), `build`, `test:e2e`; client-bundle grep for `SERVICE_ROLE`, `CURSEFORGE_API_KEY`, `YOUTUBE_API_KEY`, `KOFI_` → must be absent.
- Test harness (`test-engineer`): Vitest projects `unit` + `db`; `tests/helpers/asRole.ts` + `expectPolicy` runner; Playwright `smoke` project at 1280 + 390 with axe; `scripts/contrast.mjs`.
- `vercel.json` with an empty `crons` list; `next.config.ts` `headers()` per 01 INV-76/INV-77 on every route (CSP with `frame-ancestors 'none'` globally, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security`) plus `X-Robots-Tag: noindex, nofollow` on `/admin/:path*` and `/api/:path*` (the `/admin` route itself is built in S1.1; the header rule ships now).
- Supabase Branching enabled + Supabase GitHub/Vercel integrations installed so the preview gets branch env vars (`docs/dev-tooling.md` "set up at first preview deploy").
- Skills written: `.claude/skills/ship/SKILL.md`, `.claude/skills/keep-docs/SKILL.md` (specs: `docs/site-management-skills.md` §3).
- Preview deploy green (Deployment Protection Standard stays on).

**Scope OUT**
- No tables beyond helpers (S1.1+). No sign-in UI (S1.1). No project data or hero content (S1.2). No cron entries (S1.2+). No DNS/domain (S1.10). No Sentry/Web Analytics (S1.10). No Oliver skills beyond `ship` + `keep-docs` (S1.10).

**Spec traceability:** `docs/spec.md` §7 (infrastructure), §8 (aesthetic); `docs/framework-decision.md` (stack, layout, guardrails); `DESIGN.md` §1–§5, §11.1 (Toast, Skeleton), §11.3 (#13 404, #14 error), §11.6, §12.2 (nav); `docs/dev-tooling.md`.

**Engineering docs implemented:** 01 §1, §2, §7 (INV-35..37), §14, §20 (INV-76/77), §21–§24 (all invariants become enforceable here); 02 §0.4 RP-05..RP-07, §0.5 RP-09, §0.6 RP-12/RP-13, §8 row S0; 03 §2.1 (`Nav`, `Footer`, `Toast`, `Skeleton`, `SkipLink`), §2.2 (`Button`, `PixelLabel`, `Icon`, `Avatar`), §4, §5; 04 §0 C-04 (helper names), C-16 (env); 05 §1 harness, §4 CI-1..CI-5, §8 row S0.

**Acceptance criteria**
1. S0.AC1 — Preview URL renders `/` with `Nav` + `Footer`; nav items in order Projects · Videos · Skins · Art · Seen on; no "Commissions" item; Support is a gold button; under 900px a 44px burger appears (screenshots 1280 + 390).
2. S0.AC2 — `styles/tokens.css` contains every token name + hex from DESIGN.md §1 "Dark"; `grep` for raw hex outside `tokens.css` returns nothing (allowed exceptions listed in 01).
3. S0.AC3 — Fonts served from `/fonts/*.woff2` (no request to a Google/CDN host in the network log).
4. S0.AC4 — `/does-not-exist` renders the 404 page (`404` in `--indigo`, "THAT PAGE DOESN'T EXIST", GO HOME + "See the projects"); a forced error renders "SOMETHING BROKE" with RELOAD + Go home; no error codes shown.
5. S0.AC5 — `pnpm build` fails when any of the 04 C-16 required-at-boot variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `MODRINTH_USER`, `MODRINTH_USER_AGENT`, `YOUTUBE_CHANNEL_ID`) is missing (zod in `lib/env.ts`, T-UNIT-16); build passes with only those set and every other `.env.example` name blank.
6. S0.AC6 — CI workflow runs the five required checks in DoD-2 (`lint`, `unit`, `db`, `build`, `e2e`) and blocks merge on failure; `scripts/check-bundle-secrets.mjs` inside `build` passes.
7. S0.AC7 — `supabase db reset` applies the first migration; `is_admin()`/`is_moderator()` exist; `lib/supabase/types.ts` committed and matches.
8. S0.AC8 — Playwright smoke: `/` and 404 at 1280 + 390 pass axe with zero serious/critical.
9. S0.AC9 — Response headers per 01 INV-76 are present on `/` and on `/admin` (a 404 in S0): CSP per INV-77 including `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security`; `/admin/**` and `/api/**` additionally `X-Robots-Tag: noindex, nofollow` (T-E2E-20).
10. S0.AC10 — `vercel.json` exists with `"crons": []`; `deploy-checker` PASS on the preview.
11. S0.AC11 — `.claude/skills/ship/SKILL.md` and `.claude/skills/keep-docs/SKILL.md` exist with the sections required by `docs/site-management-skills.md` §3 and the boundaries block from `docs/skill-handoffs.md`.
12. S0.AC12 — Preview deploy shows Supabase preview-branch env vars present (names only) per `deploy-checker`.

**Tests required:** 05 §8 row S0 — harness + CI-1..CI-5 green; T-UNIT-15 (contrast), T-UNIT-16 (env schema); T-E2E-14, T-E2E-15 (shells), T-E2E-17 (landmarks/skip link), T-E2E-19, T-E2E-20 (headers); T-RLS-123, T-RLS-124 (helpers migration); plus token-parity script (`tokens.css` ↔ DESIGN.md §1 — area label `T-UNIT tokens-parity`, §6).

**Gates required:** all seven (see §1.7).

**Demo script**
1. Open preview `/` — see nav/footer, correct fonts, no Commissions.
2. Resize to 390 — burger + Support last in the menu.
3. Visit `/nope` — 404 page.
4. Open PR checks — the five required checks green; bundle secret grep green.
5. `deploy-checker` verdict PASS in PR body.

**Risks / unknowns:** Supabase Branching + Vercel integration first-time setup (env injection may lag — fallback: production Supabase vars in preview for S0 only, recorded as `ADR-000n-branching-preview-env.md`, number per 06 ADR-N3); Node 24 vs vercel-ops note "Node 22" (registry/dev-tooling/01 O-1 say 24 — follow 24, ADR if Vercel forces otherwise); Silkscreen/Bungee WOFF2 licensing files must ship alongside fonts.

---

### S1.1 — Accounts

**Goal:** Google sign-in via Supabase Auth with mandatory handle onboarding, profile page, role model, and the admin gate — no PII ever displayed.

**Depends on:** S0.

**Scope IN**
- Tables: `profiles` (+ view `public_profiles`; column `handle_changed_at` per 04 §11), `site_settings` (single row `id = 1`, **all** columns per `docs/data-model.md` §2.4: `moderation_mode`, `admin_notify_emails`, `discord_webhook_url`, `kofi_page`, `comments_closed_default`, `announcement_md`; seeded `moderation_mode='auto'`, `comments_closed_default=false`, `kofi_page` = env `KOFI_PAGE` seed value); trigger on `auth.users` insert creating `profiles` (handle null, `email_hash` set server-side); `updated_at` triggers; RLS per `docs/data-model.md` §4 (+ 05 OPEN-1/OPEN-2 defaults); RPC `check_handle`; bucket `avatars` (public-read; upload via server action only, ≤1 MB inline per 04 C-18).
- Auth: Google provider (config already in `supabase/config.toml`), `/auth/callback` code exchange, `/auth/sign-out` POST; `middleware.ts` per 02 §3 M1..M8: refreshes the session and redirects any authenticated user with null handle to `/welcome` (except `/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*`, static — 02 M5 / 01 INV-30); **middleware never reads role** (02 RP-18); the `/admin/*` role gate lives in `app/admin/layout.tsx` via `requireRole('moderator')` (01 INV-31, 02 RP-11, §4).
- Routes: `/welcome` (`OnboardingPanel`, `HandleField`, `AvatarUpload` + crop), `/profile` (§11.3 #11 incl. Delete account action → `deleteAccount`), `/privacy` (§11.3 #12 + §12.5 additions), `/how-comments-work` (§12.5), `/admin` (`AdminGate` §11.3 #18 when signed out; role `user` → `notFound()`; `AdminShell` dashboard placeholder for role ≥ moderator — 02 RP-04), `/admin/settings` **stub** (admin only; 02 §1.3 / §8 row S1.1): Moderation radios (`moderation_mode`) + `comments_closed_default` toggle + Moderators table (handle + role; Make mod / Remove / add by handle) — no matrix, webhook, emails, or Ko-fi section yet (S1.5).
- Components: `HandleField` (all §11.1 states), `AvatarUpload` (+ crop, §11.1 "Picture upload"), `ProfileMenu` (§11.1; "Admin" item for role ≥ moderator per 03 N-06), `OnboardingPanel`, `SignInPrompt` (§5, reused by S1.4), `GoogleSignInButton`, `AdminGate`, `AdminShell` (sidebar per 02 RP-14; Orders item hidden until S2.2; Settings item admin only), `Toggle`, `Field`, `Table` (Moderators), `InlineConfirm`.
- Actions: `completeOnboarding`, `updateProfile` (incl. own-handle rename via the service-role client, 1 / 7 days on `profiles.handle_changed_at` — 04 §1.1 / 04 OPEN-2; see 00-O-15), `checkHandle` (RPC; structural validation `^[A-Za-z0-9_]{3,20}$`, citext-unique, reserved handles per 04 §1.1 H3 `RESERVED_HANDLES` (at least `admin, oddsense, odsens, moderator, mod`), no `@`/email-like by construction), `deleteAccount` (04 §1.0 / §11, `lib/actions/accounts.ts`; semantics per 00-O-16: auth user deleted via admin client, own comments → `status='deleted'`, likes/reports removed, avatar object removed — cascade on comments is exercised in S1.4), `updateSettings` (partial: `moderation_mode`, `admin_notify_emails` schema exists but the emails UI arrives S1.5; `comments_closed_default`), `setUserRole` (admin; 04 §1.3; registry addition §6); avatar re-encode server-side (strip EXIF, 512×512 WebP, ≤1 MB).
- Roles: `user|moderator|admin`; first admin set via seed/SQL (00-O-10); `AdminShell` visible to role ≥ moderator; `/admin/settings` link + route admin only (`requireRole('admin')` in the page, moderator → `notFound()`).

**Scope OUT**
- No comments (S1.4). No notification matrix, Discord webhook field, admin-emails chips, or Ko-fi section on `/admin/settings` (S1.5). `deleteAccount` ships now; its comments cascade (00-O-16) is tested in S1.4 (S1.4.AC16). No moderator handle-rename action (`renameHandle`, S1.4 — 00-O-15). No name/email detection in handles (decided Q34).

**Spec traceability:** `docs/spec.md` §5 Accounts, §9 (PII, handles), Q23, Q34; `docs/data-model.md` §2.1, §3 (`avatars`), §4, §6 "First sign-in"; `DESIGN.md` §5 (Sign-in prompt, Nav signed-in state), §11.1 (Handle field, Square toggle, Picture upload, Profile menu), §11.3 (#10 onboarding, #11 profile, #12 privacy, #18 admin gate), §12.5 (handle guidance, privacy line, How comments work).

**Engineering docs implemented:** 01 §6 (INV-28..34), §10 (no-PII), §11 (INV-51 avatar path); 02 §1.2, §1.3 (`/admin`, `/admin/settings` stub), §2.4, §2.5, §2.8 items 1 + 3, §3 (M1..M8, RP-18..RP-20), §4 (auth flows, admin gate); 03 §2.5 (Accounts), §2.10 (`AdminGate`, `AdminShell`), §2.2 (`Toggle`, `Field`, `Table`, `GoogleSignInButton`, `InlineConfirm`); 04 §1.1 (`completeOnboarding`, `updateProfile`, `checkHandle`), §1.3 (`updateSettings` partial, `setUserRole`), §2.1, §2.2, §11 (`deleteAccount`); 05 §7.1 T-RLS-1..15, §7.2 T-ACT-0..10, §7.5 T-E2E-16, 21..23, 32, 33 (row S1.1 in §8).

**Acceptance criteria**
1. S1.1.AC1 — Clicking "Sign in" starts the Google OAuth flow; after consent the user lands on `/welcome` if `profiles.handle` is null; visiting any page other than `/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*` (and static assets) while handle is null redirects to `/welcome` (02 M5; T-ACT-10, T-E2E-21).
2. S1.1.AC2 — `HandleField` shows: resting rules line; live `n / 20` counter; checking state with pixel pulse; available "That one's free." in `--emerald-soft`; invalid states with plain-words reason for: too short, too long, bad char, taken, reserved, contains `@`.
3. S1.1.AC3 — DONE is disabled until the handle validates; on success the user is redirected to the page they came from (or `/`) and `ProfileMenu` shows the handle + picture.
4. S1.1.AC4 — Avatar upload: >1 MB or non png/jpg/webp shows the §11.1 error copy; accepted image is cropped square, stored in `avatars`, re-encoded (no EXIF), 512×512.
5. S1.1.AC5 — No page, API response, or client bundle contains the Google display name or email: `public_profiles` exposes only `id, handle, avatar_path, role`; a T-RLS test proves a user cannot select another user's `profiles` row.
6. S1.1.AC6 — `/profile` shows picture Change/Remove, handle row with SAVE + consequence line, "what we store" footer strip linking Privacy, Delete account in danger (`deleteAccount`, inline confirm; after it the session is gone and the auth user no longer exists — 00-O-16); changing the handle (`updateProfile`) updates `ProfileMenu` immediately; a second rename within 7 days is refused with the plain reason (04 §1.1, T-ACT-05).
7. S1.1.AC7 — `/privacy` and `/how-comments-work` render the DESIGN.md §11.3/§12.5 content incl. the handle guidance line and the Google-age-rules line; both linked from `Footer` "Site" column.
8. S1.1.AC8 — `/admin` signed-out → `AdminGate` (ADMINS ONLY + Google button, nothing else, HTTP 200); signed-in role `user` → root 404 page (`notFound()`, 02 RP-04 — never a 403 body); role `moderator|admin` → `AdminShell` with sidebar (T-E2E-33). `/admin/settings` as moderator → root 404.
9. S1.1.AC9 — Reserved handles rejected server-side (T-ACT), not just in the UI.
10. S1.1.AC10 — Sign-out POST clears the session; `ProfileMenu` reverts to "Sign in".
11. S1.1.AC11 — RLS matrix for `profiles`, `public_profiles`, `site_settings`, `avatars` bucket passes for anon/user/banned/moderator/admin.
12. S1.1.AC12 — axe zero serious/critical on `/welcome`, `/profile`, `/privacy`, `/how-comments-work`, `/admin` gate, `/admin/settings` at 1280 + 390.
13. S1.1.AC13 — `/admin/settings` (admin): Moderation radios switch `site_settings.moderation_mode` and toggle `comments_closed_default` via `updateSettings` → toast "Saved."; Moderators table: Make mod / Remove / add by handle call `setUserRole` and update `profiles.role`; a moderator calling `setUserRole` gets `forbidden` (T-ACT-34 + auth matrix); an admin cannot demote self / the last admin (04 §1.3).

**Tests required:** 05 §8 row S1.1 — T-RLS-1..15, T-RLS-115..116, T-RLS-125..127; T-ACT-0..10 (+ 04 T-ACT-01..06 accounts, T-ACT-30 role matrix for `updateSettings`, T-ACT-34 `setUserRole`); T-UNIT-1, 2, 17, 18; T-E2E-16, 21, 22, 23, 32, 33; T-ACT auth matrix for `deleteAccount` (04 §11 — ID to be assigned in 05).

**Gates required:** all seven; `security-reviewer` focus: PII isolation, avatar re-encode, middleware, RLS on `profiles`.

**Demo script**
1. Preview: click Sign in → Google → land on `/welcome`.
2. Type `ad`, `admin`, `bob@x`, `taken_handle`, then a free one — watch each state and helper line.
3. Upload a 3 MB PNG → error; upload a small PNG → crop → DONE.
4. Open profile menu → Your profile → change handle → SAVE → menu updates.
5. Visit `/admin` as a normal user → root 404; promote via SQL (00-O-10) → sidebar appears; open `/admin/settings` → make a second account moderator.
6. Sign out.

**Risks / unknowns:** Google OAuth redirect URLs must include the Vercel preview pattern (`https://*.vercel.app/**` is in `config.toml` remote section — verify Supabase branch auth config inherits it); Q36 under-13 line copy needs David's confirmation before S1.10 (build the DESIGN.md wording now); `deleteAccount` uses the admin client (`auth.admin.deleteUser`) — behind an inline confirm, rate 1 / day (04 §1.0); `docs/data-model.md` §4 profiles update rule ("handle only if null→value or admin") is amended in this PR by ADR (00-O-15).

---

### S1.2 — Projects (synced)

**Goal:** the Modrinth catalogue on the site — hourly sync into Supabase, public grid + detail pages with ISR, Home hero/featured, CurseForge combined counts, and admin curation of synced projects.

**Depends on:** S0.

**Scope IN**
- Tables: `projects` (+ view `projects_public` with `downloads_total`), `project_versions`, `project_files`, `project_links`, `project_overrides`, `sync_runs`; RLS per `docs/data-model.md` §4; indexes on `slug`, `status`, `(source, external_id)`.
- Adapters: `lib/adapters/modrinth.ts` (User-Agent from `MODRINTH_USER_AGENT`, 10 s timeout, retry ≤3 with backoff on 429/5xx, 300 req/min respected), `lib/adapters/curseforge.ts` (`CURSEFORGE_API_KEY`, `GET /v1/mods/{id}`).
- Jobs: `syncModrinth` (upsert by `(source, external_id)`; `project_type` mapping per `docs/data-model.md` §5 / 04 §5.2; upstream-deleted → `status='hidden'`, never delete; writes `sync_runs` (04 C-11, C-13 lock); `revalidateTag('projects')` + `project:<slug>`), `syncCurseforge` (per `project_links` row → `downloads_curseforge`, `project_links.downloads`; no key → skipped run per 04 §3.2). In S1.2 the jobs write **no** `notification_events` rows (the table does not exist yet): failures go to structured logs + `sync_runs.error` only. `sync.failed` emission (04 J-F) and `sync.stale` (04 J-S) are added to both jobs in S1.5 via `lib/notify/emit.ts` — deterministic, not conditional.
- Route handlers: `/api/cron/sync-modrinth`, `/api/cron/sync-curseforge` (Bearer `CRON_SECRET`, idempotent, JSON summary); `vercel.json` crons: both hourly (offset).
- Actions (all **admin** per 04 §1.0 role rule; moderators see the admin pages read-only — 05 OPEN-5): `triggerSync` (runs a job now), `curateProject` (upsert `project_overrides`: featured/featured_order/hidden/notes_md/comments_enabled/title_override/description_override; `extra_gallery` paths accepted per 04 §1.4 but the upload UI + `project-media` bucket arrive in S1.3), `setProjectLink` (manual CurseForge id/URL per Q39).
- Public routes: `/projects` (`FilterBar` type counts + version + sort, search = client-side substring on title + description over the ISR list — 02 §2.2 RP-02, `search` tsvector unused on the page in v1; `ActiveFilterChips`, 3-up `ProjectCard` grid, empty state §11.7), `/projects/[slug]` (breadcrumb, icon 104px, `TypeBadge`, `Chip`s, count row, `Gallery` + `Lightbox`, ABOUT `Markdown` incl. `notes_md` appended, `VersionsTable` + `ChangelogExpander` §12.5, `GetItPanel` sticky rail with Modrinth/CurseForge rows + combined-count line, `DetailsList`, `TipPanel` **placeholder slab pointing at `/support`** until S1.9); `/` hero `FeaturedHero` (featured project takeover; fallback = highest `downloads_total` per 02 §2.1) + Featured 4-up; `app/sitemap.ts` (`/sitemap.xml`, 02 RP-07); `generateMetadata` per page; `ProjectCardSkeleton`, `ProjectDetailSkeleton` `loading.tsx`.
- Admin: `/admin/projects` (`Table` of all projects incl. hidden; feature/hide toggles + reorder; `SyncStatus` from `sync_runs`; "Sync now" → `triggerSync`), `/admin/projects/[id]` **curate view for synced projects** (02 §1.3: overrides form — feature/order/hidden/title + description override/notes/comments toggle, CurseForge id field → `setProjectLink`); S1.3 extends this route with the exclusive edit form and gallery upload.
- ISR: `revalidate` 600 on `/`, `/projects`, `/projects/[slug]`; tags `projects`, `project:<slug>`.
- Custom Vercel Analytics events **not yet** (S1.9).

**Scope OUT**
- No exclusive projects create/edit form, no `project-files` or `project-media` bucket, no `uploadProjectMedia`/extra-gallery upload UI, no `/api/download/[fileId]` (S1.3). No comments section (S1.4 — detail page reserves the COMMENTS section slot). No `notification_events` writes of any kind (table arrives S1.4; `sync.*` emission arrives S1.5). No SEEN ON row (S1.8). No Latest videos on Home (S1.6). No stats snapshot (S1.9). Discovery of CF ids by author search — manual only (Q39).

**Spec traceability:** `docs/spec.md` §3 (Modrinth snapshot), §4 goals 1–3, §5 Projects, Home; `docs/platform-audit.md` (Modrinth, CurseForge); `docs/data-model.md` §2.2, §2.9 (`sync_runs`), §5 (Modrinth/CurseForge rows), §6 "Curate synced project"; Q1, Q2, Q39; `DESIGN.md` §4 (glyphs), §5 (Type badge, Chip, Filter bar, Project card, Gallery), §6.1–6.3, §11.1 (Skeleton), §11.7, §12.5 (changelog expander).

**Engineering docs implemented:** 01 §5 (route handlers/cron), §8 (ISR/tags), §18 (jobs); 02 §1.1 (`/`, `/projects`, `/projects/[slug]`), §1.3 (`/admin/projects`, `/admin/projects/[id]` curate), §1.4 (cron rows), §2.1, §2.2, §2.3, §5 revalidation, §8 row S1.2; 03 §2.3 (Projects), §2.2 (`Table`, `Select`, `Markdown`, `StatusPill`), §2.10 (`SyncStatus`); 04 §1.4 (`curateProject`, `setProjectLink`), §1.7 (`triggerSync`), §2.4 (cron routes, C-12/C-13), §3.1, §3.2, §4 (modrinth/curseforge adapters), §5.2, §6 rows S1.2; 05 §8 row S1.2.

**Acceptance criteria**
1. S1.2.AC1 — Authorized `GET /api/cron/sync-modrinth` returns 200 JSON summary; unauthorized returns 401; running twice produces the same row counts (idempotent) and two `sync_runs` rows with `ok=true`.
2. S1.2.AC2 — All 18 Modrinth projects (per `docs/spec.md` §3 snapshot, whatever the live count is) appear on `/projects` with the correct `project_type` mapping: Heavy Spear (datapack) → datapack; Legacy Manhunts Reworked → plugin; Metal Pipe Mace → resource pack; Pixel Chameleon → mod.
3. S1.2.AC3 — `/projects` filter buttons show counts (`MODS 7` style); selecting type + version + sort updates the grid and `ActiveFilterChips`; "Clear" resets; empty state reads "NOTHING MATCHES / Try fewer filters." with Clear filters; `q` search matches title/description client-side (case-insensitive substring, 02 §2.2).
4. S1.2.AC4 — `ProjectCard` matches DESIGN.md §5: icon in ink well, Bungee title, one-line description, ≤2 chips (+N), footer with `TypeBadge` (glyph + word) left and Silkscreen emerald count right; hover lift; whole card is one link.
5. S1.2.AC5 — `/projects/[slug]` shows gallery + `Lightbox` (Esc closes, arrows move, alt text present), ABOUT markdown with Bungee gold h2/h3, VERSIONS & FILES table with the word "Download" (never "Get") and a "Changes ▾" expander (one open at a time, collapsed by default), `GetItPanel` with Modrinth (+CurseForge when linked) rows and a combined-count explanation line, `DetailsList` (type, updated, licence, source).
6. S1.2.AC6 — Combined count = `downloads_modrinth + downloads_curseforge + downloads_direct` and equals the sum shown in the rail rows.
7. S1.2.AC7 — Home hero is the featured project (`project_overrides.featured=true`, lowest `featured_order`) with gold DOWNLOAD (links to Modrinth in v1 for synced projects) + "See the project"; Featured 4-up shows the next four featured (0 → section not rendered); if none featured, hero uses the highest-`downloads_total` published project (02 §2.1; 00-O-3 DECIDED).
8. S1.2.AC8 — Admin: as role `admin`, on `/admin/projects` toggle feature/hide + reorder, and on `/admin/projects/[id]` add notes, title/description overrides, and a CurseForge id → after `syncCurseforge` the CF row and count appear on the detail page; `SyncStatus` shows last run time/ok/items; "Sync now" runs and refreshes. As role `moderator` the same pages render read-only and `curateProject`/`setProjectLink`/`triggerSync` return `forbidden` (04 §1.0; T-ACT-40 mod = denied).
9. S1.2.AC9 — Hidden projects (override `hidden` or `status='hidden'`) never render on `/`, `/projects`, or `/projects/[slug]` (404), but appear in admin.
10. S1.2.AC10 — After a sync, a changed title appears on `/projects/[slug]` without redeploy within one request after `revalidateTag` (verify by editing an override, which also revalidates).
11. S1.2.AC11 — Modrinth requests carry the `User-Agent` from env; a simulated 429 is retried with backoff and does not wipe existing rows (T-ADP + T-UNIT).
12. S1.2.AC12 — `loading.tsx` skeletons render inside real card/detail shells; axe zero serious/critical on `/`, `/projects`, one detail at 1280 + 390; Lighthouse LCP < 2.5 s on the preview for `/projects/[slug]`.
13. S1.2.AC13 — Client bundle contains no `CURSEFORGE_API_KEY`; `next build` route table shows `/projects/[slug]` as ISR.

**Tests required:** 05 §8 row S1.2 — T-RLS-16..43, T-RLS-111..114; T-ACT-33 (modrinth + curseforge routes), 40, 41, 42, 45..52; T-ADP-1..8, 20 (mapping edge cases: datapack loader, paper/spigot/bukkit/purpur/folia/velocity/bungeecord → plugin, resourcepack, default mod; run-twice idempotency; 429 retry + UA); T-UNIT-10, 11, 13, 14, 20, 21, 30, 31, 32; T-E2E-1 (hero + featured), 2, 3 (except comments/SEEN ON), 5 (gallery/lightbox), 34 (curate), 41.

**Gates required:** all seven; `backend-reviewer` focus: idempotency, sync_runs, never-delete; `security-reviewer` focus: cron secret, admin actions role re-check.

**Demo script**
1. Hit `/api/cron/sync-modrinth` with the secret (via `sync-now`-style curl) → JSON summary; open `/admin/projects` → SyncStatus updated.
2. Open `/projects`, filter DATAPACKS, sort by downloads, search "spear".
3. Open Heavy Spear (datapack) → gallery, lightbox, Changes ▾, GET IT rail.
4. In admin, feature Metal Pipe Mace as #1 → Home hero updates.
5. Enter a CurseForge id for a cross-posted project, run CF sync → combined count changes.

**Risks / unknowns:** `CURSEFORGE_API_KEY` not yet obtained (`docs/questions.md` setup list) — CF adapter ships with fixtures; AC8's CF part is verified once the key exists (record in PR "Deferred" if not; `setProjectLink` returns `upstream_error` "CurseForge key not configured" per 04 §1.4); Modrinth gallery/CDN hosts must be allow-listed for `next/image`; project icons/screenshots for the hero are "still missing" art (Q37) — hero uses Modrinth assets; cron minute offsets differ between 02 §1.4 and 04 §6 — 04 §6 strings are the contract (`keep-docs` aligns 02).

---

### S1.3 — Exclusive projects

**Goal:** Oliver can author and publish projects that live only on odsens.com, upload their files, and visitors download them directly with counted, signed URLs.

**Depends on:** S1.2.

**Scope IN**
- Buckets: `project-files` (**private**, 100 MB per `docs/data-model.md` §3 / 04 OPEN-10 — supersedes 05 OPEN-6's 50 MB default; allowlist `.jar .zip .mrpack`, ZIP magic bytes 04 C-19, sha512 recorded) and `project-media` (public-read, 5 MB/img, png/jpg/webp) — both created here with policies (service role only, 01 INV-33); `supabase/config.toml` `[storage] file_size_limit` raised from `50MiB` to `100MiB` in this PR (04 §11) so `test:db`/local uploads match production.
- Uploads: ≤1 MB inline via action FormData; larger files via the 04 §1.4.5 **two-phase signed-upload pattern** (`begin` mints a signed upload URL with the service role, browser PUTs, `commit` re-validates magic bytes / size / dimensions / sha512 and writes the row or deletes the object); no browser-side broad Storage policy — 00-O-9 DECIDED by 04 C-18; 01 INV-51 ("browsers NEVER receive a signed upload URL") is amended in this PR by ADR.
- Table: `project_downloads` (`project_id, file_id, ip_hash, ua_hash, created_at`; hashes per 04 C-17 with `HASH_SALT`); purge >90 days runs in the stats job (S1.9) — S1.3 ships the table + insert; RPC `record_download` (04 D4).
- Actions (admin): `createExclusiveProject`, `updateExclusiveProject` (Modrinth-shaped form: slug, title, description, body_md, project_type, categories, loaders, game_versions, license, links; versions + files), `publishProject` (draft → published, and back to draft/hidden), `uploadProjectMedia` (icon/gallery for exclusives; extra-gallery images for synced projects referenced by `curateProject.extra_gallery`), `uploadProjectFile`.
- Route handler: `/api/download/[fileId]` per 04 §2.3 D1..D8 — verify project published + file has `storage_path` → rate limit 30 / min / `ip_hash` (429) → increment `project_files.download_count` + `projects.downloads_direct` + insert `project_downloads` in one RPC → 302 to a 60 s signed URL with `Content-Disposition: attachment`; unpublished/missing/synced → 404. Scope resolver `lib/files.ts resolveDownloadable` (04 D2/D8) is generic over bucket + owner for S2.3.
- Admin: `/admin/projects/new`; `/admin/projects/[id]` extended with the exclusive edit form (`Field`, `Select`, `UploadWell` states per §11.1, versions editor, publish toggle with `StatusPill` DRAFT/LIVE/HIDDEN) and the extra-gallery `UploadWell` on the S1.2 curate view.
- Public: `ExclusiveBadge` on `ProjectCard` + detail (gold outline; never on a project that has a Modrinth/CurseForge link); `GetItPanel` primary button = direct DOWNLOAD (gold) with file meta (name, size, sha512 shown); `VersionsTable` "Download" links → `/api/download/[fileId]`; Home hero gold DOWNLOAD becomes a direct download when the featured project is exclusive.
- Combined count includes `downloads_direct` (already in view).

**Scope OUT**
- No comments (S1.4). No custom Vercel Analytics `download` event (S1.9). No skins/art buckets (S1.7). No workroom-generic file table (P2 — but the download route must not hardcode `project` scope: it resolves owner + bucket via `lib/files.ts`, see `docs/spec.md` §4 5c "v1 groundwork" and 04 D8). No skin download counter (00-O-17).

**Spec traceability:** `docs/spec.md` §4 1b, 3, 5c groundwork, §5 Projects (Exclusive), Admin Projects; `docs/data-model.md` §2.2, §3 (`project-files`, `project-media`), §6 "Exclusive download", "Add exclusive project"; `DESIGN.md` §5 (Exclusive badge, Gold button), §6.3, §6.9, §11.1 (Upload well, Admin field, Admin table).

**Engineering docs implemented:** 01 §11 (uploads, INV-51 as amended), §12 (downloads), §17 (rate limiting); 02 §1.3 (`/admin/projects/new`, `/admin/projects/[id]` exclusive edit), §1.4 + §2.9 (`/api/download/[fileId]`), §8 row S1.3; 03 §2.2 (`ExclusiveBadge`, `StatusPill`, `Field`, `Select`), §2.10 (`UploadWell`); 04 §0 C-17..C-21, §1.4 (`createExclusiveProject`, `updateExclusiveProject`, `publishProject`), §1.4.5, `uploadProjectMedia`, `uploadProjectFile`, §2.3 (D1..D8), §11 (`HASH_SALT`, `record_download`, storage limit); 05 §8 row S1.3.

**Acceptance criteria**
1. S1.3.AC1 — Admin creates a draft exclusive project; it is not visible on `/projects` or `/projects/[slug]` (404) until `publishProject`; after publish it appears with `ExclusiveBadge` "★ ONLY ON ODSENS" and a gold card outline.
2. S1.3.AC2 — `UploadWell` shows idle / drag-over / uploading (percent + flat bar + Cancel) / done (✔ name + size) / error with the actual number ("That's 120 MB. The limit is 100.") or type; limits printed under the well at all times (values from the 04 caps: files 100 MB, media 5 MB).
3. S1.3.AC3 — Uploading a `.exe` renamed `.jar` (wrong magic bytes) is rejected at `commit` and the object deleted (T-ACT-52); a real `.jar`/`.zip`/`.mrpack` ≤100 MB is accepted through the two-phase flow against the local stack (`supabase start` with the raised `file_size_limit`), sha512 stored and displayed in `GetItPanel` file meta.
4. S1.3.AC4 — `GET /api/download/[fileId]` on a published file returns 302 to a signed URL that expires within 60 s; the response/URL sets `Content-Disposition: attachment`; `project_files.download_count` and `projects.downloads_direct` each increment exactly 1 per request; a `project_downloads` row is written with hashed ip/ua only.
5. S1.3.AC5 — Same route for a draft/hidden project or unknown id → 404; direct bucket URL access to `project-files` without a signed URL → 4xx (bucket private).
6. S1.3.AC6 — Rate limit: the 31st request in one minute from one `ip_hash` → 429 with `Retry-After: 60` (04 D3; T-ACT-93).
7. S1.3.AC7 — Detail page for an exclusive project: `GetItPanel` primary gold DOWNLOAD (direct), no Modrinth/CurseForge rows, combined count = direct count; `DetailsList` source reads "odsens".
8. S1.3.AC8 — `ExclusiveBadge` never renders on a project with `source='modrinth'` or any `project_links` row (T-UNIT on the predicate).
9. S1.3.AC9 — Editing an exclusive project's markdown body updates `/projects/[slug]` after `revalidateTag('project:<slug>')`.
10. S1.3.AC10 — RLS: anon/user cannot insert/update `projects`, `project_versions`, `project_files`; storage policies allow uploads only via service role (signed upload URLs are minted server-side per 04 §1.4.5; no `insert` policy for `authenticated`/`anon` on `storage.objects`).
11. S1.3.AC11 — Client bundle contains no `SERVICE_ROLE`; the browser never holds a broad Storage policy; an object PUT to a signed URL without a subsequent `commit` has no DB row and is removed by the U1 cleanup (04 §1.4.5) (`security-reviewer`).
12. S1.3.AC12 — axe zero serious/critical on `/admin/projects/new` and an exclusive detail at 1280 + 390.

**Tests required:** 05 §8 row S1.3 — T-RLS-44..47, T-RLS-117..120; T-ACT-34..39, 43, 44 (+ 04 T-ACT-50..54 uploads, T-ACT-90..94 download route); T-UNIT-17 (zip), 18 (`project-files`, `project-media`), 22, 23; T-E2E-4, 31, 35.

**Gates required:** all seven; `security-reviewer` focus: uploads/downloads section of the checklist.

**Demo script**
1. `/admin/projects/new` → fill Modrinth-shaped form → upload icon + a `.jar` → save draft.
2. Visit the public slug → 404. Publish → page live with the badge.
3. Click DOWNLOAD → file arrives as attachment; refresh → count +1.
4. Try to upload a 120 MB zip → error with the number.
5. Hide the project → public 404 again.

**Risks / unknowns:** Vercel 4.5 MB request-body cap is why 04 §1.4.5 exists — the ADR amending 01 INV-51 must land in this PR or the gates disagree; `.mrpack` is a zip container (04 C-19 treats it as the ZIP signature); `HASH_SALT` must exist in Vercel preview + prod before merge (01 O-3 `HASH_SECRET` is renamed to `HASH_SALT`, 04 owns the name).

---

### S1.4 — Comments

**Goal:** signed-in visitors can comment, reply, like, edit (15 min), delete, and report on projects; moderators moderate; events are logged for S1.5 delivery.

**Depends on:** S1.1, S1.2.

**Scope IN**
- Tables: `comments` (+ view `comments_public`, 05 RA-1; BEFORE INSERT trigger `comments_set_status()`, 05 RA-6), `comment_likes`, `comment_reports`, `notification_events` (event catalog kinds `comment.new`, `comment.held`, `comment.reported`, `comment.reply`, `comment.approved` written via `lib/notify/emit.ts` (04 C-22); nothing delivered); triggers for `like_count`, `profiles.comment_count` (counts comments that have ever reached `published` — 04 §1.2); SQL rate limits per 04 §5.5 (`postComment` 5 / min + 50 / day per user; `reportComment` 10 / h; `toggleLike` 60 / min); RLS per `docs/data-model.md` §4; index `(target_type, target_id, created_at)`.
- Actions: `postComment` (onboarded + not banned; comments enabled = `coalesce(project_overrides.comments_enabled, not site_settings.comments_closed_default)` per 04 §1.2 else `comments_closed`; strip HTML; ≤1000 chars; ≤1 link; status per moderation mode: `held` if `hold_first_time` and `comment_count = 0`; writes `comment.new` or `comment.held`; reply → also `comment.reply`; revalidate target), `editComment` (author, ≤15 min, sets `edited_at`), `deleteComment` (author **or** role ≥ moderator; soft-delete → `deleted`, `moderated_by/at` set when actor ≠ author — 04 §1.2), `toggleLike`, `reportComment` (reason `spam|rude|other` + note; unique per reporter; ≥3 reports → auto `held` + `comment.held` (reason `reports`) and always `comment.reported`), `moderateComment` (mod; verbs `approve|hide|unhide|delete` per 04 §1.2 transition table; approve → `published` + `comment.approved`; sets `moderated_by/at`, resolves reports), `banUser` (mod; `is_banned`, reason; target role `user` only), `renameHandle` (mod; spec §9 "moderators can rename"; registry addition §6, contract to be added to 04 §1.2 mirroring `banUser`: target role `user`, new handle passes 04 H-rules, sets `profiles.handle` + `handle_changed_at`; see 00-O-15).
- Public UI on `/projects/[slug]` COMMENTS section: `CommentThread`, `Comment`, `Reply` (one level; deeper replies flat with `@handle`), `Composer` (`useOptimistic`), `LikeButton`, `ReportPicker`, `HeldNotice`, `SignInPrompt`, `ModActionRow` (+ Moderate ON/OFF `Toggle` in thread header for mods), `CommentThreadSkeleton`; all §11.2 states: own Edit/Delete, edited marker, inline delete confirm, report confirmation line, count `14 TOTAL`, empty thread, hidden slot, deleted-with-replies slot, banned composer, comments closed, composer error, held (author view + mod view with `FIRST COMMENT` tag), CREATOR / MOD tags.
- Admin `/admin/comments`: queue `Table` (held first, then reported), Approve (filled emerald) / Hide / Delete / Ban user (+ Unhide, Rename handle via inline confirm); sidebar count of held; moderation mode is toggled on `/admin/settings` (S1.1 stub) — S1.4 reads `site_settings.moderation_mode` (seeded `auto`).
- Comments target is polymorphic (`target_type project|skin|art|video`); only `project` is wired in v1 UI (per registry; skins/art threads are not in v1 scope unless a later slice adds them — see §5 00-O-4).

**Scope OUT**
- No delivery of notifications, no matrix / webhook / emails on `/admin/settings` (S1.5). No Realtime. No user inbox (cut, Q29). No comment threads on skins/art/videos pages (00-O-4). No name detection. No `sync.*` events (S1.5).

**Spec traceability:** `docs/spec.md` §4 goal 4, §5 Comments, §9; Q10, Q35, Q38, Q40; `docs/data-model.md` §2.5, §4, §6 "Comment"; `docs/notifications.md` (event catalog v1 rows, "log only" for reply/approved); `DESIGN.md` §5 (Comment bubble, Reply, Held for review, Sign-in prompt), §11.1 (Mod action row, Square toggle), §11.2 (all), §11.7.

**Engineering docs implemented:** 01 §15 (user text), §17 (rate limiting); 02 §1.3 (`/admin/comments`), §2.3 (comments section), §8 row S1.4; 03 §2.4 (Comments), §2.2 (`InlineConfirm`); 04 §0 C-05, C-08, C-22, §1.2 (all seven actions + shared definitions), §5.1, §5.5; 05 §8 row S1.4 (T-RLS-63..89, T-ACT-11..24, T-UNIT-4..8, T-E2E-24..30, 36).

**Acceptance criteria**
1. S1.4.AC1 — Signed-out visitor sees `SignInPrompt` ("Sign in to comment. Your handle is all anyone sees.") in place of the composer; existing comments visible.
2. S1.4.AC2 — Signed-in user posts a comment → appears optimistically, then persisted; toast "Comment posted."; `notification_events` row `comment.new` (or `comment.held`) written with `subject_type/subject_id`.
3. S1.4.AC3 — Limits enforced server-side: 1001 chars → composer error inline "That didn't post." + rule; two links → rejected "Too many links."; HTML stripped; T-ACT proves each.
4. S1.4.AC4 — Moderation mode `hold_first_time` + first-time commenter → comment `held`: author sees the dashed gold-deep bubble + "⏳ HELD FOR REVIEW" + copy; other users do not see it; mods see it with `ModActionRow` + `FIRST COMMENT` tag; Approve → published + `comment.approved` event.
5. S1.4.AC5 — Reply renders one indent level (52 px margin, 2 px left border); a reply to a reply stores the root as `parent_id` and prefixes `@handle`; `comment.reply` event written.
6. S1.4.AC6 — Like toggles `like_count` via trigger (T-RLS: only own like row deletable); liked state = `--indigo-lift` fill with ink text.
7. S1.4.AC7 — Edit allowed for 15 min (T-ACT with clock at 14:59 vs 15:01), sets `edited_at` and shows "· edited"; after 15 min only Delete remains.
8. S1.4.AC8 — Delete asks once inline; deleted comment with replies shows "Deleted." slot with replies intact; without replies the slot still stays (per §11.2) — status `deleted`.
9. S1.4.AC9 — Report picker (Spam / Rude / Something else) → "Reported. OddSense will look at it."; second report by same user → idempotent no-op (no error to UI); third distinct report → comment auto-`held` + `comment.held` (payload `reason='reports'`) **and** `comment.reported` events (04 §1.2; T-ACT-20).
10. S1.4.AC10 — Banned user: composer replaced by "You can't comment here."; RLS blocks insert into `comments`, `comment_likes`, `comment_reports` for banned (T-RLS).
11. S1.4.AC11 — Comments disabled on a project (`project_overrides.comments_enabled=false`, or no override row and `site_settings.comments_closed_default=true`) → CLOSED slab, old comments visible, `postComment` returns `comments_closed` server-side; an override row with `comments_enabled=true` re-opens the thread regardless of the site default (04 §1.2 rule; T-ACT).
12. S1.4.AC12 — Hidden by mod → sunk slab "Hidden by a moderator." (no handle, no body); `moderated_by/at` set.
13. S1.4.AC13 — Rate limit: the 6th comment in 60 s (or 51st in 24 h) → `rate_limited` with plain-language error (04 §5.5; T-ACT-13).
14. S1.4.AC14 — `/admin/comments` lists held + reported first with worded `StatusPill`s (HELD gold-wash, LIVE emerald-wash); Approve/Hide/Unhide/Delete/Ban/Rename handle work and re-check role server-side (T-ACT: user role → `forbidden`; `deleteComment` by a mod sets `moderated_by`); sidebar shows held count.
15. S1.4.AC15 — Comment count `n TOTAL` in Silkscreen ≥11 px beside COMMENTS; empty thread state renders "NO COMMENTS YET / Say something." + one button.
16. S1.4.AC16 — `deleteAccount` (S1.1) leaves the user's comments as "Deleted." slots (`status='deleted'`), removes their likes/reports and avatar object (00-O-16 cascade tested here).
17. S1.4.AC17 — axe zero serious/critical on a detail page with comments (incl. composer focus, dialog-free inline confirms) at 1280 + 390.

**Tests required:** 05 §8 row S1.4 — T-RLS-63..89; T-ACT-11..24 (+ 04 T-ACT-11..27: all seven actions auth matrix + validation — length, links, HTML strip, edit window, rate limits, auto-hold at 3 with both events, moderation-mode branch, comments-enabled rule, mod delete); T-ACT auth matrix for `renameHandle` (ID to be assigned in 05); T-UNIT-4..8; T-E2E-3 (comments part), 24..30, 36; COV-2.

**Gates required:** all seven; `security-reviewer` focus: comments section, rate limits, mod audit fields.

**Demo script**
1. Signed out: see prompt. Sign in as fresh user (mode `hold_first_time` set via SQL) → post → HELD bubble.
2. As mod, open `/admin/comments` → Approve → comment appears publicly.
3. Reply, like, edit (within 15 min), report from a second account ×3 → auto-held.
4. Toggle Moderate ON in the thread header → hide one → "Hidden by a moderator."
5. Ban a user → their composer becomes "You can't comment here."

**Risks / unknowns:** Optimistic UI + held status (must not flash "published" for held comments — resolve status server-side before optimistic render, or optimistic-render as pending); rate limits are SQL counts per 04 C-08 (no edge limiter); `comment_count` counts ever-published comments (04 §1.2; 00-O-13 DECIDED); `renameHandle` has no 04 contract yet — the S1.4 PR adds it to 04 §1.2 (registry addition, ADR-R4: no ADR needed).

---

### S1.5 — Notifications

**Goal:** admins get Discord + email for the v1 event catalog, controlled by the Settings matrix, delivered by a 5-minute cron; sync jobs report failures/staleness.

**Depends on:** S1.4.

**Scope IN**
- Tables: `notification_recipients` (unique index `(event_id, channel, coalesce(address,''))`, 04 §11), `notification_matrix` seeded **exactly** per `docs/notifications.md` default matrix including the P2 rows with the listed values (`comment.new` ON/ON, `comment.held` ON/ON, `comment.reported` ON/ON, `sync.failed`+`sync.stale` ON/OFF, `mention.suggested` OFF/ON, `order.new` ON/ON, `tip.new` OFF/ON); P2 rows cannot fire because no P2 event is emitted in v1 and `updateSettings` rejects them (04 §1.3). `site_settings` columns already exist from S1.1 (data-model §2.4).
- Admin `/admin/settings` (**admin only**; completes the S1.1 stub per 02 §2.8): `NotificationMatrix` (§12.1: rows New comment · Held for review · Reported · Sync failed/stale (one row toggles both kinds); greyed 45 % non-interactive COMING LATER rows Suggested mention · New order · New tip; columns EMAIL · DISCORD; Discord webhook URL masked + Test button + inline ✔/✕; Admin emails as removable chips; helper line "The allay works for admins only…"), Ko-fi section (page name `Field` → `site_settings.kofi_page`; webhook `StatusPill` NOT SET gold-wash in v1), SAVE SETTINGS + "Saved." toast. Moderation radios + Moderators table are unchanged from S1.1.
- Actions: `updateSettings` (admin; full input per 04 §1.3 incl. `discord_webhook_url`, `admin_notify_emails`, `kofi_page`, `matrix`), `testDiscordWebhook` (admin; posts a test embed; returns ✔/✕).
- Jobs: `notifyFanOut` (04 §3.6: step F0 emits `sync.stale` per J-S; then pending events → recipient rows per enabled (kind, channel); email → one row per admin email address; discord → one row per event with **`address = null`** — the webhook URL is read from `site_settings` at send time and never stored in the queue, 04 F2), `notifyDeliver` (04 §3.7: pending → `lib/notify/deliver/discord.ts` / `deliver/email.ts` (Resend, from `NOTIFY_FROM_EMAIL` = `allay@odsens.com`) → `sent`, or `attempts+1` + `error` with backoff 5/10/20/40/80 min and `status='failed'` at attempt 5; >5 eligible per (channel, address) → single digest); route `/api/cron/notify` every 5 min in `vercel.json` (04 §6).
- Emails (`emails/`): `EmailLayout`, `EmailButton`, `EmailBadge`, templates `CommentNew`, `CommentHeld` (gold APPROVE button), `CommentReported`, `SyncFailed`, each with a plain-text version; `pnpm email dev` preview; allay voice per `DESIGN.md` §12.1; wordmark as PNG; one button per mail; footer "why you got it" + "Manage in Settings".
- Discord embed: bot name `allay`, colour bar indigo default / gold held+reported / `--alert` failures; title "Event — Project", excerpt, View link.
- `lib/notify/emit.ts` (04 C-22) is wired into the shared job runner (04 §3 common signature): `syncModrinth` and `syncCurseforge` (the only jobs existing at S1.5) now emit `sync.failed` per 04 J-F (edge-triggered: this run failed and the previous run for the source was ok/absent); `sync.stale` is emitted only by `notifyFanOut` F0 per 04 J-S (sources `modrinth`, `youtube`, `curseforge`*, no ok run in 6 h, once per 6 h per source). Every later job (`syncYoutube` S1.6, `refreshMentions` S1.8, `snapshotStats` S1.9) inherits `sync.failed` emission through the same runner.
- Adapters: `lib/adapters/resend.ts`, `lib/adapters/discord.ts`.

**Scope OUT**
- No user-facing notifications, no in-app bell (S2.5), no `notification_prefs` (P2). No `mention.suggested` delivery (v1.5). No `OrderNew`/`WorkroomUpdate` templates (P2). No second Discord webhook field.

**Spec traceability:** `docs/spec.md` §5 Comments → Notifications, Admin Settings; `docs/notifications.md` (all sections); `docs/data-model.md` §2.4 `site_settings`, §2.6, §5 "Notifications" row; Q11, Q29, Q44; `DESIGN.md` §11.3 #15, §12.1 (Notification matrix, Email template, The allay, Discord embed).

**Engineering docs implemented:** 01 §9 (logging), §18 (jobs); 02 §1.3 + §2.8 (`/admin/settings`), §1.4 + §2.10 (`/api/cron/notify`), §8 row S1.5; 03 §2.10 (`NotificationMatrix`), §2.11 + §6 (Email components); 04 §0 C-22, §1.3 (`updateSettings`, `testDiscordWebhook`), §3 J-F/J-S, §3.6, §3.7, §4 (resend, discord adapters), §6 row notify; 05 §8 row S1.5 (T-RLS-90..101, T-ACT-25..33, T-ADP-17..19, T-UNIT-3, 25..28, T-E2E-37).

**Acceptance criteria**
1. S1.5.AC1 — `/admin/settings` reachable only by role `admin`; a signed-in moderator gets the root 404 page (`notFound()`, 02 RP-04 / §4) and sees no Settings link in `AdminShell`.
2. S1.5.AC2 — Matrix renders the four v1 rows with worded ON/OFF square toggles seeded to the default matrix (`comment.*` ON/ON, sync ON/OFF); the three P2 rows render greyed 45 % and non-interactive with their seeded values visible (`mention.suggested` OFF/ON, `order.new` ON/ON, `tip.new` OFF/ON); SAVE writes only v1 rows to `notification_matrix` (`updateSettings` rejects P2 kinds — T-ACT-32); toast "Saved."
3. S1.5.AC3 — Discord webhook field is masked after save; Test posts an embed to the channel and shows inline ✔ (or ✕ with the plain reason); the raw URL is never returned to the client after save (T-ACT).
4. S1.5.AC4 — Admin emails are entered explicitly as chips; the signed-in admin's Google email is never pre-filled (T-E2E/T-ACT).
5. S1.5.AC5 — Posting a comment (S1.4) → within one `/api/cron/notify` run, recipient rows exist for each enabled channel; Discord message arrives with the correct colour bar; email arrives from `allay@odsens.com` with subject/body in allay voice and a plain-text part.
6. S1.5.AC6 — Turning `comment.new` × EMAIL OFF → next fan-out creates no email row for `comment.new` (T-UNIT).
7. S1.5.AC7 — A failing deliverer (mocked 500) leaves the row `pending` with `attempts+1` and `error`; it is retried after the 04 §3.7 N1 backoff (5/10/20/40/80 min) up to 5 attempts, then `status='failed'` (T-ADP-64, T-ADP-65).
8. S1.5.AC8 — >5 pending rows for one channel → one digest message, all rows marked sent (T-UNIT).
9. S1.5.AC9 — A `syncModrinth` (or `syncCurseforge`) list failure (mock 500s) writes exactly one `sync.failed` per failure episode (04 J-F edge rule; T-ADP-04); a source with no `ok=true` run for 6 h yields exactly one `sync.stale` event per 6 h from `notifyFanOut` F0 (T-ADP-63); 00-O-2 DECIDED.
10. S1.5.AC10 — Email templates render in `pnpm email dev` for all four; visual matches `DESIGN.md` §12.1 rules (0 radius, 2 px solid borders, one button, wordmark PNG, explicit backgrounds); plain-text version exists per template.
11. S1.5.AC11 — Ko-fi page name saved to `site_settings.kofi_page` (regex 04 §1.3); webhook pill reads NOT SET; Moderators table + Moderation radios still work as in S1.1.AC13 (regression).
12. S1.5.AC12 — Cron route: 401 without `CRON_SECRET`; idempotent (running twice sends nothing twice — T-UNIT on status transitions).
13. S1.5.AC13 — Client bundle contains no `RESEND_API_KEY` or webhook URL; `notification_events`/`recipients` are admin-read only (T-RLS).

**Tests required:** 05 §8 row S1.5 — T-RLS-90..101; T-ACT-25..33 (notify route; + 04 T-ACT-30..33 settings/webhook masking); T-ADP-17..19 (+ 04 T-ADP-60..68 fan-out/digest/backoff/stale, T-ADP-04 `sync.failed` edge); T-UNIT-3, 25, 26, 27, 28 (templates HTML + text); T-E2E-37; COV-4.

**Gates required:** all seven; `design-fidelity-reviewer` also covers `emails/`; `security-reviewer` focus: secrets masking, admin-only route.

**Demo script**
1. As admin open `/admin/settings` → paste Discord webhook → Test → ✔ in Discord.
2. Add an admin email chip → SAVE → "Saved."
3. Post a comment as a user → wait ≤5 min (or hit `/api/cron/notify`) → Discord embed + email arrive.
4. Turn Held × DISCORD OFF → SAVE → trigger a held comment → email only.
5. Force a Modrinth failure locally → `sync.failed` email "The allay came back empty-handed."

**Risks / unknowns:** `DISCORD_WEBHOOK_URL` and Oliver's server not yet confirmed (setup to-do) — Test button proves it when available; allay pixel render pending (Q44) — ship with a placeholder slot and no image until the asset lands (ADR not needed; note in PR); Reply-To `allay@odsens.com` depends on inbound forwarding (S1.10 DNS) — set `Reply-To` only after that to-do is done (record in PR).

---

### S1.6 — Videos

**Goal:** the YouTube channel on the site — hourly sync, `/videos` with click-to-load facades, Up next, Shorts row, and Latest videos on Home.

**Depends on:** S0 (registry) **and S1.5** — this plan sequences S1.6 after S1.5 (§1.4 tag order), so `syncYoutube` emits `sync.failed` through `lib/notify/emit.ts` from its first merge (04 J-F) and `notifyFanOut` F0 covers source `youtube` (04 J-S). No conditional path.

**Scope IN**
- Table: `videos` (per `docs/data-model.md` §2.3; `is_short` detection duration ≤ 60 s or `#shorts` in title/description — refine via ADR if needed, e.g. `ADR-000n-shorts-detection.md`); RLS: published/not hidden to all; admin all.
- Adapter `lib/adapters/youtube.ts`: RSS (`YOUTUBE_CHANNEL_ID`) for cheap new-video detection; Data API `playlistItems` (uploads playlist) + `videos` for duration/stats; quota budget logged; 10 s timeout, retry ≤3.
- Job `syncYoutube` (04 §3.3: upsert by `youtube_id`, never delete, `sync_runs`, `revalidateTag('videos')`, `sync.failed` via the S1.5 runner); route `/api/cron/sync-youtube` (04 §6 `27 * * * *`) in `vercel.json`.
- Public: `/videos` (big `VideoFacade` player — nothing from YouTube loads until click, `youtube-nocookie.com` embed; Bungee title, view/date meta, blurb; `UpNextList` 132 px thumbs, selected = `--indigo-lift` outline; long-form grid below on phone; `ShortsRow` 9:16 104 px gold duration chip, horizontal scroll on phone; empty state §11.7); Home "Latest videos" 2-up beside "Find me" list (Modrinth / CurseForge / YouTube) per §6.1.
- Admin: hide/unhide a video via action `updateVideo` (`lib/actions/videos.ts`, admin; input `{youtube_id, hidden?, is_short?}` — 04 OPEN-7 / §11, registry addition §6) triggered from a videos list on the `/admin` dashboard — **no `/admin/videos` route** (00-O-5).

**Scope OUT**
- No comments on videos (00-O-4). No mentions (S1.8). No stats snapshot (S1.9). No custom `play` analytics event (S1.9).

**Spec traceability:** `docs/spec.md` §3 YouTube, §5 Videos, Home; `docs/platform-audit.md` YouTube; `docs/data-model.md` §2.3, §5 YouTube row; Q30; `DESIGN.md` §6.1 (Latest videos), §6.4, §11.1 (Video facade), §11.5, §11.7; `docs/design-review.md` #19 (nocookie + facades).

**Engineering docs implemented:** 01 §13 (embeds, INV-59 excluded); 02 §1.1 (`/videos`), §1.4 (`/api/cron/sync-youtube`), §2.1 item 4 (Latest videos + Find me), §8 row S1.6; 03 §2.6 (Videos); 04 §3.3, §4 (youtube adapter), §5.3, §6 row youtube, §11 (`updateVideo`); 05 §8 row S1.6 (T-RLS-48..52, T-ACT-33, 53, T-ADP-9..13, T-UNIT-12, 29, T-E2E-1, 6).

**Acceptance criteria**
1. S1.6.AC1 — Authorized `/api/cron/sync-youtube` upserts all channel uploads (21 at spec time) with duration + view counts; second run is idempotent; `sync_runs` row written; 401 without secret.
2. S1.6.AC2 — `/videos` initial load makes **zero** requests to any youtube/google host (network log); clicking the facade loads `youtube-nocookie.com/embed/<id>`.
3. S1.6.AC3 — Facade matches §11.1: thumbnail + scrim, 88 px indigo play block with white triangle, duration chip bottom-right (Silkscreen ≥11 px), `CLICK TO LOAD YOUTUBE` chip bottom-left.
4. S1.6.AC4 — `UpNextList` selection swaps the main player and moves the `--indigo-lift` outline; keyboard reachable with the gold focus ring.
5. S1.6.AC5 — Shorts appear only in `ShortsRow` (9:16, gold duration chip), never in the long-form grid; a video with duration ≤60 s or `#shorts` is `is_short=true` (T-ADP).
6. S1.6.AC6 — Home shows the two newest non-hidden, non-short videos as facades beside the Find me list.
7. S1.6.AC7 — Hidden video (`hidden=true` via `updateVideo` from the `/admin` dashboard) never renders publicly; `updateVideo` as moderator/user → `forbidden` (T-ACT auth matrix).
11. S1.6.AC11 — A forced `syncYoutube` list failure writes one `sync.failed` event (04 J-F) and the S1.5 pipeline delivers it.
8. S1.6.AC8 — Empty state "NO VIDEOS YET / They'll show up here when they exist." + channel link when the table is empty (T-E2E with empty seed).
9. S1.6.AC9 — Data API calls per sync ≤ documented budget (log line with units) and the key is server-only (bundle grep).
10. S1.6.AC10 — `/videos` ISR with tag `videos`; axe zero serious/critical at 1280 + 390; CLS < 0.1 (facade has fixed aspect box).

**Tests required:** 05 §8 row S1.6 — T-RLS-48..52; T-ACT-33 (youtube route), 53; T-ADP-9..13 (+ 04 T-ADP-20..24 RSS/Data API/shorts/idempotent); T-UNIT-12, 29; T-E2E-1 (Latest videos), 6; T-ACT auth matrix for `updateVideo` (ID to be assigned in 05).

**Gates required:** all seven; `security-reviewer` focus: embeds (nocookie, CSP frame-src), key not in bundle.

**Demo script**
1. Trigger `/api/cron/sync-youtube` → open `/videos`.
2. Note network panel: no YouTube requests. Click play → player loads.
3. Click an Up next item → swaps. Scroll to Shorts row.
4. Home → Latest videos 2-up.

**Risks / unknowns:** Shorts detection heuristic accuracy (04 OPEN-8; ADR slug reserved `ADR-000n-shorts-detection.md`, number per 06 ADR-N3); YouTube quota if `search` were used — use `playlistItems` (uploads) instead; thumbnails hosts allow-list for `next/image`.

---

### S1.7 — Skins + Art

**Goal:** Oliver's skins (3D-rendered) and art (natural-aspect masonry) hosted on the site with admin add/edit and uploads.

**Depends on:** S1.1.

**Scope IN**
- Tables: `skins`, `art` (per `docs/data-model.md` §2.4); buckets `skins` (public-read; 64×64 PNG ≤64 KB textures; cached bust renders ≤512 KB), `art` (public-read; ≤10 MB); RLS published to all, admin all; storage policies service-role only (01 INV-33) — skin textures travel inline in the action (≤64 KB, 04 C-18), art images use the 04 §1.4.5 two-phase signed-upload flow.
- Actions (admin, 04 §1.5): `createSkin`, `updateSkin` (name, description_md, texture upload with 64×64 PNG validation, `model classic|slim`, `is_exclusive`, status, sort_order), `createArt`, `updateArt` (title, kind `avatar|thumbnail|icon|render|other`, image via two-phase, width/height computed server-side, year, credit, downloadable, status, sort_order).
- Job: `renderSkinBust` (on skin insert/update from the server action → `skins.render_bust_path`; fallback: client-side render cached on first view); `scripts/render-skins.mjs` for bulk (`add-content` use).
- Public: `/skins` (§6.5: big live `SkinViewer3D` panel (client, lazy-loaded skinview3d) with spin / walk / front-back controls; 4-up `SkinCard` grid of rendered busts in 3:4 slots with the 64×64 source pinned small at integer scale `image-rendering: pixelated`; name + description + DOWNLOAD PNG + Slim toggle under the viewer; selected card `--indigo-lift` outline; `ExclusiveBadge` when `is_exclusive`; empty state §11.7); `/art` (§6.6: filter row all / avatars / thumbnails / icons; `ArtMasonry` column-flow, natural aspect, 18 px gutter, 4 cols desktop / 2 phone / 1 under 480; `ArtCard`; `Lightbox` with title, year, optional download; empty state).
- Admin: `/admin/skins`, `/admin/art` (add/edit forms with `UploadWell`, `Table` with status pills, reorder; moderators read-only per 02 §1.3).
- Skin DOWNLOAD PNG = direct link to the public `skins/{skin_id}/texture.png` object with a `download` attribute; **no counter in v1** (`skins.downloads` stays 0 — 00-O-17 OPEN).

**Scope OUT**
- No comments on skins/art (00-O-4). No hero 3D skin on Home (design chose the featured-project hero; Q31). No stats (S1.9). No bulk `add-content` skill (S1.10 writes Oliver's skills).

**Spec traceability:** `docs/spec.md` §5 Skins, Art, Admin Skins/Art; Q4, Q37; `docs/platform-audit.md` (skins, Mojang); `docs/data-model.md` §2.4, §3 (`skins`, `art`), §5 "Skin renders"; `DESIGN.md` §4 (pixelated), §6.5, §6.6, §10 (assets), §11.7.

**Engineering docs implemented:** 01 §11 (uploads); 02 §1.1 (`/skins`, `/art`), §1.3 (`/admin/skins`, `/admin/art`), §8 row S1.7; 03 §2.7 (Skins/Art), `Lightbox` reuse (§2.3); 04 §1.4.5, §1.5 (`createSkin`/`updateSkin`, `createArt`/`updateArt`), §3.8 (`renderSkinBust`); 05 §8 row S1.7 (T-RLS-53..62, 121..122, T-ACT-56..61, T-UNIT-17..19, T-E2E-7, 8, 9, 38).

**Acceptance criteria**
1. S1.7.AC1 — Admin uploads a 64×64 PNG → skin created as draft; a 128×128 or JPEG is rejected with the plain error; publish → appears on `/skins`.
2. S1.7.AC2 — `/skins` main panel is a live 3D model of the selected skin (skinview3d) — never a flat texture and never a profile picture; controls spin / walk / front-back work; `prefers-reduced-motion` stops idle spin.
3. S1.7.AC3 — Grid slots show rendered busts (from `render_bust_path`, or client-render fallback if null) in 3:4 with the source PNG pinned small at integer scale with `image-rendering: pixelated`.
4. S1.7.AC4 — DOWNLOAD PNG serves the 64×64 texture as a file download (`download` attribute on the public object URL); no counter is incremented in v1 (00-O-17); Slim toggle switches the model.
5. S1.7.AC5 — skinview3d is lazy-loaded (`/skins` first-load JS excludes it until the viewer mounts; `next build` route table + `frontend-reviewer`).
6. S1.7.AC6 — `/art` masonry renders each image at natural aspect (`height:auto`, no crop); filter row filters by `kind`; lightbox shows title, year, download only when `downloadable`.
7. S1.7.AC7 — Art upload >10 MB rejected with the number; accepted image records `width/height`.
8. S1.7.AC8 — Empty states: "NO SKINS YET / Working on it. Check the projects meanwhile." and "NO ART HERE YET / Nothing in this filter. Try \"all\"."
9. S1.7.AC9 — RLS: anon/user cannot mutate `skins`/`art`; drafts invisible publicly; no `insert` policy on `storage.objects` for `anon`/`authenticated` (uploads go through the actions; art via signed upload URLs minted server-side, 04 §1.4.5); `createSkin`/`createArt` as moderator → `forbidden` (T-ACT-57/60 mod = denied).
10. S1.7.AC10 — `ExclusiveBadge` on exclusive skins; alt text on every skin/art image; axe zero serious/critical at 1280 + 390 on `/skins`, `/art`, admin forms.
11. S1.7.AC11 — `scripts/render-skins.mjs` renders busts for all skins missing `render_bust_path` (idempotent).

**Tests required:** 05 §8 row S1.7 — T-RLS-53..62, T-RLS-121..122; T-ACT-56..61 (+ 04 T-ACT-60..63 dimensions/type/size, T-ADP-70/71 bust render); T-UNIT-17 (all), 18 (`skins`, `art`), 19; T-E2E-7, 8, 9, 38.

**Gates required:** all seven; `security-reviewer` focus: uploads (images re-encode/type sniff); `frontend-reviewer` focus: lazy skinview3d bundle.

**Demo script**
1. `/admin/skins` → upload `assets/brand/skins/skin-*.png` (one) → publish.
2. `/skins` → spin it, walk, flip; toggle Slim; DOWNLOAD PNG.
3. `/admin/art` → upload two pieces of different aspect → publish.
4. `/art` → masonry with natural sizes; filter avatars; open lightbox.

**Risks / unknowns:** headless bust rendering on Vercel serverless (WebGL) — fallback is client render + cache (decided in data-model); WebGL in Playwright CI (use software GL flag or assert fallback path); skinview3d bundle size (~150 KB gz) exceeds the 50 KB stop-and-ask threshold — pre-approved by `docs/framework-decision.md` (lazy-load), note in PR.

---

### S1.8 — Seen on

**Goal:** third-party coverage curated by Oliver — paste a URL, auto-fetch metadata, publish; shown on project detail, Home, and `/seen-on`, with hourly view-count refresh.

**Depends on:** S1.2, S1.6.

**Scope IN**
- Table: `mentions` (per `docs/data-model.md` §2.3b; `status draft|suggested|published|hidden`, `source manual|auto`, `featured`, `sort_order`, `view_count`); RLS published to all, drafts/suggested admin only.
- Adapter `lib/adapters/oembed.ts` (YouTube oEmbed / Data API `videos` for id + views; generic Open Graph fallback for tiktok/twitch/reddit/article/other; 10 s timeout; server-side fetch with URL allow-list of http(s) + no private IPs).
- Actions (admin, 04 §1.6; moderators see `/admin/mentions` read-only): `fetchMentionPreview` (paste URL → metadata → `MentionPreview`), `createMention` (assign `project_id` or null = "About OddSense generally"; publish), `updateMention` (feature/hide/reorder/reassign).
- Job `refreshMentions` (04 §3.4: hourly; YouTube `videos?id=…` batched 50/req → `view_count`; `sync_runs` source `mentions`; on failure emits `sync.failed` through the S1.5 runner — 04 J-F; `sync.stale` is not tracked for `mentions` per 04 J-S); route `/api/cron/refresh-mentions` (04 §6 `37 * * * *`) in `vercel.json`. Daily reach snapshot lands in S1.9's `snapshotStats` (`metric='reach'`).
- Public: `SeenOnRow` on `/projects/[slug]` between VERSIONS & FILES and COMMENTS (title + count, 2-up `MentionCard`; **renders nothing when the project has no mentions**); Home `InTheWildStrip` after Featured (3–4 featured mentions + `ReachLine` + "All mentions →"; hidden when none); `/seen-on` (three `StatTile`s for reach totals, `FilterBar` ALL + platform counts + project `Select`, 3-up grid newest first with footer strip type badge + project link, general mentions tagged with the ODSENS wordmark chip; 1-up phone); `Footer` second dry line "Creators featuring the mods aren't affiliated with odsens." added site-wide (registry S1.8; 02 RP-13; DESIGN §12.2).
- `MentionCard`: YouTube → inline facade→player + `--indigo-lift` outline + "on YouTube ↗" ghost; other platforms link out with ↗ chip + "WATCH ON <PLATFORM>" chip; official platform marks (24 px) — assets pending Q44 (placeholder neutral slab until supplied).
- Admin `/admin/mentions`: paste URL → preview card → assign → PUBLISH; `Table` with FEATURED / LIVE / HIDDEN worded tags, ⠿ drag-reorder (featured order feeds Home), Feature/Hide; **Suggested tab UI stub** (empty state, no auto-discovery job).

**Scope OUT**
- No YouTube search / auto-suggest cron (S2.4 / v1.5). No `mention.suggested` events. No comments on mentions. No stats snapshot (S1.9 adds `reach`).

**Spec traceability:** `docs/spec.md` §5 Seen on; Q41, Q44; `docs/data-model.md` §2.3b, §5 "Mentions refresh"; `DESIGN.md` §12.1 (Mention card, Reach line), §12.2 (four surfaces, nav, footer), §11.1 (Stat tile, Video facade).

**Engineering docs implemented:** 01 §13 (third-party marks); 02 §1.1 (`/seen-on`), §1.3 (`/admin/mentions`), §1.4 (`/api/cron/refresh-mentions`), §2.1 item 3, §2.3 SEEN ON, §2.6, §8 row S1.8; 03 §2.1 `Footer` line 2, §2.8 (Seen on); 04 §1.6, §3.4, §4 (oembed adapter, SSRF rules), §5.4, §6 row mentions; 05 §8 row S1.8 (T-RLS-102..106, T-ACT-33, 54, 62..64, T-ADP-14..16, T-UNIT-9, T-E2E-1, 3/5, 10, 39).

**Acceptance criteria**
1. S1.8.AC1 — Admin pastes a YouTube URL → preview shows thumb, title, creator, views, date; pastes a Reddit/article URL → OG preview; a private-IP or non-http URL is rejected server-side (T-ACT).
2. S1.8.AC2 — Assign to a project → PUBLISH → the mention appears in `SeenOnRow` on that project's detail page (2-up cards, count in Silkscreen) and on `/seen-on`.
3. S1.8.AC3 — A project with zero mentions renders no SEEN ON section at all; Home renders no IN THE WILD strip when no mention is featured (no empty state, per §12.1).
4. S1.8.AC4 — Feature 3 mentions → Home strip shows them in `sort_order`, `ReachLine` reads e.g. "1.2M VIEWS · 6 VIDEOS · 4 CREATORS" (numbers computed from published mentions), "All mentions →" links `/seen-on`.
5. S1.8.AC5 — YouTube `MentionCard` click loads the inline player (nocookie), takes the `--indigo-lift` outline, shows "on YouTube ↗"; TikTok/Twitch/Reddit/article cards link out with ↗ + "WATCH ON <PLATFORM>" (or "READ ON" for article — see §5 00-O-6).
6. S1.8.AC6 — `/seen-on`: three stat tiles (views, videos/mentions, creators), filter by platform with counts, project select; general mentions carry the ODSENS wordmark chip; newest first.
7. S1.8.AC7 — `/api/cron/refresh-mentions` updates `view_count` for YouTube mentions in batches of ≤50 ids per request; idempotent; `sync_runs` row (source `mentions`); 401 without secret; a forced Data API list failure writes one `sync.failed` event (04 J-F) delivered by the S1.5 pipeline.
8. S1.8.AC8 — Hidden mentions vanish from all three public surfaces; drag-reorder persists `sort_order`.
9. S1.8.AC9 — Footer shows the second dry line "Creators featuring the mods aren't affiliated with odsens." on every page from this slice on (T-E2E-1 footer line).
10. S1.8.AC10 — Suggested tab renders (empty state) with Approve/Dismiss disabled or absent; no job inserts `suggested` rows.
11. S1.8.AC11 — Creator display = public channel name + link only (no other creator data stored beyond `creator_name/creator_url`).
12. S1.8.AC12 — axe zero serious/critical on `/seen-on`, a project with mentions, `/admin/mentions` at 1280 + 390.

**Tests required:** 05 §8 row S1.8 — T-RLS-102..106; T-ACT-33 (refresh-mentions route), 54, 62..64 (SSRF); T-ADP-14..16 (+ 04 T-ADP-30/31 batching); T-UNIT-9; T-E2E-1 (IN THE WILD + footer line), 3/5 (SEEN ON row), 10, 39.

**Gates required:** all seven; `security-reviewer` focus: server-side URL fetch (SSRF), admin actions; `backend-reviewer` focus: batching, quota.

**Demo script**
1. `/admin/mentions` → paste a YouTube URL about a mod → preview → assign → PUBLISH.
2. Open that project → SEEN ON row; click → inline player.
3. Feature it + two more → Home IN THE WILD strip + reach line.
4. `/seen-on` → filter by YouTube, pick a project.
5. Hide one → gone everywhere.

**Risks / unknowns:** OG fetch against bot-blocking hosts (Reddit/TikTok may 403) — preview falls back to manual fields (title/creator editable in admin; note in 04); official platform marks (Q44) — placeholder until supplied; drag-reorder a11y (provide move up/down buttons too — `frontend-reviewer`).

---

### S1.9 — Stats + Support

**Goal:** daily stats snapshots with an admin Stats page, and the Support page (Ko-fi wrapper) + site-wide floating support button + Vercel custom events.

**Depends on:** S1.2, S1.4.

**Scope IN**
- Table `stats_daily` (PK `(day, metric, source, entity_type, entity_id)`; site rows use the 04 §3.5 sentinel `entity_id`); job `snapshotStats` daily 03:00 UTC per 04 §3.5 (metrics `downloads` per source per project + site totals, `views`/`subs` youtube, `comments`/`comments_held`, `reach` from mentions, `tips/kofi` = 0 in v1; aggregates `project_downloads`, purges rows >90 days, deletes orphan upload objects >24 h (U1); date-idempotent `on conflict do update`; `sync.failed` via the S1.5 runner on failure); route `/api/cron/stats-snapshot` (04 §6 `0 3 * * *`) in `vercel.json`.
- Admin `/admin/stats` (§11.3 #16): four `StatTile`s (downloads 7 days, downloads all time, comments with held count, tips 30 days — shows `0` in v1 per 04 §3.5 (f)), `FlatBarChart` last 30 days stacked by source with fixed colours (Modrinth `--emerald`, CurseForge `--orange`, direct `--indigo-lift`) + swatch **and** word, phone 15 bars (two days each) with the label saying so, honest line "Modrinth and CurseForge report their own counts. Direct downloads are the ones we serve."; a tile whose window has no snapshot yet shows `0` with context text "no data yet" (00-O-18 OPEN).
- Public `/support` (§6.7 + §11.4 + 02 §2.7): gold hatched `AmountPicker` ($1 / $3 / $5 / Other, $3 preselected) + single CONTINUE ON KO-FI button handing off to Ko-fi overlay/panel; `KofiPanelSlot` labelled dashed click-to-load slot where Ko-fi's iframe renders for **`site_settings.kofi_page`** (DB is the source of truth; env `KOFI_PAGE` is only the S1.1 seed value — 00-O-19); `kofi_page` empty → picker + button disabled with the mute line "Tips open soon.", slot hidden (02 O-8); "What it pays for" slab; `Leaderboard` block in **empty state** ("NOBODY YET / Be first." + how-to line) — no data source yet. `TipPanel` on project detail (placeholder since S1.2) gets its final §7-voice copy linking `/support`; Home compact `TipPanel` beside Latest videos / Find me is **built here** (02 §2.1 item 4; hidden when `kofi_page` empty).
- `FloatingSupportButton` (gold, ♥ SUPPORT, hides on scroll-down, returns on scroll-up; 52 px square on phones) on every public route **except `/support`**; not on `/welcome` or under `/admin/*` (02 RP-15).
- Vercel Analytics custom events (`@vercel/analytics` `track` via 03 `TrackedLink`): `download` {project, source}, `tip_click` {amount}, `video_play` {id}, `sign_in` — names per 01 INV-59; payload keys per §6 "Analytics events" (04 §5.6 to be added); dashboard toggle happens in S1.10.

**Scope OUT**
- No Ko-fi webhook, `kofi_events`, `supporters`, live leaderboard (S2.1). No Web Analytics dashboard enablement / Speed Insights component (S1.10). No Sentry (S1.10). No stats CLI skill (S1.10 writes `stats`).

**Spec traceability:** `docs/spec.md` §4 goal 5 (Support), §7 Analytics; `docs/analytics-options.md` (#3, #4, #5); `docs/data-model.md` §2.9, §5 "Stats snapshot", §2.8 (P2 refs); `docs/platform-audit.md` Ko-fi; Q12, Q33; `DESIGN.md` §5 (Floating support button), §6.7, §11.1 (Stat tile, Flat bar chart), §11.3 #16, §11.4, §12.4 (leaderboard incl. empty state).

**Engineering docs implemented:** 01 §13 (INV-59 analytics), §20 (Ko-fi frame-src); 02 §1.1 (`/support`), §1.3 (`/admin/stats`), §1.4 (`/api/cron/stats-snapshot`), §2.1 item 4 (compact `TipPanel`), §2.7, RP-15, §8 row S1.9; 03 §2.1 (`FloatingSupportButton`), §2.2 (`StatTile`, `FlatBarChart`, `TrackedLink`), §2.3 (`TipPanel`), §2.9 (Support); 04 §3.5, §6 row stats, §5.6 analytics events (**to be added to 04** — see §6); 05 §8 row S1.9 (T-RLS-107..110, T-ACT-33, 55, T-E2E-11, 40, custom-events smoke).

**Acceptance criteria**
1. S1.9.AC1 — Authorized `/api/cron/stats-snapshot` writes one row per (metric, source, entity) for today; running twice yields the same rows (upsert); `project_downloads` older than 90 days are purged (T-UNIT with seeded old rows); 401 without secret.
2. S1.9.AC2 — `/admin/stats` (role ≥ moderator) shows four tiles with numbers derived from `stats_daily` deltas (tips tile = `0`); the chart stacks three fixed source colours with swatch + word legend; phone shows 15 bars and says so.
3. S1.9.AC3 — Chart is hand-rolled SVG (no chart library in `package.json`), 0 radius, no gradients, Silkscreen 11 px axis labels.
4. S1.9.AC4 — `/support`: picker preselects $3, CONTINUE ON KO-FI opens Ko-fi's overlay/panel for `site_settings.kofi_page` with the chosen amount where Ko-fi supports it; the Ko-fi iframe loads only on `/support` (CSP frame-src) and only after the click-to-load slot is activated; with `kofi_page` empty the picker/button are disabled and the mute line "Tips open soon." shows.
5. S1.9.AC5 — Leaderboard block renders the empty state "NOBODY YET / Be first." + the how-to line from §12.4; no amounts, no rows.
6. S1.9.AC6 — `FloatingSupportButton` on every public page except `/support`; absent on `/welcome` and under `/admin/*` (02 RP-15); hides on scroll-down, returns on scroll-up; phone = 52 px gold square with heart; links to `/support`; 44 px+ target; `prefers-reduced-motion` drops the transform.
7. S1.9.AC7 — `TipPanel` on project detail and the Home compact panel (new here) link to `/support` (copy from §7 voice, no begging); Home panel absent when `kofi_page` is empty.
8. S1.9.AC8 — Custom events fire (`track` calls observed with `@vercel/analytics` stubbed): `download {project, source}` on a download button, `tip_click {amount}` on the picker button, `video_play {id}` on a facade click, `sign_in` on Sign in; payload keys exactly as §6 "Analytics events"; no PII in payloads (T-UNIT + 05 §8 S1.9 custom-events smoke).
9. S1.9.AC9 — RLS: `stats_daily` admin-read, service-role write.
10. S1.9.AC10 — axe zero serious/critical on `/support`, `/admin/stats` at 1280 + 390; chart has a text alternative (table or `aria-label` summary).

**Tests required:** 05 §8 row S1.9 — T-RLS-107..110; T-ACT-33 (stats route), 55 (+ 04 T-ADP-50..53 snapshot idempotency/purge/orphans); T-E2E-11, 40; custom-events smoke (`window.va` stub); T-UNIT analytics payload schema (no PII — ID to be assigned in 05).

**Gates required:** all seven; `security-reviewer` focus: Ko-fi iframe CSP, admin route; `frontend-reviewer` focus: floating button scroll listener perf, chart a11y.

**Demo script**
1. Hit `/api/cron/stats-snapshot` twice → `/admin/stats` shows tiles + chart.
2. Resize to 390 → 15 bars + label.
3. `/support` → pick $3 → CONTINUE ON KO-FI → overlay opens (stop before paying).
4. Scroll a project page down/up → floating button hides/returns.

**Risks / unknowns:** Ko-fi account/page not yet created (setup to-do; `KOFI_PAGE=oddsense` unconfirmed) — build against a test page name and record; Ko-fi preset-amount behaviour unverified (`docs/design-review.md` #13); first days of `stats_daily` have no deltas (00-O-18); 04 has no analytics section yet — the S1.9 PR adds §5.6 (registry addition, ADR-R4: no ADR needed).

---

### S1.10 — Launch

**Goal:** odsens.com live on production with real content, monitoring, Oliver's helper skills, and the launch verification pass; tag `v1.0.0`.

**Depends on:** S1.1–S1.9 (all merged).

**Scope IN**
- Supabase Branching + Vercel integration verified end-to-end (branch per PR, migrations promote on merge to `main`; production DB has all migrations; `supabase/config.toml` remote `site_url`/redirects correct).
- DNS cutover: Squarespace DNS → Vercel (A `76.76.21.21` / CNAME `cname.vercel-dns.com`); `www` redirect → apex; Resend DMARC `TXT _dmarc` (`p=none`, rua David) + inbound forwarding for `allay@odsens.com` (option (a) per `docs/questions.md`) → set `Reply-To: allay@odsens.com` in `deliver/email.ts`; Google OAuth redirect list includes `https://odsens.com/**`.
- Vercel: Deployment Protection **off for production** only (previews stay Standard); Web Analytics + Speed Insights enabled + components mounted; `vercel.json` cron list = 6 v1 routes verified in the dashboard; env var names complete for production (`.env.example` parity incl. `CURSEFORGE_API_KEY`, `RESEND_API_KEY`, `DISCORD_WEBHOOK_URL`); production `NEXT_PUBLIC_SITE_URL=https://odsens.com`.
- Sentry (server + client, DSN via env `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` — §6), error boundary reports; `beforeSend` strips `user.email`, `user_metadata`, and request cookies/headers; handles are public and may remain.
- Seed real content: Oliver's skins (`assets/brand/skins/*`) and art (`assets/brand/art/*`, avatar) via `add-content` flow into production as **drafts**; Oliver publishes from admin (stop-and-ask: publishing is human).
- Featured projects + first mentions curated by Oliver (human).
- Oliver's laptop setup per `docs/dev-tooling.md` (repo access, `.env` from David, `pnpm dev`).
- Skills written: `start-here`, `whats-wrong`, `restyle`, `new-feature`, `db-change`, `add-content`, `sync-now`, `write-copy`, `stats`, `upkeep` (specs `docs/site-management-skills.md` §3; boundaries per `docs/skill-handoffs.md`).
- `CLAUDE.md` build-time version (outline in `docs/site-management-skills.md` §6); `docs/spec.md` status → shipped v1; `docs/questions.md` setup list closed.
- `deploy-checker` PASS on production URL; production smoke: home, projects, a detail, download, sign-in round-trip, `/support`, cron routes 401 unauthenticated.
- Tag `v1.0.0`; phase report (`build-phase` step 6).

**Scope OUT**
- No new features. No Phase 2 tables. No "Commissions" nav item (stays hidden). No `/api/og` unless 00-O-7 decides otherwise.

**Spec traceability:** `docs/spec.md` §7 (infra table, repo, accounts), §4 goal 6 (skills), §10; `docs/questions.md` setup to-dos, Q36, Q44; `docs/dev-tooling.md`; `docs/notifications.md` "Resend account wiring" gaps; `docs/analytics-options.md` #1, #2, #8; `docs/site-management-skills.md` §3, §6; `.claude/skills/vercel-ops/SKILL.md` (domain, checklist).

**Engineering docs implemented:** 01 §7 (INV-36/37 env parity), §13 (INV-59 analytics scripts), §24; 02 §7 smoke list, §8 row S1.10 (all routes live on prod); 04 §6 (all six cron rows in `vercel.json`); 05 §8 row S1.10 (T-E2E-43, 44 via `deploy-checker`; COV-5).

**Acceptance criteria**
1. S1.10.AC1 — `https://odsens.com` and `https://www.odsens.com` (redirect) serve the site with a valid certificate; no Vercel Auth wall on production; previews still protected.
2. S1.10.AC2 — Vercel dashboard cron list shows exactly: `/api/cron/sync-modrinth`, `/api/cron/sync-curseforge`, `/api/cron/sync-youtube`, `/api/cron/refresh-mentions`, `/api/cron/stats-snapshot`, `/api/cron/notify` with the schedules in 04; each returned `ok=true` in `sync_runs` within its first cycle.
3. S1.10.AC3 — Google sign-in on production completes and lands on `/welcome` for a new account.
4. S1.10.AC4 — `deploy-checker` PASS on production: env names present, headers, no secrets in bundle, pages 200 with expected `<title>`.
5. S1.10.AC5 — Web Analytics + Speed Insights show data within 24 h; a custom `download` event appears.
6. S1.10.AC6 — Sentry receives a test event from server and client; events contain no email.
7. S1.10.AC7 — DMARC record resolves (`dig TXT _dmarc.odsens.com`); a reply to a notification email reaches David's inbox; notification emails carry `Reply-To: allay@odsens.com`.
8. S1.10.AC8 — Supabase: production project has every migration applied (`supabase migration list` matches repo); a test PR after launch spins a preview branch automatically.
9. S1.10.AC9 — Real content: every file in `assets/brand/skins/*.png` (8 at freeze) and every piece in `assets/brand/art/*` + the avatar has a `skins`/`art` row in production (draft or published — Oliver's choice); the Home hero shows a featured project chosen by Oliver.
10. S1.10.AC10 — Ten Oliver skills exist in `.claude/skills/` (plus `ship`, `keep-docs` from S0), each with frontmatter + the six required sections + boundaries block; `CLAUDE.md` build-time version merged.
11. S1.10.AC11 — Oliver ran `pnpm dev` on his laptop against a preview branch or local stack and opened a PR (or David did with him) — recorded in the phase report.
12. S1.10.AC12 — Q36 (under-13 privacy line) confirmed by David; the copy on `/privacy` matches the decision.
13. S1.10.AC13 — Tag `v1.0.0` on `main`; `docs/spec.md` revision log entry "v1 shipped"; phase report posted.

**Tests required:** 05 §8 row S1.10 — T-E2E-43, T-E2E-44 on the preview and then production (read-only: home, projects, detail, videos, skins, art, seen-on, support, privacy, 404, cron 401) with axe; env parity (`.env.example` vs `vercel env ls` names — `deploy-checker`, area label `T-UNIT env-parity`, §6); full suite green on `main`; COV-5.

**Gates required:** all seven; `deploy-checker` on the **production** URL is mandatory; `security-reviewer` full checklist pass as the launch audit.

**Demo script**
1. Open `https://odsens.com` on a phone → sign in → onboard → comment on a project.
2. Download an exclusive file; check `/admin/stats` next day.
3. Confirm Discord + email notification arrived for that comment.
4. Oliver publishes a skin from `/admin/skins`; it appears on `/skins`.
5. Verify cron list + `sync_runs` in admin `SyncStatus`.

**Risks / unknowns:** DNS propagation window (do the cutover after prod is verified on the `*.vercel.app` URL with protection off briefly, or attach the domain first); Deployment Protection off exposes prod — do it last; `CURSEFORGE_API_KEY` / Ko-fi / Discord to-dos may still be open (launch can proceed with CF counts = 0 and Ko-fi test page — record as known gaps in the phase report, not blockers, unless David decides otherwise).

---

## 3. Phase 2 — stubs (detailed via ADR + doc edit when approached)

| ID | Name | Goal (1 line) | Scope IN (outline) | Depends on | Sources |
|---|---|---|---|---|---|
| **S2.1** | Ko-fi webhook + leaderboard | Tips flow into the site and the supporters leaderboard goes live. | `/api/webhooks/kofi` (verify `KOFI_WEBHOOK_VERIFICATION_TOKEN` constant-time, dedupe `kofi_message_id`), tables `kofi_events`, `supporters`, hashed-email match → `@handle` in message → Anonymous (Q33), `tip.new` event + matrix row live, `Leaderboard` + `LeaderboardRow` with data (top 3 cards, amounts only if linked or `is_public`), Settings Ko-fi webhook `LIVE` pill, `stats_daily` `tips`. | S1.5, S1.9 | `docs/data-model.md` §2.8, `docs/platform-audit.md` Ko-fi, `DESIGN.md` §12.4, Q33 |
| **S2.2** | Custom Orders intake | Visitors can hire Oliver via a form; orders appear in admin. | table `orders`, `/commissions` form (§6.8: loader shown only for mod/plugin), post-submit "SENT." (§12.5), `ProfileMenu` "Your orders" with unread count, `/admin/orders` list + detail (§11.3 #17: REPLY BY EMAIL, status selector), `order.new` event + matrix row live, `OrderNew` email template, **nav item "Commissions" shown**, footer "Custom orders" link. | S1.5 | `docs/spec.md` §4 5b, `docs/data-model.md` §2.7, `DESIGN.md` §6.8, §11.3 #17, §12.5 |
| **S2.3** | Workrooms | Private per-commission room with posts, files both ways, member-scoped comments, admin auto-member. | tables `workrooms`, `workroom_members`, `workroom_posts`, `workroom_files`, `notification_prefs`; bucket `workroom-files` (private, allowlist png/jpg/webp/zip/txt/md/pdf, 25 MB/file, 200 MB/room, magic-byte check, never executables); `/workrooms/[id]` (§12.3 layout + 5 states), `PrivateBadge`, milestone pills, participants row, client `UploadWell` variant; comments `target_type='workroom'`; admin Orders & Workrooms (create room, add participant, close); `workroom.post/file/comment` events to opted-in clients (first user-facing email; privacy page line Q43); generic download route scope (owner + bucket). | S2.2 | `docs/spec.md` §4 5c, `docs/data-model.md` §2.7b, `DESIGN.md` §12.1 (PRIVATE, pills, participants), §12.3, Q43, Q45 |
| **S2.4** | Suggested mentions | Assisted discovery: daily YouTube search per project title (+ "OddSense") → Suggested queue; never auto-publish. | cron `sync-mentions` (name TBD in registry), inserts `status='suggested'`, `source='auto'`; `mention.suggested` event + matrix row live (email OFF / discord ON default); Suggested tab Approve → preview → PUBLISH / Dismiss. | S1.8, S1.5 | `docs/spec.md` §5 Seen on v1.5, `docs/data-model.md` §2.3b, `docs/notifications.md`, `DESIGN.md` §12.2 |
| **S2.5** | In-app notifications | Bell + inbox for users reading `notification_recipients` channel `inapp` (needed for workroom clients). | `channel='inapp'` deliverer, bell with `--alert` count badge, inbox page, `notification_prefs` UI, `comment.reply/approved` delivered. | S2.3 | `docs/notifications.md` (In-app row), `DESIGN.md` §5 (bell cut note), Q29 |

Rules for Phase 2: each stub becomes a full slice section in this doc (same fields as §2) via a `docs/` PR before its branch opens; Phase 2 IDs/names already in `_registry.md` are used verbatim; nav "Commissions" appears only in S2.2.

---

## 4. Cross-slice checklists (used by gates)

### 4.1 Cron routes by slice (must match `vercel.json` at each tag)

| Route | Added in | Schedule (04 §6 strings are the contract) |
|---|---|---|
| `/api/cron/sync-modrinth` | S1.2 | `7 * * * *` (hourly) |
| `/api/cron/sync-curseforge` | S1.2 | `17 * * * *` (hourly, offset) |
| `/api/cron/sync-youtube` | S1.6 | `27 * * * *` (hourly, offset) |
| `/api/cron/refresh-mentions` | S1.8 | `37 * * * *` (hourly, offset) |
| `/api/cron/stats-snapshot` | S1.9 | `0 3 * * *` (daily 03:00 UTC) |
| `/api/cron/notify` | S1.5 | `*/5 * * * *` (every 5 min) |

Rule: a cron route ships in the same slice as its job; `vercel.json` never lists a route that does not exist (`deploy-checker` checks 200/401 behaviour).

### 4.2 Tables by slice (must match `supabase/migrations/` at each tag)

| Slice | Tables / views / buckets created |
|---|---|
| S0 | helpers `is_admin()`, `is_moderator()`, `updated_at` trigger fn |
| S1.1 | `profiles` (incl. `handle_changed_at`), view `public_profiles`, `site_settings` (all data-model §2.4 columns), RPC `check_handle`; bucket `avatars` |
| S1.2 | `projects`, view `projects_public`, `project_versions`, `project_files`, `project_links`, `project_overrides`, `sync_runs` (no buckets) |
| S1.3 | `project_downloads`, RPC `record_download`; buckets `project-files` (private), `project-media` (public-read); `config.toml` `file_size_limit = "100MiB"` |
| S1.4 | `comments` (+ view `comments_public`, trigger `comments_set_status()`), `comment_likes`, `comment_reports`, `notification_events` |
| S1.5 | `notification_recipients` (+ unique index), `notification_matrix` (seeded) |
| S1.6 | `videos` |
| S1.7 | `skins`, `art`; buckets `skins`, `art` |
| S1.8 | `mentions` |
| S1.9 | `stats_daily` |
| S1.10 | none |

Rule: every table gets RLS + policies in the migration that creates it (`supabase-reviewer`); `lib/supabase/types.ts` regenerated in the same PR.

### 4.3 Nav / footer state by slice

| Slice | Nav links live | Footer "Site" links live |
|---|---|---|
| S0 | all five present (`/projects`, `/videos`, `/skins`, `/art`, `/seen-on`) + gold Support button (`/support`); each resolves to the root 404 page until its slice ships (00-O-8 DECIDED; 02 §8 S0 lists no placeholder pages) | Privacy, How comments work (404 until S1.1) |
| S1.2 | Projects | Projects |
| S1.6 | Videos | — |
| S1.7 | Skins, Art | — |
| S1.8 | Seen on | Seen on |
| S1.9 | Support (gold button live) | Support |
| S2.2 | Commissions | Custom orders |

---

## 5. Open (proposed defaults; use unless an ADR says otherwise)

IDs are `00-O-n` (cite as "00 §5 00-O-n"). Rows marked DECIDED were settled by the named sibling section after v0.1 and are kept only so cross-references resolve.

| # | Item | Proposed default / decision | Owner doc | Status |
|---|---|---|---|---|
| 00-O-1 | Comment / report / like / download rate limits. | `postComment` 5 / min + 50 / day per user; `reportComment` 10 / h; `toggleLike` 60 / min; `/api/download/[fileId]` 30 / min per `ip_hash`. | 04 §5.5 | DECIDED |
| 00-O-2 | Where `sync.stale` is detected. | `notifyFanOut` step F0 (04 J-S): per source with no `ok=true` run in 6 h, once per 6 h. | 04 §3 J-S, §3.6 | DECIDED |
| 00-O-3 | Home hero when no project is featured. | Highest `downloads_total` published project; Featured 4-up not rendered when empty. | 02 §2.1 | DECIDED |
| 00-O-4 | Comment threads on `/skins`, `/art`, `/videos` in v1 (schema is polymorphic; registry S1.4 lists only project UI). | Not in v1; project-only UI. Schema keeps `target_type`. | 00/02 | OPEN |
| 00-O-5 | Admin UI for hiding a video (no `/admin/videos` route in the registry). | Videos list on the `/admin` dashboard calling `updateVideo` (04 OPEN-7 / §11; registry addition §6); no new route. | 04 / 02 | OPEN (default in use) |
| 00-O-6 | Link-out chip wording for `article` mentions ("WATCH ON" doesn't fit). | "READ ON <SITE>" for `article`, "WATCH ON <PLATFORM>" for video platforms, "SEE ON REDDIT" for reddit. | 03 / DESIGN.md changelog | OPEN |
| 00-O-7 | `/api/og` (registry says optional). | Not in v1; static OG image asset instead (02 RP-06). Revisit post-launch. | 02 | OPEN |
| 00-O-8 | Nav links for not-yet-built sections during S0–S1.8. | Render all five nav items (+ Support button) from S0; each resolves to the root 404 page until its slice ships (matches 02 §8 S0 row; no placeholder pages). | 00 | DECIDED (this doc) |
| 00-O-9 | Uploads through Vercel serverless (4.5 MB body cap) for 100 MB project files. | Two-phase signed-upload pattern (04 §1.4.5, C-18): `begin` mints a signed URL server-side, browser PUTs, `commit` re-validates and writes the row. 01 INV-51 ("browsers NEVER receive a signed upload URL") is amended by ADR in the S1.3 PR. | 04 §1.4.5 | DECIDED |
| 00-O-10 | First admin bootstrap. | `supabase/seed.sql` for local; production: one documented SQL statement setting `profiles.role='admin'` for David's and Oliver's `auth.users.id` after their first sign-in (stop-and-ask logged in PR). | 04 / S1.1 PR | OPEN |
| 00-O-11 | Q36 under-13 privacy line. | Build the DESIGN.md §11.3 #12 wording; David confirms before S1.10.AC12. | docs/questions.md | OPEN |
| 00-O-12 | Q44 assets (allay render, platform marks). | Ship neutral placeholder slabs; swap in assets when Oliver supplies them (no ADR needed, asset-only PR). | — | OPEN |
| 00-O-13 | `comment_count` semantics for the first-timer rule. | Counts the author's comments that have ever reached `status='published'`. | 04 §1.2 | DECIDED |
| 00-O-14 | Skin bust render location (serverless WebGL vs. client fallback). | Try `renderSkinBust` in a Node canvas path (04 §3.8); if not viable in the S1.7 PR, ADR switching to client-render + cache. | 04 | OPEN |
| 00-O-15 | Handle change after onboarding: `docs/data-model.md` §4 allows `handle` only null→value (or admin), but DESIGN §11.3 #11 (own rename) and spec §9 ("moderators can rename/ban") require changes. | Own rename via `updateProfile` with the service-role client, 1 / 7 days on `profiles.handle_changed_at` (04 §1.1, OPEN-2; 05 OPEN-2 agrees); moderator rename via new action `renameHandle` (moderator; S1.4; registry addition §6; contract to be added to 04 §1.2). `keep-docs` amends data-model §4 in the S1.1 PR (ADR, `Kind: security` — R7 "what is stored about people" unchanged, RLS shape unchanged, action-level rule). | 04 / data-model | OPEN (default in use) |
| 00-O-16 | Self-serve account deletion + cascade (`deleteAccount`; data-model §4 profiles delete = admin only). | Per 04 OPEN-9 / 02 O-6: `deleteAccount` (onboarded user, 1 / day) deletes the `auth.users` row via the admin client (cascades `profiles`), sets own comments `status='deleted'` (slots stay), removes own `comment_likes`/`comment_reports`, deletes the avatar object; revalidates content tags. Data-model §4 delete row amended by ADR in the S1.1 PR (stop-and-ask: changes what is stored about people). | 04 §11 / 02 O-6 | OPEN (default in use) |
| 00-O-17 | Skin download counter (`skins.downloads` column exists; no route/action in registry, 02, or 04 increments it; `skins` bucket is public-read). | v1: DOWNLOAD PNG is a direct link to the public texture object with a `download` attribute; `skins.downloads` stays 0. If a counter is wanted, generalise `/api/download/[fileId]` via `lib/files.ts resolveDownloadable` (04 D2/D8) to `{project_files, skins}` — ADR-R7 (download route behaviour). | 04 | OPEN |
| 00-O-18 | `/admin/stats` tiles before the first `stats_daily` deltas exist. | Show `0` with context text "no data yet"; never "—". `write-copy` may reword before S1.10. | 03 / 02 | OPEN |
| 00-O-19 | Ko-fi page name source: env `KOFI_PAGE` (01 §7 env table, `.env.example`) vs `site_settings.kofi_page` (02 §2.7, 04 `updateSettings`). | DB wins: `/support` and the Home compact `TipPanel` read `site_settings.kofi_page`; env `KOFI_PAGE` seeds the S1.1 row only (mirrors `DISCORD_WEBHOOK_URL`). 01 §7 env row for `KOFI_PAGE` to read "seed only" (`keep-docs`). | 01 / 02 | OPEN (default in use) |
| 00-O-20 | About page: `docs/spec.md` §5 lists "About — who OddSense is", but neither the registry route list nor DESIGN.md §6 has one. | Not a v1 route: the Home hero intro strip ("OddSense makes things for Minecraft", 02 §2.1) + footer dry line cover it; `keep-docs` strikes About from spec §5 or moves it to Phase 2 (product call — CC-4, ask David). | docs/spec.md | OPEN |
| 00-O-21 | Env-required sets differ: 04 C-16 (`RESEND_API_KEY`, `KOFI_*`, `SUPABASE_URL` optional) vs 01 §7 (`SUPABASE_URL`/`SUPABASE_ANON_KEY`, `CURSEFORGE_MEMBER` R; `RESEND_API_KEY` R from S1.5; `KOFI_PAGE` R from S1.9). | This plan uses 04 C-16 as the boot-required set (S0.AC5) and 01 §7 for "required from slice"; `keep-docs` aligns 01 §7 to C-16 at S0 (drop the `SUPABASE_URL` pair or make it optional; `CURSEFORGE_MEMBER` optional). | 01 / 04 | OPEN |
| 00-O-22 | Analytics event set: 01 INV-59 lists four names; 03 `TrackedLink` also types `external_out`. | Four names only in v1 (`download`, `tip_click`, `video_play`, `sign_in`); `external_out` removed from `TrackedLink`'s union or added to 01/04 by ADR-R5-free registry edit before S1.9. | 01 / 03 / 04 | OPEN |
| 00-O-23 | `project-files` cap: 05 OPEN-6 proposes 50 MB; data-model §3 / 04 OPEN-10 / this doc say 100 MB. | 100 MB; `config.toml` `file_size_limit = "100MiB"` and the `UploadWell` copy change in the S1.3 PR; 05 OPEN-6 is closed as superseded (`test-engineer` updates 05 §8 S1.3 note). | 05 | OPEN (default in use) |

---

## 6. Registry additions (proposed for `_registry.md`; not edited here)

| Kind | Name | Used by | Note |
|---|---|---|---|
| Action | `deleteAccount` (`lib/actions/accounts.ts`) | S1.1 (cascade tested S1.4) | Per 04 §1.0 / §11 and 02 O-6 (02 proposes `lib/actions/profile.ts`; 04 owns the file name → `accounts.ts`). Semantics 00-O-16. |
| Action | `setUserRole` (`lib/actions/settings.ts`; admin; input `{handle, role}`) | S1.1 | Moderators table on `/admin/settings` (04 §1.3, 02 §10). |
| Action | `renameHandle` (`lib/actions/comments.ts` or `accounts.ts` — 04 decides; moderator; input `{profile_id, handle}`) | S1.4 | spec §9 "moderators can rename"; contract to be added to 04 §1.2 mirroring `banUser` (target role `user`, H-rules, sets `handle` + `handle_changed_at`). 00-O-15. |
| Action | `updateVideo` (`lib/actions/videos.ts`; admin; input `{youtube_id, hidden?, is_short?}`) | S1.6 | 04 OPEN-7 / §11; behind the `/admin` dashboard videos list (00-O-5). |
| Route | `/robots.txt` (`app/robots.ts`), `/sitemap.xml` (`app/sitemap.ts`) | S0, S1.2 | 02 RP-07 / §10. |
| RPC | `check_handle(text)`, `record_download(uuid, text, text)` | S1.1, S1.3 | 04 §1.1, §2.3 D4 (already in 04 §11). |
| Column | `profiles.handle_changed_at timestamptz null` | S1.1 | 04 §11 (rename rate limit). |
| View / trigger | `comments_public`, `comments_set_status()` | S1.4 | 05 RA-1, RA-6. |
| Env var | `HASH_SALT` (server-only, ≥32 random bytes) | S1.3, S1.9 | 04 C-17 / §11 owns the name; 01 O-3 `HASH_SECRET` and v0.1's `IP_HASH_SALT` are renamed to `HASH_SALT`. |
| Env var | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | S1.10 | Sentry per `docs/framework-decision.md` "Errors: Sentry (post-launch)". |
| Analytics events | `download {project: slug, source: 'modrinth'|'curseforge'|'direct'}` · `tip_click {amount: 1|3|5|'other'}` · `video_play {id: youtube_id}` · `sign_in {}` | S1.9 (names from 01 INV-59; 03 `TrackedLink`) | Payload table to be added to 04 as §5.6 in the S1.9 PR; no PII keys allowed. |
| Storage config | `supabase/config.toml` `[storage] file_size_limit = "100MiB"`; per-bucket caps `project-files` 100 MB · `project-media` 5 MB · `art` 10 MB · `avatars` 1 MB · `skins` 512 KB | S1.3 (files/media), S1.7 (art/skins), S1.1 (avatars) | 04 §11 / OPEN-10; 00-O-23. |
| Component | `TipPanel` placeholder behaviour | S1.2 | Already in registry; renders a link-to-`/support` slab before S1.9. Home compact instance built in S1.9. |
| Job/route | `sync-mentions` (S2.4) | S2.4 | Cron for suggested mentions; name from `docs/data-model.md` §2.3b — needs a registry row when S2.4 is detailed. |
| Test area labels | `T-E2E prod-smoke`, `T-UNIT env-parity`, `T-UNIT tokens-parity`, T-ACT auth matrices for `deleteAccount`, `setUserRole` (04 T-ACT-34), `renameHandle`, `updateVideo`, T-UNIT analytics payload schema | S0, S1.1, S1.4, S1.6, S1.9, S1.10 | Areas to be numbered in 05. |
| ADR slugs | `ADR-000n-branching-preview-env.md` (S0, only if the fallback is used) · `ADR-000n-shorts-detection.md` (S1.6, if the heuristic changes) · `ADR-000n-signed-upload-inv-51.md` (S1.3, amends 01 INV-51 — required) · `ADR-000n-handle-rename-rls.md` (S1.1, amends data-model §4 — required) · `ADR-000n-account-deletion.md` (S1.1, amends data-model §4 delete row — required) | S0, S1.1, S1.3, S1.6 | Numbers assigned at PR open per 06 ADR-N3; `ADR-0001` is the engineering-spec baseline. |

---

## 7. Changelog

| Date | Version | ADR | Change |
|---|---|---|---|
| 2026-08-17 | v0.1 | — | Initial draft. |
| 2026-08-17 | v0.2 | — | Review pass 1: deterministic `sync.*` emission (S1.2/S1.5/S1.6/S1.8/S1.9); `/admin/settings` stub, `deleteAccount`, `setUserRole`, `site_settings` full columns moved to S1.1; middleware never reads role, role-user → 404; content actions admin-only; `project-media` + `uploadProjectMedia` to S1.3 with `/admin/projects/[id]` curate in S1.2; two-phase uploads (04 §1.4.5) adopted; 100 MB cap + `config.toml`; matrix seeding per notifications.md; skin download counter → open; nav 404-until-built; Ko-fi page from DB; FSB per RP-15; analytics events registry row; `HASH_SALT`; PR template `ADRs:` heading; five CI checks; robots/sitemap; changelog section; Open IDs prefixed `00-O-`; cross-references to real section numbers. |

---

## 8. Review notes (findings not applied as proposed, with reasons)

| Finding | Resolution |
|---|---|
| Footer second dry line assigned twice (S0 vs S1.8) — proposed fix: keep it in S0. | Kept in **S1.8** instead: `_registry.md` S1.8 one-line scope says "footer line", 02 RP-13 says "second line only once S1.8 ships", 02 §8 S1.8 lists "footer line 2". S0 `Footer` ships the first dry line only. |
| Nav for unbuilt sections — proposed fix offered placeholder pages (00-O-8 default) or 404. | Chose **404 until the slice ships**: 02 §8 S0 lists no placeholder routes and rule 0.2 makes Scope IN exhaustive; adding six placeholder pages would need a 02 edit. |
| S1.5.AC1 "gate/404" — proposed "AdminGate state (INV-31), never a 404 body". | Used **404** (`notFound()`): 02 RP-04/§4 and 05 T-E2E-33/OPEN-11 say signed-in insufficient role → 404; 01 INV-31's "AdminGate" wording applies to the signed-out case. Same ruling for S1.1.AC8. |
| Handle change: proposed a `renameHandle`/`moderateProfile` action for mods and an Open item. | Applied as `renameHandle` in S1.4 (moderation slice) with an Open row (00-O-15) because 04 has no contract yet; own rename follows 04 §1.1 / OPEN-2 (1 / 7 days). |
| Skin download counter: proposed either a new route or downgrade. | Downgraded AC4 (no counter in v1) + Open 00-O-17; no new route invented (04 owns the download route; a generic scope resolver already exists in 04 D8). |
| S1.6 Depends on: registry says S0. | Added S1.5 as a **plan-order** dependency (S1.6 is tagged v0.7 after S1.5 v0.6) so `sync.failed` emission is unconditional; registry row unchanged. |
| Env required set: proposed listing five S0 vars. | Used 04 C-16's eight-variable boot set (04 owns C-16; 05 T-UNIT-16 already tests it) and logged the 01 §7 vs 04 C-16 discrepancy as 00-O-21. |
