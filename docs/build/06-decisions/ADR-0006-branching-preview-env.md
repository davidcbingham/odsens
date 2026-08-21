# ADR-0006 — Preview env fallback until Supabase Branching is live

## Status
Superseded by ADR-0010

## Date
2026-08-17

## Slice
S0

## Context
Kind: deferral
- Spec says: `docs/build/00-build-plan.md` S0 Scope IN — "Supabase Branching enabled + Supabase GitHub/Vercel integrations installed so the preview gets branch env vars (`docs/dev-tooling.md` "set up at first preview deploy")"; S0.AC12 — "Preview deploy shows Supabase preview-branch env vars present (names only) per `deploy-checker`".
- Spec says: `docs/build/00-build-plan.md` S0 Risks / unknowns — "Supabase Branching + Vercel integration first-time setup (env injection may lag — fallback: production Supabase vars in preview for S0 only, recorded as an ADR with slug `branching-preview-env`, number per 06 ADR-N3 — ADR-0002 C11)".
- Found: enabling Branching, creating the first branch and installing the Supabase GitHub + Vercel integrations are dashboard actions David must perform (billable infrastructure; the automated S0 session was not permitted to create cloud resources), so the preview cannot receive branch env vars at S0. S0 has no tables beyond helpers, no sign-in and no server-side Supabase writes — nothing on the S0 preview needs a working Supabase call.
- Related: `docs/questions.md` "Setup to-dos before build (David)" (Branching + integrations item added by this PR) · supersedes none.

## Decision
1. For S0 the Vercel **preview** environment carries `NEXT_PUBLIC_SUPABASE_URL` = the production project URL (`https://dllbekulbimblrsrxuyv.supabase.co`, a public value) and **placeholder** (non-working) values for `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Least privilege: no production credential reaches previews. The S0 preview makes no Supabase call that must succeed — `ViewerProvider` treats an auth error as anon (03 C-17a), `/auth/callback` without a valid session redirects to `/` (ADR-0002 C18). Boot validation (`lib/env.ts`, 00 S0.AC5) checks presence and shape only, so placeholders pass.
2. `NEXT_PUBLIC_SITE_URL` for preview is set **per branch** by `ship` when a branch is new: `vercel env add NEXT_PUBLIC_SITE_URL preview <branch> --value https://odsens-git-<branch-slug>-studiobing.vercel.app` (Vercel branch-alias pattern for project `odsens`, team `studiobing`). Whether to keep per-branch values or derive from `VERCEL_BRANCH_URL` is an S1.1 question (`docs/questions.md`, "S1.1 open: preview `NEXT_PUBLIC_SITE_URL` strategy") — needed there for OAuth `redirectTo` on previews.
3. S1.1 (sign-in, profiles) **requires** Supabase Branching + the Supabase GitHub integration (`davidcbingham/odsens`) + the Supabase Vercel integration to be live first — a David-side prerequisite listed in `docs/questions.md` "Setup to-dos". If David instead chooses the 00 fallback (production Supabase values in preview), that is his call and is recorded by a superseding ADR that flips Decision 1; no skill applies production values to preview on its own (`docs/skill-handoffs.md` §5: missing secret value → ask).
4. `deploy-checker` S0.AC12 reads "names present": the three names above plus the other boot-required names exist in the preview environment (values never printed) — satisfied by this fallback. The AC text is unchanged (no 00 CC-7 scope change).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Production Supabase values in preview (00's stated fallback) | Puts the production anon key and, worse, the service-role key on every preview deployment for no benefit — S0 makes no call that needs them. Rejected for S0 as unnecessary exposure; remains David's option via a superseding ADR. |
| Block S0 until Branching + integrations are enabled | Blocks the whole build (CI, harness, tokens, layout, skills) on a dashboard click that only S1.1 actually needs. |
| Local-stack values (`http://127.0.0.1:54321` + CLI demo keys) in preview | Unreachable from Vercel; the URL is a public value anyway, and the CLI demo keys are well-known — no cleaner than explicit placeholders and misleading in logs. |

## Consequences
- Positive: no production credential on previews; S0 ships; the S0 preview still boots (env presence/shape satisfied) and every S0 acceptance criterion is checkable.
- Negative: S0 preview cannot exercise any real Supabase path (none exists at S0); the placeholder values must be replaced — not merely overridden — once Branching injects the real per-branch values, and `NEXT_PUBLIC_SITE_URL` needs a per-branch step in `ship` until S1.1 decides.
- Follow-ups: enable Branching + install both integrations before S1.1 → owner David (`docs/questions.md` Setup to-dos) · decide the preview `NEXT_PUBLIC_SITE_URL` strategy → `vercel-ops` at S1.1 (superseding ADR if per-branch is dropped) · remove the placeholder values when branch env injection is verified → `vercel-ops` · if David picks the production-values fallback → superseding ADR by `keep-docs`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/00-build-plan.md` | §6 Changelog | new line "ADR-0006 — S0 preview env fallback (placeholders; Branching required before S1.1)" (contains the string ADR-0006) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0006 (2026-08-17)" (README ADR-R2) |
| `docs/questions.md` | Setup to-dos before build (David); dated S0 notes | Branching + integrations item "REQUIRED before S1.1 (ADR-0006)"; Protection Bypass for Automation item; `CURSEFORGE_MEMBER` removal item; S1.1 open question on preview `NEXT_PUBLIC_SITE_URL` (ADR-0006 D2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0006 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | this ADR is listed in the PR body `## ADRs in this PR`; 00 §6 + Status line amended; no code applies production Supabase values to preview |
| deploy-checker | S0.AC12 = the boot-required env **names** are present on the preview (values never printed); `NEXT_PUBLIC_SUPABASE_URL` may equal the production URL at S0; from S1.1 it expects the branch URL/keys injected by the Supabase↔Vercel integration |
| security-reviewer | no production `SUPABASE_SERVICE_ROLE_KEY`/anon key in the preview environment at S0 (asks `vercel env ls` output — names + environments only); flags any PR that sets production values on preview without a superseding ADR |
| design-fidelity-reviewer, frontend-reviewer, backend-reviewer, supabase-reviewer | none |
