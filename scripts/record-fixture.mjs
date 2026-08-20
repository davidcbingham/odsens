#!/usr/bin/env node
/**
 * scripts/record-fixture.mjs — docs/build/05-test-plan.md F-1 (human-run, never in tests or CI).
 *   node scripts/record-fixture.mjs <adapter> <name> <url>
 * Fetches <url> once and writes tests/fixtures/<adapter>/<name>.json (or .xml / .html by content-type)
 * plus <name>.meta.json = { url, recorded_at, scrubbed: false }. Prints the F-2 scrub reminder.
 * Recording anything with PII or from an authenticated endpoint is a stop-and-ask (F-7). Zero deps.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const [adapter, name, url] = process.argv.slice(2);
const usage = 'usage: node scripts/record-fixture.mjs <adapter> <name> <url>';

if (!adapter || !name || !url) {
  console.error(usage);
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(adapter) || !/^[a-z0-9._-]+$/.test(name)) {
  console.error(`${usage}\n<adapter> and <name> must be lowercase slugs.`);
  process.exit(1);
}
let target;
try {
  target = new URL(url);
} catch {
  console.error(`record-fixture: "${url}" is not a valid URL.`);
  process.exit(1);
}
if (process.env.CI) {
  console.error(
    'record-fixture: refusing to run in CI — fixtures are recorded once by a human (F-1).',
  );
  process.exit(1);
}

console.warn(
  `record-fixture: WARNING — this performs ONE live request to ${target.host}. Fixtures are recorded by a human, never at test time (F-1). Do not record authenticated endpoints or anything with PII (F-7).`,
);

const res = await fetch(target, {
  headers: { 'user-agent': 'odsens.com/fixture-recorder (local; https://odsens.com)' },
});
const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
const body = await res.text();

let ext = '.json';
if (contentType.includes('xml')) ext = '.xml';
else if (contentType.includes('html')) ext = '.html';
else if (!contentType.includes('json')) {
  // fall back to sniffing the body
  const trimmed = body.trimStart();
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') || trimmed.startsWith('<feed'))
    ext = '.xml';
  else if (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html')
  )
    ext = '.html';
}

let contents = body;
if (ext === '.json') {
  try {
    contents = `${JSON.stringify(JSON.parse(body), null, 2)}\n`;
  } catch {
    console.error('record-fixture: response is not valid JSON; writing raw body as .json anyway.');
  }
}

const dir = path.join(process.cwd(), 'tests', 'fixtures', adapter);
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${name}${ext}`);
const meta = path.join(dir, `${name}.meta.json`);
if (existsSync(file))
  console.warn(
    `record-fixture: overwriting ${path.relative(process.cwd(), file)} (F-6: refresh only when an adapter or upstream schema changes).`,
  );
writeFileSync(file, contents);
writeFileSync(
  meta,
  `${JSON.stringify({ url: target.toString(), recorded_at: new Date().toISOString(), status: res.status, scrubbed: false }, null, 2)}\n`,
);

console.log(
  `record-fixture: wrote ${path.relative(process.cwd(), file)} (${res.status}, ${contentType || 'unknown content-type'})`,
);
console.log(`record-fixture: wrote ${path.relative(process.cwd(), meta)}`);
console.log(
  [
    '',
    'F-2 SCRUB BEFORE COMMIT:',
    '  - remove/replace every email, real personal name (public creator/channel names may stay), IP,',
    '    auth token, API key, Set-Cookie and request id;',
    '  - Modrinth team/members arrays → user.username only; YouTube: drop contentOwnerDetails;',
    '  - then set "scrubbed": true in the .meta.json and list what was scrubbed in the PR;',
    '  - `node scripts/check-fixtures.mjs` must pass (F-3 emails, F-4 sizes).',
  ].join('\n'),
);
