/**
 * tests/db/actions/renameUserHandle.test.ts — T-ACT-67 (+ T-ACT-69 SC-24 audit line) (05 §7.2;
 * 04 §1.2 `renameUserHandle` — spec §9 "moderators can rename"; H-rules in
 * `lib/validation/handle.ts`; RPC `check_handle`; ADR-0002 C7).
 *
 * `requireRole('moderator')`, target must exist and be role `user` unless the actor is `admin`;
 * the handle goes through RPC `check_handle` on the caller's cookie client → `handle_taken` /
 * `handle_reserved` / `validation`; the write (service client) sets `profiles.handle` and
 * `handle_changed_at = now()`; a unique-index race maps to `handle_taken`. No event, no
 * revalidation; exactly one keys-only `msg:'admin'` line per `ok:true` (the new handle value
 * never reaches the log).
 *
 * Targets are factory users (`makeUser`), removed by `cleanupFactories`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renameUserHandle } from '@/lib/actions/comments';
import { LINE_FORBIDDEN } from '@/lib/validation/comment';
import { HANDLE_RESERVED, HANDLE_TAKEN, REASON_CHARSET } from '@/lib/validation/handle';
import { freeHandle, readProfile } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, type DbFaultOptions } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeUser, purgeNotificationEvents } from '@/tests/helpers/factories';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

let logs: LogSpy;

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

async function eventCount(): Promise<number> {
  const { count, error } = await service
    .from('notification_events')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`service could not count notification_events: ${error.message}`);
  return count ?? 0;
}

async function handleOf(
  id: string,
): Promise<{ handle: string | null; handle_changed_at: string | null }> {
  const row = await readProfile(id);
  if (!row) throw new Error(`profile ${id} is gone`);
  return { handle: row.handle, handle_changed_at: row.handle_changed_at };
}

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(() => {
  logs.restore();
});

afterAll(async () => {
  await purgeNotificationEvents();
  await cleanupFactories();
});

describe('T-ACT-67 renameUserHandle', () => {
  it('T-ACT-67 anon → unauthenticated', async () => {
    const target = await makeUser();
    const before = await handleOf(target);
    expectFail(
      await callAction(
        renameUserHandle,
        { profile_id: target, handle: freeHandle() },
        { role: 'anon' },
      ),
      'unauthenticated',
    );
    expect(await handleOf(target)).toEqual(before);
  });

  it.each(['user', 'banned'] as const)('T-ACT-67 %s → forbidden, no audit line', async (role) => {
    const target = await makeUser();
    const before = await handleOf(target);
    const error = expectFail(
      await callAction(renameUserHandle, { profile_id: target, handle: freeHandle() }, { role }),
      'forbidden',
    );
    expect(error.message).toBe(LINE_FORBIDDEN);
    expect(await handleOf(target)).toEqual(before);
    expect(adminLines()).toEqual([]);
  });

  it.each(['mod', 'admin'] as const)(
    'T-ACT-67 %s renames a user: profiles.handle + handle_changed_at = now(); no event, no revalidation; audit line (T-ACT-69)',
    async (role) => {
      const target = await makeUser();
      const handle = freeHandle('t_new_');
      const events = await eventCount();
      const started = Date.now();

      const data = expectOk(
        await callAction(renameUserHandle, { profile_id: target, handle }, { role }),
      );
      expect(data).toEqual({ profile_id: target, handle });
      const after = await handleOf(target);
      expect(after.handle).toBe(handle);
      expect(after.handle_changed_at).not.toBeNull();
      expect(new Date(String(after.handle_changed_at)).getTime()).toBeGreaterThanOrEqual(
        started - 5_000,
      );

      expect(await eventCount()).toBe(events);
      expect(tags.calls).toEqual([]);

      const lines = adminLines();
      expect(lines).toHaveLength(1);
      const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
      expect(line.action).toBe('renameUserHandle');
      expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
      expect(Object.keys(line.meta).sort()).toEqual([
        'actor_profile_id',
        'fields',
        'target_id',
        'target_type',
      ]);
      expect(line.meta).toMatchObject({
        actor_profile_id: SEED_ROLE_IDS[role],
        target_type: 'profile',
        target_id: target,
      });
      expect([...(line.meta.fields as string[])].sort()).toEqual(['handle', 'profile_id']);
      expect(JSON.stringify(line.meta)).not.toContain(handle);
    },
  );

  it.each([
    ['mod', 'moderator'],
    ['mod', 'admin'],
  ] as const)('T-ACT-67 %s renaming a %s → forbidden', async (actor, role) => {
    const target = await makeUser({ role });
    const before = await handleOf(target);
    expectFail(
      await callAction(
        renameUserHandle,
        { profile_id: target, handle: freeHandle() },
        { role: actor },
      ),
      'forbidden',
    );
    expect(await handleOf(target)).toEqual(before);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-67 admin renaming a moderator → ok', async () => {
    const target = await makeUser({ role: 'moderator' });
    const handle = freeHandle();
    expectOk(await callAction(renameUserHandle, { profile_id: target, handle }, { role: 'admin' }));
    expect((await handleOf(target)).handle).toBe(handle);
  });

  it('T-ACT-67 reserved handle → handle_reserved', async () => {
    const target = await makeUser();
    const error = expectFail(
      await callAction(renameUserHandle, { profile_id: target, handle: 'admin' }, { role: 'mod' }),
      'handle_reserved',
    );
    expect(error.message).toBe(HANDLE_RESERVED);
    expect(error.field).toBe('handle');
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-67 taken handle (another user, any case) → handle_taken', async () => {
    const target = await makeUser();
    const error = expectFail(
      await callAction(
        renameUserHandle,
        { profile_id: target, handle: 'SEED_USER' },
        { role: 'mod' },
      ),
      'handle_taken',
    );
    expect(error.message).toBe(HANDLE_TAKEN);
    expect(error.field).toBe('handle');
  });

  it("T-ACT-67 the caller's own handle counts as taken too (check_handle excludes the caller; the unique index answers)", async () => {
    const target = await makeUser();
    expectFail(
      await callAction(
        renameUserHandle,
        { profile_id: target, handle: 'seed_mod' },
        { role: 'mod' },
      ),
      'handle_taken',
    );
    expect((await handleOf(target)).handle).not.toBe('seed_mod');
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(21)],
    ['dash', 'has-dash'],
    ['at sign', '@handle'],
    ['space', 'two words'],
  ])('T-ACT-67 invalid handle (%s) → validation', async (_label, handle) => {
    const target = await makeUser();
    const error = expectFail(
      await callAction(renameUserHandle, { profile_id: target, handle }, { role: 'mod' }),
      'validation',
    );
    expect(error.issues?.[0]?.path).toBe('handle');
  });

  it('T-ACT-67 unknown profile → not_found; malformed → validation', async () => {
    expectFail(
      await callAction(
        renameUserHandle,
        { profile_id: randomUUID(), handle: freeHandle() },
        { role: 'mod' },
      ),
      'not_found',
    );
    expectFail(
      await callAction(
        renameUserHandle,
        { profile_id: 'nope', handle: freeHandle() },
        { role: 'mod' },
      ),
      'validation',
    );
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-67 the renamed handle is what public_profiles shows (comments by that user join the new handle)', async () => {
    const target = await makeUser();
    const handle = freeHandle('t_shown_');
    expectOk(await callAction(renameUserHandle, { profile_id: target, handle }, { role: 'admin' }));
    const { data } = await asRole('anon')
      .from('public_profiles')
      .select('handle')
      .eq('id', target)
      .single();
    expect(data?.handle).toBe(handle);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-67 — the RPC's verdict wins, unexpected verdicts, and DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-67 renameUserHandle RPC verdicts + DB faults', () => {
  it("T-ACT-67 the RPC says 'invalid' for a handle the TS rules accept → validation with the charset line", async () => {
    const target = await makeUser();
    const before = await handleOf(target);
    const handle = freeHandle();
    const error = expectFail(
      await withDbFault({ rpc: 'check_handle' }, { result: { data: 'invalid', error: null } }, () =>
        callAction(renameUserHandle, { profile_id: target, handle }, { role: 'mod' }),
      ),
      'validation',
    );
    expect(error.message).toBe(REASON_CHARSET);
    expect(error.issues).toEqual([{ path: 'handle', message: REASON_CHARSET }]);
    expect(await handleOf(target)).toEqual(before);
    expect(adminLines()).toEqual([]);
  });

  it.each<{ name: string; options: DbFaultOptions }>([
    { name: 'an unknown verdict string', options: { result: { data: 'weird', error: null } } },
    { name: 'a non-string verdict', options: { result: { data: 42, error: null } } },
    { name: 'an RPC error', options: {} },
  ])(
    'T-ACT-67 check_handle answering $name → internal + one log.error line, handle untouched',
    async ({ options }) => {
      const target = await makeUser();
      const before = await handleOf(target);
      const res = await withDbFault({ rpc: 'check_handle' }, options, () =>
        callAction(renameUserHandle, { profile_id: target, handle: freeHandle() }, { role: 'mod' }),
      );
      expectInternal(res, 'renameUserHandle', logs);
      expect(await handleOf(target)).toEqual(before);
      expect(adminLines()).toEqual([]);
    },
  );

  it.each<{ name: string; table: 'profiles'; op: 'select' | 'update'; nth?: number }>([
    // nth 2: `requireRole` reads the ACTOR's own row first (lenient); the target read is next.
    { name: 'the target read', table: 'profiles', op: 'select', nth: 2 },
    { name: 'the rename write', table: 'profiles', op: 'update' },
  ])(
    'T-ACT-67 $name fails → internal + one log.error line, handle untouched, no audit line',
    async ({ table, op, nth }) => {
      const target = await makeUser();
      const before = await handleOf(target);
      const res = await withDbFault({ table, op }, nth === undefined ? {} : { nth }, () =>
        callAction(
          renameUserHandle,
          { profile_id: target, handle: freeHandle() },
          { role: 'admin' },
        ),
      );
      expectInternal(res, 'renameUserHandle', logs);
      expect(await handleOf(target)).toEqual(before);
      expect(adminLines()).toEqual([]);
    },
  );
});
