/**
 * tests/db/actions/curateProject.test.ts — T-ACT-40 (05 §7.2; 04 §1.4 `curateProject`;
 * ADR-0002 C7 / A11 / C10; migrations 20260827090200/90300).
 *
 * Auth matrix: anon `unauthenticated` · user D `forbidden` · banned D `forbidden` (the seed banned
 * account has role `user`, so `requireRole`'s rank check answers) · **mod D `forbidden`** (ADR-0002
 * C7: curation is admin-only; moderators read the admin pages only) · admin A. Success rows run on
 * factory projects only (seed overrides SEED-6 drive the Home hero and stay untouched, 05 H-1);
 * factory rows fall to `cleanupFactories` (overrides cascade with their project).
 *
 * The per-project shape upserts `project_overrides` partially (absent fields keep stored values),
 * revalidates `projects` + `project:<slug>` and logs the SC-24 keys-only audit line; `hidden=true`
 * removes the row from `projects_public`. The batch `reorder` shape revalidates `projects` exactly
 * once (ADR-0002 A11). `extra_gallery`: a foreign path fails the schema prefix rule; a well-formed
 * own path still fails the HEAD check while bucket `project-media` does not exist (S1.3 —
 * ADR-0002 C10), both as `validation`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { curateProject } from '@/lib/actions/projects';
import type { CurateProjectInput } from '@/lib/actions/projects.schema';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

afterAll(async () => {
  await cleanupFactories();
});

async function slugOf(projectId: string): Promise<string> {
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data.slug;
}

async function publicIds(projectId: string): Promise<number> {
  const { data, error } = await service.from('projects_public').select('id').eq('id', projectId);
  if (error) throw new Error(error.message);
  return data.length;
}

describe('T-ACT-40 curateProject', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: curation is admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-40 $role → $code', async ({ role, code, message }) => {
    const error = expectFail(
      await callAction(curateProject, { project_id: randomUUID(), featured: true }, { role }),
      code,
    );
    expect(error.message).toBe(message);
  });

  it('T-ACT-40 admin upserts project_overrides, revalidates projects + project:<slug>, SC-24 audit line', async () => {
    const projectId = await makeProject();
    const slug = await slugOf(projectId);
    const tags = spyRevalidateTag();
    const logs = spyLog();
    try {
      const data = expectOk(
        await callAction(
          curateProject,
          {
            project_id: projectId,
            featured: true,
            featured_order: 7,
            title_override: 'Curated Title',
            description_override: 'A curated description.',
            notes_md: 'a curation note',
            comments_enabled: false,
          },
          { role: 'admin' },
        ),
      );
      if (!('override' in data)) throw new Error('expected the per-project {override} payload');
      expect(data.override).toMatchObject({
        project_id: projectId,
        featured: true,
        featured_order: 7,
        hidden: false,
        title_override: 'Curated Title',
        description_override: 'A curated description.',
        notes_md: 'a curation note',
        comments_enabled: false,
      });

      const { data: row, error } = await service
        .from('project_overrides')
        .select('featured, featured_order, title_override, comments_enabled')
        .eq('project_id', projectId)
        .single();
      expect(error).toBeNull();
      expect(row).toEqual({
        featured: true,
        featured_order: 7,
        title_override: 'Curated Title',
        comments_enabled: false,
      });

      expect(tags.calls).toEqual(['projects', `project:${slug}`]);

      // SC-24: keys only — no values, no bodies.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('curateProject');
      expect(Object.keys(line.meta).sort()).toEqual([
        'actor_profile_id',
        'fields',
        'target_id',
        'target_type',
      ]);
      expect(line.meta.actor_profile_id).toBe(SEED_ROLE_IDS.admin);
      expect(line.meta.target_type).toBe('project');
      expect(line.meta.target_id).toBe(projectId);
      expect(line.meta.fields).toContain('project_id');
      expect(line.meta.fields).toContain('featured');
      expect(JSON.stringify(line.meta)).not.toContain('Curated Title');
    } finally {
      logs.restore();
    }
  });

  it('T-ACT-40 partial upsert merges: hidden=true keeps earlier fields and removes the row from projects_public', async () => {
    const projectId = await makeProject();
    expect(await publicIds(projectId)).toBe(1);

    expectOk(
      await callAction(curateProject, { project_id: projectId, featured: true }, { role: 'admin' }),
    );
    expectOk(
      await callAction(curateProject, { project_id: projectId, hidden: true }, { role: 'admin' }),
    );

    const { data: row, error } = await service
      .from('project_overrides')
      .select('featured, hidden')
      .eq('project_id', projectId)
      .single();
    expect(error).toBeNull();
    expect(row).toEqual({ featured: true, hidden: true });
    expect(await publicIds(projectId)).toBe(0);
  });

  it('T-ACT-40 batch reorder upserts featured_order per id and revalidates projects ONCE (ADR-0002 A11)', async () => {
    const first = await makeProject();
    const second = await makeProject();
    const tags = spyRevalidateTag();

    const data = expectOk(
      await callAction(
        curateProject,
        {
          reorder: [
            { project_id: first, featured_order: 8 },
            { project_id: second, featured_order: 9 },
          ],
        },
        { role: 'admin' },
      ),
    );
    if (!('reordered' in data)) throw new Error('expected the batch {reordered} payload');
    expect(data.reordered).toBe(2);

    const { data: rows, error } = await service
      .from('project_overrides')
      .select('project_id, featured_order')
      .in('project_id', [first, second])
      .order('featured_order');
    expect(error).toBeNull();
    expect(rows).toEqual([
      { project_id: first, featured_order: 8 },
      { project_id: second, featured_order: 9 },
    ]);

    // One call, one revalidate — no per-slug tags.
    expect(tags.calls).toEqual(['projects']);
  });

  it('T-ACT-40 unknown project_id → not_found (per-project and batch)', async () => {
    expectFail(
      await callAction(
        curateProject,
        { project_id: randomUUID(), featured: true },
        { role: 'admin' },
      ),
      'not_found',
    );
    expectFail(
      await callAction(
        curateProject,
        { reorder: [{ project_id: randomUUID(), featured_order: 1 }] },
        { role: 'admin' },
      ),
      'not_found',
    );
  });

  it.each<{ name: string; input: CurateProjectInput }>([
    {
      name: 'featured_order 0',
      input: { project_id: randomUUID(), featured_order: 0 },
    },
    {
      name: 'featured_order 100',
      input: { project_id: randomUUID(), featured_order: 100 },
    },
    {
      name: 'title_override empty',
      input: { project_id: randomUUID(), title_override: '' },
    },
    {
      name: 'title_override 81 chars',
      input: { project_id: randomUUID(), title_override: 'x'.repeat(81) },
    },
    {
      name: 'description_override 257 chars',
      input: { project_id: randomUUID(), description_override: 'x'.repeat(257) },
    },
    {
      name: 'notes_md 20001 chars',
      input: { project_id: randomUUID(), notes_md: 'x'.repeat(20001) },
    },
    {
      name: 'extra_gallery 21 entries',
      input: {
        project_id: '00000000-0000-4000-8000-00000000ff01',
        extra_gallery: Array.from({ length: 21 }, (_, i) => ({
          path: `project-media/00000000-0000-4000-8000-00000000ff01/gallery/pic-${String(i)}.png`,
          ordering: i,
        })),
      },
    },
    {
      name: 'extra_gallery title 121 chars',
      input: {
        project_id: '00000000-0000-4000-8000-00000000ff01',
        extra_gallery: [
          {
            path: 'project-media/00000000-0000-4000-8000-00000000ff01/gallery/pic.png',
            title: 'x'.repeat(121),
            ordering: 0,
          },
        ],
      },
    },
    {
      name: "extra_gallery foreign path (another project's folder)",
      input: {
        project_id: randomUUID(),
        extra_gallery: [{ path: `project-media/${randomUUID()}/gallery/pic.png`, ordering: 0 }],
      },
    },
    {
      name: 'reorder 100 entries',
      input: {
        reorder: Array.from({ length: 100 }, (_, i) => ({
          project_id: randomUUID(),
          featured_order: (i % 99) + 1,
        })),
      },
    },
  ])('T-ACT-40 $name → validation', async ({ input }) => {
    expectFail(await callAction(curateProject, input, { role: 'admin' }), 'validation');
  });

  it("T-ACT-40 a well-formed own path still fails the HEAD check while `project-media` doesn't exist (S1.3 — ADR-0002 C10)", async () => {
    const projectId = await makeProject();
    const error = expectFail(
      await callAction(
        curateProject,
        {
          project_id: projectId,
          extra_gallery: [{ path: `project-media/${projectId}/gallery/pic.png`, ordering: 0 }],
        },
        { role: 'admin' },
      ),
      'validation',
    );
    expect(error.field).toBe('extra_gallery');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-40 — DB faults (T-ACT-0 (1)): the project read, the per-project upsert, the batch upsert
// ---------------------------------------------------------------------------------------------
describe('T-ACT-40 curateProject DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  async function overrideRows(projectId: string): Promise<number> {
    const { data, error } = await service
      .from('project_overrides')
      .select('project_id')
      .eq('project_id', projectId);
    if (error) throw new Error(error.message);
    return data.length;
  }

  it.each<{ name: string; target: { table: string; op: 'select' | 'upsert' }; batch: boolean }>([
    { name: 'the project read', target: { table: 'projects', op: 'select' }, batch: false },
    {
      name: 'the per-project override upsert',
      target: { table: 'project_overrides', op: 'upsert' },
      batch: false,
    },
    {
      name: 'the batch reorder upsert (not an FK miss)',
      target: { table: 'project_overrides', op: 'upsert' },
      batch: true,
    },
  ])(
    'T-ACT-40 $name fails → internal + one log.error line, no override row, no revalidate',
    async ({ target, batch }) => {
      const projectId = await makeProject();
      const tags = spyRevalidateTag();
      const input: CurateProjectInput = batch
        ? { reorder: [{ project_id: projectId, featured_order: 1 }] }
        : { project_id: projectId, featured: true };
      const res = await withDbFault(target, {}, () =>
        callAction(curateProject, input, { role: 'admin' }),
      );
      expectInternal(res, 'curateProject', logs);
      expect(await overrideRows(projectId)).toBe(0);
      expect(tags.calls).toEqual([]);
    },
  );
});
