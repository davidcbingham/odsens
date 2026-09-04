/**
 * tests/db/routes/cron-sync-curseforge.test.ts — T-ACT-33 for `/api/cron/sync-curseforge`
 * (04 SC-12; ADR-0002 C15; 05 §7.2). Handlers are imported from the route file and invoked directly
 * (the route reads no cookies). `mutatesSeed`: the 200 run touches the SEED-6 link's `synced_at`
 * (its numbers already mirror `curseforge/mod.json`), so the file snapshots/restores the content
 * tables (H-1).
 *
 * The 500 row 404s the only link (`error-404.json` is not retried, SC-09) so > 50 % of items fail
 * (J-P) — the job returns `ok=false` and the route wraps it as `job_failed` while the run row is
 * still finalized (SC-11).
 */
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as route from '@/app/api/cron/sync-curseforge/route';
import type { JobSummary } from '@/lib/jobs/types';
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
const jobOverride = vi.hoisted(() => ({ run: null as null | (() => Promise<JobSummary>) }));

vi.mock('@/lib/jobs/syncCurseforge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/syncCurseforge')>();
  const syncCurseforge: typeof actual.syncCurseforge = (opts) =>
    jobOverride.run ? jobOverride.run() : actual.syncCurseforge(opts);
  return { ...actual, syncCurseforge };
});

setupActionMocks();

const service = asRole('service');

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const CF_BASE = process.env.CURSEFORGE_API_BASE ?? '';
const CHAMELEON_URL = `${CF_BASE}/mods/900001`;
const ROUTE_URL = 'http://localhost:3000/api/cron/sync-curseforge';

let snapshot: ContentSnapshot;

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(ROUTE_URL, { headers });
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
});

afterAll(async () => {
  await restoreContentTables(snapshot);
  // S1.5: the failed-run rows now emit `sync.failed` through the runner (04 J-F) — purge them (H-1).
  await purgeNotificationEvents();
});

describe('T-ACT-33 /api/cron/sync-curseforge', () => {
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
    spyFetch({ [CHAMELEON_URL]: 'curseforge/mod.json' });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as JobSummary;
    expect(body.ok).toBe(true);
    expect(body.source).toBe('curseforge');
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
    spyFetch({ [CHAMELEON_URL]: 'curseforge/error-404.json' });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      run_id: string;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.source).toBe('curseforge');
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
describe('T-ACT-33 /api/cron/sync-curseforge route guards (job mocked)', () => {
  afterEach(() => {
    jobOverride.run = null;
  });

  it("T-ACT-33 a summary ok:false without an error text → 500 job_failed with the fallback 'Job failed.'", async () => {
    jobOverride.run = async () => ({
      ok: false,
      source: 'curseforge',
      run_id: 't_run',
      items: 0,
      ms: 1,
    });
    const res = await route.GET(request({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      source: 'curseforge',
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
          source: 'curseforge',
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
      expect(lines[0]?.job).toBe('syncCurseforge');
      expect(lines[0]?.meta?.error).toBe(logged);
    },
  );
});
