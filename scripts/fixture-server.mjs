#!/usr/bin/env node
/**
 * scripts/fixture-server.mjs — starts the e2e fixture server standalone (ADR-0002 #73; 05 CI-5;
 * ADR-0030 D8 — the two POST routes; ADR-0037 D10 — the `.json` fallback; ADR-0045 — the single-`id`
 * rule).
 *   node scripts/fixture-server.mjs [port]      (default 4010)
 * GET/HEAD: serves tests/fixtures/<source>/<path> at http://127.0.0.1:<port>/<source>/<path>.
 *   A GET whose resolved path is a directory or does not exist is served from `<path>.json` when
 *   that file exists (S1.5a: `GET /modrinth/project/sd000101` → `project/sd000101.json`, beside the
 *   `project/sd000101/version` alias directory — the adapter's `GET /project/{id}`).
 *   Single-`id` rule (S1.8, ADR-0045): the query string is otherwise ignored, but when it carries
 *   EXACTLY ONE `id` value (one `id=` param, a bare id — no comma list) and
 *   tests/fixtures/<source>/<path>/<id>.json is a file, that file is served:
 *   GET /youtube/videos?part=…&id=seedvid0009&key=… → youtube/videos/seedvid0009.json. Every other
 *   request — a multi-id sync batch, an id with no file — is answered exactly as before.
 * POST (S1.5, the request body is read and discarded — never stored, never logged):
 *   POST /discord/webhooks/<id>/<token>  → tests/fixtures/discord/webhooks/<id>.json (200; unknown id → 404)
 *   POST /resend/emails                  → tests/fixtures/resend/send-ok.json (200)
 *   any other POST (or method)           → 405
 * Keeps running until SIGINT/SIGTERM. Mirrors tests/helpers/fixtureServer.ts (kept dependency-free so
 * CI can run it before the app is built). The test-only *_API_BASE names in .env.test point adapters here.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.argv[2] ?? process.env.FIXTURE_PORT ?? 4010);
if (!Number.isInteger(port) || port <= 0) {
  console.error(`fixture-server: invalid port "${process.argv[2]}"`);
  process.exit(1);
}
const ROOT = path.join(process.cwd(), 'tests', 'fixtures');
const TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.jar': 'application/java-archive',
};

/** ADR-0030 D8 POST routes: URL path pattern → fixture path segments under tests/fixtures/. */
const POST_ROUTES = [
  {
    pattern: /^\/discord\/webhooks\/([A-Za-z0-9_-]+)\/[A-Za-z0-9_-]+$/,
    file: (m) => ['discord', 'webhooks', `${m[1]}.json`],
  },
  { pattern: /^\/resend\/emails$/, file: () => ['resend', 'send-ok.json'] },
];

function resolveFixture(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const parts = decoded.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const resolved = path.resolve(ROOT, ...parts);
  return resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

/** One fixture id in a query string: a bare token — never a comma list, never a path. */
const SINGLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * ADR-0045 single-`id` rule: `<path>/<id>.json` for a request whose query has exactly one `id` value;
 * null when the rule does not apply. Served only when it is a file.
 */
function resolveIdFixture(urlPath) {
  const base = resolveFixture(urlPath);
  const queryAt = urlPath.indexOf('?');
  if (base === null || queryAt === -1) return null;
  const ids = new URLSearchParams(urlPath.slice(queryAt + 1)).getAll('id');
  if (ids.length !== 1 || !SINGLE_ID_RE.test(ids[0])) return null;
  return path.join(base, `${ids[0]}.json`);
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** POST: the fixture file for a D8 route, or null when the path is not one (→ 405). */
function resolvePostFixture(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  for (const route of POST_ROUTES) {
    const match = route.pattern.exec(decoded);
    if (match) return path.resolve(ROOT, ...route.file(match));
  }
  return null;
}

/** ADR-0037 D10: a missing file or a directory falls back to `<path>.json` when that is a file. */
async function withJsonFallback(file) {
  try {
    const info = await stat(file);
    if (info.isFile()) return file;
  } catch {
    // missing — try the .json twin
  }
  try {
    const info = await stat(`${file}.json`);
    if (info.isFile()) return `${file}.json`;
  } catch {
    // no twin either — serveFile answers 404
  }
  return file;
}

/** Log form of a URL: the Discord webhook token segment is shown as `…<last 4>` (never whole, even here). */
function displayUrl(url) {
  return url.replace(
    /(\/discord\/webhooks\/[A-Za-z0-9_-]+\/)([A-Za-z0-9_-]+)/,
    (_, head, token) => `${head}…${token.slice(-4)}`,
  );
}

/** Reads and discards the request body so the client's write never sees a reset. */
function drain(req) {
  return new Promise((resolve) => {
    req.on('end', resolve);
    req.on('error', resolve);
    req.resume();
  });
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(method === 'HEAD' ? undefined : body);
  };
  const serveFile = async (file) => {
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      send(200, body, TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      console.log(`fixture-server: 200 ${method} ${displayUrl(req.url ?? '/')}`);
    } catch {
      send(404, 'not found');
      console.log(`fixture-server: 404 ${method} ${displayUrl(req.url ?? '/')}`);
    }
  };
  if (method === 'POST') {
    await drain(req);
    const file = resolvePostFixture(req.url ?? '/');
    if (!file) return send(405, 'method not allowed');
    return serveFile(file);
  }
  if (method !== 'GET' && method !== 'HEAD') return send(405, 'method not allowed');
  const file = resolveFixture(req.url ?? '/');
  if (!file) return send(404, 'not found');
  const byId = resolveIdFixture(req.url ?? '/');
  return serveFile(byId !== null && (await isFile(byId)) ? byId : await withJsonFallback(file));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fixture-server: serving tests/fixtures at http://127.0.0.1:${port}/<source>/<path>`);
});
server.on('error', (err) => {
  console.error(`fixture-server: ${err.message}`);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
