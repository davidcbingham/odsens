/**
 * tests/unit/auth-safeNext.test.ts — T-UNIT-44: `safeNext(next)` (02 RP-20; 01 INV-32; 04 §2.1 A1).
 * `safeNext` is pure, but `lib/auth.ts` also imports the cookie server client; `server-only` is
 * mocked by tests/helpers/setup.unit.ts and `next/headers` is stubbed here so the import never
 * needs a request context (no function under test touches it).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const { safeNext } = await import('@/lib/auth');

// Control characters spelled out by code so no escape sequence hides in the source.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const DEL = String.fromCharCode(127);

describe('safeNext (T-UNIT-44)', () => {
  it.each([
    '/projects/x#comments',
    '/support?x=1',
    '/',
    '/projects',
    '/welcome',
    '/profile',
    '/apis/x', // `/api` prefix only matches at a path boundary
    '/authors',
    '/administrator',
    '/ok x', // a plain space is not a control character
  ])('T-UNIT-44 %s → unchanged', (next) => {
    expect(safeNext(next)).toBe(next);
  });

  it.each([
    undefined,
    null,
    '',
    'https://evil.example',
    '//evil',
    '/\\evil',
    '/api/x',
    '/api',
    '/api?x=1',
    '/auth/callback',
    '/auth',
    '/admin',
    '/admin/projects',
    '/admin#x',
    'projects',
    'javascript:alert(1)',
    '/ok\\evil',
    `/ok${CR}${LF}Set-Cookie: x`,
    `/ok${LF}x`,
    `/${TAB}/evil`,
    `/ok${NUL}x`,
    `/ok${DEL}`,
  ])('T-UNIT-44 %j → /', (next) => {
    expect(safeNext(next)).toBe('/');
  });
});
