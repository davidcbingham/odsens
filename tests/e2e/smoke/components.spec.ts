/**
 * tests/e2e/smoke/components.spec.ts — T-E2E-48: `/dev/components` (dev-only, `notFound()` on Vercel —
 * ADR-0002 #44) renders every 03 §2 component present so far in every state from `tests/fixtures/ui/*`;
 * axe zero serious/critical over the whole page; screenshots `components@1280.png` / `@390.png`.
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { shoot } from '../../helpers/screenshots';

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'gold', 'gold-ink'] as const;
const CHALK = 'rgb(238, 241, 246)'; // --chalk (the skins.spec settle colour)

test.describe('components preview', () => {
  test('T-E2E-48 /dev/components renders every Button variant, labelled svgs, axe clean', async ({
    page,
  }) => {
    // The gallery is one long page (every 03 §2 component in every state); at 390 the axe pass plus
    // the settle-and-shoot walk took 24–26 s on CI before S1.8 and the Seen on area grew it — the
    // default 30 s budget timed out twice on 2026-09-25. Same budget as the admin flows.
    test.setTimeout(90_000);
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

    // No horizontal overflow at either viewport: the capture must be exactly the viewport width.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, 'document scrollWidth == viewport width').toBe(page.viewportSize()?.width);

    // The SkinViewer3D stage specimens reach `ready` a beat after load and their controls then
    // ease from the disabled look to chalk-on-slab over --dur-fast; an axe pass that samples
    // mid-fade reports a ~3:1 blend on Spin / Walk / Front (seen 2026-09-26, S1.9, once the
    // gallery grew by the FlatBarChart specimens). The skins.spec idiom: every viewer settles to a
    // terminal state, then every un-pressed secondary control of a `ready` viewer rests at chalk.
    const viewers = page.locator('section[data-preview="SkinViewer3D"] [data-state]');
    await expect
      .poll(
        async () =>
          (
            await viewers.evaluateAll((els) => els.map((el) => el.getAttribute('data-state')))
          ).every((state) => state !== 'loading'),
        { timeout: 30_000 },
      )
      .toBe(true);
    const controls = page.locator(
      'section[data-preview="SkinViewer3D"] [data-state="ready"] button[data-variant="secondary"]:not([aria-pressed="true"])',
    );
    const controlCount = await controls.count();
    for (let i = 0; i < controlCount; i += 1) {
      await expect(controls.nth(i)).toHaveCSS('color', CHALK);
    }

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
