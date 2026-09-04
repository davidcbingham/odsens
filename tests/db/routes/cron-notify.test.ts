/**
 * tests/db/routes/cron-notify.test.ts — T-ACT-33 for `/api/cron/notify` + the route side of T-ACT-70
 * (04 SC-12 / SC-13, §2.4 notify row; 02 §1.4 RP-17 `maxDuration` 60 — ADR-0002 C15; ADR-0030 D2;
 * 05 §7.2). Handlers are imported from the route file and invoked directly (the route reads no
 * cookies). The 200 row runs the real `runNotify` on an empty queue (fan-out + deliver → one `notify`
 * run row); the 500 row fails the deliver step's claim read through `withDbFault` so the job returns
 * `ok=false` and the route wraps it as `job_failed` while the run row is still finalized (SC-11).
 * Events the failed run emits (J-F for `notify`) are purged (H-1).
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as route from '@/app/api/cron/notify/route';
import type { JobSummary } from '@/lib/jobs/types';
import { touchSeedSyncRuns } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { withDbFault } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeSyncRun, purgeNotificationEvents } from '@/tests/helpers/factories';
import { spyFetch, spyLog, type FetchSpy } from '@/tests/helpers/spies';

/**
 * Set by the route-guard rows only (the job mocked to answer / throw a shape the real job never
 * produces — 04 §3 jobs finalize their row and return `ok:false`); read inside the hoisted factory.
 */
const jobOverride = vi.hoisted(() => ({ run: null as null | (() => Promise<JobSummary>) }));

vi.mock('@/lib/jobs/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/notify')>();
  const runNotify: typeof actual.runNotify = (opts) =>
    jobOverride.run ? jobOverride.run() : actual.runNotify(opts);
  return { ...actual, runNotify };
});

setupActionMocks();

const service = asRole('service');

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const ROUTE_URL = 'http://localhost:3000/api/cron/notify';

let snapshot: ContentSnapshot;
let fetchSpy: FetchSpy;

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(ROUTE_URL, { headers });
}

async function notifyRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'notify');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  await touchSeedSyncRuns();
  snapshot = await snapshotContentTables();
  await purgeNotificationEvents();
  fetchSpy = spyFetch({}); // H-5: the empty queue makes no outbound call
});

afterEach(async () => {
  await cleanupFactories();
});

afterAll(async () => {
  fetchSpy.restore();
  await purgeNotificationEvents();
  await restoreContentTables(snapshot);
});

describe('T-ACT-33 /api/cron/notify', () => {
  it('T-ACT-33 no Authorization header → 401 exact JSON and no sync_runs row', async () => {
    const before = await notifyRunCount();
    const res = await route.GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Nope.' },
    });
    expect(await notifyRunCount()).toBe(before);
  });

  it('T-ACT-33 Authorization: Bearer wrong → 401, no side effects', async () => {
    const before = await notifyRunCount();
    const res = await route.GET(request({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
    expect(await notifyRunCount()).toBe(before);
  });

  it('T-ACT-33 correct CRON_SECRET → 200 JSON JobSummary {ok, source, run_id, items, ms} and ONE notify run row', async () => {
    const before = await notifyRunCount();
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as JobSummary;
    expect(body.ok).toBe(true);
    expect(body.source).toBe('notify');
    expect(typeof body.run_id).toBe('string');
    expect(typeof body.items).toBe('number');
    expect(typeof body.ms).toBe('number');
    expect(body.fan_out).toBeDefined();
    expect(body.deliver).toBeDefined();
    expect(await notifyRunCount()).toBe(before + 1);
  });

  it('T-ACT-33 POST/HEAD/PUT/PATCH/DELETE → 405 with Allow: GET', () => {
    for (const handler of [route.POST, route.HEAD, route.PUT, route.PATCH, route.DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
    }
  });

  it('T-ACT-33 job failure → 500 {ok:false, source, run_id, error:{code:job_failed}}; sync_runs finalized ok=false', async () => {
    const res = await withDbFault({ table: 'notification_recipients', op: 'select' }, {}, () =>
      route.GET(request({ authorization: `Bearer ${CRON_SECRET}` })),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      run_id: string;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.source).toBe('notify');
    expect(typeof body.run_id).toBe('string');
    expect(body.error.code).toBe('job_failed');
    expect(body.error.message).toMatch(/^deliver: /);

    const { data } = await service
      .from('sync_runs')
      .select('finished_at, ok, error')
      .eq('id', body.run_id)
      .single();
    expect(data?.finished_at).not.toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.error).not.toBeNull();
  });

  it("T-ACT-33 handler exports dynamic='force-dynamic', runtime='nodejs', maxDuration=60 (ADR-0002 C15)", () => {
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.runtime).toBe('nodejs');
    expect(route.maxDuration).toBe(60);
  });

  it("T-ACT-70 an open notify run 5 min old → 200 {ok:true, skipped:'running'}, no second row", async () => {
    const openRun = await makeSyncRun({
      source: 'notify',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const before = await notifyRunCount();
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobSummary;
    expect(body).toMatchObject({ ok: true, source: 'notify', run_id: openRun, skipped: 'running' });
    expect(await notifyRunCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-33 — the route's own guards, with the job mocked: a summary without an error text, and a
// job that throws past its try/finally (the "last resort" catch — 500, run_id '', one log line)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-33 /api/cron/notify route guards (job mocked)', () => {
  afterEach(() => {
    jobOverride.run = null;
  });

  it("T-ACT-33 a summary ok:false without an error text → 500 job_failed with the fallback 'Job failed.'", async () => {
    jobOverride.run = async () => ({
      ok: false,
      source: 'notify',
      run_id: 't_run',
      items: 0,
      ms: 1,
    });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      source: 'notify',
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
          source: 'notify',
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
      expect(lines[0]?.job).toBe('runNotify');
      expect(lines[0]?.meta?.error).toBe(logged);
    },
  );
});
