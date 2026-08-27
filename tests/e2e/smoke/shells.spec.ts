/**
 * tests/e2e/smoke/shells.spec.ts — T-E2E-14 (404 shell, 02 SM-04) and T-E2E-15 (error boundary,
 * `/__test/throw` exists only when `E2E=1` — ADR-0002 #74). 00 S0.AC4; DESIGN.md §11.3 #13/#14.
 *
 * SPEC CONTRADICTION (S1.2, needs an ADR — do not "fix" silently): `/projects/[slug]` exists
 * from S1.2, so `/projects/does-not-exist-404` is now decided by `notFound()` INSIDE the route,
 * not by a router miss. Next 16 locks the HTTP status at 200 whenever any ancestor `loading.tsx`
 * exists (the shell streams before `notFound()` runs — vercel/next.js#45801, #76474), and 02
 * RP-10/G-01 REQUIRE those loading files, while 02 SM-04 / 05 T-E2E-14 require status 404.
 * Verified empirically: removing every `app/(public)` loading.tsx yields 404; any one of them
 * restores 200. Until the ADR decides, this spec asserts the 404 SHELL BODY for the slug case
 * and tolerates the streamed 200 status; `/nope-<random>` (a real router miss) still must be a
 * hard 404.
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

    // Streamed slug-route notFound: status is 200 under Next 16 while RP-10's loading.tsx files
    // exist (see header — frozen-spec contradiction, ADR pending); the shell body is asserted.
    const nested = await page.goto('/projects/does-not-exist-404');
    expect([200, 404]).toContain(nested?.status());
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
