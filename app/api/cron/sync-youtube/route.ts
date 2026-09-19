/**
 * `/api/cron/sync-youtube` — thin wrapper `route → lib/jobs/syncYoutube()` (04 §2.4; SC-12; SC-13
 * via the job; 01 INV-41 no-store; ADR-0002 C15 maxDuration 300; 02 §1.4 / §2.10; 05 T-ACT-33;
 * vercel.json schedule `27 * * * *`, 04 §6).
 *
 * GET only — POST/HEAD/others → 405 (`Allow: GET`; 04 §7 has no method-not-allowed code, so the
 * JSON uses `validation` while the status carries the meaning, as `/auth/sign-out` does).
 * Auth: `Authorization: Bearer ${CRON_SECRET}` via `cronAuth` (`crypto.timingSafeEqual`,
 * length-checked first) → else 401 `{ok:false, error:{code:'unauthorized', message:'Nope.'}}` with
 * no side effects (no `sync_runs` row, no upstream request). Query: `?full=1` — the one cron route
 * with a parameter (04 §2.4 "youtube only, admin/manual use"): the job walks the uploads playlist
 * before `videos.list` (04 §3.3 step 3). The trigger stays `'cron'` — `'manual'` is `triggerSync`'s.
 * Success → 200 `JobSummary` (an SC-13 lock skip is `{ok:true, skipped:'running'}`, still 200; the
 * no-key run is `{ok:true, degraded:'no_key'}`, 05 T-ACT-71). Failure → 500
 * `{ok:false, source, run_id, error:{code:'job_failed', message}}` — the run is already recorded in
 * `sync_runs` by the job (SC-11) and `sync.failed` emitted per J-F. `triggerSync` calls the job
 * function directly, never this route (01 INV-72).
 */
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ERROR_STATUS, fail } from '@/lib/actions/result';
import { cronAuth } from '@/lib/jobs/cronAuth';
import { syncYoutube } from '@/lib/jobs/syncYoutube';
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
    // 04 §2.4 / 02 §2.10: `?full=1` walks the whole uploads playlist; any other value is a plain run.
    const full = request.nextUrl.searchParams.get('full') === '1';
    const summary = await syncYoutube({ trigger: 'cron', full });
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
      job: 'syncYoutube',
      id: randomUUID(),
      msg: 'route_unhandled',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json(
      {
        ok: false,
        source: 'youtube',
        run_id: '',
        error: { code: 'job_failed', message: 'Job failed.' },
      },
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
