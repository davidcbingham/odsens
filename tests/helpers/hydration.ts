/**
 * tests/helpers/hydration.ts — `waitForHydrated(page, selector)` (Playwright-only; 05 §1.3 helpers).
 * Resolves once React has hydrated the element `selector` points at: host instances carry a
 * `__reactFiber$…` property only after hydration (or a client render) attached them. Route segments
 * behind `loading.tsx` are Suspense boundaries React hydrates lazily after the root, and an event
 * that lands on them before that is dropped — so every interaction on such a segment waits for this
 * first (the tests/e2e/flows/profile.spec.ts idiom, shared from S1.4 for the comment flows on
 * `/projects/[slug]`). No `import.meta` (Playwright transpiles helpers to CommonJS).
 */
import type { Page } from '@playwright/test';

export async function waitForHydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el !== null && Object.keys(el).some((key) => key.startsWith('__reactFiber$'));
  }, selector);
}
