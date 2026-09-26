/**
 * lib/jobs/constants.ts — operational defaults (04 §5.8; registry Jobs "Constants
 * `lib/jobs/constants.ts`"). Tunable without an ADR (04 §5.8 heading); later slices append theirs
 * (`FANOUT_BATCH`, `DELIVER_BATCH`; S1.9 the `snapshotStats` housekeeping set below).
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

// ---- S1.9 `snapshotStats` housekeeping (04 §3.5; 04 §1.4.5 U1; 04 §5.8 tunables; ADR-0049 D17) ----

/** 04 §5.8 tunable: Storage objects the U1 orphan sweep removes per run, across every bucket. */
export const ORPHAN_CLEANUP_MAX = 200;

/** 04 §5.8 tunable: an object younger than this is an upload still in flight, never an orphan (U1). */
export const ORPHAN_MIN_AGE_HOURS = 24;

/**
 * 04 §3.5 rule homes (ADR-R6 applies — changing one changes the contract, not a tunable):
 * `purge_project_downloads(90)` and `purge_rate_limit_hits(1)`.
 */
export const PROJECT_DOWNLOADS_RETENTION_DAYS = 90;
export const RATE_LIMIT_HITS_RETENTION_DAYS = 1;

/**
 * 04 §1.4.5 U1: the buckets whose objects must be referenced by a committed row (`project_files.
 * storage_path`, `projects.icon_url`, `projects.gallery[].url`, `project_overrides.extra_gallery[].path`,
 * `art.image_path`). `avatars` and `skins` are EXCLUDED — never listed, never removed (ADR-0049 D6).
 */
export const ORPHAN_BUCKETS = ['project-files', 'project-media', 'art'] as const;
export type OrphanBucket = (typeof ORPHAN_BUCKETS)[number];

/** `stats_daily` rows per upsert request (PostgREST handles one statement; the URL stays short). */
export const STATS_UPSERT_CHUNK = 500;
