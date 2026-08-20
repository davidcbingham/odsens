/**
 * tests/e2e/smoke/components.spec.ts — T-E2E-48: `/dev/components` (dev-only, `notFound()` on Vercel —
 * ADR-0002 #44) renders every 03 §2 component present so far in every state from `tests/fixtures/ui/*`;
 * axe zero serious/critical over the whole page; screenshots `components@1280.png` / `@390.png`.
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'gold', 'gold-ink'] as const;

test.describe('components preview', () => {
  test('T-E2E-48 /dev/components renders every Button variant, labelled svgs, axe clean', async ({
    page,
  }) => {
    const response = await page.goto('/dev/components');
    expect(response?.status()).toBe(200);

    const buttons = page.locator('section[data-preview="Button"]');
    expect(await buttons.count(), 'Button sections rendered').toBeGreaterThan(0);
    for (const variant of BUTTON_VARIANTS) {
      expect(
        await buttons.locator(`[data-variant="${variant}"]`).count(),
        `Button variant "${variant}" is previewed`,
      ).toBeGreaterThan(0);
    }

    // Every svg is decorative (aria-hidden="true") or labelled (role="img" + <title>).
    const unlabelled = await page.locator('svg').evaluateAll((els) =>
      els
        .filter((el) => {
          if (el.getAttribute('aria-hidden') === 'true') return false;
          return !(el.getAttribute('role') === 'img' && el.querySelector('title') !== null);
        })
        .map((el) => el.outerHTML.slice(0, 120)),
    );
    expect(unlabelled, 'svgs without aria-hidden or role=img+title').toEqual([]);

    await expectNoSeriousA11y(page);
    await shoot(page, 'components');

    // NavMenuButton `data-state="open"` (03 N-05/N-08; ADR-0004 D3): the burger exists only under 900px.
    const burger = page.locator('section[data-preview="NavMenuButton"] button[aria-label="Menu"]');
    if (await burger.isVisible()) {
      await burger.click();
      const panel = page.locator('#nav-menu-preview[data-state="open"]');
      await expect(panel).toBeVisible();
      // Let the 150ms open transition finish — axe samples blended colours mid-fade otherwise.
      await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await expectNoSeriousA11y(page);
      await shoot(page, 'components-menu');
      await page.keyboard.press('Escape');
    }
  });
});
