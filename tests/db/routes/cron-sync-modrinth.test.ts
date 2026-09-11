/**
 * tests/db/routes/cron-sync-modrinth.test.ts — T-ACT-33 for `/api/cron/sync-modrinth` (04 SC-12;
 * ADR-0002 C15; 05 §7.2). Handlers are imported from the route file and invoked directly (the route
 * reads no cookies). `mutatesSeed`: the 200 run re-syncs the two seed Modrinth projects (list derived
 * from `user-projects.json` in memory, F-6), so the file snapshots/restores the content tables (H-1).
 *
 * The 401 rows assert "no side effects" by counting `sync_runs`; the 500 row uses a non-retried 400
 * on the list call (SC-09: only 429/5xx retry), so the job fails fast and the row is still finalized
 * `ok=false` (SC-11).
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as route from '@/app/api/cron/sync-modrinth/route';
import type { ModrinthProject } from '@/lib/adapters/modrinth';
import type { JobSummary } from '@/lib/jobs/types';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { loadFixture } from '@/tests/helpers/fixtures';
import { purgeNotificationEvents } from '@/tests/helpers/factories';
import { spyFetch, spyLog } from '@/tests/helpers/spies';

/**
 * Set by the route-guard rows only (the job mocked to answer / throw a shape the real job never
 * produces — 04 §3 jobs finalize their row and return `ok:false`); read inside the hoisted factory.
 */
const jobOverride = vi.hoisted(() => ({ run: null as null | (() => Promise<JobSummary>) }));

vi.mock('@/lib/jobs/syncModrinth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/syncModrinth')>();
  const syncModrinth: typeof actual.syncModrinth = (opts) =>
    jobOverride.run ? jobOverride.run() : actual.syncModrinth(opts);
  return { ...actual, syncModrinth };
});

setupActionMocks();

const service = asRole('service');

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const MODRINTH_BASE = process.env.MODRINTH_API_BASE ?? '';
const MODRINTH_USER = process.env.MODRINTH_USER ?? '';
const LIST_URL = `${MODRINTH_BASE}/user/${MODRINTH_USER}/projects`;
const PROJECT_PREFIX = `${MODRINTH_BASE}/project/`;
const ROUTE_URL = 'http://localhost:3000/api/cron/sync-modrinth';

/** The two seed Modrinth projects only — a fast run that leaves no extra rows (T-E2E-41 fixtures ⊇ seed). */
let seedOnlyList: ModrinthProject[] = [];
let snapshot: ContentSnapshot;

const json = (value: unknown) => (): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(ROUTE_URL, { headers });
}

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'modrinth');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  snapshot = await snapshotContentTables();
  const all = await loadFixture<ModrinthProject[]>('modrinth', 'user-projects.json');
  seedOnlyList = all.filter((p) => p.id === 'sd000101' || p.id === 'sd000102');
  expect(seedOnlyList).toHaveLength(2);
});

afterAll(async () => {
  await restoreContentTables(snapshot);
  // S1.5: the failed-run rows now emit `sync.failed` through the runner (04 J-F) — purge them (H-1).
  await purgeNotificationEvents();
});

describe('T-ACT-33 /api/cron/sync-modrinth', () => {
  it('T-ACT-33 no Authorization header → 401 exact JSON and no sync_runs row', async () => {
    const before = await syncRunCount();
    const res = await route.GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Nope.' },
    });
    expect(await syncRunCount()).toBe(before);
  });

  it('T-ACT-33 Authorization: Bearer wrong → 401, no side effects', async () => {
    const before = await syncRunCount();
    const res = await route.GET(request({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
    expect(await syncRunCount()).toBe(before);
  });

  it('T-ACT-33 correct CRON_SECRET → 200 JSON JobSummary {ok, source, run_id, items, ms}', async () => {
    spyFetch({
      [LIST_URL]: json(seedOnlyList),
      [PROJECT_PREFIX]: 'modrinth/versions-empty.json',
    });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobSummary;
    expect(body.ok).toBe(true);
    expect(body.source).toBe('modrinth');
    expect(typeof body.run_id).toBe('string');
    expect(typeof body.items).toBe('number');
    expect(typeof body.ms).toBe('number');
  });

  it('T-ACT-33 POST/HEAD/PUT/PATCH/DELETE → 405 with Allow: GET', async () => {
    for (const handler of [route.POST, route.HEAD, route.PUT, route.PATCH, route.DELETE]) {
      const res = handler();
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
    }
  });

  it('T-ACT-33 job failure → 500 {ok:false, source, run_id, error:{code:job_failed}}; sync_runs finalized ok=false', async () => {
    spyFetch({ [LIST_URL]: 'status:400' });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      run_id: string;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.source).toBe('modrinth');
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
describe('T-ACT-33 /api/cron/sync-modrinth route guards (job mocked)', () => {
  afterEach(() => {
    jobOverride.run = null;
  });

  it("T-ACT-33 a summary ok:false without an error text → 500 job_failed with the fallback 'Job failed.'", async () => {
    jobOverride.run = async () => ({
      ok: false,
      source: 'modrinth',
      run_id: 't_run',
      items: 0,
      ms: 1,
    });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      source: 'modrinth',
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
          source: 'modrinth',
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
      expect(lines[0]?.job).toBe('syncModrinth');
      expect(lines[0]?.meta?.error).toBe(logged);
    },
  );
});
