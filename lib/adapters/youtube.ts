/**
 * lib/adapters/youtube.ts — `createYoutube` (04 §4.3 export list verbatim; §3.3 what `syncYoutube`
 * asks for; §5.3 Shorts heuristic; 04 SC-09/SC-10/SC-16/SC-25; 01 INV-26/INV-78/INV-83;
 * 05 T-ADP-9..15, T-UNIT-29, T-ADP-20; ADR-0043 D2/D3).
 *
 * Pure I/O + mapping, no DB access (04 §4 A1–A3). Factory `createYoutube({fetch, env})` — env is an
 * argument (the caller passes `lib/env.ts`'s `env`); this module reads no environment of its own
 * (SC-25 / T-ADP-20).
 * - Construction requires `MODRINTH_USER_AGENT` (SC-10: the same UA goes to YouTube) and
 *   `YOUTUBE_CHANNEL_ID` (SC-16 boot-required; every `channelId` parameter defaults to it).
 *   `YOUTUBE_API_KEY` is OPTIONAL: without it the adapter still constructs and `fetchRss` / `oembed`
 *   work (04 §3.3 RSS-only degraded run, 05 T-ACT-71), while `listVideos` / `listUploads` /
 *   `channelStats` throw `AdapterError 'unsupported'` with NO request — callers read `hasKey` (or
 *   the env) first.
 * - Two upstreams: the keyless Atom feed `https://www.youtube.com/feeds/videos.xml` (newest 15
 *   uploads, 0 quota units) and the Data API `https://www.googleapis.com/youtube/v3` with
 *   `key=<YOUTUBE_API_KEY>` as a query param. `YOUTUBE_RSS_BASE` / `YOUTUBE_API_BASE` override them
 *   in tests only (ADR-0002 #73).
 * - Every call goes through `lib/adapters/http.ts` (SC-09: 10 s timeout, retry ≤ 3 with backoff):
 *   JSON through `fetchJson`, the feed through `fetchText` (ADR-0043 D3). The feed is parsed by the
 *   hand-rolled Atom reader `parseRss` below — no XML dependency (01 INV-78); it never looks at the
 *   response `Content-Type`.
 * - The key never reaches an error or a log line: `http.ts` redacts `key=` in every message, the
 *   `parse_error` label here is built from the redacted URL, and a literal copy of the key inside an
 *   upstream body or a network-error string is scrubbed too (04 §4.3 "redacted from errors/logs").
 * - `listVideos(ids)` returns `MappedVideo[]` with live/upcoming items
 *   (`snippet.liveBroadcastContent !== 'none'`) already dropped (ADR-0002 #77; ADR-0043 D2) — an id
 *   that does not come back mapped is simply not in the list (deleted, private, live, upcoming).
 * - `unitsUsed` counts Data-API list requests issued by THIS instance (jobs build one adapter per
 *   run — SC-25): +1 per `videos` / `playlistItems` / `channels` request, RSS and oEmbed are free;
 *   SC-09 retries of one request are not counted again (00 S1.6 AC9, 05 T-ADP-13).
 * - `oembed` / `videoIdFromUrl` are consumed from S1.8 (`fetchMentionPreview`, 04 §5.4); they live
 *   here because 04 §4.3 lists them on this adapter.
 */
import 'server-only';
import { z } from 'zod';
import { AdapterError, fetchJson, fetchText, redactSecrets } from '@/lib/adapters/http';
import type { Env } from '@/lib/env';

/** 04 §4.3 base URLs — unit tests assert the real hosts (05 T-ADP-9/10); e2e overrides to :4010. */
export const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_RSS = 'https://www.youtube.com/feeds/videos.xml';
export const YOUTUBE_OEMBED = 'https://www.youtube.com/oembed';

/** 04 §4.3: `listVideos` batches ≤ 50 ids; `listUploads` asks for 50 items per page. */
export const VIDEOS_BATCH = 50;
export const UPLOADS_PAGE_SIZE = 50;

/**
 * `listUploads` hard page cap: 40 pages × 50 = 2,000 uploads, ~100× the channel at
 * spec time. With the repeated-token guard it makes an upstream (or a fixture server that ignores
 * `pageToken`) that keeps answering "there is a next page" terminate instead of spinning.
 */
export const MAX_UPLOAD_PAGES = 40;

/** 04 §1.8 `updateVideoInput.youtube_id` / 05 T-ADP-14: ids are exactly 11 url-safe chars. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** 04 §5.3 tag rule — `#shorts` as its own token, any case, in `title + ' ' + description`. */
const SHORTS_TAG_RE = /\B#shorts\b/i;

/** 04 §5.3: a video of at most this many seconds is a Short. */
const SHORT_MAX_SECONDS = 60;

/** 04 §4.3 / 05 T-UNIT-29 thumbnail preference, best first. */
const THUMBNAIL_ORDER = ['maxres', 'standard', 'high', 'medium', 'default'] as const;

/** Hosts `videoIdFromUrl` accepts (05 T-ADP-14 names `www.`, `m.` and `youtu.be`). */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'www.youtube-nocookie.com',
]);
const YOUTUBE_SHORT_HOST = 'youtu.be';

/** 04 §4.3 path shapes other than `watch?v=`: `/shorts/<id>`, `/live/<id>`, `/embed/<id>`. */
const PATH_ID_RE = /^\/(?:shorts|live|embed)\/([^/]+)\/?$/;

/** A4: raw upstream bodies are truncated to 300 chars before they travel in an error. */
const BODY_LIMIT = 300;

/** Shortest key prefix `scrub` treats as a leak when it ends a truncated error body. */
const KEY_TAIL_MIN = 6;

const youtubeEnvSchema = z.object({
  MODRINTH_USER_AGENT: z.string().min(1),
  YOUTUBE_CHANNEL_ID: z.string().min(1),
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  YOUTUBE_API_BASE: z.string().optional(),
  YOUTUBE_RSS_BASE: z.string().optional(),
});

export type YoutubeEnv = Partial<
  Pick<
    Env,
    | 'MODRINTH_USER_AGENT'
    | 'YOUTUBE_CHANNEL_ID'
    | 'YOUTUBE_API_KEY'
    | 'YOUTUBE_API_BASE'
    | 'YOUTUBE_RSS_BASE'
  >
>;

// ---------------------------------------------------------------------------------------------
// Upstream shapes (01 INV-83: external JSON is parsed with zod, schemas exported). Only what is
// read is declared — unknown keys are dropped, so a richer upstream answer never fails the parse.
// Counts arrive as decimal STRINGS from the Data API.
// ---------------------------------------------------------------------------------------------

const thumbnailSchema = z.object({ url: z.string().min(1) });

export const youtubeThumbnailsSchema = z.object({
  default: thumbnailSchema.optional(),
  medium: thumbnailSchema.optional(),
  high: thumbnailSchema.optional(),
  standard: thumbnailSchema.optional(),
  maxres: thumbnailSchema.optional(),
});

export type YoutubeThumbnails = z.infer<typeof youtubeThumbnailsSchema>;

const countSchema = z.union([z.string(), z.number()]);
/** A count that must be there and must be a number (`channels.list` `viewCount`). */
const requiredCountSchema = countSchema.refine((value) => countOrNull(value) !== null);

/** One `videos.list` item (`part=snippet,contentDetails,statistics`). */
export const youtubeVideoItemSchema = z.object({
  id: z.string().regex(VIDEO_ID_RE),
  snippet: z.object({
    title: z.string(),
    description: z.string().optional(),
    publishedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    liveBroadcastContent: z.string().optional(),
    thumbnails: youtubeThumbnailsSchema.optional(),
  }),
  contentDetails: z.object({ duration: z.string().optional() }).optional(),
  statistics: z
    .object({ viewCount: countSchema.optional(), likeCount: countSchema.optional() })
    .optional(),
});

export type YoutubeVideoItem = z.infer<typeof youtubeVideoItemSchema>;

export const videosListResponseSchema = z.object({ items: z.array(youtubeVideoItemSchema) });

export const playlistItemsResponseSchema = z.object({
  items: z.array(
    z.object({ contentDetails: z.object({ videoId: z.string().regex(VIDEO_ID_RE) }) }),
  ),
  nextPageToken: z.string().optional(),
});

export const channelsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        statistics: z.object({
          viewCount: requiredCountSchema,
          subscriberCount: countSchema.optional(),
          hiddenSubscriberCount: z.boolean().optional(),
        }),
      }),
    )
    .optional(),
});

/** YouTube oEmbed answer — the four fields 04 §5.4 step 2 takes. */
export const oembedResponseSchema = z.object({
  title: z.string(),
  author_name: z.string(),
  author_url: z.string(),
  thumbnail_url: z.string().optional(),
});

// ---------------------------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------------------------

/**
 * One feed entry (05 T-ADP-9). `thumbnail_url` is `media:thumbnail@url` VERBATIM — on the live feed
 * that is an `i1…i4.ytimg.com` host outside 01 INV-54's allow-list, so `syncYoutube` does not store
 * it: it writes the 04 §3.3 literal `https://i.ytimg.com/vi/<id>/hqdefault.jpg`.
 * `null` when an entry carries no thumbnail / an empty description. `published_at` is normalised to
 * `Date#toISOString()` form, like `MappedVideo.published_at`.
 */
export type RssVideo = {
  youtube_id: string;
  title: string;
  published_at: string;
  thumbnail_url: string | null;
  description: string | null;
};

/** 05 T-ADP-12 — the `videos` columns a Data-API item fills (04 §3.3 step 2). */
export type MappedVideo = {
  youtube_id: string;
  title: string;
  description: string;
  /** Best of maxres ▸ standard ▸ high ▸ medium ▸ default; `null` when upstream sent none. */
  thumbnail_url: string | null;
  /** `Date#toISOString()` form. */
  published_at: string;
  duration_seconds: number | null;
  is_short: boolean;
  /** `null` (never 0) when `statistics` — or that one count, e.g. hidden likes — is missing. */
  view_count: number | null;
  like_count: number | null;
};

/** `channelStats` result (05 T-ADP-13). `subs` is `null` when the channel hides its count. */
export type ChannelStats = { views: number; subs: number | null };

/** `oembed` result (05 T-ADP-15): `author_name → creator_name`, `author_url → creator_url`. */
export type YoutubeOembed = {
  title: string;
  creator_name: string;
  creator_url: string;
  thumbnail_url: string | null;
};

// ---------------------------------------------------------------------------------------------
// Pure helpers (A3 — exported for T-ADP / T-UNIT tests and for `updateVideo`'s recompute)
// ---------------------------------------------------------------------------------------------

/**
 * ISO 8601 duration → whole seconds (05 T-ADP-10): `PT45S` → 45, `PT1H2M3S` → 3723, `P1DT1S` →
 * 86401, `P0D` (what a live/upcoming item reports) → 0. Anything else — empty, bare `P` / `PT`, a
 * `T` with nothing after it, years/months, fractions — → `null`.
 */
export function parseDuration(iso8601: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso8601);
  if (!match) return null;
  const [, weeks, days, hours, minutes, seconds] = match;
  const parts = [weeks, days, hours, minutes, seconds];
  if (parts.every((part) => part === undefined)) return null; // 'P', 'PT'
  if (iso8601.endsWith('T')) return null; // 'P1DT' — a time designator with no time part
  const [w, d, h, m, s] = parts.map((part) => Number(part ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return w * 604_800 + d * 86_400 + h * 3_600 + m * 60 + s;
}

/** 05 T-UNIT-29: maxres ▸ standard ▸ high ▸ medium ▸ default; empty / missing → `null`. */
export function pickThumbnail(thumbnails: YoutubeThumbnails | null | undefined): string | null {
  if (!thumbnails) return null;
  for (const size of THUMBNAIL_ORDER) {
    const url = thumbnails[size]?.url;
    if (url !== undefined && url !== '') return url;
  }
  return null;
}

/**
 * 04 §5.3 Shorts heuristic (ADR-0002 #67): `duration_seconds <= 60` OR the `#shorts` tag in
 * `title + ' ' + description`. The §5.3 ROWS win over the formula: an unknown duration
 * is never a Short — `null <= 60` is `true` in JS, so the guard comes first — which also means an
 * RSS-only row (no key, no duration) is never a Short, tag or not (05 T-ADP-11).
 */
export function isShort(v: {
  duration_seconds: number | null;
  title: string;
  description: string | null;
}): boolean {
  if (v.duration_seconds === null) return false;
  if (v.duration_seconds <= SHORT_MAX_SECONDS) return true;
  return SHORTS_TAG_RE.test(`${v.title} ${v.description ?? ''}`);
}

/** Data-API counts are decimal strings; anything that is not a finite, non-negative number → `null`. */
function countOrNull(value: string | number | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * 05 T-ADP-12: one `videos.list` item → the `videos` columns. Missing `statistics` (or one hidden
 * count) → `null`, never 0. Pure; does NOT filter live/upcoming — `listVideos` does (ADR-0043 D2).
 */
export function mapVideo(item: YoutubeVideoItem): MappedVideo {
  const title = item.snippet.title;
  const description = item.snippet.description ?? '';
  const duration = item.contentDetails?.duration;
  const durationSeconds = duration === undefined ? null : parseDuration(duration);
  return {
    youtube_id: item.id,
    title,
    description,
    thumbnail_url: pickThumbnail(item.snippet.thumbnails),
    published_at: new Date(item.snippet.publishedAt).toISOString(),
    duration_seconds: durationSeconds,
    is_short: isShort({ duration_seconds: durationSeconds, title, description }),
    view_count: countOrNull(item.statistics?.viewCount),
    like_count: countOrNull(item.statistics?.likeCount),
  };
}

/** ADR-0002 #77: `live` and `upcoming` are excluded; a missing flag reads as `'none'`. */
function isLiveOrUpcoming(item: YoutubeVideoItem): boolean {
  return (item.snippet.liveBroadcastContent ?? 'none') !== 'none';
}

/**
 * 04 §4.3 `videoIdFromUrl` (05 T-ADP-14): `watch?v=`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`
 * on a YouTube host → the 11-char id; anything else (a channel URL, another host, a non-http(s)
 * scheme, an id of the wrong length) → `null`.
 */
export function videoIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  let candidate: string | null | undefined;
  if (host === YOUTUBE_SHORT_HOST) {
    candidate = parsed.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    candidate =
      parsed.pathname === '/watch'
        ? parsed.searchParams.get('v')
        : PATH_ID_RE.exec(parsed.pathname)?.[1];
  }
  return candidate !== null && candidate !== undefined && VIDEO_ID_RE.test(candidate)
    ? candidate
    : null;
}

// ---------------------------------------------------------------------------------------------
// Atom feed reader (ADR-0043 D3 — hand-rolled, no XML dependency: 01 INV-78)
// ---------------------------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** One pass over `&amp; &lt; &gt; &quot; &apos; &#NN; &#xHH;` — a decoded `&` is never re-read. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (!lower.startsWith('#')) return NAMED_ENTITIES[lower] ?? whole;
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** Element text: CDATA sections verbatim, everything around them entity-decoded; trimmed. */
function xmlText(raw: string): string {
  let out = '';
  let cursor = 0;
  for (const match of raw.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += decodeEntities(raw.slice(cursor, match.index)) + (match[1] ?? '');
    cursor = match.index + match[0].length;
  }
  return (out + decodeEntities(raw.slice(cursor))).trim();
}

/** Text of the first `<tag>…</tag>` in `block`, or `null`. `tag` may carry a prefix (`yt:videoId`). */
function elementText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? xmlText(match[1] ?? '') : null;
}

/** Value of `attr` on the first `<tag …>` in `block`, or `null`. */
function attributeValue(block: string, tag: string, attr: string): string | null {
  const open = new RegExp(`<${tag}\\s([^>]*)>`).exec(block)?.[1];
  if (open === undefined) return null;
  const match = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(open);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? '').trim();
}

/**
 * YouTube's channel feed (Atom) → `RssVideo[]` (05 T-ADP-9): `yt:videoId`, `title`, `published`,
 * `media:thumbnail@url`, `media:description` per `<entry>`, in feed order (newest first). Pure (A3).
 * Throws a typed `parse_error` when the document is not a complete feed — no `<feed` root or no
 * `</feed>`, `<entry>` opens ≠ closes (a truncated download) — or when an entry lacks a valid
 * 11-char `yt:videoId`, a `title`, or a parseable `published`. A complete feed with zero entries is
 * `[]` (a channel with no uploads is not an error). `label` names the (key-free) source in the
 * error message.
 */
export function parseRss(xml: string, label: string = YOUTUBE_RSS): RssVideo[] {
  const fail = (why: string): AdapterError =>
    new AdapterError(`GET ${redactSecrets(label)} → parse_error (${why})`, {
      status: 200,
      code: 'parse_error',
      body: xml.slice(0, BODY_LIMIT),
    });

  if (!/<feed[\s>]/.test(xml) || !xml.includes('</feed>')) throw fail('not an Atom feed');
  const opens = xml.match(/<entry[\s>]/g)?.length ?? 0;
  const closes = xml.match(/<\/entry>/g)?.length ?? 0;
  if (opens !== closes) throw fail('unbalanced <entry>');

  const videos: RssVideo[] = [];
  for (const match of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const block = match[1] ?? '';
    const youtubeId = elementText(block, 'yt:videoId');
    if (youtubeId === null || !VIDEO_ID_RE.test(youtubeId)) throw fail('entry without yt:videoId');
    const title = elementText(block, 'title');
    if (title === null || title === '') throw fail('entry without title');
    const published = Date.parse(elementText(block, 'published') ?? '');
    if (Number.isNaN(published)) throw fail('entry without published');
    const thumbnail = attributeValue(block, 'media:thumbnail', 'url');
    const description = elementText(block, 'media:description');
    videos.push({
      youtube_id: youtubeId,
      title,
      published_at: new Date(published).toISOString(),
      thumbnail_url: thumbnail === null || thumbnail === '' ? null : thumbnail,
      description: description === null || description === '' ? null : description,
    });
  }
  return videos;
}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------

/** 04 §4.3 factory (SC-25). Throws a zod error naming any missing env key — before any request. */
export function createYoutube({
  fetch: fetchImpl,
  env,
}: {
  fetch?: typeof fetch;
  env: YoutubeEnv;
}) {
  const parsed = youtubeEnvSchema.parse(env);
  const apiBase = parsed.YOUTUBE_API_BASE ?? YOUTUBE_API;
  const rssBase = parsed.YOUTUBE_RSS_BASE ?? YOUTUBE_RSS;
  const ua = parsed.MODRINTH_USER_AGENT;
  const defaultChannelId = parsed.YOUTUBE_CHANNEL_ID;
  const apiKey = parsed.YOUTUBE_API_KEY;

  /** Data-API list requests issued by this instance (1 quota unit each — 04 §4.3). */
  let units = 0;

  /**
   * Belt and braces over `http.ts`'s `key=` redaction: no literal copy of the key leaves here — not
   * whole, and not as a prefix (≥ 6 chars) left at the end of a body that A4 truncated mid-key.
   */
  function scrubText(text: string, key: string): string {
    const whole = text.replaceAll(key, '[redacted]');
    for (let length = key.length - 1; length >= KEY_TAIL_MIN; length -= 1) {
      if (whole.endsWith(key.slice(0, length))) return `${whole.slice(0, -length)}[redacted]`;
    }
    return whole;
  }
  function scrub(error: unknown): unknown {
    if (!(error instanceof AdapterError) || apiKey === undefined) return error;
    const message = scrubText(error.message, apiKey);
    const body = scrubText(error.body, apiKey);
    if (message === error.message && body === error.body) return error;
    return new AdapterError(message, { status: error.status, code: error.code, body });
  }

  /** A 2xx body that doesn't match the §4.3 shape is a typed `parse_error` (key-free label). */
  function parseOr<T>(schema: z.ZodType<T>, payload: unknown, url: string): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new AdapterError(
        `GET ${redactSecrets(url)} → parse_error (unexpected response shape)`,
        {
          status: 200,
          code: 'parse_error',
          body: (JSON.stringify(payload) ?? '').slice(0, BODY_LIMIT),
        },
      );
    }
    return result.data;
  }

  /**
   * One Data-API list call = one quota unit. `query` is appended verbatim (commas in `part=` stay
   * literal — 05 T-ADP-10 compares the URL as a string); `key` goes last. No key → `unsupported`
   * with no request and no unit.
   */
  async function list<T>(resource: string, query: string, schema: z.ZodType<T>): Promise<T> {
    if (apiKey === undefined) {
      throw new AdapterError(
        `GET ${apiBase}/${resource} → unsupported (YOUTUBE_API_KEY is not set)`,
        {
          status: 0,
          code: 'unsupported',
          body: '',
        },
      );
    }
    const url = `${apiBase}/${resource}?${query}&key=${encodeURIComponent(apiKey)}`;
    units += 1;
    try {
      return parseOr(schema, await fetchJson<unknown>(url, { ua, fetch: fetchImpl }), url);
    } catch (error) {
      throw scrub(error);
    }
  }

  return {
    /**
     * 04 §4.3 / §3.3 step 1: `GET <rss>?channel_id=<id>` — keyless, 0 units, the newest 15 uploads
     * (live and upcoming ones included: the feed carries no live flag).
     */
    async fetchRss(channelId: string = defaultChannelId): Promise<RssVideo[]> {
      const url = `${rssBase}?channel_id=${encodeURIComponent(channelId)}`;
      const xml = await fetchText(url, {
        ua,
        fetch: fetchImpl,
        accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
      });
      return parseRss(xml, url);
    },

    /**
     * 04 §4.3 / §3.3 step 2: `videos.list part=snippet,contentDetails,statistics` in batches of ≤ 50
     * ids, one unit each, strictly one after another. Returns the mapped list in upstream order with
     * live/upcoming dropped (ADR-0043 D2); duplicate input ids are asked for once; `[]` → no request.
     */
    async listVideos(ids: string[]): Promise<MappedVideo[]> {
      const unique = [...new Set(ids)];
      const mapped: MappedVideo[] = [];
      for (let start = 0; start < unique.length; start += VIDEOS_BATCH) {
        const batch = unique.slice(start, start + VIDEOS_BATCH).map(encodeURIComponent);
        const { items } = await list(
          'videos',
          `part=snippet,contentDetails,statistics&id=${batch.join(',')}`,
          videosListResponseSchema,
        );
        for (const item of items) {
          if (!isLiveOrUpcoming(item)) mapped.push(mapVideo(item));
        }
      }
      return mapped;
    },

    /**
     * 04 §4.3 / §3.3 step 3: walks `playlistItems.list part=contentDetails` over the uploads playlist
     * (`"UU" + channelId.slice(2)`, 50/page, one unit per page) → every video id, de-duplicated, in
     * upstream order. Stops at the last page, at a `nextPageToken` it has already followed, or after
     * `MAX_UPLOAD_PAGES` pages — returning what it has rather than looping.
     */
    async listUploads(channelId: string = defaultChannelId): Promise<string[]> {
      const playlistId = `UU${channelId.slice(2)}`;
      const ids = new Set<string>();
      const followed = new Set<string>();
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_UPLOAD_PAGES; page += 1) {
        const query =
          `part=contentDetails&playlistId=${encodeURIComponent(playlistId)}` +
          `&maxResults=${UPLOADS_PAGE_SIZE}` +
          (pageToken === undefined ? '' : `&pageToken=${encodeURIComponent(pageToken)}`);
        const body = await list('playlistItems', query, playlistItemsResponseSchema);
        for (const item of body.items) ids.add(item.contentDetails.videoId);
        const next = body.nextPageToken;
        if (next === undefined || next === '' || followed.has(next)) break;
        followed.add(next);
        pageToken = next;
      }
      return [...ids];
    },

    /**
     * 04 §4.3: `channels.list part=statistics` → `{views, subs}`, 1 unit (05 T-ADP-13). An unknown
     * channel (no `items`) → typed `not_found`; a hidden subscriber count → `subs: null`.
     */
    async channelStats(channelId: string = defaultChannelId): Promise<ChannelStats> {
      const query = `part=statistics&id=${encodeURIComponent(channelId)}`;
      const body = await list('channels', query, channelsResponseSchema);
      const statistics = body.items?.[0]?.statistics;
      if (statistics === undefined) {
        throw new AdapterError(`GET ${apiBase}/channels?${query} → not_found`, {
          status: 200,
          code: 'not_found',
          body: '',
        });
      }
      return {
        views: Number(statistics.viewCount),
        subs:
          statistics.hiddenSubscriberCount === true
            ? null
            : countOrNull(statistics.subscriberCount),
      };
    },

    /**
     * 04 §4.3 / §5.4 step 2: `GET https://www.youtube.com/oembed?url=<enc>&format=json` — no key, 0
     * units. 401/404 (private / removed video) → typed `not_found` (05 T-ADP-15).
     */
    async oembed(url: string): Promise<YoutubeOembed> {
      const target = `${YOUTUBE_OEMBED}?url=${encodeURIComponent(url)}&format=json`;
      let payload: unknown;
      try {
        payload = await fetchJson<unknown>(target, { ua, fetch: fetchImpl });
      } catch (error) {
        if (error instanceof AdapterError && (error.status === 401 || error.status === 404)) {
          throw new AdapterError(`GET ${target} → not_found`, {
            status: error.status,
            code: 'not_found',
            body: error.body,
          });
        }
        throw error;
      }
      const data = parseOr(oembedResponseSchema, payload, target);
      return {
        title: data.title,
        creator_name: data.author_name,
        creator_url: data.author_url,
        thumbnail_url: data.thumbnail_url ?? null,
      };
    },

    /** 05 T-ADP-13 / 00 S1.6 AC9: Data-API units this instance has spent (one per list request). */
    get unitsUsed(): number {
      return units;
    },
    /** `false` → RSS-only: the three Data-API methods throw `unsupported` (04 SC-16 degrade). */
    get hasKey(): boolean {
      return apiKey !== undefined;
    },
    parseDuration,
    pickThumbnail,
    isShort,
    mapVideo,
    parseRss,
    videoIdFromUrl,
  };
}

export type Youtube = ReturnType<typeof createYoutube>;
