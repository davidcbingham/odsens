/**
 * lib/adapters/oembed.ts — `createOembed` (04 §4.4 export list: `fetchOpenGraph`, `assertPublicHost`,
 * `detectPlatform`; §1.6 `fetchMentionPreview` input rule; §5.4 steps 1 and 4; 04 SC-09/SC-10/SC-25;
 * §4 rules A1–A5; 01 INV-26/INV-78; 05 T-ADP-16, T-ADP-20, T-ACT-62; ADR-0045).
 *
 * The one place in the app that requests a URL SOMEBODY ELSE chose: an admin pastes a link on
 * `/admin/mentions` and the server reads that page's Open Graph tags. Everything here exists to make
 * that safe (server-side request forgery — 00 S1.8 gate focus). Pure I/O + parsing, no DB (A1).
 *
 * Factory `createOembed({fetch, env, lookup})` — env is an argument (SC-25 / T-ADP-20); `lookup` is
 * the injectable DNS resolver T-ADP-16 asks for (default: `node:dns/promises` `lookup` with
 * `all: true` — getaddrinfo, the resolution path the transport itself uses, `/etc/hosts` included).
 * Construction requires only `MODRINTH_USER_AGENT` (SC-10 — the same UA goes to every page read).
 *
 * THERE IS NO BASE-URL OVERRIDE HERE, BY DESIGN. `OEMBED_BASE` (lib/env.ts, test-only) re-aims the
 * adapter-owned YouTube oEmbed endpoint in `lib/adapters/youtube.ts` and nothing else; this module's
 * env schema does not know the name. No env value, `E2E`, `NODE_ENV` or loopback allowance can point
 * the page read at a private host — unit tests inject `fetch` + `lookup` instead. Do not "complete
 * the pattern".
 *
 * `assertPublicHost(url)` → the NORMALISED `URL` to request (request exactly that, never the input):
 *   1. parses with WHATWG `URL` — which already canonicalises every exotic IPv4 spelling (decimal
 *      `2130706433`, hex `0x7f.1`, octal `0177.0.0.1`, short `127.1`, full-width digits) to a dotted
 *      quad and IPv4-mapped IPv6 to `[::ffff:7f00:1]` — so the HOSTNAME is classified, never the raw
 *      string; longer than 2,048 chars / unparseable → `rejected`;
 *   2. `http:` / `https:` only; userinfo (`user:pass@`) → `rejected`;
 *   3. `http:` is UPGRADED to `https:` (04 §1.6) and any explicit port that survives the upgrade →
 *      `rejected`: every hop is https on 443, the adapter never sends a cleartext request;
 *   4. trailing dots stripped and written back (the checked name is the requested name), fragment
 *      dropped; empty host → `rejected`;
 *   5. IP literal → `isPublicAddress`, no DNS; otherwise the name deny-list (`localhost`,
 *      `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `*.lan`, `*.intranet`, `*.corp`,
 *      `*.home`, any single-label host) → `rejected`;
 *   6. DNS (3 s cap): resolver failure / timeout → `network_error`; no address, or ANY address that
 *      is not public → `rejected` — all of them, because the transport may connect to any of them.
 * `isPublicAddress`: IPv4 deny-list (this-network, RFC1918, CGNAT, loopback, link-local, protocol
 * assignments, TEST-NETs, 6to4 relay, benchmarking, multicast, reserved + broadcast); IPv6 ALLOW-list
 * — global unicast `2000::/3` only, minus Teredo / IETF `2001::/23`, documentation, 6to4 — so `::`,
 * `::1`, IPv4-mapped / -compatible, NAT64 `64:ff9b::/96`, ULA, link-/site-local and multicast are
 * refused without a rule of their own.
 *
 * `fetchOpenGraph(url)`: guard → GET through `http.ts` `fetchPage` with `redirect: 'manual'`,
 * `retries: 0` (04 §4.4 "no retry" — and every retry would be a fresh DNS answer), `maxBytes` 1 MB,
 * `contentTypes` html / xhtml, `Accept: text/html`, no cookies, no extra headers; ≤ 3 redirects, each
 * `Location` resolved against the current hop and sent back through the guard; ONE 10 s budget for
 * the whole chain. Too many / looping / location-less redirects, a body over 1 MB and a non-HTML
 * answer → `unsupported`. Returns PARSED FIELDS ONLY — never the body — and every error it throws
 * names the page by origin alone, with an empty `body`: a pasted URL can carry a token, and an
 * upstream error body is whatever the far side wants us to store.
 *
 * DNS rebinding (the check-time lookup and the transport's connect-time lookup are two queries):
 * the resolved address cannot be pinned through the injectable transport without a new dependency
 * (01 INV-78) or a second HTTP path (INV-26). Accepted residual risk, neutralised in practice by
 * step 3 — a rebound connection lands on an internal address that cannot complete a TLS handshake
 * for the attacker's name, so no request is ever sent to it — plus all-addresses checking, no retry,
 * parsed-fields-only output, and the caller being admin-only and rate-limited (ADR-0045).
 *
 * `parseOpenGraph` is hand-rolled (no HTML dependency — INV-78) and LINEAR in the input: one forward
 * scan, `indexOf` cursors, no lazy regex over the document, a 4,096-char cap per tag. It is robust to
 * attribute order, `"` / `'` / no quotes, `property` vs `name`, upper-case tags, and ignores tags
 * inside comments, `<script>`, `<style>`, `<noscript>` and the other raw-text elements.
 * v1 limitation: the body is decoded as UTF-8 — a legacy-charset page yields a garbled title the
 * admin retypes.
 *
 * This file is server-only and imports `node:dns` / `node:net` (Node runtime, never edge): never
 * import it from a client island — `detectPlatform` reaches the browser only as `data.platform`.
 */
import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import {
  AdapterError,
  fetchPage,
  type AdapterErrorCode,
  type FetchedPage,
} from '@/lib/adapters/http';
import type { Env } from '@/lib/env';

/** 04 §4.4 "read ≤ 1 MB". */
export const OG_MAX_BYTES = 1_048_576;
/** 04 §4.4 "follow ≤ 3 redirects" → at most 4 requests per call. */
export const OG_MAX_REDIRECTS = 3;
/** 04 §4.4 "10 s, no retry (interactive)" — the budget for the WHOLE chain, not per hop. */
export const OG_TIMEOUT_MS = 10_000;
/** `dns.lookup` has no timeout of its own. */
export const DNS_TIMEOUT_MS = 3_000;

/** 04 §1.6 `url ≤ 2048` — also the ceiling for a redirect `Location` and for a parsed URL field. */
const MAX_URL_LENGTH = 2048;
/** 04 §5.4 step 5 lengths (`title ≤ 200`, `creator ≤ 80` ← `site_name`); `og:type` is a short token. */
const TITLE_MAX = 200;
const SITE_NAME_MAX = 80;
const OG_TYPE_MAX = 40;
/** Parser caps: one tag, and the raw text taken from `<title>`. */
const MAX_TAG_LENGTH = 4096;
const MAX_TITLE_LENGTH = 4096;

/** What `detectPlatform` can answer — never `other`, which is admin-selectable only (05 T-ADP-16). */
export type DetectedPlatform = 'youtube' | 'tiktok' | 'twitch' | 'reddit' | 'article';

/** One `dns.lookup(…, {all: true})` answer. */
export type LookupAddress = { address: string; family: number };
/** Injectable resolver (05 T-ADP-16 "DNS resolver injected"). */
export type Lookup = (hostname: string) => Promise<LookupAddress[]>;

/** `fetchOpenGraph` result (05 T-ADP-16) — parsed, trimmed, length-capped fields; never the body. */
export type OpenGraph = {
  /** `og:title` ▸ `<title>`; ≤ 200 chars. */
  title: string;
  /** `og:image` resolved against the page, `https:` only, else `null`. Never rendered for a non-YouTube mention (ADR-0002 #33). */
  image: string | null;
  /** `og:site_name`; ≤ 80 chars. */
  site_name: string | null;
  /** `og:url` when it is a clean `https:` URL, else the requested URL. */
  canonical: string;
  /** `article:published_time` in `Date#toISOString()` form. */
  published_at: string | null;
  og_type: string | null;
};

const oembedEnvSchema = z.object({ MODRINTH_USER_AGENT: z.string().min(1) });

/** NO `OEMBED_BASE` — by design (file header). */
export type OembedEnv = Partial<Pick<Env, 'MODRINTH_USER_AGENT'>>;

// ---------------------------------------------------------------------------------------------
// Errors — origin-only labels, empty bodies
// ---------------------------------------------------------------------------------------------

const UNPARSEABLE = '(unparseable url)';

function failure(code: AdapterErrorCode, label: string, why: string, status = 0): AdapterError {
  return new AdapterError(`GET ${label} → ${code} (${why})`, { status, code, body: '' });
}

/** What a message may say about a URL: its origin — never the path, the query or the userinfo. */
function originLabel(url: URL): string {
  return url.origin === 'null' ? url.protocol : url.origin;
}

// ---------------------------------------------------------------------------------------------
// Address classification (pure — A3; exported for T-ADP-16)
// ---------------------------------------------------------------------------------------------

const DENY_V4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network", 0.0.0.0 included
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — cloud metadata lives at 169.254.169.254
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, 255.255.255.255 broadcast included
] as const) {
  DENY_V4.addSubnet(network, prefix, 'ipv4');
}

/** IPv6 is an allow-list: global unicast only … */
const ALLOW_V6 = new BlockList();
ALLOW_V6.addSubnet('2000::', 3, 'ipv6');

/** … minus the carve-outs inside it that are not ordinary hosts or that embed an IPv4 address. */
const DENY_V6 = new BlockList();
for (const [network, prefix] of [
  ['2001::', 23], // IETF protocol assignments, Teredo (2001::/32) included
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 — embeds an IPv4 address
  ['3fff::', 20], // documentation
] as const) {
  DENY_V6.addSubnet(network, prefix, 'ipv6');
}

/**
 * `true` only for an address a public web page can live on. Takes a bare IPv4 / IPv6 literal (no
 * brackets; a `%zone` suffix is ignored); anything that is not an IP literal → `false`.
 */
export function isPublicAddress(address: string): boolean {
  const zone = address.indexOf('%');
  const bare = zone === -1 ? address : address.slice(0, zone);
  const family = isIP(bare);
  if (family === 4) return !DENY_V4.check(bare, 'ipv4');
  if (family === 6) return ALLOW_V6.check(bare, 'ipv6') && !DENY_V6.check(bare, 'ipv6');
  return false;
}

// ---------------------------------------------------------------------------------------------
// URL policy (pure part of the guard — no DNS)
// ---------------------------------------------------------------------------------------------

const DENIED_HOSTS: ReadonlySet<string> = new Set(['localhost']);
const DENIED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.lan',
  '.intranet',
  '.corp',
  '.home',
] as const;

/** A normalised URL plus what is left to check: `host` needs DNS unless `literal`. */
type PolicyPass = { url: URL; host: string; literal: boolean };

/**
 * Steps 1–5 of the guard (file header) — everything that needs no resolver. Returns the normalised
 * URL, or throws a typed `rejected`. Also the rule a parsed `og:url` / `og:image` must pass.
 */
function applyUrlPolicy(raw: string): PolicyPass {
  if (raw.length > MAX_URL_LENGTH) throw failure('rejected', UNPARSEABLE, 'url too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw failure('rejected', UNPARSEABLE, 'not a url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw failure('rejected', originLabel(url), 'scheme');
  }
  if (url.username !== '' || url.password !== '') {
    throw failure('rejected', originLabel(url), 'userinfo');
  }
  // 04 §1.6: http is upgraded. `http://host:80/` and `http://host:443/` both come out portless;
  // `http://host:8080/` keeps its port and is refused below — no cleartext, no odd ports, ever.
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.port !== '') throw failure('rejected', originLabel(url), 'port');

  let host = url.hostname;
  let end = host.length;
  while (end > 0 && host[end - 1] === '.') end -= 1;
  host = host.slice(0, end);
  if (host === '') throw failure('rejected', originLabel(url), 'host');
  // `localhost.` is `localhost`: the name that is checked must be the name that is requested. The
  // setter ignores a value it cannot take, hence the read-back.
  url.hostname = host;
  if (url.hostname !== host) throw failure('rejected', originLabel(url), 'host');
  url.hash = '';

  // An IPv6 literal arrives bracketed, and `isIP('[::1]')` is 0.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (isIP(bare) !== 0) {
    if (!isPublicAddress(bare)) throw failure('rejected', originLabel(url), 'address');
    return { url, host: bare, literal: true };
  }

  if (
    !host.includes('.') ||
    DENIED_HOSTS.has(host) ||
    DENIED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw failure('rejected', originLabel(url), 'host');
  }
  return { url, host, literal: false };
}

/** A URL field lifted from the page: kept only when it is a clean `https:` URL under the policy. */
function safeHttpsUrl(value: string, base: URL | null): string | null {
  let resolved: URL;
  try {
    resolved = base === null ? new URL(value) : new URL(value, base);
  } catch {
    return null;
  }
  if (resolved.protocol !== 'https:') return null; // no upgrade here: the page said what it said
  try {
    return applyUrlPolicy(resolved.href).url.href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// detectPlatform (pure — A3; 05 T-ADP-16)
// ---------------------------------------------------------------------------------------------

const PLATFORM_DOMAINS: readonly (readonly [string, DetectedPlatform])[] = [
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['tiktok.com', 'tiktok'],
  ['twitch.tv', 'twitch'], // `clips.twitch.tv` by the subdomain rule
  ['reddit.com', 'reddit'],
  ['redd.it', 'reddit'],
];

/**
 * 04 §4.4 hostname map. A domain matches itself and its subdomains on a DOT boundary
 * (`evilyoutube.com` and `youtube.com.evil.test` are `article`); anything else — another host, a
 * non-http(s) scheme, not a URL — is `article`. Never `other`.
 */
export function detectPlatform(url: string): DetectedPlatform {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'article';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'article';
  let host = parsed.hostname;
  while (host.endsWith('.')) host = host.slice(0, -1);
  for (const [domain, platform] of PLATFORM_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return platform;
  }
  return 'article';
}

// ---------------------------------------------------------------------------------------------
// Open Graph reader (pure — A3; hand-rolled, linear: 01 INV-78)
// ---------------------------------------------------------------------------------------------

/** The `<meta>` keys 04 §4.4 reads (`property` or `name`). */
const WANTED_META: ReadonlySet<string> = new Set([
  'og:title',
  'og:image',
  'og:site_name',
  'og:url',
  'og:type',
  'article:published_time',
]);

/** Elements whose content is text, not markup — a `<meta` inside one is not a tag. */
const RAW_TEXT_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'iframe',
  'xmp',
  'noembed',
  'noframes',
] as const;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Length-preserving lower-casing (`String#toLowerCase` can change a string's length — `İ`). */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
}

/**
 * One pass over named + numeric entities — a decoded `&` is never re-read (`&amp;lt;` → `&lt;`).
 * Code points are limited to real scalar values: no NUL, no surrogates, nothing past U+10FFFF.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (!lower.startsWith('#')) return NAMED_ENTITIES[lower] ?? whole;
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    const scalar = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return scalar ? String.fromCodePoint(code) : whole;
  });
}

/**
 * Page text → a field: entities decoded ONCE, control characters and bidi overrides dropped (a title
 * is shown in the admin preview and on the public card), whitespace collapsed, trimmed.
 */
function cleanText(raw: string): string {
  return decodeEntities(raw)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Caps a cleaned field at `max` UTF-16 units without splitting a surrogate pair. */
function capLength(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return text.slice(0, cut).trimEnd();
}

/** Where an attribute name stops: whitespace, `=`, `/` or the tag's `>`. */
function endsAttributeName(char: string | undefined): boolean {
  return isSpace(char) || char === '=' || char === '/' || char === '>';
}

/** `<name` at `at`, followed by whitespace, `/`, `>` or the end — `<metadata>` is not `<meta>`. */
function isTagAt(lower: string, at: number, name: string): boolean {
  if (!lower.startsWith(name, at + 1)) return false;
  const after = lower[at + 1 + name.length];
  return after === undefined || after === '>' || after === '/' || isSpace(after);
}

/**
 * Reads one tag's attributes from `from` (just past the tag name) to its `>` — quotes respected,
 * at most `MAX_TAG_LENGTH` chars. `complete: false` = no `>` inside the cap; the caller skips the
 * scanned span, so every character of the document is looked at once. First attribute of a name
 * wins (the HTML rule); names are lower-cased, values are raw.
 */
function readTag(
  html: string,
  from: number,
): { attrs: Map<string, string>; end: number; complete: boolean } {
  const limit = Math.min(html.length, from + MAX_TAG_LENGTH);
  const attrs = new Map<string, string>();
  let i = from;
  while (i < limit) {
    const char = html[i];
    if (char === '>') return { attrs, end: i + 1, complete: true };
    if (isSpace(char) || char === '/') {
      i += 1;
      continue;
    }
    const nameStart = i;
    if (char === '=') i += 1; // the HTML rule: a stray `=` starts a (junk) name, it does not eat the next attribute
    while (i < limit && !endsAttributeName(html[i])) i += 1;
    const name = asciiLower(html.slice(nameStart, i));
    while (i < limit && isSpace(html[i])) i += 1;
    let value = '';
    if (i < limit && html[i] === '=') {
      i += 1;
      while (i < limit && isSpace(html[i])) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.slice(i + 1, limit).indexOf(quote); // bounded — never scans the document
        if (close === -1) return { attrs, end: limit, complete: false };
        value = html.slice(i + 1, i + 1 + close);
        i += close + 2;
      } else {
        const valueStart = i;
        while (i < limit && !isSpace(html[i]) && html[i] !== '>') i += 1;
        value = html.slice(valueStart, i);
      }
    }
    if (name !== '' && !attrs.has(name)) attrs.set(name, value);
  }
  return { attrs, end: limit, complete: false };
}

/** One forward scan: the wanted `<meta>` values (first non-empty one per key) and the first `<title>`. */
function scanDocument(html: string): { meta: Map<string, string>; title: string | null } {
  const lower = asciiLower(html);
  const meta = new Map<string, string>();
  let title: string | null = null;
  let titleSeen = false;
  let cursor = 0;
  for (;;) {
    const open = lower.indexOf('<', cursor);
    if (open === -1) break;

    if (lower.startsWith('<!--', open)) {
      const close = lower.indexOf('-->', open + 2); // `<!-->` and `<!--->` are whole comments
      if (close === -1) break; // unterminated — the rest of the document is comment
      cursor = close + 3;
      continue;
    }

    const rawText = RAW_TEXT_ELEMENTS.find((name) => isTagAt(lower, open, name));
    if (rawText !== undefined) {
      const close = lower.indexOf(`</${rawText}`, open + 1);
      if (close === -1) break; // unterminated — the rest of the document is its text
      cursor = close + 2 + rawText.length;
      continue;
    }

    if (isTagAt(lower, open, 'meta')) {
      const tag = readTag(html, open + 5);
      cursor = tag.end;
      if (!tag.complete) continue;
      const content = cleanText(tag.attrs.get('content') ?? '');
      if (content === '') continue; // an empty value never claims a key
      for (const attr of ['property', 'name'] as const) {
        const key = asciiLower(tag.attrs.get(attr) ?? '').trim();
        if (WANTED_META.has(key) && !meta.has(key)) meta.set(key, content);
      }
      continue;
    }

    if (!titleSeen && isTagAt(lower, open, 'title')) {
      titleSeen = true; // only the first `<title` is ever searched from — no repeated scans
      const start = lower.indexOf('>', open);
      if (start === -1) break;
      const close = lower.indexOf('</title', start + 1);
      const end = close === -1 ? lower.length : close;
      title = html.slice(start + 1, Math.min(end, start + 1 + MAX_TITLE_LENGTH));
      cursor = end;
      continue;
    }

    cursor = open + 1;
  }
  return { meta, title };
}

/**
 * `article:published_time` → `Date#toISOString()`. ISO 8601 shapes only (`2026-06-14`,
 * `2026-06-14T16:00:00Z`, `…+02:00`, `…+0200`); a time without an offset is read as UTC, so the
 * answer never depends on the server's time zone. Anything else → `null`.
 */
function isoDateOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)\s?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(
      value,
    );
  if (!match) return null;
  const [, date, time, offset] = match;
  const zone =
    offset === undefined || offset.toUpperCase() === 'Z'
      ? 'Z'
      : offset.includes(':')
        ? offset
        : `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const parsed = Date.parse(`${date ?? ''}T${time ?? '00:00'}${zone}`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * 05 T-ADP-16: `{title: og:title ▸ <title>, image: og:image ▸ null, site_name, canonical: og:url ▸
 * url, published_at: article:published_time ▸ null, og_type}`. `url` is the page that was asked for
 * (the fallback canonical and the base a relative `og:image` resolves against). No title at all →
 * typed `parse_error` — with an empty body: the page is never echoed.
 */
export function parseOpenGraph(html: string, url: string): OpenGraph {
  let base: URL | null = null;
  try {
    base = new URL(url);
  } catch {
    // a caller's problem — relative fields simply do not resolve
  }
  const { meta, title: titleElement } = scanDocument(html);

  // `meta` values are already cleaned (entities are decoded exactly once); the element text is not.
  const title = capLength(meta.get('og:title') ?? cleanText(titleElement ?? ''), TITLE_MAX);
  if (title === '') {
    throw failure('parse_error', base === null ? '(page)' : originLabel(base), 'no title', 200);
  }

  const image = meta.get('og:image');
  const canonical = meta.get('og:url');
  const siteName = meta.get('og:site_name');
  const ogType = meta.get('og:type');
  return {
    title,
    image: image === undefined ? null : safeHttpsUrl(image, base),
    site_name: siteName === undefined ? null : capLength(siteName, SITE_NAME_MAX),
    canonical: (canonical === undefined ? null : safeHttpsUrl(canonical, null)) ?? url,
    published_at: isoDateOrNull(meta.get('article:published_time')),
    og_type: ogType === undefined ? null : capLength(ogType, OG_TYPE_MAX),
  };
}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------

/** Rejects after `ms` unless `work` settles first; the timer never outlives the race. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timed out'));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/** 04 §4.4 factory (SC-25). Throws a zod error naming any missing env key — before any request. */
export function createOembed({
  fetch: fetchImpl,
  env,
  lookup = (hostname) => dnsLookup(hostname, { all: true }),
}: {
  fetch?: typeof fetch;
  env: OembedEnv;
  lookup?: Lookup;
}) {
  const parsed = oembedEnvSchema.parse(env);
  const ua = parsed.MODRINTH_USER_AGENT;

  /** The whole guard (file header steps 1–6); `dnsTimeoutMs` lets the page read spend its one budget. */
  async function guard(raw: string, dnsTimeoutMs: number): Promise<URL> {
    const { url, host, literal } = applyUrlPolicy(raw);
    if (literal) return url;
    let addresses: LookupAddress[];
    try {
      addresses = await withTimeout(
        Promise.resolve().then(() => lookup(host)),
        dnsTimeoutMs,
      );
    } catch {
      // Resolver text (ENOTFOUND <host>, a timeout) stays out of the message — origin only.
      throw failure('network_error', originLabel(url), 'dns');
    }
    // ALL of them: the transport may connect to any address the name resolves to.
    if (addresses.length === 0 || !addresses.every((entry) => isPublicAddress(entry.address))) {
      throw failure('rejected', originLabel(url), 'address');
    }
    return url;
  }

  return {
    /**
     * 04 §4.4 / §5.4 step 1. Resolves to the normalised URL (https, default port, no trailing dot,
     * no fragment) — request exactly that. Every refusal is a typed `AdapterError`: `rejected` for a
     * policy refusal (no request, no DNS where none is needed), `network_error` when the resolver
     * failed or timed out.
     */
    assertPublicHost(url: string): Promise<URL> {
      return guard(url, DNS_TIMEOUT_MS);
    },

    /**
     * 04 §4.4 / §5.4 step 4 (file header). `canonical` falls back to the normalised INPUT url, not
     * the last hop — a consent or region redirect must not become the mention's address.
     */
    async fetchOpenGraph(url: string): Promise<OpenGraph> {
      const deadline = Date.now() + OG_TIMEOUT_MS;
      const budget = (origin: string): number => {
        const left = deadline - Date.now();
        if (left <= 0) throw failure('network_error', origin, 'timed out');
        return left;
      };

      const first = await guard(url, DNS_TIMEOUT_MS);
      const visited = new Set([first.href]);
      let current = first;
      for (let hop = 0; ; hop += 1) {
        const origin = originLabel(current);
        const timeoutMs = budget(origin);
        let page: FetchedPage;
        try {
          page = await fetchPage(current.href, {
            ua,
            fetch: fetchImpl,
            accept: 'text/html',
            retries: 0,
            timeoutMs,
            redirect: 'manual',
            maxBytes: OG_MAX_BYTES,
            contentTypes: ['text/html', 'application/xhtml+xml'],
          });
        } catch (error) {
          // Re-labelled: `http.ts` names the full URL and carries the upstream body — neither leaves here.
          if (error instanceof AdapterError) {
            const why =
              error.code === 'unsupported'
                ? 'not html, or over 1 MB'
                : error.status === 0
                  ? 'request failed'
                  : String(error.status);
            throw failure(error.code, origin, why, error.status);
          }
          throw failure('network_error', origin, 'request failed');
        }
        if (page.status < 300) return parseOpenGraph(page.text, first.href);

        if (hop >= OG_MAX_REDIRECTS) throw failure('unsupported', origin, 'too many redirects');
        const location = page.location?.trim() ?? '';
        if (location === '') throw failure('unsupported', origin, 'redirect without location');
        let next: URL;
        try {
          next = new URL(location, current); // `Location` may be relative
        } catch {
          throw failure('rejected', origin, 'not a url');
        }
        // EVERY hop goes back through the guard — same-host hops included.
        current = await guard(next.href, Math.min(DNS_TIMEOUT_MS, budget(origin)));
        if (visited.has(current.href)) throw failure('unsupported', origin, 'redirect loop');
        visited.add(current.href);
      }
    },

    detectPlatform,
    isPublicAddress,
    parseOpenGraph,
  };
}

export type Oembed = ReturnType<typeof createOembed>;
