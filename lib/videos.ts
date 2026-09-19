/**
 * lib/videos.ts — the pure, client-safe half of the videos data layer (S1.6; 03 §2.6 `VideoFacade` /
 * `UpNextList` / `VideoCard` / `ShortsRow`; 01 INV-57 embeds; 02 route row `/videos` + §2.1 item 4
 * Home "Latest videos").
 *
 * Plain module (no directive, no env, no `server-only`, no zod — ADR-0008): bundled into the
 * `VideoFacade` / `UpNextList` / `VideoStage` client leaves, which may not import `@/lib/data/*`
 * (01 INV-09 Check greps every client file for it). So the prop type `VideoCardData` is declared
 * HERE and `lib/data/videos.ts` (server-only: the one cached reader `listVisibleVideos`, tag
 * `videos`) re-exports it with `export type` — ADR-0043 D6 (03 §2.6 said "defined once in
 * `lib/data/videos.ts`"; the shape is unchanged). `lib/support.ts` is the module precedent
 * (ADR-0041 D8); `tests/unit/videos.test.ts` covers every function.
 *
 * What lives here:
 *   VideoCardData · VideoStageItem          the component prop shapes (serialisable: camelCase,
 *                                           ISO date strings — 03 C-19)
 *   UP_NEXT_COUNT                           4 rows beside the player (ADR-0043 D12; 02 §6 skeleton
 *                                           "player well + 4 facade shells"; pass-3 prototype)
 *   YOUTUBE_CHANNEL_URL                     the one channel link (02 RP-13; the §11.7 empty state,
 *                                           "Subscribe on YouTube", Home's head link)
 *   youtubeEmbedUrl · youtubeWatchUrl       the only two YouTube URLs the UI builds (01 INV-57)
 *   splitVideos · latestLongVideos          long-form vs Shorts (AC5), Home's newest two (AC6)
 *   blurbFrom                               `videos.description` → the hero blurb
 *
 * Every function is pure: no clock, no I/O, inputs are never mutated.
 */

/** 03 §2.6 `VideoCard` prop shape — one row of `videos`, already filtered to `hidden = false`. */
export type VideoCardData = {
  id: string;
  youtubeId: string;
  title: string;
  thumbnailUrl: string;
  /** `null` on an RSS-only row (04 §3.3, no `YOUTUBE_API_KEY`) → the caller renders no chip. */
  durationSeconds: number | null;
  /** ISO 8601 (`videos.published_at`). */
  publishedAt: string;
  /** `null` when `statistics` was missing or the row is RSS-only (05 T-ADP-12) → date-only meta. */
  viewCount: number | null;
  /** The effective flag (`videos.is_short` = override ?? 04 §5.3 heuristic — ADR-0043 D1). */
  isShort: boolean;
};

/** What the `VideoStage` island takes (ADR-0043 D4): a card plus the hero blurb (`blurbFrom`). */
export type VideoStageItem = VideoCardData & { blurb: string | null };

/** Up next rows beside the big player; the list includes the selected video (ADR-0043 D12). */
export const UP_NEXT_COUNT = 4;

/** The channel (02 RP-13 — same literal as the footer's "Find me" YouTube link). */
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@OdSens';

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
const WATCH_ORIGIN = 'https://www.youtube.com';

/**
 * The `VideoFacade` iframe `src` (01 INV-57; 00 S1.6.AC2): the privacy-enhanced host, mounted only
 * after a click, `autoplay=1` because the click WAS the play gesture. The id is encoded so nothing
 * stored in `videos.youtube_id` can leave its path segment.
 */
export function youtubeEmbedUrl(youtubeId: string): string {
  return `${EMBED_ORIGIN}/embed/${encodeURIComponent(youtubeId)}?autoplay=1`;
}

/** The "Watch on YouTube" link for one video — a plain outbound link, never an embed. */
export function youtubeWatchUrl(youtubeId: string): string {
  return `${WATCH_ORIGIN}/watch?v=${encodeURIComponent(youtubeId)}`;
}

/**
 * Long-form vs Shorts (00 S1.6.AC5: Shorts appear only in `ShortsRow`). Order is kept — the reader
 * hands over `published_at desc`, so both halves stay newest-first. `splitVideos([])` →
 * `{ long: [], shorts: [] }`: the literal-empty arm behind the §11.7 empty state (ADR-0043 D9 —
 * the e2e reaches "no VISIBLE rows"; this is where "no rows at all" is proven).
 */
export function splitVideos<T extends VideoCardData>(videos: T[]): { long: T[]; shorts: T[] } {
  const long: T[] = [];
  const shorts: T[] = [];
  for (const video of videos) (video.isShort ? shorts : long).push(video);
  return { long, shorts };
}

/** `published_at` as a sortable number; an unparseable date sorts last instead of throwing. */
function publishedMs(video: VideoCardData): number {
  const ms = Date.parse(video.publishedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * The `count` newest non-short videos (02 §2.1 item 4 / 00 S1.6.AC6: Home shows the two newest
 * where `hidden = false AND is_short = false`; hidden rows never reach this module). Sorts a copy
 * newest-first (stable — ties keep the reader's order), so the answer does not depend on the
 * caller's ordering. `count <= 0` or a fractional/NaN count → floors, never negative.
 */
export function latestLongVideos<T extends VideoCardData>(videos: T[], count: number): T[] {
  const take = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (take === 0) return [];
  return videos
    .filter((video) => !video.isShort)
    .sort((a, b) => {
      const [left, right] = [publishedMs(a), publishedMs(b)];
      return left === right ? 0 : right > left ? 1 : -1;
    })
    .slice(0, take);
}

/**
 * `videos.description` → the hero blurb under the big player: the first paragraph (up to the first
 * blank line), inner line breaks and runs of whitespace folded to single spaces, trimmed. `null`
 * for a `null` / empty / whitespace-only description (RSS-only rows, SEED-11 `seedvid0006`) → the
 * caller renders no blurb. Plain text only — the UI prints it as a text node, never as Markdown
 * or HTML (the description is upstream content, not Oliver's).
 */
export function blurbFrom(description: string | null): string | null {
  if (description === null) return null;
  const first = description.trim().split(/\r?\n[^\S\r\n]*\r?\n/)[0] ?? '';
  const blurb = first.replace(/\s+/g, ' ').trim();
  return blurb === '' ? null : blurb;
}
