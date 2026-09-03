/**
 * tests/db/rls/comments.test.ts — RLS matrix for `comments` (docs/build/05-test-plan.md §7.1
 * T-RLS-63..78, T-RLS-126 (`comment_count` + `updated_at` halves), T-RLS-131 (status trigger);
 * data-model §2.5 / §4; 04 §1.2 shared definitions + §5.1; ADR-0002 #72 / C21; ADR-0028 D3 / D4).
 * Policies + triggers: supabase/migrations/20260903090000_comments.sql — select = published rows of
 * a visible target, own rows (any status), or `is_moderator()`; insert = own row + `can_comment()`;
 * update = author or moderator, with the column rules in `comments_guard()` (a body edit = the
 * author within 15 minutes of `created_at`, moderators included; status = author → `deleted` only,
 * moderators any status and stamped `moderated_by/at` on someone else's row; `like_count`,
 * `author_id`, `target_*`, `parent_id`, `created_at` immutable; a banned caller changes nothing);
 * delete (hard) = moderators only. Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * Seed rows (SEED-9, on project …0102) stay read-only (H-1): denied write cells target them and are
 * proven no-ops through `service`; allowed write cells use factory comments (`makeComment` / a
 * tracked JWT insert), removed by `cleanupFactories`, which also re-asserts the SEED-3
 * `comment_count` values the bump trigger moved. T-RLS-131 is `mutatesSeed`:
 * `site_settings.moderation_mode` flips to `hold_first_time` through `service` and is restored to
 * `auto` in `afterAll`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { patchProfile, readProfile } from '@/tests/helpers/arrange';
import { asRole, SEED_ROLE_IDS, type SeedRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import {
  cleanupFactories,
  makeComment,
  makeProject,
  restoreSeedCommentCounts,
  trackComment,
} from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';

const JWT_ROLES = ['user', 'banned', 'mod', 'admin'] as const satisfies readonly SeedRole[];
const ALL_ROLES = ['anon', ...JWT_ROLES, 'service'] as const satisfies readonly TestRole[];
const NON_MOD = ['anon', 'user', 'banned'] as const satisfies readonly TestRole[];
const MOD_UP = ['mod', 'admin', 'service'] as const satisfies readonly TestRole[];
const service = asRole('service');

const SEED_HIDDEN_BODY = 'cheap diamonds at totally-legit.example, no questions asked';

type CommentRow = {
  id: string;
  body: string;
  status: string;
  author_id: string | null;
  like_count: number;
  moderated_by: string | null;
  moderated_at: string | null;
  updated_at: string;
};

async function readComment(id: string): Promise<CommentRow> {
  const { data, error } = await service
    .from('comments')
    .select('id, body, status, author_id, like_count, moderated_by, moderated_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`service could not read comments: ${error.message}`);
  if (!data) throw new Error(`comment ${id} is gone`);
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

/** An override row on a factory project (no `makeOverride` in 05 §1.3 — it cascades with the project). */
async function arrangeOverride(projectId: string, values: { hidden?: boolean }): Promise<void> {
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: projectId, ...values });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
}

function insertRow(authorId: string, targetId = SEED_PROJECTS.pixelChameleon): RowValues {
  return {
    id: randomUUID(),
    target_type: 'project',
    target_id: targetId,
    author_id: authorId,
    body: 't_rls comments insert',
  };
}

const SIXTEEN_MIN_AGO = (): string => new Date(Date.now() - 16 * 60_000).toISOString();

let draftProjectId: string;
let hiddenProjectId: string;

beforeAll(async () => {
  draftProjectId = await makeProject({ source: 'odsens', status: 'draft' });
  hiddenProjectId = await makeProject({ status: 'published' });
  await arrangeOverride(hiddenProjectId, { hidden: true });
});

afterAll(async () => {
  await setModerationMode('auto');
  await cleanupFactories();
  await restoreSeedCommentCounts();
});

// ---------------------------------------------------------------------------------------------
// T-RLS-63 select status='published' (…0201, …0202) — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-63 comments select published', () => {
  it.each(ALL_ROLES)('T-RLS-63 %s sees the published seed rows …0201 and …0202', async (role) => {
    const { data, error } = await asRole(role)
      .from('comments')
      .select('id, body')
      .in('id', [SEED_COMMENTS.published, SEED_COMMENTS.creatorReply]);
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id).sort()).toEqual(
      [SEED_COMMENTS.published, SEED_COMMENTS.creatorReply].sort(),
    );
    expect(data?.every((row) => row.body.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-64 select own held (…0203 as seed_user2) / own hidden (…0204 as seed_banned)
//   — | own | own | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-64 comments select own held / hidden row', () => {
  const NON_PUBLISHED = [SEED_COMMENTS.held, SEED_COMMENTS.hidden];

  it('T-RLS-64 user0 (seed_user2) sees own held …0203 and not the hidden …0204', async () => {
    const { data, error } = await asRole('user0')
      .from('comments')
      .select('id, status, body')
      .in('id', NON_PUBLISHED);
    expect(error).toBeNull();
    expect(data).toEqual([
      { id: SEED_COMMENTS.held, status: 'held', body: 'first comment here, the tail is great' },
    ]);
  });

  it('T-RLS-64 banned (seed_banned) sees own hidden …0204 and not the held …0203', async () => {
    const { data, error } = await asRole('banned')
      .from('comments')
      .select('id, status')
      .in('id', NON_PUBLISHED);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: SEED_COMMENTS.hidden, status: 'hidden' }]);
  });

  it.each(MOD_UP)('T-RLS-64 %s sees both non-published seed rows', async (role) => {
    const { data, error } = await asRole(role)
      .from('comments')
      .select('id')
      .in('id', NON_PUBLISHED);
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id).sort()).toEqual([...NON_PUBLISHED].sort());
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-65 select another user's held row …0203 — D | D | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-65 comments select another user’s held row', () => {
  it.each(NON_MOD)('T-RLS-65 %s cannot see the held …0203', async (role) => {
    await expectPolicy({
      table: 'comments',
      op: 'select',
      role,
      allowed: false,
      filter: { id: SEED_COMMENTS.held },
    });
  });

  it.each(MOD_UP)('T-RLS-65 %s reads the held …0203', async (role) => {
    await expectPolicy({
      table: 'comments',
      op: 'select',
      role,
      allowed: true,
      filter: { id: SEED_COMMENTS.held },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-66 select another user's hidden row …0204 body — D | D | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-66 comments select another user’s hidden row body', () => {
  it.each(['anon', 'user'] as const)('T-RLS-66 %s cannot read the hidden …0204', async (role) => {
    await expectPolicy({
      table: 'comments',
      op: 'select',
      role,
      allowed: false,
      filter: { id: SEED_COMMENTS.hidden },
    });
  });

  it("T-RLS-66 banned cannot read another user's hidden row (…0204 is seed_banned's own — a factory row stands in)", async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user2, status: 'hidden' });
    await expectPolicy({
      table: 'comments',
      op: 'select',
      role: 'banned',
      allowed: false,
      filter: { id },
    });
  });

  it.each(MOD_UP)('T-RLS-66 %s reads the hidden …0204 with its body', async (role) => {
    const { data, error } = await asRole(role)
      .from('comments')
      .select('body, moderated_by')
      .eq('id', SEED_COMMENTS.hidden)
      .single();
    expect(error).toBeNull();
    expect(data?.body).toBe(SEED_HIDDEN_BODY);
    expect(data?.moderated_by).toBe(SEED_USERS.oddsense);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-67 insert own row on a target with comments enabled (…0102) — D | A | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-67 comments insert own', () => {
  it('T-RLS-67 anon cannot insert', async () => {
    const row = insertRow(SEED_USERS.seed_user);
    await expectPolicy({ table: 'comments', op: 'insert', role: 'anon', allowed: false, row });
    const { data } = await service.from('comments').select('id').eq('id', String(row.id));
    expect(data).toEqual([]);
  });

  it('T-RLS-67 banned cannot insert own row (can_comment false)', async () => {
    const row = insertRow(SEED_USERS.seed_banned);
    await expectPolicy({ table: 'comments', op: 'insert', role: 'banned', allowed: false, row });
    const { data } = await service.from('comments').select('id').eq('id', String(row.id));
    expect(data).toEqual([]);
  });

  it.each(['user', 'mod', 'admin'] as const)(
    'T-RLS-67 %s inserts own row on …0102 (stored published under moderation_mode auto)',
    async (role) => {
      const row = insertRow(SEED_ROLE_IDS[role]);
      trackComment(String(row.id));
      await expectPolicy({
        table: 'comments',
        op: 'insert',
        role,
        allowed: true,
        row,
        expectRows: 1,
      });
      const stored = await readComment(String(row.id));
      expect(stored.status).toBe('published');
      expect(stored.author_id).toBe(SEED_ROLE_IDS[role]);
    },
  );

  it('T-RLS-67 service inserts (factory)', async () => {
    const id = await makeComment();
    expect((await readComment(id)).status).toBe('published');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-68 insert with author_id ≠ auth.uid() — D | D | D | D | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-68 comments insert as someone else', () => {
  it.each(['anon', ...JWT_ROLES] as const)(
    'T-RLS-68 %s cannot insert as another author',
    async (role) => {
      const other =
        role === 'admin' || role === 'anon' ? SEED_USERS.seed_user : SEED_USERS.oddsense;
      const row = insertRow(other);
      await expectPolicy({ table: 'comments', op: 'insert', role, allowed: false, row });
      const { data } = await service.from('comments').select('id').eq('id', String(row.id));
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-68 service inserts on behalf of any author (factory)', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
    expect((await readComment(id)).author_id).toBe(SEED_USERS.seed_user2);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-69 insert on a target with project_overrides.comments_enabled=false (…0103)
//   — D | D | D | D ⓘ | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-69 comments insert where comments are off', () => {
  it.each(['anon', ...JWT_ROLES] as const)('T-RLS-69 %s cannot insert on …0103', async (role) => {
    const row = insertRow(
      role === 'anon' ? SEED_USERS.seed_user : SEED_ROLE_IDS[role],
      SEED_PROJECTS.seedExclusivePack,
    );
    await expectPolicy({ table: 'comments', op: 'insert', role, allowed: false, row });
    const { data } = await service.from('comments').select('id').eq('id', String(row.id));
    expect(data).toEqual([]);
  });

  it('T-RLS-69 service inserts on …0103 (factory)', async () => {
    const id = await makeComment({ target_id: SEED_PROJECTS.seedExclusivePack });
    expect((await readComment(id)).status).toBe('published');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-70 insert on a draft / hidden project (factory) — D | D | D | D | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-70 comments insert on an invisible project', () => {
  const cases = ['anon', ...JWT_ROLES].flatMap((role) =>
    (['draft', 'hidden'] as const).map((kind) => [role, kind] as const),
  );

  it.each(cases)('T-RLS-70 %s cannot insert on a %s project', async (role, kind) => {
    const targetId = kind === 'draft' ? draftProjectId : hiddenProjectId;
    const row = insertRow(
      role === 'anon' ? SEED_USERS.seed_user : SEED_ROLE_IDS[role as SeedRole],
      targetId,
    );
    await expectPolicy({
      table: 'comments',
      op: 'insert',
      role: role as TestRole,
      allowed: false,
      row,
    });
    const { data } = await service.from('comments').select('id').eq('id', String(row.id));
    expect(data).toEqual([]);
  });

  it.each(['draft', 'hidden'] as const)(
    'T-RLS-70 service inserts on a %s project',
    async (kind) => {
      const id = await makeComment({
        target_id: kind === 'draft' ? draftProjectId : hiddenProjectId,
      });
      expect((await readComment(id)).status).toBe('published');
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-71 update own body within 15 minutes — D | A | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-71 comments update own body inside the edit window', () => {
  it('T-RLS-71 anon cannot update a body', async () => {
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_COMMENTS.published },
      patch: { body: 't_rls71' },
    });
    expect((await readComment(SEED_COMMENTS.published)).body).not.toBe('t_rls71');
  });

  it('T-RLS-71 banned cannot edit own fresh comment (comments_guard 42501)', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_banned });
    const { error } = await asRole('banned')
      .from('comments')
      .update({ body: 't_rls71 banned' })
      .eq('id', id)
      .select('id');
    expect(error?.code).toBe('42501');
    expect((await readComment(id)).body).not.toBe('t_rls71 banned');
  });

  it.each(['user', 'mod', 'admin'] as const)(
    'T-RLS-71 %s edits own body within 15 minutes',
    async (role) => {
      const id = await makeComment({ author_id: SEED_ROLE_IDS[role] });
      await expectPolicy({
        table: 'comments',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { body: `t_rls71 ${role}` },
        expectRows: 1,
      });
      expect((await readComment(id)).body).toBe(`t_rls71 ${role}`);
    },
  );

  it('T-RLS-71 service edits any body', async () => {
    const id = await makeComment();
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: { body: 't_rls71 service' },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-72 update own body after 15 minutes (created_at via service) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-72 comments update own body after the edit window', () => {
  it.each(JWT_ROLES)('T-RLS-72 %s cannot edit own 16-minute-old body (42501)', async (role) => {
    const id = await makeComment({
      author_id: SEED_ROLE_IDS[role],
      created_at: SIXTEEN_MIN_AGO(),
    });
    const { error } = await asRole(role)
      .from('comments')
      .update({ body: 't_rls72' })
      .eq('id', id)
      .select('id');
    expect(error?.code).toBe('42501');
    expect((await readComment(id)).body).not.toBe('t_rls72');
  });

  it('T-RLS-72 anon cannot edit the 3-day-old …0201', async () => {
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_COMMENTS.published },
      patch: { body: 't_rls72' },
    });
  });

  it('T-RLS-72 service edits an old body', async () => {
    const id = await makeComment({ created_at: SIXTEEN_MIN_AGO() });
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: { body: 't_rls72 service' },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-73 update another user's body — D | D | D | D | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-73 comments update another user’s body', () => {
  it.each(['anon', ...JWT_ROLES] as const)(
    "T-RLS-73 %s cannot edit someone else's body",
    async (role) => {
      // seed_user owns …0201 and oddsense owns …0202 — pick the one the role does not own.
      const target = role === 'admin' ? SEED_COMMENTS.published : SEED_COMMENTS.creatorReply;
      const before = (await readComment(target)).body;
      await expectPolicy({
        table: 'comments',
        op: 'update',
        role,
        allowed: false,
        filter: { id: target },
        patch: { body: 't_rls73' },
      });
      expect((await readComment(target)).body).toBe(before);
    },
  );

  it('T-RLS-73 service edits any body (factory)', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: { body: 't_rls73 service' },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-74 update own status → deleted (soft delete) — D | A | D ⓘ | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-74 comments soft-delete own row', () => {
  it('T-RLS-74 anon cannot set a status', async () => {
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_COMMENTS.published },
      patch: { status: 'deleted' },
    });
    expect((await readComment(SEED_COMMENTS.published)).status).toBe('published');
  });

  it('T-RLS-74 banned cannot soft-delete own row (42501)', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_banned });
    const { error } = await asRole('banned')
      .from('comments')
      .update({ status: 'deleted' })
      .eq('id', id)
      .select('id');
    expect(error?.code).toBe('42501');
    expect((await readComment(id)).status).toBe('published');
  });

  it.each(['user', 'mod', 'admin', 'service'] as const)(
    'T-RLS-74 %s sets own row to deleted (author stamps nothing)',
    async (role) => {
      const id = await makeComment({
        author_id: role === 'service' ? SEED_USERS.seed_user : SEED_ROLE_IDS[role],
      });
      await expectPolicy({
        table: 'comments',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { status: 'deleted' },
        expectRows: 1,
      });
      const row = await readComment(id);
      expect(row.status).toBe('deleted');
      expect(row.moderated_by).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-75 update own status held → published (self-approve) — D | D | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-75 comments self-approve', () => {
  it('T-RLS-75 anon cannot approve', async () => {
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_COMMENTS.held },
      patch: { status: 'published' },
    });
    expect((await readComment(SEED_COMMENTS.held)).status).toBe('held');
  });

  it.each(['user', 'banned'] as const)(
    'T-RLS-75 %s cannot publish own held row (42501)',
    async (role) => {
      const id = await makeComment({ author_id: SEED_ROLE_IDS[role], status: 'held' });
      const { error } = await asRole(role)
        .from('comments')
        .update({ status: 'published' })
        .eq('id', id)
        .select('id');
      expect(error?.code).toBe('42501');
      expect((await readComment(id)).status).toBe('held');
    },
  );

  it.each(['mod', 'admin', 'service'] as const)(
    'T-RLS-75 %s publishes own held row',
    async (role) => {
      const id = await makeComment({
        author_id: role === 'service' ? SEED_USERS.seed_mod : SEED_ROLE_IDS[role],
        status: 'held',
      });
      await expectPolicy({
        table: 'comments',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { status: 'published' },
        expectRows: 1,
      });
      const row = await readComment(id);
      expect(row.status).toBe('published');
      // Own row: no moderation stamp (the guard stamps only someone else's row).
      expect(row.moderated_by).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-76 update another user's status (held→published, published→hidden) stamps moderated_by/at
//   — D | D | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-76 comments moderate another user’s row', () => {
  it.each(NON_MOD)('T-RLS-76 %s cannot change the status of …0203 / …0201', async (role) => {
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role,
      allowed: false,
      filter: { id: SEED_COMMENTS.held },
      patch: { status: 'published' },
    });
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role,
      allowed: false,
      filter: { id: SEED_COMMENTS.published },
      patch: { status: 'hidden' },
    });
    expect((await readComment(SEED_COMMENTS.held)).status).toBe('held');
    expect((await readComment(SEED_COMMENTS.published)).status).toBe('published');
  });

  it.each(['mod', 'admin'] as const)(
    'T-RLS-76 %s approves and hides other users’ rows and gets moderated_by/at stamped',
    async (role) => {
      const heldId = await makeComment({ author_id: SEED_USERS.seed_user2, status: 'held' });
      const publishedId = await makeComment({ author_id: SEED_USERS.seed_user });
      await expectPolicy({
        table: 'comments',
        op: 'update',
        role,
        allowed: true,
        filter: { id: heldId },
        patch: { status: 'published' },
        expectRows: 1,
      });
      await expectPolicy({
        table: 'comments',
        op: 'update',
        role,
        allowed: true,
        filter: { id: publishedId },
        patch: { status: 'hidden' },
        expectRows: 1,
      });
      for (const [id, status] of [
        [heldId, 'published'],
        [publishedId, 'hidden'],
      ] as const) {
        const row = await readComment(id);
        expect(row.status).toBe(status);
        expect(row.moderated_by).toBe(SEED_ROLE_IDS[role]);
        expect(row.moderated_at).not.toBeNull();
      }
    },
  );

  it('T-RLS-76 service sets any status and the moderation fields explicitly', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user2, status: 'held' });
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: {
        status: 'published',
        moderated_by: SEED_USERS.seed_mod,
        moderated_at: new Date().toISOString(),
      },
      expectRows: 1,
    });
    const row = await readComment(id);
    expect(row.status).toBe('published');
    expect(row.moderated_by).toBe(SEED_USERS.seed_mod);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-77 update like_count / author_id / target_* directly — D | D | D | D | D ⓘ | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-77 comments immutable columns', () => {
  const PATCHES: ReadonlyArray<[string, RowValues]> = [
    ['like_count', { like_count: 9 }],
    ['author_id', { author_id: SEED_USERS.seed_newbie }],
    ['target_id', { target_id: SEED_PROJECTS.metalPipeMace }],
    ['target_type', { target_type: 'skin' }],
  ];

  it.each(PATCHES)('T-RLS-77 anon cannot change %s', async (_column, patch) => {
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_COMMENTS.published },
      patch,
    });
  });

  const cells = JWT_ROLES.flatMap((role) =>
    PATCHES.map(([column, patch]) => [role, column, patch] as const),
  );
  it.each(cells)(
    'T-RLS-77 %s cannot change %s on own row (42501)',
    async (role, _column, patch) => {
      const id = await makeComment({ author_id: SEED_ROLE_IDS[role] });
      const { error } = await asRole(role)
        .from('comments')
        .update(patch as never)
        .eq('id', id)
        .select('id');
      expect(error?.code).toBe('42501');
      const row = await readComment(id);
      expect(row.like_count).toBe(0);
      expect(row.author_id).toBe(SEED_ROLE_IDS[role]);
    },
  );

  it('T-RLS-77 service changes the counters and target (factory)', async () => {
    const id = await makeComment();
    await expectPolicy({
      table: 'comments',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { id },
      patch: { like_count: 9, target_id: SEED_PROJECTS.metalPipeMace },
      expectRows: 1,
    });
    expect((await readComment(id)).like_count).toBe(9);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-78 hard delete — D | D | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-78 comments hard delete', () => {
  it('T-RLS-78 anon cannot delete …0201', async () => {
    await expectPolicy({
      table: 'comments',
      op: 'delete',
      role: 'anon',
      allowed: false,
      filter: { id: SEED_COMMENTS.published },
    });
    await readComment(SEED_COMMENTS.published);
  });

  it.each(['user', 'banned'] as const)('T-RLS-78 %s cannot hard-delete own row', async (role) => {
    const id = await makeComment({ author_id: SEED_ROLE_IDS[role] });
    await expectPolicy({ table: 'comments', op: 'delete', role, allowed: false, filter: { id } });
    await readComment(id);
  });

  it.each(MOD_UP)('T-RLS-78 %s hard-deletes a row (factory)', async (role) => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user2 });
    await expectPolicy({
      table: 'comments',
      op: 'delete',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
    const { data } = await service.from('comments').select('id').eq('id', id);
    expect(data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-126 (comments half): profiles.comment_count +1 the first time a row reaches published,
// never decremented; updated_at fires on comments. (The like_count half lives in comment_likes.)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-126 comment triggers', () => {
  const author = SEED_USERS.seed_user2;

  it('T-RLS-126 a published insert bumps the author’s comment_count by one', async () => {
    const before = await commentCount(author);
    await makeComment({ author_id: author });
    expect(await commentCount(author)).toBe(before + 1);
  });

  it('T-RLS-126 a held insert leaves comment_count unchanged; held → published bumps it once', async () => {
    const before = await commentCount(author);
    const id = await makeComment({ author_id: author, status: 'held' });
    expect(await commentCount(author)).toBe(before);
    const { error } = await service.from('comments').update({ status: 'published' }).eq('id', id);
    expect(error).toBeNull();
    expect(await commentCount(author)).toBe(before + 1);
    // A second pass through published (hidden → published) does not count again.
    await service.from('comments').update({ status: 'hidden' }).eq('id', id);
    await service.from('comments').update({ status: 'published' }).eq('id', id);
    expect(await commentCount(author)).toBe(before + 1);
  });

  it('T-RLS-126 hidden, deleted and a hard delete never decrement comment_count', async () => {
    const id = await makeComment({ author_id: author });
    const after = await commentCount(author);
    await service.from('comments').update({ status: 'hidden' }).eq('id', id);
    expect(await commentCount(author)).toBe(after);
    await service.from('comments').update({ status: 'deleted' }).eq('id', id);
    expect(await commentCount(author)).toBe(after);
    const { error } = await service.from('comments').delete().eq('id', id);
    expect(error).toBeNull();
    expect(await commentCount(author)).toBe(after);
  });

  it('T-RLS-126 updated_at moves on every comments update', async () => {
    const id = await makeComment();
    const before = (await readComment(id)).updated_at;
    const { error } = await service.from('comments').update({ body: 't_rls126' }).eq('id', id);
    expect(error).toBeNull();
    const after = (await readComment(id)).updated_at;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-131 comments_set_status() BEFORE INSERT under hold_first_time (mutatesSeed) — a JWT
// caller's value is ignored; no-JWT / service inserts keep theirs (the seed rows above).
// ---------------------------------------------------------------------------------------------
describe('T-RLS-131 comments_set_status() under hold_first_time (mutatesSeed)', () => {
  beforeAll(async () => {
    await setModerationMode('hold_first_time');
    // Earlier cells bumped seed_user2 through factory rows — the first-timer shape is count 0.
    await patchProfile(SEED_USERS.seed_user2, { comment_count: 0 });
  });

  afterAll(async () => {
    await setModerationMode('auto');
  });

  it('T-RLS-131 user0 inserting status=published is stored as held (count stays 0)', async () => {
    const row = insertRow(SEED_USERS.seed_user2);
    trackComment(String(row.id));
    const { data, error } = await asRole('user0')
      .from('comments')
      .insert({ ...row, status: 'published' } as never)
      .select('status')
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe('held');
    expect((await readComment(String(row.id))).status).toBe('held');
    expect(await commentCount(SEED_USERS.seed_user2)).toBe(0);
  });

  it('T-RLS-131 a user with comment_count > 0 stays published (M5)', async () => {
    const row = insertRow(SEED_USERS.seed_user);
    trackComment(String(row.id));
    const { data, error } = await asRole('user')
      .from('comments')
      .insert(row as never)
      .select('status')
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe('published');
  });

  it.each(['mod', 'admin'] as const)('T-RLS-131 %s insert stays published (M2)', async (role) => {
    const row = insertRow(SEED_ROLE_IDS[role]);
    trackComment(String(row.id));
    const { data, error } = await asRole(role)
      .from('comments')
      .insert({ ...row, status: 'held' } as never)
      .select('status, like_count, moderated_by')
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe('published');
    expect(data?.like_count).toBe(0);
    expect(data?.moderated_by).toBeNull();
  });

  it('T-RLS-131 a JWT insert cannot forge created_at / updated_at — both are pinned to now() (ADR-0028 D12)', async () => {
    const row = insertRow(SEED_USERS.seed_user);
    trackComment(String(row.id));
    // created_at is not an insertable column for `authenticated` (column-level grant) …
    const forged = await asRole('user')
      .from('comments')
      .insert({ ...row, created_at: new Date(Date.now() + 86_400_000).toISOString() } as never)
      .select('id');
    expect(forged.error?.code).toBe('42501');
    // … and a plain insert lands with the server's clock (the trigger pins it as well).
    const before = Date.now();
    const { error } = await asRole('user')
      .from('comments')
      .insert(row as never);
    expect(error).toBeNull();
    const stamps = await service
      .from('comments')
      .select('created_at, updated_at')
      .eq('id', String(row.id))
      .single();
    expect(stamps.error).toBeNull();
    expect(Math.abs(Date.parse(stamps.data?.created_at ?? '') - before)).toBeLessThan(30_000);
    expect(Math.abs(Date.parse(stamps.data?.updated_at ?? '') - before)).toBeLessThan(30_000);
  });

  it('T-RLS-131 a JWT reply needs a published ROOT on the same target (the 04 §1.2 reply rules, ADR-0028 D12)', async () => {
    const otherProject = await makeProject({ status: 'published' });
    const foreignRoot = await makeComment({
      target_id: otherProject,
      author_id: SEED_USERS.seed_user2,
    });
    const held = await makeComment({ author_id: SEED_USERS.seed_user2, status: 'held' });
    const reply = await makeComment({
      author_id: SEED_USERS.seed_user2,
      parent_id: SEED_COMMENTS.published,
    });
    for (const [label, parentId] of [
      ['a comment on another project', foreignRoot],
      ['a held comment', held],
      ['a reply (depth 2)', reply],
    ] as const) {
      const row = insertRow(SEED_USERS.seed_user);
      const { error } = await asRole('user')
        .from('comments')
        .insert({ ...row, parent_id: parentId } as never);
      expect(error?.code, label).toBe('42501');
    }
    // The sanctioned shape — a published root on the same target — still works.
    const ok = insertRow(SEED_USERS.seed_user);
    trackComment(String(ok.id));
    const { error } = await asRole('user')
      .from('comments')
      .insert({ ...ok, parent_id: SEED_COMMENTS.published } as never);
    expect(error).toBeNull();
  });

  it('T-RLS-131 under auto the same first-timer insert stays published', async () => {
    await setModerationMode('auto');
    await patchProfile(SEED_USERS.seed_user2, { comment_count: 0 });
    const row = insertRow(SEED_USERS.seed_user2);
    trackComment(String(row.id));
    const { data, error } = await asRole('user0')
      .from('comments')
      .insert(row as never)
      .select('status')
      .single();
    expect(error).toBeNull();
    expect(data?.status).toBe('published');
    expect(await commentCount(SEED_USERS.seed_user2)).toBe(1);
  });
});
