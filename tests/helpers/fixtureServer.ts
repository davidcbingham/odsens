/**
 * tests/helpers/fixtureServer.ts — e2e fixture server on :4010 (ADR-0002 #73; 05 §4 CI-5).
 * Maps `GET /<source>/<path>` → `tests/fixtures/<source>/<path>`; JSON/XML/HTML content types; 404 otherwise.
 * The test-only `*_API_BASE` env names in `.env.test` point adapters here. First used in S1.2.
 */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const FIXTURE_ROOT = path.join(process.cwd(), 'tests', 'fixtures');
export const DEFAULT_FIXTURE_PORT = 4010;

const CONTENT_TYPES: Record<string, string> = {
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

let server: Server | null = null;

/** Resolve a request path to a fixture file, refusing anything that escapes FIXTURE_ROOT. */
export function resolveFixturePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const parts = decoded.split('/').filter((p) => p.length > 0);
  if (parts.length < 2) return null; // need `<source>/<path>`
  const resolved = path.resolve(FIXTURE_ROOT, ...parts);
  if (!resolved.startsWith(FIXTURE_ROOT + path.sep)) return null;
  return resolved;
}

export function startFixtureServer(port: number = DEFAULT_FIXTURE_PORT): Promise<Server> {
  if (server) return Promise.resolve(server);
  const s = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('method not allowed');
      return;
    }
    const file = resolveFixturePath(req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': body.byteLength });
      res.end(method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });
  server = s;
  return new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

export function stopFixtureServer(): Promise<void> {
  const s = server;
  server = null;
  if (!s) return Promise.resolve();
  return new Promise((resolve) => s.close(() => resolve()));
}
