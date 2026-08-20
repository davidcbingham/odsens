/**
 * tests/db/rls/profiles.test.ts — RLS matrix for `profiles` (docs/build/05-test-plan.md §7.1
 * T-RLS-1..9) plus the identity trigger (T-RLS-125) and the "no direct anon-key path to secrets"
 * checks (T-RLS-127). Policies: supabase/migrations/20260820120000_profiles.sql; matrix source
 * docs/data-model.md §4. Column order of every cell comment: anon | user | banned | mod | admin | svc.
 *
 * Seed rows are read-only (H-1) except where a cell needs a write; every touched seed row is restored
 * to its SEED-3 shape in `afterAll` through psql (no JWT → `profiles_guard` passes). Factory users
 * (T-RLS-3/5/9/125) are removed by `cleanupFactories` / `auth.admin.deleteUser`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { emailHash } from '@/lib/hash';
import { asRole, asUser, SEED_ROLE_IDS, type SeedRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { SEED_USERS } from '@/tests/helpers/seedIds';

const JWT_ROLES = ['user', 'banned', 'mod', 'admin'] as const satisfies readonly SeedRole[];
/** Signed-in, non-admin roles: every write beyond avatar_path / first handle is denied for them. */
const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly SeedRole[];

const SEED_HANDLES: Readonly<Record<SeedRole, string | null>> = {
  admin: 'oddsense',
  mod: 'seed_mod',
  user: 'seed_user',
  user0: 'seed_user2',
  banned: 'seed_banned',
  nohandle: null,
};

const tag = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 6)}`;

const service = asRole('service');

/**
 * ADR-0015 (2026-08-20, T-RLS-5/8/9 admin cells): Postgres applies the SELECT policies to every
 * UPDATE/DELETE whose WHERE or RETURNING references a column, and PostgREST always emits both. With
 * `profiles` select = own row only (T-RLS-2 admin D, ADR-0002 #70) an admin JWT can never update or
 * delete ANOTHER user's row through RLS: `is_admin()` is true and the update/delete policy passes,
 * but the target row is filtered out → 0 rows, no error. Decision: schema stays as built; the admin
 * JWT cells of T-RLS-8 / T-RLS-9 are D and service is A; T-RLS-5 admin is A on the admin's OWN row
 * (a factory admin whose handle is still NULL). Admin/moderator mutations of other users' rows go
 * through the service client in Server Actions after `requireRole` (04 SC-06).
 */

/** Admin-created auth users that are not factory users (T-RLS-125) — deleted in afterAll. */
const adminCreatedUsers: string[] = [];

async function profileRow(id: string) {
  const { data, error } = await service.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`service could not read profiles ${id}: ${error.message}`);
  return data;
}

/** SEED-3 shape for the six seed profiles (05 §3) — restores everything this file may touch. */
function restoreSeedProfiles(): void {
  sql(`
    update public.profiles p
       set handle = s.handle::extensions.citext, role = s.role::public.user_role,
           comment_count = s.comment_count, is_banned = s.is_banned, banned_reason = s.banned_reason,
           avatar_path = null, handle_changed_at = null, email_hash = null
      from (values
        ('${SEED_USERS.oddsense}'::uuid,    'oddsense',    'admin',     1, false, null),
        ('${SEED_USERS.seed_mod}'::uuid,    'seed_mod',    'moderator', 0, false, null),
        ('${SEED_USERS.seed_user}'::uuid,   'seed_user',   'user',      2, false, null),
        ('${SEED_USERS.seed_user2}'::uuid,  'seed_user2',  'user',      0, false, null),
        ('${SEED_USERS.seed_banned}'::uuid, 'seed_banned', 'user',      1, true,  'seed'),
        ('${SEED_USERS.seed_newbie}'::uuid, null,          'user',      0, false, null)
      ) as s (id, handle, role, comment_count, is_banned, banned_reason)
     where p.id = s.id
  `);
}

afterAll(async () => {
  restoreSeedProfiles();
  await cleanupFactories();
  for (const id of adminCreatedUsers.splice(0)) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error && error.status !== 404) throw new Error(`deleteUser(${id}): ${error.message}`);
  }
});

// ---------------------------------------------------------------------------------------------
// T-RLS-1 select own row — D | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-1 profiles select own row', () => {
  it('T-RLS-1 anon cannot select a profile row at all', async () => {
    await expectPolicy({
      table: 'profiles',
      op: 'select',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_USERS.seed_user },
    });
  });

  it.each(JWT_ROLES)(
    'T-RLS-1 %s selects own row with every column incl. email_hash',
    async (role) => {
      const { data, error } = await asRole(role)
        .from('profiles')
        .select('*')
        .eq('id', SEED_ROLE_IDS[role]);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data?.[0];
      expect(row?.id).toBe(SEED_ROLE_IDS[role]);
      expect(Object.keys(row ?? {}).sort()).toEqual(
        [
          'avatar_path',
          'banned_reason',
          'comment_count',
          'created_at',
          'email_hash',
          'handle',
          'handle_changed_at',
          'id',
          'is_banned',
          'role',
          'updated_at',
        ].sort(),
      );
    },
  );

  it('T-RLS-1 service selects any row', async () => {
    await expectPolicy({
      table: 'profiles',
      op: 'select',
      role: 'service',
      allowed: true,
      filter: { id: SEED_USERS.seed_banned },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-2 select another user's row — D | D | D | D | D | A   (ADR-0002 #70: admin too)
// ---------------------------------------------------------------------------------------------
describe("T-RLS-2 profiles select another user's row", () => {
  it.each(['anon', ...JWT_ROLES] as const)(
    'T-RLS-2 %s cannot read another profile',
    async (role) => {
      const target = role === 'user' ? SEED_USERS.seed_user2 : SEED_USERS.seed_user;
      await expectPolicy({
        table: 'profiles',
        op: 'select',
        role,
        allowed: false,
        filter: { id: target },
      });
    },
  );

  it('T-RLS-2 user sees exactly one row with no filter (own row only)', async () => {
    const { data, error } = await asRole('user').from('profiles').select('id');
    expect(error).toBeNull();
    expect(data?.map((r) => r.id)).toEqual([SEED_USERS.seed_user]);
  });

  it('T-RLS-2 service reads every row', async () => {
    const { data, error } = await service.from('profiles').select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-3 insert (direct) — D | D | D | D | D | A   (creation is trigger-only)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-3 profiles insert (direct)', () => {
  it('T-RLS-3 only service can insert a profile row directly', async () => {
    // An auth user whose trigger-created profile is removed, so a denial is never "FK failed".
    const id = await makeUser({ handle: null });
    const removed = await service.from('profiles').delete().eq('id', id).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);

    for (const role of ['anon', ...JWT_ROLES] as const) {
      await expectPolicy({ table: 'profiles', op: 'insert', role, allowed: false, row: { id } });
    }
    expect(await profileRow(id)).toBeNull();

    await expectPolicy({
      table: 'profiles',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { id },
      expectRows: 1,
    });
    expect((await profileRow(id))?.role).toBe('user');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-4 update own avatar_path — D | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-4 profiles update own avatar_path', () => {
  it('T-RLS-4 anon cannot update avatar_path', async () => {
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_USERS.seed_user },
      patch: { avatar_path: 't_rls4.webp' },
    });
  });

  it.each(JWT_ROLES)('T-RLS-4 %s updates own avatar_path', async (role) => {
    const id = SEED_ROLE_IDS[role];
    const avatarPath = `${id}/${tag('t_rls4')}.webp`;
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role,
      allowed: true,
      filter: { id },
      patch: { avatar_path: avatarPath },
      expectRows: 1,
    });
    expect((await profileRow(id))?.avatar_path).toBe(avatarPath);
    // Owner may also clear it.
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role,
      allowed: true,
      filter: { id },
      patch: { avatar_path: null },
      expectRows: 1,
    });
    expect((await profileRow(id))?.avatar_path).toBeNull();
  });

  it('T-RLS-4 service updates avatar_path (then restores)', async () => {
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id: SEED_USERS.seed_user2 },
      patch: { avatar_path: 't_rls4_svc.webp' },
      expectRows: 1,
    });
    restoreSeedProfiles();
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-5 update own handle when currently NULL — — | A (nohandle) | — | — | A (own row, ADR-0015) | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-5 profiles first handle (NULL → value)', () => {
  const newbie = SEED_USERS.seed_newbie;

  async function resetNewbieHandle(): Promise<void> {
    const { error } = await service.from('profiles').update({ handle: null }).eq('id', newbie);
    if (error) throw new Error(`could not reset seed_newbie handle: ${error.message}`);
  }

  it('T-RLS-5 nohandle sets their own first handle', async () => {
    expect((await profileRow(newbie))?.handle).toBeNull();
    const handle = tag('t_nh');
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'nohandle',
      allowed: true,
      filter: { id: newbie },
      patch: { handle },
      expectRows: 1,
    });
    expect((await profileRow(newbie))?.handle).toBe(handle);
    await resetNewbieHandle();
  });

  it('T-RLS-5 admin sets their own first handle (factory admin, NULL → value; ADR-0015)', async () => {
    // The seed admin already has a handle, so the cell needs an admin whose handle is still NULL.
    const adminId = await makeUser({ role: 'admin', handle: null });
    const before = await profileRow(adminId);
    expect(before?.role).toBe('admin');
    expect(before?.handle).toBeNull();

    const handle = tag('t_rls5');
    const { data, error } = await asUser(adminId)
      .from('profiles')
      .update({ handle })
      .eq('id', adminId)
      .select('id');
    expect(error, `factory admin own-row first handle failed: ${error?.message ?? ''}`).toBeNull();
    expect(data).toHaveLength(1);
    expect((await profileRow(adminId))?.handle).toBe(handle);
    // Row is removed by cleanupFactories (afterAll).
  });

  it('T-RLS-5 service sets a NULL handle', async () => {
    const handle = tag('t_nhs');
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id: newbie },
      patch: { handle },
      expectRows: 1,
    });
    expect((await profileRow(newbie))?.handle).toBe(handle);
    await resetNewbieHandle();
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-6 update own handle when already set — D | D | D | D | A | A   (renames = updateProfile/service)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-6 profiles rename an existing handle', () => {
  it('T-RLS-6 anon cannot rename', async () => {
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_USERS.seed_user },
      patch: { handle: tag('t_r6') },
    });
  });

  it.each(NON_ADMIN)(
    'T-RLS-6 %s cannot rename their own handle (profiles_guard 42501)',
    async (role) => {
      const id = SEED_ROLE_IDS[role];
      await expectPolicy({
        table: 'profiles',
        op: 'update',
        role,
        allowed: false,
        filter: { id },
        patch: { handle: tag('t_r6') },
      });
      // Case-only change is a rename too (guard compares as text).
      const upper = SEED_HANDLES[role]?.toUpperCase() ?? '';
      await expectPolicy({
        table: 'profiles',
        op: 'update',
        role,
        allowed: false,
        filter: { id },
        patch: { handle: upper },
      });
      expect((await profileRow(id))?.handle).toBe(SEED_HANDLES[role]);
    },
  );

  it('T-RLS-6 nohandle cannot rename once the first handle is set', async () => {
    const newbie = SEED_USERS.seed_newbie;
    const first = tag('t_r6n');
    const set = await service.from('profiles').update({ handle: first }).eq('id', newbie);
    expect(set.error).toBeNull();
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'nohandle',
      allowed: false,
      filter: { id: newbie },
      patch: { handle: tag('t_r6n') },
    });
    expect((await profileRow(newbie))?.handle).toBe(first);
    const reset = await service.from('profiles').update({ handle: null }).eq('id', newbie);
    expect(reset.error).toBeNull();
  });

  it('T-RLS-6 admin renames their own handle', async () => {
    const id = SEED_USERS.oddsense;
    const handle = tag('t_r6a');
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'admin',
      allowed: true,
      filter: { id },
      patch: { handle },
      expectRows: 1,
    });
    expect((await profileRow(id))?.handle).toBe(handle);
    restoreSeedProfiles();
    expect((await profileRow(id))?.handle).toBe('oddsense');
  });

  it('T-RLS-6 service renames a handle', async () => {
    const id = SEED_USERS.seed_user;
    const handle = tag('t_r6s');
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: { handle },
      expectRows: 1,
    });
    expect((await profileRow(id))?.handle).toBe(handle);
    restoreSeedProfiles();
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-7 update own role/is_banned/comment_count/email_hash/handle_changed_at — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-7 profiles guarded columns', () => {
  const GUARDED = {
    role: 'admin',
    is_banned: true,
    comment_count: 99,
    email_hash: 'a'.repeat(64),
    handle_changed_at: '2026-01-01T00:00:00.000Z',
  } as const;
  type Guarded = keyof typeof GUARDED;
  const columns = Object.keys(GUARDED) as Guarded[];

  it('T-RLS-7 anon cannot touch guarded columns', async () => {
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_USERS.seed_user },
      patch: { comment_count: 99 },
    });
  });

  const cells = NON_ADMIN.flatMap((role) => columns.map((column) => [role, column] as const));
  it.each(cells)('T-RLS-7 %s cannot change own %s', async (role, column) => {
    const id = SEED_ROLE_IDS[role];
    // Flip relative to the row so the patch is a real change for every role.
    const value =
      column === 'is_banned'
        ? role !== 'banned'
        : column === 'role' && role === 'mod'
          ? 'admin'
          : GUARDED[column];
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role,
      allowed: false,
      filter: { id },
      patch: { [column]: value },
    });
    // The row still has its SEED-3 shape.
    const row = await profileRow(id);
    expect(row?.role).toBe(role === 'mod' ? 'moderator' : 'user');
    expect(row?.is_banned).toBe(role === 'banned');
    expect(row?.comment_count).toBe(role === 'user' ? 2 : role === 'banned' ? 1 : 0);
    expect(row?.email_hash).toBeNull();
    expect(row?.handle_changed_at).toBeNull();
  });

  it('T-RLS-7 admin changes guarded columns on own row', async () => {
    const id = SEED_USERS.oddsense;
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'admin',
      allowed: true,
      filter: { id },
      patch: { ...GUARDED, is_banned: false },
      expectRows: 1,
    });
    const row = await profileRow(id);
    expect(row?.comment_count).toBe(99);
    expect(row?.email_hash).toBe(GUARDED.email_hash);
    expect(row?.handle_changed_at).not.toBeNull();
    restoreSeedProfiles();
    expect((await profileRow(id))?.comment_count).toBe(1);
  });

  it('T-RLS-7 service changes guarded columns', async () => {
    const id = SEED_USERS.seed_user;
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: { ...GUARDED, role: 'moderator' },
      expectRows: 1,
    });
    const row = await profileRow(id);
    expect(row?.role).toBe('moderator');
    expect(row?.is_banned).toBe(true);
    restoreSeedProfiles();
    const restored = await profileRow(id);
    expect(restored?.role).toBe('user');
    expect(restored?.is_banned).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-8 update another user's row (any column) — D | D | D | D | D (ADR-0015) | A
// ---------------------------------------------------------------------------------------------
describe("T-RLS-8 profiles update another user's row", () => {
  const target = SEED_USERS.seed_user2;

  it.each(['anon', ...NON_ADMIN] as const)(
    "T-RLS-8 %s cannot update another user's row",
    async (role) => {
      await expectPolicy({
        table: 'profiles',
        op: 'update',
        role,
        allowed: false,
        filter: { id: target },
        patch: { avatar_path: 't_rls8.webp' },
      });
      expect((await profileRow(target))?.avatar_path).toBeNull();
    },
  );

  it("T-RLS-8 admin JWT cannot update another user's row; service can (ADR-0015)", async () => {
    const original = (await profileRow(target))?.avatar_path ?? null;
    const patch = { avatar_path: `${target}/${tag('t_rls8')}.webp` };

    // Admin JWT: the update policy passes (`is_admin()`), but own-row select filters the target out
    // → 0 rows, no error. expectPolicy proves the row exists via service first.
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'admin',
      allowed: false,
      filter: { id: target },
      patch,
    });
    expect((await profileRow(target))?.avatar_path).toBe(original);

    // The same patch through the service client lands.
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id: target },
      patch,
      expectRows: 1,
    });
    expect((await profileRow(target))?.avatar_path).toBe(patch.avatar_path);

    const restored = await service
      .from('profiles')
      .update({ avatar_path: original })
      .eq('id', target)
      .select('id');
    expect(restored.error).toBeNull();
    expect(restored.data).toHaveLength(1);
    expect((await profileRow(target))?.avatar_path).toBe(original);
  });

  it("T-RLS-8 service updates another user's row", async () => {
    const avatarPath = `${target}/${tag('t_rls8')}.webp`;
    await expectPolicy({
      table: 'profiles',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id: target },
      patch: { avatar_path: avatarPath, comment_count: 7 },
      expectRows: 1,
    });
    const row = await profileRow(target);
    expect(row?.avatar_path).toBe(avatarPath);
    expect(row?.comment_count).toBe(7);
    restoreSeedProfiles();
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-9 delete — D | D | D | D | D (ADR-0015) | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-9 profiles delete', () => {
  it('T-RLS-9 anon/user/banned/mod cannot delete; service can', async () => {
    const victimA = await makeUser({});
    for (const role of ['anon', ...NON_ADMIN] as const) {
      await expectPolicy({
        table: 'profiles',
        op: 'delete',
        role,
        allowed: false,
        filter: { id: victimA },
      });
    }
    // Non-admins cannot even delete their own row (the policy is admin-only).
    await expectPolicy({
      table: 'profiles',
      op: 'delete',
      role: 'user',
      allowed: false,
      filter: { id: SEED_USERS.seed_user },
    });
    expect(await profileRow(victimA)).not.toBeNull();

    await expectPolicy({
      table: 'profiles',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { id: victimA },
      expectRows: 1,
    });
    expect(await profileRow(victimA)).toBeNull();
  });

  it("T-RLS-9 admin JWT cannot delete another user's row; service can (ADR-0015)", async () => {
    const victim = await makeUser({});

    // Admin JWT: delete policy passes (`is_admin()`), own-row select filters the target → 0 rows.
    await expectPolicy({
      table: 'profiles',
      op: 'delete',
      role: 'admin',
      allowed: false,
      filter: { id: victim },
    });
    expect(await profileRow(victim)).not.toBeNull();

    // The same delete through PostgREST as service removes the profiles row (auth user is
    // removed by cleanupFactories in afterAll).
    await expectPolicy({
      table: 'profiles',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { id: victim },
      expectRows: 1,
    });
    expect(await profileRow(victim)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-125 auth.users insert fires handle_new_user(): handle NULL, role 'user', email_hash NULL.
// The route-level write of email_hash by /auth/callback is asserted in T-ACT-8 (tests/db/routes).
// ---------------------------------------------------------------------------------------------
describe('T-RLS-125 profile trigger + email hashing contract', () => {
  it('T-RLS-125 a new auth user gets a bare profile row (no email_hash from the trigger)', async () => {
    const id = randomUUID();
    const email = `t_${id}@localhost.test`;
    const { data, error } = await service.auth.admin.createUser({
      id,
      email,
      password: 'seed-password',
      email_confirm: true,
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(id);
    adminCreatedUsers.push(id);

    let row = await profileRow(id);
    for (let attempt = 0; attempt < 5 && row === null; attempt += 1) {
      await new Promise((r) => setTimeout(r, 100));
      row = await profileRow(id);
    }
    expect(row).not.toBeNull();
    expect(row?.handle).toBeNull();
    expect(row?.role).toBe('user');
    expect(row?.email_hash).toBeNull();
    expect(row?.is_banned).toBe(false);
    expect(row?.comment_count).toBe(0);
    expect(row?.avatar_path).toBeNull();
    expect(row?.handle_changed_at).toBeNull();

    // The raw email lives only in auth.users: no `public` column is named email, and the profile
    // row never carries the address (ADR-0002 A14).
    expect(
      sql(
        "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'email'",
      ),
    ).toEqual([]);
    expect(JSON.stringify(row)).not.toContain(email);
  });

  it('T-RLS-125 emailHash(email) is a 64-hex keyed digest that never contains the address', () => {
    const email = 'seed-newbie@localhost.test';
    const digest = emailHash(email);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(email);
    expect(digest).not.toContain('seed-newbie');
    // Normalised (trim + lowercase), so the callback and Ko-fi matching agree.
    expect(emailHash('  SEED-NEWBIE@localhost.test ')).toBe(digest);
    expect(emailHash('seed-user@localhost.test')).not.toBe(digest);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-127 direct anon-key access to auth.users, storage.objects metadata of project-files and
// another user's profiles.email_hash all fail.
// ---------------------------------------------------------------------------------------------
describe('T-RLS-127 no direct anon-key path to secrets', () => {
  const restUrl = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1`;
  const anonKey = requireTestEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  async function restGet(table: string, schema: string): Promise<Response> {
    return fetch(`${restUrl}/${table}?select=*&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Accept-Profile': schema },
    });
  }

  it('T-RLS-127 anon key cannot read auth.users through PostgREST', async () => {
    const res = await restGet('users', 'auth');
    expect(res.ok).toBe(false);
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(false);
  });

  it('T-RLS-127 anon key cannot read storage.objects metadata', async () => {
    const res = await restGet('objects', 'storage');
    expect(res.ok).toBe(false);
    // …and the Storage API exposes no project-files listing to anon (bucket arrives in S1.3; until
    // then "not found" and "denied" are both failures — never a listing).
    const list = await asRole('anon').storage.from('project-files').list();
    expect(list.error !== null || (list.data ?? []).length === 0).toBe(true);
  });

  it("T-RLS-127 another user's email_hash is unreadable for anon and user", async () => {
    const anon = await asRole('anon')
      .from('profiles')
      .select('email_hash')
      .eq('id', SEED_USERS.oddsense);
    expect(anon.error).not.toBeNull();
    expect(anon.data).toBeNull();

    const user = await asRole('user')
      .from('profiles')
      .select('email_hash')
      .eq('id', SEED_USERS.oddsense);
    expect(user.error).toBeNull();
    expect(user.data).toEqual([]);

    // public_profiles (the cross-user read) has no such column to select.
    const view = await asRole('anon')
      .from('public_profiles')
      .select('email_hash' as 'id');
    expect(view.error).not.toBeNull();
  });
});
