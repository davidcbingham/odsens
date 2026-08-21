/**
 * tests/e2e/smoke/headers.spec.ts — T-E2E-20: security headers per 01 INV-76/INV-77 on `/` and
 * `/admin` (the anon `AdminGate`, 200), `X-Robots-Tag` on `/admin/**` + `/api/**` (00 S0.AC9; 02
 * SM-27/28) and — from S1.1 — on `/welcome` and `/profile`, fetched anonymously with redirects off
 * (02 M1: both answer 307 `/`; the noindex header rides on the redirect). `/api/download/<id>` arrives in S1.3.
 */
import { test, expect } from '../fixtures';
import type { APIResponse } from '@playwright/test';

function expectSecurityHeaders(res: APIResponse, path: string) {
  const h = res.headers();
  const csp = h['content-security-policy'] ?? '';
  expect(csp, `${path}: Content-Security-Policy present`).not.toBe('');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).toContain('frame-src https://www.youtube-nocookie.com https://ko-fi.com');
  expect(h['x-content-type-options'], path).toBe('nosniff');
  expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
  expect(h['x-frame-options'], path).toBe('DENY');
  expect(h['permissions-policy'], `${path}: Permissions-Policy present`).toBeTruthy();
  expect(h['strict-transport-security'], `${path}: Strict-Transport-Security present`).toBeTruthy();
}

test.describe('headers', () => {
  test('T-E2E-20 security headers on / and /admin', async ({ request }) => {
    const home = await request.get('/', { maxRedirects: 0 });
    expectSecurityHeaders(home, '/');
    expect(home.headers()['x-robots-tag'], '/ is indexable').toBeUndefined();

    const admin = await request.get('/admin', { maxRedirects: 0 });
    expectSecurityHeaders(admin, '/admin');
    expect(admin.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('T-E2E-20 X-Robots-Tag noindex on /admin/**, /api/**', async ({ request }) => {
    for (const path of ['/admin/anything', '/api/anything']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
      expectSecurityHeaders(res, path);
    }
    // S1.3: add '/api/download/<id>' (T-E2E-20 full list).
  });

  test('T-E2E-20 X-Robots-Tag noindex on /welcome and /profile (anon, redirects off)', async ({
    request,
  }) => {
    for (const path of ['/welcome', '/profile']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path}: anon → 307 (02 M1)`).toBe(307);
      expect(res.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
      expectSecurityHeaders(res, path);
    }
  });
});
