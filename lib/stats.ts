/**
 * lib/stats.ts — the stats page's pure arithmetic (00 §S1.9 AC2; 02 §1.3 `/admin/stats`; 03 §2.2
 * `StatTile` / `FlatBarChart`; 04 §3.5 `snapshotStats` registry vocabulary; 05 T-UNIT-42): UTC day
 * helpers, per-(metric, source) daily deltas from `stats_daily` snapshots, the 30-day chart window
 * and its 15-bar phone buckets, and the four tiles with their context lines.
 *
 * Pure and client-safe — NO directive, no zod, no server imports, no `Date` local getters and no
 * `toLocale*` (01 INV-68 / INV-93: `stats_daily.day` is the UTC calendar date, so every day here is
 * `YYYY-MM-DD` built from `Date.UTC`). Consumed by `lib/data/stats.ts` + `app/admin/stats/page.tsx`
 * (server) and `components/primitives/FlatBarChart.tsx`; the job (`lib/jobs/snapshotStats.ts`) shares
 * the metric / source / entity vocabulary and the site sentinel id.
 *
 * Rules: deltas, window and buckets — ADR-0049 D10; tiles — ADR-0049 D11; copy — ADR-0049 D23 (§5 of the S1.9 brief).
 */
import { DOWNLOAD_SOURCES } from '@/lib/format/project';
import { formatCount } from '@/lib/format/number';

// ---- registry vocabulary (docs/build/_registry.md `stats_daily`; 04 §3.5) ----

/** `entity_id` of site and channel rows — PK columns cannot be null (04 §3.5; ADR-0049 D1). */
export const SITE_ENTITY_ID = '00000000-0000-0000-0000-000000000000';

/** `stats_daily.metric` CHECK list (registry conventions; ADR-0049 D1). */
export const STATS_METRICS = [
  'downloads',
  'direct_downloads_day',
  'views',
  'subs',
  'comments',
  'comments_held',
  'likes',
  'users',
  'reach',
  'mentions',
  'tips',
] as const;
export type StatsMetric = (typeof STATS_METRICS)[number];

/** `stats_daily.source` CHECK list (ADR-0049 D1). */
export const STATS_SOURCES = [
  'modrinth',
  'curseforge',
  'direct',
  'odsens',
  'youtube',
  'kofi',
] as const;
export type StatsSource = (typeof STATS_SOURCES)[number];

/** `stats_daily.entity_type` CHECK list (ADR-0049 D1). */
export const STATS_ENTITY_TYPES = ['site', 'project', 'video', 'channel'] as const;
export type StatsEntityType = (typeof STATS_ENTITY_TYPES)[number];

// ---- windows (ADR-0049 D10 / ADR-0049 D11) ----

/** The chart window: the 30 UTC days ending today (DESIGN.md §11.3 #16 "last 30 days"). */
export const CHART_DAYS = 30;
/** Phone: 15 bars of two days each (DESIGN.md §11.1 "Phone shows 15 bars (two days each) and says so"). */
export const COMPACT_BARS = 15;
/** The 7-day tile window (`Downloads · 7 days`) and the week before it. */
export const TILE_WEEK_DAYS = 7;
/** The tips tile window (`Tips · 30 days`). */
export const TIPS_WINDOW_DAYS = 30;
export const READ_WINDOW_DAYS = 38; // CHART_DAYS + TILE_WEEK_DAYS + 1 — ADR-0049 D11

// ---- copy (§5, verbatim; DESIGN.md §7 voice) ----

/** Tile context before any snapshot exists in the tile's window (ADR-0002 #29). */
export const NO_DATA_YET = 'No data yet.';
/** The compact figure's visible caption. */
export const COMPACT_NOTE = '15 bars, two days each';
/** The hidden table's caption and the chart's default accessible name. */
export const CHART_TITLE = 'Downloads · last 30 days';
export const AXIS_START = '30 DAYS AGO';
export const AXIS_END = 'TODAY';
/** The four `StatTile` labels in page order (`StatTile` uppercases them visually). */
export const TILE_LABELS = {
  downloads7: 'Downloads · 7 days',
  downloadsAll: 'Downloads · all time',
  comments: 'Comments',
  tips: 'Tips · 30 days',
} as const;

// ---- shapes ----

/** One `stats_daily` site row as `lib/data/stats.ts` reads it (`day, metric, source, value`). */
export type SiteSnapshotRow = {
  day: string /* YYYY-MM-DD */;
  metric: string;
  source: string;
  value: number;
};

/** One chart column: the three sources' downloads gained on `date` (or the bucket starting there). */
export type DailyDownloads = { date: string; modrinth: number; curseforge: number; direct: number };

/** `StatTile` props as the page passes them (03 §2.2; the number goes through `formatCount` there). */
export type StatsTile = {
  label: string;
  value: number;
  context: { text: string; tone: 'up' | 'attention' | 'neutral' };
};
export type StatsTiles = {
  downloads7: StatsTile;
  downloadsAll: StatsTile;
  comments: StatsTile;
  tips: StatsTile;
};

// ---- UTC day helpers (01 INV-68 — never a local getter) ----

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD` of a UTC epoch millisecond value. */
function formatUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** The UTC calendar date of an instant as `YYYY-MM-DD` (04 §3.5 "`day` = UTC date of the run"). */
export function utcDay(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('stats: invalid date');
  return formatUtcMs(date.getTime());
}

/** `day` ± `n` calendar days in UTC — month, year and leap boundaries included; no DST anywhere. */
export function addDays(day: string, n: number): string {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`stats: not a YYYY-MM-DD day: ${day}`);
  return formatUtcMs(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
}

/** Ascending list of `days` consecutive UTC days ending at (and including) `endDay`. */
export function dayRange(endDay: string, days: number): string[] {
  const count = Math.max(0, Math.floor(days));
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addDays(endDay, -i));
  return out;
}

/** Inclusive `YYYY-MM-DD` comparison — ISO days sort as strings. */
function between(day: string, first: string, last: string): boolean {
  return day >= first && day <= last;
}

// ---- deltas (ADR-0049 D10) ----

/**
 * The snapshots of one (metric, source), one per day, ascending — the last row wins a duplicate
 * day (the PK forbids one; defensive).
 */
function seriesOf(
  rows: readonly SiteSnapshotRow[],
  metric: string,
  source: string,
): SiteSnapshotRow[] {
  const byDay = new Map<string, SiteSnapshotRow>();
  for (const row of rows) {
    if (row.metric === metric && row.source === source) byDay.set(row.day, row);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Per-day gains of one (metric, source) — ADR-0049 D10: a snapshot day's delta is its value minus the
 * PREVIOUS snapshot day's value (whatever the gap), clamped at ≥ 0 and attributed to the later day;
 * the first snapshot has no delta (0). Keyed by snapshot day only — days without a snapshot are
 * simply absent (the chart reads them as 0).
 */
export function dailyDeltas(
  rows: readonly SiteSnapshotRow[],
  metric: string,
  source: string,
): Map<string, number> {
  const deltas = new Map<string, number>();
  let previous: number | null = null;
  for (const row of seriesOf(rows, metric, source)) {
    deltas.set(row.day, previous === null ? 0 : Math.max(0, row.value - previous));
    previous = row.value;
  }
  return deltas;
}

// ---- chart (ADR-0049 D10) ----

/**
 * The 30 chart columns, ascending and ending `today` (`today−29 … today`): each day's `downloads`
 * deltas per source; days without a snapshot are 0. Deltas are computed over EVERY row passed, so a
 * snapshot just before the window still gives the first window day its gain (why the reader's window
 * is wider than the chart's — ADR-0049 D11 `READ_WINDOW_DAYS`).
 */
export function chartDays(rows: readonly SiteSnapshotRow[], today: string): DailyDownloads[] {
  const modrinth = dailyDeltas(rows, 'downloads', 'modrinth');
  const curseforge = dailyDeltas(rows, 'downloads', 'curseforge');
  const direct = dailyDeltas(rows, 'downloads', 'direct');
  return dayRange(today, CHART_DAYS).map((date) => ({
    date,
    modrinth: modrinth.get(date) ?? 0,
    curseforge: curseforge.get(date) ?? 0,
    direct: direct.get(date) ?? 0,
  }));
}

/**
 * The columns a variant draws — ADR-0049 D10: `compact` folds consecutive pairs `(today−29, today−28) …
 * (today−1, today)` into 15 buckets whose `date` is the pair's first day; otherwise a copy. Totals
 * are preserved; an odd tail (29 or 31 days passed) lands in the last bucket, which holds the
 * remainder rather than starting a lone one. Empty in → empty out.
 */
export function bucketDays(days: readonly DailyDownloads[], compact: boolean): DailyDownloads[] {
  if (!compact) return days.map((day) => ({ ...day }));
  if (days.length === 0) return [];
  const per = CHART_DAYS / COMPACT_BARS; // 2 days a bucket
  const buckets = Math.max(1, Math.floor(days.length / per));
  const out: DailyDownloads[] = [];
  for (let b = 0; b < buckets; b += 1) {
    const start = b * per;
    const end = b === buckets - 1 ? days.length : start + per;
    const first = days[start];
    if (!first) break;
    const bucket: DailyDownloads = { date: first.date, modrinth: 0, curseforge: 0, direct: 0 };
    for (let i = start; i < end; i += 1) {
      const day = days[i];
      if (!day) continue;
      bucket.modrinth += day.modrinth;
      bucket.curseforge += day.curseforge;
      bucket.direct += day.direct;
    }
    out.push(bucket);
  }
  return out;
}

/** The tallest stacked column (`modrinth + curseforge + direct`); 0 for no columns. */
export function stackedMax(days: readonly DailyDownloads[]): number {
  let max = 0;
  for (const day of days) max = Math.max(max, day.modrinth + day.curseforge + day.direct);
  return max;
}

// ---- tiles (ADR-0049 D11 + §5 copy) ----

function neutral(text: string): StatsTile['context'] {
  return { text, tone: 'neutral' };
}

/** Σ of the three sources' `downloads` deltas over `days`. */
function sumDownloadDeltas(
  deltas: readonly Map<string, number>[],
  days: readonly string[],
): number {
  let total = 0;
  for (const day of days) for (const series of deltas) total += series.get(day) ?? 0;
  return total;
}

/** True when any row of `metric` has a day inside `[first, last]`. */
function hasRowIn(
  rows: readonly SiteSnapshotRow[],
  metric: string,
  first: string,
  last: string,
): boolean {
  return rows.some((row) => row.metric === metric && between(row.day, first, last));
}

/** The latest day among `metric` rows (any source), or null when there is none. */
function latestDayOf(rows: readonly SiteSnapshotRow[], metric: string): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.metric === metric && (latest === null || row.day > latest)) latest = row.day;
  }
  return latest;
}

/** The value of (metric, source) on `day`, or null when that day has no such row. */
function valueOn(
  rows: readonly SiteSnapshotRow[],
  metric: string,
  source: string,
  day: string,
): number | null {
  const row = rows.find((r) => r.metric === metric && r.source === source && r.day === day);
  return row ? row.value : null;
}

/**
 * The four tiles — ADR-0049 D11 windows anchored on the caller's UTC `today`, context lines per §5:
 *
 * - `downloads7` — Σ of the three sources' `downloads` deltas over `today−6 … today`; context
 *   `<prev7> the week before` (`up` when this week beat it) when the week before holds a snapshot,
 *   else `First week counted.`; `No data yet.` when no `downloads` row falls in the 7 days.
 * - `downloadsAll` — the three sources' values at the latest `downloads` snapshot day (a source
 *   missing on that day counts 0); context `Modrinth <m> · CurseForge <c> · direct <d>`.
 * - `comments` — the latest `comments/odsens` value; `<held> held` from `comments_held/odsens` on the
 *   same day (else its latest), `attention` when held > 0.
 * - `tips` — Σ `tips/kofi` deltas over `today−29 … today` (0 in v1); `Ko-fi isn't counted yet.` once
 *   a tips snapshot exists in that window.
 *
 * Only rows inside the read window `today−37 … today` count (ADR-0049 D11: older-only data reads as
 * `No data yet.` — the SYNC board's `stats` row is what makes a dead cron visible), whatever the
 * caller read.
 */
export function buildStatsTiles(rows: readonly SiteSnapshotRow[], today: string): StatsTiles {
  const windowStart = addDays(today, -(READ_WINDOW_DAYS - 1));
  const inWindow = rows.filter((row) => between(row.day, windowStart, today));

  // downloads7 / prev7
  const week = dayRange(today, TILE_WEEK_DAYS);
  const weekBefore = dayRange(addDays(today, -TILE_WEEK_DAYS), TILE_WEEK_DAYS);
  const weekFirst = week[0] ?? today;
  const weekBeforeFirst = weekBefore[0] ?? today;
  const weekBeforeLast = weekBefore[weekBefore.length - 1] ?? today;
  const downloadDeltas = DOWNLOAD_SOURCES.map((source) =>
    dailyDeltas(inWindow, 'downloads', source),
  );
  const downloads7Value = sumDownloadDeltas(downloadDeltas, week);
  const prev7Value = sumDownloadDeltas(downloadDeltas, weekBefore);
  let downloads7: StatsTile;
  if (!hasRowIn(inWindow, 'downloads', weekFirst, today)) {
    downloads7 = { label: TILE_LABELS.downloads7, value: 0, context: neutral(NO_DATA_YET) };
  } else if (hasRowIn(inWindow, 'downloads', weekBeforeFirst, weekBeforeLast)) {
    downloads7 = {
      label: TILE_LABELS.downloads7,
      value: downloads7Value,
      context: {
        text: `${formatCount(prev7Value)} the week before`,
        tone: downloads7Value > prev7Value ? 'up' : 'neutral',
      },
    };
  } else {
    downloads7 = {
      label: TILE_LABELS.downloads7,
      value: downloads7Value,
      context: neutral('First week counted.'),
    };
  }

  // downloadsAll
  const latestDownloadsDay = latestDayOf(inWindow, 'downloads');
  let downloadsAll: StatsTile;
  if (latestDownloadsDay === null) {
    downloadsAll = { label: TILE_LABELS.downloadsAll, value: 0, context: neutral(NO_DATA_YET) };
  } else {
    const m = valueOn(inWindow, 'downloads', 'modrinth', latestDownloadsDay) ?? 0;
    const c = valueOn(inWindow, 'downloads', 'curseforge', latestDownloadsDay) ?? 0;
    const d = valueOn(inWindow, 'downloads', 'direct', latestDownloadsDay) ?? 0;
    downloadsAll = {
      label: TILE_LABELS.downloadsAll,
      value: m + c + d,
      context: neutral(
        `Modrinth ${formatCount(m)} · CurseForge ${formatCount(c)} · direct ${formatCount(d)}`,
      ),
    };
  }

  // comments + held
  const latestCommentsDay = latestDayOf(
    inWindow.filter((row) => row.source === 'odsens'),
    'comments',
  );
  let comments: StatsTile;
  if (latestCommentsDay === null) {
    comments = { label: TILE_LABELS.comments, value: 0, context: neutral(NO_DATA_YET) };
  } else {
    const value = valueOn(inWindow, 'comments', 'odsens', latestCommentsDay) ?? 0;
    const latestHeldDay = latestDayOf(
      inWindow.filter((row) => row.source === 'odsens'),
      'comments_held',
    );
    const held =
      valueOn(inWindow, 'comments_held', 'odsens', latestCommentsDay) ??
      (latestHeldDay === null
        ? 0
        : (valueOn(inWindow, 'comments_held', 'odsens', latestHeldDay) ?? 0));
    comments = {
      label: TILE_LABELS.comments,
      value,
      context: { text: `${formatCount(held)} held`, tone: held > 0 ? 'attention' : 'neutral' },
    };
  }

  // tips
  const tipsDays = dayRange(today, TIPS_WINDOW_DAYS);
  const tipsFirst = tipsDays[0] ?? today;
  let tips: StatsTile;
  if (!hasRowIn(inWindow, 'tips', tipsFirst, today)) {
    tips = { label: TILE_LABELS.tips, value: 0, context: neutral(NO_DATA_YET) };
  } else {
    const tipDeltas = dailyDeltas(inWindow, 'tips', 'kofi');
    let value = 0;
    for (const day of tipsDays) value += tipDeltas.get(day) ?? 0;
    tips = { label: TILE_LABELS.tips, value, context: neutral("Ko-fi isn't counted yet.") };
  }

  return { downloads7, downloadsAll, comments, tips };
}
