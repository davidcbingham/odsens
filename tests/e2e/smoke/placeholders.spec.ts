/**
 * tests/e2e/smoke/placeholders.spec.ts — T-E2E-46 (placeholder-page part; 00 S0.AC1; ADR-0002 C20; 02 RP-16).
 * Each nav target is a placeholder (title + "Not yet. Soon.") until its slice replaces it.
 * S1.2 replaced `/projects` — its assertions live in tests/e2e/smoke/projects.spec.ts (T-E2E-2).
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const PLACEHOLDERS = [
  { path: '/videos', name: 'Videos', slug: 'videos' },
  { path: '/skins', name: 'Skins', slug: 'skins' },
  { path: '/art', name: 'Art', slug: 'art' },
  { path: '/seen-on', name: 'Seen on', slug: 'seen-on' },
  { path: '/support', name: 'Support', slug: 'support' },
] as const;

for (const { path, name, slug } of PLACEHOLDERS) {
  test(`T-E2E-46 ${path} placeholder → 200, title, h1, "Not yet. Soon."`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${name} — odsens`);

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    const h1Text = ((await h1.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    expect(h1Text.toLowerCase()).toBe(name.toLowerCase());

    await expect(page.getByText('Not yet. Soon.')).toBeVisible();

    await expectNoSeriousA11y(page);
    await shoot(page, slug);
  });
}
