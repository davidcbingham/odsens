/**
 * tests/e2e/flows/http.spec.ts — T-E2E-46 (non-page HTTP part available at S0; 02 SM-12/13/19–23;
 * 00 S0.AC13). Runs in the `e2e` project. Later slices extend this file:
 *  TODO S1.1: anon GET /welcome → 307 `/`; anon GET /profile → 307 `/`.
 *  TODO S1.2: POST /api/cron/notify with header → 405 (first cron route lands S1.2; notify route S1.5).
 *  TODO S1.3: GET /api/download/00000000-0000-0000-0000-000000000000 → 404; HEAD → 405 (SM-21b);
 *             GET /api/download/not-a-uuid → 404.
 */
import { test, expect } from '../fixtures';

test.describe('http smoke', () => {
  test('T-E2E-46 GET /auth/callback without a code → 307 / (no query)', async ({ request }) => {
    const res = await request.get('/auth/callback', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = res.headers()['location'] ?? '';
    expect(location.endsWith('/')).toBe(true);
    expect(location).not.toContain('?');
  });

  test('T-E2E-46 GET /auth/sign-out → 405; GET /auth/sign-in → 404 (ADR-0002 C3)', async ({
    request,
  }) => {
    const signOut = await request.get('/auth/sign-out', { maxRedirects: 0 });
    expect(signOut.status()).toBe(405);
    const signIn = await request.get('/auth/sign-in', { maxRedirects: 0 });
    expect(signIn.status()).toBe(404);
  });

  test('T-E2E-46 POST /auth/sign-out without Origin → 403 {ok:false, error:{code:"forbidden"}}', async ({
    request,
  }) => {
    const res = await request.post('/auth/sign-out', { maxRedirects: 0 });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  test('T-E2E-46 GET /dev/components → 200 locally (Vercel 404 = deploy-checker SM-32)', async ({
    request,
  }) => {
    const res = await request.get('/dev/components');
    expect(res.status()).toBe(200);
  });
});
