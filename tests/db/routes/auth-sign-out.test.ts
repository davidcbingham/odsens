/**
 * tests/db/routes/auth-sign-out.test.ts — T-ACT-9 (05 §7.2; 04 §2.2; 02 RP-21; ADR-0002 C3).
 *
 * Handlers are imported from app/auth/sign-out/route.ts and invoked through `callRoute` (H-6). A real
 * sign-out revokes the refresh token of the session the context was built from, so the 303 rows use
 * factory users (fresh sessions); the 403 / 405 rows never reach `signOut()` and may use seed roles.
 * Cookies the handler clears land in the context store (`lastActionCookies()`), where production Next
 * would copy them onto the response.
 */
import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it } from 'vitest';
import { DELETE, GET, HEAD, PATCH, POST, PUT } from '@/app/auth/sign-out/route';
import { callRoute, lastActionCookies, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { seedSessionCookies } from '@/tests/helpers/sessionCookies';

setupActionMocks();

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const URL_ = new URL('/auth/sign-out', SITE).toString();

afterAll(async () => {
  await cleanupFactories();
});

function post(headers: Record<string, string>): NextRequest {
  return new NextRequest(URL_, { method: 'POST', headers });
}

function sessionCookies(): { name: string; value: string }[] {
  return lastActionCookies()
    .getAll()
    .filter((c) => /^sb-.+-auth-token/.test(c.name));
}

async function expectForbidden(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toEqual({ ok: false, error: { code: 'forbidden', message: 'Nope.' } });
}

describe('T-ACT-9 /auth/sign-out', () => {
  it('T-ACT-9 GET → 405 with Allow: POST (and every other non-POST method)', async () => {
    for (const handler of [GET, HEAD, PUT, PATCH, DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    const body = (await GET().json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('validation');
  });

  it('T-ACT-9 POST with same-origin Origin → clears session cookies and 303 /', async () => {
    const id = await makeUser();
    const res = await callRoute(POST, post({ origin: new URL(SITE).origin }), { profileId: id });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(new URL('/', SITE).toString());
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(sessionCookies()).toEqual([]);
  });

  it('T-ACT-9 POST with a foreign Origin → 403, session untouched', async () => {
    const before = (await seedSessionCookies('user')).length;
    expect(before).toBeGreaterThan(0);
    const res = await callRoute(POST, post({ origin: 'https://evil.example' }), { role: 'user' });
    await expectForbidden(res);
    expect(sessionCookies()).toHaveLength(before);
  });

  it('T-ACT-9 POST with no Origin and a foreign Referer → 403', async () => {
    const res = await callRoute(POST, post({ referer: 'https://evil.example/page' }), {
      role: 'user',
    });
    await expectForbidden(res);
    expect(sessionCookies().length).toBeGreaterThan(0);
  });

  it('T-ACT-9 POST with neither Origin nor Referer → 403', async () => {
    await expectForbidden(await callRoute(POST, post({}), { role: 'user' }));
  });

  it('T-ACT-9 POST with a same-site Referer but no Origin → 303', async () => {
    const id = await makeUser();
    const res = await callRoute(POST, post({ referer: new URL('/profile', SITE).toString() }), {
      profileId: id,
    });
    expect(res.status).toBe(303);
    expect(sessionCookies()).toEqual([]);
  });

  it('T-ACT-9 a scheme/port-different Origin with the same host is rejected (host match only on the real origin)', async () => {
    // `new URL(origin).host` comparison: a different port is a different host
    const res = await callRoute(POST, post({ origin: 'http://localhost:4010' }), { role: 'user' });
    await expectForbidden(res);
  });

  it('T-ACT-9 nohandle (un-onboarded) may sign out → 303', async () => {
    const id = await makeUser({ handle: null });
    const res = await callRoute(POST, post({ origin: new URL(SITE).origin }), { profileId: id });
    expect(res.status).toBe(303);
    expect(sessionCookies()).toEqual([]);
  });

  it('T-ACT-9 anon POST with same-origin Origin → 303 (nothing to clear, no error)', async () => {
    const res = await callRoute(POST, post({ origin: new URL(SITE).origin }), { role: 'anon' });
    expect(res.status).toBe(303);
    expect(sessionCookies()).toEqual([]);
  });
});
