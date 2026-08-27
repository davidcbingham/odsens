/**
 * tests/unit/format-number.test.ts — `lib/format/number.ts` `formatCount` (05 T-UNIT-10;
 * 03 §2.2 `StatTile` number; DESIGN.md §5 Silkscreen counts) + `formatCountFull`
 * (the `ProjectCard` sr text "12,431 downloads" — 03 §2.3). Pure, locale-free.
 */
import { describe, expect, it } from 'vitest';
import { formatCount, formatCountFull } from '@/lib/format/number';

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
