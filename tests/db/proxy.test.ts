/**
 * tests/db/proxy.test.ts — T-ACT-10 (05 §7.2; 02 §3 M1–M8, RP-19 / RP-20 / RP-21; ADR-0009).
 *
 * Invokes the exported `proxy(request)` with `NextRequest`s whose `Cookie:` header carries the real
 * local-stack session cookies for a role (built the `loginAs` way by tests/helpers/sessionCookies.ts), and
 * none for anon. `proxy.ts` reads `request.cookies`, so the action-context mocks are not involved.
 *
 * "No query on profiles.role" is proven two ways: a `fetch` spy records every PostgREST request the
 * middleware makes (each `/rest/v1/profiles` call must select exactly `handle,is_banned` — ADR-0019 added
 * `is_banned` for M4b), and the source of proxy.ts — comments stripped — contains no `role` token at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { proxy, config } from '@/proxy';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import {
  cookieHeader,
  seedSessionCookies,
  userSessionCookies,
} from '@/tests/helpers/sessionCookies';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

let nohandleCookie = '';
let userCookie = '';
let bannedCookie = '';

beforeAll(async () => {
  nohandleCookie = cookieHeader(await seedSessionCookies('nohandle'));
  userCookie = cookieHeader(await seedSessionCookies('user'));
  bannedCookie = cookieHeader(await seedSessionCookies('banned'));
});

afterAll(async () => {
  await cleanupFactories();
});

const realFetch = globalThis.fetch;
const profileRequests: URL[] = [];
let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

function spyOnDb(): void {
  profileRequests.length = 0;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes('/rest/v1/')) profileRequests.push(url);
    return realFetch(input, init);
  });
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

function req(pathWithQuery: string, cookie?: string): NextRequest {
  return new NextRequest(
    new URL(pathWithQuery, SITE),
    cookie ? { headers: { cookie } } : undefined,
  );
}

function location(res: Response): string {
  return res.headers.get('location') ?? '';
}

function expectPassThrough(res: Response): void {
  expect(res.status).toBe(200);
  expect(res.headers.get('x-middleware-next')).toBe('1');
}

function expectRedirect(res: Response, pathWithQuery: string): void {
  expect(res.status).toBe(307);
  expect(location(res)).toBe(new URL(pathWithQuery, SITE).toString());
}

describe('T-ACT-10 proxy M1 — anon (no auth cookie)', () => {
  it('T-ACT-10 anon on /profile and /welcome → 307 /, without touching Supabase', async () => {
    spyOnDb();
    expectRedirect(await proxy(req('/profile')), '/');
    expectRedirect(await proxy(req('/welcome')), '/');
    expectRedirect(await proxy(req('/welcome?next=/projects')), '/');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    '/',
    '/projects',
    '/projects/pixel-chameleon',
    '/privacy',
    '/how-comments-work',
    '/admin',
    '/skins',
    '/auth/sign-out',
    '/api/health',
  ])('T-ACT-10 anon on %s → pass through (200), no DB work', async (p) => {
    spyOnDb();
    expectPassThrough(await proxy(req(p)));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-ACT-10 a PKCE code-verifier cookie alone is not a session (M1 path)', async () => {
    spyOnDb();
    expectRedirect(await proxy(req('/profile', 'sb-127-auth-token-code-verifier=abc')), '/');
    expectPassThrough(await proxy(req('/projects', 'sb-127-auth-token-code-verifier=abc')));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('T-ACT-10 proxy M2 — invalid session', () => {
  it('T-ACT-10 a garbage sb-*-auth-token cookie → treated as anon', async () => {
    const cookie = 'sb-127-auth-token=base64-garbage';
    expectRedirect(await proxy(req('/profile', cookie)), '/');
    expectRedirect(await proxy(req('/welcome', cookie)), '/');
    expectPassThrough(await proxy(req('/projects', cookie)));
  });
});

describe('T-ACT-10 proxy M5 — nohandle must onboard', () => {
  it.each(['/', '/projects', '/profile', '/skins', '/projects/pixel-chameleon'])(
    'T-ACT-10 nohandle on %s → 307 /welcome?next=<path>',
    async (p) => {
      const res = await proxy(req(p, nohandleCookie));
      expectRedirect(res, `/welcome?next=${encodeURIComponent(p)}`);
    },
  );

  it('T-ACT-10 nohandle keeps the query in next', async () => {
    const res = await proxy(req('/projects?tag=mods&sort=new', nohandleCookie));
    expectRedirect(res, `/welcome?next=${encodeURIComponent('/projects?tag=mods&sort=new')}`);
  });

  it('T-ACT-10 nohandle on /admin → 307 /welcome without next (RP-20 blocks /admin as a destination)', async () => {
    const res = await proxy(req('/admin', nohandleCookie));
    expect(res.status).toBe(307);
    const target = new URL(location(res));
    expect(target.pathname).toBe('/welcome');
    expect(target.searchParams.has('next')).toBe(false);
  });

  it.each([
    '/welcome',
    '/welcome?next=/projects',
    '/auth/sign-out',
    '/auth/callback?code=x',
    '/api/health',
    '/privacy',
    '/how-comments-work',
  ])('T-ACT-10 nohandle on %s → pass through (RP-21)', async (p) => {
    expectPassThrough(await proxy(req(p, nohandleCookie)));
  });
});

describe('T-ACT-10 proxy M6/M7/M8 — onboarded user', () => {
  it('T-ACT-10 user on /welcome → 307 / (no next)', async () => {
    expectRedirect(await proxy(req('/welcome', userCookie)), '/');
  });

  it('T-ACT-10 user on /welcome?next=/projects → 307 /projects', async () => {
    expectRedirect(
      await proxy(req('/welcome?next=%2Fprojects%3Ftag%3Dmods', userCookie)),
      '/projects?tag=mods',
    );
  });

  it.each(['https://evil.example', '//evil.example', '/api/x', '/auth/x', '/admin', 'projects'])(
    'T-ACT-10 user on /welcome?next=%s → 307 / (RP-20)',
    async (next) => {
      expectRedirect(
        await proxy(req(`/welcome?next=${encodeURIComponent(next)}`, userCookie)),
        '/',
      );
    },
  );

  it.each([
    '/',
    '/profile',
    '/projects',
    '/admin',
    '/admin/comments',
    '/auth/sign-out',
    '/api/health',
    '/privacy',
  ])('T-ACT-10 user on %s → pass through (role gate is app/admin/layout.tsx)', async (p) => {
    expectPassThrough(await proxy(req(p, userCookie)));
  });
});

/** A Server Action POST (`next-action` header + RSC body), as the browser sends it. */
function actionPost(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(pathname, SITE), {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      'next-action': '0123456789abcdef0123456789abcdef01234567',
      'content-type': 'text/plain;charset=UTF-8',
    },
    body: '[]',
  });
}

describe('T-ACT-10 proxy M3b — non-GET requests (Server Action POSTs) are never redirected', () => {
  // ADR-0009 addendum: a 307 on an action POST makes the browser re-POST the action to the redirect
  // target (seen on the preview: DONE → handle set → second DONE → POST /welcome 307 → POST / → crash).
  // The action re-checks auth + onboarding itself (04 SC-04); the proxy only refreshes the session.

  it('T-ACT-10 anon POST /profile and /welcome → pass through (no 307, no Supabase call)', async () => {
    spyOnDb();
    for (const pathname of ['/profile', '/welcome']) {
      expectPassThrough(await proxy(actionPost(pathname)));
    }
    expect(profileRequests).toEqual([]);
  });

  it('T-ACT-10 nohandle POST /projects → pass through (M5 is a navigation rule)', async () => {
    spyOnDb();
    expectPassThrough(await proxy(actionPost('/projects?x=1', nohandleCookie)));
    // M3b returns before M4: no profiles read for an action request.
    expect(profileRequests).toEqual([]);
  });

  it('T-ACT-10 user POST /welcome → pass through (M6 is a navigation rule)', async () => {
    spyOnDb();
    expectPassThrough(await proxy(actionPost('/welcome?next=%2F', userCookie)));
    expect(profileRequests).toEqual([]);
  });

  it('T-ACT-10 HEAD behaves like GET (user on /welcome → 307 /)', async () => {
    const res = await proxy(
      new NextRequest(new URL('/welcome', SITE), {
        method: 'HEAD',
        headers: { cookie: userCookie },
      }),
    );
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`${SITE}/`);
  });
});

describe('T-ACT-10 proxy RP-19 — never reads role', () => {
  it('T-ACT-10 every profiles query selects exactly `handle,is_banned` (fetch spy; ADR-0019)', async () => {
    spyOnDb();
    await proxy(req('/projects', nohandleCookie));
    await proxy(req('/profile', userCookie));
    await proxy(req('/welcome', userCookie));
    await proxy(req('/', bannedCookie));
    const profiles = profileRequests.filter((u) => u.pathname.endsWith('/rest/v1/profiles'));
    expect(profiles.length).toBeGreaterThanOrEqual(4);
    for (const url of profiles) {
      // supabase-js strips the space from `select('handle, is_banned')`; never `role`, never `*`.
      expect(url.searchParams.get('select')).toBe('handle,is_banned');
      expect(url.search.toLowerCase()).not.toContain('role');
    }
    // and no other table is consulted by the middleware
    expect(profileRequests.filter((u) => !u.pathname.endsWith('/rest/v1/profiles'))).toEqual([]);
  });

  it('T-ACT-10 /auth/* short-circuits before the profiles read (M3)', async () => {
    spyOnDb();
    expectPassThrough(await proxy(req('/auth/sign-out', userCookie)));
    expect(profileRequests).toEqual([]);
  });

  it('T-ACT-10 proxy.ts source (comments stripped) never mentions role; matcher is 02 §3 verbatim', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'proxy.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/\brole\b/i);
    expect(code).not.toMatch(/getSession\(/);
    expect(code).not.toMatch(/supabase\/admin/);
    expect(code).toMatch(/select\('handle, is_banned'\)/);
    expect(config.matcher).toEqual([
      '/((?!_next/static|_next/image|favicon\\.ico|fonts/|brand/|robots\\.txt|sitemap\\.xml|api/cron/|api/webhooks/|api/download/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2|txt|xml)$).*)',
    ]);
  });
});

describe('T-ACT-10 proxy M4b — banned (ADR-0019)', () => {
  // A banned account sees `/banned` and nothing else: every page navigation is 307'd there before M5
  // (so a banned account with a null handle never reaches `/welcome`); `/banned` itself, `/auth/*` (M3)
  // and `/api/*` pass through; an action POST passes through (M3b) and the action answers `banned`.
  it.each([
    '/',
    '/projects',
    '/projects/pixel-chameleon?tag=mods',
    '/profile',
    '/welcome',
    '/welcome?next=/projects',
    '/admin',
    '/admin/comments',
    '/privacy',
    '/how-comments-work',
    '/skins',
  ])('T-ACT-10 banned on %s → 307 /banned', async (p) => {
    expectRedirect(await proxy(req(p, bannedCookie)), '/banned');
  });

  it('T-ACT-10 banned on /banned → pass through', async () => {
    expectPassThrough(await proxy(req('/banned', bannedCookie)));
  });

  it('T-ACT-10 banned on /auth/* → pass through before the profiles read (M3)', async () => {
    spyOnDb();
    expectPassThrough(await proxy(req('/auth/sign-out', bannedCookie)));
    expectPassThrough(await proxy(req('/auth/callback?code=x', bannedCookie)));
    expect(profileRequests).toEqual([]);
  });

  it('T-ACT-10 banned on /api/* → pass through', async () => {
    expectPassThrough(await proxy(req('/api/health', bannedCookie)));
  });

  it('T-ACT-10 banned with a null handle (factory) → 307 /banned, never /welcome (M4b precedes M5)', async () => {
    const id = await makeUser({ banned: true, handle: null });
    const cookie = cookieHeader(await userSessionCookies(id));
    expectRedirect(await proxy(req('/', cookie)), '/banned');
    expectRedirect(await proxy(req('/welcome', cookie)), '/banned');
    expectPassThrough(await proxy(req('/banned', cookie)));
  });

  it('T-ACT-10 user on /banned → pass through (the page redirects, not the proxy); nohandle → M5 first', async () => {
    expectPassThrough(await proxy(req('/banned', userCookie)));
    // `/banned` is not onboarding-exempt: a not-banned account without a handle still owes one.
    expectRedirect(
      await proxy(req('/banned', nohandleCookie)),
      `/welcome?next=${encodeURIComponent('/banned')}`,
    );
  });

  it('T-ACT-10 anon on /banned → pass through, no DB work (M1; the page sends anon home)', async () => {
    spyOnDb();
    expectPassThrough(await proxy(req('/banned')));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-ACT-10 a banned Server Action POST → pass through (M3b), no profiles read', async () => {
    spyOnDb();
    expectPassThrough(await proxy(actionPost('/profile', bannedCookie)));
    expectPassThrough(await proxy(actionPost('/welcome', bannedCookie)));
    expect(profileRequests).toEqual([]);
  });

  it('T-ACT-10 HEAD behaves like GET (banned on / → 307 /banned)', async () => {
    const res = await proxy(
      new NextRequest(new URL('/', SITE), { method: 'HEAD', headers: { cookie: bannedCookie } }),
    );
    expectRedirect(res, '/banned');
  });
});
