/**
 * tests/helpers/fixtureServer.ts — e2e fixture server on :4010 (ADR-0002 #73; 05 §4 CI-5; ADR-0030 D8;
 * ADR-0037 D10; ADR-0045 — the single-`id` rule).
 * GET/HEAD `/<source>/<path>` → `tests/fixtures/<source>/<path>`; JSON/XML/HTML content types; 404 otherwise.
 *   A GET whose resolved path is a directory or does not exist is served from `<path>.json` when that
 *   file exists (S1.5a, D10: `GET /modrinth/project/sd000101` → `project/sd000101.json`, beside the
 *   `project/sd000101/version` alias directory — the adapter's `GET /project/{id}`).
 *   Single-`id` rule (S1.8, ADR-0045): the query string is otherwise ignored, but when it carries
 *   EXACTLY ONE `id` value (one `id=` param, a bare id — no comma list) and
 *   `tests/fixtures/<source>/<path>/<id>.json` is a file, that file is served:
 *   `GET /youtube/videos?part=…&id=seedvid0009&key=…` → `youtube/videos/seedvid0009.json`. Every other
 *   request — a multi-id sync batch, an id with no file — is answered exactly as before.
 * POST (S1.5, D8 — the request body is read and discarded, never stored or logged):
 *   `POST /discord/webhooks/<id>/<token>` → `tests/fixtures/discord/webhooks/<id>.json` (200; unknown id → 404)
 *   `POST /resend/emails`                 → `tests/fixtures/resend/send-ok.json` (200)
 *   any other POST (or method)            → 405
 * The test-only `*_API_BASE` env names in `.env.test` point adapters here. First used in S1.2; the
 * dependency-free twin `scripts/fixture-server.mjs` (CI-5) must behave the same — change both together.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
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

/** ADR-0030 D8 POST routes: URL path pattern → fixture path segments under `FIXTURE_ROOT`. */
const POST_ROUTES: { pattern: RegExp; file: (match: RegExpExecArray) => string[] }[] = [
  {
    pattern: /^\/discord\/webhooks\/([A-Za-z0-9_-]+)\/[A-Za-z0-9_-]+$/,
    file: (match) => ['discord', 'webhooks', `${match[1] ?? ''}.json`],
  },
  { pattern: /^\/resend\/emails$/, file: () => ['resend', 'send-ok.json'] },
];

let server: Server | null = null;

/** Resolve a GET request path to a fixture file, refusing anything that escapes FIXTURE_ROOT. */
export function resolveFixturePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const parts = decoded.split('/').filter((p) => p.length > 0);
  if (parts.length < 2) return null; // need `<source>/<path>`
  const resolved = path.resolve(FIXTURE_ROOT, ...parts);
  if (!resolved.startsWith(FIXTURE_ROOT + path.sep)) return null;
  return resolved;
}

/** One fixture id in a query string: a bare token — never a comma list, never a path. */
const SINGLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * ADR-0045 single-`id` rule: `<path>/<id>.json` for a request whose query has exactly one `id` value;
 * `null` when the rule does not apply (no query, no / several `id` params, a comma list, a path that
 * is not a fixture path). The caller serves it only when it is a file.
 */
export function resolveIdFixturePath(urlPath: string): string | null {
  const base = resolveFixturePath(urlPath);
  const queryAt = urlPath.indexOf('?');
  if (base === null || queryAt === -1) return null;
  const ids = new URLSearchParams(urlPath.slice(queryAt + 1)).getAll('id');
  const id = ids.length === 1 ? ids[0] : undefined;
  if (id === undefined || !SINGLE_ID_RE.test(id)) return null;
  return path.join(base, `${id}.json`);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** ADR-0037 D10: a missing file or a directory falls back to `<path>.json` when that is a file. */
export async function withJsonFallback(file: string): Promise<string> {
  try {
    if ((await stat(file)).isFile()) return file;
  } catch {
    // missing — try the .json twin
  }
  try {
    if ((await stat(`${file}.json`)).isFile()) return `${file}.json`;
  } catch {
    // no twin either — the caller answers 404
  }
  return file;
}

/** Resolve a POST request path to its D8 fixture file; `null` when the path is not a POST route (→ 405). */
export function resolvePostFixturePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  for (const route of POST_ROUTES) {
    const match = route.pattern.exec(decoded);
    if (match) return path.resolve(FIXTURE_ROOT, ...route.file(match));
  }
  return null;
}

/** Reads and discards the request body so the client's write never sees a reset. */
function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    req.on('end', () => resolve());
    req.on('error', () => resolve());
    req.resume();
  });
}

export function startFixtureServer(port: number = DEFAULT_FIXTURE_PORT): Promise<Server> {
  if (server) return Promise.resolve(server);
  const s = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const sendText = (status: number, text: string): void => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    const serveFile = async (file: string): Promise<void> => {
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error('not a file');
        const body = await readFile(file);
        const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'content-length': body.byteLength });
        res.end(method === 'HEAD' ? undefined : body);
      } catch {
        sendText(404, 'not found');
      }
    };
    if (method === 'POST') {
      await drain(req);
      const file = resolvePostFixturePath(req.url ?? '/');
      if (!file) {
        sendText(405, 'method not allowed');
        return;
      }
      await serveFile(file);
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(405, 'method not allowed');
      return;
    }
    const file = resolveFixturePath(req.url ?? '/');
    if (!file) {
      sendText(404, 'not found');
      return;
    }
    const byId = resolveIdFixturePath(req.url ?? '/');
    await serveFile(byId !== null && (await isFile(byId)) ? byId : await withJsonFallback(file));
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
