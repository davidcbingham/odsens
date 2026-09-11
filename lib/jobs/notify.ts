/**
 * lib/jobs/notify.ts — `runNotify` (04 §2.4 notify row: "`notifyFanOut` then `notifyDeliver` (one run
 * row)"; 02 §1.4 `items` = delivered count; SC-11/SC-13 via `runJob`; ADR-0030 D2; registry Jobs
 * "`runNotify` (`lib/jobs/notify.ts`)"; 05 T-ACT-33, T-ACT-70).
 *
 * Owns the ONE `sync_runs` row (source `notify`) and the SC-13 lock for the cron pair, then calls
 * `notifyFanOut({runId})` and `notifyDeliver({runId})` — nested runs that write no `sync_runs` row of
 * their own (`runJob` skips lock/insert/finalize/J-F when `runId` is given). Fan-out and deliver
 * both run even when the first fails (rows already queued still deserve delivery); the run is
 * `ok=false` when either failed, `items` = rows delivered, and the two step summaries ride on the
 * summary as `fan_out` / `deliver` (without their duplicated `source` / `run_id`). A failed tick
 * emits `sync.failed` for source `notify` per J-F (through the owning runner) — the matrix decides
 * whether that reaches anyone.
 */
import 'server-only';
import { notifyDeliver } from '@/lib/jobs/notifyDeliver';
import { notifyFanOut } from '@/lib/jobs/notifyFanOut';
import { runJob } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';

const JOB = 'runNotify';
const SOURCE = 'notify' as const;

/** The step summary minus the keys the owning summary already carries. */
function stepView(summary: JobSummary): Record<string, unknown> {
  const view: Record<string, unknown> = { ...summary };
  delete view.source;
  delete view.run_id;
  return view;
}

/** 04 §2.4 / ADR-0030 D2 — the `/api/cron/notify` job. */
export async function runNotify(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ runId, trigger }) => {
      const fanOut = await notifyFanOut({ runId, trigger });
      const deliver = await notifyDeliver({ runId, trigger });
      const ok = fanOut.ok && deliver.ok;
      const errors = [
        fanOut.ok ? null : `fan-out: ${fanOut.error ?? 'failed'}`,
        deliver.ok ? null : `deliver: ${deliver.error ?? 'failed'}`,
      ].filter((entry): entry is string => entry !== null);
      return {
        ok,
        items: deliver.items,
        error: ok ? null : errors.join('; '),
        extra: { fan_out: stepView(fanOut), deliver: stepView(deliver) },
        logMeta: {
          events: fanOut.events,
          recipients: fanOut.items,
          stale: fanOut.stale,
          failed: deliver.failed,
          digests: deliver.digests,
          skipped: deliver.skipped,
        },
      };
    },
  });
}
