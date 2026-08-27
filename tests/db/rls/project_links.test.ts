/**
 * tests/db/rls/project_links.test.ts — RLS matrix for `project_links`
 * (docs/build/05-test-plan.md §7.1 T-RLS-34..38; data-model §4; insert admin only — ADR-0002 C7,
 * mod cells plain D). Policies: supabase/migrations/20260827090200_project_links_overrides.sql —
 * select = `project_is_visible(project_id)` or `is_admin()`; insert/update/delete = admin only;
 * `syncCurseforge` writes bypass RLS via service. Composite PK `(project_id, platform)` — the
 * documented uuid-PK exception — so every filter names both columns. Cell order of every cell
 * comment: anon | user | banned | mod | admin | svc.
 *
 * Invisible parents are factory rows (draft project; published project with
 * `project_overrides.hidden = true`), each carrying one service-arranged link. Seed rows stay
 * read-only (H-1): denied write cells target the SEED-6 link `(…0102, curseforge)` and are proven
 * no-ops through `service`; allowed write cells use links on visible factory projects (removed by
 * `cleanupFactories` via the project FK cascade).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { expectPolicy } from '@/tests/helpers/expectPolicy';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';

const NON_ADMIN = ['user', 'banned', 'mod'] as const satisfies readonly TestRole[];
const service = asRole('service');
/** The SEED-6 link (project_id + platform = the composite PK). */
const SEED_LINK = { project_id: SEED_PROJECTS.pixelChameleon, platform: 'curseforge' } as const;

let draftProjectId: string;
let hiddenProjectId: string;

/** Arranges a link row through service (no makeLink factory in 05 §1.3 — cascade-cleaned). */
async function arrangeLink(projectId: string, platform: 'modrinth' | 'curseforge'): Promise<void> {
  const { error } = await service.from('project_links').insert({
    project_id: projectId,
    platform,
    external_id: `t_${projectId.replace(/-/g, '').slice(0, 8)}`,
    url: `https://modrinth.com/mod/t-${projectId.slice(0, 8)}`,
    downloads: 0,
    synced_at: new Date().toISOString(),
  });
  if (error) throw new Error(`arrange: project_links insert failed: ${error.message}`);
}

beforeAll(async () => {
  draftProjectId = await makeProject({ source: 'odsens', status: 'draft' });
  await arrangeLink(draftProjectId, 'modrinth');
  hiddenProjectId = await makeProject({ status: 'published' });
  const { error } = await service
    .from('project_overrides')
    .insert({ project_id: hiddenProjectId, hidden: true });
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
  await arrangeLink(hiddenProjectId, 'modrinth');
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-34 select where project published & visible — pub | pub | pub | pub | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-34 project_links select under a visible project', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-34 %s sees the seed link but none under a draft/hidden project',
    async (role) => {
      const { data, error } = await asRole(role)
        .from('project_links')
        .select('project_id, platform');
      expect(error).toBeNull();
      const rows = data ?? [];
      expect(
        rows.some(
          (r) => r.project_id === SEED_LINK.project_id && r.platform === SEED_LINK.platform,
        ),
      ).toBe(true);
      expect(rows.some((r) => r.project_id === draftProjectId)).toBe(false);
      expect(rows.some((r) => r.project_id === hiddenProjectId)).toBe(false);
    },
  );

  it.each(['admin', 'service'] as const)('T-RLS-34 %s sees every link row', async (role) => {
    const { data, error } = await asRole(role).from('project_links').select('project_id');
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.project_id));
    for (const id of [SEED_LINK.project_id, draftProjectId, hiddenProjectId]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-35 select where project draft/hidden — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-35 project_links select under a draft/hidden project', () => {
  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-35 %s cannot see links of a draft or hidden project',
    async (role) => {
      for (const project_id of [draftProjectId, hiddenProjectId]) {
        await expectPolicy({
          table: 'project_links',
          op: 'select',
          role,
          allowed: false,
          filter: { project_id, platform: 'modrinth' },
        });
      }
    },
  );

  it.each(['admin', 'service'] as const)(
    'T-RLS-35 %s reads links of a draft or hidden project',
    async (role) => {
      for (const project_id of [draftProjectId, hiddenProjectId]) {
        await expectPolicy({
          table: 'project_links',
          op: 'select',
          role,
          allowed: true,
          filter: { project_id, platform: 'modrinth' },
          expectRows: 1,
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-RLS-36 insert (admin only — ADR-0002 C7) — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-36 project_links insert', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-36 %s cannot insert a link', async (role) => {
    await expectPolicy({
      table: 'project_links',
      op: 'insert',
      role,
      allowed: false,
      row: {
        project_id: SEED_PROJECTS.metalPipeMace,
        platform: 'curseforge',
        external_id: 't_rls36',
        url: 'https://www.curseforge.com/minecraft/mc-mods/t-rls36',
        downloads: 0,
        synced_at: new Date().toISOString(),
      },
    });
    const { data } = await service
      .from('project_links')
      .select('project_id')
      .eq('project_id', SEED_PROJECTS.metalPipeMace);
    expect(data).toEqual([]);
  });

  it.each(['admin', 'service'] as const)('T-RLS-36 %s inserts a link', async (role) => {
    const projectId = await makeProject({ status: 'published' });
    await expectPolicy({
      table: 'project_links',
      op: 'insert',
      role,
      allowed: true,
      row: {
        project_id: projectId,
        platform: 'curseforge',
        external_id: `t_rls36_${role}`,
        url: `https://www.curseforge.com/minecraft/mc-mods/t-rls36-${role}`,
        downloads: 0,
        synced_at: new Date().toISOString(),
      },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-37 update — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-37 project_links update', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-37 %s cannot update a link', async (role) => {
    await expectPolicy({
      table: 'project_links',
      op: 'update',
      role,
      allowed: false,
      filter: { ...SEED_LINK },
      patch: { downloads: 999999 },
    });
    const { data } = await service
      .from('project_links')
      .select('downloads')
      .eq('project_id', SEED_LINK.project_id)
      .eq('platform', SEED_LINK.platform)
      .single();
    expect(data?.downloads).toBe(120);
  });

  it.each(['admin', 'service'] as const)('T-RLS-37 %s updates a link (factory)', async (role) => {
    const projectId = await makeProject({ status: 'published' });
    await arrangeLink(projectId, 'curseforge');
    await expectPolicy({
      table: 'project_links',
      op: 'update',
      role,
      allowed: true,
      filter: { project_id: projectId, platform: 'curseforge' },
      patch: { downloads: 1 },
      expectRows: 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-38 delete — D | D | D | D | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-38 project_links delete', () => {
  it.each(['anon', ...NON_ADMIN] as const)('T-RLS-38 %s cannot delete a link', async (role) => {
    await expectPolicy({
      table: 'project_links',
      op: 'delete',
      role,
      allowed: false,
      filter: { ...SEED_LINK },
    });
    const { data } = await service
      .from('project_links')
      .select('project_id')
      .eq('project_id', SEED_LINK.project_id)
      .eq('platform', SEED_LINK.platform);
    expect(data).toHaveLength(1);
  });

  it.each(['admin', 'service'] as const)('T-RLS-38 %s deletes a link (factory)', async (role) => {
    const projectId = await makeProject({ status: 'published' });
    await arrangeLink(projectId, 'curseforge');
    await expectPolicy({
      table: 'project_links',
      op: 'delete',
      role,
      allowed: true,
      filter: { project_id: projectId, platform: 'curseforge' },
      expectRows: 1,
    });
  });
});
