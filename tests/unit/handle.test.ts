/**
 * tests/unit/handle.test.ts — T-UNIT-1: `handleSchema` / `handleReason` (H1 regex + plain-words reasons)
 * and T-UNIT-2: `RESERVED_HANDLES` / `isReserved` (04 §1.1 H3 list, 22 entries, case-insensitive).
 * 01 INV-49; DESIGN.md §11.1 voice; ADR-0002 #63. SQL parity with `check_handle` is T-ACT-7 (db lane).
 */
import { describe, expect, it } from 'vitest';
import { handleSchema } from '@/lib/actions/accounts.schema';
import {
  HANDLE_AVAILABLE,
  HANDLE_HELPER,
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_RE,
  HANDLE_RESERVED,
  HANDLE_TAKEN,
  REASON_AT_SIGN,
  REASON_CHARSET,
  REASON_TOO_LONG,
  REASON_TOO_SHORT,
  RESERVED_HANDLES,
  handleReason,
  isReserved,
  isValidHandle,
} from '@/lib/validation/handle';

/** 04 §1.1 H3 — verbatim, in document order. */
const H3_LIST = [
  'admin',
  'administrator',
  'oddsense',
  'odsens',
  'moderator',
  'mod',
  'mods',
  'root',
  'system',
  'support',
  'allay',
  'api',
  'staff',
  'help',
  'null',
  'undefined',
  'anonymous',
  'deleted',
  'me',
  'you',
  'everyone',
  'here',
] as const;

const VALID = ['abc', 'A_1', '_a_', 'a'.repeat(20), '123', 'Under_Score99', 'ABC', '___'] as const;

const INVALID_SHAPE = [
  'ab',
  'a'.repeat(21),
  'a-b',
  'a.b',
  'a b',
  'ünïcode',
  'ñame',
  'naïve_',
  '@name',
  'a@b.c',
  '',
  ' abc',
  'abc ',
  'abc\n',
  'a/b',
  'a\\b',
  'a\u200bb', // zero-width space
] as const;

describe('handleSchema / handleReason (T-UNIT-1)', () => {
  it('T-UNIT-1 HANDLE_RE is H1 ^[A-Za-z0-9_]{3,20}$ and the bounds match', () => {
    expect(HANDLE_RE.source).toBe('^[A-Za-z0-9_]{3,20}$');
    expect(HANDLE_RE.flags).toBe('');
    expect(HANDLE_MIN).toBe(3);
    expect(HANDLE_MAX).toBe(20);
  });

  it.each(VALID)('T-UNIT-1 %j passes H1 + H3 (regex, reason null, schema ok)', (value) => {
    expect(HANDLE_RE.test(value)).toBe(true);
    expect(handleReason(value)).toBeNull();
    expect(isValidHandle(value)).toBe(true);
    const parsed = handleSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(value);
  });

  it.each(INVALID_SHAPE)(
    'T-UNIT-1 %j fails H1 (regex false, schema fails with a reason)',
    (value) => {
      expect(HANDLE_RE.test(value)).toBe(false);
      expect(isValidHandle(value)).toBe(false);
      const reason = handleReason(value);
      expect(reason).not.toBeNull();
      const parsed = handleSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toHaveLength(1);
        expect(parsed.error.issues[0]?.message).toBe(reason);
      }
    },
  );

  it.each([
    ['ab', REASON_TOO_SHORT],
    ['', REASON_TOO_SHORT],
    ['a', REASON_TOO_SHORT],
    ['a'.repeat(21), REASON_TOO_LONG],
    ['a'.repeat(40), REASON_TOO_LONG],
    ['@name', REASON_AT_SIGN],
    ['a@b.c', REASON_AT_SIGN],
    ['name@', REASON_AT_SIGN],
    ['a-b', REASON_CHARSET],
    ['a.b', REASON_CHARSET],
    ['a b', REASON_CHARSET],
    ['ünïcode', REASON_CHARSET],
    ['abc\n', REASON_CHARSET],
    ['admin', HANDLE_RESERVED],
    ['OddSense', HANDLE_RESERVED],
    ['you', HANDLE_RESERVED],
  ])('T-UNIT-1 handleReason(%j) → %j', (value, expected) => {
    expect(handleReason(value)).toBe(expected);
  });

  it('T-UNIT-1 reasons are checked in order: @ → too short → too long → charset → reserved', () => {
    // `@` wins over every other failure, including length.
    expect(handleReason('@')).toBe(REASON_AT_SIGN);
    expect(handleReason('a@')).toBe(REASON_AT_SIGN);
    expect(handleReason(`@${'a'.repeat(30)}`)).toBe(REASON_AT_SIGN);
    // Length wins over charset.
    expect(handleReason('-')).toBe(REASON_TOO_SHORT);
    expect(handleReason('-'.repeat(21))).toBe(REASON_TOO_LONG);
    // Length wins over reserved (`me` is two characters).
    expect(handleReason('me')).toBe(REASON_TOO_SHORT);
    // Charset wins over reserved.
    expect(handleReason('admin!')).toBe(REASON_CHARSET);
  });

  it('T-UNIT-1 copy is plain words in the DESIGN.md §11.1 voice — never "invalid input"', () => {
    expect(REASON_CHARSET).toBe('Letters, numbers and underscore only.');
    expect(REASON_AT_SIGN).toBe('No @ — we add it.');
    expect(REASON_TOO_SHORT).toBe('Too short. 3 characters minimum.');
    expect(REASON_TOO_LONG).toBe('Too long. 20 characters maximum.');
    expect(HANDLE_HELPER).toBe('3–20 characters. Letters, numbers, underscore.');
    expect(HANDLE_AVAILABLE).toBe("That one's free.");
    expect(HANDLE_TAKEN).toBe("That one's taken.");
    expect(HANDLE_RESERVED).toBe("That one's reserved.");

    const allCopy = [
      REASON_CHARSET,
      REASON_AT_SIGN,
      REASON_TOO_SHORT,
      REASON_TOO_LONG,
      HANDLE_HELPER,
      HANDLE_AVAILABLE,
      HANDLE_TAKEN,
      HANDLE_RESERVED,
    ];
    for (const text of allCopy) {
      expect(text, text).not.toMatch(/invalid|input|error|regex|pattern|string/i);
      expect(text, text).toMatch(/\.$/); // full sentences
    }
    // The numbers in the copy are the real bounds.
    expect(REASON_TOO_SHORT).toContain(String(HANDLE_MIN));
    expect(REASON_TOO_LONG).toContain(String(HANDLE_MAX));
    expect(HANDLE_HELPER).toContain(`${HANDLE_MIN}–${HANDLE_MAX}`);
  });

  it('T-UNIT-1 zod never leaks its own wording (one custom issue, same text as handleReason)', () => {
    for (const value of ['ab', 'a-b', '@x', 'admin', 'a'.repeat(21)]) {
      const parsed = handleSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages).toEqual([handleReason(value)]);
      for (const message of messages) expect(message).not.toMatch(/invalid/i);
    }
    // Non-string input is a zod type failure (the action wrapper reports it as `validation`).
    expect(handleSchema.safeParse(42).success).toBe(false);
    expect(handleSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('RESERVED_HANDLES / isReserved (T-UNIT-2)', () => {
  it('T-UNIT-2 equals the 04 H3 list exactly — 22 entries, document order', () => {
    expect([...RESERVED_HANDLES]).toEqual([...H3_LIST]);
    expect(RESERVED_HANDLES).toHaveLength(22);
  });

  it('T-UNIT-2 entries are lowercase, trimmed and unique', () => {
    for (const entry of RESERVED_HANDLES) {
      expect(entry).toBe(entry.toLowerCase());
      expect(entry).toBe(entry.trim());
      expect(entry).toMatch(/^[a-z]+$/);
    }
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
  });

  it.each(RESERVED_HANDLES)('T-UNIT-2 isReserved(%j) in any case', (entry) => {
    expect(isReserved(entry)).toBe(true);
    expect(isReserved(entry.toUpperCase())).toBe(true);
    const mixed = entry
      .split('')
      .map((ch, i) => (i % 2 === 0 ? ch.toUpperCase() : ch))
      .join('');
    expect(isReserved(mixed)).toBe(true);
  });

  it('T-UNIT-2 case-insensitive examples from 05 and near-misses are not reserved', () => {
    expect(isReserved('OddSense')).toBe(true);
    expect(isReserved('ADMIN')).toBe(true);
    expect(isReserved('Null')).toBe(true);
    expect(isReserved('oddsense2')).toBe(false);
    expect(isReserved('admins')).toBe(false);
    expect(isReserved('supporter')).toBe(false);
    expect(isReserved('odsensfan')).toBe(false);
    expect(isReserved('_admin')).toBe(false);
    expect(isReserved('')).toBe(false);
    expect(isReserved(' admin')).toBe(false); // no trimming — the input is already structural
  });

  it('T-UNIT-2 a reserved handle that passes H1 is refused by handleReason / handleSchema', () => {
    for (const entry of RESERVED_HANDLES.filter((e) => HANDLE_RE.test(e))) {
      expect(handleReason(entry)).toBe(HANDLE_RESERVED);
      expect(handleReason(entry.toUpperCase())).toBe(HANDLE_RESERVED);
      expect(handleSchema.safeParse(entry).success).toBe(false);
    }
  });
});
