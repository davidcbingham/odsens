/**
 * tests/db/jobs/notify.test.ts — `runNotify` (`lib/jobs/notify.ts`, 04 §2.4 notify row: fan-out then
 * deliver on ONE `sync_runs` row; 02 §1.4 `items` = delivered count; SC-11/SC-13; ADR-0030 D1/D2)
 * + the job side of T-ACT-70 for `notify` (05 §7.2; 00 S1.5.AC12 idempotency). The nested rule is
 * proven both ways: called WITH the owner's `runId` the two jobs write no `sync_runs` row and skip the
 * lock (the owner's open row IS the lock); called WITHOUT one each manages its own row.
 *
 * Harness per 05 §7.2: `spyFetch` routes Resend to `resend/send-ok.json`; `mutatesSeed`
 * (`admin_notify_emails`) restored through `restoreSeedSettings()`; events purged per test (H-1).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runNotify } from '@/lib/jobs/notify';
import { notifyDeliver } from '@/lib/jobs/notifyDeliver';
import { notifyFanOut } from '@/lib/jobs/notifyFanOut';
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
  makeNotificationEvent,
  makeSyncRun,
  purgeNotificationEvents,
  trackNotificationEvent,
} from '@/tests/helpers/factories';
import { spyFetch, spyLog, type FetchSpy, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const RESEND_URL = `${process.env.RESEND_API_BASE ?? ''}/emails`;
const EMAIL_A = 'seed-admin@localhost.test';

let snapshot: ContentSnapshot;
let fetchSpy: FetchSpy;
let logs: LogSpy;

type StepSummary = { ok: boolean; items: number; events?: number; claimed?: number };

async function notifyRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'notify');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function readRun(id: string) {
  const { data, error } = await service
    .from('sync_runs')
    .select('source, ok, items, error, finished_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function syncFailedFor(source: string): Promise<string[]> {
  const { data, error } = await service
    .from('notification_events')
    .select('id, payload')
    .eq('kind', 'sync.failed');
  if (error) throw new Error(error.message);
  const rows = data as unknown as { id: string; payload: { source?: string } }[];
  for (const row of rows) trackNotificationEvent(row.id);
  return rows.filter((row) => row.payload.source === source).map((row) => row.id);
}

beforeAll(async () => {
  await touchSeedSyncRuns();
  snapshot = await snapshotContentTables();
  await purgeNotificationEvents();
  await restoreSeedSettings();
  const { error } = await service
    .from('site_settings')
    .update({ admin_notify_emails: [EMAIL_A] })
    .eq('id', 1);
  if (error) throw new Error(error.message);
});

beforeEach(() => {
  fetchSpy = spyFetch({ [RESEND_URL]: 'resend/send-ok.json' });
  logs = spyLog();
});

afterEach(async () => {
  logs.restore();
  fetchSpy.restore();
  await cleanupFactories();
  await purgeNotificationEvents();
});

afterAll(async () => {
  await restoreSeedSettings();
  await restoreContentTables(snapshot);
});

describe('runNotify (04 §2.4, ADR-0030 D2)', () => {
  it('writes ONE sync_runs row (source notify) for fan-out + deliver; items = delivered count; both step summaries ride along', async () => {
    await makeNotificationEvent({ kind: 'comment.new' });
    const before = await notifyRunCount();

    const summary = await runNotify({ trigger: 'cron' });
    expect(summary.ok).toBe(true);
    expect(summary.source).toBe('notify');
    expect(await notifyRunCount()).toBe(before + 1);

    const fanOut = summary.fan_out as StepSummary;
    const deliver = summary.deliver as StepSummary;
    expect(fanOut.ok).toBe(true);
    expect(fanOut.events).toBe(1);
    expect(fanOut.items).toBe(2); // email A pending + discord skipped (no webhook)
    expect(deliver.ok).toBe(true);
    expect(deliver.items).toBe(1);
    expect(summary.items).toBe(1); // 02 §1.4: delivered count
    expect(fetchSpy.calls).toHaveLength(1);
    // The step views carry no duplicated source / run_id.
    expect('run_id' in fanOut).toBe(false);
    expect('source' in deliver).toBe(false);

    const row = await readRun(summary.run_id);
    expect(row).toMatchObject({ source: 'notify', ok: true, items: 1, error: null });
    expect(row.finished_at).not.toBeNull();

    // One `done` line for the owner, one per nested step, all under the same run id (INV-42).
    const lines = logs.lines as Array<{ job?: string; msg?: string; id?: string }>;
    const done = lines.filter((line) => line.msg === 'done');
    expect(done.map((line) => line.job).sort()).toEqual([
      'notifyDeliver',
      'notifyFanOut',
      'runNotify',
    ]);
    for (const line of done) expect(line.id).toBe(summary.run_id);
  });

  it('a second tick sends nothing twice (S1.5.AC12): no new recipient, no new send', async () => {
    await makeNotificationEvent({ kind: 'comment.new' });
    const first = await runNotify({ trigger: 'cron' });
    expect(first.items).toBe(1);
    const second = await runNotify({ trigger: 'cron' });
    expect(second.ok).toBe(true);
    expect(second.items).toBe(0);
    expect((second.fan_out as StepSummary).events).toBe(0);
    expect((second.deliver as StepSummary).claimed).toBe(0);
    expect(fetchSpy.calls).toHaveLength(1);
  });

  it('notifyFanOut / notifyDeliver called WITHOUT a runId each manage their own sync_runs row', async () => {
    const before = await notifyRunCount();
    const fanOut = await notifyFanOut({ trigger: 'manual' });
    expect(fanOut.source).toBe('notify');
    expect(await notifyRunCount()).toBe(before + 1);
    expect((await readRun(fanOut.run_id)).ok).toBe(true);
    const deliver = await notifyDeliver({ trigger: 'manual' });
    expect(await notifyRunCount()).toBe(before + 2);
    expect((await readRun(deliver.run_id)).ok).toBe(true);
  });

  it('called WITH a runId the steps write no row, skip the lock and answer with the given run_id', async () => {
    const openRun = await makeSyncRun({
      source: 'notify',
      started_at: new Date(Date.now() - 60_000).toISOString(),
      finished_at: null,
    });
    const before = await notifyRunCount();
    const fanOut = await notifyFanOut({ trigger: 'cron', runId: openRun });
    const deliver = await notifyDeliver({ trigger: 'cron', runId: openRun });
    // No SC-13 skip — the owner's open row IS the lock (`skipped` here is the fan-out/deliver count).
    expect(fanOut.skipped).not.toBe('running');
    expect(deliver.skipped).not.toBe('running');
    expect(fanOut.ok).toBe(true);
    expect(deliver.ok).toBe(true);
    expect(fanOut.run_id).toBe(openRun);
    expect(deliver.run_id).toBe(openRun);
    expect(await notifyRunCount()).toBe(before);
    // Not finalized by the nested runs — the owner does that.
    expect((await readRun(openRun)).finished_at).toBeNull();
  });

  describe('T-ACT-70 job lock (04 SC-13) on notify', () => {
    it("T-ACT-70 an open notify run 5 min old → {ok:true, skipped:'running'} with that run's id, no second row", async () => {
      const openRun = await makeSyncRun({
        source: 'notify',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        finished_at: null,
      });
      const before = await notifyRunCount();
      const summary = await runNotify({ trigger: 'cron' });
      expect(summary).toMatchObject({
        ok: true,
        source: 'notify',
        run_id: openRun,
        skipped: 'running',
      });
      expect(await notifyRunCount()).toBe(before);
      expect(fetchSpy.calls).toEqual([]);
    });

    it('T-ACT-70 a stale open run (20 min old) does not hold the lock — the tick runs', async () => {
      await makeSyncRun({
        source: 'notify',
        started_at: new Date(Date.now() - 20 * 60_000).toISOString(),
        finished_at: null,
      });
      const before = await notifyRunCount();
      const summary = await runNotify({ trigger: 'cron' });
      expect(summary.skipped).not.toBe('running');
      expect(summary.ok).toBe(true);
      expect(await notifyRunCount()).toBe(before + 1);
    });
  });

  it('a deliver failure → ok=false, error names the step, the row is finalized and J-F emits sync.failed for notify once', async () => {
    // A previous ok notify run exists (the tests above) — the J-F edge is armed.
    await makeSyncRun({
      source: 'notify',
      ok: true,
      items: 0,
      finished_at: new Date().toISOString(),
    });
    const summary = await withDbFault({ table: 'notification_recipients', op: 'select' }, {}, () =>
      runNotify({ trigger: 'cron' }),
    );
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/^deliver: /);
    expect((summary.fan_out as StepSummary).ok).toBe(true);
    expect((summary.deliver as StepSummary).ok).toBe(false);
    const row = await readRun(summary.run_id);
    expect(row.ok).toBe(false);
    expect(row.error).toMatch(/^deliver: /);
    const events = await syncFailedFor('notify');
    expect(events).toHaveLength(1);

    // The failure persists → no second event (edge-triggered, T-ACT-74 rule via the runner).
    const again = await withDbFault({ table: 'notification_recipients', op: 'select' }, {}, () =>
      runNotify({ trigger: 'cron' }),
    );
    expect(again.ok).toBe(false);
    expect(await syncFailedFor('notify')).toHaveLength(1);
  });

  it('a fan-out failure still runs deliver (queued rows deserve delivery); the run is ok=false', async () => {
    const summary = await withDbFault({ table: 'notification_events', op: 'select' }, {}, () =>
      runNotify({ trigger: 'cron' }),
    );
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/^fan-out: /);
    const deliver = summary.deliver as StepSummary;
    expect(deliver.ok).toBe(true);
    expect(deliver.claimed).toBe(0);
  });
});
