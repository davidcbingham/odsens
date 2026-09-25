/**
 * tests/db/routes/cron-refresh-mentions.test.ts — T-ACT-33 for `/api/cron/refresh-mentions` + the
 * route side of T-ACT-70 / T-ACT-71 (04 SC-12, §2.4; 02 §1.4 / §2.10; ADR-0002 C15; 00 S1.8 AC7
 * "401 without secret"; 05 §7.2). Handlers are imported from the route file and invoked directly
 * (the route reads no cookies). `mutatesSeed`: every authorized run adds a `sync_runs` row, so the
 * file snapshots/restores the content tables (`mentions` + `sync_runs` included — 05 H-1); its one
 * stale mention comes from `makeMention` and leaves with `cleanupFactories`.
 *
 * `spyFetch` key = the real request prefix `${YOUTUBE_API_BASE}/videos` — ALWAYS routed, the 401 rows
 * included: the base is a loopback host, and an unrouted loopback URL passes through `spyFetch` to
 * the real network instead of throwing. The fixture `youtube/videos-mentions.json` answers
 * `fixmen00001` (95,400 views); SEED-10's `seedvid0001` is never answered, so the seed row is an
 * eligible-but-unchanged mention in every run here (and the reason the 500 row always has at least
 * one id to ask about).
 *
 * The 500 row answers `videos.list` with 400 (not retried, SC-09): a list-call failure → the job
 * returns `ok=false` with zero writes and the route wraps it as `job_failed` while the run row is
 * still finalized (SC-11). The guard rows mock the job and assert the options it received — this
 * route reads no query parameter (`?full=1` is `/api/cron/sync-youtube`'s alone, 04 §2.4).
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as route from '@/app/api/cron/refresh-mentions/route';
import { env } from '@/lib/env';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import {
  cleanupFactories,
  makeMention,
  makeSyncRun,
  purgeNotificationEvents,
} from '@/tests/helpers/factories';
import { spyFetch, spyLog, spyRevalidateTag } from '@/tests/helpers/spies';

/**
 * Set by the route-guard rows only (the job mocked to answer / throw a shape the real job never
 * produces — 04 §3 jobs finalize their row and return `ok:false`); read inside the hoisted factory.
 */
const jobOverride = vi.hoisted(() => ({
  run: null as null | ((opts: JobOptions) => Promise<JobSummary>),
}));

vi.mock('@/lib/jobs/refreshMentions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/refreshMentions')>();
  const refreshMentions: typeof actual.refreshMentions = (opts) =>
    jobOverride.run ? jobOverride.run(opts) : actual.refreshMentions(opts);
  return { ...actual, refreshMentions };
});

setupActionMocks();

const service = asRole('service');

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const API_BASE = process.env.YOUTUBE_API_BASE ?? '';
const API_KEY = process.env.YOUTUBE_API_KEY ?? '';
if (CRON_SECRET === '' || API_BASE === '' || API_KEY === '') {
  throw new Error('CRON_SECRET / YOUTUBE_API_BASE / YOUTUBE_API_KEY are not set — .env.test?');
}
const VIDEOS_URL = `${API_BASE}/videos`;
const FIXTURE_OK = { [VIDEOS_URL]: 'youtube/videos-mentions.json' };
const ROUTE_URL = 'http://localhost:3000/api/cron/refresh-mentions';

const FIX_1 = 'fixmen00001';
const FIX_1_VIEWS = 95_400;
const STALE_VIEWS = 5;

let snapshot: ContentSnapshot;
/** An eligible YouTube mention with a stale number — what an authorized run updates. */
let mentionId = '';

function request(headers: Record<string, string> = {}, query = ''): NextRequest {
  return new NextRequest(`${ROUTE_URL}${query}`, { headers });
}

const authorized = (query = ''): NextRequest =>
  request({ authorization: `Bearer ${CRON_SECRET}` }, query);

async function viewCount(): Promise<number | null> {
  const { data, error } = await service
    .from('mentions')
    .select('view_count')
    .eq('id', mentionId)
    .single();
  if (error) throw new Error(error.message);
  return data.view_count;
}

async function makeStale(): Promise<void> {
  const { error } = await service
    .from('mentions')
    .update({ view_count: STALE_VIEWS })
    .eq('id', mentionId);
  if (error) throw new Error(error.message);
}

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'mentions');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  snapshot = await snapshotContentTables();
  mentionId = await makeMention({
    external_id: FIX_1,
    url: `https://www.youtube.com/watch?v=${FIX_1}`,
    view_count: STALE_VIEWS,
  });
});

afterAll(async () => {
  await restoreContentTables(snapshot);
  await cleanupFactories();
  // The failed-run row emits `sync.failed` through the runner (04 J-F) — purge it (H-1).
  await purgeNotificationEvents();
});

describe('T-ACT-33 /api/cron/refresh-mentions', () => {
  it('T-ACT-33 no Authorization header → 401 exact JSON, no sync_runs row, no upstream request, no mentions write (00 S1.8 AC7)', async () => {
    const before = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const res = await route.GET(request());
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Nope.' },
    });
    expect(await syncRunCount()).toBe(before);
    expect(await viewCount()).toBe(STALE_VIEWS);
    expect(fetchSpy.calls).toEqual([]);
    expect(tags.calls).toEqual([]);
  });

  it.each<{ name: string; headers: Record<string, string> }>([
    { name: 'Bearer wrong', headers: { authorization: 'Bearer wrong' } },
    { name: 'the secret without the Bearer scheme', headers: { authorization: CRON_SECRET } },
    { name: 'the secret in another header', headers: { 'x-cron-secret': CRON_SECRET } },
    {
      name: 'the secret with one character appended',
      headers: { authorization: `Bearer ${CRON_SECRET}x` },
    },
  ])('T-ACT-33 $name → 401, no side effects', async ({ headers }) => {
    const before = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    const res = await route.GET(request(headers));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
    expect(await syncRunCount()).toBe(before);
    expect(await viewCount()).toBe(STALE_VIEWS);
    expect(fetchSpy.calls).toEqual([]);
  });

  it('T-ACT-33 the secret in the query string is not a credential → 401', async () => {
    const before = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    const res = await route.GET(request({}, `?secret=${CRON_SECRET}&authorization=${CRON_SECRET}`));
    expect(res.status).toBe(401);
    expect(await syncRunCount()).toBe(before);
    expect(fetchSpy.calls).toEqual([]);
  });

  it('T-ACT-33 correct CRON_SECRET → 200 JSON JobSummary {ok, source, run_id, items, ms}; the run refreshed the stale mention and wrote its sync_runs row', async () => {
    const before = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const res = await route.GET(authorized());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as JobSummary;
    expect(body.ok).toBe(true);
    expect(body.source).toBe('mentions');
    expect(typeof body.run_id).toBe('string');
    expect(typeof body.ms).toBe('number');
    expect(body.items).toBe(1);
    expect(body).toMatchObject({ updated: 1, units: 1, errors: [] });
    expect(body.skipped).toBeUndefined();

    expect(await viewCount()).toBe(FIX_1_VIEWS);
    expect(fetchSpy.calls).toHaveLength(1);
    expect(fetchSpy.calls[0]?.startsWith(`${VIDEOS_URL}?part=statistics&id=`)).toBe(true);
    expect(tags.calls).toEqual(['mentions']); // a general mention — no project tag

    expect(await syncRunCount()).toBe(before + 1);
    const { data } = await service
      .from('sync_runs')
      .select('source, finished_at, ok, items, error')
      .eq('id', body.run_id)
      .single();
    expect(data?.source).toBe('mentions');
    expect(data?.finished_at).not.toBeNull();
    expect(data?.ok).toBe(true);
    expect(data?.items).toBe(1);
    expect(data?.error).toBeNull();
  });

  it('T-ACT-33 a second authorized tick is idempotent → 200, items 0, nothing revalidated (00 S1.8 AC7)', async () => {
    spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const res = await route.GET(authorized());
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobSummary;
    expect(body).toMatchObject({ ok: true, items: 0, updated: 0 });
    expect(await viewCount()).toBe(FIX_1_VIEWS);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-33 POST/HEAD/PUT/PATCH/DELETE → 405 with Allow: GET, no-store', async () => {
    for (const handler of [route.POST, route.HEAD, route.PUT, route.PATCH, route.DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({
        ok: false,
        error: { code: 'validation', message: 'GET only.' },
      });
    }
  });

  it('T-ACT-33 job failure (videos.list 400) → 500 {ok:false, source, run_id, error:{code:job_failed}}; sync_runs finalized ok=false; the key value is in neither the body nor the row; no mention changed', async () => {
    await makeStale();
    spyFetch({ [VIDEOS_URL]: 'status:400' });
    const res = await route.GET(authorized());
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    const body = JSON.parse(text) as {
      ok: boolean;
      source: string;
      run_id: string;
      error: { code: string; message: string };
    };
    expect(Object.keys(body).sort()).toEqual(['error', 'ok', 'run_id', 'source']);
    expect(body.ok).toBe(false);
    expect(body.source).toBe('mentions');
    expect(typeof body.run_id).toBe('string');
    expect(body.error.code).toBe('job_failed');
    expect(body.error.message).toContain('/videos');
    expect(text).not.toContain(`key=${API_KEY}`);
    expect(text).not.toMatch(/[?&]key=(?!\[redacted\])/);

    const { data } = await service
      .from('sync_runs')
      .select('finished_at, ok, error')
      .eq('id', body.run_id)
      .single();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error).not.toBeNull();
    expect(data?.error ?? '').not.toContain(`key=${API_KEY}`);
    expect(data?.error ?? '').not.toMatch(/[?&]key=(?!\[redacted\])/);
    expect(await viewCount()).toBe(STALE_VIEWS);
  });

  it("T-ACT-71 YOUTUBE_API_KEY unset → 200 {ok:true, items:0, skipped:'not_configured'}, no upstream request, the mention keeps its number", async () => {
    await makeStale();
    const saved = env.YOUTUBE_API_KEY;
    const fetchSpy = spyFetch(FIXTURE_OK);
    try {
      env.YOUTUBE_API_KEY = undefined;
      const res = await route.GET(authorized());
      expect(res.status).toBe(200);
      const body = (await res.json()) as JobSummary;
      expect(body).toMatchObject({
        ok: true,
        source: 'mentions',
        items: 0,
        skipped: 'not_configured',
      });
      const { data } = await service
        .from('sync_runs')
        .select('ok, error')
        .eq('id', body.run_id)
        .single();
      expect(data).toEqual({ ok: true, error: 'not configured' });
    } finally {
      env.YOUTUBE_API_KEY = saved;
    }
    expect(fetchSpy.calls).toEqual([]);
    expect(await viewCount()).toBe(STALE_VIEWS);
  });

  it("T-ACT-70 an open mentions run 5 min old → 200 {ok:true, skipped:'running'}, no second row, no upstream request", async () => {
    const lockId = await makeSyncRun({
      source: 'mentions',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const withLock = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    try {
      const res = await route.GET(authorized());
      expect(res.status).toBe(200);
      const body = (await res.json()) as JobSummary;
      expect(body).toMatchObject({ ok: true, skipped: 'running', run_id: lockId, items: 0 });
      expect(await syncRunCount()).toBe(withLock);
      expect(fetchSpy.calls).toEqual([]);
      expect(await viewCount()).toBe(STALE_VIEWS);
    } finally {
      // Close the arranged row so it cannot hold the lock for a later test in this file.
      const { error } = await service
        .from('sync_runs')
        .update({ finished_at: new Date().toISOString(), ok: true, items: 0 })
        .eq('id', lockId);
      if (error) throw new Error(error.message);
    }
  });

  it("T-ACT-33 handler exports dynamic='force-dynamic', runtime='nodejs', maxDuration=300 (ADR-0002 C15)", () => {
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.runtime).toBe('nodejs');
    expect(route.maxDuration).toBe(300);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-33 — the route's own guards, with the job mocked: the options it passes, a summary without
// an error text, and a job that throws past its try/finally (the "last resort" catch — 500,
// run_id '', one log line)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-33 /api/cron/refresh-mentions route guards (job mocked)', () => {
  afterEach(() => {
    jobOverride.run = null;
  });

  it.each(['', '?full=1', '?full=true'])(
    "T-ACT-33 '%s' → the job receives exactly {trigger:'cron'} (no query parameter is read) and its summary is the 200 body",
    async (query) => {
      const received: JobOptions[] = [];
      jobOverride.run = async (opts) => {
        received.push(opts);
        return { ok: true, source: 'mentions', run_id: 't_run', items: 0, ms: 1 };
      };
      const res = await route.GET(authorized(query));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        source: 'mentions',
        run_id: 't_run',
        items: 0,
        ms: 1,
      });
      expect(received).toEqual([{ trigger: 'cron' }]);
    },
  );

  it('T-ACT-33 an unauthorized request never reaches the job', async () => {
    let called = 0;
    jobOverride.run = async () => {
      called += 1;
      return { ok: true, source: 'mentions', run_id: 't_run', items: 0, ms: 1 };
    };
    const res = await route.GET(request({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(called).toBe(0);
  });

  it("T-ACT-33 a summary ok:false without an error text → 500 job_failed with the fallback 'Job failed.'", async () => {
    jobOverride.run = async () => ({
      ok: false,
      source: 'mentions',
      run_id: 't_run',
      items: 0,
      ms: 1,
    });
    const res = await route.GET(authorized());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      source: 'mentions',
      run_id: 't_run',
      error: { code: 'job_failed', message: 'Job failed.' },
    });
  });

  it.each<{ name: string; thrown: unknown; logged: string }>([
    { name: 'an Error', thrown: new Error('t_ boom'), logged: 't_ boom' },
    { name: 'a non-Error value', thrown: 't_ string rejection', logged: 't_ string rejection' },
  ])(
    "T-ACT-33 the job throwing $name → 500 job_failed, run_id '', the thrown text stays out of the body, one route_unhandled log line",
    async ({ thrown, logged }) => {
      jobOverride.run = () => Promise.reject(thrown);
      const logs = spyLog();
      try {
        const res = await route.GET(authorized());
        expect(res.status).toBe(500);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.json()).toEqual({
          ok: false,
          source: 'mentions',
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
      expect(lines[0]?.job).toBe('refreshMentions');
      expect(lines[0]?.meta?.error).toBe(logged);
    },
  );
});
