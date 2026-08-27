/**
 * tests/db/rls/project_files.test.ts — RLS matrix for `project_files`
 * (docs/build/05-test-plan.md §7.1 T-RLS-29..33; data-model §4). Policies:
 * supabase/migrations/20260827090100_project_versions_files.sql — select = EXISTS-join up through
 * `project_versions` to `project_is_visible(project_id)` or `is_admin()` (visibility inherited two
 * levels up); insert/update/delete = admin only; sync writes bypass RLS via service.
 * `"primary"` keeps the data-model column name (reserved word, quoted in SQL). Cell order of every
 * cell comment: anon | user | banned | mod | admin | svc.
 *
 * Invisible chains are factory rows (draft project → version → file; hidden-by-override project →
 * version → file). Seed rows stay read-only (H-1): denied write cells target seed file `…0501` and
 * are proven no-ops through `service`; allowed write cells use factory files under a visible factory
 * project (removed by `cleanupFactories`, children via FK cascade).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeFile, makeProject, makeVersion } from '@/tests/helpers/factories';
import { SEED_FILES, seedId } from '@/tests/helpers/seedIds';

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');
/** SEED-5 file ids …0501..0505 (seed.sql extends group 05 beyond the named `exclusiveZip`). */
const SEED_FILE_IDS = [1, 2, 3, 4, 5].map((n) => seedId('files', n));

let draftFileId: string;
let hiddenFileId: string;
let visibleVersionId: string;

beforeAll(async () => {
  const draftProjectId = await makeProject({ source: 'odsens', status: 'draft' });
  draftFileId = await makeFile({ version_id: await makeVersion({ project_id: draftProjectId }) });
  const hiddenProjectId = await makeProject({ status: 'published' });
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: hiddenProjectId, hidden: true });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
  hiddenFileId = await makeFile({ version_id: await makeVersion({ project_id: hiddenProjectId }) });
  visibleVersionId = await makeVersion({
    project_id: await makeProject({ status: 'published' }),
  });
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-29 select where project published & visible — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-29 project_files select under a visible project', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-29 %s sees the seed files but none under a draft/hidden project',
    async (role) => {
      const { data, error } = await asRole(role).from('project_files').select('id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of SEED_FILE_IDS) expect(ids.has(id), id).toBe(true);
      expect(ids.has(draftFileId)).toBe(false);
      expect(ids.has(hiddenFileId)).toBe(false);
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-29 %s sees every file row', async (role) => {
    const { data, error } = await asRole(role).from('project_files').select('id');
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    for (const id of [...SEED_FILE_IDS, draftFileId, hiddenFileId]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-30 select where project draft/hidden — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-30 project_files select under a draft/hidden project', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-30 %s cannot see files of a draft or hidden project',
    async (role) => {
      await expectPolicy({
        table: 'project_files',
        op: 'select',
        role,
        allowed: false,
        filter: { id: draftFileId },
      });
      await expectPolicy({
        table: 'project_files',
        op: 'select',
        role,
        allowed: false,
        filter: { id: hiddenFileId },
      });
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-30 %s reads files of a draft or hidden project',
    async (role) => {
      for (const id of [draftFileId, hiddenFileId]) {
        await expectPolicy({
          table: 'project_files',
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
// T-RLS-31 insert — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
function fileRow(id: string): RowValues {
  return {
    id,
    version_id: visibleVersionId,
    filename: `t_rls31_${id.replace(/-/g, '').slice(0, 8)}.zip`,
    size_bytes: 1024,
  };
}

describe('T-RLS-31 project_files insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-31 %s cannot insert a file', async (role) => {
    const id = randomUUID();
    await expectPolicy({
      table: 'project_files',
      op: 'insert',
      role,
      allowed: false,
      row: fileRow(id),
    });
    const { data } = await service.from('project_files').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each(['admin', 'service'] as const)('T-RLS-31 %s inserts a file', async (role) => {
    await expectPolicy({
      table: 'project_files',
      op: 'insert',
      role,
      allowed: true,
      row: fileRow(randomUUID()),
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-32 update (incl. download_count) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-32 project_files update', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-32 %s cannot update a file (incl. download_count)',
    async (role) => {
      await expectPolicy({
        table: 'project_files',
        op: 'update',
        role,
        allowed: false,
        filter: { id: SEED_FILES.exclusiveZip },
        patch: { download_count: 999999 },
      });
      const { data } = await service
        .from('project_files')
        .select('download_count')
        .eq('id', SEED_FILES.exclusiveZip)
        .single();
      expect(data?.download_count).toBe(7);
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-32 %s updates a file (factory)', async (role) => {
    const id = await makeFile({ version_id: visibleVersionId });
    await expectPolicy({
      table: 'project_files',
      op: 'update',
      role,
      allowed: true,
      filter: { id },
      patch: { download_count: 1 },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-33 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-33 project_files delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-33 %s cannot delete a file', async (role) => {
    await expectPolicy({
      table: 'project_files',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: SEED_FILES.exclusiveZip },
    });
    const { data } = await service
      .from('project_files')
      .select('id')
      .eq('id', SEED_FILES.exclusiveZip);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)('T-RLS-33 %s deletes a file (factory)', async (role) => {
    const id = await makeFile({ version_id: visibleVersionId });
    await expectPolicy({
      table: 'project_files',
      op: 'delete',
      role,
      allowed: true,
      filter: { id },
      expectRows: 1,
    });
  });
});
