#!/usr/bin/env node
/**
 * scripts/wait-for-schema.mjs — `pnpm build` waits for the database schema (ADR-0029 D1–D5;
 * 05 T-UNIT-46 for the pure parts; 05 CI-4). `package.json` `build` = `node scripts/wait-for-schema.mjs
 * && next build`, so a Vercel build that starts before the Supabase GitHub integration has applied the
 * merge's migrations waits instead of prerendering against the old schema (`PGRST205`).
 *
 * Ready (D2) = every migration version in `supabase/migrations/*.sql` is returned by the RPC
 * `public.migration_versions()` (D3, service-role only) AND every relation those migrations create in
 * `public` (`create table [if not exists] public.<x>`, `create [or replace] view public.<x>`; later
 * `drop` / `rename` honoured) appears in `definitions` of the PostgREST OpenAPI root (`GET /rest/v1/`)
 * — the same schema cache the prerender reads, so a reload lag after DDL is covered too.
 *
 * Loop (D4): poll every 15 s; deadline 20 min when `VERCEL_ENV` is set, 60 s elsewhere; a `waiting`
 * line at most once per 60 s; `ready (N migrations, M relations)` + exit 0; on the deadline one line
 * naming the missing items + exit 1 (fallback: `supabase migration list --linked`, then
 * `vercel redeploy`). `SKIP_SCHEMA_WAIT=1` → exit 0 at once (local only). Missing
 * `NEXT_PUBLIC_SUPABASE_URL` / key → prints why and exits 0 so `next build` fails on its own terms.
 * Env read here only (INV-88 scripts carve-out): `NEXT_PUBLIC_SUPABASE_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY` (alias `SUPABASE_SECRET_KEY` — ADR-0010), `VERCEL_ENV`, `SKIP_SCHEMA_WAIT`.
 * The key is never printed. Zero deps; Node ≥ 24 (`fetch`, `AbortSignal.timeout`).
 *
 * Import-safe: `parseMigrations`, `isReady`, `deadlineMs`, `run` are exported for tests; `main()` runs
 * only when this file is the entry point.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root (this file lives in scripts/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

export const POLL_MS = 15_000;
export const LOG_EVERY_MS = 60_000;
export const DEADLINE_VERCEL_MS = 20 * 60_000;
export const DEADLINE_LOCAL_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 10_000;

const PREFIX = 'wait-for-schema:';

/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} FetchLike */

// ---- pure parts (T-UNIT-46) ------------------------------------------------------------------

/** Non-empty, non-blank string → itself; anything else → undefined. */
function present(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * D4: 20 min on Vercel (any `VERCEL_ENV`), 60 s anywhere else.
 * @param {Record<string, string | undefined>} [env]
 */
export function deadlineMs(env = process.env) {
  return present(env.VERCEL_ENV) ? DEADLINE_VERCEL_MS : DEADLINE_LOCAL_MS;
}

/** Drop `-- …` line comments and `/* … *\/` block comments so prose never counts as DDL. */
function stripSqlComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Parses an optionally schema-qualified, optionally quoted relation name at the start of `rest`.
 * Returns `{ schema, name }` (schema `'public'` when unqualified — Postgres' default search_path in
 * Supabase migrations) or `null`. Unquoted identifiers fold to lower case; quoted keep their case.
 */
function parseRelationName(rest) {
  const m = rest.match(
    /^(?:("([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*\.\s*)?("([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))/,
  );
  if (!m) return null;
  const schema = m[2] ?? (m[3] ? m[3].toLowerCase() : 'public');
  const name = m[5] ?? (m[6] ? m[6].toLowerCase() : null);
  if (!name) return null;
  return { schema, name };
}

const CREATE_RE = /\bcreate\s+(?:or\s+replace\s+)?(table|view)\s+(?:if\s+not\s+exists\s+)?/gi;
const DROP_RE = /\bdrop\s+(table|view)\s+(?:if\s+exists\s+)?/gi;
const RENAME_RE = /\balter\s+(table|view)\s+(?:if\s+exists\s+)?(?:only\s+)?/gi;

/** The migration version = the leading digits of `<version>_<name>.sql`; other files are ignored. */
function versionOf(fileName) {
  const m = fileName.match(/^(\d+)_.*\.sql$/i);
  return m ? m[1] : null;
}

/**
 * D2 (a)+(b): `files` = `{ name, text }[]` in any order → `{ versions, relations }`, both sorted.
 * Relations = tables + views created in `public` (unqualified counts as public; `create temp table`,
 * `create type`, functions and other schemas are ignored), minus later `drop table|view` and with
 * `alter table … rename to` applied in version order.
 * @param {{ name: string, text: string }[]} files
 * @returns {{ versions: string[], relations: string[] }}
 */
export function parseMigrations(files) {
  const ordered = files
    .map((file) => ({ ...file, version: versionOf(file.name) }))
    .filter((file) => file.version !== null)
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));

  const versions = [];
  const relations = new Set();
  for (const file of ordered) {
    versions.push(file.version);
    const sql = stripSqlComments(file.text);
    /** @type {{ index: number, apply: () => void }[]} */
    const ops = [];

    for (const m of sql.matchAll(CREATE_RE)) {
      const rel = parseRelationName(sql.slice(m.index + m[0].length));
      if (rel && rel.schema === 'public')
        ops.push({ index: m.index, apply: () => relations.add(rel.name) });
    }
    for (const m of sql.matchAll(DROP_RE)) {
      const rel = parseRelationName(sql.slice(m.index + m[0].length));
      if (rel && rel.schema === 'public')
        ops.push({ index: m.index, apply: () => relations.delete(rel.name) });
    }
    for (const m of sql.matchAll(RENAME_RE)) {
      const after = sql.slice(m.index + m[0].length);
      const rel = parseRelationName(after);
      if (!rel || rel.schema !== 'public') continue;
      const tail = after.slice(after.indexOf(rel.name) + rel.name.length);
      const rename = tail.match(/^"?\s*rename\s+to\s+/i);
      if (!rename) continue;
      const target = parseRelationName(tail.slice(rename[0].length));
      if (!target) continue;
      ops.push({
        index: m.index,
        apply: () => {
          if (relations.delete(rel.name)) relations.add(target.name);
        },
      });
    }
    ops.sort((a, b) => a.index - b.index);
    for (const op of ops) op.apply();
  }
  return { versions: [...new Set(versions)], relations: [...relations].sort() };
}

/**
 * D2: ready when every expected version is in `applied` and every expected relation is a key of
 * `definitions` (the PostgREST OpenAPI `definitions` map).
 * @param {{ versions: string[], relations: string[] }} expected
 * @param {{ applied?: string[], definitions?: Record<string, unknown> }} observed
 * @returns {{ ready: boolean, missingVersions: string[], missingRelations: string[] }}
 */
export function isReady(expected, observed) {
  const applied = new Set(observed.applied ?? []);
  const definitions = observed.definitions ?? {};
  const missingVersions = expected.versions.filter((v) => !applied.has(v));
  const missingRelations = expected.relations.filter(
    (r) => !Object.prototype.hasOwnProperty.call(definitions, r),
  );
  return {
    ready: missingVersions.length === 0 && missingRelations.length === 0,
    missingVersions,
    missingRelations,
  };
}

/** One plain clause per missing kind, `nothing missing` when both lists are empty. */
export function describeMissing({ missingVersions, missingRelations }) {
  const parts = [];
  if (missingVersions.length > 0) parts.push(`missing migrations: ${missingVersions.join(', ')}`);
  if (missingRelations.length > 0) parts.push(`missing relations: ${missingRelations.join(', ')}`);
  return parts.length > 0 ? parts.join('; ') : 'nothing missing';
}

/**
 * Reads `supabase/migrations/*.sql` into the `parseMigrations` input shape.
 * @param {string} [dir]
 * @returns {{ name: string, text: string }[]}
 */
export function readMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.sql$/i.test(name))
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
}

// ---- the thin network loop -------------------------------------------------------------------

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strips the trailing `/` so `${url}/rest/v1/` is well-formed for both `…co` and `…co/`. */
function baseUrl(url) {
  return url.replace(/\/+$/, '');
}

/** The applied versions from the RPC body — an array of strings, or of one-key objects. */
function toVersionList(body) {
  if (!Array.isArray(body)) return [];
  return body
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') return String(item);
      if (item && typeof item === 'object') {
        const first = Object.values(item)[0];
        return first === undefined || first === null ? null : String(first);
      }
      return null;
    })
    .filter((v) => v !== null);
}

/**
 * One probe: `{ applied, definitions }` or `{ error }` (a plain reason, never the key). A 404
 * `PGRST202` on the RPC (function not in the schema cache yet — the first S1.5 build) reads as
 * `applied = []`, so the migration that creates it is simply "missing" until it lands.
 * @param {{ url: string, key: string, fetchImpl: FetchLike }} input
 * @returns {Promise<{ applied: string[], definitions: Record<string, unknown> } | { error: string }>}
 */
export async function probe({ url, key, fetchImpl }) {
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const base = baseUrl(url);
  try {
    const root = await fetchImpl(`${base}/rest/v1/`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!root.ok) return { error: `GET /rest/v1/ answered HTTP ${root.status}` };
    const openapi = await root.json();
    const definitions =
      openapi &&
      typeof openapi === 'object' &&
      openapi.definitions &&
      typeof openapi.definitions === 'object'
        ? openapi.definitions
        : {};

    const rpc = await fetchImpl(`${base}/rest/v1/rpc/migration_versions`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (rpc.status === 404) {
      let code = '';
      try {
        const body = await rpc.json();
        code = body && typeof body === 'object' && typeof body.code === 'string' ? body.code : '';
      } catch {
        code = '';
      }
      if (code === 'PGRST202' || code === '') return { applied: [], definitions };
      return { error: `rpc migration_versions answered HTTP 404 (${code})` };
    }
    if (!rpc.ok) return { error: `rpc migration_versions answered HTTP ${rpc.status}` };
    const applied = toVersionList(await rpc.json());
    return { applied, definitions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `supabase unreachable (${message})` };
  }
}

/**
 * The whole program with its edges injected (tests pass fakes; `main()` passes the real ones).
 * Returns the exit code; prints through `log`.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: FetchLike,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   migrationsDir?: string,
 * }} [options]
 * @returns {Promise<number>}
 */
export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  now = Date.now,
  log = console.log,
  migrationsDir = MIGRATIONS_DIR,
} = {}) {
  const skip = (present(env.SKIP_SCHEMA_WAIT) ?? '').toLowerCase();
  if (skip === '1' || skip === 'true') {
    log(`${PREFIX} skipped (SKIP_SCHEMA_WAIT=${env.SKIP_SCHEMA_WAIT})`);
    return 0;
  }

  const url = present(env.NEXT_PUBLIC_SUPABASE_URL);
  const key = present(env.SUPABASE_SERVICE_ROLE_KEY) ?? present(env.SUPABASE_SECRET_KEY);
  if (!url || !key) {
    const missing = [
      url ? null : 'NEXT_PUBLIC_SUPABASE_URL',
      key ? null : 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)',
    ].filter(Boolean);
    log(
      `${PREFIX} skipped — ${missing.join(' and ')} not set; next build will report it (lib/env.ts)`,
    );
    return 0;
  }

  const expected = parseMigrations(readMigrationFiles(migrationsDir));
  if (expected.versions.length === 0) {
    log(`${PREFIX} ready (0 migrations, 0 relations — nothing to wait for)`);
    return 0;
  }

  const deadline = deadlineMs(env);
  const startedAt = now();
  let lastLogAt = Number.NEGATIVE_INFINITY;
  let lastReason = '';

  for (;;) {
    const observed = await probe({ url, key, fetchImpl });
    const status = observed.error
      ? { ready: false, missingVersions: expected.versions, missingRelations: expected.relations }
      : isReady(expected, observed);
    if (status.ready) {
      log(
        `${PREFIX} ready (${expected.versions.length} migrations, ${expected.relations.length} relations)`,
      );
      return 0;
    }

    lastReason = observed.error
      ? `${observed.error}; ${describeMissing(status)}`
      : describeMissing(status);
    const elapsed = now() - startedAt;
    if (now() - lastLogAt >= LOG_EVERY_MS) {
      log(`${PREFIX} waiting (${lastReason}; ${Math.round(elapsed / 1000)}s elapsed)`);
      lastLogAt = now();
    }
    if (elapsed >= deadline) {
      log(
        `${PREFIX} gave up after ${Math.round(deadline / 60_000) || 1} min — ${lastReason}. ` +
          'Check `supabase migration list --linked`, then `vercel redeploy` once it catches up (ADR-0029).',
      );
      return 1;
    }
    await sleep(Math.max(0, Math.min(POLL_MS, deadline - elapsed)));
  }
}

export async function main() {
  const code = await run();
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`${PREFIX} crashed — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
