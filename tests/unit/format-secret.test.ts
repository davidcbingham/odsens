/**
 * tests/unit/format-secret.test.ts — T-UNIT-25: `maskSecret(url)` (`lib/format/secret.ts`; 04 §1.3
 * `discord_webhook_tail`; 01 INV-43 "masked to `…<last 4>`"; ADR-0030 D12).
 *   `https://discord.com/api/webhooks/123/abcdefghij` → `…ghij`; empty/null → `NOT SET`.
 */
import { describe, expect, it } from 'vitest';
import {
  MASK_PREFIX,
  SECRET_NOT_SET,
  SECRET_TAIL_LENGTH,
  maskSecret,
  secretTail,
} from '@/lib/format/secret';

const WEBHOOK = 'https://discord.com/api/webhooks/123/abcdefghij';

describe('maskSecret (T-UNIT-25)', () => {
  it('T-UNIT-25 a webhook URL masks to … + its last 4 characters', () => {
    expect(maskSecret(WEBHOOK)).toBe('…ghij');
    expect(maskSecret(WEBHOOK)).not.toContain('discord.com');
    expect(maskSecret(WEBHOOK)).not.toContain('123');
  });

  it.each([
    ['', 'empty string'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('T-UNIT-25 %j (%s) → NOT SET', (value, label) => {
    expect(maskSecret(value), label).toBe('NOT SET');
    expect(maskSecret(value), label).toBe(SECRET_NOT_SET);
  });

  it('T-UNIT-25 exactly 4 characters keep all four behind the prefix', () => {
    expect(maskSecret('ghij')).toBe('…ghij');
  });

  it('T-UNIT-25 fewer than 4 characters → … + the whole string (never padded, never blank)', () => {
    expect(maskSecret('a')).toBe('…a');
    expect(maskSecret('abc')).toBe('…abc');
  });

  it('T-UNIT-25 the prefix is the single ellipsis character and the tail length is 4', () => {
    expect(MASK_PREFIX).toBe('…');
    expect(MASK_PREFIX).toHaveLength(1);
    expect(SECRET_TAIL_LENGTH).toBe(4);
    expect(maskSecret(WEBHOOK)).toHaveLength(1 + SECRET_TAIL_LENGTH);
  });

  it('T-UNIT-25 the mask never grows with the secret (a 2 KB token still shows 5 characters)', () => {
    const long = `https://discordapp.com/api/webhooks/9/${'x'.repeat(2000)}wxyz`;
    expect(maskSecret(long)).toBe('…wxyz');
  });
});

describe('secretTail (the raw tail for `discord_webhook_tail`)', () => {
  it('returns the last 4 characters of a set value', () => {
    expect(secretTail(WEBHOOK)).toBe('ghij');
    expect(secretTail('ab')).toBe('ab');
  });

  it('returns null for an unset value (so the action can answer discord_webhook_set: false)', () => {
    expect(secretTail('')).toBeNull();
    expect(secretTail(null)).toBeNull();
    expect(secretTail(undefined)).toBeNull();
  });
});
