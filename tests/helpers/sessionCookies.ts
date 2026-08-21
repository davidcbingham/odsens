/**
 * tests/helpers/sessionCookies.ts — the Supabase auth cookies for a local-stack session, produced the
 * way the app produces them: an `@supabase/ssr` `createServerClient` whose cookie adapter collects
 * `setAll` into a jar, then `signInWithPassword`. Cookie names/chunking/encoding therefore match what
 * `lib/supabase/server.ts` and `proxy.ts` read (the name derives from `NEXT_PUBLIC_SUPABASE_URL`, so the
 * app under test must run with the same URL as `.env.test`).
 *
 * Used by `loginAs` (Playwright), `callAction` (mocked server client) and the proxy test (T-ACT-10).
 * Cached per identity for the process.
 */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/types';
import { credentialsFor, credentialsForUser, type Credentials, type SeedRole } from './asRole';
import { assertLocalSupabase, requireTestEnv } from './envTest';

export type SessionCookie = { name: string; value: string; options: CookieOptions };

const cache = new Map<string, SessionCookie[]>();

/** Signs `creds` in through an ssr server client and returns the cookies it set (chunks included). */
export async function collectSessionCookies(creds: Credentials): Promise<SessionCookie[]> {
  const cached = cache.get(creds.email);
  if (cached) return cached.map((c) => ({ ...c, options: { ...c.options } }));

  const url = requireTestEnv('NEXT_PUBLIC_SUPABASE_URL');
  assertLocalSupabase(url, 'sessionCookies');
  const jar = new Map<string, SessionCookie>();
  const client = createServerClient<Database>(
    url,
    requireTestEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      cookies: {
        getAll: () => [...jar.values()].map(({ name, value }) => ({ name, value })),
        setAll: (list) => {
          for (const { name, value, options } of list) {
            if (value === '' || options.maxAge === 0) jar.delete(name);
            else jar.set(name, { name, value, options });
          }
        },
      },
    },
  );
  const { error } = await client.auth.signInWithPassword(creds);
  if (error) {
    throw new Error(
      `sessionCookies: sign-in as ${creds.email} failed: ${error.message} — is SEED-3 applied (supabase db reset)?`,
    );
  }
  if (jar.size === 0) {
    throw new Error('sessionCookies: sign-in succeeded but @supabase/ssr set no cookies');
  }
  const cookies = [...jar.values()];
  cache.set(creds.email, cookies);
  return cookies.map((c) => ({ ...c, options: { ...c.options } }));
}

/** Cookies for a 05 §1.4 seed role. */
export function seedSessionCookies(role: SeedRole): Promise<SessionCookie[]> {
  return collectSessionCookies(credentialsFor(role));
}

/** Cookies for a factory-created user (tests/helpers/factories.ts `makeUser`). */
export function userSessionCookies(profileId: string): Promise<SessionCookie[]> {
  return collectSessionCookies(credentialsForUser(profileId));
}

export function forgetSessionCookies(email: string): void {
  cache.delete(email);
}

/** `Cookie:` request-header value — for invoking `proxy(request)` / route handlers with a session. */
export function cookieHeader(
  cookies: ReadonlyArray<Pick<SessionCookie, 'name' | 'value'>>,
): string {
  return cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
}
