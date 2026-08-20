/**
 * tests/e2e/fixtures.ts — shared Playwright `test` for every spec (docs/build/05-test-plan.md §1.5).
 *  - H-10: the browser context aborts every request whose host is not localhost/127.0.0.1
 *    (the Google sign-in start, T-E2E-16, asserts the URL first and is aborted here too).
 *  - `requests`: every request URL the context issued, for network assertions (00 S0.AC3 fonts).
 * Every spec imports `test`/`expect` from here, never from `@playwright/test` directly.
 */
import { test as base, expect, type BrowserContext } from '@playwright/test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const recorded = new WeakMap<BrowserContext, string[]>();

export function isLocalHost(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const test = base.extend<{ requests: string[] }>({
  context: async ({ context }, provide) => {
    const urls: string[] = [];
    recorded.set(context, urls);
    context.on('request', (req) => {
      urls.push(req.url());
    });
    await context.route('**/*', (route) => {
      if (isLocalHost(route.request().url())) return route.continue();
      return route.abort();
    });
    await provide(context);
  },
  requests: async ({ context }, provide) => {
    await provide(recorded.get(context) ?? []);
  },
});

export { expect };
