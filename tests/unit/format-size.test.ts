/**
 * tests/unit/format-size.test.ts — `lib/format/size.ts` `formatFileSize` (registry Modules
 * `format/*.ts`; DESIGN.md pass-3 Size column "184 KB" / GET IT meta "1.9 MB" / upload copy
 * "That's 82 MB. The limit is 50."). Supporting helper for the T-UNIT-30 `VersionsTable`
 * rendering — no catalogue ID of its own. Pure — no DOM, no network. Same no-trailing-`.0`
 * rule as `formatCount` (T-UNIT-10).
 */
import { describe, expect, it } from 'vitest';
import { formatFileSize } from '@/lib/format/size';

describe('formatFileSize', () => {
  it.each<[number, string]>([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [188416, '184 KB'], // 184 × 1024 — the mockup Size cell
    [92160, '90 KB'],
    [1993342, '1.9 MB'], // GET IT meta / upload progress shape
    [2 * 1024 * 1024, '2 MB'], // exactly 2.0 → no trailing .0
    [82 * 1024 * 1024, '82 MB'], // upload error copy number
    [10.4 * 1024 * 1024, '10 MB'], // ≥10 MB rounds to whole
  ])('formatFileSize(%d) → %s', (input, expected) => {
    expect(formatFileSize(input)).toBe(expected);
  });

  it('never prints a trailing .0', () => {
    for (const n of [1024 * 1024, 3 * 1024 * 1024, 5017600]) {
      expect(formatFileSize(n)).not.toMatch(/\.0 /);
    }
  });

  it('clamps junk to zero', () => {
    expect(formatFileSize(-5)).toBe('0 B');
    expect(formatFileSize(Number.NaN)).toBe('0 B');
  });
});
