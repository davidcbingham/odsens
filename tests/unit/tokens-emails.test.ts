/**
 * tests/unit/tokens-emails.test.ts — 05 T-UNIT-43: email hex parity (03 §6 E-02). Mail clients cannot
 * read `var(--…)`, so `emails/**` inlines hex literals; every `#RRGGBB` literal under `emails/**`
 * must exist (case-insensitively) as a value in `styles/tokens.css`. A miss names the file:line.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const HEX = /#[0-9a-f]{6}\b/gi;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('emails/** hex parity with styles/tokens.css', () => {
  const tokens = new Set(
    (readFileSync(path.join(ROOT, 'styles', 'tokens.css'), 'utf8').match(HEX) ?? []).map((h) =>
      h.toLowerCase(),
    ),
  );

  it('T-UNIT-43 every #RRGGBB literal under emails/** is a tokens.css value', () => {
    expect(tokens.size, 'tokens.css colours parsed').toBeGreaterThan(30);
    const files = walk(path.join(ROOT, 'emails'));
    expect(files.length, 'emails/** source files').toBeGreaterThan(5);
    const offenders: string[] = [];
    let seen = 0;
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const hex of line.match(HEX) ?? []) {
          seen += 1;
          if (!tokens.has(hex.toLowerCase())) {
            offenders.push(`${path.relative(ROOT, file)}:${index + 1} ${hex}`);
          }
        }
      });
    }
    expect(seen, 'hex literals found under emails/**').toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
