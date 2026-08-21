# ADR-0012 — `HASH_SECRET` boot-required from S1.1

## Status
Accepted

## Date
2026-08-20

## Slice
S1.1

## Context
Kind: deviation
- Spec says: `docs/build/04-server-contracts.md` SC-16 — "the boot-required set is exactly the **8 required** rows below … `lib/env.ts` fails fast only on those 8"; `HASH_SECRET` row — "**required from S1.1** (≥ 32 random bytes, server-only)". `docs/build/05-test-plan.md` T-UNIT-16 — "`HASH_SECRET` … is **not** a boot-fail name (04 SC-16 …; a missing `HASH_SECRET` surfaces where 04 SC-17 says, not at import)". `docs/build/01-architecture.md` INV-36 — "boot-required = the 8 names in 00 S0.AC5 + `HASH_SECRET` from S1.1 — ADR-0002 #18/A14"; §7 env matrix `HASH_SECRET` = "R from S1.1". `docs/build/_registry.md` Env — "`HASH_SECRET` (required from **S1.1**, server-only, ≥32 bytes — ADR-0002 A14)" listed outside the boot-required set.
- Found: 01 and 04/05 disagree on whether "required from S1.1" means fail-at-boot. From S1.1 `/auth/callback` A3a hashes the email on every first sign-in and `lib/hash.ts` is the one hashing seam (SC-17); a blank secret would either throw on the first sign-in (worse than at boot) or silently HMAC with an empty key. 01 INV-36's reading (boot-required) is the safe one.
- Related: ADR-0002 #18 / A14 · `docs/questions.md` S1.1 build notes (secret generated and set 2026-08-20) · supersedes none (adds one name to the set ADR-0002 #18 fixed at 8 for S0).

## Decision
1. From S1.1 `lib/env.ts` has `HASH_SECRET: z.string().min(32)` in the **required** schema: missing → throws at import; a 31-character value → throws. The boot-required set is **9 names**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `MODRINTH_USER`, `MODRINTH_USER_AGENT`, `YOUTUBE_CHANNEL_ID`, `HASH_SECRET`.
2. 05 T-UNIT-16 asserts the 9 names (missing `HASH_SECRET` → throws; 31 chars → throws). `.env.test` carries a 48-character local value; T-UNIT-35 parity is unchanged (the name was already in `.env.example`).
3. `HASH_SECRET` stays server-only (01 INV-29 grep list, 05 CI-4) and is never aliased or derived.
4. The value was generated and set in Vercel production + preview and in David's `.env` on 2026-08-20 (names only recorded; `docs/questions.md`).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Keep it optional and fail inside `emailHash()` | First failure lands on a real user's first sign-in instead of at deploy; `deploy-checker` cannot see it from the names list alone. |
| Default to a generated value when blank | Hashes would change per deployment, breaking `email_hash` matching (data-model §2.8, Ko-fi leaderboard) silently. |

## Consequences
- Positive: a missing or short secret is caught at boot (and by `deploy-checker` names check) before any sign-in; 01, 04, 05 and the registry say the same thing.
- Negative: local `.env` without `HASH_SECRET` no longer boots from S1.1 (`.env.example` says so); S0.AC5's "8 names" stays true for S0 history only.
- Follow-ups: none (value set; `deploy-checker` counts 9 names from S1.1).

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/build/04-server-contracts.md` | §0 SC-16 header; `HASH_SECRET` row; "Boot-required set" line | 9 names from S1.1 (contains the string ADR-0012) |
| `docs/build/04-server-contracts.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0012, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/05-test-plan.md` | §7.4 T-UNIT-16 row | `HASH_SECRET` is a boot-fail name; 9 names; 31-char value throws (contains the string ADR-0012) |
| `docs/build/05-test-plan.md` | `Status:` line | appended "— amended by ADR-0010, ADR-0012, ADR-0013 (2026-08-20)" (README ADR-R2) |
| `docs/build/_registry.md` | Env line | `HASH_SECRET` moved into the boot-required list (contains the string ADR-0012) |
| `docs/build/00-build-plan.md` | §6 Changelog | new row "ADR-0012 — `HASH_SECRET` boot-required from S1.1 (9 names)" (contains the string ADR-0012) |
| `docs/build/00-build-plan.md` | `Status:` line | appended "— amended by ADR-0009, ADR-0010, ADR-0011, ADR-0012 (2026-08-20)" (README ADR-R2) |
| `.env.example` | header comment | boot-required list = 9 from S1.1 (contains the string ADR-0012) |
| `docs/build/06-decisions/README.md` | §7 Index | row for ADR-0012 |

`docs/build/01-architecture.md` INV-36 and the §7 env matrix already state the boot-required reading ("R from S1.1") — no edit; this ADR cites them.

## Gate impact
| Gate | Now checks |
|---|---|
| backend-reviewer | `lib/env.ts` required schema includes `HASH_SECRET` (`min(32)`); T-UNIT-16 asserts 9 names + the 31-char case |
| deploy-checker | 9 boot-required names present in production and preview (names only) |
| security-reviewer | `HASH_SECRET` absent from `.next/static/**` (CI-4) and from `lib/env/public.ts` |
| spec-drift-reviewer | 04 SC-16 / 05 T-UNIT-16 / registry Env agree on 9 names; this ADR listed in the PR |
| design-fidelity-reviewer, frontend-reviewer, supabase-reviewer | none |
