/**
 * tests/db/actions/triggerSync.test.ts — T-ACT-42 + the `triggerSync` clause of T-ACT-70
 * (05 §7.2; 04 §1.7, SC-13, SC-24; 01 INV-72; ADR-0002 C7 / C16; migration 20260827090400).
 * `mutatesSeed`: the admin run is a real `syncCurseforge` pass (no-change against the SEED-6
 * fixture-mirroring link, so only `synced_at` moves and one `sync_runs` row lands), from S1.6 a real
 * `syncYoutube` pass with `full:true` (the fixture channel's 19 mapped uploads land next to SEED-11),
 * from S1.8 a real `refreshMentions` pass (no-change: the fixture never answers SEED-10's
 * `seedvid0001`, so only a `sync_runs` row lands) and, from S1.9, a real `snapshotStats` pass
 * (today's `stats_daily` rows for every entity — the SEED-12 pair rewritten with the same values)
 * — content tables (`videos`, `mentions`, `stats_daily` + `sync_runs` included) restore from a
 * snapshot in `afterAll` (05 H-1).
 *
 * Auth: admin A, **mod D `forbidden`**, user D `forbidden` (ADR-0002 C7), anon `unauthenticated`.
 * Input: `source` ∈ the five triggerable values — `notify`, `skins` (a `sync_runs` source with no
 * standalone job) and unknown strings → `validation`; `full:true` accepted only for `youtube`.
 * The admin call runs the job function directly (adapter `fetch` mocked to fixtures — never the
 * HTTP route, 01 INV-72), returns the `JobSummary` as `data`, writes `sync_runs`, and logs the
 * SC-24 audit line. An open run (5 min old) → D `conflict` "Already running." with no second row
 * (T-ACT-70; the job/route sides live in tests/db/jobs/). `youtube` runs `syncYoutube` since S1.6
 * (`full:true` reaches the job as the uploads-playlist walk — 04 §3.3 step 3; `spyFetch` keys are the
 * real request prefixes, never the bare `YOUTUBE_API_BASE`). `mentions` runs `refreshMentions` since
 * S1.8 (04 §3.4; ADR-0045 — its "Sync now" button lives on `/admin/mentions`). `stats` runs
 * `snapshotStats` since S1.9 (04 §3.5; ADR-0049 D9 — the `stats` row of the `/admin/stats` SYNC board; the
 * adapter's one `channels.list` request is answered by `youtube/channels.json`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { triggerSync } from '@/lib/actions/admin';
import type { TriggerSyncInput } from '@/lib/actions/admin.schema';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { cleanupFactories, makeSyncRun } from '@/tests/helpers/factories';
import { SEED_MENTIONS } from '@/tests/helpers/seedIds';
import { spyFetch, spyLog } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const CF_BASE = process.env.CURSEFORGE_API_BASE ?? '';
const MOD_URL = `${CF_BASE}/mods/900001`;
const RSS_BASE = process.env.YOUTUBE_RSS_BASE ?? '';
const YT_API_BASE = process.env.YOUTUBE_API_BASE ?? '';
const YT_VIDEOS_URL = `${YT_API_BASE}/videos`;
const YT_PLAYLIST_URL = `${YT_API_BASE}/playlistItems`;
const YT_CHANNELS_URL = `${YT_API_BASE}/channels`;

let snapshot: ContentSnapshot;

beforeAll(async () => {
  snapshot = await snapshotContentTables();
});

afterAll(async () => {
  await restoreContentTables(snapshot);
  await cleanupFactories();
});

async function syncRunCount(source: string): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', source);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

describe('T-ACT-42 triggerSync', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: sync is admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-42 $role → $code, no sync_runs row written', async ({ role, code, message }) => {
    const before = await syncRunCount('modrinth');
    const error = expectFail(await callAction(triggerSync, { source: 'modrinth' }, { role }), code);
    expect(error.message).toBe(message);
    expect(await syncRunCount('modrinth')).toBe(before);
  });

  it.each<{ name: string; input: TriggerSyncInput }>([
    {
      name: "source 'notify' (not triggerable, 04 §1.7)",
      input: { source: 'notify' } as unknown as TriggerSyncInput,
    },
    {
      name: "source 'skins' (a sync_runs source, not a job)",
      input: { source: 'skins' } as unknown as TriggerSyncInput,
    },
    { name: "unknown source 'bogus'", input: { source: 'bogus' } as unknown as TriggerSyncInput },
    { name: 'full:true for modrinth (youtube only)', input: { source: 'modrinth', full: true } },
    {
      name: 'full:true for curseforge (youtube only)',
      input: { source: 'curseforge', full: true },
    },
    { name: 'full:true for mentions (youtube only)', input: { source: 'mentions', full: true } },
    { name: 'full:true for stats (youtube only)', input: { source: 'stats', full: true } },
  ])('T-ACT-42 $name → validation', async ({ input }) => {
    expectFail(await callAction(triggerSync, input, { role: 'admin' }), 'validation');
  });

  it("T-ACT-42 source 'stats' runs snapshotStats directly (S1.9) → {ok:true, data:<JobSummary>} with source 'stats', one channels.list request, today's rows written, a new sync_runs row, SC-24", async () => {
    const before = await syncRunCount('stats');
    const fetchSpy = spyFetch({ [YT_CHANNELS_URL]: 'youtube/channels.json' });
    const logs = spyLog();
    try {
      const summary = expectOk(
        await callAction(triggerSync, { source: 'stats' }, { role: 'admin' }),
      );
      expect(summary.ok).toBe(true);
      expect(summary.source).toBe('stats');
      expect(typeof summary.run_id).toBe('string');
      expect(typeof summary.ms).toBe('number');
      expect(summary.skipped).toBeUndefined();
      // The ADR-0049 D7 shape: today's rows for every entity, the one channels.list unit, no errors.
      expect(summary.items).toBeGreaterThan(10);
      expect(summary.units).toBe(1);
      expect(summary.errors).toEqual([]);
      expect(summary.rows).toMatchObject({ site: 10, channel: 2 });
      expect(summary.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fetchSpy.calls).toHaveLength(1);
      expect(fetchSpy.calls[0]?.startsWith(`${YT_CHANNELS_URL}?part=statistics&id=`)).toBe(true);
      const { count: written } = await service
        .from('stats_daily')
        .select('*', { count: 'exact', head: true })
        .eq('day', String(summary.day));
      expect(written).toBe(summary.items);

      // The job function ran in-process (01 INV-72 — no request to the cron route), as a manual run.
      expect(fetchSpy.calls.some((url) => url.includes('/api/cron/'))).toBe(false);
      const done = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.job === 'snapshotStats' && line.msg === 'done',
      );
      expect(done).toHaveLength(1);
      expect((done[0]?.meta as { trigger?: string }).trigger).toBe('manual');

      expect(await syncRunCount('stats')).toBe(before + 1);
      const { data: run, error } = await service
        .from('sync_runs')
        .select('source, finished_at, ok, items')
        .eq('id', summary.run_id)
        .single();
      expect(error).toBeNull();
      expect(run?.source).toBe('stats');
      expect(run?.finished_at).not.toBeNull();
      expect(run?.ok).toBe(true);
      expect(run?.items).toBe(summary.items);

      // SC-24: keys only.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('triggerSync');
      expect(line.meta.target_type).toBe('sync_run');
      expect(line.meta.target_id).toBe(summary.run_id);
      expect(line.meta.fields).toEqual(['source']);
    } finally {
      logs.restore();
      fetchSpy.restore();
    }
  });

  it("T-ACT-42 source 'mentions' runs refreshMentions directly (S1.8) → {ok:true, data:<JobSummary>}, one part=statistics request, sync_runs written, SC-24", async () => {
    const before = await syncRunCount('mentions');
    const fetchSpy = spyFetch({ [YT_VIDEOS_URL]: 'youtube/videos-mentions.json' });
    const logs = spyLog();
    try {
      const summary = expectOk(
        await callAction(triggerSync, { source: 'mentions' }, { role: 'admin' }),
      );
      expect(summary.ok).toBe(true);
      expect(summary.source).toBe('mentions');
      expect(typeof summary.run_id).toBe('string');
      expect(typeof summary.items).toBe('number');
      expect(typeof summary.ms).toBe('number');
      expect(summary.skipped).toBeUndefined();
      // SEED-10 …0301 is eligible, so the job asked the Data API once — with `part=statistics`.
      expect(summary.units).toBe(1);
      expect(summary.mentions).toBeGreaterThanOrEqual(1);
      expect(fetchSpy.calls).toHaveLength(1);
      expect(fetchSpy.calls[0]?.startsWith(`${YT_VIDEOS_URL}?part=statistics&id=`)).toBe(true);
      expect(fetchSpy.calls[0]).toContain('seedvid0001');
      // The fixture never answers `seedvid0001` → the seed mention keeps its number (04 §3.4).
      const { data: seed } = await service
        .from('mentions')
        .select('view_count')
        .eq('id', SEED_MENTIONS.youtube)
        .single();
      expect(seed?.view_count).toBe(1_200_000);

      // The job function ran in-process (01 INV-72 — no request to the cron route), as a manual run.
      expect(fetchSpy.calls.some((url) => url.includes('/api/cron/'))).toBe(false);
      const done = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.job === 'refreshMentions' && line.msg === 'done',
      );
      expect(done).toHaveLength(1);
      expect((done[0]?.meta as { trigger?: string }).trigger).toBe('manual');

      expect(await syncRunCount('mentions')).toBe(before + 1);
      const { data: run, error } = await service
        .from('sync_runs')
        .select('source, finished_at, ok')
        .eq('id', summary.run_id)
        .single();
      expect(error).toBeNull();
      expect(run?.source).toBe('mentions');
      expect(run?.finished_at).not.toBeNull();
      expect(run?.ok).toBe(true);

      // SC-24: keys only.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('triggerSync');
      expect(line.meta.target_type).toBe('sync_run');
      expect(line.meta.target_id).toBe(summary.run_id);
      expect(line.meta.fields).toEqual(['source']);
    } finally {
      logs.restore();
      fetchSpy.restore();
    }
  });

  it("T-ACT-70 open mentions run (5 min old) → conflict 'Already running.', no second row, no upstream request", async () => {
    const lockId = await makeSyncRun({
      source: 'mentions',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const withLock = await syncRunCount('mentions');
    const fetchSpy = spyFetch({ [YT_VIDEOS_URL]: 'youtube/videos-mentions.json' });
    try {
      const error = expectFail(
        await callAction(triggerSync, { source: 'mentions' }, { role: 'admin' }),
        'conflict',
      );
      expect(error.message).toBe('Already running.');
      expect(await syncRunCount('mentions')).toBe(withLock);
      expect(fetchSpy.calls).toEqual([]);
    } finally {
      fetchSpy.restore();
      // Close the arranged row so it cannot hold the lock for a later test in this file.
      await service
        .from('sync_runs')
        .update({ finished_at: new Date().toISOString(), ok: true })
        .eq('id', lockId);
    }
  });

  it('T-ACT-42 full:true for youtube runs syncYoutube directly with the playlist walk → {ok:true, data:<JobSummary>}, sync_runs written, SC-24', async () => {
    const before = await syncRunCount('youtube');
    const fetchSpy = spyFetch({
      [RSS_BASE]: 'youtube/rss.xml',
      [YT_VIDEOS_URL]: 'youtube/videos-list.json',
      [YT_PLAYLIST_URL]: 'youtube/playlist-items.json',
    });
    const logs = spyLog();
    try {
      const summary = expectOk(
        await callAction(triggerSync, { source: 'youtube', full: true }, { role: 'admin' }),
      );
      expect(summary.ok).toBe(true);
      expect(summary.source).toBe('youtube');
      expect(typeof summary.run_id).toBe('string');
      expect(typeof summary.ms).toBe('number');
      // `full` reached the job: the walk ran before videos.list and every mapped upload landed.
      expect(summary.full).toBe(true);
      expect(summary.walked).toBe(21);
      expect(summary.items).toBe(19);
      expect(fetchSpy.calls.map((url) => url.split('?')[0])).toEqual([
        RSS_BASE,
        YT_PLAYLIST_URL,
        YT_VIDEOS_URL,
      ]);

      // The job function ran in-process (01 INV-72 — no request to the cron route).
      expect(fetchSpy.calls.some((url) => url.includes('/api/cron/'))).toBe(false);
      expect(await syncRunCount('youtube')).toBe(before + 1);
      const { data: run, error } = await service
        .from('sync_runs')
        .select('source, finished_at, ok, items')
        .eq('id', summary.run_id)
        .single();
      expect(error).toBeNull();
      expect(run?.source).toBe('youtube');
      expect(run?.finished_at).not.toBeNull();
      expect(run?.ok).toBe(true);
      expect(run?.items).toBe(19);

      // SC-24: keys only — `full` is named, its value is not logged.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('triggerSync');
      expect(line.meta.target_id).toBe(summary.run_id);
      expect(line.meta.fields).toEqual(['source', 'full']);
    } finally {
      logs.restore();
      fetchSpy.restore();
    }
  });

  it("T-ACT-70 open youtube run (5 min old) → conflict 'Already running.', no second row, no upstream request", async () => {
    const lockId = await makeSyncRun({
      source: 'youtube',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const withLock = await syncRunCount('youtube');
    const fetchSpy = spyFetch({ [RSS_BASE]: 'youtube/rss.xml' });
    try {
      const error = expectFail(
        await callAction(triggerSync, { source: 'youtube' }, { role: 'admin' }),
        'conflict',
      );
      expect(error.message).toBe('Already running.');
      expect(await syncRunCount('youtube')).toBe(withLock);
      expect(fetchSpy.calls).toEqual([]);
    } finally {
      fetchSpy.restore();
      // Close the arranged row so it cannot hold the lock for a later test in this file.
      await service
        .from('sync_runs')
        .update({ finished_at: new Date().toISOString(), ok: true })
        .eq('id', lockId);
    }
  });

  it('T-ACT-42 admin runs the job function directly → {ok:true, data:<JobSummary>}, sync_runs written, SC-24', async () => {
    const before = await syncRunCount('curseforge');
    const fetchSpy = spyFetch({ [MOD_URL]: 'curseforge/mod.json' });
    const logs = spyLog();
    try {
      const summary = expectOk(
        await callAction(triggerSync, { source: 'curseforge' }, { role: 'admin' }),
      );
      expect(summary.ok).toBe(true);
      expect(summary.source).toBe('curseforge');
      expect(typeof summary.run_id).toBe('string');
      expect(typeof summary.items).toBe('number');
      expect(typeof summary.ms).toBe('number');

      // The job ran for real: one finalized `sync_runs` row, adapter fetch hit the fixture.
      expect(await syncRunCount('curseforge')).toBe(before + 1);
      const { data: run, error } = await service
        .from('sync_runs')
        .select('source, finished_at, ok')
        .eq('id', summary.run_id)
        .single();
      expect(error).toBeNull();
      expect(run?.source).toBe('curseforge');
      expect(run?.finished_at).not.toBeNull();
      expect(run?.ok).toBe(true);
      expect(fetchSpy.calls).toContain(MOD_URL);

      // SC-24: keys only.
      const adminLines = (logs.lines as Array<Record<string, unknown>>).filter(
        (line) => line.msg === 'admin',
      );
      expect(adminLines).toHaveLength(1);
      const line = adminLines[0] as { action: string; meta: Record<string, unknown> };
      expect(line.action).toBe('triggerSync');
      expect(Object.keys(line.meta).sort()).toEqual([
        'actor_profile_id',
        'fields',
        'target_id',
        'target_type',
      ]);
      expect(line.meta.actor_profile_id).toBe(SEED_ROLE_IDS.admin);
      expect(line.meta.target_type).toBe('sync_run');
      expect(line.meta.target_id).toBe(summary.run_id);
      expect(line.meta.fields).toEqual(['source']);
    } finally {
      logs.restore();
      fetchSpy.restore();
    }
  });

  it("T-ACT-70 open run (5 min old) → conflict 'Already running.', no second row", async () => {
    await makeSyncRun({
      source: 'curseforge',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const withLock = await syncRunCount('curseforge');

    const error = expectFail(
      await callAction(triggerSync, { source: 'curseforge' }, { role: 'admin' }),
      'conflict',
    );
    expect(error.message).toBe('Already running.');
    expect(await syncRunCount('curseforge')).toBe(withLock);
  });
});
