/**
 * tests/helpers/threadCache.ts — `repairThreadCache(browser, …)` (Playwright-only; 05 H-1 + FLK-4).
 *
 * A comment flow that restores the seed thread through the SERVICE client leaves the page's ISR entry
 * (`project:<slug>`, 02 §5) stale: `next start` writes ISR entries to disk, so the pre-restore page
 * would survive into the next local run (`reuseExistingServer`) and break the seed-truth smoke
 * assertions (T-E2E-3 "3 TOTAL"). FLK-4 forbids waiting the `revalidate` window out and asks for the
 * app's own revalidation instead, so this signs in as `seed_user` in a fresh context (H-10 routing:
 * non-local hosts aborted), likes and unlikes one root comment — `toggleLike` revalidates the tag on
 * both calls, the second AFTER the like row is gone again — then re-navigates until the expected
 * `N TOTAL` heading shows. Call it LAST in `afterAll`, after every service-side restore.
 */
import { expect, type Browser, type Locator } from '@playwright/test';
import { waitForHydrated } from './hydration';
import { loginAs } from './loginAs';

export type ThreadCacheRepair = {
  /** The detail page path, e.g. `/projects/pixel-chameleon`. */
  path: string;
  /** Body text that identifies the root comment to like and unlike (a seed published root). */
  rootText: string;
  /** The `N` of the `N TOTAL` count a signed-in seed_user must see once the entry is fresh. */
  expectedTotal: number;
};

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Clicks the like button and waits for `aria-pressed` to flip AND the action to settle. */
async function clickLike(button: Locator): Promise<void> {
  const before = (await button.getAttribute('aria-pressed')) === 'true';
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', before ? 'false' : 'true');
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
}

export async function repairThreadCache(
  browser: Browser,
  { path, rootText, expectedTotal }: ThreadCacheRepair,
): Promise<void> {
  const context = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: 1280, height: 800 },
  });
  await context.route('**/*', (route) =>
    isLocal(route.request().url()) ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  try {
    await loginAs(page, 'user');
    await page.goto(path);
    // The composer is client-rendered by the thread island after the viewer read, so its presence
    // means the whole island (like buttons included) is hydrated.
    await expect(page.locator('#comment-composer')).toHaveCount(1);
    await waitForHydrated(page, '#comment-composer');
    const like = page
      .locator('#comments li[data-depth="0"]')
      .filter({ hasText: rootText })
      .locator('> article')
      .getByRole('button', { name: /^Like, \d+ likes?$/ });
    await expect(like).toBeVisible();
    // `revalidateTag(…, 'max')` is stale-while-revalidate TWICE over: the page entry regenerates on
    // the next request from a data-cache entry that is itself still refreshing in the background,
    // so one like/unlike pair (two revalidations ~1 s apart) can bake a stale thread for another
    // 600 s. Cycle again until the fresh count serves — each cycle is two more revalidations.
    let fresh = false;
    for (let cycle = 0; cycle < 4 && !fresh; cycle += 1) {
      await clickLike(like);
      await clickLike(like);
      try {
        await expect(async () => {
          await page.goto(path);
          await expect(
            page.locator('#comments').getByRole('heading', {
              level: 2,
              name: `COMMENTS ${expectedTotal} total`,
              exact: true,
            }),
          ).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 8_000, intervals: [400, 800, 1_600] });
        fresh = true;
      } catch (error) {
        if (cycle === 3) throw error;
        await page.goto(path);
        await expect(page.locator('#comment-composer')).toHaveCount(1);
        await waitForHydrated(page, '#comment-composer');
        await expect(like).toBeVisible();
      }
    }
  } finally {
    await context.close();
  }
}
