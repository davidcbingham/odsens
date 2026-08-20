# ADR-0011 — OAuth redirect allow-list narrowed to project previews

## Status
Proposed

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: security
- Spec says: `docs/build/02-routes-and-pages.md` §4 — "Redirect URL allow-list is in `supabase/config.toml` (`[remotes.production.auth].additional_redirect_urls`: `https://odsens.com/**`, `https://www.odsens.com/**`, `https://*.vercel.app/**`, `http://localhost:3000/**`)"; `docs/build/01-architecture.md` INV-34 — "`[remotes.production.auth]` … and the four `additional_redirect_urls`".
- Found: `https://*.vercel.app/**` lets **any** Vercel-hosted site finish a PKCE flow against the production Supabase project (S0 `security-reviewer` note (b), `docs/questions.md` 2026-08-20). Vercel branch aliases for this project are `https://odsens-git-<branch>-studiobing.vercel.app`, and Supabase's glob rules (`*` = any run of non-separator characters, separators `.` and `/`; `**` = anything) allow the narrower `https://odsens-git-*-studiobing.vercel.app/**`. With Branching live (ADR-0010), ephemeral preview branches take the **base** `[auth]` block (config.toml syncs to branches; `[remotes.production]` is applied to production by the GitHub integration on merge), so the base block needs the preview pattern too.
- Related: `docs/questions.md` S0 gate note (b) · supersedes none.

## Decision
1. `supabase/config.toml` `[remotes.production.auth].additional_redirect_urls` = exactly `https://odsens.com/**`, `https://www.odsens.com/**`, `https://odsens-git-*-studiobing.vercel.app/**`, `http://localhost:3000/**` (still four entries; `https://*.vercel.app/**` removed).
2. The base `[auth]` block (local stack + any preview branch without its own `[remotes.*]` block — the persistent `staging` branch carries its own list, ADR-0010 D4) additionally lists `https://odsens-git-*-studiobing.vercel.app/**` so the preview's OAuth `redirectTo` (derived per ADR-0010) is accepted by the branch's Auth server.
3. `[remotes.production]` remains the only route to production config; it is applied by the Supabase GitHub integration on merge to `main`. The base block is never hand-edited for a single branch.
4. Adding any redirect URL = `config.toml` change + this ADR's successor (R7 security rule), never an app change.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep `https://*.vercel.app/**` | Any Vercel site can complete sign-in against the project — open redirect surface on a minor's site. |
| Exact per-branch URLs added by `ship` | Manual step per branch and a config push per PR; the narrowed glob covers every branch alias of this project with one entry. |
| Previews without OAuth (production only) | Loses the sign-in *start* check on previews (the redirect to `/auth/v1/authorize` is verifiable there even when the Google consent leg is not — `docs/questions.md` Q47). |

## Consequences
- Positive: only this project's branch aliases and the two production hosts can complete a code exchange; previews keep working under Branching.
- Negative: a renamed Vercel project or team (`odsens` / `studiobing`) invalidates the pattern — `vercel-ops` owns that rename and files the successor ADR; the Google consent step on previews still needs a per-branch Google-console entry (Q47, not a config.toml matter).
- Follow-ups: `config.toml` edit → owner `supabase-ops` (this PR) · Google sign-in on preview branches → Q47 (David) · `security-reviewer` / `deploy-checker` agent files read this ADR → owner `keep-docs` (README OPEN-4).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/02-routes-and-pages.md` | §4 Sign-in paragraph | allow-list sentence rewritten with the four entries + base `[auth]` note (contains the string ADR-0011) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0011, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/01-architecture.md` | §6 INV-34 | "the four `additional_redirect_urls`" enumerated; base `[auth]` block note (contains the string ADR-0011) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/00-build-plan.md` | §2 S1.1 Risks / unknowns | preview pattern sentence (contains the string ADR-0011) |
| `docs/build/00-build-plan.md` | §6 Changelog | new row "ADR-0011 — OAuth redirect allow-list narrowed" (contains the string ADR-0011) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0012 (2026-08-20)" (README ADR-R2) |
| `.claude/skills/supabase-ops/SKILL.md` | Auth checklist | `*.vercel.app` → `odsens-git-*-studiobing.vercel.app` (contains the string ADR-0011) |
| `docs/setup-google-cloud.md` | §2 Supabase-side line; Status 2026-08-17 | operator guide lists the four narrowed entries; status note marks the allow-list narrowed (contains the string ADR-0011) |
| `docs/questions.md` | S0 build notes 2026-08-20 gate note (b) | marked done by ADR-0011 |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0011 |

## Gate impact
| Gate | Now checks |
|---|---|
| security-reviewer | `supabase/config.toml`: no `*.vercel.app` wildcard anywhere; `[remotes.production.auth].additional_redirect_urls` equals Decision 1; base `[auth]` carries the narrowed preview pattern and `http://localhost:3000/**` |
| deploy-checker | the preview's `NEXT_PUBLIC_SITE_URL` (branch alias, ADR-0010) matches `https://odsens-git-*-studiobing.vercel.app`; production `site_url = "https://odsens.com"` (INV-34) |
| supabase-reviewer | `config.toml` diff limited to the two allow-lists (+ the `[storage] file_size_limit = "100MiB"` value INV-52 already mandates) |
| spec-drift-reviewer | 02 §4 and 01 INV-34 amended with ADR-0011; this ADR listed in the PR |
| design-fidelity-reviewer, frontend-reviewer, backend-reviewer | none |
