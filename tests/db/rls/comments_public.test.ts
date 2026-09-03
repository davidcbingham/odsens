/**
 * tests/db/rls/comments_public.test.ts — T-RLS-128 (docs/build/05-test-plan.md §7.1; ADR-0002 #71;
 * data-model §2.5 "Public view comments_public"; 04 §1.2 "Reads"). View:
 * supabase/migrations/20260903090200_comments_public_moderator_thread.sql — a definer view
 * (`security_invoker = off`, the `public_profiles` pattern) over `comments` filtered by
 * `comment_target_visible()`: every role incl. anon selects rows of ALL statuses of a visible
 * target with `id, target_type, target_id, parent_id, status, created_at, like_count`; `body`,
 * `author_id`, `edited_at` are non-NULL only for `published` rows or the caller's own rows. Select
 * only (no insert/update/delete grant for any API role). Cell order: anon | user | banned | mod | admin | svc.
 *
 * Seed truths (SEED-9 on …0102): …0201/…0202 published (bodies for everyone), …0203 held by
 * seed_user2, …0204 hidden by seed_banned, …0205 deleted by seed_user. A factory comment on a
 * hidden project is absent for every role (`cleanupFactories` removes it).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { cleanupFactories, makeComment, makeProject } from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';

const ALL_ROLES = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
  'service',
] as const satisfies readonly TestRole[];
const service = asRole('service');

const SEED_IDS = Object.values(SEED_COMMENTS);
const HELD_BODY = 'first comment here, the tail is great';
const HIDDEN_BODY = 'cheap diamonds at totally-legit.example, no questions asked';

let hiddenProjectId: string;
let hiddenProjectCommentId: string;

async function seedSlots(role: TestRole) {
  const { data, error } = await asRole(role)
    .from('comments_public')
    .select(
      'id, target_type, target_id, parent_id, status, created_at, like_count, body, author_id, edited_at',
    )
    .eq('target_type', 'project')
    .eq('target_id', SEED_PROJECTS.pixelChameleon)
    .in('id', SEED_IDS)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`${role} could not read comments_public: ${error.message}`);
  return data;
}

beforeAll(async () => {
  hiddenProjectId = await makeProject({ status: 'published' });
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: hiddenProjectId, hidden: true });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
  hiddenProjectCommentId = await makeComment({ target_id: hiddenProjectId });
});

afterAll(cleanupFactories);

describe('T-RLS-128 comments_public view', () => {
  it('T-RLS-128 the column set is exactly id, target_type, target_id, parent_id, status, created_at, like_count, body, author_id, edited_at', () => {
    const rows = sql(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'comments_public' order by ordinal_position",
    );
    expect(rows.map(([name]) => name)).toEqual([
      'id',
      'target_type',
      'target_id',
      'parent_id',
      'status',
      'created_at',
      'like_count',
      'body',
      'author_id',
      'edited_at',
    ]);
  });

  it.each(ALL_ROLES)(
    'T-RLS-128 %s sees every seed row of …0102 as a slot, all statuses',
    async (role) => {
      const rows = await seedSlots(role);
      expect(rows.map((row) => row.id).sort()).toEqual([...SEED_IDS].sort());
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(SEED_COMMENTS.published)?.status).toBe('published');
      expect(byId.get(SEED_COMMENTS.published)?.like_count).toBe(1);
      expect(byId.get(SEED_COMMENTS.creatorReply)?.parent_id).toBe(SEED_COMMENTS.published);
      expect(byId.get(SEED_COMMENTS.held)?.status).toBe('held');
      expect(byId.get(SEED_COMMENTS.hidden)?.status).toBe('hidden');
      expect(byId.get(SEED_COMMENTS.deleted)?.status).toBe('deleted');
      // Published bodies and authors are open to everyone.
      expect(byId.get(SEED_COMMENTS.published)?.body).toBe(
        'The chameleon blends into my kitchen floor. Ten out of ten.',
      );
      expect(byId.get(SEED_COMMENTS.published)?.author_id).toBe(SEED_USERS.seed_user);
      expect(byId.get(SEED_COMMENTS.creatorReply)?.author_id).toBe(SEED_USERS.oddsense);
    },
  );

  it.each(['anon', 'user', 'mod', 'admin', 'service'] as const)(
    'T-RLS-128 %s gets …0203 / …0204 / …0205 with body, author_id and edited_at NULL (not their rows)',
    async (role) => {
      const byId = new Map((await seedSlots(role)).map((row) => [row.id, row]));
      for (const id of [SEED_COMMENTS.held, SEED_COMMENTS.hidden]) {
        expect(byId.get(id)?.body, id).toBeNull();
        expect(byId.get(id)?.author_id, id).toBeNull();
        expect(byId.get(id)?.edited_at, id).toBeNull();
      }
      // …0205 belongs to seed_user — its deleted body is the author's alone.
      if (role !== 'user') expect(byId.get(SEED_COMMENTS.deleted)?.body).toBeNull();
    },
  );

  it('T-RLS-128 seed_user2 (user0) sees own held …0203 body, still not the hidden …0204', async () => {
    const byId = new Map((await seedSlots('user0')).map((row) => [row.id, row]));
    expect(byId.get(SEED_COMMENTS.held)?.body).toBe(HELD_BODY);
    expect(byId.get(SEED_COMMENTS.held)?.author_id).toBe(SEED_USERS.seed_user2);
    expect(byId.get(SEED_COMMENTS.hidden)?.body).toBeNull();
    expect(byId.get(SEED_COMMENTS.hidden)?.author_id).toBeNull();
  });

  it('T-RLS-128 seed_banned sees own hidden …0204 body; seed_user sees own deleted …0205 body', async () => {
    const banned = new Map((await seedSlots('banned')).map((row) => [row.id, row]));
    expect(banned.get(SEED_COMMENTS.hidden)?.body).toBe(HIDDEN_BODY);
    expect(banned.get(SEED_COMMENTS.held)?.body).toBeNull();
    const user = new Map((await seedSlots('user')).map((row) => [row.id, row]));
    expect(user.get(SEED_COMMENTS.deleted)?.body).toBe('never mind, found the setting');
    expect(user.get(SEED_COMMENTS.held)?.body).toBeNull();
  });

  it.each(ALL_ROLES)('T-RLS-128 %s never sees a comment on a hidden project', async (role) => {
    const { data, error } = await asRole(role)
      .from('comments_public')
      .select('id')
      .eq('id', hiddenProjectCommentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    // The row is real — only the target's visibility hides it.
    const { data: base } = await service
      .from('comments')
      .select('id')
      .eq('id', hiddenProjectCommentId);
    expect(base).toHaveLength(1);
  });

  it.each(['anon', 'user', 'mod', 'admin'] as const)(
    'T-RLS-128 %s cannot insert, update or delete through the view',
    async (role) => {
      const client = asRole(role);
      const inserted = await client.from('comments_public').insert({
        id: '00000000-0000-4000-8000-0000000002ff',
        target_type: 'project',
        target_id: SEED_PROJECTS.pixelChameleon,
        status: 'published',
      } as never);
      expect(inserted.error?.code).toBe('42501');
      const updated = await client
        .from('comments_public')
        .update({ like_count: 9 } as never)
        .eq('id', SEED_COMMENTS.published);
      expect(updated.error?.code).toBe('42501');
      const deleted = await client
        .from('comments_public')
        .delete()
        .eq('id', SEED_COMMENTS.published);
      expect(deleted.error?.code).toBe('42501');
      const { data } = await service
        .from('comments')
        .select('like_count')
        .eq('id', SEED_COMMENTS.published)
        .single();
      expect(data?.like_count).toBe(1);
    },
  );
});
