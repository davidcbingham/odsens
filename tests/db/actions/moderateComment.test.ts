/**
 * tests/db/actions/moderateComment.test.ts — T-ACT-23 (+ T-ACT-69 SC-24 audit line) (05 §7.2;
 * 04 §1.2 `moderateComment`; `lib/validation/moderation.ts` MODERATION_TRANSITIONS; ADR-0002 C7).
 *
 * `requireRole('moderator')` then the service client: approve `held → published` (event
 * `comment.approved`, the author's `comment_count` +1 through the trigger, unresolved reports
 * resolved), hide `published|held → hidden` (reports resolved), unhide `hidden → published`
 * (reports untouched), delete any non-deleted → `deleted` (reports resolved); every transition
 * stamps `moderated_by = actor`, `moderated_at`; an illegal transition → `conflict`, an unknown id
 * → `not_found`; `project:<slug>` revalidated; exactly one keys-only `msg:'admin'` line per
 * `ok:true` (SC-24).
 *
 * The auth matrix approves the seed …0203 (`mutatesSeed`, restored to held / unstamped with
 * seed_user2's `comment_count` back to 0 after each A cell); transitions run on factory comments
 * by a factory author with reports arranged through `service`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { moderateComment } from '@/lib/actions/comments';
import type { ModerateCommentInput } from '@/lib/actions/comments.schema';
import { LINE_FORBIDDEN } from '@/lib/validation/comment';
import { patchProfile, readProfile } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
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

let author: string;
let logs: LogSpy;

async function storedComment(id: string) {
  const { data, error } = await service
    .from('comments')
    .select('id, status, moderated_by, moderated_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`service could not read comments: ${error.message}`);
  return data;
}

async function reports(commentId: string) {
  const { data, error } = await service
    .from('comment_reports')
    .select('reporter_id, resolved_at, resolved_by')
    .eq('comment_id', commentId)
    .order('reporter_id');
  if (error) throw new Error(`service could not read comment_reports: ${error.message}`);
  return data;
}

async function arrangeReports(commentId: string, reporters: string[]): Promise<void> {
  for (const reporter_id of reporters) {
    const { error } = await service
      .from('comment_reports')
      .insert({ comment_id: commentId, reporter_id, reason: 'spam' });
    if (error) throw new Error(`arrange: comment_reports insert failed: ${error.message}`);
  }
}

async function eventKinds(subjectId: string): Promise<string[]> {
  const { data, error } = await service
    .from('notification_events')
    .select('kind, payload')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`service could not read notification_events: ${error.message}`);
  return data.map((row) => row.kind);
}

async function commentCount(profileId: string): Promise<number> {
  const row = await readProfile(profileId);
  if (!row) throw new Error(`profile ${profileId} is gone`);
  return row.comment_count;
}

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

/** SC-24: exactly one keys-only audit line for `action` on `targetId` by `actorId`. */
function expectAuditLine(actorId: string, targetId: string, fields: string[]): void {
  const lines = adminLines();
  expect(lines).toHaveLength(1);
  const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
  expect(line.action).toBe('moderateComment');
  expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.keys(line.meta).sort()).toEqual([
    'actor_profile_id',
    'fields',
    'target_id',
    'target_type',
  ]);
  expect(line.meta.actor_profile_id).toBe(actorId);
  expect(line.meta.target_type).toBe('comment');
  expect(line.meta.target_id).toBe(targetId);
  expect([...(line.meta.fields as string[])].sort()).toEqual([...fields].sort());
  // keys only: the action value never appears in meta
  expect(JSON.stringify(line.meta)).not.toMatch(/approve|hide|unhide|delete/);
}

async function restoreSeedHeld(): Promise<void> {
  const { error } = await service
    .from('comments')
    .update({ status: 'held', moderated_by: null, moderated_at: null })
    .eq('id', SEED_COMMENTS.held);
  if (error) throw new Error(`restore: comments update failed: ${error.message}`);
  await patchProfile(SEED_USERS.seed_user2, { comment_count: 0 });
}

beforeAll(async () => {
  author = await makeUser();
});

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(() => {
  logs.restore();
});

afterAll(async () => {
  await restoreSeedHeld();
  await purgeNotificationEvents();
  await cleanupFactories();
  await restoreSeedCommentCounts();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-23 — auth matrix (approve on …0203)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-23 moderateComment auth (approve …0203)', () => {
  const input: ModerateCommentInput = { comment_id: SEED_COMMENTS.held, action: 'approve' };

  it('T-ACT-23 anon → unauthenticated', async () => {
    expectFail(await callAction(moderateComment, input, { role: 'anon' }), 'unauthenticated');
    expect((await storedComment(SEED_COMMENTS.held)).status).toBe('held');
  });

  it.each(['user', 'banned'] as const)(
    'T-ACT-23 %s → forbidden, row untouched, no audit line',
    async (role) => {
      const error = expectFail(await callAction(moderateComment, input, { role }), 'forbidden');
      expect(error.message).toBe(LINE_FORBIDDEN);
      expect((await storedComment(SEED_COMMENTS.held)).status).toBe('held');
      expect(adminLines()).toEqual([]);
      expect(tags.calls).toEqual([]);
    },
  );

  it.each(['mod', 'admin'] as const)(
    'T-ACT-23 %s → ok: …0203 published, stamped, comment.approved, seed_user2 comment_count 0→1, tag, audit line (mutatesSeed)',
    async (role) => {
      await restoreSeedHeld();
      const data = expectOk(await callAction(moderateComment, input, { role }));
      expect(data).toEqual({ comment_id: SEED_COMMENTS.held, status: 'published' });
      const row = await storedComment(SEED_COMMENTS.held);
      expect(row.status).toBe('published');
      expect(row.moderated_by).toBe(SEED_ROLE_IDS[role]);
      expect(row.moderated_at).not.toBeNull();
      expect(await commentCount(SEED_USERS.seed_user2)).toBe(1);
      expect(await eventKinds(SEED_COMMENTS.held)).toContain('comment.approved');
      expect(tags.calls).toEqual([PIXEL_TAG]);
      expectAuditLine(SEED_ROLE_IDS[role], SEED_COMMENTS.held, ['comment_id', 'action']);
      await restoreSeedHeld();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-23 — transitions, reports, events, conflicts (factory rows, actor = seed_mod)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-23 moderateComment transitions', () => {
  it('T-ACT-23 approve: held → published, comment.approved {comment_id, author}, comment_count +1, reports resolved', async () => {
    const id = await makeComment({ author_id: author, status: 'held' });
    await arrangeReports(id, [SEED_USERS.seed_user, SEED_USERS.seed_user2]);
    const before = await commentCount(author);
    const handle = (await readProfile(author))?.handle;

    const data = expectOk(
      await callAction(moderateComment, { comment_id: id, action: 'approve' }, { role: 'mod' }),
    );
    expect(data).toEqual({ comment_id: id, status: 'published' });
    const row = await storedComment(id);
    expect(row.status).toBe('published');
    expect(row.moderated_by).toBe(SEED_USERS.seed_mod);
    expect(row.moderated_at).not.toBeNull();
    expect(await commentCount(author)).toBe(before + 1);

    const { data: events } = await service
      .from('notification_events')
      .select('kind, actor_id, subject_type, payload')
      .eq('subject_id', id);
    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      kind: 'comment.approved',
      actor_id: SEED_USERS.seed_mod,
      subject_type: 'comment',
      payload: { comment_id: id, author: { profile_id: author, handle } },
    });
    expect(Object.keys((events?.[0]?.payload as object) ?? {}).sort()).toEqual([
      'author',
      'comment_id',
    ]);

    for (const report of await reports(id)) {
      expect(report.resolved_at).not.toBeNull();
      expect(report.resolved_by).toBe(SEED_USERS.seed_mod);
    }
    expect(tags.calls).toEqual([PIXEL_TAG]);
    expectAuditLine(SEED_USERS.seed_mod, id, ['comment_id', 'action']);
  });

  it.each(['published', 'held'] as const)(
    'T-ACT-23 hide: %s → hidden, reports resolved, no event',
    async (status) => {
      const id = await makeComment({ author_id: author, status });
      await arrangeReports(id, [SEED_USERS.seed_user]);
      const data = expectOk(
        await callAction(moderateComment, { comment_id: id, action: 'hide' }, { role: 'mod' }),
      );
      expect(data).toEqual({ comment_id: id, status: 'hidden' });
      const row = await storedComment(id);
      expect(row.status).toBe('hidden');
      expect(row.moderated_by).toBe(SEED_USERS.seed_mod);
      expect((await reports(id))[0]?.resolved_at).not.toBeNull();
      expect(await eventKinds(id)).toEqual([]);
      expect(tags.calls).toEqual([PIXEL_TAG]);
    },
  );

  it('T-ACT-23 unhide: hidden → published (reports left as they are), admin actor stamped', async () => {
    const id = await makeComment({
      author_id: author,
      status: 'hidden',
      moderated_by: SEED_USERS.seed_mod,
    });
    await arrangeReports(id, [SEED_USERS.seed_user]);
    const data = expectOk(
      await callAction(moderateComment, { comment_id: id, action: 'unhide' }, { role: 'admin' }),
    );
    expect(data).toEqual({ comment_id: id, status: 'published' });
    const row = await storedComment(id);
    expect(row.status).toBe('published');
    expect(row.moderated_by).toBe(SEED_USERS.oddsense);
    expect((await reports(id))[0]?.resolved_at).toBeNull();
    expectAuditLine(SEED_USERS.oddsense, id, ['comment_id', 'action']);
  });

  it.each(['published', 'held', 'hidden'] as const)(
    'T-ACT-23 delete: %s → deleted, reports resolved, comment_count unchanged',
    async (status) => {
      const id = await makeComment({ author_id: author, status });
      await arrangeReports(id, [SEED_USERS.seed_user]);
      const before = await commentCount(author);
      const data = expectOk(
        await callAction(moderateComment, { comment_id: id, action: 'delete' }, { role: 'mod' }),
      );
      expect(data).toEqual({ comment_id: id, status: 'deleted' });
      const row = await storedComment(id);
      expect(row.status).toBe('deleted');
      expect(row.moderated_by).toBe(SEED_USERS.seed_mod);
      expect(row.moderated_at).not.toBeNull();
      expect((await reports(id))[0]?.resolved_at).not.toBeNull();
      expect(await commentCount(author)).toBe(before);
      expect(tags.calls).toEqual([PIXEL_TAG]);
    },
  );

  it.each([
    ['approve', 'published'],
    ['approve', 'hidden'],
    ['approve', 'deleted'],
    ['unhide', 'published'],
    ['unhide', 'held'],
    ['hide', 'hidden'],
    ['hide', 'deleted'],
    ['delete', 'deleted'],
  ] as const)(
    'T-ACT-23 illegal transition %s on a %s comment → conflict, nothing written',
    async (action, status) => {
      const id = await makeComment({ author_id: author, status });
      const error = expectFail(
        await callAction(moderateComment, { comment_id: id, action }, { role: 'mod' }),
        'conflict',
      );
      expect(error.message).toBe('That already happened.');
      const row = await storedComment(id);
      expect(row.status).toBe(status);
      expect(row.moderated_by).toBeNull();
      expect(adminLines()).toEqual([]);
      expect(tags.calls).toEqual([]);
    },
  );

  it('T-ACT-23 unknown id → not_found; unknown action / malformed id → validation', async () => {
    expectFail(
      await callAction(
        moderateComment,
        { comment_id: randomUUID(), action: 'approve' },
        { role: 'mod' },
      ),
      'not_found',
    );
    expectFail(
      await callAction(
        moderateComment,
        { comment_id: SEED_COMMENTS.held, action: 'nuke' } as unknown as ModerateCommentInput,
        { role: 'mod' },
      ),
      'validation',
    );
    expectFail(
      await callAction(moderateComment, { comment_id: 'nope', action: 'approve' }, { role: 'mod' }),
      'validation',
    );
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-23 — edge states (author gone, project gone) + DB faults (T-ACT-0 (1): a thrown DB error →
// internal + one log.error line, never a throw to the caller)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-23 moderateComment edge states + DB faults', () => {
  async function eventsFor(subjectId: string) {
    const { data, error } = await service
      .from('notification_events')
      .select('kind, payload')
      .eq('subject_id', subjectId);
    if (error) throw new Error(`service could not read notification_events: ${error.message}`);
    return data;
  }

  it('T-ACT-23 approve on a comment whose author account is gone (author_id NULL) → ok, comment.approved carries author null', async () => {
    const id = await makeComment({ author_id: author, status: 'held' });
    const { error } = await service.from('comments').update({ author_id: null }).eq('id', id);
    expect(error).toBeNull();

    const data = expectOk(
      await callAction(moderateComment, { comment_id: id, action: 'approve' }, { role: 'mod' }),
    );
    expect(data).toEqual({ comment_id: id, status: 'published' });
    expect(await eventsFor(id)).toEqual([
      { kind: 'comment.approved', payload: { comment_id: id, author: null } },
    ]);
    expect(tags.calls).toEqual([PIXEL_TAG]);
  });

  it("T-ACT-23 the author's account vanishes between the status write and the event → ok, author null (public_profiles has no row)", async () => {
    const gone = await makeUser({ comment_count: 1 });
    const id = await makeComment({ author_id: gone, status: 'held' });

    const data = expectOk(
      await withDbHook(
        { table: 'comments', op: 'update' },
        async () => {
          const { error } = await service.auth.admin.deleteUser(gone);
          if (error) throw new Error(`hook: deleteUser failed: ${error.message}`);
        },
        () => callAction(moderateComment, { comment_id: id, action: 'approve' }, { role: 'mod' }),
        { when: 'after' },
      ),
    );
    expect(data).toEqual({ comment_id: id, status: 'published' });
    expect(await eventsFor(id)).toEqual([
      { kind: 'comment.approved', payload: { comment_id: id, author: null } },
    ]);
    // The profiles FK nulled the author once the account went (04 §1.1 "Deleted." slot).
    expect((await storedComment(id)).status).toBe('published');
  });

  it('T-ACT-23 a comment whose project row is gone → ok (hidden, stamped, audit line), nothing to revalidate', async () => {
    const projectId = await makeProject();
    const id = await makeComment({ target_id: projectId, author_id: author });
    const { error } = await service.from('projects').delete().eq('id', projectId);
    expect(error).toBeNull();

    const data = expectOk(
      await callAction(moderateComment, { comment_id: id, action: 'hide' }, { role: 'mod' }),
    );
    expect(data).toEqual({ comment_id: id, status: 'hidden' });
    expect((await storedComment(id)).moderated_by).toBe(SEED_USERS.seed_mod);
    expect(tags.calls).toEqual([]);
    expectAuditLine(SEED_USERS.seed_mod, id, ['comment_id', 'action']);
  });

  it.each<{ name: string; target: DbCallTarget; untouched: boolean }>([
    { name: 'the comment read', target: { table: 'comments', op: 'select' }, untouched: true },
    { name: 'the status write', target: { table: 'comments', op: 'update' }, untouched: true },
    {
      name: 'the report resolution (after the status write)',
      target: { table: 'comment_reports', op: 'update' },
      untouched: false,
    },
  ])(
    'T-ACT-23 $name fails → internal + one log.error line, no audit line, no revalidate',
    async ({ target, untouched }) => {
      const id = await makeComment({ author_id: author });
      const res = await withDbFault(target, {}, () =>
        callAction(moderateComment, { comment_id: id, action: 'hide' }, { role: 'mod' }),
      );
      const meta = expectInternal(res, 'moderateComment', logs);
      expect(meta.name).toBe('Error');
      expect((await storedComment(id)).status).toBe(untouched ? 'published' : 'hidden');
      expect(adminLines()).toEqual([]);
      expect(tags.calls).toEqual([]);
    },
  );

  it('T-ACT-23 the public_profiles read for the approve event fails → internal; the approve itself stands, no event', async () => {
    const id = await makeComment({ author_id: author, status: 'held' });
    const res = await withDbFault({ table: 'public_profiles', op: 'select' }, {}, () =>
      callAction(moderateComment, { comment_id: id, action: 'approve' }, { role: 'mod' }),
    );
    expectInternal(res, 'moderateComment', logs);
    expect((await storedComment(id)).status).toBe('published');
    expect(await eventsFor(id)).toEqual([]);
    expect(adminLines()).toEqual([]);
  });
});
