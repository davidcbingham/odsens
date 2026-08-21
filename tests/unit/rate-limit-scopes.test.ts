/**
 * tests/unit/rate-limit-scopes.test.ts — T-UNIT-37: `lib/rate-limit.ts` `SCOPES` == the 04 §5.5 rows
 * (18 scopes, exact max/window), unknown scope throws, and `assertRateLimit` hands each scope's
 * defaults to the `rate_limit_ok` RPC and fails closed. `@/lib/supabase/admin` is mocked so nothing
 * touches the DB here — the window math and the one-row-per-call assertion are T-RLS-130 / T-ACT-* (db lane).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc }),
}));

const { RATE_LIMITED_MESSAGE, RateLimitError, SCOPES, assertRateLimit } =
  await import('@/lib/rate-limit');

/** 04 §5.5 — verbatim, document order. */
const EXPECTED_ROWS = [
  ['comment', 5, '1 minute'],
  ['comment_day', 50, '24 hours'],
  ['comment_edit', 20, '1 minute'],
  ['comment_delete', 20, '1 minute'],
  ['report', 10, '1 hour'],
  ['like', 60, '1 minute'],
  ['download', 30, '1 minute'],
  ['onboarding', 10, '10 minutes'],
  ['check_handle', 60, '1 minute'],
  ['avatar', 10, '10 minutes'],
  ['delete_account', 1, '1 day'],
  ['upload:project-media', 60, '1 hour'],
  ['upload:art', 60, '1 hour'],
  ['upload:project-files', 30, '1 hour'],
  ['upload:skins', 60, '1 hour'],
  ['project_link', 30, '1 hour'],
  ['mention_preview', 30, '1 minute'],
  ['discord_test', 10, '1 minute'],
] as const;

type ScopeName = (typeof EXPECTED_ROWS)[number][0];

const INTERVAL_LITERAL = /^[1-9]\d* (minute|minutes|hour|hours|day|days)$/;

beforeEach(() => {
  rpc.mockReset();
});

describe('SCOPES (T-UNIT-37)', () => {
  it('T-UNIT-37 is exactly the 18 rows of 04 §5.5 (names, order, max, window)', () => {
    const actual = Object.entries(SCOPES).map(([scope, rule]) => [scope, rule.max, rule.window]);
    expect(actual).toEqual(EXPECTED_ROWS.map((row) => [...row]));
    expect(Object.keys(SCOPES)).toHaveLength(18);
  });

  it.each(EXPECTED_ROWS)('T-UNIT-37 %s = %d per %s', (scope, max, window) => {
    expect(SCOPES[scope]).toEqual({ max, window });
  });

  it('T-UNIT-37 every window is a Postgres interval literal and every max a positive integer', () => {
    for (const [scope, rule] of Object.entries(SCOPES)) {
      expect(rule.window, scope).toMatch(INTERVAL_LITERAL);
      expect(Number.isInteger(rule.max), scope).toBe(true);
      expect(rule.max, scope).toBeGreaterThan(0);
    }
  });

  it('T-UNIT-37 the copy is "Slow down a little." and the error code is rate_limited', () => {
    expect(RATE_LIMITED_MESSAGE).toBe('Slow down a little.');
    const error = new RateLimitError();
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('rate_limited');
    expect(error.message).toBe(RATE_LIMITED_MESSAGE);
    expect(error.name).toBe('RateLimitError');
  });
});

describe('assertRateLimit (T-UNIT-37)', () => {
  it.each(EXPECTED_ROWS)(
    'T-UNIT-37 %s passes max %d / window %s to rate_limit_ok by default',
    async (scope, max, window) => {
      rpc.mockResolvedValueOnce({ data: true, error: null });
      await expect(assertRateLimit(scope, 'key-1')).resolves.toBeUndefined();
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith('rate_limit_ok', {
        p_scope: scope,
        p_key: 'key-1',
        p_max: max,
        p_window: window,
      });
    },
  );

  it('T-UNIT-37 explicit max / window override the defaults', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await assertRateLimit('comment', 'k', 2, '5 seconds');
    expect(rpc).toHaveBeenCalledWith('rate_limit_ok', {
      p_scope: 'comment',
      p_key: 'k',
      p_max: 2,
      p_window: '5 seconds',
    });
  });

  it('T-UNIT-37 RPC false → RateLimitError (code rate_limited, "Slow down a little.")', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const pending = assertRateLimit('onboarding', 'profile-1');
    await expect(pending).rejects.toBeInstanceOf(RateLimitError);
    await expect(assertRateLimit('onboarding', 'profile-1')).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Slow down a little.',
    });
  });

  it('T-UNIT-37 anything but a literal `true` from the RPC is a rejection (null / undefined)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(assertRateLimit('like', 'k')).rejects.toBeInstanceOf(RateLimitError);
    rpc.mockResolvedValueOnce({ data: undefined, error: null });
    await expect(assertRateLimit('like', 'k')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('T-UNIT-37 an RPC error fails closed with a plain Error (→ internal), never RateLimitError', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'boom' } });
    const pending = assertRateLimit('download', 'ip-hash');
    await expect(pending).rejects.toThrow(/rate_limit_ok failed: 42883/);
    await expect(assertRateLimit('download', 'ip-hash')).rejects.not.toBeInstanceOf(RateLimitError);
  });

  it('T-UNIT-37 an unknown scope throws before any RPC call', async () => {
    const bogus = 'not_a_scope' as unknown as ScopeName;
    await expect(assertRateLimit(bogus, 'k')).rejects.toThrow(/unknown scope "not_a_scope"/);
    await expect(assertRateLimit('' as unknown as ScopeName, 'k')).rejects.toThrow(/unknown scope/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('T-UNIT-37 an empty key throws before any RPC call (a blank key would pool every caller)', async () => {
    await expect(assertRateLimit('comment', '')).rejects.toThrow(/empty key/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
