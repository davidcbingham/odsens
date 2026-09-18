/**
 * tests/db/jobs/syncYoutube.test.ts — T-ACT-53, T-ACT-71 (youtube no-key), T-ACT-45 and
 * "T-ACT-74 syncYoutube" (04 §3.3 as amended by ADR-0043 D1/D2; 04 §3 J-F/J-P/J-I/J-D, SC-11/SC-16;
 * 00 S1.6 AC1/AC9/AC11; 05 §7.2 jobs layer; ADR-0043 D10; migration 20260918120000).
 * `mutatesSeed`: the runs insert the fixture channel's videos next to SEED-11, one test empties the
 * `videos` table on purpose (04 §3.3 step 3 "table empty → walk"), and every run adds a `sync_runs`
 * row — the file snapshots the content tables (`videos` + `sync_runs` included) and
 * restores them in `afterAll`, so SEED-11 / SEED-12 are back byte-for-byte for the e2e build (05 H-1).
 *
 * Harness per 05 §7.2: the job runs against the local DB with the adapter's `fetch` mocked to
 * fixtures. `spyFetch` keys are the three real request prefixes — `${YOUTUBE_RSS_BASE}`,
 * `${YOUTUBE_API_BASE}/videos`, `${YOUTUBE_API_BASE}/playlistItems` — never the bare API base, which
 * is a string prefix of the RSS URL. Fixtures (`tests/fixtures/README.md` youtube row):
 * one channel of 21 uploads `fixvid00001..21`; `rss.xml` = the newest 15; `videos-list.json` answers
 * all 21 whatever was asked (…08 live, …09 upcoming → 19 mapped); `playlist-items.json` = all 21 on
 * one page. No `fixvid…` id is a `seedvid…` id, so SEED-11 rows are "known ids the API did not
 * return" in every run here — they must come out untouched.
 *
 * The tests share state in file order (as the §3.1/§3.2 job files do): non-empty keyed run → rerun →
 * admin-owned columns → `full` walk → empty table → no-key → failures → DB faults → J-F.
 *
 * "T-ACT-74 syncYoutube" (AC11): the `sync.failed` edge through the shared runner for this job, plus
 * the delivery leg — a forced RSS list failure writes ONE event and one `runNotify` tick delivers it
 * through Resend (`tests/db/jobs/notify.test.ts` pattern; `admin_notify_emails` restored through
 * `restoreSeedSettings()`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { runNotify } from '@/lib/jobs/notify';
import { syncYoutube } from '@/lib/jobs/syncYoutube';
import type { JobSummary } from '@/lib/jobs/types';
import { touchSeedSyncRuns } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  restoreSeedSettings,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { withDbFault } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  factoryYoutubeId,
  makeSyncRun,
  makeVideo,
  purgeNotificationEvents,
  trackNotificationEvent,
} from '@/tests/helpers/factories';
import { SEED_VIDEOS } from '@/tests/helpers/seedIds';
import { spyFetch, spyLog, spyRevalidateTag } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const RSS_BASE = process.env.YOUTUBE_RSS_BASE ?? '';
const API_BASE = process.env.YOUTUBE_API_BASE ?? '';
const API_KEY = process.env.YOUTUBE_API_KEY ?? '';
if (RSS_BASE === '' || API_BASE === '' || API_KEY === '') {
  throw new Error('YOUTUBE_RSS_BASE / YOUTUBE_API_BASE / YOUTUBE_API_KEY are not set — .env.test?');
}
const VIDEOS_URL = `${API_BASE}/videos`;
const PLAYLIST_URL = `${API_BASE}/playlistItems`;
const RESEND_URL = `${process.env.RESEND_API_BASE ?? ''}/emails`;
const EMAIL_A = 'seed-admin@localhost.test';

/** All three upstreams answering their fixtures. */
const ALL_OK = {
  [RSS_BASE]: 'youtube/rss.xml',
  [VIDEOS_URL]: 'youtube/videos-list.json',
  [PLAYLIST_URL]: 'youtube/playlist-items.json',
};

/** `fixvid00001..21` minus the live (…08) and upcoming (…09) items — what `listVideos` maps. */
const FIXTURE_IDS = Array.from(
  { length: 21 },
  (_, index) => `fixvid${String(index + 1).padStart(5, '0')}`,
);
const LIVE_IDS = ['fixvid00008', 'fixvid00009'];
const MAPPED_IDS = FIXTURE_IDS.filter((id) => !LIVE_IDS.includes(id));
/** The feed's newest 15 that also come back mapped (13). */
const RSS_MAPPED_IDS = MAPPED_IDS.filter((id) => id <= 'fixvid00015');
const SEED_YOUTUBE_IDS: string[] = Object.values(SEED_VIDEOS).map((video) => video.youtubeId);

/** Every column but the two the DB moves on its own (`updated_at` trigger, `created_at` default). */
const COLUMNS =
  'youtube_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, is_short_override, view_count, like_count, synced_at, hidden';

type VideoRow = {
  youtube_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string;
  published_at: string;
  duration_seconds: number | null;
  is_short: boolean;
  is_short_override: boolean | null;
  view_count: number | null;
  like_count: number | null;
  synced_at: string | null;
  hidden: boolean;
};

let snapshot: ContentSnapshot;

function run(full = false): Promise<JobSummary> {
  return syncYoutube({ trigger: 'manual', full });
}

async function allVideos(): Promise<VideoRow[]> {
  const { data, error } = await service
    .from('videos')
    .select(COLUMNS)
    .order('youtube_id', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

async function videoRow(youtubeId: string): Promise<VideoRow | null> {
  const { data, error } = await service
    .from('videos')
    .select(COLUMNS)
    .eq('youtube_id', youtubeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function mustRow(youtubeId: string): Promise<VideoRow> {
  const row = await videoRow(youtubeId);
  if (row === null) throw new Error(`no videos row for ${youtubeId}`);
  return row;
}

async function patchVideo(youtubeId: string, patch: Partial<VideoRow>): Promise<void> {
  const { error } = await service.from('videos').update(patch).eq('youtube_id', youtubeId);
  if (error) throw new Error(error.message);
}

/** Test-side arrangement only (the job itself never removes a row — 04 J-D). */
async function removeVideos(youtubeIds: string[] | 'all'): Promise<void> {
  const query = service.from('videos').delete();
  const { error } = await (youtubeIds === 'all'
    ? query.not('youtube_id', 'is', null)
    : query.in('youtube_id', youtubeIds));
  if (error) throw new Error(error.message);
}

const withoutSyncedAt = (rows: VideoRow[]) => rows.map((row) => ({ ...row, synced_at: null }));

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'youtube');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function runRow(id: string) {
  const { data, error } = await service
    .from('sync_runs')
    .select('source, started_at, finished_at, ok, items, error')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  await touchSeedSyncRuns();
  snapshot = await snapshotContentTables();
});

afterAll(async () => {
  await restoreSeedSettings();
  await restoreContentTables(snapshot);
  await cleanupFactories();
  // Failed runs emit `sync.failed` through the runner (04 J-F) — purge them (H-1).
  await purgeNotificationEvents();
});

describe('syncYoutube (04 §3.3)', () => {
  it('T-ACT-53 non-empty table, no full → RSS + one videos.list (no playlistItems walk); new ids get Data-API rows; live/upcoming never get a row; SEED-11 untouched; revalidateTag(videos)', async () => {
    const seedBefore = (await allVideos()).filter((row) =>
      SEED_YOUTUBE_IDS.includes(row.youtube_id),
    );
    expect(seedBefore).toHaveLength(7);
    const fetchSpy = spyFetch(ALL_OK);
    const tags = spyRevalidateTag();
    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary.source).toBe('youtube');
    expect(summary).toMatchObject({
      items: 13,
      inserted: 13,
      updated: 0,
      rss: 15,
      walked: 0,
      full: false,
      errors: [],
    });
    expect(summary.degraded).toBeUndefined();
    expect(summary.skipped).toBeUndefined();

    // Gather order: the keyless feed, then ONE videos.list over every known id — no walk.
    expect(fetchSpy.calls).toHaveLength(2);
    expect(fetchSpy.calls[0]).toBe(`${RSS_BASE}?channel_id=${env.YOUTUBE_CHANNEL_ID}`);
    const listUrl = fetchSpy.calls[1] ?? '';
    expect(listUrl.startsWith(`${VIDEOS_URL}?part=snippet,contentDetails,statistics&id=`)).toBe(
      true,
    );
    for (const id of [...SEED_YOUTUBE_IDS, 'fixvid00001', 'fixvid00015']) {
      expect(listUrl).toContain(id); // "all known ids" = existing ∪ rss
    }
    expect(listUrl).not.toContain('fixvid00016');

    // Upserted by youtube_id: the 13 feed ids that came back mapped — and only those.
    const fixtureRows = (await allVideos()).filter((row) => row.youtube_id.startsWith('fixvid'));
    expect(fixtureRows.map((row) => row.youtube_id)).toEqual(RSS_MAPPED_IDS);
    // ADR-0043 D2: live (…08) / upcoming (…09) are in the feed but never get a row; …16 is in the
    // fixture answer but was not asked about.
    for (const id of [...LIVE_IDS, 'fixvid00016']) expect(await videoRow(id)).toBeNull();

    // Data-API fields + best thumbnail (maxres ▸ standard ▸ high ▸ …).
    expect(await mustRow('fixvid00001')).toMatchObject({
      title: 'I Rebuilt My Base & Regretted It',
      description:
        'Turns out a lava moat needs a plan.\n\nMods used are listed on the site.\nMusic: none, just vibes.',
      thumbnail_url: 'https://i.ytimg.com/vi/fixvid00001/maxresdefault.jpg',
      duration_seconds: 724,
      view_count: 48211,
      like_count: 2140,
      is_short: false,
      is_short_override: null,
      hidden: false,
    });
    expect(Date.parse((await mustRow('fixvid00001')).published_at)).toBe(
      Date.parse('2026-05-30T15:00:07Z'),
    );
    expect((await mustRow('fixvid00001')).synced_at).not.toBeNull();
    expect((await mustRow('fixvid00002')).thumbnail_url).toBe(
      'https://i.ytimg.com/vi/fixvid00002/sddefault.jpg',
    );
    // …03's feed thumbnail is on i3.ytimg.com — never stored (01 INV-54).
    expect((await mustRow('fixvid00003')).thumbnail_url).toBe(
      'https://i.ytimg.com/vi/fixvid00003/hqdefault.jpg',
    );
    expect((await mustRow('fixvid00010')).duration_seconds).toBe(3723);

    // is_short per T-ADP-11: ≤ 60 s · #shorts in the title · #Shorts in the description.
    expect((await mustRow('fixvid00003')).is_short).toBe(true);
    expect((await mustRow('fixvid00004')).is_short).toBe(true);
    expect((await mustRow('fixvid00005')).is_short).toBe(true);
    // Missing statistics / hidden likes → NULL, never 0 (T-ADP-12).
    expect(await mustRow('fixvid00006')).toMatchObject({ view_count: null, like_count: null });
    expect(await mustRow('fixvid00007')).toMatchObject({ view_count: 7044, like_count: null });

    // Known ids the API did not return (SEED-11) are left exactly as they were — synced_at included.
    const seedAfter = (await allVideos()).filter((row) =>
      SEED_YOUTUBE_IDS.includes(row.youtube_id),
    );
    expect(seedAfter).toEqual(seedBefore);

    expect(tags.calls).toEqual(['videos']);
  });

  it('T-ACT-53 rerun is idempotent (J-I): items 0, only synced_at moves on the confirmed rows, no revalidation', async () => {
    const before = await allVideos();
    spyFetch(ALL_OK);
    const tags = spyRevalidateTag();
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({ items: 0, inserted: 0, updated: 0, errors: [] });
    expect(tags.calls).toEqual([]);

    const after = await allVideos();
    expect(withoutSyncedAt(after)).toEqual(withoutSyncedAt(before));
    const beforeById = new Map(before.map((row) => [row.youtube_id, row.synced_at]));
    for (const row of after) {
      if (row.youtube_id.startsWith('fixvid')) {
        expect(row.synced_at).not.toBe(beforeById.get(row.youtube_id));
      } else {
        expect(row.synced_at).toBe(beforeById.get(row.youtube_id));
      }
    }
  });

  it('T-ACT-53 hidden and is_short_override are never overwritten (04 §1.8, ADR-0043 D1): is_short = override ?? heuristic', async () => {
    // As `updateVideo` leaves them: …01 hidden + forced Short; …03 (45 s) forced NOT a Short.
    await patchVideo('fixvid00001', {
      hidden: true,
      is_short_override: true,
      is_short: true,
      title: 't_ stale title',
      view_count: 1,
    });
    await patchVideo('fixvid00003', { is_short_override: false, is_short: false, view_count: 1 });
    // No override: a wrong effective flag is the heuristic's to put right (…04 has #shorts).
    await patchVideo('fixvid00004', { is_short: false });

    spyFetch(ALL_OK);
    const tags = spyRevalidateTag();
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({ items: 3, inserted: 0, updated: 3 });
    expect(tags.calls).toEqual(['videos']);

    expect(await mustRow('fixvid00001')).toMatchObject({
      hidden: true,
      is_short_override: true,
      is_short: true, // a 724 s video — the heuristic alone says false
      title: 'I Rebuilt My Base & Regretted It',
      view_count: 48211,
    });
    expect(await mustRow('fixvid00003')).toMatchObject({
      hidden: false,
      is_short_override: false,
      is_short: false, // a 45 s video — the heuristic alone says true
      view_count: 120455,
    });
    expect(await mustRow('fixvid00004')).toMatchObject({ is_short_override: null, is_short: true });

    // SEED-11's hidden row is still hidden.
    expect((await mustRow(SEED_VIDEOS.hiddenLong.youtubeId)).hidden).toBe(true);
  });

  it('T-ACT-53 an override flipped while the run gathers is kept (ADR-0043 D21): the stale is_short never lands, the other synced columns do', async () => {
    const { readFileSync } = await import('node:fs');
    const body = readFileSync('tests/fixtures/youtube/videos-list.json', 'utf8');
    const listed = () =>
      new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8' } });

    // Short ON mid-run: …01 (724 s) had no override at the read; the admin forces it while the
    // job is waiting on videos.list.
    await patchVideo('fixvid00001', { is_short_override: null, is_short: false, view_count: 1 });
    spyFetch({
      ...ALL_OK,
      [VIDEOS_URL]: async () => {
        await patchVideo('fixvid00001', { is_short_override: true, is_short: true });
        return listed();
      },
    });
    expect((await run()).ok).toBe(true);
    expect(await mustRow('fixvid00001')).toMatchObject({
      is_short_override: true,
      is_short: true,
      view_count: 48211,
    });

    // Auto mid-run: the override the job read is cleared and the heuristic value written by
    // `updateVideo` stands.
    await patchVideo('fixvid00001', { view_count: 1 });
    spyFetch({
      ...ALL_OK,
      [VIDEOS_URL]: async () => {
        await patchVideo('fixvid00001', { is_short_override: null, is_short: false });
        return listed();
      },
    });
    expect((await run()).ok).toBe(true);
    expect(await mustRow('fixvid00001')).toMatchObject({
      is_short_override: null,
      is_short: false,
      view_count: 48211,
    });

    // Back to what the previous test left — the full-run test below reads it.
    await patchVideo('fixvid00001', { is_short_override: true, is_short: true });
  });

  it('T-ACT-53 full:true → listUploads walk FIRST, then videos.list over all 21; videos absent from the walk are not deleted (J-D)', async () => {
    // A row the walk will not list (neither will it list any SEED-11 row).
    const orphanId = await makeVideo({ hidden: true });
    const orphanYoutubeId = factoryYoutubeId(orphanId);
    const orphanBefore = await mustRow(orphanYoutubeId);

    const fetchSpy = spyFetch(ALL_OK);
    const summary = await run(true);
    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({ full: true, walked: 21, inserted: 6, errors: [] });

    // RSS → playlistItems (uploads playlist "UU" + channelId.slice(2)) → videos.
    expect(fetchSpy.calls).toHaveLength(3);
    expect(fetchSpy.calls[0]?.startsWith(RSS_BASE)).toBe(true);
    expect(fetchSpy.calls[1]?.startsWith(`${PLAYLIST_URL}?part=contentDetails&playlistId=UU`)).toBe(
      true,
    );
    expect(fetchSpy.calls[1]).toContain(`playlistId=UU${env.YOUTUBE_CHANNEL_ID.slice(2)}`);
    expect(fetchSpy.calls[2]?.startsWith(`${VIDEOS_URL}?`)).toBe(true);
    expect(fetchSpy.calls[2]).toContain('fixvid00021');

    const rows = await allVideos();
    expect(
      rows.map((row) => row.youtube_id).filter((youtubeId) => youtubeId.startsWith('fixvid')),
    ).toEqual(MAPPED_IDS);
    // Only a `default` thumbnail upstream → that one; 61 s is one second past the Shorts line.
    expect(await mustRow('fixvid00020')).toMatchObject({
      thumbnail_url: 'https://i.ytimg.com/vi/fixvid00020/default.jpg',
    });
    expect(await mustRow('fixvid00021')).toMatchObject({ duration_seconds: 61, is_short: false });

    // Never deleted, never touched: the orphan and all seven SEED-11 rows are still there.
    expect(await mustRow(orphanYoutubeId)).toEqual(orphanBefore);
    for (const youtubeId of SEED_YOUTUBE_IDS) expect(await videoRow(youtubeId)).not.toBeNull();
    // Admin-owned columns from the previous test survived the full run too.
    expect(await mustRow('fixvid00001')).toMatchObject({ hidden: true, is_short_override: true });
  });

  it('T-ACT-53 empty videos table → listUploads walk first even without full; all 19 mapped uploads inserted (00 S1.6 AC1)', async () => {
    await removeVideos('all');
    expect(await allVideos()).toEqual([]);

    const fetchSpy = spyFetch(ALL_OK);
    const tags = spyRevalidateTag();
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({ full: false, walked: 21, items: 19, inserted: 19, updated: 0 });
    expect(fetchSpy.calls.map((url) => url.split('?')[0])).toEqual([
      RSS_BASE,
      PLAYLIST_URL,
      VIDEOS_URL,
    ]);
    expect((await allVideos()).map((row) => row.youtube_id)).toEqual(MAPPED_IDS);
    for (const row of await allVideos()) {
      expect(row.hidden).toBe(false); // column defaults — the job never writes either
      expect(row.is_short_override).toBeNull();
    }
    expect(tags.calls).toEqual(['videos']);
  });

  it('T-ACT-53 quota (00 S1.6 AC9, T-ADP-13): summary.units and the done log line carry the Data-API units — 1 per plain run, 2 with the walk, ≤ 10, never the key', async () => {
    const logs = spyLog();
    try {
      spyFetch(ALL_OK);
      const plain = await run();
      const walked = await run(true);
      expect(plain.units).toBe(1);
      expect(walked.units).toBe(2);
      expect(walked.units as number).toBeLessThanOrEqual(10);

      const done = (
        logs.lines as Array<{ job?: string; msg?: string; id?: string; meta?: { units?: number } }>
      ).filter((line) => line.job === 'syncYoutube' && line.msg === 'done');
      expect(done.map((line) => line.id)).toEqual([plain.run_id, walked.run_id]);
      expect(done.map((line) => line.meta?.units)).toEqual([1, 2]);
      expect(JSON.stringify(logs.lines)).not.toMatch(/key=/i);
    } finally {
      logs.restore();
    }
  });

  it('T-ACT-45 the run wrote exactly one finalized sync_runs row (error NULL on success)', async () => {
    const before = await syncRunCount();
    spyFetch(ALL_OK);
    const summary = await run();
    expect(await syncRunCount()).toBe(before + 1);
    const row = await runRow(summary.run_id);
    expect(row.source).toBe('youtube');
    expect(row.started_at).not.toBeNull();
    expect(row.finished_at).not.toBeNull();
    expect(row.ok).toBe(true);
    expect(row.items).toBe(0);
    expect(row.error).toBeNull();
  });

  describe('T-ACT-71 YOUTUBE_API_KEY unset (04 §3.3 Quota row, SC-16)', () => {
    it("T-ACT-71 no key → RSS-only: minimal hqdefault rows for new feed ids, summary.degraded='no_key', ok=true, Data-API fields never downgraded", async () => {
      // Two feed ids become "new" again; the rest keep their Data-API fields from the keyed runs.
      await removeVideos(['fixvid00002', 'fixvid00003']);
      const keptBefore = await mustRow('fixvid00001');
      const runsBefore = await syncRunCount();
      const saved = env.YOUTUBE_API_KEY;
      // Only the feed is routed: a Data-API request would fall through and fail the run.
      const fetchSpy = spyFetch({ [RSS_BASE]: 'youtube/rss.xml' });
      const tags = spyRevalidateTag();
      try {
        env.YOUTUBE_API_KEY = undefined;
        const summary = await run();
        expect(summary.ok).toBe(true);
        expect(summary.degraded).toBe('no_key');
        expect(summary.skipped).toBeUndefined();
        expect(summary.error).toBeUndefined();
        // …02, …03 + the live/upcoming pair: without the Data API the job cannot know (ADR-0043 D2).
        expect(summary).toMatchObject({ items: 4, inserted: 4, updated: 0, rss: 15, units: 0 });
        expect(fetchSpy.calls).toEqual([`${RSS_BASE}?channel_id=${env.YOUTUBE_CHANNEL_ID}`]);
        expect(tags.calls).toEqual(['videos']);

        // SC-11: an ordinary ok run — no error text (unlike §3.2's 'not configured').
        expect(await syncRunCount()).toBe(runsBefore + 1);
        expect(await runRow(summary.run_id)).toMatchObject({ ok: true, items: 4, error: null });
      } finally {
        env.YOUTUBE_API_KEY = saved;
      }

      // 04 §3.3 step 1 minimal row; the literal i.ytimg.com URL, not the feed's i3.ytimg.com one.
      const minimal = await mustRow('fixvid00003');
      expect(minimal).toMatchObject({
        title: 'Pipe bonk',
        thumbnail_url: 'https://i.ytimg.com/vi/fixvid00003/hqdefault.jpg',
        description: null,
        duration_seconds: null,
        view_count: null,
        like_count: null,
        is_short: false, // unknown duration is never a Short (04 §5.3 rows)
        is_short_override: null,
        hidden: false,
      });
      expect(Date.parse(minimal.published_at)).toBe(Date.parse('2026-05-16T15:00:00Z'));
      expect((await mustRow('fixvid00008')).thumbnail_url).toBe(
        'https://i.ytimg.com/vi/fixvid00008/hqdefault.jpg',
      );

      // Never downgraded: description, maxres thumbnail, duration and counts stay as stored.
      expect({ ...(await mustRow('fixvid00001')), synced_at: null }).toEqual({
        ...keptBefore,
        synced_at: null,
      });
    });

    it('T-ACT-71 a second no-key run (full:true) changes nothing but synced_at and never walks the playlist', async () => {
      const before = await allVideos();
      const saved = env.YOUTUBE_API_KEY;
      const fetchSpy = spyFetch({ [RSS_BASE]: 'youtube/rss.xml' });
      const tags = spyRevalidateTag();
      try {
        env.YOUTUBE_API_KEY = undefined;
        const summary = await run(true);
        expect(summary.ok).toBe(true);
        expect(summary).toMatchObject({ degraded: 'no_key', items: 0, walked: 0, units: 0 });
        expect(fetchSpy.calls).toHaveLength(1);
        expect(tags.calls).toEqual([]);
      } finally {
        env.YOUTUBE_API_KEY = saved;
      }
      expect(withoutSyncedAt(await allVideos())).toEqual(withoutSyncedAt(before));
    });

    it('T-ACT-71 a no-key run follows a changed feed title on a known row without touching its Data-API fields', async () => {
      await patchVideo('fixvid00001', { title: 't_ stale title' });
      const before = await mustRow('fixvid00001');
      const saved = env.YOUTUBE_API_KEY;
      spyFetch({ [RSS_BASE]: 'youtube/rss.xml' });
      try {
        env.YOUTUBE_API_KEY = undefined;
        expect(await run()).toMatchObject({ ok: true, items: 1, updated: 1 });
      } finally {
        env.YOUTUBE_API_KEY = saved;
      }
      expect({ ...(await mustRow('fixvid00001')), synced_at: null }).toEqual({
        ...before,
        title: 'I Rebuilt My Base & Regretted It',
        synced_at: null,
      });
    });

    it('T-ACT-71 the next keyed run upgrades the RSS-minimal rows; the live/upcoming stubs a no-key run made stay untouched', async () => {
      const liveBefore = await mustRow('fixvid00008');
      spyFetch(ALL_OK);
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary).toMatchObject({ inserted: 0, updated: 2 });
      expect(summary.degraded).toBeUndefined();
      expect(await mustRow('fixvid00003')).toMatchObject({
        description: 'One bonk. That is the video.',
        duration_seconds: 45,
        is_short: true,
        view_count: 120455,
      });
      expect(await mustRow('fixvid00008')).toEqual(liveBefore);
    });
  });

  describe('T-ACT-45 list-call failures change no row (ADR-0043 D2: gather, then write)', () => {
    /** A run that WOULD insert and update if it got as far as writing. */
    async function arrangePendingWrites(): Promise<VideoRow[]> {
      await removeVideos(['fixvid00002']);
      await patchVideo('fixvid00001', { view_count: 1 });
      return allVideos();
    }

    it('T-ACT-45 RSS list-call failure (500 ×4) → ok=false, error set (≤ 2000, no key), no videos row changed, no tags, run finalized', async () => {
      const before = await arrangePendingWrites();
      const runsBefore = await syncRunCount();
      const fetchSpy = spyFetch({ ...ALL_OK, [RSS_BASE]: 'status:500' });
      const tags = spyRevalidateTag();
      const summary = await run();
      expect(summary.ok).toBe(false);
      expect(typeof summary.error).toBe('string');
      expect((summary.error ?? '').length).toBeLessThanOrEqual(2000);
      expect(summary.error).not.toMatch(/key=/i);
      expect(fetchSpy.calls).toHaveLength(4); // SC-09: 1 + 3 retries, then nothing else is asked
      expect(summary.units).toBe(0);

      expect(await syncRunCount()).toBe(runsBefore + 1);
      const row = await runRow(summary.run_id);
      expect(row.finished_at).not.toBeNull();
      expect(row.ok).toBe(false);
      expect(row.items).toBe(0);
      expect(row.error).not.toBeNull();

      expect(await allVideos()).toEqual(before);
      expect(tags.calls).toEqual([]);
    });

    it('T-ACT-45 videos.list failure after a good feed → ok=false, zero writes (not even RSS rows), the spent unit is still reported, the key is redacted', async () => {
      const before = await arrangePendingWrites();
      spyFetch({ ...ALL_OK, [VIDEOS_URL]: 'status:400' });
      const tags = spyRevalidateTag();
      const logs = spyLog();
      let summary: JobSummary;
      try {
        summary = await run();
      } finally {
        logs.restore();
      }
      expect(summary.ok).toBe(false);
      expect(summary).toMatchObject({ items: 0, inserted: 0, updated: 0, rss: 15, units: 1 });
      expect(summary.error).toContain('/videos');
      expect(summary.error).not.toContain(`key=${API_KEY}`);
      expect((await runRow(summary.run_id)).error).not.toContain(`key=${API_KEY}`);
      const failed = (
        logs.lines as Array<{ job?: string; msg?: string; meta?: { units?: number } }>
      ).filter((line) => line.job === 'syncYoutube' && line.msg === 'failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.meta?.units).toBe(1);
      expect(JSON.stringify(logs.lines)).not.toContain(`key=${API_KEY}`);

      expect(await allVideos()).toEqual(before);
      expect(tags.calls).toEqual([]);
    });

    it('T-ACT-45 playlistItems failure on a full run → ok=false, zero writes, videos.list never asked', async () => {
      const before = await arrangePendingWrites();
      const fetchSpy = spyFetch({ ...ALL_OK, [PLAYLIST_URL]: 'status:400' });
      const summary = await run(true);
      expect(summary.ok).toBe(false);
      expect(summary.error).toContain('/playlistItems');
      expect(fetchSpy.calls.some((url) => url.startsWith(VIDEOS_URL))).toBe(false);
      expect(await allVideos()).toEqual(before);
    });

    it('T-ACT-45 a malformed feed (parse_error) is a list failure too → ok=false, zero writes', async () => {
      const before = await arrangePendingWrites();
      spyFetch({ ...ALL_OK, [RSS_BASE]: 'youtube/rss-malformed.xml' });
      const summary = await run();
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/parse_error/);
      expect(await allVideos()).toEqual(before);
    });

    it('T-ACT-45 a failed videos read → ok=false, error names the read, no upstream request', async () => {
      const fetchSpy = spyFetch(ALL_OK);
      const summary = await withDbFault({ table: 'videos', op: 'select' }, {}, () => run());
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/videos read failed/);
      expect(fetchSpy.calls).toEqual([]);
      expect(await runRow(summary.run_id)).toMatchObject({ ok: false });
    });
  });

  describe('T-ACT-53 per-item write errors (04 J-P)', () => {
    it('T-ACT-53 one failed insert is counted in summary.errors and the run stays ok; the other rows still sync', async () => {
      await removeVideos(['fixvid00002', 'fixvid00004']);
      await patchVideo('fixvid00001', { view_count: 1 });
      spyFetch(ALL_OK);
      const summary = await withDbFault({ table: 'videos', op: 'upsert' }, {}, () => run());
      expect(summary.ok).toBe(true);
      expect(summary).toMatchObject({ inserted: 1, updated: 1, items: 2 });
      expect(summary.errors).toHaveLength(1);
      expect((summary.errors as string[])[0]).toMatch(/^fixvid0000[24]: videos insert failed/);
      const present = [await videoRow('fixvid00002'), await videoRow('fixvid00004')].filter(
        (row) => row !== null,
      );
      expect(present).toHaveLength(1);
      expect((await mustRow('fixvid00001')).view_count).toBe(48211);
    });

    it('T-ACT-53 one failed update keeps the old values (J-P) and the run stays ok', async () => {
      spyFetch(ALL_OK);
      await run(); // heal the row the previous test left missing
      await patchVideo('fixvid00001', { view_count: 1 });
      const summary = await withDbFault({ table: 'videos', op: 'update' }, {}, () => run());
      expect(summary.ok).toBe(true);
      expect(summary.items).toBe(0);
      expect((summary.errors as string[])[0]).toMatch(/^fixvid00001: videos update failed/);
      expect((await mustRow('fixvid00001')).view_count).toBe(1);
    });

    it('T-ACT-53 more than half of the attempted ids failing → ok=false, error counts them, nothing revalidated', async () => {
      spyFetch(ALL_OK);
      await run(); // heal …01 — every row is now unchanged upstream
      const before = await allVideos();
      const tags = spyRevalidateTag();
      const summary = await withDbFault({ table: 'videos', op: 'update' }, { nth: 'all' }, () =>
        run(),
      );
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/^19\/19 items failed: .*videos touch failed/);
      expect((summary.errors as string[]).length).toBeLessThanOrEqual(20);
      expect(tags.calls).toEqual([]);
      expect(await allVideos()).toEqual(before);
    });
  });

  describe('T-ACT-74 syncYoutube sync.failed edge + delivery (04 J-F, ADR-0030 D1, 00 S1.6 AC11, ADR-0043 D10)', () => {
    /** 400 is not retried (SC-09) — a fast forced list failure. */
    const LIST_FAILS = { ...ALL_OK, [RSS_BASE]: 'status:400' };

    async function failedEvents(): Promise<{ id: string; run_id: string | undefined }[]> {
      const { data, error } = await service
        .from('notification_events')
        .select('id, payload')
        .eq('kind', 'sync.failed')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data as unknown as {
        id: string;
        payload: { source?: string; run_id?: string };
      }[];
      for (const row of rows) trackNotificationEvent(row.id);
      return rows
        .filter((row) => row.payload.source === 'youtube')
        .map((row) => ({ id: row.id, run_id: row.payload.run_id }));
    }

    beforeAll(async () => {
      await purgeNotificationEvents();
      await restoreSeedSettings();
      const { error } = await service
        .from('site_settings')
        .update({ admin_notify_emails: [EMAIL_A] })
        .eq('id', 1);
      if (error) throw new Error(error.message);
      await makeSyncRun({
        source: 'youtube',
        ok: true,
        items: 0,
        finished_at: new Date().toISOString(),
      });
    });

    it('T-ACT-74 syncYoutube: a forced list failure after an ok run → exactly one sync.failed for youtube, and the S1.5 pipeline delivers it (AC11)', async () => {
      spyFetch(LIST_FAILS);
      const summary = await run();
      expect(summary.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.run_id).toBe(summary.run_id);

      const { data: event, error: eventError } = await service
        .from('notification_events')
        .select('subject_type, subject_id, payload')
        .eq('id', events[0]?.id ?? '')
        .single();
      expect(eventError).toBeNull();
      expect(event?.subject_type).toBe('sync_run');
      expect(event?.subject_id).toBe(summary.run_id);
      const payload = event?.payload as { source: string; error: string; started_at: string };
      expect(payload.source).toBe('youtube');
      expect(payload.error.length).toBeLessThanOrEqual(300);
      expect(payload.error).not.toMatch(/key=/i);
      expect(Number.isNaN(Date.parse(payload.started_at))).toBe(false);

      // Delivery leg: one notify tick fans the event out to the admin address and sends it.
      const resend = spyFetch({ [RESEND_URL]: 'resend/send-ok.json' });
      const tick = await runNotify({ trigger: 'cron' });
      expect(tick.ok).toBe(true);
      const { data: recipients, error: recipientsError } = await service
        .from('notification_recipients')
        .select('channel, address, status')
        .eq('event_id', events[0]?.id ?? '')
        .eq('channel', 'email');
      expect(recipientsError).toBeNull();
      expect(recipients).toEqual([{ channel: 'email', address: EMAIL_A, status: 'sent' }]);
      expect(resend.calls.filter((url) => url === RESEND_URL).length).toBeGreaterThanOrEqual(1);
    });

    it('T-ACT-74 syncYoutube: a second consecutive failing run → no new event', async () => {
      spyFetch(LIST_FAILS);
      expect((await run()).ok).toBe(false);
      expect(await failedEvents()).toHaveLength(1);
    });

    it('T-ACT-74 syncYoutube: failed → ok → failed → emits again', async () => {
      spyFetch(ALL_OK);
      expect((await run()).ok).toBe(true);
      expect(await failedEvents()).toHaveLength(1);
      spyFetch(LIST_FAILS);
      const failedRun = await run();
      expect(failedRun.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(2);
      expect(events[1]?.run_id).toBe(failedRun.run_id);
    });

    it("T-ACT-74 syncYoutube: the degraded no-key run never emits (it is ok:true, degraded 'no_key')", async () => {
      const saved = env.YOUTUBE_API_KEY;
      const before = (await failedEvents()).length;
      spyFetch({ [RSS_BASE]: 'youtube/rss.xml' });
      try {
        env.YOUTUBE_API_KEY = undefined;
        const summary = await run();
        expect(summary.ok).toBe(true);
        expect(summary.degraded).toBe('no_key');
      } finally {
        env.YOUTUBE_API_KEY = saved;
      }
      expect(await failedEvents()).toHaveLength(before);
    });
  });
});
