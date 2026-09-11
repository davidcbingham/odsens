/**
 * lib/jobs/types.ts — the job contract shapes (04 §3 common signature; `_registry.md` Types:
 * "`JobSummary` (`lib/jobs/types.ts`)"; registry Jobs: `sync_runs.source ∈ modrinth, curseforge,
 * youtube, mentions, stats, notify, skins`).
 *
 * 04 §3 verbatim: `export async function <job>(opts: {runId?: string, trigger: 'cron'|'manual',
 * full?: boolean}): Promise<JobSummary>` where `JobSummary = {ok: boolean, source, run_id,
 * items: number, ms: number, error?: string, skipped?: string, [k: string]: unknown}`.
 * `run_id` = the job's `sync_runs.id` (SC-11); on an SC-13 lock skip it is the OPEN run's id (the
 * run that holds the lock — no new row is written). Cron routes echo the summary as their 200 JSON
 * (SC-12), so every value must be JSON-serializable.
 */

/** The closed `sync_runs.source` list (registry Jobs; sync_runs_source_check). */
export type SyncSource =
  'modrinth' | 'curseforge' | 'youtube' | 'mentions' | 'stats' | 'notify' | 'skins';

/** 04 §3 common signature — the options every `lib/jobs/*` job takes. */
export type JobOptions = {
  /**
   * An existing `sync_runs` row the CALLER owns (the §2.4 notify pair under `runNotify` — ADR-0030 D2):
   * when given, the callee runs no SC-13 lock check, inserts nothing, does not finalize and emits no
   * J-F `sync.failed`; the owner (`runNotify`) finalizes and emits for the combined outcome. Absent =
   * the job owns its row (the cron routes, `triggerSync`, tests).
   */
  runId?: string;
  trigger: 'cron' | 'manual';
  /** Only meaningful for `syncYoutube` (walk the uploads playlist) — S1.2 jobs ignore it. */
  full?: boolean;
};

/**
 * 04 §3 verbatim. Per-job extras (`hidden`, `versions`, `errors[]`, …) ride on the index signature.
 * `skipped` carries two 04 meanings: the §3/SC-13 skip reason (`'running'`, `'not_configured'` —
 * a string) and §3.1 step 5's count of skipped Modrinth types (05 T-ACT-50 — a number), so the
 * declared type is the union of both.
 */
export type JobSummary = {
  ok: boolean;
  source: SyncSource;
  run_id: string;
  items: number;
  ms: number;
  error?: string;
  skipped?: string | number;
  [k: string]: unknown;
};
