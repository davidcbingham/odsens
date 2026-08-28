# ADR-0026 — Version identity: `external_id` for synced versions, `(project_id, version_number)` for exclusives only

## Status
Proposed

## Date
2026-08-27

## Slice
S1.3

## Context
Kind: deviation
- Spec says: `docs/data-model.md` §2.2 `project_versions` — "unique(project_id, version_number)"; `docs/build/04-server-contracts.md` §3.1 idempotency key — "`project_versions.external_id` (Modrinth version id)".
- Found: the live Modrinth catalogue has one project (`loud-metal-pipe-mace`) with two versions sharing a `version_number` (distinct `external_id`s) — recorded in `docs/questions.md` (2026-08-27, S1.2 staging + production syncs). Under the S1.2 schema the second insert is refused by `project_versions_project_id_version_number_key` (23505) on the first run, and on every later run the job's `version_number` fallback match silently overwrites the one stored row with alternating upstream data (each swing counts as a change and triggers revalidation). The DB unique and the 04 idempotency key disagreed; Modrinth reality sides with 04.
- Related: `docs/questions.md` S1.2 build notes 2026-08-27 (the finding names S1.3/`backend-robustness` as owner and asks for this ADR).

## Decision
1. Migration `supabase/migrations/20260827200000_project_versions_identity.sql` drops `project_versions_project_id_version_number_key`.
2. `project_versions.external_id` gains a plain DB unique `project_versions_external_id_key` — the 04 §3.1 idempotency key becomes a real constraint. NULLs (exclusive versions) never collide in a plain unique index, and Modrinth version ids are globally unique.
3. Exclusive versions keep per-project `version_number` uniqueness via the partial unique index `project_versions_exclusive_version_key on (project_id, version_number) where external_id is null` — `uploadProjectFile` (04 §1.4) keys its find-or-create on this pair.
4. `lib/jobs/syncModrinth.ts` matches existing versions by `external_id` **only**; the `version_number` fallback match is removed. Duplicate upstream `version_number`s become two rows, exactly as Modrinth shows them; `VersionsTable` renders both.
5. Rows half-adopted by the old fallback (one row carrying one duplicate's `external_id`) converge on the next sync: the other duplicate inserts as its own row; nothing is deleted (J-D / ADR-0002 #66 unchanged).

## Alternatives considered
| Alternative | Why not |
|---|---|
| Widen the DB unique to `(project_id, version_number, version_type)` or similar | Modrinth does not promise any such tuple is unique either; still refuses legal upstream data eventually. |
| Keep newest-wins (skip the older duplicate) | Silently hides a real release from the site; contradicts "the catalogue mirrors Modrinth" (spec §4) and keeps the ping-pong risk in the fallback match. |
| Unique on `(source-scoped) external_id` via partial index `where external_id is not null` | Equivalent in effect, but supabase-js/PostgREST `onConflict` inference cannot name a partial index's predicate; the plain unique keeps upsert paths available and NULLs are naturally exempt. |

## Consequences
- Positive: first production sync stops recording a per-item error every hour; no silent alternating overwrite; DB constraint now matches the 04 §3.1 contract; exclusives keep the uniqueness their upload flow needs.
- Negative: `version_number` alone no longer addresses a synced version (callers must use ids — the codebase already does); two rows may print the same version number in `VersionsTable`, as on Modrinth.
- Follow-ups: none.

## Docs amended
| Doc | Section | Change |
|---|---|---|
| `docs/data-model.md` | §2.2 `project_versions` | unique row replaced with "unique(external_id) — ADR-0026; unique(project_id, version_number) where external_id is null (exclusives)" |
| `docs/build/05-test-plan.md` | §12 | dated note: T-ACT-48 extended with the duplicate-`version_number` case (two upstream versions, one `version_number` → two rows; rerun idempotent) — ADR-0026 |

## Gate impact
`supabase-reviewer` (constraint change + migration), `backend-reviewer` (sync match rule), `spec-drift-reviewer` (data-model §2.2 edit carries this ADR's number).
