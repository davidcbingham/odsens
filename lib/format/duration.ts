/**
 * lib/format/duration.ts — video lengths (05 T-UNIT-12 `formatDuration`; 03 §2.6 `VideoFacade`
 * duration chip + "duration sr \"12 minutes 4 seconds\""; DESIGN.md §11.1 / §11.5 duration chips).
 * Registry Modules `format/*.ts`. Pure, locale-free (no `Intl`, no `toLocale*` — 01 INV-68 /
 * INV-93) and client-safe (no zod, no server imports — ADR-0008): bundled into the `VideoFacade`
 * client leaf, so server and client print the same string.
 *
 *   formatDuration(724)  → `12:04`     (45→`0:45`, 62→`1:02`, 3600→`1:00:00`, 3723→`1:02:03`)
 *   spokenDuration(724)  → `12 minutes 4 seconds`
 *
 * `null` → `''` for both: an RSS-only row (04 §3.3, no `YOUTUBE_API_KEY` — 05 T-ACT-71) has no
 * `duration_seconds`, and the caller renders no chip at all rather than an empty one.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** Whole non-negative seconds, or `null` for anything that is not a usable length. */
function wholeSeconds(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.floor(seconds);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The visible chip per 05 T-UNIT-12: `m:ss` under an hour (minutes unpadded), `h:mm:ss` from an
 * hour up. `null` (and junk: negative, `NaN`) → `''`.
 */
export function formatDuration(seconds: number | null): string {
  const total = wholeSeconds(seconds);
  if (total === null) return '';
  const h = Math.floor(total / HOUR);
  const m = Math.floor((total % HOUR) / MINUTE);
  const s = total % MINUTE;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

function unit(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

/**
 * The screen-reader form of the same length (03 §2.6: "12 minutes 4 seconds"): zero parts are
 * left out (`3600` → `1 hour`, `60` → `1 minute`), a zero length reads `0 seconds`.
 * `null` (and junk) → `''`.
 */
export function spokenDuration(seconds: number | null): string {
  const total = wholeSeconds(seconds);
  if (total === null) return '';
  const h = Math.floor(total / HOUR);
  const m = Math.floor((total % HOUR) / MINUTE);
  const s = total % MINUTE;
  const parts: string[] = [];
  if (h > 0) parts.push(unit(h, 'hour'));
  if (m > 0) parts.push(unit(m, 'minute'));
  if (s > 0 || parts.length === 0) parts.push(unit(s, 'second'));
  return parts.join(' ');
}
