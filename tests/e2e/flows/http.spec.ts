/**
 * tests/e2e/flows/http.spec.ts — T-E2E-46 (non-page HTTP part; 02 SM-12/13/19–23; 00 S0.AC13;
 * S1.1: 02 §3 M1 anon bounces; S1.2: cron-route auth surface, 02 SM-16/17 — the authorised 200
 * (SM-18) is exercised through `triggerSync` in tests/e2e/admin/projects.spec.ts, T-E2E-41, so
 * this read-only file never starts a real sync). Runs in the `e2e` project. Later slices extend:
 *  TODO S1.3: GET /api/download/00000000-0000-0000-0000-000000000000 → 404; HEAD → 405 (SM-21b);
 *             GET /api/download/not-a-uuid → 404.
 *  TODO S1.5: /api/cron/notify variants once the route exists.
 */
import { test, expect } from '../fixtures';

test.describe('http smoke', () => {
  test('T-E2E-46 anon GET /welcome and /profile → 307 / (02 M1, no DB work)', async ({
    request,
  }) => {
    for (const path of ['/welcome', '/profile']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(307);
      const location = new URL(res.headers()['location'] ?? '', 'http://localhost:3000');
      expect(location.pathname, path).toBe('/');
      expect(location.search, path).toBe('');
    }
  });

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

  test('T-E2E-46 cron routes (S1.2): no/wrong header → 401 JSON, no side effects; POST/HEAD → 405', async ({
    request,
  }) => {
    for (const path of ['/api/cron/sync-modrinth', '/api/cron/sync-curseforge']) {
      const bare = await request.get(path);
      expect(bare.status(), path).toBe(401);
      expect(await bare.json()).toMatchObject({
        ok: false,
        error: { code: 'unauthorized', message: 'Nope.' },
      });

      const wrong = await request.get(path, {
        headers: { Authorization: 'Bearer wrong' },
      });
      expect(wrong.status(), path).toBe(401);

      // 405 for non-GET regardless of auth (04 SC-12; ADR-0002 C15 wrapper shape).
      const post = await request.post(path);
      expect(post.status(), path).toBe(405);
      expect(post.headers()['allow']).toBe('GET');
      const head = await request.head(path);
      expect(head.status(), path).toBe(405);
    }
  });

  test('T-E2E-46 GET /dev/components → 200 locally (Vercel 404 = deploy-checker SM-32)', async ({
    request,
  }) => {
    const res = await request.get('/dev/components');
    expect(res.status()).toBe(200);
  });
});
