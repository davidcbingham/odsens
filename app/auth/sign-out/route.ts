/**
 * `/auth/sign-out` — POST only (04 §2.2; 02 §1.2 / §4; ADR-0002 C3, A17; T-E2E-46).
 *
 * POST: the `Origin` header (fallback: the `Referer` origin) must match a host this deployment
 * answers on — the host the request was actually addressed to (`request.nextUrl.host`) or the
 * configured `NEXT_PUBLIC_SITE_URL` host — else 403 `{ ok:false, error:{ code:'forbidden' } }`
 * (CSRF — CSP `form-action 'self'` is the second layer, 01 INV-77). Then `auth.signOut()` on the
 * cookie client → 303 back to `/` on the host the request came in on (ADR-0031: comparing only
 * against the env host 403'd every logout while production served `www.odsens.com` and
 * `NEXT_PUBLIC_SITE_URL` was the apex).
 *
 * Every other method → 405 with `Allow: POST`. 04 §7 has no method-not-allowed code, so the JSON
 * body uses `validation` ("POST only.") while the HTTP status carries the meaning — 02 SM-22 /
 * T-E2E-46 assert the status only. All responses: `Cache-Control: no-store` (01 INV-41).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ERROR_STATUS, fail } from '@/lib/actions/result';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** `Origin`, or the origin of `Referer` when a browser omitted `Origin`; `null` when neither parses. */
function requestOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Hosts this deployment answers on: the one the request was addressed to (the OWASP same-origin
 * check — Next resolves it from the forwarded host, so on Vercel it is the public domain) plus the
 * configured site host, which keeps the frozen 04 §2.2 comparison working. Both are ours; a
 * cross-site form cannot set `Origin`, so neither clause admits a foreign origin (ADR-0031).
 */
function acceptedHosts(request: NextRequest): string[] {
  const hosts = [request.nextUrl.host];
  try {
    hosts.push(new URL(env.NEXT_PUBLIC_SITE_URL).host);
  } catch {
    // A malformed NEXT_PUBLIC_SITE_URL cannot reach here (lib/env.ts validates it at boot).
  }
  return hosts.filter(Boolean);
}

function isSameSite(origin: string | null, request: NextRequest): boolean {
  if (!origin) return false;
  try {
    return acceptedHosts(request).includes(new URL(origin).host);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameSite(requestOrigin(request), request)) {
    return NextResponse.json(fail('forbidden', 'Nope.'), {
      status: ERROR_STATUS.forbidden,
      headers: NO_STORE,
    });
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    // The cookies are cleared locally either way; the redirect still lands the user on `/`.
    log.warn({ action: 'auth_sign_out', id: crypto.randomUUID(), msg: 'sign_out_failed' });
  }
  // Back to `/` on the host the user is actually on — never a cross-host hop (ADR-0031).
  return NextResponse.redirect(new URL('/', request.nextUrl), {
    status: 303,
    headers: NO_STORE,
  });
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(fail('validation', 'POST only.'), {
    status: 405,
    headers: { ...NO_STORE, Allow: 'POST' },
  });
}

export function GET(): NextResponse {
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
