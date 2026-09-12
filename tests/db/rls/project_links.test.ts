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
 *
 * S1.5a (ADR-0037 D1/D9; migration 20260911120000): T-RLS-135 — `modrinth` link rows (an odsens
 * project's listing) go through the same visibility predicate, including the PostgREST embed from
 * `projects_public`, and the listing unique `project_links_platform_external_id_key (platform,
 * external_id)` makes a second link to one listing a 23505 (the `conflict` backstop of
 * `linkProjectListing`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, loose, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
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

// ---------------------------------------------------------------------------------------------
// T-RLS-135 (S1.5a, ADR-0037 D1/D9) — `modrinth` link rows through the visibility predicate and the
// PostgREST embed from `projects_public`; the listing unique (platform, external_id) → 23505.
// pub | pub | pub | pub | A | A for a visible odsens project's listing; D for a draft's (T-RLS-35).
// ---------------------------------------------------------------------------------------------
describe('T-RLS-135 project_links modrinth rows + the listing unique (ADR-0037)', () => {
  let linkedId = '';
  let listingId = '';

  beforeAll(async () => {
    linkedId = await makeProject({ source: 'odsens', status: 'published' });
    listingId = `t_rls135_${linkedId.replace(/-/g, '').slice(0, 8)}`;
    const { error } = await service.from('project_links').insert({
      project_id: linkedId,
      platform: 'modrinth',
      external_id: listingId,
      url: `https://modrinth.com/project/${listingId}`,
      downloads: 12,
      synced_at: new Date().toISOString(),
    });
    if (error) throw new Error(`arrange: project_links insert failed: ${error.message}`);
  });

  it.each(['anon', ...NON_ADMIN, 'admin', 'service'] as const)(
    'T-RLS-135 %s reads the modrinth link of a visible odsens project (direct + embedded from projects_public)',
    async (role) => {
      const direct = await asRole(role)
        .from('project_links')
        .select('platform, external_id, downloads')
        .eq('project_id', linkedId);
      expect(direct.error).toBeNull();
      expect(direct.data).toEqual([
        { platform: 'modrinth', external_id: listingId, downloads: 12 },
      ]);

      // The read model joins links from the view (03 GetItPanel "Also on" rows come from here).
      const embedded = await loose(asRole(role))
        .from('projects_public')
        .select('id, is_exclusive, project_links(platform, external_id)')
        .eq('id', linkedId);
      expect(embedded.error).toBeNull();
      expect(embedded.data).toEqual([
        {
          id: linkedId,
          is_exclusive: false,
          project_links: [{ platform: 'modrinth', external_id: listingId }],
        },
      ]);
    },
  );

  it.each(['anon', ...NON_ADMIN] as const)(
    'T-RLS-135 %s sees neither the draft project nor its modrinth link through projects_public',
    async (role) => {
      const embedded = await loose(asRole(role))
        .from('projects_public')
        .select('id, project_links(platform)')
        .eq('id', draftProjectId);
      expect(embedded.error).toBeNull();
      expect(embedded.data).toEqual([]);
      await expectPolicy({
        table: 'project_links',
        op: 'select',
        role,
        allowed: false,
        filter: { project_id: draftProjectId, platform: 'modrinth' },
      });
    },
  );

  it('T-RLS-135 a second link to the same (platform, external_id) is refused with 23505 — even through service', async () => {
    const otherId = await makeProject({ source: 'odsens', status: 'published' });
    const { error } = await service.from('project_links').insert({
      project_id: otherId,
      platform: 'modrinth',
      external_id: listingId,
      url: `https://modrinth.com/project/${listingId}`,
      downloads: 0,
      synced_at: new Date().toISOString(),
    });
    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('project_links_platform_external_id_key');
    // The unique is on the PAIR: the same external_id on another platform is a different listing.
    const otherPlatform = await service.from('project_links').insert({
      project_id: otherId,
      platform: 'curseforge',
      external_id: listingId,
      url: `https://www.curseforge.com/minecraft/mc-mods/${listingId}`,
      downloads: 0,
      synced_at: new Date().toISOString(),
    });
    expect(otherPlatform.error).toBeNull();
  });

  it('T-RLS-135 the listing unique is a unique index on (platform, external_id) (catalog)', () => {
    const rows = sql(
      "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'project_links' and indexname = 'project_links_platform_external_id_key'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toMatch(/CREATE UNIQUE INDEX .* \(platform, external_id\)/);
  });
});
