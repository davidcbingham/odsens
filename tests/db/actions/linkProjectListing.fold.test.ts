/**
 * tests/db/actions/linkProjectListing.fold.test.ts — T-ACT-81 (05 §7.2; ADR-0037 D3 the fold;
 * 00 S1.5a.AC3 / AC9; migration 20260911120300 `fold_project`, 20260911120100 `project_redirects`).
 *
 * Two sections (H-4 one file per action — the fold IS the action's step (c)):
 *   1. RPC-direct (supabase-ops, lane A): `fold_project(duplicate, canonical)` through the service
 *      client — the merge order on a same-numbered version (files moved / CDN-only sha512 duplicate
 *      dropped after the canonical row gains its `url` / duplicate version row deleted / canonical
 *      row takes the `external_id` + sync-owned columns), a different-numbered version re-parented,
 *      hosted `primary` kept (canonical wins), the comment re-targeted, `downloads_direct` carried,
 *      the redirect row, the duplicate row gone, the jsonb return shape; the preconditions raise a
 *      plain P0002 message and write nothing; a second call names a deleted duplicate → raises;
 *      ONE transaction — a `before delete` trigger (psql) that blocks step (h) on the test duplicate
 *      leaves every moved row where it was; a canonical that already holds the duplicate's link
 *      platform keeps its row and count (the duplicate's is dropped — canonical wins).
 *   2. Via `linkProjectListing` (backend-robustness, lane B) — appended below the marker; includes
 *      the failed-fold → hourly-run → re-link path (a synced same-numbered version the sync already
 *      re-parented onto the canonical merges on the re-link — 00 S1.5a.AC2).
 *
 * Fixtures are factory rows only (never a seed row — 05 H-1): the duplicate is deleted by the fold,
 * so `cleanupFactories`' delete of it affects 0 rows (a no-op by design); the merged duplicate
 * version and the deduped CDN file likewise. The canonical project's redirect row and moved
 * children cascade with it. `makeComment` bumps `seed_user.comment_count`; `cleanupFactories`
 * restores the SEED-3 value.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole } from '@/tests/helpers/asRole';
import {
  cleanupFactories,
  makeComment,
  makeFile,
  makeProject,
  makeVersion,
} from '@/tests/helpers/factories';
import { hasPsql, sql } from '@/tests/helpers/db';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';

const service = asRole('service');

const tag = (id: string): string => id.replace(/-/g, '').slice(0, 8);

type FoldResult = {
  versions_moved: number;
  versions_merged: number;
  files_moved: number;
  files_deduped: number;
  comments_moved: number;
  downloads_moved: number;
  downloads_direct_moved: number;
  links_moved: number;
  redirect_slug: string;
};

async function fold(
  duplicateId: string,
  canonicalId: string,
): Promise<{ data: FoldResult | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await service.rpc('fold_project', {
    p_duplicate_id: duplicateId,
    p_canonical_id: canonicalId,
  });
  return { data: (data as FoldResult | null) ?? null, error };
}

// =============================================================================================
// Section 1 — RPC-direct (lane A, supabase-ops)
// =============================================================================================
describe('T-ACT-81 fold_project — RPC-direct', () => {
  const SHARED_SHA = `t_sha_shared_${randomUUID().replace(/-/g, '')}`;
  const OTHER_SHA = `t_sha_other_${randomUUID().replace(/-/g, '')}`;

  let canonicalId = '';
  let duplicateId = '';
  let duplicateSlug = '';
  let duplicateExternalId = '';
  let hostedVersionId = '';
  let hostedFileId = '';
  let dupSameVersionId = '';
  let dupSameExternalId = '';
  let dupSharedFileId = '';
  let dupOtherFileId = '';
  let dupNewVersionId = '';
  let dupNewFileId = '';
  let commentId = '';

  beforeAll(async () => {
    // The canonical odsens row: hosted version 1.0.0 with one hosted primary file (sha SHARED).
    canonicalId = await makeProject({
      source: 'odsens',
      status: 'published',
      downloads_direct: 5,
    });
    hostedVersionId = await makeVersion({
      project_id: canonicalId,
      version_number: '1.0.0',
      date_published: '2026-05-01T12:00:00.000Z',
    });
    hostedFileId = await makeFile({
      version_id: hostedVersionId,
      filename: 'pack-1.0.0.zip',
      sha512: SHARED_SHA,
      storage_path: `project-files/${canonicalId}/${hostedVersionId}/pack-1.0.0.zip`,
      primary: true,
      download_count: 4,
    });

    // The duplicate the sync imported: synced 1.0.0 (a CDN file with the SAME bytes + one other) and
    // a synced 1.1.0 the canonical does not have; one comment; a curseforge link; downloads_direct 3.
    duplicateId = await makeProject({
      source: 'modrinth',
      external_id: `t_listing_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      status: 'published',
      downloads_direct: 3,
    });
    const dupRow = await service
      .from('projects')
      .select('slug, external_id')
      .eq('id', duplicateId)
      .single();
    duplicateSlug = dupRow.data?.slug ?? '';
    duplicateExternalId = dupRow.data?.external_id ?? '';

    dupSameExternalId = `t_v_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    dupSameVersionId = await makeVersion({
      project_id: duplicateId,
      external_id: dupSameExternalId,
      version_number: '1.0.0',
      name: 'Modrinth one point oh',
      changelog_md: 'from modrinth',
      game_versions: ['1.21.1'],
      loaders: ['fabric'],
      version_type: 'release',
      date_published: '2026-05-02T12:00:00.000Z',
      downloads: 42,
    });
    dupSharedFileId = await makeFile({
      version_id: dupSameVersionId,
      filename: 'pack-1.0.0.zip',
      sha512: SHARED_SHA,
      url: `https://cdn.modrinth.com/data/${duplicateExternalId}/versions/${dupSameExternalId}/pack-1.0.0.zip`,
      primary: true,
    });
    dupOtherFileId = await makeFile({
      version_id: dupSameVersionId,
      filename: 'pack-1.0.0-sources.zip',
      sha512: OTHER_SHA,
      url: `https://cdn.modrinth.com/data/${duplicateExternalId}/versions/${dupSameExternalId}/pack-1.0.0-sources.zip`,
      primary: false,
    });
    dupNewVersionId = await makeVersion({
      project_id: duplicateId,
      external_id: `t_v_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      version_number: '1.1.0',
      date_published: '2026-06-01T12:00:00.000Z',
      downloads: 7,
    });
    dupNewFileId = await makeFile({
      version_id: dupNewVersionId,
      filename: 'pack-1.1.0.zip',
      sha512: `t_sha_new_${tag(dupNewVersionId)}`,
      url: `https://cdn.modrinth.com/data/${duplicateExternalId}/versions/x/pack-1.1.0.zip`,
      primary: true,
    });
    commentId = await makeComment({ target_id: duplicateId });
    const link = await service.from('project_links').insert({
      project_id: duplicateId,
      platform: 'curseforge',
      external_id: `t_cf_${tag(duplicateId)}`,
      url: `https://www.curseforge.com/minecraft/mc-mods/t-cf-${tag(duplicateId)}`,
      downloads: 9,
      synced_at: new Date().toISOString(),
    });
    if (link.error) throw new Error(`arrange: project_links insert failed: ${link.error.message}`);
  });

  afterAll(cleanupFactories);

  it('T-ACT-81 preconditions raise a plain P0002 message and write nothing', async () => {
    const cases: Array<[string, string, string]> = [
      [canonicalId, canonicalId, 'A project cannot be folded into itself.'],
      [randomUUID(), canonicalId, 'That duplicate project is gone already.'],
      [duplicateId, randomUUID(), 'That project could not be found.'],
      [canonicalId, duplicateId, 'Only a project synced from Modrinth can be folded.'],
      [
        duplicateId,
        SEED_PROJECTS.metalPipeMace,
        'A listing can only be folded into an odsens project.',
      ],
    ];
    for (const [dup, can, message] of cases) {
      const { data, error } = await fold(dup, can);
      expect(error?.code, message).toBe('P0002');
      expect(error?.message, message).toBe(message);
      expect(data).toBeNull();
    }
    // Nothing written: both rows still there, no redirect, the comment still on the duplicate.
    const rows = await service.from('projects').select('id').in('id', [canonicalId, duplicateId]);
    expect(rows.data).toHaveLength(2);
    const redirect = await service
      .from('project_redirects')
      .select('old_slug')
      .eq('project_id', canonicalId);
    expect(redirect.data).toEqual([]);
    const comment = await service.from('comments').select('target_id').eq('id', commentId).single();
    expect(comment.data?.target_id).toBe(duplicateId);
  });

  it('T-ACT-81 folds the duplicate into the canonical row in the D3 order and returns the counts', async () => {
    const { data, error } = await fold(duplicateId, canonicalId);
    expect(error).toBeNull();
    expect(data).toEqual({
      versions_moved: 1,
      versions_merged: 1,
      files_moved: 1,
      files_deduped: 1,
      comments_moved: 1,
      downloads_moved: 0,
      downloads_direct_moved: 3,
      links_moved: 1,
      redirect_slug: duplicateSlug,
    });

    // (h) the duplicate projects row is gone.
    const gone = await service.from('projects').select('id').eq('id', duplicateId);
    expect(gone.data).toEqual([]);

    // (a) merge: the canonical hosted 1.0.0 row survives (same id), took the Modrinth external_id and
    // the sync-owned columns; the duplicate 1.0.0 row was deleted.
    const versions = await service
      .from('project_versions')
      .select('id, project_id, external_id, version_number, name, changelog_md, downloads, loaders')
      .eq('project_id', canonicalId)
      .order('version_number');
    expect(versions.error).toBeNull();
    expect(versions.data).toEqual([
      {
        id: hostedVersionId,
        project_id: canonicalId,
        external_id: dupSameExternalId,
        version_number: '1.0.0',
        name: 'Modrinth one point oh',
        changelog_md: 'from modrinth',
        downloads: 42,
        loaders: ['fabric'],
      },
      // (b) 1.1.0 re-parented as-is.
      expect.objectContaining({
        id: dupNewVersionId,
        project_id: canonicalId,
        version_number: '1.1.0',
        downloads: 7,
      }),
    ]);
    const mergedAway = await service
      .from('project_versions')
      .select('id')
      .eq('id', dupSameVersionId);
    expect(mergedAway.data).toEqual([]);

    // Files on the merged 1.0.0: the hosted row kept its storage_path, primary and download_count and
    // gained the CDN url from the sha512 twin; the twin CDN-only row was dropped; the other CDN file
    // moved over (not primary — canonical wins, and it never was).
    const files = await service
      .from('project_files')
      .select('id, filename, sha512, url, storage_path, primary, download_count')
      .eq('version_id', hostedVersionId)
      .order('filename');
    expect(files.error).toBeNull();
    expect(files.data).toEqual([
      {
        id: dupOtherFileId,
        filename: 'pack-1.0.0-sources.zip',
        sha512: OTHER_SHA,
        url: `https://cdn.modrinth.com/data/${duplicateExternalId}/versions/${dupSameExternalId}/pack-1.0.0-sources.zip`,
        storage_path: null,
        primary: false,
        download_count: 0,
      },
      {
        id: hostedFileId,
        filename: 'pack-1.0.0.zip',
        sha512: SHARED_SHA,
        url: `https://cdn.modrinth.com/data/${duplicateExternalId}/versions/${dupSameExternalId}/pack-1.0.0.zip`,
        storage_path: `project-files/${canonicalId}/${hostedVersionId}/pack-1.0.0.zip`,
        primary: true,
        download_count: 4,
      },
    ]);
    const deduped = await service.from('project_files').select('id').eq('id', dupSharedFileId);
    expect(deduped.data).toEqual([]);
    const movedNew = await service
      .from('project_files')
      .select('version_id, primary')
      .eq('id', dupNewFileId)
      .single();
    expect(movedNew.data).toEqual({ version_id: dupNewVersionId, primary: true });

    // (c) the curseforge link re-parented and its count carried; (e) downloads_direct carried.
    const links = await service
      .from('project_links')
      .select('platform, downloads')
      .eq('project_id', canonicalId);
    expect(links.data).toEqual([{ platform: 'curseforge', downloads: 9 }]);
    const project = await service
      .from('projects')
      .select('downloads_direct, downloads_curseforge')
      .eq('id', canonicalId)
      .single();
    expect(project.data).toEqual({ downloads_direct: 8, downloads_curseforge: 9 });

    // (d) the comment now targets the canonical project.
    const comment = await service.from('comments').select('target_id').eq('id', commentId).single();
    expect(comment.data?.target_id).toBe(canonicalId);

    // (g) the old slug resolves to the canonical row.
    const redirect = await service
      .from('project_redirects')
      .select('old_slug, project_id')
      .eq('old_slug', duplicateSlug);
    expect(redirect.data).toEqual([{ old_slug: duplicateSlug, project_id: canonicalId }]);
  });

  it('T-ACT-81 a second call naming the deleted duplicate raises "gone already" (the action never issues it)', async () => {
    const { data, error } = await fold(duplicateId, canonicalId);
    expect(error?.code).toBe('P0002');
    expect(error?.message).toBe('That duplicate project is gone already.');
    expect(data).toBeNull();
  });
});

describe('T-ACT-81 fold_project — one transaction; canonical wins on links', () => {
  /** A blocking `before delete` trigger on ONE test row, created through psql (no PostgREST surface). */
  const BLOCK_FN = 'public.t_fold_block_delete';
  const BLOCK_TRIGGER = 't_fold_block';

  async function blockDeleteOf(projectId: string): Promise<void> {
    sql(
      `create or replace function ${BLOCK_FN}() returns trigger language plpgsql as $$ ` +
        `begin raise exception 'blocked by the test at step (h)' using errcode = 'P0001'; end $$;`,
    );
    sql(
      `create trigger ${BLOCK_TRIGGER} before delete on public.projects for each row ` +
        `when (old.id = '${projectId}'::uuid) execute function ${BLOCK_FN}();`,
    );
  }

  function unblock(): void {
    sql(`drop trigger if exists ${BLOCK_TRIGGER} on public.projects;`);
    sql(`drop function if exists ${BLOCK_FN}();`);
  }

  afterAll(async () => {
    if (hasPsql()) unblock();
    await cleanupFactories();
  });

  it.skipIf(!hasPsql())(
    'T-ACT-81 a failure at step (h) rolls the whole fold back: nothing moved, merged, deleted or redirected',
    async () => {
      const sha = `t_sha_atomic_${randomUUID().replace(/-/g, '')}`;
      const canonicalId = await makeProject({
        source: 'odsens',
        status: 'published',
        downloads_direct: 5,
      });
      const hostedVersionId = await makeVersion({
        project_id: canonicalId,
        version_number: '1.0.0',
      });
      const hostedFileId = await makeFile({
        version_id: hostedVersionId,
        filename: 'pack-1.0.0.zip',
        sha512: sha,
        storage_path: `project-files/${canonicalId}/${hostedVersionId}/pack-1.0.0.zip`,
        primary: true,
      });
      const duplicateId = await makeProject({
        source: 'modrinth',
        external_id: `t_listing_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        status: 'published',
        downloads_direct: 3,
      });
      const dupSlug = (await service.from('projects').select('slug').eq('id', duplicateId).single())
        .data?.slug;
      const dupSameExternalId = `t_v_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const dupSameVersionId = await makeVersion({
        project_id: duplicateId,
        external_id: dupSameExternalId,
        version_number: '1.0.0',
      });
      const dupTwinFileId = await makeFile({
        version_id: dupSameVersionId,
        filename: 'pack-1.0.0.zip',
        sha512: sha,
        url: 'https://cdn.modrinth.com/data/x/versions/y/pack-1.0.0.zip',
        primary: true,
      });
      const dupNewVersionId = await makeVersion({
        project_id: duplicateId,
        external_id: `t_v_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        version_number: '1.1.0',
      });
      const commentId = await makeComment({ target_id: duplicateId });
      const link = await service.from('project_links').insert({
        project_id: duplicateId,
        platform: 'curseforge',
        external_id: `t_cf_${tag(duplicateId)}`,
        url: `https://www.curseforge.com/minecraft/mc-mods/t-cf-${tag(duplicateId)}`,
        downloads: 9,
        synced_at: new Date().toISOString(),
      });
      if (link.error)
        throw new Error(`arrange: project_links insert failed: ${link.error.message}`);

      await blockDeleteOf(duplicateId);
      try {
        const { data, error } = await fold(duplicateId, canonicalId);
        expect(data).toBeNull();
        expect(error?.code).toBe('P0001');
        expect(error?.message).toBe('blocked by the test at step (h)');
      } finally {
        unblock();
      }

      // Every earlier step rolled back with (h): the merge (a), the move (b), the link (c), the
      // comment (d), the counter (e), the redirect (g).
      expect((await service.from('projects').select('id').eq('id', duplicateId)).data).toEqual([
        { id: duplicateId },
      ]);
      const versions = await service
        .from('project_versions')
        .select('id, project_id, external_id')
        .in('id', [hostedVersionId, dupSameVersionId, dupNewVersionId])
        .order('version_number');
      expect(versions.data).toEqual(
        expect.arrayContaining([
          { id: hostedVersionId, project_id: canonicalId, external_id: null },
          { id: dupSameVersionId, project_id: duplicateId, external_id: dupSameExternalId },
          { id: dupNewVersionId, project_id: duplicateId, external_id: expect.any(String) },
        ]),
      );
      expect(versions.data).toHaveLength(3);
      const files = await service
        .from('project_files')
        .select('id, version_id, url')
        .in('id', [hostedFileId, dupTwinFileId]);
      expect(files.data).toEqual(
        expect.arrayContaining([
          { id: hostedFileId, version_id: hostedVersionId, url: null },
          {
            id: dupTwinFileId,
            version_id: dupSameVersionId,
            url: 'https://cdn.modrinth.com/data/x/versions/y/pack-1.0.0.zip',
          },
        ]),
      );
      expect(files.data).toHaveLength(2);
      expect(
        (await service.from('project_links').select('project_id').eq('project_id', duplicateId))
          .data,
      ).toEqual([{ project_id: duplicateId }]);
      expect(
        (await service.from('comments').select('target_id').eq('id', commentId).single()).data
          ?.target_id,
      ).toBe(duplicateId);
      const canonical = await service
        .from('projects')
        .select('downloads_direct, downloads_curseforge')
        .eq('id', canonicalId)
        .single();
      expect(canonical.data).toEqual({ downloads_direct: 5, downloads_curseforge: 0 });
      expect(
        (
          await service
            .from('project_redirects')
            .select('project_id')
            .eq('old_slug', dupSlug ?? '')
        ).data,
      ).toEqual([]);

      // With the block gone the same fold completes (nothing was half-written).
      const retry = await fold(duplicateId, canonicalId);
      expect(retry.error).toBeNull();
      expect(retry.data).toMatchObject({ versions_merged: 1, versions_moved: 1, links_moved: 1 });
    },
  );

  it("T-ACT-81 (c) canonical wins: a canonical that already has the platform keeps its link and count; the duplicate's row is dropped", async () => {
    const canonicalId = await makeProject({
      source: 'odsens',
      status: 'published',
      downloads_curseforge: 5,
    });
    const canonicalCf = `t_cf_can_${tag(canonicalId)}`;
    const own = await service.from('project_links').insert({
      project_id: canonicalId,
      platform: 'curseforge',
      external_id: canonicalCf,
      url: `https://www.curseforge.com/minecraft/mc-mods/${canonicalCf}`,
      downloads: 5,
      synced_at: new Date().toISOString(),
    });
    if (own.error) throw new Error(`arrange: project_links insert failed: ${own.error.message}`);
    const duplicateId = await makeProject({
      source: 'modrinth',
      external_id: `t_listing_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      status: 'published',
    });
    const dupCf = `t_cf_dup_${tag(duplicateId)}`;
    const theirs = await service.from('project_links').insert({
      project_id: duplicateId,
      platform: 'curseforge',
      external_id: dupCf,
      url: `https://www.curseforge.com/minecraft/mc-mods/${dupCf}`,
      downloads: 9,
      synced_at: new Date().toISOString(),
    });
    if (theirs.error) {
      throw new Error(`arrange: project_links insert failed: ${theirs.error.message}`);
    }

    const { data, error } = await fold(duplicateId, canonicalId);
    expect(error).toBeNull();
    expect(data).toMatchObject({ links_moved: 0 });
    const links = await service
      .from('project_links')
      .select('project_id, external_id, downloads')
      .eq('platform', 'curseforge')
      .in('external_id', [canonicalCf, dupCf]);
    expect(links.data).toEqual([
      { project_id: canonicalId, external_id: canonicalCf, downloads: 5 },
    ]);
    const project = await service
      .from('projects')
      .select('downloads_curseforge')
      .eq('id', canonicalId)
      .single();
    expect(project.data?.downloads_curseforge).toBe(5);
  });
});

// =============================================================================================
// Section 2 — via `linkProjectListing` (lane B, backend-robustness) — append below this line.
// =============================================================================================

/*
 * Section 2 harness (lane B): the action builds the adapter from `lib/env.ts`, so `spyFetch`
 * routes `MODRINTH_API_BASE/project/sd000199` to `modrinth/project/sd000199.json` (id
 * `sd000199`, 4321 downloads — a listing absent from the 18-project list, so no sync run ever
 * imports it; the duplicate below is a factory row carrying that id). A second listing id is
 * derived in-memory for the fold-failure case (never a `projects` row of its own until arranged).
 * Success calls run as a FACTORY admin (the seed admin's `project_link` budget stays untouched).
 */
import { afterEach, beforeEach } from 'vitest';
import { linkProjectListing } from '@/lib/actions/projects';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault, withDbHook } from '@/tests/helpers/dbFault';
import { makeUser } from '@/tests/helpers/factories';
import { clearRateLimitHits } from '@/tests/helpers/arrange';
import {
  spyFetch,
  spyLog,
  spyRevalidateTag,
  type FetchSpy,
  type LogSpy,
} from '@/tests/helpers/spies';

setupActionMocks();

const MR_BASE = process.env.MODRINTH_API_BASE ?? '';
const LISTING_ID = 'sd000199';
const LISTING_DOWNLOADS = 4321;
const LISTING_URL = `${MR_BASE}/project/${LISTING_ID}`;
const FAIL_LISTING_ID = 't_fold_fail_listing';
const FAIL_LISTING_URL = `${MR_BASE}/project/${FAIL_LISTING_ID}`;
/** The failed-fold → hourly-run → re-link path (00 S1.5a.AC2 on the recovery path). */
const MERGE_LISTING_ID = 't_fold_merge_listing';
const MERGE_LISTING_URL = `${MR_BASE}/project/${MERGE_LISTING_ID}`;

const HEX64 = (): string => randomUUID().replace(/-/g, '').padEnd(64, '0');

function routes(): FetchSpy {
  return spyFetch({
    [LISTING_URL]: 'modrinth/project/sd000199.json',
    [FAIL_LISTING_URL]: () =>
      Response.json({
        id: FAIL_LISTING_ID,
        slug: 't-fold-fail',
        project_type: 'mod',
        title: 'Fold fail listing',
        description: 'A listing whose fold is faulted once.',
        downloads: 11,
      }),
    [MERGE_LISTING_URL]: () =>
      Response.json({
        id: MERGE_LISTING_ID,
        slug: 't-fold-merge',
        project_type: 'mod',
        title: 'Fold merge listing',
        description: 'A listing whose fold is faulted once, then re-parented by the sync.',
        downloads: 13,
      }),
  });
}

/** A `project_downloads` row (the SC-17 hashed log) on a hosted file — service-arranged. */
async function insertDownloadRow(projectId: string, fileId: string): Promise<string> {
  const { data, error } = await service
    .from('project_downloads')
    .insert({ project_id: projectId, file_id: fileId, ip_hash: HEX64(), ua_hash: HEX64() })
    .select('id')
    .single();
  if (error) throw new Error(`arrange: project_downloads insert failed: ${error.message}`);
  return data.id;
}

describe('T-ACT-81 the fold via linkProjectListing (ADR-0037 D1 step (c) + D3)', () => {
  const SHARED_SHA = `t_sha_shared_${randomUUID().replace(/-/g, '')}`;
  const OTHER_SHA = `t_sha_other_${randomUUID().replace(/-/g, '')}`;

  let adminId = '';
  let canonicalId = '';
  let canonicalSlug = '';
  let duplicateId = '';
  let duplicateSlug = '';
  let hostedVersionId = '';
  let hostedFileId = '';
  let canonicalDownloadRow = '';
  let dupSameVersionId = '';
  let dupSameExternalId = '';
  let dupSharedFileId = '';
  let dupOtherFileId = '';
  let dupNewVersionId = '';
  let dupNewFileId = '';
  let dupDownloadRow = '';
  let commentId = '';
  let activeFetch: FetchSpy | null = null;

  beforeAll(async () => {
    adminId = await makeUser({ role: 'admin' });

    // The canonical odsens row: published, downloads_direct 5, an override (title wins), hosted
    // 1.0.0 with a hosted primary file (sha SHARED, 4 direct downloads) and one download log row.
    canonicalId = await makeProject({
      source: 'odsens',
      status: 'published',
      downloads_direct: 5,
    });
    const canonicalRow = await service
      .from('projects')
      .select('slug')
      .eq('id', canonicalId)
      .single();
    canonicalSlug = canonicalRow.data?.slug ?? '';
    const canonicalOverride = await service.from('project_overrides').insert({
      project_id: canonicalId,
      title_override: 'Canonical title',
      extra_gallery: [{ path: `project-media/${canonicalId}/gallery/a.png`, ordering: 1 }],
    });
    if (canonicalOverride.error) throw new Error(canonicalOverride.error.message);
    hostedVersionId = await makeVersion({
      project_id: canonicalId,
      version_number: '1.0.0',
      date_published: '2026-05-01T12:00:00.000Z',
    });
    hostedFileId = await makeFile({
      version_id: hostedVersionId,
      filename: 'pack-1.0.0.zip',
      sha512: SHARED_SHA,
      storage_path: `project-files/${canonicalId}/${hostedVersionId}/pack-1.0.0.zip`,
      primary: true,
      download_count: 4,
    });
    canonicalDownloadRow = await insertDownloadRow(canonicalId, hostedFileId);

    // The duplicate the sync imported for `sd000199`: synced 1.0.0 (a CDN twin of the hosted file +
    // one other CDN file), a 1.1.0 carrying a HOSTED file (D5 — Modrinth-first rows may host) with
    // its own download log row, a comment, a curseforge link, an override, downloads_direct 3.
    duplicateId = await makeProject({
      source: 'modrinth',
      external_id: LISTING_ID,
      status: 'published',
      downloads_direct: 3,
    });
    const dupRow = await service.from('projects').select('slug').eq('id', duplicateId).single();
    duplicateSlug = dupRow.data?.slug ?? '';
    const dupOverride = await service.from('project_overrides').insert({
      project_id: duplicateId,
      featured: true,
      featured_order: 3,
      title_override: 'Duplicate title',
      extra_gallery: [{ path: `project-media/${duplicateId}/gallery/b.png`, ordering: 1 }],
    });
    if (dupOverride.error) throw new Error(dupOverride.error.message);

    dupSameExternalId = `t_v_${tag(duplicateId)}`;
    dupSameVersionId = await makeVersion({
      project_id: duplicateId,
      external_id: dupSameExternalId,
      version_number: '1.0.0',
      name: 'Modrinth one point oh',
      changelog_md: 'from modrinth',
      game_versions: ['1.21.1'],
      loaders: ['fabric'],
      date_published: '2026-05-02T12:00:00.000Z',
      downloads: 42,
    });
    dupSharedFileId = await makeFile({
      version_id: dupSameVersionId,
      filename: 'pack-1.0.0.zip',
      sha512: SHARED_SHA,
      url: `https://cdn.modrinth.com/data/${LISTING_ID}/versions/${dupSameExternalId}/pack-1.0.0.zip`,
      primary: true,
    });
    dupOtherFileId = await makeFile({
      version_id: dupSameVersionId,
      filename: 'pack-1.0.0-sources.zip',
      sha512: OTHER_SHA,
      url: `https://cdn.modrinth.com/data/${LISTING_ID}/versions/${dupSameExternalId}/pack-1.0.0-sources.zip`,
      primary: false,
    });
    dupNewVersionId = await makeVersion({
      project_id: duplicateId,
      external_id: `t_v2_${tag(duplicateId)}`,
      version_number: '1.1.0',
      date_published: '2026-06-01T12:00:00.000Z',
      downloads: 7,
    });
    dupNewFileId = await makeFile({
      version_id: dupNewVersionId,
      filename: 'pack-1.1.0.zip',
      sha512: `t_sha_new_${tag(dupNewVersionId)}`,
      storage_path: `project-files/${duplicateId}/${dupNewVersionId}/pack-1.1.0.zip`,
      primary: true,
      download_count: 2,
    });
    dupDownloadRow = await insertDownloadRow(duplicateId, dupNewFileId);
    commentId = await makeComment({ target_id: duplicateId });
    const link = await service.from('project_links').insert({
      project_id: duplicateId,
      platform: 'curseforge',
      external_id: `t_cf_${tag(duplicateId)}`,
      url: `https://www.curseforge.com/minecraft/mc-mods/t-cf-${tag(duplicateId)}`,
      downloads: 9,
      synced_at: new Date().toISOString(),
    });
    if (link.error) throw new Error(`arrange: project_links insert failed: ${link.error.message}`);
  });

  afterEach(() => {
    activeFetch?.restore();
    activeFetch = null;
  });

  afterAll(async () => {
    await clearRateLimitHits('project_link', adminId);
    await cleanupFactories();
  });

  it('T-ACT-81 linking the imported listing writes the link FIRST, then folds; revalidates the folded slug too', async () => {
    activeFetch = routes();
    const tags = spyRevalidateTag();
    // Seen from inside the action, right before the fold RPC runs (D1: link before fold).
    let seenAtFold: { link: unknown; count: number } | null = null;
    const res = await withDbHook(
      { rpc: 'fold_project' },
      async () => {
        const link = await service
          .from('project_links')
          .select('external_id, url, downloads')
          .eq('project_id', canonicalId)
          .eq('platform', 'modrinth')
          .maybeSingle();
        const project = await service
          .from('projects')
          .select('downloads_modrinth')
          .eq('id', canonicalId)
          .single();
        seenAtFold = { link: link.data, count: project.data?.downloads_modrinth ?? -1 };
      },
      () =>
        callActionAs(
          linkProjectListing,
          {
            project_id: canonicalId,
            platform: 'modrinth',
            ref: `https://modrinth.com/project/${LISTING_ID}`,
          },
          { profileId: adminId },
        ),
    );
    const data = expectOk(res);
    expect(data.link).toMatchObject({
      project_id: canonicalId,
      platform: 'modrinth',
      external_id: LISTING_ID,
      url: `https://modrinth.com/project/${LISTING_ID}`,
      downloads: LISTING_DOWNLOADS,
    });
    expect(seenAtFold).toEqual({
      link: {
        external_id: LISTING_ID,
        url: `https://modrinth.com/project/${LISTING_ID}`,
        downloads: LISTING_DOWNLOADS,
      },
      count: LISTING_DOWNLOADS,
    });
    expect(activeFetch.calls).toEqual([LISTING_URL]);
    // (d): projects, the canonical slug, then the redirect slug the RPC returned.
    expect(tags.calls).toEqual([
      'projects',
      `project:${canonicalSlug}`,
      `project:${duplicateSlug}`,
    ]);
  });

  it('T-ACT-81 after the fold: duplicate gone, merge order held, CDN twin deduped with url gained, hosted rows moved with their download rows, primary per home, counters carried, overrides merged, redirect row', async () => {
    // (h) the duplicate projects row is gone.
    const gone = await service.from('projects').select('id').eq('id', duplicateId);
    expect(gone.data).toEqual([]);

    // (a) merge: the canonical hosted 1.0.0 row survives (same id), took the Modrinth external_id
    // and the sync-owned columns; the duplicate 1.0.0 row was deleted. (b) 1.1.0 re-parented.
    const versions = await service
      .from('project_versions')
      .select('id, project_id, external_id, version_number, name, changelog_md, downloads, loaders')
      .eq('project_id', canonicalId)
      .order('version_number');
    expect(versions.error).toBeNull();
    expect(versions.data).toEqual([
      {
        id: hostedVersionId,
        project_id: canonicalId,
        external_id: dupSameExternalId,
        version_number: '1.0.0',
        name: 'Modrinth one point oh',
        changelog_md: 'from modrinth',
        downloads: 42,
        loaders: ['fabric'],
      },
      expect.objectContaining({
        id: dupNewVersionId,
        project_id: canonicalId,
        version_number: '1.1.0',
      }),
    ]);
    expect(
      (await service.from('project_versions').select('id').eq('id', dupSameVersionId)).data,
    ).toEqual([]);

    // Files on the merged 1.0.0: the hosted row kept storage_path / primary / download_count and
    // gained the CDN url from its sha512 twin; the twin CDN-only row was dropped; the other CDN
    // file moved over, not primary (canonical wins; it never was).
    const files = await service
      .from('project_files')
      .select('id, filename, url, storage_path, primary, download_count')
      .eq('version_id', hostedVersionId)
      .order('filename');
    expect(files.data).toEqual([
      {
        id: dupOtherFileId,
        filename: 'pack-1.0.0-sources.zip',
        url: `https://cdn.modrinth.com/data/${LISTING_ID}/versions/${dupSameExternalId}/pack-1.0.0-sources.zip`,
        storage_path: null,
        primary: false,
        download_count: 0,
      },
      {
        id: hostedFileId,
        filename: 'pack-1.0.0.zip',
        url: `https://cdn.modrinth.com/data/${LISTING_ID}/versions/${dupSameExternalId}/pack-1.0.0.zip`,
        storage_path: `project-files/${canonicalId}/${hostedVersionId}/pack-1.0.0.zip`,
        primary: true,
        download_count: 4,
      },
    ]);
    expect(
      (await service.from('project_files').select('id').eq('id', dupSharedFileId)).data,
    ).toEqual([]);

    // The hosted 1.1.0 file moved with its version: storage_path kept (object not moved), still
    // the hosted primary of its version, download_count intact.
    const movedHosted = await service
      .from('project_files')
      .select('version_id, storage_path, primary, download_count')
      .eq('id', dupNewFileId)
      .single();
    expect(movedHosted.data).toEqual({
      version_id: dupNewVersionId,
      storage_path: `project-files/${duplicateId}/${dupNewVersionId}/pack-1.1.0.zip`,
      primary: true,
      download_count: 2,
    });

    // (e) every download log row now belongs to the canonical project; downloads_direct carried
    // (5 + 3); (c) the curseforge link re-parented with its count; (b) downloads_modrinth from (b).
    const downloadRows = await service
      .from('project_downloads')
      .select('id, project_id')
      .in('id', [canonicalDownloadRow, dupDownloadRow])
      .order('id');
    expect(downloadRows.data?.map((row) => row.project_id)).toEqual([canonicalId, canonicalId]);
    const project = await service
      .from('projects')
      .select('downloads_direct, downloads_curseforge, downloads_modrinth')
      .eq('id', canonicalId)
      .single();
    expect(project.data).toEqual({
      downloads_direct: 8,
      downloads_curseforge: 9,
      downloads_modrinth: LISTING_DOWNLOADS,
    });
    const links = await service
      .from('project_links')
      .select('platform, downloads')
      .eq('project_id', canonicalId);
    // (`order('platform')` would follow the enum's declaration order — sort by name here.)
    expect((links.data ?? []).slice().sort((a, b) => a.platform.localeCompare(b.platform))).toEqual(
      [
        { platform: 'curseforge', downloads: 9 },
        { platform: 'modrinth', downloads: LISTING_DOWNLOADS },
      ],
    );

    // (d) the comment now targets the canonical project.
    const comment = await service.from('comments').select('target_id').eq('id', commentId).single();
    expect(comment.data?.target_id).toBe(canonicalId);

    // (f) overrides merged column-wise: the canonical title wins, the duplicate's non-default
    // featured/featured_order land, extra_gallery appended verbatim (old folder kept — D5(e)).
    const override = await service
      .from('project_overrides')
      .select('featured, featured_order, title_override, extra_gallery')
      .eq('project_id', canonicalId)
      .single();
    expect(override.data).toEqual({
      featured: true,
      featured_order: 3,
      title_override: 'Canonical title',
      extra_gallery: [
        { path: `project-media/${canonicalId}/gallery/a.png`, ordering: 1 },
        { path: `project-media/${duplicateId}/gallery/b.png`, ordering: 1 },
      ],
    });
    expect(
      (await service.from('project_overrides').select('project_id').eq('project_id', duplicateId))
        .data,
    ).toEqual([]);

    // (g) the old slug resolves to the canonical row.
    const redirect = await service
      .from('project_redirects')
      .select('old_slug, project_id')
      .eq('old_slug', duplicateSlug);
    expect(redirect.data).toEqual([{ old_slug: duplicateSlug, project_id: canonicalId }]);
  });

  it('T-ACT-81 re-linking the same listing → ok, idempotent: nothing to fold, no redirect tag, rows unchanged', async () => {
    activeFetch = routes();
    const tags = spyRevalidateTag();
    const data = expectOk(
      await callActionAs(
        linkProjectListing,
        { project_id: canonicalId, platform: 'modrinth', ref: LISTING_ID },
        { profileId: adminId },
      ),
    );
    expect(data.link).toMatchObject({ external_id: LISTING_ID, downloads: LISTING_DOWNLOADS });
    expect(tags.calls).toEqual(['projects', `project:${canonicalSlug}`]);
    const versions = await service
      .from('project_versions')
      .select('id')
      .eq('project_id', canonicalId)
      .order('version_number');
    expect(versions.data?.map((row) => row.id)).toEqual([hostedVersionId, dupNewVersionId]);
    const project = await service
      .from('projects')
      .select('downloads_direct')
      .eq('id', canonicalId)
      .single();
    expect(project.data?.downloads_direct).toBe(8);
  });

  describe('T-ACT-81 a fold that fails leaves the link written (the sync converges — D2); the next link folds', () => {
    let logs: LogSpy;
    let canonical2 = '';
    let duplicate2 = '';

    beforeAll(async () => {
      canonical2 = await makeProject({ source: 'odsens', status: 'published' });
      duplicate2 = await makeProject({
        source: 'modrinth',
        external_id: FAIL_LISTING_ID,
        status: 'published',
      });
    });

    beforeEach(() => {
      logs = spyLog();
    });

    afterEach(() => {
      logs.restore();
    });

    it('T-ACT-81 fold_project faulted → internal + one log.error line; link row + count written, duplicate still there, no revalidate', async () => {
      activeFetch = routes();
      const tags = spyRevalidateTag();
      const res = await withDbFault({ rpc: 'fold_project' }, {}, () =>
        callActionAs(
          linkProjectListing,
          { project_id: canonical2, platform: 'modrinth', ref: FAIL_LISTING_ID },
          { profileId: adminId },
        ),
      );
      expectInternal(res, 'linkProjectListing', logs);
      expect(tags.calls).toEqual([]);
      const link = await service
        .from('project_links')
        .select('external_id, downloads')
        .eq('project_id', canonical2)
        .eq('platform', 'modrinth')
        .maybeSingle();
      expect(link.data).toEqual({ external_id: FAIL_LISTING_ID, downloads: 11 });
      const project = await service
        .from('projects')
        .select('downloads_modrinth')
        .eq('id', canonical2)
        .single();
      expect(project.data?.downloads_modrinth).toBe(11);
      expect((await service.from('projects').select('id').eq('id', duplicate2)).data).toEqual([
        { id: duplicate2 },
      ]);
    });

    it('T-ACT-81 linking again (same id) runs the fold: duplicate gone, redirect row, redirect tag', async () => {
      activeFetch = routes();
      const tags = spyRevalidateTag();
      const dupSlug = (await service.from('projects').select('slug').eq('id', duplicate2).single())
        .data?.slug;
      const canSlug = (await service.from('projects').select('slug').eq('id', canonical2).single())
        .data?.slug;
      expectOk(
        await callActionAs(
          linkProjectListing,
          { project_id: canonical2, platform: 'modrinth', ref: FAIL_LISTING_ID },
          { profileId: adminId },
        ),
      );
      expect((await service.from('projects').select('id').eq('id', duplicate2)).data).toEqual([]);
      const redirect = await service
        .from('project_redirects')
        .select('project_id')
        .eq('old_slug', dupSlug ?? '');
      expect(redirect.data).toEqual([{ project_id: canonical2 }]);
      expect(tags.calls).toEqual(['projects', `project:${canSlug}`, `project:${dupSlug}`]);
    });

    it('T-ACT-81 a listing linked to another project is refused BEFORE any write or fold (conflict)', async () => {
      activeFetch = routes();
      const third = await makeProject({ source: 'odsens' });
      const error = expectFail(
        await callActionAs(
          linkProjectListing,
          { project_id: third, platform: 'modrinth', ref: FAIL_LISTING_ID },
          { profileId: adminId },
        ),
        'conflict',
      );
      expect(error.message).toBe(`That listing is already linked to t_${tag(canonical2)}.`);
      expect(
        (await service.from('project_links').select('platform').eq('project_id', third)).data,
      ).toEqual([]);
    });
  });
});

describe('T-ACT-81 fold faulted → the hourly run re-parents the synced twin → the re-link still merges (AC2)', () => {
  let adminId = '';
  let canonicalId = '';
  let duplicateId = '';
  let hostedVersionId = '';
  let hostedFileId = '';
  let dupVersionId = '';
  let dupExternalId = '';
  let dupFileId = '';
  let activeFetch: FetchSpy | null = null;
  let logs: LogSpy;

  beforeAll(async () => {
    adminId = await makeUser({ role: 'admin' });
    canonicalId = await makeProject({ source: 'odsens', status: 'published' });
    hostedVersionId = await makeVersion({
      project_id: canonicalId,
      version_number: '1.0.0',
      date_published: '2026-05-01T12:00:00.000Z',
    });
    hostedFileId = await makeFile({
      version_id: hostedVersionId,
      filename: 'pack-1.0.0.zip',
      sha512: `t_sha_hosted_${tag(canonicalId)}`,
      storage_path: `project-files/${canonicalId}/${hostedVersionId}/pack-1.0.0.zip`,
      primary: true,
    });
    duplicateId = await makeProject({
      source: 'modrinth',
      external_id: MERGE_LISTING_ID,
      status: 'published',
    });
    dupExternalId = `t_v_merge_${tag(duplicateId)}`;
    dupVersionId = await makeVersion({
      project_id: duplicateId,
      external_id: dupExternalId,
      version_number: '1.0.0',
      name: 'Modrinth 1.0.0',
      date_published: '2026-05-02T12:00:00.000Z',
      downloads: 21,
    });
    dupFileId = await makeFile({
      version_id: dupVersionId,
      filename: 'pack-1.0.0-modrinth.zip',
      sha512: `t_sha_cdn_${tag(duplicateId)}`,
      url: `https://cdn.modrinth.com/data/${MERGE_LISTING_ID}/versions/${dupExternalId}/pack-1.0.0-modrinth.zip`,
      primary: true,
    });
  });

  beforeEach(() => {
    logs = spyLog();
  });

  afterEach(() => {
    logs.restore();
    activeFetch?.restore();
    activeFetch = null;
  });

  afterAll(async () => {
    await clearRateLimitHits('project_link', adminId);
    await cleanupFactories();
  });

  it('T-ACT-81 the link is written, the fold faults; the sync re-parents the synced 1.0.0 onto the canonical; the re-link merges it into the hosted 1.0.0', async () => {
    activeFetch = routes();
    const faulted = await withDbFault({ rpc: 'fold_project' }, {}, () =>
      callActionAs(
        linkProjectListing,
        { project_id: canonicalId, platform: 'modrinth', ref: MERGE_LISTING_ID },
        { profileId: adminId },
      ),
    );
    expectInternal(faulted, 'linkProjectListing', logs);

    // What the hourly run does with the link in place (ADR-0037 D2 step 3 — the global re-parent:
    // the version row follows its listing; step 4 hides the stale duplicate; T-ACT-82 proves the
    // job itself): the synced 1.0.0 now sits on the canonical BESIDE the hosted 1.0.0.
    const reparented = await service
      .from('project_versions')
      .update({ project_id: canonicalId })
      .eq('id', dupVersionId);
    if (reparented.error) throw new Error(reparented.error.message);
    const hidden = await service
      .from('projects')
      .update({ status: 'hidden' })
      .eq('id', duplicateId);
    if (hidden.error) throw new Error(hidden.error.message);
    expect(
      (await service.from('project_versions').select('id').eq('project_id', canonicalId)).data,
    ).toHaveLength(2);

    activeFetch.restore();
    activeFetch = routes();
    expectOk(
      await callActionAs(
        linkProjectListing,
        { project_id: canonicalId, platform: 'modrinth', ref: MERGE_LISTING_ID },
        { profileId: adminId },
      ),
    );

    // One 1.0.0 row: the hosted row survived, took the Modrinth external_id + sync-owned columns.
    const versions = await service
      .from('project_versions')
      .select('id, external_id, version_number, name, downloads')
      .eq('project_id', canonicalId);
    expect(versions.data).toEqual([
      {
        id: hostedVersionId,
        external_id: dupExternalId,
        version_number: '1.0.0',
        name: 'Modrinth 1.0.0',
        downloads: 21,
      },
    ]);
    // Its files: the hosted file primary, the CDN file listed once beside it (its own home's primary).
    const files = await service
      .from('project_files')
      .select('id, version_id, storage_path, url, primary')
      .in('id', [hostedFileId, dupFileId])
      .order('filename');
    expect(files.data).toEqual([
      {
        id: dupFileId,
        version_id: hostedVersionId,
        storage_path: null,
        url: `https://cdn.modrinth.com/data/${MERGE_LISTING_ID}/versions/${dupExternalId}/pack-1.0.0-modrinth.zip`,
        primary: true,
      },
      {
        id: hostedFileId,
        version_id: hostedVersionId,
        storage_path: `project-files/${canonicalId}/${hostedVersionId}/pack-1.0.0.zip`,
        url: null,
        primary: true,
      },
    ]);
    expect((await service.from('projects').select('id').eq('id', duplicateId)).data).toEqual([]);
  });
});
