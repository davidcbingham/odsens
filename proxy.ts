/**
 * proxy.ts — session refresh + onboarding gate (02 §3 M1–M8, RP-19 / RP-20 / RP-21; 01 INV-30 /
 * INV-32; ADR-0009 — Next 16 names this file `proxy.ts`; the rules are the "middleware" rules).
 *
 * Named export `proxy(request)` (Next 16 convention; T-ACT-10 imports it) + the 02 §3 matcher
 * verbatim. No `runtime` export (Next 16 throws on it here); this runs on Node.js.
 *
 *   M1 no `sb-*-auth-token` cookie → no DB work: `/welcome`, `/profile` → 307 `/`; else pass through
 *   M2 cookie present → `auth.getUser()` (refreshes tokens; refreshed cookies ride on the response);
 *      invalid / expired → treated as M1
 *   M3 authenticated + `/auth/*` → pass through
 *   M3b non-GET/HEAD requests (Server Action POSTs) → pass through after the refresh: the action
 *      re-checks auth + onboarding itself (04 SC-04), and a 307 would make the browser re-POST the
 *      action body to the redirect target (ADR-0009 addendum)
 *   M4 read `profiles.handle, is_banned` for the user (one own-row query; NEVER `role`)
 *   M4b `is_banned` → path ∉ {`/banned`, `/auth/*` (already passed at M3), `/api/*`} → 307 `/banned`;
 *      else pass through. M5–M8 never run for a banned account, so one whose handle is still null
 *      lands on `/banned` too, never on `/welcome` (ADR-0019)
 *   M5 handle null + path ∉ {`/welcome`, `/privacy`, `/how-comments-work`, `/auth/*`, `/api/*`}
 *      → 307 `/welcome?next=<pathname+search>` (only when `next` passes RP-20, else plain `/welcome`)
 *   M6 handle set + `/welcome` → 307 `safeNext(next)`
 *   M7 `/admin*` → pass through (role gate is `app/admin/layout.tsx`)   M8 else pass through
 *
 * `@supabase/ssr` is imported here (not via `lib/supabase/server.ts`, whose cookie adapter is
 * `next/headers`) because the refresh must write cookies onto THIS response — the official
 * `createServerClient` + `NextResponse.next({ request })` pattern. Never imports the admin client.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import type { Database } from '@/lib/supabase/types';
import { safeNext } from '@/lib/validation/next';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|fonts/|brand/|robots\\.txt|sitemap\\.xml|api/cron/|api/webhooks/|api/download/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2|txt|xml)$).*)',
  ],
};

/** `sb-<ref>-auth-token` and its chunks `…-auth-token.0`; the PKCE `…-code-verifier` cookie is not a session. */
const AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

/** M1: anon visitors are bounced off these two (02 §3; ADR-0002 #37). */
const ANON_REDIRECT_PATHS: ReadonlySet<string> = new Set(['/welcome', '/profile']);

/** M5 exemptions (RP-21): an un-onboarded user may still see these. */
const ONBOARDING_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/welcome',
  '/privacy',
  '/how-comments-work',
]);
const ONBOARDING_EXEMPT_PREFIXES = ['/auth/', '/api/'] as const;

function isOnboardingExempt(pathname: string): boolean {
  if (ONBOARDING_EXEMPT_PATHS.has(pathname)) return true;
  return ONBOARDING_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** M4b (ADR-0019): all a banned account may still load — its page and `/api/*` (`/auth/*` passed at M3). */
function isBannedExempt(pathname: string): boolean {
  return pathname === '/banned' || pathname.startsWith('/api/');
}

function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => AUTH_COOKIE.test(cookie.name));
}

/** 307 to an in-app path, carrying any cookies the refresh wrote onto `from`. */
function redirect(request: NextRequest, path: string, from?: NextResponse): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 307);
  if (from) {
    for (const cookie of from.cookies.getAll()) response.cookies.set(cookie);
  }
  return response;
}

/** M1 behaviour, reused by the M2 "invalid session" branch. */
function anonResponse(request: NextRequest, pathname: string, from?: NextResponse): NextResponse {
  if (ANON_REDIRECT_PATHS.has(pathname)) return redirect(request, '/', from);
  return from ?? NextResponse.next({ request });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // Redirects (M1, M5, M6) apply to page navigations only — GET/HEAD documents and RSC fetches. A
  // Server Action POST is never redirected: the action re-checks auth and onboarding (04 SC-04), and a
  // 307 would make the browser re-POST the action to the redirect target (ADR-0009 addendum).
  const navigation = request.method === 'GET' || request.method === 'HEAD';

  // M1 — no session cookie: public traffic never touches Supabase.
  if (!hasAuthCookie(request))
    return navigation ? anonResponse(request, pathname) : NextResponse.next({ request });

  // M2 — refresh the session; cookies written by the client land on `response`.
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return navigation ? anonResponse(request, pathname, response) : response;

  // M3 — auth routes pass through for signed-in users (callback / sign-out).
  if (pathname.startsWith('/auth/')) return response;

  // M3b — non-navigation requests (Server Action POSTs) pass through with the refreshed cookies.
  if (!navigation) return response;

  // M4 — one own-row read: `handle` + `is_banned` (RP-19: never `role`).
  const { data: profile } = await supabase
    .from('profiles')
    .select('handle, is_banned')
    .eq('id', data.user.id)
    .maybeSingle();
  const handle = profile?.handle ?? null;

  // M4b — a banned account sees `/banned` and nothing else (ADR-0019). Before M5 on purpose: a banned
  // account whose handle is still null lands here, not on `/welcome`; M5–M8 do not apply to it.
  if (profile?.is_banned === true) {
    return isBannedExempt(pathname) ? response : redirect(request, '/banned', response);
  }

  // M5 — onboarding is mandatory everywhere except the exempt list.
  if (handle === null && !isOnboardingExempt(pathname)) {
    const candidate = `${pathname}${search}`;
    const next = safeNext(candidate);
    const target = next === candidate ? `/welcome?next=${encodeURIComponent(next)}` : '/welcome';
    return redirect(request, target, response);
  }

  // M6 — onboarded users do not see /welcome again.
  if (handle !== null && pathname === '/welcome') {
    return redirect(request, safeNext(request.nextUrl.searchParams.get('next')), response);
  }

  // M7 / M8 — pass through (the /admin role gate lives in app/admin/layout.tsx, INV-31).
  return response;
}
