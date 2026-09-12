#!/usr/bin/env node
/**
 * scripts/fixture-server.mjs — starts the e2e fixture server standalone (ADR-0002 #73; 05 CI-5;
 * ADR-0030 D8 — the two POST routes; ADR-0037 D10 — the `.json` fallback).
 *   node scripts/fixture-server.mjs [port]      (default 4010)
 * GET/HEAD: serves tests/fixtures/<source>/<path> at http://127.0.0.1:<port>/<source>/<path>.
 *   A GET whose resolved path is a directory or does not exist is served from `<path>.json` when
 *   that file exists (S1.5a: `GET /modrinth/project/sd000101` → `project/sd000101.json`, beside the
 *   `project/sd000101/version` alias directory — the adapter's `GET /project/{id}`).
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
  return serveFile(await withJsonFallback(file));
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
