/**
 * tests/db/actions/deleteComment.test.ts — T-ACT-19 (+ the T-ACT-69 audit line on the moderator
 * path) (05 §7.2; 04 §1.2 `deleteComment`; §5.5 `comment_delete`; ADR-0002 A6 / A4; SC-24).
 *
 * Two paths: the author's own soft delete (`requireOnboarded`, no time window, 20 / min on
 * `rate_limit_hits`) and a moderator's delete of someone else's comment (`requireRole`, service
 * client, `moderated_by/at` stamped, SC-24 line). The result is soft: `status='deleted'`, the body
 * stays in the DB and never reaches a non-moderator (RLS + `comments_public`), the row and its
 * replies remain, `comment_count` is untouched, `project:<slug>` is revalidated.
 *
 * Every comment is a factory row (`makeComment` on …0102) by a factory user (`victim`); the seed
 * actors' hits are cleared and their `comment_count` restored.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteComment } from '@/lib/actions/comments';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { LINE_BANNED, LINE_FORBIDDEN } from '@/lib/validation/comment';
import {
  clearRateLimitHitsFor,
  countRateLimitHits,
  patchProfile,
  readProfile,
} from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, withDbHook } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeComment,
  makeUser,
  purgeNotificationEvents,
  restoreSeedCommentCounts,
} from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_USERS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();
const PIXEL_TAG = 'project:pixel-chameleon';

let victim: string;
let logs: LogSpy;

async function storedComment(id: string) {
  const { data, error } = await service
    .from('comments')
    .select('id, body, status, moderated_by, moderated_at, parent_id')
    .eq('id', id)
    .single();
  if (error) throw new Error(`service could not read comments: ${error.message}`);
  return data;
}

async function commentCount(profileId: string): Promise<number> {
  const row = await readProfile(profileId);
  if (!row) throw new Error(`profile ${profileId} is gone`);
  return row.comment_count;
}

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

beforeAll(async () => {
  victim = await makeUser({ comment_count: 1 });
  await clearRateLimitHitsFor(['comment_delete'], [SEED_USERS.seed_user]);
});

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(() => {
  logs.restore();
});

afterAll(async () => {
  await purgeNotificationEvents();
  await clearRateLimitHitsFor(['comment_delete'], [SEED_USERS.seed_user]);
  await cleanupFactories();
  await restoreSeedCommentCounts();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-19 — auth on another user's comment: anon D · user D forbidden · banned D `banned` (04 SC-05:
// answered before any table is read — ADR-0028 D12) · mod A · admin A
// ---------------------------------------------------------------------------------------------
describe("T-ACT-19 deleteComment on another user's comment", () => {
  it('T-ACT-19 anon → unauthenticated', async () => {
    const id = await makeComment({ author_id: victim });
    expectFail(
      await callAction(deleteComment, { comment_id: id }, { role: 'anon' }),
      'unauthenticated',
    );
    expect((await storedComment(id)).status).toBe('published');
  });

  it.each([
    ['user', 'forbidden'],
    ['banned', 'banned'],
  ] as const)('T-ACT-19 %s → %s, row untouched', async (role, code) => {
    const id = await makeComment({ author_id: victim });
    const error = expectFail(await callAction(deleteComment, { comment_id: id }, { role }), code);
    expect(error.message).toBe(code === 'banned' ? LINE_BANNED : LINE_FORBIDDEN);
    expect((await storedComment(id)).status).toBe('published');
    expect(adminLines()).toEqual([]);
  });

  it.each(['mod', 'admin'] as const)(
    'T-ACT-19 %s → ok: soft delete stamped moderated_by/at, tag revalidated, SC-24 audit line (T-ACT-69)',
    async (role) => {
      const id = await makeComment({ author_id: victim });
      const before = await commentCount(victim);
      const data = expectOk(await callAction(deleteComment, { comment_id: id }, { role }));
      expect(data).toEqual({ comment_id: id, status: 'deleted' });

      const row = await storedComment(id);
      expect(row.status).toBe('deleted');
      expect(row.moderated_by).toBe(SEED_ROLE_IDS[role]);
      expect(row.moderated_at).not.toBeNull();
      expect(await commentCount(victim)).toBe(before);
      expect(tags.calls).toEqual([PIXEL_TAG]);

      const lines = adminLines();
      expect(lines).toHaveLength(1);
      const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
      expect(line.action).toBe('deleteComment');
      expect(typeof line.id).toBe('string');
      expect(Object.keys(line.meta).sort()).toEqual([
        'actor_profile_id',
        'fields',
        'target_id',
        'target_type',
      ]);
      expect(line.meta).toMatchObject({
        actor_profile_id: SEED_ROLE_IDS[role],
        target_type: 'comment',
        target_id: id,
        fields: ['comment_id'],
      });
      expect(JSON.stringify(line.meta)).not.toContain('factory comment');
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-19 — own comment: user A · banned D banned; the soft-delete semantics
// ---------------------------------------------------------------------------------------------
describe('T-ACT-19 deleteComment on own comment', () => {
  it('T-ACT-19 author → ok: status deleted, body retained, not returned to non-mods, replies stay published, no stamp, comment_count unchanged, tag revalidated, no audit line', async () => {
    const root = await makeComment({ author_id: victim, body: 't_ T-ACT-19 keep me in the db' });
    const reply = await makeComment({ author_id: SEED_USERS.seed_user, parent_id: root });
    const before = await commentCount(victim);

    const data = expectOk(
      await callActionAs(deleteComment, { comment_id: root }, { profileId: victim }),
    );
    expect(data).toEqual({ comment_id: root, status: 'deleted' });

    const row = await storedComment(root);
    expect(row.status).toBe('deleted');
    expect(row.body).toBe('t_ T-ACT-19 keep me in the db');
    expect(row.moderated_by).toBeNull();
    expect(row.moderated_at).toBeNull();
    expect((await storedComment(reply)).status).toBe('published');
    expect(await commentCount(victim)).toBe(before);
    expect(tags.calls).toEqual([PIXEL_TAG]);
    expect(adminLines()).toEqual([]);

    // Never returned to non-mods: the public slot has no body, another user cannot select the row.
    const slot = await asRole('anon')
      .from('comments_public')
      .select('status, body')
      .eq('id', root)
      .single();
    expect(slot.data).toEqual({ status: 'deleted', body: null });
    const other = await asRole('user').from('comments').select('id').eq('id', root);
    expect(other.data).toEqual([]);
    const mod = await asRole('mod').from('comments').select('body').eq('id', root).single();
    expect(mod.data?.body).toBe('t_ T-ACT-19 keep me in the db');
  });

  it('T-ACT-19 banned author → banned, row untouched', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_banned });
    expectFail(await callAction(deleteComment, { comment_id: id }, { role: 'banned' }), 'banned');
    expect((await storedComment(id)).status).toBe('published');
  });

  it('T-ACT-19 author delete has no time window (2-day-old comment)', async () => {
    const id = await makeComment({
      author_id: victim,
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    });
    expectOk(await callActionAs(deleteComment, { comment_id: id }, { profileId: victim }));
    expect((await storedComment(id)).status).toBe('deleted');
  });

  it('T-ACT-19 seed user deletes own factory row (the matrix `user` cell, one comment_delete hit)', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user });
    expectOk(await callAction(deleteComment, { comment_id: id }, { role: 'user' }));
    expect(await countRateLimitHits('comment_delete', SEED_USERS.seed_user)).toBe(1);
  });

  it('T-ACT-19 the 21st author delete in a minute → rate_limited (rate_limit_hits only)', async () => {
    const id = await makeComment({ author_id: victim });
    // Earlier cells recorded the victim's own hits — start the minute from zero.
    await clearRateLimitHitsFor(['comment_delete'], [victim]);
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 20 }, () => ({ scope: 'comment_delete', key: victim })));
    expect(error).toBeNull();
    try {
      const limited = expectFail(
        await callActionAs(deleteComment, { comment_id: id }, { profileId: victim }),
        'rate_limited',
      );
      expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
      expect(await countRateLimitHits('comment_delete', victim)).toBe(21);
      expect((await storedComment(id)).status).toBe('published');
    } finally {
      await clearRateLimitHitsFor(['comment_delete'], [victim]);
    }
  });

  it('T-ACT-19 an already-deleted or unknown comment → not_found; the moderator path is not rate-limited', async () => {
    const id = await makeComment({ author_id: victim, status: 'deleted' });
    expectFail(
      await callActionAs(deleteComment, { comment_id: id }, { profileId: victim }),
      'not_found',
    );
    expectFail(await callAction(deleteComment, { comment_id: id }, { role: 'mod' }), 'not_found');
    expectFail(
      await callAction(deleteComment, { comment_id: randomUUID() }, { role: 'mod' }),
      'not_found',
    );
    expectFail(
      await callActionAs(deleteComment, { comment_id: 'nope' }, { profileId: victim }),
      'validation',
    );
    expect(await countRateLimitHits('comment_delete', SEED_USERS.seed_mod)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-19 — the onboarding gate, the between-the-read-and-the-write races the RLS/trigger layer
// answers (a hard-deleted row, a ban), and DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-19 deleteComment edge states + DB faults', () => {
  it('T-ACT-19 nohandle → onboarding_required before any table is read, no hit', async () => {
    const error = expectFail(
      await callAction(
        deleteComment,
        { comment_id: SEED_COMMENTS.published },
        { role: 'nohandle' },
      ),
      'onboarding_required',
    );
    expect(error.message).toBe('Pick a handle first.');
    expect((await storedComment(SEED_COMMENTS.published)).status).toBe('published');
    expect(await countRateLimitHits('comment_delete', SEED_USERS.seed_newbie)).toBe(0);
  });

  it('T-ACT-19 author: the row is hard-deleted between the read and the write → not_found, no revalidate', async () => {
    const id = await makeComment({ author_id: victim });
    const res = await withDbHook(
      { rpc: 'rate_limit_ok' },
      async () => {
        const { error } = await service.from('comments').delete().eq('id', id);
        if (error) throw new Error(`hook: comments delete failed: ${error.message}`);
      },
      () => callActionAs(deleteComment, { comment_id: id }, { profileId: victim }),
    );
    expectFail(res, 'not_found');
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-19 author banned between the read and the write → banned (comments_guard answers 42501), row untouched', async () => {
    const author = await makeUser({ comment_count: 1 });
    const id = await makeComment({ author_id: author });
    const res = await withDbHook(
      { rpc: 'rate_limit_ok' },
      () => patchProfile(author, { is_banned: true }),
      () => callActionAs(deleteComment, { comment_id: id }, { profileId: author }),
    );
    const error = expectFail(res, 'banned');
    expect(error.message).toBe(LINE_BANNED);
    expect((await storedComment(id)).status).toBe('published');
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-19 author path: the status write fails → internal + one log.error line, row untouched', async () => {
    const id = await makeComment({ author_id: victim });
    const res = await withDbFault({ table: 'comments', op: 'update' }, {}, () =>
      callActionAs(deleteComment, { comment_id: id }, { profileId: victim }),
    );
    expectInternal(res, 'deleteComment', logs);
    expect((await storedComment(id)).status).toBe('published');
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-19 moderator path: the status write fails → internal + one log.error line, row untouched, no audit line', async () => {
    const id = await makeComment({ author_id: victim });
    const res = await withDbFault({ table: 'comments', op: 'update' }, {}, () =>
      callAction(deleteComment, { comment_id: id }, { role: 'mod' }),
    );
    expectInternal(res, 'deleteComment', logs);
    expect((await storedComment(id)).status).toBe('published');
    expect(adminLines()).toEqual([]);
    expect(tags.calls).toEqual([]);
  });
});
