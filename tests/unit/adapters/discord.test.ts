/**
 * tests/unit/adapters/discord.test.ts — `lib/adapters/discord.ts` (05 T-ADP-18 + the discord half of
 * T-ADP-20; 04 §4.6 export list, §1.3 webhook regex, §3.7 N6 colours, SC-09/SC-10/SC-25; ADR-0030 D6/D9).
 * Fixtures: `tests/fixtures/discord/{webhook-ok,429}.json` (F-5; hand-made minimal shapes). Pure over
 * `mockFetch` (05 H-5); the `retry_after` / SC-09 waits via fake timers. The webhook URL is the
 * secret: every error path is checked for its absence, and the adapter must log nothing itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdapterError } from '@/lib/adapters/http';
import {
  DISCORD_COLORS,
  DISCORD_USERNAME,
  createDiscord,
  discordWebhookUrlPattern,
  maskWebhookUrl,
  rewriteDiscordBase,
  type DiscordEmbedInput,
} from '@/lib/adapters/discord';
import { loadFixture, loadFixtureText } from '../../helpers/fixtures';
import { mockFetch } from '../../helpers/mockFetch';

const UA = 'odsens.com/test (localhost)';
const ENV = { MODRINTH_USER_AGENT: UA };
const TOKEN = 'abcdefghij-token_XYZ';
const WEBHOOK = `https://discord.com/api/webhooks/123/${TOKEN}`;
const POST_URL = `${WEBHOOK}?wait=true`;

const okFixture = await loadFixture<{ id: string; channel_id: string }>(
  'discord',
  'webhook-ok.json',
);
const rateLimitedBody = await loadFixtureText('discord', '429.json');

/** A deliverer-shaped embed (04 N6): '<Event> — <target title>', excerpt, link, colour. */
const EMBED: DiscordEmbedInput = {
  title: 'New comment — Metal Pipe Mace',
  description: '@creeperfan9: "this mace is cracked"',
  url: 'http://localhost:3000/projects/metal-pipe-mace#comments',
  color: DISCORD_COLORS.indigo,
};

type SentBody = {
  username: string;
  avatar_url?: string;
  embeds: {
    title: string;
    description: string;
    url?: string;
    color: number;
    timestamp: string;
    fields?: unknown;
  }[];
};

/** Routes the webhook POST to `respond`, capturing the request for assertions. */
function capture(
  respond: (attempt: number) => Response = () => Response.json(okFixture),
  route: string = WEBHOOK,
) {
  const seen: {
    urls: string[];
    body?: SentBody;
    headers?: Record<string, string>;
    method?: string;
  } = { urls: [] };
  const fetchSpy = vi.fn(
    mockFetch({
      [route]: async (request) => {
        seen.urls.push(request.url);
        seen.method = request.method;
        seen.headers = Object.fromEntries(request.headers);
        seen.body = JSON.parse(await request.text()) as SentBody;
        return respond(seen.urls.length);
      },
    }),
  );
  return { fetchSpy, seen };
}

/** Every string an error could leak: the URL, its rewritten form, the bare token. */
function expectNoSecret(text: string): void {
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain('webhooks/123');
  expect(text).not.toContain('discord.com/api');
}

function settle(promise: Promise<unknown>): Promise<AdapterError | null> {
  return promise.then(
    () => null,
    (thrown: unknown) => thrown as AdapterError,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T-ADP-18 discord postEmbed (04 §4.6)', () => {
  it('T-ADP-18 POST <url>?wait=true with {username:"allay", embeds:[{title, description, url, color, timestamp}]}, no avatar_url → {status: 200}', async () => {
    const { fetchSpy, seen } = capture();
    const discord = createDiscord({ fetch: fetchSpy, env: ENV });
    const result = await discord.postEmbed(WEBHOOK, EMBED);
    expect(result).toEqual({ status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(seen.urls).toEqual([POST_URL]);
    expect(seen.method).toBe('POST');
    expect(seen.headers?.['content-type']).toBe('application/json');
    expect(seen.headers?.accept).toBe('application/json');
    expect(seen.headers?.['user-agent']).toBe(UA); // SC-10
    expect(seen.body?.username).toBe(DISCORD_USERNAME);
    expect(seen.body?.username).toBe('allay');
    expect(seen.body).not.toHaveProperty('avatar_url'); // omitted until the asset exists (Q44)
    expect(seen.body?.embeds).toHaveLength(1);
    const embed = seen.body?.embeds[0];
    expect(embed).toMatchObject({
      title: EMBED.title,
      description: EMBED.description,
      url: EMBED.url,
      color: 4933078,
    });
    expect(typeof embed?.color).toBe('number');
    expect(embed?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // SC-14 UTC ISO
    expect(embed).not.toHaveProperty('fields');
    expect(Object.keys(embed ?? {}).sort()).toEqual(
      ['color', 'description', 'timestamp', 'title', 'url'].sort(),
    );
  });

  it('T-ADP-18 a 204 (empty body) resolves to {status: 204}', async () => {
    const { fetchSpy } = capture(() => new Response(null, { status: 204 }));
    await expect(
      createDiscord({ fetch: fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED),
    ).resolves.toEqual({ status: 204 });
  });

  it('T-ADP-18 DISCORD_COLORS are the 04 N6 integers (indigo 4933078 · gold 16762399 · alert 13384234) and travel as numbers', async () => {
    expect(DISCORD_COLORS).toEqual({ indigo: 4933078, gold: 16762399, alert: 13384234 });
    expect(DISCORD_COLORS.indigo).toBe(0x4b45d6);
    expect(DISCORD_COLORS.gold).toBe(0xffc61f);
    expect(DISCORD_COLORS.alert).toBe(0xcc3a2a);
    for (const color of [DISCORD_COLORS.gold, DISCORD_COLORS.alert]) {
      const { fetchSpy, seen } = capture();
      await createDiscord({ fetch: fetchSpy, env: ENV }).postEmbed(WEBHOOK, { ...EMBED, color });
      expect(seen.body?.embeds[0]?.color).toBe(color);
    }
  });

  it('T-ADP-18 optional url is omitted and fields pass through when given', async () => {
    const { fetchSpy, seen } = capture();
    await createDiscord({ fetch: fetchSpy, env: ENV }).postEmbed(WEBHOOK, {
      title: 'Sync failed — modrinth',
      description: 'The allay came back empty-handed. It’ll keep trying.',
      color: DISCORD_COLORS.alert,
      fields: [{ name: 'Cause', value: 'GET … → 500', inline: false }],
    });
    const embed = seen.body?.embeds[0];
    expect(embed).not.toHaveProperty('url');
    expect(embed?.fields).toEqual([{ name: 'Cause', value: 'GET … → 500', inline: false }]);
  });

  it('T-ADP-18 discord/429.json → waits retry_after (250 ms) then retries ONCE → {status}', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const t0 = Date.now();
    const { fetchSpy } = capture((attempt) => {
      times.push(Date.now() - t0);
      return attempt === 1
        ? new Response(rateLimitedBody, { status: 429 })
        : Response.json(okFixture);
    });
    const promise = createDiscord({ fetch: fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED);
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ status: 200 });
    expect(times).toEqual([0, 250]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('T-ADP-18 a second 429 throws http_error 429 after exactly two calls, URL masked as …<last 4>', async () => {
    vi.useFakeTimers();
    const { fetchSpy } = capture(() => new Response(rateLimitedBody, { status: 429 }));
    const settled = settle(createDiscord({ fetch: fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED));
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(error).toBeInstanceOf(AdapterError);
    expect(error?.status).toBe(429);
    expect(error?.code).toBe('http_error');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(error?.message).toBe('POST discord webhook …_XYZ → 429');
    expectNoSecret(error?.message ?? '');
    expectNoSecret(error?.body ?? '');
    expectNoSecret(String(error));
  });

  it('T-ADP-18 a 429 without retry_after honours Retry-After (seconds); neither → 1 s', async () => {
    vi.useFakeTimers();
    const header: number[] = [];
    let t0 = Date.now();
    const viaHeader = capture((attempt) => {
      header.push(Date.now() - t0);
      return attempt === 1
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
        : Response.json(okFixture);
    });
    const first = createDiscord({ fetch: viaHeader.fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED);
    await vi.runAllTimersAsync();
    await first;
    expect(header).toEqual([0, 2000]);

    const bare: number[] = [];
    t0 = Date.now();
    const noHint = capture((attempt) => {
      bare.push(Date.now() - t0);
      return attempt === 1
        ? new Response('rate limited', { status: 429 })
        : Response.json(okFixture);
    });
    const second = createDiscord({ fetch: noHint.fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED);
    await vi.runAllTimersAsync();
    await second;
    expect(bare).toEqual([0, 1000]);
  });

  it('T-ADP-18 other 4xx (404 — unknown webhook) → http_error 404, one call, URL absent', async () => {
    const { fetchSpy } = capture(
      () => new Response('{"message":"Unknown Webhook","code":10015}', { status: 404 }),
    );
    const error = await settle(
      createDiscord({ fetch: fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED),
    );
    expect(error?.status).toBe(404);
    expect(error?.code).toBe('http_error');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(error?.message).toBe('POST discord webhook …_XYZ → 404');
    expect(error?.body).toContain('Unknown Webhook');
    expectNoSecret(error?.message ?? '');
    expectNoSecret(error?.body ?? '');
  });

  it('T-ADP-18 5xx → SC-09 retries (1 s → 2 s → 4 s) then http_error with the URL masked', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const t0 = Date.now();
    const { fetchSpy } = capture(() => {
      times.push(Date.now() - t0);
      return new Response('upstream down', { status: 502 });
    });
    const settled = settle(createDiscord({ fetch: fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED));
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(times).toEqual([0, 1000, 3000, 7000]);
    expect(error?.status).toBe(502);
    expect(error?.code).toBe('http_error');
    expectNoSecret(error?.message ?? '');
  });

  it('T-ADP-18 a network error that names the URL is scrubbed from the thrown error', async () => {
    vi.useFakeTimers();
    const impl = (async (input: RequestInfo | URL) => {
      throw new TypeError(`fetch failed for ${String(input)}`);
    }) as typeof fetch;
    const settled = settle(createDiscord({ fetch: impl, env: ENV }).postEmbed(WEBHOOK, EMBED));
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(error).toBeInstanceOf(AdapterError);
    expect(error?.code).toBe('network_error');
    expect(error?.status).toBe(0);
    expect(error?.message).toContain('…_XYZ');
    expectNoSecret(error?.message ?? '');
    expectNoSecret(error?.body ?? '');
  });

  it('T-ADP-18 the adapter logs nothing itself — no console output on success or failure', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = capture();
    await createDiscord({ fetch: ok.fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED);
    const bad = capture(() => new Response('nope', { status: 404 }));
    await settle(createDiscord({ fetch: bad.fetchSpy, env: ENV }).postEmbed(WEBHOOK, EMBED));
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('T-ADP-18 DISCORD_API_BASE (tests only) rewrites the discord.com / discordapp.com API prefix to the fixture server', async () => {
    const base = 'http://127.0.0.1:4010/discord';
    const rewritten = `${base}/webhooks/123/${TOKEN}`;
    const { fetchSpy, seen } = capture(() => Response.json(okFixture), rewritten);
    const discord = createDiscord({
      fetch: fetchSpy,
      env: { ...ENV, DISCORD_API_BASE: `${base}/` },
    });
    await expect(discord.postEmbed(WEBHOOK, EMBED)).resolves.toEqual({ status: 200 });
    await expect(
      discord.postEmbed(`https://discordapp.com/api/webhooks/123/${TOKEN}`, EMBED),
    ).resolves.toEqual({ status: 200 });
    expect(seen.urls).toEqual([`${rewritten}?wait=true`, `${rewritten}?wait=true`]);
  });

  it('T-ADP-18 rewriteDiscordBase is pure: only the API prefix moves; unset base → unchanged', () => {
    const base = 'http://127.0.0.1:4010/discord';
    expect(rewriteDiscordBase(WEBHOOK, base)).toBe(`${base}/webhooks/123/${TOKEN}`);
    expect(rewriteDiscordBase(`https://discordapp.com/api/webhooks/1/a`, base)).toBe(
      `${base}/webhooks/1/a`,
    );
    expect(rewriteDiscordBase(WEBHOOK, undefined)).toBe(WEBHOOK);
    expect(rewriteDiscordBase(WEBHOOK, '')).toBe(WEBHOOK);
    expect(rewriteDiscordBase('https://example.com/api/webhooks/1/a', base)).toBe(
      'https://example.com/api/webhooks/1/a',
    );
  });

  it('T-ADP-18 a URL outside the 04 §1.3 grammar → unsupported, no request, URL masked', async () => {
    const fetchSpy = vi.fn(mockFetch({}));
    const discord = createDiscord({ fetch: fetchSpy, env: ENV });
    for (const bad of [
      `http://discord.com/api/webhooks/123/${TOKEN}`,
      `https://example.com/api/webhooks/123/${TOKEN}`,
      `${WEBHOOK} `,
      '',
    ]) {
      const error = await settle(discord.postEmbed(bad, EMBED));
      expect(error?.code).toBe('unsupported');
      expectNoSecret(error?.message ?? '');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-ADP-18 discordWebhookUrlPattern = the 04 §1.3 regex (discord.com + discordapp.com; https only; no trim)', () => {
    expect(discordWebhookUrlPattern.test(WEBHOOK)).toBe(true);
    expect(discordWebhookUrlPattern.test('https://discordapp.com/api/webhooks/1/a-b_c')).toBe(true);
    expect(discordWebhookUrlPattern.test('http://discord.com/api/webhooks/1/abc')).toBe(false);
    expect(discordWebhookUrlPattern.test('https://discord.gg/api/webhooks/1/abc')).toBe(false);
    expect(discordWebhookUrlPattern.test('https://discord.com/api/webhooks/1/abc ')).toBe(false);
    expect(discordWebhookUrlPattern.test('https://discord.com/api/webhooks/x/abc')).toBe(false);
    expect(discordWebhookUrlPattern.test('https://discord.com/api/webhooks/1/abc?wait=true')).toBe(
      false,
    );
  });

  it('T-ADP-18 maskWebhookUrl → …<last 4>; empty → NOT SET; short → … + all (maskSecret rule)', () => {
    expect(maskWebhookUrl('https://discord.com/api/webhooks/123/abcdefghij')).toBe('…ghij');
    expect(maskWebhookUrl(WEBHOOK)).toBe('…_XYZ');
    expect(maskWebhookUrl('')).toBe('NOT SET');
    expect(maskWebhookUrl(null)).toBe('NOT SET');
    expect(maskWebhookUrl(undefined)).toBe('NOT SET');
    expect(maskWebhookUrl('abc')).toBe('…abc');
  });
});

describe('T-ADP-20 discord env by injection (04 SC-25)', () => {
  it('T-ADP-20 missing UA → createDiscord throws a zod error naming MODRINTH_USER_AGENT, no request', () => {
    const fetchSpy = vi.fn(mockFetch({}));
    let thrown: unknown;
    try {
      createDiscord({ fetch: fetchSpy, env: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(
      'MODRINTH_USER_AGENT',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
