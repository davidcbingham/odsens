# ADR-0001 — Engineering spec baseline

## Status
Accepted

## Date
2026-08-17

## Slice
cross-cutting

## Context
Kind: baseline
- Spec says: `CLAUDE.md` — "Engineering specs live in `docs/build/` (to be written before slice 1); deviations require an ADR in `docs/build/06-decisions/`." `.claude/skills/build-phase/SKILL.md` step 2b — "Engineering specs are the contract (`docs/build/00–05`)."
- Found: the build starts with a set of decisions already taken across `docs/spec.md`, `docs/questions.md`, `docs/framework-decision.md`, `docs/data-model.md`, `docs/notifications.md`, `docs/dev-tooling.md`, and `DESIGN.md` v1.3. Gate agents need one place that says which documents are binding and which decisions are already closed, so a "deviation" is measurable.
- Related: none (first ADR).

## Decision
1. The **engineering baseline** for the build is the set: `docs/build/00-build-plan.md`, `docs/build/01-architecture.md`, `docs/build/02-routes-and-pages.md`, `docs/build/03-components.md`, `docs/build/04-server-contracts.md`, `docs/build/05-test-plan.md`, `docs/build/_registry.md`, plus their upstream sources `/DESIGN.md` (v1.3), `docs/data-model.md`, `docs/notifications.md`. All IDs and names come from `_registry.md` verbatim.
2. Any PR that contradicts a statement in the baseline set MUST carry an ADR and the doc amendment in the same PR (README §2 ADR-R1/R2). `spec-drift-reviewer` runs on every PR and fails an unlogged deviation.
3. The pre-build decisions in the table below are **closed**. Re-opening one = a new ADR that supersedes the relevant row *and* an update to the named product doc via `keep-docs`. Building against them needs no ADR.
4. Where the baseline docs are `DRAFT v0.x` (2026-08-17), they become `v1.0` at freeze. The freeze is recorded by appending one "See also" line to this ADR (`See also: freeze commit <sha>, 00–05 v1.0, YYYY-MM-DD`) — the only edit README §4 ADR-L2 permits; no table edits, and no new ADR unless the baseline *set* changes (README OPEN-2).
5. Proposed defaults in the "Open" sections of 00–05 are part of the baseline in the sense of README ADR-R14: build the default without an ADR; diverge only with one.

### Pre-build decisions (closed)
| # | Decision | Where it is recorded (pointer) | Slice(s) |
|---|---|---|---|
| D1 | Framework/stack: **Next.js App Router + TypeScript on Vercel + Supabase** (Postgres + RLS, Auth Google provider, Storage); pnpm; **Node 24** LTS pinned in `.nvmrc` + `package.json#engines` (01 §29 O-1 proposed default, 00 §S0, `docs/dev-tooling.md`; `docs/framework-decision.md` still says 22 — `keep-docs` updates it at freeze); `@supabase/ssr` cookie sessions; service-role key server-only | `docs/framework-decision.md` (whole); `docs/questions.md` Q17; `docs/spec.md` §7 | S0 → all |
| D2 | Styling: **plain CSS custom properties** from DESIGN.md §1 in `styles/tokens.css`, CSS Modules per component (`Name.tsx` + `Name.module.css`); **no Tailwind, no UI kit**; self-hosted Bungee / Space Grotesk / Silkscreen via `next/font/local`; component names mirror DESIGN.md names | `docs/framework-decision.md` §Stack + §Guardrails; `DESIGN.md` §1–§3; `_registry.md` §Repo layout | S0 |
| D3 | Staging = **Supabase Branching** on the production project `odsens` (ref `dllbekulbimblrsrxuyv`); one preview branch per PR via Supabase↔Vercel integration; no second Supabase project; local stack (`supabase start`) until Branching is enabled | `docs/dev-tooling.md` §Supabase project; `docs/questions.md` §Setup to-dos | S0, S1.10 |
| D4 | Notifications v1 = **admins only**, channels **Discord webhook + Resend email**, sender **`allay@odsens.com`**, one event log (`notification_events`) → `notification_recipients` queue → `notification_matrix` toggles; `/api/cron/notify` every 5 min; retries max 5, digest when >5 pending per channel; `comment.reply`/`comment.approved` logged, undelivered; React Email templates in `emails/`; no user inbox/bell in v1 | `docs/notifications.md` (whole); `docs/questions.md` Q11, Q29; `DESIGN.md` §12.1; `docs/data-model.md` §2.6 | S1.4, S1.5 |
| D5 | Comments **built in-house** (no Disqus/Giscus/Remark42): tables `comments`, `comment_likes`, `comment_reports`; actions `postComment`, `editComment`, `deleteComment`, `toggleLike`, `reportComment`, `moderateComment`, `banUser`; threaded one level + likes; moderation mode `auto` \| `hold_first_time` in `site_settings`; limits 1000 chars, 1 link, 15-min edit window, auto-hold ≥3 reports, SQL rate limit | `docs/data-model.md` §2.5; `docs/questions.md` Q10, Q35, Q38, Q40; `docs/spec.md` §5 Comments | S1.4 |
| D6 | Identity: **handle-only**; Google name/email/avatar never displayed or stored in `profiles`; handle structural validation only (3–20, `^[A-Za-z0-9_]+$`, unique, reserved words, no `@`, no name detection); `profiles.email_hash` = sha256(lower(auth email)) set by trigger, server-side only, never in any view — used solely for **Ko-fi supporter matching** (P2); public read via `public_profiles` view | `docs/spec.md` §5 Accounts, §9; `docs/data-model.md` §2.1, §2.8; `docs/questions.md` Q23, Q33, Q34; `DESIGN.md` §12.5 | S1.1, S2.1 |
| D7 | **Seen on v1 = manual curation**: admin pastes URL → metadata fetch (YouTube oEmbed/Data API, OG fallback) → assign → publish; `mentions` table; hourly `/api/cron/refresh-mentions` view counts; YouTube mentions embed inline, others link out; **no auto-discovery in v1** (Suggested queue = v1.5/S2.4, never auto-publish) | `docs/spec.md` §5 Seen on; `docs/data-model.md` §2.3b; `DESIGN.md` §12.2; `docs/questions.md` Q41 + pass-3 note | S1.8 (S2.4) |
| D8 | **Workrooms = Phase 2** (S2.3); v1 keeps only hooks: `comments` polymorphic (`target_type`), file table + `/api/download/[fileId]` generic (owner scope + bucket), admin orders route extensible; admin auto-member of every room; limits 25 MB/file, 200 MB/room (Q45 pending confirm) | `docs/spec.md` §4 5c; `docs/data-model.md` §2.7b; `DESIGN.md` §12.3; `docs/questions.md` Q43, Q45 | S1.3, S1.4 hooks; S2.3 |
| D9 | **Nav order**: wordmark = Home; desktop `Projects · Videos · Skins · Art · Seen on · (Commissions)`; Support = gold button, never in the row; phone: burger, same order, Support last | `DESIGN.md` §12.2 Nav; `docs/spec.md` §5 Nav | S0 |
| D10 | **Commissions nav item hidden until S2.2** ships (Custom Orders intake); `/commissions` route does not exist in v1 | `_registry.md` S0 scope + Phase 2 line; `docs/questions.md` §Design pass 3 note; `DESIGN.md` §12.2 | S0, S2.2 |
| D11 | Sync via **Vercel Cron** route handlers: Modrinth hourly, CurseForge hourly (manual CF id entry in admin, no auto-discovery), YouTube hourly (RSS + Data API), mentions refresh hourly, stats snapshot daily 03:00 UTC, notify every 5 min; every run writes `sync_runs`; failures never touch existing data; deleted-upstream → `hidden`, never delete | `docs/data-model.md` §5; `docs/questions.md` Q39; `docs/framework-decision.md` §Stack | S1.2, S1.6, S1.8, S1.9, S1.5 |
| D12 | Public content pages = **ISR** `revalidate` 600 + tags (`projects`, `project:<slug>`, `videos`, `skins`, `art`, `mentions`, `settings`); session-reading pages, admin, API = dynamic | `_registry.md` §Route registry Rendering; `docs/data-model.md` §5 | S1.2+ |
| D13 | Storage: buckets `avatars`, `project-files` (private, signed URL via `/api/download/[fileId]`), `project-media`, `skins`, `art` with the size limits in data-model §3; every upload is authorised, path-assigned and verified (type/size/magic-byte allowlist, sha512) by a server action — ≤ 1 MB inside the action's `FormData`, larger files via the two-phase signed-upload pattern of 04 §1.4.5 (`createSignedUploadUrl`, browser PUTs to a one-object 2 h URL, second action verifies; proposed default per 00 §5 O-9 / 04 OPEN-11 — the browser never holds a broad Storage policy); every table has RLS; browser uses anon key only | `docs/data-model.md` §3, §4; `docs/build/04-server-contracts.md` C-18, §1.4.5; `docs/framework-decision.md` §Guardrails | S1.1, S1.3, S1.7 |
| D14 | Support: **Ko-fi**, embedded panel + floating button; webhook, `kofi_events`/`supporters`, live leaderboard = **Phase 2** (S2.1); v1 `/support` ships leaderboard in empty state; leaderboard = handle + amount, hashed-email match → `@handle` in message → Anonymous | `_registry.md` S1.9 (panel + floating button are v1); `docs/spec.md` §4 goal 5 (its "Phase 2" label covers the wall/webhook only); `docs/platform-audit.md` Ko-fi row; `docs/questions.md` Q12, Q33; `DESIGN.md` §12.4 | S1.9, S2.1 |
| D15 | Analytics: Vercel Web Analytics + Speed Insights + custom events + own Supabase counters; `stats_daily` snapshots; no GA4/PostHog; Sentry at launch (S1.10) | `docs/analytics-options.md`; `docs/questions.md` Q20 | S1.9, S1.10 |
| D16 | Excluded content: **no Scratch, no Roblox, no posts/devlogs**; no PII anywhere; never reference "Odd Sense NYC" | `docs/spec.md` §3, §6, §9; `docs/questions.md` Q3, Q6, Q26; `CLAUDE.md` | all |
| D17 | Design source of truth = `DESIGN.md` v1.3 "Crate Poster" (dark-first, 0 radius, 2px edges, offset shadows, no blur); prototypes `design/claude-design-export/pass-1..3/`; no pass 4 before build | `DESIGN.md` header + §12; `docs/design-review.md`; `docs/questions.md` Q42 | all UI slices |
| D18 | Skills/gates protocol: build specialists in `.claude/skills/`, read-only gate agents in `.claude/agents/`, spawned per slice in one background batch, `GATE:` verdicts pasted into the PR; `ship` is the only merger; stop-and-ask list applies | `docs/skill-handoffs.md` §1–§5; `docs/site-management-skills.md`; `CLAUDE.md` | all |
| D19 | Repo layout as in `_registry.md` §Repo layout (`app/`, `components/<area>/`, `lib/{actions,jobs,adapters,supabase,notify/deliver}`, `emails/`, `styles/`, `supabase/`, `tests/{unit,db,e2e,fixtures,helpers}`, `scripts/`) | `_registry.md` §Repo layout; `docs/framework-decision.md` §Repo layout | S0 |
| D20 | Environments/secrets: `.env` gitignored, template `.env.example`; Vercel project `odsens` (team `studiobing`) with `CRON_SECRET`, `YOUTUBE_API_KEY`, `RESEND_API_KEY` (Vercel integration), Supabase vars prod-only until Branching; DNS at Squarespace, registration only | `.env.example`; `docs/dev-tooling.md` §Vercel project; `docs/questions.md` Q21 + §Setup to-dos | S0, S1.10 |
| D21 | Skins: `skinview3d` client island (lazy) for the 3D viewer + `renderSkinBust` job writing cached bust PNGs to `skins.render_bust_path` (render location per 00 §5 O-14) | `docs/framework-decision.md` §Stack; `_registry.md` §Server contract registry Jobs, S1.7; `docs/data-model.md` §2.4 `skins`, §5 Skin renders | S1.7 |
| D22 | Markdown: `react-markdown` + `remark-gfm`, sanitised, server-only `Markdown` component; charts: hand-rolled SVG `FlatBarChart`, **no chart lib**; runtime/dev dependency allowlist = 01 INV-78 (anything else → ADR, README R5) | `docs/framework-decision.md` §Stack; `_registry.md` §Component registry Primitives; `docs/build/01-architecture.md` INV-78 | S1.2, S1.9 |
| D23 | Tests/CI: Vitest (`unit` + `db` projects), Playwright smoke + axe, GitHub Actions running `lint / typecheck / test:unit / test:db / build / test:e2e`, required for merge; test IDs from 05 | `.claude/skills/test-engineer/SKILL.md`; `docs/build/00-build-plan.md` DoD-2, §S0; `docs/build/05-test-plan.md` | S0 → all |
| D24 | Videos: YouTube uploads via RSS + Data API `playlistItems` (no `search`), `youtube-nocookie.com` embeds behind a click-to-load facade (`VideoFacade`, one iframe at a time), Shorts detected by duration ≤ 60 s or `#shorts` (04 §5.3, OPEN-8), `ShortsRow` (Q30) | `docs/data-model.md` §2.3, §5; `.claude/skills/web-quality/SKILL.md` Third-party; `docs/build/04-server-contracts.md` §5.3; `DESIGN.md` §11.5; `docs/build/05-test-plan.md` T-E2E-6 | S1.6 |

## Alternatives considered
| Alternative | Why not |
|---|---|
| No baseline ADR; treat 00–05 as implicitly binding | Gates need an explicit, dated statement of *which* docs are the contract and *which* decisions are closed; otherwise "deviation" is arguable. |
| Fold the decision list into `docs/spec.md` | `spec.md` is the product spec (what); this is the engineering baseline (how) and must be diffable by `spec-drift-reviewer` in one place. |

## Consequences
- Positive: one pointer table for every gate and every skill; re-deciding a closed item costs a visible ADR.
- Negative: the table duplicates pointers that also live in `docs/questions.md`; must be kept in sync by `keep-docs` when a Q flips.
- Follow-ups: freeze 00–05 to v1.0 → `build-phase` + `keep-docs`; at freeze `keep-docs` replaces the pre-assigned numbers `ADR-0001`/`ADR-0002`/`ADR-0003` in 00 §6, 01 §29 O-2, 03 §7 O-1, 03 §9, 04 §5.3/OPEN-8 with `ADR-<next>` (README §3 N1/N3, OPEN-3) and updates `docs/framework-decision.md` Node 22 → 24 (D1); Q36 (under-13 line), Q44 (allay render), Q45 (workroom limits) remain product-open in `docs/questions.md` — none blocks S0.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0001 |
| (none of 00–05 / DESIGN.md / data-model / notifications amended — this ADR records the baseline, it does not change it; the sibling-doc edits above are follow-ups, not amendments of this PR) | — | — |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | treats the set in Decision 1 as the contract; any diff contradicting D1–D24 without a superseding ADR = FAIL |
| design-fidelity-reviewer | DESIGN.md v1.3 is the reference (D2, D9, D17) |
| security-reviewer | D6, D13 (handle-only, `email_hash` never in a view, anon-key-only client, RLS everywhere) |
| backend-reviewer | D4, D5, D11, D12, D24 (queue semantics, comment limits, cron cadences/idempotency, ISR tags, Shorts heuristic) |
| supabase-reviewer | D3, D13 (Branching, buckets, RLS on every table) |
| deploy-checker | D3, D10, D20 (Branching wired, Commissions absent from nav, env per environment) |
| frontend-reviewer | D2, D19, D21, D22, D24 (CSS Modules + tokens, folder layout, lazy skinview3d, no chart lib / INV-78 allowlist, youtube-nocookie facade) |
