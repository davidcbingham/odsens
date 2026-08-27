/**
 * tests/e2e/flows/banned.spec.ts — T-E2E-32 (banned account flow — ADR-0019, ADR-0021; 02 §1.2
 * `/banned`, §3 M4b; DESIGN.md §11.3 #19): a banned account's Google sign-in ends on `/banned` and
 * nowhere else. `loginAs('banned')` → `/` → 307 `/banned`: "YOU'RE BANNED", one line, and nothing but
 * the onboarding shell's wordmark + Sign out and (since ADR-0021, once onboarded) the Delete account
 * control (no nav, no footer, no Google button); `/profile`, `/admin`, `/welcome`, `/projects` 307
 * there too; Sign out → POST `/auth/sign-out` 303 → anon `/` with "Sign in" in the nav; anon on
 * `/banned` is sent home by the page. The delete leg runs on factory users only (deleting
 * `seed_banned` would break every later file): confirm → account gone → document navigation to anon
 * `/`; a banned account with a NULL handle sees no Delete control at all.
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { cleanupFactories, makeUser } from '../../helpers/factories';
import { loginAs, loginAsUser } from '../../helpers/loginAs';

const AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

test.describe('banned', () => {
  test.afterAll(async () => {
    await cleanupFactories();
  });

  test("T-E2E-32 banned → /banned (YOU'RE BANNED; wordmark + Sign out + Delete account only) → Sign out → anon /", async ({
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

    // No functionality (David, 2026-08-21) beyond leaving — and, since ADR-0021, leaving for good:
    // no nav, no footer, one link (the wordmark), Sign out in the shell, Delete account in the slab.
    await expect(page.locator('nav')).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    const header = page.locator('header');
    await expect(header.getByRole('link')).toHaveCount(1);
    await expect(header.getByRole('link')).toHaveText('ODSENS');
    const signOut = header.locator('form[action="/auth/sign-out"] button');
    await expect(signOut).toHaveText('Sign out');
    const main = page.locator('main#main');
    await expect(main.getByRole('link')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(1);
    await expect(main.getByRole('button')).toHaveText('Delete account');
    await expect(page.getByRole('button')).toHaveCount(2);
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

    // Sign out still works (01 INV-17 POST form; 04 §2.2 → 303 `/`) — the seed user is never deleted.
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

  test('T-E2E-32 banned self-delete (ADR-0021): Keep it closes; Delete it → account gone → anon /', async ({
    page,
    context,
  }) => {
    const profileId = await makeUser({ banned: true });
    await loginAsUser(page, profileId);
    await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/banned');

    const main = page.locator('main#main');
    const trigger = main.getByRole('button', { name: 'Delete account' });
    await trigger.click();
    const strip = main.getByRole('group');
    await expect(
      strip.getByText('Delete your account? Your handle, picture and comments go with it.'),
    ).toBeVisible();
    await expectNoSeriousA11y(page);

    // Keep it → strip closes, trigger is back, nothing happened.
    await strip.getByRole('button', { name: 'Keep it' }).click();
    await expect(trigger).toBeVisible();

    // Delete it → the action deletes the account and clears the cookies; the island leaves with a
    // document navigation, so the next paint is anon `/`.
    await trigger.click();
    await strip.getByRole('button', { name: 'Delete it' }).click();
    await page.waitForURL((url) => new URL(url).pathname === '/');
    await expect(page.locator('header nav').getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect((await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name))).toEqual([]);

    // Gone for real: the deleted session cannot come back (no auth user behind it any more).
    await page.goto('/banned');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('T-E2E-32 banned before onboarding (NULL handle): /banned shows no Delete control (ADR-0021)', async ({
    page,
  }) => {
    const profileId = await makeUser({ banned: true, handle: null });
    await loginAsUser(page, profileId);
    await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/banned');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("YOU'RE BANNED");
    await expect(page.locator('main#main').getByRole('button')).toHaveCount(0);
    await expect(page.locator('main#main').getByRole('link')).toHaveCount(0);
  });
});
