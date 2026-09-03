/**
 * tests/db/rls/comment_reports.test.ts — RLS matrix for `comment_reports` (docs/build/05-test-plan.md
 * §7.1 T-RLS-85..89; data-model §2.5 / §4; 04 §1.2 reportComment; ADR-0028 D2 / D4). Policies:
 * supabase/migrations/20260903090100_comment_likes_reports.sql — select = `is_moderator()`;
 * insert = `reporter_id = auth.uid()` + `can_comment()` on the reported comment's target; update
 * (`resolved_at/by`) = moderators; delete = NO policy and no JWT grant (service only — the admin
 * cell is D). Unique (comment_id, reporter_id) → 23505 on a repeat (T-RLS-87; the action maps it
 * to `ok:true`, T-ACT-21). Cell order of every cell comment: anon | user | banned | mod | admin | svc.
 *
 * A reporter cannot select the table, so an INSERT with RETURNING would be refused by RLS — the
 * allowed insert cells insert WITHOUT `.select()` (the action does the same) and are proven through
 * `service`. The seed report (…0204 ← seed_user 'spam', SEED-9) is read-only (H-1): denied cells
 * target it; allowed cells report FACTORY comments (`makeComment`), whose report rows cascade away
 * with them in `cleanupFactories`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { asRole, SEED_ROLE_IDS, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeComment } from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_USERS } from '@/tests/helpers/seedIds';

const NON_MOD = ['anon', 'user', 'banned'] as const satisfies readonly TestRole[];
const NON_SERVICE = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
] as const satisfies readonly TestRole[];
const service = asRole('service');

const SEED_REPORT = {
  comment_id: SEED_COMMENTS.hidden,
  reporter_id: SEED_USERS.seed_user,
} as const;

type ReportRow = {
  id: string;
  reason: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

async function readReport(commentId: string, reporterId: string): Promise<ReportRow | null> {
  const { data, error } = await service
    .from('comment_reports')
    .select('id, reason, resolved_at, resolved_by')
    .eq('comment_id', commentId)
    .eq('reporter_id', reporterId)
    .maybeSingle();
  if (error) throw new Error(`service could not read comment_reports: ${error.message}`);
  return data;
}

/** A report row through service (the "own / unresolved" row the update + delete cells act on). */
async function arrangeReport(commentId: string, reporterId: string): Promise<string> {
  const { data, error } = await service
    .from('comment_reports')
    .insert({ comment_id: commentId, reporter_id: reporterId, reason: 'other' })
    .select('id')
    .single();
  if (error) throw new Error(`arrange: comment_reports insert failed: ${error.message}`);
  return data.id;
}

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-85 select — D | D | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-85 comment_reports select', () => {
  it.each(NON_MOD)('T-RLS-85 %s cannot read the seed report', async (role) => {
    await expectPolicy({
      table: 'comment_reports',
      op: 'select',
      role,
      allowed: false,
      filter: SEED_REPORT,
    });
  });

  it.each(['mod', 'admin', 'service'] as const)(
    'T-RLS-85 %s reads the seed report',
    async (role) => {
      const { data, error } = await asRole(role)
        .from('comment_reports')
        .select('reason, resolved_at')
        .match(SEED_REPORT);
      expect(error).toBeNull();
      expect(data).toEqual([{ reason: 'spam', resolved_at: null }]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-86 insert (comment_id, reporter_id = auth.uid(), reason) — D | A | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-86 comment_reports insert own', () => {
  it('T-RLS-86 anon cannot report', async () => {
    const commentId = await makeComment();
    await expectPolicy({
      table: 'comment_reports',
      op: 'insert',
      role: 'anon',
      allowed: false,
      row: { comment_id: commentId, reporter_id: SEED_USERS.seed_user2, reason: 'spam' },
    });
    expect(await readReport(commentId, SEED_USERS.seed_user2)).toBeNull();
  });

  it('T-RLS-86 banned cannot report (can_comment false)', async () => {
    const commentId = await makeComment();
    await expectPolicy({
      table: 'comment_reports',
      op: 'insert',
      role: 'banned',
      allowed: false,
      row: { comment_id: commentId, reporter_id: SEED_USERS.seed_banned, reason: 'spam' },
    });
    expect(await readReport(commentId, SEED_USERS.seed_banned)).toBeNull();
  });

  it.each(['user', 'mod', 'admin'] as const)(
    'T-RLS-86 %s reports a comment (insert without RETURNING)',
    async (role) => {
      const commentId = await makeComment({ author_id: SEED_USERS.seed_user2 });
      const { error } = await asRole(role)
        .from('comment_reports')
        .insert({ comment_id: commentId, reporter_id: SEED_ROLE_IDS[role], reason: 'rude' });
      expect(error).toBeNull();
      const stored = await readReport(commentId, SEED_ROLE_IDS[role]);
      expect(stored?.reason).toBe('rude');
      expect(stored?.resolved_at).toBeNull();
    },
  );

  it('T-RLS-86 a reporter cannot ask for the row back (RETURNING is refused by the select policy)', async () => {
    const commentId = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const { error } = await asRole('user')
      .from('comment_reports')
      .insert({ comment_id: commentId, reporter_id: SEED_USERS.seed_user, reason: 'spam' })
      .select('id');
    expect(error?.code).toBe('42501');
    expect(await readReport(commentId, SEED_USERS.seed_user)).toBeNull();
  });

  it('T-RLS-86 service inserts a report', async () => {
    const commentId = await makeComment();
    await expectPolicy({
      table: 'comment_reports',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { comment_id: commentId, reporter_id: SEED_USERS.seed_user2, reason: 'other' },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-87 insert a duplicate (comment_id, reporter_id) → 23505 — — | D | — | D | D | D
// ---------------------------------------------------------------------------------------------
describe('T-RLS-87 comment_reports duplicate report', () => {
  it.each(['user', 'mod', 'admin'] as const)(
    'T-RLS-87 %s reporting the same comment twice hits the unique constraint (23505)',
    async (role) => {
      const commentId = await makeComment({ author_id: SEED_USERS.seed_user2 });
      const client = asRole(role);
      const first = await client
        .from('comment_reports')
        .insert({ comment_id: commentId, reporter_id: SEED_ROLE_IDS[role], reason: 'spam' });
      expect(first.error).toBeNull();
      const second = await client
        .from('comment_reports')
        .insert({ comment_id: commentId, reporter_id: SEED_ROLE_IDS[role], reason: 'rude' });
      expect(second.error?.code).toBe('23505');
      expect((await readReport(commentId, SEED_ROLE_IDS[role]))?.reason).toBe('spam');
    },
  );

  it('T-RLS-87 service repeating the seed report hits the unique constraint (23505)', async () => {
    const { error } = await service
      .from('comment_reports')
      .insert({ ...SEED_REPORT, reason: 'rude' });
    expect(error?.code).toBe('23505');
    expect((await readReport(SEED_REPORT.comment_id, SEED_REPORT.reporter_id))?.reason).toBe(
      'spam',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-88 update (resolved_at, resolved_by) — D | D | D | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-88 comment_reports update', () => {
  it.each(NON_MOD)('T-RLS-88 %s cannot resolve the seed report', async (role) => {
    await expectPolicy({
      table: 'comment_reports',
      op: 'update',
      role,
      allowed: false,
      filter: SEED_REPORT,
      patch: { resolved_at: new Date().toISOString(), resolved_by: SEED_USERS.seed_mod },
    });
    expect(
      (await readReport(SEED_REPORT.comment_id, SEED_REPORT.reporter_id))?.resolved_at,
    ).toBeNull();
  });

  it.each(['mod', 'admin', 'service'] as const)(
    'T-RLS-88 %s resolves a report (factory)',
    async (role) => {
      const commentId = await makeComment({ author_id: SEED_USERS.seed_user2 });
      await arrangeReport(commentId, SEED_USERS.seed_user);
      const resolver = role === 'service' ? SEED_USERS.seed_mod : SEED_ROLE_IDS[role];
      await expectPolicy({
        table: 'comment_reports',
        op: 'update',
        role,
        allowed: true,
        filter: { comment_id: commentId, reporter_id: SEED_USERS.seed_user },
        patch: { resolved_at: new Date().toISOString(), resolved_by: resolver },
        expectRows: 1,
      });
      const stored = await readReport(commentId, SEED_USERS.seed_user);
      expect(stored?.resolved_at).not.toBeNull();
      expect(stored?.resolved_by).toBe(resolver);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-89 delete — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-89 comment_reports delete', () => {
  it.each(NON_SERVICE)('T-RLS-89 %s cannot delete the seed report', async (role) => {
    await expectPolicy({
      table: 'comment_reports',
      op: 'delete',
      role,
      allowed: false,
      filter: SEED_REPORT,
    });
    expect(await readReport(SEED_REPORT.comment_id, SEED_REPORT.reporter_id)).not.toBeNull();
  });

  it('T-RLS-89 service deletes a report (factory)', async () => {
    const commentId = await makeComment({ author_id: SEED_USERS.seed_user2 });
    const id = await arrangeReport(commentId, SEED_USERS.seed_user);
    await expectPolicy({
      table: 'comment_reports',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
    expect(await readReport(commentId, SEED_USERS.seed_user)).toBeNull();
  });
});
