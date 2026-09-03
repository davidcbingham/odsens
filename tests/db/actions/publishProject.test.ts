/**
 * tests/db/actions/publishProject.test.ts — T-ACT-37 (05 §7.2; 04 §1.4 `publishProject`;
 * ADR-0002 C7 admin-only, #65 publish preconditions; migrations 20260827090000/90300).
 *
 * Admin only (matrix rows brief — same shape as T-ACT-34). `draft`→`published` sets `published_at`
 * when NULL and never overwrites it after (hidden → draft → published again keeps the first
 * timestamp). Preconditions (ADR-0002 #65: an icon AND ≥ 1 version with ≥ 1 STORED file):
 * `icon_url NULL` → `precondition_failed` naming the icon; no file with a `storage_path` →
 * `precondition_failed` "Nothing to download yet." (a file row WITHOUT `storage_path` — the synced
 * shape — does not count); both missing → both sentences. `published`→`hidden` and back to `draft`
 * are unguarded. A synced seed project → `forbidden`. Every success revalidates `projects` +
 * `project:<slug>`; after publish the row appears in `projects_public` for anon (definer view,
 * 05 T-RLS-22 sibling check).
 *
 * All mutations run on factory rows (`cleanupFactories` in `afterAll`); the publishable
 * arrangement is service-side (factory `icon_url` + version + file with `storage_path` — the
 * precondition reads the DB, not the bucket). The modrinth seed project only ever receives a
 * DENIED call, so seed rows stay byte-identical (05 H-1).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishProject } from '@/lib/actions/projects';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, type DbCallTarget } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeFile, makeProject, makeVersion } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const anon = asRole('anon');

afterAll(async () => {
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// Arrangements — service-side rows that satisfy (or deliberately miss) the ADR-0002 #65 gates
// ---------------------------------------------------------------------------------------------

/** DB-stored paths carry the bucket prefix (04 §1.4.5) — the shape the precondition query filters on. */
const storedPath = (projectId: string, versionId: string): string =>
  `project-files/${projectId}/${versionId}/t-pack.zip`;

const ICON = (projectId: string): string => `project-media/${projectId}/icon/0123456789abcdef.png`;

/** A draft exclusive project passing both publish preconditions: icon + a version with a stored file. */
async function makePublishableDraft(): Promise<{ projectId: string; slug: string }> {
  const projectId = randomUUID();
  await makeProject({ id: projectId, status: 'draft', icon_url: ICON(projectId) });
  const versionId = await makeVersion({ project_id: projectId });
  await makeFile({ version_id: versionId, storage_path: storedPath(projectId, versionId) });
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return { projectId, slug: data.slug };
}

async function statusAndPublishedAt(
  projectId: string,
): Promise<{ status: string; published_at: string | null }> {
  const { data, error } = await service
    .from('projects')
    .select('status, published_at')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------------------------
// T-ACT-37
// ---------------------------------------------------------------------------------------------

describe('T-ACT-37 publishProject', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: exclusive projects are admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-37 $role → $code', async ({ role, code, message }) => {
    const error = expectFail(
      await callAction(publishProject, { id: randomUUID(), status: 'published' }, { role }),
      code,
    );
    expect(error.message).toBe(message);
  });

  it('T-ACT-37 draft→published sets published_at when NULL; revalidates; row appears in projects_public', async () => {
    const { projectId, slug } = await makePublishableDraft();

    // Invisible while draft (ADR-0002 #38: no preview URLs) …
    const { data: before, error: beforeError } = await anon
      .from('projects_public')
      .select('id')
      .eq('id', projectId);
    expect(beforeError).toBeNull();
    expect(before).toEqual([]);

    const tags = spyRevalidateTag();
    const data = expectOk(
      await callAction(publishProject, { id: projectId, status: 'published' }, { role: 'admin' }),
    );
    expect(data).toEqual({ id: projectId, status: 'published' });
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);

    const row = await statusAndPublishedAt(projectId);
    expect(row.status).toBe('published');
    expect(row.published_at).not.toBeNull();

    // … and public through the definer view now (anon select).
    const { data: after, error: afterError } = await anon
      .from('projects_public')
      .select('id, slug')
      .eq('id', projectId);
    expect(afterError).toBeNull();
    expect(after).toEqual([{ id: projectId, slug }]);
  });

  it('T-ACT-37 icon_url NULL → precondition_failed and the message names the icon', async () => {
    const projectId = await makeProject({ status: 'draft' }); // icon_url stays NULL
    const versionId = await makeVersion({ project_id: projectId });
    await makeFile({ version_id: versionId, storage_path: storedPath(projectId, versionId) });

    const error = expectFail(
      await callAction(publishProject, { id: projectId, status: 'published' }, { role: 'admin' }),
      'precondition_failed',
    );
    expect(error.message).toBe('The project needs an icon.');
    expect((await statusAndPublishedAt(projectId)).status).toBe('draft');
  });

  it("T-ACT-37 no STORED file → precondition_failed 'Nothing to download yet.' (a storage_path-less row doesn't count)", async () => {
    const projectId = randomUUID();
    await makeProject({ id: projectId, status: 'draft', icon_url: ICON(projectId) });
    const versionId = await makeVersion({ project_id: projectId });
    await makeFile({ version_id: versionId }); // storage_path NULL — the synced (external URL) shape

    const error = expectFail(
      await callAction(publishProject, { id: projectId, status: 'published' }, { role: 'admin' }),
      'precondition_failed',
    );
    expect(error.message).toBe('Nothing to download yet.');
  });

  it('T-ACT-37 both missing → the message contains both sentences', async () => {
    const projectId = await makeProject({ status: 'draft' }); // no icon, no versions, no files

    const error = expectFail(
      await callAction(publishProject, { id: projectId, status: 'published' }, { role: 'admin' }),
      'precondition_failed',
    );
    expect(error.message).toContain('The project needs an icon.');
    expect(error.message).toContain('Nothing to download yet.');
    expect(error.message).toBe('The project needs an icon. Nothing to download yet.');
  });

  it('T-ACT-37 published→hidden and back→draft allowed; published_at set once, never overwritten', async () => {
    const { projectId, slug } = await makePublishableDraft();
    expectOk(
      await callAction(publishProject, { id: projectId, status: 'published' }, { role: 'admin' }),
    );
    const first = await statusAndPublishedAt(projectId);
    expect(first.published_at).not.toBeNull();

    // published → hidden
    const tags = spyRevalidateTag();
    const hid = expectOk(
      await callAction(publishProject, { id: projectId, status: 'hidden' }, { role: 'admin' }),
    );
    expect(hid).toEqual({ id: projectId, status: 'hidden' });
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
    expect((await statusAndPublishedAt(projectId)).status).toBe('hidden');

    // hidden → draft (back off the public site entirely)
    const back = expectOk(
      await callAction(publishProject, { id: projectId, status: 'draft' }, { role: 'admin' }),
    );
    expect(back).toEqual({ id: projectId, status: 'draft' });

    // draft → published again: published_at was non-NULL, so the first timestamp survives.
    expectOk(
      await callAction(publishProject, { id: projectId, status: 'published' }, { role: 'admin' }),
    );
    expect((await statusAndPublishedAt(projectId)).published_at).toBe(first.published_at);
  });

  it('T-ACT-37 a synced seed project → forbidden (synced projects are curated, not edited)', async () => {
    // Prove the row exists and is synced first — the denial must be the source check, not not_found.
    const { data: seed, error: seedError } = await service
      .from('projects')
      .select('source, status')
      .eq('id', SEED_PROJECTS.metalPipeMace)
      .single();
    expect(seedError).toBeNull();
    expect(seed).toEqual({ source: 'modrinth', status: 'published' });

    const error = expectFail(
      await callAction(
        publishProject,
        { id: SEED_PROJECTS.metalPipeMace, status: 'hidden' },
        { role: 'admin' },
      ),
      'forbidden',
    );
    expect(error.message).toBe('Synced projects are curated, not edited.');
    // Untouched (05 H-1).
    expect((await statusAndPublishedAt(SEED_PROJECTS.metalPipeMace)).status).toBe('published');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-37 — DB faults (T-ACT-0 (1)): the precondition read and the status write
// ---------------------------------------------------------------------------------------------
describe('T-ACT-37 publishProject DB faults', () => {
  let logs: LogSpy;

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  it.each<{ name: string; target: DbCallTarget }>([
    { name: 'the stored-file precondition read', target: { table: 'project_files', op: 'select' } },
    { name: 'the status write', target: { table: 'projects', op: 'update' } },
  ])(
    'T-ACT-37 $name fails → internal + one log.error line, still draft, no revalidate',
    async ({ target }) => {
      const { projectId } = await makePublishableDraft();
      const tags = spyRevalidateTag();
      const res = await withDbFault(target, {}, () =>
        callAction(publishProject, { id: projectId, status: 'published' }, { role: 'admin' }),
      );
      expectInternal(res, 'publishProject', logs);
      expect(await statusAndPublishedAt(projectId)).toEqual({
        status: 'draft',
        published_at: null,
      });
      expect(tags.calls).toEqual([]);
    },
  );
});
