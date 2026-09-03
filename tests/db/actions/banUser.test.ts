/**
 * tests/db/actions/banUser.test.ts — T-ACT-24 (+ T-ACT-69 SC-24 audit line) (05 §7.2; 04 §1.2
 * `banUser`; SC-05; ADR-0002 #64 (no cascade) / C7).
 *
 * `requireRole('moderator')` then the service client writes `profiles.is_banned` /
 * `banned_reason`. The target must be role `user` (moderators and admins cannot be banned by this
 * action, by either actor → `forbidden`) and not the actor. Existing published comments stay
 * published; a banned user's next `postComment` / `toggleLike` / `reportComment` answers `banned`
 * (SC-05). No event, no revalidation; exactly one keys-only `msg:'admin'` line per `ok:true`.
 *
 * Targets are factory users (`makeUser`), removed by `cleanupFactories`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { banUser, postComment, reportComment, toggleLike } from '@/lib/actions/comments';
import type { BanUserInput } from '@/lib/actions/comments.schema';
import { LINE_FORBIDDEN } from '@/lib/validation/comment';
import { readProfile } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeComment,
  makeUser,
  purgeNotificationEvents,
  restoreSeedCommentCounts,
} from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';
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

async function banState(id: string): Promise<{ is_banned: boolean; banned_reason: string | null }> {
  const row = await readProfile(id);
  if (!row) throw new Error(`profile ${id} is gone`);
  return { is_banned: row.is_banned, banned_reason: row.banned_reason };
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
  await restoreSeedCommentCounts();
});

describe('T-ACT-24 banUser', () => {
  it('T-ACT-24 anon → unauthenticated', async () => {
    const target = await makeUser();
    expectFail(
      await callAction(banUser, { profile_id: target, banned: true }, { role: 'anon' }),
      'unauthenticated',
    );
    expect((await banState(target)).is_banned).toBe(false);
  });

  it.each(['user', 'banned'] as const)(
    'T-ACT-24 %s → forbidden, target untouched, no audit line',
    async (role) => {
      const target = await makeUser();
      const error = expectFail(
        await callAction(banUser, { profile_id: target, banned: true }, { role }),
        'forbidden',
      );
      expect(error.message).toBe(LINE_FORBIDDEN);
      expect((await banState(target)).is_banned).toBe(false);
      expect(adminLines()).toEqual([]);
    },
  );

  it.each(['mod', 'admin'] as const)(
    'T-ACT-24 %s → ok: {banned:true, reason} sets is_banned + banned_reason; {banned:false} clears both; no event, no revalidation; audit line (T-ACT-69)',
    async (role) => {
      const target = await makeUser();
      const events = await eventCount();

      const banned = expectOk(
        await callAction(
          banUser,
          { profile_id: target, banned: true, reason: 'spam links' },
          { role },
        ),
      );
      expect(banned).toEqual({ profile_id: target, is_banned: true });
      expect(await banState(target)).toEqual({ is_banned: true, banned_reason: 'spam links' });

      let lines = adminLines();
      expect(lines).toHaveLength(1);
      const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
      expect(line.action).toBe('banUser');
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
      expect([...(line.meta.fields as string[])].sort()).toEqual([
        'banned',
        'profile_id',
        'reason',
      ]);
      expect(JSON.stringify(line.meta)).not.toContain('spam links');

      const unbanned = expectOk(
        await callAction(banUser, { profile_id: target, banned: false }, { role }),
      );
      expect(unbanned).toEqual({ profile_id: target, is_banned: false });
      expect(await banState(target)).toEqual({ is_banned: false, banned_reason: null });
      lines = adminLines();
      expect(lines).toHaveLength(2);

      expect(await eventCount()).toBe(events);
      expect(tags.calls).toEqual([]);
    },
  );

  it('T-ACT-24 {banned:false} with no prior ban is a harmless ok; a ban without a reason stores NULL', async () => {
    const target = await makeUser();
    expectOk(await callAction(banUser, { profile_id: target, banned: false }, { role: 'mod' }));
    expectOk(await callAction(banUser, { profile_id: target, banned: true }, { role: 'mod' }));
    expect(await banState(target)).toEqual({ is_banned: true, banned_reason: null });
  });

  it('T-ACT-24 reason over 200 characters → validation, nothing written', async () => {
    const target = await makeUser();
    const error = expectFail(
      await callAction(
        banUser,
        { profile_id: target, banned: true, reason: 'r'.repeat(201) },
        { role: 'mod' },
      ),
      'validation',
    );
    expect(error.issues?.[0]?.path).toBe('reason');
    expect((await banState(target)).is_banned).toBe(false);
  });

  it.each([
    ['mod', 'moderator'],
    ['mod', 'admin'],
    ['admin', 'moderator'],
    ['admin', 'admin'],
  ] as const)(
    'T-ACT-24 %s banning a %s target → forbidden (demote first via setUserRole)',
    async (actor, role) => {
      const target = await makeUser({ role });
      expectFail(
        await callAction(banUser, { profile_id: target, banned: true }, { role: actor }),
        'forbidden',
      );
      expect((await banState(target)).is_banned).toBe(false);
      expect(adminLines()).toEqual([]);
    },
  );

  it.each(['mod', 'admin'] as const)('T-ACT-24 %s banning self → forbidden', async (role) => {
    expectFail(
      await callAction(banUser, { profile_id: SEED_ROLE_IDS[role], banned: true }, { role }),
      'forbidden',
    );
    expect((await banState(SEED_ROLE_IDS[role])).is_banned).toBe(false);
  });

  it('T-ACT-24 unknown profile → not_found; malformed → validation', async () => {
    expectFail(
      await callAction(banUser, { profile_id: randomUUID(), banned: true }, { role: 'mod' }),
      'not_found',
    );
    expectFail(
      await callAction(banUser, { profile_id: 'nope', banned: true } as unknown as BanUserInput, {
        role: 'mod',
      }),
      'validation',
    );
  });

  it("T-ACT-24 after a ban: the user's published comments stay published (no cascade); postComment / toggleLike / reportComment → banned", async () => {
    const target = await makeUser({ comment_count: 1 });
    const own = await makeComment({ author_id: target });
    expectOk(
      await callAction(
        banUser,
        { profile_id: target, banned: true, reason: 'rude' },
        { role: 'mod' },
      ),
    );

    const { data: comment } = await service
      .from('comments')
      .select('status')
      .eq('id', own)
      .single();
    expect(comment?.status).toBe('published');

    expectFail(
      await callActionAs(
        postComment,
        { target_type: 'project', target_id: SEED_PROJECTS.pixelChameleon, body: 'still here?' },
        { profileId: target },
      ),
      'banned',
    );
    expectFail(
      await callActionAs(
        toggleLike,
        { comment_id: SEED_COMMENTS.published },
        { profileId: target },
      ),
      'banned',
    );
    expectFail(
      await callActionAs(
        reportComment,
        { comment_id: SEED_COMMENTS.published, reason: 'spam' },
        { profileId: target },
      ),
      'banned',
    );
    const { data: like } = await service
      .from('comment_likes')
      .select('user_id')
      .eq('comment_id', SEED_COMMENTS.published)
      .eq('user_id', target);
    expect(like).toEqual([]);

    // Reversible from /admin/comments: unban → the same user posts again.
    expectOk(await callAction(banUser, { profile_id: target, banned: false }, { role: 'admin' }));
    const posted = await callActionAs(
      postComment,
      { target_type: 'project', target_id: SEED_PROJECTS.pixelChameleon, body: 'back again' },
      { profileId: target },
    );
    const data = expectOk(posted);
    const { error } = await service.from('comments').delete().eq('id', data.comment.id);
    expect(error).toBeNull();
  });

  it('T-ACT-24 the seed banned account is role user and stays banned throughout (SEED-3 truth)', async () => {
    expect(await banState(SEED_USERS.seed_banned)).toEqual({
      is_banned: true,
      banned_reason: 'seed',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-24 — DB faults (T-ACT-0 (1)): the target read, the write, and a non-Error rejection
// ---------------------------------------------------------------------------------------------
describe('T-ACT-24 banUser DB faults', () => {
  it('T-ACT-24 the target read fails → internal + one log.error line, target untouched, no audit line', async () => {
    const target = await makeUser();
    // nth 2: `requireRole` reads the ACTOR's own profiles row first (lenient); the target read is next.
    const res = await withDbFault({ table: 'profiles', op: 'select' }, { nth: 2 }, () =>
      callAction(banUser, { profile_id: target, banned: true }, { role: 'mod' }),
    );
    expectInternal(res, 'banUser', logs);
    expect(await banState(target)).toEqual({ is_banned: false, banned_reason: null });
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-24 the profiles write fails → internal + one log.error line, target untouched, no audit line', async () => {
    const target = await makeUser();
    const res = await withDbFault({ table: 'profiles', op: 'update' }, {}, () =>
      callAction(banUser, { profile_id: target, banned: true, reason: 'spam' }, { role: 'mod' }),
    );
    const meta = expectInternal(res, 'banUser', logs);
    expect(meta.name).toBe('Error');
    expect(await banState(target)).toEqual({ is_banned: false, banned_reason: null });
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-24 a non-Error rejection (a string) from the write → internal, the log line names its typeof', async () => {
    const target = await makeUser();
    const res = await withDbFault({ table: 'profiles', op: 'update' }, { throws: 'boom' }, () =>
      callAction(banUser, { profile_id: target, banned: true }, { role: 'admin' }),
    );
    const meta = expectInternal(res, 'banUser', logs);
    expect(meta.name).toBe('string');
    expect(await banState(target)).toEqual({ is_banned: false, banned_reason: null });
  });
});
