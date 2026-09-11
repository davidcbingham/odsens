#!/usr/bin/env node
/**
 * scripts/check-fixtures.mjs — docs/build/05-test-plan.md F-3 / F-4 / F-8 (part of `pnpm lint`).
 *  F-4: every file under tests/fixtures/ ≤ 200 KB; files under files/ and images/ ≤ 100 KB.
 *  F-3: text fixtures contain no email address except allay@odsens.com and *@localhost.test.
 *  F-8: every `<hash16 of <fixture path>>` literal in supabase/seed.sql equals the first 16 hex chars of
 *       sha256 of that fixture's bytes (compared against the neighbouring 16-hex literal); skipped when
 *       seed.sql has none (S0).
 * Zero deps; exit 1 with clear messages.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const SEED = path.join(ROOT, 'supabase', 'seed.sql');
const KB = 1024;
const MAX_ANY = 200 * KB;
const MAX_BINARY = 100 * KB;
const BINARY_DIRS = new Set(['files', 'images']);
const TEXT_EXT = new Set([
  '.json',
  '.xml',
  '.html',
  '.txt',
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.csv',
  '.svg',
  '.snap',
  '.eml',
]);
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Retina asset names (`wordmark@2x.png`, 03 E-07 / ADR-0030 D15) look like addresses to EMAIL_RE — never an address. */
const RETINA_ASSET_RE = /^[A-Z0-9._%+-]+@[23]x\.(png|jpe?g|webp|gif|svg)$/i;
const ALLOWED_EMAIL = (addr) =>
  RETINA_ASSET_RE.test(addr) ||
  addr.toLowerCase() === 'allay@odsens.com' ||
  addr.toLowerCase().endsWith('@localhost.test');

const errors = [];

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push({ full, size: st.size });
  }
  return out;
}

if (!existsSync(FIXTURES)) {
  console.log('check-fixtures: tests/fixtures/ does not exist yet — nothing to check.');
  process.exit(0);
}

const files = walk(FIXTURES, []);
for (const { full, size } of files) {
  const rel = path.relative(FIXTURES, full).split(path.sep).join('/');
  const top = rel.split('/')[0];
  const limit = BINARY_DIRS.has(top) ? MAX_BINARY : MAX_ANY;
  if (size > limit) {
    errors.push(`F-4 ${rel} is ${(size / KB).toFixed(1)} KB (limit ${limit / KB} KB)`);
  }
  const ext = path.extname(rel).toLowerCase();
  const isText = TEXT_EXT.has(ext) || (ext === '' && !BINARY_DIRS.has(top));
  if (isText && size > 0) {
    const text = readFileSync(full, 'utf8');
    for (const m of text.matchAll(EMAIL_RE)) {
      if (!ALLOWED_EMAIL(m[0])) errors.push(`F-3 ${rel} contains an email address: ${m[0]}`);
    }
  }
}

// F-8: `<hash16 of images/icon-256.png>` literals in seed.sql vs sha256 of the fixture bytes.
if (existsSync(SEED)) {
  const seed = readFileSync(SEED, 'utf8');
  const refs = [...seed.matchAll(/<hash16 of ([^>]+)>/g)];
  if (refs.length === 0) {
    console.log('check-fixtures: F-8 — no <hash16 of …> literals in supabase/seed.sql (skipped).');
  }
  for (const m of refs) {
    const fixtureRel = m[1].trim();
    const fixtureFile = path.join(FIXTURES, fixtureRel);
    if (!existsSync(fixtureFile)) {
      errors.push(
        `F-8 seed.sql references <hash16 of ${fixtureRel}> but tests/fixtures/${fixtureRel} is missing`,
      );
      continue;
    }
    const expected = createHash('sha256')
      .update(readFileSync(fixtureFile))
      .digest('hex')
      .slice(0, 16);
    // The neighbouring literal: nearest 16-hex token on the same line as the marker.
    const lineStart = seed.lastIndexOf('\n', m.index) + 1;
    const lineEnd = seed.indexOf('\n', m.index);
    const line = seed.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const hexes = [...line.matchAll(/\b[0-9a-f]{16}\b/g)].map((h) => h[0]);
    if (hexes.length === 0) {
      errors.push(
        `F-8 seed.sql line with <hash16 of ${fixtureRel}> has no 16-hex literal to compare (expected ${expected})`,
      );
    } else if (!hexes.includes(expected)) {
      errors.push(
        `F-8 seed.sql <hash16 of ${fixtureRel}>: expected ${expected}, found ${hexes.join(', ')}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`check-fixtures: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `check-fixtures: OK — ${files.length} fixture file(s) checked (F-3 emails, F-4 sizes, F-8 seed hashes).`,
);
