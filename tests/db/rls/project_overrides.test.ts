/**
 * tests/db/rls/project_overrides.test.ts — RLS matrix for `project_overrides`
 * (docs/build/05-test-plan.md §7.1 T-RLS-39..43; data-model §4; insert admin only — ADR-0002 C7,
 * mod cells plain D). Policies: supabase/migrations/20260827090200_project_links_overrides.sql —
 * select = `project_is_visible(project_id)` or `is_admin()`: a `hidden=true` row makes its own
 * project invisible, so the row itself disappears for non-admin roles (T-RLS-40), while override
 * rows of visible projects are selectable by anon/authenticated — the ISR pages read them through
 * the anon server client (01 INV-15). insert/update/delete = admin only; sync never touches this
 * table (Principle 2). PK = `project_id`. Cell order of every cell comment:
 * anon | user | banned | mod | admin | svc.
 *
 * Seed rows stay read-only (H-1): denied write cells target the SEED-6 override on `…0102` and are
 * proven no-ops through `service`; allowed write cells use overrides arranged on visible factory
 * projects (removed by `cleanupFactories` via the project FK cascade).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');

let hiddenProjectId: string;

/** Arranges an override row through service (no makeOverride factory in 05 §1.3 — cascade-cleaned). */
async function arrangeOverride(
  projectId: string,
  values: { hidden?: boolean; notes_md?: string },
): Promise<void> {
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: projectId, ...values });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
}

beforeAll(async () => {
  hiddenProjectId = await makeProject({ status: 'published' });
  await arrangeOverride(hiddenProjectId, { hidden: true });
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-39 select where hidden=false and project published — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-39 project_overrides select where hidden=false', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-39 %s sees the seed overrides of visible projects but not the hidden one',
    async (role) => {
      const { data, error } = await asRole(role)
        .from('project_overrides')
        .select('project_id, notes_md, comments_enabled');
      expect(error).toBeNull();
      const rows = data ?? [];
      // SEED-6: (…0102 featured, notes 'seed note') and (…0103 comments off) — the ISR read path.
      expect(rows.find((r) => r.project_id === SEED_PROJECTS.pixelChameleon)?.notes_md).toBe(
        'seed note',
      );
      expect(
        rows.find((r) => r.project_id === SEED_PROJECTS.seedExclusivePack)?.comments_enabled,
      ).toBe(false);
      expect(rows.some((r) => r.project_id === hiddenProjectId)).toBe(false);
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-39 %s sees every override row', async (role) => {
    const { data, error } = await asRole(role).from('project_overrides').select('project_id');
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.project_id));
    for (const id of [
      SEED_PROJECTS.pixelChameleon,
      SEED_PROJECTS.seedExclusivePack,
      hiddenProjectId,
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-40 select where hidden=true — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-40 project_overrides select where hidden=true', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-40 %s cannot see a hidden=true override row',
    async (role) => {
      await expectPolicy({
        table: 'project_overrides',
        op: 'select',
        role,
        allowed: false,
        filter: { project_id: hiddenProjectId },
      });
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-40 %s reads the hidden=true override row',
    async (role) => {
      await expectPolicy({
        table: 'project_overrides',
        op: 'select',
        role,
        allowed: true,
        filter: { project_id: hiddenProjectId },
        expectRows: 1,
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-41 insert (admin only — ADR-0002 C7) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-41 project_overrides insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-41 %s cannot insert an override',
    async (role) => {
      await expectPolicy({
        table: 'project_overrides',
        op: 'insert',
        role,
        allowed: false,
        row: { project_id: SEED_PROJECTS.metalPipeMace, notes_md: 't_rls41' },
      });
      const { data } = await service
        .from('project_overrides')
        .select('project_id')
        .eq('project_id', SEED_PROJECTS.metalPipeMace);
      expect(data).toEqual([]);
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-41 %s inserts an override', async (role) => {
    const projectId = await makeProject({ status: 'published' });
    await expectPolicy({
      table: 'project_overrides',
      op: 'insert',
      role,
      allowed: true,
      row: { project_id: projectId, notes_md: `t_rls41_${role}` },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-42 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-42 project_overrides update', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-42 %s cannot update an override',
    async (role) => {
      await expectPolicy({
        table: 'project_overrides',
        op: 'update',
        role,
        allowed: false,
        filter: { project_id: SEED_PROJECTS.pixelChameleon },
        patch: { notes_md: 't_rls42' },
      });
      const { data } = await service
        .from('project_overrides')
        .select('notes_md')
        .eq('project_id', SEED_PROJECTS.pixelChameleon)
        .single();
      expect(data?.notes_md).toBe('seed note');
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-42 %s updates an override (factory)',
    async (role) => {
      const projectId = await makeProject({ status: 'published' });
      await arrangeOverride(projectId, { notes_md: 't_rls42' });
      await expectPolicy({
        table: 'project_overrides',
        op: 'update',
        role,
        allowed: true,
        filter: { project_id: projectId },
        patch: { notes_md: `t_rls42_${role}` },
        expectRows: 1,
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-43 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-43 project_overrides delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-43 %s cannot delete an override',
    async (role) => {
      await expectPolicy({
        table: 'project_overrides',
        op: 'delete',
        role,
        allowed: false,
        filter: { project_id: SEED_PROJECTS.pixelChameleon },
      });
      const { data } = await service
        .from('project_overrides')
        .select('project_id')
        .eq('project_id', SEED_PROJECTS.pixelChameleon);
      expect(data).toHaveLength(1);
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-43 %s deletes an override (factory)',
    async (role) => {
      const projectId = await makeProject({ status: 'published' });
      await arrangeOverride(projectId, { notes_md: 't_rls43' });
      await expectPolicy({
        table: 'project_overrides',
        op: 'delete',
        role,
        allowed: true,
        filter: { project_id: projectId },
        expectRows: 1,
      });
    },
  );
});
