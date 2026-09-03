/**
 * tests/db/rls/comment_likes.test.ts — RLS matrix for `comment_likes` (docs/build/05-test-plan.md
 * §7.1 T-RLS-79..84 + the `like_count` half of T-RLS-126; data-model §2.5 / §4; ADR-0028 D4).
 * Policies + trigger: supabase/migrations/20260903090100_comment_likes_reports.sql — select =
 * everyone; insert = own row + `can_comment()` on the liked comment's target (the comment lookup
 * runs under `comments` RLS as the caller); NO update policy and no update grant; delete = own row.
 * `comment_likes_count()` keeps `comments.like_count` in step on insert and delete. Cell order of
 * every cell comment: anon | user | banned | mod | admin | svc.
 *
 * The seed like (…0201 ← seed_user2, SEED-9 → `like_count 1`) is read-only (H-1): denied cells
 * target it and are proven no-ops through `service`; allowed cells like / unlike FACTORY comments
 * (`makeComment`), whose like rows cascade away with them in `cleanupFactories`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, SEED_ROLE_IDS, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeComment } from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_USERS } from '@/tests/helpers/seedIds';

const ALL_ROLES = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
  'service',
] as const satisfies readonly TestRole[];
const NON_SERVICE = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
] as const satisfies readonly TestRole[];
const service = asRole('service');

const SEED_LIKE = { comment_id: SEED_COMMENTS.published, user_id: SEED_USERS.seed_user2 } as const;

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

/** A like row through service (arranges the "own row" the delete cells remove). */
async function arrangeLike(commentId: string, userId: string): Promise<void> {
  const { error } = await service
    .from('comment_likes')
    .insert({ comment_id: commentId, user_id: userId });
  if (error) throw new Error(`arrange: comment_likes insert failed: ${error.message}`);
}

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-79 select — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-79 comment_likes select', () => {
  it.each(ALL_ROLES)('T-RLS-79 %s sees the seed like row', async (role) => {
    await expectPolicy({
      table: 'comment_likes',
      op: 'select',
      role,
      allowed: true,
      filter: SEED_LIKE,
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-80 insert (comment_id, user_id = auth.uid()) → like_count +1 — D | A | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-80 comment_likes insert own', () => {
  it('T-RLS-80 anon cannot like', async () => {
    const commentId = await makeComment();
    await expectPolicy({
      table: 'comment_likes',
      op: 'insert',
      role: 'anon',
      allowed: false,
      row: { comment_id: commentId, user_id: SEED_USERS.seed_user },
    });
    expect(await likeRows(commentId)).toBe(0);
    expect(await likeCount(commentId)).toBe(0);
  });

  it('T-RLS-80 banned cannot like (can_comment false)', async () => {
    const commentId = await makeComment();
    await expectPolicy({
      table: 'comment_likes',
      op: 'insert',
      role: 'banned',
      allowed: false,
      row: { comment_id: commentId, user_id: SEED_USERS.seed_banned },
    });
    expect(await likeRows(commentId)).toBe(0);
    expect(await likeCount(commentId)).toBe(0);
  });

  it.each(['user', 'mod', 'admin'] as const)(
    'T-RLS-80 %s likes a comment → like_count +1',
    async (role) => {
      const commentId = await makeComment({ author_id: SEED_USERS.seed_user2 });
      await expectPolicy({
        table: 'comment_likes',
        op: 'insert',
        role,
        allowed: true,
        row: { comment_id: commentId, user_id: SEED_ROLE_IDS[role] },
        expectRows: 1,
      });
      expect(await likeCount(commentId)).toBe(1);
      expect(await likeRows(commentId)).toBe(1);
    },
  );

  it('T-RLS-80 service inserts a like → like_count +1', async () => {
    const commentId = await makeComment();
    await expectPolicy({
      table: 'comment_likes',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { comment_id: commentId, user_id: SEED_USERS.seed_user2 },
      expectRows: 1,
    });
    expect(await likeCount(commentId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-81 insert with user_id ≠ auth.uid() — D | D | D | D | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-81 comment_likes insert as someone else', () => {
  it.each(NON_SERVICE)('T-RLS-81 %s cannot like on behalf of another user', async (role) => {
    const commentId = await makeComment();
    const other = role === 'admin' ? SEED_USERS.seed_user : SEED_USERS.oddsense;
    await expectPolicy({
      table: 'comment_likes',
      op: 'insert',
      role,
      allowed: false,
      row: { comment_id: commentId, user_id: other },
    });
    expect(await likeRows(commentId)).toBe(0);
    expect(await likeCount(commentId)).toBe(0);
  });

  it('T-RLS-81 service inserts a like for any user', async () => {
    const commentId = await makeComment();
    await expectPolicy({
      table: 'comment_likes',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { comment_id: commentId, user_id: SEED_USERS.seed_newbie },
      expectRows: 1,
    });
    expect(await likeCount(commentId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-82 update — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-82 comment_likes update', () => {
  it.each(NON_SERVICE)('T-RLS-82 %s cannot update a like row', async (role) => {
    await expectPolicy({
      table: 'comment_likes',
      op: 'update',
      role,
      allowed: false,
      filter: SEED_LIKE,
      patch: { created_at: '2020-01-01T00:00:00.000Z' },
    });
    const { data } = await service
      .from('comment_likes')
      .select('created_at')
      .match(SEED_LIKE)
      .single();
    expect(data?.created_at.startsWith('2020-')).toBe(false);
  });

  it('T-RLS-82 service updates a like row (factory)', async () => {
    const commentId = await makeComment();
    await arrangeLike(commentId, SEED_USERS.seed_user2);
    await expectPolicy({
      table: 'comment_likes',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { comment_id: commentId, user_id: SEED_USERS.seed_user2 },
      patch: { created_at: '2020-01-01T00:00:00.000Z' },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-83 delete own → like_count −1 — D | A | A ⓘ | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-83 comment_likes delete own', () => {
  it('T-RLS-83 anon cannot delete a like', async () => {
    await expectPolicy({
      table: 'comment_likes',
      op: 'delete',
      role: 'anon',
      allowed: false,
      filter: SEED_LIKE,
    });
    expect(await likeRows(SEED_COMMENTS.published)).toBe(1);
    expect(await likeCount(SEED_COMMENTS.published)).toBe(1);
  });

  it.each(['user', 'banned', 'mod', 'admin'] as const)(
    'T-RLS-83 %s removes own like → like_count −1',
    async (role) => {
      const commentId = await makeComment({ author_id: SEED_USERS.seed_user2 });
      await arrangeLike(commentId, SEED_ROLE_IDS[role]);
      expect(await likeCount(commentId)).toBe(1);
      await expectPolicy({
        table: 'comment_likes',
        op: 'delete',
        role,
        allowed: true,
        filter: { comment_id: commentId, user_id: SEED_ROLE_IDS[role] },
        expectRows: 1,
      });
      expect(await likeCount(commentId)).toBe(0);
      expect(await likeRows(commentId)).toBe(0);
    },
  );

  it('T-RLS-83 service removes any like → like_count −1', async () => {
    const commentId = await makeComment();
    await arrangeLike(commentId, SEED_USERS.seed_user2);
    await expectPolicy({
      table: 'comment_likes',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { comment_id: commentId, user_id: SEED_USERS.seed_user2 },
      expectRows: 1,
    });
    expect(await likeCount(commentId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-84 delete another user's like — D | D | D | D | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-84 comment_likes delete another user’s', () => {
  it.each(NON_SERVICE)("T-RLS-84 %s cannot delete seed_user2's like on …0201", async (role) => {
    await expectPolicy({
      table: 'comment_likes',
      op: 'delete',
      role,
      allowed: false,
      filter: SEED_LIKE,
    });
    expect(await likeRows(SEED_COMMENTS.published)).toBe(1);
    expect(await likeCount(SEED_COMMENTS.published)).toBe(1);
  });

  it('T-RLS-84 service deletes any like (factory)', async () => {
    const commentId = await makeComment();
    await arrangeLike(commentId, SEED_USERS.seed_user);
    await expectPolicy({
      table: 'comment_likes',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { comment_id: commentId, user_id: SEED_USERS.seed_user },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-126 (like_count half): the trigger keeps comments.like_count equal to the like rows.
// ---------------------------------------------------------------------------------------------
describe('T-RLS-126 like_count trigger', () => {
  it('T-RLS-126 seed …0201 carries like_count 1 = its one like row', async () => {
    expect(await likeCount(SEED_COMMENTS.published)).toBe(1);
    expect(await likeRows(SEED_COMMENTS.published)).toBe(1);
  });

  it('T-RLS-126 insert/delete moves like_count with the rows and never below 0', async () => {
    const commentId = await makeComment();
    await arrangeLike(commentId, SEED_USERS.seed_user);
    await arrangeLike(commentId, SEED_USERS.seed_user2);
    expect(await likeCount(commentId)).toBe(2);
    const { error } = await service.from('comment_likes').delete().eq('comment_id', commentId);
    expect(error).toBeNull();
    expect(await likeCount(commentId)).toBe(0);
  });
});
