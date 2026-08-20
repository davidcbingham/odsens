/**
 * `/auth/callback` — Supabase OAuth code exchange (04 §2.1 A1–A4; 02 §4; ADR-0002 C18, A14, A17).
 *
 * A1 read `code` + `safeNext(next)`; no code → 307 `/`.
 * A2 `exchangeCodeForSession(code)` on the cookie client; error → `log.warn` + 307 `/` (no query param).
 * A3 `getProfile()` — handle null → 307 `/welcome?next=<next>`, else 307 `<next>` (same-origin via
 *    `safeNext`). At S0 `getProfile()` is always null (no `profiles` table yet); the `email_hash`
 *    step A3a (service client, `lib/hash.ts`) lands in S1.1.
 * A4 every response carries `Cache-Control: no-store` (01 INV-41); the session cookies written by
 *    the SSR client through `cookies()` propagate to the redirect response.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getProfile, safeNext } from '@/lib/auth';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  if (!code) return redirectTo('/');

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    log.warn({ action: 'auth_callback', id: crypto.randomUUID(), msg: 'exchange_failed' });
    return redirectTo('/');
  }

  const profile = await getProfile();
  if (!profile || profile.handle === null) {
    return redirectTo(`/welcome?next=${encodeURIComponent(next)}`);
  }
  return redirectTo(next);
}
