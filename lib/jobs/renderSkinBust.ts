/**
 * lib/jobs/renderSkinBust.ts — `renderSkinBust(skinId, deps?)`: one skin's texture → the cached
 * 600×800 bust at `skins/{skin_id}/bust.png` + `skins.render_bust_path` (04 §3.8; 00 S1.7 AC3 /
 * AC11; data-model §3 "512 KB bust" / §5 "Skin renders"; ADR-0047 renderer; ADR-0048 D10).
 *
 * Awaited by `createSkin` / `updateSkin` (04 §1.5 — the action revalidates `skins` afterwards) and
 * called per skin by `scripts/render-skins.mjs` (the bulk backfill). Never throws: every outcome is
 * `{ ok: true, path }` or `{ ok: false, error }`, and a failure leaves `render_bust_path` exactly as
 * it was (the action already cleared it on a texture replace; the card renders the live fallback —
 * 00 S1.7 AC10). Writes NO `sync_runs` row — the script owns that (04 §3.8 Idempotency).
 *
 * Steps (inside a 20 s budget — `Promise.race` against a timer; a step that finishes after the
 * timeout stops before its next write, so a timed-out run never lands a late bust under a fresh one):
 *   1. read `skins.texture_path, model` through the service client — no row → `{ok:false}`;
 *   2. download the texture bytes from the `skins` bucket (the DB path minus the bucket prefix);
 *   3. `renderBustPng(bytes, model)` (lib/skins/render.ts — pure TypeScript, sharp only);
 *   4. upload `skins/{skin_id}/bust.png` (`upsert: true`, `image/png`, cache-control 1 y) — the
 *      path is fixed per skin, so a re-render overwrites (idempotent, 04 §3.8);
 *   5. `update skins set render_bust_path` (the CHECK `skins_render_bust_path_own` binds it to
 *      this row's folder — the path is derived from `skinId`, never read from input).
 * A failure at any step is ONE `log.error` line (`job: 'renderSkinBust'`, `id` = the skin id — the
 * job has no `sync_runs` row of its own; `meta` carries the step and the error's name / code, never
 * bytes or paths) and `{ ok: false, error }`.
 *
 * `deps` (tests + the script): `db` — a service client (default `createAdminClient()`); `render` —
 * the renderer (default `renderBustPng`); `now` — the clock for the `ms` in the log line; `timeoutMs`
 * — the budget (default 20 000).
 *
 * Plain module — NO `server-only` (it has no browser importer, and `scripts/render-skins.mjs`
 * loads it under plain Node through `scripts/lib/ts-loader.mjs`), no `next/*`, no `revalidateTag`.
 * `@/lib/supabase/admin` is an allowed import here (01 INV-14: `lib/jobs/**`).
 */
import { SKINS_BUCKET, objectPathInBucket, skinBustPath } from '@/lib/files';
import { log } from '@/lib/log';
import { renderBustPng } from '@/lib/skins/render';
import { createAdminClient } from '@/lib/supabase/admin';

/** The service client type without importing `@supabase/supabase-js` (01 INV-85). */
export type JobDb = ReturnType<typeof createAdminClient>;

export type RenderSkinBustDeps = {
  db?: JobDb;
  render?: typeof renderBustPng;
  now?: () => number;
  timeoutMs?: number;
};

export type RenderSkinBustResult = { ok: true; path: string } | { ok: false; error: string };

/** 04 §3.8: "Timeout 20 s". */
export const RENDER_TIMEOUT_MS = 20_000;

/** One year — the bust path is fixed per skin and busts are cache-busted by a re-render's bytes only. */
const CACHE_CONTROL_S = '31536000';

type Step = 'read' | 'download' | 'render' | 'upload' | 'update' | 'timeout';

/** A step failure with the step name for the log line (message stays plain, no path, no bytes). */
class StepError extends Error {
  readonly step: Step;
  readonly code: string | null;
  constructor(
    step: Step,
    message: string,
    code: string | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StepError';
    this.step = step;
    this.code = code;
  }
}

/** The five steps in sequence; `stillWanted()` is false once the budget ran out. */
async function work(
  skinId: string,
  db: JobDb,
  render: typeof renderBustPng,
  stillWanted: () => boolean,
): Promise<RenderSkinBustResult> {
  const { data: row, error: readError } = await db
    .from('skins')
    .select('texture_path, model')
    .eq('id', skinId)
    .maybeSingle();
  if (readError) throw new StepError('read', 'skins read failed', readError.code);
  if (row === null) throw new StepError('read', 'unknown skin');
  if (!stillWanted()) return { ok: false, error: 'timeout' };

  const texturePath = objectPathInBucket(SKINS_BUCKET, row.texture_path);
  if (texturePath === null) throw new StepError('download', 'texture path outside the bucket');
  const { data: blob, error: downloadError } = await db.storage
    .from(SKINS_BUCKET)
    .download(texturePath);
  if (downloadError || blob === null) {
    throw new StepError('download', 'texture download failed', null, { cause: downloadError });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!stillWanted()) return { ok: false, error: 'timeout' };

  let png: Buffer;
  try {
    png = await render(bytes, row.model);
  } catch (cause) {
    const code = (cause as { code?: unknown }).code;
    throw new StepError('render', 'render failed', typeof code === 'string' ? code : null, {
      cause,
    });
  }
  if (!stillWanted()) return { ok: false, error: 'timeout' };

  const bustDbPath = skinBustPath(skinId);
  const bustPath = objectPathInBucket(SKINS_BUCKET, bustDbPath);
  if (bustPath === null) throw new StepError('upload', 'bust path outside the bucket');
  const { error: uploadError } = await db.storage.from(SKINS_BUCKET).upload(bustPath, png, {
    contentType: 'image/png',
    upsert: true,
    cacheControl: CACHE_CONTROL_S,
  });
  if (uploadError)
    throw new StepError('upload', 'bust upload failed', null, { cause: uploadError });
  if (!stillWanted()) return { ok: false, error: 'timeout' };

  const { error: updateError } = await db
    .from('skins')
    .update({ render_bust_path: bustDbPath })
    .eq('id', skinId);
  if (updateError) throw new StepError('update', 'skins update failed', updateError.code);

  return { ok: true, path: bustDbPath };
}

/**
 * Renders and caches one skin's bust (see the header). Resolves — never rejects — with the result;
 * a failure is logged once and leaves the row as it was.
 */
export async function renderSkinBust(
  skinId: string,
  deps: RenderSkinBustDeps = {},
): Promise<RenderSkinBustResult> {
  const db = deps.db ?? createAdminClient();
  const render = deps.render ?? renderBustPng;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? RENDER_TIMEOUT_MS;
  const startedAt = now();

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RenderSkinBustResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
  });

  let step: Step = 'read';
  let code: string | null = null;
  let name = 'unknown';
  try {
    const result = await Promise.race([work(skinId, db, render, () => !timedOut), timeout]);
    if (result.ok) return result;
    step = 'timeout';
    name = 'Timeout';
  } catch (error) {
    if (error instanceof StepError) {
      step = error.step;
      code = error.code;
      name = error.cause instanceof Error ? error.cause.name : error.name;
    } else {
      name = error instanceof Error ? error.name : typeof error;
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  log.error({
    job: 'renderSkinBust',
    id: skinId,
    msg: 'bust_render_failed',
    meta: { step, name, code, ms: now() - startedAt },
  });
  return { ok: false, error: step === 'timeout' ? 'timeout' : `${step} failed` };
}
