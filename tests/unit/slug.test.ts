/**
 * tests/unit/slug.test.ts — `lib/validation/slug.ts` (05 T-UNIT-20; 04 "Shared" `SLUG` regex +
 * `RESERVED_SLUGS`): `slugSchema`, `isValidSlug`, `slugify`. Pure — no DOM, no network.
 */
import { describe, expect, it } from 'vitest';
import {
  RESERVED_SLUGS,
  SLUG_MESSAGE,
  SLUG_RE,
  SLUG_RESERVED_MESSAGE,
  isReservedSlug,
  isValidSlug,
  slugSchema,
  slugify,
} from '@/lib/validation/slug';

describe('T-UNIT-20 slug regex ^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$ (3–64)', () => {
  it.each(['ab', '-abc', 'abc-', 'Abc', 'a_b_c', 'has space', 'sneaky.dot', ''])(
    'T-UNIT-20 rejects %j',
    (bad) => {
      expect(SLUG_RE.test(bad)).toBe(false);
      expect(isValidSlug(bad)).toBe(false);
      expect(slugSchema.safeParse(bad).success).toBe(false);
    },
  );

  it.each(['abc', 'a-1', 'metal-pipe-mace', '1-21-pack', 'a'.repeat(64)])(
    'T-UNIT-20 accepts %j',
    (good) => {
      expect(SLUG_RE.test(good)).toBe(true);
      expect(isValidSlug(good)).toBe(true);
      expect(slugSchema.safeParse(good).success).toBe(true);
    },
  );

  it('T-UNIT-20 enforces the 64-char ceiling', () => {
    expect(SLUG_RE.test('a'.repeat(65))).toBe(false);
  });

  it('T-UNIT-20 regex failures carry the plain-words message', () => {
    const result = slugSchema.safeParse('ab');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(SLUG_MESSAGE);
  });
});

describe('T-UNIT-20 RESERVED_SLUGS', () => {
  it("T-UNIT-20 is exactly ['new','edit','admin','api','projects'] (04 order)", () => {
    expect([...RESERVED_SLUGS]).toEqual(['new', 'edit', 'admin', 'api', 'projects']);
  });

  it.each([...RESERVED_SLUGS])('T-UNIT-20 %j fails the schema as reserved', (reserved) => {
    expect(isReservedSlug(reserved)).toBe(true);
    expect(isValidSlug(reserved)).toBe(false);
    const result = slugSchema.safeParse(reserved);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(SLUG_RESERVED_MESSAGE);
  });
});

describe('T-UNIT-20 slugify', () => {
  it("T-UNIT-20 slugify('Metal Pipe Mace!') → 'metal-pipe-mace'", () => {
    expect(slugify('Metal Pipe Mace!')).toBe('metal-pipe-mace');
  });

  it('T-UNIT-20 collapses dash runs', () => {
    expect(slugify('a -- b')).toBe('a-b');
    expect(slugify('one---two')).toBe('one-two');
  });

  it('T-UNIT-20 trims leading/trailing separators', () => {
    expect(slugify('  hey  ')).toBe('hey');
    expect(slugify('!!wow!!')).toBe('wow');
  });

  it('T-UNIT-20 strips accents via NFKD before slugging', () => {
    expect(slugify('Café Métal')).toBe('cafe-metal');
  });

  it('T-UNIT-20 output is not guaranteed valid — the schema still decides (length/reserved)', () => {
    expect(slugify('Ab')).toBe('ab'); // too short for the schema
    expect(isValidSlug(slugify('Ab'))).toBe(false);
    expect(slugify('Admin')).toBe('admin'); // reserved
    expect(isValidSlug(slugify('Admin'))).toBe(false);
  });
});
