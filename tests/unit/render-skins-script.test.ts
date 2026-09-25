/**
 * tests/unit/render-skins-script.test.ts — T-UNIT-45: `scripts/render-skins.mjs` idempotency
 * (04 §3.8 "`scripts/render-skins.mjs` for backfill"; 00 S1.7 AC11; ADR-0002 #80; ADR-0048 D11).
 * `run()` with every edge faked — a 3-row skins table (2 without `render_bust_path`, 1 with) and
 * recording `insertRun` / `finalizeRun` / `render`: the first run renders exactly the two, inserts
 * ONE run row `source='skins'` and finalizes it `items = 2, ok = true`; a second run over the
 * now-rendered table renders nothing (`items = 0, ok = true`); `--force` renders all three; one
 * skin's failure leaves the other rendered (`ok = true`, `summary.errors.length === 1`, exit 0);
 * every skin failing fills `error`; a DB that cannot start the run → exit 1, nothing rendered.
 * Also pinned by reading the script's source: `process.env` never appears outside a comment and
 * `loadEnvFile` is used only inside `main()` (the module never reads env — `@/lib/env` does,
 * 01 INV-88). Pure — no DB, no sockets.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERRORS_MAX, dueSkins, parseArgs, run } from '../../scripts/render-skins.mjs';
import { REPO_ROOT } from '@/tests/helpers/envTest';

type Skin = { id: string; slug: string; render_bust_path: string | null };
type RunRow = { id: string; source: string; ok?: boolean; items?: number; error?: string | null };
type RenderResult = { ok: true; path: string } | { ok: false; error: string };

const ID_A = '00000000-0000-4000-8000-00000000aaaa';
const ID_B = '00000000-0000-4000-8000-00000000bbbb';
const ID_C = '00000000-0000-4000-8000-00000000cccc';

/** A fake stack: an in-memory `skins` table, a `sync_runs` table and a renderer with a failure list. */
function fakeStack(failing: readonly string[] = []) {
  const skins: Skin[] = [
    { id: ID_A, slug: 'skin-a', render_bust_path: null },
    { id: ID_B, slug: 'skin-b', render_bust_path: `skins/${ID_B}/bust.png` },
    { id: ID_C, slug: 'skin-c', render_bust_path: null },
  ];
  const runs: RunRow[] = [];
  const rendered: string[] = [];
  const lines: string[] = [];
  const edges = {
    listSkins: () => Promise.resolve(skins.map((skin) => ({ ...skin }))),
    render: (skinId: string): Promise<RenderResult> => {
      rendered.push(skinId);
      const skin = skins.find((row) => row.id === skinId);
      if (skin === undefined) return Promise.resolve({ ok: false, error: 'read failed' });
      if (failing.includes(skinId)) return Promise.resolve({ ok: false, error: 'render failed' });
      skin.render_bust_path = `skins/${skinId}/bust.png`;
      return Promise.resolve({ ok: true, path: skin.render_bust_path });
    },
    insertRun: (source: 'skins') => {
      const id = `run-${String(runs.length + 1)}`;
      runs.push({ id, source });
      return Promise.resolve(id);
    },
    finalizeRun: (runId: string, result: { ok: boolean; items: number; error: string | null }) => {
      const row = runs.find((run) => run.id === runId);
      if (row === undefined) throw new Error(`unknown run ${runId}`);
      Object.assign(row, result);
      return Promise.resolve();
    },
    log: (line: string) => {
      lines.push(line);
    },
  };
  return { skins, runs, rendered, lines, edges };
}

describe('T-UNIT-45 scripts/render-skins.mjs', () => {
  it('T-UNIT-45 first run: renders exactly the two skins without a bust, ONE run row source=skins, items 2, ok', async () => {
    const stack = fakeStack();
    const { exitCode, summary } = await run(stack.edges);
    expect(exitCode).toBe(0);
    expect(stack.rendered).toEqual([ID_A, ID_C]);
    expect(stack.runs).toEqual([{ id: 'run-1', source: 'skins', ok: true, items: 2, error: null }]);
    expect(summary).toEqual({
      runId: 'run-1',
      total: 3,
      due: 2,
      rendered: 2,
      failed: 0,
      skipped: 1,
      errors: [],
    });
    expect(stack.lines).toEqual([
      'rendered skin-a',
      'rendered skin-c',
      'render-skins: done — 2 rendered, 0 failed, 1 already had a bust (run run-1)',
    ]);
    expect(stack.skins.every((skin) => skin.render_bust_path !== null)).toBe(true);
  });

  it('T-UNIT-45 second run over the rendered table: zero renders, items 0, ok — idempotent', async () => {
    const stack = fakeStack();
    await run(stack.edges);
    stack.rendered.length = 0;
    const { exitCode, summary } = await run(stack.edges);
    expect(exitCode).toBe(0);
    expect(stack.rendered).toEqual([]);
    expect(stack.runs).toHaveLength(2);
    expect(stack.runs[1]).toEqual({
      id: 'run-2',
      source: 'skins',
      ok: true,
      items: 0,
      error: null,
    });
    expect(summary.rendered).toBe(0);
    expect(summary.skipped).toBe(3);
  });

  it('T-UNIT-45 --force renders every skin (3), onto the same fixed paths', async () => {
    const stack = fakeStack();
    const before = stack.skins.map((skin) => skin.render_bust_path);
    const { exitCode, summary } = await run({ ...stack.edges, force: true });
    expect(exitCode).toBe(0);
    expect(stack.rendered).toEqual([ID_A, ID_B, ID_C]);
    expect(stack.runs[0]).toMatchObject({ source: 'skins', ok: true, items: 3, error: null });
    expect(summary.due).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(stack.skins[1]?.render_bust_path).toBe(before[1]);
    expect(stack.lines.at(-1)).toContain('(--force)');
    expect(parseArgs(['--force'])).toEqual({ force: true });
    expect(parseArgs([])).toEqual({ force: false });
    expect(dueSkins(stack.skins, false)).toEqual([]);
    expect(dueSkins(stack.skins, true)).toHaveLength(3);
  });

  it('T-UNIT-45 one skin fails: the other is still rendered, ok stays true, errors carries the one, exit 0', async () => {
    const stack = fakeStack([ID_A]);
    const { exitCode, summary } = await run(stack.edges);
    expect(exitCode).toBe(0);
    expect(stack.rendered).toEqual([ID_A, ID_C]);
    expect(stack.runs[0]).toEqual({
      id: 'run-1',
      source: 'skins',
      ok: true,
      items: 1,
      error: null,
    });
    expect(summary.rendered).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toEqual([{ slug: 'skin-a', message: 'render failed' }]);
    expect(stack.lines).toContain('failed skin-a: render failed');
    expect(stack.lines).toContain('rendered skin-c');
    // The failed skin is still due next time; the rendered one is not.
    expect(stack.skins.find((skin) => skin.id === ID_A)?.render_bust_path).toBeNull();
    expect(stack.skins.find((skin) => skin.id === ID_C)?.render_bust_path).not.toBeNull();
  });

  it('T-UNIT-45 every due skin fails: ok stays true (the run completed), error names them, exit 0', async () => {
    const stack = fakeStack([ID_A, ID_C]);
    const { exitCode, summary } = await run(stack.edges);
    expect(exitCode).toBe(0);
    expect(summary.errors).toHaveLength(2);
    expect(stack.runs[0]).toMatchObject({ ok: true, items: 0 });
    expect(stack.runs[0]?.error).toContain('every skin failed (2)');
    expect(stack.runs[0]?.error).toContain('skin-a: render failed');
  });

  it(`T-UNIT-45 errors[] is capped at ${String(ERRORS_MAX)} entries; the counts stay exact`, async () => {
    const skins: Skin[] = Array.from({ length: ERRORS_MAX + 5 }, (_unused, index) => ({
      id: `id-${String(index)}`,
      slug: `skin-${String(index)}`,
      render_bust_path: null,
    }));
    const stack = fakeStack();
    const { summary } = await run({
      ...stack.edges,
      listSkins: () => Promise.resolve(skins),
      render: () => Promise.resolve({ ok: false, error: 'boom' }),
    });
    expect(summary.failed).toBe(ERRORS_MAX + 5);
    expect(summary.errors).toHaveLength(ERRORS_MAX);
  });

  it('T-UNIT-45 the run cannot start (list or insert throws) → exit 1, nothing rendered, no run row', async () => {
    const noDb = fakeStack();
    const listFailed = await run({
      ...noDb.edges,
      listSkins: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(listFailed.exitCode).toBe(1);
    expect(noDb.rendered).toEqual([]);
    expect(noDb.runs).toEqual([]);
    expect(noDb.lines).toEqual(['render-skins: could not start — ECONNREFUSED']);

    const insertFailed = fakeStack();
    const result = await run({
      ...insertFailed.edges,
      insertRun: () => Promise.reject(new Error('sync_runs insert failed')),
    });
    expect(result.exitCode).toBe(1);
    expect(insertFailed.rendered).toEqual([]);
    expect(result.summary.runId).toBeNull();
  });

  it('T-UNIT-45 a finalize failure is logged, the renders stand, exit 0', async () => {
    const stack = fakeStack();
    const { exitCode } = await run({
      ...stack.edges,
      finalizeRun: () => Promise.reject(new Error('lost the connection')),
    });
    expect(exitCode).toBe(0);
    expect(stack.rendered).toEqual([ID_A, ID_C]);
    expect(stack.lines.some((line) => line.includes('could not be finalized'))).toBe(true);
  });

  it('T-UNIT-45 the module never reads process.env; loadEnvFile lives in main() only (INV-88)', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'scripts', 'render-skins.mjs'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('process.env');

    const mainStart = code.indexOf('export async function main(');
    const guardStart = code.indexOf('process.argv[1]');
    expect(mainStart).toBeGreaterThan(-1);
    expect(guardStart).toBeGreaterThan(mainStart);
    const uses = [...code.matchAll(/loadEnvFile/g)].map((m) => m.index);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toBeGreaterThan(mainStart);
    expect(uses[0]).toBeLessThan(guardStart);
  });
});
