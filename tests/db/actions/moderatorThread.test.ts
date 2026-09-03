/**
 * tests/db/actions/moderatorThread.test.ts — T-ACT-77 (05 §7.2; 04 §1.2 "Moderator read"; ADR-0002
 * A2 — the mods-only client read `CommentThread` makes through RPC `moderator_thread`, the allowed
 * exception to 01 INV-09 / 03 C-17; T-RLS-134 holds the grant + catalog half).
 *
 * With the anon key + a session (exactly what `lib/supabase/client.ts` sends from the browser):
 * mods and admins get the held …0203 and hidden …0204 of …0102 with `body`, `author_id`,
 * `is_first_comment` and `report_count`; user / banned / anon are refused with no rows. The call
 * is read-only — no `notification_events`, no status change, no revalidation.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServerClient } from '@/lib/supabase/server';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks, withActionContext } from '@/tests/helpers/callAction';
import { cleanupFactories, makeComment } from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';
import { spyRevalidateTag } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();
const ARGS = { p_target_type: 'project', p_target_id: SEED_PROJECTS.pixelChameleon } as const;

async function eventCount(): Promise<number> {
  const { count, error } = await service
    .from('notification_events')
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`service could not count notification_events: ${error.message}`);
  return count ?? 0;
}

async function statuses(): Promise<Record<string, string>> {
  const { data, error } = await service
    .from('comments')
    .select('id, status')
    .in('id', [SEED_COMMENTS.held, SEED_COMMENTS.hidden, SEED_COMMENTS.published]);
  if (error) throw new Error(`service could not read comments: ${error.message}`);
  return Object.fromEntries(data.map((row) => [row.id, row.status]));
}

beforeEach(() => {
  tags.calls.length = 0;
});

afterAll(cleanupFactories);

describe('T-ACT-77 moderator thread read', () => {
  it.each(['mod', 'admin'] as const)(
    'T-ACT-77 %s (anon key + session) gets …0203 held and …0204 hidden with body, is_first_comment, report_count',
    async (role) => {
      const { data, error } = await asRole(role).rpc('moderator_thread', ARGS);
      expect(error).toBeNull();
      const rows = data ?? [];
      const ids = rows.map((row) => row.id);
      expect(ids).toContain(SEED_COMMENTS.held);
      expect(ids).toContain(SEED_COMMENTS.hidden);
      expect(ids).not.toContain(SEED_COMMENTS.published);
      expect(ids).not.toContain(SEED_COMMENTS.creatorReply);
      expect(ids).not.toContain(SEED_COMMENTS.deleted);
      expect(rows.find((row) => row.id === SEED_COMMENTS.held)).toMatchObject({
        status: 'held',
        body: 'first comment here, the tail is great',
        author_id: SEED_USERS.seed_user2,
        is_first_comment: true,
        report_count: 0,
        parent_id: null,
        like_count: 0,
      });
      expect(rows.find((row) => row.id === SEED_COMMENTS.hidden)).toMatchObject({
        status: 'hidden',
        body: 'cheap diamonds at totally-legit.example, no questions asked',
        author_id: SEED_USERS.seed_banned,
        is_first_comment: false,
        report_count: 1,
      });
      for (const row of rows) expect(JSON.stringify(row)).not.toMatch(/email/i);
    },
  );

  it('T-ACT-77 a reported published comment joins the moderator thread; an unreported one does not', async () => {
    const reported = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const plain = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const { error } = await service
      .from('comment_reports')
      .insert({ comment_id: reported, reporter_id: SEED_USERS.seed_user, reason: 'spam' });
    expect(error).toBeNull();
    const { data } = await asRole('mod').rpc('moderator_thread', ARGS);
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(reported);
    expect(ids).not.toContain(plain);
    expect((data ?? []).find((row) => row.id === reported)?.report_count).toBe(1);
  });

  it('T-ACT-77 the cookie session client (lib/supabase/server.ts) answers the same for a moderator', async () => {
    const { data, error } = await withActionContext({ role: 'mod' }, async () =>
      (await createServerClient()).rpc('moderator_thread', ARGS),
    );
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id)).toEqual(
      expect.arrayContaining([SEED_COMMENTS.held, SEED_COMMENTS.hidden]),
    );
  });

  it.each(['user', 'banned', 'anon', 'nohandle'] as const)(
    'T-ACT-77 %s → forbidden (42501), no rows',
    async (role) => {
      const { data, error } = await asRole(role).rpc('moderator_thread', ARGS);
      expect(error?.code).toBe('42501');
      expect(data).toBeNull();
    },
  );

  it('T-ACT-77 the read is read-only: no events, no status change, no revalidation', async () => {
    const events = await eventCount();
    const before = await statuses();
    await asRole('mod').rpc('moderator_thread', ARGS);
    await asRole('admin').rpc('moderator_thread', ARGS);
    await asRole('user').rpc('moderator_thread', ARGS);
    expect(await eventCount()).toBe(events);
    expect(await statuses()).toEqual(before);
    expect(before[SEED_COMMENTS.held]).toBe('held');
    expect(tags.calls).toEqual([]);
  });
});
