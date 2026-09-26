'use server';
/**
 * lib/actions/admin.ts — `triggerSync` (04 §1.7; SC-01 "`triggerSync` lives in `lib/actions/admin.ts`"
 * — ADR-0002 C16; 01 INV-72; SC-13; SC-24; ADR-0002 C7; ADR-0013; 05 T-ACT-42 / T-ACT-70).
 *
 * Calls the job function directly (`lib/jobs/*` — 01 INV-72: the same function as the cron route,
 * never a copy, never internal HTTP), so the SC-13 lock, the `sync_runs` row and the job's own
 * revalidations all come from the one code path. The job-level lock skip (`{ok:true,
 * skipped:'running'}`) is mapped HERE to `{ok:false, error:{code:'conflict', message:'Already
 * running.'}}` per the 04 §1.7 Returns cell — the cron route passes the job summary through
 * unchanged (05 T-ACT-70 covers both layers). No rate-limit scope: the lock is the limiter
 * (04 §5.5 row, counted on `sync_runs`).
 *
 * S1.2 wires `modrinth` and `curseforge`, S1.6 `youtube` (`full:true` — the schema accepts it for
 * youtube only — reaches `syncYoutube` as the uploads-playlist walk, 04 §3.3 step 3), S1.8
 * `mentions` (`refreshMentions`, 04 §3.4 — its "Sync now" button lives on `/admin/mentions`,
 * ADR-0045), S1.9 `stats` (`snapshotStats`, 04 §3.5 — the `stats` row of the `/admin/stats` SYNC
 * board, ADR-0049 D9 / ADR-0049 D14). `JOBS` is a full `Record` over the schema's five sources: every accepted
 * `source` has a job, so there is no "not built yet" branch.
 *
 * SC-24: the `requireRole` call site logs `msg:'admin'` with meta keys only before returning
 * `ok:true`. Input schema lives in `./admin.schema.ts` (a `'use server'` module may export only
 * async functions).
 */
import { triggerSyncInput, type TriggerSyncInput } from '@/lib/actions/admin.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction } from '@/lib/actions/run';
import { requireRole } from '@/lib/auth';
import { refreshMentions } from '@/lib/jobs/refreshMentions';
import { snapshotStats } from '@/lib/jobs/snapshotStats';
import { syncCurseforge } from '@/lib/jobs/syncCurseforge';
import { syncModrinth } from '@/lib/jobs/syncModrinth';
import { syncYoutube } from '@/lib/jobs/syncYoutube';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import { log } from '@/lib/log';

/** Source → job function (01 INV-72) — one entry per schema source (ADR-0049 D9). */
const JOBS: Record<TriggerSyncInput['source'], (opts: JobOptions) => Promise<JobSummary>> = {
  modrinth: syncModrinth,
  curseforge: syncCurseforge,
  youtube: syncYoutube,
  mentions: refreshMentions,
  stats: snapshotStats,
};

// ---------------------------------------------------------------------------------------------
// triggerSync — 04 §1.7 (SyncStatus "Sync now" buttons in /admin/projects, from S1.6 /admin, from
// S1.8 /admin/mentions and, from S1.9, /admin/stats)
// ---------------------------------------------------------------------------------------------

export async function triggerSync(input: TriggerSyncInput): Promise<ActionResult<JobSummary>> {
  return runAction('triggerSync', triggerSyncInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');

    const summary = await JOBS[data.source]({ trigger: 'manual', full: data.full });
    // SC-13 lock skip at the job → `conflict` at this action (04 §1.7 Returns cell).
    if (summary.skipped === 'running') return fail('conflict', 'Already running.');

    log.info({
      action: 'triggerSync',
      id: ctx.id,
      msg: 'admin',
      meta: {
        actor_profile_id: user.id,
        target_type: 'sync_run',
        target_id: summary.run_id,
        fields: Object.keys(data),
      },
    });
    return ok(summary);
  });
}
