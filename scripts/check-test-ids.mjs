#!/usr/bin/env node
/**
 * scripts/check-test-ids.mjs — docs/build/05-test-plan.md H-12 (part of `pnpm lint`).
 * Parses the §8 "Slice → required tests" table; for every shipped slice (SHIPPED_SLICES, extended per
 * slice PR) it extracts the required T-<layer>-<n> IDs (lists, ranges `a..b`, suffixed ids like 45a)
 * and greps tests/** (.ts/.tsx) for each ID followed by a non-alphanumeric char. Missing → exit 1.
 * Also warns (no fail) about §7 catalog IDs that no §8 row lists. Zero deps.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Extend when a slice merges (05 §8; 00 DoD-4). */
const SHIPPED_SLICES = ['S0', 'S1.1', 'S1.2', 'S1.3', 'S1.4'];

const ROOT = process.cwd();
const DOC = path.join(ROOT, 'docs', 'build', '05-test-plan.md');
const TESTS = path.join(ROOT, 'tests');
const LAYERS = 'RLS|ACT|ADP|E2E|UNIT';

function fail(msg) {
  console.error(`check-test-ids: ${msg}`);
  process.exit(1);
}

if (!existsSync(DOC)) fail('docs/build/05-test-plan.md not found');
const doc = readFileSync(DOC, 'utf8');

function section(n) {
  const start = doc.search(new RegExp(`^## ${n}\\.`, 'm'));
  if (start === -1) fail(`§${n} heading not found in 05-test-plan.md`);
  const rest = doc.slice(start + 1);
  const nextRel = rest.search(/^## \d+\./m);
  return nextRel === -1 ? doc.slice(start) : doc.slice(start, start + 1 + nextRel);
}

/** Remove backtick spans and (nested) parentheses so parenthetical remarks never leak IDs. */
function stripRemarks(text) {
  let s = text.replace(/`[^`]*`/g, ' ');
  for (let i = 0; i < 20; i += 1) {
    const next = s.replace(/\([^()]*\)/g, ' ');
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Expand `T-LAYER-` followed by a `,`/`/`-separated list of numbers, suffixed ids and `a..b` ranges. */
function extractIds(cellText) {
  const ids = new Set();
  const listRe = new RegExp(
    `T-(${LAYERS})-(\\d+[a-z]?(?:\\.\\.\\d+[a-z]?)?(?:\\s*[,/]\\s*\\d+[a-z]?(?:\\.\\.\\d+[a-z]?)?)*)`,
    'g',
  );
  for (const m of stripRemarks(cellText).matchAll(listRe)) {
    const layer = m[1];
    for (const raw of m[2].split(/\s*[,/]\s*/)) {
      const token = raw.trim();
      if (!token) continue;
      const range = token.match(/^(\d+)\.\.(\d+)$/);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        if (b < a) fail(`bad range ${token} in §8`);
        for (let n = a; n <= b; n += 1) ids.add(`T-${layer}-${n}`);
      } else {
        ids.add(`T-${layer}-${token}`);
      }
    }
  }
  return ids;
}

// ---- §8 rows ----
const s8 = section(8);
const rows = s8.split('\n').filter((l) => l.trim().startsWith('| **S'));
if (rows.length === 0) fail('no `| **S…` rows found in §8');

const required = new Set();
const allListed = new Set();
const seenSlices = new Set();
for (const row of rows) {
  const cells = row.split('|').map((c) => c.trim());
  const slice = (cells[1] ?? '').replace(/\*\*/g, '').trim();
  const must = cells[2] ?? '';
  const ids = extractIds(must);
  for (const id of ids) allListed.add(id);
  if (SHIPPED_SLICES.includes(slice)) {
    seenSlices.add(slice);
    for (const id of ids) required.add(id);
  }
}
for (const s of SHIPPED_SLICES) {
  if (!seenSlices.has(s)) fail(`shipped slice ${s} has no row in 05 §8`);
}

// ---- tests/** corpus ----
function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}
const corpus = walk(TESTS, [])
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const missing = [...required]
  .filter((id) => !new RegExp(`${escape(id)}(?![A-Za-z0-9])`).test(corpus))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// ---- §7 orphan warning (IDs in the catalog no §8 row lists) ----
const s7 = section(7);
const catalog = new Set();
for (const m of s7.matchAll(new RegExp(`^\\|\\s*(T-(?:${LAYERS})-\\d+[a-z]?)\\s*\\|`, 'gm'))) {
  catalog.add(m[1]);
}
const orphans = [...catalog]
  .filter((id) => !allListed.has(id))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (orphans.length > 0) {
  console.warn(
    `check-test-ids: warning — ${orphans.length} §7 ID(s) not listed in any §8 row: ${orphans.join(', ')}`,
  );
}

if (missing.length > 0) {
  console.error(
    `check-test-ids: ${missing.length} required test ID(s) for shipped slice(s) ${SHIPPED_SLICES.join(', ')} not found in tests/** (05 H-12):`,
  );
  for (const id of missing) console.error(`  - ${id}`);
  process.exit(1);
}
console.log(
  `check-test-ids: OK — all ${required.size} ID(s) required by ${SHIPPED_SLICES.join(', ')} appear in tests/**.`,
);
