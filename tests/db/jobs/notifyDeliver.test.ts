/**
 * tests/db/jobs/notifyDeliver.test.ts — T-ACT-30 (deliver, 04 §3.7 N1–N4), T-ACT-31 (digest, N2),
 * T-ACT-72 (`not_configured`, N7) (05 §7.2 jobs layer; 01 INV-43 / INV-70; ADR-0030 D7; migration
 * 20260903120100; 00 S1.5.AC7 / AC8).
 *
 * Harness per 05 §7.2: rows are arranged with `makeNotificationEvent` + `makeRecipient` (the
 * `updated_at` backoff clock is set at insert — the `set_updated_at` trigger fires on UPDATE only,
 * so an explicit insert value stands); the adapters' `fetch` is `spyFetch`-routed to the fixture
 * server URLs (`RESEND_API_BASE` + `/emails`, `DISCORD_API_BASE` + `/webhooks/<id>/<token>` — the
 * Discord adapter rewrites `https://discord.com/api` to the base, ADR-0030 D6) and answers from
 * `tests/fixtures/{resend,discord}/*`; the local stack passes through. Adapter failures use a
 * non-retried 400 (SC-09) so no test waits for a backoff. Addresses are `*@localhost.test` (F-3).
 * Every test starts from an empty queue (`purgeNotificationEvents` in `afterEach`); the `notify`
 * `sync_runs` rows each own-row run writes are removed by the content snapshot in `afterAll` (H-1).
 * The DB-error arms (a failed status write, the N7 write, the hydrate read) and the tick-anchored
 * time budget (04 §5.8 — measured from the OWNER's `sync_runs.started_at` when nested, ADR-0030 D2)
 * are reproduced with `withDbFault` / an arranged open owner row — no constant is mocked here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { notifyDeliver } from '@/lib/jobs/notifyDeliver';
import type { JobSummary } from '@/lib/jobs/types';
import { backoffMs, DELIVER_BATCH, DISCORD_PER_TICK, MAX_ATTEMPTS } from '@/lib/notify/constants';
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
  makeNotificationEvent,
  makeRecipient,
  makeSyncRun,
  purgeNotificationEvents,
  type NotificationKind,
} from '@/tests/helpers/factories';
import { loadFixture } from '@/tests/helpers/fixtures';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';
import {
  spyFetch,
  spyLog,
  type FetchSpy,
  type FixtureMap,
  type LogSpy,
} from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const RESEND_BASE = process.env.RESEND_API_BASE ?? '';
const DISCORD_BASE = process.env.DISCORD_API_BASE ?? '';
if (RESEND_BASE === '' || DISCORD_BASE === '') {
  throw new Error('RESEND_API_BASE / DISCORD_API_BASE are not set — is .env.test loaded?');
}
const RESEND_URL = `${RESEND_BASE}/emails`;
const WEBHOOK_ID = '123';
const WEBHOOK_TOKEN = 't_delivertoken';
const WEBHOOK = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;
const WEBHOOK_ROUTE = `${DISCORD_BASE}/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;
const EMAIL_A = 'seed-admin@localhost.test';
const EMAIL_B = 'other-admin@localhost.test';
const MINUTE_MS = 60_000;

const sendOk = await loadFixture<{ id: string }>('resend', 'send-ok.json');
const webhookOk = await loadFixture<{ id: string }>('discord', 'webhook-ok.json');

type ResendBody = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  reply_to?: string;
};
type DiscordBody = {
  username: string;
  embeds: { title: string; description: string; url?: string; color: number }[];
};

type RecipientRow = {
  id: string;
  status: string;
  attempts: number;
  sent_at: string | null;
  error: string | null;
  updated_at: string;
};

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Routes both adapters to the fixtures and captures every request body. */
function routeBoth(): {
  spy: FetchSpy;
  emails: ResendBody[];
  posts: { url: string; body: DiscordBody }[];
} {
  const emails: ResendBody[] = [];
  const posts: { url: string; body: DiscordBody }[] = [];
  const routes: FixtureMap = {
    [RESEND_URL]: async (request) => {
      emails.push((await request.json()) as ResendBody);
      return json(sendOk);
    },
    [WEBHOOK_ROUTE]: async (request) => {
      posts.push({ url: request.url, body: (await request.json()) as DiscordBody });
      return json(webhookOk);
    },
  };
  return { spy: spyFetch(routes), emails, posts };
}

/** The 04 §1.2 comment payload the S1.4 actions store. */
function commentPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    comment_id: SEED_COMMENTS.published,
    target_type: 'project',
    target_id: SEED_PROJECTS.pixelChameleon,
    target_title: 'Pixel Chameleon',
    target_slug: 'pixel-chameleon',
    excerpt: 'this is a test comment',
    author: { profile_id: SEED_USERS.seed_user, handle: 'seed_user' },
    first_time: false,
    ...extra,
  };
}

async function pendingRow(
  channel: 'email' | 'discord',
  options: {
    kind?: NotificationKind;
    payload?: Record<string, unknown>;
    address?: string | null;
    attempts?: number;
    updatedAt?: string;
    status?: 'pending' | 'sent' | 'failed' | 'skipped';
  } = {},
): Promise<string> {
  const kind = options.kind ?? 'comment.new';
  const eventId = await makeNotificationEvent({
    kind,
    payload: (options.payload ?? commentPayload()) as never,
    actor_id: kind.startsWith('sync.') ? null : SEED_USERS.seed_user,
  });
  return makeRecipient({
    event_id: eventId,
    channel,
    address:
      options.address === undefined ? (channel === 'email' ? EMAIL_A : WEBHOOK) : options.address,
    status: options.status ?? 'pending',
    attempts: options.attempts ?? 0,
    ...(options.updatedAt !== undefined ? { updated_at: options.updatedAt } : {}),
  });
}

async function readRow(id: string): Promise<RecipientRow> {
  const { data, error } = await service
    .from('notification_recipients')
    .select('id, status, attempts, sent_at, error, updated_at')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function run(): Promise<JobSummary> {
  return notifyDeliver({ trigger: 'manual' });
}

let logs: LogSpy;
let activeSpy: FetchSpy | null = null;
let snapshot: ContentSnapshot;

beforeAll(async () => {
  snapshot = await snapshotContentTables();
  await purgeNotificationEvents();
});

beforeEach(() => {
  logs = spyLog();
});

afterEach(async () => {
  logs.restore();
  activeSpy?.restore();
  activeSpy = null;
  await cleanupFactories();
  await purgeNotificationEvents();
});

afterAll(async () => {
  await purgeNotificationEvents();
  // H-1: every own-row `notifyDeliver` call above wrote a `notify` sync_runs row — remove them.
  await restoreContentTables(snapshot);
});

describe('T-ACT-30 notifyDeliver (04 §3.7 N1–N4)', () => {
  it('T-ACT-30 pending email rows → sendEmail once per row with the matching template; sent / sent_at / attempts+1', async () => {
    const newId = await pendingRow('email', { kind: 'comment.new' });
    const heldId = await pendingRow('email', {
      kind: 'comment.held',
      payload: commentPayload({ first_time: true, reason: 'first_time' }),
    });
    const { spy, emails } = routeBoth();
    activeSpy = spy;

    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.source).toBe('notify');
    expect(summary.items).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.digests).toBe(0);
    expect(summary.skipped).toBe(0);

    expect(emails).toHaveLength(2);
    const subjects = emails.map((mail) => mail.subject).sort();
    expect(subjects).toEqual([
      'Held for review: Pixel Chameleon',
      'New comment on Pixel Chameleon',
    ]);
    for (const mail of emails) {
      expect(mail.to).toEqual([EMAIL_A]);
      expect(mail.from).toBe('odsens <allay@odsens.com>');
      expect(mail.html.length).toBeGreaterThan(0);
      expect(mail.text.length).toBeGreaterThan(0);
      expect(mail.reply_to).toBeUndefined();
      expect([newId, heldId]).toContain(mail.headers['X-Entity-Ref-ID']);
    }
    const newMail = emails.find((mail) => mail.subject.startsWith('New comment'));
    expect(newMail?.text).toContain('The allay picked this up on');
    expect(newMail?.text).toContain('http://localhost:3000/projects/pixel-chameleon#comments');
    const heldMail = emails.find((mail) => mail.subject.startsWith('Held'));
    expect(heldMail?.text).toContain('holding it until you decide');

    for (const id of [newId, heldId]) {
      const row = await readRow(id);
      expect(row.status).toBe('sent');
      expect(row.sent_at).not.toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.error).toBeNull();
    }

    // INV-43: no address, key or webhook in the log lines.
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain(EMAIL_A);
    expect(text).not.toContain('re_test');
    expect(text).not.toContain(WEBHOOK_TOKEN);
  });

  it('T-ACT-30 pending discord rows → postEmbed(address, …) with ?wait=true, username allay and the N6 shape', async () => {
    const id = await pendingRow('discord', {
      kind: 'comment.reported',
      payload: commentPayload({ report_count: 2, reason: 'spam' }),
    });
    const { spy, posts } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.items).toBe(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`${WEBHOOK_ROUTE}?wait=true`);
    const body = posts[0]!.body;
    expect(body.username).toBe('allay');
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0]?.title).toBe('Reported comment — Pixel Chameleon');
    // Untrusted text is Discord-markdown-escaped in the description (`_` would italicise).
    expect(body.embeds[0]?.description).toContain('@seed\\_user: "this is a test comment"');
    expect(body.embeds[0]?.description).toContain('2 reports · spam');
    expect(body.embeds[0]?.url).toBe('http://localhost:3000/admin/comments');
    expect(body.embeds[0]?.color).toBe(0xffc61f);
    expect(await readRow(id)).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('T-ACT-30 adapter failure → status stays pending, attempts+1, error set (≤ 500, no address/key)', async () => {
    const emailId = await pendingRow('email');
    const discordId = await pendingRow('discord');
    activeSpy = spyFetch({ [RESEND_URL]: 'status:400', [WEBHOOK_ROUTE]: 'status:400' });
    const summary = await run();
    expect(summary.ok).toBe(true); // per-row failures never fail the run
    expect(summary.items).toBe(0);
    expect(summary.failed).toBe(2);
    for (const id of [emailId, discordId]) {
      const row = await readRow(id);
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(1);
      expect(row.sent_at).toBeNull();
      expect(row.error).not.toBeNull();
      expect((row.error ?? '').length).toBeLessThanOrEqual(500);
      expect(row.error).not.toContain(EMAIL_A);
      expect(row.error).not.toContain('re_test');
      expect(row.error).not.toContain(WEBHOOK_TOKEN);
    }
    expect((await readRow(discordId)).error).toMatch(/^POST discord webhook …oken → 400/);
  });

  it.each([1, 2, 3, 4])(
    'T-ACT-30 backoff: attempts=%i is eligible only when updated_at <= now() - 5 min × 2^(a−1)',
    async (attempts) => {
      const backoff = backoffMs(attempts);
      const justInside = new Date(Date.now() - backoff + MINUTE_MS).toISOString();
      const pastDue = new Date(Date.now() - backoff - MINUTE_MS).toISOString();
      const waiting = await pendingRow('email', { attempts, updatedAt: justInside });
      const due = await pendingRow('email', { attempts, updatedAt: pastDue });
      const { spy, emails } = routeBoth();
      activeSpy = spy;
      const summary = await run();
      expect(summary.claimed).toBe(1);
      expect(summary.items).toBe(1);
      expect(emails).toHaveLength(1);
      expect(await readRow(due)).toMatchObject({ status: 'sent', attempts: attempts + 1 });
      const untouched = await readRow(waiting);
      expect(untouched.status).toBe('pending');
      expect(untouched.attempts).toBe(attempts);
      expect(new Date(untouched.updated_at).toISOString()).toBe(justInside);
    },
  );

  it('T-ACT-30 attempts=0 is eligible at once regardless of updated_at', async () => {
    const id = await pendingRow('email', { attempts: 0, updatedAt: new Date().toISOString() });
    const { spy } = routeBoth();
    activeSpy = spy;
    await run();
    expect((await readRow(id)).status).toBe('sent');
  });

  it("T-ACT-30 the 5th failed attempt → status 'failed', never retried", async () => {
    const id = await pendingRow('email', {
      attempts: MAX_ATTEMPTS - 1,
      updatedAt: new Date(Date.now() - 100 * MINUTE_MS).toISOString(),
    });
    activeSpy = spyFetch({ [RESEND_URL]: 'status:400' });
    const first = await run();
    expect(first.failed).toBe(1);
    const row = await readRow(id);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.error).not.toBeNull();

    // Even with the provider healthy, a failed row is never claimed again.
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const second = await run();
    expect(second.claimed).toBe(0);
    expect(emails).toHaveLength(0);
    expect((await readRow(id)).attempts).toBe(MAX_ATTEMPTS);
  });

  it('T-ACT-30 batch ≤ DELIVER_BATCH (100) per tick; the rest waits for the next tick', async () => {
    // 105 pending rows in one statement (the factories would take ~210 round trips).
    sql(
      `with ev as (
         insert into public.notification_events (kind, actor_id, subject_type, subject_id, payload)
         select 'comment.new', '${SEED_USERS.seed_user}', 'comment', '${SEED_COMMENTS.published}',
                jsonb_build_object('comment_id', '${SEED_COMMENTS.published}', 'target_type', 'project',
                  'target_id', '${SEED_PROJECTS.pixelChameleon}', 'target_title', 'Pixel Chameleon',
                  'target_slug', 'pixel-chameleon', 'excerpt', 'bulk ' || g,
                  'author', jsonb_build_object('profile_id', '${SEED_USERS.seed_user}', 'handle', 'seed_user'))
         from generate_series(1, ${String(DELIVER_BATCH + 5)}) g
         returning id)
       insert into public.notification_recipients (event_id, channel, address, status)
       select id, 'email', '${EMAIL_A}', 'pending' from ev`,
    );
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.claimed).toBe(DELIVER_BATCH);
    // 100 rows to one address → one digest (N2) — all 100 marked sent by one send.
    expect(summary.items).toBe(DELIVER_BATCH);
    expect(summary.digests).toBe(1);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toBe(`${String(DELIVER_BATCH)} things from the allay`);
    const { count } = await service
      .from('notification_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    expect(count).toBe(5);
  });

  it('T-ACT-30 discord rows are capped at DISCORD_PER_TICK (20) per tick; the rest is deferred', async () => {
    const ids: string[] = [];
    for (let i = 0; i < DISCORD_PER_TICK + 2; i += 1) ids.push(await pendingRow('discord'));
    const { spy, posts } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.claimed).toBe(DISCORD_PER_TICK + 2);
    expect(summary.deferred).toBe(2);
    expect(summary.items).toBe(DISCORD_PER_TICK);
    expect(summary.digests).toBe(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.embeds[0]?.title).toBe(
      `${String(DISCORD_PER_TICK)} things from the allay`,
    );
    const pending = (await Promise.all(ids.map(readRow))).filter((row) => row.status === 'pending');
    expect(pending).toHaveLength(2);
  });

  it('T-ACT-30 a comment event without target words is hydrated from projects_public before rendering', async () => {
    const hydrated = await pendingRow('email', {
      payload: {
        comment_id: SEED_COMMENTS.published,
        target_type: 'project',
        target_id: SEED_PROJECTS.metalPipeMace,
        excerpt: 'no words stored',
        author: { profile_id: SEED_USERS.seed_user, handle: 'seed_user' },
      },
    });
    const bare = await pendingRow('email', {
      payload: {
        comment_id: SEED_COMMENTS.published,
        author: { profile_id: null, handle: null },
      },
    });
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    await run();
    const byRef = new Map(emails.map((mail) => [mail.headers['X-Entity-Ref-ID'], mail]));
    expect(byRef.get(hydrated)?.subject).toBe('New comment on Metal Pipe Mace');
    expect(byRef.get(hydrated)?.text).toContain('/projects/metal-pipe-mace#comments');
    expect(byRef.get(bare)?.subject).toBe('New comment on odsens');
    expect(byRef.get(bare)?.text).toContain('from a deleted account');
    expect(byRef.get(bare)?.text).toContain('/admin/comments');
  });

  it('T-ACT-30 sync.failed / sync.stale rows render the SyncFailed mail (allay lines, source subject)', async () => {
    const failed = await pendingRow('email', {
      kind: 'sync.failed',
      payload: {
        source: 'modrinth',
        run_id: '00000000-0000-4000-8000-000000000801',
        error: 'list: GET … → 500',
        started_at: new Date().toISOString(),
      },
    });
    const stale = await pendingRow('email', {
      kind: 'sync.stale',
      payload: { source: 'curseforge', last_ok_at: null, hours_since_ok: null },
    });
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    await run();
    const byRef = new Map(emails.map((mail) => [mail.headers['X-Entity-Ref-ID'], mail]));
    expect(byRef.get(failed)?.subject).toBe('Sync failed: modrinth');
    expect(byRef.get(failed)?.text).toContain('came back empty-handed');
    expect(byRef.get(stale)?.subject).toBe('Sync stale: curseforge');
    // ADR-0030 D19: a source with no ok run reads "No good run yet." — never the word "never".
    expect(byRef.get(stale)?.text).toContain('No good run yet.');
    expect(byRef.get(stale)?.text).not.toContain('never');
    expect(byRef.get(stale)?.text).not.toContain('Last good run');
  });

  it('T-ACT-30 summary is {items: sent, failed, digests, skipped} (+ claimed, deferred, errors)', async () => {
    const { spy } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary).toMatchObject({
      ok: true,
      source: 'notify',
      items: 0,
      failed: 0,
      digests: 0,
      skipped: 0,
      claimed: 0,
      deferred: 0,
      errors: [],
    });
    expect(typeof summary.run_id).toBe('string');
    expect(typeof summary.ms).toBe('number');
  });

  it('T-ACT-30 a failed claim read → ok=false and the run row is finalized with the error', async () => {
    activeSpy = spyFetch({});
    const summary = await withDbFault({ table: 'notification_recipients', op: 'select' }, {}, () =>
      run(),
    );
    expect(summary.ok).toBe(false);
    expect(typeof summary.error).toBe('string');
    const { data } = await service
      .from('sync_runs')
      .select('ok, error')
      .eq('id', summary.run_id)
      .single();
    expect(data?.ok).toBe(false);
    expect(data?.error).not.toBeNull();
  });
});

describe('T-ACT-31 digest (04 N2, ADR-0030 D7)', () => {
  it('T-ACT-31 6 eligible email rows for one address → ONE sendEmail "6 things from the allay" listing kind + target + excerpt; all 6 sent', async () => {
    const ids: string[] = [];
    const kinds: NotificationKind[] = [
      'comment.new',
      'comment.held',
      'comment.reported',
      'comment.new',
      'comment.new',
      'comment.new',
    ];
    for (const [index, kind] of kinds.entries()) {
      ids.push(
        await pendingRow('email', {
          kind,
          payload: commentPayload({ excerpt: `digest item ${String(index + 1)}` }),
        }),
      );
    }
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.items).toBe(6);
    expect(summary.digests).toBe(1);
    expect(emails).toHaveLength(1);
    const mail = emails[0]!;
    expect(mail.subject).toBe('6 things from the allay');
    expect(mail.to).toEqual([EMAIL_A]);
    expect(mail.headers['X-Entity-Ref-ID']).toBe(ids[0]);
    expect(mail.text).toContain('New comment — Pixel Chameleon');
    expect(mail.text).toContain('Held for review — Pixel Chameleon');
    expect(mail.text).toContain('Reported comment — Pixel Chameleon'); // the 04 N6 event word, both channels
    for (let i = 1; i <= 6; i += 1) expect(mail.text).toContain(`digest item ${String(i)}`);
    expect(mail.text).toContain('http://localhost:3000/admin/comments');
    expect(mail.text).toContain('The allay emails you because digest mail is on.');
    for (const id of ids) expect((await readRow(id)).status).toBe('sent');
  });

  it('T-ACT-31 5 rows → 5 single messages (no digest)', async () => {
    for (let i = 0; i < 5; i += 1) await pendingRow('email');
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.items).toBe(5);
    expect(summary.digests).toBe(0);
    expect(emails).toHaveLength(5);
    for (const mail of emails) expect(mail.subject).toBe('New comment on Pixel Chameleon');
  });

  it('T-ACT-31 groups are per (channel, address): 6 to A digest, 2 to B single → 3 sends', async () => {
    for (let i = 0; i < 6; i += 1) await pendingRow('email', { address: EMAIL_A });
    for (let i = 0; i < 2; i += 1) await pendingRow('email', { address: EMAIL_B });
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.items).toBe(8);
    expect(summary.digests).toBe(1);
    expect(emails).toHaveLength(3);
    expect(emails.filter((mail) => mail.to[0] === EMAIL_A).map((mail) => mail.subject)).toEqual([
      '6 things from the allay',
    ]);
    expect(emails.filter((mail) => mail.to[0] === EMAIL_B)).toHaveLength(2);
  });

  it('T-ACT-31 6 discord rows → ONE embed "6 things from the allay"; a failing digest marks every row failed together', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await pendingRow('discord'));
    const { spy, posts } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.items).toBe(6);
    expect(summary.digests).toBe(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.embeds[0]?.title).toBe('6 things from the allay');
    expect(posts[0]?.body.embeds[0]?.description.split('\n')).toHaveLength(6);

    const more: string[] = [];
    for (let i = 0; i < 6; i += 1) more.push(await pendingRow('discord'));
    activeSpy = spyFetch({ [WEBHOOK_ROUTE]: 'status:400' });
    const failedRun = await run();
    expect(failedRun.items).toBe(0);
    expect(failedRun.failed).toBe(6);
    expect(failedRun.digests).toBe(0);
    for (const id of more)
      expect(await readRow(id)).toMatchObject({ status: 'pending', attempts: 1 });
  });
});

describe('T-ACT-72 not_configured (04 N7)', () => {
  it("T-ACT-72 RESEND_API_KEY unset → email rows 'failed' + error 'not_configured' at once, attempts untouched, never retried; discord rows unaffected", async () => {
    const emailId = await pendingRow('email');
    const discordId = await pendingRow('discord');
    const { spy, emails, posts } = routeBoth();
    activeSpy = spy;
    const saved = env.RESEND_API_KEY;
    try {
      env.RESEND_API_KEY = undefined;
      const summary = await run();
      expect(summary.skipped).toBe(1);
      expect(summary.items).toBe(1);
      expect(emails).toHaveLength(0);
      expect(posts).toHaveLength(1);
      const row = await readRow(emailId);
      expect(row.status).toBe('failed');
      expect(row.error).toBe('not_configured');
      expect(row.attempts).toBe(0);
      expect((await readRow(discordId)).status).toBe('sent');

      // A later tick (still no key, then with the key back) never touches the row again.
      expect((await run()).claimed).toBe(0);
    } finally {
      env.RESEND_API_KEY = saved;
    }
    const later = await run();
    expect(later.claimed).toBe(0);
    expect(emails).toHaveLength(0);
    expect((await readRow(emailId)).attempts).toBe(0);
  });

  it("T-ACT-72 a discord row with an empty address → 'failed' + 'not_configured', no request", async () => {
    const id = await pendingRow('discord', { address: '' });
    const { spy, posts } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.skipped).toBe(1);
    expect(posts).toHaveLength(0);
    expect(await readRow(id)).toMatchObject({
      status: 'failed',
      error: 'not_configured',
      attempts: 0,
    });
  });

  it("T-ACT-72 a pending email row with a NULL address → 'failed' + 'not_configured'", async () => {
    const id = await pendingRow('email', { address: null });
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    await run();
    expect(emails).toHaveLength(0);
    expect(await readRow(id)).toMatchObject({ status: 'failed', error: 'not_configured' });
  });
});

describe('T-ACT-30 status writes and DB-error arms (04 N4 / Summary — a status write fails the run)', () => {
  it('T-ACT-30 a failed status write mid-digest → the other rows are still marked, the run is ok=false and names the write', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await pendingRow('email'));
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await withDbFault({ table: 'notification_recipients', op: 'update' }, {}, () =>
      run(),
    );
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/notification_recipients update failed/);
    expect(emails).toHaveLength(1); // one digest send happened
    expect(summary.items).toBe(5); // five of six marks landed
    const rows = await Promise.all(ids.map(readRow));
    expect(rows.filter((row) => row.status === 'sent')).toHaveLength(5);
    const unmarked = rows.filter((row) => row.status === 'pending');
    expect(unmarked).toHaveLength(1); // the at-least-once window: one row, re-sent next tick
    expect(unmarked[0]?.attempts).toBe(0);
    const { data } = await service
      .from('sync_runs')
      .select('ok, error')
      .eq('id', summary.run_id)
      .single();
    expect(data?.ok).toBe(false);
    expect(data?.error).toMatch(/notification_recipients update failed/);
  });

  it('T-ACT-30 every status write failing → ok=false, no row marked, one digest send', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await pendingRow('email'));
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await withDbFault(
      { table: 'notification_recipients', op: 'update' },
      { nth: 'all' },
      () => run(),
    );
    expect(summary.ok).toBe(false);
    expect(summary.items).toBe(0);
    expect(emails).toHaveLength(1);
    for (const id of ids)
      expect(await readRow(id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('T-ACT-30 a failed status write after a single send → ok=false and no later unit is sent', async () => {
    const first = await pendingRow('email');
    const second = await pendingRow('email', { address: EMAIL_B });
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await withDbFault({ table: 'notification_recipients', op: 'update' }, {}, () =>
      run(),
    );
    expect(summary.ok).toBe(false);
    expect(summary.items).toBe(0);
    expect(emails).toHaveLength(1); // the first unit was sent (and could not be marked) — the second never was
    expect(emails[0]?.to).toEqual([EMAIL_A]);
    expect(await readRow(first)).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await readRow(second)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('T-ACT-72 the N7 write (not_configured) failing → ok=false before any send', async () => {
    const bare = await pendingRow('email', { address: null });
    const discordId = await pendingRow('discord');
    const { spy, posts } = routeBoth();
    activeSpy = spy;
    const summary = await withDbFault({ table: 'notification_recipients', op: 'update' }, {}, () =>
      run(),
    );
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/notification_recipients update failed/);
    expect(posts).toHaveLength(0);
    expect(await readRow(bare)).toMatchObject({ status: 'pending', error: null });
    expect(await readRow(discordId)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('T-ACT-30 a failed projects_public hydrate read → ok=false, nothing sent', async () => {
    const id = await pendingRow('email', {
      payload: {
        comment_id: SEED_COMMENTS.published,
        target_type: 'project',
        target_id: SEED_PROJECTS.metalPipeMace,
        excerpt: 'no words stored',
        author: { profile_id: SEED_USERS.seed_user, handle: 'seed_user' },
      },
    });
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await withDbFault({ table: 'projects_public', op: 'select' }, {}, () => run());
    expect(summary.ok).toBe(false);
    expect(summary.error).toMatch(/projects_public read failed/);
    expect(emails).toHaveLength(0);
    expect(await readRow(id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('T-ACT-30 a pending row of a channel with no deliverer (inapp, Phase 2) is never claimed or touched', async () => {
    const eventId = await makeNotificationEvent({ kind: 'comment.new' });
    const inapp = await makeRecipient({ event_id: eventId, channel: 'inapp', address: null });
    const email = await makeRecipient({ event_id: eventId, channel: 'email', address: EMAIL_A });
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const summary = await run();
    expect(summary.ok).toBe(true);
    expect(summary.claimed).toBe(1);
    expect(summary.items).toBe(1);
    expect(emails).toHaveLength(1);
    expect(await readRow(email)).toMatchObject({ status: 'sent' });
    expect(await readRow(inapp)).toMatchObject({ status: 'pending', attempts: 0, error: null });
  });
});

describe('T-ACT-30 time budget is anchored to the owning tick (04 §5.8 DELIVER_TIME_BUDGET_MS, ADR-0030 D2)', () => {
  it('T-ACT-30 nested under an owner row that started 2 min ago → every unit is deferred before any send', async () => {
    const owner = await makeSyncRun({
      source: 'notify',
      started_at: new Date(Date.now() - 2 * MINUTE_MS).toISOString(),
      finished_at: null,
    });
    const emailId = await pendingRow('email');
    const discordId = await pendingRow('discord');
    const { spy, emails, posts } = routeBoth();
    activeSpy = spy;
    const summary = await notifyDeliver({ trigger: 'cron', runId: owner });
    expect(summary.ok).toBe(true);
    expect(summary.run_id).toBe(owner);
    expect(summary.claimed).toBe(2);
    expect(summary.deferred).toBe(2);
    expect(summary.items).toBe(0);
    expect(emails).toHaveLength(0);
    expect(posts).toHaveLength(0);
    for (const id of [emailId, discordId]) {
      expect(await readRow(id)).toMatchObject({ status: 'pending', attempts: 0, error: null });
    }
  });

  it("T-ACT-30 nested under a fresh owner row → delivered; an unreadable owner row falls back to this run's clock", async () => {
    const owner = await makeSyncRun({
      source: 'notify',
      started_at: new Date().toISOString(),
      finished_at: null,
    });
    const fresh = await pendingRow('email');
    const { spy, emails } = routeBoth();
    activeSpy = spy;
    const delivered = await notifyDeliver({ trigger: 'cron', runId: owner });
    expect(delivered.ok).toBe(true);
    expect(delivered.items).toBe(1);
    expect(emails).toHaveLength(1);
    expect(await readRow(fresh)).toMatchObject({ status: 'sent' });

    // Nested runs skip the SC-13 lock check, so the 1st sync_runs select is the owner's started_at read.
    const again = await pendingRow('email');
    const fallback = await withDbFault({ table: 'sync_runs', op: 'select' }, {}, () =>
      notifyDeliver({ trigger: 'cron', runId: owner }),
    );
    expect(fallback.ok).toBe(true); // the budget clock is best effort — never a run failure
    expect(fallback.items).toBe(1);
    expect(emails).toHaveLength(2);
    expect(await readRow(again)).toMatchObject({ status: 'sent' });
  });
});
