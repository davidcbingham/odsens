# Build Plan
Slice-by-slice contract for building odsens.com v1 (S0–S1.10) with Phase 2 stubs: scope, acceptance criteria, tests, gates, demo, and the global rules every PR follows.
Status: DRAFT v0.3 (2026-08-17) — becomes v1.0 at freeze
Binding decisions: `06-decisions/ADR-0001-engineering-spec-baseline.md` (baseline) · `06-decisions/ADR-0002-spec-reconciliation.md` (contradictions C1–C22 + OPEN defaults 13–80 — every slice below is aligned to it).

Sources this doc is derived from (it re-decides nothing): `docs/build/_registry.md` (IDs — used verbatim), `docs/spec.md`, `docs/questions.md`, `docs/data-model.md`, `docs/notifications.md`, `docs/framework-decision.md`, `docs/analytics-options.md`, `DESIGN.md` v1.3, `docs/skill-handoffs.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `docs/dev-tooling.md`, `.env.example`, `supabase/config.toml`.
Sibling docs referenced: `01-architecture.md` (invariants INV-nn), `02-routes-and-pages.md` (RP-nn, M-n), `03-components.md`, `04-server-contracts.md` (SC-nn, J-x, F/N/D/U steps), `05-test-plan.md` (T-<layer>-n, CI-n), `06-decisions/` (ADRs). Open items in this doc are cited as `00 §5 00-O-n` to avoid collision with the `O-n` lists in 01–03. Test IDs cited below are 05's real IDs (05 owns numbering); where a slice's list here and 05 §8 differ, 05 §8 wins.

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
| 0.7 | Registry names (routes, components, actions, tables, event kinds) are used verbatim from `_registry.md`. Anything new goes into `_registry.md` first (CC-5), never invented inline; this doc keeps no separate additions list (folded in by ADR-0002). |
| 0.8 | Where a source is silent, the item is listed in §5 "Open" with a proposed default marked OPEN; builders use the proposed default and write an ADR if they diverge. Open IDs in this doc are `00-O-n` (other docs have their own `O-n`/`OPEN-n` lists). |
| 0.9 | Where 01–05 or an ADR already decide something this doc previously listed as open, that source wins and the row in §5 is marked DECIDED with the owning section / ADR reference. |

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
## ADRs in this PR
none   (the literal word `none` when the PR carries no ADR — 06 ADR-R11; otherwise one line per ADR:)
ADR-<nnnn>-<slug>.md (amends: <doc §>)
## Gate verdicts (pasted verbatim)
GATE: spec-drift … Verdict: PASS
GATE: … (each required gate)
GATE: deploy … Verdict: PASS
## Screenshots
1280 + 390 for each touched page
## Bundle
none   (required when any route's first-load JS grows >20 KB gz vs `main` — one line naming the route, the delta and why; enforced by `frontend-reviewer`, ADR-0002 "Also")
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
| CC-2 | ADR numbering is sequential across the repo (06 ADR-N1..N3; `ADR-0001` (baseline) and `ADR-0002` (reconciliation) are already on `main`; pre-assigned numbers are slugs only — ADR-0002 C11); the ADR names the doc + section it amends and the slice ID. Every amendment of this doc records the `ADR-<nnnn>` string in §6 Changelog (06 ADR-R2). |
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
- Route groups (ADR-0002 C5): root `app/layout.tsx` = html/body/fonts/tokens only; `app/(public)/layout.tsx` carries `Nav`, `Footer`, `FloatingSupportButton` (mounted from S1.9), `ViewerProvider` (client seam for session-aware UI on ISR pages — ADR-0002 C1; no PPR, no `experimental.*`) and the `ToastProvider` live region; `app/(onboarding)/layout.tsx` (+ `welcome/` in S1.1); `app/admin/layout.tsx` (`AdminShell`, S1.1); `app/api/*`.
- Layout: `Nav` (§5 + §12.2 order Projects · Videos · Skins · Art · Seen on; **Commissions item hidden**; Support gold button; burger < 900px; phone Support in the menu ≤599 px, in the bar 600–899 (ADR-0002 #51); nav metrics per pass-3 (ADR-0002 #52); 03 §4 N-01..N-08), `Footer` (§5 + §11.6 links + first dry line; the second dry line "Creators featuring the mods aren't affiliated with odsens." arrives in S1.8 per registry / 02 RP-13), `SkipLink`, `PixelLabel`, `Button` (primary|secondary|ghost|gold|gold-ink; pending = disabled look + `aria-busy`, ADR-0002 #46), `Icon`, `Avatar` (default = `--slab-sunk` square + first char, ADR-0002 #48), `Toast` (+ `ToastProvider`, `useToast`; one at a time, hover pauses — ADR-0002 #53), `Skeleton` (base) + `Skeleton*` shells; `app/not-found.tsx` (§11.3 #13), `app/error.tsx` (§11.3 #14), `app/global-error.tsx` (the only `'use client'` route files), `app/(public)/loading.tsx` (Home skeleton, 03 G-01 / 02 RP-09); derived token `--ink-deep #0A0F16` (ADR-0002 #45). Other 03 §2.2 primitives arrive in the slice that first uses them.
- Routes: `/` (placeholder page using the layout; hero content arrives in S1.2), `/auth/callback` (Supabase OAuth code exchange per ADR-0002 C18: on error 307 `/` with no query param; then reads `profiles.handle` — null → 307 `/welcome?next=`, else 307 `next` via `safeNext`, same-origin only), `/auth/sign-out` (POST form; GET → 405) wired to Supabase SSR — **no `/auth/sign-in` route** (sign-in is the client `GoogleSignInButton`, ADR-0002 C3), `app/robots.ts` (`/robots.txt`, 02 RP-07). **Placeholder pages** for `/projects`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support` (title + the one voice line "Not yet. Soon." per DESIGN.md §12.7 — ADR-0002 C20; each replaced by the real page in its slice; §4.3). Non-production: `/dev/components` (dev-only component preview from `tests/fixtures/ui/*`, `notFound()` on Vercel — ADR-0002 #44) and `/__test/throw` (only when `E2E=1`, reaches `error.tsx` — ADR-0002 #74).
- `lib/env.ts` (zod-validated env, fail-fast at boot; names = `.env.example`; required-at-boot set = the 8 names (ADR-0002 #18): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `MODRINTH_USER`, `MODRINTH_USER_AGENT`, `YOUTUBE_CHANNEL_ID`; the `SUPABASE_URL`/`SUPABASE_ANON_KEY` pair is CLI-only; every other variable is optional and becomes required in the slice that first reads it per 01 §7 env matrix "R from S1.x" — `CURSEFORGE_API_KEY` stays optional forever (04 §3.2 no-key path)) + `lib/env/public.ts` (browser-safe names), `lib/log.ts` (`log.info/warn/error({job?|action?, id, msg, meta?})` with redaction — ADR-0002 C16), `lib/flags.ts` (`FLAGS`), `lib/supabase/{server,client,admin,anon}.ts` (four-client model, 01 INV-13), `lib/auth.ts` (export set per 04 SC-04, which owns the names — `getUser`, `getProfile`, `requireUser`, `requireOnboarded`, `requireRole`, `safeNext`, plus 04's `getSession` for the SSR client; a **real** `safeNext` — T-UNIT-44; 01 INV-32 must match 04 — see §7).
- Local Supabase (`supabase start`, `config.toml` already present) + first migration: helpers `public.is_admin()`, `public.is_moderator()`, `updated_at` trigger function only. `supabase/seed.sql` skeleton. `lib/supabase/types.ts` generated + committed.
- CI (GitHub Actions): lint, typecheck, `test:unit`, `test:db` (Supabase CLI service), `build`, `test:e2e`; client-bundle grep for the CI-4 list (05 §4): `SERVICE_ROLE`, `sb_secret`, `CURSEFORGE_API_KEY`, `YOUTUBE_API_KEY`, `RESEND_API_KEY`, `DISCORD_WEBHOOK`, `KOFI_`, `CRON_SECRET`, `GOOGLE_OAUTH`, `HASH_SECRET` → must be absent (`scripts/check-bundle-secrets.mjs`); `scripts/check-client-islands.mjs`, `check-fixtures.mjs`, `check-test-ids.mjs` wired.
- Test harness (`test-engineer`): Vitest projects `unit` + `db`; `tests/helpers/asRole.ts` + `expectPolicy` runner; Playwright projects `smoke-desktop`/`smoke-phone`/`e2e`/`admin` at 1280 + 390 with axe; `scripts/contrast.mjs`; `tests/fixtures/ui/*` for `/dev/components`; e2e fixture server on :4010 + test-only `*_API_BASE` env (ADR-0002 #73) scaffolded (first used in S1.2).
- `vercel.json` with an empty `crons` list; `next.config.ts` `headers()` per 01 INV-76/INV-77 on every route (CSP with `frame-ancestors 'none'` globally and `form-action 'self'` (ADR-0002 C3); `script-src 'unsafe-inline'` accepted for v1 with a `Kind: security` ADR (`csp-unsafe-inline`) landing in this PR — ADR-0002 #32; `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security`) plus `X-Robots-Tag: noindex, nofollow` on `/admin/:path*`, `/welcome`, `/profile` and `/api/:path*` (01 INV-76, 02 RP-07; the `/admin`, `/welcome`, `/profile` routes themselves are built in S1.1 — the header rule ships now).
- Supabase Branching enabled + Supabase GitHub/Vercel integrations installed so the preview gets branch env vars (`docs/dev-tooling.md` "set up at first preview deploy").
- Skills written: `.claude/skills/ship/SKILL.md`, `.claude/skills/keep-docs/SKILL.md` (specs: `docs/site-management-skills.md` §3). ADRs in this PR: `csp-unsafe-inline` (security), `component-preview` (addition, `/dev/components` — ADR-0002 #44); the seven gate agents read ADRs (ADR-0002 #78, done in the ADR-0002 PR).
- Preview deploy green (Deployment Protection Standard stays on).

**Scope OUT**
- No tables beyond helpers (S1.1+). No sign-in UI (S1.1). No `/auth/sign-in` route ever (ADR-0002 C3). No project data or hero content (S1.2); placeholder pages carry no data reads. No cron entries (S1.2+). No DNS/domain (S1.10). No Sentry/Web Analytics (S1.10). No Oliver skills beyond `ship` + `keep-docs` (S1.10).

**Spec traceability:** `docs/spec.md` §7 (infrastructure), §8 (aesthetic); `docs/framework-decision.md` (stack, layout, guardrails); `DESIGN.md` §1–§5, §11.1 (Toast, Skeleton), §11.3 (#13 404, #14 error), §11.6, §12.2 (nav); `docs/dev-tooling.md`.

**Engineering docs implemented:** 01 §1, §2, §7 (INV-35..37), §14, §20 (INV-76/77), §21–§24 (all invariants become enforceable here); 02 §0.4 RP-05..RP-07, §0.5 RP-09/RP-11 (route groups), §0.6 RP-12/RP-13, RP-16 (placeholders), §4 (`/auth/callback`), §8 row S0; 03 §2.1 (`Nav`, `Footer`, `Toast`, `Skeleton`, `SkipLink`), §2.2 (`Button`, `PixelLabel`, `Icon`, `Avatar`), §4, §5; 04 §0 SC-04 (helper names), SC-16 (env); 05 §1 harness, §4 CI-1..CI-5, §8 row S0.

**Acceptance criteria**
1. S0.AC1 — Preview URL renders `/` with `Nav` + `Footer`; nav items in order Projects · Videos · Skins · Art · Seen on; no "Commissions" item; Support is a gold button; under 900px a 44px burger appears (screenshots 1280 + 390); every nav target (`/projects`, `/videos`, `/skins`, `/art`, `/seen-on`, `/support`) returns 200 with its title + "Not yet. Soon." (ADR-0002 C20).
2. S0.AC2 — `styles/tokens.css` contains every token name + hex from DESIGN.md §1 "Dark"; `grep` for raw hex outside `tokens.css` returns nothing (allowed exceptions listed in 01).
3. S0.AC3 — Fonts served from `/fonts/*.woff2` (no request to a Google/CDN host in the network log).
4. S0.AC4 — `/does-not-exist` renders the 404 page (`404` in `--indigo`, "THAT PAGE DOESN'T EXIST", GO HOME + "See the projects"); a forced error renders "SOMETHING BROKE" with RELOAD + Go home; no error codes shown.
5. S0.AC5 — `pnpm build` fails when any of the eight required-at-boot variables (ADR-0002 #18) (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `MODRINTH_USER`, `MODRINTH_USER_AGENT`, `YOUTUBE_CHANNEL_ID`) is missing (zod in `lib/env.ts`, T-UNIT-16); build passes with only those set and every other `.env.example` name blank.
6. S0.AC6 — CI workflow runs the five required checks in DoD-2 (`lint`, `unit`, `db`, `build`, `e2e`) and blocks merge on failure; `scripts/check-bundle-secrets.mjs` inside `build` passes.
7. S0.AC7 — `supabase db reset` applies the first migration; `is_admin()`/`is_moderator()` exist; `lib/supabase/types.ts` committed and matches.
8. S0.AC8 — Playwright smoke: `/` and 404 at 1280 + 390 pass axe with zero serious/critical.
9. S0.AC9 — Response headers per 01 INV-76 are present on `/` and on `/admin` (a 404 in S0): CSP per INV-77 including `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Strict-Transport-Security`; `/admin/**`, `/welcome`, `/profile` and `/api/**` additionally `X-Robots-Tag: noindex, nofollow` (01 INV-76; T-E2E-20 — the `/welcome`/`/profile` paths are asserted from S1.1 when the routes exist).
10. S0.AC10 — `vercel.json` exists with `"crons": []`; `deploy-checker` PASS on the preview.
11. S0.AC11 — `.claude/skills/ship/SKILL.md` and `.claude/skills/keep-docs/SKILL.md` exist with the sections required by `docs/site-management-skills.md` §3 and the boundaries block from `docs/skill-handoffs.md`.
12. S0.AC12 — Preview deploy shows Supabase preview-branch env vars present (names only) per `deploy-checker`.
13. S0.AC13 — `/dev/components` renders every 03 §2 component present so far in every state from `tests/fixtures/ui/*` locally and returns 404 on Vercel (T-E2E-48); `GET /__test/throw` renders the error shell only when `E2E=1`; `GET /auth/sign-out` → 405; `GET /auth/callback` without a code → 307 `/` (T-E2E-46 subset).

**Tests required:** 05 §8 row S0 — harness + CI-1..CI-5 green; T-UNIT-15 (contrast), T-UNIT-16 (env schema), T-UNIT-33 (`lib/log.ts` redaction), T-UNIT-34 (tokens parity), T-UNIT-44 (`safeNext`); T-E2E-14, T-E2E-15 (shells), T-E2E-17 (landmarks/skip link), T-E2E-19, T-E2E-20 (headers on `/`), T-E2E-45 (robots/sitemap), T-E2E-46 (placeholder pages 200 + non-page HTTP part available at S0), T-E2E-48 (`/dev/components`); T-RLS-123, T-RLS-124 (helpers migration).

**Gates required:** all seven (see §1.7).

**Demo script**
1. Open preview `/` — see nav/footer, correct fonts, no Commissions.
2. Resize to 390 — burger + Support last in the menu.
3. Visit `/nope` — 404 page; visit `/projects` — "Not yet. Soon." placeholder.
4. Open PR checks — the five required checks green; bundle secret grep green.
5. `deploy-checker` verdict PASS in PR body.

**Risks / unknowns:** Supabase Branching + Vercel integration first-time setup (env injection may lag — fallback: production Supabase vars in preview for S0 only, recorded as an ADR with slug `branching-preview-env`, number per 06 ADR-N3 — ADR-0002 C11); Node 24 vs vercel-ops note "Node 22" (registry/dev-tooling/01 O-1 say 24 — follow 24, ADR if Vercel forces otherwise); Silkscreen/Bungee WOFF2 licensing files must ship alongside fonts.

---

### S1.1 — Accounts

**Goal:** Google sign-in via Supabase Auth with mandatory handle onboarding, profile page, role model, and the admin gate — no PII ever displayed.

**Depends on:** S0.

**Scope IN**
- Tables: `profiles` (+ view `public_profiles`; column `handle_changed_at timestamptz null` — ADR-0002 #27), `site_settings` (single row `id = 1`, **all** columns per `docs/data-model.md` §2.4: `moderation_mode`, `admin_notify_emails`, `discord_webhook_url`, `kofi_page`, `comments_closed_default`, `announcement_md`, plus `owner_profile_id uuid null` for the CREATOR tag — ADR-0002 #55; seeded `moderation_mode='auto'`, `comments_closed_default=false`, `kofi_page` = env `KOFI_PAGE` seed value) + view **`site_settings_public`** (`comments_closed_default`, `kofi_page`, `owner_profile_id`; readable by all — ADR-0002 C6; no admin-client carve-out on public pages); `rate_limit_hits` (service-role only) + RPCs `rate_limit_ok(scope,key,max,window)` and `purge_rate_limit_hits(int)` behind `lib/rate-limit.ts` `assertRateLimit` — ADR-0002 #14; trigger on `auth.users` insert creating `profiles` (handle null, `email_hash = HMAC-SHA256(HASH_SECRET, lower(email))` — ADR-0002 C13; `HASH_SECRET` itself is added at **S1.3** per ADR-0002 C13 / registry Env — how the S1.1 trigger obtains the key is an unresolved gap flagged in §7 Review notes, not settled here); `updated_at` triggers; RLS per `docs/data-model.md` §4 (admin select on other `profiles` rows = deny — ADR-0002 #70); RPC `check_handle`; bucket `avatars` (public-read; upload via server action only, ≤1 MB inline per 04 SC-18; path `avatars/{profile_id}/{hash}.webp` — ADR-0002 C16).
- Auth: Google provider (config already in `supabase/config.toml`); sign-in = client `GoogleSignInButton` → `supabase.auth.signInWithOAuth({provider:'google', options:{redirectTo: NEXT_PUBLIC_SITE_URL + '/auth/callback?next=…'}})` (ADR-0002 C3 — no `/auth/sign-in` route); `/auth/callback` per ADR-0002 C18; `/auth/sign-out` POST; anon on an onboarded-only route → silent 307 `/` (ADR-0002 #37); `middleware.ts` per 02 §3 M1..M8: refreshes the session and redirects any authenticated user with null handle to `/welcome` (except `/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*`, static — 02 M5 / 01 INV-30); **middleware never reads role** (02 RP-19); the `/admin/*` role gate lives in `app/admin/layout.tsx` via `requireRole('moderator')` (01 INV-31, 02 RP-11, §4).
- Routes: `/welcome` (`app/(onboarding)/welcome`; `OnboardingPanel`, `HandleField`, `AvatarUpload` + crop), `/profile` (§11.3 #11 incl. Delete account action → `deleteAccount`), `/privacy` (§11.3 #12 + §12.5 additions; Q36 line "Sign-in needs a Google account; Google's age rules apply." — ADR-0002 #24), `/how-comments-work` (§12.5), `/admin` (`AdminGate` §11.3 #18 "Admins only" + Google button for anon, HTTP 200; signed-in role `user` → `notFound()` → root 404, never a 403 body or a gate variant — ADR-0002 C4; `AdminShell` dashboard placeholder for role ≥ moderator; sidebar order Comments · Projects · Skins · Art · Mentions · Stats · Settings — ADR-0002 #36, items appear as their slices ship). **No `/admin/settings` in this slice** — the whole route ships in S1.5 (ADR-0002 C2); roles are bootstrapped by SQL until then.
- Components: `ViewerProvider` (+ `useViewer()`, `components/accounts/`, client — reads only the viewer's own `profiles` row under RLS via `lib/supabase/client.ts`; ADR-0002 C1), `HandleField` (all §11.1 states), `AvatarUpload` (+ crop, §11.1 "Picture upload"), `ProfileMenu` (§11.1; "Admin" item for role ≥ moderator per 03 N-06), `OnboardingPanel`, `GoogleSignInButton` (client), `AdminGate` (anon only), `AdminShell` (+ `AdminNav`; sidebar per 02 RP-14; Orders item hidden until S2.2; Settings item admin only, live from S1.5), `InlineConfirm` (first use: `/profile` Delete account — S1.1.AC6; reused by S1.4), `NoteCallout` (`/privacy`, 03 §2.2). `Table`, `Field`, `Toggle` (S1.2) arrive with their first use — none is needed here; `SignInPrompt` is an S1.4 component (03 §2.4 — the registry slice wins).
- Actions (`lib/actions/accounts.ts`; input schemas `<actionName>Input`; result `ActionResult<T>` from `lib/actions/result.ts` — ADR-0002 C14/C16): `completeOnboarding`, `updateProfile` (incl. own-handle rename via the service-role client, 1 / 7 days on `profiles.handle_changed_at` — ADR-0002 #27; see 00-O-15), `checkHandle` (RPC; structural validation `^[A-Za-z0-9_]{3,20}$`, citext-unique, reserved handles = the 04 H3 22-entry `RESERVED_HANDLES` list — ADR-0002 #63, no `@`/email-like by construction; rate-limited via `assertRateLimit`), `deleteAccount` (semantics per ADR-0002 #28: comments → `status='deleted'`, likes/reports removed, avatar object removed, `auth.admin.deleteUser` — cascade on comments is exercised in S1.4); avatar re-encode server-side (`lib/files.ts reencodeAvatar`: strip EXIF, 512×512 WebP, ≤1 MB; validation in `lib/validation/{handle,files}.ts`). **No `updateSettings` / `setUserRole` here** (S1.5, ADR-0002 C2).
- Roles: `user|moderator|admin`; first admin bootstrap = `supabase/seed.sql` locally, one documented SQL statement in prod after first sign-in (ADR-0002 #23); `AdminShell` visible to role ≥ moderator; role semantics per ADR-0002 C7 (**admin** for content curation/sync/media/mentions/videos/skins/art/exclusive; **moderator** for comment moderation + reading admin pages).

**Scope OUT**
- No comments (S1.4). No `/admin/settings` at all — moderation radios, `comments_closed_default` toggle, Moderators table, `setUserRole`, matrix, webhook, emails, Ko-fi section all ship whole in S1.5 (ADR-0002 C2). `deleteAccount` ships now; its comments cascade is tested in S1.4 (S1.4.AC16). No moderator handle-rename action (`renameUserHandle`, S1.4). No name/email detection in handles (decided Q34).

**Spec traceability:** `docs/spec.md` §5 Accounts, §9 (PII, handles), Q23, Q34; `docs/data-model.md` §2.1, §3 (`avatars`), §4, §6 "First sign-in"; `DESIGN.md` §5 (Sign-in prompt, Nav signed-in state), §11.1 (Handle field, Square toggle, Picture upload, Profile menu), §11.3 (#10 onboarding, #11 profile, #12 privacy, #18 admin gate), §12.5 (handle guidance, privacy line, How comments work).

**Engineering docs implemented:** 01 §6 (INV-28..34), §10 (no-PII), §11 (INV-51 avatar path); 02 §1.2, §1.3 (`/admin`), §2.4, §2.5, §3 (M1..M8, RP-19..RP-21), §4 (auth flows, admin gate); 03 §2.5 (Accounts incl. `ViewerProvider`), §2.10 (`AdminGate`, `AdminShell`), §2.2 (`GoogleSignInButton`, `InlineConfirm`, `NoteCallout`); 04 §1.1 (`completeOnboarding`, `updateProfile`, `checkHandle`, `deleteAccount`), §2.1, §2.2, §5.5 (`rate_limit_hits`); 05 §8 row S1.1.

**Acceptance criteria**
1. S1.1.AC1 — Clicking "Sign in" starts the Google OAuth flow; after consent the user lands on `/welcome` if `profiles.handle` is null; visiting any page other than `/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*` (and static assets) while handle is null redirects to `/welcome` (02 M5; T-ACT-10, T-E2E-21).
2. S1.1.AC2 — `HandleField` shows: resting rules line; live `n / 20` counter; checking state with pixel pulse; available "That one's free." in `--emerald-soft`; invalid states with plain-words reason for: too short, too long, bad char, taken, reserved, contains `@`.
3. S1.1.AC3 — DONE is disabled until the handle validates; on success the user is redirected to the page they came from (or `/`) and `ProfileMenu` shows the handle + picture.
4. S1.1.AC4 — Avatar upload: >1 MB or non png/jpg/webp shows the §11.1 error copy; accepted image is cropped square, stored in `avatars`, re-encoded (no EXIF), 512×512.
5. S1.1.AC5 — No page, API response, or client bundle contains the Google display name or email: `public_profiles` exposes only `id, handle, avatar_path, role`; a T-RLS test proves a user cannot select another user's `profiles` row.
6. S1.1.AC6 — `/profile` shows picture Change/Remove, handle row with SAVE + consequence line, "what we store" footer strip linking Privacy, Delete account in danger (`deleteAccount`, inline confirm; after it the session is gone and the auth user no longer exists — 00-O-16); changing the handle (`updateProfile`) updates `ProfileMenu` immediately; a second rename within 7 days is refused with the plain reason (04 §1.1, ADR-0002 #27; T-ACT-5).
7. S1.1.AC7 — `/privacy` and `/how-comments-work` render the DESIGN.md §11.3/§12.5 content incl. the handle guidance line and the Google-age-rules line; both linked from `Footer` "Site" column.
8. S1.1.AC8 — `/admin` signed-out → `AdminGate` (ADMINS ONLY + Google button, nothing else, HTTP 200); signed-in role `user` → root 404 page (`notFound()` — ADR-0002 C4; never a 403 body, never a "not-allowed" gate variant); role `moderator|admin` → `AdminShell` with sidebar (T-E2E-33).
9. S1.1.AC9 — Reserved handles rejected server-side (T-ACT), not just in the UI.
10. S1.1.AC10 — Sign-out POST clears the session; `ProfileMenu` reverts to "Sign in".
11. S1.1.AC11 — RLS matrix for `profiles`, `public_profiles`, `site_settings`, `avatars` bucket passes for anon/user/banned/moderator/admin.
12. S1.1.AC12 — axe zero serious/critical on `/welcome`, `/profile`, `/privacy`, `/how-comments-work`, `/admin` gate at 1280 + 390.
13. S1.1.AC13 — View `site_settings_public` is selectable by anon and exposes exactly `comments_closed_default`, `kofi_page`, `owner_profile_id` (ADR-0002 C6; T-RLS-132); `site_settings` itself stays admin-only (T-RLS-12..14); `rate_limit_hits` is service-role only for every role (T-RLS-130) and `rate_limit_ok`/`purge_rate_limit_hits`/`check_handle` grants are per T-RLS-129; a burst of `checkHandle` calls past the 04 §5.5 scope returns `rate_limited`.

**Tests required:** 05 §8 row S1.1 — T-RLS-1..15, 115..116, 125..127, 129 (`check_handle` grant + `rate_limit_ok`), 130 (`rate_limit_hits`), 132 (`site_settings_public`); T-ACT-0..10, 65 (`deleteAccount`), 69 (audit line, for actions present); T-UNIT-1, 2, 17 (png/jpg/webp), 18 (`avatar`), 23 (`emailHash` part), 27 (may land here or S1.5), 37 (scopes present so far); T-E2E-12, 13, 16, 21, 22, 23, 32, 33 (gate + 404 for wrong role; sidebar can be a stub), 46; seed SEED-3.

**Gates required:** all seven; `security-reviewer` focus: PII isolation, avatar re-encode, middleware, RLS on `profiles`.

**Demo script**
1. Preview: click Sign in → Google → land on `/welcome`.
2. Type `ad`, `admin`, `bob@x`, `taken_handle`, then a free one — watch each state and helper line.
3. Upload a 3 MB PNG → error; upload a small PNG → crop → DONE.
4. Open profile menu → Your profile → change handle → SAVE → menu updates.
5. Visit `/admin` as a normal user → root 404; promote via SQL (ADR-0002 #23) → sidebar appears (Settings item absent until S1.5).
6. Sign out.

**Risks / unknowns:** Google OAuth redirect URLs must include the Vercel preview pattern (`https://*.vercel.app/**` is in `config.toml` remote section — verify Supabase branch auth config inherits it); Q36 under-13 line copy needs David's confirmation before S1.10 (build the DESIGN.md wording now); `deleteAccount` uses the admin client (`auth.admin.deleteUser`) — behind an inline confirm, rate 1 / day (04 §1.0); `docs/data-model.md` §4 profiles update/delete rules are already amended by ADR-0002 (#27 handle rename, #28 account deletion) — the slice needs no further ADR unless it deviates.

---

### S1.2 — Projects (synced)

**Goal:** the Modrinth catalogue on the site — hourly sync into Supabase, public grid + detail pages with ISR, Home hero/featured, CurseForge combined counts, and admin curation of synced projects.

**Depends on:** S0.

**Scope IN**
- Tables: `projects` (+ view `projects_public` with `downloads_total`), `project_versions`, `project_files`, `project_links`, `project_overrides`, `sync_runs`; RLS per `docs/data-model.md` §4; indexes on `slug`, `status`, `(source, external_id)`.
- Adapters: `lib/adapters/modrinth.ts` (User-Agent from `MODRINTH_USER_AGENT`, 10 s timeout, retry ≤3 with backoff on 429/5xx, 300 req/min respected), `lib/adapters/curseforge.ts` (`CURSEFORGE_API_KEY`, `GET /v1/mods/{id}`).
- Jobs (`lib/jobs/*.ts`, logging via `lib/log.ts` `log.info({job, id, msg, meta?})` — ADR-0002 C16): `syncModrinth` (upsert by `(source, external_id)`; `project_type` mapping per `docs/data-model.md` §5 / 04 §5.2 (unknown `version_type` → `release` — ADR-0002 #77); upstream-deleted → `status='hidden'`, never delete; upstream-removed versions kept — ADR-0002 #66; writes `sync_runs` (04 SC-11, SC-13 lock); `revalidateTag('projects')` + `project:<slug>`), `syncCurseforge` (per `project_links` row → `downloads_curseforge`, `project_links.downloads`; no key → skipped run per 04 §3.2). In S1.2 the jobs write **no** `notification_events` rows (the table does not exist yet): failures go to structured logs + `sync_runs.error` only. `sync.failed` emission (04 J-F) and `sync.stale` (04 J-S) are added to both jobs in S1.5 via `lib/notify/emit.ts` — deterministic, not conditional.
- Route handlers: `/api/cron/sync-modrinth`, `/api/cron/sync-curseforge` (Bearer `CRON_SECRET`, idempotent, JSON summary; 401 body `{ok:false,error:{code:'unauthorized',message}}` — ADR-0002 C14; `maxDuration` 300 — ADR-0002 C15); `vercel.json` crons: both hourly (offset).
- Actions (all **admin** — ADR-0002 C7; moderators see the admin pages read-only): `triggerSync` (`lib/actions/admin.ts`; runs a job now), `curateProject` (`lib/actions/projects.ts`; upsert `project_overrides`: featured/featured_order/hidden/notes_md/comments_enabled/title_override/description_override; `extra_gallery` paths accepted per 04 §1.4 but the upload UI + `project-media` bucket arrive in S1.3), `setProjectLink` (manual CurseForge id/URL per Q39).
- Public routes: `/projects` (`FilterBar` type counts + version + sort `downloads|updated|newest|title`, count line "<N> things. Some useful, some not." — ADR-0002 #39; search = client-side substring on title + description over the ISR list — 02 §2.2 RP-02, `search` tsvector unused on the page in v1; `SearchBox` 250 ms debounce — ADR-0002 #59; `ActiveFilterChips`, 3-up `ProjectCard` grid (2 chips per card, 4 elsewhere — ADR-0002 #54), empty state §11.7), `/projects/[slug]` (breadcrumb, icon 104px, `TypeBadge`, `Chip`s, count row, `Gallery` + `Lightbox`, ABOUT `Markdown` incl. `notes_md` appended, `VersionsTable` + `ChangelogExpander` §12.5 (synced file Download cell → the Modrinth CDN URL `project_files.url` — ADR-0002 #42), `GetItPanel` sticky rail with Modrinth/CurseForge rows + combined-count line, `DetailsList`, `TipPanel` **placeholder slab pointing at `/support`** until S1.9; public comments slot reserved); `/` hero `FeaturedHero` (featured project takeover; NEW badge when `published_at` < 30 days — ADR-0002 #41; fallback = highest `downloads_total` per 02 §2.1) + Featured 4-up; `app/sitemap.ts` (`/sitemap.xml`, 02 RP-07); `generateMetadata` per page; `ProjectCardSkeleton`, `ProjectDetailSkeleton` `loading.tsx`.
- Admin: `/admin/projects` (`Table` of all projects incl. hidden, empty copy per 02 §1.3 — ADR-0002 #40; feature/hide `Toggle`s (first use of `Toggle`, 03 §2.2) + `ReorderableList` reorder; `SyncStatus` = `Table`+`StatusPill`+`Button`+`SourceSwatch` from `sync_runs` — ADR-0002 #56; `StatusPill` fills per ADR-0002 #47; "Sync now" → `triggerSync`), `/admin/projects/[id]` **curate view for synced projects** (02 §1.3: overrides form built from `Field` (first use, 03 §2.2) + `Toggle` + `Select` — feature/order/hidden/title + description override/notes/comments toggle, CurseForge id field → `setProjectLink`); S1.3 extends this route with the exclusive edit form and gallery upload.
- ISR: `revalidate` 600 on `/`, `/projects`, `/projects/[slug]`; tags `projects`, `project:<slug>`; the placeholder pages from S0 for `/projects` are replaced here (ADR-0002 C20).
- Custom Vercel Analytics events **not yet** (S1.9).

**Scope OUT**
- No exclusive projects create/edit form, no `project-files` or `project-media` bucket, no `uploadProjectMedia`/extra-gallery upload UI (S1.2 gallery = Modrinth URLs only — ADR-0002 C10), no `/api/download/[fileId]` (S1.3). No comments section (S1.4 — detail page reserves the COMMENTS section slot). No `notification_events` writes of any kind (table arrives S1.4; `sync.*` emission arrives S1.5). No SEEN ON row (S1.8). No Latest videos on Home (S1.6). No stats snapshot (S1.9). Discovery of CF ids by author search — manual only (Q39).

**Spec traceability:** `docs/spec.md` §3 (Modrinth snapshot), §4 goals 1–3, §5 Projects, Home; `docs/platform-audit.md` (Modrinth, CurseForge); `docs/data-model.md` §2.2, §2.9 (`sync_runs`), §5 (Modrinth/CurseForge rows), §6 "Curate synced project"; Q1, Q2, Q39; `DESIGN.md` §4 (glyphs), §5 (Type badge, Chip, Filter bar, Project card, Gallery), §6.1–6.3, §11.1 (Skeleton), §11.7, §12.5 (changelog expander).

**Engineering docs implemented:** 01 §5 (route handlers/cron), §8 (ISR/tags), §18 (jobs); 02 §1.1 (`/`, `/projects`, `/projects/[slug]`), §1.3 (`/admin/projects`, `/admin/projects/[id]` curate), §1.4 (cron rows), §2.1, §2.2, §2.3, §5 revalidation, §8 row S1.2; 03 §2.3 (Projects), §2.2 (`Table`, `Field`, `Toggle`, `Select`, `Markdown`, `StatusPill`), §2.10 (`SyncStatus`); 04 §1.4 (`curateProject`, `setProjectLink`), §1.7 (`triggerSync`), §2.4 (cron routes, SC-12/SC-13), §3.1, §3.2, §4 (modrinth/curseforge adapters), §5.2, §6 rows S1.2; 05 §8 row S1.2.

**Acceptance criteria**
1. S1.2.AC1 — Authorized `GET /api/cron/sync-modrinth` returns 200 JSON summary; unauthorized returns 401; running twice produces the same row counts (idempotent) and two `sync_runs` rows with `ok=true`.
2. S1.2.AC2 — All 18 Modrinth projects (per `docs/spec.md` §3 snapshot, whatever the live count is) appear on `/projects` with the correct `project_type` mapping: Heavy Spear (datapack) → datapack; Legacy Manhunts Reworked → plugin; Metal Pipe Mace → resource pack; Pixel Chameleon → mod.
3. S1.2.AC3 — `/projects` filter buttons show counts (`MODS 7` style); selecting type + version + sort updates the grid and `ActiveFilterChips`; "Clear" resets; empty state reads "NOTHING MATCHES / Try fewer filters." with Clear filters; `q` search matches title/description client-side (case-insensitive substring, 02 §2.2).
4. S1.2.AC4 — `ProjectCard` matches DESIGN.md §5: icon in ink well, Bungee title, one-line description, ≤2 chips (+N), footer with `TypeBadge` (glyph + word) left and Silkscreen emerald count right; hover lift; whole card is one link.
5. S1.2.AC5 — `/projects/[slug]` shows gallery + `Lightbox` (Esc closes, arrows move, alt text present), ABOUT markdown with Bungee gold h2/h3, VERSIONS & FILES table with the word "Download" (never "Get") and a "Changes ▾" expander (one open at a time, collapsed by default), `GetItPanel` with Modrinth (+CurseForge when linked) rows and a combined-count explanation line, `DetailsList` (type, updated, licence, source).
6. S1.2.AC6 — Combined count = `downloads_modrinth + downloads_curseforge + downloads_direct` and equals the sum shown in the rail rows.
7. S1.2.AC7 — Home hero is the featured project (`project_overrides.featured=true`, lowest `featured_order`) with gold DOWNLOAD (links to Modrinth in v1 for synced projects) + "See the project"; Featured 4-up shows the next featured projects by `featured_order` (excluding the hero); if nothing is featured, hero uses the highest-`downloads_total` published project and the 4-up shows the next four by `downloads_total`; fewer than 4 → render what exists; section not rendered only when there are 0 published projects (02 §2.1; 00-O-3 DECIDED).
8. S1.2.AC8 — Admin: as role `admin`, on `/admin/projects` toggle feature/hide + reorder, and on `/admin/projects/[id]` add notes, title/description overrides, and a CurseForge id → after `syncCurseforge` the CF row and count appear on the detail page; `SyncStatus` shows last run time/ok/items; "Sync now" runs and refreshes. As role `moderator` the same pages render read-only and `curateProject`/`setProjectLink`/`triggerSync` return `forbidden` (ADR-0002 C7; T-ACT-40..42 with mod = denied).
9. S1.2.AC9 — Hidden projects (override `hidden` or `status='hidden'`) never render on `/`, `/projects`, or `/projects/[slug]` (404), but appear in admin.
10. S1.2.AC10 — After a sync, a changed title appears on `/projects/[slug]` without redeploy within one request after `revalidateTag` (verify by editing an override, which also revalidates).
11. S1.2.AC11 — Modrinth requests carry the `User-Agent` from env; a simulated 429 is retried with backoff and does not wipe existing rows (T-ADP + T-UNIT).
12. S1.2.AC12 — `loading.tsx` skeletons render inside real card/detail shells; axe zero serious/critical on `/`, `/projects`, one detail at 1280 + 390; Lighthouse LCP < 2.5 s on the preview for `/projects/[slug]`.
13. S1.2.AC13 — Client bundle contains no `CURSEFORGE_API_KEY`; `next build` route table shows `/projects/[slug]` as ISR.

**Tests required:** 05 §8 row S1.2 — T-RLS-16..43, 111..114; T-ACT-33 (modrinth + curseforge routes), 40, 41, 42, 45..52, 70 (lock), 71 (curseforge no-key); T-ADP-1..8 (T-ADP-2 = mapping edge cases: datapack loader, paper/spigot/bukkit/purpur/folia/velocity/bungeecord → plugin, resourcepack, default mod; run-twice idempotency; 429 retry + UA), 20 (no `process.env` in adapters); T-UNIT-10, 11, 13, 14, 20, 21, 24 (`cronAuth` — first cron route; 04 §2.4), 30, 31, 32, 39 (`groupGameVersions`); T-E2E-1 (hero + featured), 2, 3 (except comments/SEEN ON), 5 (gallery/lightbox part), 18, 34 (curate part), 41, 42 (admin a11y + screenshots — first admin page `/admin/projects`; extends per admin slice); seed SEED-4..6, SEED-12. (T-ACT-38/73 belong to S1.3 — ADR-0002 C10.)

**Gates required:** all seven; `backend-reviewer` focus: idempotency, sync_runs, never-delete; `security-reviewer` focus: cron secret, admin actions role re-check.

**Demo script**
1. Hit `/api/cron/sync-modrinth` with the secret (via `sync-now`-style curl) → JSON summary; open `/admin/projects` → SyncStatus updated.
2. Open `/projects`, filter DATAPACKS, sort by downloads, search "spear".
3. Open Heavy Spear (datapack) → gallery, lightbox, Changes ▾, GET IT rail.
4. In admin, feature Metal Pipe Mace as #1 → Home hero updates.
5. Enter a CurseForge id for a cross-posted project, run CF sync → combined count changes.

**Risks / unknowns:** `CURSEFORGE_API_KEY` not yet obtained (`docs/questions.md` setup list) — CF adapter ships with fixtures; AC8's CF part is verified once the key exists (record in PR "Deferred" if not; `setProjectLink` returns `upstream_error` "CurseForge key not configured" per 04 §1.4); Modrinth gallery/CDN hosts must be allow-listed for `next/image`; project icons/screenshots for the hero are "still missing" art (Q37) — hero uses Modrinth assets; cron minute offsets: 04 §6 strings are the contract (02 aligned).

---

### S1.3 — Exclusive projects

**Goal:** Oliver can author and publish projects that live only on odsens.com, upload their files, and visitors download them directly with counted, signed URLs.

**Depends on:** S1.2.

**Scope IN**
- Buckets: `project-files` (**private**, 100 MB per `docs/data-model.md` §3 — ADR-0002 #31; allowlist `.jar .zip .mrpack`, ZIP magic bytes 04 SC-19, sha512 recorded) and `project-media` (public-read, 5 MB/img, png/jpg/webp) — both created here with policies (service role only, 01 INV-33); `supabase/config.toml` `[storage] file_size_limit` raised from `50MiB` to `100MiB` in this PR (04 §10 OPEN-10 / ADR-0002 #31) so `test:db`/local uploads match production.
- Uploads: ≤1 MB inline via action FormData; larger files via the 04 §1.4.5 **two-phase signed-upload pattern** (`begin` mints a signed upload URL with the service role, browser PUTs, `commit` re-validates magic bytes / size / dimensions / sha512 and writes the row or deletes the object); no browser-side broad Storage policy. This is the baseline (01 INV-51 v0.2, ADR-0001 D13) — **no further ADR** (ADR-0002 C11). Storage paths per ADR-0002 C16: `project-media/{project_id}/{icon|gallery}/{hash}.{ext}`, `project-files/{project_id}/{version_id}/{filename}`; helpers in `lib/files.ts` (path builders, signed URLs, `resolveDownloadable`) and `lib/validation/files.ts` (`sniffMime, pngDimensions, isSkinTexture, sanitizeFilename, UPLOAD_KINDS, validateUpload`) — no `lib/uploads.ts`.
- Table: `project_downloads` (`project_id, file_id, ip_hash, ua_hash, created_at`; `lib/hash.ts` per ADR-0002 C13: `ipHash = HMAC-SHA256(HASH_SECRET, ip|utcDay)`, `HASH_SECRET` ≥32 bytes server-only, added to `.env.example` + Vercel in this PR); purge >90 days runs in the stats job (S1.9) — S1.3 ships the table + insert; RPC `record_download` (04 D4).
- Actions (admin — ADR-0002 C7; `lib/actions/{projects,uploads}.ts`): `createExclusiveProject`, `updateExclusiveProject` (Modrinth-shaped form: slug, title, description, body_md, project_type, categories, loaders, game_versions, license, links; versions + files), `publishProject` (draft → published, and back to draft/hidden; preconditions icon + ≥1 version with ≥1 file — ADR-0002 #65), `uploadProjectMedia` (icon/gallery for exclusives; extra-gallery images for synced projects referenced by `curateProject.extra_gallery` — lands here with the bucket, ADR-0002 C10), `uploadProjectFile`. No draft preview URLs (ADR-0002 #38).
- Route handler: `/api/download/[fileId]` per 04 §2.3 D1..D7 — **GET only** (HEAD/POST/others → 405; ADR-0002 C17) — verify project published + file has `storage_path` → rate limit 30 / min / `ip_hash` via `assertRateLimit` → `rate_limit_ok`, counted on `project_downloads.ip_hash` (04 D3; for the download route `rate_limit_hits` is used for kind `skin` only — full scope table in 04 §5.5) (429 with JSON `{ok:false,error:{code:'rate_limited',message}}` + `Retry-After: 60` — ADR-0002 C14) → increment `project_files.download_count` + `projects.downloads_direct` + insert `project_downloads` in one RPC → 302 to a 60 s signed URL with `Content-Disposition: attachment`; unpublished/missing/synced → 404. Scope resolver `lib/files.ts resolveDownloadable` (04 D2 + 01 INV-56) is generic over bucket + owner for S2.3.
- Admin: `/admin/projects/new`; `/admin/projects/[id]` extended with the exclusive edit form (`Field`, `Select`, `UploadWell` states per §11.1, versions editor, publish toggle with `StatusPill` DRAFT/LIVE/HIDDEN) and the extra-gallery `UploadWell` on the S1.2 curate view.
- Public: `ExclusiveBadge` on `ProjectCard` + detail (gold outline; never on a project that has a Modrinth/CurseForge link — `isExclusive` predicate, T-UNIT-36); `GetItPanel` primary button = direct DOWNLOAD (gold) with file meta (name, size, sha512 shown); `VersionsTable` "Download" links → `/api/download/[fileId]` for exclusive files (synced files keep the Modrinth CDN URL); Home hero gold DOWNLOAD becomes a direct download when the featured project is exclusive. Markdown `<img>` hosts limited to the INV-54 allowlist (ADR-0002 #34).
- Combined count includes `downloads_direct` (already in view).

**Scope OUT**
- No comments (S1.4). No custom Vercel Analytics `download` event (S1.9). No skins/art buckets (S1.7). No workroom-generic file table (P2 — but the download route must not hardcode `project` scope: it resolves kinds `project_file` (S1.3) · `skin` (S1.7) · `workroom_file` (S2.3) via `lib/files.ts resolveDownloadable`, see `docs/spec.md` §4 5c "v1 groundwork" and 04 D2 / 01 INV-56). Skin download kind arrives in S1.7 (ADR-0002 C8). Orphan-object cleanup (U1) is S1.9's `snapshotStats` (ADR-0002 #80).

**Spec traceability:** `docs/spec.md` §4 1b, 3, 5c groundwork, §5 Projects (Exclusive), Admin Projects; `docs/data-model.md` §2.2, §3 (`project-files`, `project-media`), §6 "Exclusive download", "Add exclusive project"; `DESIGN.md` §5 (Exclusive badge, Gold button), §6.3, §6.9, §11.1 (Upload well, Admin field, Admin table).

**Engineering docs implemented:** 01 §11 (uploads, INV-51 two-phase baseline), §12 (downloads), §17 (rate limiting); 02 §1.3 (`/admin/projects/new`, `/admin/projects/[id]` exclusive edit), §1.4 + §2.9 (`/api/download/[fileId]`), §8 row S1.3; 03 §2.2 (`ExclusiveBadge`, `StatusPill`; `Field`/`Select` reused from S1.2), §2.10 (`UploadWell`); 04 §0 SC-17..SC-21, §1.4 (`createExclusiveProject`, `updateExclusiveProject`, `publishProject`), §1.4.5, `uploadProjectMedia`, `uploadProjectFile`, §2.3 (D1..D7 + Errors row), SC-16/SC-17 (`HASH_SECRET`), §2.3 D4 (`record_download`), §10 OPEN-10 (storage limit); 05 §8 row S1.3.

**Acceptance criteria**
1. S1.3.AC1 — Admin creates a draft exclusive project; it is not visible on `/projects` or `/projects/[slug]` (404) until `publishProject`; after publish it appears with `ExclusiveBadge` "★ ONLY ON ODSENS" and a gold card outline.
2. S1.3.AC2 — `UploadWell` shows idle / drag-over / uploading (percent + flat bar + Cancel) / done (✔ name + size) / error with the actual number ("That's 120 MB. The limit is 100.") or type; limits printed under the well at all times (values from the 04 caps: files 100 MB, media 5 MB).
3. S1.3.AC3 — Uploading a `.exe` renamed `.jar` (wrong magic bytes) is rejected at `commit` and the object deleted (T-ACT-39, T-ACT-73); a real `.jar`/`.zip`/`.mrpack` ≤100 MB is accepted through the two-phase flow against the local stack (`supabase start` with the raised `file_size_limit`), sha512 stored and displayed in `GetItPanel` file meta.
4. S1.3.AC4 — `GET /api/download/[fileId]` on a published file returns 302 to a signed URL that expires within 60 s; the response/URL sets `Content-Disposition: attachment`; `project_files.download_count` and `projects.downloads_direct` each increment exactly 1 per request; a `project_downloads` row is written with hashed ip/ua only.
5. S1.3.AC5 — Same route for a draft/hidden project or unknown id → 404; direct bucket URL access to `project-files` without a signed URL → 4xx (bucket private).
6. S1.3.AC6 — Rate limit: the 31st request in one minute from one `ip_hash` → 429 JSON `{ok:false,error:{code:'rate_limited',message}}` with `Retry-After: 60` (ADR-0002 C14/C17; T-ACT-44); `HEAD` on the route → 405 (T-ACT-43).
7. S1.3.AC7 — Detail page for an exclusive project: `GetItPanel` primary gold DOWNLOAD (direct), no Modrinth/CurseForge rows, combined count = direct count; `DetailsList` source reads "odsens".
8. S1.3.AC8 — `ExclusiveBadge` never renders on a project with `source='modrinth'` or any `project_links` row (T-UNIT on the predicate).
9. S1.3.AC9 — Editing an exclusive project's markdown body updates `/projects/[slug]` after `revalidateTag('project:<slug>')`.
10. S1.3.AC10 — RLS: anon/user cannot insert/update `projects`, `project_versions`, `project_files`; storage policies allow uploads only via service role (signed upload URLs are minted server-side per 04 §1.4.5; no `insert` policy for `authenticated`/`anon` on `storage.objects`).
11. S1.3.AC11 — Client bundle contains no `SERVICE_ROLE` or `HASH_SECRET`; the browser never holds a broad Storage policy; an object PUT to a signed URL without a subsequent `commit` has no DB row (its removal by the U1 orphan cleanup is S1.9.AC1 / T-ACT-75 — ADR-0002 #80) (`security-reviewer`).
12. S1.3.AC12 — axe zero serious/critical on `/admin/projects/new` and an exclusive detail at 1280 + 390.

**Tests required:** 05 §8 row S1.3 — T-RLS-44..47, 117..120, 129 (`record_download`); T-ACT-34..39 (38 = `uploadProjectMedia`, moved here from S1.2 per ADR-0002 C10), 43, 44, 73 (files + media); T-UNIT-17 (zip), 18 (`project-file`, `project-media`, config.toml 100MiB), 19 (`pngDimensions` for icons), 22, 23 (`ipHash`/`uaHash`), 36 (`isExclusive`), 38 (`download` event schema); T-E2E-4, 31, 35; seed SEED-4 `…0103`, SEED-5 `…0501`, SEED-13; CI-13 (`100MiB`).

**Gates required:** all seven; `security-reviewer` focus: uploads/downloads section of the checklist.

**Demo script**
1. `/admin/projects/new` → fill Modrinth-shaped form → upload icon + a `.jar` → save draft.
2. Visit the public slug → 404. Publish → page live with the badge.
3. Click DOWNLOAD → file arrives as attachment; refresh → count +1.
4. Try to upload a 120 MB zip → error with the number.
5. Hide the project → public 404 again.

**Risks / unknowns:** Vercel 4.5 MB request-body cap is why 04 §1.4.5 exists (baseline, no ADR — ADR-0002 C11); `.mrpack` is a zip container (04 SC-19 treats it as the ZIP signature); `HASH_SECRET` (≥32 bytes) must exist in Vercel preview + prod before merge (ADR-0002 C13).

---

### S1.4 — Comments

**Goal:** signed-in visitors can comment, reply, like, edit (15 min), delete, and report on projects; moderators moderate; events are logged for S1.5 delivery.

**Depends on:** S1.1, S1.2.

**Scope IN**
- Tables: `comments` (+ view `comments_public` — ADR-0002 #71: every role incl. anon selects rows of all statuses for a visible target with `id, target_type, target_id, parent_id, status, created_at, like_count`, bodies/authors only for `published`; BEFORE INSERT trigger `comments_set_status()` — ADR-0002 #72: the action inserts its computed status, the trigger recomputes, the action returns the row **as stored**), `comment_likes`, `comment_reports`, `notification_events` (event catalog kinds `comment.new`, `comment.held`, `comment.reported`, `comment.reply`, `comment.approved` written via `lib/notify/emit.ts` (04 SC-22); nothing delivered); SQL helper `can_comment(target_type, target_id)` (security definer) used by the comment/like/report insert policies (ADR-0002); triggers for `like_count`, `profiles.comment_count` (counts comments that have ever reached `published` — 04 §1.2); rate limits per 04 §5.5 via `assertRateLimit` → `rate_limit_ok`, counted on the source tables in 04 §5.5 (`comments`, `comment_reports`, `comment_likes`; among the comment scopes only edit/delete count on `rate_limit_hits` — full scope table in 04 §5.5) (post 5 / min + 50 / day, edit 20 / min, delete 20 / min, report 10 / h, like 60 / min); RLS per `docs/data-model.md` §4; index `(target_type, target_id, created_at)`.
- Actions: `postComment` (onboarded + not banned; comments enabled = `coalesce(project_overrides.comments_enabled, not site_settings.comments_closed_default)` per 04 §1.2 else `comments_closed`; strip HTML; ≤1000 chars; ≤1 link; status per moderation mode: `held` if `hold_first_time` and `comment_count = 0`; writes `comment.new` or `comment.held`; reply → also `comment.reply`; revalidate target), `editComment` (author, ≤15 min, sets `edited_at` in the action — no trigger), `deleteComment` (author **or** role ≥ moderator; soft-delete → `deleted`, `moderated_by/at` set when actor ≠ author — 04 §1.2; may return `rate_limited`), `toggleLike` (revalidates `project:<slug>`), `reportComment` (reason `spam|rude|other` + note; unique per reporter; ≥3 reports → auto `held` + `comment.held` (reason `reports`) and always `comment.reported`), `moderateComment` (mod; verbs `approve|hide|unhide|delete` per 04 §1.2 transition table; approve → `published` + `comment.approved`; sets `moderated_by/at`, resolves reports), `banUser` (mod; `is_banned`, reason; target role `user` only; no cascade in v1 — ADR-0002 #64), `renameUserHandle` (mod; spec §9 "moderators can rename"; contract 04 §1.2: target role `user`, new handle passes 04 H-rules, sets `profiles.handle` + `handle_changed_at`; `lib/actions/comments.ts`). Roles per ADR-0002 C7 (moderator = comment moderation only).
- Public UI on `/projects/[slug]` COMMENTS section (client seam per ADR-0002 C1 — no PPR): `CommentThread` (server shell; public comments via `lib/data/comments.ts` over `comments_public`, tag `project:<slug>`) + `CommentList` (client leaf; `useOptimistic`; reads the viewer's own held/hidden rows + own likes via `lib/supabase/client.ts` under RLS; no optimistic insert for first-timers under `hold_first_time`), `Comment` (not split — ADR-0002 #57), `Reply` (one level; deeper replies flat with `@handle`), `Composer` (`useActionState`), `LikeButton`, `ReportPicker`, `HeldNotice`, `SignInPrompt`, `ModActionRow` (+ Moderate ON/OFF `Toggle` in thread header for mods), `CommentThreadSkeleton`; all §11.2 states: own Edit/Delete, edited marker, inline delete confirm, report confirmation line, count `14 TOTAL` (= slots the viewer sees — ADR-0002 #76), empty thread, hidden slot, deleted-with-replies slot, banned composer, comments closed, composer error, held (author view + mod view with `FIRST COMMENT` tag), CREATOR (from `site_settings.owner_profile_id`, ADR-0002 #55) / MOD tags. Composer error strings from `lib/validation/comment.ts` (`commentErrorLine`; ADR-0002 C16).
- Admin `/admin/comments` (role ≥ moderator): queue `Table` (held first, then reported), Approve (filled emerald) / Hide / Delete / Ban user (+ Unhide; Rename handle = `Field` (handle rules) + `InlineConfirm` "Rename @old to @new?" → `renameUserHandle`, composed from existing primitives — no new DESIGN.md state); sidebar count of held; moderation mode is edited on `/admin/settings` (S1.5) — S1.4 reads `site_settings.moderation_mode` (seeded `auto`; set via SQL locally for the demo). `Toggle` (from S1.2) is reused for the thread-header Moderate switch.
- Comments target is polymorphic (`target_type project|skin|art|video`); only `project` is wired in v1 (ADR-0002 C21; 00-O-4 DECIDED).

**Scope OUT**
- No delivery of notifications, no `/admin/settings` (S1.5). No Realtime. No user inbox (cut, Q29). No comment threads on skins/art/videos pages (ADR-0002 C21). No name detection. No `sync.*` events (S1.5).

**Spec traceability:** `docs/spec.md` §4 goal 4, §5 Comments, §9; Q10, Q35, Q38, Q40; `docs/data-model.md` §2.5, §4, §6 "Comment"; `docs/notifications.md` (event catalog v1 rows, "log only" for reply/approved); `DESIGN.md` §5 (Comment bubble, Reply, Held for review, Sign-in prompt), §11.1 (Mod action row, Square toggle), §11.2 (all), §11.7.

**Engineering docs implemented:** 01 §15 (user text), §17 (rate limiting); 02 §1.3 (`/admin/comments`), §2.3 (comments section), §8 row S1.4; 03 §2.4 (Comments), §2.2 (`InlineConfirm`, `Toggle`); 04 §0 SC-05, SC-08, SC-22, §1.2 (all eight actions incl. `renameUserHandle` + shared definitions), §5.1, §5.5; 05 §8 row S1.4.

**Acceptance criteria**
1. S1.4.AC1 — Signed-out visitor sees `SignInPrompt` ("Sign in to comment. Your handle is all anyone sees.") in place of the composer; existing comments visible.
2. S1.4.AC2 — Signed-in user posts a comment → appears optimistically, then persisted; toast "Comment posted."; `notification_events` row `comment.new` (or `comment.held`) written with `subject_type/subject_id`.
3. S1.4.AC3 — Limits enforced server-side: 1001 chars → composer error inline "That didn't post." + rule; two links → rejected "Too many links."; HTML stripped; T-ACT proves each.
4. S1.4.AC4 — Moderation mode `hold_first_time` + first-time commenter → comment `held`: author sees the dashed gold-deep bubble + "⏳ HELD FOR REVIEW" + copy; other users do not see it; mods see it with `ModActionRow` + `FIRST COMMENT` tag; Approve → published + `comment.approved` event.
5. S1.4.AC5 — Reply renders one indent level (52 px margin, 2 px left border); a reply to a reply stores the root as `parent_id` and prefixes `@handle`; `comment.reply` event written.
6. S1.4.AC6 — Like toggles `like_count` via trigger (T-RLS: only own like row deletable); liked state = `--indigo-lift` fill with ink text.
7. S1.4.AC7 — Edit allowed for 15 min (T-ACT with clock at 14:59 vs 15:01), sets `edited_at` and shows "· edited"; after 15 min only Delete remains.
8. S1.4.AC8 — Delete asks once inline; deleted comment with replies shows "Deleted." slot with replies intact; without replies the slot still stays (per §11.2) — status `deleted`.
9. S1.4.AC9 — Report picker (Spam / Rude / Something else) → "Reported. OddSense will look at it."; second report by same user → idempotent no-op (no error to UI); third distinct report → comment auto-`held` + `comment.held` (payload `reason='reports'`) **and** `comment.reported` events (04 §1.2; T-ACT-22); `reportComment` limited to 10 / h (ADR-0002 #69).
10. S1.4.AC10 — Banned user: composer replaced by "You can't comment here."; RLS blocks insert into `comments`, `comment_likes`, `comment_reports` for banned (T-RLS).
11. S1.4.AC11 — Comments disabled on a project (`project_overrides.comments_enabled=false`, or no override row and `site_settings.comments_closed_default=true`) → CLOSED slab, old comments visible, `postComment` returns `comments_closed` server-side; an override row with `comments_enabled=true` re-opens the thread regardless of the site default (04 §1.2 rule; T-ACT).
12. S1.4.AC12 — Hidden by mod → sunk slab "Hidden by a moderator." (no handle, no body); `moderated_by/at` set.
13. S1.4.AC13 — Rate limit: the 6th comment in 60 s (or 51st in 24 h) → `rate_limited` with plain-language error (04 §5.5; T-ACT-13).
14. S1.4.AC14 — `/admin/comments` lists held + reported first with worded `StatusPill`s (HELD gold-wash, LIVE emerald-wash); Approve/Hide/Unhide/Delete/Ban/Rename handle (`Field` + `InlineConfirm` → `renameUserHandle`, T-ACT-67) work and re-check role server-side (T-ACT: user role → `forbidden`; `deleteComment` by a mod sets `moderated_by`); sidebar shows held count.
15. S1.4.AC15 — Comment count `n TOTAL` in Silkscreen ≥11 px beside COMMENTS; empty thread state renders "NO COMMENTS YET / Say something." + one button.
16. S1.4.AC16 — `deleteAccount` (S1.1) leaves the user's comments as "Deleted." slots (`status='deleted'`), removes their likes/reports and avatar object (ADR-0002 #28; T-ACT-65 cascade re-run here); `can_comment()` gates comment/like/report inserts (T-RLS-133).
17. S1.4.AC17 — axe zero serious/critical on a detail page with comments (incl. composer focus, dialog-free inline confirms) at 1280 + 390.
18. S1.4.AC18 — A user inserting `status='published'` directly with the anon key under `hold_first_time` with `comment_count=0` gets a row stored as `held` (trigger `comments_set_status()`, T-RLS-131); `comments_public` never exposes `body`/`author_id` of hidden/deleted/held rows to other users (T-RLS-128).

**Tests required:** 05 §8 row S1.4 — T-RLS-63..89, 90..93 (`notification_events`, created here), 128 (`comments_public`), 131 (status trigger), 133 (`can_comment`); T-ACT-11..24 (all comment actions auth matrix + validation — length, links, HTML strip, edit window, rate limits, auto-hold at 3 with both events, moderation-mode branch, comments-enabled rule, mod delete), 67 (`renameUserHandle`), 65 (`deleteAccount` cascade re-run against comments); T-UNIT-4..8, 40 (comment error lines); T-E2E-3 (comments part), 24..30, 36; seed SEED-9; COV-2.

**Gates required:** all seven; `security-reviewer` focus: comments section, rate limits, mod audit fields.

**Demo script**
1. Signed out: see prompt. Sign in as fresh user (mode `hold_first_time` set via SQL) → post → HELD bubble.
2. As mod, open `/admin/comments` → Approve → comment appears publicly.
3. Reply, like, edit (within 15 min), report from a second account ×3 → auto-held.
4. Toggle Moderate ON in the thread header → hide one → "Hidden by a moderator."
5. Ban a user → their composer becomes "You can't comment here."

**Risks / unknowns:** Optimistic UI + held status (must not flash "published" for held comments — `postComment` returns the row as stored and `CommentList` performs no optimistic insert for first-timers under `hold_first_time`, ADR-0002 #72); rate limits are SQL counts via `rate_limit_ok` over the 04 §5.5 source tables (among the comment scopes only edit/delete use `rate_limit_hits`; no edge limiter); `comment_count` counts ever-published comments (04 §1.2; 00-O-13 DECIDED).

---

### S1.5 — Notifications

**Goal:** admins get Discord + email for the v1 event catalog, controlled by the Settings matrix, delivered by a 5-minute cron; sync jobs report failures/staleness.

**Depends on:** S1.4.

**Scope IN**
- Tables: `notification_recipients` (unique index `(event_id, channel, coalesce(address,''))`, 04 §3.6 F3 / data-model §2.6), `notification_matrix` seeded **exactly** per `docs/notifications.md` default matrix including the P2 rows with the listed values (`comment.new` ON/ON, `comment.held` ON/ON, `comment.reported` ON/ON, `sync.failed`+`sync.stale` ON/OFF, `mention.suggested` OFF/ON, `order.new` ON/ON, `tip.new` OFF/ON); P2 rows cannot fire because no P2 event is emitted in v1 and `updateSettings` rejects them (04 §1.3). `site_settings` columns already exist from S1.1 (data-model §2.4).
- Admin `/admin/settings` (**admin only**; the **whole route ships here** — ADR-0002 C2): Moderation radios (`moderation_mode`) + `comments_closed_default` square `Toggle` (label per 03 V-03 — ADR-0002 #43) + Moderators `Table` (handle + role; Make mod / Remove / add by handle → `setUserRole`); `NotificationMatrix` (§12.1: rows New comment · Held for review · Reported · Sync failed/stale (one row toggles both kinds); greyed 45 % non-interactive COMING LATER rows Suggested mention · New order · New tip; columns EMAIL · DISCORD; Discord webhook URL masked + Test button + inline ✔/✕; Admin emails as removable chips; helper line "The allay works for admins only…"), Ko-fi section (page name `Field` → `site_settings.kofi_page`; webhook `StatusPill` NOT SET gold-wash in v1), SAVE SETTINGS + "Saved." toast (reuses `Toggle`, `Field`, `Table` from earlier slices).
- Actions (`lib/actions/settings.ts`, admin): `updateSettings` (full input per 04 §1.3 incl. `moderation_mode`, `comments_closed_default`, `discord_webhook_url`, `admin_notify_emails`, `kofi_page`, `matrix`; `lib/settings/matrixDiff.ts`), `testDiscordWebhook` (posts a test embed; returns ✔/✕), `setUserRole` (input `{handle, role}`; moderator → `forbidden`; cannot demote self / the last admin — 04 §1.3, T-ACT-66).
- Jobs: `notifyFanOut` (04 §3.6: step F0 emits `sync.stale` per J-S; then pending events → recipient rows per enabled (kind, channel); email → one row per admin email address; discord → one row per event with **`address = <the webhook URL>`**, masked `…<last 4>` in UI/logs — ADR-0002 C9 / notifications.md), `notifyDeliver` (04 §3.7: pending → `lib/notify/deliver/discord.ts` / `deliver/email.ts` (Resend, from `NOTIFY_FROM_EMAIL` = `allay@odsens.com`) → `sent`, or `attempts+1` + `error` with backoff 5/10/20/40/80 min and `status='failed'` at attempt 5; >5 eligible per (channel, address) → single digest); route `/api/cron/notify` every 5 min in `vercel.json` (04 §6; `maxDuration` 60 — ADR-0002 C15).
- Emails (`emails/`): `EmailLayout`, `EmailButton`, `EmailBadge`, templates `CommentNew`, `CommentHeld` (gold APPROVE button), `CommentReported`, `SyncFailed`, each with a plain-text version; `pnpm email dev` preview; allay voice per `DESIGN.md` §12.1; wordmark as PNG; allay render = neutral placeholder until Oliver's asset PR (ADR-0002 #25); one button per mail; footer "why you got it" + "Manage in Settings"; hex literals under `emails/**` must exist in `tokens.css` (T-UNIT-43).
- Discord embed: bot name `allay`, colour bar indigo default / gold held+reported / `--alert` failures; title "Event — Project", excerpt, View link.
- `lib/notify/emit.ts` (04 SC-22) is wired into the shared job runner (04 §3 common signature): `syncModrinth` and `syncCurseforge` (the only jobs existing at S1.5) now emit `sync.failed` per 04 J-F (edge-triggered: this run failed and the previous run for the source was ok/absent); `sync.stale` is emitted only by `notifyFanOut` F0 per 04 J-S (sources `modrinth`, `youtube`, `curseforge`*, `mentions`** per the 04 J-S conditions — `mentions` only when `YOUTUBE_API_KEY` is set and ≥1 YouTube mention exists; no ok run in 6 h, once per 6 h per source). Every later job (`syncYoutube` S1.6, `refreshMentions` S1.8, `snapshotStats` S1.9) inherits `sync.failed` emission through the same runner.
- Adapters: `lib/adapters/resend.ts`, `lib/adapters/discord.ts`.

**Scope OUT**
- No user-facing notifications, no in-app bell (S2.5), no `notification_prefs` (P2). No `mention.suggested` delivery (v1.5). No `OrderNew`/`WorkroomUpdate` templates (P2). No second Discord webhook field.

**Spec traceability:** `docs/spec.md` §5 Comments → Notifications, Admin Settings; `docs/notifications.md` (all sections); `docs/data-model.md` §2.4 `site_settings`, §2.6, §5 "Notifications" row; Q11, Q29, Q44; `DESIGN.md` §11.3 #15, §12.1 (Notification matrix, Email template, The allay, Discord embed).

**Engineering docs implemented:** 01 §9 (logging), §18 (jobs); 02 §1.3 + §2.8 (`/admin/settings`, whole), §1.4 + §2.10 (`/api/cron/notify`), §8 row S1.5; 03 §2.10 (`NotificationMatrix`), §2.2 (`Toggle`, `Field`, `Table` reuse), §2.11 + §6 (Email components); 04 §0 SC-22, §1.3 (`updateSettings`, `testDiscordWebhook`, `setUserRole`), §3 J-F/J-S, §3.6, §3.7, §4 (resend, discord adapters), §6 row notify; 05 §8 row S1.5.

**Acceptance criteria**
1. S1.5.AC1 — `/admin/settings` reachable only by role `admin`; a signed-in moderator gets the root 404 page (`notFound()` — ADR-0002 C4) and sees no Settings link in `AdminShell`; anon → `AdminGate` (200).
2. S1.5.AC2 — Matrix renders the four v1 rows with worded ON/OFF square toggles seeded to the default matrix (`comment.*` ON/ON, sync ON/OFF); the three P2 rows render greyed 45 % and non-interactive with their seeded values visible (`mention.suggested` OFF/ON, `order.new` ON/ON, `tip.new` OFF/ON); SAVE writes only v1 rows to `notification_matrix` (`updateSettings` rejects P2 kinds — T-ACT-26); toast "Saved."
3. S1.5.AC3 — Discord webhook field is masked after save; Test posts an embed to the channel and shows inline ✔ (or ✕ with the plain reason); the raw URL is never returned to the client after save (T-ACT).
4. S1.5.AC4 — Admin emails are entered explicitly as chips; the signed-in admin's Google email is never pre-filled (T-E2E/T-ACT).
5. S1.5.AC5 — Posting a comment (S1.4) → within one `/api/cron/notify` run, recipient rows exist for each enabled channel; Discord message arrives with the correct colour bar; email arrives from `allay@odsens.com` with subject/body in allay voice and a plain-text part.
6. S1.5.AC6 — Turning `comment.new` × EMAIL OFF → next fan-out creates no email row for `comment.new` (T-UNIT).
7. S1.5.AC7 — A failing deliverer (mocked 500) leaves the row `pending` with `attempts+1` and `error`; it is retried after the 04 §3.7 N1 backoff (5/10/20/40/80 min) up to 5 attempts, then `status='failed'` (T-ACT-30); an unset `RESEND_API_KEY` marks email rows `failed` with `error='not_configured'` (T-ACT-72).
8. S1.5.AC8 — >5 pending rows for one channel → one digest message, all rows marked sent (T-ACT-31).
9. S1.5.AC9 — A `syncModrinth` (or `syncCurseforge`) list failure (mock 500s) writes exactly one `sync.failed` per failure episode (04 J-F edge rule; T-ACT-74); a source with no `ok=true` run for 6 h yields exactly one `sync.stale` event per 6 h from `notifyFanOut` F0 (T-ACT-32); 00-O-2 DECIDED.
10. S1.5.AC10 — Email templates render in `pnpm email dev` for all four; visual matches `DESIGN.md` §12.1 rules (0 radius, 2 px solid borders, one button, wordmark PNG, explicit backgrounds); plain-text version exists per template.
11. S1.5.AC11 — Ko-fi page name saved to `site_settings.kofi_page` (regex 04 §1.3); webhook pill reads NOT SET; Moderation radios switch `site_settings.moderation_mode` and the `comments_closed_default` toggle saves via `updateSettings` → toast "Saved."; Moderators table: Make mod / Remove / add by handle call `setUserRole` and update `profiles.role`; a moderator calling `setUserRole` gets `forbidden` (T-ACT-66); an admin cannot demote self / the last admin (04 §1.3); the Discord recipient row stores the webhook URL as `address`, shown masked (T-ACT-29).
12. S1.5.AC12 — Cron route: 401 without `CRON_SECRET`; idempotent (running twice sends nothing twice — T-UNIT on status transitions).
13. S1.5.AC13 — Client bundle contains no `RESEND_API_KEY` or webhook URL; `notification_events`/`recipients` are admin-read only (T-RLS).

**Tests required:** 05 §8 row S1.5 — T-RLS-94..101 (`notification_recipients`/`notification_matrix`, created here), 90..93 (re-run), 12..14 (settings update), 132 (re-run after `updateSettings`); T-ACT-25..33 (notify route, fan-out/digest/backoff/stale, settings + webhook masking), 66 (`setUserRole`), 72 (`not_configured`), 74 (`sync.failed` edge, S1.2 jobs); T-ADP-17..19; T-UNIT-3, 25, 26, 27, 28 (templates HTML + text), 41 (`matrixDiff`), 43 (email hex parity); T-E2E-37; seed SEED-2; COV-4.

**Gates required:** all seven; `design-fidelity-reviewer` also covers `emails/`; `security-reviewer` focus: secrets masking, admin-only route.

**Demo script**
1. As admin open `/admin/settings` → paste Discord webhook → Test → ✔ in Discord.
2. Add an admin email chip → SAVE → "Saved."
3. Post a comment as a user → wait ≤5 min (or hit `/api/cron/notify`) → Discord embed + email arrive.
4. Turn Held × DISCORD OFF → SAVE → trigger a held comment → email only.
5. Force a Modrinth failure locally → `sync.failed` email "The allay came back empty-handed."

**Risks / unknowns:** `DISCORD_WEBHOOK_URL` and Oliver's server not yet confirmed (setup to-do) — Test button proves it when available; allay pixel render pending (Q44) — ship with a neutral placeholder until the asset lands (ADR-0002 #25; asset-only PR later); Reply-To `allay@odsens.com` depends on inbound forwarding (S1.10 DNS) — set `Reply-To` only after that to-do is done (record in PR).

---

### S1.6 — Videos

**Goal:** the YouTube channel on the site — hourly sync, `/videos` with click-to-load facades, Up next, Shorts row, and Latest videos on Home.

**Depends on:** S0 (registry) **and S1.5** — this plan sequences S1.6 after S1.5 (§1.4 tag order), so `syncYoutube` emits `sync.failed` through `lib/notify/emit.ts` from its first merge (04 J-F) and `notifyFanOut` F0 covers source `youtube` (04 J-S). No conditional path.

**Scope IN**
- Table: `videos` (per `docs/data-model.md` §2.3; `is_short` = duration ≤ 60 s or `#shorts` in title/description — ADR-0002 #67, refine only via an ADR with slug `shorts-detection`; live videos excluded — ADR-0002 #77); RLS: published/not hidden to all; admin all.
- Adapter `lib/adapters/youtube.ts`: RSS (`YOUTUBE_CHANNEL_ID`) for cheap new-video detection; Data API `playlistItems` (uploads playlist) + `videos` for duration/stats; quota budget logged; 10 s timeout, retry ≤3.
- Job `syncYoutube` (04 §3.3: upsert by `youtube_id`, never delete, `sync_runs`, `revalidateTag('videos')`, `sync.failed` via the S1.5 runner; no `YOUTUBE_API_KEY` → RSS-only degraded run, T-ACT-71); route `/api/cron/sync-youtube` (04 §6 `27 * * * *`, `maxDuration` 300) in `vercel.json`.
- Public: `/videos` (big `VideoFacade` player — nothing from YouTube loads until click, `youtube-nocookie.com` embed; play-block sizes 88 hero/card, 44 upnext, 56 short — ADR-0002 #58; Bungee title, view/date meta, blurb; `UpNextList` rows = `VideoFacade variant=upnext` (ADR-0002 #49), selected = `--indigo-lift` outline; `VideoCard` long-form grid below on phone; `ShortsRow` 9:16 104 px gold duration chip, horizontal scroll on phone; empty state §11.7; replaces the S0 placeholder); Home "Latest videos" 2-up beside "Find me" list (Modrinth / CurseForge / YouTube) per §6.1.
- Admin: hide/unhide a video via action `updateVideo` (`lib/actions/videos.ts`, admin — ADR-0002 C7; input `{youtube_id, hidden?, is_short?}`) triggered from a videos list on the `/admin` dashboard — **no `/admin/videos` route** (ADR-0002 #20; 00-O-5 DECIDED).

**Scope OUT**
- No comments on videos (ADR-0002 C21). No mentions (S1.8). No stats snapshot (S1.9). No custom `video_play` analytics event (S1.9).

**Spec traceability:** `docs/spec.md` §3 YouTube, §5 Videos, Home; `docs/platform-audit.md` YouTube; `docs/data-model.md` §2.3, §5 YouTube row; Q30; `DESIGN.md` §6.1 (Latest videos), §6.4, §11.1 (Video facade), §11.5, §11.7; `docs/design-review.md` #19 (nocookie + facades).

**Engineering docs implemented:** 01 §13 (embeds, INV-59 excluded); 02 §1.1 (`/videos`), §1.4 (`/api/cron/sync-youtube`), §2.1 item 4 (Latest videos + Find me), §8 row S1.6; 03 §2.6 (Videos incl. `VideoCard`); 04 §3.3, §4 (youtube adapter), §5.3, §6 row youtube, §1.8 (`updateVideo`); 05 §8 row S1.6.

**Acceptance criteria**
1. S1.6.AC1 — Authorized `/api/cron/sync-youtube` upserts all channel uploads (21 at spec time) with duration + view counts; second run is idempotent; `sync_runs` row written; 401 without secret.
2. S1.6.AC2 — `/videos` initial load makes **zero** requests to any youtube/google host (network log); clicking the facade loads `youtube-nocookie.com/embed/<id>`.
3. S1.6.AC3 — Facade matches §11.1: thumbnail + scrim, 88 px indigo play block with white triangle, duration chip bottom-right (Silkscreen ≥11 px), `CLICK TO LOAD YOUTUBE` chip bottom-left.
4. S1.6.AC4 — `UpNextList` selection swaps the main player and moves the `--indigo-lift` outline; keyboard reachable with the gold focus ring.
5. S1.6.AC5 — Shorts appear only in `ShortsRow` (9:16, gold duration chip), never in the long-form grid; a video with duration ≤60 s or `#shorts` is `is_short=true` (T-ADP).
6. S1.6.AC6 — Home shows the two newest non-hidden, non-short videos as facades beside the Find me list.
7. S1.6.AC7 — Hidden video (`hidden=true` via `updateVideo` from the `/admin` dashboard) never renders publicly; `updateVideo` as moderator/user → `forbidden` (T-ACT-68).
8. S1.6.AC8 — Empty state "NO VIDEOS YET / They'll show up here when they exist." + channel link when the table is empty (T-E2E with empty seed).
9. S1.6.AC9 — Data API calls per sync ≤ documented budget (log line with units) and the key is server-only (bundle grep).
10. S1.6.AC10 — `/videos` ISR with tag `videos`; axe zero serious/critical at 1280 + 390; CLS < 0.1 (facade has fixed aspect box).
11. S1.6.AC11 — A forced `syncYoutube` list failure writes one `sync.failed` event (04 J-F) and the S1.5 pipeline delivers it.

**Tests required:** 05 §8 row S1.6 — T-RLS-48..52; T-ACT-33 (youtube route), 53, 68 (`updateVideo`), 71 (youtube no-key); T-ADP-9..13 (RSS / Data API / shorts / mapping / quota); T-UNIT-12, 29; T-E2E-1 (Latest videos), 6, 47 (empty state); seed SEED-11.

**Gates required:** all seven; `security-reviewer` focus: embeds (nocookie, CSP frame-src), key not in bundle.

**Demo script**
1. Trigger `/api/cron/sync-youtube` → open `/videos`.
2. Note network panel: no YouTube requests. Click play → player loads.
3. Click an Up next item → swaps. Scroll to Shorts row.
4. Home → Latest videos 2-up.

**Risks / unknowns:** Shorts detection heuristic accuracy (ADR-0002 #67; ADR slug `shorts-detection`, number per 06 ADR-N3, only if refined); YouTube quota if `search` were used — use `playlistItems` (uploads) instead; thumbnails hosts allow-list for `next/image`.

---

### S1.7 — Skins + Art

**Goal:** Oliver's skins (3D-rendered) and art (natural-aspect masonry) hosted on the site with admin add/edit and uploads.

**Depends on:** S1.1 (registry) **and S1.3** (plan order — `/api/download/[fileId]` + `lib/files.ts resolveDownloadable`, `UploadWell`, the two-phase upload pattern and `ExclusiveBadge` come from S1.3; `Table`/`Lightbox` from S1.2; see §7).

**Scope IN**
- Tables: `skins`, `art` (per `docs/data-model.md` §2.4); buckets `skins` (public-read; 64×64 PNG ≤64 KB textures; cached bust renders ≤512 KB), `art` (public-read; ≤10 MB); RLS published to all, admin all; storage policies service-role only (01 INV-33) — skin textures travel inline in the action (≤64 KB, 04 SC-18), art images use the 04 §1.4.5 two-phase signed-upload flow.
- Actions (admin — ADR-0002 C7; 04 §1.5; `lib/actions/{skins,art}.ts`): `createSkin`, `updateSkin` (name, description_md, texture upload with 64×64 PNG validation, `model classic|slim`, `is_exclusive`, status, sort_order), `createArt`, `updateArt` (title, kind `avatar|thumbnail|icon|render|other`, image via two-phase, width/height computed server-side, year, credit, downloadable, status, sort_order).
- Job: `renderSkinBust` (`lib/skins/render.ts`: `skinview3d` in headless WebGL via `gl` — ADR-0002 C22 / 00-O-14 DECIDED; native dependency → dependency ADR in this PR; on skin insert/update from the server action → `skins.render_bust_path`; fallback: client-side render cached on first view); `scripts/render-skins.mjs` for bulk (`add-content` use; idempotent — T-UNIT-45).
- Public: `/skins` (§6.5: big live `SkinViewer3D` panel (client, lazy-loaded skinview3d) with spin / walk / front-back controls; 4-up `SkinCard` grid of rendered busts in 3:4 slots with the 64×64 source pinned small at integer scale `image-rendering: pixelated`; name + description + DOWNLOAD PNG + Slim toggle under the viewer; selected card `--indigo-lift` outline; `ExclusiveBadge` when `is_exclusive`; empty state §11.7); `/art` (§6.6: filter row all / avatars / thumbnails / icons; `ArtMasonry` column-flow, natural aspect, 18 px gutter, 4 cols desktop / 2 phone / 1 under 480; `ArtCard`; `Lightbox` with title, year, optional download; empty state).
- Admin: `/admin/skins`, `/admin/art` (add/edit forms with `UploadWell`, `Table` with status pills, reorder; moderators read-only per 02 §1.3).
- Skin DOWNLOAD PNG → `/api/download/[fileId]` with kind `skin` (`lib/files.ts resolveDownloadable`) → RPC `record_skin_download` increments `skins.downloads` → 302 to the public texture object with a download filename (ADR-0002 C8; 00-O-17 DECIDED); RPC `record_skin_download(uuid)` created here.

**Scope OUT**
- No comments on skins/art (ADR-0002 C21). No hero 3D skin on Home (design chose the featured-project hero; Q31). No stats (S1.9). No bulk `add-content` skill (S1.10 writes Oliver's skills).

**Spec traceability:** `docs/spec.md` §5 Skins, Art, Admin Skins/Art; Q4, Q37; `docs/platform-audit.md` (skins, Mojang); `docs/data-model.md` §2.4, §3 (`skins`, `art`), §5 "Skin renders"; `DESIGN.md` §4 (pixelated), §6.5, §6.6, §10 (assets), §11.7.

**Engineering docs implemented:** 01 §11 (uploads), §12 (download route kind `skin`); 02 §1.1 (`/skins`, `/art`), §1.3 (`/admin/skins`, `/admin/art`), §2.9 (kind `skin`), §8 row S1.7; 03 §2.7 (Skins/Art), `Lightbox` reuse (§2.3); 04 §1.4.5, §1.5 (`createSkin`/`updateSkin`, `createArt`/`updateArt`), §2.3 D2 (kind `skin`), §3.8 (`renderSkinBust`); 05 §8 row S1.7.

**Acceptance criteria**
1. S1.7.AC1 — Admin uploads a 64×64 PNG → skin created as draft; a 128×128 or JPEG is rejected with the plain error; publish → appears on `/skins`.
2. S1.7.AC2 — `/skins` main panel is a live 3D model of the selected skin (skinview3d) — never a flat texture and never a profile picture; controls spin / walk / front-back work; `prefers-reduced-motion` stops idle spin.
3. S1.7.AC3 — Grid slots show rendered busts (from `render_bust_path`, or client-render fallback if null) in 3:4 with the source PNG pinned small at integer scale with `image-rendering: pixelated`.
4. S1.7.AC4 — DOWNLOAD PNG goes through `/api/download/[fileId]` kind `skin`: 302 to the public texture object with a download filename, `skins.downloads` +1 per request via `record_skin_download`, draft skin → 404, rate limit → 429 (ADR-0002 C8; T-ACT-76, T-RLS-129); Slim toggle switches the model.
5. S1.7.AC5 — skinview3d is lazy-loaded (`/skins` first-load JS excludes it until the viewer mounts; `next build` route table + `frontend-reviewer`).
6. S1.7.AC6 — `/art` masonry renders each image at natural aspect (`height:auto`, no crop); filter row filters by `kind`; lightbox shows title, year, download only when `downloadable`.
7. S1.7.AC7 — Art upload >10 MB rejected with the number; accepted image records `width/height`.
8. S1.7.AC8 — Empty states: "NO SKINS YET / Working on it. Check the projects meanwhile." and "NO ART HERE YET / Nothing in this filter. Try \"all\"."
9. S1.7.AC9 — RLS: anon/user cannot mutate `skins`/`art`; drafts invisible publicly; no `insert` policy on `storage.objects` for `anon`/`authenticated` (uploads go through the actions; art via signed upload URLs minted server-side, 04 §1.4.5); `createSkin`/`createArt` as moderator → `forbidden` (T-ACT-57/60 mod = denied).
10. S1.7.AC10 — `ExclusiveBadge` on exclusive skins; alt text on every skin/art image; axe zero serious/critical at 1280 + 390 on `/skins`, `/art`, admin forms.
11. S1.7.AC11 — `scripts/render-skins.mjs` renders busts for all skins missing `render_bust_path` (idempotent — T-UNIT-45).

**Tests required:** 05 §8 row S1.7 — T-RLS-53..62, 121..122, 129 (`record_skin_download`); T-ACT-56..61 (bust render, dimensions/type/size), 73 (art two-phase), 76 (skin download); T-UNIT-17 (all), 18 (`skin`, `art`), 19, 45 (`render-skins.mjs` idempotency); T-E2E-7, 8, 9, 38; seed SEED-7, 8, 13.

**Gates required:** all seven; `security-reviewer` focus: uploads (images re-encode/type sniff); `frontend-reviewer` focus: lazy skinview3d bundle.

**Demo script**
1. `/admin/skins` → upload `assets/brand/skins/skin-*.png` (one) → publish.
2. `/skins` → spin it, walk, flip; toggle Slim; DOWNLOAD PNG.
3. `/admin/art` → upload two pieces of different aspect → publish.
4. `/art` → masonry with natural sizes; filter avatars; open lightbox.

**Risks / unknowns:** headless bust rendering on Vercel serverless (`gl` native dep — dependency ADR in this PR per ADR-0002 C22) — fallback is client render + cache; WebGL in Playwright CI (use software GL flag or assert fallback path); skinview3d bundle size (~150 KB gz) exceeds the 50 KB stop-and-ask threshold — pre-approved by `docs/framework-decision.md` (lazy-load); record it in the PR `## Bundle` section (§1.3).

---

### S1.8 — Seen on

**Goal:** third-party coverage curated by Oliver — paste a URL, auto-fetch metadata, publish; shown on project detail, Home, and `/seen-on`, with hourly view-count refresh.

**Depends on:** S1.2, S1.6.

**Scope IN**
- Table: `mentions` (per `docs/data-model.md` §2.3b; `status draft|suggested|published|hidden`, `source manual|auto`, `featured`, `sort_order`, `view_count`); RLS published to all, drafts/suggested admin only.
- Adapters: YouTube oEmbed + `videoIdFromUrl` live in `lib/adapters/youtube.ts` (`oembed`, Data API `videos` for id + views); `lib/adapters/oembed.ts` = `detectPlatform`, `fetchOpenGraph` (generic Open Graph fallback for tiktok/twitch/reddit/article/other), `assertPublicHost` (http(s) only, no private IPs, 10 s timeout) — names per registry / 04 §4.
- Actions (**admin** — ADR-0002 C7; moderators see `/admin/mentions` read-only; `lib/actions/mentions.ts`): `fetchMentionPreview` (paste URL → metadata → `MentionPreview`), `createMention` (assign `project_id` or null = "About OddSense generally"; publish), `updateMention` (feature/hide/reorder/reassign).
- Job `refreshMentions` (04 §3.4: hourly; YouTube `videos?id=…` batched 50/req → `view_count`; `sync_runs` source `mentions`; on failure emits `sync.failed` through the S1.5 runner — 04 J-F; `sync.stale` for `mentions` is emitted by `notifyFanOut` F0 only when `YOUTUBE_API_KEY` is set and ≥1 YouTube mention exists — 04 J-S); route `/api/cron/refresh-mentions` (04 §6 `37 * * * *`, `maxDuration` 300) in `vercel.json`. Daily reach snapshot lands in S1.9's `snapshotStats` (`metric='reach'`).
- Public: `SeenOnRow` on `/projects/[slug]` between VERSIONS & FILES and COMMENTS (title + count, 2-up `MentionCard`; **renders nothing when the project has no mentions**); Home `InTheWildStrip` after Featured (3–4 featured mentions + `ReachLine` + "All mentions →"; hidden when none); `/seen-on` (three `StatTile`s for reach totals, `FilterBar` ALL + platform counts + project `Select`, 3-up grid newest first with footer strip type badge + project link, general mentions tagged with the ODSENS wordmark chip; 1-up phone; filter yielding none → `EmptyState` "NOTHING HERE / Try another filter." — ADR-0002 #62; replaces the S0 placeholder); `Footer` second dry line "Creators featuring the mods aren't affiliated with odsens." added site-wide (registry S1.8; 02 RP-13; DESIGN §12.2).
- `MentionCard`: YouTube → inline facade→player + `--indigo-lift` outline + "on YouTube ↗" ghost; other platforms link out with ↗ chip worded per 03 V-04 (`WATCH ON <PLATFORM>` for video platforms, `READ ON <SITE>` for article, `SEE ON REDDIT`, `OPEN ↗` fallback — ADR-0002 #21; 00-O-6 DECIDED); non-YouTube thumbnails are never fetched remotely — `PlatformMark` placeholder instead (ADR-0002 #33); official platform marks (24 px) — neutral placeholders until Oliver's asset PR (ADR-0002 #25).
- Admin `/admin/mentions`: paste URL → preview card → assign → PUBLISH; `Table` with FEATURED / LIVE / HIDDEN worded tags, ⠿ drag-reorder (featured order feeds Home), Feature/Hide; **Suggested tab UI stub** (empty state, no auto-discovery job).

**Scope OUT**
- No YouTube search / auto-suggest cron (S2.4 / v1.5). No `mention.suggested` events. No comments on mentions. No stats snapshot (S1.9 adds `reach`).

**Spec traceability:** `docs/spec.md` §5 Seen on; Q41, Q44; `docs/data-model.md` §2.3b, §5 "Mentions refresh"; `DESIGN.md` §12.1 (Mention card, Reach line), §12.2 (four surfaces, nav, footer), §11.1 (Stat tile, Video facade).

**Engineering docs implemented:** 01 §13 (third-party marks); 02 §1.1 (`/seen-on`), §1.3 (`/admin/mentions`), §1.4 (`/api/cron/refresh-mentions`), §2.1 item 3, §2.3 SEEN ON, §2.6, §8 row S1.8; 03 §2.1 `Footer` line 2, §2.8 (Seen on); 04 §1.6, §3.4, §4 (youtube `oembed`/`videoIdFromUrl`, oembed adapter, SSRF rules), §5.4, §6 row mentions; 05 §8 row S1.8.

**Acceptance criteria**
1. S1.8.AC1 — Admin pastes a YouTube URL → preview shows thumb, title, creator, views, date; pastes a Reddit/article URL → OG preview; a private-IP or non-http URL is rejected server-side (T-ACT).
2. S1.8.AC2 — Assign to a project → PUBLISH → the mention appears in `SeenOnRow` on that project's detail page (2-up cards, count in Silkscreen) and on `/seen-on`.
3. S1.8.AC3 — A project with zero mentions renders no SEEN ON section at all; Home renders no IN THE WILD strip when no mention is featured (no empty state, per §12.1).
4. S1.8.AC4 — Feature 3 mentions → Home strip shows them in `sort_order`, `ReachLine` reads e.g. "1.2M VIEWS · 6 VIDEOS · 4 CREATORS" (numbers computed from published mentions), "All mentions →" links `/seen-on`.
5. S1.8.AC5 — YouTube `MentionCard` click loads the inline player (nocookie), takes the `--indigo-lift` outline, shows "on YouTube ↗"; TikTok/Twitch/Reddit/article cards link out with ↗ + the 03 V-04 chip wording (`WATCH ON <PLATFORM>` / `READ ON <SITE>` / `SEE ON REDDIT` / `OPEN ↗` — ADR-0002 #21) and show a `PlatformMark` placeholder instead of a remote thumbnail (ADR-0002 #33).
6. S1.8.AC6 — `/seen-on`: three stat tiles (views, videos/mentions, creators), filter by platform with counts, project select; general mentions carry the ODSENS wordmark chip; newest first.
7. S1.8.AC7 — `/api/cron/refresh-mentions` updates `view_count` for YouTube mentions in batches of ≤50 ids per request; idempotent; `sync_runs` row (source `mentions`); 401 without secret; a forced Data API list failure writes one `sync.failed` event (04 J-F) delivered by the S1.5 pipeline.
8. S1.8.AC8 — Hidden mentions vanish from all three public surfaces; drag-reorder persists `sort_order`.
9. S1.8.AC9 — Footer shows the second dry line "Creators featuring the mods aren't affiliated with odsens." on every page from this slice on (T-E2E-1 footer line).
10. S1.8.AC10 — Suggested tab renders (empty state) with Approve/Dismiss disabled or absent; no job inserts `suggested` rows.
11. S1.8.AC11 — Creator display = public channel name + link only (no other creator data stored beyond `creator_name/creator_url`).
12. S1.8.AC12 — axe zero serious/critical on `/seen-on`, a project with mentions, `/admin/mentions` at 1280 + 390.

**Tests required:** 05 §8 row S1.8 — T-RLS-102..106; T-ACT-33 (refresh-mentions route), 54 (batching), 62..64 (SSRF; admin only per ADR-0002 C7), 71 (mentions no-key); T-ADP-14..16; T-UNIT-9; T-E2E-1 (IN THE WILD + footer line), 3/5 (SEEN ON row), 10, 39; seed SEED-10; fixture server :4010 (ADR-0002 #73).

**Gates required:** all seven; `security-reviewer` focus: server-side URL fetch (SSRF), admin actions; `backend-reviewer` focus: batching, quota.

**Demo script**
1. `/admin/mentions` → paste a YouTube URL about a mod → preview → assign → PUBLISH.
2. Open that project → SEEN ON row; click → inline player.
3. Feature it + two more → Home IN THE WILD strip + reach line.
4. `/seen-on` → filter by YouTube, pick a project.
5. Hide one → gone everywhere.

**Risks / unknowns:** OG fetch against bot-blocking hosts (Reddit/TikTok may 403) — preview falls back to manual fields (title/creator editable in admin; note in 04); official platform marks (Q44) — neutral placeholder until supplied (ADR-0002 #25); drag-reorder a11y (provide move up/down buttons too — `frontend-reviewer`).

---

### S1.9 — Stats + Support

**Goal:** daily stats snapshots with an admin Stats page, and the Support page (Ko-fi wrapper) + site-wide floating support button + Vercel custom events.

**Depends on:** S1.2, S1.4.

**Scope IN**
- Table `stats_daily` (PK `(day, metric, source, entity_type, entity_id)`; site rows use the 04 §3.5 sentinel `entity_id`); job `snapshotStats` daily 03:00 UTC per 04 §3.5 (metrics `downloads` per source per project + site totals, `direct_downloads_day` per project for day − 1 (04 §3.5 (e)), `views`/`subs` youtube, `comments`/`comments_held`, `likes`, `users` = **aggregate count only** — ADR-0002 #68, `reach` from mentions, `mentions`, `tips/kofi` = 0 in v1; aggregates `project_downloads`, purges rows >90 days (`purge_project_downloads`) and `rate_limit_hits` (`purge_rate_limit_hits`), deletes orphan upload objects >24 h (U1 — moved here from S1.3.AC11, ADR-0002 #80); date-idempotent `on conflict do update`; `sync.failed` via the S1.5 runner on failure); route `/api/cron/stats-snapshot` (04 §6 `0 3 * * *`, `maxDuration` 300) in `vercel.json`.
- Admin `/admin/stats` (§11.3 #16): four `StatTile`s (downloads 7 days, downloads all time, comments with held count, tips 30 days — shows `0` in v1 per 04 §3.5 (f)), `FlatBarChart` last 30 days stacked by source with fixed colours (Modrinth `--emerald`, CurseForge `--orange`, direct `--indigo-lift`) + swatch **and** word, phone 15 bars (two days each) with the label saying so, honest line "Modrinth and CurseForge report their own counts. Direct downloads are the ones we serve."; a tile whose window has no snapshot yet shows `0` with the context text "No data yet." (ADR-0002 #29; 00-O-18 DECIDED).
- Public `/support` (§6.7 + §11.4 + 02 §2.7; ISR 600 with tag `settings`, reads `site_settings_public` — ADR-0002 C19; replaces the S0 placeholder): gold hatched `AmountPicker` ($1 / $3 / $5 / Other, $3 preselected) + single CONTINUE ON KO-FI button that **mounts the `KofiPanelSlot` iframe in place** (712/620 px — ADR-0002 #50; no new tab), plus an "on Ko-fi ↗" ghost link that opens the page; the iframe renders for **`site_settings.kofi_page`** (DB is the source of truth; env `KOFI_PAGE` seeds the S1.1 row only — ADR-0002 C19; 00-O-19 DECIDED); `kofi_page` empty → picker + button disabled with the mute line "Tips open soon.", slot hidden; "What it pays for" slab; `Leaderboard` block in **empty state** ("NOBODY YET / Be first." + how-to line) — no data source yet. `TipPanel` on project detail (placeholder since S1.2) gets its final §7-voice copy linking `/support`; Home compact `TipPanel` beside Latest videos / Find me is **built here** (02 §2.1 item 4; static `S` component per 03, always rendered from S1.9 — the `kofi_page`-empty behaviour applies to `/support` only, 04 §5.7).
- `FloatingSupportButton` (mounted in `app/(public)/layout.tsx`; gold, ♥ SUPPORT, hides on scroll-down, returns on scroll-up; 52 px square on phones) on every public route **except `/support`**; not on `/welcome` or under `/admin/*` (02 RP-15); e2e T-E2E-49 (ADR-0002 #80).
- Vercel Analytics custom events (`lib/analytics.ts` `trackEvent` allowlist via 03 `TrackedLink`; ADR-0002 C12 — only these four in v1): `download {project, source, from}` · `tip_click {amount?, from}` · `video_play {youtube_id, kind}` · `sign_in {from}` (names per 01 INV-59, payloads per 04 §5.6); dashboard toggle happens in S1.10.

**Scope OUT**
- No Ko-fi webhook, `kofi_events`, `supporters`, live leaderboard (S2.1). No Web Analytics dashboard enablement / Speed Insights component (S1.10). No Sentry (S1.10). No stats CLI skill (S1.10 writes `stats`).

**Spec traceability:** `docs/spec.md` §4 goal 5 (Support), §7 Analytics; `docs/analytics-options.md` (#3, #4, #5); `docs/data-model.md` §2.9, §5 "Stats snapshot", §2.8 (P2 refs); `docs/platform-audit.md` Ko-fi; Q12, Q33; `DESIGN.md` §5 (Floating support button), §6.7, §11.1 (Stat tile, Flat bar chart), §11.3 #16, §11.4, §12.4 (leaderboard incl. empty state).

**Engineering docs implemented:** 01 §13 (INV-59 analytics), §20 (Ko-fi frame-src); 02 §1.1 (`/support`), §1.3 (`/admin/stats`), §1.4 (`/api/cron/stats-snapshot`), §2.1 item 4 (compact `TipPanel`), §2.7, RP-15, §8 row S1.9; 03 §2.1 (`FloatingSupportButton`), §2.2 (`StatTile`, `FlatBarChart`, `TrackedLink`), §2.3 (`TipPanel`), §2.9 (Support); 04 §3.5, §5.6 (analytics payloads), §5.7 (Ko-fi), §6 row stats; 05 §8 row S1.9.

**Acceptance criteria**
1. S1.9.AC1 — Authorized `/api/cron/stats-snapshot` writes one row per (metric, source, entity) for today; running twice yields the same rows (upsert); `project_downloads` older than 90 days are purged (T-ACT-55 with seeded old rows); an uncommitted upload object older than 24 h is removed and a committed one kept (U1 — T-ACT-75); `users` metric is a single aggregate count (ADR-0002 #68); 401 without secret.
2. S1.9.AC2 — `/admin/stats` (role ≥ moderator) shows four tiles with numbers derived from `stats_daily` deltas (tips tile = `0`); the chart stacks three fixed source colours with swatch + word legend; phone shows 15 bars and says so.
3. S1.9.AC3 — Chart is hand-rolled SVG (no chart library in `package.json`), 0 radius, no gradients, Silkscreen 11 px axis labels.
4. S1.9.AC4 — `/support`: picker preselects $3, CONTINUE ON KO-FI mounts the `KofiPanelSlot` iframe in place for `site_settings.kofi_page` (from `site_settings_public`) (amount not passed in v1 — 04 §5.7, ADR-0002 #50) — no new tab (ADR-0002 C19); the "on Ko-fi ↗" ghost link opens the page; the Ko-fi iframe loads only on `/support` (CSP frame-src) and only after the click; with `kofi_page` empty the picker/button are disabled and the mute line "Tips open soon." shows; editing `kofi_page` in Settings updates `/support` after `revalidateTag('settings')` (T-E2E-11).
5. S1.9.AC5 — Leaderboard block renders the empty state "NOBODY YET / Be first." + the how-to line from §12.4; no amounts, no rows.
6. S1.9.AC6 — `FloatingSupportButton` on every public page except `/support`; absent on `/welcome` and under `/admin/*` (02 RP-15); hides on scroll-down, returns on scroll-up; phone = 52 px gold square with heart; links to `/support`; 44 px+ target; `prefers-reduced-motion` drops the transform.
7. S1.9.AC7 — `TipPanel` on project detail and the Home compact panel (new here) link to `/support` (copy from §7 voice, no begging); the Home panel is always rendered (02 §2.1 item 4).
8. S1.9.AC8 — Custom events fire (`track` calls observed with `@vercel/analytics` stubbed): `download {project, source, from}` on a download button, `tip_click {amount?, from}` on the picker button, `video_play {youtube_id, kind}` on a facade click, `sign_in {from}` on Sign in; payload keys exactly as ADR-0002 C12 / 04 §5.6; nothing else is accepted by `trackEvent`; no PII in payloads (T-UNIT-38 + custom-events smoke inside T-E2E-16/31/6/49).
9. S1.9.AC9 — RLS: `stats_daily` admin-read, service-role write.
10. S1.9.AC10 — axe zero serious/critical on `/support`, `/admin/stats` at 1280 + 390; chart has a text alternative (table or `aria-label` summary).
11. S1.9.AC11 — `FloatingSupportButton` e2e (T-E2E-49 — 05's current text must be rewritten to this behaviour, DESIGN.md §5 / 03 `FloatingSupportButton` / 04 §5.6 `from:'floating'`; see §7 Review notes): present on `/` and a project detail, absent on `/support`, `/welcome`, `/admin/*`; hides on scroll-down and returns on scroll-up; 52 px square at 390; `TipPanel` on detail and the Home compact panel link to `/support` (always rendered; only `/support` reacts to an empty `kofi_page`, 04 §5.7).

**Tests required:** 05 §8 row S1.9 — T-RLS-107..110; T-ACT-33 (stats route), 55 (snapshot idempotency/purge), 75 (orphan cleanup); T-UNIT-38 (`trackEvent` allowlist), 42 (`lib/stats.ts` bucketing); T-E2E-11, 40, 49 (`FloatingSupportButton`/`TipPanel`); custom-events smoke inside T-E2E-16/31/6/49 (`window.va` stub sees `sign_in`, `download`, `tip_click`, `video_play`); seed SEED-12.

**Gates required:** all seven; `security-reviewer` focus: Ko-fi iframe CSP, admin route; `frontend-reviewer` focus: floating button scroll listener perf, chart a11y.

**Demo script**
1. Hit `/api/cron/stats-snapshot` twice → `/admin/stats` shows tiles + chart.
2. Resize to 390 → 15 bars + label.
3. `/support` → pick $3 → CONTINUE ON KO-FI → overlay opens (stop before paying).
4. Scroll a project page down/up → floating button hides/returns.

**Risks / unknowns:** Ko-fi account/page not yet created (setup to-do; `KOFI_PAGE=oddsense` unconfirmed) — build against a test page name and record; Ko-fi preset-amount behaviour unverified (`docs/design-review.md` #13; verify the amount param once the account exists — ADR-0002 #50); first days of `stats_daily` have no deltas (tiles show `0` + "No data yet.", ADR-0002 #29).

---

### S1.10 — Launch

**Goal:** odsens.com live on production with real content, monitoring, Oliver's helper skills, and the launch verification pass; tag `v1.0.0`.

**Depends on:** S1.1–S1.9 (all merged).

**Scope IN**
- Supabase Branching + Vercel integration verified end-to-end (branch per PR, migrations promote on merge to `main`; production DB has all migrations; `supabase/config.toml` remote `site_url`/redirects correct).
- DNS cutover: Squarespace DNS → Vercel (A `76.76.21.21` / CNAME `cname.vercel-dns.com`); `www` redirect → apex; Resend DMARC `TXT _dmarc` (`p=none`, rua David) + inbound forwarding for `allay@odsens.com` (option (a) per `docs/questions.md`) → set `Reply-To: allay@odsens.com` in `deliver/email.ts`; Google OAuth redirect list includes `https://odsens.com/**`.
- Vercel: Deployment Protection **off for production** only (previews stay Standard); Web Analytics + Speed Insights enabled + components mounted; `vercel.json` cron list = 6 v1 routes verified in the dashboard; env var names complete for production (`.env.example` parity incl. `CURSEFORGE_API_KEY`, `RESEND_API_KEY`, `DISCORD_WEBHOOK_URL`); production `NEXT_PUBLIC_SITE_URL=https://odsens.com`.
- Sentry (server + client, DSN via env `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` — the latter added to the 01 INV-29 allowed browser-var set here, ADR-0002 #79), error boundary reports; `beforeSend` strips `user.email`, `user_metadata`, and request cookies/headers; handles are public and may remain.
- Seed real content: Oliver's skins (`assets/brand/skins/*`) and art (`assets/brand/art/*`, avatar) via `add-content` flow into production as **drafts**; Oliver publishes from admin (stop-and-ask: publishing is human).
- Featured projects + first mentions curated by Oliver (human).
- Oliver's laptop setup per `docs/dev-tooling.md` (repo access, `.env` from David, `pnpm dev`).
- Skills written: `start-here`, `whats-wrong`, `restyle`, `new-feature`, `db-change`, `add-content`, `sync-now`, `write-copy`, `stats`, `upkeep` (specs `docs/site-management-skills.md` §3; boundaries per `docs/skill-handoffs.md`).
- `CLAUDE.md` build-time version (outline in `docs/site-management-skills.md` §6); `docs/spec.md` status → shipped v1; `docs/questions.md` setup list closed.
- `deploy-checker` PASS on production URL; production smoke: home, projects, a detail, download, sign-in round-trip, `/support`, cron routes 401 unauthenticated.
- Tag `v1.0.0`; phase report (`build-phase` step 6).

**Scope OUT**
- No new features. No Phase 2 tables. No "Commissions" nav item (stays hidden). No `/api/og` — static `public/brand/og-default.png` (ADR-0002 #22). No About page (ADR-0002 #30, David confirmed 2026-08-17).

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
12. S1.10.AC12 — Q36 privacy line: the copy on `/privacy` is "Sign-in needs a Google account; Google's age rules apply." (ADR-0002 #24) unless David overrules before launch; David's confirm recorded in the PR.
13. S1.10.AC13 — Tag `v1.0.0` on `main`; `docs/spec.md` revision log entry "v1 shipped"; phase report posted.

**Tests required:** 05 §8 row S1.10 — T-E2E-43, T-E2E-44 on the preview and then production (read-only: home, projects, detail, videos, skins, art, seen-on, support, privacy, 404, cron 401) with axe; T-UNIT-35 (env parity — `.env.example` vs `lib/env.ts`; `deploy-checker` re-runs it against `vercel env ls`); full suite green on `main`; COV-5.

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
| **S2.4** | Suggested mentions | Assisted discovery: daily YouTube search per project title (+ "OddSense") → Suggested queue; never auto-publish. | cron `/api/cron/sync-mentions` → job `syncMentionsSuggested` (registry), inserts `status='suggested'`, `source='auto'`; `mention.suggested` event + matrix row live (email OFF / discord ON default); Suggested tab Approve → preview → PUBLISH / Dismiss. | S1.8, S1.5 | `docs/spec.md` §5 Seen on v1.5, `docs/data-model.md` §2.3b, `docs/notifications.md`, `DESIGN.md` §12.2 |
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

Rule: a cron route ships in the same slice as its job; `vercel.json` never lists a route that does not exist (`deploy-checker` checks 200/401 behaviour). `maxDuration` 300 for sync/stats/refresh routes, 60 for `notify` (ADR-0002 C15); 401 body `{ok:false,error:{code:'unauthorized',message}}` (ADR-0002 C14).

### 4.2 Tables by slice (must match `supabase/migrations/` at each tag)

| Slice | Tables / views / buckets created |
|---|---|
| S0 | helpers `is_admin()`, `is_moderator()`, `updated_at` trigger fn |
| S1.1 | `profiles` (incl. `handle_changed_at`), view `public_profiles`, `site_settings` (all data-model §2.4 columns + `owner_profile_id`), view `site_settings_public`, `rate_limit_hits` (+ RPCs `rate_limit_ok`, `purge_rate_limit_hits`), RPC `check_handle`; bucket `avatars` |
| S1.2 | `projects`, view `projects_public`, `project_versions`, `project_files`, `project_links`, `project_overrides`, `sync_runs` (no buckets) |
| S1.3 | `project_downloads`, RPCs `record_download`, `purge_project_downloads`; buckets `project-files` (private), `project-media` (public-read); `config.toml` `file_size_limit = "100MiB"` |
| S1.4 | `comments` (+ view `comments_public`, trigger `comments_set_status()`, helper `can_comment()`), `comment_likes`, `comment_reports`, `notification_events` |
| S1.5 | `notification_recipients` (+ unique index), `notification_matrix` (seeded) |
| S1.6 | `videos` |
| S1.7 | `skins`, `art`, RPC `record_skin_download`; buckets `skins`, `art` |
| S1.8 | `mentions` |
| S1.9 | `stats_daily` |
| S1.10 | none |

Rule: every table gets RLS + policies in the migration that creates it (`supabase-reviewer`; notification/rate-limit table rows per data-model §4 as amended by ADR-0002 #75); `lib/supabase/types.ts` regenerated in the same PR.

### 4.3 Nav / footer state by slice

| Slice | Nav links live | Footer "Site" links live |
|---|---|---|
| S0 | all five present (`/projects`, `/videos`, `/skins`, `/art`, `/seen-on`) + gold Support button (`/support`); each is a placeholder page (title + "Not yet. Soon.") until its slice ships (ADR-0002 C20; 00-O-8 DECIDED) | Privacy, How comments work (404 until S1.1) |
| S1.2 | Projects | Projects |
| S1.6 | Videos | — |
| S1.7 | Skins, Art | — |
| S1.8 | Seen on | Seen on |
| S1.9 | Support (gold button → real `/support`) | Support |
| S2.2 | Commissions | Custom orders |

---

## 5. Open (proposed defaults; use unless an ADR says otherwise)

IDs are `00-O-n` (cite as "00 §5 00-O-n"). Rows marked DECIDED were settled by the named sibling section or by ADR-0002 and are kept only so cross-references resolve. No rows remain OPEN — every item is DECIDED by the named sibling section or ADR-0002 (00-O-20 was confirmed by David on 2026-08-17).

| # | Item | Proposed default / decision | Owner doc | Status |
|---|---|---|---|---|
| 00-O-1 | Comment / report / like / download rate limits. | `postComment` 5 / min + 50 / day per user; `reportComment` 10 / h; `toggleLike` 60 / min; `/api/download/[fileId]` 30 / min per `ip_hash`. | 04 §5.5 | DECIDED |
| 00-O-2 | Where `sync.stale` is detected. | `notifyFanOut` step F0 (04 J-S): per source with no `ok=true` run in 6 h, once per 6 h. | 04 §3 J-S, §3.6 | DECIDED |
| 00-O-3 | Home hero when no project is featured. | Hero = highest `downloads_total` published project; Featured 4-up = next featured by `featured_order`, else the next four by `downloads_total`; fewer than 4 → render what exists; section omitted only when there are 0 published projects (02 §2.1). | 02 §2.1 | DECIDED |
| 00-O-4 | Comment threads on `/skins`, `/art`, `/videos` in v1 (schema is polymorphic; registry S1.4 lists only project UI). | Not in v1; project-only UI. Schema keeps `target_type`. | ADR-0002 C21 | DECIDED (ADR-0002 C21) |
| 00-O-5 | Admin UI for hiding a video (no `/admin/videos` route in the registry). | Videos list on the `/admin` dashboard calling `updateVideo`; no new route. | ADR-0002 #20 | DECIDED (ADR-0002 #20) |
| 00-O-6 | Link-out chip wording for `article` mentions ("WATCH ON" doesn't fit). | Per 03 V-04: `WATCH ON <PLATFORM>` (video platforms), `READ ON <SITE>` (article), `SEE ON REDDIT`, `OPEN ↗` fallback. | ADR-0002 #21 | DECIDED (ADR-0002 #21) |
| 00-O-7 | `/api/og` (registry says optional). | Not in v1; static `public/brand/og-default.png`. Revisit post-launch. | ADR-0002 #22 | DECIDED (ADR-0002 #22) |
| 00-O-8 | Nav links for not-yet-built sections during S0–S1.8. | Render all five nav items (+ Support button) from S0; each is a **placeholder page** (title + "Not yet. Soon.", DESIGN.md §12.7) until its slice ships — supersedes v0.2's "404 until built". | ADR-0002 C20 | DECIDED (ADR-0002 C20) |
| 00-O-9 | Uploads through Vercel serverless (4.5 MB body cap) for 100 MB project files. | Two-phase signed-upload pattern (04 §1.4.5, SC-18): `begin` mints a signed URL server-side, browser PUTs, `commit` re-validates and writes the row. Baseline per 01 INV-51 v0.2 + ADR-0001 D13 — no further ADR. | 04 §1.4.5 | DECIDED (ADR-0002 C11) |
| 00-O-10 | First admin bootstrap. | `supabase/seed.sql` for local; production: one documented SQL statement setting `profiles.role='admin'` for David's and Oliver's `auth.users.id` after their first sign-in (stop-and-ask logged in PR); roles bootstrapped by SQL until `/admin/settings` ships in S1.5. | ADR-0002 #23 / C2 | DECIDED (ADR-0002 #23) |
| 00-O-11 | Q36 under-13 privacy line. | Wording "Sign-in needs a Google account; Google's age rules apply."; David confirms before S1.10.AC12. | ADR-0002 #24 | DECIDED (ADR-0002 #24) |
| 00-O-12 | Q44 assets (allay render, platform marks). | Ship neutral placeholders; swap in assets when Oliver supplies them (asset-only PR, no ADR). | ADR-0002 #25 | DECIDED (ADR-0002 #25) |
| 00-O-13 | `comment_count` semantics for the first-timer rule. | Counts the author's comments that have ever reached `status='published'`. | 04 §1.2 | DECIDED |
| 00-O-14 | Skin bust render location (serverless WebGL vs. client fallback). | `skinview3d` in headless WebGL via `gl` (native dep → dependency ADR at S1.7); fallback = client render + cache on first view. | ADR-0002 C22 | DECIDED (ADR-0002 C22) |
| 00-O-15 | Handle change after onboarding: `docs/data-model.md` §4 allows `handle` only null→value (or admin), but DESIGN §11.3 #11 (own rename) and spec §9 ("moderators can rename/ban") require changes. | Own rename via `updateProfile` with the service-role client, 1 / 7 days on `profiles.handle_changed_at`; moderator rename via `renameUserHandle` (moderator; S1.4; 04 §1.2). Data-model §4 amended by ADR-0002 (`handle-rename-rls` slug reserved only if S1.1 deviates). | ADR-0002 #27 | DECIDED (ADR-0002 #27) |
| 00-O-16 | Self-serve account deletion + cascade (`deleteAccount`; data-model §4 profiles delete = admin only). | `deleteAccount` (onboarded user, 1 / day): comments → `status='deleted'` (slots stay), own `comment_likes`/`comment_reports` removed, avatar object removed, `auth.admin.deleteUser` (cascades `profiles`); revalidates content tags. Data-model §4 delete row amended by ADR-0002. | ADR-0002 #28 | DECIDED (ADR-0002 #28) |
| 00-O-17 | Skin download counter (`skins.downloads` column exists; `skins` bucket is public-read). | Counter **is** in v1: DOWNLOAD PNG → `/api/download/[fileId]` kind `skin` → RPC `record_skin_download` increments `skins.downloads` (S1.7) — supersedes v0.2's "stays 0". | ADR-0002 C8 | DECIDED (ADR-0002 C8) |
| 00-O-18 | `/admin/stats` tiles before the first `stats_daily` deltas exist. | Show `0` with the context text "No data yet."; never "—". | ADR-0002 #29 | DECIDED (ADR-0002 #29) |
| 00-O-19 | Ko-fi page name source: env `KOFI_PAGE` vs `site_settings.kofi_page`. | DB wins: `/support` (ISR, tag `settings`) reads `site_settings.kofi_page` via view `site_settings_public` (the Home compact `TipPanel` is static and links to `/support`); env `KOFI_PAGE` seeds the S1.1 row only. CONTINUE ON KO-FI mounts the `KofiPanelSlot` iframe in place; "on Ko-fi ↗" ghost link opens the page. | ADR-0002 C19 | DECIDED (ADR-0002 C19) |
| 00-O-20 | About page: `docs/spec.md` §5 lists "About — who OddSense is", but neither the registry route list nor DESIGN.md §6 has one. | Not a v1 route: the Home hero intro strip ("OddSense makes things for Minecraft", 02 §2.1) + footer dry line cover it; spec §5 About struck by the ADR-0002 PR (`keep-docs`). **[DAVID — confirmed 2026-08-17]** per ADR-0002 #30. | ADR-0002 #30 | DECIDED (ADR-0002 #30, David confirmed 2026-08-17) |
| 00-O-21 | Env-required sets differed between 04 SC-16 and 01 §7. | Boot-required = the 8 names in S0.AC5; `SUPABASE_URL`/`SUPABASE_ANON_KEY` pair CLI-only; `CURSEFORGE_MEMBER` removed (unused in v1); everything else optional-with-degradation or required from its slice (registry Env line). | ADR-0002 #18 | DECIDED (ADR-0002 #18) |
| 00-O-22 | Analytics event set and payload keys. | Four names only in v1: `download {project, source, from}` · `tip_click {amount?, from}` · `video_play {youtube_id, kind}` · `sign_in {from}`; no `external_out`. | ADR-0002 C12 | DECIDED (ADR-0002 C12) |
| 00-O-23 | `project-files` cap. | 100 MB; `config.toml` `file_size_limit = "100MiB"` and the `UploadWell` copy in the S1.3 PR. | ADR-0002 #31 | DECIDED (ADR-0002 #31) |

---

## 6. Changelog

| Date | Version | ADR | Change |
|---|---|---|---|
| 2026-08-17 | v0.1 | — | Initial draft. |
| 2026-08-17 | v0.2 | — | Review pass 1: deterministic `sync.*` emission (S1.2/S1.5/S1.6/S1.8/S1.9); `/admin/settings` stub, `deleteAccount`, `setUserRole`, `site_settings` full columns moved to S1.1; middleware never reads role, role-user → 404; content actions admin-only; `project-media` + `uploadProjectMedia` to S1.3 with `/admin/projects/[id]` curate in S1.2; two-phase uploads (04 §1.4.5) adopted; 100 MB cap + `config.toml`; matrix seeding per notifications.md; skin download counter → open; nav 404-until-built; Ko-fi page from DB; FSB per RP-15; analytics events registry row; `HASH_SALT`; PR template `ADRs:` heading; five CI checks; robots/sitemap; changelog section; Open IDs prefixed `00-O-`; cross-references to real section numbers. |
| 2026-08-17 | v0.3 | ADR-0002 | Reconciliation pass: route groups + client seam (C1/C5); `/admin/settings` whole in S1.5, `setUserRole`/`updateSettings` out of S1.1 (C2); client `GoogleSignInButton`, no `/auth/sign-in`, `/auth/callback` per C18 (C3/C18); wrong role → `notFound()` (C4); `site_settings_public` (C6); roles admin/moderator per C7; skin download counter via download route (C8); Discord `address` = webhook (C9); `uploadProjectMedia` S1.3 (C10); two-phase uploads baseline, no ADR (C11); analytics payloads (C12); `HASH_SECRET` HMAC (C13); `ActionResult` shape, GET-only download, 429 JSON (C14/C17); cron `maxDuration` (C15); names/module homes (C16, `renameUserHandle`, `lib/files.ts`, `lib/validation/*`); Ko-fi from DB + iframe in place (C19); placeholder pages (C20); comments = projects only (C21); skin renderer (C22); `rate_limit_hits` in S1.1; OPEN defaults 13–80 applied; test citations re-pointed to 05's real IDs (T-ACT-65..76, T-UNIT-33..45, T-E2E-45..49); §6 folded into `_registry.md`; §5 rows marked DECIDED (00-O-20 About page confirmed by David 2026-08-17 — no rows remain OPEN). Consistency pass (same day): 04 citations `C-nn` → `SC-nn` and stale `04 §11` pointers re-pointed; 02 RP-19/RP-21; `HASH_SECRET` at S1.3 only (S1.1 trigger gap → §7); rate limits counted on 04 §5.5 source tables; `sync.stale` incl. `mentions` per 04 J-S; Featured 4-up per 02 §2.1; Home compact `TipPanel` always rendered; Ko-fi amount not passed (04 §5.7); T-ACT-26 for P2-kind rejection; test lists = 05 §8 (T-RLS-132/133, T-ACT-65 re-run); CI-4 secret list; AC lists in numeric order; empty §6 removed (Changelog → §6, Review notes → §7). Consistency pass 2 (same day, critic + dry-run): `Table`/`Field`/`Toggle` first use = S1.2, `SignInPrompt` → S1.4, `NoteCallout` + `InlineConfirm` in S1.1; download flow `04 §2.3 D1..D7`; `03 §2.2` primitives; `X-Robots-Tag` incl. `/welcome`, `/profile` (01 INV-76); `app/(public)/loading.tsx`; `lib/auth.ts` exports per 04 SC-04; test lists = 05 §8 verbatim (T-E2E-46 S0, T-UNIT-23 S1.1, T-UNIT-24 + T-E2E-42 S1.2, T-E2E-16/31/6/49 S1.9); `rate_limit_hits` scope wording per 04 §5.5; `direct_downloads_day` metric; S1.7 depends on S1.3 (plan order); PR template `## Bundle` section; §7 rows for `HASH_SECRET`, T-E2E-49, compact `TipPanel`, `getSession`, `InlineConfirm`, S1.7 deps. |

---

## 7. Review notes (findings not applied as proposed, with reasons)

| Finding | Resolution |
|---|---|
| Footer second dry line assigned twice (S0 vs S1.8) — proposed fix: keep it in S0. | Kept in **S1.8** instead: `_registry.md` S1.8 one-line scope says "footer line", 02 RP-13 says "second line only once S1.8 ships", 02 §8 S1.8 lists "footer line 2". S0 `Footer` ships the first dry line only. |
| Nav for unbuilt sections — proposed fix offered placeholder pages (00-O-8 default) or 404. | v0.2 chose 404; **superseded by ADR-0002 C20**: placeholder pages (title + "Not yet. Soon.") from S0, per 02 RP-16. |
| S1.5.AC1 "gate/404" — proposed "AdminGate state (INV-31), never a 404 body". | Used **404** (`notFound()`) — confirmed by ADR-0002 C4: signed-in non-moderator → root 404; `AdminGate` is the signed-out state only. Same ruling for S1.1.AC8. |
| Handle change: proposed a `renameHandle`/`moderateProfile` action for mods and an Open item. | Applied as `renameUserHandle` (04's name, ADR-0002 C16) in S1.4 (moderation slice); own rename follows 04 §1.1 (1 / 7 days, ADR-0002 #27). |
| Skin download counter: proposed either a new route or downgrade. | v0.2 downgraded AC4; **superseded by ADR-0002 C8**: counter via the existing `/api/download/[fileId]` with kind `skin` + RPC `record_skin_download` (no new route). |
| S1.6 Depends on: registry says S0. | Added S1.5 as a **plan-order** dependency (S1.6 is tagged v0.7 after S1.5 v0.6) so `sync.failed` emission is unconditional; registry S1.6 row now also lists S1.5 (plan order). |
| Env required set: proposed listing five S0 vars. | Used the eight-variable boot set (05 T-UNIT-16 tests it); the 01 §7 vs 04 SC-16 discrepancy is settled by ADR-0002 #18. |
| `HASH_SECRET` timing vs the S1.1 `auth.users` trigger — v0.3 claimed `HASH_SECRET` exists from S1.1. | Claim removed: ADR-0002 C13, `_registry.md` Env, 04 SC-16 and 05 §8 all place `HASH_SECRET` at **S1.3**. 01 INV-50, 04 SC-17, 05 T-RLS-125 and data-model §2.1 now all say the keyed HMAC (`email_hash = HMAC-SHA256(HASH_SECRET, lower(trim(email)))`) and 05 T-UNIT-23 (`emailHash` part) is listed for S1.1 above. **Genuine gap, not settled here:** the S1.1 Postgres trigger `handle_new_user()` cannot read a Vercel env secret, and `HASH_SECRET` is an S1.3 variable — the key-delivery mechanism to Postgres (DB setting / Vault secret set by the S1.1 migration, or moving `HASH_SECRET` into the S0 boot set) and the S1.1-vs-S1.3 timing need an ADR before S1.1, amending 01/04/05/data-model in the same PR. |
| S1.9.AC11 cites T-E2E-49 for FSB scroll hide/return, `href` `/support`, 52 px phone square. | 05's T-E2E-49 still asserts a `sessionStorage` dismiss control, FSB click → `TipPanel` + `AmountPicker`, `from:'fsb'` and a compact bar at 600–899 px — contradicting DESIGN.md §5, 03 `FloatingSupportButton` (`<a href="/support">`, `data-state hidden/visible`, `data-compact` ≤599 px), 02 RP-15/SM-31 and 04 §5.6 (`from ∈ 'support'\|'tip-panel'\|'floating'\|'nav'`). 00 keeps that behaviour; **05 T-E2E-49 must be rewritten** to: present on `/` and a detail, absent on `/support`/`/welcome`/`/admin/*`; hides on scroll-down, returns on scroll-up; 52 px square at 390; `<a href="/support">`; `track('tip_click', {from:'floating'})`. The "must be rewritten" caveat in S1.9.AC11 is removed once 05 lands that text. |
| Home compact `TipPanel` — 02 §2.1 item 4 / SM-31 / RP-23 say it reads `site_settings_public.kofi_page` and is absent when empty (citing 00 S1.9.AC7 for the opposite). | Kept **always rendered, static, no data** (S1.9 Scope IN, AC7, AC11, 00-O-19): 03 `TipPanel` is `S` with `{compact?}` and no data prop (03 owns components), 04 §5.7 scopes the empty-`kofi_page` behaviour to `/support`. 02 §2.1 item 4, SM-31 and the `settings` tag rationale in RP-23 must be amended to match (Home carries `settings` only if some other reader needs it) — not edited here. |
| `lib/auth.ts` export set — 01 INV-32 says "no `getSession()` export" while 04 SC-04 lists `getSession()` and claims equality with INV-32. | 00 S0 follows **04 SC-04** (04 owns names/shapes): `getUser, getProfile, requireUser, requireOnboarded, requireRole, safeNext` + `getSession` (SSR client only, never for auth decisions). 01 INV-32 must add `getSession()` (its seam rule already permits `auth.getSession()` inside `lib/auth.ts`) — not edited here. |
| `InlineConfirm` slice — 03 §2.2 puts it at S1.4, but 00 S1.1.AC6, 04 `deleteAccount` ("inline confirm") and 05 T-E2E-23 need it at S1.1. | Kept in **S1.1** (first use `/profile` Delete account); 03 §2.2 `InlineConfirm` slice cell should read "S1.1 (`/profile` Delete account) · S1.4" — not edited here. `SignInPrompt` dropped from S1.1 (03 §2.4: S1.4); `NoteCallout` added to S1.1 (03: `/privacy`). |
| S1.7 "Depends on: S1.1" (registry) but its Scope IN uses S1.3 deliverables. | Added **S1.3** as a plan-order dependency (as done for S1.6); `_registry.md` S1.7 row should read "S1.1, S1.3 (plan order)" — not edited here. |
| Toggle/Field first-use slice — 00 v0.3 said `Field` S1.3 / `Toggle` S1.4 while S1.2 already needs both. | Aligned to 03 §2.2 / 02 §1.3: `Table`, `Field`, `Toggle` all first ship in **S1.2** (`/admin/projects` switches + curate form); S1.3/S1.4/S1.5 reuse them. |
