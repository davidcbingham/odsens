/**
 * tests/e2e/flows/sign-out.spec.ts — T-E2E-32: ProfileMenu → Sign out (danger, behind the top
 * border; `<form method="post" action="/auth/sign-out">` — 01 INV-17) → POST → 303 `/` → the nav
 * shows "Sign in" and the session cookies are gone (04 §2.2; DESIGN.md §11.1 Profile menu).
 */
import { test, expect } from '../fixtures';
import { loginAs } from '../../helpers/loginAs';

const AUTH_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;
const DANGER = 'rgb(240, 131, 107)'; // --danger #f0836b

test.describe('sign-out', () => {
  test('T-E2E-32 ProfileMenu → Sign out → POST /auth/sign-out 303 → nav shows Sign in', async ({
    page,
    context,
  }) => {
    await loginAs(page, 'user0');
    await page.goto('/');

    const trigger = page.locator('header nav button[aria-haspopup="menu"]');
    await expect(trigger).toContainText('seed_user2');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toBeVisible();
    const items = await menu
      .getByRole('menuitem')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
    expect(items).toEqual(['Your profile', 'Change handle', 'Change picture', 'Sign out']);

    const signOut = menu.getByRole('menuitem', { name: 'Sign out' });
    const look = await signOut.evaluate((el) => {
      const form = el.closest('form') as HTMLFormElement;
      const cs = getComputedStyle(form);
      return {
        color: getComputedStyle(el).color,
        method: form.method,
        action: new URL(form.action).pathname,
        borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
      };
    });
    expect(look).toEqual({
      color: DANGER,
      method: 'post',
      action: '/auth/sign-out',
      borderTop: '2px solid',
    });

    const posted = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' && new URL(res.url()).pathname === '/auth/sign-out',
    );
    await signOut.click();
    const response = await posted;
    expect(response.status()).toBe(303);
    expect(new URL(response.headers()['location'] ?? '', page.url()).pathname).toBe('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('header nav').getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('header nav button[aria-haspopup="menu"]')).toHaveCount(0);

    const cookies = await context.cookies();
    expect(cookies.filter((c) => AUTH_COOKIE.test(c.name))).toEqual([]);
    // And the server agrees: `/profile` is anon-bounced again (02 M1).
    expect((await page.request.get('/profile', { maxRedirects: 0 })).status()).toBe(307);
  });
});
