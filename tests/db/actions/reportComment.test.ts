/**
 * tests/db/actions/reportComment.test.ts — T-ACT-21 / T-ACT-22 (05 §7.2; 04 §1.2 `reportComment`;
 * §5.1 M6–M8; §5.5 `report`; T-UNIT-7 `shouldAutoHold`; ADR-0002 #69 / A4; ADR-0028 D2).
 *
 * A report is one row per (comment, reporter): a repeat by the same reporter is `ok:true` with
 * the current `report_count` and writes nothing (no second row, no second event — 00 S1.4.AC9).
 * Every accepted report writes `comment.reported`; the third unresolved report on a PUBLISHED
 * comment by a `user` auto-holds it (`moderated_by NULL`, `comment.held` with `reason='reports'`,
 * `project:<slug>` revalidated — M6); staff comments never auto-hold (M7); held / hidden comments
 * accept reports with no status change (M8). 10 / h on `rate_limit_hits`. No revalidation on a
 * plain report.
 *
 * T-ACT-21 runs on factory comments (their report rows cascade away with the comment or the
 * factory reporter). T-ACT-22 is `mutatesSeed`: …0201 is auto-held and restored to published with
 * `moderated_by/at` NULL; the moderator's report on …0204 is removed; reports by factory users
 * cascade with `cleanupFactories`; `notification_events` is emptied.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reportComment } from '@/lib/actions/comments';
import type { ReportCommentInput } from '@/lib/actions/comments.schema';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { codePointLength } from '@/lib/validation/comment';
import { clearRateLimitHitsFor, countRateLimitHits } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole } from '@/tests/helpers/asRole';
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
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';
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
const NO_PII = /email|google|picture|given_name|family_name|full_name/i;

type EventRow = {
  kind: string;
  actor_id: string | null;
  subject_type: string;
  payload: Record<string, unknown>;
};

async function eventsFor(subjectId: string): Promise<EventRow[]> {
  const { data, error } = await service
    .from('notification_events')
    .select('kind, actor_id, subject_type, payload')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`service could not read notification_events: ${error.message}`);
  return data.map((row) => ({ ...row, payload: row.payload as Record<string, unknown> }));
}

async function kinds(subjectId: string): Promise<string[]> {
  return (await eventsFor(subjectId)).map((event) => event.kind);
}

async function storedComment(id: string) {
  const { data, error } = await service
    .from('comments')
    .select('id, status, moderated_by, moderated_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(`service could not read comments: ${error.message}`);
  return data;
}

async function reportRows(commentId: string) {
  const { data, error } = await service
    .from('comment_reports')
    .select('reporter_id, reason, note, resolved_at')
    .eq('comment_id', commentId);
  if (error) throw new Error(`service could not read comment_reports: ${error.message}`);
  return data;
}

/** A published factory comment by a fresh factory `user` (the M6 author shape). */
async function victimComment(): Promise<string> {
  const author = await makeUser({ comment_count: 1 });
  return makeComment({ author_id: author });
}

async function reportAs(profileId: string, input: ReportCommentInput) {
  return callActionAs(reportComment, input, { profileId });
}

beforeAll(async () => {
  await clearRateLimitHitsFor(['report'], SEED_ACTORS);
});

beforeEach(() => {
  tags.calls.length = 0;
});

afterAll(async () => {
  // …0201 back to its SEED-9 shape; the moderator's M8 report on …0204 removed (the seed report stays).
  const { error } = await service
    .from('comments')
    .update({ status: 'published', moderated_by: null, moderated_at: null })
    .eq('id', SEED_COMMENTS.published);
  if (error) throw new Error(`restore: comments update failed: ${error.message}`);
  const reports = await service
    .from('comment_reports')
    .delete()
    .in('comment_id', [SEED_COMMENTS.published, SEED_COMMENTS.creatorReply, SEED_COMMENTS.hidden])
    .neq('reporter_id', SEED_USERS.seed_user);
  if (reports.error)
    throw new Error(`restore: comment_reports delete failed: ${reports.error.message}`);
  await purgeNotificationEvents();
  await clearRateLimitHitsFor(['report'], SEED_ACTORS);
  await cleanupFactories();
  await restoreSeedCommentCounts();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-21 — auth, validation, idempotent duplicate, comment.reported, rate limit, no revalidation
// ---------------------------------------------------------------------------------------------
describe('T-ACT-21 reportComment', () => {
  it('T-ACT-21 anon → unauthenticated', async () => {
    const id = await victimComment();
    expectFail(
      await callAction(reportComment, { comment_id: id, reason: 'spam' }, { role: 'anon' }),
      'unauthenticated',
    );
    expect(await reportRows(id)).toEqual([]);
  });

  it('T-ACT-21 banned → banned, no row, no hit', async () => {
    const id = await victimComment();
    expectFail(
      await callAction(reportComment, { comment_id: id, reason: 'spam' }, { role: 'banned' }),
      'banned',
    );
    expect(await reportRows(id)).toEqual([]);
    expect(await countRateLimitHits('report', SEED_USERS.seed_banned)).toBe(0);
  });

  it.each(['user', 'mod', 'admin'] as const)(
    'T-ACT-21 %s → ok {report_count: 1}, one comment_reports row, one comment.reported event, no revalidation',
    async (role) => {
      const id = await victimComment();
      const data = expectOk(
        await callAction(
          reportComment,
          { comment_id: id, reason: 'rude', note: 'said a mean thing' },
          { role },
        ),
      );
      expect(data).toEqual({ report_count: 1 });
      const rows = await reportRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        reason: 'rude',
        note: 'said a mean thing',
        resolved_at: null,
      });
      expect(await kinds(id)).toEqual(['comment.reported']);
      expect(tags.calls).toEqual([]);
    },
  );

  it('T-ACT-21 comment.reported payload: comment_id, report_count, reason, excerpt(140), target…, author — no PII', async () => {
    const author = await makeUser({ comment_count: 1 });
    // Stored bodies are plain text (B4 — postComment strips tags); a 300-character one proves the cut.
    const id = await makeComment({ author_id: author, body: 'x'.repeat(300) });
    const reporter = await makeUser({ comment_count: 1 });
    expectOk(await reportAs(reporter, { comment_id: id, reason: 'other', note: 'long one' }));
    const [event] = await eventsFor(id);
    expect(event?.kind).toBe('comment.reported');
    expect(event?.subject_type).toBe('comment');
    expect(event?.actor_id).toBe(reporter);
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual([
      'author',
      'comment_id',
      'excerpt',
      'reason',
      'report_count',
      'target_id',
      'target_slug',
      'target_title',
      'target_type',
    ]);
    expect(event?.payload).toMatchObject({
      comment_id: id,
      report_count: 1,
      reason: 'other',
      target_type: 'project',
      target_id: SEED_PROJECTS.pixelChameleon,
      target_slug: 'pixel-chameleon',
      target_title: 'Pixel Chameleon',
      author: { profile_id: author },
    });
    const excerpt = String(event?.payload.excerpt);
    expect(codePointLength(excerpt)).toBeLessThanOrEqual(140);
    expect(excerpt).not.toMatch(/<[^>]*>/);
    expect(JSON.stringify(event)).not.toMatch(NO_PII);
  });

  it('T-ACT-21 duplicate by the same reporter → ok {report_count} no-op: no second row, no second event', async () => {
    const id = await victimComment();
    const reporter = await makeUser({ comment_count: 1 });
    expectOk(await reportAs(reporter, { comment_id: id, reason: 'spam' }));
    const again = expectOk(
      await reportAs(reporter, { comment_id: id, reason: 'rude', note: 'changed my mind' }),
    );
    expect(again).toEqual({ report_count: 1 });
    const rows = await reportRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('spam');
    expect(await kinds(id)).toEqual(['comment.reported']);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-21 reason outside spam|rude|other → validation', async () => {
    const id = await victimComment();
    const error = expectFail(
      await callAction(
        reportComment,
        { comment_id: id, reason: 'meh' } as unknown as ReportCommentInput,
        { role: 'user' },
      ),
      'validation',
    );
    expect(error.issues?.[0]?.path).toBe('reason');
    expect(await reportRows(id)).toEqual([]);
  });

  it('T-ACT-21 note over 300 characters → validation; exactly 300 → ok', async () => {
    const id = await victimComment();
    const error = expectFail(
      await callAction(
        reportComment,
        { comment_id: id, reason: 'other', note: 'n'.repeat(301) },
        { role: 'user' },
      ),
      'validation',
    );
    expect(error.issues?.[0]?.path).toBe('note');
    expectOk(
      await callAction(
        reportComment,
        { comment_id: id, reason: 'other', note: 'n'.repeat(300) },
        { role: 'user' },
      ),
    );
  });

  it('T-ACT-21 reporting own comment → validation "You can\'t report your own comment."', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user });
    const error = expectFail(
      await callAction(reportComment, { comment_id: id, reason: 'spam' }, { role: 'user' }),
      'validation',
    );
    expect(error.message).toBe("You can't report your own comment.");
    expect(error.field).toBe('comment_id');
    expect(await reportRows(id)).toEqual([]);
  });

  it('T-ACT-21 deleted / unknown comment, or a comment on a hidden target → not_found', async () => {
    const deleted = await makeComment({ author_id: SEED_USERS.seed_user2, status: 'deleted' });
    expectFail(
      await callAction(reportComment, { comment_id: deleted, reason: 'spam' }, { role: 'user' }),
      'not_found',
    );
    expectFail(
      await callAction(
        reportComment,
        { comment_id: randomUUID(), reason: 'spam' },
        { role: 'user' },
      ),
      'not_found',
    );
    const projectId = await makeProject({ status: 'published' });
    const { error } = await service
      .from('project_overrides')
      .insert({ project_id: projectId, hidden: true });
    expect(error).toBeNull();
    const onHidden = await makeComment({ target_id: projectId, author_id: SEED_USERS.seed_user2 });
    expectFail(
      await callAction(reportComment, { comment_id: onHidden, reason: 'spam' }, { role: 'user' }),
      'not_found',
    );
    expectFail(
      await callAction(reportComment, { comment_id: 'nope', reason: 'spam' }, { role: 'user' }),
      'validation',
    );
  });

  it('T-ACT-21 the 11th report in an hour → rate_limited (rate_limit_hits only)', async () => {
    const id = await victimComment();
    const reporter = await makeUser({ comment_count: 1 });
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 10 }, () => ({ scope: 'report', key: reporter })));
    expect(error).toBeNull();
    const limited = expectFail(
      await reportAs(reporter, { comment_id: id, reason: 'spam' }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect(await countRateLimitHits('report', reporter)).toBe(11);
    expect(await reportRows(id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-22 — auto-hold (M6), staff exemption (M7), reports on a hidden comment (M8) — mutatesSeed
// ---------------------------------------------------------------------------------------------
describe('T-ACT-22 reportComment auto-hold (mutatesSeed)', () => {
  it('T-ACT-22 M6: 2 reports keep …0201 published; the 3rd distinct report holds it (moderated_by NULL, comment.held reason=reports, tag revalidated); a 4th is accepted with no second hold', async () => {
    const reporters = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const target = SEED_COMMENTS.published;
    await clearRateLimitHitsFor(['report'], [SEED_USERS.seed_mod]);

    expectOk(await reportAs(reporters[0], { comment_id: target, reason: 'spam' }));
    const two = expectOk(await reportAs(reporters[1], { comment_id: target, reason: 'rude' }));
    expect(two).toEqual({ report_count: 2 });
    expect((await storedComment(target)).status).toBe('published');
    expect(await kinds(target)).toEqual(['comment.reported', 'comment.reported']);
    expect(tags.calls).toEqual([]);

    const three = expectOk(await reportAs(reporters[2], { comment_id: target, reason: 'other' }));
    expect(three).toEqual({ report_count: 3 });
    const held = await storedComment(target);
    expect(held.status).toBe('held');
    expect(held.moderated_by).toBeNull();
    expect(held.moderated_at).not.toBeNull();
    const events = await eventsFor(target);
    expect(events.map((event) => event.kind)).toEqual([
      'comment.reported',
      'comment.reported',
      'comment.held',
      'comment.reported',
    ]);
    const hold = events.find((event) => event.kind === 'comment.held');
    expect(hold?.payload).toMatchObject({ comment_id: target, reason: 'reports', report_count: 3 });
    expect(tags.calls).toEqual([PIXEL_TAG]);

    // A held comment is invisible to plain users (T-RLS-65) — their report answers not_found, the
    // same as the UI they no longer see it in; the 4th report comes from a moderator (M8).
    tags.calls.length = 0;
    expectFail(await reportAs(reporters[3], { comment_id: target, reason: 'spam' }), 'not_found');
    const four = expectOk(
      await callAction(reportComment, { comment_id: target, reason: 'spam' }, { role: 'mod' }),
    );
    expect(four).toEqual({ report_count: 4 });
    expect((await storedComment(target)).status).toBe('held');
    expect((await kinds(target)).filter((kind) => kind === 'comment.held')).toHaveLength(1);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-22 M7: 3 reports on …0202 (admin author) → stays published, 3 × comment.reported, no comment.held', async () => {
    const reporters = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const target = SEED_COMMENTS.creatorReply;
    for (const [index, reporter] of reporters.entries()) {
      const data = expectOk(await reportAs(reporter, { comment_id: target, reason: 'spam' }));
      expect(data).toEqual({ report_count: index + 1 });
    }
    const row = await storedComment(target);
    expect(row.status).toBe('published');
    expect(row.moderated_by).toBeNull();
    expect(await kinds(target)).toEqual([
      'comment.reported',
      'comment.reported',
      'comment.reported',
    ]);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-22 M8: a moderator reports the hidden …0204 → accepted, status unchanged, comment.reported written', async () => {
    const target = SEED_COMMENTS.hidden;
    const data = expectOk(
      await callAction(reportComment, { comment_id: target, reason: 'spam' }, { role: 'mod' }),
    );
    // The seed report by seed_user is unresolved too.
    expect(data).toEqual({ report_count: 2 });
    const row = await storedComment(target);
    expect(row.status).toBe('hidden');
    expect(row.moderated_by).toBe(SEED_USERS.oddsense);
    expect(await kinds(target)).toEqual(['comment.reported']);
    expect(tags.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-21/22 — edge states (a moderator on a hidden target, an author-less comment, the
// comments-closed and hide-mid-flight races) + DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-21 reportComment edge states + DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  async function arrangeReports(commentId: string, reporters: string[]): Promise<void> {
    for (const reporter_id of reporters) {
      const { error } = await service
        .from('comment_reports')
        .insert({ comment_id: commentId, reporter_id, reason: 'spam' });
      if (error) throw new Error(`arrange: comment_reports insert failed: ${error.message}`);
    }
  }

  it('T-ACT-21 a moderator reporting a comment on a hidden target → not_found (mods read the row; the target is invisible)', async () => {
    const projectId = await makeProject();
    const { error } = await service
      .from('project_overrides')
      .insert({ project_id: projectId, hidden: true });
    expect(error).toBeNull();
    const id = await makeComment({ target_id: projectId, author_id: SEED_USERS.seed_user2 });
    expectFail(
      await callAction(reportComment, { comment_id: id, reason: 'spam' }, { role: 'mod' }),
      'not_found',
    );
    expect(await reportRows(id)).toEqual([]);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-22 M6 on an author-less comment (account deleted): the 3rd report holds it; author null in comment.held and comment.reported', async () => {
    const id = await victimComment();
    const { error } = await service.from('comments').update({ author_id: null }).eq('id', id);
    expect(error).toBeNull();
    await arrangeReports(id, [SEED_USERS.seed_user2, SEED_USERS.seed_mod]);
    const reporter = await makeUser({ comment_count: 1 });

    const data = expectOk(await reportAs(reporter, { comment_id: id, reason: 'rude' }));
    expect(data).toEqual({ report_count: 3 });
    expect((await storedComment(id)).status).toBe('held');
    const events = await eventsFor(id);
    expect(events.map((event) => event.kind).sort()).toEqual(['comment.held', 'comment.reported']);
    for (const event of events) expect(event.payload.author).toBeNull();
    expect(tags.calls).toEqual([PIXEL_TAG]);
  });

  it('T-ACT-22 a moderator hides the comment between the report insert and the auto-hold → no comment.held, comment.reported still written', async () => {
    const id = await victimComment();
    await arrangeReports(id, [SEED_USERS.seed_user2, SEED_USERS.seed_mod]);
    const reporter = await makeUser({ comment_count: 1 });

    const data = expectOk(
      await withDbHook(
        { table: 'comment_reports', op: 'insert' },
        async () => {
          const { error } = await service
            .from('comments')
            .update({ status: 'hidden', moderated_by: SEED_USERS.seed_mod })
            .eq('id', id);
          if (error) throw new Error(`hook: comments update failed: ${error.message}`);
        },
        () => reportAs(reporter, { comment_id: id, reason: 'rude' }),
        { when: 'after' },
      ),
    );
    expect(data).toEqual({ report_count: 3 });
    expect((await storedComment(id)).status).toBe('hidden');
    expect(await kinds(id)).toEqual(['comment.reported']);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-21 comments closed between the checks and the write → not_found (the insert policy answers 42501), no row', async () => {
    const projectId = await makeProject();
    const id = await makeComment({ target_id: projectId, author_id: SEED_USERS.seed_user2 });
    const reporter = await makeUser({ comment_count: 1 });
    const res = await withDbHook(
      { rpc: 'rate_limit_ok' },
      async () => {
        const { error } = await service
          .from('project_overrides')
          .insert({ project_id: projectId, comments_enabled: false });
        if (error) throw new Error(`hook: project_overrides insert failed: ${error.message}`);
      },
      () => reportAs(reporter, { comment_id: id, reason: 'spam' }),
    );
    expectFail(res, 'not_found');
    expect(await reportRows(id)).toEqual([]);
    expect(await kinds(id)).toEqual([]);
  });

  it('T-ACT-21 a count-less answer from comment_reports reads as 0 reports', async () => {
    const id = await victimComment();
    const reporter = await makeUser({ comment_count: 1 });
    const data = expectOk(
      await withDbFault(
        { table: 'comment_reports', op: 'select' },
        { result: { data: null, error: null, count: null } },
        () => reportAs(reporter, { comment_id: id, reason: 'spam' }),
      ),
    );
    expect(data).toEqual({ report_count: 0 });
    expect(await reportRows(id)).toHaveLength(1);
  });

  it.each<{ name: string; target: DbCallTarget; priorReports: number; rows: number }>([
    {
      name: 'the report insert',
      target: { table: 'comment_reports', op: 'insert' },
      priorReports: 0,
      rows: 0,
    },
    {
      name: 'the report count (after the row landed)',
      target: { table: 'comment_reports', op: 'select' },
      priorReports: 0,
      rows: 1,
    },
    {
      name: 'the auto-hold status write (3rd report)',
      target: { table: 'comments', op: 'update' },
      priorReports: 2,
      rows: 3,
    },
  ])(
    'T-ACT-21 $name fails → internal + one log.error line, no event, no revalidate',
    async ({ target, priorReports, rows }) => {
      const id = await victimComment();
      await arrangeReports(id, [SEED_USERS.seed_user2, SEED_USERS.seed_mod].slice(0, priorReports));
      const reporter = await makeUser({ comment_count: 1 });
      const res = await withDbFault(target, {}, () =>
        reportAs(reporter, { comment_id: id, reason: 'spam' }),
      );
      expectInternal(res, 'reportComment', logs);
      expect(await reportRows(id)).toHaveLength(rows);
      expect(await kinds(id)).toEqual([]);
      expect((await storedComment(id)).status).toBe('published');
      expect(tags.calls).toEqual([]);
    },
  );
});
