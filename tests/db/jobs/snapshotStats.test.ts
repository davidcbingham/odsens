/**
 * tests/db/jobs/snapshotStats.test.ts — T-ACT-55, T-ACT-75, T-ACT-45, T-ACT-70 and
 * "T-ACT-74 snapshotStats" (04 §3.5; 04 §1.4.5 U1; 04 §3 J-F/J-P, SC-11/SC-13; 00 S1.9 AC1 / AC9;
 * 05 §7.2 jobs layer; migrations 20260926120000 + 20260926120100; ADR-0049 D5..ADR-0049 D7, ADR-0049 D16, ADR-0049 D17,
 * ADR-0049 D19..ADR-0049 D21). `mutatesSeed`: every run adds a `sync_runs` row and rewrites today's SEED-12
 * `stats_daily` pair (with the same values on the pristine seed — ADR-0049 D4) while writing every other
 * entity's rows — the file snapshots the content tables (`stats_daily` + `sync_runs` included) and
 * restores them in `afterAll` (05 H-1). Its own `project_downloads` / `rate_limit_hits` rows carry
 * `t_` tags and are removed here; factory rows leave with `cleanupFactories`; every Storage object
 * it uploads it removes, and the two seed objects it ages get their `created_at` put back.
 *
 * Harness per 05 §7.2: the job runs against the local DB with the adapter's `fetch` mocked.
 * `spyFetch` key = the real request prefix `${YOUTUBE_API_BASE}/channels` — ALWAYS routed on a keyed
 * run: the base is a loopback host, and an unrouted loopback URL passes through `spyFetch` to the
 * real network. Upstream payload: `youtube/channels.json` (views 1,284,530 · subs 21,400); derived
 * payloads (a hidden subscriber count) are built in memory from that fixture (F-6).
 *
 * Expected rows are DERIVED from the DB through the service client (`expectedInput`) and compared
 * against what the run wrote — never trusted from the brief's arithmetic — and the documented seed
 * truths (SEED-4 downloads 4099 / 120 / 7, SEED-9 comments 2 published · 1 held · 1 like, SEED-3
 * five handles, SEED-10 reach 1.2M · 2 mentions) are asserted on that derived input as well.
 *
 * The tests share state in file order: pure core → first run → rerun → ADR-0049 D19 direct row → purges →
 * no key → channel failure / hidden subs → gather + upsert failures → housekeeping failures → lock →
 * J-F → the U1 orphan sweep (its own uploads, aged through `sql()`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import {
  ORPHAN_BUCKETS,
  ORPHAN_CLEANUP_MAX,
  ORPHAN_MIN_AGE_HOURS,
  PROJECT_DOWNLOADS_RETENTION_DAYS,
  RATE_LIMIT_HITS_RETENTION_DAYS,
  STATS_UPSERT_CHUNK,
} from '@/lib/jobs/constants';
import {
  buildSnapshotRows,
  countSnapshotRows,
  planOrphanRemovals,
  snapshotStats,
  type OrphanCandidate,
  type SnapshotInput,
  type SnapshotRow,
} from '@/lib/jobs/snapshotStats';
import type { JobSummary } from '@/lib/jobs/types';
import { addDays, SITE_ENTITY_ID, utcDay } from '@/lib/stats';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { sql } from '@/tests/helpers/db';
import { withDbFault } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeArt,
  makeFile,
  makeProject,
  makeSyncRun,
  makeVersion,
  purgeNotificationEvents,
  trackNotificationEvent,
} from '@/tests/helpers/factories';
import { fixturePath, loadFixture } from '@/tests/helpers/fixtures';
import { SEED_FILES, SEED_PROJECTS, SEED_VERSIONS } from '@/tests/helpers/seedIds';
import { listObjects, removeObjects, uploadFixture, type Bucket } from '@/tests/helpers/storage';
import { spyFetch, spyLog, spyRevalidateTag } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const API_BASE = process.env.YOUTUBE_API_BASE ?? '';
const API_KEY = process.env.YOUTUBE_API_KEY ?? '';
if (API_BASE === '' || API_KEY === '') {
  throw new Error('YOUTUBE_API_BASE / YOUTUBE_API_KEY are not set — is .env.test loaded?');
}
const CHANNELS_URL = `${API_BASE}/channels`;
/** `youtube/channels.json` (tests/fixtures/README.md): views 1,284,530 · subs 21,400. */
const FIXTURE_OK = { [CHANNELS_URL]: 'youtube/channels.json' };
const CHANNEL_VIEWS = 1_284_530;
const CHANNEL_SUBS = 21_400;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** The five-column idempotency key, as a string (the `contentReset` NUL trick). */
type KeyedRow = {
  day: string;
  metric: string;
  source: string;
  entity_type: string;
  entity_id: string;
  value: number;
  updated_at: string;
};

let snapshot: ContentSnapshot;

function run(): Promise<JobSummary> {
  return snapshotStats({ trigger: 'manual' });
}

function keyOf(row: {
  day: string;
  metric: string;
  source: string;
  entity_type: string;
  entity_id: string;
}): string {
  return [row.day, row.metric, row.source, row.entity_type, row.entity_id].join('\0');
}

function sortRows<
  T extends { day: string; metric: string; source: string; entity_type: string; entity_id: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/** Every `stats_daily` row of one UTC day (≤ 1,000 — the seed plus this file's runs). */
async function rowsOn(day: string): Promise<KeyedRow[]> {
  const { data, error } = await service
    .from('stats_daily')
    .select('day, metric, source, entity_type, entity_id, value, updated_at')
    .eq('day', day)
    .limit(1000);
  if (error) throw new Error(error.message);
  return sortRows(data);
}

function valueOf(
  rows: readonly KeyedRow[],
  metric: string,
  source: string,
  entity_type: string,
  entity_id: string,
): number | undefined {
  return rows.find(
    (row) =>
      row.metric === metric &&
      row.source === source &&
      row.entity_type === entity_type &&
      row.entity_id === entity_id,
  )?.value;
}

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'stats');
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

/**
 * The 04 §3.5 numbers read straight from the DB (service client) — what a correct run must write.
 * `channel` is the fixture's answer; the caller overrides it for the no-key / failure legs.
 */
async function expectedInput(day: string): Promise<SnapshotInput> {
  const projects = await service
    .from('projects')
    .select('id, downloads_modrinth, downloads_curseforge, downloads_direct')
    .order('id');
  if (projects.error) throw new Error(projects.error.message);
  const videos = await service.from('videos').select('id, view_count, like_count').order('id');
  if (videos.error) throw new Error(videos.error.message);
  const countWhere = async (status: 'published' | 'held'): Promise<number> => {
    const { count, error } = await service
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const likeRows = await service.from('comments').select('like_count');
  if (likeRows.error) throw new Error(likeRows.error.message);
  const users = await service
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .not('handle', 'is', null);
  if (users.error) throw new Error(users.error.message);
  const mentions = await service.from('mentions').select('view_count').eq('status', 'published');
  if (mentions.error) throw new Error(mentions.error.message);
  const downloads = await service
    .from('project_downloads')
    .select('project_id')
    .gte('created_at', `${addDays(day, -1)}T00:00:00Z`)
    .lt('created_at', `${day}T00:00:00Z`);
  if (downloads.error) throw new Error(downloads.error.message);
  const directDownloadsByProject = new Map<string, number>();
  for (const row of downloads.data) {
    directDownloadsByProject.set(
      row.project_id,
      (directDownloadsByProject.get(row.project_id) ?? 0) + 1,
    );
  }
  return {
    day,
    projects: projects.data,
    videos: videos.data,
    commentsPublished: await countWhere('published'),
    commentsHeld: await countWhere('held'),
    likes: likeRows.data.reduce((sum, row) => sum + row.like_count, 0),
    users: users.count ?? 0,
    reach: mentions.data.reduce((sum, row) => sum + (row.view_count ?? 0), 0),
    mentions: mentions.data.length,
    directDownloadsByProject,
    channel: { views: CHANNEL_VIEWS, subs: CHANNEL_SUBS },
  };
}

/** The rows a run must have written, compared on the key columns + value (not timestamps). */
function bare(rows: readonly (SnapshotRow | KeyedRow)[]) {
  return sortRows(rows).map(({ day, metric, source, entity_type, entity_id, value }) => ({
    day,
    metric,
    source,
    entity_type,
    entity_id,
    value,
  }));
}

// ---- arranged housekeeping rows (`t_` tags; removed in `afterAll`) ----

async function insertDownload(createdAt: string, projectId = SEED_PROJECTS.seedExclusivePack) {
  const tag = `t_${randomUUID()}`;
  const { data, error } = await service
    .from('project_downloads')
    .insert({
      project_id: projectId,
      file_id: SEED_FILES.exclusiveZip,
      ip_hash: tag,
      ua_hash: tag,
      created_at: createdAt,
    })
    .select('id')
    .single();
  if (error) throw new Error(`project_downloads insert: ${error.message}`);
  return data.id;
}

async function downloadExists(id: string): Promise<boolean> {
  const { data, error } = await service
    .from('project_downloads')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

async function insertHit(key: string, ts: string): Promise<void> {
  const { error } = await service.from('rate_limit_hits').insert({ scope: 't_stats', key, ts });
  if (error) throw new Error(`rate_limit_hits insert: ${error.message}`);
}

async function hitCount(key: string): Promise<number> {
  const { count, error } = await service
    .from('rate_limit_hits')
    .select('*', { count: 'exact', head: true })
    .eq('scope', 't_stats')
    .eq('key', key);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function removeArranged(): Promise<void> {
  const downloads = await service.from('project_downloads').delete().like('ip_hash', 't\\_%');
  if (downloads.error) throw new Error(downloads.error.message);
  const hits = await service.from('rate_limit_hits').delete().eq('scope', 't_stats');
  if (hits.error) throw new Error(hits.error.message);
}

const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

type JobLogLine = { job?: string; msg?: string; id?: string; meta?: Record<string, unknown> };

function jobLines(lines: object[], msg: string): JobLogLine[] {
  return (lines as JobLogLine[]).filter((line) => line.job === 'snapshotStats' && line.msg === msg);
}

beforeAll(async () => {
  snapshot = await snapshotContentTables();
});

afterAll(async () => {
  await removeArranged();
  await restoreContentTables(snapshot);
  await cleanupFactories();
  // Failed runs emit `sync.failed` through the runner (04 J-F) — purge them (H-1).
  await purgeNotificationEvents();
});

// ---------------------------------------------------------------------------------------------
// The pure core — no DB
// ---------------------------------------------------------------------------------------------

describe('buildSnapshotRows (04 §3.5 row rules — pure)', () => {
  const DAY = '2026-09-26';
  const P1 = '00000000-0000-4000-8000-000000000101';
  const P2 = '00000000-0000-4000-8000-000000000102';
  const P3 = '00000000-0000-4000-8000-000000000103';
  const V1 = '00000000-0000-4000-8000-000000000901';
  const V2 = '00000000-0000-4000-8000-000000000902';

  /** SEED-4/9/3/10/11-shaped input (05 §3) — the brief's expected arithmetic, asserted here. */
  const seedShaped: SnapshotInput = {
    day: DAY,
    projects: [
      { id: P1, downloads_modrinth: 2531, downloads_curseforge: 0, downloads_direct: 0 },
      { id: P2, downloads_modrinth: 1568, downloads_curseforge: 120, downloads_direct: 0 },
      { id: P3, downloads_modrinth: 0, downloads_curseforge: 0, downloads_direct: 7 },
    ],
    videos: Array.from({ length: 7 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000090${String(index + 1)}`,
      view_count: 1000 + index,
      like_count: 10 + index,
    })),
    commentsPublished: 2,
    commentsHeld: 1,
    likes: 1,
    users: 5,
    reach: 1_200_000,
    mentions: 2,
    directDownloadsByProject: new Map(),
    channel: { views: CHANNEL_VIEWS, subs: CHANNEL_SUBS },
  };

  const find = (
    rows: readonly SnapshotRow[],
    metric: string,
    source: string,
    entity_type: string,
    entity_id: string,
  ): SnapshotRow | undefined =>
    rows.find(
      (row) =>
        row.metric === metric &&
        row.source === source &&
        row.entity_type === entity_type &&
        row.entity_id === entity_id,
    );

  it('T-ACT-55 the seed shape → 35 rows: 3 × 3 project, 10 site, 7 × 2 video, 2 channel, 0 direct — every key unique, every row dated the run day', () => {
    const rows = buildSnapshotRows(seedShaped);
    expect(rows).toHaveLength(35);
    expect(countSnapshotRows(rows)).toEqual({
      project: 9,
      site: 10,
      video: 14,
      channel: 2,
      direct_days: 0,
    });
    expect(new Set(rows.map(keyOf)).size).toBe(35);
    expect(rows.every((row) => row.day === DAY)).toBe(true);
    expect(rows.every((row) => Number.isInteger(row.value) && row.value >= 0)).toBe(true);
  });

  it('T-ACT-55 site rows = sums + counts on the sentinel id: downloads 4099 / 120 / 7, comments 2, comments_held 1, likes 1, users 5, reach 1.2M, mentions 2, tips 0 (ADR-0049 D4 matches)', () => {
    const rows = buildSnapshotRows(seedShaped);
    const site = (metric: string, source: string): number | undefined =>
      find(rows, metric, source, 'site', SITE_ENTITY_ID)?.value;
    expect(site('downloads', 'modrinth')).toBe(4099);
    expect(site('downloads', 'curseforge')).toBe(120);
    expect(site('downloads', 'direct')).toBe(7);
    expect(site('comments', 'odsens')).toBe(2);
    expect(site('comments_held', 'odsens')).toBe(1);
    expect(site('likes', 'odsens')).toBe(1);
    expect(site('users', 'odsens')).toBe(5);
    expect(site('reach', 'youtube')).toBe(1_200_000);
    expect(site('mentions', 'odsens')).toBe(2);
    expect(site('tips', 'kofi')).toBe(0);
    expect(rows.filter((row) => row.entity_type === 'site')).toHaveLength(10);
  });

  it('T-ACT-55 per project always three downloads rows (0 allowed); per video views + likes; channel views + subs on the sentinel id', () => {
    const rows = buildSnapshotRows(seedShaped);
    expect(find(rows, 'downloads', 'modrinth', 'project', P1)?.value).toBe(2531);
    expect(find(rows, 'downloads', 'curseforge', 'project', P1)?.value).toBe(0);
    expect(find(rows, 'downloads', 'direct', 'project', P3)?.value).toBe(7);
    expect(find(rows, 'views', 'youtube', 'video', V1)?.value).toBe(1000);
    expect(find(rows, 'likes', 'youtube', 'video', V2)?.value).toBe(11);
    expect(find(rows, 'views', 'youtube', 'channel', SITE_ENTITY_ID)?.value).toBe(CHANNEL_VIEWS);
    expect(find(rows, 'subs', 'youtube', 'channel', SITE_ENTITY_ID)?.value).toBe(CHANNEL_SUBS);
  });

  it('ADR-0049 D20 channel null → no channel rows; subs null (hidden count) → the views row only', () => {
    expect(countSnapshotRows(buildSnapshotRows({ ...seedShaped, channel: null })).channel).toBe(0);
    const hidden = buildSnapshotRows({ ...seedShaped, channel: { views: 5, subs: null } });
    expect(countSnapshotRows(hidden).channel).toBe(1);
    expect(find(hidden, 'views', 'youtube', 'channel', SITE_ENTITY_ID)?.value).toBe(5);
    expect(find(hidden, 'subs', 'youtube', 'channel', SITE_ENTITY_ID)).toBeUndefined();
  });

  it('per video a NULL count writes no row for that metric (only the counts YouTube answered)', () => {
    const rows = buildSnapshotRows({
      ...seedShaped,
      videos: [
        { id: V1, view_count: 7, like_count: null },
        { id: V2, view_count: null, like_count: null },
      ],
    });
    expect(rows.filter((row) => row.entity_type === 'video')).toEqual([
      {
        day: DAY,
        metric: 'views',
        source: 'youtube',
        entity_type: 'video',
        entity_id: V1,
        value: 7,
      },
    ]);
  });

  it('ADR-0049 D19 direct_downloads_day: one row per project with ≥ 1 download on day − 1, dated day − 1 (the day it describes); a zero count writes nothing', () => {
    const rows = buildSnapshotRows({
      ...seedShaped,
      directDownloadsByProject: new Map([
        [P3, 2],
        [P1, 0],
      ]),
    });
    const direct = rows.filter((row) => row.metric === 'direct_downloads_day');
    expect(direct).toEqual([
      {
        day: '2026-09-25',
        metric: 'direct_downloads_day',
        source: 'direct',
        entity_type: 'project',
        entity_id: P3,
        value: 2,
      },
    ]);
    expect(countSnapshotRows(rows).direct_days).toBe(1);
    // Month boundary: the row's day is UTC arithmetic, never a local getter (01 INV-68).
    const first = buildSnapshotRows({
      ...seedShaped,
      day: '2026-10-01',
      directDownloadsByProject: new Map([[P3, 1]]),
    });
    expect(first.find((row) => row.metric === 'direct_downloads_day')?.day).toBe('2026-09-30');
  });

  it('no projects / no videos → the 10 site rows still exist with zero downloads (a fresh site snapshots too)', () => {
    const rows = buildSnapshotRows({ ...seedShaped, projects: [], videos: [], channel: null });
    expect(countSnapshotRows(rows)).toEqual({
      project: 0,
      site: 10,
      video: 0,
      channel: 0,
      direct_days: 0,
    });
    expect(find(rows, 'downloads', 'modrinth', 'site', SITE_ENTITY_ID)?.value).toBe(0);
  });
});

describe('planOrphanRemovals (04 §1.4.5 U1 — pure, ADR-0049 D6)', () => {
  const c = (bucket: string, name: string): OrphanCandidate => ({ bucket, name });
  const candidates = [
    c('project-files', 'p/v/kept.zip'),
    c('project-files', 'p/v/gone.zip'),
    c('project-media', 'p/icon/kept.png'),
    c('project-media', 'p/gallery/gone-1.webp'),
    c('project-media', 'p/gallery/gone-2.webp'),
    c('art', 'a/kept.png'),
    c('art', 'a/gone.png'),
  ];
  const referenced = new Set([
    'project-files/p/v/kept.zip',
    'project-media/p/icon/kept.png',
    'art/a/kept.png',
    // The same NAME in another bucket is not a reference for this one.
    'art/p/v/gone.zip',
  ]);

  it('T-ACT-75 referenced candidates stay; the rest are removed in candidate order; under the cap → capped false', () => {
    expect(planOrphanRemovals(candidates, referenced, ORPHAN_CLEANUP_MAX)).toEqual({
      remove: [
        c('project-files', 'p/v/gone.zip'),
        c('project-media', 'p/gallery/gone-1.webp'),
        c('project-media', 'p/gallery/gone-2.webp'),
        c('art', 'a/gone.png'),
      ],
      capped: false,
    });
  });

  it('T-ACT-75 the cap stops the plan at `max` removals across buckets → capped true; exactly `max` orphans → capped false; max 0 → nothing, capped when an orphan exists', () => {
    const three = planOrphanRemovals(candidates, referenced, 3);
    expect(three.remove.map((entry) => entry.name)).toEqual([
      'p/v/gone.zip',
      'p/gallery/gone-1.webp',
      'p/gallery/gone-2.webp',
    ]);
    expect(three.capped).toBe(true);
    expect(planOrphanRemovals(candidates, referenced, 4).capped).toBe(false);
    expect(planOrphanRemovals(candidates, referenced, 0)).toEqual({ remove: [], capped: true });
    expect(planOrphanRemovals(candidates, referenced, -5)).toEqual({ remove: [], capped: true });
    // Nothing to remove: the cap is never reached, whatever it is.
    expect(planOrphanRemovals([c('art', 'a/kept.png')], referenced, 0)).toEqual({
      remove: [],
      capped: false,
    });
  });

  it('T-ACT-75 Studio folder markers (.emptyFolderPlaceholder) are skipped and never count against the cap; no candidates → nothing', () => {
    const withMarkers = [
      c('project-media', 'p/.emptyFolderPlaceholder'),
      c('project-media', 'p/gallery/.emptyFolderPlaceholder'),
      c('project-media', 'p/gallery/gone.webp'),
    ];
    expect(planOrphanRemovals(withMarkers, new Set(), 1)).toEqual({
      remove: [c('project-media', 'p/gallery/gone.webp')],
      capped: false,
    });
    expect(planOrphanRemovals([], referenced, 200)).toEqual({ remove: [], capped: false });
  });
});

describe('ADR-0049 D17 constants (04 §5.8 tunables + rule homes)', () => {
  it('ORPHAN_CLEANUP_MAX 200 · ORPHAN_MIN_AGE_HOURS 24 · retention 90 / 1 days · the three U1 buckets (never avatars / skins) · upsert chunk 500', () => {
    expect(ORPHAN_CLEANUP_MAX).toBe(200);
    expect(ORPHAN_MIN_AGE_HOURS).toBe(24);
    expect(PROJECT_DOWNLOADS_RETENTION_DAYS).toBe(90);
    expect(RATE_LIMIT_HITS_RETENTION_DAYS).toBe(1);
    expect([...ORPHAN_BUCKETS]).toEqual(['project-files', 'project-media', 'art']);
    expect(STATS_UPSERT_CHUNK).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------
// The job against the local stack
// ---------------------------------------------------------------------------------------------

describe('T-ACT-55 snapshotStats (04 §3.5)', () => {
  /** Today as the FIRST run saw it (a UTC midnight mid-file would move `utcDay(new Date())`). */
  let today = '';

  it('T-ACT-55 first run: one row per (metric, source, entity) for today — equal to the rows derived from the DB + the channel fixture; the seed truths hold; one channels.list request (1 unit); nothing revalidated; T-ACT-45 one finalized sync_runs row, error null', async () => {
    const runsBefore = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const logs = spyLog();
    let summary: JobSummary;
    try {
      summary = await run();
    } finally {
      logs.restore();
    }

    expect(summary.ok).toBe(true);
    expect(summary.source).toBe('stats');
    expect(summary.skipped).toBeUndefined();
    expect(summary.error).toBeUndefined();
    today = summary.day as string;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([utcDay(new Date()), addDays(utcDay(new Date()), -1)]).toContain(today);

    // Derived, not trusted: what the DB says the run must have written.
    const input = await expectedInput(today);
    const expected = buildSnapshotRows(input);
    expect(summary.rows).toEqual(countSnapshotRows(expected));
    expect(summary.items).toBe(expected.length);
    expect(summary.units).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(summary.purged).toEqual({
      project_downloads: expect.any(Number) as number,
      rate_limit_hits: expect.any(Number) as number,
    });
    expect(summary.orphans).toMatchObject({ capped: false });
    expect(Object.keys(summary).sort()).toEqual([
      'day',
      'errors',
      'items',
      'ms',
      'ok',
      'orphans',
      'purged',
      'rows',
      'run_id',
      'source',
      'units',
    ]);

    // The table for today IS the run's row set (the SEED-12 pair shares three of the keys).
    const written = await rowsOn(today);
    expect(bare(written)).toEqual(bare(expected));
    expect(new Set(written.map(keyOf)).size).toBe(written.length);

    // The documented seed truths on the derived input (05 §3 SEED-3/4/9/10/11; ADR-0049 D4).
    expect(valueOf(written, 'downloads', 'modrinth', 'site', SITE_ENTITY_ID)).toBe(4099);
    expect(valueOf(written, 'downloads', 'curseforge', 'site', SITE_ENTITY_ID)).toBe(120);
    expect(valueOf(written, 'downloads', 'direct', 'site', SITE_ENTITY_ID)).toBe(7);
    expect(valueOf(written, 'comments', 'odsens', 'site', SITE_ENTITY_ID)).toBe(2);
    expect(valueOf(written, 'comments_held', 'odsens', 'site', SITE_ENTITY_ID)).toBe(1);
    expect(valueOf(written, 'likes', 'odsens', 'site', SITE_ENTITY_ID)).toBe(1);
    expect(valueOf(written, 'users', 'odsens', 'site', SITE_ENTITY_ID)).toBe(5);
    expect(valueOf(written, 'reach', 'youtube', 'site', SITE_ENTITY_ID)).toBe(1_200_000);
    expect(valueOf(written, 'mentions', 'odsens', 'site', SITE_ENTITY_ID)).toBe(2);
    expect(valueOf(written, 'tips', 'kofi', 'site', SITE_ENTITY_ID)).toBe(0);
    expect(valueOf(written, 'views', 'youtube', 'channel', SITE_ENTITY_ID)).toBe(CHANNEL_VIEWS);
    expect(valueOf(written, 'subs', 'youtube', 'channel', SITE_ENTITY_ID)).toBe(CHANNEL_SUBS);
    expect(input.projects.length).toBeGreaterThanOrEqual(3);
    expect(input.videos.length).toBeGreaterThanOrEqual(7);
    expect(summary.rows).toMatchObject({ site: 10, channel: 2, direct_days: 0 });

    // One `channels.list part=statistics` request, the seed channel id, nothing else.
    expect(fetchSpy.calls).toHaveLength(1);
    expect(fetchSpy.calls[0]?.startsWith(`${CHANNELS_URL}?part=statistics&id=`)).toBe(true);
    expect(fetchSpy.calls[0]).toContain(encodeURIComponent(env.YOUTUBE_CHANNEL_ID));

    // 04 §3.5 revalidate: none.
    expect(tags.calls).toEqual([]);

    // SC-11: exactly one finalized row, source `stats`, error NULL on success (T-ACT-45).
    expect(await syncRunCount()).toBe(runsBefore + 1);
    const row = await runRow(summary.run_id);
    expect(row).toMatchObject({ source: 'stats', ok: true, items: expected.length, error: null });
    expect(row.finished_at).not.toBeNull();

    // The done line carries counts only (never the key).
    const done = jobLines(logs.lines, 'done');
    expect(done).toHaveLength(1);
    expect(done[0]?.id).toBe(summary.run_id);
    expect(done[0]?.meta).toMatchObject({
      trigger: 'manual',
      items: expected.length,
      units: 1,
      site: 10,
      channel: 2,
      errors: 0,
    });
    expect(JSON.stringify(logs.lines)).not.toContain(`key=${API_KEY}`);
  });

  it('T-ACT-55 run twice the same day → the same row count and keys for the day, equal items, values rewritten in place (updated_at advanced on every row), no revalidation (AC1 "twice = same rows")', async () => {
    const before = await rowsOn(today);
    const fetchSpy = spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary.items).toBe(before.length);
    const after = await rowsOn(today);
    expect(after).toHaveLength(before.length);
    expect(after.map(keyOf)).toEqual(before.map(keyOf));
    expect(bare(after)).toEqual(bare(before));
    // Every row was touched by the upsert (the `set_updated_at` trigger stamps each one).
    for (let index = 0; index < after.length; index += 1) {
      expect(Date.parse(after[index]?.updated_at ?? '')).toBeGreaterThan(
        Date.parse(before[index]?.updated_at ?? ''),
      );
    }
    expect(fetchSpy.calls).toHaveLength(1);
    expect(tags.calls).toEqual([]);
    expect(await runRow(summary.run_id)).toMatchObject({ ok: true, items: before.length });
  });

  it('T-ACT-55 ADR-0049 D19: project_downloads rows on the completed UTC day before the run → one direct_downloads_day row per project, dated day − 1, value = the count; rows on the run day or two days back do not count', async () => {
    const yesterday = addDays(today, -1);
    const ids = [
      await insertDownload(`${yesterday}T12:00:00Z`),
      await insertDownload(`${yesterday}T23:59:59Z`),
      await insertDownload(`${addDays(today, -2)}T23:59:59Z`), // the day before yesterday
      await insertDownload(`${today}T00:00:01Z`), // today — not complete yet
    ];
    spyFetch(FIXTURE_OK);
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect((summary.rows as { direct_days: number }).direct_days).toBe(1);

    const direct = (await rowsOn(yesterday)).filter((row) => row.metric === 'direct_downloads_day');
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatchObject({
      source: 'direct',
      entity_type: 'project',
      entity_id: SEED_PROJECTS.seedExclusivePack,
      value: 2,
    });
    // No direct row landed on today (the day is not complete) nor on day − 2 (not this run's window).
    expect((await rowsOn(today)).some((row) => row.metric === 'direct_downloads_day')).toBe(false);
    expect(
      (await rowsOn(addDays(today, -2))).some((row) => row.metric === 'direct_downloads_day'),
    ).toBe(false);
    // The fresh log rows are all still there (90-day retention).
    for (const id of ids) expect(await downloadExists(id)).toBe(true);

    const { error } = await service.from('project_downloads').delete().in('id', ids);
    if (error) throw new Error(error.message);
  });

  it('T-ACT-55 housekeeping: project_downloads older than 90 days deleted and an 89-day-old row kept; rate_limit_hits older than 1 day deleted and a fresh hit kept; the purge counts ride the summary', async () => {
    const old = await insertDownload(daysAgo(91));
    const kept = await insertDownload(daysAgo(89));
    await insertHit('t_old', daysAgo(2));
    await insertHit('t_fresh', new Date().toISOString());
    spyFetch(FIXTURE_OK);
    const summary = await run();

    expect(summary.ok).toBe(true);
    const purged = summary.purged as { project_downloads: number; rate_limit_hits: number };
    expect(purged.project_downloads).toBeGreaterThanOrEqual(1);
    expect(purged.rate_limit_hits).toBeGreaterThanOrEqual(1);
    expect(await downloadExists(old)).toBe(false);
    expect(await downloadExists(kept)).toBe(true);
    expect(await hitCount('t_old')).toBe(0);
    expect(await hitCount('t_fresh')).toBe(1);

    const { error } = await service.from('project_downloads').delete().eq('id', kept);
    if (error) throw new Error(error.message);
  });

  it('T-ACT-55 ADR-0049 D20 without YOUTUBE_API_KEY: no channel rows, units 0, NO request, ok:true and NOT a not_configured skip (sync_runs error null) — every other row still written', async () => {
    const saved = env.YOUTUBE_API_KEY;
    const fetchSpy = spyFetch(FIXTURE_OK);
    try {
      env.YOUTUBE_API_KEY = undefined;
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary.skipped).toBeUndefined();
      expect(summary.units).toBe(0);
      expect(summary.errors).toEqual([]);
      expect(summary.rows).toMatchObject({ site: 10, channel: 0 });
      expect(summary.items).toBeGreaterThan(10);
      expect(fetchSpy.calls).toEqual([]);
      expect(await runRow(summary.run_id)).toMatchObject({ ok: true, error: null });
    } finally {
      env.YOUTUBE_API_KEY = saved;
    }
  });

  it('T-ACT-55 a channels.list failure (400) is a per-item error: one errors[] entry (key value absent), channel rows 0, units 1, ok stays true, the other rows written (J-P)', async () => {
    const fetchSpy = spyFetch({ [CHANNELS_URL]: 'status:400' });
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.units).toBe(1);
    expect(summary.rows).toMatchObject({ site: 10, channel: 0 });
    expect(summary.items).toBeGreaterThan(10);
    const errors = summary.errors as string[];
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^channel stats: /);
    expect(errors[0]).toContain('/channels');
    expect(errors[0]).not.toContain(`key=${API_KEY}`);
    expect(fetchSpy.calls).toHaveLength(1); // 400 is not retried (SC-09)
    expect(await runRow(summary.run_id)).toMatchObject({ ok: true, error: null });
  });

  it('T-ACT-55 ADR-0049 D20 a hidden subscriber count → the channel views row only (derived from channels.json in memory, F-6)', async () => {
    const fixture = await loadFixture<{ items: { statistics: Record<string, unknown> }[] }>(
      'youtube',
      'channels.json',
    );
    const [channel] = fixture.items;
    const hidden = {
      ...fixture,
      items: [
        {
          ...channel,
          statistics: { ...channel?.statistics, hiddenSubscriberCount: true },
        },
      ],
    };
    spyFetch({
      [CHANNELS_URL]: () =>
        new Response(JSON.stringify(hidden), { status: 200, headers: JSON_HEADERS }),
    });
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.rows).toMatchObject({ channel: 1 });
    expect(summary.errors).toEqual([]);
    // Today's `subs` row from the earlier runs is left alone (jobs never delete synced rows, INV-24).
    const rows = await rowsOn(today);
    expect(valueOf(rows, 'views', 'youtube', 'channel', SITE_ENTITY_ID)).toBe(CHANNEL_VIEWS);
  });

  describe('T-ACT-45 gather / write failures write nothing more and skip housekeeping (ADR-0049 D21)', () => {
    it('T-ACT-45 a failed projects read → ok=false, error names the read, today’s rows byte-equal (updated_at included), no channels request, no unit, purges skipped (a 91-day row survives), run finalized ok=false', async () => {
      const old = await insertDownload(daysAgo(91));
      const before = await rowsOn(today);
      const runsBefore = await syncRunCount();
      const fetchSpy = spyFetch(FIXTURE_OK);
      const tags = spyRevalidateTag();
      const logs = spyLog();
      let summary: JobSummary;
      try {
        summary = await withDbFault({ table: 'projects', op: 'select' }, {}, () => run());
      } finally {
        logs.restore();
      }
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/^projects read failed/);
      expect(summary.errors).toEqual([summary.error]);
      expect(summary).toMatchObject({
        items: 0,
        units: 0,
        rows: { project: 0, site: 0, video: 0, channel: 0, direct_days: 0 },
        purged: { project_downloads: 0, rate_limit_hits: 0 },
        orphans: { scanned: 0, removed: 0, capped: false },
      });
      expect(fetchSpy.calls).toEqual([]);
      expect(tags.calls).toEqual([]);
      expect(await rowsOn(today)).toEqual(before);
      expect(await downloadExists(old)).toBe(true);

      expect(await syncRunCount()).toBe(runsBefore + 1);
      const row = await runRow(summary.run_id);
      expect(row.ok).toBe(false);
      expect(row.items).toBe(0);
      expect(row.error).toMatch(/^projects read failed/);
      expect(row.finished_at).not.toBeNull();
      const failed = jobLines(logs.lines, 'failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.meta).toMatchObject({ trigger: 'manual', units: 0, errors: 1 });

      const { error } = await service.from('project_downloads').delete().eq('id', old);
      if (error) throw new Error(error.message);
    });

    it('T-ACT-45 a read that REJECTS with a non-Error value → ok=false with the value as text, run finalized', async () => {
      const summary = await withDbFault(
        { table: 'videos', op: 'select' },
        { throws: 't_ string rejection' },
        () => run(),
      );
      expect(summary.ok).toBe(false);
      expect(summary.error).toBe('t_ string rejection');
      expect(await runRow(summary.run_id)).toMatchObject({
        ok: false,
        error: 't_ string rejection',
      });
    });

    it('T-ACT-45 a failed stats_daily upsert → ok=false, error names the upsert, items 0, the unit already spent is reported, housekeeping skipped (a 2-day-old hit survives)', async () => {
      await insertHit('t_upsert_old', daysAgo(2));
      const before = await rowsOn(today);
      spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ table: 'stats_daily', op: 'upsert' }, {}, () => run());
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/^stats_daily upsert failed/);
      expect(summary).toMatchObject({
        items: 0,
        units: 1,
        purged: { project_downloads: 0, rate_limit_hits: 0 },
        orphans: { scanned: 0, removed: 0, capped: false },
      });
      expect(await rowsOn(today)).toEqual(before);
      expect(await hitCount('t_upsert_old')).toBe(1);
      expect(await runRow(summary.run_id)).toMatchObject({ ok: false, items: 0 });
      const { error } = await service
        .from('rate_limit_hits')
        .delete()
        .eq('scope', 't_stats')
        .eq('key', 't_upsert_old');
      if (error) throw new Error(error.message);
    });
  });

  describe('ADR-0049 D21 housekeeping failures → ok=false, the snapshot rows stay', () => {
    it('ADR-0049 D21 purge_project_downloads failing → ok=false with that failure as error and in errors[], items > 0 and today’s rows rewritten, the other steps still ran (a 2-day-old hit is gone), sync_runs ok=false', async () => {
      await insertHit('t_hk_old', daysAgo(2));
      const before = await rowsOn(today);
      spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ rpc: 'purge_project_downloads' }, {}, () => run());
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/^purge_project_downloads failed: /);
      expect(summary.errors).toEqual([summary.error]);
      expect(summary.items).toBe(before.length);
      expect(summary.rows).toMatchObject({ site: 10, channel: 2 });
      expect(
        (summary.purged as { rate_limit_hits: number }).rate_limit_hits,
      ).toBeGreaterThanOrEqual(1);
      expect(await hitCount('t_hk_old')).toBe(0);
      const after = await rowsOn(today);
      expect(bare(after)).toEqual(bare(before));
      expect(Date.parse(after[0]?.updated_at ?? '')).toBeGreaterThan(
        Date.parse(before[0]?.updated_at ?? ''),
      );
      expect(await runRow(summary.run_id)).toMatchObject({
        ok: false,
        items: before.length,
      });
      expect((await runRow(summary.run_id)).error).toMatch(/^purge_project_downloads failed/);
    });

    it('ADR-0049 D21 purge_rate_limit_hits failing → ok=false with that failure as error, the project_downloads purge and the orphan sweep still ran, rows written', async () => {
      const old = await insertDownload(daysAgo(91));
      spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ rpc: 'purge_rate_limit_hits' }, {}, () => run());
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/^purge_rate_limit_hits failed: /);
      expect(summary.errors).toEqual([summary.error]);
      expect(summary.items).toBeGreaterThan(10);
      expect(
        (summary.purged as { project_downloads: number }).project_downloads,
      ).toBeGreaterThanOrEqual(1);
      expect(await downloadExists(old)).toBe(false);
      expect(summary.orphans).toMatchObject({ capped: false });
      expect(await runRow(summary.run_id)).toMatchObject({ ok: false });
    });

    it('ADR-0049 D21 list_stale_objects failing on every bucket → ok=false, three failures joined as error (one per bucket), nothing removed, rows written, purges ran', async () => {
      spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ rpc: 'list_stale_objects' }, { nth: 'all' }, () => run());
      expect(summary.ok).toBe(false);
      const errors = summary.errors as string[];
      expect(errors).toHaveLength(3);
      expect(errors.map((entry) => entry.replace(/ failed:.*$/, ''))).toEqual([
        'list_stale_objects project-files',
        'list_stale_objects project-media',
        'list_stale_objects art',
      ]);
      expect(summary.error).toBe(errors.join('; '));
      expect(summary.orphans).toEqual({ scanned: 0, removed: 0, capped: false });
      expect(summary.items).toBeGreaterThan(10);
      expect(await runRow(summary.run_id)).toMatchObject({ ok: false });
    });

    it('ADR-0049 D21 a failed reference read (art) removes NOTHING and is one failure entry (an incomplete reference set could name a live object an orphan)', async () => {
      spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ table: 'art', op: 'select' }, {}, () => run());
      expect(summary.ok).toBe(false);
      expect(summary.errors).toEqual([
        expect.stringMatching(/^orphan references: art read failed/),
      ]);
      expect(summary.orphans).toEqual({ scanned: 0, removed: 0, capped: false });
    });
  });

  it("T-ACT-70 an open stats run 5 min old → {ok:true, skipped:'running'} with that run's id, no second row, no request, no write (04 SC-13)", async () => {
    const before = await rowsOn(today);
    const lockId = await makeSyncRun({
      source: 'stats',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const withLock = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    try {
      const summary = await run();
      expect(summary).toMatchObject({ ok: true, skipped: 'running', run_id: lockId, items: 0 });
      expect(await syncRunCount()).toBe(withLock);
      expect(fetchSpy.calls).toEqual([]);
      expect(await rowsOn(today)).toEqual(before);
    } finally {
      // Close the arranged row so it cannot hold the lock for the tests below.
      const { error } = await service
        .from('sync_runs')
        .update({ finished_at: new Date().toISOString(), ok: true, items: 0 })
        .eq('id', lockId);
      if (error) throw new Error(error.message);
    }
  });

  describe('T-ACT-74 snapshotStats sync.failed edge (04 J-F, ADR-0030 D1)', () => {
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
        .filter((row) => row.payload.source === 'stats')
        .map((row) => ({ id: row.id, run_id: row.payload.run_id }));
    }

    beforeAll(async () => {
      // The failing runs above already emitted; start the edge from a clean queue + an ok run.
      await purgeNotificationEvents();
      await makeSyncRun({
        source: 'stats',
        ok: true,
        items: 0,
        finished_at: new Date().toISOString(),
      });
    });

    it('T-ACT-74 snapshotStats: a forced gather failure after an ok run → exactly one sync.failed for stats with the run id, an error ≤ 300 chars and a started_at', async () => {
      spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ table: 'projects', op: 'select' }, {}, () => run());
      expect(summary.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.run_id).toBe(summary.run_id);

      const { data: event, error } = await service
        .from('notification_events')
        .select('subject_type, subject_id, payload')
        .eq('id', events[0]?.id ?? '')
        .single();
      expect(error).toBeNull();
      expect(event?.subject_type).toBe('sync_run');
      expect(event?.subject_id).toBe(summary.run_id);
      const payload = event?.payload as {
        source: string;
        run_id: string;
        error: string;
        started_at: string;
      };
      expect(payload.source).toBe('stats');
      expect(payload.error).toMatch(/^projects read failed/);
      expect(payload.error.length).toBeLessThanOrEqual(300);
      expect(Number.isNaN(Date.parse(payload.started_at))).toBe(false);
    });

    it('T-ACT-74 snapshotStats: a second consecutive failing run → no new event (edge-triggered)', async () => {
      spyFetch(FIXTURE_OK);
      expect((await withDbFault({ table: 'projects', op: 'select' }, {}, () => run())).ok).toBe(
        false,
      );
      expect(await failedEvents()).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-75 — the U1 orphan sweep against real Storage (04 §1.4.5; ADR-0049 D6)
// ---------------------------------------------------------------------------------------------

describe('T-ACT-75 U1 orphan cleanup (04 §1.4.5; ADR-0049 D6)', () => {
  const uploaded: { bucket: Bucket; name: string }[] = [];
  const agedSeed: { bucket: Bucket; name: string }[] = [];
  let projectId = '';
  let versionId = '';
  let artId = '';
  let artImage = '';
  const skinFolder = randomUUID();

  // Referenced (kept) objects on the factory project — one per ADR-0049 D6 referencing column.
  let refFile = '';
  let refIcon = '';
  let refGallery = '';
  let refExtra = '';
  // Orphans (removed).
  let orphanMedia = '';
  let orphanFile = '';
  let orphanArt = '';
  // Fresh (kept — younger than 24 h) and skins (never scanned).
  let freshMedia = '';
  const skinOrphan = `${skinFolder}/t_orphan.png`;
  let seedIcon = '';
  let seedZip = '';

  async function upload(bucket: Bucket, name: string, fixture: string): Promise<string> {
    await uploadFixture(bucket, name, fixture);
    uploaded.push({ bucket, name });
    return name;
  }

  function age(bucket: Bucket, name: string, hours: number): void {
    sql(
      `update storage.objects set created_at = now() - interval '${String(hours)} hours' where bucket_id = '${bucket}' and name = '${name}'`,
    );
  }

  async function exists(bucket: Bucket, name: string): Promise<boolean> {
    const slash = name.lastIndexOf('/');
    const names = await listObjects(bucket, name.slice(0, slash));
    return names.includes(name);
  }

  beforeAll(async () => {
    // A first sweep clears whatever stale orphans an earlier file left in the shared stack, so
    // the counts below are this describe's own.
    spyFetch(FIXTURE_OK);
    expect((await run()).ok).toBe(true);

    projectId = await makeProject({ source: 'odsens' });
    versionId = await makeVersion({ project_id: projectId });
    artId = await makeArt({});
    const { data: art, error: artError } = await service
      .from('art')
      .select('image_path')
      .eq('id', artId)
      .single();
    if (artError) throw new Error(artError.message);
    artImage = art.image_path.slice('art/'.length);

    // Referenced objects: project_files.storage_path · projects.icon_url · projects.gallery[].url
    // · project_overrides.extra_gallery[].path (art.image_path is the factory art's own upload).
    refFile = await upload(
      'project-files',
      `${projectId}/${versionId}/t_ref.zip`,
      'files/pack.zip',
    );
    await makeFile({ version_id: versionId, storage_path: `project-files/${refFile}` });
    refIcon = await upload(
      'project-media',
      `${projectId}/icon/t_ref_icon.webp`,
      'images/tiny.webp',
    );
    refGallery = await upload(
      'project-media',
      `${projectId}/gallery/t_ref_gallery.webp`,
      'images/tiny.webp',
    );
    refExtra = await upload(
      'project-media',
      `${projectId}/gallery/t_ref_extra.webp`,
      'images/tiny.webp',
    );
    const projectPatch = await service
      .from('projects')
      .update({
        icon_url: `project-media/${refIcon}`,
        gallery: [
          {
            url: `project-media/${refGallery}`,
            title: null,
            description: null,
            ordering: 0,
            featured: false,
          },
        ],
      })
      .eq('id', projectId);
    if (projectPatch.error) throw new Error(projectPatch.error.message);
    const overrides = await service.from('project_overrides').insert({
      project_id: projectId,
      extra_gallery: [{ path: `project-media/${refExtra}`, ordering: 0 }],
    });
    if (overrides.error) throw new Error(overrides.error.message);

    // Orphans — one per scanned bucket — plus a fresh one and a skins one.
    orphanMedia = await upload(
      'project-media',
      `${projectId}/gallery/t_orphan.webp`,
      'images/tiny.webp',
    );
    orphanFile = await upload(
      'project-files',
      `${projectId}/${versionId}/t_orphan.zip`,
      'files/pack.zip',
    );
    orphanArt = await upload('art', `${artId}/t_orphan.png`, 'images/icon-256.png');
    freshMedia = await upload(
      'project-media',
      `${projectId}/gallery/t_fresh.webp`,
      'images/tiny.webp',
    );
    await upload('skins', skinOrphan, 'images/skin-64.png');

    // The SEED-13 objects the seed rows reference (F-8 keeps the hash literal in sync).
    const iconBytes = await readFile(fixturePath('images', 'icon-256.png'));
    const hash16 = createHash('sha256').update(iconBytes).digest('hex').slice(0, 16);
    seedIcon = `${SEED_PROJECTS.seedExclusivePack}/icon/${hash16}.png`;
    seedZip = `${SEED_PROJECTS.seedExclusivePack}/${SEED_VERSIONS.exclusive_1_0_0}/seed-exclusive-pack-1.0.0.zip`;
    expect(await exists('project-media', seedIcon)).toBe(true);
    expect(await exists('project-files', seedZip)).toBe(true);

    // Everything but the fresh object is 25 h old.
    for (const [bucket, name] of [
      ['project-files', refFile],
      ['project-media', refIcon],
      ['project-media', refGallery],
      ['project-media', refExtra],
      ['art', artImage],
      ['project-media', orphanMedia],
      ['project-files', orphanFile],
      ['art', orphanArt],
      ['skins', skinOrphan],
    ] as const) {
      age(bucket, name, 25);
    }
    age('project-media', seedIcon, 25);
    age('project-files', seedZip, 25);
    agedSeed.push(
      { bucket: 'project-media', name: seedIcon },
      { bucket: 'project-files', name: seedZip },
    );
  }, 120_000);

  afterAll(async () => {
    // Put the seed objects' age back and remove everything this describe uploaded (the run removed
    // some already — `removeObjects` tolerates missing paths).
    for (const { bucket, name } of agedSeed) {
      sql(
        `update storage.objects set created_at = now() where bucket_id = '${bucket}' and name = '${name}'`,
      );
    }
    for (const bucket of ['project-files', 'project-media', 'art', 'skins'] as const) {
      const names = uploaded.filter((entry) => entry.bucket === bucket).map((entry) => entry.name);
      await removeObjects(bucket, names);
    }
  });

  it('T-ACT-75 one run removes the three aged unreferenced objects (project-media, project-files, art), keeps every aged referenced one (seed icon + zip; factory file, icon, gallery, extra_gallery, art image), keeps the fresh orphan, never touches skins; orphans {removed 3, capped false}', async () => {
    spyFetch(FIXTURE_OK);
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.errors).toEqual([]);
    const orphans = summary.orphans as { scanned: number; removed: number; capped: boolean };
    expect(orphans.removed).toBe(3);
    expect(orphans.capped).toBe(false);
    // 3 orphans + 7 aged referenced objects at least (other stale referenced objects may add).
    expect(orphans.scanned).toBeGreaterThanOrEqual(10);

    expect(await exists('project-media', orphanMedia)).toBe(false);
    expect(await exists('project-files', orphanFile)).toBe(false);
    expect(await exists('art', orphanArt)).toBe(false);

    expect(await exists('project-media', seedIcon)).toBe(true);
    expect(await exists('project-files', seedZip)).toBe(true);
    expect(await exists('project-files', refFile)).toBe(true);
    expect(await exists('project-media', refIcon)).toBe(true);
    expect(await exists('project-media', refGallery)).toBe(true);
    expect(await exists('project-media', refExtra)).toBe(true);
    expect(await exists('art', artImage)).toBe(true);
    expect(await exists('project-media', freshMedia)).toBe(true);
    expect(await exists('skins', skinOrphan)).toBe(true);
  });

  it('T-ACT-75 the next run finds nothing more to remove (removed 0); the fresh orphan and the skins object are still there; the summary counts the purges and orphans as numbers', async () => {
    spyFetch(FIXTURE_OK);
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.orphans).toMatchObject({ removed: 0, capped: false });
    expect(await exists('project-media', freshMedia)).toBe(true);
    expect(await exists('skins', skinOrphan)).toBe(true);
  });

  it('T-ACT-75 an aged skins object stays even when nothing references it (the bucket is never listed): the run above removed 0 and it is still present', async () => {
    expect(await exists('skins', skinOrphan)).toBe(true);
    await removeObjects('skins', [skinOrphan]);
    expect(await exists('skins', skinOrphan)).toBe(false);
  });
});
