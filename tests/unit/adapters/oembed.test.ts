/**
 * tests/unit/adapters/oembed.test.ts — `lib/adapters/oembed.ts` (05 T-ADP-16 and the oembed half of
 * T-ADP-20; 04 §4.4 export list, §1.6 input rule, §5.4 steps 1 and 4; ADR-0045 — the SSRF guard).
 * Fixtures: `tests/fixtures/oembed/{og-page.html, no-og.html, tiktok.html}` (F-5; hand-made — README).
 * Variants (redirect chains, > 1 MB bodies, other media types, broken markup, 1 MB hostile inputs)
 * are derived in memory (F-6).
 *
 * Nothing here opens a socket OR asks a real resolver (05 H-5): `fetch` and `lookup` are injected in
 * every test, and `node:dns/promises` itself is mocked for the whole file, so the one test of the
 * DEFAULT resolver — and any test that forgot to inject one — never reaches the network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdapterError } from '@/lib/adapters/http';
import {
  DNS_TIMEOUT_MS,
  OG_MAX_BYTES,
  OG_MAX_REDIRECTS,
  OG_TIMEOUT_MS,
  createOembed,
  detectPlatform,
  isPublicAddress,
  parseOpenGraph,
  type LookupAddress,
} from '@/lib/adapters/oembed';
import { loadFixtureText } from '../../helpers/fixtures';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));

const UA = 'odsens.com/test (localhost)';
const ENV = { MODRINTH_USER_AGENT: UA };

const ogPageHtml = await loadFixtureText('oembed', 'og-page.html');
const noOgHtml = await loadFixtureText('oembed', 'no-og.html');
const tiktokHtml = await loadFixtureText('oembed', 'tiktok.html');

/** Public sample addresses — never a TEST-NET / documentation range (those are refused). */
const PUBLIC_V4: LookupAddress = { address: '93.184.216.34', family: 4 };
const PUBLIC_V6: LookupAddress = { address: '2606:4700:4700::1111', family: 6 };

const PAGE = 'https://blockybulletin.example/reviews/metal-pipe-mace';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  dns.lookup.mockReset();
});

const caught = (promise: Promise<unknown>): Promise<AdapterError | null> =>
  promise.then(
    () => null,
    (thrown: unknown) => thrown as AdapterError,
  );

/** A resolver that answers every name with the same (public by default) addresses. */
function lookupAll(addresses: LookupAddress[] = [PUBLIC_V4]) {
  return vi.fn(async (hostname: string) => {
    void hostname;
    return addresses;
  });
}

/** A resolver with one answer per name; an unknown name fails the way getaddrinfo does. */
function lookupMap(map: Record<string, LookupAddress[]>) {
  return vi.fn(async (hostname: string) => {
    const found = map[hostname];
    if (found === undefined) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    }
    return found;
  });
}

const html = (body: string, headers: Record<string, string> = {}): Response =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

const redirect = (location: string | null, status = 302): Response =>
  new Response(null, { status, headers: location === null ? {} : { location } });

/** An injected transport driven by the request URL; records every URL it was asked for. */
function transport(respond: (url: string, request: Request) => Response | Promise<Response>) {
  const urls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    return respond(url, new Request(url, init));
  });
  return { fetch: impl as unknown as typeof fetch, spy: impl, urls };
}

// -----------------------------------------------------------------------------------------------
// detectPlatform
// -----------------------------------------------------------------------------------------------

describe('T-ADP-16 oembed detectPlatform (04 §4.4 hostname map)', () => {
  it.each([
    ['https://www.youtube.com/watch?v=seedvid0001', 'youtube'],
    ['https://youtube.com/shorts/seedvid0001', 'youtube'],
    ['https://m.youtube.com/watch?v=seedvid0001', 'youtube'],
    ['https://music.youtube.com/watch?v=seedvid0001', 'youtube'],
    ['https://youtu.be/seedvid0001', 'youtube'],
    ['http://YOUTU.BE/seedvid0001', 'youtube'],
    ['https://www.youtube.com./watch?v=seedvid0001', 'youtube'], // trailing dot
    ['https://www.tiktok.com/@seedtok/video/1', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc/', 'tiktok'],
    ['https://www.twitch.tv/videos/1', 'twitch'],
    ['https://clips.twitch.tv/SomeClip', 'twitch'],
    ['https://www.reddit.com/r/Minecraft/comments/abc/', 'reddit'],
    ['https://old.reddit.com/r/Minecraft/', 'reddit'],
    ['https://redd.it/abc', 'reddit'],
    ['https://blockybulletin.example/reviews/metal-pipe-mace', 'article'],
    // A dot boundary, not a suffix or a prefix:
    ['https://evilyoutube.com/watch?v=seedvid0001', 'article'],
    ['https://youtube.com.evil.test/watch?v=seedvid0001', 'article'],
    ['https://notyoutu.be/x', 'article'],
    ['https://mytiktok.com/x', 'article'],
    ['https://twitch.tv.evil.test/x', 'article'],
    ['https://example.test/?next=https://youtube.com/', 'article'],
    ['https://youtube.com@evil.test/', 'article'], // `youtube.com` is the userinfo here
    // 04 §4.4 lists youtube.com and youtu.be only — the nocookie embed host is not a mention URL.
    ['https://www.youtube-nocookie.com/embed/seedvid0001', 'article'],
    ['ftp://youtube.com/video', 'article'],
    ['javascript:alert(1)', 'article'],
    ['not a url', 'article'],
    ['', 'article'],
  ] as const)('T-ADP-16 detectPlatform(%j) → %s (never "other")', (url, expected) => {
    expect(detectPlatform(url)).toBe(expected);
  });
});

// -----------------------------------------------------------------------------------------------
// isPublicAddress
// -----------------------------------------------------------------------------------------------

describe('T-ADP-16 oembed isPublicAddress (the classifier behind assertPublicHost)', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '1.0.0.0',
    '9.255.255.255',
    '11.0.0.0',
    '93.184.216.34',
    '100.63.255.255', // just below CGNAT
    '100.128.0.1', // just above CGNAT
    '126.255.255.255',
    '128.0.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '172.15.255.255',
    '172.32.0.1',
    '192.0.1.1',
    '192.167.255.255',
    '192.169.0.0',
    '198.17.255.255',
    '198.20.0.0',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2607:f8b0:4004:c07::5b',
    '2a00:1450:4001::200e',
    '2001:200::1', // global unicast just past the 2001::/23 carve-out
    '2003::1',
    '2606:4700:4700::1111%en0', // a zone suffix is ignored, the address decides
  ])('T-ADP-16 isPublicAddress(%j) → true', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['0.0.0.0', 'this network'],
    ['0.1.2.3', 'this network'],
    ['0.255.255.255', 'this network'],
    ['10.0.0.0', 'RFC1918'],
    ['10.1.2.3', 'RFC1918'],
    ['10.255.255.255', 'RFC1918'],
    ['100.64.0.0', 'CGNAT'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.255', 'CGNAT'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.0.0', 'link-local'],
    ['169.254.169.254', 'link-local — cloud metadata'],
    ['169.254.255.255', 'link-local'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.255', 'RFC1918'],
    ['192.168.0.0', 'RFC1918'],
    ['192.168.1.1', 'RFC1918'],
    ['192.168.255.255', 'RFC1918'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['198.51.100.7', 'TEST-NET-2'],
    ['203.0.113.9', 'TEST-NET-3'],
    ['192.88.99.1', '6to4 relay'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex form'],
    ['::ffff:10.0.0.1', 'IPv4-mapped RFC1918'],
    ['::ffff:8.8.8.8', 'IPv4-mapped — refused outright, public or not'],
    ['::ffff:0808:0808', 'IPv4-mapped, hex form'],
    ['::7f00:1', 'IPv4-compatible'],
    ['::127.0.0.1', 'IPv4-compatible'],
    ['64:ff9b::7f00:1', 'NAT64 → loopback'],
    ['64:ff9b::8.8.8.8', 'NAT64 — refused outright'],
    ['64:ff9b:1::1', 'local-use NAT64'],
    ['100::1', 'discard-only'],
    ['fc00::1', 'ULA'],
    ['fd12:3456::1', 'ULA'],
    ['fdff:ffff::1', 'ULA'],
    ['fe80::1', 'link-local'],
    ['fe80::1%en0', 'link-local with a zone'],
    ['febf::1', 'link-local'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
    ['ff0e::1', 'multicast'],
    ['2001::1', 'Teredo'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
    ['2001:1ff::1', 'IETF protocol assignments'],
    ['2001:db8::1', 'documentation'],
    ['2002:7f00:1::1', '6to4 → loopback'],
    ['2002:a00:1::1', '6to4 → RFC1918'],
    ['3fff::1', 'documentation'],
    ['4000::1', 'outside global unicast'],
    ['1fff::1', 'outside global unicast'],
    ['not-an-ip', 'not an address'],
    ['', 'not an address'],
    ['127.0.0.1.', 'not an address'],
    ['010.0.0.1', 'not an address (leading zero)'],
    ['1.2.3', 'not an address (short form is a URL-parser thing)'],
    ['0x7f.0.0.1', 'not an address'],
    ['[::1]', 'not an address (brackets)'],
    ['8.8.8.8 ', 'not an address (trailing space)'],
    ['example.test', 'a name'],
  ])('T-ADP-16 isPublicAddress(%j) → false (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------------
// assertPublicHost
// -----------------------------------------------------------------------------------------------

describe('T-ADP-16 oembed assertPublicHost (04 §4.4, §1.6, §5.4 step 1 — DNS resolver injected)', () => {
  it('T-ADP-16 assertPublicHost: a public https page → the normalised URL; the resolver is asked once, for the hostname; no request is made', async () => {
    const lookup = lookupAll([PUBLIC_V4, PUBLIC_V6]);
    const { fetch: impl, spy } = transport(() => html('never'));
    const oembed = createOembed({ fetch: impl, env: ENV, lookup });
    const url = await oembed.assertPublicHost(`${PAGE}?ref=1#comments`);
    expect(url).toBeInstanceOf(URL);
    expect(url.href).toBe(`${PAGE}?ref=1`); // the fragment is dropped
    expect(lookup.mock.calls).toEqual([['blockybulletin.example']]);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['http://blockybulletin.example/a?b=1', 'https://blockybulletin.example/a?b=1'],
    ['http://blockybulletin.example:80/a', 'https://blockybulletin.example/a'],
    ['http://blockybulletin.example:443/a', 'https://blockybulletin.example/a'],
    ['https://blockybulletin.example:443/a', 'https://blockybulletin.example/a'],
    ['HTTP://BlockyBulletin.EXAMPLE/A', 'https://blockybulletin.example/A'],
    ['http:/blockybulletin.example', 'https://blockybulletin.example/'],
    ['http://@blockybulletin.example/', 'https://blockybulletin.example/'], // empty userinfo is no userinfo
  ])(
    'T-ADP-16 assertPublicHost: %j is upgraded / normalised to %j — never a cleartext URL',
    async (input, expected) => {
      const oembed = createOembed({ env: ENV, lookup: lookupAll() });
      expect((await oembed.assertPublicHost(input)).href).toBe(expected);
    },
  );

  it('T-ADP-16 assertPublicHost: upper-case, trailing-dot and IDN hosts are resolved — and returned — in their normalised form', async () => {
    const lookup = lookupAll();
    const oembed = createOembed({ env: ENV, lookup });
    expect((await oembed.assertPublicHost('https://BLOCKYBULLETIN.example./a')).href).toBe(
      'https://blockybulletin.example/a',
    );
    expect((await oembed.assertPublicHost('https://blockybulletin.example.../a')).href).toBe(
      'https://blockybulletin.example/a',
    );
    expect((await oembed.assertPublicHost('https://bücher.example/a')).href).toBe(
      'https://xn--bcher-kva.example/a',
    );
    expect((await oembed.assertPublicHost('https://xn--bcher-kva.example/a')).hostname).toBe(
      'xn--bcher-kva.example',
    );
    expect(lookup.mock.calls.map((call) => call[0])).toEqual([
      'blockybulletin.example',
      'blockybulletin.example',
      'xn--bcher-kva.example',
      'xn--bcher-kva.example',
    ]);
  });

  it('T-ADP-16 assertPublicHost: a public IP literal passes WITHOUT a DNS query', async () => {
    const lookup = lookupAll();
    const oembed = createOembed({ env: ENV, lookup });
    expect((await oembed.assertPublicHost('https://93.184.216.34/x')).href).toBe(
      'https://93.184.216.34/x',
    );
    expect((await oembed.assertPublicHost('http://[2606:4700:4700::1111]/x')).href).toBe(
      'https://[2606:4700:4700::1111]/x',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    // --- not a URL / not http(s) ---
    ['', 'empty'],
    ['not a url', 'not a url'],
    ['//blockybulletin.example/x', 'scheme-relative'],
    ['http://', 'empty host'],
    ['https://./', 'a host of dots'],
    ['https://../x', 'a host of dots'],
    ['blockybulletin.example/x', 'no scheme'],
    ['file:///etc/passwd', 'file:'],
    ['javascript:alert(1)', 'javascript:'],
    ['data:text/html,<title>x</title>', 'data:'],
    ['ftp://blockybulletin.example/x', 'ftp:'],
    ['gopher://blockybulletin.example/x', 'gopher:'],
    ['ws://blockybulletin.example/x', 'ws:'],
    ['blob:https://blockybulletin.example/uuid', 'blob:'],
    ['view-source:https://blockybulletin.example/', 'view-source:'],
    // --- userinfo ---
    ['https://user:pass@blockybulletin.example/', 'userinfo'],
    ['https://user@blockybulletin.example/', 'userinfo, no password'],
    ['https://:pass@blockybulletin.example/', 'userinfo, no user'],
    ['https://blockybulletin.example%2f@127.0.0.1/', 'userinfo hiding the real host'],
    ['https://blockybulletin.example@127.0.0.1/', 'userinfo hiding the real host'],
    // --- ports ---
    ['https://blockybulletin.example:8443/', 'non-default port'],
    ['https://blockybulletin.example:80/', 'the http port over https'],
    ['http://blockybulletin.example:8080/', 'http on a port the upgrade cannot drop'],
    ['http://blockybulletin.example:8443/', 'http on a port the upgrade cannot drop'],
    ['https://93.184.216.34:8080/', 'a public literal on another port'],
    ['https://blockybulletin.example:22/', 'ssh port'],
    // --- IPv4 literals, every spelling the URL parser accepts ---
    ['http://127.0.0.1/', 'loopback'],
    ['https://127.0.0.1/', 'loopback'],
    ['http://2130706433/', 'loopback, decimal'],
    ['http://0x7f000001/', 'loopback, hex'],
    ['http://0x7f.1/', 'loopback, hex short form'],
    ['http://017700000001/', 'loopback, octal'],
    ['http://0177.0.0.1/', 'loopback, octal first part'],
    ['http://127.1/', 'loopback, short form'],
    ['http://127.0.1/', 'loopback, short form'],
    ['http://１２７.０.０.１/', 'loopback, full-width digits'],
    ['http://127.0.0.1./', 'loopback, trailing dot'],
    ['http://0/', '0.0.0.0, short form'],
    ['http://0.0.0.0/', 'unspecified'],
    ['https://255.255.255.255/', 'broadcast'],
    ['https://224.0.0.1/', 'multicast'],
    ['https://10.0.0.5/', 'RFC1918'],
    ['https://172.16.0.1/', 'RFC1918'],
    ['https://172.31.255.255/', 'RFC1918'],
    ['https://192.168.1.1/', 'RFC1918'],
    ['http://3232235777/', 'RFC1918, decimal (192.168.1.1)'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local — cloud metadata'],
    ['http://0xa9fea9fe/', 'cloud metadata, hex'],
    ['https://100.64.0.1/', 'CGNAT'],
    ['https://192.0.2.1/', 'TEST-NET-1'],
    // --- IPv6 literals ---
    ['http://[::1]/', 'loopback'],
    ['http://[0:0:0:0:0:0:0:1]/', 'loopback, long form'],
    ['http://[::]/', 'unspecified'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
    ['http://[::ffff:7f00:1]/', 'IPv4-mapped loopback, hex form'],
    ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped metadata'],
    ['http://[::ffff:8.8.8.8]/', 'IPv4-mapped — refused outright'],
    ['http://[::127.0.0.1]/', 'IPv4-compatible'],
    ['http://[64:ff9b::7f00:1]/', 'NAT64 → loopback'],
    ['http://[64:ff9b::a9fe:a9fe]/', 'NAT64 → metadata'],
    ['http://[fc00::1]/', 'ULA'],
    ['http://[fd00:ec2::254]/', 'ULA — the IPv6 metadata address'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[2002:7f00:1::1]/', '6to4 → loopback'],
    ['http://[2001::1]/', 'Teredo'],
    ['http://[2001:db8::1]/', 'documentation'],
    ['http://[ff02::1]/', 'multicast'],
    // --- hosts the URL parser itself refuses ---
    ['http://256.1.1.1/', 'not an IPv4 address'],
    ['http://1.2.3.4.5/', 'not an IPv4 address'],
    ['http://[fe80::1%25eth0]/', 'a zone id in a URL'],
    ['http://[::1/', 'unterminated bracket'],
    ['http://a b/', 'a space in the host'],
    // --- names ---
    ['http://localhost/', 'localhost'],
    ['https://LOCALHOST/', 'localhost, upper-case'],
    ['https://localhost./', 'localhost, trailing dot'],
    ['https://localhost../', 'localhost, two trailing dots'],
    ['https://foo.localhost/', '*.localhost'],
    ['https://FOO.LocalHost./', '*.localhost, upper-case, trailing dot'],
    ['https://x.local/', '*.local'],
    ['https://printer.LOCAL./', '*.local, upper-case, trailing dot'],
    ['https://x.internal/', '*.internal'],
    ['https://metadata.google.internal/computeMetadata/v1/', '*.internal — cloud metadata'],
    ['https://router.home.arpa/', '*.home.arpa'],
    ['https://nas.lan/', '*.lan'],
    ['https://wiki.corp/', '*.corp'],
    ['https://wiki.intranet/', '*.intranet'],
    ['https://tv.home/', '*.home'],
    ['https://intranet/', 'a single-label host'],
    ['https://metadata/', 'a single-label host'],
    ['https://xn--lcalhost-54a/', 'a single-label punycode host'],
  ])(
    'T-ADP-16 assertPublicHost(%j) → typed rejected (%s) — no DNS query, no request',
    async (input) => {
      const lookup = lookupAll();
      const { fetch: impl, spy } = transport(() => html('never'));
      const oembed = createOembed({ fetch: impl, env: ENV, lookup });
      const error = await caught(oembed.assertPublicHost(input));
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status: 0, code: 'rejected', body: '' });
      expect(lookup).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('T-ADP-16 assertPublicHost: a URL over 2,048 chars is rejected before it is even parsed', async () => {
    const lookup = lookupAll();
    const oembed = createOembed({ env: ENV, lookup });
    const long = `${PAGE}?q=${'a'.repeat(2048)}`;
    expect(await caught(oembed.assertPublicHost(long))).toMatchObject({ code: 'rejected' });
    expect(lookup).not.toHaveBeenCalled();
    const fits = `${PAGE}?q=${'a'.repeat(2048 - PAGE.length - 3)}`;
    expect(fits).toHaveLength(2048);
    expect((await oembed.assertPublicHost(fits)).href).toBe(fits);
  });

  it.each([
    ['loopback', [{ address: '127.0.0.1', family: 4 }]],
    ['RFC1918 10/8', [{ address: '10.0.0.5', family: 4 }]],
    ['RFC1918 172.16/12', [{ address: '172.16.4.4', family: 4 }]],
    ['RFC1918 192.168/16', [{ address: '192.168.0.10', family: 4 }]],
    ['link-local (cloud metadata)', [{ address: '169.254.169.254', family: 4 }]],
    ['CGNAT', [{ address: '100.64.1.1', family: 4 }]],
    ['0.0.0.0', [{ address: '0.0.0.0', family: 4 }]],
    ['IPv6 loopback', [{ address: '::1', family: 6 }]],
    ['IPv6 ULA', [{ address: 'fd12:3456:789a::1', family: 6 }]],
    ['IPv6 link-local with a zone', [{ address: 'fe80::1%en0', family: 6 }]],
    ['IPv4-mapped loopback', [{ address: '::ffff:127.0.0.1', family: 6 }]],
    ['NAT64', [{ address: '64:ff9b::a00:1', family: 6 }]],
    ['a MIX — public first, private second', [PUBLIC_V4, { address: '10.0.0.5', family: 4 }]],
    ['a MIX — private first, public second', [{ address: '127.0.0.1', family: 4 }, PUBLIC_V4]],
    ['a MIX — public A, private AAAA', [PUBLIC_V4, PUBLIC_V6, { address: '::1', family: 6 }]],
    ['no address at all', []],
    ['an answer that is not an address', [{ address: 'blockybulletin.example', family: 4 }]],
    ['an empty address', [{ address: '', family: 4 }]],
  ] as [string, LookupAddress[]][])(
    'T-ADP-16 assertPublicHost: a hostname resolving to %s → typed rejected — EVERY address must be public',
    async (_label, addresses) => {
      const lookup = lookupAll(addresses);
      const oembed = createOembed({ env: ENV, lookup });
      const error = await caught(oembed.assertPublicHost('https://rebind.example/page?token=t0k'));
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status: 0, code: 'rejected', body: '' });
      expect(lookup).toHaveBeenCalledTimes(1);
      // The message names the origin and nothing else: no path, no query, no resolved address.
      expect(error?.message).toBe('GET https://rebind.example → rejected (address)');
    },
  );

  it('T-ADP-16 assertPublicHost: a resolver that fails (ENOTFOUND), throws synchronously or answers garbage is a typed network_error / rejected — never a crash', async () => {
    const notFound = createOembed({ env: ENV, lookup: lookupMap({}) });
    const error = await caught(notFound.assertPublicHost('https://nowhere.example/x?key=hunter2'));
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 0, code: 'network_error', body: '' });
    expect(error?.message).toBe('GET https://nowhere.example → network_error (dns)');
    expect(error?.message).not.toContain('ENOTFOUND');

    const sync = createOembed({
      env: ENV,
      lookup: (() => {
        throw new TypeError('resolver exploded');
      }) as never,
    });
    expect(await caught(sync.assertPublicHost(PAGE))).toMatchObject({ code: 'network_error' });
  });

  it('T-ADP-16 assertPublicHost: a resolver that never answers is cut off after 3 s → typed network_error', async () => {
    vi.useFakeTimers();
    const hung = createOembed({ env: ENV, lookup: () => new Promise<LookupAddress[]>(() => {}) });
    const settled = caught(hung.assertPublicHost(PAGE));
    await vi.advanceTimersByTimeAsync(DNS_TIMEOUT_MS - 1);
    let done = false;
    void settled.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toMatchObject({ status: 0, code: 'network_error' });
    expect(vi.getTimerCount()).toBe(0); // the timer never outlives the race
  });

  it('T-ADP-16 assertPublicHost: error messages never carry the path, the query, the userinfo or a resolved address', async () => {
    const oembed = createOembed({
      env: ENV,
      lookup: lookupAll([{ address: '10.9.8.7', family: 4 }]),
    });
    const inputs = [
      'https://secret-user:secret-pass@blockybulletin.example/private/path?token=t0ken',
      'https://blockybulletin.example:8443/private/path?token=t0ken',
      'https://blockybulletin.example/private/path?token=t0ken',
      'ftp://blockybulletin.example/private/path?token=t0ken',
      'https://127.0.0.1/private/path?token=t0ken',
      `not a url /private/path?token=t0ken`,
    ];
    for (const input of inputs) {
      const error = await caught(oembed.assertPublicHost(input));
      expect(error).toBeInstanceOf(AdapterError);
      for (const secret of ['secret-user', 'secret-pass', 'private/path', 't0ken', '10.9.8.7']) {
        expect(`${error?.message ?? ''} ${error?.body ?? ''}`).not.toContain(secret);
      }
    }
  });

  it('T-ADP-16 assertPublicHost: with no resolver injected it asks node:dns/promises lookup(host, {all: true}) — getaddrinfo, every address', async () => {
    dns.lookup.mockResolvedValueOnce([PUBLIC_V4, PUBLIC_V6]);
    const oembed = createOembed({ env: ENV });
    expect((await oembed.assertPublicHost(PAGE)).href).toBe(PAGE);
    expect(dns.lookup.mock.calls).toEqual([['blockybulletin.example', { all: true }]]);

    dns.lookup.mockResolvedValueOnce([PUBLIC_V4, { address: '127.0.0.1', family: 4 }]);
    expect(await caught(oembed.assertPublicHost(PAGE))).toMatchObject({ code: 'rejected' });
  });
});

// -----------------------------------------------------------------------------------------------
// parseOpenGraph
// -----------------------------------------------------------------------------------------------

describe('T-ADP-16 oembed parseOpenGraph (hand-rolled reader — fixtures + in-memory variants)', () => {
  const meta = (inner: string): string => `<html><head>${inner}</head><body></body></html>`;

  it('T-ADP-16 og-page.html → {title: og:title, image, site_name, canonical: og:url, published_at, og_type}; decoys in a comment / script / style lose; the first og:title wins', () => {
    expect(parseOpenGraph(ogPageHtml, `${PAGE}?utm_source=feed`)).toEqual({
      // `&amp;` and `&#39;` decoded, the run of spaces collapsed; NOT the <title>, NOT a decoy.
      title: "Metal Pipe Mace & friends: the loudest mod we've tried",
      image: 'https://blockybulletin.example/img/metal-pipe-mace.png',
      site_name: 'Blocky Bulletin', // written name='og:site_name', single quotes, content first
      canonical: PAGE,
      published_at: '2026-06-20T07:30:00.000Z', // a <meta> inside <body>, +02:00 normalised
      og_type: 'article', // <META PROPERTY=… CONTENT=article> — upper-case tag, unquoted value
    });
  });

  it('T-ADP-16 no-og.html → title from <title> (entity decoded, newlines collapsed), image null, canonical = the requested url', () => {
    const url = 'https://cobblepost.example/notes/24?page=2';
    expect(parseOpenGraph(noOgHtml, url)).toEqual({
      title: 'Patch notes — week 24 | The Cobble Post',
      image: null,
      site_name: null,
      canonical: url,
      published_at: null,
      og_type: null,
    });
  });

  it('T-ADP-16 tiktok.html → the TikTok-shaped head; the rehydration JSON decoy inside <script> loses', () => {
    expect(parseOpenGraph(tiktokHtml, 'https://www.tiktok.com/@seedtok/video/1?lang=en')).toEqual({
      title: 'this mod makes no sense and I love it',
      image:
        'https://p16-sign.tiktokcdn.example/obj/seedtok-cover-1.jpeg?x-expires=1790000000&x-signature=fixture',
      site_name: 'TikTok',
      canonical: 'https://www.tiktok.com/@seedtok/video/1',
      published_at: null,
      og_type: 'video.other',
    });
  });

  it.each([
    ['double quotes', '<meta property="og:title" content="Hello">'],
    ['single quotes', "<meta property='og:title' content='Hello'>"],
    ['no quotes', '<meta property=og:title content=Hello>'],
    ['content before the key', '<meta content="Hello" property="og:title">'],
    ['name instead of property', '<meta name="og:title" content="Hello">'],
    ['upper-case tag and attributes', '<META PROPERTY="OG:TITLE" CONTENT="Hello">'],
    ['self-closing', '<meta property="og:title" content="Hello"/>'],
    ['self-closing with a space', '<meta property="og:title" content="Hello" />'],
    [
      'other attributes around',
      '<meta data-rh="true" property="og:title" id=t content="Hello" lang=en>',
    ],
    ['spaces around =', '<meta property = "og:title" content = "Hello">'],
    [
      'newlines and tabs between attributes',
      '<meta\n\tproperty="og:title"\r\n\tcontent="Hello"\n>',
    ],
    ['a > inside a quoted value', '<meta data-x="a > b" property="og:title" content="Hello">'],
    ['a valueless attribute', '<meta hidden property="og:title" content="Hello">'],
    ['a stray =', '<meta = property="og:title" content="Hello">'],
    ['whitespace inside the key', '<meta property=" og:title " content="Hello">'],
    ['in <body>', '</head><body><p>x</p><meta property="og:title" content="Hello">'],
    ['no <head> at all', '<meta property="og:title" content="Hello"><p>text'],
    [
      'after junk markup',
      '<<< <m <metadata x="1"> <met <meta property="og:title" content="Hello">',
    ],
  ])('T-ADP-16 parseOpenGraph reads a <meta> written with %s', (_label, tag) => {
    expect(parseOpenGraph(meta(tag), PAGE).title).toBe('Hello');
  });

  it.each([
    ['an HTML comment', '<!-- <meta property="og:title" content="DECOY"> -->'],
    ['a <script>', '<script>var s = \'<meta property="og:title" content="DECOY">\';</script>'],
    [
      'an upper-case <SCRIPT type=…>',
      '<SCRIPT type="text/template"><meta property="og:title" content="DECOY"></SCRIPT>',
    ],
    [
      'a <style>',
      '<style>a::after{content:\'<meta property="og:title" content="DECOY">\'}</style>',
    ],
    ['a <noscript>', '<noscript><meta property="og:title" content="DECOY"></noscript>'],
    ['a <template>', '<template><meta property="og:title" content="DECOY"></template>'],
    ['a <textarea>', '<textarea><meta property="og:title" content="DECOY"></textarea>'],
    ['an <iframe>', '<iframe><meta property="og:title" content="DECOY"></iframe>'],
    [
      'a quoted attribute of another <meta>',
      '<meta name="x" content=\'<meta property="og:title" content="DECOY">\'>',
    ],
    ['the short comment <!--> … -->', '<!--><meta property="og:title" content="REAL-A"><!-- x -->'],
  ])('T-ADP-16 parseOpenGraph ignores a <meta> inside %s', (label, decoy) => {
    const page = meta(`${decoy}<meta property="og:title" content="Real">`);
    // `<!-->` is a whole (empty) comment, so what follows it IS markup — the one case where the first tag counts.
    expect(parseOpenGraph(page, PAGE).title).toBe(
      label.startsWith('the short') ? 'REAL-A' : 'Real',
    );
  });

  it('T-ADP-16 parseOpenGraph: an unterminated comment / <script> / <style> swallows the rest of the document — what came before still counts', () => {
    for (const opener of ['<!-- never closed', '<script>never closed', '<style>never closed']) {
      const page = meta(
        `<meta property="og:title" content="Before">${opener}<meta property="og:site_name" content="DECOY">`,
      );
      expect(parseOpenGraph(page, PAGE)).toMatchObject({ title: 'Before', site_name: null });
    }
  });

  it('T-ADP-16 parseOpenGraph: the first NON-EMPTY value of a key wins; an empty / whitespace-only / missing content never claims it; duplicate attributes — the first counts', () => {
    const page = meta(
      '<meta property="og:title" content="">' +
        '<meta property="og:title" content="   ">' +
        '<meta property="og:title">' +
        '<meta property="og:title" content="First real" content="second attribute loses">' +
        '<meta property="og:title" content="Later">',
    );
    expect(parseOpenGraph(page, PAGE).title).toBe('First real');
  });

  it('T-ADP-16 parseOpenGraph: <title> is the fallback only — first <title>, attributes allowed, entities decoded, never a look-alike tag', () => {
    expect(parseOpenGraph('<title>Only title</title>', PAGE).title).toBe('Only title');
    expect(
      parseOpenGraph('<TITLE data-rh="true">\n  Upper &amp; spaced \n</TITLE>', PAGE).title,
    ).toBe('Upper & spaced');
    expect(
      parseOpenGraph('<titles>no</titles><title>Real</title><title>Second</title>', PAGE).title,
    ).toBe('Real');
    expect(
      parseOpenGraph('<title>Element</title><meta property="og:title" content="OG wins">', PAGE)
        .title,
    ).toBe('OG wins');
    // An unterminated <title> reads to the end of the document; a <meta> inside title text is text.
    expect(parseOpenGraph('<title>Runs on', PAGE).title).toBe('Runs on');
    expect(
      parseOpenGraph('<title>T <meta property="og:title" content="DECOY"></title>', PAGE).title,
    ).toBe('T <meta property="og:title" content="DECOY">');
  });

  it('T-ADP-16 parseOpenGraph: entities are decoded ONCE; junk code points stay literal; control characters and bidi overrides are dropped', () => {
    const rlo = String.fromCharCode(0x202e);
    const nul = String.fromCharCode(0);
    const page = meta(
      `<meta property="og:title" content="Tom &amp; Jerry &lt;3 &quot;q&quot; &apos;a&apos; &#39;d&#39; &#x1F600; &amp;lt; &nbsp;&mdash;&nbsp; &bogus; &#0; &#xD800; &#x110000; &#99999999; x${rlo}y${nul}z&#8238;w&#9;v">`,
    );
    expect(parseOpenGraph(page, PAGE).title).toBe(
      `Tom & Jerry <3 "q" 'a' 'd' 😀 &lt; — &bogus; &#0; &#xD800; &#x110000; &#99999999; x y z w v`,
    );
  });

  it('T-ADP-16 parseOpenGraph caps lengths — title 200, site_name 80, og_type 40 — without splitting a surrogate pair', () => {
    const page = meta(
      `<meta property="og:title" content="${'t'.repeat(199)}😀 tail">` +
        `<meta property="og:site_name" content="${'s'.repeat(300)}">` +
        `<meta property="og:type" content="${'y'.repeat(300)}">`,
    );
    const parsed = parseOpenGraph(page, PAGE);
    expect(parsed.title).toBe('t'.repeat(199)); // the emoji would straddle unit 200 — dropped whole
    expect(parsed.site_name).toBe('s'.repeat(80));
    expect(parsed.og_type).toBe('y'.repeat(40));
    const fits = parseOpenGraph(
      meta(`<meta property="og:title" content="${'t'.repeat(198)}😀">`),
      PAGE,
    );
    expect(fits.title).toBe(`${'t'.repeat(198)}😀`);
    expect(
      parseOpenGraph(`<title>${'long '.repeat(2000)}</title>`, PAGE).title.length,
    ).toBeLessThanOrEqual(200);
  });

  it.each([
    ['https://cdn.blockybulletin.example/a.png', 'https://cdn.blockybulletin.example/a.png'],
    ['/img/a.png', 'https://blockybulletin.example/img/a.png'],
    ['img/a.png?x=1&amp;y=2', 'https://blockybulletin.example/reviews/img/a.png?x=1&y=2'],
    ['//cdn.blockybulletin.example/a.png', 'https://cdn.blockybulletin.example/a.png'],
    ['https://CDN.BlockyBulletin.example./a.png#frag', 'https://cdn.blockybulletin.example/a.png'],
    ['http://cdn.blockybulletin.example/a.png', null], // not https — the page said what it said
    ['javascript:alert(1)', null],
    ['data:image/png;base64,AAAA', null],
    ['https://user:pw@cdn.blockybulletin.example/a.png', null],
    ['https://cdn.blockybulletin.example:8443/a.png', null],
    ['https://127.0.0.1/a.png', null],
    ['https://[::1]/a.png', null],
    ['https://localhost/a.png', null],
    ['https://printer.local/a.png', null],
    ['https://intranet/a.png', null],
    ['https://[bad/a.png', null],
    [`https://cdn.blockybulletin.example/${'a'.repeat(2100)}.png`, null],
  ])(
    'T-ADP-16 parseOpenGraph og:image %j → %j (https + public-looking only)',
    (value, expected) => {
      const page = meta(`<title>T</title><meta property="og:image" content="${value}">`);
      expect(parseOpenGraph(page, PAGE).image).toBe(expected);
    },
  );

  it.each([
    ['https://blockybulletin.example/canonical', 'https://blockybulletin.example/canonical'],
    [
      'https://www.blockybulletin.example./canonical#top',
      'https://www.blockybulletin.example/canonical',
    ],
    ['http://blockybulletin.example/canonical', PAGE],
    ['/canonical', PAGE], // og:url must be absolute
    ['javascript:alert(1)', PAGE],
    ['https://user@blockybulletin.example/canonical', PAGE],
    ['https://blockybulletin.example:8443/canonical', PAGE],
    ['https://169.254.169.254/latest/', PAGE],
    ['https://localhost/canonical', PAGE],
    ['not a url', PAGE],
  ])(
    'T-ADP-16 parseOpenGraph og:url %j → canonical %j (else the requested url)',
    (value, expected) => {
      const page = meta(`<title>T</title><meta property="og:url" content="${value}">`);
      expect(parseOpenGraph(page, PAGE).canonical).toBe(expected);
    },
  );

  it.each([
    ['2026-06-14T16:00:00Z', '2026-06-14T16:00:00.000Z'],
    ['2026-06-14T16:00:00.123Z', '2026-06-14T16:00:00.123Z'],
    ['2026-06-14T16:00:00+02:00', '2026-06-14T14:00:00.000Z'],
    ['2026-06-14T16:00:00-0530', '2026-06-14T21:30:00.000Z'],
    ['2026-06-14T16:00', '2026-06-14T16:00:00.000Z'], // no offset → UTC, whatever the server's zone
    ['2026-06-14 16:00:00', '2026-06-14T16:00:00.000Z'],
    ['2026-06-14t16:00:00z', '2026-06-14T16:00:00.000Z'],
    ['2026-06-14', '2026-06-14T00:00:00.000Z'],
    ['2026-13-45T00:00:00Z', null],
    ['2026-06-14T25:00:00Z', null],
    ['June 14, 2026', null],
    ['1781452800', null],
    ['yesterday', null],
  ])('T-ADP-16 parseOpenGraph article:published_time %j → %j', (value, expected) => {
    const page = meta(
      `<title>T</title><meta property="article:published_time" content="${value}">`,
    );
    expect(parseOpenGraph(page, PAGE).published_at).toBe(expected);
  });

  it('T-ADP-16 parseOpenGraph: no og:title and no <title> → typed parse_error naming the origin only, with an EMPTY body (the page is never echoed)', () => {
    for (const page of [
      '',
      '<html><body><p>secret intranet text</p></body></html>',
      '<title>  </title>',
    ]) {
      let thrown: unknown;
      try {
        parseOpenGraph(page, `${PAGE}?token=t0ken`);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AdapterError);
      expect(thrown).toMatchObject({ status: 200, code: 'parse_error', body: '' });
      expect((thrown as AdapterError).message).toBe(
        'GET https://blockybulletin.example → parse_error (no title)',
      );
    }
    // A caller that passes something that is not a URL still gets a typed error and a usable result.
    expect(() => parseOpenGraph('', 'nonsense')).toThrow('GET (page) → parse_error (no title)');
    expect(
      parseOpenGraph('<title>T</title><meta property="og:image" content="/a.png">', 'nonsense'),
    ).toMatchObject({ title: 'T', image: null, canonical: 'nonsense' });
  });

  it('T-ADP-16 parseOpenGraph: a tag with no > inside 4,096 chars is skipped whole — and the scan carries on after it', () => {
    const unterminated = `<meta property="og:title" content="DECOY" ${'x'.repeat(5000)}`;
    expect(
      parseOpenGraph(`${unterminated}<meta property="og:title" content="After the cap">`, PAGE)
        .title,
    ).toBe('After the cap');
    // An unclosed quote: the tag is abandoned at the cap, not read to the end of the document.
    const unclosed = `<meta property="og:site_name" content="never closed ${'y'.repeat(5000)}`;
    expect(
      parseOpenGraph(
        `<title>T</title>${unclosed}<meta property="og:type" content="article">`,
        PAGE,
      ),
    ).toMatchObject({ title: 'T', site_name: null, og_type: 'article' });
    // A document that ends inside a tag.
    expect(
      parseOpenGraph('<title>T</title><meta property="og:type" content="article"', PAGE).og_type,
    ).toBeNull();
    expect(
      parseOpenGraph('<title>T</title><meta property="og:type" content=', PAGE).og_type,
    ).toBeNull();
    expect(parseOpenGraph('<title>T</title><meta', PAGE).title).toBe('T');
    expect(() => parseOpenGraph('<title', PAGE)).toThrow(AdapterError); // `<title` with no `>`
  });

  it('T-ADP-16 parseOpenGraph is linear in the input: 1 MB of hostile markup of every shape parses in well under a second each', () => {
    const fill = (unit: string): string => unit.repeat(Math.ceil(OG_MAX_BYTES / unit.length));
    const hostile = [
      fill('<'),
      fill('<meta '),
      fill('<meta a="'),
      fill("<meta a='b' "),
      fill('<meta content=x property=og:title>'),
      fill('<title'),
      fill('<title>'),
      fill('<!--'),
      fill('<!-->'),
      fill('<script'),
      fill('<script>'),
      fill('<script></script><style></style>'),
      fill('<noscript><template>'),
      fill('&amp;'),
      fill('&#x'),
      fill('= = = ='),
      fill('<meta ' + ' '.repeat(5000)),
      `<title>${fill('&')}`,
      `<meta property="og:title" content="${fill(' ')}">`,
      'İ'.repeat(OG_MAX_BYTES / 2) + '<meta property="og:title" content="offsets survive">',
    ];
    for (const page of hostile) {
      const started = performance.now();
      try {
        parseOpenGraph(`<title>T</title>${page}`, PAGE);
      } catch (error) {
        expect(error).toBeInstanceOf(AdapterError); // a parse_error is a fine answer; a hang is not
      }
      expect(performance.now() - started).toBeLessThan(2_500);
    }
    // `String#toLowerCase` would shift every offset after a `İ`; the ASCII-only fold does not.
    expect(parseOpenGraph(hostile.at(-1) ?? '', PAGE).title).toBe('offsets survive');
  });
});

// -----------------------------------------------------------------------------------------------
// fetchOpenGraph
// -----------------------------------------------------------------------------------------------

describe('T-ADP-16 oembed fetchOpenGraph (04 §4.4, §5.4 step 4 — ≤ 3 manual redirects, every hop guarded)', () => {
  it('T-ADP-16 fetchOpenGraph(og-page.html): ONE guarded GET — https, redirect manual, the SC-10 UA, Accept text/html, no cookies / auth, ≤ 10 s — → the six parsed fields and nothing else', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const seen: Record<string, unknown> = {};
    const {
      fetch: impl,
      spy,
      urls,
    } = transport((_url, request) => {
      seen.method = request.method;
      seen.redirect = request.redirect;
      seen.headers = Object.fromEntries(request.headers.entries());
      return html(ogPageHtml);
    });
    const lookup = lookupAll();
    const oembed = createOembed({ fetch: impl, env: ENV, lookup });
    // Pasted as http with a fragment: what is requested is the guard's normalised https URL.
    const result = await oembed.fetchOpenGraph(`${PAGE.replace('https:', 'http:')}?ref=1#top`);

    expect(result).toEqual(parseOpenGraph(ogPageHtml, `${PAGE}?ref=1`));
    expect(Object.keys(result).sort()).toEqual([
      'canonical',
      'image',
      'og_type',
      'published_at',
      'site_name',
      'title',
    ]);
    expect(JSON.stringify(result)).not.toContain('We tried it on every mob'); // never the body
    expect(urls).toEqual([`${PAGE}?ref=1`]);
    expect(seen).toEqual({
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'text/html', 'user-agent': UA },
    });
    expect(Object.keys(spy.mock.calls[0]?.[1] ?? {})).toEqual([
      'method',
      'headers',
      'redirect',
      'signal',
    ]);
    expect(lookup.mock.calls).toEqual([['blockybulletin.example']]);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    const budget = timeoutSpy.mock.calls[0]?.[0] ?? 0;
    expect(budget).toBeGreaterThan(OG_TIMEOUT_MS - 2_000);
    expect(budget).toBeLessThanOrEqual(OG_TIMEOUT_MS);
  });

  it('T-ADP-16 fetchOpenGraph(no-og.html / tiktok.html) → <title> fallback with image null; the TikTok head', async () => {
    const pages: Record<string, string> = {
      'https://cobblepost.example/notes/24': noOgHtml,
      'https://www.tiktok.com/@seedtok/video/1': tiktokHtml,
    };
    const { fetch: impl } = transport((url) => html(pages[url] ?? ''));
    const oembed = createOembed({ fetch: impl, env: ENV, lookup: lookupAll() });
    expect(await oembed.fetchOpenGraph('https://cobblepost.example/notes/24')).toEqual({
      title: 'Patch notes — week 24 | The Cobble Post',
      image: null,
      site_name: null,
      canonical: 'https://cobblepost.example/notes/24',
      published_at: null,
      og_type: null,
    });
    expect(await oembed.fetchOpenGraph('https://www.tiktok.com/@seedtok/video/1')).toMatchObject({
      title: 'this mod makes no sense and I love it',
      site_name: 'TikTok',
      og_type: 'video.other',
    });
  });

  it('T-ADP-16 fetchOpenGraph: the guard runs FIRST — a private, non-http(s) or userinfo URL is rejected with no request at all', async () => {
    const { fetch: impl, spy } = transport(() => html(ogPageHtml));
    const oembed = createOembed({ fetch: impl, env: ENV, lookup: lookupAll() });
    for (const input of [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/',
      'https://localhost/',
      'https://x.internal/',
      'file:///etc/passwd',
      'https://user:pw@blockybulletin.example/',
      'https://blockybulletin.example:8443/',
    ]) {
      expect(await caught(oembed.fetchOpenGraph(input))).toMatchObject({ code: 'rejected' });
    }
    const rebinding = createOembed({
      fetch: impl,
      env: ENV,
      lookup: lookupAll([PUBLIC_V4, { address: '10.0.0.5', family: 4 }]),
    });
    expect(await caught(rebinding.fetchOpenGraph(PAGE))).toMatchObject({ code: 'rejected' });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['application/pdf', { 'content-type': 'application/pdf' }],
    ['application/json', { 'content-type': 'application/json' }],
    ['text/plain', { 'content-type': 'text/plain; charset=utf-8' }],
    ['image/svg+xml', { 'content-type': 'image/svg+xml' }],
    ['no Content-Type at all', {}],
  ] as [string, Record<string, string>][])(
    'T-ADP-16 fetchOpenGraph: a non-HTML answer (%s) → typed unsupported, ONE request, body unread',
    async (_label, headers) => {
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulled += 1;
            controller.enqueue(new TextEncoder().encode(ogPageHtml));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const { fetch: impl, spy } = transport(() => new Response(body, { headers }));
      const oembed = createOembed({ fetch: impl, env: ENV, lookup: lookupAll() });
      const error = await caught(oembed.fetchOpenGraph(`${PAGE}?token=t0ken`));
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status: 200, code: 'unsupported', body: '' });
      expect(error?.message).toBe(
        'GET https://blockybulletin.example → unsupported (not html, or over 1 MB)',
      );
      expect(spy).toHaveBeenCalledTimes(1);
      expect(pulled).toBe(0);
    },
  );

  it('T-ADP-16 fetchOpenGraph: application/xhtml+xml is HTML too', async () => {
    const { fetch: impl } = transport(() =>
      html(ogPageHtml, { 'content-type': 'application/xhtml+xml' }),
    );
    const oembed = createOembed({ fetch: impl, env: ENV, lookup: lookupAll() });
    expect((await oembed.fetchOpenGraph(PAGE)).site_name).toBe('Blocky Bulletin');
  });

  it('T-ADP-16 fetchOpenGraph: a response over 1 MB → typed unsupported — by Content-Length before reading, or cut off mid-stream; exactly 1 MB is read', async () => {
    const declared = transport(() =>
      html(ogPageHtml, { 'content-length': String(OG_MAX_BYTES + 1) }),
    );
    const byHeader = await caught(
      createOembed({ fetch: declared.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(PAGE),
    );
    expect(byHeader).toMatchObject({ status: 200, code: 'unsupported', body: '' });

    let pulls = 0;
    const chunk = new TextEncoder().encode('<p>padding</p>'.repeat(8_000)); // ~112 KB
    const endless = transport(
      () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                pulls += 1;
                controller.enqueue(chunk);
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { 'content-type': 'text/html' } },
        ),
    );
    const byStream = await caught(
      createOembed({ fetch: endless.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(PAGE),
    );
    expect(byStream).toMatchObject({ status: 200, code: 'unsupported', body: '' });
    expect(pulls).toBe(Math.floor(OG_MAX_BYTES / chunk.byteLength) + 1); // stopped at the cap
    expect(endless.spy).toHaveBeenCalledTimes(1);

    const head = '<title>Exactly one megabyte</title>';
    const exact = transport(() => html(head + ' '.repeat(OG_MAX_BYTES - head.length)));
    expect(
      (
        await createOembed({ fetch: exact.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(
          PAGE,
        )
      ).title,
    ).toBe('Exactly one megabyte');
  });

  it('T-ADP-16 fetchOpenGraph: NO retry — a 5xx, a 429 and a network error are each one attempt; the error names the origin only and carries no upstream body', async () => {
    for (const status of [500, 503, 429, 404, 403]) {
      const { fetch: impl, spy } = transport(
        (url) =>
          new Response(`internal detail for ${url}`, { status, headers: { 'retry-after': '1' } }),
      );
      const oembed = createOembed({ fetch: impl, env: ENV, lookup: lookupAll() });
      const error = await caught(oembed.fetchOpenGraph(`${PAGE}?token=t0ken`));
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status, code: 'http_error', body: '' });
      expect(error?.message).toBe(
        `GET https://blockybulletin.example → http_error (${String(status)})`,
      );
      expect(spy).toHaveBeenCalledTimes(1);
    }

    const dead = transport(() => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.5:443');
    });
    const error = await caught(
      createOembed({ fetch: dead.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(
        `${PAGE}?token=t0ken`,
      ),
    );
    expect(error).toMatchObject({ status: 0, code: 'network_error', body: '' });
    expect(error?.message).toBe(
      'GET https://blockybulletin.example → network_error (request failed)',
    );
    expect(dead.spy).toHaveBeenCalledTimes(1);
  });

  it('T-ADP-16 fetchOpenGraph: a transport that misbehaves in an untyped way still ends in a typed network_error', async () => {
    const odd = transport(
      () =>
        ({
          ok: true,
          status: 200,
          headers: {
            get() {
              throw new RangeError('headers exploded');
            },
          },
          body: null,
        }) as unknown as Response,
    );
    const error = await caught(
      createOembed({ fetch: odd.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(PAGE),
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 0, code: 'network_error', body: '' });
  });

  it('T-ADP-16 fetchOpenGraph: a page with no title at all → typed parse_error (empty body)', async () => {
    const { fetch: impl } = transport(() => html('<html><body><p>secret</p></body></html>'));
    const error = await caught(
      createOembed({ fetch: impl, env: ENV, lookup: lookupAll() }).fetchOpenGraph(PAGE),
    );
    expect(error).toMatchObject({ status: 200, code: 'parse_error', body: '' });
  });

  it('T-ADP-16 fetchOpenGraph follows a RELATIVE Location against the current hop, re-checking the host; canonical falls back to the INPUT url, not the last hop', async () => {
    const { fetch: impl, urls } = transport((url) =>
      url === 'https://cobblepost.example/n/24?utm=x'
        ? redirect('../notes/24?consent=1', 301)
        : html(noOgHtml),
    );
    const lookup = lookupAll();
    const oembed = createOembed({ fetch: impl, env: ENV, lookup });
    const result = await oembed.fetchOpenGraph('https://cobblepost.example/n/24?utm=x');
    expect(urls).toEqual([
      'https://cobblepost.example/n/24?utm=x',
      'https://cobblepost.example/notes/24?consent=1',
    ]);
    expect(lookup).toHaveBeenCalledTimes(2); // same host — checked again all the same
    expect(result.canonical).toBe('https://cobblepost.example/n/24?utm=x');
  });

  it('T-ADP-16 fetchOpenGraph follows an ABSOLUTE Location to another public host (resolved on its own) and upgrades an http:// hop to https', async () => {
    const { fetch: impl, urls } = transport((url) => {
      if (url === 'https://short.example/abc')
        return redirect('http://blockybulletin.example/reviews/metal-pipe-mace', 307);
      return html(ogPageHtml);
    });
    const lookup = lookupMap({
      'short.example': [PUBLIC_V4],
      'blockybulletin.example': [PUBLIC_V6],
    });
    const oembed = createOembed({ fetch: impl, env: ENV, lookup });
    expect((await oembed.fetchOpenGraph('https://short.example/abc')).title).toContain(
      'Metal Pipe Mace',
    );
    expect(urls).toEqual(['https://short.example/abc', PAGE]); // never http://
    expect(lookup.mock.calls.map((call) => call[0])).toEqual([
      'short.example',
      'blockybulletin.example',
    ]);
  });

  it.each([
    ['a private literal', 'http://127.0.0.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/iam/'],
    ['an IPv4-mapped literal', 'https://[::ffff:10.0.0.1]/'],
    ['a decimal literal', 'http://2130706433/'],
    ['localhost', 'https://localhost/admin'],
    ['a *.internal name', 'https://metadata.google.internal/'],
    ['a scheme-relative private name', '//printer.local/x'],
    ['a name that resolves privately', 'https://rebind.example/x'],
    ['a name with mixed answers', 'https://mixed.example/x'],
    ['a name that does not resolve', 'https://nowhere.example/x'],
    ['http:// on a port the upgrade cannot drop', 'http://blockybulletin.example:8080/x'],
    ['an https port', 'https://blockybulletin.example:8443/x'],
    ['another scheme — ftp', 'ftp://blockybulletin.example/x'],
    ['another scheme — file', 'file:///etc/passwd'],
    ['another scheme — javascript', 'javascript:alert(1)'],
    ['another scheme — data', 'data:text/html,<title>x</title>'],
    ['userinfo', 'https://user:pw@blockybulletin.example/x'],
    ['an unparseable Location', 'https://[bad/x'],
    ['a Location over 2,048 chars', `https://blockybulletin.example/${'a'.repeat(2100)}`],
  ])(
    'T-ADP-16 fetchOpenGraph: a redirect to %s (%j) → typed rejection, and the second request is NEVER made',
    async (label, location) => {
      const { fetch: impl, spy } = transport((url) =>
        url === 'https://short.example/abc' ? redirect(location) : html(ogPageHtml),
      );
      const lookup = lookupMap({
        'short.example': [PUBLIC_V4],
        'blockybulletin.example': [PUBLIC_V4],
        'rebind.example': [{ address: '192.168.1.10', family: 4 }],
        'mixed.example': [PUBLIC_V4, { address: '::1', family: 6 }],
      });
      const oembed = createOembed({ fetch: impl, env: ENV, lookup });
      const error = await caught(oembed.fetchOpenGraph('https://short.example/abc'));
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({
        status: 0,
        code: label === 'a name that does not resolve' ? 'network_error' : 'rejected',
        body: '',
      });
      expect(spy).toHaveBeenCalledTimes(1);
      // Whatever the Location carried, the message does not repeat it.
      expect(error?.message).not.toContain('meta-data');
      expect(error?.message).not.toContain('passwd');
      expect(error?.message).not.toContain('192.168');
    },
  );

  it('T-ADP-16 fetchOpenGraph: a redirect with a missing or blank Location → typed unsupported', async () => {
    for (const location of [null, '', '   ']) {
      const { fetch: impl, spy } = transport(() => redirect(location));
      const error = await caught(
        createOembed({ fetch: impl, env: ENV, lookup: lookupAll() }).fetchOpenGraph(PAGE),
      );
      expect(error).toMatchObject({ status: 0, code: 'unsupported', body: '' });
      expect(error?.message).toBe(
        'GET https://blockybulletin.example → unsupported (redirect without location)',
      );
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it('T-ADP-16 fetchOpenGraph follows ≤ 3 redirects: the 3rd still lands; a 4th → typed unsupported after exactly 4 requests, every hop re-checked', async () => {
    const chain = (length: number) =>
      transport((url) => {
        const hop = Number(new URL(url).searchParams.get('hop') ?? '0');
        return hop < length
          ? redirect(`/r?hop=${String(hop + 1)}`, 302 + (hop % 2) * 5)
          : html(ogPageHtml);
      });

    const three = chain(OG_MAX_REDIRECTS);
    const lookupThree = lookupAll();
    const landed = await createOembed({
      fetch: three.fetch,
      env: ENV,
      lookup: lookupThree,
    }).fetchOpenGraph('https://blockybulletin.example/r?hop=0');
    expect(landed.og_type).toBe('article');
    expect(three.urls).toHaveLength(4);
    expect(lookupThree).toHaveBeenCalledTimes(4);

    const four = chain(OG_MAX_REDIRECTS + 1);
    const error = await caught(
      createOembed({ fetch: four.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(
        'https://blockybulletin.example/r?hop=0',
      ),
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 0, code: 'unsupported', body: '' });
    expect(error?.message).toBe(
      'GET https://blockybulletin.example → unsupported (too many redirects)',
    );
    expect(four.urls).toEqual([
      'https://blockybulletin.example/r?hop=0',
      'https://blockybulletin.example/r?hop=1',
      'https://blockybulletin.example/r?hop=2',
      'https://blockybulletin.example/r?hop=3',
    ]); // hop=4 is never requested
  });

  it('T-ADP-16 fetchOpenGraph: a redirect loop (A → B → A, or A → A, fragment games included) → typed unsupported without burning the whole allowance', async () => {
    const ping = transport((url) =>
      redirect(
        url.endsWith('/a')
          ? 'https://blockybulletin.example/b'
          : 'http://blockybulletin.example/a#again',
      ),
    );
    const loop = await caught(
      createOembed({ fetch: ping.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(
        'https://blockybulletin.example/a',
      ),
    );
    expect(loop).toMatchObject({ status: 0, code: 'unsupported', body: '' });
    expect(loop?.message).toBe('GET https://blockybulletin.example → unsupported (redirect loop)');
    expect(ping.urls).toEqual([
      'https://blockybulletin.example/a',
      'https://blockybulletin.example/b',
    ]);

    const self = transport(() => redirect('#top'));
    expect(
      await caught(
        createOembed({ fetch: self.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(PAGE),
      ),
    ).toMatchObject({ code: 'unsupported' });
    expect(self.urls).toEqual([PAGE]);
  });

  it('T-ADP-16 fetchOpenGraph spends ONE 10 s budget across the chain: later hops get what is left, and an exhausted budget ends in a typed network_error with no further request', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const slow = transport(async (url) => {
      const hop = Number(new URL(url).searchParams.get('hop') ?? '0');
      await new Promise((resolve) => setTimeout(resolve, 6_000)); // every hop takes 6 s
      return redirect(`/r?hop=${String(hop + 1)}`);
    });
    const settled = caught(
      createOembed({ fetch: slow.fetch, env: ENV, lookup: lookupAll() }).fetchOpenGraph(
        'https://blockybulletin.example/r?hop=0',
      ),
    );
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 0, code: 'network_error', body: '' });
    expect(error?.message).toBe('GET https://blockybulletin.example → network_error (timed out)');
    expect(slow.urls).toHaveLength(2); // 6 s + 6 s > 10 s — the third hop is never requested
    expect(timeoutSpy.mock.calls.map((call) => call[0])).toEqual([OG_TIMEOUT_MS, 4_000]);
  });
});

// -----------------------------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------------------------

describe('T-ADP-20 oembed takes env by injection (04 SC-25) — and has no base override (ADR-0045)', () => {
  it('T-ADP-20 createOembed with a partial env (no MODRINTH_USER_AGENT) throws a zod error naming it, no request, no DNS', () => {
    const lookup = lookupAll();
    const { fetch: impl, spy } = transport(() => html(ogPageHtml));
    for (const env of [{}, { MODRINTH_USER_AGENT: undefined }, { MODRINTH_USER_AGENT: '' }]) {
      let thrown: unknown;
      try {
        createOembed({ fetch: impl, env, lookup });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ZodError);
      expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(
        'MODRINTH_USER_AGENT',
      );
    }
    expect(spy).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('T-ADP-20 T-ADP-16 no env name can re-aim the page read: OEMBED_BASE and every *_API_BASE in the env are ignored, a loopback URL is still rejected', async () => {
    const { fetch: impl, urls } = transport(() => html(ogPageHtml));
    const loaded = {
      ...ENV,
      E2E: '1',
      OEMBED_BASE: 'http://127.0.0.1:4010/oembed',
      YOUTUBE_API_BASE: 'http://127.0.0.1:4010/youtube',
      MODRINTH_API_BASE: 'http://127.0.0.1:4010/modrinth',
    };
    const oembed = createOembed({ fetch: impl, env: loaded, lookup: lookupAll() });
    await oembed.fetchOpenGraph(PAGE);
    expect(urls).toEqual([PAGE]);
    for (const input of [
      'http://127.0.0.1:4010/oembed/og-page.html',
      'http://127.0.0.1/og-page.html',
    ]) {
      expect(await caught(oembed.fetchOpenGraph(input))).toMatchObject({ code: 'rejected' });
    }
    expect(urls).toEqual([PAGE]);
  });

  it('T-ADP-20 the factory re-exposes the pure functions', () => {
    const oembed = createOembed({ env: ENV, lookup: lookupAll() });
    expect(oembed.detectPlatform).toBe(detectPlatform);
    expect(oembed.isPublicAddress).toBe(isPublicAddress);
    expect(oembed.parseOpenGraph).toBe(parseOpenGraph);
  });
});
