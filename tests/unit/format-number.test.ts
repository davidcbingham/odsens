/**
 * tests/unit/format-number.test.ts — `lib/format/number.ts` `formatCount` (05 T-UNIT-10;
 * 03 §2.2 `StatTile` number; DESIGN.md §5 Silkscreen counts) + `formatCountFull`
 * (the `ProjectCard` sr text "12,431 downloads" — 03 §2.3). Pure, locale-free. S1.8 (ADR-0045):
 * the `B` tier 05 T-UNIT-9 needs (`1500000000` → `1.5B`) and `spokenCount`, the same figure with
 * the unit as a word (the `ReachLine` sr text) — no T-UNIT-10 vector changes.
 */
import { describe, expect, it } from 'vitest';
import { formatCount, formatCountFull, spokenCount } from '@/lib/format/number';

describe('T-UNIT-10 formatCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [8934, '8.9K'],
    [1_000_000, '1M'],
  ])('T-UNIT-10 formatCount(%d) → %s (catalogue vectors)', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });

  it('T-UNIT-10 never prints a trailing .0', () => {
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(2049)).toBe('2K'); // 2.049 rounds to 2.0 → "2K"
    expect(formatCount(3_000_000)).toBe('3M');
  });

  it('T-UNIT-10 keeps one decimal past 10 units too (12.4K style)', () => {
    expect(formatCount(12_431)).toBe('12.4K');
    expect(formatCount(1_240_000)).toBe('1.2M');
  });

  it('T-UNIT-10 seed counts: 1568 → 1.6K, 1688 → 1.7K (05 T-E2E-3 GET IT rows)', () => {
    expect(formatCount(1568)).toBe('1.6K');
    expect(formatCount(1688)).toBe('1.7K');
  });

  it('T-UNIT-10 rounding rolls over unit boundaries instead of printing 1000K', () => {
    expect(formatCount(999_949)).toBe('999.9K');
    expect(formatCount(999_950)).toBe('1M');
  });

  it('T-UNIT-10 clamps negatives and floors fractions (counts are whole and non-negative)', () => {
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(999.9)).toBe('999');
  });

  it.each([
    [1_000_000_000, '1B'],
    [1_500_000_000, '1.5B'],
    [2_049_000_000, '2B'],
    [12_400_000_000, '12.4B'],
  ])('T-UNIT-9 formatCount(%d) → %s (the B tier — ADR-0045)', (input, expected) => {
    expect(formatCount(input)).toBe(expected);
  });

  it('T-UNIT-9 the M tier is untouched below the B boundary and rolls over at it', () => {
    expect(formatCount(999_000_000)).toBe('999M');
    expect(formatCount(999_949_999)).toBe('999.9M');
    expect(formatCount(999_950_000)).toBe('1B');
  });

  it('T-UNIT-9 there is no tier past B — a trillion stays in billions', () => {
    expect(formatCount(1_500_000_000_000)).toBe('1500B');
  });

  it('T-UNIT-10 a non-finite count reads 0', () => {
    expect(formatCount(Number.NaN)).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('T-UNIT-9 spokenCount (the sr expansion of formatCount)', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1 thousand'],
    [12_500, '12.5 thousand'],
    [999_950, '1 million'],
    [1_200_000, '1.2 million'],
    [1_500_000_000, '1.5 billion'],
  ])('T-UNIT-9 spokenCount(%d) → %s', (input, expected) => {
    expect(spokenCount(input)).toBe(expected);
  });

  it('T-UNIT-9 the spoken figure is always the visible figure', () => {
    for (const n of [0, 7, 1000, 1049, 1050, 8934, 999_949, 999_950, 1_240_000, 2_500_000_000]) {
      expect(spokenCount(n).split(' ')[0], String(n)).toBe(formatCount(n).replace(/[KMB]$/, ''));
    }
  });
});

describe('T-UNIT-10 formatCountFull (grouped sr-text form)', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [12_431, '12,431'],
    [1_234_567, '1,234,567'],
  ])('T-UNIT-10 formatCountFull(%d) → %s', (input, expected) => {
    expect(formatCountFull(input)).toBe(expected);
  });
});
