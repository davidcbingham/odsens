/**
 * lib/format/reach.ts — the Reach line (05 T-UNIT-9 `formatReachLine`; DESIGN.md §12.1 "Reach
 * line": Silkscreen emerald, letter-spaced "1.2M VIEWS · 6 VIDEOS · 4 CREATORS" — "the numbers
 * brag, the copy doesn't"; 03 §2.8 `ReachLine`; 02 §2.1 item 3 / §2.6 totals; ADR-0002 #77).
 *
 * Pure and locale-free (01 INV-68 / INV-93), client-safe (no zod, no server imports — ADR-0008).
 * The totals come from `reachTotals` (`lib/mentions.ts`): views = Σ `view_count`, videos = every
 * published mention (articles too — SEED-10 is one YouTube + one TikTok row and reads `2 VIDEOS`,
 * 05 §3), creators = distinct `creator_name`.
 *
 *   formatReachLine({ views: 1200000, videos: 6, creators: 4 })
 *     → text     `1.2M VIEWS · 6 VIDEOS · 4 CREATORS`            (uppercase in source, `·` between)
 *       segments [`1.2M VIEWS`, `6 VIDEOS`, `4 CREATORS`]         (one `PixelLabel` each — ADR-0045:
 *                                                                  the whole line is 8 words and
 *                                                                  `PixelLabel` guards at 5)
 *       spoken   `1.2 million views · 6 videos · 4 creators`      (03 "sr text expands abbreviations")
 *
 * Rules (T-UNIT-9, verbatim): views print through `formatCount` (`12.5K`, `1K`, `1.5B`); a count
 * of exactly 1 reads singular (`1 VIDEO`, `1 CREATOR`, `1 VIEW`); `views` 0 / null omits the views
 * segment (ADR-0002 #77 — never "0 VIEWS"; a platform that gives no count is not a zero). Nothing
 * to say (no views AND no mentions AND no creators) → `''` / `[]` — the caller renders nothing
 * (03 `ReachLine`: "Zero mentions → renders nothing").
 */
import { formatCount, spokenCount } from '@/lib/format/number';

/** `ReachTotals` (`lib/mentions.ts`) fits; `views` may also be null/absent (T-UNIT-9 "views 0/null"). */
export type ReachLineInput = {
  views?: number | null;
  videos: number;
  creators: number;
};

export type ReachLine = {
  /** The visible line: `segments` joined by ` · `. `''` when there is nothing to say. */
  text: string;
  /** The same line for a screen reader: lower-case words, unit abbreviations expanded. */
  spoken: string;
  /** The visible line in pieces (each at most two words), in display order. */
  segments: string[];
};

const SEPARATOR = ' · ';

/** Counts are whole and non-negative; anything else (NaN, null, a negative) reads as 0. */
function whole(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function noun(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function formatReachLine(totals: ReachLineInput): ReachLine {
  const views = whole(totals.views);
  const videos = whole(totals.videos);
  const creators = whole(totals.creators);
  if (views === 0 && videos === 0 && creators === 0) return { text: '', spoken: '', segments: [] };

  const segments: string[] = [];
  const spoken: string[] = [];
  if (views > 0) {
    segments.push(`${formatCount(views)} ${noun(views, 'VIEW', 'VIEWS')}`);
    spoken.push(`${spokenCount(views)} ${noun(views, 'view', 'views')}`);
  }
  segments.push(`${formatCount(videos)} ${noun(videos, 'VIDEO', 'VIDEOS')}`);
  spoken.push(`${spokenCount(videos)} ${noun(videos, 'video', 'videos')}`);
  segments.push(`${formatCount(creators)} ${noun(creators, 'CREATOR', 'CREATORS')}`);
  spoken.push(`${spokenCount(creators)} ${noun(creators, 'creator', 'creators')}`);

  return { text: segments.join(SEPARATOR), spoken: spoken.join(SEPARATOR), segments };
}
