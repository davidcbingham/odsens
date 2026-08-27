/**
 * tests/unit/jobs/cronAuth.test.ts — T-UNIT-24 (04 SC-12 cron bearer check; lib/jobs/cronAuth.ts).
 * `.env.test` supplies `CRON_SECRET=test-cron-secret` (setup.unit.ts loads it before `lib/env.ts`
 * parses). The constant-time property is asserted the way the RLS parity tests do: the module text
 * must do the `crypto.timingSafeEqual` comparison behind an explicit length check.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cronAuth } from '@/lib/jobs/cronAuth';
import { REPO_ROOT } from '@/tests/helpers/envTest';

const SECRET = process.env.CRON_SECRET ?? '';

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/cron/sync-modrinth', { headers });
}

describe('T-UNIT-24 cronAuth', () => {
  it('T-UNIT-24 Bearer <CRON_SECRET> → true', () => {
    expect(SECRET).not.toBe('');
    expect(cronAuth(request({ authorization: `Bearer ${SECRET}` }))).toBe(true);
  });

  it('T-UNIT-24 missing header → false', () => {
    expect(cronAuth(request())).toBe(false);
  });

  it('T-UNIT-24 wrong value (same length) → false', () => {
    const wrong = `${SECRET.slice(0, -1)}X`;
    expect(wrong).toHaveLength(SECRET.length);
    expect(cronAuth(request({ authorization: `Bearer ${wrong}` }))).toBe(false);
  });

  it('T-UNIT-24 wrong length → false (length-checked before timingSafeEqual)', () => {
    expect(cronAuth(request({ authorization: `Bearer ${SECRET}x` }))).toBe(false);
    expect(cronAuth(request({ authorization: 'Bearer ' }))).toBe(false);
  });

  it('T-UNIT-24 Basic scheme → false', () => {
    expect(cronAuth(request({ authorization: `Basic ${SECRET}` }))).toBe(false);
  });

  it('T-UNIT-24 comparison is crypto.timingSafeEqual after a length check (module text)', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'lib', 'jobs', 'cronAuth.ts'), 'utf8');
    expect(source).toContain('timingSafeEqual(given, expected)');
    const lengthCheck = source.indexOf('given.length !== expected.length');
    const comparison = source.indexOf('timingSafeEqual(given, expected)');
    expect(lengthCheck).toBeGreaterThan(-1);
    expect(lengthCheck).toBeLessThan(comparison);
  });
});
