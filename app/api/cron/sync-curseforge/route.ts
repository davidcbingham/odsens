/**
 * `/api/cron/sync-curseforge` — thin wrapper `route → lib/jobs/syncCurseforge()` (04 §2.4; SC-12;
 * SC-13 via the job; SC-16 no-key degradation in the job; 01 INV-41 no-store; ADR-0002 C15
 * maxDuration; 05 T-ACT-33, T-ACT-71; vercel.json schedule `17 * * * *`, 04 §6).
 *
 * GET only — POST/HEAD/others → 405 (`Allow: GET`; JSON code `validation`, the status carries the
 * meaning). Auth: `Authorization: Bearer ${CRON_SECRET}` via `cronAuth` → else 401
 * `{ok:false, error:{code:'unauthorized', message:'Nope.'}}` with no side effects. Success → 200
 * `JobSummary` (lock skip `{ok:true, skipped:'running'}` and the no-key run
 * `{ok:true, items:0, skipped:'not_configured'}` are both 200). Failure → 500
 * `{ok:false, source, run_id, error:{code:'job_failed', message}}` — already recorded in
 * `sync_runs` by the job (SC-11). `triggerSync` calls the job function directly (01 INV-72).
 */
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ERROR_STATUS, fail } from '@/lib/actions/result';
import { cronAuth } from '@/lib/jobs/cronAuth';
import { syncCurseforge } from '@/lib/jobs/syncCurseforge';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!cronAuth(request)) {
    return NextResponse.json(fail('unauthorized', 'Nope.'), {
      status: ERROR_STATUS.unauthorized,
      headers: NO_STORE,
    });
  }
  try {
    const summary = await syncCurseforge({ trigger: 'cron' });
    if (!summary.ok) {
      return NextResponse.json(
        {
          ok: false,
          source: summary.source,
          run_id: summary.run_id,
          error: { code: 'job_failed', message: summary.error ?? 'Job failed.' },
        },
        { status: ERROR_STATUS.job_failed, headers: NO_STORE },
      );
    }
    return NextResponse.json(summary, { headers: NO_STORE });
  } catch (error) {
    // Jobs finalize their own row and return `ok:false` instead of throwing; this is a last resort.
    log.error({
      job: 'syncCurseforge',
      id: randomUUID(),
      msg: 'route_unhandled',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json(
      { ok: false, source: 'curseforge', run_id: '', error: { code: 'job_failed', message: 'Job failed.' } },
      { status: ERROR_STATUS.job_failed, headers: NO_STORE },
    );
  }
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(fail('validation', 'GET only.'), {
    status: 405,
    headers: { ...NO_STORE, Allow: 'GET' },
  });
}

export function POST(): NextResponse {
  return methodNotAllowed();
}
export function HEAD(): NextResponse {
  return methodNotAllowed();
}
export function PUT(): NextResponse {
  return methodNotAllowed();
}
export function PATCH(): NextResponse {
  return methodNotAllowed();
}
export function DELETE(): NextResponse {
  return methodNotAllowed();
}
