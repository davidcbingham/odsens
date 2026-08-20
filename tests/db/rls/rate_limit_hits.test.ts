/**
 * tests/db/rls/rate_limit_hits.test.ts — RLS matrix for `rate_limit_hits` + the `rate_limit_ok` /
 * `purge_rate_limit_hits` RPC behaviour (docs/build/05-test-plan.md §7.1 T-RLS-130; data-model
 * §2.10/§4; 04 §5.5; ADR-0002 #14/A4). Policies: 20260820120200_rate_limits.sql — service role
 * only on every op; the RPCs are security definer, execute granted to service_role only (grants are
 * asserted in _rpc-grants.test.ts, T-RLS-129). Cell order: anon | user | banned | mod | admin | svc.
 *
 * Every row this file creates uses scope `t_rls_130` and is deleted in `afterAll` (H-1). Keys are
 * unique per run so earlier hits in a reused local DB (SKIP_DB_RESET=1) cannot skew the counts.
 * A4: the verdict counts only `rate_limit_hits` — `comments` / `project_downloads` do not exist
 * until S1.4 / S1.2, so "unaffected by rows there" is trivially true here and is re-asserted in
 * T-ACT-13/44 once those tables land.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { expectPolicy } from '@/tests/helpers/expectPolicy';

const SCOPE = 't_rls_130';
const NON_SERVICE = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
] as const satisfies readonly TestRole[];
const service = asRole('service');

const uniqueKey = (): string => `k_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

function countRows(key: string): number {
  const count = sql(
    `select count(*) from public.rate_limit_hits where scope = '${SCOPE}' and key = '${key}'`,
  )[0]?.[0];
  return Number(count);
}

afterAll(() => {
  sql(`delete from public.rate_limit_hits where scope = '${SCOPE}'`);
});

// ---------------------------------------------------------------------------------------------
// T-RLS-130 table ops — D | D | D | D | D | A (every op)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-130 rate_limit_hits table access', () => {
  it.each(NON_SERVICE)('T-RLS-130 %s is denied select/insert/update/delete', async (role) => {
    const key = uniqueKey();
    const seeded = await service
      .from('rate_limit_hits')
      .insert({ scope: SCOPE, key })
      .select('key');
    expect(seeded.error).toBeNull();

    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'select',
      role,
      allowed: false,
      filter: { scope: SCOPE, key },
    });
    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'insert',
      role,
      allowed: false,
      row: { scope: SCOPE, key: `${key}_ins` },
    });
    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'update',
      role,
      allowed: false,
      filter: { scope: SCOPE, key },
      patch: { ts: '2020-01-01T00:00:00.000Z' },
    });
    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'delete',
      role,
      allowed: false,
      filter: { scope: SCOPE, key },
    });
    // Nothing changed: the row is still there, untouched, and no insert landed.
    expect(countRows(key)).toBe(1);
    expect(countRows(`${key}_ins`)).toBe(0);
    const ts = sql(
      `select ts from public.rate_limit_hits where scope = '${SCOPE}' and key = '${key}'`,
    )[0]?.[0];
    expect(ts?.startsWith('2020')).toBe(false);
  });

  it('T-RLS-130 service can select/insert/update/delete', async () => {
    const key = uniqueKey();
    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { scope: SCOPE, key },
      expectRows: 1,
    });
    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'select',
      role: 'service',
      allowed: true,
      filter: { scope: SCOPE, key },
      expectRows: 1,
    });
    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { scope: SCOPE, key },
      patch: { ts: '2020-01-01T00:00:00.000Z' },
      expectRows: 1,
    });
    await expectPolicy({
      table: 'rate_limit_hits',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { scope: SCOPE, key },
      expectRows: 1,
    });
    expect(countRows(key)).toBe(0);
  });

  it('T-RLS-130 the table has exactly scope, key, ts (keyless — 01 INV-97 exception)', () => {
    const columns = sql(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'rate_limit_hits' order by ordinal_position",
    ).map(([name]) => name);
    expect(columns).toEqual(['scope', 'key', 'ts']);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-130 rate_limit_ok(scope, key, max, window) as svc: max=2 → true, true, false
// ---------------------------------------------------------------------------------------------
describe('T-RLS-130 rate_limit_ok', () => {
  async function ok(key: string, max = 2, window = '1 minute'): Promise<boolean> {
    const { data, error } = await service.rpc('rate_limit_ok', {
      p_scope: SCOPE,
      p_key: key,
      p_max: max,
      p_window: window,
    });
    expect(error).toBeNull();
    return data as boolean;
  }

  it('T-RLS-130 with max=2: two calls → true, the third → false; every call records one hit', async () => {
    const key = uniqueKey();
    expect(await ok(key)).toBe(true);
    expect(await ok(key)).toBe(true);
    expect(await ok(key)).toBe(false);
    expect(await ok(key)).toBe(false);
    // One row per call, also on the rejected ones (data-model §2.10; brief §1).
    expect(countRows(key)).toBe(4);
  });

  it('T-RLS-130 counts are per (scope, key): a different key is unaffected', async () => {
    const busy = uniqueKey();
    const other = uniqueKey();
    expect(await ok(busy, 1)).toBe(true);
    expect(await ok(busy, 1)).toBe(false);
    expect(await ok(other, 1)).toBe(true);
    // Same key under another scope is its own counter too.
    const { data } = await service.rpc('rate_limit_ok', {
      p_scope: `${SCOPE}_other`,
      p_key: busy,
      p_max: 1,
      p_window: '1 minute',
    });
    expect(data).toBe(true);
    sql(`delete from public.rate_limit_hits where scope = '${SCOPE}_other'`);
  });

  it('T-RLS-130 hits outside the window do not count', async () => {
    const key = uniqueKey();
    sql(
      `insert into public.rate_limit_hits (scope, key, ts) values ('${SCOPE}', '${key}', now() - interval '2 hours'), ('${SCOPE}', '${key}', now() - interval '2 hours')`,
    );
    // Two stale hits + this call = 3 rows, but only 1 inside a 1-minute window → allowed.
    expect(await ok(key, 2, '1 minute')).toBe(true);
    // With a 1-day window the same rows count → over max.
    expect(await ok(key, 2, '1 day')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-130 purge_rate_limit_hits(days) removes rows older than the longest window
// ---------------------------------------------------------------------------------------------
describe('T-RLS-130 purge_rate_limit_hits', () => {
  it('T-RLS-130 purge(1) removes rows older than a day and keeps recent ones', async () => {
    const oldKey = uniqueKey();
    const freshKey = uniqueKey();
    sql(
      `insert into public.rate_limit_hits (scope, key, ts) values ('${SCOPE}', '${oldKey}', now() - interval '2 days'), ('${SCOPE}', '${freshKey}', now())`,
    );
    expect(countRows(oldKey)).toBe(1);

    const { data, error } = await service.rpc('purge_rate_limit_hits', { p_days: 1 });
    expect(error).toBeNull();
    expect(typeof data).toBe('number');
    expect(data as number).toBeGreaterThanOrEqual(1);

    expect(countRows(oldKey)).toBe(0);
    expect(countRows(freshKey)).toBe(1);

    // Nothing older than a day is left anywhere, not only under our scope.
    const stale = sql(
      "select count(*) from public.rate_limit_hits where ts < now() - interval '1 day'",
    )[0]?.[0];
    expect(Number(stale)).toBe(0);
  });
});
