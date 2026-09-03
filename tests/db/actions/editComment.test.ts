/**
 * tests/db/actions/editComment.test.ts — T-ACT-17 / T-ACT-18 (05 §7.2; 04 §1.2 `editComment`;
 * §5.5 `comment_edit`; T-UNIT-8 `isWithinEditWindow`; ADR-0002 A4).
 *
 * Bodies are the author's alone (moderators and admins get `forbidden`), for 15 minutes from
 * `created_at` — boundary exclusive (14:59 → ok, 15:00 / 15:01 → `edit_window_expired`). The
 * action reads the APP clock (`isWithinEditWindow`) and the DB guard `comments_guard()` re-checks
 * on `now()` (T-RLS-72): the boundary cases freeze the app clock 2 s AHEAD of the DB clock
 * (`freezeAt`) and set `created_at` through `service`, so the two clocks can never disagree on
 * the 14:59 row. `edited_at` is set by the action, no trigger; status never changes (held stays
 * held). The 21st edit in a minute is refused on `rate_limit_hits` alone (ADR-0002 A4).
 *
 * Every comment is a factory row (`makeComment` on …0102); the acting seed roles get their hits
 * cleared; `revalidateTag('project:pixel-chameleon')` is asserted per successful edit.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { editComment } from '@/lib/actions/comments';
import type { EditCommentInput } from '@/lib/actions/comments.schema';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { LINE_EDIT_WINDOW, LINE_FORBIDDEN, LINE_TOO_MANY_LINKS } from '@/lib/validation/comment';
import { EDIT_WINDOW_MS } from '@/lib/validation/moderation';
import { clearRateLimitHitsFor, countRateLimitHits, readProfile } from '@/tests/helpers/arrange';
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
  makeUser,
  purgeNotificationEvents,
  restoreSeedCommentCounts,
} from '@/tests/helpers/factories';
import { SEED_USERS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';
import { freezeAt, unfreeze } from '@/tests/helpers/time';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();
const PIXEL_TAG = 'project:pixel-chameleon';

const MINUTE = 60_000;
const agoIso = (ms: number): string => new Date(Date.now() - ms).toISOString();

let author: string;

async function storedComment(id: string) {
  const { data, error } = await service
    .from('comments')
    .select('id, body, status, edited_at, updated_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`service could not read comments: ${error.message}`);
  return data;
}

async function editAs(profileId: string, input: EditCommentInput) {
  return callActionAs(editComment, input, { profileId });
}

beforeAll(async () => {
  author = await makeUser({ comment_count: 1 });
  await clearRateLimitHitsFor(['comment_edit'], [SEED_USERS.seed_user]);
});

afterEach(() => {
  unfreeze();
});

afterAll(async () => {
  await purgeNotificationEvents();
  await clearRateLimitHitsFor(['comment_edit'], [SEED_USERS.seed_user]);
  await cleanupFactories();
  await restoreSeedCommentCounts();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-17 — auth matrix on own comment created 1 min ago + the 15-minute window + rate limit
// ---------------------------------------------------------------------------------------------
describe('T-ACT-17 editComment auth + window', () => {
  it('T-ACT-17 anon → unauthenticated', async () => {
    const id = await makeComment({ author_id: author, created_at: agoIso(MINUTE) });
    expectFail(
      await callAction(editComment, { comment_id: id, body: 'x' }, { role: 'anon' }),
      'unauthenticated',
    );
  });

  it('T-ACT-17 author → ok (body updated, edited_at set)', async () => {
    const id = await makeComment({ author_id: author, created_at: agoIso(MINUTE) });
    const data = expectOk(await editAs(author, { comment_id: id, body: 'T-ACT-17 edited' }));
    expect(data.comment.body).toBe('T-ACT-17 edited');
    expect(data.comment.editedAt).not.toBeNull();
    const stored = await storedComment(id);
    expect(stored.body).toBe('T-ACT-17 edited');
    expect(stored.edited_at).not.toBeNull();
  });

  it.each(['user', 'mod', 'admin'] as const)(
    "T-ACT-17 %s on someone else's comment → forbidden (bodies are author-only)",
    async (role) => {
      const id = await makeComment({ author_id: author, created_at: agoIso(MINUTE) });
      const error = expectFail(
        await callAction(editComment, { comment_id: id, body: 'nope' }, { role }),
        'forbidden',
      );
      expect(error.message).toBe(LINE_FORBIDDEN);
      expect((await storedComment(id)).body).not.toBe('nope');
    },
  );

  it('T-ACT-17 banned → banned (own comment, nothing written)', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_banned, created_at: agoIso(MINUTE) });
    expectFail(
      await callAction(editComment, { comment_id: id, body: 'nope' }, { role: 'banned' }),
      'banned',
    );
    expect((await storedComment(id)).body).not.toBe('nope');
  });

  it('T-ACT-17 own comment created 16 min ago → edit_window_expired', async () => {
    const id = await makeComment({ author_id: author, created_at: agoIso(16 * MINUTE) });
    const error = expectFail(
      await editAs(author, { comment_id: id, body: 'late' }),
      'edit_window_expired',
    );
    expect(error.message).toBe(LINE_EDIT_WINDOW);
    expect((await storedComment(id)).edited_at).toBeNull();
  });

  it('T-ACT-17 boundary: 14:59 → ok, 15:00 → edit_window_expired, 15:01 → edit_window_expired', async () => {
    // The app clock runs 8 s AHEAD of the DB clock: the 14:59 row is 14:51 by DB time, so the
    // `comments_guard()` window (DB `now()`) cannot close between the arrange and the update on a
    // slow CI box; the 15:00 / 15:01 rows fail on the app-side check alone (no DB involvement).
    freezeAt(new Date(Date.now() + 8_000).toISOString());
    const at = (offsetMs: number): string => new Date(Date.now() - offsetMs).toISOString();

    const fresh = await makeComment({ author_id: author, created_at: at(EDIT_WINDOW_MS - 1_000) });
    const onEdge = await makeComment({ author_id: author, created_at: at(EDIT_WINDOW_MS) });
    const past = await makeComment({ author_id: author, created_at: at(EDIT_WINDOW_MS + 1_000) });

    expectOk(await editAs(author, { comment_id: fresh, body: '14:59' }));
    expectFail(await editAs(author, { comment_id: onEdge, body: '15:00' }), 'edit_window_expired');
    expectFail(await editAs(author, { comment_id: past, body: '15:01' }), 'edit_window_expired');
    expect((await storedComment(onEdge)).edited_at).toBeNull();
    expect((await storedComment(past)).edited_at).toBeNull();
  });

  it('T-ACT-17 the 21st edit in a minute → rate_limited (rate_limit_hits only)', async () => {
    const id = await makeComment({ author_id: author });
    // Earlier cells recorded the author's own hits — start the minute from zero.
    await clearRateLimitHitsFor(['comment_edit'], [author]);
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 20 }, () => ({ scope: 'comment_edit', key: author })));
    expect(error).toBeNull();
    try {
      const limited = expectFail(
        await editAs(author, { comment_id: id, body: 'x' }),
        'rate_limited',
      );
      expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
      expect(await countRateLimitHits('comment_edit', author)).toBe(21);
      expect((await storedComment(id)).edited_at).toBeNull();
    } finally {
      await clearRateLimitHitsFor(['comment_edit'], [author]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-18 — validation, effects, CommentView, revalidation, not_found cases
// ---------------------------------------------------------------------------------------------
describe('T-ACT-18 editComment validation + effects', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['1001 code points', 'a'.repeat(1001)],
  ])('T-ACT-18 %s body → validation', async (_label, body) => {
    const id = await makeComment({ author_id: author });
    expectFail(await editAs(author, { comment_id: id, body }), 'validation');
    expect((await storedComment(id)).edited_at).toBeNull();
  });

  it('T-ACT-18 two links → too_many_links', async () => {
    const id = await makeComment({ author_id: author });
    const error = expectFail(
      await editAs(author, { comment_id: id, body: 'http://a.example www.b.example' }),
      'too_many_links',
    );
    expect(error.message).toBe(LINE_TOO_MANY_LINKS);
  });

  it('T-ACT-18 success strips HTML, sets edited_at, keeps status, returns CommentView, revalidates project:<slug>', async () => {
    const id = await makeComment({ author_id: author });
    const { error } = await service
      .from('comment_likes')
      .insert({ comment_id: id, user_id: author });
    expect(error).toBeNull();
    const handle = (await readProfile(author))?.handle;
    tags.calls.length = 0;

    const data = expectOk(await editAs(author, { comment_id: id, body: '<b>fixed</b> typo' }));
    expect(data.comment).toEqual({
      id,
      body: 'fixed typo',
      status: 'published',
      createdAt: expect.any(String),
      editedAt: expect.any(String),
      parentId: null,
      likeCount: 1,
      likedByViewer: true,
      author: { id: author, handle, avatarUrl: null, role: 'user' },
    });
    expect(tags.calls).toEqual([PIXEL_TAG]);
  });

  it('T-ACT-18 a held comment stays held after an edit', async () => {
    const id = await makeComment({ author_id: author, status: 'held' });
    const data = expectOk(await editAs(author, { comment_id: id, body: 'still waiting' }));
    expect(data.comment.status).toBe('held');
    expect((await storedComment(id)).status).toBe('held');
  });

  it.each(['deleted', 'hidden'] as const)(
    'T-ACT-18 editing own %s comment → not_found',
    async (status) => {
      const id = await makeComment({ author_id: author, status });
      expectFail(await editAs(author, { comment_id: id, body: 'x' }), 'not_found');
    },
  );

  it('T-ACT-18 unknown / malformed comment_id → not_found / validation', async () => {
    expectFail(
      await editAs(author, { comment_id: '00000000-0000-4000-8000-0000000002ff', body: 'x' }),
      'not_found',
    );
    expectFail(await editAs(author, { comment_id: 'nope', body: 'x' }), 'validation');
  });

  it('T-ACT-18 a seed user edits own fresh factory row (the matrix `user` cell, hits cleared)', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user });
    const data = expectOk(
      await callAction(editComment, { comment_id: id, body: 'seed edit' }, { role: 'user' }),
    );
    expect(data.comment.author?.id).toBe(SEED_ROLE_IDS.user);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-17/18 — the DB-clock race (comments_guard closes the window, T-RLS-72), a row gone
// mid-flight, and DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-17 editComment mid-flight races + DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
    tags.calls.length = 0;
  });

  afterEach(() => {
    logs.restore();
  });

  it('T-ACT-17 the DB clock closes the window between the check and the write → edit_window_expired (comments_guard 42501), body untouched', async () => {
    const id = await makeComment({ author_id: author, created_at: agoIso(MINUTE) });
    const res = await withDbHook(
      { rpc: 'rate_limit_ok' },
      async () => {
        const { error } = await service
          .from('comments')
          .update({ created_at: agoIso(16 * MINUTE) })
          .eq('id', id);
        if (error) throw new Error(`hook: comments update failed: ${error.message}`);
      },
      () => editAs(author, { comment_id: id, body: 'too late' }),
    );
    const error = expectFail(res, 'edit_window_expired');
    expect(error.message).toBe(LINE_EDIT_WINDOW);
    expect((await storedComment(id)).body).not.toBe('too late');
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-18 the row is hard-deleted between the read and the write → not_found', async () => {
    const id = await makeComment({ author_id: author });
    const res = await withDbHook(
      { rpc: 'rate_limit_ok' },
      async () => {
        const { error } = await service.from('comments').delete().eq('id', id);
        if (error) throw new Error(`hook: comments delete failed: ${error.message}`);
      },
      () => editAs(author, { comment_id: id, body: 'gone' }),
    );
    expectFail(res, 'not_found');
    expect(tags.calls).toEqual([]);
  });

  it.each<{ name: string; target: DbCallTarget; landed: boolean }>([
    { name: 'the body write', target: { table: 'comments', op: 'update' }, landed: false },
    {
      name: 'the likedByViewer read (after the edit landed)',
      target: { table: 'comment_likes', op: 'select' },
      landed: true,
    },
    {
      name: 'the project read for the tag (after the edit landed)',
      target: { table: 'projects', op: 'select' },
      landed: true,
    },
  ])(
    'T-ACT-18 $name fails → internal + one log.error line, no revalidate',
    async ({ target, landed }) => {
      const id = await makeComment({ author_id: author });
      const res = await withDbFault(target, {}, () =>
        editAs(author, { comment_id: id, body: 'faulted edit' }),
      );
      expectInternal(res, 'editComment', logs);
      expect((await storedComment(id)).body === 'faulted edit').toBe(landed);
      expect(tags.calls).toEqual([]);
    },
  );
});
