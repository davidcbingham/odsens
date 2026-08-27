/**
 * tests/e2e/flows/admin-gate.spec.ts — T-E2E-33: the `/admin` role gate (02 §4, RP-14; ADR-0002
 * C2/C4; 01 INV-31). anon → HTTP 200 `AdminGate`; `user` → the root 404 (same body as T-E2E-14);
 * `mod` → `AdminShell` sidebar without Settings; `admin` → with Settings; `/admin/settings` does not
 * exist until S1.5 → 404 for everyone.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { loginAs } from '../../helpers/loginAs';

const MOD_ORDER = ['Comments', 'Projects', 'Skins', 'Art', 'Mentions', 'Stats'];
const ADMIN_ORDER = [...MOD_ORDER, 'Settings'];

async function sidebarLabels(page: Page): Promise<string[]> {
  return page
    .locator('nav[aria-label="Admin"] a')
    .evaluateAll((els) =>
      els.map((el) => (el.querySelector('span')?.textContent ?? el.textContent ?? '').trim()),
    );
}

async function h1Text(page: Page): Promise<string> {
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1);
  return ((await h1.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

test.describe('admin gate', () => {
  test('T-E2E-33 anon /admin → 200 AdminGate (ADMINS ONLY + chalk Google button), noindex', async ({
    page,
    request,
  }) => {
    const raw = await request.get('/admin', { maxRedirects: 0 });
    expect(raw.status()).toBe(200);
    expect(raw.headers()['x-robots-tag']).toBe('noindex, nofollow');

    const response = await page.goto('/admin');
    expect(response?.status()).toBe(200);
    expect(await h1Text(page)).toBe('ADMINS ONLY');
    const google = page.getByRole('button', { name: 'Continue with Google' });
    await expect(google).toHaveAttribute('data-variant', 'chalk');
    await expect(page.locator('nav[aria-label="Admin"]')).toHaveCount(0);
    expect(await page.locator('main#main').getByRole('link').count()).toBe(0);
  });

  test('T-E2E-33 user /admin and /admin/comments → root 404 (same body as T-E2E-14)', async ({
    page,
  }) => {
    const random = Math.random().toString(36).slice(2, 10);
    await page.goto(`/nope-${random}`);
    const reference = await h1Text(page);
    expect(reference.toLowerCase()).toContain("that page doesn't exist");

    await loginAs(page, 'user');
    for (const path of ['/admin', '/admin/comments']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      expect(await h1Text(page), path).toBe(reference);
      await expect(page.getByText('Probably never did.')).toBeVisible();
      await expect(page.getByText('ADMINS ONLY')).toHaveCount(0);
      await expect(page.locator('nav[aria-label="Admin"]')).toHaveCount(0);
      await expect(page.getByText(/not allowed/i)).toHaveCount(0);
    }
  });

  test('T-E2E-33 mod /admin → AdminShell, sidebar without Settings; /admin/settings → 404', async ({
    page,
  }) => {
    await loginAs(page, 'mod');
    const response = await page.goto('/admin');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Admin — odsens');
    expect(await sidebarLabels(page)).toEqual(MOD_ORDER);
    // Comments carries the held count (0 until S1.4).
    await expect(page.locator('nav[aria-label="Admin"] a[href="/admin/comments"]')).toContainText(
      '0',
    );
    // The S1.2 dashboard renders inside the shell (02 §1.3 `/admin` row: SyncStatus + tiles).
    await expect(page.getByRole('heading', { name: 'SYNC' })).toBeVisible();
    await expect(page.locator('header button[aria-haspopup="menu"]')).toContainText('seed_mod');

    const settings = await page.goto('/admin/settings');
    expect(settings?.status()).toBe(404);
    expect((await h1Text(page)).toLowerCase()).toContain("that page doesn't exist");
  });

  test('T-E2E-33 admin /admin → 200, sidebar with Settings; /admin/settings → 404 until S1.5', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    const response = await page.goto('/admin');
    expect(response?.status()).toBe(200);
    expect(await sidebarLabels(page)).toEqual(ADMIN_ORDER);
    await expect(page.locator('nav[aria-label="Admin"] a[href="/admin/settings"]')).toHaveText(
      'Settings',
    );
    await expect(page.locator('header button[aria-haspopup="menu"]')).toContainText('oddsense');

    // ADR-0002 C2: the route itself arrives in S1.5.
    const settings = await page.goto('/admin/settings');
    expect(settings?.status()).toBe(404);
  });
});
