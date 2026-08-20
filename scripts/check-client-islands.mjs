#!/usr/bin/env node
/**
 * scripts/check-client-islands.mjs — 01 INV-94 / 03 C-16a.
 * Reads the client-island table in docs/build/03-components.md between
 * `<!-- client-islands:begin -->` and `<!-- client-islands:end -->`, collects the backticked path in
 * column 1 of every table row, then walks app/, components/, lib/ for .ts/.tsx files whose first
 * statement is 'use client' / "use client". Every such file must be in that set ∪ {app/error.tsx,
 * app/global-error.tsx}. Prints offenders and exits 1 if any. Zero deps.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DOC = path.join(ROOT, 'docs', 'build', '03-components.md');
const BEGIN = '<!-- client-islands:begin -->';
const END = '<!-- client-islands:end -->';
const ALWAYS_ALLOWED = ['app/error.tsx', 'app/global-error.tsx'];
const SCAN_DIRS = ['app', 'components', 'lib'];

function fail(msg) {
  console.error(`check-client-islands: ${msg}`);
  process.exit(1);
}

if (!existsSync(DOC)) fail(`missing ${path.relative(ROOT, DOC)}`);
const doc = readFileSync(DOC, 'utf8');
const start = doc.indexOf(BEGIN);
const end = doc.indexOf(END);
if (start === -1 || end === -1 || end < start)
  fail(`markers ${BEGIN} / ${END} not found in 03-components.md`);

const allowed = new Set(ALWAYS_ALLOWED);
for (const line of doc.slice(start + BEGIN.length, end).split('\n')) {
  const row = line.trim();
  if (!row.startsWith('|')) continue;
  const firstCell = row.split('|')[1]?.trim() ?? '';
  const m = firstCell.match(/^`([^`]+)`$/);
  if (m) allowed.add(m[1].replace(/\\/g, '/'));
}
if (allowed.size === ALWAYS_ALLOWED.length)
  fail('client-island table has no rows — check the markers');

/** True when the file's first statement (after comments/blank lines) is a 'use client' directive. */
function hasUseClientDirective(source) {
  let src = source.replace(/^﻿/, '');
  // strip leading comments + whitespace
  for (;;) {
    const before = src;
    src = src.replace(/^\s+/, '');
    if (src.startsWith('//')) src = src.replace(/^\/\/[^\n]*\n?/, '');
    else if (src.startsWith('/*')) {
      const close = src.indexOf('*/');
      if (close === -1) return false;
      src = src.slice(close + 2);
    }
    if (src === before) break;
  }
  return /^(['"])use client\1\s*;?/.test(src);
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d), []));
const clientFiles = files.filter((f) => hasUseClientDirective(readFileSync(f, 'utf8')));
const offenders = clientFiles
  .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
  .filter((rel) => !allowed.has(rel))
  .sort();

if (offenders.length > 0) {
  console.error(
    `check-client-islands: ${offenders.length} 'use client' file(s) not in the 03 §1.4 client-island list (01 INV-94):`,
  );
  for (const rel of offenders) console.error(`  - ${rel}`);
  console.error(
    'Add the file to the C-16a table (with an ADR + 03 row change) or remove the directive.',
  );
  process.exit(1);
}

console.log(
  `check-client-islands: OK — ${clientFiles.length} 'use client' file(s), all in the ${allowed.size - ALWAYS_ALLOWED.length}-row list (+ error boundaries).`,
);
