/**
 * lib/mentions.ts — the pure, client-safe half of the mentions data layer (S1.8; 03 §2.8
 * `MentionCard` / `ReachLine` / `SeenOnRow` / `InTheWildStrip` + the `SeenOnGrid` island; 03 V-04
 * link-out chip wording; 02 §2.1 item 3 Home IN THE WILD, §2.3 item 5 SEEN ON, §2.6 `/seen-on`;
 * DESIGN.md §12.1 / §12.2; ADR-0002 #21 / #33 / #62; ADR-0045).
 *
 * Plain module (no directive, no env, no `server-only`, no zod — ADR-0008): bundled into the
 * `MentionCard` / `SeenOnGrid` client leaves, which may not import `@/lib/data/*` (01 INV-09 Check
 * greps every client file for it). So the prop type `MentionCardData` is declared HERE and
 * `lib/data/mentions.ts` (server-only: the one cached reader `listPublishedMentions`, tags
 * `mentions` + `projects`) re-exports it with `export type` — the `lib/videos.ts` split
 * (ADR-0043 D6). `tests/unit/mentions.test.ts` covers every function.
 *
 * What lives here:
 *   MENTION_PLATFORMS · MentionPlatform     the `mention_platform` enum (04 §1.6), in display order
 *   MentionCardData · PublishedMention      the component prop shape (serialisable: camelCase, ISO
 *                                           date strings — 03 C-19) and the reader's row (+ the
 *                                           three ordering keys no card prints)
 *   ReachTotals · reachTotals               views / videos / creators over a list (02 §2.6)
 *   platformLabel · linkOutChipLabel        the platform word; the 03 V-04 chip wording
 *   isPlayableInline · mentionThumbnail     YouTube-with-an-id plays inline; the ONE thumbnail URL
 *                                           the UI may render (01 INV-54 host; ADR-0002 #33)
 *   newestFirst · featuredMentions · projectMentions
 *                                           the three surface orders (02 §2.6 / §2.1 #3 / §2.3 #5)
 *   MentionFilters · GENERAL_PROJECT_VALUE · parseMentionFilters · applyMentionFilters
 *   platformCounts · projectOptions         `/seen-on` filter state (`?platform=`, `?project=`) and
 *                                           the `FilterBar` groups / project `Select` options
 *
 * Every function is pure: no clock, no I/O, inputs are never mutated. Ordering is locale-free on
 * purpose (01 INV-68 / INV-93) — server and client must order identically.
 */
import type { ProjectType } from '@/lib/format/project';

/** `mention_platform` (data-model §2.3b; 04 §1.6 `createMentionInput.platform`) — display order. */
export const MENTION_PLATFORMS = [
  'youtube',
  'tiktok',
  'twitch',
  'reddit',
  'article',
  'other',
] as const;
export type MentionPlatform = (typeof MENTION_PLATFORMS)[number];

/**
 * 03 §2.8 `MentionCard` prop shape — one published row of `mentions`. `creatorUrl`, `thumbnailUrl`
 * and `publishedAt` are nullable (ADR-0045: `createMentionInput` makes all three optional and an
 * Open Graph preview often has none).
 */
export type MentionCardData = {
  id: string;
  platform: MentionPlatform;
  /** The canonical link out (`mentions.url` — https, tracking params stripped; 04 §1.6). */
  url: string;
  /** Platform-native id; for `youtube` the 11-char video id. `null` → the card links out. */
  externalId: string | null;
  title: string;
  /** Public channel name — with `creatorUrl` the only creator data anywhere (00 S1.8.AC11). */
  creatorName: string;
  creatorUrl: string | null;
  /**
   * As handed over by `lib/data/mentions.ts`: `mentionThumbnail(row)` — the i.ytimg.com literal for
   * a playable YouTube mention, else `null` (the `PlatformMark` placeholder). A stored non-YouTube
   * thumbnail never leaves the data layer (ADR-0002 #33).
   */
  thumbnailUrl: string | null;
  /** ISO 8601 (`mentions.published_at`); `null` when the platform gave no date → no `<time>`. */
  publishedAt: string | null;
  /** `null` when the platform gives no count → no views text (never "0 VIEWS"). */
  viewCount: number | null;
  /** `null` = "About OddSense generally" (`mentions.project_id IS NULL`) → the ODSENS chip. */
  project: { slug: string; title: string; type: ProjectType } | null;
};

/** What `listPublishedMentions` returns: the card plus the keys the surface orders sort on. */
export type PublishedMention = MentionCardData & {
  featured: boolean;
  sortOrder: number;
  /** ISO 8601 (`mentions.created_at`) — the "newest first" fallback when `publishedAt` is null. */
  createdAt: string;
};

/** 02 §2.1 item 3 / §2.6: Σ `view_count`, count of mentions, distinct `creator_name`. */
export type ReachTotals = { views: number; videos: number; creators: number };

/** `/seen-on` filter state — JSON-serialisable (03 C-19). `null` = no filter on that key. */
export type MentionFilters = {
  platform: MentionPlatform | null;
  /** A project slug, or `GENERAL_PROJECT_VALUE` for the general mentions (`project === null`). */
  project: string | null;
};

/** 02 §2.6: `?project=odsens` = the mentions about OddSense generally. */
export const GENERAL_PROJECT_VALUE = 'odsens';

/** The project `Select`'s last option (02 §2.6: `+ "About OddSense"`). */
const GENERAL_PROJECT_LABEL = 'About OddSense';

/** `projects.slug` is ≤ 64 (04 §1.4 `SLUG`); a longer `?project=` value can never match. */
const PROJECT_PARAM_MAX = 64;

const PLATFORM_LABELS: Record<MentionPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  twitch: 'Twitch',
  reddit: 'Reddit',
  article: 'Article',
  other: 'Other',
};

/** `FilterBar` button words — uppercase IN SOURCE (e2e reads DOM text, not `text-transform`). */
const PLATFORM_FILTER_LABELS: Record<MentionPlatform, string> = {
  youtube: 'YOUTUBE',
  tiktok: 'TIKTOK',
  twitch: 'TWITCH',
  reddit: 'REDDIT',
  article: 'ARTICLE',
  other: 'OTHER',
};

const PLATFORM_SET: ReadonlySet<string> = new Set<string>(MENTION_PLATFORMS);

/** A YouTube video id is exactly 11 URL-safe characters (04 §1.8; `mentions_youtube_external_id_format`). */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** 03 V-04: `<SITE>` longer than this falls back to `READ ON THE SITE`. */
const SITE_MAX = 16;
const READ_ON_THE_SITE = 'READ ON THE SITE';

/** The platform word, as `PlatformMark` spells it (03 §2.2): `YouTube`, `TikTok`, … */
export function platformLabel(platform: MentionPlatform): string {
  return PLATFORM_LABELS[platform];
}

/** `<SITE>` for an article link: hostname without a leading `www.`, uppercased; `null` = no host. */
function siteWord(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const site = host.replace(/^www\./i, '').toUpperCase();
  return site === '' || site.length > SITE_MAX ? null : site;
}

/**
 * 03 V-04 (DECIDED — ADR-0002 #21) link-out chip wording: `WATCH ON TIKTOK` / `WATCH ON TWITCH`,
 * `SEE ON REDDIT`, `OPEN ↗` for `other`, and for `article` `READ ON <SITE>` where `<SITE>` is the
 * hostname without `www.`, uppercased, at most 16 characters — else (or for a URL that does not
 * parse) `READ ON THE SITE`. `youtube` reads `WATCH ON YOUTUBE`: only a YouTube mention WITHOUT an
 * id reaches the link-out card (ADR-0045; one with an id plays inline — `isPlayableInline`). Every
 * answer is at most four words (the `PixelLabel` 5-word guard).
 */
export function linkOutChipLabel(platform: MentionPlatform, url: string): string {
  switch (platform) {
    case 'youtube':
      return 'WATCH ON YOUTUBE';
    case 'tiktok':
      return 'WATCH ON TIKTOK';
    case 'twitch':
      return 'WATCH ON TWITCH';
    case 'reddit':
      return 'SEE ON REDDIT';
    case 'article': {
      const site = siteWord(url);
      return site === null ? READ_ON_THE_SITE : `READ ON ${site}`;
    }
    case 'other':
      return 'OPEN ↗';
  }
}

/**
 * True when the card plays in place: a YouTube mention with a well-formed video id (the facade →
 * nocookie iframe, 01 INV-57). Everything else — every other platform, a YouTube row whose
 * `externalId` is null or malformed — is a link-out card.
 */
export function isPlayableInline(
  mention: Pick<MentionCardData, 'platform' | 'externalId'>,
): boolean {
  return (
    mention.platform === 'youtube' &&
    mention.externalId !== null &&
    YOUTUBE_ID_RE.test(mention.externalId)
  );
}

/**
 * The ONE thumbnail URL the UI may hand to `next/image`: `https://i.ytimg.com/vi/<id>/hqdefault.jpg`
 * for a playable YouTube mention — built from the id, never read from `mentions.thumbnail_url`, so
 * the host is always on the 01 INV-54 list (a stray host would throw at render and take Home, the
 * project page and `/seen-on` down together: they share one cached list). `null` for everything
 * else → the `PlatformMark` placeholder; non-YouTube thumbnails are never rendered (ADR-0002 #33).
 */
export function mentionThumbnail(
  mention: Pick<MentionCardData, 'platform' | 'externalId'>,
): string | null {
  if (!isPlayableInline(mention) || mention.externalId === null) return null;
  return `https://i.ytimg.com/vi/${mention.externalId}/hqdefault.jpg`;
}

/**
 * 02 §2.1 item 3 / §2.6 totals over the list it is given (callers pass ALL published mentions,
 * never the featured subset): `views` = Σ `viewCount ?? 0`, `videos` = the number of mentions
 * (every platform — SEED-10 reads `2 VIDEOS`), `creators` = distinct `creatorName`, compared
 * trimmed and case-insensitively.
 */
export function reachTotals(list: readonly MentionCardData[]): ReachTotals {
  let views = 0;
  const creators = new Set<string>();
  for (const mention of list) {
    views += mention.viewCount ?? 0;
    creators.add(mention.creatorName.trim().toLowerCase());
  }
  return { views, videos: list.length, creators: creators.size };
}

/** An ISO date as a sortable number; `null` / unparseable → `null` (sorts last, never throws). */
function toMs(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Descending by date, a missing date last; 0 when both are missing or equal. */
function byDateDesc(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right > left ? 1 : -1;
}

/** `publishedAt` desc (nulls last) → `createdAt` desc → `id` asc: total, so the order is one order. */
function compareNewest(a: PublishedMention, b: PublishedMention): number {
  return (
    byDateDesc(toMs(a.publishedAt), toMs(b.publishedAt)) ||
    byDateDesc(toMs(a.createdAt), toMs(b.createdAt)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * 02 §2.6 "newest `published_at` first": a sorted COPY — `publishedAt` desc, mentions without a
 * date last, then `createdAt` desc, then `id`, so the answer never depends on the caller's order
 * (deterministic between revalidations and between server and client).
 */
export function newestFirst<T extends PublishedMention>(list: readonly T[]): T[] {
  return [...list].sort(compareNewest);
}

/**
 * Home's IN THE WILD cards (02 §2.1 item 3): the featured mentions by `sortOrder` ascending (ties →
 * newest), at most `max` (default 4). `max <= 0`, fractional or NaN floors, never negative.
 */
export function featuredMentions<T extends PublishedMention>(list: readonly T[], max = 4): T[] {
  const take = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  if (take === 0) return [];
  return list
    .filter((mention) => mention.featured)
    .sort((a, b) => a.sortOrder - b.sortOrder || compareNewest(a, b))
    .slice(0, take);
}

/**
 * One project's SEEN ON row (02 §2.3 item 5): the mentions attached to `slug`, `featured` first,
 * then newest. General mentions (`project === null`) never match a slug.
 */
export function projectMentions<T extends PublishedMention>(list: readonly T[], slug: string): T[] {
  return list
    .filter((mention) => mention.project !== null && mention.project.slug === slug)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || compareNewest(a, b));
}

/**
 * The `/seen-on` `FilterBar` platform group (02 §2.6 "one button per platform with counts"): only
 * platforms with at least one mention, in `MENTION_PLATFORMS` order, labels uppercase in source
 * (05 T-E2E-10 reads exactly `YOUTUBE 1 · TIKTOK 1`). Counted once over the full list — the counts
 * are not faceted by the project select (the `/projects` precedent). Structurally a
 * `FilterOption[]` (`components/projects/FilterBar.tsx`).
 */
export function platformCounts(
  list: readonly MentionCardData[],
): { value: string; label: string; count: number }[] {
  const counts = new Map<MentionPlatform, number>();
  for (const mention of list) counts.set(mention.platform, (counts.get(mention.platform) ?? 0) + 1);
  return MENTION_PLATFORMS.flatMap((platform) => {
    const count = counts.get(platform) ?? 0;
    return count > 0 ? [{ value: platform, label: PLATFORM_FILTER_LABELS[platform], count }] : [];
  });
}

/**
 * The `/seen-on` project `Select` values (02 §2.6): every project with at least one mention, by
 * title A→Z (case-insensitive, slug breaks a tie), then — only when a general mention exists —
 * `{ value: 'odsens', label: 'About OddSense' }` last. The caller puts its own "All projects"
 * (`value: ''`) option in front.
 */
export function projectOptions(
  list: readonly MentionCardData[],
): { value: string; label: string }[] {
  const titles = new Map<string, string>();
  let general = false;
  for (const mention of list) {
    if (mention.project === null) general = true;
    else if (!titles.has(mention.project.slug))
      titles.set(mention.project.slug, mention.project.title);
  }
  const options = [...titles].map(([value, label]) => ({ value, label }));
  options.sort((a, b) => {
    const [left, right] = [a.label.toLowerCase(), b.label.toLowerCase()];
    if (left !== right) return left < right ? -1 : 1;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });
  if (general) options.push({ value: GENERAL_PROJECT_VALUE, label: GENERAL_PROJECT_LABEL });
  return options;
}

/**
 * Parses `?platform=&project=` (02 §2.6 "Query (client-side)") — unknown values fall away silently
 * (the `parseProjectFilters` rule): `platform` must be one of `MENTION_PLATFORMS`; `project` is a
 * trimmed, non-empty value of at most 64 characters (a slug, or `odsens`). Pass `projectValues`
 * (the `projectOptions(...)` values) to also drop a `project` the select does not offer — without
 * it an unknown slug would filter to nothing while the `Select` shows "All projects".
 */
export function parseMentionFilters(
  params: URLSearchParams,
  projectValues?: readonly string[],
): MentionFilters {
  const platform = params.get('platform');
  const project = params.get('project')?.trim() ?? '';
  const projectKnown =
    project !== '' &&
    project.length <= PROJECT_PARAM_MAX &&
    (projectValues === undefined || projectValues.includes(project));
  return {
    platform:
      platform !== null && PLATFORM_SET.has(platform) ? (platform as MentionPlatform) : null,
    project: projectKnown ? project : null,
  };
}

/**
 * The `/seen-on` grid filter (exported pure — the `applyProjectFilters` precedent): order is kept.
 * `project === 'odsens'` keeps the general mentions; any other value keeps that slug's mentions.
 */
export function applyMentionFilters<T extends MentionCardData>(
  list: readonly T[],
  filters: MentionFilters,
): T[] {
  return list.filter((mention) => {
    if (filters.platform !== null && mention.platform !== filters.platform) return false;
    if (filters.project === null) return true;
    if (filters.project === GENERAL_PROJECT_VALUE) return mention.project === null;
    return mention.project !== null && mention.project.slug === filters.project;
  });
}
