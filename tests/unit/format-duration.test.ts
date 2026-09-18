/**
 * tests/unit/format-duration.test.ts — T-UNIT-12: `lib/format/duration.ts` `formatDuration`
 * (05 §7.4: 45→`0:45`, 62→`1:02`, 3600→`1:00:00`, 3723→`1:02:03`, null→``), plus its
 * screen-reader twin `spokenDuration` (03 §2.6 `VideoFacade`: duration sr "12 minutes 4 seconds" —
 * supporting helper, no catalogue id of its own). Pure — no DOM, no network, no clock.
 */
import { describe, expect, it } from 'vitest';
import { formatDuration, spokenDuration } from '@/lib/format/duration';

describe('T-UNIT-12 formatDuration(seconds): 45→0:45, 62→1:02, 3600→1:00:00, 3723→1:02:03, null→``', () => {
  it.each<[number | null, string]>([
    [45, '0:45'],
    [62, '1:02'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
    [null, ''],
  ])('T-UNIT-12 formatDuration(%s) → `%s`', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it.each<[number, string]>([
    [0, '0:00'],
    [9, '0:09'],
    [60, '1:00'],
    [61, '1:01'], // SEED-11 seedvid0007 — one second past the Shorts threshold
    [600, '10:00'], // SEED-11 seedvid0001
    [724, '12:04'], // the 03 §2.6 sr example, SEED-11 seedvid0004
    [3599, '59:59'],
    [36000, '10:00:00'],
    [86401, '24:00:01'], // T-ADP-10 `P1DT1S` — hours are never folded into days
  ])('T-UNIT-12 formatDuration(%d) → %s (edges)', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it('T-UNIT-12 floors fractions and answers junk with the empty string (no chip)', () => {
    expect(formatDuration(62.9)).toBe('1:02');
    expect(formatDuration(-1)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('spokenDuration(seconds) — the T-UNIT-12 sr twin', () => {
  it.each<[number | null, string]>([
    [724, '12 minutes 4 seconds'], // 03 §2.6 literal
    [45, '45 seconds'],
    [1, '1 second'],
    [0, '0 seconds'],
    [60, '1 minute'],
    [61, '1 minute 1 second'],
    [600, '10 minutes'],
    [3600, '1 hour'],
    [3723, '1 hour 2 minutes 3 seconds'],
    [7200, '2 hours'],
    [3601, '1 hour 1 second'],
    [null, ''],
  ])('spokenDuration(%s) → `%s`', (input, expected) => {
    expect(spokenDuration(input)).toBe(expected);
  });

  it('floors fractions and answers junk with the empty string', () => {
    expect(spokenDuration(724.7)).toBe('12 minutes 4 seconds');
    expect(spokenDuration(-5)).toBe('');
    expect(spokenDuration(Number.NaN)).toBe('');
  });
});
