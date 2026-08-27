/**
 * tests/db/rls/projects.test.ts — RLS matrix for `projects` (docs/build/05-test-plan.md §7.1
 * T-RLS-16..21; data-model §4 row "projects / versions / files / links / overrides"). Policies:
 * supabase/migrations/20260827090000_projects.sql — select = `project_is_visible(id)` or
 * `is_admin()`; insert/update/delete = admin only; sync writes bypass RLS via service. Cell order of
 * every cell comment: anon | user | banned | mod | admin | svc.
 *
 * Visibility fixtures are factory rows (a draft exclusive and a published project whose
 * `project_overrides.hidden = true`) — seed rows stay read-only (H-1): denied write cells target seed
 * `…0101` and are proven no-ops through `service`; allowed write cells use factory rows. Factory rows
 * (and the override hung on one, via FK cascade) are removed by `cleanupFactories`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy, type RowValues } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';

/** Signed-in, non-admin roles — every cell below is identical for them (mod is plain D on writes, ADR-0002 C7). */
const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');
const SEED_PROJECT_IDS = Object.values(SEED_PROJECTS);

let draftId: string;
let hiddenId: string;

beforeAll(async () => {
  draftId = await makeProject({ source: 'odsens', status: 'draft' });
  hiddenId = await makeProject({ status: 'published' });
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: hiddenId, hidden: true });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-16 select status='published' and not overrides.hidden — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-16 projects select published & not hidden', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-16 %s sees the published seed rows and nothing draft or hidden',
    async (role) => {
      const { data, error } = await asRole(role).from('projects').select('id, status');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of SEED_PROJECT_IDS) expect(ids.has(id), id).toBe(true);
      expect(ids.has(draftId)).toBe(false);
      expect(ids.has(hiddenId)).toBe(false);
      for (const row of data ?? []) expect(row.status).toBe('published');
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-16 %s sees every row incl. the draft and hidden ones',
    async (role) => {
      const { data, error } = await asRole(role).from('projects').select('id');
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      for (const id of [...SEED_PROJECT_IDS, draftId, hiddenId]) expect(ids.has(id), id).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-17 select a status='draft' exclusive (factory) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-17 projects select a draft exclusive', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-17 %s cannot see the draft row', async (role) => {
    await expectPolicy({
      table: 'projects',
      op: 'select',
      role,
      allowed: false,
      filter: { id: draftId },
    });
  });

  it.each(['admin', 'service'] as const)('T-RLS-17 %s reads the draft row', async (role) => {
    await expectPolicy({
      table: 'projects',
      op: 'select',
      role,
      allowed: true,
      filter: { id: draftId },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-18 select a published project whose project_overrides.hidden=true — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-18 projects select a hidden-by-override project', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-18 %s cannot see the hidden row',
    async (role) => {
      await expectPolicy({
        table: 'projects',
        op: 'select',
        role,
        allowed: false,
        filter: { id: hiddenId },
      });
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-18 %s reads the hidden row', async (role) => {
    await expectPolicy({
      table: 'projects',
      op: 'select',
      role,
      allowed: true,
      filter: { id: hiddenId },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-19 insert (source='odsens') — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
function exclusiveRow(id: string): RowValues {
  const tag = id.replace(/-/g, '').slice(0, 8);
  return {
    id,
    source: 'odsens',
    slug: `t_rls19_${tag}`,
    project_type: 'datapack',
    title: `t_rls19_${tag}`,
    description: 't_rls19',
    body_md: 't_rls19',
    categories: [],
    loaders: [],
    game_versions: [],
  };
}

describe('T-RLS-19 projects insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-19 %s cannot insert a project', async (role) => {
    const id = randomUUID();
    await expectPolicy({
      table: 'projects',
      op: 'insert',
      role,
      allowed: false,
      row: exclusiveRow(id),
    });
    const { data } = await service.from('projects').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it.each(['admin', 'service'] as const)('T-RLS-19 %s inserts an exclusive', async (role) => {
    const id = randomUUID();
    await expectPolicy({
      table: 'projects',
      op: 'insert',
      role,
      allowed: true,
      row: exclusiveRow(id),
      expectRows: 1,
    });
    const removed = await service.from('projects').delete().eq('id', id).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-20 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-20 projects update', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-20 %s cannot update a project', async (role) => {
    await expectPolicy({
      table: 'projects',
      op: 'update',
      role,
      allowed: false,
      filter: { id: SEED_PROJECTS.metalPipeMace },
      patch: { title: 't_rls20' },
    });
    const { data } = await service
      .from('projects')
      .select('title')
      .eq('id', SEED_PROJECTS.metalPipeMace)
      .single();
    expect(data?.title).toBe('Metal Pipe Mace');
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-20 %s updates a project (factory)',
    async (role) => {
      const id = await makeProject();
      await expectPolicy({
        table: 'projects',
        op: 'update',
        role,
        allowed: true,
        filter: { id },
        patch: { title: `t_rls20_${role}` },
        expectRows: 1,
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-21 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-21 projects delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-21 %s cannot delete a project', async (role) => {
    await expectPolicy({
      table: 'projects',
      op: 'delete',
      role,
      allowed: false,
      filter: { id: SEED_PROJECTS.metalPipeMace },
    });
    const { data } = await service
      .from('projects')
      .select('id')
      .eq('id', SEED_PROJECTS.metalPipeMace);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)(
    'T-RLS-21 %s deletes a project (factory)',
    async (role) => {
      const id = await makeProject();
      await expectPolicy({
        table: 'projects',
        op: 'delete',
        role,
        allowed: true,
        filter: { id },
        expectRows: 1,
      });
    },
  );
});
