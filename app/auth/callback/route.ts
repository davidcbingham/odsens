/**
 * `/auth/callback` — Supabase OAuth code exchange (04 §2.1 A1–A4; 02 §4; ADR-0002 C18, A14, A17).
 *
 * A1  read `code` + `safeNext(next)`; no code → 307 `/`.
 * A2  `exchangeCodeForSession(code)` on the cookie client; error → `log.warn` + 307 `/` (no query param).
 * A3a if `profiles.email_hash` is null, set it = `emailHash(user.email)` (`lib/hash.ts`, HMAC keyed by
 *     `HASH_SECRET`) via the service client — the DB trigger cannot read env (ADR-0002 A14). The
 *     email itself is never logged or returned; a failed stamp is logged (by profile id) and ignored.
 * A3  `getProfile()` — handle null → 307 `/welcome?next=<next>`, else 307 `<next>` (same-origin via
 *     `safeNext`).
 * A4  every response carries `Cache-Control: no-store` (01 INV-41); the session cookies written by
 *     the SSR client through `cookies()` propagate to the redirect response.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getProfile, safeNext } from '@/lib/auth';
import { env } from '@/lib/env';
import { emailHash } from '@/lib/hash';
import { log } from '@/lib/log';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, env.NEXT_PUBLIC_SITE_URL), {
    status: 307,
    headers: NO_STORE,
  });
}

/** A3a — service-role write, only when the column is still null (idempotent across sign-ins). */
async function stampEmailHash(
  userId: string,
  email: string | undefined,
  requestId: string,
): Promise<void> {
  if (!email) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ email_hash: emailHash(email) })
    .eq('id', userId)
    .is('email_hash', null);
  if (error) {
    log.warn({
      action: 'auth_callback',
      id: requestId,
      msg: 'email_hash_failed',
      meta: { profile_id: userId, code: error.code },
    });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  if (!code) return redirectTo('/');

  const requestId = crypto.randomUUID();
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    log.warn({ action: 'auth_callback', id: requestId, msg: 'exchange_failed' });
    return redirectTo('/');
  }

  await stampEmailHash(data.user.id, data.user.email, requestId);

  const profile = await getProfile();
  if (!profile || profile.handle === null) {
    return redirectTo(`/welcome?next=${encodeURIComponent(next)}`);
  }
  return redirectTo(next);
}
