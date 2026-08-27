/**
 * tests/db/rls/project_versions.test.ts — RLS matrix for `project_versions`
 * (docs/build/05-test-plan.md §7.1 T-RLS-24..28; data-model §4). Policies:
 * supabase/migrations/20260827090100_project_versions_files.sql — select =
 * `project_is_visible(project_id)` or `is_admin()` (visibility inherited from the parent project);
 * insert/update/delete = admin only; sync writes bypass RLS via service. Cell order of every cell
 * comment: anon | user | banned | mod | admin | svc.
 *
 * Invisible parents are factory rows (draft project; published project with
 * `project_overrides.hidden = true`), each carrying one factory version. Seed rows stay read-only
 * (H-1): denied write cells target seed `…0402` and are proven no-ops through `service`; allowed
 * write cells use factory rows under a visible factory project (removed by `cleanupFactories`,
 * children via FK cascade).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeProject, makeVersion } from '@/tests/helpers/factories';
import { SEED_VERSIONS } from '@/tests/helpers/seedIds';

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');
const SEED_VERSION_IDS = Object.values(SEED_VERSIONS);

let draftVersionId: string;
let hiddenVersionId: string;
let visibleProjectId: string;

beforeAll(async () => {
  const draftProjectId = await makeProject({ source: 'odsens', status: 'draft' });
  draftVersionId = await makeVersion({ project_id: draftProjectId });
  const hiddenProjectId = await makeProject({ status: 'published' });
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: hiddenProjectId, hidden: true });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
  hiddenVersionId = await makeVersion({ project_id: hiddenProjectId });
  visibleProjectId = await makeProject({ status: 'published' });
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-24 select where parent published & visible — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-24 project_versions select under a visible parent', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-24 %s sees the seed versions but none under a draft/hidden parent',
    async (role) => {
      const { data, error } = await asRole(role).from('project_versions').select('id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of SEED_VERSION_IDS) expect(ids.has(id), id).toBe(true);
      expect(ids.has(draftVersionId)).toBe(false);
      expect(ids.has(hiddenVersionId)).toBe(false);
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-24 %s sees every version row', async (role) => {
    const { data, error } = await asRole(role).from('project_versions').select('id');
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    for (const id of [...SEED_VERSION_IDS, draftVersionId, hiddenVersionId]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-25 select where parent draft/hidden — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-25 project_versions select under a draft/hidden parent', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-25 %s cannot see versions of a draft or hidden project',
    async (role) => {
      await expectPolicy({
        table: 'project_versions',
        op: 'select',
        role,
        allowed: false,
        filter: { id: draftVersionId },
      });
      await expectPolicy({
        table: 'project_versions',
        op: 'select',
        role,
        allowed: false,
        filter: { id: hiddenVersionId },
      });
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-25 %s reads versions of a draft or hidden project',
    async (role) => {
      for (const id of [draftVersionId, hiddenVersionId]) {
        await expectPolicy({
          table: 'project_versions',
          op: 'select',
          role,
          allowed: true,
          filter: { id },
          expectRows: 1,
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-26 insert — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
function versionRow(id: string): RowValues {
  return {
    id,
    project_id: visibleProjectId,
    version_number: `t_rls26_${id.replace(/-/g, '').slice(0, 8)}`,
    game_versions: [],
    loaders: [],
    version_type: 'release',
    date_published: new Date().toISOString(),
  };
}

describe('T-RLS-26 project_versions insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-26 %s cannot insert a version', async (role) => {
    const id = randomUUID();
    await expectPolicy({
      table: 'project_versions',
      op: 'insert',
      role,
      allowed: false,
      row: versionRow(id),
    });
    const { data } = await service.from('project_versions').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each(['admin', 'service'] as const)('T-RLS-26 %s inserts a version', async (role) => {
    await expectPolicy({
      table: 'project_versions',
      op: 'insert',
      role,
      allowed: true,
      row: versionRow(randomUUID()),
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-27 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-27 project_versions update', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-27 %s cannot update a version', async (role) => {
    await expectPolicy({
      table: 'project_versions',
      op: 'update',
      role,
      allowed: false,
      filter: { id: SEED_VERSIONS.mace_1_1_0 },
      patch: { downloads: 999999 },
    });
    const { data } = await service
      .from('project_versions')
      .select('downloads')
      .eq('id', SEED_VERSIONS.mace_1_1_0)
      .single();
    expect(data?.downloads).toBe(1300);
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-27 %s updates a version (factory)',
    async (role) => {
      const id = await makeVersion({ project_id: visibleProjectId });
      await expectPolicy({
        table: 'project_versions',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { name: `t_rls27_${role}` },
        expectRows: 1,
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-28 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-28 project_versions delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-28 %s cannot delete a version', async (role) => {
    await expectPolicy({
      table: 'project_versions',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: SEED_VERSIONS.mace_1_1_0 },
    });
    const { data } = await service
      .from('project_versions')
      .select('id')
      .eq('id', SEED_VERSIONS.mace_1_1_0);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-28 %s deletes a version (factory)',
    async (role) => {
      const id = await makeVersion({ project_id: visibleProjectId });
      await expectPolicy({
        table: 'project_versions',
        op: 'delete',
        role,
        allowed: true,
        filter: { id },
        expectRows: 1,
      });
    },
  );
});
