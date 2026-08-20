/**
 * tests/db/rls/public_profiles.test.ts — matrix for the `public_profiles` view (docs/build/05-test-plan.md
 * §7.1 T-RLS-10/11; data-model §2.1/§4; 01 INV-45). Definer view, SELECT granted to anon +
 * authenticated; column set is exactly id, handle, avatar_path, role. Read-only: the seed rows are
 * never written here. Cell order: anon | user | banned | mod | admin | svc.
 */
import { describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { SEED_USERS } from '@/tests/helpers/seedIds';

const ALL_ROLES = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
  'service',
] as const satisfies readonly TestRole[];
const PUBLIC_COLUMNS = ['id', 'handle', 'avatar_path', 'role'] as const;

// ---------------------------------------------------------------------------------------------
// T-RLS-10 select any row — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-10 public_profiles select any row', () => {
  it.each(ALL_ROLES)('T-RLS-10 %s reads every profile through the view', async (role) => {
    const { data, error } = await asRole(role).from('public_profiles').select('*');
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    for (const id of Object.values(SEED_USERS)) expect(ids.has(id)).toBe(true);
    // Incl. the onboarding-incomplete row (handle NULL) — the view hides nothing.
    expect(data?.find((r) => r.id === SEED_USERS.seed_newbie)?.handle).toBeNull();
  });

  it('T-RLS-10 anon can look a handle up (case-insensitive citext)', async () => {
    const { data, error } = await asRole('anon')
      .from('public_profiles')
      .select('id, handle')
      .eq('handle', 'SEED_USER');
    expect(error).toBeNull();
    expect(data).toEqual([{ id: SEED_USERS.seed_user, handle: 'seed_user' }]);
  });

  it('T-RLS-10 the view is read-only for every role (SELECT-only grant)', async () => {
    for (const role of ['anon', 'user', 'admin'] as const) {
      await expectPolicy({
        table: 'public_profiles',
        op: 'update',
        role,
        allowed: false,
        filter: { id: SEED_USERS.seed_user },
        patch: { handle: 't_view_write' },
      });
      await expectPolicy({
        table: 'public_profiles',
        op: 'delete',
        role,
        allowed: false,
        filter: { id: SEED_USERS.seed_user },
      });
    }
    const { data } = await asRole('anon')
      .from('public_profiles')
      .select('handle')
      .eq('id', SEED_USERS.seed_user);
    expect(data).toEqual([{ handle: 'seed_user' }]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-11 column set is exactly id, handle, avatar_path, role — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-11 public_profiles column set', () => {
  it.each(ALL_ROLES)('T-RLS-11 %s sees exactly id, handle, avatar_path, role', async (role) => {
    const { data, error } = await asRole(role)
      .from('public_profiles')
      .select('*')
      .eq('id', SEED_USERS.seed_banned);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual([...PUBLIC_COLUMNS].sort());
    // The banned flag and reason are not observable here.
    expect(data?.[0]).toEqual({
      id: SEED_USERS.seed_banned,
      handle: 'seed_banned',
      avatar_path: null,
      role: 'user',
    });
  });

  it('T-RLS-11 the catalog agrees (no email_hash / is_banned / banned_reason / handle_changed_at)', () => {
    const columns = sql(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_profiles' order by ordinal_position",
    ).map(([name]) => name);
    expect(columns).toEqual([...PUBLIC_COLUMNS]);
  });

  it('T-RLS-11 selecting a hidden column through the view fails', async () => {
    for (const column of ['email_hash', 'is_banned', 'banned_reason', 'handle_changed_at']) {
      const { error } = await asRole('user')
        .from('public_profiles')
        .select(column as 'id')
        .limit(1);
      expect(error, `${column} must not be selectable`).not.toBeNull();
    }
  });
});
