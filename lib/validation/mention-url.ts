/**
 * lib/validation/mention-url.ts — the two pure URL rules of a mention link (04 §1.6
 * `fetchMentionPreviewInput` / `createMentionInput` "url"; 04 §5.4 step 2; 05 T-ACT-62 / T-ACT-63;
 * ADR-0045 — registry Modules `validation/mention-url.ts`).
 *
 * Like `lib/validation/slug.ts` this module is server-side, NOT client-safe: `videoIdFromUrl` is
 * the ONE YouTube URL grammar (04 §4.3; 05 T-ADP-14) and lives in `lib/adapters/youtube.ts`
 * (`server-only`), imported here "so each grammar has one source of truth" (the
 * `projects.schema.ts` → `parseRef` precedent). It is consumed by `lib/actions/mentions.schema.ts`
 * and `lib/actions/mentions.ts`, never by a client island. No zod, no I/O, never throws.
 *
 *   readMentionUrl(raw)        what the schema accepts (04 §1.6 Input cell): a parseable URL of at
 *                              most 2048 characters, scheme `http:` / `https:` ONLY (so
 *                              `javascript:` / `file:` / `data:` are `validation`, never a fetch),
 *                              no credentials (`user:pass@`), `http:` UPGRADED to `https:`. Returns
 *                              the WHATWG-normalised href — the same address the admin pasted
 *                              (tracking params and all): the preview fetches THIS, only
 *                              `canonical_url` is canonical. Host / DNS / port rules are not URL
 *                              syntax — they are `assertPublicHost`'s (04 §4.4; the SSRF guard
 *                              repeats scheme + credentials as defence in depth).
 *   canonicalMentionUrl(url)   the uniqueness key `createMention` stores (04 §1.6 Preconditions):
 *                                1. `http:` → `https:`;
 *                                2. any URL `videoIdFromUrl` reads (`watch?v=`, `youtu.be/`,
 *                                   `/shorts/`, `/live/`, `/embed/`, `m.` / `music.` hosts) →
 *                                   exactly `https://www.youtube.com/watch?v=<id>` (`t=`, `list=`,
 *                                   everything else dropped);
 *                                3. otherwise every query param named `utm_*`, `si` or `feature`
 *                                   (names compared case-insensitively) is removed; the rest keep
 *                                   their order and their exact encoding.
 *                              Nothing else is specified, so nothing else is done: no fragment
 *                              rule, no trailing-slash rule, no host rewriting beyond what the
 *                              WHATWG parser does by itself (lower-cased host, default port
 *                              dropped). Idempotent. A string that does not parse comes back
 *                              unchanged (the schema has already refused it).
 */
import { videoIdFromUrl } from '@/lib/adapters/youtube';

/** 04 §1.6 `url: z.string().url().max(2048)` — also the `mentions_url_format` CHECK bound. */
export const MENTION_URL_MAX = 2048;

const TRACKING_PREFIX = 'utm_';
const TRACKING_NAMES: ReadonlySet<string> = new Set(['si', 'feature']);

/** Why `readMentionUrl` refused a value — the schema turns each into its plain-words message. */
export type MentionUrlProblem = 'unparseable' | 'too_long' | 'scheme' | 'credentials';

export type MentionUrlResult =
  { ok: true; url: string } | { ok: false; problem: MentionUrlProblem };

/** `new URL` without the throw. */
function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * The 04 §1.6 `url` rules (see the header). Surrounding whitespace is ignored — a pasted link
 * often carries some. The length bound holds for the pasted text AND for the normalised href (the
 * parser can lengthen it: percent-encoding, punycode), so what comes back always fits the column.
 */
export function readMentionUrl(raw: string): MentionUrlResult {
  const value = raw.trim();
  if (value.length > MENTION_URL_MAX) return { ok: false, problem: 'too_long' };
  const parsed = parse(value);
  if (parsed === null) return { ok: false, problem: 'unparseable' };
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, problem: 'scheme' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, problem: 'credentials' };
  }
  parsed.protocol = 'https:';
  if (parsed.href.length > MENTION_URL_MAX) return { ok: false, problem: 'too_long' };
  return { ok: true, url: parsed.href };
}

/** The decoded name of one `name=value` query pair; an undecodable name reads as typed. */
function paramName(pair: string): string {
  const raw = (pair.split('=')[0] ?? '').replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(TRACKING_PREFIX) || TRACKING_NAMES.has(lower);
}

/** `?a=1&utm_source=x&b=2` → `?a=1&b=2`; kept pairs are copied byte for byte. */
function stripTracking(search: string): string {
  const kept = search
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => pair !== '' && !isTrackingParam(paramName(pair)));
  return kept.length > 0 ? `?${kept.join('&')}` : '';
}

/** The canonical form `mentions.url` is unique on (see the header for the three rules). */
export function canonicalMentionUrl(url: string): string {
  const parsed = parse(url.trim());
  if (parsed === null) return url;
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';

  const videoId = videoIdFromUrl(parsed.href);
  if (videoId !== null) return `https://www.youtube.com/watch?v=${videoId}`;

  parsed.search = stripTracking(parsed.search);
  return parsed.href;
}
