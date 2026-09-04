/**
 * tests/unit/wait-for-schema.test.ts — T-UNIT-46 (ADR-0029 D5): the pure parts of
 * `scripts/wait-for-schema.mjs` — migration parsing (versions; relations incl. `if not exists`,
 * `or replace`, quoted names, other schemas ignored, later drop/rename honoured), the readiness
 * decision over an OpenAPI `definitions` map + an applied-versions list, and the deadline choice —
 * plus the thin loop `run()` with fetch/sleep/clock injected (SKIP, missing env, ready on the first
 * poll, `PGRST202` → `applied = []`, unreachable stack, the 60 s log throttle, the deadline line
 * naming the missing items, the key never printed) and the two real-process exit-0 paths.
 * No socket is opened (05 H-5): every fetch is a fake.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEADLINE_LOCAL_MS,
  DEADLINE_VERCEL_MS,
  LOG_EVERY_MS,
  MIGRATIONS_DIR,
  POLL_MS,
  deadlineMs,
  describeMissing,
  isReady,
  parseMigrations,
  probe,
  readMigrationFiles,
  run,
} from '../../scripts/wait-for-schema.mjs';
import { REPO_ROOT } from '@/tests/helpers/envTest';

const KEY = 'service-role-key-never-printed-0123456789';
const URL_BASE = 'http://127.0.0.1:54321';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A PostgREST stand-in: `definitions` for the root, `applied` (or a 404 body) for the RPC. */
function fakeStack(opts: {
  definitions?: Record<string, unknown>;
  applied?: unknown;
  rpcStatus?: number;
  rpcBody?: unknown;
  rootStatus?: number;
  throwWith?: string;
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (opts.throwWith) throw new Error(opts.throwWith);
    if (url.endsWith('/rest/v1/')) {
      if (opts.rootStatus && opts.rootStatus !== 200) return json({}, opts.rootStatus);
      return json({ swagger: '2.0', definitions: opts.definitions ?? {} });
    }
    if (url.endsWith('/rest/v1/rpc/migration_versions')) {
      if (opts.rpcStatus && opts.rpcStatus !== 200) {
        return json(
          opts.rpcBody ?? { code: 'PGRST202', message: 'not in the schema cache' },
          opts.rpcStatus,
        );
      }
      return json(opts.applied ?? []);
    }
    return json({ message: 'unexpected url' }, 500);
  };
  return { fetchImpl, calls };
}

/** A fake clock: `sleep` advances `now`, so a 20-minute wait costs nothing. */
function fakeClock() {
  let t = 1_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    elapsed: () => t - 1_000,
  };
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

let tmp = '';
let twoMigrations = '';
beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'wait-for-schema-'));
  // `two/`: two migrations (a table and a view); `empty/`: a migrations dir with nothing in it.
  twoMigrations = path.join(tmp, 'two');
  mkdirSync(twoMigrations, { recursive: true });
  mkdirSync(path.join(tmp, 'empty'), { recursive: true });
  writeFileSync(
    path.join(twoMigrations, '20260101000000_alpha.sql'),
    'create table if not exists public.alpha (id int);\n',
  );
  writeFileSync(
    path.join(twoMigrations, '20260102000000_beta.sql'),
    'create or replace view public.beta as select 1;\n',
  );
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const READY_ENV = { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: KEY };

describe('parseMigrations (T-UNIT-46)', () => {
  const files = [
    {
      name: '20260101000000_a.sql',
      text: [
        '-- create table public.commented_out (never counts)',
        '/* create view public.blocked_out */',
        'create table if not exists public.profiles (id uuid primary key);',
        'CREATE TABLE public."Quoted" (id int);',
        'create or replace view public.public_profiles as select 1;',
        'create view public.plain_view as select 1;',
        'create table "public"."double_quoted" (id int);',
        'create table supabase_migrations.schema_migrations (version text);',
        'create table other_schema.thing (id int);',
        "create type public.user_role as enum ('user');",
        'create or replace function public.is_admin() returns boolean language sql as $$ select true $$;',
        'create temp table scratch (id int);',
        'create unlogged table public.unlogged_one (id int);',
        'create table unqualified_table (id int);',
        'create index if not exists profiles_handle_idx on public.profiles (handle);',
      ].join('\n'),
    },
    {
      name: '20260102000000_b.sql',
      text: [
        'drop view if exists public.plain_view;',
        'alter table public.unqualified_table rename to renamed_table;',
        'alter table public.profiles rename column handle to nick;',
        'drop table if exists other_schema.thing;',
      ].join('\n'),
    },
    { name: 'README.md', text: 'create table public.not_sql (id int);' },
    { name: '.gitkeep', text: '' },
    { name: 'notes.sql', text: 'create table public.no_version_prefix (id int);' },
  ];

  it('T-UNIT-46 versions = the numeric filename prefixes, sorted; non-migration files ignored', () => {
    expect(parseMigrations(files).versions).toEqual(['20260101000000', '20260102000000']);
    expect(parseMigrations([...files].reverse()).versions).toEqual([
      '20260101000000',
      '20260102000000',
    ]);
  });

  it('T-UNIT-46 relations = public tables + views (if not exists / or replace / quoted / unqualified), other schemas, types, functions, temp tables and comments ignored', () => {
    const { relations } = parseMigrations(files);
    expect(relations).toEqual([
      'Quoted',
      'double_quoted',
      'profiles',
      'public_profiles',
      'renamed_table',
    ]);
    expect(relations).not.toContain('schema_migrations');
    expect(relations).not.toContain('thing');
    expect(relations).not.toContain('user_role');
    expect(relations).not.toContain('scratch');
    expect(relations).not.toContain('commented_out');
    expect(relations).not.toContain('blocked_out');
    expect(relations).not.toContain('not_sql');
    expect(relations).not.toContain('no_version_prefix');
  });

  it('T-UNIT-46 a later drop removes a relation; rename to moves it; input order does not matter', () => {
    const forward = parseMigrations(files);
    const backward = parseMigrations([...files].reverse());
    expect(backward).toEqual(forward);
    expect(forward.relations).not.toContain('plain_view');
    expect(forward.relations).not.toContain('unqualified_table');
    expect(forward.relations).toContain('renamed_table');
  });

  it('T-UNIT-46 a create followed by a drop in the SAME file nets out by statement order', () => {
    const { relations } = parseMigrations([
      {
        name: '20260103000000_c.sql',
        text: 'create table public.tmp_a (id int); drop table public.tmp_a; create view public.keep as select 1;',
      },
    ]);
    expect(relations).toEqual(['keep']);
  });

  it('T-UNIT-46 an empty list → no versions, no relations', () => {
    expect(parseMigrations([])).toEqual({ versions: [], relations: [] });
  });

  it('T-UNIT-46 the real supabase/migrations tree parses: every .sql file is a version and the known relations are present', () => {
    const real = parseMigrations(readMigrationFiles(MIGRATIONS_DIR));
    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f));
    expect(real.versions).toHaveLength(sqlFiles.length);
    expect(real.versions).toContain('20260818000012');
    expect(real.versions).toContain('20260903090300');
    for (const relation of [
      'profiles',
      'public_profiles',
      'site_settings',
      'site_settings_public',
      'rate_limit_hits',
      'projects',
      'projects_public',
      'project_versions',
      'project_files',
      'project_links',
      'project_overrides',
      'project_downloads',
      'sync_runs',
      'comments',
      'comments_public',
      'comment_likes',
      'comment_reports',
      'notification_events',
    ]) {
      expect(real.relations, relation).toContain(relation);
    }
    expect(real.relations.some((r) => r.includes('schema_migrations'))).toBe(false);
    expect(real.relations).toEqual([...real.relations].sort());
  });
});

describe('isReady + describeMissing (T-UNIT-46)', () => {
  const expected = { versions: ['1', '2'], relations: ['a', 'b'] };

  it('T-UNIT-46 ready only when every version is applied AND every relation is a definitions key', () => {
    expect(isReady(expected, { applied: ['1', '2'], definitions: { a: {}, b: {} } })).toEqual({
      ready: true,
      missingVersions: [],
      missingRelations: [],
    });
  });

  it('T-UNIT-46 a missing version is named', () => {
    expect(isReady(expected, { applied: ['1'], definitions: { a: {}, b: {} } })).toEqual({
      ready: false,
      missingVersions: ['2'],
      missingRelations: [],
    });
  });

  it('T-UNIT-46 a missing relation is named (versions applied but the schema cache lags)', () => {
    expect(isReady(expected, { applied: ['1', '2'], definitions: { a: {} } })).toEqual({
      ready: false,
      missingVersions: [],
      missingRelations: ['b'],
    });
  });

  it('T-UNIT-46 both missing; extra applied versions / definitions never hurt; prototype keys do not count', () => {
    expect(isReady(expected, { applied: [], definitions: {} })).toEqual({
      ready: false,
      missingVersions: ['1', '2'],
      missingRelations: ['a', 'b'],
    });
    expect(
      isReady(expected, { applied: ['0', '1', '2', '3'], definitions: { a: {}, b: {}, c: {} } })
        .ready,
    ).toBe(true);
    expect(
      isReady({ versions: [], relations: ['constructor'] }, { applied: [], definitions: {} }),
    ).toEqual({
      ready: false,
      missingVersions: [],
      missingRelations: ['constructor'],
    });
    expect(isReady({ versions: [], relations: [] }, { applied: [], definitions: {} }).ready).toBe(
      true,
    );
  });

  it('T-UNIT-46 describeMissing is one plain line per kind', () => {
    expect(describeMissing({ missingVersions: ['1', '2'], missingRelations: [] })).toBe(
      'missing migrations: 1, 2',
    );
    expect(describeMissing({ missingVersions: [], missingRelations: ['a'] })).toBe(
      'missing relations: a',
    );
    expect(describeMissing({ missingVersions: ['1'], missingRelations: ['a'] })).toBe(
      'missing migrations: 1; missing relations: a',
    );
    expect(describeMissing({ missingVersions: [], missingRelations: [] })).toBe('nothing missing');
  });
});

describe('deadlineMs (T-UNIT-46 — ADR-0029 D4)', () => {
  it('T-UNIT-46 20 min on Vercel (any VERCEL_ENV), 60 s elsewhere (blank counts as unset)', () => {
    expect(deadlineMs({ VERCEL_ENV: 'production' })).toBe(20 * 60_000);
    expect(deadlineMs({ VERCEL_ENV: 'preview' })).toBe(20 * 60_000);
    expect(deadlineMs({ VERCEL_ENV: 'development' })).toBe(20 * 60_000);
    expect(deadlineMs({})).toBe(60_000);
    expect(deadlineMs({ VERCEL_ENV: '' })).toBe(60_000);
    expect(deadlineMs({ VERCEL_ENV: '   ' })).toBe(60_000);
    expect(DEADLINE_VERCEL_MS).toBe(20 * 60_000);
    expect(DEADLINE_LOCAL_MS).toBe(60_000);
    expect(POLL_MS).toBe(15_000);
    expect(LOG_EVERY_MS).toBe(60_000);
  });
});

describe('probe (T-UNIT-46 — one poll)', () => {
  it('T-UNIT-46 sends apikey + bearer to GET /rest/v1/ and POST /rest/v1/rpc/migration_versions with a {} body', async () => {
    const stack = fakeStack({ definitions: { alpha: {} }, applied: ['1'] });
    const result = await probe({ url: `${URL_BASE}/`, key: KEY, fetchImpl: stack.fetchImpl });
    expect(result).toEqual({ applied: ['1'], definitions: { alpha: {} } });
    expect(stack.calls.map((c) => c.url)).toEqual([
      `${URL_BASE}/rest/v1/`,
      `${URL_BASE}/rest/v1/rpc/migration_versions`,
    ]);
    const root = stack.calls[0]?.init?.headers as Record<string, string>;
    expect(root.apikey).toBe(KEY);
    expect(root.authorization).toBe(`Bearer ${KEY}`);
    const rpc = stack.calls[1]?.init;
    expect(rpc?.method).toBe('POST');
    expect(rpc?.body).toBe('{}');
    expect((rpc?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('T-UNIT-46 a 404 PGRST202 on the RPC (function not in the cache yet) reads as applied = []', async () => {
    const stack = fakeStack({ definitions: { alpha: {} }, rpcStatus: 404 });
    await expect(probe({ url: URL_BASE, key: KEY, fetchImpl: stack.fetchImpl })).resolves.toEqual({
      applied: [],
      definitions: { alpha: {} },
    });
  });

  it('T-UNIT-46 the RPC answered as an array of one-key objects still yields the version strings', async () => {
    const stack = fakeStack({ applied: [{ migration_versions: '1' }, { migration_versions: 2 }] });
    const result = await probe({ url: URL_BASE, key: KEY, fetchImpl: stack.fetchImpl });
    expect(result).toMatchObject({ applied: ['1', '2'] });
  });

  it('T-UNIT-46 other failures are plain reasons that never carry the key', async () => {
    const root = await probe({
      url: URL_BASE,
      key: KEY,
      fetchImpl: fakeStack({ rootStatus: 401 }).fetchImpl,
    });
    expect(root).toEqual({ error: 'GET /rest/v1/ answered HTTP 401' });
    const rpc = await probe({
      url: URL_BASE,
      key: KEY,
      fetchImpl: fakeStack({ rpcStatus: 500 }).fetchImpl,
    });
    expect(rpc).toEqual({ error: 'rpc migration_versions answered HTTP 500' });
    const other404 = await probe({
      url: URL_BASE,
      key: KEY,
      fetchImpl: fakeStack({ rpcStatus: 404, rpcBody: { code: 'PGRST301' } }).fetchImpl,
    });
    expect(other404).toEqual({ error: 'rpc migration_versions answered HTTP 404 (PGRST301)' });
    const down = await probe({
      url: URL_BASE,
      key: KEY,
      fetchImpl: fakeStack({ throwWith: 'connect ECONNREFUSED 127.0.0.1:54321' }).fetchImpl,
    });
    expect(down).toEqual({ error: 'supabase unreachable (connect ECONNREFUSED 127.0.0.1:54321)' });
    for (const r of [root, rpc, other404, down]) expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe('run (T-UNIT-46 — the thin loop with fetch/sleep/clock injected)', () => {
  it('T-UNIT-46 SKIP_SCHEMA_WAIT=1 → prints skipped, exit 0, no request', async () => {
    const out = capture();
    const stack = fakeStack({});
    const code = await run({
      env: { ...READY_ENV, SKIP_SCHEMA_WAIT: '1' },
      fetchImpl: stack.fetchImpl,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(0);
    expect(out.lines).toEqual(['wait-for-schema: skipped (SKIP_SCHEMA_WAIT=1)']);
    expect(stack.calls).toHaveLength(0);
  });

  it('T-UNIT-46 missing NEXT_PUBLIC_SUPABASE_URL / key → prints why, exit 0, no request (next build fails on its own terms)', async () => {
    for (const [env, named] of [
      [{ SUPABASE_SERVICE_ROLE_KEY: KEY }, 'NEXT_PUBLIC_SUPABASE_URL'],
      [
        { NEXT_PUBLIC_SUPABASE_URL: URL_BASE },
        'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)',
      ],
      [
        { NEXT_PUBLIC_SUPABASE_URL: '  ', SUPABASE_SERVICE_ROLE_KEY: '' },
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)',
      ],
    ] as const) {
      const out = capture();
      const stack = fakeStack({});
      const code = await run({
        env,
        fetchImpl: stack.fetchImpl,
        log: out.log,
        migrationsDir: twoMigrations,
      });
      expect(code, named).toBe(0);
      expect(out.lines).toHaveLength(1);
      expect(out.lines[0]).toContain('wait-for-schema: skipped —');
      expect(out.lines[0]).toContain(`${named} not set`);
      expect(stack.calls).toHaveLength(0);
    }
  });

  it('T-UNIT-46 SUPABASE_SECRET_KEY is accepted as the key alias (ADR-0010)', async () => {
    const out = capture();
    const stack = fakeStack({
      definitions: { alpha: {}, beta: {} },
      applied: ['20260101000000', '20260102000000'],
    });
    const code = await run({
      env: { NEXT_PUBLIC_SUPABASE_URL: URL_BASE, SUPABASE_SECRET_KEY: KEY },
      fetchImpl: stack.fetchImpl,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(0);
    expect((stack.calls[0]?.init?.headers as Record<string, string>).apikey).toBe(KEY);
  });

  it('T-UNIT-46 ready on the first poll → `ready (N migrations, M relations)`, exit 0, two requests', async () => {
    const out = capture();
    const clock = fakeClock();
    const stack = fakeStack({
      definitions: { alpha: {}, beta: {}, extra: {} },
      applied: ['20260101000000', '20260102000000', '20260103000000'],
    });
    const code = await run({
      env: READY_ENV,
      fetchImpl: stack.fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(0);
    expect(out.lines).toEqual(['wait-for-schema: ready (2 migrations, 2 relations)']);
    expect(stack.calls).toHaveLength(2);
    expect(clock.elapsed()).toBe(0);
  });

  it('T-UNIT-46 no migrations in the tree → ready at once without a request', async () => {
    const out = capture();
    const stack = fakeStack({});
    const code = await run({
      env: READY_ENV,
      fetchImpl: stack.fetchImpl,
      log: out.log,
      migrationsDir: path.join(tmp, 'empty'),
    });
    expect(code).toBe(0);
    expect(out.lines[0]).toContain('ready (0 migrations, 0 relations');
    expect(stack.calls).toHaveLength(0);
  });

  it('T-UNIT-46 the RPC missing (404 PGRST202) → waits on the versions, polls every 15 s, gives up at 60 s locally with the versions named, exit 1', async () => {
    const out = capture();
    const clock = fakeClock();
    const stack = fakeStack({ definitions: { alpha: {}, beta: {} }, rpcStatus: 404 });
    const code = await run({
      env: READY_ENV,
      fetchImpl: stack.fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(1);
    // probes at 0 / 15 / 30 / 45 / 60 s → 5 probes × 2 requests
    expect(stack.calls).toHaveLength(10);
    expect(clock.elapsed()).toBe(60_000);
    const waiting = out.lines.filter((l) => l.includes('waiting ('));
    expect(waiting).toHaveLength(2); // t = 0 and t = 60 s (once per 60 s)
    expect(waiting[0]).toContain('missing migrations: 20260101000000, 20260102000000');
    expect(waiting[0]).not.toContain('missing relations');
    const last = out.lines.at(-1) ?? '';
    expect(last).toContain('wait-for-schema: gave up after 1 min');
    expect(last).toContain('missing migrations: 20260101000000, 20260102000000');
    expect(last).toContain('vercel redeploy');
    expect(JSON.stringify(out.lines)).not.toContain(KEY);
  });

  it('T-UNIT-46 versions applied but a relation absent from the schema cache → only that relation is named', async () => {
    const out = capture();
    const clock = fakeClock();
    const stack = fakeStack({
      definitions: { alpha: {} },
      applied: ['20260101000000', '20260102000000'],
    });
    const code = await run({
      env: READY_ENV,
      fetchImpl: stack.fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(1);
    const last = out.lines.at(-1) ?? '';
    expect(last).toContain('missing relations: beta');
    expect(last).not.toContain('missing migrations');
  });

  it('T-UNIT-46 on Vercel the deadline is 20 min (81 polls at 15 s), and the waiting line prints once per minute', async () => {
    const out = capture();
    const clock = fakeClock();
    const stack = fakeStack({ definitions: {}, applied: [] });
    const code = await run({
      env: { ...READY_ENV, VERCEL_ENV: 'production' },
      fetchImpl: stack.fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(1);
    expect(clock.elapsed()).toBe(20 * 60_000);
    expect(stack.calls).toHaveLength(81 * 2);
    expect(out.lines.filter((l) => l.includes('waiting ('))).toHaveLength(21);
    expect(out.lines.at(-1)).toContain('gave up after 20 min');
    expect(out.lines.at(-1)).toContain(
      'missing migrations: 20260101000000, 20260102000000; missing relations: alpha, beta',
    );
  });

  it('T-UNIT-46 an unreachable stack keeps polling (reason in the waiting line) and never prints the key', async () => {
    const out = capture();
    const clock = fakeClock();
    const stack = fakeStack({ throwWith: `connect ECONNREFUSED 127.0.0.1:54321` });
    const code = await run({
      env: READY_ENV,
      fetchImpl: stack.fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(1);
    expect(out.lines[0]).toContain(
      'waiting (supabase unreachable (connect ECONNREFUSED 127.0.0.1:54321)',
    );
    expect(JSON.stringify(out.lines)).not.toContain(KEY);
  });

  it('T-UNIT-46 becomes ready mid-wait → exit 0 after the poll that sees it', async () => {
    const out = capture();
    const clock = fakeClock();
    let polls = 0;
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith('/rest/v1/')) {
        polls += 1;
        return json({ definitions: { alpha: {}, beta: {} } });
      }
      return polls >= 3
        ? json(['20260101000000', '20260102000000'])
        : json({ code: 'PGRST202' }, 404);
    };
    const code = await run({
      env: READY_ENV,
      fetchImpl,
      sleep: clock.sleep,
      now: clock.now,
      log: out.log,
      migrationsDir: twoMigrations,
    });
    expect(code).toBe(0);
    expect(polls).toBe(3);
    expect(clock.elapsed()).toBe(30_000);
    expect(out.lines.at(-1)).toBe('wait-for-schema: ready (2 migrations, 2 relations)');
  });

  it('T-UNIT-46 a trailing slash on the URL does not double the path', async () => {
    const stack = fakeStack({
      definitions: { alpha: {}, beta: {} },
      applied: ['20260101000000', '20260102000000'],
    });
    await run({
      env: { NEXT_PUBLIC_SUPABASE_URL: `${URL_BASE}/`, SUPABASE_SERVICE_ROLE_KEY: KEY },
      fetchImpl: stack.fetchImpl,
      log: vi.fn(),
      migrationsDir: twoMigrations,
    });
    expect(stack.calls[0]?.url).toBe(`${URL_BASE}/rest/v1/`);
  });
});

describe('the real process (T-UNIT-46 — the two exit-0 paths, no network)', () => {
  const script = path.join(REPO_ROOT, 'scripts', 'wait-for-schema.mjs');

  it('T-UNIT-46 SKIP_SCHEMA_WAIT=1 → exit 0 and the skipped line', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '',
        SKIP_SCHEMA_WAIT: '1',
        NEXT_PUBLIC_SUPABASE_URL: URL_BASE,
        SUPABASE_SERVICE_ROLE_KEY: KEY,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('wait-for-schema: skipped (SKIP_SCHEMA_WAIT=1)');
    expect(result.stdout + result.stderr).not.toContain(KEY);
  });

  it('T-UNIT-46 no Supabase env at all → exit 0 and the reason', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      'wait-for-schema: skipped — NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) not set',
    );
  });
});
