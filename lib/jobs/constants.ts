/**
 * lib/jobs/constants.ts — operational defaults (04 §5.8; registry Jobs "Constants
 * `lib/jobs/constants.ts`"). Tunable without an ADR (04 §5.8 heading); later slices append theirs
 * (`FANOUT_BATCH`, `DELIVER_BATCH`, `ORPHAN_CLEANUP_MAX`, …).
 */

/** SC-13 concurrency lock window: an open `sync_runs` row younger than this blocks the source. */
export const JOB_LOCK_MINUTES = 15;

/** 04 §3.1 external-call spacing for `syncModrinth` (sequential; ≤ 300 req/min stays far away). */
export const MODRINTH_CALL_SPACING_MS = 100;
