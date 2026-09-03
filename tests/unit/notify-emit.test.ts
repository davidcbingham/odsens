/**
 * tests/unit/notify-emit.test.ts — `lib/notify/emit.ts` (04 SC-22; docs/notifications.md event
 * catalog; data-model §2.6). Supplementary tests (no 05 ID — the pipeline is T-ACT-29..32, db lane):
 * the catalog is the 13 permanent names, `emit` writes exactly one `notification_events` row through
 * the service client with the given kind/actor/subject/payload, refuses an unknown kind before any
 * DB call, and throws on a DB error (never swallows an event). `@/lib/supabase/admin` is mocked the
 * way `rate-limit-scopes.test.ts` mocks it — nothing touches the DB here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const single = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const insert = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from }),
}));

const { NOTIFICATION_KINDS, emit, isNotificationKind } = await import('@/lib/notify/emit');

/** docs/notifications.md — verbatim, document order (v1, v1.5, P2). */
const CATALOG = [
  'comment.new',
  'comment.held',
  'comment.reported',
  'comment.reply',
  'comment.approved',
  'sync.failed',
  'sync.stale',
  'mention.suggested',
  'order.new',
  'tip.new',
  'workroom.post',
  'workroom.file',
  'workroom.comment',
] as const;

const ACTOR = '00000000-0000-4000-8000-000000000003';
const SUBJECT = '00000000-0000-4000-8000-000000000201';

beforeEach(() => {
  single.mockReset();
  select.mockReset();
  insert.mockReset();
  from.mockReset();
  from.mockReturnValue({ insert });
  insert.mockReturnValue({ select });
  select.mockReturnValue({ single });
  single.mockResolvedValue({ data: { id: 'evt-1' }, error: null });
});

describe('NOTIFICATION_KINDS (docs/notifications.md catalog)', () => {
  it('is exactly the 13 catalog names in document order', () => {
    expect([...NOTIFICATION_KINDS]).toEqual([...CATALOG]);
    expect(NOTIFICATION_KINDS).toHaveLength(13);
  });

  it.each(CATALOG)('isNotificationKind(%j) is true', (kind) => {
    expect(isNotificationKind(kind)).toBe(true);
  });

  it.each(['', 'comment', 'comment.deleted', 'COMMENT.NEW', 'sync.ok'])(
    'isNotificationKind(%j) is false',
    (kind) => {
      expect(isNotificationKind(kind)).toBe(false);
    },
  );
});

describe('emit', () => {
  it('inserts one notification_events row with kind, actor, subject and payload and returns its id', async () => {
    const payload = {
      comment_id: SUBJECT,
      target_type: 'project',
      target_slug: 'pixel-chameleon',
      author: { profile_id: ACTOR, handle: 'seed_user' },
      first_time: false,
    };
    await expect(
      emit('comment.new', { actorId: ACTOR, subjectType: 'comment', subjectId: SUBJECT, payload }),
    ).resolves.toEqual({ id: 'evt-1' });

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('notification_events');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      kind: 'comment.new',
      actor_id: ACTOR,
      subject_type: 'comment',
      subject_id: SUBJECT,
      payload,
    });
    expect(select).toHaveBeenCalledWith('id');
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('an omitted or null actorId is stored as actor_id null (jobs have no actor)', async () => {
    await emit('sync.failed', { subjectType: 'sync_run', subjectId: SUBJECT, payload: {} });
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ actor_id: null }));

    await emit('sync.stale', {
      actorId: null,
      subjectType: 'sync_run',
      subjectId: SUBJECT,
      payload: { source: 'modrinth' },
    });
    expect(insert).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor_id: null, payload: { source: 'modrinth' } }),
    );
  });

  it('undefined payload values are dropped so the stored JSON is exactly the keys the caller set', async () => {
    await emit('comment.held', {
      actorId: ACTOR,
      subjectType: 'comment',
      subjectId: SUBJECT,
      payload: { reason: 'first_time', excerpt: undefined, parent_id: null },
    });
    const stored = insert.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    expect(stored.payload).toEqual({ reason: 'first_time', parent_id: null });
    expect(Object.keys(stored.payload)).not.toContain('excerpt');
  });

  it('an unknown kind throws before any DB call', async () => {
    const bogus = 'comment.deleted' as unknown as (typeof CATALOG)[number];
    await expect(
      emit(bogus, { subjectType: 'comment', subjectId: SUBJECT, payload: {} }),
    ).rejects.toThrow(/unknown notification kind "comment.deleted"/);
    expect(from).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('a DB error throws (the event never silently disappears — runAction maps it to internal)', async () => {
    single.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'check' } });
    await expect(
      emit('comment.reported', {
        actorId: ACTOR,
        subjectType: 'comment',
        subjectId: SUBJECT,
        payload: {},
      }),
    ).rejects.toThrow(/notification_events insert failed: 23514/);
  });

  it.each(CATALOG)('accepts every catalog kind (%s)', async (kind) => {
    await expect(
      emit(kind, { subjectType: 'x', subjectId: SUBJECT, payload: {} }),
    ).resolves.toEqual({ id: 'evt-1' });
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ kind }));
  });
});
