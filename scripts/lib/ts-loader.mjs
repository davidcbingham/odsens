/**
 * scripts/lib/ts-loader.mjs — a Node module-customization hook so a plain `node` script can import
 * the app's TypeScript modules (ADR-0048 D11; `scripts/render-skins.mjs` is the one user).
 *
 * Node ≥ 24 strips types natively (erasable syntax only — the app's modules are written that way),
 * so the only two things a script lacks are (1) the `@/…` path alias `tsconfig.json` declares and
 * (2) the `server-only` marker package, whose `index.js` throws outside a React Server Component
 * runtime. This hook supplies both in `resolve()`:
 *   `@/<path>`     → `<repo>/<path>.ts` · `.tsx` · `/index.ts` (the first that is a file; a bare
 *                    existing file last, for `.mjs` / `.json` targets) — so `@/lib/env` is
 *                    `lib/env.ts`, not the `lib/env/` directory beside it;
 *   `server-only`  → `node_modules/server-only/empty.js` (the package's own no-op entry).
 * Anything else falls through to Node's resolver unchanged. The resolved specifier is handed on
 * through `nextResolve`. `load()` then names the format of every repo `.ts` file
 * (`module-typescript`): `package.json` has no `"type"`, so without it Node would first parse each
 * file as CommonJS, fail, reparse as ESM and print a MODULE_TYPELESS_PACKAGE_JSON warning per file.
 *
 * Usage (from a script's `main()`): `register(new URL('./lib/ts-loader.mjs', import.meta.url).href)`
 * from `node:module`, then dynamic-`import` the app modules. No env is read here; the repo root is
 * this file's grandparent (`scripts/lib/` → `scripts/` → root), overridable through
 * `initialize({ root })` for tests. `pnpm exec node scripts/render-skins.mjs` needs nothing else.
 *
 * `tests/unit/ts-loader.test.ts` pins the mapping with a fake `nextResolve` / `nextLoad`.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root (this file lives in scripts/lib/). */
export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let root = DEFAULT_ROOT;

/** The candidates tried for `@/<rel>`, in order (ADR-0048 D11). */
export function candidatesFor(rel, base = root) {
  const target = path.join(base, rel);
  return [`${target}.ts`, `${target}.tsx`, path.join(target, 'index.ts'), target];
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * `@/<rel>` → the first candidate that is a file (as a `file://` URL), `server-only` → the empty
 * entry, anything else → null (let Node resolve it). Pure apart from the `statSync` probes.
 * @param {string} specifier
 * @param {string} [base]
 * @returns {string | null}
 */
export function mapSpecifier(specifier, base = root) {
  if (specifier === 'server-only') {
    return pathToFileURL(path.join(base, 'node_modules', 'server-only', 'empty.js')).href;
  }
  if (specifier.startsWith('@/')) {
    const file = candidatesFor(specifier.slice(2), base).find(isFile);
    return file === undefined ? null : pathToFileURL(file).href;
  }
  return null;
}

/** `register(url, { data: { root } })` may point the hook at another checkout (tests). */
export function initialize(data) {
  if (data && typeof data.root === 'string' && data.root !== '') root = data.root;
}

/**
 * The Node `resolve` hook: maps `@/…` and `server-only`, hands everything on to `nextResolve`.
 * @param {string} specifier
 * @param {{ parentURL?: string, conditions?: string[], importAttributes?: object }} context
 * @param {(specifier: string, context?: object) => Promise<object>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  const mapped = mapSpecifier(specifier);
  return nextResolve(mapped ?? specifier, context);
}

/** True for a `file:` URL of a `.ts` / `.tsx` module inside the repo (never `node_modules`). */
export function isRepoTypeScript(url, base = root) {
  if (!url.startsWith('file:')) return false;
  const file = fileURLToPath(url);
  if (!/\.tsx?$/.test(file)) return false;
  const rel = path.relative(base, file);
  return rel !== '' && !rel.startsWith('..') && !rel.split(path.sep).includes('node_modules');
}

/**
 * The Node `load` hook: a repo `.ts` file is an ES module with types to strip — said up front so
 * Node skips the CommonJS-first reparse (and its warning). Everything else is Node's business.
 * @param {string} url
 * @param {{ format?: string | null, conditions?: string[], importAttributes?: object }} context
 * @param {(url: string, context?: object) => Promise<object>} nextLoad
 */
export async function load(url, context, nextLoad) {
  if (isRepoTypeScript(url)) return nextLoad(url, { ...context, format: 'module-typescript' });
  return nextLoad(url, context);
}
