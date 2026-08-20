#!/usr/bin/env node
/**
 * scripts/fixture-server.mjs — starts the e2e fixture server standalone (ADR-0002 #73; 05 CI-5).
 *   node scripts/fixture-server.mjs [port]      (default 4010)
 * Serves tests/fixtures/<source>/<path> at http://127.0.0.1:<port>/<source>/<path> and keeps running
 * until SIGINT/SIGTERM. Mirrors tests/helpers/fixtureServer.ts (kept dependency-free so CI can run it
 * before the app is built). The test-only *_API_BASE names in .env.test point adapters here.
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

function resolveFixture(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const parts = decoded.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const resolved = path.resolve(ROOT, ...parts);
  return resolved.startsWith(ROOT + path.sep) ? resolved : null;
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(method === 'HEAD' ? undefined : body);
  };
  if (method !== 'GET' && method !== 'HEAD') return send(405, 'method not allowed');
  const file = resolveFixture(req.url ?? '/');
  if (!file) return send(404, 'not found');
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    send(200, body, TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    console.log(`fixture-server: 200 ${method} ${req.url}`);
  } catch {
    send(404, 'not found');
    console.log(`fixture-server: 404 ${method} ${req.url}`);
  }
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
