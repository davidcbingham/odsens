/**
 * tests/e2e/fixtures.ts — shared Playwright `test` for every spec (docs/build/05-test-plan.md §1.5).
 *  - H-10: the browser context aborts every request whose host is not localhost/127.0.0.1
 *    (the Google sign-in start, T-E2E-16, asserts the URL first and is aborted here too).
 *  - `/_next/image` placeholder (S1.2): seed media URLs are recorded-fixture shapes that do not
 *    exist upstream (SEED-4 `cdn.modrinth.com/data/sd000101/…`), so the image optimizer's
 *    server-side fetch would open a socket to the real CDN and 404. Requests whose inner `url`
 *    param is NOT local are fulfilled in the browser with a flat `--slab-raised` PNG before they
 *    reach the server — e2e stays offline (H-10's intent) and every `<img>` settles
 *    deterministically. Local inner URLs (Supabase Storage, /brand/*) still hit the real
 *    optimizer.
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

/** 8×8 flat #1E2938 (`--skeleton-media`) PNG — the offline stand-in for remote seed media. */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOQ07TAihiGlgQAYfwfweCegU0AAAAASUVORK5CYII=',
  'base64',
);

/** True for `/_next/image?url=…` requests whose upstream image lives on a non-local host. */
function isRemoteImageOptimization(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== '/_next/image') return false;
    const inner = parsed.searchParams.get('url');
    if (inner === null) return false;
    if (inner.startsWith('/')) return false; // local static asset
    return !isLocalHost(inner);
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
      const url = route.request().url();
      if (isRemoteImageOptimization(url)) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: PLACEHOLDER_PNG });
      }
      if (isLocalHost(url)) return route.continue();
      return route.abort();
    });
    await provide(context);
  },
  requests: async ({ context }, provide) => {
    await provide(recorded.get(context) ?? []);
  },
});

export { expect };
