#!/usr/bin/env node
/**
 * scripts/render-skins.mjs — the bulk bust backfill (04 §3.8 "`scripts/render-skins.mjs` for
 * backfill"; 00 S1.7 AC11; 05 T-UNIT-45 idempotency; ADR-0002 #80; ADR-0048 D11).
 *
 *   pnpm exec node scripts/render-skins.mjs            # every skin with render_bust_path IS NULL
 *   pnpm exec node scripts/render-skins.mjs --force    # every skin (re-render, same paths)
 *
 * What it does: lists the skins, inserts ONE `sync_runs` row (`source='skins'`) before the first
 * render, renders each due skin in sequence through `lib/jobs/renderSkinBust.ts` (the same code
 * the actions await: `skins/<id>/bust.png` upserted + `render_bust_path` set; a per-skin failure
 * is logged by the job and counted here), then finalizes the run: `items` = the number rendered,
 * `ok = true` whenever the run itself completed (per-skin failures do not fail the run — the
 * summary's `errors[]` (≤ 20 entries) carries them; `error` is set only when every due skin
 * failed). Idempotent: a second run finds nothing due and renders nothing (`items = 0`), and
 * `--force` re-renders onto the same fixed paths. One line per skin (`rendered <slug>` /
 * `failed <slug>: <message>`) and a summary line. Exit code 0 on completion; 1 only when the run
 * could not start (the list / insert failed — no DB). The e2e / CI never run it.
 *
 * `run({ listSkins, render, insertRun, finalizeRun, force, log })` is the whole program with its
 * edges injected (tests pass fakes — the `scripts/wait-for-schema.mjs` `run()` shape); `main()`
 * runs only as the entry point: it registers `scripts/lib/ts-loader.mjs` (the `@/…` + `server-only`
 * resolve hook — Node 24 strips the types itself), loads `.env` through `process.loadEnvFile`
 * when the file exists (this module never reads `process.env` — `@/lib/env` does, INV-88), then
 * dynamic-imports `@/lib/supabase/admin`, `@/lib/jobs/runs` and `@/lib/jobs/renderSkinBust` and
 * wires the real edges. No package.json script on purpose (a one-off, `add-content` territory).
 */
import { existsSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repo root (this file lives in scripts/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `summary.errors` never grows past this (the `sync_runs.error` column is 2000 chars anyway). */
export const ERRORS_MAX = 20;

const PREFIX = 'render-skins:';

/**
 * @typedef {{ id: string, slug: string, render_bust_path: string | null }} SkinListItem
 * @typedef {{ ok: true, path: string } | { ok: false, error: string }} RenderResult
 * @typedef {{
 *   listSkins: () => Promise<SkinListItem[]>,
 *   render: (skinId: string) => Promise<RenderResult>,
 *   insertRun: (source: 'skins') => Promise<string>,
 *   finalizeRun: (runId: string, result: { ok: boolean, items: number, error: string | null }) => Promise<void>,
 *   force?: boolean,
 *   log?: (line: string) => void,
 * }} RunEdges
 * @typedef {{
 *   runId: string | null,
 *   total: number,
 *   due: number,
 *   rendered: number,
 *   failed: number,
 *   skipped: number,
 *   errors: { slug: string, message: string }[],
 * }} RunSummary
 */

/** The skins a run renders: every one without a bust, or every one under `--force`. Order kept. */
export function dueSkins(skins, force) {
  return force ? [...skins] : skins.filter((skin) => skin.render_bust_path === null);
}

/** `--force` anywhere in the arguments. */
export function parseArgs(argv) {
  return { force: argv.includes('--force') };
}

/**
 * The whole program with its edges injected. Returns `{ exitCode, summary }`; prints through `log`.
 * @param {RunEdges} edges
 * @returns {Promise<{ exitCode: number, summary: RunSummary }>}
 */
export async function run({
  listSkins,
  render,
  insertRun,
  finalizeRun,
  force = false,
  log = console.log,
}) {
  /** @type {RunSummary} */
  const summary = { runId: null, total: 0, due: 0, rendered: 0, failed: 0, skipped: 0, errors: [] };

  let skins;
  let runId;
  try {
    skins = await listSkins();
    runId = await insertRun('skins');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${PREFIX} could not start — ${message}`);
    return { exitCode: 1, summary };
  }
  summary.runId = runId;
  summary.total = skins.length;

  const due = dueSkins(skins, force);
  summary.due = due.length;
  summary.skipped = skins.length - due.length;

  for (const skin of due) {
    const result = await render(skin.id);
    if (result.ok) {
      summary.rendered += 1;
      log(`rendered ${skin.slug}`);
    } else {
      summary.failed += 1;
      if (summary.errors.length < ERRORS_MAX)
        summary.errors.push({ slug: skin.slug, message: result.error });
      log(`failed ${skin.slug}: ${result.error}`);
    }
  }

  const everyDueFailed = summary.due > 0 && summary.rendered === 0;
  const error = everyDueFailed
    ? `every skin failed (${summary.failed}): ${summary.errors.map((e) => `${e.slug}: ${e.message}`).join('; ')}`
    : null;
  try {
    await finalizeRun(runId, { ok: true, items: summary.rendered, error });
  } catch (finalizeError) {
    const message = finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
    log(`${PREFIX} run ${runId} could not be finalized — ${message}`);
  }

  log(
    `${PREFIX} done — ${summary.rendered} rendered, ${summary.failed} failed, ${summary.skipped} already had a bust` +
      `${force ? ' (--force)' : ''} (run ${runId})`,
  );
  return { exitCode: 0, summary };
}

/** The entry point: real DB, real renderer, `.env` when present (never `process.env` here). */
export async function main(argv = process.argv.slice(2)) {
  register(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'ts-loader.mjs')).href);
  const envFile = path.join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { insertRun, finalizeRun } = await import('@/lib/jobs/runs');
  const { renderSkinBust } = await import('@/lib/jobs/renderSkinBust');
  const db = createAdminClient();

  const { exitCode } = await run({
    force: parseArgs(argv).force,
    listSkins: async () => {
      const { data, error } = await db
        .from('skins')
        .select('id, slug, render_bust_path')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw new Error(`skins read failed: ${error.message}`);
      return data;
    },
    render: (skinId) => renderSkinBust(skinId, { db }),
    insertRun: (source) => insertRun(db, source),
    finalizeRun: (runId, result) => finalizeRun(db, runId, result),
  });
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`${PREFIX} crashed — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
