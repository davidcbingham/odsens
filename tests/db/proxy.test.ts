/**
 * tests/db/proxy.test.ts — T-ACT-10 (05 §7.2; 02 §3 M1–M8, RP-19 / RP-20 / RP-21; ADR-0009).
 *
 * Invokes the exported `proxy(request)` with `NextRequest`s whose `Cookie:` header carries the real
 * local-stack session cookies for a role (built the `loginAs` way by tests/helpers/sessionCookies.ts), and
 * none for anon. `proxy.ts` reads `request.cookies`, so the action-context mocks are not involved.
 *
 * "No query on profiles.role" is proven two ways: a `fetch` spy records every PostgREST request the
 * middleware makes (each `/rest/v1/profiles` call must select exactly `handle`), and the source of
 * proxy.ts — comments stripped — contains no `role` token at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { proxy, config } from '@/proxy';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { cookieHeader, seedSessionCookies } from '@/tests/helpers/sessionCookies';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

let nohandleCookie = '';
let userCookie = '';

beforeAll(async () => {
  nohandleCookie = cookieHeader(await seedSessionCookies('nohandle'));
  userCookie = cookieHeader(await seedSessionCookies('user'));
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

describe('T-ACT-10 proxy RP-19 — never reads role', () => {
  it('T-ACT-10 every profiles query selects exactly `handle` (fetch spy)', async () => {
    spyOnDb();
    await proxy(req('/projects', nohandleCookie));
    await proxy(req('/profile', userCookie));
    await proxy(req('/welcome', userCookie));
    const profiles = profileRequests.filter((u) => u.pathname.endsWith('/rest/v1/profiles'));
    expect(profiles.length).toBeGreaterThanOrEqual(3);
    for (const url of profiles) {
      expect(url.searchParams.get('select')).toBe('handle');
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
    expect(code).toMatch(/select\('handle'\)/);
    expect(config.matcher).toEqual([
      '/((?!_next/static|_next/image|favicon\\.ico|fonts/|brand/|robots\\.txt|sitemap\\.xml|api/cron/|api/webhooks/|api/download/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2|txt|xml)$).*)',
    ]);
  });
});
