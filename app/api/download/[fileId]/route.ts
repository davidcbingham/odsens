/**
 * `/api/download/[fileId]` — counted direct downloads behind 60 s signed URLs (04 §2.3 D1–D7;
 * 02 §2.9; 01 INV-55/INV-56; ADR-0002 C8 / C13 / C14 / C17; 05 T-ACT-43 / T-ACT-44; kind `skin`
 * arrives S1.7, `workroom_file` S2.3 — `lib/files.ts resolveDownloadable` owns the kind table).
 *
 * GET only — HEAD would double-count, so HEAD/POST/others → 405 (`Allow: GET`; same `validation`
 * JSON convention as the cron routes). Flow: uuid check (D1) → `resolveDownloadable` (D2 — 404 for
 * unknown/draft/hidden/synced, never 403: drafts are not revealed) → rate limit 30 / min per
 * `ip_hash` (D3 — scope `download` on `rate_limit_hits`; 429 JSON + `Retry-After: 60`) → RPC
 * `record_download` (D4 — counters + hashed log row in one statement) → signed URL, TTL 60 s,
 * `download: <filename>` (D5) → 302 with `Cache-Control: private, no-store`,
 * `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (D6). A signed-URL failure
 * after the counters is a logged 500 `internal` (04 §2.3 Errors row). Analytics fire client-side
 * on the button (`TrackedLink`), never here (D7). Raw IP/UA never stored or logged (SC-17).
 */
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ERROR_STATUS, fail } from '@/lib/actions/result';
import { createDownloadUrl, resolveDownloadable } from '@/lib/files';
import { ipHash, uaHash } from '@/lib/hash';
import { log } from '@/lib/log';
import { RateLimitError, assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function notFound(): NextResponse {
  return NextResponse.json(fail('not_found', 'Nothing here.'), {
    status: ERROR_STATUS.not_found,
    headers: NO_STORE,
  });
}

/** First hop of `x-forwarded-for` (Vercel sets it; local dev falls back to a loopback marker). */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }
  return request.headers.get('x-real-ip') ?? '127.0.0.1';
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> },
): Promise<NextResponse> {
  const { fileId } = await context.params;
  const id = fileId.toLowerCase();
  if (!UUID_RE.test(id)) return notFound(); // D1

  const requestId = randomUUID();
  try {
    const downloadable = await resolveDownloadable(id); // D2
    if (downloadable === null) return notFound();

    const ip = ipHash(clientIp(request));
    const ua = uaHash(request.headers.get('user-agent') ?? '');

    try {
      await assertRateLimit('download', ip); // D3 — 30 / min / ip_hash
    } catch (error) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(fail('rate_limited', error.message), {
          status: ERROR_STATUS.rate_limited,
          headers: { ...NO_STORE, 'Retry-After': '60' },
        });
      }
      throw error;
    }

    // D4 — counters + log in one SQL statement (RPC per kind; `record_skin_download` joins S1.7).
    const admin = createAdminClient();
    const { error: rpcError } = await admin.rpc(downloadable.counter, {
      p_file_id: id,
      p_ip_hash: ip,
      p_ua_hash: ua,
    });
    if (rpcError) throw new Error(`${downloadable.counter} failed: ${rpcError.code}`);

    // D5/D6 — 60 s signed URL with Content-Disposition attachment, then 302.
    const url = await createDownloadUrl(
      downloadable.bucket,
      downloadable.path,
      downloadable.filename,
    );
    return new NextResponse(null, {
      status: 302,
      headers: {
        Location: url,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    // Counters may already be incremented (acceptable — 04 §2.3 Errors row); one line, no URLs.
    log.error({
      action: 'download',
      id: requestId,
      msg: 'route_unhandled',
      meta: { name: error instanceof Error ? error.name : 'unknown' },
    });
    return NextResponse.json(fail('internal', 'Something broke.'), {
      status: ERROR_STATUS.internal,
      headers: NO_STORE,
    });
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
