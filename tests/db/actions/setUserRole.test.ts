/**
 * tests/db/actions/setUserRole.test.ts — T-ACT-66 (+ T-ACT-69 SC-24 audit line) (05 §7.2; 04 §1.3
 * `setUserRole`; 00 S1.5.AC11; ADR-0002 C2 / C7; migration 20260821090000 `profiles_guard` lets
 * the service client write `role`).
 *
 * `requireRole('admin')` (a moderator answers `forbidden` — the roles table is admin-only), the
 * target is found by handle on the citext column (case-insensitive; H1 only, so the reserved
 * `oddsense` resolves), then: unknown → `not_found`; demoting self → `forbidden`; a banned target
 * asked for a staff role → `conflict` (04 §1.2 `banUser` refuses staff — "demote first" — and this
 * is the same fence from the other side; demoting to `user` always passes — ADR-0030 D14);
 * demoting the last admin → `conflict`; else the service client sets `profiles.role`, the
 * keys-only audit line is logged and `{profile_id, handle, role}` comes back. No event, no
 * revalidation.
 *
 * The last-admin guard: with the actor being an admin and the target someone else, at least two
 * admins exist whenever the count runs — the guard only fires under a concurrent demotion, which
 * `withDbHook` reproduces on the real stack (every other admin is demoted through the service
 * client right before the count, and, for the TOCTOU window, right before the write — the action
 * then reverts its own write and answers `conflict`).
 *
 * `mutatesSeed` (H-1): `seed_user`'s role and, inside the hooks, the seed admin's role are written
 * and restored (`patchProfile`) in `finally` / `afterEach`. Other targets are factory users.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setUserRole } from '@/lib/actions/settings';
import type { SetUserRoleInput } from '@/lib/actions/settings.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { patchProfile, readProfile } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, withDbHook } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { SEED_USERS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

let logs: LogSpy;

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

async function roleOf(id: string): Promise<string> {
  const row = await readProfile(id);
  if (!row) throw new Error(`profile ${id} is gone`);
  return row.role;
}

async function handleOf(id: string): Promise<string> {
  const row = await readProfile(id);
  if (!row?.handle) throw new Error(`profile ${id} has no handle`);
  return row.handle;
}

async function eventCount(): Promise<number> {
  const { count, error } = await service
    .from('notification_events')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`service could not count notification_events: ${error.message}`);
  return count ?? 0;
}

/** Demotes every admin except `keep` through the service client (the hook's "concurrent" write). */
async function demoteOtherAdmins(keep: string): Promise<string[]> {
  const { data, error } = await service
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .neq('id', keep);
  if (error) throw new Error(`service could not read admins: ${error.message}`);
  const ids = data.map((row) => row.id);
  if (ids.length > 0) {
    const { error: updateError } = await service
      .from('profiles')
      .update({ role: 'moderator' })
      .in('id', ids);
    if (updateError) throw new Error(`service could not demote admins: ${updateError.message}`);
  }
  return ids;
}

async function restoreAdmins(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await service.from('profiles').update({ role: 'admin' }).in('id', ids);
  if (error) throw new Error(`service could not restore admins: ${error.message}`);
}

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(async () => {
  logs.restore();
  // Seed roles back (H-1 `mutatesSeed`) whatever a test did.
  await patchProfile(SEED_USERS.seed_user, { role: 'user' });
  await patchProfile(SEED_USERS.oddsense, { role: 'admin' });
});

afterAll(async () => {
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-66 auth — anon D · user D forbidden · banned D · mod D forbidden · admin A
// ---------------------------------------------------------------------------------------------
describe('T-ACT-66 setUserRole auth', () => {
  it('T-ACT-66 anon → unauthenticated, target untouched', async () => {
    expectFail(
      await callAction(setUserRole, { handle: 'seed_user', role: 'moderator' }, { role: 'anon' }),
      'unauthenticated',
    );
    expect(await roleOf(SEED_USERS.seed_user)).toBe('user');
  });

  it.each([
    { role: 'user' as const },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const },
    // 04 §1.3 / 00 S1.5.AC11: a moderator calling setUserRole gets `forbidden`.
    { role: 'mod' as const },
  ])('T-ACT-66 $role → forbidden, target untouched, no audit line', async ({ role }) => {
    const error = expectFail(
      await callAction(setUserRole, { handle: 'seed_user', role: 'moderator' }, { role }),
      'forbidden',
    );
    expect(error.message).toBe('Not allowed.');
    expect(await roleOf(SEED_USERS.seed_user)).toBe('user');
    expect(adminLines()).toEqual([]);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-66 a moderator cannot promote themselves either', async () => {
    expectFail(
      await callAction(setUserRole, { handle: 'seed_mod', role: 'admin' }, { role: 'mod' }),
      'forbidden',
    );
    expect(await roleOf(SEED_USERS.seed_mod)).toBe('moderator');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-66 effects — role updated, `{profile_id, handle, role}` returned, no event / tag, SC-24
// ---------------------------------------------------------------------------------------------
describe('T-ACT-66 setUserRole effects', () => {
  it("T-ACT-66 admin {handle:'seed_user', role:'moderator'} → role updated, returns {profile_id, handle, role}; no event, no revalidation; audit line keys only (T-ACT-69)", async () => {
    const events = await eventCount();
    const data = expectOk(
      await callAction(setUserRole, { handle: 'seed_user', role: 'moderator' }, { role: 'admin' }),
    );
    expect(data).toEqual({
      profile_id: SEED_USERS.seed_user,
      handle: 'seed_user',
      role: 'moderator',
    });
    expect(await roleOf(SEED_USERS.seed_user)).toBe('moderator');
    expect(await eventCount()).toBe(events);
    expect(tags.calls).toEqual([]);

    const lines = adminLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
    expect(line.action).toBe('setUserRole');
    expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(line.meta).toEqual({
      actor_profile_id: SEED_ROLE_IDS.admin,
      target_type: 'profile',
      target_id: SEED_USERS.seed_user,
      fields: ['handle', 'role'],
    });
    expect(JSON.stringify(logs.lines)).not.toContain('seed_user');

    // Remove (→ user) is the same action.
    const back = expectOk(
      await callAction(setUserRole, { handle: 'seed_user', role: 'user' }, { role: 'admin' }),
    );
    expect(back).toEqual({ profile_id: SEED_USERS.seed_user, handle: 'seed_user', role: 'user' });
    expect(await roleOf(SEED_USERS.seed_user)).toBe('user');
    expect(adminLines()).toHaveLength(2);
  });

  it('T-ACT-66 the handle is matched case-insensitively (citext) and echoed as stored', async () => {
    const data = expectOk(
      await callAction(setUserRole, { handle: 'SEED_USER', role: 'moderator' }, { role: 'admin' }),
    );
    expect(data.handle).toBe('seed_user');
    expect(await roleOf(SEED_USERS.seed_user)).toBe('moderator');
  });

  it('T-ACT-66 a factory user walks user → moderator → admin → user; the new admin is a real admin', async () => {
    const target = await makeUser();
    const handle = await handleOf(target);
    for (const role of ['moderator', 'admin', 'user'] as const) {
      const data = expectOk(await callAction(setUserRole, { handle, role }, { role: 'admin' }));
      expect(data).toEqual({ profile_id: target, handle, role });
      expect(await roleOf(target)).toBe(role);
    }
    // A freshly made admin can use the action at once (roles are read per request, not from the JWT).
    await patchProfile(target, { role: 'admin' });
    const other = await makeUser();
    const promoted = expectOk(
      await callActionAs(
        setUserRole,
        { handle: await handleOf(other), role: 'moderator' },
        { profileId: target },
      ),
    );
    expect(promoted.role).toBe('moderator');
    expect(await roleOf(other)).toBe('moderator');
  });

  it('T-ACT-66 setting the same role again is a no-op success', async () => {
    const target = await makeUser({ role: 'moderator' });
    const handle = await handleOf(target);
    expectOk(await callAction(setUserRole, { handle, role: 'moderator' }, { role: 'admin' }));
    expect(await roleOf(target)).toBe('moderator');
    expect(adminLines()).toHaveLength(1);
  });

  it("T-ACT-66 'oddsense' (H3 reserved) resolves — the seed admin may set self to admin (no-op)", async () => {
    const data = expectOk(
      await callAction(setUserRole, { handle: 'oddsense', role: 'admin' }, { role: 'admin' }),
    );
    expect(data).toEqual({ profile_id: SEED_USERS.oddsense, handle: 'oddsense', role: 'admin' });
    expect(await roleOf(SEED_USERS.oddsense)).toBe('admin');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-66 preconditions — not_found · demoting self forbidden · last admin conflict · validation
// ---------------------------------------------------------------------------------------------
describe('T-ACT-66 setUserRole preconditions', () => {
  it('T-ACT-66 unknown handle → not_found, no audit line', async () => {
    const error = expectFail(
      await callAction(
        setUserRole,
        { handle: 't_nobody_here', role: 'moderator' },
        { role: 'admin' },
      ),
      'not_found',
    );
    expect(error.message).toBe("That account doesn't exist.");
    expect(adminLines()).toEqual([]);
  });

  it.each(['moderator', 'user'] as const)(
    'T-ACT-66 demoting self (→ %s) → forbidden, the admin stays admin',
    async (role) => {
      const error = expectFail(
        await callAction(setUserRole, { handle: 'oddsense', role }, { role: 'admin' }),
        'forbidden',
      );
      expect(error.message).toBe("You can't change your own role.");
      expect(await roleOf(SEED_USERS.oddsense)).toBe('admin');
      expect(adminLines()).toEqual([]);
    },
  );

  it.each(['moderator', 'admin'] as const)(
    "T-ACT-66 a banned account → %s → conflict 'Unban that account first.'; role stays user, ban stays, no audit line (ADR-0030 D14)",
    async (role) => {
      const target = await makeUser({ banned: true });
      const handle = await handleOf(target);
      const error = expectFail(
        await callAction(setUserRole, { handle, role }, { role: 'admin' }),
        'conflict',
      );
      expect(error.message).toBe('Unban that account first.');
      expect(await roleOf(target)).toBe('user');
      expect((await readProfile(target))?.is_banned).toBe(true);
      expect(adminLines()).toEqual([]);
    },
  );

  it('T-ACT-66 a banned account may always be set to user — a banned moderator is demoted, the state repaired', async () => {
    const target = await makeUser({ banned: true, role: 'moderator' });
    const handle = await handleOf(target);
    const data = expectOk(
      await callAction(setUserRole, { handle, role: 'user' }, { role: 'admin' }),
    );
    expect(data).toEqual({ profile_id: target, handle, role: 'user' });
    expect(await roleOf(target)).toBe('user');
    expect((await readProfile(target))?.is_banned).toBe(true);
    expect(adminLines()).toHaveLength(1);
  });

  it('T-ACT-66 demoting the last remaining admin → conflict (factory admin actor; every other admin demoted concurrently before the count)', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'admin' });
    const targetHandle = await handleOf(target);
    let demoted: string[] = [];
    try {
      // profiles.select calls in order: 1 requireRole own row · 2 the handle lookup · 3 the count.
      const res = await withDbHook(
        { table: 'profiles', op: 'select' },
        async () => {
          demoted = await demoteOtherAdmins(target);
        },
        () =>
          callActionAs(
            setUserRole,
            { handle: targetHandle, role: 'moderator' },
            { profileId: actor },
          ),
        { nth: 3, when: 'before' },
      );
      const error = expectFail(res, 'conflict');
      expect(error.message).toBe('Someone has to stay admin.');
      expect(await roleOf(target)).toBe('admin');
      expect(adminLines()).toEqual([]);
    } finally {
      await restoreAdmins(demoted);
    }
  });

  it('T-ACT-66 the check-then-write window: every other admin demoted right before the write → the write is reverted, conflict', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'admin' });
    const targetHandle = await handleOf(target);
    let demoted: string[] = [];
    try {
      const res = await withDbHook(
        { table: 'profiles', op: 'update' },
        async () => {
          demoted = await demoteOtherAdmins(target);
        },
        () =>
          callActionAs(setUserRole, { handle: targetHandle, role: 'user' }, { profileId: actor }),
        { nth: 1, when: 'before' },
      );
      const error = expectFail(res, 'conflict');
      expect(error.message).toBe('Someone has to stay admin.');
      expect(await roleOf(target)).toBe('admin');
      expect(adminLines()).toEqual([]);
    } finally {
      await restoreAdmins(demoted);
    }
  });

  it('T-ACT-66 demoting an admin while another admin remains → ok', async () => {
    const target = await makeUser({ role: 'admin' });
    const handle = await handleOf(target);
    const data = expectOk(
      await callAction(setUserRole, { handle, role: 'user' }, { role: 'admin' }),
    );
    expect(data.role).toBe('user');
    expect(await roleOf(target)).toBe('user');
    expect(await roleOf(SEED_USERS.oddsense)).toBe('admin');
  });

  it.each<{ name: string; input: unknown; path: string }>([
    { name: 'role outside the enum', input: { handle: 'seed_user', role: 'owner' }, path: 'role' },
    { name: 'role missing', input: { handle: 'seed_user' }, path: 'role' },
    { name: 'handle with @', input: { handle: '@seed_user', role: 'moderator' }, path: 'handle' },
    { name: 'handle too short', input: { handle: 'ab', role: 'moderator' }, path: 'handle' },
    {
      name: 'handle too long',
      input: { handle: 'a'.repeat(21), role: 'moderator' },
      path: 'handle',
    },
    {
      name: 'handle with a space',
      input: { handle: 'seed user', role: 'moderator' },
      path: 'handle',
    },
    { name: 'handle not a string', input: { handle: 42, role: 'moderator' }, path: 'handle' },
  ])('T-ACT-66 $name → validation, nothing written', async ({ input, path }) => {
    const error = expectFail(
      await callAction(setUserRole, input as SetUserRoleInput, { role: 'admin' }),
      'validation',
    );
    expect(error.message).toBe(VALIDATION_MESSAGE);
    expect(error.issues?.[0]?.path).toBe(path);
    expect(error.issues?.[0]?.message).toMatch(/^[A-Z]/);
    expect(await roleOf(SEED_USERS.seed_user)).toBe('user');
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-0 (1) — a DB failure → internal + one log.error line; role untouched
// ---------------------------------------------------------------------------------------------
describe('T-ACT-0 setUserRole faults', () => {
  it('T-ACT-0 the profiles update fails → internal, role untouched, no audit line', async () => {
    const target = await makeUser();
    const handle = await handleOf(target);
    const res = await withDbFault({ table: 'profiles', op: 'update' }, {}, () =>
      callAction(setUserRole, { handle, role: 'moderator' }, { role: 'admin' }),
    );
    expectInternal(res, 'setUserRole', logs);
    expect(await roleOf(target)).toBe('user');
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-0 the handle lookup fails → internal', async () => {
    // profiles.select: 1 requireRole own row · 2 the handle lookup.
    const res = await withDbFault({ table: 'profiles', op: 'select' }, { nth: 2 }, () =>
      callAction(setUserRole, { handle: 'seed_user', role: 'moderator' }, { role: 'admin' }),
    );
    expectInternal(res, 'setUserRole', logs);
    expect(await roleOf(SEED_USERS.seed_user)).toBe('user');
  });
});
