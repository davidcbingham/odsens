/**
 * tests/db/routes/auth-callback.test.ts — T-ACT-8 (05 §7.2; 04 §2.1 A1–A4; 02 RP-20; ADR-0002 C18 / A14).
 *
 * `GET` is imported from app/auth/callback/route.ts and invoked through `callRoute` (H-6). The cookie
 * client is the harness one (real local session for the context's identity) with ONE method replaced:
 * `auth.exchangeCodeForSession` is a `vi.fn` this file drives — there is no real OAuth code to exchange
 * against local GoTrue. Everything after the exchange (A3a email_hash stamp via the service client,
 * `getProfile()` under RLS, the redirects) runs for real.
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/auth/callback/route';
import { emailHash } from '@/lib/hash';
import { readProfile } from '@/tests/helpers/arrange';
import { factoryEmail } from '@/tests/helpers/asRole';
import { callRoute, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { spyLog, type LogSpy } from '@/tests/helpers/spies';

type ExchangeResult = {
  data: { user: { id: string; email?: string } | null; session: null };
  error: { message: string } | null;
};

const mocks = vi.hoisted(() => ({
  exchange: vi.fn<(code: string) => Promise<ExchangeResult>>(),
}));

vi.mock('@/lib/supabase/server', async () => {
  const ctx = await import('@/tests/helpers/actionContext');
  return {
    createServerClient: async () => {
      const client = await ctx.createContextServerClient();
      vi.spyOn(client.auth, 'exchangeCodeForSession').mockImplementation(mocks.exchange as never);
      return client;
    },
  };
});

setupActionMocks();

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

function request(query: Record<string, string>): NextRequest {
  const url = new URL('/auth/callback', SITE);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new NextRequest(url);
}

function exchangeOk(id: string, email?: string): void {
  mocks.exchange.mockResolvedValue({ data: { user: { id, email }, session: null }, error: null });
}

function exchangeFails(): void {
  mocks.exchange.mockResolvedValue({
    data: { user: null, session: null },
    error: { message: 'invalid grant' },
  });
}

let logs: LogSpy;
beforeEach(() => {
  mocks.exchange.mockReset();
  logs = spyLog();
});
afterEach(() => {
  logs.restore();
});
afterAll(async () => {
  await cleanupFactories();
});

function expectRedirect(res: Response, path: string): void {
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toBe(new URL(path, SITE).toString());
  expect(res.headers.get('cache-control')).toBe('no-store');
}

describe('T-ACT-8 /auth/callback', () => {
  it('T-ACT-8 no code → 307 / (no exchange attempted), no-store', async () => {
    const res = await callRoute(GET, request({ next: '/projects' }), { role: 'anon' });
    expectRedirect(res, '/');
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it('T-ACT-8 exchange error → 307 / with no query param + log.warn exchange_failed', async () => {
    exchangeFails();
    const res = await callRoute(GET, request({ code: 'bad', next: '/projects' }), { role: 'anon' });
    expectRedirect(res, '/');
    expect(new URL(res.headers.get('location') ?? '').search).toBe('');
    expect(mocks.exchange).toHaveBeenCalledWith('bad');
    const warns = (logs.lines as Array<Record<string, unknown>>).filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ action: 'auth_callback', msg: 'exchange_failed' });
    expect(typeof warns[0]?.id).toBe('string');
  });

  it('T-ACT-8 valid code + handle NULL → 307 /welcome?next=<next>; email_hash stamped once', async () => {
    const id = await makeUser({ handle: null });
    const email = factoryEmail(id);
    expect((await readProfile(id))?.email_hash).toBeNull();

    exchangeOk(id, email.toUpperCase());
    const res = await callRoute(GET, request({ code: 'good', next: '/projects?tag=mods' }), {
      profileId: id,
    });
    expectRedirect(res, `/welcome?next=${encodeURIComponent('/projects?tag=mods')}`);

    const stamped = (await readProfile(id))?.email_hash ?? '';
    expect(stamped).toMatch(/^[0-9a-f]{64}$/);
    expect(stamped).toBe(emailHash(email)); // normalised (trim + lowercase), keyed by HASH_SECRET
    // the email itself never reaches a log line
    expect(JSON.stringify(logs.lines)).not.toContain('@localhost.test');

    // A3a is "only when null": a second sign-in with a different address leaves it unchanged.
    exchangeOk(id, `other_${id}@localhost.test`);
    const again = await callRoute(GET, request({ code: 'good2' }), { profileId: id });
    expectRedirect(again, `/welcome?next=${encodeURIComponent('/')}`);
    expect((await readProfile(id))?.email_hash).toBe(stamped);
  });

  it('T-ACT-8 valid code + handle set → 307 <next>', async () => {
    const id = await makeUser();
    exchangeOk(id, factoryEmail(id));
    const res = await callRoute(GET, request({ code: 'good', next: '/projects' }), {
      profileId: id,
    });
    expectRedirect(res, '/projects');
    expect((await readProfile(id))?.email_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('T-ACT-8 valid code, no next → 307 /', async () => {
    const id = await makeUser();
    exchangeOk(id, factoryEmail(id));
    expectRedirect(await callRoute(GET, request({ code: 'good' }), { profileId: id }), '/');
  });

  it('T-ACT-8 no email on the user → no stamp, still redirects', async () => {
    const id = await makeUser();
    exchangeOk(id, undefined);
    expectRedirect(
      await callRoute(GET, request({ code: 'good', next: '/skins' }), { profileId: id }),
      '/skins',
    );
    expect((await readProfile(id))?.email_hash).toBeNull();
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/api/x',
    '/auth/x',
    '/admin',
    '/admin/comments',
    'projects',
    '/projects\nX-Injected: 1',
  ])('T-ACT-8 safeNext: next=%j → 307 /', async (next) => {
    const id = await makeUser();
    exchangeOk(id, factoryEmail(id));
    const res = await callRoute(GET, request({ code: 'good', next }), { profileId: id });
    expectRedirect(res, '/');
  });

  it('T-ACT-8 safeNext keeps a hash and query on an allowed path', async () => {
    const id = await makeUser();
    exchangeOk(id, factoryEmail(id));
    const res = await callRoute(
      GET,
      request({ code: 'good', next: '/projects/pixel-chameleon?v=2#comments' }),
      {
        profileId: id,
      },
    );
    expectRedirect(res, '/projects/pixel-chameleon?v=2#comments');
  });
});
