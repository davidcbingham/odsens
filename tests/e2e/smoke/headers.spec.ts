/**
 * tests/e2e/smoke/headers.spec.ts — T-E2E-20 (S0 part): security headers per 01 INV-76/INV-77 on `/`
 * and `/admin` (a 404 at S0), `X-Robots-Tag` on `/admin/**` + `/api/**` (00 S0.AC9; 02 SM-27/28).
 * `/welcome` and `/profile` X-Robots-Tag assertions arrive in S1.1 when those routes exist;
 * `/api/download/<id>` arrives in S1.3.
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
    // S1.1: add '/welcome' and '/profile' (fetched with redirects off) once the routes exist.
    // S1.3: add '/api/download/<id>' (T-E2E-20 full list).
  });
});
