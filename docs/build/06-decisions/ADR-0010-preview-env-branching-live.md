# ADR-0010 — Preview env from persistent `staging` Supabase branch; site URL derived

## Status
Accepted

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: supersession
- Spec says: `docs/build/06-decisions/ADR-0006-branching-preview-env.md` D1 — at S0 the Vercel preview carries placeholder anon/service-role values; D2 — preview `NEXT_PUBLIC_SITE_URL` "is set per branch by `ship`"; D3 — S1.1 requires Branching + both integrations live first. `docs/dev-tooling.md` "Staging = Supabase Branching … a preview branch per PR". `docs/build/01-architecture.md` INV-37 — "`NEXT_PUBLIC_SITE_URL` is the canonical origin used for absolute URLs"; INV-36 / `docs/build/04-server-contracts.md` SC-16 name the Supabase keys `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- Found: David enabled Supabase Branching and installed the Supabase GitHub + Vercel integrations on 2026-08-20 (`docs/questions.md` Setup to-dos). An ephemeral branch per PR cannot complete Google sign-in on a preview: each branch is its own Auth server (`https://<branch-ref>.supabase.co/auth/v1/callback`) that Google's OAuth client must list, and that list cannot be pushed from `config.toml` (Q47). The integration names the keys `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) / `SUPABASE_SECRET_KEY` (`sb_secret_…`, acts as service_role), not the legacy names the schema requires. Per-branch `NEXT_PUBLIC_SITE_URL` (ADR-0006 D2) is a manual step on every branch, breaks when Vercel truncates a long branch alias (> 63 chars before `.vercel.app`), and is needed on every preview for OAuth `redirectTo` (02 §4).
- Related: Q47 in `docs/questions.md` (answered 2026-08-20 by David: option (b), a persistent `staging` branch) · "S1.1 open: preview `NEXT_PUBLIC_SITE_URL` strategy" (answered by this ADR) · supersedes **ADR-0006** (D1 and D2 replaced; D3 satisfied; D4 updated in Decision 6).

## Decision
1. A **persistent Supabase branch `staging`** (git branch `staging`; created 2026-08-20 via the CLI; region us-east-2, size micro; project ref `oihrxwqarwllvsyllczo`) is the database + Auth server for **every** Vercel preview deployment. Automatic per-PR (ephemeral) branching in the Supabase GitHub integration is **OFF** (David toggles it in the dashboard).
2. The Vercel **Preview** environment carries staging's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — set once by David (REST API / dashboard, values never through chat) under the integration's key names. **Canonical env names stay the spec names:** `lib/env.ts` `parseEnv(source)` pre-fills `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `SUPABASE_SECRET_KEY` when the canonical value is blank (canonical wins when both are set); `lib/env/public.ts` does the same with the literal `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both key formats are accepted by supabase-js 2.112 / `@supabase/ssr`; the local stack (`.env.test`) keeps the legacy JWT demo keys. No branch-scoped Supabase vars exist on Vercel; the S0 `feat/S0-scaffold` placeholder entries (ADR-0006 D1) are removed by `vercel-ops`. 05 T-UNIT-16 covers: a source with only the new names parses; canonical wins when both are present.
3. **Preview `NEXT_PUBLIC_SITE_URL` is derived, never set by hand.** When `VERCEL_ENV === 'preview'` (server, `lib/env.ts`) / `NEXT_PUBLIC_VERCEL_ENV === 'preview'` (client, `lib/env/public.ts`) and `VERCEL_BRANCH_URL` / `NEXT_PUBLIC_VERCEL_BRANCH_URL` is set, `NEXT_PUBLIC_SITE_URL = 'https://' + branchUrl` — the derived value wins over any configured value on preview. The derivation runs before validation, so the name stays boot-required (04 SC-16) and `env.NEXT_PUBLIC_SITE_URL` remains the one field (no new export). Production and local use the configured value. The client-side names are written literally (`process.env.NEXT_PUBLIC_VERCEL_ENV`, `process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL`) so Next inlines them; this requires the Vercel project setting "Enable access to System Environment Variables" (`vercel-ops` verifies it before merge; `deploy-checker` checks it per Gate impact).
4. `supabase/config.toml` gets `[remotes.staging]` (`project_id = "oihrxwqarwllvsyllczo"`) with `[remotes.staging.auth]` `site_url = "https://odsens-git-staging-studiobing.vercel.app"`, `additional_redirect_urls = ["https://odsens-git-*-studiobing.vercel.app/**", "http://localhost:3000/**"]` and `[remotes.staging.auth.external.google]` (the same `client_id` as the base block, `secret = "env(GOOGLE_OAUTH_CLIENT_SECRET)"`). The Google Cloud console's OAuth client lists `https://oihrxwqarwllvsyllczo.supabase.co/auth/v1/callback` as an authorized redirect URI (one-time, David). `[remotes.production]` is unchanged (ADR-0011).
5. **Flow (`ship` skill step):** before a PR is reviewed on its preview, the PR branch is pushed to `staging` — `git push origin <branch>:staging`, **fast-forward only, never force** — so its migrations + `config.toml` reach the staging branch through the GitHub integration; `main` still promotes to production on merge. One PR in flight at a time (solo project); a second PR rebases onto `main` first. `ship` no longer runs `vercel env add NEXT_PUBLIC_SITE_URL preview <branch>`; `vercel-ops` "Environments" states the staging model, the derivation and the key names.
6. `deploy-checker` (ADR-0006 D4 updated): on a preview it expects `NEXT_PUBLIC_SUPABASE_URL` = the staging branch URL (`https://oihrxwqarwllvsyllczo.supabase.co`, ≠ production's ref) and **either** key pair present — `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + `SUPABASE_SECRET_KEY` — names only, values never printed. It reports which Supabase ref the preview is actually running on.
7. **Transition:** until David finishes the three dashboard steps (toggle automatic branching OFF · paste the three staging vars into Vercel Preview · Google-console redirect URI for the staging callback), a PR preview may still run on an ephemeral branch; `deploy-checker` reports which one it found, and the Google consent leg is verified on production after merge until then.
8. `.env.example` documents the two integration names as commented alternatives under the Supabase block (aliases accepted by `lib/env.ts`); T-UNIT-35 parity treats commented names as documentation, not schema keys.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Ephemeral Supabase branch per PR (the 2026-08-17 plan and the first draft of this ADR) | Google sign-in cannot complete on a preview without a Google-console entry per branch (Q47); env values change per PR and the first build races the integration's env write; nothing to test Google against before production. |
| Keep per-branch `NEXT_PUBLIC_SITE_URL` (ADR-0006 D2) | Manual step per branch; wrong when Vercel truncates the alias; the value Vercel already knows (`VERCEL_BRANCH_URL`) is authoritative. |
| Rename the schema keys to Supabase's new names | Renames registry/spec names across 01/04/05/`.env.example`/`.env.test` and every skill for no behavioural gain; the alias costs two lines in `parseEnv`. |
| A second Supabase project as staging | A billable second project with its own migration history and no `config.toml` branch semantics; a persistent branch gives the same isolation inside the one project. |
| Derive the site URL from `VERCEL_URL` | `VERCEL_URL` is the per-deployment hash URL, not the stable branch alias the OAuth allow-list (ADR-0011) matches. |

## Consequences
- Positive: one stable staging Auth callback that Google knows — the full Google round-trip is verifiable on previews; one set of preview vars set once; OAuth `redirectTo` on previews matches the branch alias the allow-list expects (ADR-0011); no production credential on previews (ADR-0006's least-privilege stance is kept).
- Negative: every preview shares one database — a PR's migrations land on staging before review (hence one PR in flight; a broken staging branch is repaired by the next fast-forward push or by `supabase-ops` resetting it); three dashboard steps stay with David until done (Decision 7); two env spellings exist for the same two secrets (alias logic in `lib/env.ts` / `lib/env/public.ts` must stay in step); the client-side derivation depends on Vercel's `NEXT_PUBLIC_VERCEL_*` exposure being enabled.
- Follow-ups: the three dashboard steps → David (`docs/questions.md` Setup to-dos) · `[remotes.staging]` block + the staging ref in this ADR / `docs/dev-tooling.md` → `supabase-ops` (this PR) · push-to-staging step → `ship` (this PR) · remove the `feat/S0-scaffold` placeholder entries → `vercel-ops` · `deploy-checker` agent file reads this ADR for the staging-ref and "either key pair" rules → `keep-docs` (agent files are docs; README OPEN-4).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/06-decisions/ADR-0006-branching-preview-env.md` | Status | `Accepted` → `Superseded by ADR-0010` (README ADR-L3) |
| `docs/build/01-architecture.md` | §6 INV-29 | note: on previews (persistent `staging` branch) the publishable key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` value) may legitimately reach the bundle; `sb_secret` never (contains the string ADR-0010) |
| `docs/build/01-architecture.md` | §7 INV-36; §7 env matrix rows | Preview env carries the persistent `staging` branch's keys under the integration's names, accepted as aliases; `VERCEL_BRANCH_URL` / `NEXT_PUBLIC_VERCEL_*` row (contains the string ADR-0010) |
| `docs/build/01-architecture.md` | §7 INV-37 | preview derivation sentence (contains the string ADR-0010) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/04-server-contracts.md` | §0 SC-16 Supabase key rows; `NEXT_PUBLIC_SITE_URL` row | staging branch + alias names; preview derivation (contains the string ADR-0010) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0012, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §7.4 T-UNIT-16 row | alias-only source parses; canonical wins when both set (contains the string ADR-0010) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0010, ADR-0012, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/_registry.md` | Env line | preview aliases = the integration's key names; previews run on the persistent `staging` branch (contains the string ADR-0010) |
| `docs/build/00-build-plan.md` | §6 Changelog | row "ADR-0010 — preview env from the persistent `staging` Supabase branch (supersedes ADR-0006)" (contains the string ADR-0010) |
| `docs/build/00-build-plan.md` | §2 S1.10 Scope IN (Branching line) | "branch per PR" → the persistent `staging` branch serves every preview (contains the string ADR-0010) |
| `docs/build/00-build-plan.md` | §2 S1.10.AC8 | wording: "spins a preview branch automatically" → preview runs against the persistent `staging` branch after the push-to-staging step (CC-7 AC wording change carried by this ADR; contains the string ADR-0010) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0012 (2026-08-20)" (README ADR-R2) |
| `docs/questions.md` | Setup to-dos (Supabase project item; Branching item; new three-dashboard-steps item); S0 build notes "S1.1 open: preview `NEXT_PUBLIC_SITE_URL` strategy"; S1.1 build notes (ADR list line; Q47) | to-dos updated; `NEXT_PUBLIC_SITE_URL` question answered; Q47 answered 2026-08-20 — persistent `staging` branch (contains the string ADR-0010) |
| `docs/spec.md` | Revision log 2026-08-20 line | ADR-0010 wording; Q47 answered (contains the string ADR-0010) |
| `docs/dev-tooling.md` | Supabase project — Staging paragraph; Vercel project — env vars line; Oliver's laptop line | persistent `staging` branch model, push-to-staging flow, Preview env vars (contains the string ADR-0010) |
| `.env.example` | Supabase block comment | Preview carries the `staging` branch's keys under the alias names `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (contains the string ADR-0010) |
| `.claude/skills/ship/SKILL.md` | Facts; step 3; David-side prerequisites | staging model; push-to-staging step (fast-forward, never force); three dashboard steps (contains the string ADR-0010) |
| `.claude/skills/vercel-ops/SKILL.md` | Environments | Preview = persistent `staging` branch's vars, key names, derivation (contains the string ADR-0010) |
| `.claude/skills/supabase-ops/SKILL.md` | Workflow step 5 | previews use the persistent `staging` branch; migrations reach it via the push (contains the string ADR-0010) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0010; ADR-0006 row status → Superseded by ADR-0010 |

## Gate impact
| Gate | Now checks |
|---|---|
| deploy-checker | preview: `NEXT_PUBLIC_SUPABASE_URL` is the staging branch URL (`oihrxwqarwllvsyllczo`, ≠ production ref) — it reports the ref it found; either key pair present (names only); `NEXT_PUBLIC_SITE_URL` is not set per branch; "Enable access to System Environment Variables" on; production unchanged |
| backend-reviewer | `lib/env.ts` `parseEnv` aliases + preview derivation before validation; `lib/env/public.ts` uses the literal `process.env.NEXT_PUBLIC_VERCEL_*` / `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` names; T-UNIT-16 covers both key spellings |
| security-reviewer | no production `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` on previews (Preview holds staging's only); `scripts/check-bundle-secrets.mjs` still greps `sb_secret` (ADR-0007 literal exception stands); the publishable key in the bundle is allowed |
| supabase-reviewer | `supabase/config.toml` has `[remotes.staging]` with the Decision 4 values; `[remotes.production]` unchanged (ADR-0011) |
| spec-drift-reviewer | this ADR + ADR-0006's status flip + README row in the PR; `ship` carries the push-to-staging step; no skill step sets `NEXT_PUBLIC_SITE_URL` per branch |
| design-fidelity-reviewer, frontend-reviewer | none |
