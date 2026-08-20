/**
 * tests/e2e/smoke/shells.spec.ts — T-E2E-14 (404 shell, 02 SM-04) and T-E2E-15 (error boundary,
 * `/__test/throw` exists only when `E2E=1` — ADR-0002 #74). 00 S0.AC4; DESIGN.md §11.3 #13/#14.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const INDIGO = 'rgb(75, 69, 214)'; // --indigo #4B45D6

async function expectNotFoundShell(page: Page) {
  const code = page.getByText('404', { exact: true }).first();
  await expect(code).toBeVisible();
  const hidden = await code.evaluate((el) => el.closest('[aria-hidden="true"]') !== null);
  expect(hidden, 'the decorative "404" is aria-hidden').toBe(true);
  expect(await code.evaluate((el) => getComputedStyle(el).color)).toBe(INDIGO);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/that page doesn[’']t exist/i);
  await expect(page.getByText('Probably never did.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^go home$/i })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: /^see the projects$/i })).toHaveAttribute(
    'href',
    '/projects',
  );
}

test.describe('shells', () => {
  test('T-E2E-14 /nope-<random> and /projects/does-not-exist-404 → 404 shell', async ({ page }) => {
    const random = Math.random().toString(36).slice(2, 10);
    const response = await page.goto(`/nope-${random}`);
    expect(response?.status()).toBe(404);
    await expectNotFoundShell(page);

    const nested = await page.goto('/projects/does-not-exist-404');
    expect(nested?.status()).toBe(404);
    await expectNotFoundShell(page);

    await expectNoSeriousA11y(page);
    await shoot(page, 'not-found');
  });

  test('T-E2E-15 /__test/throw → error shell, no error codes shown', async ({ page }) => {
    await page.goto('/__test/throw');

    await expect(page.getByText(/something broke/i).first()).toBeVisible();
    await expect(
      page.getByText(
        "Not your fault. Reload and it's usually fine. If it isn't, it's on the list.",
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^reload$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^go home$/i })).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('digest');
    expect(body).not.toContain('Error:');
    expect(body).not.toContain('__test/throw');
    expect(body).not.toMatch(/^\s*at\s+\S+.*\(.*\)\s*$/m); // stack-trace lines

    await expectNoSeriousA11y(page);
    await shoot(page, 'error');
  });
});
