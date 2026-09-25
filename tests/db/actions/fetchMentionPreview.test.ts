/**
 * tests/db/actions/fetchMentionPreview.test.ts — T-ACT-62 (+ T-ACT-69 SC-24 audit line) (05 §7.2;
 * 04 §1.6 `fetchMentionPreview`, §4.3 `oembed` / `getVideoMeta`, §4.4 `assertPublicHost` /
 * `fetchOpenGraph`, §5.4 the chain, §5.5 `mention_preview` 30 / min; 01 INV-26 / INV-43 / INV-54;
 * ADR-0002 C7 / #33 / #73; ADR-0045; 00 S1.8.AC1 — security-reviewer's SSRF focus).
 *
 * `requireRole('admin')` → `assertRateLimit('mention_preview', profile_id, 30, '1 minute')` →
 * step 1 `assertPublicHost` on the pasted link (every platform) → YouTube: `youtube.oembed` →
 * `youtube.getVideoMeta` → the page read only when both gave nothing; every other platform: the
 * page read only → normalise → `{…ten keys…, source}`. NOTHING is stored, nothing is revalidated.
 * Every `AdapterError` that ends the chain is the ONE `upstream_error` message — an SSRF refusal
 * reads exactly like a timeout; the reason is a server-side `warn` line (step + code, never the URL).
 *
 * Harness (H-5 — no socket, no real resolver):
 * - DNS: the action builds `createOembed({ env })` with nothing injected, so the adapter's DEFAULT
 *   resolver runs — the named import `lookup` of the exact specifier `node:dns/promises`, mocked for
 *   this whole file by a table (`dns.table`; a host that is not in it fails like ENOTFOUND). Public
 *   samples are `93.184.216.34` / `2606:4700:4700::1111` — TEST-NET and `2001:db8::` are refused.
 * - fetch: `spyFetch` replaces the global. The two adapter-owned YouTube endpoints are the
 *   `.env.test` bases (`OEMBED_BASE`, `YOUTUBE_API_BASE` — never passed through the guard); pages
 *   are keyed by their public URL and answered with `text/html` `Response`s (a fixture-path route
 *   would answer `application/json`, which the page read refuses). Every route pushes its name onto
 *   `events`, next to the resolver's `dns:<host>` entries, so the ORDER of the chain is asserted.
 *   Failure arms use 404s: a 5xx costs ~7 s of SC-09 backoff per YouTube call.
 * - `@/lib/adapters/oembed` / `youtube` are wrapped by pass-through mocks with a per-test switch
 *   (`sabotage`) — the only way to make an adapter throw something that is NOT an `AdapterError`
 *   (→ `internal`, never `upstream_error`), to answer a title-less page, or to run without a key.
 *   With the switch off (every other test) the real adapters run untouched.
 * - The seed admin's `mention_preview` hits are cleared after every test (30 / min is one file's
 *   worth); the 31st-call case runs as a burner admin. Nothing here writes `mentions`; "nothing
 *   stored" compares the rows at the pasted + canonical URLs before and after (scoped — other lanes
 *   may be writing mentions of their own).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMentionPreview } from '@/lib/actions/mentions';
import type { FetchMentionPreviewInput } from '@/lib/actions/mentions.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { expectInternal, withDbFault } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeUser } from '@/tests/helpers/factories';
import { FIXTURE_ROOT } from '@/tests/helpers/fixtures';
import { SEED_MENTIONS } from '@/tests/helpers/seedIds';
import {
  spyFetch,
  spyLog,
  spyRevalidateTag,
  type FetchSpy,
  type FixtureMap,
  type LogSpy,
} from '@/tests/helpers/spies';

type Address = { address: string; family: 4 | 6 };

/** The mocked resolver: `table` = what each host resolves to; `events` = the order things happened in. */
const dns = vi.hoisted(() => ({
  table: new Map<string, { address: string; family: 4 | 6 }[]>(),
  events: [] as string[],
}));

vi.mock('node:dns/promises', () => {
  const lookup = (host: string): Promise<{ address: string; family: 4 | 6 }[]> => {
    dns.events.push(`dns:${host}`);
    const answer = dns.table.get(host);
    if (answer === undefined) {
      return Promise.reject(
        Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }),
      );
    }
    return Promise.resolve(answer);
  };
  return { lookup, default: { lookup } };
});

/** Per-test switches over the real adapters (see the header); all `null` = untouched. */
const sabotage = vi.hoisted(() => ({
  assertPublicHost: null as (() => Promise<URL>) | null,
  fetchOpenGraph: null as (() => Promise<unknown>) | null,
  oembed: null as (() => Promise<never>) | null,
  hasKey: null as boolean | null,
}));

vi.mock('@/lib/adapters/oembed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/adapters/oembed')>();
  return {
    ...actual,
    createOembed: (deps: Parameters<typeof actual.createOembed>[0]) => {
      const real = actual.createOembed(deps);
      return {
        ...real,
        assertPublicHost: (url: string) =>
          sabotage.assertPublicHost ? sabotage.assertPublicHost() : real.assertPublicHost(url),
        fetchOpenGraph: (url: string) =>
          sabotage.fetchOpenGraph ? sabotage.fetchOpenGraph() : real.fetchOpenGraph(url),
      };
    },
  };
});

vi.mock('@/lib/adapters/youtube', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/adapters/youtube')>();
  return {
    ...actual,
    createYoutube: (deps: Parameters<typeof actual.createYoutube>[0]) => {
      const real = actual.createYoutube(deps);
      return {
        ...real,
        hasKey: sabotage.hasKey ?? real.hasKey,
        oembed: (url: string) => (sabotage.oembed ? sabotage.oembed() : real.oembed(url)),
      };
    },
  };
});

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const OEMBED = process.env.OEMBED_BASE ?? '';
const API = process.env.YOUTUBE_API_BASE ?? '';
const API_KEY = process.env.YOUTUBE_API_KEY ?? '';
if (OEMBED === '' || API === '' || API_KEY === '') {
  throw new Error(
    'OEMBED_BASE / YOUTUBE_API_BASE / YOUTUBE_API_KEY not set — is .env.test loaded?',
  );
}
const VIDEOS = `${API}/videos`;
const SUPABASE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;

/** 04 §1.6 Returns — verbatim. */
const UNREADABLE = "Couldn't read that page. You can fill the fields by hand.";

const PUBLIC_V4: Address = { address: '93.184.216.34', family: 4 };
const PUBLIC_V6: Address = { address: '2606:4700:4700::1111', family: 6 };
const PUBLIC: Address[] = [PUBLIC_V4, PUBLIC_V6];

/** `youtube/oembed.json` + `youtube/videos-mentions.json` both describe this video. */
const VIDEO_ID = 'fixmen00001';
const WATCH = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const ARTICLE = 'https://blog.example.test/post';

const fixtureText = (name: string): string => readFileSync(path.join(FIXTURE_ROOT, name), 'utf8');
const oembedJson = fixtureText('youtube/oembed.json');
const videosJson = fixtureText('youtube/videos-mentions.json');
const ogPageHtml = fixtureText('oembed/og-page.html');
const noOgHtml = fixtureText('oembed/no-og.html');
const tiktokHtml = fixtureText('oembed/tiktok.html');

const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const html = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (location: string, status = 302): Response =>
  new Response(null, { status, headers: { location } });
const notFound = (): Response => json('{}', 404);

/** A named route: records that it answered (the chain-order assertions) and clones its response. */
function named(name: string, response: Response | (() => Response)) {
  return (): Response => {
    dns.events.push(name);
    return typeof response === 'function' ? response() : response.clone();
  };
}

let logs: LogSpy;
let fetchSpy: FetchSpy | null = null;

/**
 * EVERY request that left for anything but the local Supabase stack, routed or not — `spyFetch`
 * records matched URLs only and lets unmatched loopback ones through, so "no request" is asserted
 * here, one layer above it. `fetchSpy.restore()` puts the real global back (this wrapper included).
 */
const outbound: string[] = [];

function routes(map: FixtureMap): FetchSpy {
  fetchSpy = spyFetch(map);
  const routed = globalThis.fetch;
  outbound.length = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin !== SUPABASE_ORIGIN) outbound.push(url);
    return routed(input, init);
  }) as typeof fetch;
  return fetchSpy;
}

function resolves(host: string, answer: Address[] = PUBLIC): void {
  dns.table.set(host, answer);
}

function lines(filter: Partial<{ msg: string; level: string }>): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) =>
    Object.entries(filter).every(([key, value]) => line[key] === value),
  );
}

/** 01 INV-43 / SC-24: no log line ever carries the pasted link, its host, or an address. */
function expectNothingOfTheUrlInLogs(...needles: string[]): void {
  const text = JSON.stringify(logs.lines);
  for (const needle of [...needles, `key=${API_KEY}`]) {
    expect(text).not.toContain(needle);
  }
}

/** The one server-side trace of a refused / unreadable link: step + adapter code, nothing else. */
function expectUnreadableLine(step: 'host' | 'page', code: string): void {
  const warned = lines({ msg: 'unreadable' });
  expect(warned).toHaveLength(1);
  const line = warned[0] as { action: string; level: string; id: string; meta: object };
  expect(line.action).toBe('fetchMentionPreview');
  expect(line.level).toBe('warn');
  expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.keys(line.meta).sort()).toEqual(['code', 'status', 'step']);
  expect(line.meta).toMatchObject({ step, code });
}

async function mentionIdsAt(urls: readonly string[]): Promise<string[]> {
  const { data, error } = await service
    .from('mentions')
    .select('id')
    .in('url', [...urls]);
  if (error) throw new Error(`mentions read failed: ${error.message}`);
  return data.map((row) => row.id).sort();
}

const preview = (url: string, role: 'admin' | 'mod' | 'user' | 'banned' | 'anon' = 'admin') =>
  callAction(fetchMentionPreview, { url }, { role });

async function hits(profileId: string = SEED_ROLE_IDS.admin): Promise<number> {
  return countRateLimitHits('mention_preview', profileId);
}

/** Burner admins whose `mention_preview` hits `afterEach` forgets. */
const burners: string[] = [];

/** A factory admin with `count` hits already on the clock — arranged straight in `rate_limit_hits`, the only table `rate_limit_ok` counts. */
async function burnerWithHits(count: number): Promise<string> {
  const burner = await makeUser({ role: 'admin' });
  burners.push(burner);
  const { error } = await service
    .from('rate_limit_hits')
    .insert(Array.from({ length: count }, () => ({ scope: 'mention_preview', key: burner })));
  if (error) throw new Error(`rate_limit_hits arrange failed: ${error.message}`);
  return burner;
}

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
  dns.table.clear();
  dns.events.length = 0;
  sabotage.assertPublicHost = null;
  sabotage.fetchOpenGraph = null;
  sabotage.oembed = null;
  sabotage.hasKey = null;
});

afterEach(async () => {
  fetchSpy?.restore();
  fetchSpy = null;
  logs.restore();
  // Also when the test failed half-way: a spent budget must never outlive its test.
  for (const key of [SEED_ROLE_IDS.admin, ...burners.splice(0)]) {
    await clearRateLimitHits('mention_preview', key);
  }
});

afterAll(async () => {
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-62 auth — admin only (ADR-0002 C7): nothing resolved, nothing requested, no hit
// ---------------------------------------------------------------------------------------------
describe('T-ACT-62 fetchMentionPreview auth', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check answers (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: mentions are admin-only; a moderator reads `/admin/mentions`, nothing more.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])(
    'T-ACT-62 $role → $code: no DNS, no request, no rate-limit hit, no audit line',
    async ({ role, code, message }) => {
      resolves('www.youtube.com');
      const spy = routes({
        [OEMBED]: named('oembed', json(oembedJson)),
        [VIDEOS]: named('videos', json(videosJson)),
      });
      const error = expectFail(await preview(WATCH, role), code);
      expect(error.message).toBe(message);
      expect(dns.events).toEqual([]);
      expect(spy.calls).toEqual([]);
      expect(outbound).toEqual([]);
      if (role !== 'anon') expect(await hits(SEED_ROLE_IDS[role])).toBe(0);
      expect(lines({ msg: 'admin' })).toEqual([]);
      expect(tags.calls).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-62 input — an http(s) URL ≤ 2048 with no credentials; everything else is `validation`
// ---------------------------------------------------------------------------------------------
describe('T-ACT-62 fetchMentionPreview validation', () => {
  const SCHEME = 'Links start with https://.';
  const CREDENTIALS = "Links can't carry a username or password.";

  it.each<{ name: string; url: unknown; message: string }>([
    { name: 'file:', url: 'file:///etc/passwd', message: SCHEME },
    { name: 'javascript:', url: 'javascript:alert(1)', message: SCHEME },
    { name: 'data:', url: 'data:text/html,<h1>hi</h1>', message: SCHEME },
    { name: 'ftp:', url: 'ftp://blog.example.test/post', message: SCHEME },
    { name: 'gopher:', url: 'gopher://127.0.0.1:70/_x', message: SCHEME },
    {
      name: 'userinfo user:pass@',
      url: 'https://oliver:hunter2@blog.example.test/',
      message: CREDENTIALS,
    },
    { name: 'userinfo user@', url: 'https://oliver@blog.example.test/', message: CREDENTIALS },
    {
      name: 'userinfo in front of a loopback host',
      url: 'http://blog.example.test@127.0.0.1/',
      message: CREDENTIALS,
    },
    {
      name: '2049 characters',
      url: `https://blog.example.test/${'a'.repeat(2049 - 'https://blog.example.test/'.length)}`,
      message: 'Too long. 2048 characters maximum.',
    },
    { name: 'not a URL', url: 'metal pipe mace review', message: "That doesn't look like a link." },
    {
      name: 'a bare host',
      url: 'blog.example.test/post',
      message: "That doesn't look like a link.",
    },
    { name: "''", url: '', message: 'Paste a link.' },
    { name: 'whitespace only', url: '   ', message: 'Paste a link.' },
    { name: 'a non-string', url: 42, message: 'Paste a link.' },
    { name: 'missing', url: undefined, message: 'Paste a link.' },
  ])(
    'T-ACT-62 url $name → validation before auth (asked as anon): no DNS, no request, no hit',
    async ({ url, message }) => {
      const spy = routes({ [OEMBED]: named('oembed', json(oembedJson)) });
      const error = expectFail(
        await callAction(fetchMentionPreview, { url } as FetchMentionPreviewInput, {
          role: 'anon',
        }),
        'validation',
      );
      expect(error.message).toBe(VALIDATION_MESSAGE);
      expect(error.field).toBe('url');
      expect(error.issues).toEqual([{ path: 'url', message }]);
      expect(dns.events).toEqual([]);
      expect(spy.calls).toEqual([]);
    },
  );

  it('T-ACT-62 a 2048-character https URL is accepted (the bound is inclusive); as admin a bad scheme burns no budget', async () => {
    const long = `${ARTICLE}?q=${'a'.repeat(2048 - `${ARTICLE}?q=`.length)}`;
    expect(long).toHaveLength(2048);
    resolves('blog.example.test');
    routes({ [ARTICLE]: named('page', html(ogPageHtml)) });
    expectOk(await preview(long));

    await clearRateLimitHits('mention_preview', SEED_ROLE_IDS.admin);
    expectFail(await preview('javascript:alert(1)'), 'validation');
    expect(await hits()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-62 SSRF — step 1 on every platform; the refusal never says why and never makes a request
// ---------------------------------------------------------------------------------------------
describe('T-ACT-62 fetchMentionPreview SSRF guard (DNS mocked)', () => {
  const INTERNAL_HOST = 'wiki.example.test';

  async function expectRefused(
    url: string,
    code: 'rejected' | 'network_error',
    ...secrets: string[]
  ): Promise<void> {
    // Every route a careless chain could reach is live — so "no request" is a real observation.
    // (No `http://` catch-all: the local Supabase stack is http; `outbound` sees cleartext anyway.)
    const spy = routes({
      [OEMBED]: named('oembed', json(oembedJson)),
      [VIDEOS]: named('videos', json(videosJson)),
      'https://': named('page', html(ogPageHtml)),
    });
    const res = await preview(url);
    const error = expectFail(res, 'upstream_error');
    // The ONE message — and nothing else: no field, no issues, no reason.
    expect(error).toEqual({ code: 'upstream_error', message: UNREADABLE });
    expect(spy.calls).toEqual([]);
    expect(outbound).toEqual([]);
    expect(tags.calls).toEqual([]);
    expect(lines({ msg: 'admin' })).toEqual([]);
    expectUnreadableLine('host', code);
    expectNothingOfTheUrlInLogs(...secrets);
    expect(JSON.stringify(res)).not.toMatch(/rejected|address|dns|private|loopback/i);
  }

  it.each<{ range: string; address: string }>([
    { range: '127.0.0.0/8 (loopback)', address: '127.0.0.1' },
    { range: '127.0.0.0/8 (top of the range)', address: '127.255.255.254' },
    { range: '10.0.0.0/8', address: '10.0.0.1' },
    { range: '10.0.0.0/8 (top of the range)', address: '10.255.255.255' },
    { range: '172.16.0.0/12', address: '172.16.0.1' },
    { range: '172.16.0.0/12 (top of the range)', address: '172.31.255.255' },
    { range: '192.168.0.0/16', address: '192.168.1.1' },
    { range: '169.254.0.0/16 (link-local — cloud metadata)', address: '169.254.169.254' },
    { range: '100.64.0.0/10 (CGNAT)', address: '100.64.0.1' },
    { range: '100.64.0.0/10 (top of the range)', address: '100.127.255.255' },
    { range: '::1', address: '::1' },
    { range: 'fc00::/7 (ULA, fc…)', address: 'fc00::1' },
    { range: 'fc00::/7 (ULA, fd…)', address: 'fd12:3456:789a::1' },
    { range: 'fe80::/10 (IPv6 link-local)', address: 'fe80::1' },
    { range: 'IPv4-mapped loopback', address: '::ffff:127.0.0.1' },
    { range: '0.0.0.0/8', address: '0.0.0.0' },
  ])(
    'T-ACT-62 a host resolving into $range → upstream_error, the one message, no request',
    async ({ address }) => {
      resolves(INTERNAL_HOST, [{ address, family: address.includes(':') ? 6 : 4 }]);
      await expectRefused(`https://${INTERNAL_HOST}/secrets`, 'rejected', INTERNAL_HOST, address);
      expect(dns.events).toEqual([`dns:${INTERNAL_HOST}`]);
    },
  );

  it('T-ACT-62 ONE private address among public ones is enough (the transport may pick any of them)', async () => {
    resolves(INTERNAL_HOST, [PUBLIC_V4, { address: '10.0.0.7', family: 4 }, PUBLIC_V6]);
    await expectRefused(`https://${INTERNAL_HOST}/`, 'rejected', INTERNAL_HOST, '10.0.0.7');
  });

  it('T-ACT-62 a name that resolves to nothing, or does not resolve at all → upstream_error', async () => {
    resolves(INTERNAL_HOST, []);
    await expectRefused(`https://${INTERNAL_HOST}/`, 'rejected', INTERNAL_HOST);

    logs.restore();
    logs = spyLog();
    dns.table.clear();
    await expectRefused('https://nxdomain.example.test/', 'network_error', 'nxdomain', 'ENOTFOUND');
  });

  it.each<{ name: string; url: string }>([
    { name: '.local', url: 'https://printer.local/status' },
    { name: '.local with a trailing dot', url: 'https://printer.local./status' },
    { name: 'localhost', url: 'https://localhost/' },
    { name: 'localhost with a trailing dot', url: 'http://localhost./' },
    { name: '*.localhost', url: 'https://app.localhost/' },
    { name: '*.internal', url: 'https://db.internal/' },
    { name: 'a single-label host', url: 'https://intranet/' },
    { name: 'IPv4 literal 127.0.0.1', url: 'https://127.0.0.1/' },
    { name: 'IPv4 literal 10.0.0.1', url: 'https://10.0.0.1/' },
    { name: 'IPv4 literal 172.16.0.1', url: 'https://172.16.0.1/' },
    { name: 'IPv4 literal 192.168.1.1', url: 'https://192.168.1.1/' },
    { name: 'IPv4 literal 100.64.0.1', url: 'https://100.64.0.1/' },
    { name: 'the metadata endpoint', url: 'http://169.254.169.254/latest/meta-data/' },
    { name: 'IPv6 literal [::1]', url: 'https://[::1]/' },
    { name: 'IPv6 literal ULA', url: 'https://[fd00::1]/' },
    { name: 'IPv4-mapped IPv6 literal', url: 'https://[::ffff:127.0.0.1]/' },
    { name: 'decimal 2130706433 (= 127.0.0.1)', url: 'http://2130706433/' },
    { name: 'hex 0x7f.0.0.1', url: 'http://0x7f.0.0.1/' },
    { name: 'octal 0177.0.0.1', url: 'http://0177.0.0.1/' },
    { name: 'short form 127.1', url: 'http://127.1/' },
    {
      name: 'the local Supabase stack (loopback + a port)',
      url: 'http://127.0.0.1:54321/rest/v1/',
    },
    { name: 'a public name on an odd port', url: 'https://blog.example.test:8443/post' },
  ])('T-ACT-62 $name → upstream_error without asking the resolver', async ({ url }) => {
    resolves('blog.example.test');
    await expectRefused(url, 'rejected', new URL(url).hostname.replace(/[[\]]/g, ''));
    expect(dns.events).toEqual([]);
  });

  it('T-ACT-62 a YouTube-looking link is guarded like any other (step 1 is for every platform)', async () => {
    resolves('www.youtube.com', [{ address: '192.168.0.10', family: 4 }]);
    await expectRefused(WATCH, 'rejected', 'youtube.com', '192.168.0.10');
    expect(dns.events).toEqual(['dns:www.youtube.com']);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-62 the chain — YouTube: oEmbed → Data API → (only then) the page
// ---------------------------------------------------------------------------------------------
describe('T-ACT-62 fetchMentionPreview chain — YouTube', () => {
  const SHORT = `https://youtu.be/${VIDEO_ID}?si=t_tracking&t=42`;

  it('T-ACT-62 oEmbed + Data API → source data_api with views + date; exact ten keys; nothing stored; one hit; SC-24 keys only', async () => {
    resolves('youtu.be');
    const before = await mentionIdsAt([SHORT, WATCH]);
    const spy = routes({
      [OEMBED]: named('oembed', json(oembedJson)),
      [VIDEOS]: named('videos', json(videosJson)),
      'https://': named('page', html(ogPageHtml)),
    });

    const res = await preview(SHORT);
    const data = expectOk(res);
    expect(Object.keys(data).sort()).toEqual([
      'canonical_url',
      'creator_name',
      'creator_url',
      'external_id',
      'platform',
      'published_at',
      'source',
      'thumbnail_url',
      'title',
      'view_count',
    ]);
    expect(data).toEqual({
      platform: 'youtube',
      external_id: VIDEO_ID,
      canonical_url: WATCH,
      title: 'I played every OdSens datapack at once',
      creator_name: 'BlockBuddy',
      creator_url: 'https://www.youtube.com/@BlockBuddy',
      // Step 2's thumbnail wins (it is on i.ytimg.com); step 3 only fills gaps.
      thumbnail_url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
      published_at: '2026-05-12T17:00:00.000Z',
      view_count: 95400,
      source: 'data_api',
    });

    // Order: the guard, then oEmbed, then the Data API — and never the page.
    expect(dns.events).toEqual(['dns:youtu.be', 'oembed', 'videos']);
    expect(spy.calls).toEqual([
      `${OEMBED}?url=${encodeURIComponent(SHORT)}&format=json`,
      `${VIDEOS}?part=snippet,statistics&id=${VIDEO_ID}&key=${API_KEY}`,
    ]);

    // Nothing stored, nothing revalidated, one hit.
    expect(await mentionIdsAt([SHORT, WATCH])).toEqual(before);
    expect(tags.calls).toEqual([]);
    expect(await hits()).toBe(1);

    // SC-24 (T-ACT-69): one keys-only line; the link is a key name, never a value.
    const admin = lines({ msg: 'admin' });
    expect(admin).toHaveLength(1);
    const line = admin[0] as { action: string; id: string; meta: Record<string, unknown> };
    expect(line.action).toBe('fetchMentionPreview');
    expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(line.meta).toEqual({
      actor_profile_id: SEED_ROLE_IDS.admin,
      target_type: 'mention_preview',
      target_id: null,
      fields: ['url'],
    });
    expect(lines({ msg: 'unreadable' })).toEqual([]);
    expectNothingOfTheUrlInLogs('youtu.be', VIDEO_ID, 't_tracking');
    expect(JSON.stringify(res)).not.toContain(`key=${API_KEY}`);
  });

  it('T-ACT-62 oEmbed 404 + Data API ok → still ok: every field from the Data API, channel link built from the channel id', async () => {
    resolves('www.youtube.com');
    const spy = routes({
      [OEMBED]: named('oembed', notFound),
      [VIDEOS]: named('videos', json(videosJson)),
      'https://': named('page', html(ogPageHtml)),
    });
    expect(expectOk(await preview(`${WATCH}&list=PLt_list&feature=share`))).toEqual({
      platform: 'youtube',
      external_id: VIDEO_ID,
      canonical_url: WATCH,
      title: 'I played every OdSens datapack at once',
      creator_name: 'BlockBuddy',
      creator_url: 'https://www.youtube.com/channel/UCfixmention0000000000000',
      thumbnail_url: `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`,
      published_at: '2026-05-12T17:00:00.000Z',
      view_count: 95400,
      source: 'data_api',
    });
    expect(dns.events).toEqual(['dns:www.youtube.com', 'oembed', 'videos']);
    expect(spy.calls).toHaveLength(2);
  });

  it.each<{ name: string; videos: () => Response }>([
    { name: 'the Data API answers 404', videos: notFound },
    // The strict id match: an answer about OTHER videos is no answer (never `items[0]`).
    { name: 'the Data API answers, but not about this video', videos: () => json(videosJson) },
  ])(
    'T-ACT-62 oEmbed ok + $name → source oembed, views / date null, no page read',
    async ({ videos }) => {
      const other = 'fixmen00099';
      resolves('www.youtube.com');
      const spy = routes({
        [OEMBED]: named('oembed', json(oembedJson)),
        [VIDEOS]: named('videos', videos),
        'https://': named('page', html(ogPageHtml)),
      });
      const data = expectOk(await preview(`https://www.youtube.com/shorts/${other}`));
      expect(data).toMatchObject({
        platform: 'youtube',
        external_id: other,
        canonical_url: `https://www.youtube.com/watch?v=${other}`,
        title: 'I played every OdSens datapack at once',
        creator_name: 'BlockBuddy',
        published_at: null,
        view_count: null,
        source: 'oembed',
      });
      expect(dns.events).toEqual(['dns:www.youtube.com', 'oembed', 'videos']);
      expect(spy.calls).toHaveLength(2);
    },
  );

  it('T-ACT-62 no YOUTUBE_API_KEY → step 3 is skipped (no request, no unit): source oembed', async () => {
    sabotage.hasKey = false;
    resolves('www.youtube.com');
    const spy = routes({
      [OEMBED]: named('oembed', json(oembedJson)),
      [VIDEOS]: named('videos', json(videosJson)),
    });
    const data = expectOk(await preview(WATCH));
    expect(data.source).toBe('oembed');
    expect(data.view_count).toBeNull();
    expect(dns.events).toEqual(['dns:www.youtube.com', 'oembed']);
    expect(spy.calls).toHaveLength(1);
  });

  it('T-ACT-62 step 5: an off-host thumbnail becomes the i.ytimg literal, a non-https creator link falls back, text is trimmed and capped', async () => {
    const id = 'fixmen00002';
    resolves('m.youtube.com');
    routes({
      [OEMBED]: named(
        'oembed',
        json(
          JSON.stringify({
            title: `  ${'T'.repeat(260)}  `,
            // 79 chars + an astral character straddling the 80 cap: the pair is never split.
            author_name: `${'c'.repeat(79)}\u{1F3B8}tail`,
            author_url: 'http://www.youtube.com/@cleartext',
            thumbnail_url: 'https://thumbs.evil.example/steal.jpg',
          }),
        ),
      ),
      [VIDEOS]: named('videos', json(videosJson)),
    });
    const data = expectOk(await preview(`https://m.youtube.com/watch?v=${id}`));
    expect(data.title).toBe('T'.repeat(200));
    expect(data.creator_name).toBe('c'.repeat(79));
    // The oEmbed link is not https → the Data API's channel link.
    expect(data.creator_url).toBe('https://www.youtube.com/channel/UCfixmention0000000000000');
    // The oEmbed thumbnail is off-host → the Data API's i.ytimg one.
    expect(data.thumbnail_url).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    expect(data.source).toBe('data_api');
  });

  it('T-ACT-62 no i.ytimg thumbnail from either step → the hqdefault literal built from the id', async () => {
    resolves('www.youtube.com');
    routes({
      [OEMBED]: named(
        'oembed',
        json(
          JSON.stringify({
            title: 't_ clip',
            author_name: '   ',
            author_url: 'https://not a host/',
          }),
        ),
      ),
      [VIDEOS]: named('videos', notFound),
    });
    const data = expectOk(await preview(`https://www.youtube.com/live/fixmen00077`));
    expect(data.thumbnail_url).toBe('https://i.ytimg.com/vi/fixmen00077/hqdefault.jpg');
    // A blank creator and an https link that does not parse are `null`, never '' — the admin types them.
    expect(data.creator_name).toBeNull();
    expect(data.creator_url).toBeNull();
  });

  it('T-ACT-62 oEmbed AND Data API fail → the page read → source og; a YouTube link keeps its watch form and an i.ytimg thumbnail', async () => {
    resolves('www.youtube.com');
    const page = `<!doctype html><html><head><title>t_ - YouTube</title>
      <meta property="og:site_name" content="YouTube">
      <meta property="og:title" content="I played every OdSens datapack at once">
      <meta property="og:url" content="https://www.youtube.com/watch?v=${VIDEO_ID}&amp;feature=youtu.be">
      <meta property="og:image" content="https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg">
      </head><body></body></html>`;
    const spy = routes({
      [OEMBED]: named('oembed', notFound),
      [VIDEOS]: named('videos', notFound),
      [WATCH]: named('page', html(page)),
    });
    expect(expectOk(await preview(`${WATCH}&t=10s`))).toEqual({
      platform: 'youtube',
      external_id: VIDEO_ID,
      canonical_url: WATCH,
      title: 'I played every OdSens datapack at once',
      creator_name: 'YouTube',
      creator_url: null,
      thumbnail_url: `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`,
      published_at: null,
      view_count: null,
      source: 'og',
    });
    // 2 and 3 first, the page last — behind its own guard.
    expect(dns.events).toEqual([
      'dns:www.youtube.com',
      'oembed',
      'videos',
      'dns:www.youtube.com',
      'page',
    ]);
    expect(spy.calls[2]).toBe(`${WATCH}&t=10s`);
  });

  it('T-ACT-62 a YouTube page whose og:image is off-host still gets the i.ytimg literal; a link without a video id has no thumbnail', async () => {
    resolves('www.youtube.com');
    routes({
      [OEMBED]: named('oembed', notFound),
      [VIDEOS]: named('videos', notFound),
      'https://www.youtube.com/': named('page', html(ogPageHtml)),
    });
    const video = expectOk(await preview(WATCH));
    expect(video.thumbnail_url).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
    expect(video.canonical_url).toBe(WATCH);

    // A channel page: YouTube, but no video id → step 3 never runs, nothing to build a literal from.
    dns.events.length = 0;
    const channel = expectOk(await preview('https://www.youtube.com/@BlockBuddy?si=t_x'));
    expect(channel).toMatchObject({
      platform: 'youtube',
      external_id: null,
      thumbnail_url: null,
      canonical_url: 'https://blockybulletin.example/reviews/metal-pipe-mace',
      source: 'og',
    });
    expect(dns.events).toEqual(['dns:www.youtube.com', 'oembed', 'dns:www.youtube.com', 'page']);
  });

  it('T-ACT-62 YouTube: everything fails → upstream_error with the verbatim message, no audit line, the hit still counts', async () => {
    resolves('www.youtube.com');
    const spy = routes({
      [OEMBED]: named('oembed', notFound),
      [VIDEOS]: named('videos', notFound),
      [WATCH]: named('page', () => html('gone', 404)),
    });
    const error = expectFail(await preview(WATCH), 'upstream_error');
    expect(error).toEqual({ code: 'upstream_error', message: UNREADABLE });
    expect(spy.calls).toHaveLength(3);
    expect(lines({ msg: 'admin' })).toEqual([]);
    expectUnreadableLine('page', 'http_error');
    expectNothingOfTheUrlInLogs('youtube.com', VIDEO_ID);
    expect(await hits()).toBe(1);
    expect(tags.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-62 the chain — every other platform: the page read ONLY (`platform` per T-ADP-16)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-62 fetchMentionPreview chain — Open Graph', () => {
  it.each<{ platform: string; url: string; host: string }>([
    {
      platform: 'tiktok',
      url: 'https://www.tiktok.com/@t_creator/video/7',
      host: 'www.tiktok.com',
    },
    { platform: 'twitch', url: 'https://clips.twitch.tv/t_BonkClip', host: 'clips.twitch.tv' },
    { platform: 'twitch', url: 'https://www.twitch.tv/videos/123', host: 'www.twitch.tv' },
    {
      platform: 'reddit',
      url: 'https://www.reddit.com/r/t_mods/comments/1/x/',
      host: 'www.reddit.com',
    },
    { platform: 'reddit', url: 'https://redd.it/t_abc1', host: 'redd.it' },
    { platform: 'article', url: ARTICLE, host: 'blog.example.test' },
    // A dot boundary, not a suffix match: this is somebody's blog, not YouTube.
    {
      platform: 'article',
      url: 'https://notyoutube.com/watch?v=fixmen00001',
      host: 'notyoutube.com',
    },
    // Spec-literal (05 T-ADP-16): the nocookie host is not on the platform map.
    {
      platform: 'article',
      url: `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
      host: 'www.youtube-nocookie.com',
    },
  ])(
    'T-ACT-62 $url → platform $platform, the page only (no oEmbed, no Data API), source og',
    async ({ platform, url, host }) => {
      resolves(host);
      const spy = routes({
        [OEMBED]: named('oembed', json(oembedJson)),
        [VIDEOS]: named('videos', json(videosJson)),
        [url]: named('page', html(ogPageHtml)),
      });
      const data = expectOk(await preview(url));
      expect(data).toEqual({
        platform,
        external_id: null,
        canonical_url: 'https://blockybulletin.example/reviews/metal-pipe-mace',
        title: "Metal Pipe Mace & friends: the loudest mod we've tried",
        creator_name: 'Blocky Bulletin',
        creator_url: null,
        thumbnail_url: 'https://blockybulletin.example/img/metal-pipe-mace.png',
        published_at: '2026-06-20T07:30:00.000Z',
        view_count: null,
        source: 'og',
      });
      expect(dns.events).toEqual([`dns:${host}`, `dns:${host}`, 'page']);
      expect(spy.calls).toEqual([url]);
      expect(tags.calls).toEqual([]);
    },
  );

  it('T-ACT-62 the TikTok fixture: og fields, a long signed og:image kept (≤ 512), SEED-10 untouched', async () => {
    const pasted = 'https://www.tiktok.com/@seedtok/video/1?utm_source=t_share&is_from_webapp=1';
    const canonical = 'https://www.tiktok.com/@seedtok/video/1';
    resolves('www.tiktok.com');
    const before = await mentionIdsAt([pasted, canonical]);
    expect(before).toEqual([SEED_MENTIONS.tiktok]);
    routes({ 'https://www.tiktok.com/': named('page', html(tiktokHtml)) });

    expect(expectOk(await preview(pasted))).toEqual({
      platform: 'tiktok',
      external_id: null,
      canonical_url: canonical,
      title: 'this mod makes no sense and I love it',
      creator_name: 'TikTok',
      creator_url: null,
      thumbnail_url:
        'https://p16-sign.tiktokcdn.example/obj/seedtok-cover-1.jpeg?x-expires=1790000000&x-signature=fixture',
      published_at: null,
      view_count: null,
      source: 'og',
    });
    expect(await mentionIdsAt([pasted, canonical])).toEqual(before);
  });

  it('T-ACT-62 a page with no Open Graph at all: <title> only, no creator, no image; canonical = the pasted link minus tracking params', async () => {
    resolves('blog.example.test');
    const spy = routes({ [ARTICLE]: named('page', html(noOgHtml)) });
    const data = expectOk(
      await preview(`http://blog.example.test/post?utm_source=t_news&id=7&UTM_Medium=x&si=1`),
    );
    expect(data).toEqual({
      platform: 'article',
      external_id: null,
      canonical_url: `${ARTICLE}?id=7`,
      title: 'Patch notes — week 24 | The Cobble Post',
      creator_name: null,
      creator_url: null,
      thumbnail_url: null,
      published_at: null,
      view_count: null,
      source: 'og',
    });
    // `http:` was upgraded before anything left: the page is read over https, as pasted otherwise.
    expect(spy.calls).toEqual([`${ARTICLE}?utm_source=t_news&id=7&UTM_Medium=x&si=1`]);
  });

  it('T-ACT-62 step 5: an og:image longer than 512 characters is dropped (the preview must round-trip into createMention)', async () => {
    resolves('blog.example.test');
    const long = `https://cdn.example.test/cover.jpg?sig=${'s'.repeat(520)}`;
    routes({
      [ARTICLE]: named(
        'page',
        html(ogPageHtml.replace('https://blockybulletin.example/img/metal-pipe-mace.png', long)),
      ),
    });
    const data = expectOk(await preview(ARTICLE));
    expect(data.thumbnail_url).toBeNull();
    expect(data.title).toBe("Metal Pipe Mace & friends: the loudest mod we've tried");
  });

  it('T-ACT-62 a redirect to a public page is followed (each hop behind the guard)', async () => {
    resolves('blog.example.test');
    resolves('www.example.test');
    const spy = routes({
      [ARTICLE]: named('hop', redirect('https://www.example.test/final', 301)),
      'https://www.example.test/final': named('page', html(ogPageHtml)),
    });
    expect(expectOk(await preview(ARTICLE)).source).toBe('og');
    expect(spy.calls).toEqual([ARTICLE, 'https://www.example.test/final']);
    expect(dns.events).toEqual([
      'dns:blog.example.test',
      'dns:blog.example.test',
      'hop',
      'dns:www.example.test',
      'page',
    ]);
  });

  it.each<{ name: string; location: string; secret: string; privateHost?: [string, Address[]] }>([
    { name: 'http://127.0.0.1/', location: 'http://127.0.0.1/admin', secret: '127.0.0.1' },
    {
      name: 'the metadata endpoint',
      location: 'http://169.254.169.254/latest/meta-data/iam/',
      secret: '169.254',
    },
    { name: 'an IPv6 loopback literal', location: 'https://[::1]/', secret: '::1' },
    { name: 'a .local name', location: 'https://nas.local/', secret: 'nas.local' },
    {
      name: 'a public-looking name that resolves to 192.168.1.1',
      location: 'https://rebind.example.test/x',
      secret: 'rebind',
      privateHost: ['rebind.example.test', [{ address: '192.168.1.1', family: 4 }]],
    },
  ])(
    'T-ACT-62 a redirect to a private host inside the page read ($name) → upstream_error, the hop is never requested',
    async ({ location, secret, privateHost }) => {
      resolves('blog.example.test');
      if (privateHost) resolves(...privateHost);
      const spy = routes({
        [ARTICLE]: named('hop', redirect(location)),
        'https://': named('private', html(ogPageHtml)),
      });
      const res = await preview(ARTICLE);
      expect(expectFail(res, 'upstream_error')).toEqual({
        code: 'upstream_error',
        message: UNREADABLE,
      });
      // The first hop was public and was read; the redirect target never was — routed or not.
      expect(spy.calls).toEqual([ARTICLE]);
      expect(outbound).toEqual([ARTICLE]);
      expectUnreadableLine('page', 'rejected');
      expectNothingOfTheUrlInLogs('blog.example.test', secret);
      expect(JSON.stringify(res)).not.toContain(secret);
      expect(lines({ msg: 'admin' })).toEqual([]);
    },
  );

  it.each<{ name: string; code: string; page: () => Response }>([
    { name: '404', code: 'http_error', page: () => html('nope', 404) },
    { name: '403 (a bot wall)', code: 'http_error', page: () => html('denied', 403) },
    {
      name: 'a PDF',
      code: 'unsupported',
      page: () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
    },
    { name: 'JSON', code: 'unsupported', page: () => json('{"title":"not a page"}') },
    {
      name: 'no Content-Type at all',
      code: 'unsupported',
      page: () => {
        const response = new Response('<title>x</title>');
        response.headers.delete('content-type');
        return response;
      },
    },
    {
      name: 'more than 1 MB of HTML',
      code: 'unsupported',
      page: () => html(`<html><head>${'<!-- pad -->'.repeat(90_000)}<title>big</title>`),
    },
    { name: 'HTML without any title', code: 'parse_error', page: () => html('<html><body>hi') },
    {
      name: 'a transport failure',
      code: 'network_error',
      page: () => {
        throw new TypeError('t_ socket hang up');
      },
    },
    {
      name: 'a redirect that never ends',
      code: 'unsupported',
      page: () => redirect(`${ARTICLE}?again=${String(Math.random())}`),
    },
  ])(
    'T-ACT-62 non-YouTube and the page is $name → upstream_error with the verbatim message',
    async ({ code, page }) => {
      resolves('blog.example.test');
      routes({ [ARTICLE]: named('page', page) });
      const error = expectFail(await preview(ARTICLE), 'upstream_error');
      expect(error).toEqual({ code: 'upstream_error', message: UNREADABLE });
      expect(error.message).toMatch(/^Couldn't read that page/);
      expectUnreadableLine('page', code);
      expectNothingOfTheUrlInLogs('blog.example.test', 'socket hang up');
      expect(lines({ msg: 'admin' })).toEqual([]);
      expect(tags.calls).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-62 rate limit — 30 / min per admin (04 §5.5 `mention_preview`); the 31st → rate_limited
// ---------------------------------------------------------------------------------------------
describe('T-ACT-62 fetchMentionPreview rate limit', () => {
  it('T-ACT-62 the 31st call in a minute → rate_limited before DNS and before any request; its hit is recorded', async () => {
    const burner = await burnerWithHits(30);

    resolves('blog.example.test');
    const spy = routes({ [ARTICLE]: named('page', html(ogPageHtml)) });
    const limited = expectFail(
      await callActionAs(fetchMentionPreview, { url: ARTICLE }, { profileId: burner }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect(await hits(burner)).toBe(31);
    expect(dns.events).toEqual([]);
    expect(spy.calls).toEqual([]);
    expect(lines({ msg: 'admin' })).toEqual([]);
  });

  it('T-ACT-62 the 30th call still goes through (the budget is per admin — the seed admin is untouched by the burner)', async () => {
    const burner = await burnerWithHits(29);

    resolves('blog.example.test');
    routes({ [ARTICLE]: named('page', html(ogPageHtml)) });
    expectOk(await callActionAs(fetchMentionPreview, { url: ARTICLE }, { profileId: burner }));
    expect(await hits(burner)).toBe(30);
    expect(await hits()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-0 (1) — what is NOT an upstream problem is `internal`, never the fill-by-hand message
// ---------------------------------------------------------------------------------------------
describe('T-ACT-62 fetchMentionPreview faults', () => {
  it('T-ACT-62 rate_limit_ok fails → internal (fail closed): no DNS, no request, no audit line', async () => {
    resolves('blog.example.test');
    const spy = routes({ [ARTICLE]: named('page', html(ogPageHtml)) });
    const res = await withDbFault({ rpc: 'rate_limit_ok' }, {}, () => preview(ARTICLE));
    expectInternal(res, 'fetchMentionPreview', logs);
    expect(dns.events).toEqual([]);
    expect(spy.calls).toEqual([]);
    expect(lines({ msg: 'admin' })).toEqual([]);
  });

  it.each<{ name: string; arm: () => void }>([
    {
      name: 'the guard (step 1)',
      arm: () => {
        sabotage.assertPublicHost = () => Promise.reject(new TypeError('t_ bug in the guard'));
      },
    },
    {
      name: 'oEmbed (step 2)',
      arm: () => {
        sabotage.oembed = () => Promise.reject(new TypeError('t_ bug in the adapter'));
      },
    },
    {
      name: 'the page read (step 4)',
      arm: () => {
        sabotage.fetchOpenGraph = () => Promise.reject(new RangeError('t_ bug in the parser'));
      },
    },
  ])(
    'T-ACT-62 a throw from $name that is NOT an AdapterError → internal + one log.error line — never upstream_error',
    async ({ name, arm }) => {
      arm();
      const youtube = name !== 'the page read (step 4)';
      resolves('www.youtube.com');
      resolves('blog.example.test');
      routes({
        [OEMBED]: named('oembed', json(oembedJson)),
        [VIDEOS]: named('videos', json(videosJson)),
      });
      const res = await preview(youtube ? WATCH : ARTICLE);
      const meta = expectInternal(res, 'fetchMentionPreview', logs);
      expect(['TypeError', 'RangeError']).toContain(meta.name);
      expect(JSON.stringify(logs.lines)).not.toContain('t_ bug');
      expect(lines({ msg: 'unreadable' })).toEqual([]);
      expect(lines({ msg: 'admin' })).toEqual([]);
    },
  );

  it('T-ACT-62 a page read that comes back without a title is unreadable too (the adapter rule, held in the action)', async () => {
    sabotage.fetchOpenGraph = () =>
      Promise.resolve({
        title: '   ',
        image: null,
        site_name: 'Blank Gazette',
        canonical: ARTICLE,
        published_at: null,
        og_type: null,
      });
    resolves('blog.example.test');
    routes({});
    const error = expectFail(await preview(ARTICLE), 'upstream_error');
    expect(error).toEqual({ code: 'upstream_error', message: UNREADABLE });
    expectUnreadableLine('page', 'parse_error');
    expect(lines({ msg: 'admin' })).toEqual([]);
  });
});
