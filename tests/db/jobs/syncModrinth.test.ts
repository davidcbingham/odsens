/**
 * tests/db/jobs/syncModrinth.test.ts — T-ACT-45, T-ACT-46, T-ACT-47, T-ACT-48, T-ACT-49, T-ACT-50,
 * T-ACT-51, T-ACT-70, T-ACT-78, T-ACT-82 (04 §3/§3.1 SC-11/SC-13, J-P/J-I/J-D; 05 §7.2 jobs layer;
 * migrations 20260827090000..90400, 20260911120000). `mutatesSeed`: the file empties `projects` for
 * the first-run case and restores every content table from a snapshot in `afterAll` (05 H-1).
 *
 * Harness per 05 §7.2: the job runs against the local DB with the adapters' `fetch` mocked to
 * fixtures — `spyFetch` routes the fixture-server URLs (`MODRINTH_API_BASE`, ADR-0002 #73) to
 * `tests/fixtures/modrinth/*`; the local Supabase stack passes through. Derived payloads (a list
 * without one project, a draft object) are built from `user-projects.json` in memory — recorded
 * fixtures are never hand-edited (F-6).
 *
 * T-ACT-70's `triggerSync` clause (open run → D `conflict`) lands with `lib/actions/admin.ts` in the
 * actions pass (T-ACT-42); this file covers the job + cron-route sides of the lock.
 *
 * S1.5 (T-ACT-74, 04 J-F, ADR-0030 D1): the last describe proves the `sync.failed` edge through the
 * shared runner — one event per failure episode, the payload shape, no event while the failure
 * persists, one again after an ok run, one when no previous run exists, and a lost `emit` logged
 * (`emit_failed`) rather than thrown. The list call fails with a 400 (not retried, SC-09) so each
 * failing run is fast. Events are purged in `afterAll`.
 *
 * S1.5a (T-ACT-82, ADR-0037 D2): the adoption describe proves the sync's "one project, many homes"
 * rules against factory rows — a linked listing (a `project_links` `modrinth` row on an odsens
 * project) never inserts a `projects` row and never touches the canonical metadata; versions key on
 * `external_id` globally (a stray row is re-parented); a hosted version adopts the same-numbered
 * upstream version on a linked row AND on a Modrinth-first row (the ADR-0026 tie-break by `sha512`,
 * else adapter order); `sha512` pairing (same bytes → no new row, the hosted row gains `url`; same
 * filename + different bytes → its own CDN row); a hosted icon survives; the slug-collision insert
 * lands as `p-<id>` and keeps it on rerun; a duplicate whose listing is linked elsewhere is hidden by
 * step 4 and two runs converge without a fold; the linked listing revalidates `project:<canonical
 * slug>`; a rerun changes nothing but `synced_at`. Listings are derived in memory from the recorded
 * list (F-6); the version payloads are the hand-made `versions-adopt.json` (listing `sd000197`) and
 * `versions-modrinth-first.json` (chameleon `9.9.0`) in the `versions.json` shape.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GET } from '@/app/api/cron/sync-modrinth/route';
import { mapProject, type ModrinthProject } from '@/lib/adapters/modrinth';
import { modrinthListingUrl } from '@/lib/format/project';
import { syncModrinth } from '@/lib/jobs/syncModrinth';
import type { JobSummary } from '@/lib/jobs/types';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { withDbFault } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeFile,
  makeProject,
  makeSyncRun,
  makeVersion,
  purgeNotificationEvents,
  trackNotificationEvent,
} from '@/tests/helpers/factories';
import { loadFixture } from '@/tests/helpers/fixtures';
import { spyFetch, spyLog, spyRevalidateTag, type FixtureMap } from '@/tests/helpers/spies';

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

const json = (value: unknown) => (): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * Default routes: the full list (18 importable + shader + draft), chameleon versions, others empty.
 * Overrides come FIRST so a per-listing `project/<id>/version` route wins over the `/project/`
 * prefix catch-all (`spyFetch` matches in key order); a default is dropped when overridden.
 */
function routes(list: ModrinthProject[], overrides: FixtureMap = {}): FixtureMap {
  const defaults: FixtureMap = {
    [`${PROJECT_PREFIX}${CHAMELEON_ID}/version`]: 'modrinth/versions.json',
    [PROJECT_PREFIX]: 'modrinth/versions-empty.json',
    [LIST_URL]: json(list),
  };
  const map: FixtureMap = { ...overrides };
  for (const [key, route] of Object.entries(defaults)) {
    if (!(key in map)) map[key] = route;
  }
  return map;
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
  // S1.5: failed runs emit `sync.failed` through the runner (04 J-F) — purge them (H-1).
  await purgeNotificationEvents();
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

  it('T-ACT-48 versions upsert on external_id, files on (version_id, filename) among CDN-only rows; absent kept', async () => {
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
      .in(
        'version_id',
        (versions ?? []).map((row) => row.id),
      );
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

  it('T-ACT-49 a project absent from the list goes hidden (step 4 — from the list, never per-item success); children + overrides survive; reappearing republishes', async () => {
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

  it('T-ACT-78 icon upgrade: a stored resized icon is probed once, an original is never re-probed, a changed icon probes again (ADR-0034 D4)', async () => {
    const DUCK_ID = 'sd000108';
    const cdn = `https://cdn.modrinth.com/data/${DUCK_ID}`;
    const resized = (hash: string) => `${cdn}/${hash}_96.webp`;
    const original = (hash: string) => `${cdn}/${hash}.png`;
    const ok = () => (): Response => new Response(null, { status: 200 });
    const listWithIcon = (hash: string): ModrinthProject[] =>
      fullList.map((project) =>
        project.id === DUCK_ID ? { ...project, icon_url: resized(hash) } : project,
      );
    const cdnCalls = (calls: readonly string[]) =>
      calls.filter((url) => url.startsWith('https://cdn.modrinth.com/'));

    // Arrange: a row synced before the rule still holds Modrinth's resized icon.
    const duck = await projectBySlug('duck-crosshair');
    const pre = await service
      .from('projects')
      .update({ icon_url: resized('aaa111') })
      .eq('id', duck.id as string);
    if (pre.error) throw new Error(pre.error.message);

    // Run 1 — same upstream hash, stored value still resized → probed once, `.png` answers first.
    const spy1 = spyFetch(routes(listWithIcon('aaa111'), { [original('aaa111')]: ok() }));
    const tags1 = spyRevalidateTag();
    const first = await run();
    expect(first.ok).toBe(true);
    expect((await projectBySlug('duck-crosshair')).icon_url).toBe(original('aaa111'));
    expect(cdnCalls(spy1.calls)).toEqual([original('aaa111')]);
    expect(tags1.calls).toContain('project:duck-crosshair');

    // Run 2 — unchanged upstream, stored original → no HEAD, only synced_at/updated_at move.
    const before = await projectBySlug('duck-crosshair');
    const spy2 = spyFetch(routes(listWithIcon('aaa111'), { [original('aaa111')]: ok() }));
    const second = await run();
    expect(second.ok).toBe(true);
    const after = await projectBySlug('duck-crosshair');
    expect(cdnCalls(spy2.calls)).toEqual([]);
    expect(after.icon_url).toBe(original('aaa111'));
    expect(stable(after)).toEqual(stable(before));

    // Run 3 — upstream icon changed (new hash) → probed again, new original stored.
    const spy3 = spyFetch(routes(listWithIcon('bbb222'), { [original('bbb222')]: ok() }));
    const third = await run();
    expect(third.ok).toBe(true);
    expect((await projectBySlug('duck-crosshair')).icon_url).toBe(original('bbb222'));
    expect(cdnCalls(spy3.calls)).toEqual([original('bbb222')]);

    // Every other fixture row carries a plain `.png` icon: the three runs made no other CDN call.
    expect(cdnCalls([...spy1.calls, ...spy2.calls, ...spy3.calls])).toHaveLength(2);

    // Self-contained: put the fixture icon back (a plain `.png` is never probed) so later cases
    // do not depend on this one's leftovers.
    spyFetch(routes(fullList));
    const reset = await run();
    expect(reset.ok).toBe(true);
    expect((await projectBySlug('duck-crosshair')).icon_url).toBe(`${cdn}/icon.png`);
  }, 60_000);

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
      // Ran for real: `skipped` is §3.1's numeric skipped-types count, not the SC-13 'running' skip.
      expect(summary.skipped).not.toBe('running');
      expect(summary.ok).toBe(true);
      expect(await syncRunCount()).toBe(runs + 1);
    });
  });

  describe('T-ACT-48 duplicate upstream version_number (ADR-0026)', () => {
    // Modrinth allows two versions of one project to share a `version_number` (distinct version
    // ids); since ADR-0026 the identity is `external_id` alone, so both become rows. The fixture
    // serves ONLY the two duplicate 1.1.0 versions — chameleon's 3 versions.json rows are absent
    // upstream and kept (ADR-0002 #66).
    const DUPLICATE_URL = `${PROJECT_PREFIX}${CHAMELEON_ID}/version`;

    it('T-ACT-48 two versions sharing a version_number insert as two rows with their files, zero per-item errors', async () => {
      const chameleon = await projectBySlug('pixel-chameleon');
      spyFetch(routes(fullList, { [DUPLICATE_URL]: 'modrinth/versions-duplicate.json' }));
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary.errors).toEqual([]);
      expect(summary.versions).toBe(2);
      expect(summary.files).toBe(2);

      const { data: dupes } = await service
        .from('project_versions')
        .select('*')
        .eq('project_id', chameleon.id as string)
        .eq('version_number', '1.1.0')
        .order('external_id');
      expect(dupes).toHaveLength(2);
      expect(dupes?.map((row) => row.external_id)).toEqual(['sdv00407', 'sdv00408']);
      expect(dupes?.[0]?.id).not.toBe(dupes?.[1]?.id);

      // Each duplicate carries its own file row, keyed on its own (version_id, filename).
      for (const [externalId, filename] of [
        ['sdv00407', 'pixel-chameleon-1.1.0.jar'],
        ['sdv00408', 'pixel-chameleon-1.1.0-neoforge.jar'],
      ] as const) {
        const version = dupes?.find((row) => row.external_id === externalId);
        const { data: versionFiles } = await service
          .from('project_files')
          .select('filename, primary')
          .eq('version_id', version?.id ?? '');
        expect(versionFiles).toHaveLength(1);
        expect(versionFiles?.[0]?.filename).toBe(filename);
        expect(versionFiles?.[0]?.primary).toBe(true);
      }

      // 3 kept (absent upstream, ADR-0002 #66) + 2 duplicates = 5 versions total.
      const { count } = await service
        .from('project_versions')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', chameleon.id as string);
      expect(count).toBe(5);
    });

    it('T-ACT-48 rerun with the same duplicate fixture adds no rows; only synced_at moves', async () => {
      const chameleon = await projectBySlug('pixel-chameleon');
      const { data: versionsBefore } = await service
        .from('project_versions')
        .select('*')
        .eq('project_id', chameleon.id as string)
        .order('external_id');
      const { data: filesBefore } = await service
        .from('project_files')
        .select('*')
        .in(
          'version_id',
          (versionsBefore ?? []).map((row) => row.id),
        )
        .order('id');
      const projectsBefore = await modrinthProjects();

      spyFetch(routes(fullList, { [DUPLICATE_URL]: 'modrinth/versions-duplicate.json' }));
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary.errors).toEqual([]);
      expect(summary.items).toBe(0);
      expect(summary.versions).toBe(0);
      expect(summary.files).toBe(0);

      // Unchanged versions/files get no write at all (J-I) — the rows come back identical.
      const { data: versionsAfter } = await service
        .from('project_versions')
        .select('*')
        .eq('project_id', chameleon.id as string)
        .order('external_id');
      expect(versionsAfter).toEqual(versionsBefore);
      const { data: filesAfter } = await service
        .from('project_files')
        .select('*')
        .in(
          'version_id',
          (versionsAfter ?? []).map((row) => row.id),
        )
        .order('id');
      expect(filesAfter).toEqual(filesBefore);

      // Projects: same ids, same values — only `synced_at` (and the trigger's `updated_at`) move.
      const projectsAfter = await modrinthProjects();
      expect(projectsAfter.map((row) => row.id)).toEqual(projectsBefore.map((row) => row.id));
      expect(projectsAfter.map(stable)).toEqual(projectsBefore.map(stable));
      for (const [index, row] of projectsAfter.entries()) {
        expect(row.synced_at).not.toBe(projectsBefore[index]?.synced_at);
      }
    });
  });
  describe('T-ACT-82 sync adoption — one project, many homes (ADR-0037 D2)', () => {
    const CROSS_ID = 'sd000197';
    const COLLIDE_ID = 'sd000196';
    const CROSS_VERSIONS_URL = `${PROJECT_PREFIX}${CROSS_ID}/version`;
    const CHAMELEON_VERSIONS_URL = `${PROJECT_PREFIX}${CHAMELEON_ID}/version`;
    /** The fixtures' sha512 values are an 8-char token × 16 (128 hex chars). */
    const sha = (token: string): string => token.repeat(16);
    const CDN = 'https://cdn.modrinth.com/data';

    type Row = Record<string, unknown>;

    /** A listing derived in memory from the recorded first project (F-6 — never a hand-edited file). */
    function listing(id: string, slug: string, title: string, downloads: number): ModrinthProject {
      const base = baseList[0];
      if (base === undefined) throw new Error('user-projects.json is empty');
      return { ...base, id, slug, title, downloads } as ModrinthProject;
    }

    async function insertLink(projectId: string, externalId: string): Promise<void> {
      const { error } = await service.from('project_links').insert({
        project_id: projectId,
        platform: 'modrinth',
        external_id: externalId,
        url: modrinthListingUrl(externalId),
        downloads: 0,
        synced_at: new Date(Date.now() - 60_000).toISOString(),
      });
      if (error) throw new Error(error.message);
    }

    async function linkOf(projectId: string): Promise<Row> {
      const { data, error } = await service
        .from('project_links')
        .select('*')
        .eq('project_id', projectId)
        .eq('platform', 'modrinth')
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as Row;
    }

    async function projectById(id: string): Promise<Row> {
      const { data, error } = await service.from('projects').select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      return data as unknown as Row;
    }

    async function versionsOf(projectId: string): Promise<Row[]> {
      const { data, error } = await service
        .from('project_versions')
        .select('*')
        .eq('project_id', projectId)
        .order('id');
      if (error) throw new Error(error.message);
      return data as unknown as Row[];
    }

    async function filesOf(versionIds: string[]): Promise<Row[]> {
      if (versionIds.length === 0) return [];
      const { data, error } = await service
        .from('project_files')
        .select('*')
        .in('version_id', versionIds)
        .order('id');
      if (error) throw new Error(error.message);
      return data as unknown as Row[];
    }

    async function rowsForListing(externalId: string): Promise<number> {
      const { count, error } = await service
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'modrinth')
        .eq('external_id', externalId);
      if (error) throw new Error(error.message);
      return count ?? 0;
    }

    /** A hosted file row (`storage_path` set, no `url`) — what `uploadProjectFile` commits. */
    function hosted(projectId: string, versionId: string, filename: string, token: string) {
      return makeFile({
        version_id: versionId,
        filename,
        storage_path: `project-files/${projectId}/${versionId}/${filename}`,
        sha512: sha(token),
        url: null,
        primary: true,
        size_bytes: 4096,
      });
    }

    afterAll(async () => {
      await cleanupFactories();
      // The slug-collision insert is a synced row (not factory-tracked); the snapshot restore would
      // drop it in the file's afterAll, but later cases in this file count modrinth rows.
      const dropCollide = await service.from('projects').delete().eq('external_id', COLLIDE_ID);
      if (dropCollide.error) throw new Error(dropCollide.error.message);
    });

    it('T-ACT-82 a linked listing syncs INTO the canonical odsens row: no projects row, metadata untouched, versions adopt / re-parent / insert, sha512 pairing; rerun idempotent', async () => {
      // Arrange — the canonical odsens project with four hosted versions (external_id null) and a
      // stray row elsewhere already carrying one of the listing's version ids.
      const canonical = await makeProject({ source: 'odsens', status: 'published' });
      const h100 = await makeVersion({
        project_id: canonical,
        version_number: '1.0.0',
        name: 't_ hosted 1.0.0',
      });
      const h110 = await makeVersion({ project_id: canonical, version_number: '1.1.0' });
      const h200 = await makeVersion({ project_id: canonical, version_number: '2.0.0' });
      const h300 = await makeVersion({ project_id: canonical, version_number: '3.0.0' });
      const h100File = await hosted(canonical, h100, 't-cross-post-1.0.0.jar', 'aa10aa10'); // = upstream primary
      const h110File = await hosted(canonical, h110, 't-cross-post-1.1.0.jar', 'bb99bb99'); // same name, other bytes
      const h200File = await hosted(canonical, h200, 'my-build.jar', 'cc11cc11'); // = the NeoForge 2.0.0 file
      const h300File = await hosted(canonical, h300, 'other.jar', 'dd99dd99'); // matches neither 3.0.0
      const stray = await makeProject({ source: 'odsens', status: 'published' });
      const strayVersion = await makeVersion({
        project_id: stray,
        version_number: '4.0.0',
        external_id: 'sdv00907',
      });
      await insertLink(canonical, CROSS_ID);
      const cross = listing(CROSS_ID, 't-cross-post', 'T Cross Post', 4242);
      const canonicalBefore = await projectById(canonical);
      const straySlug = (await projectById(stray)).slug as string;

      // Act — run 1.
      spyFetch(
        routes([...fullList, cross], { [CROSS_VERSIONS_URL]: 'modrinth/versions-adopt.json' }),
      );
      const tags = spyRevalidateTag();
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary.errors).toEqual([]);

      // Never a `projects` row for the listing; the canonical metadata is Oliver's.
      expect(await rowsForListing(CROSS_ID)).toBe(0);
      const canonicalAfter = await projectById(canonical);
      expect(canonicalAfter.downloads_modrinth).toBe(4242);
      expect(canonicalAfter.synced_at).toEqual(canonicalBefore.synced_at);
      const metadata = (row: Row): Row => {
        const copy = { ...row };
        delete copy.downloads_modrinth;
        delete copy.updated_at;
        return copy;
      };
      expect(metadata(canonicalAfter)).toEqual(metadata(canonicalBefore));
      const link = await linkOf(canonical);
      expect(link.downloads).toBe(4242);
      expect(link.url).toBe(modrinthListingUrl(CROSS_ID));

      // Versions: 4 adopted + 2 inserted duplicates + 1 re-parented = 7, each upstream id once.
      const versions = await versionsOf(canonical);
      expect(versions).toHaveLength(7);
      const byExternal = new Map(versions.map((row) => [row.external_id as string, row]));
      expect([...byExternal.keys()].sort()).toEqual([
        'sdv00901',
        'sdv00902',
        'sdv00903',
        'sdv00904',
        'sdv00905',
        'sdv00906',
        'sdv00907',
      ]);
      // Adoption on the linked row (same version_number, external_id was null) — ids kept.
      expect(byExternal.get('sdv00901')?.id).toBe(h100);
      expect(byExternal.get('sdv00902')?.id).toBe(h110);
      // ADR-0026 tie-break: the candidate sharing a sha512 with the hosted file adopts (NeoForge)…
      expect(byExternal.get('sdv00904')?.id).toBe(h200);
      expect(byExternal.get('sdv00903')?.id).not.toBe(h200);
      // …else the first in adapter order (3.0.0 Fabric).
      expect(byExternal.get('sdv00905')?.id).toBe(h300);
      expect(byExternal.get('sdv00906')?.id).not.toBe(h300);
      // Global re-parent: the stray row followed its listing, id kept.
      expect(byExternal.get('sdv00907')?.id).toBe(strayVersion);
      expect(await versionsOf(stray)).toEqual([]);
      // Sync-owned columns follow Modrinth from adoption on.
      const adopted100 = byExternal.get('sdv00901');
      expect(adopted100?.name).toBe('First cross post');
      expect(adopted100?.downloads).toBe(1200);
      expect(adopted100?.changelog_md).toContain('Posted on both homes');
      expect(new Date(adopted100?.date_published as string).toISOString()).toBe(
        '2026-08-01T12:00:00.000Z',
      );

      // Files — sha512 pairing: same bytes → no new row, the hosted row gains the CDN url.
      const f100 = await filesOf([h100]);
      expect(f100).toHaveLength(2);
      const paired = f100.find((row) => row.id === h100File);
      expect(paired?.url).toBe(`${CDN}/${CROSS_ID}/versions/sdv00901/t-cross-post-1.0.0.jar`);
      expect(paired?.storage_path).not.toBeNull();
      expect(paired?.primary).toBe(true);
      const sources = f100.find((row) => row.id !== h100File);
      expect(sources?.filename).toBe('t-cross-post-1.0.0-sources.jar');
      expect(sources?.storage_path).toBeNull();
      expect(sources?.primary).toBe(false);
      // Same filename, different bytes: the hosted row is left alone, the upstream file is its own CDN row.
      const f110 = await filesOf([h110]);
      expect(f110).toHaveLength(2);
      const hostedRow110 = f110.find((row) => row.id === h110File);
      expect(hostedRow110?.url).toBeNull();
      expect(hostedRow110?.sha512).toBe(sha('bb99bb99'));
      const cdnRow110 = f110.find((row) => row.id !== h110File);
      expect(cdnRow110?.filename).toBe('t-cross-post-1.1.0.jar');
      expect(cdnRow110?.sha512).toBe(sha('bb10bb10'));
      expect(cdnRow110?.storage_path).toBeNull();
      // Pairing by bytes, not by name: `my-build.jar` gained the NeoForge CDN url; no second row.
      const f200 = await filesOf([h200]);
      expect(f200).toHaveLength(1);
      expect(f200[0]?.id).toBe(h200File);
      expect(f200[0]?.url).toBe(
        `${CDN}/${CROSS_ID}/versions/sdv00904/t-cross-post-2.0.0-neoforge.jar`,
      );
      // No byte match: the hosted row keeps no url; the upstream file lands as a CDN row.
      const f300 = await filesOf([h300]);
      expect(f300).toHaveLength(2);
      expect(f300.find((row) => row.id === h300File)?.url).toBeNull();
      expect(f300.find((row) => row.id !== h300File)?.storage_path).toBeNull();
      // The inserted duplicates and the re-parented row carry their own CDN file.
      for (const externalId of ['sdv00903', 'sdv00906', 'sdv00907']) {
        const rows = await filesOf([byExternal.get(externalId)?.id as string]);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.storage_path).toBeNull();
        expect(rows[0]?.primary).toBe(true);
      }

      // Revalidate: the canonical slug (never the Modrinth slug) + the re-parent source.
      expect(tags.calls).toContain('projects');
      expect(tags.calls).toContain(`project:${canonicalBefore.slug as string}`);
      expect(tags.calls).toContain(`project:${straySlug}`);
      expect(tags.calls).not.toContain('project:t-cross-post');
      expect(summary.items).toBeGreaterThanOrEqual(1);

      // Rerun — nothing but the link's synced_at moves; the linked listing counts no item.
      const versionIds = versions.map((row) => row.id as string);
      const filesBefore = await filesOf(versionIds);
      const linkBefore = await linkOf(canonical);
      spyFetch(
        routes([...fullList, cross], { [CROSS_VERSIONS_URL]: 'modrinth/versions-adopt.json' }),
      );
      const rerunTags = spyRevalidateTag();
      const rerun = await run();
      expect(rerun.ok).toBe(true);
      expect(rerun.errors).toEqual([]);
      expect(rerun.items).toBe(0);
      expect(rerun.versions).toBe(0);
      expect(rerun.files).toBe(0);
      expect(rerunTags.calls).toEqual([]);
      expect(await projectById(canonical)).toEqual(canonicalAfter);
      expect(await versionsOf(canonical)).toEqual(versions);
      expect(await filesOf(versionIds)).toEqual(filesBefore);
      expect(await rowsForListing(CROSS_ID)).toBe(0);
      const linkAfter = await linkOf(canonical);
      expect(linkAfter.synced_at).not.toBe(linkBefore.synced_at);
      expect(linkAfter.downloads).toBe(linkBefore.downloads);
      expect(linkAfter.url).toBe(linkBefore.url);

      await cleanupFactories();
    }, 60_000);

    it('T-ACT-82 a Modrinth-first row adopts its hosted version and keeps a hosted icon (never probed)', async () => {
      const chameleon = await projectBySlug('pixel-chameleon');
      const chameleonId = chameleon.id as string;
      const hostedIcon = `project-media/${chameleonId}/icon/t_icon.png`;
      const pre = await service
        .from('projects')
        .update({ icon_url: hostedIcon })
        .eq('id', chameleonId);
      if (pre.error) throw new Error(pre.error.message);
      const h990 = await makeVersion({ project_id: chameleonId, version_number: '9.9.0' });
      const h990File = await hosted(chameleonId, h990, 'pixel-chameleon-9.9.0.jar', 'ff10ff10');
      // Upstream advertises a resized icon: a probe would HEAD the CDN — a hosted icon must not.
      const listWithResizedIcon = fullList.map((project) =>
        project.id === CHAMELEON_ID
          ? { ...project, icon_url: `${CDN}/${CHAMELEON_ID}/abc123_96.webp` }
          : project,
      );
      const cdnCalls = (calls: readonly string[]) =>
        calls.filter((url) => url.startsWith('https://cdn.modrinth.com/'));

      try {
        const spy = spyFetch(
          routes(listWithResizedIcon, {
            [CHAMELEON_VERSIONS_URL]: 'modrinth/versions-modrinth-first.json',
          }),
        );
        const tags = spyRevalidateTag();
        const summary = await run();
        expect(summary.ok).toBe(true);
        expect(summary.errors).toEqual([]);
        expect(cdnCalls(spy.calls)).toEqual([]);
        expect((await projectById(chameleonId)).icon_url).toBe(hostedIcon);

        const adopted = (await versionsOf(chameleonId)).find((row) => row.id === h990);
        expect(adopted?.external_id).toBe('sdv00499');
        expect(adopted?.name).toBe('Hosted first');
        expect(adopted?.downloads).toBe(40);
        const files = await filesOf([h990]);
        expect(files).toHaveLength(2);
        const hostedRow = files.find((row) => row.id === h990File);
        expect(hostedRow?.url).toBe(
          `${CDN}/${CHAMELEON_ID}/versions/sdv00499/pixel-chameleon-9.9.0.jar`,
        );
        expect(hostedRow?.primary).toBe(true);
        const cdnRow = files.find((row) => row.id !== h990File);
        expect(cdnRow?.filename).toBe('pixel-chameleon-9.9.0-sources.jar');
        expect(cdnRow?.storage_path).toBeNull();
        expect(cdnRow?.primary).toBe(false);
        expect(tags.calls).toContain('project:pixel-chameleon');

        // Rerun: the hosted icon is still not a change, no probe, only synced_at/updated_at move.
        const before = await projectById(chameleonId);
        const versionsBefore = await versionsOf(chameleonId);
        const spy2 = spyFetch(
          routes(listWithResizedIcon, {
            [CHAMELEON_VERSIONS_URL]: 'modrinth/versions-modrinth-first.json',
          }),
        );
        const rerunTags = spyRevalidateTag();
        const rerun = await run();
        expect(rerun.ok).toBe(true);
        expect(rerun.items).toBe(0);
        expect(rerun.versions).toBe(0);
        expect(rerun.files).toBe(0);
        expect(cdnCalls(spy2.calls)).toEqual([]);
        expect(rerunTags.calls).toEqual([]);
        const after = await projectById(chameleonId);
        expect(after.icon_url).toBe(hostedIcon);
        expect(stable(after)).toEqual(stable(before));
        expect(await versionsOf(chameleonId)).toEqual(versionsBefore);
      } finally {
        // Self-contained: a hosted icon is never overwritten by the sync, so put the fixture value back.
        await cleanupFactories();
        const reset = await service
          .from('projects')
          .update({ icon_url: chameleon.icon_url as string })
          .eq('id', chameleonId);
        if (reset.error) throw new Error(reset.error.message);
      }
    }, 60_000);

    it('T-ACT-82 slug collision: an odsens row holds the mapped slug → insert as p-<id>, no error; the stored slug is kept on rerun', async () => {
      await makeProject({
        source: 'odsens',
        status: 'published',
        slug: 't-collide',
        title: 'T Collide',
      });
      const collide = listing(COLLIDE_ID, 't-collide', 'T Collide', 7);
      spyFetch(routes([...fullList, collide]));
      const tags = spyRevalidateTag();
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary.errors).toEqual([]);
      expect(await rowsForListing(COLLIDE_ID)).toBe(1);
      const inserted = await projectBySlug(`p-${COLLIDE_ID}`);
      expect(inserted.external_id).toBe(COLLIDE_ID);
      expect(inserted.status).toBe('published');
      expect(inserted.title).toBe('T Collide');
      expect(tags.calls).toContain(`project:p-${COLLIDE_ID}`);
      // The odsens row still owns the slug.
      expect((await projectBySlug('t-collide')).source).toBe('odsens');

      // Rerun: the collision persists → the stored slug is kept, nothing changes.
      spyFetch(routes([...fullList, collide]));
      const rerunTags = spyRevalidateTag();
      const rerun = await run();
      expect(rerun.ok).toBe(true);
      expect(rerun.errors).toEqual([]);
      expect(rerun.items).toBe(0);
      expect(rerunTags.calls).toEqual([]);
      const kept = await projectById(inserted.id as string);
      expect(kept.slug).toBe(`p-${COLLIDE_ID}`);
      expect(stable(kept)).toEqual(stable(inserted));

      await cleanupFactories();
      // The inserted listing row is synced (not factory-tracked): drop it here so the next case's
      // `hidden` count sees only its own duplicate (the describe's afterAll repeats this, harmlessly).
      const drop = await service.from('projects').delete().eq('external_id', COLLIDE_ID);
      if (drop.error) throw new Error(drop.error.message);
    }, 60_000);

    it('T-ACT-82 a duplicate whose listing is linked elsewhere: step 4 hides it, its versions follow the link, no fold, two runs converge', async () => {
      // The link is written, the fold never ran (the D1 failure-order case): the sync must converge.
      const canonical = await makeProject({ source: 'odsens', status: 'published' });
      const canonicalSlug = (await projectById(canonical)).slug as string;
      const canonicalBefore = await projectById(canonical);
      const duplicate = await projectBySlug('pixel-chameleon');
      const duplicateId = duplicate.id as string;
      const upstreamIds = (await loadFixture<{ id: string }[]>('modrinth', 'versions.json')).map(
        (version) => version.id,
      );
      const before = await versionsOf(duplicateId);
      const listedRows = before.filter((row) => upstreamIds.includes(row.external_id as string));
      const keptRows = before.filter((row) => !upstreamIds.includes(row.external_id as string));
      expect(listedRows).toHaveLength(upstreamIds.length);
      await insertLink(canonical, CHAMELEON_ID);
      const chameleonRaw = baseList.find((project) => project.id === CHAMELEON_ID);
      expect(chameleonRaw).toBeDefined();

      try {
        spyFetch(routes(fullList));
        const tags = spyRevalidateTag();
        const summary = await run();
        expect(summary.ok).toBe(true);
        expect(summary.errors).toEqual([]);
        expect(summary.hidden).toBe(1);
        expect((await projectById(duplicateId)).status).toBe('hidden');
        expect(await rowsForListing(CHAMELEON_ID)).toBe(1); // still exactly one row, never a second
        // Every upstream-listed version row followed its listing (global external_id key), ids
        // kept; rows absent upstream (the T-ACT-48 duplicates) stay where they are (ADR-0002 #66).
        const moved = await versionsOf(canonical);
        expect(moved.map((row) => row.id as string).sort()).toEqual(
          listedRows.map((row) => row.id as string).sort(),
        );
        expect((await versionsOf(duplicateId)).map((row) => row.id as string).sort()).toEqual(
          keptRows.map((row) => row.id as string).sort(),
        );
        // The canonical row: only downloads_modrinth moved.
        const canonicalAfter = await projectById(canonical);
        expect(canonicalAfter.downloads_modrinth).toBe(
          mapProject(chameleonRaw as ModrinthProject).downloads_modrinth,
        );
        expect(canonicalAfter.title).toBe(canonicalBefore.title);
        expect(canonicalAfter.icon_url).toBe(canonicalBefore.icon_url);
        expect(canonicalAfter.synced_at).toEqual(canonicalBefore.synced_at);
        expect(tags.calls).toContain(`project:${canonicalSlug}`);
        expect(tags.calls).toContain('project:pixel-chameleon');

        // Run 2 converges: nothing changes, nothing revalidates.
        spyFetch(routes(fullList));
        const rerunTags = spyRevalidateTag();
        const rerun = await run();
        expect(rerun.ok).toBe(true);
        expect(rerun.hidden).toBe(0);
        expect(rerun.items).toBe(0);
        expect(rerun.versions).toBe(0);
        expect(rerun.files).toBe(0);
        expect(rerunTags.calls).toEqual([]);
        expect((await projectById(duplicateId)).status).toBe('hidden');
        expect(await versionsOf(canonical)).toEqual(moved);
        expect(await projectById(canonical)).toEqual(canonicalAfter);
      } finally {
        // Unlink (the factory project takes its link and the moved rows with it) and let the next
        // run republish the listing's own row with its versions from the fixture.
        await cleanupFactories();
        spyFetch(routes(fullList));
        const back = await run();
        expect(back.ok).toBe(true);
        expect((await projectById(duplicateId)).status).toBe('published');
        expect((await versionsOf(duplicateId)).length).toBe(before.length);
      }
    }, 60_000);
  });

  describe('T-ACT-74 sync.failed edge (04 J-F, ADR-0030 D1)', () => {
    const LIST_FAILS: FixtureMap = { [LIST_URL]: 'status:400' };
    const NOW = () => new Date().toISOString();

    type FailedEvent = {
      id: string;
      actor_id: string | null;
      subject_type: string;
      subject_id: string;
      payload: { source?: string; run_id?: string; error?: string; started_at?: string };
    };

    async function failedEvents(): Promise<FailedEvent[]> {
      const { data, error } = await service
        .from('notification_events')
        .select('id, actor_id, subject_type, subject_id, payload')
        .eq('kind', 'sync.failed')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data as unknown as FailedEvent[];
      for (const row of rows) trackNotificationEvent(row.id);
      return rows.filter((row) => row.payload.source === 'modrinth');
    }

    beforeAll(async () => {
      await purgeNotificationEvents();
      // A fresh ok run is the latest row for the source (SEED-12's shape, arranged explicitly).
      await makeSyncRun({ source: 'modrinth', ok: true, items: 0, finished_at: NOW() });
    });

    it('T-ACT-74 first failing run after an ok run → exactly one sync.failed with the J-F payload', async () => {
      spyFetch(LIST_FAILS);
      const summary = await run();
      expect(summary.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.actor_id).toBeNull();
      expect(event.subject_type).toBe('sync_run');
      expect(event.subject_id).toBe(summary.run_id);
      expect(event.payload.source).toBe('modrinth');
      expect(event.payload.run_id).toBe(summary.run_id);
      expect(typeof event.payload.error).toBe('string');
      expect(event.payload.error?.length).toBeLessThanOrEqual(300);
      expect(event.payload.error).not.toMatch(/key=/i);
      expect(new Date(event.payload.started_at ?? '').toISOString()).toBe(event.payload.started_at);
    });

    it('T-ACT-74 a second consecutive failing run → no new event', async () => {
      spyFetch(LIST_FAILS);
      const summary = await run();
      expect(summary.ok).toBe(false);
      expect(await failedEvents()).toHaveLength(1);
    });

    it('T-ACT-74 failed → ok → failed → emits again', async () => {
      spyFetch(routes(fullList));
      const okRun = await run();
      expect(okRun.ok).toBe(true);
      expect(await failedEvents()).toHaveLength(1);
      spyFetch(LIST_FAILS);
      const failedRun = await run();
      expect(failedRun.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(2);
      expect(events[1]?.payload.run_id).toBe(failedRun.run_id);
    });

    it('T-ACT-74 failure with no previous run at all → emits', async () => {
      await cleanupFactories();
      // No other modrinth row exists: the content snapshot restores SEED-12 in afterAll.
      const wipe = await service.from('sync_runs').delete().eq('source', 'modrinth');
      expect(wipe.error).toBeNull();
      const before = (await failedEvents()).length;
      spyFetch(LIST_FAILS);
      const summary = await run();
      expect(summary.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(before + 1);
      expect(events.at(-1)?.payload.run_id).toBe(summary.run_id);
    });

    it('T-ACT-74 a failed previous-run read (J-F) is logged (emit_failed), never thrown, no event', async () => {
      await makeSyncRun({ source: 'modrinth', ok: true, items: 0, finished_at: NOW() });
      const before = (await failedEvents()).length;
      const logs = spyLog();
      spyFetch(LIST_FAILS);
      let summary: JobSummary;
      try {
        // The 1st sync_runs select is the SC-13 lock check; the 2nd is J-F's previous-run read.
        summary = await withDbFault({ table: 'sync_runs', op: 'select' }, { nth: 2 }, () => run());
      } finally {
        logs.restore();
      }
      expect(summary.ok).toBe(false);
      expect(await failedEvents()).toHaveLength(before);
      const line = (logs.lines as Array<{ msg?: string; meta?: { error?: string } }>).find(
        (entry) => entry.msg === 'emit_failed',
      );
      expect(line?.meta?.error).toMatch(/sync_runs previous read failed/);
    });

    it('T-ACT-74 a lost emit is logged (emit_failed) and never fails the run', async () => {
      await makeSyncRun({ source: 'modrinth', ok: true, items: 0, finished_at: NOW() });
      const before = (await failedEvents()).length;
      const logs = spyLog();
      spyFetch(LIST_FAILS);
      let summary: JobSummary;
      try {
        summary = await withDbFault({ table: 'notification_events', op: 'insert' }, {}, () =>
          run(),
        );
      } finally {
        logs.restore();
      }
      expect(summary.ok).toBe(false);
      expect(await failedEvents()).toHaveLength(before);
      const line = (logs.lines as Array<{ job?: string; msg?: string; id?: string }>).find(
        (entry) => entry.msg === 'emit_failed',
      );
      expect(line?.job).toBe('syncModrinth');
      expect(line?.id).toBe(summary.run_id);
    });
  });
});
