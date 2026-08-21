/**
 * tests/unit/format-date.test.ts — `lib/format/date.ts`: `formatDay` (UTC `YYYY-MM-DD`, the
 * "You can change it again on …" line — 04 §1.1 / SC-14), `formatDate` and `relativeTime`
 * (T-UNIT-13 catalogue row; lowercase per DESIGN.md §7). Pure: `now` is injected, nothing reads
 * the wall clock except the default-argument smoke check. No `toLocale*` / `Intl` (01 INV-68 / INV-93).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDay, relativeTime } from '@/lib/format/date';
import { REPO_ROOT } from '../helpers/envTest';

const NOW = '2026-08-20T12:00:00Z';
const at = (offsetMs: number): Date => new Date(new Date(NOW).getTime() - offsetMs);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatDay (04 §1.1 handle 7-day line)', () => {
  it.each([
    ['2026-08-27T00:00:00Z', '2026-08-27'],
    ['2026-08-27T23:59:59.999Z', '2026-08-27'],
    ['2026-08-27T23:30:00-05:00', '2026-08-28'], // UTC calendar day, not the offset's
    ['2026-08-28T01:30:00+05:00', '2026-08-27'],
    ['2026-01-05T09:00:00Z', '2026-01-05'], // zero-padded month + day
    ['2026-12-31T23:59:59Z', '2026-12-31'],
    ['2024-02-29T12:00:00Z', '2024-02-29'],
  ])('formatDay(%s) → %s', (input, expected) => {
    expect(formatDay(input)).toBe(expected);
    expect(formatDay(new Date(input))).toBe(expected);
  });

  it('matches the handle_changed_at + 7 days arithmetic used by updateProfile', () => {
    const changedAt = new Date('2026-08-20T15:45:00Z');
    const again = new Date(changedAt.getTime() + 7 * DAY);
    expect(formatDay(again)).toBe('2026-08-27');
  });

  it('throws on an unparseable date instead of printing "Invalid Date"', () => {
    expect(() => formatDay('not a date')).toThrow(/invalid date/);
    expect(() => formatDay(new Date(Number.NaN))).toThrow(/invalid date/);
  });
});

describe('formatDate (T-UNIT-13 absolute form)', () => {
  it.each([
    ['2026-08-12T10:00:00Z', '12 Aug 2026'],
    ['2026-08-01T00:00:00Z', '1 Aug 2026'], // no zero padding in the human form
    ['2026-01-31T23:59:59Z', '31 Jan 2026'],
    ['2026-08-12T23:30:00-05:00', '13 Aug 2026'], // UTC
    ['2025-12-25T12:00:00Z', '25 Dec 2025'],
  ])('formatDate(%s) → %s', (input, expected) => {
    expect(formatDate(input)).toBe(expected);
  });
});

describe('relativeTime (T-UNIT-13)', () => {
  it.each([
    [0, 'just now'],
    [10 * SECOND, 'just now'],
    [44 * SECOND, 'just now'],
    [45 * SECOND, '1 min ago'],
    [4 * MINUTE, '4 min ago'],
    [30 * MINUTE, '30 min ago'],
    [59 * MINUTE, '59 min ago'],
    [HOUR, '1 h ago'],
    [2 * HOUR, '2 h ago'],
    [23 * HOUR, '23 h ago'],
    [DAY, 'yesterday'],
    [25 * HOUR, 'yesterday'],
    [2 * DAY - SECOND, 'yesterday'],
    [2 * DAY, '2 days ago'],
    [3 * DAY, '3 days ago'],
    [3 * DAY + 20 * HOUR, '3 days ago'],
    [6 * DAY + 23 * HOUR, '6 days ago'],
    [7 * DAY, '13 Aug 2026'],
    [30 * DAY, '21 Jul 2026'],
    [400 * DAY, '16 Jul 2025'],
  ])('relativeTime(now − %d ms) → %j', (offset, expected) => {
    expect(relativeTime(at(offset), NOW)).toBe(expected);
    expect(relativeTime(at(offset).toISOString(), new Date(NOW))).toBe(expected);
  });

  it('future dates read as "just now"', () => {
    expect(relativeTime(at(-5 * MINUTE), NOW)).toBe('just now');
    expect(relativeTime(at(-3 * DAY), NOW)).toBe('just now');
  });

  it('is lowercase (DESIGN.md §7) except the absolute month abbreviation', () => {
    for (const offset of [0, MINUTE, HOUR, DAY, 3 * DAY]) {
      const text = relativeTime(at(offset), NOW);
      expect(text).toBe(text.toLowerCase());
    }
  });

  it('defaults `now` to the wall clock', () => {
    expect(relativeTime(new Date())).toBe('just now');
    expect(relativeTime(new Date(Date.now() - 3 * DAY))).toBe('3 days ago');
  });

  it('throws on an unparseable input', () => {
    expect(() => relativeTime('nope', NOW)).toThrow(/invalid date/);
    expect(() => relativeTime(NOW, 'nope')).toThrow(/invalid date/);
  });
});

describe('lib/format/date.ts never calls toLocale* or Intl (01 INV-68 / INV-93)', () => {
  it('source contains no toLocale / Intl. / getTimezoneOffset / local getters', () => {
    // Comments are stripped first: the module's header legitimately names the banned calls.
    const source = readFileSync(path.join(REPO_ROOT, 'lib', 'format', 'date.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/toLocale/);
    expect(source).not.toMatch(/\bIntl\./);
    expect(source).not.toMatch(/getTimezoneOffset/);
    // only the UTC getters may be used for formatting
    expect(source).not.toMatch(/\.get(FullYear|Month|Date|Hours|Day)\(/);
  });
});
