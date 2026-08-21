/**
 * tests/e2e/flows/sign-in-start.spec.ts — T-E2E-16: clicking "Sign in" in the nav
 * (`GoogleSignInButton`, client `signInWithOAuth` — ADR-0002 C3, no `/auth/sign-in` route) starts
 * the OAuth flow at the LOCAL Supabase `/auth/v1/authorize?provider=google…` with
 * `redirect_to = NEXT_PUBLIC_SITE_URL + '/auth/callback?next=…'`; the Google leg is aborted by the
 * fixture (H-10); no session is created; `trackEvent('sign_in', { from: 'nav' })` reaches the
 * `window.va` stub (04 §5.6; ADR-0002 C12).
 */
import { test, expect } from '../fixtures';
import { loadEnvTest, requireTestEnv } from '../../helpers/envTest';

const AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

type VaCall = [kind: string, payload: unknown];

test.describe('sign-in start', () => {
  test('T-E2E-16 nav Sign in → local /auth/v1/authorize?provider=google, va sign_in {from:nav}, no session', async ({
    page,
    context,
  }) => {
    loadEnvTest();
    const supabaseHost = new URL(requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')).host;
    const siteUrl = requireTestEnv('NEXT_PUBLIC_SITE_URL');

    // `window.va` stub: calls are forwarded to Node synchronously, so they survive the navigation.
    const vaCalls: VaCall[] = [];
    await page.exposeFunction('__odsensVa', (kind: string, payload: unknown) => {
      vaCalls.push([kind, payload]);
    });
    await page.addInitScript(() => {
      type Stubbed = Window & {
        va?: (kind: string, payload: unknown) => void;
        __odsensVa?: (kind: string, payload: unknown) => Promise<void>;
      };
      const w = window as Stubbed;
      w.va = (kind, payload) => {
        void w.__odsensVa?.(kind, payload);
      };
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    const signIn = page.locator('header nav').getByRole('button', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute('data-variant', 'outlined');

    const authorize = page.waitForRequest((req) =>
      new URL(req.url()).pathname.endsWith('/auth/v1/authorize'),
    );
    await signIn.click();
    const started = new URL((await authorize).url());
    expect(started.host).toBe(supabaseHost);
    expect(started.searchParams.get('provider')).toBe('google');
    expect(started.searchParams.get('redirect_to')).toBe(`${siteUrl}/auth/callback?next=%2F`);

    await expect.poll(() => vaCalls.length).toBeGreaterThan(0);
    expect(vaCalls).toEqual([['event', { name: 'sign_in', data: { from: 'nav' } }]]);

    // No session: the PKCE verifier cookie may exist, an `sb-*-auth-token` never does.
    const cookies = await context.cookies();
    expect(cookies.filter((c) => AUTH_COOKIE.test(c.name))).toEqual([]);
    expect((await page.request.get('/profile', { maxRedirects: 0 })).status()).toBe(307);
  });
});
