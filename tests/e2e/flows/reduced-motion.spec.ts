/**
 * tests/e2e/flows/reduced-motion.spec.ts — T-E2E-18 (03 C-28 motion rules; DESIGN.md §11.1
 * Skeleton "reduced motion holds .8"; 03 G-06): with `reducedMotion: 'reduce'`
 *  - the `/projects` card hover has no `transform` change (ProjectCard.module.css guard), and
 *  - the skeleton pulse is off and opacity holds a static 0.8.
 * The skeleton is caught by delaying the `/projects` RSC payload (the "throttled network" of the
 * 05 row) during a client-side navigation — `app/(public)/projects/loading.tsx` renders in the
 * gap. Runs in the `e2e` project (1280). Reduced motion via `page.emulateMedia` (Playwright
 * 1.62 has no top-level `reducedMotion` test option).
 */
import { test, expect } from '../fixtures';

const RSC_DELAY_MS = 2_500;

test.describe('reduced motion', () => {
  test('T-E2E-18 skeleton opacity static at 0.8; card hover has no transform', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Throttle the /projects RSC payload: prefetches are dropped (so the click cannot resolve
    // from the prefetch cache) and the on-demand fetch is delayed — loading.tsx renders in the gap.
    let delay = true;
    await page.route(
      (url) => url.pathname === '/projects' && url.searchParams.has('_rsc'),
      async (route) => {
        const headers = await route.request().allHeaders();
        if (headers['next-router-prefetch'] !== undefined) return route.abort();
        if (delay) await new Promise((resolve) => setTimeout(resolve, RSC_DELAY_MS));
        return route.continue();
      },
    );

    await page.goto('/');
    await page.getByRole('link', { name: 'Projects', exact: true }).first().click();

    // loading.tsx: Skeleton slabs (`data-variant="media"|"text"`) — static at 0.8, no animation.
    // Sampled in ONE browser pass: the fallback unmounts when the delayed payload lands, so a
    // separate visible-then-evaluate round trip can race the swap (detached node → "" styles).
    const skeletonStyle = (await page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-variant="media"]');
          if (el === null) return null;
          const cs = getComputedStyle(el);
          if (cs.opacity === '') return null;
          return { opacity: cs.opacity, animationName: cs.animationName };
        },
        undefined,
        { timeout: 10_000 },
      )
      .then((handle) => handle.jsonValue())) as { opacity: string; animationName: string };
    expect(skeletonStyle.opacity).toBe('0.8');
    expect(skeletonStyle.animationName).toBe('none');

    // Let the delayed payload land, then hover a card: transform stays `none` (03 C-28 guard).
    delay = false;
    const card = page.locator('article').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const before = await card.evaluate((el) => getComputedStyle(el).transform);
    await card.hover();
    const during = await card.evaluate((el) => getComputedStyle(el).transform);
    expect(before).toBe('none');
    expect(during).toBe('none');
  });
});
