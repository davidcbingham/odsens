/**
 * tests/db/actions/updateExclusiveProject.test.ts — T-ACT-36 (05 §7.2; 04 §1.4
 * `updateExclusiveProject`; ADR-0002 C7 admin-only; migration 20260827090000).
 *
 * Admin only (same matrix as T-ACT-34: banned seed account has role `user`, so `requireRole`'s rank
 * check answers `forbidden`; mods too — ADR-0002 C7). A `source='modrinth'` seed project →
 * `forbidden` ("Synced projects are curated, not edited." — synced rows are sync-owned, curation
 * lives in `project_overrides`). Slug changes are draft-only: while `draft` → A with BOTH
 * `project:<old>` and `project:<new>` tags revalidated (old pages must drop out of the cache);
 * while `published` → `conflict` (04 §1.4 "Slugs are fixed once a project is published."). Field
 * edits (`body_md`, `loaders`) land; extra `source` / `external_id` / `downloads_*` / `status` keys
 * are stripped by zod; every success revalidates `projects` + `project:<slug>`.
 *
 * All mutations run on factory rows (`cleanupFactories` in `afterAll`); the modrinth seed project
 * only ever receives a DENIED call, so seed rows stay byte-identical (05 H-1). The published
 * arrangement is `makeProject()`'s direct service insert (`status='published'` default) — the legal
 * shortcut past `publishProject`'s icon+file preconditions.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateExclusiveProject } from '@/lib/actions/projects';
import type { UpdateExclusiveProjectInput } from '@/lib/actions/projects.schema';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, type DbCallTarget } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

afterAll(async () => {
  await cleanupFactories();
});

/** A fresh valid slug per call — unique across parallel suites hitting the same local stack. */
const uniqueSlug = (): string => `t-${randomUUID().replace(/-/g, '').slice(0, 16)}`;

async function slugOf(projectId: string): Promise<string> {
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data.slug;
}

describe('T-ACT-36 updateExclusiveProject', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: exclusive projects are admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-36 $role → $code', async ({ role, code, message }) => {
    const error = expectFail(
      await callAction(updateExclusiveProject, { id: randomUUID(), title: 'Nope' }, { role }),
      code,
    );
    expect(error.message).toBe(message);
  });

  it("T-ACT-36 a source='modrinth' seed project → forbidden (synced projects are curated, not edited)", async () => {
    // Prove the row exists and is synced first — the denial must be the source check, not not_found.
    const { data: seed, error: seedError } = await service
      .from('projects')
      .select('source')
      .eq('id', SEED_PROJECTS.metalPipeMace)
      .single();
    expect(seedError).toBeNull();
    expect(seed).toEqual({ source: 'modrinth' });

    const error = expectFail(
      await callAction(
        updateExclusiveProject,
        { id: SEED_PROJECTS.metalPipeMace, title: 'Not yours to edit' },
        { role: 'admin' },
      ),
      'forbidden',
    );
    expect(error.message).toBe('Synced projects are curated, not edited.');
  });

  it('T-ACT-36 slug change while draft → ok; revalidates projects + BOTH project:<old> and project:<new>', async () => {
    const projectId = await makeProject({ status: 'draft' });
    const oldSlug = await slugOf(projectId);
    const newSlug = uniqueSlug();
    const tags = spyRevalidateTag();

    const data = expectOk(
      await callAction(updateExclusiveProject, { id: projectId, slug: newSlug }, { role: 'admin' }),
    );
    expect(data).toEqual({ id: projectId, slug: newSlug });
    expect(await slugOf(projectId)).toBe(newSlug);
    expect(tags.calls).toEqual(['projects', `project:${oldSlug}`, `project:${newSlug}`]);
  });

  it('T-ACT-36 slug change while published → conflict (slugs are fixed once published)', async () => {
    const projectId = await makeProject(); // odsens + status 'published' — the factory defaults
    const keptSlug = await slugOf(projectId);

    const error = expectFail(
      await callAction(
        updateExclusiveProject,
        { id: projectId, slug: uniqueSlug() },
        { role: 'admin' },
      ),
      'conflict',
    );
    expect(error.message).toBe('Slugs are fixed once a project is published.');
    expect(error.field).toBe('slug');
    expect(await slugOf(projectId)).toBe(keptSlug); // nothing moved
  });

  it('T-ACT-36 body_md/loaders edits land; revalidates projects + project:<slug>', async () => {
    const projectId = await makeProject({ status: 'draft' });
    const slug = await slugOf(projectId);
    const tags = spyRevalidateTag();

    expectOk(
      await callAction(
        updateExclusiveProject,
        { id: projectId, body_md: 'Updated body.', loaders: ['fabric', 'quilt'] },
        { role: 'admin' },
      ),
    );

    const { data: row, error } = await service
      .from('projects')
      .select('body_md, loaders')
      .eq('id', projectId)
      .single();
    expect(error).toBeNull();
    expect(row).toEqual({ body_md: 'Updated body.', loaders: ['fabric', 'quilt'] });
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
  });

  it('T-ACT-36 extra source/external_id/downloads_direct/status keys ignored (zod strips them)', async () => {
    const projectId = await makeProject({ status: 'draft' });
    const base: UpdateExclusiveProjectInput = { id: projectId, title: 'Kept title' };
    const input = Object.assign(base, {
      source: 'modrinth',
      external_id: 'sd424242',
      downloads_direct: 99,
      status: 'published',
    });

    expectOk(await callAction(updateExclusiveProject, input, { role: 'admin' }));

    const { data: row, error } = await service
      .from('projects')
      .select('source, external_id, downloads_direct, status, title')
      .eq('id', projectId)
      .single();
    expect(error).toBeNull();
    expect(row).toEqual({
      source: 'odsens',
      external_id: null,
      downloads_direct: 0,
      status: 'draft',
      title: 'Kept title',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-36 — every optional field, the slug clash the unique index answers, DB faults (T-ACT-0 (1))
// ---------------------------------------------------------------------------------------------
describe('T-ACT-36 updateExclusiveProject fields + slug clash + DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  it('T-ACT-36 every optional field lands (description, project_type, categories, game_versions, license, source_url, issues_url; discord_url null clears it)', async () => {
    const projectId = await makeProject({
      status: 'draft',
      discord_url: 'https://discord.gg/t-old',
    });
    const slug = await slugOf(projectId);
    const tags = spyRevalidateTag();
    expectOk(
      await callAction(
        updateExclusiveProject,
        {
          id: projectId,
          description: 'New blurb',
          project_type: 'datapack',
          categories: ['decoration', 'utility'],
          game_versions: ['1.21.4', '1.21.5'],
          license: 'MIT',
          source_url: 'https://github.com/odsens/t-pack',
          issues_url: 'https://github.com/odsens/t-pack/issues',
          discord_url: null,
        },
        { role: 'admin' },
      ),
    );
    const { data: row, error } = await service
      .from('projects')
      .select(
        'description, project_type, categories, game_versions, license, source_url, issues_url, discord_url',
      )
      .eq('id', projectId)
      .single();
    expect(error).toBeNull();
    expect(row).toEqual({
      description: 'New blurb',
      project_type: 'datapack',
      categories: ['decoration', 'utility'],
      game_versions: ['1.21.4', '1.21.5'],
      license: 'MIT',
      source_url: 'https://github.com/odsens/t-pack',
      issues_url: 'https://github.com/odsens/t-pack/issues',
      discord_url: null,
    });
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
  });

  it('T-ACT-36 a slug already taken (the Modrinth seed slug) while draft → conflict "That slug\'s taken.", slug unchanged', async () => {
    const projectId = await makeProject({ status: 'draft' });
    const keptSlug = await slugOf(projectId);
    const tags = spyRevalidateTag();
    const error = expectFail(
      await callAction(
        updateExclusiveProject,
        { id: projectId, slug: 'pixel-chameleon' },
        { role: 'admin' },
      ),
      'conflict',
    );
    expect(error.message).toBe("That slug's taken.");
    expect(error.field).toBe('slug');
    expect(await slugOf(projectId)).toBe(keptSlug);
    expect(tags.calls).toEqual([]);
  });

  it.each<{ name: string; target: DbCallTarget }>([
    { name: 'the project read', target: { table: 'projects', op: 'select' } },
    { name: 'the update', target: { table: 'projects', op: 'update' } },
  ])(
    'T-ACT-36 $name fails → internal + one log.error line, row unchanged, no revalidate',
    async ({ target }) => {
      const projectId = await makeProject({ status: 'draft' });
      const tags = spyRevalidateTag();
      const res = await withDbFault(target, {}, () =>
        callAction(updateExclusiveProject, { id: projectId, title: 'Faulted' }, { role: 'admin' }),
      );
      expectInternal(res, 'updateExclusiveProject', logs);
      const { data } = await service.from('projects').select('title').eq('id', projectId).single();
      expect(data?.title).not.toBe('Faulted');
      expect(tags.calls).toEqual([]);
    },
  );
});
