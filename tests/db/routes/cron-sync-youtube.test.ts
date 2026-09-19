/**
 * tests/db/routes/cron-sync-youtube.test.ts — T-ACT-33 for `/api/cron/sync-youtube`
 * (04 SC-12, §2.4 `?full=1`; 02 §1.4 / §2.10; ADR-0002 C15; 00 S1.6 AC1 "401 without secret";
 * 05 §7.2). Handlers are imported from the route file and invoked directly (the route reads no
 * cookies). `mutatesSeed`: the 200 run inserts the fixture channel's videos next to SEED-11 and every
 * authorized run adds a `sync_runs` row, so the file snapshots/restores the content tables (`videos`
 * + `sync_runs` included — 05 H-1).
 *
 * `spyFetch` keys are the real request prefixes — `${YOUTUBE_RSS_BASE}`, `${YOUTUBE_API_BASE}/videos`,
 * `${YOUTUBE_API_BASE}/playlistItems` — never the bare API base (a prefix of the RSS URL).
 *
 * The 500 row answers the feed with 400 (not retried, SC-09): a list-call failure → the job returns
 * `ok=false` with zero writes (ADR-0043 D2) and the route wraps it as `job_failed` while the run row
 * is still finalized (SC-11). The `?full=1` rows mock the job and assert the options it received.
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as route from '@/app/api/cron/sync-youtube/route';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { purgeNotificationEvents } from '@/tests/helpers/factories';
import { spyFetch, spyLog } from '@/tests/helpers/spies';

/**
 * Set by the route-guard rows only (the job mocked to answer / throw a shape the real job never
 * produces — 04 §3 jobs finalize their row and return `ok:false`); read inside the hoisted factory.
 */
const jobOverride = vi.hoisted(() => ({
  run: null as null | ((opts: JobOptions) => Promise<JobSummary>),
}));

vi.mock('@/lib/jobs/syncYoutube', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/syncYoutube')>();
  const syncYoutube: typeof actual.syncYoutube = (opts) =>
    jobOverride.run ? jobOverride.run(opts) : actual.syncYoutube(opts);
  return { ...actual, syncYoutube };
});

setupActionMocks();

const service = asRole('service');

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const RSS_BASE = process.env.YOUTUBE_RSS_BASE ?? '';
const API_BASE = process.env.YOUTUBE_API_BASE ?? '';
if (RSS_BASE === '' || API_BASE === '') {
  throw new Error('YOUTUBE_RSS_BASE / YOUTUBE_API_BASE are not set — is .env.test loaded?');
}
const ALL_OK = {
  [RSS_BASE]: 'youtube/rss.xml',
  [`${API_BASE}/videos`]: 'youtube/videos-list.json',
  [`${API_BASE}/playlistItems`]: 'youtube/playlist-items.json',
};
const ROUTE_URL = 'http://localhost:3000/api/cron/sync-youtube';

let snapshot: ContentSnapshot;

function request(headers: Record<string, string> = {}, query = ''): NextRequest {
  return new NextRequest(`${ROUTE_URL}${query}`, { headers });
}

async function videoCount(): Promise<number> {
  const { count, error } = await service
    .from('videos')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'youtube');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  snapshot = await snapshotContentTables();
});

afterAll(async () => {
  await restoreContentTables(snapshot);
  // S1.5: the failed-run rows now emit `sync.failed` through the runner (04 J-F) — purge them (H-1).
  await purgeNotificationEvents();
});

describe('T-ACT-33 /api/cron/sync-youtube', () => {
  it('T-ACT-33 no Authorization header → 401 exact JSON, no sync_runs row, no upstream request, no videos row (00 S1.6 AC1)', async () => {
    const before = await syncRunCount();
    const videosBefore = await videoCount();
    const fetchSpy = spyFetch(ALL_OK);
    const res = await route.GET(request());
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Nope.' },
    });
    expect(await syncRunCount()).toBe(before);
    expect(await videoCount()).toBe(videosBefore);
    expect(fetchSpy.calls).toEqual([]);
  });

  it('T-ACT-33 Authorization: Bearer wrong → 401, no side effects', async () => {
    const before = await syncRunCount();
    const fetchSpy = spyFetch(ALL_OK);
    const res = await route.GET(request({ authorization: 'Bearer wrong' }, '?full=1'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
    expect(await syncRunCount()).toBe(before);
    expect(fetchSpy.calls).toEqual([]);
  });

  it('T-ACT-33 correct CRON_SECRET → 200 JSON JobSummary {ok, source, run_id, items, ms}; the run upserted videos and wrote its sync_runs row', async () => {
    const before = await syncRunCount();
    const videosBefore = await videoCount();
    const fetchSpy = spyFetch(ALL_OK);
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as JobSummary;
    expect(body.ok).toBe(true);
    expect(body.source).toBe('youtube');
    expect(typeof body.run_id).toBe('string');
    expect(typeof body.items).toBe('number');
    expect(typeof body.ms).toBe('number');
    expect(body.full).toBe(false);
    expect(typeof body.units).toBe('number');

    // A plain cron tick over a non-empty table: feed + videos.list, no playlist walk.
    expect(fetchSpy.calls.some((url) => url.includes('/playlistItems'))).toBe(false);
    expect(await syncRunCount()).toBe(before + 1);
    expect(await videoCount()).toBe(videosBefore + body.items);
    expect(body.items).toBe(13); // the feed's 15 minus live + upcoming (ADR-0043 D2)
    const { data } = await service
      .from('sync_runs')
      .select('finished_at, ok, items')
      .eq('id', body.run_id)
      .single();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.items).toBe(13);
  });

  it('T-ACT-33 ?full=1 with the secret → 200, the real job walks playlistItems before videos.list (04 §2.4)', async () => {
    const fetchSpy = spyFetch(ALL_OK);
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }, '?full=1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobSummary;
    expect(body.ok).toBe(true);
    expect(body.full).toBe(true);
    expect(body.walked).toBe(21);
    expect(fetchSpy.calls.map((url) => url.split('?')[0])).toEqual([
      RSS_BASE,
      `${API_BASE}/playlistItems`,
      `${API_BASE}/videos`,
    ]);
  });

  it('T-ACT-33 POST/HEAD/PUT/PATCH/DELETE → 405 with Allow: GET', async () => {
    for (const handler of [route.POST, route.HEAD, route.PUT, route.PATCH, route.DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
    }
  });

  it('T-ACT-33 job failure → 500 {ok:false, source, run_id, error:{code:job_failed}}; sync_runs finalized ok=false', async () => {
    const videosBefore = await videoCount();
    spyFetch({ ...ALL_OK, [RSS_BASE]: 'status:400' });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      run_id: string;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.source).toBe('youtube');
    expect(typeof body.run_id).toBe('string');
    expect(body.error.code).toBe('job_failed');

    const { data } = await service
      .from('sync_runs')
      .select('finished_at, ok, error')
      .eq('id', body.run_id)
      .single();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error).not.toBeNull();
    expect(data?.error).not.toMatch(/key=/i);
    expect(await videoCount()).toBe(videosBefore);
  });

  it("T-ACT-33 handler exports dynamic='force-dynamic', runtime='nodejs', maxDuration=300 (ADR-0002 C15)", () => {
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.runtime).toBe('nodejs');
    expect(route.maxDuration).toBe(300);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-33 — the route's own guards, with the job mocked: a summary without an error text, and a
// job that throws past its try/finally (the "last resort" catch — 500, run_id '', one log line)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-33 /api/cron/sync-youtube route guards (job mocked)', () => {
  afterEach(() => {
    jobOverride.run = null;
  });

  it.each<{ query: string; full: boolean }>([
    { query: '', full: false },
    { query: '?full=1', full: true },
    { query: '?full=true', full: false }, // only the documented literal `1` switches it on
    { query: '?full=0', full: false },
  ])(
    "T-ACT-33 '$query' → the job receives {trigger:'cron', full:$full} and its summary is the 200 body",
    async ({ query, full }) => {
      const received: JobOptions[] = [];
      jobOverride.run = async (opts) => {
        received.push(opts);
        return { ok: true, source: 'youtube', run_id: 't_run', items: 0, ms: 1 };
      };
      const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }, query));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        source: 'youtube',
        run_id: 't_run',
        items: 0,
        ms: 1,
      });
      expect(received).toEqual([{ trigger: 'cron', full }]);
    },
  );

  it("T-ACT-33 a summary ok:false without an error text → 500 job_failed with the fallback 'Job failed.'", async () => {
    jobOverride.run = async () => ({
      ok: false,
      source: 'youtube',
      run_id: 't_run',
      items: 0,
      ms: 1,
    });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      source: 'youtube',
      run_id: 't_run',
      error: { code: 'job_failed', message: 'Job failed.' },
    });
  });

  it.each<{ name: string; thrown: unknown; logged: string }>([
    { name: 'an Error', thrown: new Error('t_ boom'), logged: 't_ boom' },
    { name: 'a non-Error value', thrown: 't_ string rejection', logged: 't_ string rejection' },
  ])(
    "T-ACT-33 the job throwing $name → 500 job_failed, run_id '', one route_unhandled log line",
    async ({ thrown, logged }) => {
      jobOverride.run = () => Promise.reject(thrown);
      const logs = spyLog();
      try {
        const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
          ok: false,
          source: 'youtube',
          run_id: '',
          error: { code: 'job_failed', message: 'Job failed.' },
        });
      } finally {
        logs.restore();
      }
      const lines = logs.lines.filter(
        (entry) => (entry as { msg?: string }).msg === 'route_unhandled',
      ) as Array<{ job?: string; meta?: { error?: string } }>;
      expect(lines).toHaveLength(1);
      expect(lines[0]?.job).toBe('syncYoutube');
      expect(lines[0]?.meta?.error).toBe(logged);
    },
  );
});
