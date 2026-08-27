/**
 * tests/db/jobs/syncCurseforge.test.ts — T-ACT-45, T-ACT-52, T-ACT-71 (04 §3.2 SC-11/SC-16,
 * J-P/J-I/J-D; 05 §7.2 jobs layer; migration 20260827090400). `mutatesSeed`: the file perturbs the
 * SEED-6 curseforge link (and its project's `downloads_curseforge`) so the sync has something to
 * update, and restores every content table from a snapshot in `afterAll` (05 H-1).
 *
 * Harness per 05 §7.2: the job runs against the local DB with the adapter's `fetch` mocked to
 * fixtures — `spyFetch` routes the fixture-server URLs (`CURSEFORGE_API_BASE`, ADR-0002 #73) to
 * `tests/fixtures/curseforge/*`; the local Supabase stack passes through. The second link's payload
 * is derived in memory — recorded fixtures are never hand-edited (F-6).
 *
 * T-ACT-71's youtube/mentions clauses land with those jobs (S1.6/S1.8); S1.2 scope is
 * "curseforge no-key" (05 §8 row S1.2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { syncCurseforge } from '@/lib/jobs/syncCurseforge';
import type { JobSummary } from '@/lib/jobs/types';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { cleanupFactories, makeProject } from '@/tests/helpers/factories';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';
import { spyFetch, spyRevalidateTag } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const CF_BASE = process.env.CURSEFORGE_API_BASE ?? '';
const CF_KEY = process.env.CURSEFORGE_API_KEY ?? '';
const CHAMELEON_URL = `${CF_BASE}/mods/900001`;
const SECOND_URL = `${CF_BASE}/mods/900009`;

/** `curseforge/mod.json` values the seed link mirrors (SEED-6). */
const FIXTURE_DOWNLOADS = 120;
const FIXTURE_URL = 'https://www.curseforge.com/minecraft/mc-mods/pixel-chameleon';

/** The derived second link's upstream state (in-memory payload, F-6). */
const SECOND_DOWNLOADS = 777;
const SECOND_SITE = 'https://www.curseforge.com/minecraft/mc-mods/seed-mod';

let snapshot: ContentSnapshot;
let secondProjectId = '';
let secondSlug = '';

const json = (value: unknown) => (): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const secondMod = json({
  data: {
    id: 900009,
    slug: 'seed-mod',
    downloadCount: SECOND_DOWNLOADS,
    links: { websiteUrl: SECOND_SITE },
  },
});

function run(): Promise<JobSummary> {
  return syncCurseforge({ trigger: 'manual' });
}

type LinkRow = { downloads: number; url: string; synced_at: string | null };

async function linkRow(projectId: string): Promise<LinkRow> {
  const { data, error } = await service
    .from('project_links')
    .select('downloads, url, synced_at')
    .eq('project_id', projectId)
    .eq('platform', 'curseforge')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function cfDownloads(projectId: string): Promise<number> {
  const { data, error } = await service
    .from('projects')
    .select('downloads_curseforge')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data.downloads_curseforge;
}

/** Arranges stale numbers on both links so a successful item visibly updates them. */
async function perturbLinks(): Promise<void> {
  for (const projectId of [SEED_PROJECTS.pixelChameleon, secondProjectId]) {
    const link = await service
      .from('project_links')
      .update({ downloads: 5, url: 'https://www.curseforge.com/minecraft/mc-mods/stale' })
      .eq('project_id', projectId)
      .eq('platform', 'curseforge');
    if (link.error) throw new Error(link.error.message);
    const project = await service
      .from('projects')
      .update({ downloads_curseforge: 5 })
      .eq('id', projectId);
    if (project.error) throw new Error(project.error.message);
  }
}

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'curseforge');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  snapshot = await snapshotContentTables();
  // A second linked project so J-P has two items to split (T-ACT-52 one-of-two-fails case).
  secondProjectId = await makeProject({ source: 'odsens' });
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', secondProjectId)
    .single();
  if (error) throw new Error(error.message);
  secondSlug = data.slug;
  const inserted = await service.from('project_links').insert({
    project_id: secondProjectId,
    platform: 'curseforge',
    external_id: '900009',
    url: 'https://www.curseforge.com/minecraft/mc-mods/stale',
    downloads: 0,
    synced_at: new Date().toISOString(),
  });
  if (inserted.error) throw new Error(inserted.error.message);
});

afterAll(async () => {
  await restoreContentTables(snapshot);
  await cleanupFactories();
});

describe('syncCurseforge (04 §3.2)', () => {
  it('T-ACT-52 updates project_links + projects.downloads_curseforge per linked row; unlinked projects untouched; x-api-key sent', async () => {
    await perturbLinks();
    const maceBefore = await cfDownloads(SEED_PROJECTS.metalPipeMace);
    const fetchSpy = spyFetch({
      [CHAMELEON_URL]: 'curseforge/mod.json',
      [SECOND_URL]: secondMod,
    });
    const tags = spyRevalidateTag();
    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary.source).toBe('curseforge');
    expect(summary.items).toBe(2);
    expect(summary.errors).toEqual([]);

    const chameleon = await linkRow(SEED_PROJECTS.pixelChameleon);
    expect(chameleon.downloads).toBe(FIXTURE_DOWNLOADS);
    expect(chameleon.url).toBe(FIXTURE_URL);
    expect(chameleon.synced_at).not.toBeNull();
    expect(await cfDownloads(SEED_PROJECTS.pixelChameleon)).toBe(FIXTURE_DOWNLOADS);

    const second = await linkRow(secondProjectId);
    expect(second.downloads).toBe(SECOND_DOWNLOADS);
    expect(second.url).toBe(SECOND_SITE);
    expect(await cfDownloads(secondProjectId)).toBe(SECOND_DOWNLOADS);

    // Projects without a curseforge link are untouched.
    expect(await cfDownloads(SEED_PROJECTS.metalPipeMace)).toBe(maceBefore);

    // The adapter sent the key header on every call (T-ACT-52).
    expect(fetchSpy.requests.length).toBeGreaterThanOrEqual(2);
    for (const request of fetchSpy.requests) {
      expect(request.headers['x-api-key']).toBe(CF_KEY);
    }

    // Revalidates `projects` + `project:<slug>` per changed row.
    expect(tags.calls.filter((tag) => tag === 'projects')).toHaveLength(1);
    expect(tags.calls).toContain('project:pixel-chameleon');
    expect(tags.calls).toContain(`project:${secondSlug}`);
  });

  it('T-ACT-45 the run wrote exactly one finalized sync_runs row (error NULL on success)', async () => {
    const before = await syncRunCount();
    spyFetch({ [CHAMELEON_URL]: 'curseforge/mod.json', [SECOND_URL]: secondMod });
    const summary = await run();
    expect(await syncRunCount()).toBe(before + 1);
    const { data, error } = await service
      .from('sync_runs')
      .select('source, started_at, finished_at, ok, error')
      .eq('id', summary.run_id)
      .single();
    expect(error).toBeNull();
    expect(data?.source).toBe('curseforge');
    expect(data?.started_at).not.toBeNull();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.error).toBeNull();
  });

  it('T-ACT-52 one of two links 404 → ok=true, one summary error, the other updated, failed link keeps old numbers (J-P)', async () => {
    await perturbLinks();
    spyFetch({
      [CHAMELEON_URL]: 'curseforge/mod.json',
      [SECOND_URL]: 'curseforge/error-404.json',
    });
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.errors).toHaveLength(1);
    expect(summary.items).toBe(1);
    expect((await linkRow(SEED_PROJECTS.pixelChameleon)).downloads).toBe(FIXTURE_DOWNLOADS);
    // The failed link keeps the perturbed (old) numbers.
    expect((await linkRow(secondProjectId)).downloads).toBe(5);
    expect(await cfDownloads(secondProjectId)).toBe(5);
  });

  it('T-ACT-52 both links fail (> 50 %) → ok=false, run row records the error', async () => {
    spyFetch({
      [CHAMELEON_URL]: 'curseforge/error-404.json',
      [SECOND_URL]: 'curseforge/error-404.json',
    });
    const summary = await run();
    expect(summary.ok).toBe(false);
    expect(typeof summary.error).toBe('string');
    const { data } = await service
      .from('sync_runs')
      .select('ok, error')
      .eq('id', summary.run_id)
      .single();
    expect(data?.ok).toBe(false);
    expect(data?.error).not.toBeNull();
    expect(data?.error).not.toMatch(/key=/i);
  });

  it('T-ACT-52 a run with unchanged upstream numbers moves synced_at only and revalidates nothing (J-I)', async () => {
    // The first test left both links at the fixture values; serve the same payloads again.
    spyFetch({ [CHAMELEON_URL]: 'curseforge/mod.json', [SECOND_URL]: secondMod });
    const beforeRun = await linkRow(SEED_PROJECTS.pixelChameleon);
    // Restore the chameleon values the perturbation tests overwrote so nothing differs upstream.
    await service
      .from('project_links')
      .update({ downloads: FIXTURE_DOWNLOADS, url: FIXTURE_URL })
      .eq('project_id', SEED_PROJECTS.pixelChameleon)
      .eq('platform', 'curseforge');
    await service
      .from('project_links')
      .update({ downloads: SECOND_DOWNLOADS, url: SECOND_SITE })
      .eq('project_id', secondProjectId)
      .eq('platform', 'curseforge');
    const tags = spyRevalidateTag();
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.items).toBe(0);
    expect(tags.calls).toEqual([]);
    const after = await linkRow(SEED_PROJECTS.pixelChameleon);
    expect(after.downloads).toBe(FIXTURE_DOWNLOADS);
    expect(after.synced_at).not.toBe(beforeRun.synced_at);
  });

  it("T-ACT-71 CURSEFORGE_API_KEY unset → {ok:true, items:0, skipped:'not_configured'}, sync_runs ok=true error='not configured', no writes", async () => {
    const saved = env.CURSEFORGE_API_KEY;
    const before = await linkRow(SEED_PROJECTS.pixelChameleon);
    const runsBefore = await syncRunCount();
    // No fetch routes on purpose: a request here would throw (05 H-5) — the no-key run makes none.
    const fetchSpy = spyFetch({});
    const tags = spyRevalidateTag();
    try {
      env.CURSEFORGE_API_KEY = undefined;
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary.items).toBe(0);
      expect(summary.skipped).toBe('not_configured');

      // SC-11: the skipped run still wrote its row — ok=true, error='not configured' (04 §3.2).
      expect(await syncRunCount()).toBe(runsBefore + 1);
      const { data } = await service
        .from('sync_runs')
        .select('ok, error')
        .eq('id', summary.run_id)
        .single();
      expect(data?.ok).toBe(true);
      expect(data?.error).toBe('not configured');

      // No adapter call, no writes, no revalidation.
      expect(fetchSpy.calls).toEqual([]);
      expect(tags.calls).toEqual([]);
      expect(await linkRow(SEED_PROJECTS.pixelChameleon)).toEqual(before);
    } finally {
      env.CURSEFORGE_API_KEY = saved;
    }
  });
});
