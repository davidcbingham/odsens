/**
 * tests/db/actions/postComment.test.ts — T-ACT-11..16 (05 §7.2; 04 §1.2 `postComment`; §5.1 M1–M5;
 * §5.5 `comment` / `comment_day`; ADR-0002 #72 / A3 / A4 / C21; ADR-0028 D5).
 *
 * Auth matrix (05 §7.2 Comments columns anon | user | user0 | banned | mod | admin): anon
 * `unauthenticated` · user A · user0 A · banned D `banned` (SC-05, before anything is written) ·
 * mod A · admin A. Validation is the B1–B6 table (strip → trim → 1..1000 code points → ≤ 1 link);
 * preconditions answer `not_found` (unknown / draft / hidden target) and `comments_closed`
 * (override off, or the site default with no override — `mutatesSeed`). Rate limits count ONLY
 * `rate_limit_hits` (ADR-0002 A4) — the limiter runs right before the insert, after the
 * preconditions, so a refused post records no hit and hits are cleared between loops. Moderation
 * runs under `hold_first_time` (`mutatesSeed`, restored to `auto`) and the "as stored" case makes
 * the action-side `decideCommentStatus` lie (module mock) to prove the trigger's status wins.
 *
 * Every comment an action creates is adopted by `trackComment` and removed with the factory rows;
 * seed actors (seed_user / seed_user2 / seed_mod / oddsense) get their `comment_count` and
 * `rate_limit_hits` restored, and `notification_events` is emptied again (SEED-12).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postComment } from '@/lib/actions/comments';
import type { PostCommentInput } from '@/lib/actions/comments.schema';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import {
  codePointLength,
  LINE_COMMENTS_CLOSED,
  LINE_TOO_MANY_LINKS,
} from '@/lib/validation/comment';
import { decideCommentStatus } from '@/lib/validation/moderation';
import {
  clearRateLimitHitsFor,
  countRateLimitHits,
  patchProfile,
  readProfile,
} from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import {
  callAction,
  callActionAs,
  setupActionMocks,
  type ActionRole,
} from '@/tests/helpers/callAction';
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
  trackComment,
} from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

vi.mock('@/lib/validation/moderation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validation/moderation')>();
  return { ...actual, decideCommentStatus: vi.fn(actual.decideCommentStatus) };
});

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const TARGET = { target_type: 'project', target_id: SEED_PROJECTS.pixelChameleon } as const;
const PIXEL_TAG = 'project:pixel-chameleon';
const COMMENT_SCOPES = ['comment', 'comment_day'] as const;
const SEED_ACTORS = [
  SEED_USERS.seed_user,
  SEED_USERS.seed_user2,
  SEED_USERS.seed_mod,
  SEED_USERS.oddsense,
  SEED_USERS.seed_banned,
];

type EventRow = {
  id: string;
  kind: string;
  actor_id: string | null;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
};

async function eventsFor(subjectId: string): Promise<EventRow[]> {
  const { data, error } = await service
    .from('notification_events')
    .select('id, kind, actor_id, subject_type, subject_id, payload')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`service could not read notification_events: ${error.message}`);
  return data.map((row) => ({ ...row, payload: row.payload as Record<string, unknown> }));
}

async function storedComment(id: string) {
  const { data, error } = await service
    .from('comments')
    .select(
      'id, target_id, author_id, parent_id, body, status, like_count, edited_at, moderated_by',
    )
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

async function setModerationMode(mode: 'auto' | 'hold_first_time'): Promise<void> {
  const { error } = await service
    .from('site_settings')
    .update({ moderation_mode: mode })
    .eq('id', 1);
  if (error) throw new Error(`arrange: site_settings update failed: ${error.message}`);
}

async function setClosedDefault(value: boolean): Promise<void> {
  const { error } = await service
    .from('site_settings')
    .update({ comments_closed_default: value })
    .eq('id', 1);
  if (error) throw new Error(`arrange: site_settings update failed: ${error.message}`);
}

/** An override row on a factory project (cascades with the project in cleanup). */
async function arrangeOverride(row: {
  project_id: string;
  hidden?: boolean;
  comments_enabled?: boolean;
}): Promise<void> {
  const { error } = await service.from('project_overrides').insert(row);
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
}

/** Posts as a factory user and adopts the row for cleanup. */
async function postAs(profileId: string, input: PostCommentInput) {
  const res = await callActionAs(postComment, input, { profileId });
  if (res.ok) trackComment(res.data.comment.id);
  return res;
}

/** Posts as a seed role and adopts the row for cleanup. */
async function postRole(role: ActionRole, input: PostCommentInput) {
  const res = await callAction(postComment, input, { role });
  if (res.ok) trackComment(res.data.comment.id);
  return res;
}

const NO_PII = /email|google|picture|given_name|family_name|full_name/i;

beforeAll(async () => {
  await clearRateLimitHitsFor(COMMENT_SCOPES, SEED_ACTORS);
});

afterAll(async () => {
  await setModerationMode('auto');
  await setClosedDefault(false);
  await purgeNotificationEvents();
  await clearRateLimitHitsFor(COMMENT_SCOPES, SEED_ACTORS);
  await cleanupFactories();
  await restoreSeedCommentCounts();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-11 — auth matrix (valid body, seed project …0102)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-11 postComment auth matrix', () => {
  const input: PostCommentInput = { ...TARGET, body: 'T-ACT-11 hello from the matrix' };

  it('T-ACT-11 anon → unauthenticated', async () => {
    const error = expectFail(await postRole('anon', input), 'unauthenticated');
    expect(error.message).toBe('Sign in first.');
  });

  it('T-ACT-11 nohandle → onboarding_required', async () => {
    expectFail(await postRole('nohandle', input), 'onboarding_required');
  });

  it('T-ACT-11 banned → banned, nothing written, no hit', async () => {
    expectFail(await postRole('banned', input), 'banned');
    const { data } = await service
      .from('comments')
      .select('id')
      .eq('author_id', SEED_USERS.seed_banned)
      .eq('body', input.body);
    expect(data).toEqual([]);
    expect(await countRateLimitHits('comment', SEED_USERS.seed_banned)).toBe(0);
  });

  it.each(['user', 'user0', 'mod', 'admin'] as const)('T-ACT-11 %s → ok', async (role) => {
    const data = expectOk(await postRole(role, input));
    expect(data.comment.author?.id).toBe(SEED_ROLE_IDS[role]);
    expect(data.comment.status).toBe('published');
    expect((await storedComment(data.comment.id)).author_id).toBe(SEED_ROLE_IDS[role]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-12 — validation (04 B1–B6) + preconditions
// ---------------------------------------------------------------------------------------------
describe('T-ACT-12 postComment validation', () => {
  let author: string;
  let plainProjectId: string;
  let openProjectId: string;
  let draftProjectId: string;
  let hiddenProjectId: string;

  beforeAll(async () => {
    author = await makeUser({ comment_count: 1 });
    plainProjectId = await makeProject({ status: 'published' });
    openProjectId = await makeProject({ status: 'published' });
    draftProjectId = await makeProject({ source: 'odsens', status: 'draft' });
    hiddenProjectId = await makeProject({ status: 'published' });
    await arrangeOverride({ project_id: openProjectId, comments_enabled: true });
    await arrangeOverride({ project_id: hiddenProjectId, hidden: true });
  });

  beforeEach(async () => {
    await clearRateLimitHitsFor(COMMENT_SCOPES, [author]);
  });

  afterAll(async () => {
    await setClosedDefault(false);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n\t '],
    ['tags only (strips to nothing)', '<b></b><script></script>'],
  ])('T-ACT-12 %s body → validation', async (_label, body) => {
    const error = expectFail(await postAs(author, { ...TARGET, body }), 'validation');
    expect(error.issues?.[0]?.path).toBe('body');
  });

  it('T-ACT-12 1000 code points → ok; 1001 → validation (B2 counts code points, not bytes)', async () => {
    const thousand = `${'a'.repeat(999)}\u{1F600}`;
    expect(codePointLength(thousand)).toBe(1000);
    const data = expectOk(await postAs(author, { ...TARGET, body: thousand }));
    expect(codePointLength(data.comment.body)).toBe(1000);
    expectFail(await postAs(author, { ...TARGET, body: `${thousand}b` }), 'validation');
  });

  it('T-ACT-12 one link → ok', async () => {
    const data = expectOk(
      await postAs(author, { ...TARGET, body: 'look https://modrinth.com/mod/pixel-chameleon' }),
    );
    expect(data.comment.body).toContain('https://modrinth.com/mod/pixel-chameleon');
  });

  it.each([
    ['http + https', 'http://a.example and https://b.example'],
    ['two www', 'www.a.example www.b.example'],
    ['https + www', 'https://a.example, also www.b.example'],
  ])('T-ACT-12 two links (%s) → too_many_links', async (_label, body) => {
    const error = expectFail(await postAs(author, { ...TARGET, body }), 'too_many_links');
    expect(error.message).toBe(LINE_TOO_MANY_LINKS);
    expect(error.field).toBe('body');
  });

  it('T-ACT-12 HTML is stripped: <b>x</b><script> → stored "x"', async () => {
    const data = expectOk(await postAs(author, { ...TARGET, body: '<b>x</b><script>' }));
    expect(data.comment.body).toBe('x');
    expect((await storedComment(data.comment.id)).body).toBe('x');
  });

  it('T-ACT-12 unknown target_id → not_found', async () => {
    expectFail(
      await postAs(author, { target_type: 'project', target_id: randomUUID(), body: 'hi' }),
      'not_found',
    );
  });

  it('T-ACT-12 target_type outside the v1 enum → validation (ADR-0002 C21)', async () => {
    const error = expectFail(
      await postAs(author, {
        target_type: 'skin',
        target_id: SEED_PROJECTS.pixelChameleon,
        body: 'hi',
      } as unknown as PostCommentInput),
      'validation',
    );
    expect(error.issues?.[0]?.path).toBe('target_type');
  });

  it('T-ACT-12 malformed ids → validation before any DB call', async () => {
    expectFail(
      await postAs(author, { target_type: 'project', target_id: 'nope', body: 'hi' }),
      'validation',
    );
    expectFail(await postAs(author, { ...TARGET, body: 'hi', parent_id: 'nope' }), 'validation');
  });

  it('T-ACT-12 target with comments_enabled=false (…0103) → comments_closed', async () => {
    const error = expectFail(
      await postAs(author, {
        target_type: 'project',
        target_id: SEED_PROJECTS.seedExclusivePack,
        body: 'hi',
      }),
      'comments_closed',
    );
    expect(error.message).toBe(LINE_COMMENTS_CLOSED);
  });

  it('T-ACT-12 site comments_closed_default=true: no override → comments_closed, override comments_enabled=true → ok (mutatesSeed)', async () => {
    await setClosedDefault(true);
    try {
      expectFail(
        await postAs(author, { target_type: 'project', target_id: plainProjectId, body: 'hi' }),
        'comments_closed',
      );
      expectOk(
        await postAs(author, { target_type: 'project', target_id: openProjectId, body: 'hi' }),
      );
    } finally {
      await setClosedDefault(false);
    }
    expectOk(
      await postAs(author, { target_type: 'project', target_id: plainProjectId, body: 'hi again' }),
    );
  });

  it.each([
    ['draft', () => draftProjectId],
    ['hidden', () => hiddenProjectId],
  ])('T-ACT-12 %s target → not_found (never distinguishes draft from absent)', async (_k, id) => {
    expectFail(
      await postAs(author, { target_type: 'project', target_id: id(), body: 'hi' }),
      'not_found',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-13 — rate limit: 5 / min and 50 / 24 h per user, counted on rate_limit_hits only
// ---------------------------------------------------------------------------------------------
describe('T-ACT-13 postComment rate limit', () => {
  it('T-ACT-13 the 6th comment inside 60 s → rate_limited; hits recorded per scope, per call', async () => {
    const id = await makeUser({ comment_count: 1 });
    for (let n = 1; n <= 5; n += 1) {
      expectOk(await postAs(id, { ...TARGET, body: `T-ACT-13 post ${String(n)}` }));
    }
    const limited = expectFail(
      await postAs(id, { ...TARGET, body: 'T-ACT-13 post 6' }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    // The refusing scope records its hit; `comment_day` is never reached on the refused call.
    expect(await countRateLimitHits('comment', id)).toBe(6);
    expect(await countRateLimitHits('comment_day', id)).toBe(5);
    const { count } = await service
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('author_id', id);
    expect(count).toBe(5);

    // Per user, not per target: another project is refused just the same.
    expectFail(
      await postAs(id, {
        target_type: 'project',
        target_id: SEED_PROJECTS.metalPipeMace,
        body: 'x',
      }),
      'rate_limited',
    );
    expect(await countRateLimitHits('comment', id)).toBe(7);
  });

  it('T-ACT-13 the 51st comment inside 24 h → rate_limited (comment_day)', async () => {
    const id = await makeUser({ comment_count: 1 });
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 50 }, () => ({ scope: 'comment_day', key: id })));
    expect(error).toBeNull();
    expectFail(await postAs(id, { ...TARGET, body: 'T-ACT-13 day 51' }), 'rate_limited');
    expect(await countRateLimitHits('comment', id)).toBe(1);
    expect(await countRateLimitHits('comment_day', id)).toBe(51);
    const { count } = await service
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('author_id', id);
    expect(count).toBe(0);
  });

  it('T-ACT-13 the verdict counts rate_limit_hits, not comments (ADR-0002 A4)', async () => {
    const id = await makeUser({ comment_count: 1 });
    for (let n = 0; n < 6; n += 1) await makeComment({ author_id: id });
    expect(await countRateLimitHits('comment', id)).toBe(0);
    expectOk(await postAs(id, { ...TARGET, body: 'T-ACT-13 seventh row, first hit' }));
  });

  it('T-ACT-13 a post refused by a precondition records no hit', async () => {
    const id = await makeUser({ comment_count: 1 });
    expectFail(
      await postAs(id, {
        target_type: 'project',
        target_id: SEED_PROJECTS.seedExclusivePack,
        body: 'x',
      }),
      'comments_closed',
    );
    expect(await countRateLimitHits('comment', id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-14 — moderation (04 §5.1 M2–M5), status returned AS STORED (ADR-0002 #72)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-14 postComment moderation', () => {
  afterAll(async () => {
    await setModerationMode('auto');
  });

  it('T-ACT-14 auto → published for user0 (seed_user2, comment_count 0)', async () => {
    await setModerationMode('auto');
    await patchProfile(SEED_USERS.seed_user2, { comment_count: 0 });
    const data = expectOk(await postRole('user0', { ...TARGET, body: 'T-ACT-14 auto' }));
    expect(data.comment.status).toBe('published');
    expect(await commentCount(SEED_USERS.seed_user2)).toBe(1);
  });

  it('T-ACT-14 hold_first_time + comment_count 0 → held; posting again while held → held again (mutatesSeed)', async () => {
    await setModerationMode('hold_first_time');
    const id = await makeUser();
    const first = expectOk(await postAs(id, { ...TARGET, body: 'T-ACT-14 first' }));
    expect(first.comment.status).toBe('held');
    expect((await storedComment(first.comment.id)).status).toBe('held');
    expect(await commentCount(id)).toBe(0);
    const second = expectOk(await postAs(id, { ...TARGET, body: 'T-ACT-14 second' }));
    expect(second.comment.status).toBe('held');
  });

  it('T-ACT-14 hold_first_time + comment_count > 0 → published (M5)', async () => {
    await setModerationMode('hold_first_time');
    const id = await makeUser({ comment_count: 3 });
    const data = expectOk(await postAs(id, { ...TARGET, body: 'T-ACT-14 regular' }));
    expect(data.comment.status).toBe('published');
    expect(await commentCount(id)).toBe(4);
  });

  it.each(['moderator', 'admin'] as const)(
    'T-ACT-14 a first-time %s under hold_first_time → published (M2)',
    async (role) => {
      await setModerationMode('hold_first_time');
      const id = await makeUser({ role });
      const data = expectOk(await postAs(id, { ...TARGET, body: `T-ACT-14 ${role}` }));
      expect(data.comment.status).toBe('published');
    },
  );

  it('T-ACT-14 the action returns the row AS STORED: the trigger wins over a lying decideCommentStatus', async () => {
    await setModerationMode('hold_first_time');
    const id = await makeUser();
    const decide = vi.mocked(decideCommentStatus);
    decide.mockClear();
    decide.mockReturnValueOnce('published');
    try {
      const data = expectOk(await postAs(id, { ...TARGET, body: 'T-ACT-14 as stored' }));
      expect(decide).toHaveBeenCalledTimes(1);
      const stored = await storedComment(data.comment.id);
      expect(stored.status).toBe('held');
      expect(data.comment.status).toBe(stored.status);
      // The event follows the stored status too.
      expect((await eventsFor(data.comment.id)).map((event) => event.kind)).toEqual([
        'comment.held',
      ]);
    } finally {
      decide.mockClear();
    }
    // The mock is one-shot: the next call runs the real rule again.
    const again = expectOk(await postAs(id, { ...TARGET, body: 'T-ACT-14 real rule' }));
    expect(again.comment.status).toBe('held');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-15 — side effects: row, comment_count, notification_events, CommentView, revalidateTag
// ---------------------------------------------------------------------------------------------
describe('T-ACT-15 postComment side effects', () => {
  const PAYLOAD_KEYS = [
    'author',
    'comment_id',
    'excerpt',
    'first_time',
    'target_id',
    'target_slug',
    'target_title',
    'target_type',
  ];

  afterAll(async () => {
    await setModerationMode('auto');
  });

  it('T-ACT-15 published: author = session user, comment_count +1, comment.new event, CommentView, one revalidateTag', async () => {
    await setModerationMode('auto');
    const id = await makeUser();
    const handle = (await readProfile(id))?.handle;
    const longBody = `<i>${'x'.repeat(200)}</i> <a href="https://evil.example">y</a>`;
    tags.calls.length = 0;

    const data = expectOk(await postAs(id, { ...TARGET, body: longBody }));
    const stored = await storedComment(data.comment.id);
    expect(stored.author_id).toBe(id);
    expect(stored.status).toBe('published');
    expect(stored.body).toBe(`${'x'.repeat(200)} y`);
    expect(await commentCount(id)).toBe(1);

    expect(data.comment).toEqual({
      id: stored.id,
      body: stored.body,
      status: 'published',
      createdAt: expect.any(String),
      editedAt: null,
      parentId: null,
      likeCount: 0,
      likedByViewer: false,
      author: { id, handle, avatarUrl: null, role: 'user' },
    });

    const events = await eventsFor(stored.id);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.kind).toBe('comment.new');
    expect(event?.subject_type).toBe('comment');
    expect(event?.subject_id).toBe(stored.id);
    expect(event?.actor_id).toBe(id);
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual(PAYLOAD_KEYS);
    expect(event?.payload).toMatchObject({
      comment_id: stored.id,
      target_type: 'project',
      target_id: SEED_PROJECTS.pixelChameleon,
      target_title: 'Pixel Chameleon',
      target_slug: 'pixel-chameleon',
      author: { profile_id: id, handle },
      first_time: true,
    });
    const excerpt = String(event?.payload.excerpt);
    expect(codePointLength(excerpt)).toBeLessThanOrEqual(140);
    expect(excerpt).not.toMatch(/<[^>]*>/);
    expect(JSON.stringify(event)).not.toMatch(NO_PII);

    expect(tags.calls).toEqual([PIXEL_TAG]);
  });

  it('T-ACT-15 held: comment_count unchanged, comment.held event with reason first_time', async () => {
    await setModerationMode('hold_first_time');
    const id = await makeUser();
    tags.calls.length = 0;
    const data = expectOk(await postAs(id, { ...TARGET, body: 'T-ACT-15 held' }));
    expect(data.comment.status).toBe('held');
    expect(await commentCount(id)).toBe(0);
    const events = await eventsFor(data.comment.id);
    expect(events.map((event) => event.kind)).toEqual(['comment.held']);
    expect(events[0]?.payload).toMatchObject({ reason: 'first_time', first_time: true });
    expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(
      [...PAYLOAD_KEYS, 'reason'].sort(),
    );
    expect(tags.calls).toEqual([PIXEL_TAG]);
  });

  it('T-ACT-15 a non-project target_type → validation in v1 (ADR-0002 C21)', async () => {
    expectFail(
      await postRole('user', {
        target_type: 'video',
        target_id: SEED_PROJECTS.pixelChameleon,
        body: 'hi',
      } as unknown as PostCommentInput),
      'validation',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-16 — replies (one level; comment.reply only when published and parent author ≠ actor)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-16 postComment replies', () => {
  let replier: string;

  beforeAll(async () => {
    await setModerationMode('auto');
    replier = await makeUser({ comment_count: 1 });
  });

  beforeEach(async () => {
    await clearRateLimitHitsFor(COMMENT_SCOPES, [replier]);
  });

  afterAll(async () => {
    await setModerationMode('auto');
  });

  it("T-ACT-16 reply to another author's root (…0201) → ok + comment.reply next to comment.new", async () => {
    const data = expectOk(
      await postAs(replier, {
        ...TARGET,
        body: '@seed_user T-ACT-16 reply',
        parent_id: SEED_COMMENTS.published,
      }),
    );
    expect(data.comment.parentId).toBe(SEED_COMMENTS.published);
    expect((await storedComment(data.comment.id)).parent_id).toBe(SEED_COMMENTS.published);
    // Body stored as sent — the `@handle ` prefix is the client's job, not enforced here.
    expect(data.comment.body).toBe('@seed_user T-ACT-16 reply');

    const events = await eventsFor(data.comment.id);
    expect(events.map((event) => event.kind).sort()).toEqual(['comment.new', 'comment.reply']);
    const reply = events.find((event) => event.kind === 'comment.reply');
    expect(reply?.payload).toMatchObject({
      comment_id: data.comment.id,
      parent_id: SEED_COMMENTS.published,
      root_id: SEED_COMMENTS.published,
      parent_author: { profile_id: SEED_USERS.seed_user, handle: 'seed_user' },
    });
    expect(JSON.stringify(reply)).not.toMatch(NO_PII);
  });

  it('T-ACT-16 reply to a reply (…0202) is stored under the root (…0201)', async () => {
    const data = expectOk(
      await postAs(replier, {
        ...TARGET,
        body: '@oddsense T-ACT-16 nested',
        parent_id: SEED_COMMENTS.creatorReply,
      }),
    );
    expect(data.comment.parentId).toBe(SEED_COMMENTS.published);
    expect((await storedComment(data.comment.id)).parent_id).toBe(SEED_COMMENTS.published);
    const reply = (await eventsFor(data.comment.id)).find(
      (event) => event.kind === 'comment.reply',
    );
    expect(reply?.payload).toMatchObject({
      parent_id: SEED_COMMENTS.creatorReply,
      root_id: SEED_COMMENTS.published,
      parent_author: { profile_id: SEED_USERS.oddsense, handle: 'oddsense' },
    });
  });

  it('T-ACT-16 reply to own root → no comment.reply', async () => {
    const rootId = await makeComment({ author_id: replier });
    const data = expectOk(
      await postAs(replier, { ...TARGET, body: 'T-ACT-16 self reply', parent_id: rootId }),
    );
    expect((await eventsFor(data.comment.id)).map((event) => event.kind)).toEqual(['comment.new']);
  });

  it('T-ACT-16 a held reply → no comment.reply (mutatesSeed hold_first_time)', async () => {
    await setModerationMode('hold_first_time');
    try {
      const newcomer = await makeUser();
      const data = expectOk(
        await postAs(newcomer, {
          ...TARGET,
          body: 'T-ACT-16 held reply',
          parent_id: SEED_COMMENTS.published,
        }),
      );
      expect(data.comment.status).toBe('held');
      expect((await eventsFor(data.comment.id)).map((event) => event.kind)).toEqual([
        'comment.held',
      ]);
    } finally {
      await setModerationMode('auto');
    }
  });

  it('T-ACT-16 parent on a different target → not_found', async () => {
    expectFail(
      await postAs(replier, {
        target_type: 'project',
        target_id: SEED_PROJECTS.metalPipeMace,
        body: 'x',
        parent_id: SEED_COMMENTS.published,
      }),
      'not_found',
    );
  });

  it.each([
    ['held', SEED_COMMENTS.held],
    ['hidden', SEED_COMMENTS.hidden],
    ['deleted', SEED_COMMENTS.deleted],
    ['unknown', randomUUID()],
  ])('T-ACT-16 reply to a %s parent → not_found', async (_label, parent_id) => {
    expectFail(await postAs(replier, { ...TARGET, body: 'x', parent_id }), 'not_found');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-12/16 — edge states (a handle-less parent author, the comments-closed race the insert
// policy answers, a settings view with no row) + DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-12 postComment edge states + DB faults', () => {
  let poster: string;
  let logs: LogSpy;

  beforeAll(async () => {
    await setModerationMode('auto');
    poster = await makeUser({ comment_count: 1 });
  });

  beforeEach(async () => {
    logs = spyLog();
    tags.calls.length = 0;
    await clearRateLimitHitsFor(COMMENT_SCOPES, [poster]);
  });

  afterEach(() => {
    logs.restore();
  });

  async function rowsWithBody(body: string): Promise<number> {
    const { data, error } = await service.from('comments').select('id').eq('body', body);
    if (error) throw new Error(`service could not read comments: ${error.message}`);
    for (const row of data) trackComment(row.id);
    return data.length;
  }

  it('T-ACT-16 reply to a root whose author never picked a handle → comment.reply parent_author.handle null', async () => {
    const nameless = await makeUser({ handle: null, comment_count: 1 });
    const rootId = await makeComment({ author_id: nameless });
    const data = expectOk(
      await postAs(poster, { ...TARGET, body: 'T-ACT-16 nameless parent', parent_id: rootId }),
    );
    const reply = (await eventsFor(data.comment.id)).find(
      (event) => event.kind === 'comment.reply',
    );
    expect(reply?.payload).toMatchObject({
      parent_id: rootId,
      root_id: rootId,
      parent_author: { profile_id: nameless, handle: null },
    });
  });

  it('T-ACT-12 comments closed between the checks and the insert → comments_closed (the insert policy answers 42501), no row', async () => {
    const projectId = await makeProject();
    const input: PostCommentInput = {
      target_type: 'project',
      target_id: projectId,
      body: 'T-ACT-12 closing door',
    };
    const res = await withDbHook(
      { rpc: 'rate_limit_ok' },
      () => arrangeOverride({ project_id: projectId, comments_enabled: false }),
      () => postAs(poster, input),
    );
    expectFail(res, 'comments_closed');
    expect(await rowsWithBody(input.body)).toBe(0);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-12 site_settings_public answering no row → comments default open, moderation auto → published', async () => {
    const projectId = await makeProject();
    const data = expectOk(
      await withDbFault(
        { table: 'site_settings_public', op: 'select' },
        { nth: 'all', result: { data: null, error: null } },
        () =>
          postAs(poster, {
            target_type: 'project',
            target_id: projectId,
            body: 'T-ACT-12 settings defaults',
          }),
      ),
    );
    expect(data.comment.status).toBe('published');
  });

  it.each<{ name: string; target: DbCallTarget; nth?: number }>([
    { name: 'the project_overrides read', target: { table: 'project_overrides', op: 'select' } },
    {
      name: 'the site_settings_public read (comments enabled)',
      target: { table: 'site_settings_public', op: 'select' },
    },
    {
      name: 'the site_settings_public read (moderation mode)',
      target: { table: 'site_settings_public', op: 'select' },
      nth: 2,
    },
    { name: 'the comment_count read', target: { table: 'profiles', op: 'select' }, nth: 2 },
    { name: 'the comment insert', target: { table: 'comments', op: 'insert' } },
  ])(
    'T-ACT-12 $name fails → internal + one log.error line, no row, no revalidate',
    async ({ target, nth }) => {
      const body = `T-ACT-12 fault ${randomUUID()}`;
      const res = await withDbFault(target, nth === undefined ? {} : { nth }, () =>
        postAs(poster, { ...TARGET, body }),
      );
      expectInternal(res, 'postComment', logs);
      expect(await rowsWithBody(body)).toBe(0);
      expect(tags.calls).toEqual([]);
    },
  );
});
