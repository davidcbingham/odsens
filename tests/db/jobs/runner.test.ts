/**
 * tests/db/jobs/runner.test.ts — the shared job runner `lib/jobs/runner.ts` `runJob` + its
 * `lib/jobs/runs.ts` bookkeeping on the real stack (04 §3 preamble, SC-11 insert-then-finalize,
 * SC-13 lock, J-F edge; ADR-0030 D1/D2; 01 INV-71; 05 T-ACT-45 (the one finalized row), T-ACT-70
 * (lock), T-ACT-74 (J-F edge) — the arms no job test reaches, reproduced with `withDbFault` (the
 * 05 T-ACT-0 (1) precedent) and a `work` body under the test's control; COV-4 headroom).
 *
 * Source `skins` (script-only, never written by a job) keeps the arranged `sync_runs` rows free of
 * other files' runs so the J-F predecessor is exactly the row this file plants; every row is removed
 * through the content snapshot in `afterAll` (H-1). No adapter is involved — `spyFetch({})` guards
 * H-5 all the same.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runJob, type JobWorkContext } from '@/lib/jobs/runner';
import type { JobSummary } from '@/lib/jobs/types';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { withDbFault } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeSyncRun,
  purgeNotificationEvents,
  trackNotificationEvent,
} from '@/tests/helpers/factories';
import { spyFetch, spyLog, type FetchSpy, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const SOURCE = 'skins' as const;
const JOB = 't_runnerJob';
const MINUTE_MS = 60_000;

let snapshot: ContentSnapshot;
let fetchSpy: FetchSpy;
let logs: LogSpy;

type Work = Parameters<typeof runJob>[0]['work'];

function job(work: Work): Promise<JobSummary> {
  return runJob({ source: SOURCE, job: JOB, opts: { trigger: 'manual' }, work });
}

async function runRows(): Promise<
  { id: string; ok: boolean | null; finished_at: string | null; error: string | null }[]
> {
  const { data, error } = await service
    .from('sync_runs')
    .select('id, ok, finished_at, error')
    .eq('source', SOURCE)
    .order('started_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

async function wipeRuns(): Promise<void> {
  const { error } = await service.from('sync_runs').delete().eq('source', SOURCE);
  if (error) throw new Error(error.message);
}

async function failedEvents(): Promise<{ run_id?: string }[]> {
  const { data, error } = await service
    .from('notification_events')
    .select('id, payload')
    .eq('kind', 'sync.failed')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data as unknown as { id: string; payload: { source?: string; run_id?: string } }[];
  for (const row of rows) trackNotificationEvent(row.id);
  return rows.filter((row) => row.payload.source === SOURCE).map((row) => row.payload);
}

beforeAll(async () => {
  snapshot = await snapshotContentTables();
  await purgeNotificationEvents();
  fetchSpy = spyFetch({});
});

afterEach(async () => {
  logs?.restore();
  await cleanupFactories();
  await purgeNotificationEvents();
  await wipeRuns();
});

afterAll(async () => {
  fetchSpy.restore();
  await restoreContentTables(snapshot);
});

describe('runJob — sync_runs bookkeeping arms (04 SC-11 / SC-13; T-ACT-45, T-ACT-70)', () => {
  it('T-ACT-70 a failed SC-13 lock-check read → runJob rejects before any work and writes no row', async () => {
    let ran = false;
    await expect(
      withDbFault({ table: 'sync_runs', op: 'select' }, {}, () =>
        job(async () => {
          ran = true;
          return { ok: true, items: 0 };
        }),
      ),
    ).rejects.toThrow(/sync_runs lock check failed/);
    expect(ran).toBe(false);
    expect(await runRows()).toEqual([]);
  });

  it('T-ACT-45 a failed SC-11 insert → runJob rejects before any work (nothing to finalize)', async () => {
    let ran = false;
    await expect(
      withDbFault({ table: 'sync_runs', op: 'insert' }, {}, () =>
        job(async () => {
          ran = true;
          return { ok: true, items: 0 };
        }),
      ),
    ).rejects.toThrow(/sync_runs insert failed/);
    expect(ran).toBe(false);
    expect(await runRows()).toEqual([]);
  });

  it('T-ACT-45 a failed SC-11 finalize → runJob rejects after the work ran; the row stays open (a later tick sees a crashed run)', async () => {
    let seen: JobWorkContext | null = null;
    await expect(
      withDbFault({ table: 'sync_runs', op: 'update' }, {}, () =>
        job(async (ctx) => {
          seen = ctx;
          return { ok: true, items: 3 };
        }),
      ),
    ).rejects.toThrow(/sync_runs finalize failed/);
    expect(seen).not.toBeNull();
    const rows = await runRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe((seen as unknown as JobWorkContext).runId);
    expect(rows[0]?.finished_at).toBeNull();
    expect(rows[0]?.ok).toBeNull();
  });

  it.each<{ name: string; thrown: unknown; error: string }>([
    { name: 'an Error', thrown: new Error('t_ work boom'), error: 't_ work boom' },
    { name: 'a non-Error value', thrown: 't_ string thrown', error: 't_ string thrown' },
  ])(
    'T-ACT-45 a work body throwing $name → ok=false, the message is the error, the row is finalized (last-resort catch)',
    async ({ thrown, error }) => {
      logs = spyLog();
      const summary = await job(async () => {
        throw thrown;
      });
      expect(summary.ok).toBe(false);
      expect(summary.error).toBe(error);
      expect(summary.items).toBe(0);
      const rows = await runRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: summary.run_id, ok: false, error });
      expect(rows[0]?.finished_at).not.toBeNull();
      const failedLine = (logs.lines as Array<{ msg?: string; job?: string; id?: string }>).find(
        (line) => line.msg === 'failed',
      );
      expect(failedLine?.job).toBe(JOB);
      expect(failedLine?.id).toBe(summary.run_id);
    },
  );

  it("T-ACT-45 a work result {ok:false} without an error text stores and answers 'failed'", async () => {
    const summary = await job(async () => ({ ok: false, items: 0 }));
    expect(summary.ok).toBe(false);
    expect(summary.error).toBe('failed');
    expect((await runRows())[0]).toMatchObject({ ok: false, error: 'failed' });
  });
});

describe('runJob — J-F edge through the runner (04 J-F, ADR-0030 D1; T-ACT-74)', () => {
  const failing: Work = async () => ({ ok: false, items: 0, error: 't_ boom' });

  it('T-ACT-74 ok → crashed (open row, ok NULL, older than the lock window) → failed → emits: an unfinalized predecessor is skipped', async () => {
    await makeSyncRun({
      source: SOURCE,
      ok: true,
      items: 1,
      started_at: new Date(Date.now() - 40 * MINUTE_MS).toISOString(),
      finished_at: new Date(Date.now() - 39 * MINUTE_MS).toISOString(),
    });
    // The crash: started after the ok run, never finalized, and past JOB_LOCK_MINUTES so it holds no lock.
    await makeSyncRun({
      source: SOURCE,
      started_at: new Date(Date.now() - 20 * MINUTE_MS).toISOString(),
      finished_at: null,
    });
    const summary = await job(failing);
    expect(summary.ok).toBe(false);
    expect(summary.skipped).toBeUndefined(); // the 20-min-old open row does not hold the SC-13 lock
    const events = await failedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.run_id).toBe(summary.run_id);
  });

  it('T-ACT-74 failed (finalized) → crashed → failed → no event: still the same failure episode', async () => {
    await makeSyncRun({
      source: SOURCE,
      ok: false,
      items: 0,
      error: 't_ earlier',
      started_at: new Date(Date.now() - 40 * MINUTE_MS).toISOString(),
      finished_at: new Date(Date.now() - 39 * MINUTE_MS).toISOString(),
    });
    await makeSyncRun({
      source: SOURCE,
      started_at: new Date(Date.now() - 20 * MINUTE_MS).toISOString(),
      finished_at: null,
    });
    const summary = await job(failing);
    expect(summary.ok).toBe(false);
    expect(await failedEvents()).toEqual([]);
  });

  it('T-ACT-74 a failed own-row read inside J-F is logged (emit_failed), never thrown, no event', async () => {
    await makeSyncRun({
      source: SOURCE,
      ok: true,
      items: 0,
      finished_at: new Date().toISOString(),
    });
    logs = spyLog();
    // sync_runs selects in an owning run: 1 = SC-13 lock check, 2 = J-F previous read, 3 = J-F own read.
    const summary = await withDbFault({ table: 'sync_runs', op: 'select' }, { nth: 3 }, () =>
      job(failing),
    );
    expect(summary.ok).toBe(false);
    expect(await failedEvents()).toEqual([]);
    const line = (logs.lines as Array<{ msg?: string; meta?: { error?: string } }>).find(
      (entry) => entry.msg === 'emit_failed',
    );
    expect(line?.meta?.error).toMatch(/sync_runs own read failed/);
  });
});
