/**
 * tests/db/actions/toggleLike.test.ts — T-ACT-20 (05 §7.2; 04 §1.2 `toggleLike`; §5.5 `like`;
 * ADR-0002 A4 + "Also": `toggleLike` revalidates `project:<slug>`; T-RLS-80/83 for the trigger).
 *
 * A like is a row per (comment, user): the first call inserts and `like_count` follows the
 * trigger, the second call deletes. Only `published` comments on a visible target can be liked
 * (`not_found` otherwise — never distinguishes held from absent). 60 / min on `rate_limit_hits`
 * (every call, like or unlike, records a hit).
 *
 * `mutatesSeed`: the matrix `user` cell toggles seed …0201 (SEED-9 `like_count 1`) up to 2 and
 * back; `afterAll` removes any like on …0201 that is not the seed one. Other cells use factory
 * comments; seed actors' `like` hits are cleared.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toggleLike } from '@/lib/actions/comments';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { clearRateLimitHitsFor, countRateLimitHits } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import {
  expectInternal,
  withDbFault,
  withDbHook,
  type DbCallTarget,
} from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeComment,
  makeProject,
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
const SEED_ACTORS = [
  SEED_USERS.seed_user,
  SEED_USERS.seed_mod,
  SEED_USERS.oddsense,
  SEED_USERS.seed_banned,
];

async function likeCount(commentId: string): Promise<number> {
  const { data, error } = await service
    .from('comments')
    .select('like_count')
    .eq('id', commentId)
    .single();
  if (error) throw new Error(`service could not read comments: ${error.message}`);
  return data.like_count;
}

async function likeRows(commentId: string): Promise<number> {
  const { count, error } = await service
    .from('comment_likes')
    .select('*', { count: 'exact', head: true })
    .eq('comment_id', commentId);
  if (error) throw new Error(`service could not count comment_likes: ${error.message}`);
  return count ?? 0;
}

async function restoreSeedLikes(): Promise<void> {
  const { error } = await service
    .from('comment_likes')
    .delete()
    .eq('comment_id', SEED_COMMENTS.published)
    .neq('user_id', SEED_USERS.seed_user2);
  if (error) throw new Error(`restore: comment_likes delete failed: ${error.message}`);
}

beforeAll(async () => {
  await clearRateLimitHitsFor(['like'], SEED_ACTORS);
});

beforeEach(() => {
  tags.calls.length = 0;
});

afterAll(async () => {
  await restoreSeedLikes();
  await purgeNotificationEvents();
  await clearRateLimitHitsFor(['like'], SEED_ACTORS);
  await cleanupFactories();
  await restoreSeedCommentCounts();
});

describe('T-ACT-20 toggleLike', () => {
  it('T-ACT-20 anon → unauthenticated', async () => {
    expectFail(
      await callAction(toggleLike, { comment_id: SEED_COMMENTS.published }, { role: 'anon' }),
      'unauthenticated',
    );
    expect(await likeCount(SEED_COMMENTS.published)).toBe(1);
  });

  it('T-ACT-20 banned → banned, nothing written, no hit', async () => {
    expectFail(
      await callAction(toggleLike, { comment_id: SEED_COMMENTS.published }, { role: 'banned' }),
      'banned',
    );
    expect(await likeCount(SEED_COMMENTS.published)).toBe(1);
    expect(await countRateLimitHits('like', SEED_USERS.seed_banned)).toBe(0);
  });

  it('T-ACT-20 user on …0201: first call likes (1→2), second call unlikes (→1); each call revalidates project:<slug> and records a hit (mutatesSeed)', async () => {
    const first = expectOk(
      await callAction(toggleLike, { comment_id: SEED_COMMENTS.published }, { role: 'user' }),
    );
    expect(first).toEqual({ liked: true, like_count: 2 });
    expect(await likeCount(SEED_COMMENTS.published)).toBe(2);
    expect(tags.calls).toEqual([PIXEL_TAG]);

    const second = expectOk(
      await callAction(toggleLike, { comment_id: SEED_COMMENTS.published }, { role: 'user' }),
    );
    expect(second).toEqual({ liked: false, like_count: 1 });
    expect(await likeCount(SEED_COMMENTS.published)).toBe(1);
    expect(await likeRows(SEED_COMMENTS.published)).toBe(1);
    expect(tags.calls).toEqual([PIXEL_TAG, PIXEL_TAG]);
    expect(await countRateLimitHits('like', SEED_USERS.seed_user)).toBe(2);
  });

  it.each(['mod', 'admin'] as const)('T-ACT-20 %s → ok on a factory comment', async (role) => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const data = expectOk(await callAction(toggleLike, { comment_id: id }, { role }));
    expect(data).toEqual({ liked: true, like_count: 1 });
    const { data: rows } = await service
      .from('comment_likes')
      .select('user_id')
      .eq('comment_id', id);
    expect(rows).toEqual([{ user_id: SEED_ROLE_IDS[role] }]);
  });

  it('T-ACT-20 a concurrent double-call ends consistent (0 or 1 like, like_count = rows)', async () => {
    const liker = await makeUser({ comment_count: 1 });
    const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const results = await Promise.all([
      callActionAs(toggleLike, { comment_id: id }, { profileId: liker }),
      callActionAs(toggleLike, { comment_id: id }, { profileId: liker }),
    ]);
    for (const res of results) expectOk(res);
    const rows = await likeRows(id);
    expect([0, 1]).toContain(rows);
    expect(await likeCount(id)).toBe(rows);
    expect(await countRateLimitHits('like', liker)).toBe(2);
  });

  it.each([
    ['held', SEED_COMMENTS.held],
    ['hidden', SEED_COMMENTS.hidden],
    ['deleted (own)', SEED_COMMENTS.deleted],
  ])('T-ACT-20 liking a %s comment → not_found', async (_label, comment_id) => {
    expectFail(await callAction(toggleLike, { comment_id }, { role: 'user' }), 'not_found');
    expect(await likeRows(comment_id)).toBe(0);
  });

  it('T-ACT-20 liking a comment on a hidden target → not_found', async () => {
    const projectId = await makeProject({ status: 'published' });
    const { error } = await service
      .from('project_overrides')
      .insert({ project_id: projectId, hidden: true });
    expect(error).toBeNull();
    const id = await makeComment({ target_id: projectId, author_id: SEED_USERS.seed_user2 });
    expectFail(await callAction(toggleLike, { comment_id: id }, { role: 'user' }), 'not_found');
    expect(await likeRows(id)).toBe(0);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-20 unknown / malformed id → not_found / validation', async () => {
    expectFail(
      await callAction(
        toggleLike,
        { comment_id: '00000000-0000-4000-8000-0000000002ff' },
        { role: 'user' },
      ),
      'not_found',
    );
    expectFail(
      await callAction(toggleLike, { comment_id: 'nope' }, { role: 'user' }),
      'validation',
    );
  });

  it('T-ACT-20 the 61st like in a minute → rate_limited (rate_limit_hits only)', async () => {
    const liker = await makeUser({ comment_count: 1 });
    const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 60 }, () => ({ scope: 'like', key: liker })));
    expect(error).toBeNull();
    const limited = expectFail(
      await callActionAs(toggleLike, { comment_id: id }, { profileId: liker }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect(await countRateLimitHits('like', liker)).toBe(61);
    expect(await likeRows(id)).toBe(0);
    expect(tags.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-20 — own row on a hidden target, the concurrent-like and comments-closed races the DB
// answers (23505 / 42501), and DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-20 toggleLike edge states + DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  async function closedProjectComment(): Promise<{ projectId: string; id: string }> {
    const projectId = await makeProject();
    const id = await makeComment({ target_id: projectId, author_id: SEED_USERS.seed_user2 });
    return { projectId, id };
  }

  it('T-ACT-20 the author liking own comment on a hidden target → not_found (own row readable, target invisible)', async () => {
    const projectId = await makeProject();
    const { error } = await service
      .from('project_overrides')
      .insert({ project_id: projectId, hidden: true });
    expect(error).toBeNull();
    const id = await makeComment({ target_id: projectId, author_id: SEED_USERS.seed_user });
    expectFail(await callAction(toggleLike, { comment_id: id }, { role: 'user' }), 'not_found');
    expect(await likeRows(id)).toBe(0);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-20 a like that lands concurrently (unique violation) → liked:true, like_count = rows', async () => {
    const liker = await makeUser({ comment_count: 1 });
    const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const data = expectOk(
      await withDbHook(
        { table: 'comment_likes', op: 'select' },
        async () => {
          const { error } = await service
            .from('comment_likes')
            .insert({ comment_id: id, user_id: liker });
          if (error) throw new Error(`hook: comment_likes insert failed: ${error.message}`);
        },
        () => callActionAs(toggleLike, { comment_id: id }, { profileId: liker }),
        { when: 'after' },
      ),
    );
    expect(data).toEqual({ liked: true, like_count: 1 });
    expect(await likeRows(id)).toBe(1);
    expect(tags.calls).toEqual([PIXEL_TAG]);
  });

  it('T-ACT-20 comments closed between the checks and the write → not_found (RLS 42501), no like row', async () => {
    const liker = await makeUser({ comment_count: 1 });
    const { projectId, id } = await closedProjectComment();
    const res = await withDbHook(
      { rpc: 'rate_limit_ok' },
      async () => {
        const { error } = await service
          .from('project_overrides')
          .insert({ project_id: projectId, comments_enabled: false });
        if (error) throw new Error(`hook: project_overrides insert failed: ${error.message}`);
      },
      () => callActionAs(toggleLike, { comment_id: id }, { profileId: liker }),
    );
    expectFail(res, 'not_found');
    expect(await likeRows(id)).toBe(0);
    expect(tags.calls).toEqual([]);
  });

  it.each<{ name: string; target: DbCallTarget; nth?: number; arrangeLike: boolean; rows: number }>(
    [
      {
        name: 'the like insert',
        target: { table: 'comment_likes', op: 'insert' },
        arrangeLike: false,
        rows: 0,
      },
      {
        name: 'the unlike delete',
        target: { table: 'comment_likes', op: 'delete' },
        arrangeLike: true,
        rows: 1,
      },
      {
        name: 'the like_count read (after the like landed)',
        target: { table: 'comments', op: 'select' },
        nth: 2,
        arrangeLike: false,
        rows: 1,
      },
      {
        name: 'the projects_public read',
        target: { table: 'projects_public', op: 'select' },
        arrangeLike: false,
        rows: 0,
      },
    ],
  )(
    'T-ACT-20 $name fails → internal + one log.error line, no revalidate',
    async ({ target, nth, arrangeLike, rows }) => {
      const liker = await makeUser({ comment_count: 1 });
      const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
      if (arrangeLike) {
        const { error } = await service
          .from('comment_likes')
          .insert({ comment_id: id, user_id: liker });
        expect(error).toBeNull();
      }
      const res = await withDbFault(target, nth === undefined ? {} : { nth }, () =>
        callActionAs(toggleLike, { comment_id: id }, { profileId: liker }),
      );
      expectInternal(res, 'toggleLike', logs);
      expect(await likeRows(id)).toBe(rows);
      expect(tags.calls).toEqual([]);
    },
  );
});
