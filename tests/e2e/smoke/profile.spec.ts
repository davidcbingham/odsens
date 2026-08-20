/**
 * tests/e2e/smoke/profile.spec.ts — `/profile` for an onboarded user (02 §2.5; DESIGN.md §11.3 #11;
 * 00 S1.1.AC5). Smoke only — renames / pictures / delete are tests/e2e/flows/profile.spec.ts
 * (T-E2E-23). Signs in as `seed_user2` (`user0`), which no flow mutates, so the screenshot shows
 * the seed handle. axe + screenshot at both viewports (H-8).
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { loginAs } from '../../helpers/loginAs';
import { shoot } from '../../helpers/screenshots';

test.describe('profile', () => {
  test('/profile → 200, YOUR PROFILE, picture + handle rows, Delete account, noindex · axe · screenshot', async ({
    page,
  }) => {
    await loginAs(page, 'user0');
    const response = await page.goto('/profile');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page).toHaveTitle('Your profile — odsens');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('YOUR PROFILE');
    await expect(page.getByRole('heading', { level: 2, name: 'Picture' })).toBeVisible();
    await expect(page.locator('form#picture')).toHaveCount(1);
    await expect(page.locator('form#handle')).toHaveCount(1);
    await expect(page.getByLabel('Handle', { exact: true })).toHaveValue('seed_user2');
    await expect(page.getByRole('button', { name: 'SAVE' })).toBeDisabled();
    await expect(
      page.getByText("Changing it renames you on every comment you've left."),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'What we store' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeVisible();

    // Signed-in nav: the ProfileMenu trigger carries the handle (03 N-04).
    await expect(page.locator('header nav button[aria-haspopup="menu"]')).toContainText(
      'seed_user2',
    );

    await expectNoSeriousA11y(page);
    await shoot(page, 'profile');
  });
});
