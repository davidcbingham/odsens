/**
 * tests/helpers/loginAs.ts — `loginAs(page, role)` (docs/build/05-test-plan.md §1.3, H-9).
 *
 * Signs a SEED-3 user in on the LOCAL stack (password auth, `seed-password`) through a Node
 * `@supabase/ssr` server client whose cookie adapter collects `setAll` (tests/helpers/sessionCookies.ts),
 * then injects those cookies into the Playwright context for the app origin — the same names/chunks/
 * encoding `lib/supabase/server.ts` and `proxy.ts` read. No browser round-trip to Google (H-10).
 *
 * Refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` points at 127.0.0.1/localhost (H-9) AND the app
 * origin (`PLAYWRIGHT_BASE_URL`, default http://localhost:3000) is local too: production Auth stays
 * Google-only and a seeded session is never injected into a real deployment. The app under test must
 * run with the same `NEXT_PUBLIC_SUPABASE_URL` as `.env.test` (the cookie name derives from it) —
 * playwright.config.ts `webServer.env` takes care of that for `pnpm start`.
 *
 *   await loginAs(page, 'user');   // then page.goto('/profile')
 *   await logout(page);            // clears the context's cookies
 */
import type { Page } from '@playwright/test';
import type { SeedRole } from './asRole';
import { assertLocalSupabase, loadEnvTest, requireTestEnv } from './envTest';
import { seedSessionCookies, userSessionCookies } from './sessionCookies';

export type { SeedRole } from './asRole';

export type LoginAs = (page: Page, role: SeedRole) => Promise<void>;

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function appOrigin(): URL {
  return new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000');
}

async function inject(
  page: Page,
  cookies: Awaited<ReturnType<typeof seedSessionCookies>>,
): Promise<void> {
  const origin = appOrigin();
  await page.context().addCookies(
    cookies.map(({ name, value, options }) => ({
      name,
      value,
      domain: origin.hostname,
      path: options.path ?? '/',
      httpOnly: options.httpOnly ?? false,
      secure: origin.protocol === 'https:',
      sameSite: 'Lax' as const,
    })),
  );
}

function guard(): void {
  loadEnvTest();
  assertLocalSupabase(requireTestEnv('NEXT_PUBLIC_SUPABASE_URL'), 'loginAs');
  const { hostname } = appOrigin();
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `loginAs: refusing to inject a seeded session into non-local app origin "${hostname}" (05 H-9).`,
    );
  }
}

export const loginAs: LoginAs = async (page, role) => {
  guard();
  await inject(page, await seedSessionCookies(role));
};

/** Same for a factory-created user (tests/helpers/factories.ts `makeUser` — db project only, normally). */
export async function loginAsUser(page: Page, profileId: string): Promise<void> {
  guard();
  await inject(page, await userSessionCookies(profileId));
}

/** Drops every cookie in the context (the app sees anon again). */
export async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
}
