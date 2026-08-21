/**
 * tests/e2e/flows/banned.spec.ts — T-E2E-32 (banned account flow — ADR-0019; 02 §1.2 `/banned`, §3 M4b;
 * DESIGN.md §11.3 #19): a banned account's Google sign-in ends on `/banned` and nowhere else.
 * `loginAs('banned')` → `/` → 307 `/banned`: "YOU'RE BANNED", one line, and nothing but the onboarding
 * shell's wordmark + Sign out (no nav, no footer, no Google button); `/profile`, `/admin`, `/welcome`,
 * `/projects` 307 there too; Sign out → POST `/auth/sign-out` 303 → anon `/` with "Sign in" in the nav;
 * anon on `/banned` is sent home by the page.
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { loginAs } from '../../helpers/loginAs';

const AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

test.describe('banned', () => {
  test("T-E2E-32 banned → /banned (YOU'RE BANNED; wordmark + Sign out only) → Sign out → anon /", async ({
    page,
    context,
  }) => {
    await loginAs(page, 'banned');
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/banned');
    await expect(page).toHaveTitle('Banned — odsens');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText("YOU'RE BANNED");
    await expect(page.getByText("This account can't use odsens any more.")).toBeVisible();

    // No functionality (David, 2026-08-21): no nav, no footer, one link (the wordmark), one control (Sign out).
    await expect(page.locator('nav')).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    const header = page.locator('header');
    await expect(header.getByRole('link')).toHaveCount(1);
    await expect(header.getByRole('link')).toHaveText('ODSENS');
    const signOut = header.locator('form[action="/auth/sign-out"] button');
    await expect(signOut).toHaveText('Sign out');
    await expect(page.getByRole('button')).toHaveCount(1);
    const main = page.locator('main#main');
    await expect(main.getByRole('link')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);
    await expect(main.locator('input, textarea, select')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);

    await expectNoSeriousA11y(page);

    // Every other navigation of a banned account goes the same way (02 M4b) — the admin role gate and
    // the onboarding rule never get a look in.
    for (const path of ['/profile', '/admin', '/welcome', '/projects']) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      expect(new URL(res.headers()['location'] ?? '', page.url()).pathname, path).toBe('/banned');
    }

    // Sign out is the one thing that works (01 INV-17 POST form; 04 §2.2 → 303 `/`).
    const posted = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname === '/auth/sign-out',
    );
    await signOut.click();
    expect((await posted).status()).toBe(303);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('header nav').getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect((await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name))).toEqual([]);

    // Anon on /banned → the page (not the proxy, 02 M1) sends you home.
    await page.goto('/banned');
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
