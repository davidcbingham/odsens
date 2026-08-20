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

export async function shoot(page: Page, name: string): Promise<string> {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const file = screenshotPath(page, name);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
