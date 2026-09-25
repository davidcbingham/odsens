/**
 * lib/jobs/constants.ts — operational defaults (04 §5.8; registry Jobs "Constants
 * `lib/jobs/constants.ts`"). Tunable without an ADR (04 §5.8 heading); later slices append theirs
 * (`FANOUT_BATCH`, `DELIVER_BATCH`, `ORPHAN_CLEANUP_MAX`, …).
 */

/** SC-13 concurrency lock window: an open `sync_runs` row younger than this blocks the source. */
export const JOB_LOCK_MINUTES = 15;

/** 04 §3.1 external-call spacing for `syncModrinth` (sequential; ≤ 300 req/min stays far away). */
export const MODRINTH_CALL_SPACING_MS = 100;

/**
 * 04 §3.4 select / J-S `mentions` footnote (S1.8, ADR-0045) — the `mentions.status` values
 * `refreshMentions` refreshes, and therefore the ones `notifyFanOut` F0 counts when it decides
 * whether the `mentions` source is watched at all: a source is only "stale" when the job has
 * something to refresh. One list so the two can never drift. A rule's code home, NOT a tunable —
 * changing it changes 04 §3.4 (ADR).
 */
export const MENTION_REFRESH_STATUSES = ['draft', 'published'] as const;
