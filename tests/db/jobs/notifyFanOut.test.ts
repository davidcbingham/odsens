/**
 * tests/db/jobs/notifyFanOut.test.ts — T-ACT-29 (fan-out, 04 §3.6 F1–F3) + T-ACT-32 (F0 stale,
 * 04 J-S / ADR-0030 D3) (05 §7.2 jobs layer; 01 INV-43 / INV-70 / INV-71; migrations
 * 20260903120000 + 20260903120100). `mutatesSeed`: the file writes SEED-1 (`admin_notify_emails`,
 * `discord_webhook_url`) and SEED-2 cells and backdates / removes SEED-12 `sync_runs` rows — every
 * test restores through `restoreSeedSettings()` and the content snapshot (05 H-1).
 *
 * Harness per 05 §7.2: the job runs against the local DB; `spyFetch({})` guards H-5 (fan-out makes
 * no outbound call). Events come from `makeNotificationEvent`; the recipient rows the job creates are
 * untracked and fall with their events (`purgeNotificationEvents` in `afterEach`). The webhook value
 * and the addresses are asserted absent from every `spyLog` line (INV-43).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { notifyFanOut } from '@/lib/jobs/notifyFanOut';
import type { JobSummary } from '@/lib/jobs/types';
import { syncSourceSubjectId } from '@/lib/notify/constants';
import { touchSeedSyncRuns } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  restoreSeedSettings,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { sql } from '@/tests/helpers/db';
import { withDbFault, withDbHook } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeNotificationEvent,
  makeRecipient,
  makeSyncRun,
  purgeNotificationEvents,
} from '@/tests/helpers/factories';
import { SEED_PROJECTS, SEED_SYNC_RUNS } from '@/tests/helpers/seedIds';
import { spyFetch, spyLog, type FetchSpy, type LogSpy } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const EMAIL_A = 'seed-admin@localhost.test';
const EMAIL_B = 'other-admin@localhost.test';
const WEBHOOK_TOKEN = 't_fanouttoken';
const WEBHOOK = `https://discord.com/api/webhooks/123/${WEBHOOK_TOKEN}`;
const HOUR_MS = 3_600_000;

type RecipientRow = {
  id: string;
  channel: string;
  address: string | null;
  status: string;
  attempts: number;
};

let snapshot: ContentSnapshot;
let fetchSpy: FetchSpy;
let logs: LogSpy;

function run(): Promise<JobSummary> {
  return notifyFanOut({ trigger: 'manual' });
}

async function setSettings(patch: {
  admin_notify_emails?: string[];
  discord_webhook_url?: string | null;
}): Promise<void> {
  const { error } = await service.from('site_settings').update(patch).eq('id', 1);
  if (error) throw new Error(error.message);
}

async function setMatrix(
  kind: string,
  channel: 'email' | 'discord',
  enabled: boolean,
): Promise<void> {
  const { error } = await service
    .from('notification_matrix')
    .upsert({ kind, channel, enabled }, { onConflict: 'kind,channel' });
  if (error) throw new Error(error.message);
}

async function recipientsFor(eventId: string): Promise<RecipientRow[]> {
  const { data, error } = await service
    .from('notification_recipients')
    .select('id, channel, address, status, attempts')
    .eq('event_id', eventId);
  if (error) throw new Error(error.message);
  // PostgREST orders enum columns by declaration order — sort in JS (Lane A note).
  return [...data].sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) || (a.address ?? '').localeCompare(b.address ?? ''),
  );
}

async function recipientCount(): Promise<number> {
  const { count, error } = await service
    .from('notification_recipients')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function eventsOfKind(
  kind: string,
): Promise<
  { id: string; subject_type: string; subject_id: string; payload: Record<string, unknown> }[]
> {
  const { data, error } = await service
    .from('notification_events')
    .select('id, subject_type, subject_id, payload')
    .eq('kind', kind)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data as unknown as {
    id: string;
    subject_type: string;
    subject_id: string;
    payload: Record<string, unknown>;
  }[];
}

async function backdateRun(id: string, hoursAgo: number): Promise<void> {
  const at = new Date(Date.now() - hoursAgo * HOUR_MS).toISOString();
  const { error } = await service
    .from('sync_runs')
    .update({ started_at: at, finished_at: at })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

async function deleteStaleEvents(): Promise<void> {
  const { error } = await service.from('notification_events').delete().eq('kind', 'sync.stale');
  if (error) throw new Error(error.message);
}

beforeAll(async () => {
  await touchSeedSyncRuns();
  snapshot = await snapshotContentTables();
  await purgeNotificationEvents(); // stray events from earlier files
  await restoreSeedSettings();
});

beforeEach(() => {
  fetchSpy = spyFetch({});
  logs = spyLog();
});

afterEach(async () => {
  logs.restore();
  fetchSpy.restore();
  await cleanupFactories();
  await purgeNotificationEvents();
  await restoreSeedSettings();
  await restoreContentTables(snapshot);
});

afterAll(async () => {
  await restoreContentTables(snapshot);
});

describe('T-ACT-29 notifyFanOut (04 §3.6 F1–F3)', () => {
  it('T-ACT-29 comment.new, email ON + 2 admin emails, discord ON + webhook → 3 pending rows; the webhook is the discord address and never in a log line', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A, EMAIL_B], discord_webhook_url: WEBHOOK });
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });

    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.source).toBe('notify');
    expect(summary.items).toBe(3);
    expect(summary.events).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(fetchSpy.calls).toEqual([]);

    const rows = await recipientsFor(eventId);
    expect(rows.map((row) => [row.channel, row.address, row.status, row.attempts])).toEqual([
      ['discord', WEBHOOK, 'pending', 0],
      ['email', EMAIL_B, 'pending', 0],
      ['email', EMAIL_A, 'pending', 0],
    ]);

    // INV-43: no address and no webhook (masked or not) reaches a log line.
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain(WEBHOOK_TOKEN);
    expect(text).not.toContain('webhooks/123');
    expect(text).not.toContain(EMAIL_A);
    expect(text).not.toContain(EMAIL_B);
    const done = (logs.lines as Array<{ job?: string; msg?: string; id?: string }>).find(
      (line) => line.msg === 'done',
    );
    expect(done?.job).toBe('notifyFanOut');
    expect(done?.id).toBe(summary.run_id);
  });

  it("T-ACT-29 email ON but admin_notify_emails = '{}' → one email row {address NULL, skipped}", async () => {
    await setSettings({ admin_notify_emails: [], discord_webhook_url: WEBHOOK });
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    const summary = await run();
    expect(summary.items).toBe(2);
    expect(summary.skipped).toBe(1);
    const rows = await recipientsFor(eventId);
    expect(rows.map((row) => [row.channel, row.address, row.status])).toEqual([
      ['discord', WEBHOOK, 'pending'],
      ['email', null, 'skipped'],
    ]);
  });

  it('T-ACT-29 discord ON but webhook NULL → one discord row {address NULL, skipped}', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: null });
    expect(env.DISCORD_WEBHOOK_URL).toBeUndefined(); // .env.test leaves the fallback blank
    const eventId = await makeNotificationEvent({ kind: 'comment.held' });
    await run();
    const rows = await recipientsFor(eventId);
    expect(rows.map((row) => [row.channel, row.address, row.status])).toEqual([
      ['discord', null, 'skipped'],
      ['email', EMAIL_A, 'pending'],
    ]);
  });

  it('T-ACT-29 the env DISCORD_WEBHOOK_URL is the fallback when the stored value is empty (SC-16, DB wins)', async () => {
    const saved = env.DISCORD_WEBHOOK_URL;
    try {
      env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/456/t_envfallback';
      await setSettings({ admin_notify_emails: [], discord_webhook_url: null });
      const fromEnv = await makeNotificationEvent({ kind: 'comment.new' });
      await run();
      expect((await recipientsFor(fromEnv)).find((row) => row.channel === 'discord')?.address).toBe(
        'https://discord.com/api/webhooks/456/t_envfallback',
      );
      await setSettings({ discord_webhook_url: WEBHOOK });
      const fromDb = await makeNotificationEvent({ kind: 'comment.new' });
      await run();
      expect((await recipientsFor(fromDb)).find((row) => row.channel === 'discord')?.address).toBe(
        WEBHOOK,
      );
    } finally {
      env.DISCORD_WEBHOOK_URL = saved;
    }
  });

  it('T-ACT-29 matrix OFF → a skipped row per channel even with targets set', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: WEBHOOK });
    await setMatrix('comment.new', 'email', false);
    await setMatrix('comment.new', 'discord', false);
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    const summary = await run();
    expect(summary.items).toBe(2);
    expect(summary.skipped).toBe(2);
    const rows = await recipientsFor(eventId);
    expect(rows.map((row) => [row.channel, row.address, row.status])).toEqual([
      ['discord', null, 'skipped'],
      ['email', null, 'skipped'],
    ]);
  });

  it('T-ACT-29 kinds absent from the matrix (comment.reply, comment.approved) → both rows skipped', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: WEBHOOK });
    const reply = await makeNotificationEvent({ kind: 'comment.reply' });
    const approved = await makeNotificationEvent({ kind: 'comment.approved' });
    const summary = await run();
    expect(summary.events).toBe(2);
    for (const eventId of [reply, approved]) {
      const rows = await recipientsFor(eventId);
      expect(rows.map((row) => [row.channel, row.address, row.status])).toEqual([
        ['discord', null, 'skipped'],
        ['email', null, 'skipped'],
      ]);
    }
  });

  it('T-ACT-29 every event ends with ≥ 2 rows; the unique index exists; a second run creates nothing (F3)', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A, EMAIL_B], discord_webhook_url: WEBHOOK });
    const ids = await Promise.all([
      makeNotificationEvent({ kind: 'comment.new' }),
      makeNotificationEvent({ kind: 'comment.reported' }),
      makeNotificationEvent({ kind: 'comment.reply' }),
    ]);
    const first = await run();
    expect(first.events).toBe(3);
    for (const id of ids) expect((await recipientsFor(id)).length).toBeGreaterThanOrEqual(2);
    const total = await recipientCount();

    const second = await run();
    expect(second.ok).toBe(true);
    expect(second.events).toBe(0);
    expect(second.items).toBe(0);
    expect(await recipientCount()).toBe(total);

    // The F3 key: `(event_id, channel, coalesce(address, ''))`, and a duplicate insert is 23505.
    const indexes = sql(
      "select indexname from pg_indexes where schemaname = 'public' and tablename = 'notification_recipients'",
    ).map((row) => row[0]);
    expect(indexes).toContain('notification_recipients_event_channel_address_key');
    const duplicate = await service
      .from('notification_recipients')
      .insert({ event_id: ids[0], channel: 'email', address: EMAIL_A, status: 'pending' });
    expect(duplicate.error?.code).toBe('23505');
  });

  it('T-ACT-29 a row a concurrent tick inserts between F1 and F2 is a no-op (per-row 23505 fallback), no duplicates', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A, EMAIL_B], discord_webhook_url: WEBHOOK });
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    // Right before this tick's batch insert, another tick lands one of the three rows.
    const summary = await withDbHook(
      { table: 'notification_recipients', op: 'insert' },
      async () => {
        await makeRecipient({ event_id: eventId, channel: 'email', address: EMAIL_A });
      },
      () => run(),
      { when: 'before' },
    );
    expect(summary.ok).toBe(true);
    expect(summary.items).toBe(2);
    const rows = await recipientsFor(eventId);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.address === EMAIL_A)).toHaveLength(1);
    expect(rows.filter((row) => row.address === EMAIL_B)).toHaveLength(1);
  });

  it('T-ACT-29 an event that already has a recipient row is never re-selected (F1 anti-join, F3)', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: WEBHOOK });
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    await makeRecipient({ event_id: eventId, channel: 'email', address: EMAIL_A, status: 'sent' });
    const summary = await run();
    expect(summary.events).toBe(0);
    expect(summary.items).toBe(0);
    expect(await recipientsFor(eventId)).toHaveLength(1);
  });

  it('T-ACT-29 events older than FANOUT_WINDOW_DAYS (7) are ignored; younger ones fan out', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: null });
    const old = await makeNotificationEvent({
      kind: 'comment.new',
      created_at: new Date(Date.now() - 8 * 24 * HOUR_MS).toISOString(),
    });
    const recent = await makeNotificationEvent({
      kind: 'comment.new',
      created_at: new Date(Date.now() - 6 * 24 * HOUR_MS).toISOString(),
    });
    const summary = await run();
    expect(summary.events).toBe(1);
    expect(await recipientsFor(old)).toEqual([]);
    expect((await recipientsFor(recent)).length).toBe(2);
  });

  it('T-ACT-29 a per-event insert failure is J-P (counted, the other event still fans out)', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: null });
    const a = await makeNotificationEvent({ kind: 'comment.new' });
    const b = await makeNotificationEvent({ kind: 'comment.new' });
    const summary = await withDbFault({ table: 'notification_recipients', op: 'insert' }, {}, () =>
      run(),
    );
    expect(summary.ok).toBe(true); // 1 of 2 failed — not more than half
    expect(summary.errors).toHaveLength(1);
    const fanned = [(await recipientsFor(a)).length, (await recipientsFor(b)).length].sort();
    expect(fanned).toEqual([0, 2]);
  });

  it('T-ACT-29 a failed matrix / settings read → ok=false with the error in the run row', async () => {
    await makeNotificationEvent({ kind: 'comment.new' });
    const summary = await withDbFault({ table: 'notification_matrix', op: 'select' }, {}, () =>
      run(),
    );
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/notification_matrix read failed/);
    const { data } = await service
      .from('sync_runs')
      .select('ok, error')
      .eq('id', summary.run_id)
      .single();
    expect(data?.ok).toBe(false);
    expect(data?.error).toMatch(/notification_matrix read failed/);
  });

  it('T-ACT-29 more than half of the events failing → ok=false (J-P)', async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: null });
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    const summary = await withDbFault(
      { table: 'notification_recipients', op: 'insert' },
      { nth: 'all' },
      () => run(),
    );
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/^1\/1 events failed/);
    expect(await recipientsFor(eventId)).toEqual([]);
  });

  it('T-ACT-29 a failed F1 read → ok=false, run row finalized with the error', async () => {
    const summary = await withDbFault({ table: 'notification_events', op: 'select' }, {}, () =>
      run(),
    );
    expect(summary.ok).toBe(false);
    expect(typeof summary.error).toBe('string');
    const { data } = await service
      .from('sync_runs')
      .select('ok, error, finished_at')
      .eq('id', summary.run_id)
      .single();
    expect(data?.ok).toBe(false);
    expect(data?.error).not.toBeNull();
    expect(data?.finished_at).not.toBeNull();
  });
});

describe('T-ACT-32 notifyFanOut F0 stale check (04 J-S, ADR-0030 D3)', () => {
  beforeEach(async () => {
    await setSettings({ admin_notify_emails: [EMAIL_A], discord_webhook_url: null });
  });

  it('T-ACT-32 the latest ok run for modrinth older than 6 h → one sync.stale (sync_source / syncSourceSubjectId / payload.source); a second tick within 6 h adds none; a fresh ok run stops it', async () => {
    await backdateRun(SEED_SYNC_RUNS.modrinth, 7);
    const first = await run();
    expect(first.stale).toBe(1);
    const events = await eventsOfKind('sync.stale');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.subject_type).toBe('sync_source');
    expect(event.subject_id).toBe(syncSourceSubjectId('modrinth'));
    expect(event.payload.source).toBe('modrinth');
    expect(typeof event.payload.last_ok_at).toBe('string');
    expect(Math.round(Number(event.payload.hours_since_ok))).toBe(7);
    // The stale event fans out in the same tick (sync.stale email ON / discord OFF by default).
    const rows = await recipientsFor(event.id);
    expect(rows.map((row) => [row.channel, row.status])).toEqual([
      ['discord', 'skipped'],
      ['email', 'pending'],
    ]);

    const second = await run();
    expect(second.stale).toBe(0);
    expect(await eventsOfKind('sync.stale')).toHaveLength(1);

    await makeSyncRun({
      source: 'modrinth',
      ok: true,
      items: 0,
      finished_at: new Date().toISOString(),
    });
    await deleteStaleEvents();
    const third = await run();
    expect(third.stale).toBe(0);
    expect(await eventsOfKind('sync.stale')).toHaveLength(0);
  });

  it('T-ACT-32 youtube likewise; sync.failed is never emitted here', async () => {
    await backdateRun(SEED_SYNC_RUNS.youtube, 9);
    const summary = await run();
    expect(summary.stale).toBe(1);
    const events = await eventsOfKind('sync.stale');
    expect(events).toHaveLength(1);
    expect(events[0]?.subject_id).toBe(syncSourceSubjectId('youtube'));
    expect(events[0]?.payload.source).toBe('youtube');
    expect(await eventsOfKind('sync.failed')).toHaveLength(0);
  });

  it('T-ACT-32 curseforge only with CURSEFORGE_API_KEY set and ≥ 1 curseforge link', async () => {
    await backdateRun(SEED_SYNC_RUNS.curseforge, 7);
    // Key set (.env.test) + the SEED-6 link → stale.
    expect((await run()).stale).toBe(1);
    expect((await eventsOfKind('sync.stale'))[0]?.payload.source).toBe('curseforge');

    // No key → never stale (even with the link).
    await deleteStaleEvents();
    const saved = env.CURSEFORGE_API_KEY;
    try {
      env.CURSEFORGE_API_KEY = undefined;
      expect((await run()).stale).toBe(0);
    } finally {
      env.CURSEFORGE_API_KEY = saved;
    }
    expect(await eventsOfKind('sync.stale')).toHaveLength(0);

    // Key set but no curseforge link → never stale (the snapshot restores SEED-6 afterwards).
    const unlink = await service
      .from('project_links')
      .delete()
      .eq('project_id', SEED_PROJECTS.pixelChameleon)
      .eq('platform', 'curseforge');
    expect(unlink.error).toBeNull();
    expect((await run()).stale).toBe(0);
    expect(await eventsOfKind('sync.stale')).toHaveLength(0);
  });

  it('T-ACT-32 mentions (condition false until S1.8), stats, notify and skins are never stale', async () => {
    const at = new Date(Date.now() - 9 * HOUR_MS).toISOString();
    for (const source of ['mentions', 'stats', 'notify', 'skins'] as const) {
      await makeSyncRun({ source, ok: true, items: 0, started_at: at, finished_at: at });
    }
    const summary = await run();
    expect(summary.stale).toBe(0);
    expect(await eventsOfKind('sync.stale')).toHaveLength(0);
  });

  it('T-ACT-32 a source with no sync_runs row at all is never stale (ADR-0030 D3)', async () => {
    const wipe = await service.from('sync_runs').delete().eq('source', 'youtube');
    expect(wipe.error).toBeNull();
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.stale).toBe(0);
    expect(await eventsOfKind('sync.stale')).toHaveLength(0);
  });

  it('T-ACT-32 a source whose only runs failed (no ok run ever) is stale with last_ok_at NULL', async () => {
    const wipe = await service.from('sync_runs').delete().eq('source', 'youtube');
    expect(wipe.error).toBeNull();
    await makeSyncRun({
      source: 'youtube',
      ok: false,
      items: 0,
      error: 't_ boom',
      finished_at: new Date().toISOString(),
    });
    const summary = await run();
    expect(summary.stale).toBe(1);
    const event = (await eventsOfKind('sync.stale'))[0];
    expect(event?.payload.source).toBe('youtube');
    expect(event?.payload.last_ok_at).toBeNull();
    expect(event?.payload.hours_since_ok).toBeNull();
  });

  it('T-ACT-32 a stale-check error is J-P: counted in errors[], the run stays ok and the rest fans out', async () => {
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    // The 1st sync_runs select is the runner's SC-13 lock check; the 2nd is F0's modrinth read.
    const summary = await withDbFault({ table: 'sync_runs', op: 'select' }, { nth: 2 }, () =>
      run(),
    );
    expect(summary.ok).toBe(true);
    expect((summary.errors as string[])[0]).toMatch(/^stale modrinth:/);
    expect((await recipientsFor(eventId)).length).toBe(2);
  });
});
