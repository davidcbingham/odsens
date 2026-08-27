/**
 * tests/e2e/smoke/admin.spec.ts — the anonymous `/admin` gate (02 §4; DESIGN.md §11.3 #18;
 * ADR-0002 C4; T-E2E-33 gate part): HTTP 200, "ADMINS ONLY" + the chalk Google button, nothing else.
 * Role variants are tests/e2e/flows/admin-gate.spec.ts. axe + screenshot at both viewports (H-8).
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

test.describe('admin gate', () => {
  test('anon /admin → 200 AdminGate: ADMINS ONLY + chalk Google button, nothing else · axe · screenshot', async ({
    page,
  }) => {
    const response = await page.goto('/admin');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page).toHaveTitle('Admin — odsens');

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('ADMINS ONLY');

    const google = page.getByRole('button', { name: 'Continue with Google' });
    await expect(google).toBeVisible();
    await expect(google).toHaveAttribute('data-variant', 'chalk');

    // Nothing else: one heading, one button, no links, no nav / footer / admin sidebar.
    const main = page.locator('main#main');
    await expect(main).toHaveCount(1);
    expect(await main.getByRole('heading').count()).toBe(1);
    expect(await main.getByRole('button').count()).toBe(1);
    expect(await main.getByRole('link').count()).toBe(0);
    await expect(page.locator('nav')).toHaveCount(0);
    await expect(page.locator('footer')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'SYNC' })).toHaveCount(0);

    await expectNoSeriousA11y(page);
    await shoot(page, 'admin-gate');
  });
});
