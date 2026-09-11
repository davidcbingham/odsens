/**
 * tests/db/actions/testDiscordWebhook.test.ts — T-ACT-28 (+ T-ACT-69 SC-24 audit line) (05 §7.2;
 * 04 §1.3 `testDiscordWebhook`, §4.6 `postEmbed`, §5.5 `discord_test` 10 / min; 01 INV-43;
 * ADR-0002 C2 / C7 / #73; ADR-0030 D5 / D6 / D8 / D9; DESIGN.md §12.1 "✔ Sent a test." /
 * "✕ Discord said no: <status>").
 *
 * `requireRole('admin')` → URL from the input (regex-checked by the schema) else the stored
 * `site_settings.discord_webhook_url`, neither → `validation` with no hit and no request →
 * `assertRateLimit('discord_test', profile_id)` → `createDiscord({env}).postEmbed(url, {title:'Test
 * — odsens', description:'The allay says hi.', color: INDIGO})` → `{status}`; an `AdapterError` →
 * `upstream_error` "Discord said no: <status>". Nothing is stored; the URL never reaches a log line
 * or the response.
 *
 * Harness: the adapter rewrites `https://discord.com/api/…` to `DISCORD_API_BASE` (.env.test →
 * the :4010 fixture-server origin, ADR-0002 #73) and `spyFetch` answers those URLs from
 * `tests/fixtures/discord/*` — never a socket (H-5). `mutatesSeed`: the stored URL is arranged
 * through the service client and restored (`restoreSeedSettings`) after every test; the
 * `discord_test` hits of the seed admin are cleared in `afterEach`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDiscordWebhook } from '@/lib/actions/settings';
import type { TestDiscordWebhookInput } from '@/lib/actions/settings.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { restoreSeedSettings } from '@/tests/helpers/contentReset';
import { expectInternal, withDbFault } from '@/tests/helpers/dbFault';
import { FIXTURE_ROOT } from '@/tests/helpers/fixtures';
import {
  spyFetch,
  spyLog,
  spyRevalidateTag,
  type FetchSpy,
  type LogSpy,
} from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const BASE = process.env.DISCORD_API_BASE ?? '';
if (BASE === '') throw new Error('DISCORD_API_BASE is not set — is .env.test loaded?');

const WEBHOOK = 'https://discord.com/api/webhooks/123/t_testtoken';
const TOKEN = 't_testtoken';
const ROUTE = `${BASE}/webhooks/123/${TOKEN}`;
const STORED = 'https://discordapp.com/api/webhooks/456/t_storedtoken';
const STORED_TOKEN = 't_storedtoken';
const STORED_ROUTE = `${BASE}/webhooks/456/${STORED_TOKEN}`;

const RATE_LIMIT_MAX = 10;

const okBody = readFileSync(path.join(FIXTURE_ROOT, 'discord', 'webhook-ok.json'), 'utf8');
const rateLimitedBody = readFileSync(path.join(FIXTURE_ROOT, 'discord', '429.json'), 'utf8');

const json = (body: string, status: number): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

let logs: LogSpy;
let fetchSpy: FetchSpy | null = null;

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

/** 01 INV-43: no log line ever carries the webhook URL or its token. */
function expectNoSecretInLogs(): void {
  const text = JSON.stringify(logs.lines);
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(STORED_TOKEN);
  expect(text).not.toContain('/api/webhooks/');
}

async function setStoredWebhook(url: string | null): Promise<void> {
  const { error } = await service
    .from('site_settings')
    .update({ discord_webhook_url: url })
    .eq('id', 1);
  if (error) throw new Error(`service could not patch site_settings: ${error.message}`);
}

async function hits(): Promise<number> {
  return countRateLimitHits('discord_test', SEED_ROLE_IDS.admin);
}

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(async () => {
  fetchSpy?.restore();
  fetchSpy = null;
  logs.restore();
  await clearRateLimitHits('discord_test', SEED_ROLE_IDS.admin);
  await restoreSeedSettings();
});

afterAll(async () => {
  await restoreSeedSettings();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-28 admin only — anon D unauthenticated · user / banned / mod D forbidden; no request, no hit
// ---------------------------------------------------------------------------------------------
describe('T-ACT-28 testDiscordWebhook auth', () => {
  it('T-ACT-28 anon → unauthenticated, no request', async () => {
    fetchSpy = spyFetch({ [ROUTE]: json(okBody, 200) });
    expectFail(
      await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'anon' }),
      'unauthenticated',
    );
    expect(fetchSpy.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it.each(['user', 'banned', 'mod'] as const)(
    'T-ACT-28 %s → forbidden, no request, no hit, no audit line',
    async (role) => {
      fetchSpy = spyFetch({ [ROUTE]: json(okBody, 200) });
      const error = expectFail(
        await callAction(testDiscordWebhook, { url: WEBHOOK }, { role }),
        'forbidden',
      );
      expect(error.message).toBe('Not allowed.');
      expect(fetchSpy.calls).toEqual([]);
      expect(await countRateLimitHits('discord_test', SEED_ROLE_IDS[role])).toBe(0);
      expect(adminLines()).toEqual([]);
      expectNoSecretInLogs();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-28 the post — 200 / 204 → ok {status}; the embed shape; the URL never logged or returned
// ---------------------------------------------------------------------------------------------
describe('T-ACT-28 testDiscordWebhook posts the test embed', () => {
  it('T-ACT-28 200 (webhook-ok.json) → {ok:true, data:{status:200}}; POST ?wait=true as allay with the 04 §1.3 embed; one hit; SC-24 keys only', async () => {
    let received: { method: string; url: string; body: unknown } | null = null;
    fetchSpy = spyFetch({
      [ROUTE]: async (req) => {
        received = { method: req.method, url: req.url, body: await req.json() };
        return json(okBody, 200);
      },
    });

    const res = await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' });
    expect(expectOk(res)).toEqual({ status: 200 });

    expect(fetchSpy.calls).toEqual([`${ROUTE}?wait=true`]);
    expect(received).not.toBeNull();
    const call = received as unknown as { method: string; url: string; body: unknown };
    expect(call.method).toBe('POST');
    expect(call.url).toBe(`${ROUTE}?wait=true`);
    const body = call.body as {
      username: string;
      avatar_url?: unknown;
      embeds: { title: string; description: string; color: number; url?: unknown }[];
    };
    expect(body.username).toBe('allay');
    expect('avatar_url' in body).toBe(false);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0]?.title).toBe('Test — odsens');
    expect(body.embeds[0]?.description).toBe('The allay says hi.');
    expect(body.embeds[0]?.color).toBe(4933078); // 0x4B45D6 indigo (04 N6)
    expect(body.embeds[0]?.url).toBeUndefined();

    // Nothing stored, nothing revalidated, one hit.
    const { data: row } = await service
      .from('site_settings')
      .select('discord_webhook_url')
      .eq('id', 1)
      .single();
    expect(row?.discord_webhook_url).toBeNull();
    expect(tags.calls).toEqual([]);
    expect(await hits()).toBe(1);

    // SC-24 (T-ACT-69): keys only — the URL is in `fields` as a key name, never as a value.
    const lines = adminLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
    expect(line.action).toBe('testDiscordWebhook');
    expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(line.meta).toEqual({
      actor_profile_id: SEED_ROLE_IDS.admin,
      target_type: 'site_settings',
      target_id: null,
      fields: ['url'],
    });
    expectNoSecretInLogs();
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });

  it('T-ACT-28 204 (no body) → {ok:true, data:{status:204}}', async () => {
    fetchSpy = spyFetch({ [ROUTE]: () => new Response(null, { status: 204 }) });
    expect(
      expectOk(await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' })),
    ).toEqual({ status: 204 });
    expect(fetchSpy.calls).toHaveLength(1);
    expectNoSecretInLogs();
  });

  it('T-ACT-28 no url → the stored site_settings.discord_webhook_url is posted to', async () => {
    await setStoredWebhook(STORED);
    fetchSpy = spyFetch({ [STORED_ROUTE]: json(okBody, 200), [ROUTE]: json(okBody, 200) });
    const res = await callAction(testDiscordWebhook, {}, { role: 'admin' });
    expect(expectOk(res)).toEqual({ status: 200 });
    expect(fetchSpy.calls).toEqual([`${STORED_ROUTE}?wait=true`]);
    const line = adminLines()[0] as { meta: { fields: string[] } };
    expect(line.meta.fields).toEqual([]);
    expectNoSecretInLogs();
    expect(JSON.stringify(res)).not.toContain(STORED_TOKEN);
  });

  it('T-ACT-28 a url in the input wins over the stored one', async () => {
    await setStoredWebhook(STORED);
    fetchSpy = spyFetch({ [STORED_ROUTE]: json(okBody, 200), [ROUTE]: json(okBody, 200) });
    expectOk(await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' }));
    expect(fetchSpy.calls).toEqual([`${ROUTE}?wait=true`]);
    // The stored value is untouched (nothing is stored by the Test button).
    const { data: row } = await service
      .from('site_settings')
      .select('discord_webhook_url')
      .eq('id', 1)
      .single();
    expect(row?.discord_webhook_url).toBe(STORED);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-28 failures — 401 / 404 → upstream_error; 429 → one retry honouring retry_after
// ---------------------------------------------------------------------------------------------
describe('T-ACT-28 testDiscordWebhook failures', () => {
  it.each([401, 404])(
    'T-ACT-28 %s → upstream_error "Discord said no: <status>", exactly one request (no 4xx retry), hit recorded, no audit line',
    async (status) => {
      fetchSpy = spyFetch({ [ROUTE]: `status:${status}` });
      const res = await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' });
      const error = expectFail(res, 'upstream_error');
      expect(error.message).toBe(`Discord said no: ${status}`);
      expect(fetchSpy.calls).toHaveLength(1);
      expect(await hits()).toBe(1);
      expect(adminLines()).toEqual([]);
      expectNoSecretInLogs();
      expect(JSON.stringify(res)).not.toContain(TOKEN);
    },
  );

  it('T-ACT-28 429 then 200 → one retry after retry_after (250 ms per 04 §4.6) → ok', async () => {
    let calls = 0;
    fetchSpy = spyFetch({
      [ROUTE]: () => {
        calls += 1;
        return calls === 1 ? json(rateLimitedBody, 429) : json(okBody, 200);
      },
    });
    const started = Date.now();
    expect(
      expectOk(await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' })),
    ).toEqual({ status: 200 });
    expect(fetchSpy.calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    expectNoSecretInLogs();
  });

  it('T-ACT-28 429 twice → upstream_error "Discord said no: 429" after exactly one retry', async () => {
    fetchSpy = spyFetch({ [ROUTE]: () => json(rateLimitedBody, 429) });
    const error = expectFail(
      await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' }),
      'upstream_error',
    );
    expect(error.message).toBe('Discord said no: 429');
    expect(fetchSpy.calls).toHaveLength(2);
    expectNoSecretInLogs();
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-28 validation — regex fail / nothing to test → validation, no request, no hit
// ---------------------------------------------------------------------------------------------
describe('T-ACT-28 testDiscordWebhook validation', () => {
  it.each<{ name: string; url: unknown }>([
    { name: 'http://', url: 'http://discord.com/api/webhooks/123/abc' },
    { name: 'another host', url: 'https://example.com/api/webhooks/123/abc' },
    { name: 'trailing whitespace', url: `${WEBHOOK} ` },
    { name: "'' (the Test button never sends an empty string)", url: '' },
    { name: 'a non-string', url: 123 },
  ])('T-ACT-28 url $name → validation without a network call or a hit', async ({ url }) => {
    fetchSpy = spyFetch({ [ROUTE]: json(okBody, 200) });
    const error = expectFail(
      await callAction(testDiscordWebhook, { url } as TestDiscordWebhookInput, { role: 'admin' }),
      'validation',
    );
    expect(error.message).toBe(VALIDATION_MESSAGE);
    expect(error.issues?.[0]?.path).toBe('url');
    expect(error.issues?.[0]?.message).toBe("That doesn't look like a Discord webhook URL.");
    expect(fetchSpy.calls).toEqual([]);
    expect(await hits()).toBe(0);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-28 no url and none stored → validation (path url), no request, no hit', async () => {
    await setStoredWebhook(null);
    fetchSpy = spyFetch({ [ROUTE]: json(okBody, 200) });
    const error = expectFail(
      await callAction(testDiscordWebhook, {}, { role: 'admin' }),
      'validation',
    );
    expect(error.message).toBe('Add a webhook URL first.');
    expect(error.field).toBe('url');
    expect(error.issues).toEqual([{ path: 'url', message: 'Add a webhook URL first.' }]);
    expect(fetchSpy.calls).toEqual([]);
    expect(await hits()).toBe(0);
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-28 rate limit — 10 / min per admin (04 §5.5 `discord_test`); the 11th → rate_limited
// ---------------------------------------------------------------------------------------------
describe('T-ACT-28 testDiscordWebhook rate limit', () => {
  it('T-ACT-28 the 11th call in a minute → rate_limited, no request for it, 11 hits recorded', async () => {
    fetchSpy = spyFetch({ [ROUTE]: () => json(okBody, 200) });
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expectOk(await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' }));
    }
    expect(fetchSpy.calls).toHaveLength(RATE_LIMIT_MAX);

    const error = expectFail(
      await callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' }),
      'rate_limited',
    );
    expect(error.message).toBe(RATE_LIMITED_MESSAGE);
    expect(fetchSpy.calls).toHaveLength(RATE_LIMIT_MAX);
    expect(await hits()).toBe(RATE_LIMIT_MAX + 1);
    expect(adminLines()).toHaveLength(RATE_LIMIT_MAX);
    expectNoSecretInLogs();
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-0 (1) — the limiter's RPC fails → internal + one log.error line; no request
// ---------------------------------------------------------------------------------------------
describe('T-ACT-0 testDiscordWebhook faults', () => {
  it('T-ACT-0 rate_limit_ok fails → internal, no request, no audit line', async () => {
    fetchSpy = spyFetch({ [ROUTE]: json(okBody, 200) });
    const res = await withDbFault({ rpc: 'rate_limit_ok' }, {}, () =>
      callAction(testDiscordWebhook, { url: WEBHOOK }, { role: 'admin' }),
    );
    expectInternal(res, 'testDiscordWebhook', logs);
    expect(fetchSpy.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
    expectNoSecretInLogs();
  });
});
