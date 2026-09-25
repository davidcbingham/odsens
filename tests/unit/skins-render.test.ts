/**
 * tests/unit/skins-render.test.ts — `lib/skins/render.ts` + `lib/skins/model.ts`, the software bust
 * rasterizer behind `renderSkinBust` (S1.7; 04 §3.8; 00 §S1.7 AC3/AC11; ADR-0047). Id-less
 * helper file (ADR-R9) — the catalogue rows that exercise the renderer end-to-end are T-ACT-56 (the
 * job writes `skins/<id>/bust.png`) and T-ACT-58/59 (the actions await it); this file pins the
 * pure contract: 600×800 RGBA, transparent background, ≤ 512 KB, byte-identical on repeat, the
 * model's faces land where the framing says (synthetic textures built with sharp), overlays and
 * the slim model change the output, `RenderError('validation')` on anything but a 64×64 PNG, and
 * every brand skin in `assets/brand/skins/` renders. No DOM, no network, no clock.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  boxFaces,
  boxUvs,
  buildModel,
  FACE_SHADE,
  inflate,
  partSpecs,
  SIDES,
  box,
} from '@/lib/skins/model';
import {
  BUST_HEIGHT,
  BUST_MAX_BYTES,
  BUST_WIDTH,
  FRAMING,
  hasTransparency,
  makeCamera,
  projectPoint,
  rasterize,
  RenderError,
  renderBustPng,
  TEXTURE_SIZE,
} from '@/lib/skins/render';
import { REPO_ROOT } from '../helpers/envTest';

// A render is 60–100 ms on the build Mac but 1.4–2 s on the shared CI runner under coverage
// instrumentation: the four-render determinism case hit vitest's 5 s default there (5.7 s, PR #35
// round 1). The elapsed-time contract stays the per-render bound asserted below, not this ceiling.
vi.setConfig({ testTimeout: 30_000 });

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'images', name)));

const BRAND_SKINS_DIR = path.join(REPO_ROOT, 'assets', 'brand', 'skins');

type Rgba = { r: number; g: number; b: number; alpha: number };
type Patch = { left: number; top: number; width: number; height: number; color: Rgba };

const RED: Rgba = { r: 255, g: 0, b: 0, alpha: 1 };
const GREEN: Rgba = { r: 0, g: 255, b: 0, alpha: 1 };
const BLUE: Rgba = { r: 0, g: 0, b: 255, alpha: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, alpha: 1 };
const GREY: Rgba = { r: 128, g: 128, b: 128, alpha: 1 };
const CLEAR: Rgba = { r: 0, g: 0, b: 0, alpha: 0 };

/** A 64×64 PNG: `background` everywhere, then each patch written over it (texel rectangles, no blending). */
async function texture(background: Rgba, patches: readonly Patch[]): Promise<Uint8Array> {
  const raw = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const paint = (x: number, y: number, c: Rgba) => {
    const o = (y * TEXTURE_SIZE + x) * 4;
    raw[o] = c.r;
    raw[o + 1] = c.g;
    raw[o + 2] = c.b;
    raw[o + 3] = Math.round(c.alpha * 255);
  };
  for (let y = 0; y < TEXTURE_SIZE; y++)
    for (let x = 0; x < TEXTURE_SIZE; x++) paint(x, y, background);
  for (const p of patches) {
    for (let y = p.top; y < p.top + p.height; y++) {
      for (let x = p.left; x < p.left + p.width; x++) paint(x, y, p.color);
    }
  }
  const png = await sharp(Buffer.from(raw), {
    raw: { width: TEXTURE_SIZE, height: TEXTURE_SIZE, channels: 4 },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Head front (8,8)-(16,16) red · body front (20,20)-(28,32) blue · right arm front (44,20)-(48,32) green. */
const PAINTED_FACES: readonly Patch[] = [
  { left: 8, top: 8, width: 8, height: 8, color: RED },
  { left: 20, top: 20, width: 8, height: 12, color: BLUE },
  { left: 44, top: 20, width: 4, height: 12, color: GREEN },
];

type Decoded = { data: Buffer; width: number; height: number; channels: number };

async function decode(png: Buffer): Promise<Decoded> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function pixel(img: Decoded, x: number, y: number): [number, number, number, number] {
  const o = (y * img.width + x) * img.channels;
  return [img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0, img.data[o + 3] ?? 0];
}

type Stats = {
  count: number;
  cx: number;
  cy: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Centroid + bounds of the pixels `match` accepts. */
function where(img: Decoded, match: (p: [number, number, number, number]) => boolean): Stats {
  let count = 0;
  let sx = 0;
  let sy = 0;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!match(pixel(img, x, y))) continue;
      count++;
      sx += x;
      sy += y;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return { count, cx: sx / count, cy: sy / count, top, bottom, left, right };
}

const isRed = ([r, g, b, a]: [number, number, number, number]) =>
  r > 180 && g < 60 && b < 60 && a > 250;
const isGreen = ([r, g, b, a]: [number, number, number, number]) =>
  g > 180 && r < 60 && b < 60 && a > 250;
const isBlue = ([r, g, b, a]: [number, number, number, number]) =>
  b > 180 && r < 60 && g < 60 && a > 250;

async function expectValidationError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(RenderError);
  await expect(promise).rejects.toMatchObject({ code: 'validation' });
}

describe('lib/skins/model — geometry', () => {
  it('unwraps a box into the six standard UV rectangles', () => {
    const head = boxUvs(0, 0, 8, 8, 8);
    expect(head.top).toEqual({ u0: 8, v0: 0, u1: 16, v1: 8 });
    expect(head.bottom).toEqual({ u0: 16, v0: 0, u1: 24, v1: 8 });
    expect(head.right).toEqual({ u0: 0, v0: 8, u1: 8, v1: 16 });
    expect(head.front).toEqual({ u0: 8, v0: 8, u1: 16, v1: 16 });
    expect(head.left).toEqual({ u0: 16, v0: 8, u1: 24, v1: 16 });
    expect(head.back).toEqual({ u0: 24, v0: 8, u1: 32, v1: 16 });
    // Slim arm: the rectangle narrows with the box (3 wide), the depth stays 4.
    const slimArm = boxUvs(40, 16, 3, 12, 4);
    expect(slimArm.front).toEqual({ u0: 44, v0: 20, u1: 47, v1: 32 });
    expect(slimArm.back).toEqual({ u0: 51, v0: 20, u1: 54, v1: 32 });
  });

  it('builds 72 faces (6 parts × 2 layers × 6 sides), base layer first, overlays optional', () => {
    const faces = buildModel('classic');
    expect(faces).toHaveLength(72);
    expect(faces.slice(0, 36).every((f) => f.layer === 'base')).toBe(true);
    expect(faces.slice(36).every((f) => f.layer === 'overlay')).toBe(true);
    expect(buildModel('classic', false)).toHaveLength(36);
    expect(faces.map((f) => f.side).slice(0, 6)).toEqual(SIDES);
    for (const f of faces) expect(f.shade).toBe(FACE_SHADE[f.side]);
  });

  it('emits the parts in the order the coplanar tie-break relies on (ADR-0047 D5): body before the arms, right leg before left', () => {
    const order = [...new Set(buildModel('classic').map((f) => f.part))];
    expect(order).toEqual(['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']);
  });

  it('narrows both arms to 3 for the slim model and keeps them 4 for classic', () => {
    const classic = Object.fromEntries(partSpecs('classic').map((s) => [s.part, s.box]));
    const slim = Object.fromEntries(partSpecs('slim').map((s) => [s.part, s.box]));
    expect(classic['rightArm']).toMatchObject({ x0: -8, x1: -4 });
    expect(classic['leftArm']).toMatchObject({ x0: 4, x1: 8 });
    expect(slim['rightArm']).toMatchObject({ x0: -7, x1: -4 });
    expect(slim['leftArm']).toMatchObject({ x0: 4, x1: 7 });
    expect(slim['head']).toEqual(classic['head']);
  });

  it('inflates overlays but keeps the base box for the UV widths', () => {
    const b = box(-4, 4, 24, 32, -4, 4);
    expect(inflate(b, 0.5)).toEqual({ x0: -4.5, x1: 4.5, y0: 23.5, y1: 32.5, z0: -4.5, z1: 4.5 });
    const hat = boxFaces('head', 'overlay', inflate(b, 0.5), [32, 0], b);
    const front = hat.find((f) => f.side === 'front');
    expect(front?.uv).toEqual({ u0: 40, v0: 8, u1: 48, v1: 16 });
    expect(front?.corners[0]).toEqual([-4.5, 32.5, 4.5]);
    expect(front?.corners[2]).toEqual([4.5, 23.5, 4.5]);
  });
});

describe('lib/skins/render — camera + raster helpers', () => {
  it('projects the look-at target to the image centre and +x to the right', () => {
    const cam = makeCamera(600, 800);
    const centre = projectPoint(cam, [0, FRAMING.targetY, 0]);
    expect(centre.x).toBeCloseTo(300, 6);
    expect(centre.y).toBeCloseTo(400, 6);
    expect(centre.w).toBeCloseTo(FRAMING.distance, 6);
    const right = projectPoint(cam, [4, FRAMING.targetY, 0]);
    expect(right.x).toBeGreaterThan(300);
    const up = projectPoint(cam, [0, FRAMING.targetY + 4, 0]);
    expect(up.y).toBeLessThan(400);
  });

  it('frames the bust: hat top ≈ 8 % down, belt just under the bottom edge, arms inside', () => {
    const cam = makeCamera(BUST_WIDTH, BUST_HEIGHT);
    const faces = buildModel('classic');
    const ys = (part: string, layer: string) =>
      faces
        .filter((f) => f.part === part && f.layer === layer)
        .flatMap((f) => f.corners)
        .map((c) => projectPoint(cam, c));
    const hatTop = Math.min(...ys('head', 'overlay').map((p) => p.y)) / BUST_HEIGHT;
    expect(hatTop).toBeGreaterThan(0.05);
    expect(hatTop).toBeLessThan(0.11);
    const beltFront = Math.max(
      ...faces
        .filter((f) => f.part === 'body' && f.layer === 'base' && f.side === 'front')
        .flatMap((f) => f.corners)
        .map((c) => projectPoint(cam, c).y),
    );
    expect(beltFront / BUST_HEIGHT).toBeGreaterThan(0.85);
    expect(beltFront / BUST_HEIGHT).toBeLessThanOrEqual(1);
    const arms = [...ys('rightArm', 'overlay'), ...ys('leftArm', 'overlay')].map((p) => p.x);
    expect(Math.min(...arms)).toBeGreaterThan(0);
    expect(Math.max(...arms)).toBeLessThan(BUST_WIDTH);
  });

  it('hasTransparency looks at the top half only', () => {
    const opaque = new Uint8Array(64 * 64 * 4).fill(255);
    expect(hasTransparency(opaque)).toBe(false);
    const topHole = opaque.slice();
    topHole[(5 * 64 + 40) * 4 + 3] = 254;
    expect(hasTransparency(topHole)).toBe(true);
    const bottomHole = opaque.slice();
    bottomHole[(40 * 64 + 5) * 4 + 3] = 0;
    expect(hasTransparency(bottomHole)).toBe(false);
  });

  it('rasterize leaves the background transparent and paints opaque, shaded texels', () => {
    const tex = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < tex.length; i += 4) {
      tex[i] = 200;
      tex[i + 1] = 100;
      tex[i + 2] = 50;
      tex[i + 3] = 255;
    }
    const w = 60;
    const h = 80;
    const out = rasterize(buildModel('classic', false), tex, w, h);
    expect(out).toHaveLength(w * h * 4);
    expect(out[3]).toBe(0); // top-left corner: nothing drawn
    const centre = ((h / 2) * w + w / 2) * 4;
    expect(out[centre + 3]).toBe(255);
    // Every painted pixel is a texel colour times one of the face shades.
    const shades = new Set(
      Object.values(FACE_SHADE).map((s) => Math.min(255, Math.round(100 * s))),
    );
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] === 0) continue;
      expect(shades.has(out[i + 1] ?? -1)).toBe(true);
    }
  });
});

describe('renderBustPng — output contract', () => {
  it('yields a 600×800 RGBA PNG ≤ 512 KB with transparent corners, byte-identical on repeat', async () => {
    const tex = await texture(CLEAR, PAINTED_FACES);
    const first = await renderBustPng(tex, 'classic');
    const second = await renderBustPng(tex, 'classic');
    expect(first.equals(second)).toBe(true);
    expect(first.byteLength).toBeLessThanOrEqual(BUST_MAX_BYTES);
    expect(first.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const img = await decode(first);
    expect([img.width, img.height, img.channels]).toEqual([BUST_WIDTH, BUST_HEIGHT, 4]);
    for (const [x, y] of [
      [0, 0],
      [BUST_WIDTH - 1, 0],
      [0, BUST_HEIGHT - 1],
      [BUST_WIDTH - 1, BUST_HEIGHT - 1],
    ] as const) {
      expect(pixel(img, x, y)[3]).toBe(0);
    }
  });

  it('puts the head front in the upper third, the body front in the lower half, the right arm on the viewer’s left', async () => {
    const img = await decode(await renderBustPng(await texture(CLEAR, PAINTED_FACES), 'classic'));
    const red = where(img, isRed);
    const blue = where(img, isBlue);
    const green = where(img, isGreen);
    expect(red.count).toBeGreaterThan(5_000);
    expect(blue.count).toBeGreaterThan(5_000);
    expect(green.count).toBeGreaterThan(1_000);
    // Head front: centroid in the upper third, top edge ≈ 8–15 % down, nothing below 55 %.
    expect(red.cy).toBeLessThan(BUST_HEIGHT / 3);
    expect(red.top / BUST_HEIGHT).toBeGreaterThan(0.06);
    expect(red.top / BUST_HEIGHT).toBeLessThan(0.16);
    expect(red.bottom / BUST_HEIGHT).toBeLessThan(0.55);
    // Body front: centroid in the lower half, nothing above 30 %.
    expect(blue.cy).toBeGreaterThan(BUST_HEIGHT / 2);
    expect(blue.top / BUST_HEIGHT).toBeGreaterThan(0.3);
    // The model is yawed to show its LEFT side, so the player's RIGHT arm (−x) sits on the viewer's left.
    expect(green.cx).toBeLessThan(BUST_WIDTH / 2);
    expect(green.right).toBeLessThan(blue.left + 10);
    // Head front wider than tall on screen? No — 8×8 turned 25°: width ≈ 7.25 units vs height 8.
    expect(red.right - red.left).toBeGreaterThan(0.3 * BUST_WIDTH);
  });

  it('renders slim and classic differently', async () => {
    const tex = await texture(GREY, [{ left: 0, top: 0, width: 64, height: 16, color: CLEAR }]);
    const classic = await renderBustPng(tex, 'classic');
    const slim = await renderBustPng(tex, 'slim');
    expect(classic.equals(slim)).toBe(false);
  });

  it('draws the hat overlay: painting one hat texel changes the output', async () => {
    const base = await texture(GREY, [
      { left: 32, top: 0, width: 32, height: 16, color: CLEAR }, // no hat
    ]);
    const hatted = await texture(GREY, [
      { left: 32, top: 0, width: 32, height: 16, color: CLEAR },
      { left: 44, top: 8, width: 1, height: 1, color: WHITE }, // one texel on the hat front
    ]);
    const a = await renderBustPng(base, 'classic');
    const b = await renderBustPng(hatted, 'classic');
    expect(a.equals(b)).toBe(false);
    // …and a below-cutoff alpha texel is skipped like a hole.
    const faint = await texture(GREY, [
      { left: 32, top: 0, width: 32, height: 16, color: CLEAR },
      { left: 44, top: 8, width: 1, height: 1, color: { r: 255, g: 255, b: 255, alpha: 0.2 } },
    ]);
    expect((await renderBustPng(faint, 'classic')).equals(a)).toBe(true);
  });

  it('treats a fully opaque legacy texture as having no overlays', async () => {
    // Opaque everywhere, hat region white: the white must NOT box the head in.
    const opaque = await texture(GREY, [{ left: 32, top: 0, width: 32, height: 16, color: WHITE }]);
    // The same skin with the overlay regions cleared renders identically.
    const cleared = await texture(GREY, [
      { left: 32, top: 0, width: 32, height: 16, color: CLEAR },
      { left: 0, top: 32, width: 64, height: 16, color: CLEAR },
      { left: 48, top: 48, width: 16, height: 16, color: CLEAR },
      { left: 0, top: 48, width: 16, height: 16, color: CLEAR },
    ]);
    const a = await renderBustPng(opaque, 'classic');
    const b = await renderBustPng(cleared, 'classic');
    expect(a.equals(b)).toBe(true);
    const img = await decode(a);
    const white = where(img, ([r, g, bl, al]) => r > 240 && g > 240 && bl > 240 && al > 250);
    expect(white.count).toBe(0);
  });

  it('honours width / height / supersample options', async () => {
    const tex = await texture(GREY, [{ left: 32, top: 0, width: 32, height: 16, color: CLEAR }]);
    const small = await decode(
      await renderBustPng(tex, 'classic', { width: 150, height: 200, supersample: 1 }),
    );
    expect([small.width, small.height, small.channels]).toEqual([150, 200, 4]);
  });
});

describe('renderBustPng — validation', () => {
  it('rejects a 64×32 legacy skin and a 128×128 HD skin with RenderError(validation)', async () => {
    await expectValidationError(renderBustPng(fixture('skin-64x32.png'), 'classic'));
    await expectValidationError(renderBustPng(fixture('skin-128.png'), 'slim'));
    await expect(renderBustPng(fixture('skin-128.png'), 'slim')).rejects.toThrow(
      'Skins need to be 64×64 (got 128×128).',
    );
  });

  it('refuses a huge PNG from its header, before decoding a pixel (ADR-0047 D3)', async () => {
    // 4096×4096 of one colour compresses to a few KB — a decompression bomb in miniature.
    const bomb = await sharp({
      create: {
        width: 4096,
        height: 4096,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const started = performance.now();
    await expect(renderBustPng(new Uint8Array(bomb), 'classic')).rejects.toThrow(
      'Skins need to be 64×64 (got 4096×4096).',
    );
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('rejects non-PNG bytes, truncated PNGs and bad options', async () => {
    await expectValidationError(renderBustPng(fixture('tiny.jpg'), 'classic'));
    await expectValidationError(renderBustPng(fixture('skin-64.png').slice(0, 40), 'classic'));
    await expectValidationError(renderBustPng(new Uint8Array(0), 'classic'));
    await expectValidationError(renderBustPng(fixture('skin-64.png'), 'giant' as never));
    await expectValidationError(renderBustPng(fixture('skin-64.png'), 'classic', { width: 0 }));
    await expectValidationError(
      renderBustPng(fixture('skin-64.png'), 'classic', { supersample: 5 }),
    );
    await expectValidationError(renderBustPng(fixture('skin-64.png'), 'classic', { height: 1.5 }));
  });

  it('RenderError carries its code and name', () => {
    const err = new RenderError('internal', 'boom', { cause: new Error('x') });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RenderError');
    expect(err.code).toBe('internal');
    expect(err.message).toBe('boom');
    expect(err.cause).toBeInstanceOf(Error);
  });
});

describe('renderBustPng — real skins', () => {
  const brand = readdirSync(BRAND_SKINS_DIR).filter((f) => f.endsWith('.png'));

  it('has brand skins to render', () => {
    expect(brand.length).toBeGreaterThan(0);
  });

  it.each(brand)('renders assets/brand/skins/%s within the contract', async (name) => {
    const bytes = new Uint8Array(readFileSync(path.join(BRAND_SKINS_DIR, name)));
    const started = performance.now();
    const png = await renderBustPng(bytes, 'classic');
    const elapsed = performance.now() - started;
    expect(png.byteLength).toBeLessThanOrEqual(BUST_MAX_BYTES);
    const img = await decode(png);
    expect([img.width, img.height, img.channels]).toEqual([BUST_WIDTH, BUST_HEIGHT, 4]);
    expect(pixel(img, 0, 0)[3]).toBe(0);
    // Something is drawn in the middle of the frame (the body front).
    expect(pixel(img, BUST_WIDTH / 2, Math.round(BUST_HEIGHT * 0.6))[3]).toBe(255);
    // < 1.5 s on the build Mac (measured 60–100 ms); the bound is loose for shared CI runners.
    expect(elapsed).toBeLessThan(5_000);
  });

  it('renders the fixture skin as both models, deterministically', async () => {
    const bytes = fixture('skin-64.png');
    const classic = await renderBustPng(bytes, 'classic');
    const slim = await renderBustPng(bytes, 'slim');
    expect(classic.equals(await renderBustPng(bytes, 'classic'))).toBe(true);
    expect(slim.equals(await renderBustPng(bytes, 'slim'))).toBe(true);
    expect(classic.equals(slim)).toBe(false);
  });
});
