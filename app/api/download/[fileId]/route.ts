/**
 * `/api/download/[fileId]` — counted direct downloads (04 §2.3 D1–D7; 02 §2.9; 01 INV-55/INV-56;
 * ADR-0002 C8 / C13 / C14 / C17; 05 T-ACT-43 / T-ACT-44 / T-ACT-76; ADR-0048 D1). Kinds
 * `project_file` (S1.3) and `skin` (S1.7); `workroom_file` S2.3 — `lib/files.ts resolveDownloadable`
 * owns the kind table and the route never branches on `kind`.
 *
 * GET only — HEAD would double-count, so HEAD/POST/others → 405 (`Allow: GET`; same `validation`
 * JSON convention as the cron routes). Flow: uuid check (D1) → `resolveDownloadable` (D2 — 404 for
 * unknown/draft/hidden/synced, never 403: drafts are not revealed) → rate limit 30 / min per
 * `ip_hash` (D3 — scope `download` on `rate_limit_hits`, one scope for every kind; 429 JSON +
 * `Retry-After: 60`) → the kind's counter RPC with `counterArgs` (D4 — `record_download` = counters
 * + hashed log row in one statement; `record_skin_download` = `skins.downloads + 1`, fail-closed on
 * an unpublished row) → the URL step `urlKind` names: a 60 s signed URL with `download: <filename>`
 * for a private bucket, or the public object URL with `?download=<filename>` for a public one (D5)
 * → 302 with `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`,
 * `Referrer-Policy: no-referrer` (D6 — identical for both kinds). A URL-step failure after the
 * counters is a logged 500 `internal` (04 §2.3 Errors row); so is a counter RPC that raises. Analytics
 * fire client-side on the button (`TrackedLink`), never here (D7). Raw IP/UA never stored or logged (SC-17).
 */
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { ERROR_STATUS, fail } from '@/lib/actions/result';
import {
  counterArgs,
  createDownloadUrl,
  publicDownloadUrl,
  resolveDownloadable,
} from '@/lib/files';
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

    // D4 — the kind's counter RPC, one SQL statement each (`counterArgs` builds the payload the
    // counter takes; supabase-js types `rpc` per literal name, so the union call is cast once here).
    const admin = createAdminClient();
    const { error: rpcError } = await admin.rpc(
      downloadable.counter,
      counterArgs(downloadable, { id, ipHash: ip, uaHash: ua }) as never,
    );
    if (rpcError) throw new Error(`${downloadable.counter} failed: ${rpcError.code}`);

    // D5/D6 — the URL step per `urlKind` (signed 60 s + `download:` for a private bucket, the
    // public object URL + `?download=` for a public one), then the same 302 for every kind.
    const url =
      downloadable.urlKind === 'signed'
        ? await createDownloadUrl(downloadable.bucket, downloadable.path, downloadable.filename)
        : publicDownloadUrl(downloadable.bucket, downloadable.path, downloadable.filename);
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
// Without this, Next auto-answers OPTIONS 204 with an Allow header listing every export above —
// actively misleading for a GET-only route (ADR-0002 C17 "others → 405").
export function OPTIONS(): NextResponse {
  return methodNotAllowed();
}
