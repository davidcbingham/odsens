/**
 * lib/format/number.ts — compact + grouped counts (05 T-UNIT-10 `formatCount`; 03 §2.2 `StatTile`
 * "number via `lib/format/number.ts` (`1.2M`)"; DESIGN.md §5 Silkscreen download counts).
 *
 * Pure and locale-free — no `Intl`, no `toLocale*` (01 INV-68 / INV-93), so server and client
 * render the same string. Client-safe (no zod, no server imports — ADR-0008).
 *
 *   formatCount(8934)      → `8.9K`   (0→`0`, 999→`999`, 1000→`1K`, 1000000→`1M`; no trailing `.0`)
 *   formatCountFull(12431) → `12,431` (the sr text on `ProjectCard`: "12,431 downloads" — 03 §2.3)
 */

/**
 * Compact count per 05 T-UNIT-10: below 1000 verbatim, then one-decimal `K` / `M` with the
 * trailing `.0` stripped. Rounding that lands on the next unit rolls over (`999950` → `1M`).
 * Negative or fractional input is clamped/floored — counts are non-negative integers.
 */
export function formatCount(n: number): string {
  const value = Math.max(0, Math.floor(n));
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const compact = round1(value / 1000);
    return compact >= 1000 ? '1M' : `${trim(compact)}K`;
  }
  return `${trim(round1(value / 1_000_000))}M`;
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
