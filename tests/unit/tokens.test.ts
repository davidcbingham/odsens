/**
 * tests/unit/tokens.test.ts — T-UNIT-34: tokens parity. Every token name + value in DESIGN.md §1
 * "Dark (default)" and 03 §9 (derived) exists in styles/tokens.css with the same value, and vice
 * versa (non-colour tokens ignored). A mismatch names the token (05 §7.4; 01 INV-61; 03 C-09).
 */
import { describe, expect, it } from 'vitest';
import { checkTokens } from '../../scripts/contrast.mjs';

describe('styles/tokens.css parity', () => {
  it('T-UNIT-34 tokens.css == DESIGN.md §1 Dark ∪ 03 §9 derived (names + values, both directions)', () => {
    const { expected, actual, mismatches } = checkTokens(
      'styles/tokens.css',
      'DESIGN.md',
      'docs/build/03-components.md',
    );
    expect(expected.size, 'DESIGN.md §1 Dark table parsed').toBeGreaterThan(30);
    expect(actual.size, 'styles/tokens.css colour tokens parsed').toBeGreaterThan(30);
    expect(
      mismatches.map((m) => m.message),
      `token mismatches: ${mismatches.map((m) => m.name).join(', ')}`,
    ).toEqual([]);
  });
});
