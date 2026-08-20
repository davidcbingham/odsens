/**
 * tests/db/actions/checkHandle.test.ts — T-ACT-7 (05 §7.2; 04 §1.1 `checkHandle` / RPC `check_handle`).
 *
 * Status per role, the four states, "never returns the owning profile id", the 61st call in a minute,
 * and SQL ↔ TS reserved-list parity (the RPC says `reserved` for every `RESERVED_HANDLES` entry, and the
 * array literal inside `check_handle`'s body equals the TS list exactly — T-UNIT-2's twin).
 * The 61-call run uses a factory user so the seed `user`'s budget stays untouched for other files.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { checkHandle } from '@/lib/actions/accounts';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { RESERVED_HANDLES } from '@/lib/validation/handle';
import { freeHandle } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS, type SeedRole } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { sql } from '@/tests/helpers/db';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';

setupActionMocks();

afterAll(async () => {
  await cleanupFactories();
});

const STATUSES = ['available', 'taken', 'reserved', 'invalid'];

describe('T-ACT-7 checkHandle', () => {
  it('T-ACT-7 anon → unauthenticated', async () => {
    const error = expectFail(
      await callAction(checkHandle, { handle: freeHandle() }, { role: 'anon' }),
      'unauthenticated',
    );
    expect(error.message).toBe('Sign in first.');
  });

  it.each<SeedRole>(['user', 'banned', 'mod', 'admin', 'nohandle', 'user0'])(
    'T-ACT-7 %s → ok { status } for a free handle',
    async (role) => {
      const data = expectOk(
        await callAction(checkHandle, { handle: freeHandle('t_free_') }, { role }),
      );
      expect(data).toEqual({ status: 'available' });
      expect(STATUSES).toContain(data.status);
    },
  );

  it.each([
    { handle: 'SEED_USER', status: 'taken' },
    { handle: 'seed_mod', status: 'taken' },
    { handle: 'Admin', status: 'reserved' },
    { handle: 'oddsense', status: 'reserved' },
    { handle: 'ab', status: 'invalid' },
    { handle: 'a'.repeat(21), status: 'invalid' },
    { handle: 'bad-name', status: 'invalid' },
    { handle: 'someone@localhost.test', status: 'invalid' },
    { handle: '', status: 'invalid' },
    { handle: 'x'.repeat(64), status: 'invalid' },
  ])('T-ACT-7 "$handle" → $status', async ({ handle, status }) => {
    const data = expectOk(await callAction(checkHandle, { handle }, { role: 'user0' }));
    expect(data).toEqual({ status });
  });

  it("T-ACT-7 the caller's own handle is not 'taken' (RPC excludes auth.uid())", async () => {
    const data = expectOk(await callAction(checkHandle, { handle: 'Seed_User' }, { role: 'user' }));
    expect(data.status).toBe('available');
  });

  it('T-ACT-7 never returns the owning profile id', async () => {
    const res = await callAction(checkHandle, { handle: 'seed_user' }, { role: 'user0' });
    const data = expectOk(res);
    expect(Object.keys(data)).toEqual(['status']);
    expect(JSON.stringify(res)).not.toContain(SEED_ROLE_IDS.user);
  });

  it('T-ACT-7 61st call in a minute → rate_limited', async () => {
    const id = await makeUser();
    for (let batch = 0; batch < 6; batch += 1) {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          callActionAs(checkHandle, { handle: freeHandle() }, { profileId: id }),
        ),
      );
      for (const res of results) expectOk(res);
    }
    const error = expectFail(
      await callActionAs(checkHandle, { handle: freeHandle() }, { profileId: id }),
      'rate_limited',
    );
    expect(error.message).toBe(RATE_LIMITED_MESSAGE);
  });

  it.each([...RESERVED_HANDLES])(
    'T-ACT-7 SQL check_handle("%s") → reserved (parity)',
    async (entry) => {
      // `me` (2 chars) fails H1 first: 04 §1.1 order is invalid → reserved → taken, so the SQL answers
      // 'invalid' for it — same as `handleReason('me')` in TS. Both sides agree; that is the parity.
      const expected = entry.length < 3 ? 'invalid' : 'reserved';
      const user = asRole('user');
      const lower = await user.rpc('check_handle', { p_handle: entry });
      expect(lower.error).toBeNull();
      expect(lower.data).toBe(expected);
      const upper = await user.rpc('check_handle', { p_handle: entry.toUpperCase() });
      expect(upper.data).toBe(expected);
    },
  );

  it('T-ACT-7 the array literal inside check_handle equals RESERVED_HANDLES (both directions)', () => {
    const rows = sql(
      "select (regexp_match(pg_get_functiondef('public.check_handle(text)'::regprocedure), 'array\\[(.*?)\\]'))[1]",
    );
    const literal = rows.map((cells) => cells.join('|')).join(' ');
    const inSql = [...literal.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    expect(inSql).toEqual([...RESERVED_HANDLES]);
  });
});
