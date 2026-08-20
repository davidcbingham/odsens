/**
 * lib/format/date.ts — date formatting without `toLocale*` (01 INV-68 / INV-93; 04 SC-14).
 *
 * Every function is pure and computes in UTC, so server and client render the same string
 * (no hydration mismatch, no timezone surprises). Nothing here calls `Intl` or `toLocale*`
 * — the ESLint rule `no-restricted-properties` (INV-93) is what keeps those out of the rest
 * of the app; this module is the allowed home for human formatting.
 *
 * - `formatDay(d)`      → `2026-08-27` (UTC calendar date — the "You can change it again on …" line, 04 §1.1)
 * - `formatDate(d)`     → `12 Aug 2026` (absolute fallback used by `relativeTime`; 05 T-UNIT-13)
 * - `relativeTime(d, now)` → `just now` · `4 min ago` · `2 h ago` · `yesterday` · `3 days ago` · then `formatDate`
 */

export type DateInput = string | Date;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('formatDate: invalid date');
  return date;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD` of the UTC calendar day (04 SC-14 "day = UTC calendar date"). */
export function formatDay(value: DateInput): string {
  const d = toDate(value);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** `12 Aug 2026` in UTC — the absolute form `relativeTime` falls back to after a week. */
export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Lowercase relative phrasing per DESIGN.md §7 (05 T-UNIT-13). Future dates read as `just now`.
 * `now` is injectable so tests never depend on the wall clock.
 */
export function relativeTime(value: DateInput, now: DateInput = new Date()): string {
  const then = toDate(value).getTime();
  const ref = toDate(now).getTime();
  const diff = Math.max(0, ref - then);
  if (diff < 45 * SECOND) return 'just now';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return formatDate(new Date(then));
}
