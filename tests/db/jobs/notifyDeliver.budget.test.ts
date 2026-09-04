/**
 * tests/db/jobs/notifyDeliver.budget.test.ts — the `DELIVER_TIME_BUDGET_MS` stop rule of
 * `notifyDeliver` (04 §3.7 / §5.8; `lib/notify/constants.ts`; 02 §1.4 `maxDuration` 60 — the job
 * stops claiming groups after the budget so the route never times out mid-batch). Supplementary to
 * T-ACT-30 (no 05 ID of its own): the constant is mocked to a negative budget so the first group is
 * already over budget — the claimed rows stay `pending`, untouched, and the summary reports them as
 * `deferred`. Its own file because `vi.mock` of the constants module is file-wide (H-4 allows a job
 * more than one file). The `notify` `sync_runs` row the own-row run writes is removed by the content
 * snapshot in `afterAll` (H-1). The tick-anchored clock (owner's `started_at` when nested) is proven
 * without a mock in `notifyDeliver.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { notifyDeliver } from '@/lib/jobs/notifyDeliver';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import {
  cleanupFactories,
  makeNotificationEvent,
  makeRecipient,
  purgeNotificationEvents,
} from '@/tests/helpers/factories';
import { spyFetch, type FetchSpy } from '@/tests/helpers/spies';

vi.mock('@/lib/notify/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notify/constants')>();
  return { ...actual, DELIVER_TIME_BUDGET_MS: -1 };
});

setupActionMocks();

const service = asRole('service');
let fetchSpy: FetchSpy;
let snapshot: ContentSnapshot;

beforeAll(async () => {
  snapshot = await snapshotContentTables();
  await purgeNotificationEvents();
  fetchSpy = spyFetch({}); // any send would be an unrouted call (H-5) — none may happen
});

afterEach(async () => {
  await cleanupFactories();
  await purgeNotificationEvents();
});

afterAll(async () => {
  fetchSpy.restore();
  await restoreContentTables(snapshot); // H-1: the own-row run's `notify` sync_runs row
});

describe('notifyDeliver time budget (04 §5.8 DELIVER_TIME_BUDGET_MS)', () => {
  it('stops claiming groups once the budget is spent: rows stay pending and count as deferred', async () => {
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    const emailId = await makeRecipient({ event_id: eventId, channel: 'email' });
    const discordId = await makeRecipient({ event_id: eventId, channel: 'discord' });

    const summary = await notifyDeliver({ trigger: 'manual' });
    expect(summary.ok).toBe(true);
    expect(summary.claimed).toBe(2);
    expect(summary.deferred).toBe(2);
    expect(summary.items).toBe(0);
    expect(summary.failed).toBe(0);
    expect(fetchSpy.calls).toEqual([]);

    for (const id of [emailId, discordId]) {
      const { data } = await service
        .from('notification_recipients')
        .select('status, attempts, error')
        .eq('id', id)
        .single();
      expect(data).toEqual({ status: 'pending', attempts: 0, error: null });
    }
  });
});
