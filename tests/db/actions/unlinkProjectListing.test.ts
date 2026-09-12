/**
 * tests/db/actions/unlinkProjectListing.test.ts — T-ACT-80 (05 §7.2; 04 §1.4
 * `unlinkProjectListing`; ADR-0037 D1; ADR-0002 C7; the `ref:null` clause of the S1.2 T-ACT-41).
 *
 * Both platforms, admin-only, scope `project_link` (30 / hour / user, shared with the link action).
 * `modrinth`: the ORDER is un-adopt → delete the link row → `downloads_modrinth = 0` (asserted
 * from inside the action with a `withDbHook` on the link delete: at that moment the un-adopt has
 * landed and the count is still the old one). The one-row-per-`version_number` rule: among this
 * project's adopted versions (`external_id IS NOT NULL`) carrying ≥ 1 hosted file, the row holding
 * a hosted `primary` file, else the newest `date_published`, gets `external_id = NULL`; any other
 * same-numbered adopted row keeps its id (the partial unique `project_versions_exclusive_version_key`);
 * rows with no hosted file keep their id too (they follow the listing on the next sync). CDN-only
 * file rows are kept (nothing but the fold deletes a synced row). No Modrinth call, ever.
 * `curseforge`: the row goes, `downloads_curseforge = 0`. Both revalidate `projects` +
 * `project:<slug>` and log the SC-24 line. A `source='modrinth'` row → `validation` (its listing
 * is its home). Success calls run as a FACTORY admin (the seed admin's budget stays untouched);
 * factory rows fall to `cleanupFactories` (link rows cascade with their project).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { unlinkProjectListing } from '@/lib/actions/projects';
import type { UnlinkProjectListingInput } from '@/lib/actions/projects.schema';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import {
  expectInternal,
  withDbFault,
  withDbHook,
  type DbCallTarget,
} from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeFile,
  makeProject,
  makeUser,
  makeVersion,
} from '@/tests/helpers/factories';
import {
  spyFetch,
  spyLog,
  spyRevalidateTag,
  type FetchSpy,
  type LogSpy,
} from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const MR_BASE = process.env.MODRINTH_API_BASE ?? '';
const CF_BASE = process.env.CURSEFORGE_API_BASE ?? '';

let adminId = '';
let activeFetch: FetchSpy | null = null;

/** Every upstream base is routed so a stray call is RECORDED (and answered) instead of dialling. */
function routes(): FetchSpy {
  activeFetch = spyFetch({ [`${MR_BASE}/`]: 'status:500', [`${CF_BASE}/`]: 'status:500' });
  return activeFetch;
}

const tag = (id: string): string => id.replace(/-/g, '').slice(0, 8);

function input(project: string, platform: 'modrinth' | 'curseforge'): UnlinkProjectListingInput {
  return { project_id: project, platform };
}

async function insertLink(
  projectId: string,
  platform: 'modrinth' | 'curseforge',
  downloads: number,
): Promise<void> {
  const externalId = `t_${platform}_${tag(projectId)}`;
  const { error } = await service.from('project_links').insert({
    project_id: projectId,
    platform,
    external_id: externalId,
    url:
      platform === 'modrinth'
        ? `https://modrinth.com/project/${externalId}`
        : `https://www.curseforge.com/minecraft/mc-mods/${externalId}`,
    downloads,
    synced_at: new Date().toISOString(),
  });
  if (error) throw new Error(`arrange: project_links insert failed: ${error.message}`);
}

async function linkPlatforms(projectId: string): Promise<string[]> {
  const { data, error } = await service
    .from('project_links')
    .select('platform')
    .eq('project_id', projectId)
    .order('platform');
  if (error) throw new Error(error.message);
  // Postgres orders an enum by declaration (`modrinth`, `curseforge`); sort by name here.
  return data.map((row) => row.platform).sort();
}

async function counts(
  projectId: string,
): Promise<{ downloads_curseforge: number; downloads_modrinth: number; slug: string }> {
  const { data, error } = await service
    .from('projects')
    .select('downloads_curseforge, downloads_modrinth, slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function externalIds(projectId: string): Promise<Record<string, string | null>> {
  const { data, error } = await service
    .from('project_versions')
    .select('id, external_id')
    .eq('project_id', projectId);
  if (error) throw new Error(error.message);
  return Object.fromEntries(data.map((row) => [row.id, row.external_id]));
}

function expectAdminLine(logs: LogSpy, actorId: string, targetId: string): void {
  const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
    (line) => line.msg === 'admin',
  );
  expect(adminLines).toHaveLength(1);
  const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
  expect(line.action).toBe('unlinkProjectListing');
  expect(line.meta.actor_profile_id).toBe(actorId);
  expect(line.meta.target_type).toBe('project_link');
  expect(line.meta.target_id).toBe(targetId);
  expect(line.meta.fields).toEqual(['project_id', 'platform']);
}

beforeAll(async () => {
  adminId = await makeUser({ role: 'admin' });
});

afterEach(() => {
  activeFetch?.restore();
  activeFetch = null;
});

afterAll(async () => {
  await clearRateLimitHits('project_link', adminId);
  await cleanupFactories();
});

describe('T-ACT-80 unlinkProjectListing', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: admin-only; moderators get `forbidden` (00 S1.5a.AC8).
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])(
    'T-ACT-80 $role → $code on both platforms, no rate-limit hit',
    async ({ role, code, message }) => {
      for (const platform of ['modrinth', 'curseforge'] as const) {
        const error = expectFail(
          await callAction(unlinkProjectListing, input(randomUUID(), platform), { role }),
          code,
        );
        expect(error.message).toBe(message);
      }
      if (role !== 'anon') {
        expect(await countRateLimitHits('project_link', SEED_ROLE_IDS[role])).toBe(0);
      }
    },
  );

  it('T-ACT-80 modrinth: un-adopt → link row deleted → downloads_modrinth = 0, in that order; one row per version_number; CDN rows kept; no Modrinth call; SC-24', async () => {
    const projectId = await makeProject({
      source: 'odsens',
      downloads_modrinth: 4321,
      downloads_curseforge: 9,
    });
    await insertLink(projectId, 'modrinth', 4321);
    await insertLink(projectId, 'curseforge', 9); // link row + count both untouched by a modrinth unlink
    const hosted = (versionId: string, name: string): string =>
      `project-files/${projectId}/${versionId}/${name}`;

    // 1.0.0 — one adopted row with a hosted primary + a CDN primary (one per home).
    const v100 = await makeVersion({
      project_id: projectId,
      external_id: `t_v100_${tag(projectId)}`,
      version_number: '1.0.0',
      date_published: '2026-01-01T00:00:00.000Z',
    });
    await makeFile({
      version_id: v100,
      filename: 'a.zip',
      storage_path: hosted(v100, 'a.zip'),
      primary: true,
    });
    const cdnOn100 = await makeFile({
      version_id: v100,
      filename: 'a-cdn.zip',
      url: 'https://cdn.modrinth.com/data/x/versions/y/a-cdn.zip',
      primary: true,
    });
    // 2.0.0 — two adopted rows (ADR-0026 duplicates): the OLDER one holds the hosted primary → it wins.
    const v200a = await makeVersion({
      project_id: projectId,
      external_id: `t_v200a_${tag(projectId)}`,
      version_number: '2.0.0',
      date_published: '2026-02-01T00:00:00.000Z',
    });
    await makeFile({
      version_id: v200a,
      filename: 'b.zip',
      storage_path: hosted(v200a, 'b.zip'),
      primary: true,
    });
    const v200b = await makeVersion({
      project_id: projectId,
      external_id: `t_v200b_${tag(projectId)}`,
      version_number: '2.0.0',
      date_published: '2026-03-01T00:00:00.000Z',
    });
    await makeFile({
      version_id: v200b,
      filename: 'b2.zip',
      storage_path: hosted(v200b, 'b2.zip'),
      primary: false,
    });
    // 3.0.0 — two adopted rows, no hosted primary on either → the NEWEST wins.
    const v300a = await makeVersion({
      project_id: projectId,
      external_id: `t_v300a_${tag(projectId)}`,
      version_number: '3.0.0',
      date_published: '2026-04-01T00:00:00.000Z',
    });
    await makeFile({
      version_id: v300a,
      filename: 'c.zip',
      storage_path: hosted(v300a, 'c.zip'),
      primary: false,
    });
    const v300b = await makeVersion({
      project_id: projectId,
      external_id: `t_v300b_${tag(projectId)}`,
      version_number: '3.0.0',
      date_published: '2026-05-01T00:00:00.000Z',
    });
    await makeFile({
      version_id: v300b,
      filename: 'c2.zip',
      storage_path: hosted(v300b, 'c2.zip'),
      primary: false,
    });
    // 4.0.0 — adopted, CDN-only → keeps its id (follows the listing on the next sync).
    const v400 = await makeVersion({
      project_id: projectId,
      external_id: `t_v400_${tag(projectId)}`,
      version_number: '4.0.0',
    });
    const cdnOn400 = await makeFile({
      version_id: v400,
      filename: 'd.zip',
      url: 'https://cdn.modrinth.com/data/x/versions/z/d.zip',
      primary: true,
    });

    const fetchSpy = routes();
    const tags = spyRevalidateTag();
    const logs = spyLog();
    // Seen from inside the action, right before the link row is deleted.
    let seenAtDelete: { unadopted: string | null; count: number; links: string[] } | null = null;
    try {
      const res = await withDbHook(
        { table: 'project_links', op: 'delete' },
        async () => {
          const ids = await externalIds(projectId);
          seenAtDelete = {
            unadopted: v100 in ids ? (ids[v100] ?? null) : 'missing',
            count: (await counts(projectId)).downloads_modrinth,
            links: await linkPlatforms(projectId),
          };
        },
        () =>
          callActionAs(unlinkProjectListing, input(projectId, 'modrinth'), { profileId: adminId }),
      );
      const data = expectOk(res);
      expect(data).toEqual({ link: null });
      expectAdminLine(logs, adminId, projectId);
    } finally {
      logs.restore();
    }

    // Order: the un-adopt had landed while the link row and the old count were still there.
    expect(seenAtDelete).toEqual({
      unadopted: null,
      count: 4321,
      links: ['curseforge', 'modrinth'],
    });

    // One row per version_number un-adopted; the others keep their Modrinth id.
    const ids = await externalIds(projectId);
    expect(ids[v100]).toBeNull();
    expect(ids[v200a]).toBeNull();
    expect(ids[v200b]).toBe(`t_v200b_${tag(projectId)}`);
    expect(ids[v300a]).toBe(`t_v300a_${tag(projectId)}`);
    expect(ids[v300b]).toBeNull();
    expect(ids[v400]).toBe(`t_v400_${tag(projectId)}`);

    // The link row is gone (the CurseForge one stays), the count is zero.
    expect(await linkPlatforms(projectId)).toEqual(['curseforge']);
    const after = await counts(projectId);
    expect(after.downloads_modrinth).toBe(0);
    expect(after.downloads_curseforge).toBe(9);

    // CDN-only file rows are kept — nothing but the fold deletes a synced row.
    const { data: cdnRows, error } = await service
      .from('project_files')
      .select('id')
      .in('id', [cdnOn100, cdnOn400]);
    expect(error).toBeNull();
    expect(cdnRows).toHaveLength(2);

    expect(fetchSpy.calls).toEqual([]);
    expect(tags.calls).toEqual(['projects', `project:${after.slug}`]);
  });

  it('T-ACT-80 modrinth: a version_number that already has a hosted (external_id NULL) row is skipped', async () => {
    const projectId = await makeProject({ source: 'odsens' });
    await insertLink(projectId, 'modrinth', 1);
    const hostedRow = await makeVersion({
      project_id: projectId,
      external_id: null,
      version_number: '1.0.0',
    });
    const adoptedTwin = await makeVersion({
      project_id: projectId,
      external_id: `t_twin_${tag(projectId)}`,
      version_number: '1.0.0',
      date_published: '2026-06-01T00:00:00.000Z',
    });
    await makeFile({
      version_id: adoptedTwin,
      storage_path: `project-files/${projectId}/${adoptedTwin}/t.zip`,
      primary: true,
    });

    routes();
    expectOk(
      await callActionAs(unlinkProjectListing, input(projectId, 'modrinth'), {
        profileId: adminId,
      }),
    );
    const ids = await externalIds(projectId);
    expect(ids[hostedRow]).toBeNull();
    // Un-adopting the twin would collide with the partial unique — it keeps its id.
    expect(ids[adoptedTwin]).toBe(`t_twin_${tag(projectId)}`);
    expect(await linkPlatforms(projectId)).toEqual([]);
  });

  it('T-ACT-80 curseforge: row deleted, downloads_curseforge = 0, the modrinth link untouched, revalidates, no call', async () => {
    const projectId = await makeProject({
      source: 'odsens',
      downloads_curseforge: 9,
      downloads_modrinth: 4,
    });
    await insertLink(projectId, 'curseforge', 9);
    await insertLink(projectId, 'modrinth', 4);
    const fetchSpy = routes();
    const tags = spyRevalidateTag();

    const data = expectOk(
      await callActionAs(unlinkProjectListing, input(projectId, 'curseforge'), {
        profileId: adminId,
      }),
    );
    expect(data).toEqual({ link: null });
    expect(await linkPlatforms(projectId)).toEqual(['modrinth']);
    const after = await counts(projectId);
    expect(after.downloads_curseforge).toBe(0);
    expect(after.downloads_modrinth).toBe(4);
    expect(fetchSpy.calls).toEqual([]);
    expect(tags.calls).toEqual(['projects', `project:${after.slug}`]);
  });

  it('T-ACT-80 no link row → ok {link: null} (idempotent), count zeroed', async () => {
    const projectId = await makeProject({ source: 'odsens', downloads_curseforge: 3 });
    routes();
    const data = expectOk(
      await callActionAs(unlinkProjectListing, input(projectId, 'curseforge'), {
        profileId: adminId,
      }),
    );
    expect(data).toEqual({ link: null });
    expect((await counts(projectId)).downloads_curseforge).toBe(0);
  });

  it("T-ACT-80 modrinth on a source='modrinth' row → validation (its listing is its home), versions untouched", async () => {
    const syncedId = await makeProject({ source: 'modrinth', external_id: `t_${randomUUID()}` });
    const version = await makeVersion({
      project_id: syncedId,
      external_id: `t_sv_${tag(syncedId)}`,
      version_number: '1.0.0',
    });
    await makeFile({
      version_id: version,
      storage_path: `project-files/${syncedId}/${version}/t.zip`,
    });
    routes();
    const onSynced = input(syncedId, 'modrinth');
    const error = expectFail(
      await callActionAs(unlinkProjectListing, onSynced, { profileId: adminId }),
      'validation',
    );
    expect(error.message).toBe('This project is synced from Modrinth already.');
    expect((await externalIds(syncedId))[version]).toBe(`t_sv_${tag(syncedId)}`);
  });

  it('T-ACT-80 unknown project_id → not_found', async () => {
    routes();
    const unknown = input(randomUUID(), 'modrinth');
    expectFail(
      await callActionAs(unlinkProjectListing, unknown, { profileId: adminId }),
      'not_found',
    );
  });

  it('T-ACT-80 31st call in an hour → rate_limited (the shared project_link scope)', async () => {
    const burner = await makeUser({ role: 'admin' });
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 30 }, () => ({ scope: 'project_link', key: burner })));
    expect(error).toBeNull();
    const overBudget = input(randomUUID(), 'curseforge');
    const limited = expectFail(
      await callActionAs(unlinkProjectListing, overBudget, { profileId: burner }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect(await countRateLimitHits('project_link', burner)).toBe(31);
    await clearRateLimitHits('project_link', burner);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-80 — DB faults (T-ACT-0 (1)) on each write of the modrinth path
// ---------------------------------------------------------------------------------------------
describe('T-ACT-80 unlinkProjectListing DB faults', () => {
  let faultAdmin = '';
  let logs: LogSpy;

  /** A fresh linked project per case — an earlier case's real writes must not shape the next. */
  async function arrangeLinked(): Promise<string> {
    const projectId = await makeProject({ source: 'odsens', downloads_modrinth: 2 });
    await insertLink(projectId, 'modrinth', 2);
    const version = await makeVersion({
      project_id: projectId,
      external_id: `t_fault_${tag(projectId)}`,
      version_number: '1.0.0',
    });
    await makeFile({
      version_id: version,
      storage_path: `project-files/${projectId}/${version}/f.zip`,
    });
    return projectId;
  }

  beforeAll(async () => {
    faultAdmin = await makeUser({ role: 'admin' });
  });

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
  });

  afterAll(async () => {
    await clearRateLimitHits('project_link', faultAdmin);
  });

  it.each<{ name: string; target: DbCallTarget }>([
    { name: 'the project read', target: { table: 'projects', op: 'select' } },
    { name: 'the un-adopt write', target: { table: 'project_versions', op: 'update' } },
    { name: 'the link delete', target: { table: 'project_links', op: 'delete' } },
    { name: 'the count zeroing', target: { table: 'projects', op: 'update' } },
  ])('T-ACT-80 $name fails → internal + one log.error line, no revalidate', async ({ target }) => {
    const projectId = await arrangeLinked();
    routes();
    const tags = spyRevalidateTag();
    const res = await withDbFault(target, {}, () =>
      callActionAs(unlinkProjectListing, input(projectId, 'modrinth'), { profileId: faultAdmin }),
    );
    expectInternal(res, 'unlinkProjectListing', logs);
    expect(tags.calls).toEqual([]);
    // The count is never zeroed ahead of a failed step (it is the LAST write).
    expect((await counts(projectId)).downloads_modrinth).toBe(2);
  });
});
