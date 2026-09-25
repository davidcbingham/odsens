/**
 * lib/format/number.ts — compact + grouped counts (05 T-UNIT-10 `formatCount`; 03 §2.2 `StatTile`
 * "number via `lib/format/number.ts` (`1.2M`)"; DESIGN.md §5 Silkscreen download counts; 05
 * T-UNIT-9 `formatReachLine`, which prints its views through this module — `1.5B`, and the sr
 * expansion "1.2 million").
 *
 * Pure and locale-free — no `Intl`, no `toLocale*` (01 INV-68 / INV-93), so server and client
 * render the same string. Client-safe (no zod, no server imports — ADR-0008).
 *
 *   formatCount(8934)      → `8.9K`   (0→`0`, 999→`999`, 1000→`1K`, 1000000→`1M`; no trailing `.0`)
 *   formatCount(1.5e9)     → `1.5B`   (S1.8 — ADR-0045: the `B` tier T-UNIT-9 asks for; every
 *                                      T-UNIT-10 vector is below it and reads as before)
 *   spokenCount(1200000)   → `1.2 million` (the same figure with the unit as a word — sr text)
 *   formatCountFull(12431) → `12,431` (the sr text on `ProjectCard`: "12,431 downloads" — 03 §2.3)
 */

/** The compact units, smallest first. `word` is the spoken form of `suffix` (03 §2.8 `ReachLine`). */
const UNITS = [
  { divisor: 1_000, suffix: 'K', word: 'thousand' },
  { divisor: 1_000_000, suffix: 'M', word: 'million' },
  { divisor: 1_000_000_000, suffix: 'B', word: 'billion' },
] as const;
type Unit = (typeof UNITS)[number];

/** The largest unit: everything past `999.9B` stays in billions (`1500B`) — there is no `T`. */
const LARGEST_UNIT: Unit = UNITS[2];

/**
 * One count as `figure` + `unit`: below 1000 verbatim (no unit), then one decimal with the
 * trailing `.0` stripped, in the smallest unit whose ROUNDED figure is still under 1000 — so
 * rounding that lands on the next unit rolls over (`999950` → `1M`, `999950000` → `1B`) instead of
 * printing `1000K`. Negative, fractional or non-finite input is clamped/floored — counts are
 * non-negative integers.
 */
function compact(n: number): { figure: string; unit: Unit | null } {
  const value = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (value < 1000) return { figure: String(value), unit: null };
  const unit = UNITS.find((candidate) => round1(value / candidate.divisor) < 1000) ?? LARGEST_UNIT;
  return { figure: trim(round1(value / unit.divisor)), unit };
}

/**
 * Compact count per 05 T-UNIT-10: below 1000 verbatim, then one-decimal `K` / `M` / `B` with the
 * trailing `.0` stripped. Rounding that lands on the next unit rolls over (`999950` → `1M`).
 * Negative or fractional input is clamped/floored — counts are non-negative integers.
 */
export function formatCount(n: number): string {
  const { figure, unit } = compact(n);
  return unit === null ? figure : `${figure}${unit.suffix}`;
}

/**
 * The figure `formatCount` prints, with the unit spoken: `1200000` → `1.2 million`, `12500` →
 * `12.5 thousand`, `999` → `999` (05 T-UNIT-9 "sr expansion `1.2 million views`"; 03 §2.8
 * `ReachLine` "sr text expands abbreviations"). Same rounding as `formatCount`, so the visible and
 * the spoken number never disagree.
 */
export function spokenCount(n: number): string {
  const { figure, unit } = compact(n);
  return unit === null ? figure : `${figure} ${unit.word}`;
}

/** Comma-grouped full number: `12431` → `12,431`. */
export function formatCountFull(n: number): string {
  const value = Math.max(0, Math.floor(n));
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
