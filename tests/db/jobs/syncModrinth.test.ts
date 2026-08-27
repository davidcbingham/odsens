/**
 * tests/db/jobs/syncModrinth.test.ts — T-ACT-45, T-ACT-46, T-ACT-47, T-ACT-48, T-ACT-49, T-ACT-50,
 * T-ACT-51, T-ACT-70 (04 §3/§3.1 SC-11/SC-13, J-P/J-I/J-D; 05 §7.2 jobs layer; migrations
 * 20260827090000..90400). `mutatesSeed`: the file empties `projects` for the first-run case and
 * restores every content table from a snapshot in `afterAll` (05 H-1).
 *
 * Harness per 05 §7.2: the job runs against the local DB with the adapters' `fetch` mocked to
 * fixtures — `spyFetch` routes the fixture-server URLs (`MODRINTH_API_BASE`, ADR-0002 #73) to
 * `tests/fixtures/modrinth/*`; the local Supabase stack passes through. Derived payloads (a list
 * without one project, a draft object) are built from `user-projects.json` in memory — recorded
 * fixtures are never hand-edited (F-6).
 *
 * T-ACT-70's `triggerSync` clause (open run → D `conflict`) lands with `lib/actions/admin.ts` in the
 * actions pass (T-ACT-42); this file covers the job + cron-route sides of the lock.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GET } from '@/app/api/cron/sync-modrinth/route';
import { mapProject, type ModrinthProject } from '@/lib/adapters/modrinth';
import { syncModrinth } from '@/lib/jobs/syncModrinth';
import type { JobSummary } from '@/lib/jobs/types';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import { restoreContentTables, snapshotContentTables, type ContentSnapshot } from '@/tests/helpers/contentReset';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { cleanupFactories, makeSyncRun } from '@/tests/helpers/factories';
import { loadFixture } from '@/tests/helpers/fixtures';
import { spyFetch, spyRevalidateTag, type FixtureMap } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const MODRINTH_BASE = process.env.MODRINTH_API_BASE ?? '';
const MODRINTH_USER = process.env.MODRINTH_USER ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const LIST_URL = `${MODRINTH_BASE}/user/${MODRINTH_USER}/projects`;
const PROJECT_PREFIX = `${MODRINTH_BASE}/project/`;
const CHAMELEON_ID = 'sd000102';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const ROUTE_URL = 'http://localhost:3000/api/cron/sync-modrinth';

let snapshot: ContentSnapshot;
let baseList: ModrinthProject[] = [];
let fullList: ModrinthProject[] = [];

/** A non-listable status (step 2 filters it before mapping) — derived, minimal on purpose. */
const draftProject = {
  id: 'sd000198',
  slug: 't-draft-project',
  project_type: 'mod',
  title: 'Draft',
  description: 'never imported',
  status: 'draft',
  loaders: ['fabric'],
} as ModrinthProject;

const json =
  (value: unknown) =>
  (): Response =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

/** Default routes: the full list (18 importable + shader + draft), chameleon versions, others empty. */
function routes(list: ModrinthProject[], overrides: FixtureMap = {}): FixtureMap {
  return {
    [`${PROJECT_PREFIX}${CHAMELEON_ID}/version`]: 'modrinth/versions.json',
    [PROJECT_PREFIX]: 'modrinth/versions-empty.json',
    [LIST_URL]: json(list),
    ...overrides,
  };
}

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'modrinth');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function modrinthProjects(): Promise<Record<string, unknown>[]> {
  const { data, error } = await service
    .from('projects')
    .select('*')
    .eq('source', 'modrinth')
    .order('slug');
  if (error) throw new Error(error.message);
  return data as unknown as Record<string, unknown>[];
}

async function projectBySlug(slug: string): Promise<Record<string, unknown>> {
  const { data, error } = await service.from('projects').select('*').eq('slug', slug).single();
  if (error) throw new Error(error.message);
  return data as unknown as Record<string, unknown>;
}

function run(): Promise<JobSummary> {
  return syncModrinth({ trigger: 'manual' });
}

/** `updated_at` (trigger) and `synced_at` (J-I) move on every touch; everything else must not. */
function stable(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  delete copy.synced_at;
  delete copy.updated_at;
  return copy;
}

let firstSummary: JobSummary;
let firstTags: string[] = [];
let secondSummary: JobSummary;
let secondTags: string[] = [];
let runsBefore = 0;

beforeAll(async () => {
  snapshot = await snapshotContentTables();
  baseList = await loadFixture<ModrinthProject[]>('modrinth', 'user-projects.json');
  const shader = await loadFixture<ModrinthProject>('modrinth', 'project-shader.json');
  fullList = [...baseList, shader, draftProject];

  // T-ACT-46 arrange — first run on EMPTY projects (seed rows removed via service, mutatesSeed).
  const wipe = await service.from('projects').delete().neq('id', NIL_UUID);
  if (wipe.error) throw new Error(wipe.error.message);

  runsBefore = await syncRunCount();
  spyFetch(routes(fullList));
  const tags = spyRevalidateTag();
  firstSummary = await run();
  firstTags = [...tags.calls];

  // Second run, same fixtures (T-ACT-46 idempotency / T-ACT-51 no-change run).
  spyFetch(routes(fullList));
  const tags2 = spyRevalidateTag();
  secondSummary = await run();
  secondTags = [...tags2.calls];
});

afterAll(async () => {
  await cleanupFactories();
  await restoreContentTables(snapshot);
});

describe('syncModrinth (04 §3.1)', () => {
  it('T-ACT-46 first run on empty projects inserts the 18 approved/archived fixture projects', async () => {
    expect(firstSummary.ok).toBe(true);
    expect(firstSummary.source).toBe('modrinth');
    expect(firstSummary.items).toBe(18);
    expect(typeof firstSummary.ms).toBe('number');
    const rows = await modrinthProjects();
    expect(rows).toHaveLength(18);
    for (const row of rows) {
      expect(row.source).toBe('modrinth');
      expect(row.status).toBe('published');
      expect(row.synced_at).not.toBeNull();
    }
    // Only Modrinth status ∈ {approved, archived} is imported — the draft object left no row.
    expect(rows.some((row) => row.slug === draftProject.slug)).toBe(false);
  });

  it('T-ACT-46 second run with the same fixtures changes no column but synced_at', async () => {
    expect(secondSummary.ok).toBe(true);
    expect(secondSummary.items).toBe(0);
    const rows = await modrinthProjects();
    expect(rows).toHaveLength(18);
    // Same ids, same values: the third run below re-proves it against a fresh snapshot.
    spyFetch(routes(fullList));
    const before = rows;
    const third = await run();
    expect(third.items).toBe(0);
    const after = await modrinthProjects();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after.map(stable)).toEqual(before.map(stable));
    for (const [index, row] of after.entries()) {
      expect(row.synced_at).not.toBe(before[index]?.synced_at);
    }
  });

  it('T-ACT-45 every run writes exactly one finalized sync_runs row (error NULL on success)', async () => {
    // beforeAll ran the job twice + the previous test once more = 3 rows so far.
    expect(await syncRunCount()).toBe(runsBefore + 3);
    const { data, error } = await service
      .from('sync_runs')
      .select('*')
      .eq('id', firstSummary.run_id)
      .single();
    expect(error).toBeNull();
    expect(data?.source).toBe('modrinth');
    expect(data?.started_at).not.toBeNull();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.items).toBe(18);
    expect(data?.error).toBeNull();
  });

  it('T-ACT-47 mapping is persisted per §5.2 and project_overrides is never touched', async () => {
    // T-ADP-2 spot checks (P1–P4) on persisted rows.
    expect((await projectBySlug('metal-pipe-mace')).project_type).toBe('resourcepack');
    expect((await projectBySlug('heavy-spear')).project_type).toBe('datapack');
    expect((await projectBySlug('pixel-chameleon')).project_type).toBe('mod');
    expect((await projectBySlug('legacy-manhunts-reworked')).project_type).toBe('plugin');

    // Full sync-owned column set vs the pure mapper (T-ADP-4 owns the mapper itself).
    const raw = baseList.find((project) => project.slug === 'pixel-chameleon');
    expect(raw).toBeDefined();
    const mapped = mapProject(raw as ModrinthProject);
    const row = await projectBySlug('pixel-chameleon');
    expect(row.external_id).toBe(mapped.external_id);
    expect(row.title).toBe(mapped.title);
    expect(row.description).toBe(mapped.description);
    expect(row.body_md).toBe(mapped.body_md ?? '');
    expect(row.icon_url).toBe(mapped.icon_url);
    expect(row.gallery).toEqual(mapped.gallery);
    expect(row.categories).toEqual(mapped.categories);
    expect(row.loaders).toEqual(mapped.loaders);
    expect(row.game_versions).toEqual(mapped.game_versions);
    expect(row.license).toBe(mapped.license);
    expect(row.source_url).toBe(mapped.source_url);
    expect(row.issues_url).toBe(mapped.issues_url);
    expect(row.discord_url).toBe(mapped.discord_url);
    expect(row.downloads_modrinth).toBe(mapped.downloads_modrinth);
    expect(row.followers).toBe(mapped.followers);
    expect(new Date(row.published_at as string).toISOString()).toBe(
      mapped.published_at?.toISOString(),
    );
    expect(new Date(row.external_updated_at as string).toISOString()).toBe(
      mapped.external_updated_at?.toISOString(),
    );

    // A gallery survives ordered by `ordering` (metal-pipe-mace carries 2 items).
    const mace = await projectBySlug('metal-pipe-mace');
    const gallery = mace.gallery as { ordering: number }[];
    expect(gallery.length).toBeGreaterThanOrEqual(2);
    expect([...gallery].map((item) => item.ordering)).toEqual(
      [...gallery].map((item) => item.ordering).sort((a, b) => a - b),
    );

    // The sync wrote no override rows (step 2 "Never touch project_overrides").
    const { count } = await service
      .from('project_overrides')
      .select('project_id', { count: 'exact', head: true });
    expect(count).toBe(0);
  });

  it('T-ACT-48 versions upsert on external_id, files on (version_id, filename); absent kept', async () => {
    const chameleon = await projectBySlug('pixel-chameleon');
    const { data: versions } = await service
      .from('project_versions')
      .select('*')
      .eq('project_id', chameleon.id as string)
      .order('version_number');
    expect(versions).toHaveLength(3);
    const beta = versions?.find((row) => row.version_number === '2.0.0-beta.1');
    expect(beta?.external_id).toBe('sdv00404');
    expect(beta?.version_type).toBe('beta');
    expect(beta?.changelog_md).not.toBeNull();
    expect(beta?.date_published).not.toBeNull();
    expect(beta?.downloads).toBeGreaterThanOrEqual(0);

    const { data: betaFiles } = await service
      .from('project_files')
      .select('*')
      .eq('version_id', beta?.id ?? '')
      .order('filename');
    expect(betaFiles).toHaveLength(2);
    expect(betaFiles?.filter((file) => file.primary)).toHaveLength(1);
    for (const file of betaFiles ?? []) {
      expect(file.storage_path).toBeNull();
      expect(file.url).toMatch(/^https:\/\//);
      expect(file.size_bytes).toBeGreaterThan(0);
    }

    // A 2-file version with no upstream flag keeps exactly one primary (the first — T-ADP-5).
    const v120 = versions?.find((row) => row.version_number === '1.2.0');
    const { data: v120Files } = await service
      .from('project_files')
      .select('filename, primary')
      .eq('version_id', v120?.id ?? '');
    expect(v120Files?.filter((file) => file.primary)).toHaveLength(1);

    // Rerun (beforeAll ran twice already): still 3 versions, still 2 + 2 + 1 files — no duplicates.
    const { count: fileCount } = await service
      .from('project_files')
      .select('id', { count: 'exact', head: true })
      .in('version_id', (versions ?? []).map((row) => row.id));
    expect(fileCount).toBe(5);

    // Versions absent upstream are kept (ADR-0002 #66): serve only the beta, run, all 3 remain.
    const versionsJson = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'modrinth', 'versions.json'), 'utf8'),
    ) as unknown[];
    spyFetch(
      routes(fullList, { [`${PROJECT_PREFIX}${CHAMELEON_ID}/version`]: json([versionsJson[0]]) }),
    );
    await run();
    const { count: keptCount } = await service
      .from('project_versions')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', chameleon.id as string);
    expect(keptCount).toBe(3);
  });

  it('T-ACT-51 revalidation: projects once + project:<slug> per upserted slug; none unchanged', () => {
    expect(firstTags.filter((tag) => tag === 'projects')).toHaveLength(1);
    const slugTags = firstTags.filter((tag) => tag.startsWith('project:'));
    expect(new Set(slugTags).size).toBe(slugTags.length);
    expect(slugTags).toHaveLength(18);
    expect(firstTags).toContain('project:pixel-chameleon');
    // Unchanged upstream data → no revalidate calls at all.
    expect(secondTags).toEqual([]);
  });

  it('T-ACT-50 unsupported project_type is skipped, counted, and neither a row nor an error', async () => {
    expect(firstSummary.skipped).toBe(1);
    expect(firstSummary.errors).toEqual([]);
    const { count } = await service
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('slug', 'molten-glow');
    expect(count).toBe(0);
  });

  it('T-ACT-49 a project absent from the list goes hidden; children + overrides survive; reappearing republishes', async () => {
    const chameleon = await projectBySlug('pixel-chameleon');
    const override = await service
      .from('project_overrides')
      .insert({ project_id: chameleon.id as string, title_override: 't_survives' });
    expect(override.error).toBeNull();

    const withoutChameleon = fullList.filter((project) => project.id !== CHAMELEON_ID);
    spyFetch(routes(withoutChameleon));
    const tags = spyRevalidateTag();
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.hidden).toBe(1);
    expect((await projectBySlug('pixel-chameleon')).status).toBe('hidden');
    expect(tags.calls).toContain('projects');
    expect(tags.calls).toContain('project:pixel-chameleon');

    // Row and children retained; the override is untouched.
    const { count: versionCount } = await service
      .from('project_versions')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', chameleon.id as string);
    expect(versionCount).toBe(3);
    const { data: kept } = await service
      .from('project_overrides')
      .select('title_override')
      .eq('project_id', chameleon.id as string)
      .single();
    expect(kept?.title_override).toBe('t_survives');

    // Rerun with the same list keeps it hidden and changes nothing.
    spyFetch(routes(withoutChameleon));
    const rerunTags = spyRevalidateTag();
    const rerun = await run();
    expect(rerun.hidden).toBe(0);
    expect((await projectBySlug('pixel-chameleon')).status).toBe('hidden');
    expect(rerunTags.calls).toEqual([]);

    // Reappearing upstream → published again.
    spyFetch(routes(fullList));
    const backTags = spyRevalidateTag();
    const back = await run();
    expect(back.ok).toBe(true);
    expect((await projectBySlug('pixel-chameleon')).status).toBe('published');
    expect(backTags.calls).toContain('project:pixel-chameleon');
  });

  it('T-ACT-45 list-call failure (500 ×4) → ok=false, error set, no target rows changed', async () => {
    const before = await modrinthProjects();
    const runsBeforeFailure = await syncRunCount();
    spyFetch({ [LIST_URL]: 'status:500' });
    const tags = spyRevalidateTag();
    const summary = await run();
    expect(summary.ok).toBe(false);
    expect(typeof summary.error).toBe('string');
    expect((summary.error ?? '').length).toBeLessThanOrEqual(2000);
    expect(summary.error).not.toMatch(/key=/i);

    // The failed run is still finalized (SC-11 try/finally) — one row, ok=false, error stored.
    expect(await syncRunCount()).toBe(runsBeforeFailure + 1);
    const { data: row } = await service
      .from('sync_runs')
      .select('finished_at, ok, error')
      .eq('id', summary.run_id)
      .single();
    expect(row?.finished_at).not.toBeNull();
    expect(row?.ok).toBe(false);
    expect(row?.error).not.toBeNull();
    expect(row?.error).not.toMatch(/key=/i);

    // No rows in target tables changed; steps 2–5 (incl. hiding) were skipped.
    expect(await modrinthProjects()).toEqual(before);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-45 lib/jobs never deletes synced rows (J-D grep)', () => {
    const dir = path.join(REPO_ROOT, 'lib', 'jobs');
    for (const name of readdirSync(dir)) {
      if (name === 'snapshotStats.ts') continue; // the only sanctioned housekeeping (S1.9)
      const text = readFileSync(path.join(dir, name), 'utf8');
      expect(text.includes('.delete' + '(')).toBe(false);
    }
  });

  describe('T-ACT-70 job lock (04 SC-13)', () => {
    it('T-ACT-70 an open run 5 min old → route 200 {ok:true, skipped:running}, no second row; job skips too', async () => {
      await makeSyncRun({
        source: 'modrinth',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        finished_at: null,
      });
      const runsWithLock = await syncRunCount();

      const response = await GET(
        new NextRequest(ROUTE_URL, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as JobSummary;
      expect(body.ok).toBe(true);
      expect(body.skipped).toBe('running');
      expect(await syncRunCount()).toBe(runsWithLock);

      const direct = await run();
      expect(direct.ok).toBe(true);
      expect(direct.skipped).toBe('running');
      expect(await syncRunCount()).toBe(runsWithLock);
    });

    it('T-ACT-70 a stale open run (20 min old) does not hold the lock — the job runs', async () => {
      await cleanupFactories(); // drop the 5-min lock row first
      await makeSyncRun({
        source: 'modrinth',
        started_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        finished_at: null,
      });
      const runs = await syncRunCount();
      spyFetch(routes(fullList)); // fresh routes for the real run
      const summary = await run();
      expect(summary.skipped).toBeUndefined();
      expect(summary.ok).toBe(true);
      expect(await syncRunCount()).toBe(runs + 1);
    });
  });
});
