/**
 * tests/helpers/screenshots.ts — `shoot(page, name)` (docs/build/05-test-plan.md §1.3, H-8, T-E2E-19).
 * Full-page PNG to `test-results/screenshots/<name>@<viewport.width>.png` — the design-fidelity input.
 * Waits for the route fade first (`settleRouteFade`, ADR-0035 D3) so no capture shows a half-faded page.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { settleRouteFade } from './routeFade';

export const SCREENSHOT_DIR = path.join(process.cwd(), 'test-results', 'screenshots');

export function screenshotPath(page: Page, name: string): string {
  const width = page.viewportSize()?.width ?? 0;
  return path.join(SCREENSHOT_DIR, `${name}@${width}.png`);
}

/**
 * Full-page captures must show what a visitor would see after scrolling: walk the page so every
 * lazy `next/image` request fires, wait for fonts and for every image to finish, then return to
 * the top. "Finished" = `complete` (loaded OR errored): seed media that cannot exist locally yet
 * (the S1.3 `project-media` Storage icon — ADR-0002 C10) renders as a broken image by design in
 * S1.2 e2e, and must not hang the capture.
 *
 * The walk is not enough on its own (S1.7, 2026-09-25): on a very tall page (`/dev/components`
 * passed 56k px) under headless Chromium's software GL, frames drop during the 40 ms steps and
 * the lazy-load observer never sees some images — they stay `loading="lazy"`, off-screen and
 * incomplete forever, and the wait below times out. So after the walk every rendered image that
 * is still pending is switched to `loading = "eager"` (the same bytes a visitor's scroll would
 * fetch) before the wait — the capture then shows every image, which is what the walk is for.
 */
async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y <= step + height; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
    for (const img of Array.from(document.images)) {
      if (!img.complete && img.loading === 'lazy' && img.getClientRects().length > 0) {
        img.loading = 'eager';
      }
    }
  });
  await page.waitForFunction(
    () =>
      Array.from(document.images).every(
        // Display-none images (e.g. the Gallery's desktop-only "+N" thumb at 390) never lazy-load
        // — only images that actually render must have finished.
        (img) => img.complete || img.getClientRects().length === 0,
      ),
    undefined,
    { timeout: 10_000 },
  );
}

export async function shoot(page: Page, name: string): Promise<string> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const file = screenshotPath(page, name);
  await settleRouteFade(page);
  await settlePage(page);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
