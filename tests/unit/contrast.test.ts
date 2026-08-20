/**
 * tests/unit/contrast.test.ts — T-UNIT-15: `scripts/contrast.mjs` WCAG vectors (±0.1) and the
 * `--check styles/` tokens-only CSS guard exiting 0 on the committed tree (05 §7.4; 01 INV-61).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCssText, contrast } from '../../scripts/contrast.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('scripts/contrast.mjs', () => {
  it.each([
    ['#EEF1F6', '#0D131B', 16.5],
    ['#4B45D6', '#0D131B', 2.77],
    ['#FFFFFF', '#CC3A2A', 4.99],
    ['#FFC61F', '#151E29', 10.7],
  ])('T-UNIT-15 contrast(%s, %s) ≈ %d (±0.1)', (a, b, expected) => {
    expect(Math.abs(contrast(a, b) - expected)).toBeLessThanOrEqual(0.1);
    // order-independent
    expect(contrast(b, a)).toBeCloseTo(contrast(a, b), 6);
  });

  it('T-UNIT-15 --check styles/ exits 0 on the committed tree (no raw hex, blur, radius, hairline)', () => {
    const result = spawnSync(process.execPath, ['scripts/contrast.mjs', '--check', 'styles/'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('T-UNIT-15 --check flags raw hex, blur shadows, off-scale radius and 1px hairlines', () => {
    const css = [
      '.a { color: #fff; }',
      '.b { box-shadow: 0 0 4px var(--ink-deep); }',
      '.c { border-radius: 4px; }',
      '.d { border: 1px solid var(--line); }',
      '.e { box-shadow: 4px 4px 0 var(--indigo-deep); border-radius: 3px; border: 2px solid var(--line); }',
    ].join('\n');
    const rules = checkCssText(css, 'x.css').map((o) => `${o.line}:${o.rule.split(' ')[0]}`);
    expect(rules).toEqual(['1:raw', '2:box-shadow', '3:border-radius', '4:1px']);
  });
});
