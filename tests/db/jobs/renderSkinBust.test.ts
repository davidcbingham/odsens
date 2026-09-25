/**
 * tests/db/jobs/renderSkinBust.test.ts — T-ACT-56 (04 §3.8 `renderSkinBust`; data-model §3 "512 KB
 * bust" / §5 "Skin renders"; 00 S1.7 AC3; ADR-0047; ADR-0048 D10; migration 20260925120000).
 *
 * The job against the local stack with the REAL renderer: a `makeSkin` row (its 64×64 texture
 * uploaded by the factory, `render_bust_path` NULL) → `skins/<id>/bust.png` exists (downloaded
 * back: PNG magic, ≤ 512 KB, `image/png`) and the column is set; a second call lands on the SAME
 * path (upsert — proven with an injected renderer whose bytes differ: the object changes, the
 * column does not). Failure paths through `deps`: a rejecting renderer → `{ok:false}`, the column
 * untouched, ONE `log.error` line (`job: 'renderSkinBust'`, keys only), nothing thrown; a 1 ms
 * budget against a slow renderer → `{ok:false, error:'timeout'}` and the late render never writes;
 * an unknown id → `{ok:false}`. Writes NO `sync_runs` row (counted before / after — the script
 * owns that row, T-UNIT-45). The `createSkin` half of T-ACT-56 (a failing renderer still answers
 * `ok` with `bust_rendered:false`) lives in `tests/db/actions/createSkin.test.ts`.
 *
 * Rows + objects come from `makeSkin` and leave with `cleanupFactories` (`skins/<id>/*` included).
 */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderSkinBust } from '@/lib/jobs/renderSkinBust';
import { BUST_MAX_BYTES, RenderError } from '@/lib/skins/render';
import { asRole } from '@/tests/helpers/asRole';
import { cleanupFactories, makeSkin } from '@/tests/helpers/factories';
import { spyLog, type LogSpy } from '@/tests/helpers/spies';
import { listObjects } from '@/tests/helpers/storage';

const service = asRole('service');
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let logs: LogSpy;

function jobLines(): Array<{
  level?: string;
  job?: string;
  msg?: string;
  meta?: Record<string, unknown>;
}> {
  return (logs.lines as Array<{ job?: string }>).filter((line) => line.job === 'renderSkinBust');
}

beforeEach(() => {
  logs = spyLog();
});

afterEach(() => {
  logs.restore();
});

afterAll(async () => {
  await cleanupFactories();
});

async function bustColumn(id: string): Promise<string | null> {
  const { data, error } = await service
    .from('skins')
    .select('render_bust_path')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data.render_bust_path;
}

async function downloadBust(id: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const { data, error } = await service.storage.from('skins').download(`${id}/bust.png`);
  if (error || data === null) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), type: data.type };
}

async function skinRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'skins');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** A real 1×1 PNG — visibly not a bust, so an overwrite is provable. */
async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 1, height: 1, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer();
}

describe('T-ACT-56 renderSkinBust', () => {
  it('T-ACT-56 a skin without a bust → skins/<id>/bust.png (PNG, ≤ 512 KB, image/png) and render_bust_path set; no sync_runs row', async () => {
    const id = await makeSkin();
    expect(await bustColumn(id)).toBeNull();
    const runsBefore = await skinRunCount();

    const result = await renderSkinBust(id);
    expect(result).toEqual({ ok: true, path: `skins/${id}/bust.png` });
    expect(await bustColumn(id)).toBe(`skins/${id}/bust.png`);

    const bust = await downloadBust(id);
    expect(bust).not.toBeNull();
    expect(Array.from(bust?.bytes.subarray(0, 8) ?? [])).toEqual(PNG_MAGIC);
    expect(bust?.bytes.byteLength).toBeLessThanOrEqual(BUST_MAX_BYTES);
    expect(bust?.bytes.byteLength).toBeGreaterThan(1000);
    expect(bust?.type).toBe('image/png');

    expect(await skinRunCount()).toBe(runsBefore);
    expect(jobLines()).toEqual([]);
    expect(await listObjects('skins', id)).toEqual(
      expect.arrayContaining([`${id}/texture.png`, `${id}/bust.png`]),
    );
  });

  it('T-ACT-56 a second call lands on the SAME path (upsert): the object is overwritten, the column unchanged', async () => {
    const id = await makeSkin();
    const first = await renderSkinBust(id);
    expect(first.ok).toBe(true);
    const before = await downloadBust(id);
    expect(before).not.toBeNull();

    // A renderer with different bytes proves "overwritten" (the real one is deterministic).
    const small = await tinyPng();
    const second = await renderSkinBust(id, { render: () => Promise.resolve(small) });
    expect(second).toEqual({ ok: true, path: `skins/${id}/bust.png` });
    expect(await bustColumn(id)).toBe(`skins/${id}/bust.png`);

    const after = await downloadBust(id);
    expect(after?.bytes.byteLength).toBe(small.byteLength);
    expect(after?.bytes.byteLength).not.toBe(before?.bytes.byteLength);
    expect(await listObjects('skins', id)).toHaveLength(2); // texture + one bust, no second object
  });

  it('T-ACT-56 the real renderer is deterministic: the same texture twice → byte-identical bust', async () => {
    const id = await makeSkin();
    await renderSkinBust(id);
    const first = await downloadBust(id);
    await renderSkinBust(id);
    const second = await downloadBust(id);
    expect(Buffer.from(second?.bytes ?? []).equals(Buffer.from(first?.bytes ?? []))).toBe(true);
  });

  it('T-ACT-56 the injected service client is what the job uses (deps.db)', async () => {
    const id = await makeSkin();
    const result = await renderSkinBust(id, { db: service });
    expect(result.ok).toBe(true);
    expect(await bustColumn(id)).toBe(`skins/${id}/bust.png`);
  });

  it('T-ACT-56 a rejecting renderer → {ok:false}, column untouched, ONE log.error line (keys only), nothing thrown', async () => {
    // A row that already carries a bust path proves "untouched" (not just "still null").
    const id = randomUUID();
    await makeSkin({ id, render_bust_path: `skins/${id}/bust.png` });
    const before = await bustColumn(id);
    expect(before).toBe(`skins/${id}/bust.png`);
    const objectsBefore = await listObjects('skins', id);

    const result = await renderSkinBust(id, {
      render: () => Promise.reject(new RenderError('internal', 'Could not encode the bust.')),
    });
    expect(result).toEqual({ ok: false, error: 'render failed' });
    expect(await bustColumn(id)).toBe(before);
    expect(await listObjects('skins', id)).toEqual(objectsBefore);

    const lines = jobLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      job: 'renderSkinBust',
      id,
      msg: 'bust_render_failed',
    });
    expect(lines[0]?.meta).toMatchObject({ step: 'render', name: 'RenderError', code: 'internal' });
    expect(typeof lines[0]?.meta?.ms).toBe('number');
    // Keys only — no path, no bytes, no message text.
    expect(JSON.stringify(lines)).not.toContain('bust.png');
    expect(JSON.stringify(lines)).not.toContain('Could not encode');
  });

  it('T-ACT-56 a non-Error rejection is logged by its type and still answers {ok:false}', async () => {
    const id = await makeSkin();
    const result = await renderSkinBust(id, { render: () => Promise.reject('boom') });
    expect(result).toEqual({ ok: false, error: 'render failed' });
    expect(jobLines()[0]?.meta).toMatchObject({ step: 'render', name: 'StepError', code: null });
  });

  it('T-ACT-56 a 1 ms budget → {ok:false, error:"timeout"} before the first write; nothing rendered', async () => {
    const id = await makeSkin();
    let called = false;
    const result = await renderSkinBust(id, {
      render: () => {
        called = true;
        return tinyPng();
      },
      timeoutMs: 1,
    });
    expect(result).toEqual({ ok: false, error: 'timeout' });
    expect(jobLines()[0]?.meta).toMatchObject({ step: 'timeout', name: 'Timeout' });
    // The read outlived the budget: the job stopped at the next checkpoint, never rendered.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(called).toBe(false);
    expect(await bustColumn(id)).toBeNull();
    expect(await downloadBust(id)).toBeNull();
  });

  it('T-ACT-56 the budget runs out DURING a slow render → timeout, and the late render never writes', async () => {
    const id = await makeSkin();
    let rendered = false;
    const slow = async (): Promise<Buffer> => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      rendered = true;
      return tinyPng();
    };
    // 400 ms is far past the local read + download (~tens of ms) and far short of the render.
    const result = await renderSkinBust(id, { render: slow, timeoutMs: 400 });
    expect(result).toEqual({ ok: false, error: 'timeout' });

    // Let the slow render finish: it must stop before its upload / update.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(rendered).toBe(true);
    expect(await bustColumn(id)).toBeNull();
    expect(await downloadBust(id)).toBeNull();
  });

  it('T-ACT-56 an unknown skin id → {ok:false}, one log line, no object', async () => {
    const id = '00000000-0000-4000-8000-0000000000ee';
    const result = await renderSkinBust(id);
    expect(result).toEqual({ ok: false, error: 'read failed' });
    expect(jobLines()).toHaveLength(1);
    expect(jobLines()[0]?.meta).toMatchObject({ step: 'read' });
    expect(await downloadBust(id)).toBeNull();
  });

  it('T-ACT-56 a row whose texture object is missing → {ok:false} at the download step, column untouched', async () => {
    const id = await makeSkin({ fixture: null });
    const result = await renderSkinBust(id);
    expect(result).toEqual({ ok: false, error: 'download failed' });
    expect(await bustColumn(id)).toBeNull();
    expect(jobLines()[0]?.meta).toMatchObject({ step: 'download' });
  });

  it('T-ACT-56 the clock dep drives the ms in the log line', async () => {
    const id = await makeSkin();
    let ticks = 1_000;
    const now = (): number => {
      ticks += 250;
      return ticks;
    };
    await renderSkinBust(id, { render: () => Promise.reject(new Error('x')), now });
    expect(jobLines()[0]?.meta?.ms).toBe(250);
  });
});
