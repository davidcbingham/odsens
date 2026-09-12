/**
 * tests/db/rls/project_redirects.test.ts — RLS matrix for `project_redirects` (docs/build/05-test-plan.md
 * §7.1 T-RLS-136; ADR-0037 D4/D9; migration 20260911120100). Policies: one select policy —
 * `project_is_visible(project_id)` or `is_admin()` — so a redirect never reveals a draft / hidden
 * target; insert/update/delete have NO policy and no `authenticated` grant at all (denied even for
 * an admin JWT): the fold RPC (`fold_project`, service role) is the only writer. Cell order of every
 * cell comment: anon | user | banned | mod | admin | svc.
 *
 * Fixtures: three service-arranged redirect rows pointing at factory projects — a visible one, a
 * draft, and a published-but-`overrides.hidden` one. Denied write cells target the visible row and
 * are proven no-ops through `service`; allowed (service) write cells use fresh rows. Everything
 * falls to `cleanupFactories` (redirect rows cascade from their project's FK).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';

const JWT_ROLES = ['user', 'banned', 'mod', 'admin'] as const satisfies readonly TestRole[];
const NON_ADMIN = ['anon', 'user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

let visibleId = '';
let draftId = '';
let hiddenId = '';
let visibleSlug = '';
let draftSlug = '';
let hiddenSlug = '';

const tag = (id: string): string => id.replace(/-/g, '').slice(0, 8);

async function arrangeRedirect(oldSlug: string, projectId: string): Promise<void> {
  const { error } = await service
    .from('project_redirects')
    .insert({ old_slug: oldSlug, project_id: projectId });
  if (error) throw new Error(`arrange: project_redirects insert failed: ${error.message}`);
}

beforeAll(async () => {
  visibleId = await makeProject({ source: 'odsens', status: 'published' });
  draftId = await makeProject({ source: 'odsens', status: 'draft' });
  hiddenId = await makeProject({ status: 'published' });
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: hiddenId, hidden: true });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
  visibleSlug = `t_old_${tag(visibleId)}`;
  draftSlug = `t_old_${tag(draftId)}`;
  hiddenSlug = `t_old_${tag(hiddenId)}`;
  await arrangeRedirect(visibleSlug, visibleId);
  await arrangeRedirect(draftSlug, draftId);
  await arrangeRedirect(hiddenSlug, hiddenId);
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-136 select — visible target: pub | pub | pub | pub | A | A; draft/hidden target: D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-136 project_redirects select', () => {
  it.each(NON_ADMIN)(
    'T-RLS-136 %s reads a redirect to a visible project and none to a draft or hidden one',
    async (role) => {
      const { data, error } = await asRole(role)
        .from('project_redirects')
        .select('old_slug, project_id')
        .in('old_slug', [visibleSlug, draftSlug, hiddenSlug]);
      expect(error).toBeNull();
      expect(data).toEqual([{ old_slug: visibleSlug, project_id: visibleId }]);
      for (const old_slug of [draftSlug, hiddenSlug]) {
        await expectPolicy({
          table: 'project_redirects',
          op: 'select',
          role,
          allowed: false,
          filter: { old_slug },
        });
      }
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-136 %s reads every redirect row', async (role) => {
    const { data, error } = await asRole(role)
      .from('project_redirects')
      .select('old_slug')
      .in('old_slug', [visibleSlug, draftSlug, hiddenSlug]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.old_slug).sort()).toEqual(
      [visibleSlug, draftSlug, hiddenSlug].sort(),
    );
  });

  it('T-RLS-136 old_slug is citext: a different-case lookup finds the row (one row per old slug)', async () => {
    const { data, error } = await asRole('anon')
      .from('project_redirects')
      .select('project_id')
      .eq('old_slug', visibleSlug.toUpperCase());
    expect(error).toBeNull();
    expect(data).toEqual([{ project_id: visibleId }]);
    const dupe = await service
      .from('project_redirects')
      .insert({ old_slug: visibleSlug.toUpperCase(), project_id: draftId });
    expect(dupe.error?.code).toBe('23505');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-136 insert — D | D | D | D | D | A (no JWT grant, no policy — the fold writes)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-136 project_redirects insert', () => {
  it.each(['anon', ...JWT_ROLES] as const)(
    'T-RLS-136 %s cannot insert a redirect (admin included)',
    async (role) => {
      const old_slug = `t_ins_${role}_${tag(visibleId)}`;
      await expectPolicy({
        table: 'project_redirects',
        op: 'insert',
        role,
        allowed: false,
        row: { old_slug, project_id: visibleId },
      });
      const { data } = await service
        .from('project_redirects')
        .select('old_slug')
        .eq('old_slug', old_slug);
      expect(data).toEqual([]);
    },
  );

  it('T-RLS-136 service inserts a redirect', async () => {
    await expectPolicy({
      table: 'project_redirects',
      op: 'insert',
      role: 'service',
      allowed: true,
      row: { old_slug: `t_ins_service_${tag(visibleId)}`, project_id: visibleId },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-136 update — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-136 project_redirects update', () => {
  it.each(['anon', ...JWT_ROLES] as const)(
    'T-RLS-136 %s cannot re-point a redirect (admin included)',
    async (role) => {
      await expectPolicy({
        table: 'project_redirects',
        op: 'update',
        role,
        allowed: false,
        filter: { old_slug: visibleSlug },
        patch: { project_id: draftId },
      });
      const { data } = await service
        .from('project_redirects')
        .select('project_id')
        .eq('old_slug', visibleSlug)
        .single();
      expect(data?.project_id).toBe(visibleId);
    },
  );

  it('T-RLS-136 service re-points a redirect (the fold upsert path)', async () => {
    const old_slug = `t_upd_${tag(visibleId)}`;
    await arrangeRedirect(old_slug, draftId);
    await expectPolicy({
      table: 'project_redirects',
      op: 'update',
      role: 'service',
      allowed: true,
      filter: { old_slug },
      patch: { project_id: visibleId },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-136 delete — D | D | D | D | D | A; the FK cascade removes rows with their project
// ---------------------------------------------------------------------------------------------
describe('T-RLS-136 project_redirects delete', () => {
  it.each(['anon', ...JWT_ROLES] as const)(
    'T-RLS-136 %s cannot delete a redirect (admin included)',
    async (role) => {
      await expectPolicy({
        table: 'project_redirects',
        op: 'delete',
        role,
        allowed: false,
        filter: { old_slug: visibleSlug },
      });
      const { data } = await service
        .from('project_redirects')
        .select('old_slug')
        .eq('old_slug', visibleSlug);
      expect(data).toHaveLength(1);
    },
  );

  it('T-RLS-136 service deletes a redirect', async () => {
    const old_slug = `t_del_${tag(visibleId)}`;
    await arrangeRedirect(old_slug, visibleId);
    await expectPolicy({
      table: 'project_redirects',
      op: 'delete',
      role: 'service',
      allowed: true,
      filter: { old_slug },
      expectRows: 1,
    });
  });

  it('T-RLS-136 a redirect goes with its project (on delete cascade)', async () => {
    const projectId = await makeProject({ source: 'odsens', status: 'published' });
    const old_slug = `t_cas_${tag(projectId)}`;
    await arrangeRedirect(old_slug, projectId);
    const gone = await service.from('projects').delete().eq('id', projectId);
    expect(gone.error).toBeNull();
    const { data } = await service
      .from('project_redirects')
      .select('old_slug')
      .eq('old_slug', old_slug);
    expect(data).toEqual([]);
  });
});
