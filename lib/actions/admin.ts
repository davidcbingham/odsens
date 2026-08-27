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
 * S1.2 wires `modrinth` and `curseforge`; `youtube` / `mentions` / `stats` are valid input
 * (05 T-ACT-42 enum) but their jobs land in S1.6 / S1.8 / S1.9 — until then they return
 * `upstream_error` (the §1.7 Returns cell's error for a sync that cannot run).
 *
 * SC-24: the `requireRole` call site logs `msg:'admin'` with meta keys only before returning
 * `ok:true`. Input schema lives in `./admin.schema.ts` (a `'use server'` module may export only
 * async functions).
 */
import { triggerSyncInput, type TriggerSyncInput } from '@/lib/actions/admin.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction } from '@/lib/actions/run';
import { requireRole } from '@/lib/auth';
import { syncCurseforge } from '@/lib/jobs/syncCurseforge';
import { syncModrinth } from '@/lib/jobs/syncModrinth';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import { log } from '@/lib/log';

/** Source → job function (01 INV-72). S1.6 adds `youtube`, S1.8 `mentions`, S1.9 `stats`. */
const JOBS: Partial<Record<TriggerSyncInput['source'], (opts: JobOptions) => Promise<JobSummary>>> =
  {
    modrinth: syncModrinth,
    curseforge: syncCurseforge,
  };

// ---------------------------------------------------------------------------------------------
// triggerSync — 04 §1.7 (SyncStatus "Sync now" buttons in /admin/projects)
// ---------------------------------------------------------------------------------------------

export async function triggerSync(input: TriggerSyncInput): Promise<ActionResult<JobSummary>> {
  return runAction('triggerSync', triggerSyncInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');

    const job = JOBS[data.source];
    if (job === undefined) {
      // S1.6 / S1.8 / S1.9 land these jobs; the enum already accepts the source (05 T-ACT-42).
      return fail('upstream_error', "That sync isn't built yet.");
    }

    const summary = await job({ trigger: 'manual', full: data.full });
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
