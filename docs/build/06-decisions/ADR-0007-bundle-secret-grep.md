# ADR-0007 — Bundle secret grep ignores the supabase-js key-format literal

## Status
Proposed

## Date
2026-08-20

## Slice
S0

## Context
Kind: deviation
- Spec says: `docs/build/01-architecture.md` INV-29 Check — "`pnpm build && ! grep -rEl "SERVICE_ROLE|sb_secret|CURSEFORGE_API_KEY|YOUTUBE_API_KEY|RESEND_API_KEY|KOFI_|CRON_SECRET|DISCORD_WEBHOOK|GOOGLE_OAUTH|HASH_SECRET|[^_]SENTRY_DSN" .next/static`"; `05-test-plan.md` CI-4 — the same list "→ fail if found"; `02-routes-and-pages.md` SM-30 — the same grep "→ empty".
- Spec says: `docs/build/03-components.md` C-17a — `ViewerProvider` (client) resolves the session through `lib/supabase/client.ts`, so `@supabase/supabase-js` is in the client bundle by design (ADR-0002 C1; 01 INV-85 names the three browser-client seams).
- Found: `@supabase/supabase-js` 2.112 contains a key-format guard, `key.startsWith("sb_secret_")`, that warns when a secret key is used in a browser. That literal lands in `.next/static/chunks/*.js` on every build, so the `sb_secret` grep can never be empty once the browser client ships — the literal check and C-17a contradict each other. S0's first `pnpm build` + `scripts/check-bundle-secrets.mjs` failed on exactly this one match.
- Related: none in `docs/questions.md` · supersedes none.

## Decision
1. `scripts/check-bundle-secrets.mjs` keeps the INV-29 pattern list verbatim and ignores **exactly one** shape of match: `sb_secret` immediately followed by `_` and a quote character (`"` or `'`) — the supabase-js guard literal. Any other occurrence still fails: an actual key value (`sb_secret_<key chars>`), the bare word in app code, or any other pattern in the list.
2. `01` INV-29 Check, `05` CI-4 and `02` SM-30 are amended to state that exception (each row contains the string ADR-0007); the rule itself — the browser holds only the `NEXT_PUBLIC_*` names and no secret name or value — is unchanged.
3. This is the only ignored match. A second exception (another library literal, another pattern) is a superseding ADR, never a quiet edit to the script.

## Alternatives considered
| Alternative | Why not |
|---|---|
| Drop `sb_secret` from the list | Loses detection of a real leaked secret key of the new Supabase key format (`sb_secret_…`), which is what the pattern is for. |
| Exclude the supabase-js chunk by filename | Chunk names are content hashes that change per build; a real leak bundled into the same chunk would be hidden. |
| Keep the literal grep as written | It can never pass: 03 C-17a requires the browser client in `ViewerProvider`, and the library ships the literal. |
| Patch/fork supabase-js to remove the guard | A maintained patch for Oliver (01 INV-81 supply chain) that removes a safety warning. |

## Consequences
- Positive: the check stays exact for every real secret name/value; the one exception is a two-character lookahead that is easy to read in the script and in the three doc rows.
- Negative: a future library that embeds `sb_secret_"` for its own reasons would also be ignored (only that exact shape; an actual key never matches it).
- Follow-ups: `security-reviewer` verifies the exception is exactly Decision 1 on every PR that touches the script → owner `security-check`; `deploy-checker` SM-30 runs the same script (same exception) → owner `vercel-ops`.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/01-architecture.md` | §6 INV-29 Check cell | appended "(the supabase-js key-format literal `sb_secret_"` is the one ignored match — ADR-0007)" (contains the string ADR-0007) |
| `docs/build/01-architecture.md` | `Status:` line | appended "— amended by ADR-0007 (2026-08-20)" (README ADR-R2) |
| `docs/build/02-routes-and-pages.md` | §7 SM-30 row | appended "; the supabase-js key-format literal `sb_secret_"` is the one ignored match — ADR-0007" (contains the string ADR-0007) |
| `docs/build/02-routes-and-pages.md` | `Status:` line | appended "— amended by ADR-0007 (2026-08-20)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §4 CI-4 row | appended "(one ignored match: the supabase-js key-format literal `sb_secret_"` — ADR-0007)" (contains the string ADR-0007) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0007 (2026-08-20)" (README ADR-R2) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0007 |

## Gate impact
| Gate | Now checks |
|---|---|
| spec-drift-reviewer | `scripts/check-bundle-secrets.mjs` pattern list equals the INV-29 list; the only skip is the `sb_secret` + `_` + quote lookahead; 01/02/05 rows carry ADR-0007 |
| security-reviewer | the ignored shape is exactly Decision 1 (a real `sb_secret_<key>` value still fails — spot-test by grepping a fake key into a copy of a chunk); any PR widening the exception without a superseding ADR = ❌ |
| deploy-checker | SM-30 on the deployment uses the same script/exception; `SERVICE_ROLE` and the rest of the list remain hard fails |
| frontend-reviewer | `@supabase/supabase-js` appears in the client bundle only through the three INV-85 seams |
| design-fidelity-reviewer, backend-reviewer, supabase-reviewer | none |
