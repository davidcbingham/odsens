/**
 * tests/helpers/screenshots.ts — `shoot(page, name)` (docs/build/05-test-plan.md §1.3, H-8, T-E2E-19).
 * Full-page PNG to `test-results/screenshots/<name>@<viewport.width>.png` — the design-fidelity input.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

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
 */
async function settlePage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y <= height; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
    await document.fonts.ready;
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
  await settlePage(page);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
