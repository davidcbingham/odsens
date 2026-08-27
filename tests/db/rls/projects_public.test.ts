/**
 * tests/db/rls/projects_public.test.ts — matrix for the `projects_public` view
 * (docs/build/05-test-plan.md §7.1 T-RLS-22/23; 00 S1.2 AC6; 02 §2.2). Definer view
 * (supabase/migrations/20260827090300_projects_public_view.sql): the WHERE clause
 * `status='published' and not coalesce(overrides.hidden,false)` IS the visibility rule, so every
 * role — admin JWTs and the service key included — sees only published, non-hidden rows through it
 * (admin reads drafts from the base table, tests/db/rls/projects.test.ts). Applies
 * `title_override`/`description_override` and derives `downloads_total`. Cell order:
 * anon | user | banned | mod | admin | svc.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { sql } from '@/tests/helpers/db';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';

const ALL_ROLES = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
  'service',
] as const satisfies readonly TestRole[];
const service = asRole('service');

let draftId: string;
let hiddenId: string;
let overriddenId: string;

beforeAll(async () => {
  draftId = await makeProject({ source: 'odsens', status: 'draft' });
  hiddenId = await makeProject({ status: 'published' });
  overriddenId = await makeProject({ status: 'published' });
  // Both rows name `hidden` explicitly: PostgREST unifies columns across a multi-row insert, and an
  // omitted column arrives as NULL (not the column default) on the rows that skip it.
  const { error } = await service.from('project_overrides').insert([
    { project_id: hiddenId, hidden: true },
    { project_id: overriddenId, hidden: false, title_override: 't_override_title' },
  ]);
  if (error) throw new Error(`arrange: project_overrides insert failed: ${error.message}`);
});

afterAll(cleanupFactories);

// ---------------------------------------------------------------------------------------------
// T-RLS-22 select — only published & not hidden rows — pub | pub | pub | pub | pub | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-22 projects_public select', () => {
  it.each(ALL_ROLES)('T-RLS-22 %s sees only published & not hidden rows', async (role) => {
    const { data, error } = await asRole(role).from('projects_public').select('id');
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    for (const id of Object.values(SEED_PROJECTS)) expect(ids.has(id), id).toBe(true);
    // The WHERE clause is baked into the definer view: filtered for EVERY role — the admin cell is
    // pub (not A over all rows), and even the service key cannot see drafts through this surface.
    expect(ids.has(draftId)).toBe(false);
    expect(ids.has(hiddenId)).toBe(false);
  });

  it('T-RLS-22 the view exposes neither status nor search and carries downloads_total', () => {
    const columns = sql(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'projects_public' order by ordinal_position",
    ).map(([name]) => name);
    expect(columns).not.toContain('status');
    expect(columns).not.toContain('search');
    expect(columns).toContain('downloads_total');
  });

  it('T-RLS-22 title_override is applied by the view (02 §2.2)', async () => {
    const { data, error } = await asRole('anon')
      .from('projects_public')
      .select('title')
      .eq('id', overriddenId);
    expect(error).toBeNull();
    expect(data).toEqual([{ title: 't_override_title' }]);
    // Seed …0102 has no override: the base title shows through the coalesce.
    const seed = await asRole('anon')
      .from('projects_public')
      .select('title')
      .eq('id', SEED_PROJECTS.pixelChameleon);
    expect(seed.data).toEqual([{ title: 'Pixel Chameleon' }]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-23 downloads_total = modrinth + curseforge + direct on seed …0102 = 1688 — A all roles
// ---------------------------------------------------------------------------------------------
describe('T-RLS-23 projects_public downloads_total', () => {
  it.each(ALL_ROLES)('T-RLS-23 %s reads downloads_total 1688 on seed …0102', async (role) => {
    const { data, error } = await asRole(role)
      .from('projects_public')
      .select('downloads_modrinth, downloads_curseforge, downloads_direct, downloads_total')
      .eq('id', SEED_PROJECTS.pixelChameleon);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    const row = data?.[0];
    expect(row?.downloads_total).toBe(1688); // 1568 + 120 + 0 (SEED-4)
    expect(row?.downloads_total).toBe(
      (row?.downloads_modrinth ?? 0) +
        (row?.downloads_curseforge ?? 0) +
        (row?.downloads_direct ?? 0),
    );
  });
});
