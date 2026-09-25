/**
 * tests/unit/ts-loader.test.ts — `scripts/lib/ts-loader.mjs` (ADR-0048 D11; id-less per ADR-R9):
 * the Node customization hook `scripts/render-skins.mjs` registers so plain Node can import the
 * app's TypeScript. `resolve()` with a fake `nextResolve`: `@/lib/env` → `<repo>/lib/env.ts` (the
 * FILE, not the `lib/env/` directory beside it), `@/lib/env/public` → `lib/env/public.ts`,
 * `@/lib/skins/render` → `.ts`, `server-only` → `node_modules/server-only/empty.js`, and anything
 * else (bare packages, `node:` builtins, relative paths, an unknown `@/` target) passes through
 * untouched. `load()` with a fake `nextLoad`: a repo `.ts` file is declared `module-typescript`,
 * a `node_modules` `.ts`, an `.mjs` and a non-file URL are left to Node. The candidate order
 * (`.ts` · `.tsx` · `/index.ts` · bare file) is proven on a throwaway tree. Pure — no sockets.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOT,
  candidatesFor,
  initialize,
  isRepoTypeScript,
  load,
  mapSpecifier,
  resolve,
} from '../../scripts/lib/ts-loader.mjs';
import { REPO_ROOT } from '@/tests/helpers/envTest';

type ResolveContext = { parentURL?: string; conditions?: string[] };
type NextResolve = (specifier: string, context?: object) => Promise<object>;
type NextLoad = (url: string, context?: object) => Promise<object>;

const CONTEXT: ResolveContext = { parentURL: pathToFileURL(path.join(REPO_ROOT, 'x.mjs')).href };

function fileUrl(...segments: string[]): string {
  return pathToFileURL(path.join(REPO_ROOT, ...segments)).href;
}

/** A `nextResolve` that records what it was handed and answers a recognisable object. */
function fakeNext(): { next: NextResolve; calls: { specifier: string; context?: object }[] } {
  const calls: { specifier: string; context?: object }[] = [];
  const next: NextResolve = (specifier, context) => {
    calls.push({ specifier, context });
    return Promise.resolve({ url: `resolved:${specifier}`, shortCircuit: true });
  };
  return { next, calls };
}

afterAll(() => {
  initialize({ root: DEFAULT_ROOT });
});

describe('ts-loader resolve()', () => {
  it('the default root is the repo (scripts/lib/ → scripts/ → root)', () => {
    expect(DEFAULT_ROOT).toBe(REPO_ROOT);
  });

  it.each([
    ['@/lib/env', ['lib', 'env.ts']],
    ['@/lib/env/public', ['lib', 'env', 'public.ts']],
    ['@/lib/skins/render', ['lib', 'skins', 'render.ts']],
    ['@/lib/jobs/renderSkinBust', ['lib', 'jobs', 'renderSkinBust.ts']],
    ['@/lib/supabase/admin', ['lib', 'supabase', 'admin.ts']],
  ])('%s → the .ts file under the repo, handed to nextResolve', async (specifier, segments) => {
    const { next, calls } = fakeNext();
    const result = await resolve(specifier, CONTEXT, next);
    expect(calls).toEqual([{ specifier: fileUrl(...segments), context: CONTEXT }]);
    expect(result).toEqual({ url: `resolved:${fileUrl(...segments)}`, shortCircuit: true });
  });

  it('@/lib/env resolves to the FILE lib/env.ts, never the lib/env/ directory beside it', () => {
    expect(mapSpecifier('@/lib/env')).toBe(fileUrl('lib', 'env.ts'));
    expect(mapSpecifier('@/lib/env')).not.toBe(fileUrl('lib', 'env'));
    expect(candidatesFor('lib/env')[0]).toBe(path.join(REPO_ROOT, 'lib', 'env.ts'));
  });

  it('server-only → node_modules/server-only/empty.js (the no-op entry)', async () => {
    const { next, calls } = fakeNext();
    await resolve('server-only', CONTEXT, next);
    expect(calls[0]?.specifier).toBe(fileUrl('node_modules', 'server-only', 'empty.js'));
  });

  it.each([
    'sharp',
    'zod',
    'node:fs',
    'node:crypto',
    './model',
    '../lib/x.ts',
    '@supabase/supabase-js',
  ])('%s passes through unchanged', async (specifier) => {
    const { next, calls } = fakeNext();
    await resolve(specifier, CONTEXT, next);
    expect(calls).toEqual([{ specifier, context: CONTEXT }]);
    expect(mapSpecifier(specifier)).toBeNull();
  });

  it('an @/ target that is no file passes through unchanged (Node reports it)', async () => {
    const { next, calls } = fakeNext();
    await resolve('@/lib/does-not-exist', CONTEXT, next);
    expect(calls[0]?.specifier).toBe('@/lib/does-not-exist');
  });

  it('candidate order: .ts, then .tsx, then /index.ts, then the bare file (proven on a throwaway tree)', () => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'ts-loader-'));
    try {
      mkdirSync(path.join(base, 'lib', 'both'), { recursive: true });
      mkdirSync(path.join(base, 'lib', 'folder'), { recursive: true });
      writeFileSync(path.join(base, 'lib', 'both.ts'), '');
      writeFileSync(path.join(base, 'lib', 'both', 'index.ts'), '');
      writeFileSync(path.join(base, 'lib', 'view.tsx'), '');
      writeFileSync(path.join(base, 'lib', 'folder', 'index.ts'), '');
      writeFileSync(path.join(base, 'lib', 'data.json'), '{}');

      expect(candidatesFor('lib/x', base)).toEqual([
        path.join(base, 'lib', 'x.ts'),
        path.join(base, 'lib', 'x.tsx'),
        path.join(base, 'lib', 'x', 'index.ts'),
        path.join(base, 'lib', 'x'),
      ]);
      expect(mapSpecifier('@/lib/both', base)).toBe(
        pathToFileURL(path.join(base, 'lib', 'both.ts')).href,
      );
      expect(mapSpecifier('@/lib/view', base)).toBe(
        pathToFileURL(path.join(base, 'lib', 'view.tsx')).href,
      );
      expect(mapSpecifier('@/lib/folder', base)).toBe(
        pathToFileURL(path.join(base, 'lib', 'folder', 'index.ts')).href,
      );
      expect(mapSpecifier('@/lib/data.json', base)).toBe(
        pathToFileURL(path.join(base, 'lib', 'data.json')).href,
      );
      expect(mapSpecifier('@/lib/missing', base)).toBeNull();
      // A directory alone is never a hit (`lib/x/` without index.ts).
      mkdirSync(path.join(base, 'lib', 'empty'));
      expect(mapSpecifier('@/lib/empty', base)).toBeNull();

      // `initialize({ root })` moves the hook's own root (what `resolve` uses).
      initialize({ root: base });
      expect(mapSpecifier('@/lib/both')).toBe(
        pathToFileURL(path.join(base, 'lib', 'both.ts')).href,
      );
      expect(mapSpecifier('server-only')).toBe(
        pathToFileURL(path.join(base, 'node_modules', 'server-only', 'empty.js')).href,
      );
      initialize({ root: DEFAULT_ROOT });
      expect(mapSpecifier('@/lib/env')).toBe(fileUrl('lib', 'env.ts'));
      // A malformed `initialize` payload is ignored.
      initialize(undefined);
      initialize({ root: '' });
      expect(mapSpecifier('@/lib/env')).toBe(fileUrl('lib', 'env.ts'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('ts-loader load()', () => {
  function fakeLoad(): { next: NextLoad; calls: { url: string; context?: object }[] } {
    const calls: { url: string; context?: object }[] = [];
    const next: NextLoad = (url, context) => {
      calls.push({ url, context });
      return Promise.resolve({ format: 'module', source: '', shortCircuit: true });
    };
    return { next, calls };
  }

  it('a repo .ts / .tsx file is declared module-typescript up front', async () => {
    for (const url of [fileUrl('lib', 'env.ts'), fileUrl('components', 'x', 'View.tsx')]) {
      const { next, calls } = fakeLoad();
      await load(url, { format: null }, next);
      expect(calls).toEqual([{ url, context: { format: 'module-typescript' } }]);
      expect(isRepoTypeScript(url)).toBe(true);
    }
  });

  it.each([
    fileUrl('node_modules', 'sharp', 'lib', 'index.ts'),
    fileUrl('scripts', 'render-skins.mjs'),
    fileUrl('node_modules', 'server-only', 'empty.js'),
    'node:fs',
    'data:text/javascript,export%20default%201',
  ])('%s is left to Node', async (url) => {
    const { next, calls } = fakeLoad();
    const context = { format: null };
    await load(url, context, next);
    expect(calls).toEqual([{ url, context }]);
    expect(isRepoTypeScript(url)).toBe(false);
  });

  it('a .ts file outside the repo root is not ours', () => {
    expect(isRepoTypeScript(pathToFileURL(path.join(os.tmpdir(), 'elsewhere.ts')).href)).toBe(
      false,
    );
    expect(isRepoTypeScript(pathToFileURL(path.join(REPO_ROOT, '..', 'sibling.ts')).href)).toBe(
      false,
    );
  });
});
