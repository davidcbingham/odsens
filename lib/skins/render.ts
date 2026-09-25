/**
 * lib/skins/render.ts — `renderBustPng`: a skin texture → the cached 600×800 bust PNG (S1.7; 04 §3.8
 * `renderSkinBust`; 00 §S1.7 AC3/AC11; docs/data-model.md §3 "512 KB bust" / §5 "Skin renders";
 * ADR-0047).
 *
 * A pure TypeScript software rasterizer — no `gl`, no DOM, no skinview3d: `gl` has no Node 24
 * prebuilt and needs X11 + Mesa at runtime, which a Vercel function does not have (ADR-0047).
 * `sharp` is the only dependency, used for exactly three things: decoding the texture to raw RGBA,
 * the 2× → 1× lanczos3 downscale, and the PNG encode. Everything between is plain arithmetic over
 * typed arrays, so the same texture + model always yields the byte-identical PNG (the job and the
 * bulk script rely on that: re-rendering is a no-op upload).
 *
 * Plain module — no `server-only` (it has no browser importer and `scripts/render-skins.mjs`
 * loads it under plain Node through `scripts/lib/ts-loader.mjs`, ADR-0048 D11), no `next/*`,
 * no `@/lib/env`. `lib/jobs/renderSkinBust.ts` is the app importer.
 *
 * Pipeline
 *   1. validate: PNG magic + `sharp(...).ensureAlpha().raw()` decodes to exactly 64×64 → else
 *      `RenderError('validation')` (the actions already refused it with "Skins need to be 64×64.";
 *      this is the fail-closed twin for the bulk script).
 *   2. geometry: `buildModel` (lib/skins/model.ts) — head, body, arms (classic 4 / slim 3 wide),
 *      legs; base boxes + inflated overlay boxes. A texture with no transparent texel in its top
 *      half is a legacy opaque skin: its overlay regions are junk, so the overlay layer is dropped
 *      (the rule skinview-utils' `fixOpaqueSkin` applies — the viewer and the bust then agree).
 *   3. camera: perspective, vertical FOV 40°, aspect = width/height (3:4), the model yawed so the
 *      front faces the viewer turned 25° with the player's LEFT side (+x) showing on the viewer's
 *      right, the camera pitched 10° down. Framing (`FRAMING`): top of the hat ≈ 8 % below the top
 *      edge, the belt (y = 12) just under the bottom edge, arms inside the frame with a margin.
 *   4. raster at `supersample`× (default 2 → 1200×1600): z-buffer, perspective-correct
 *      nearest-neighbour texels, flat per-face shading (front 1 · top 1.12 · sides 0.82 · back 0.68
 *      · bottom 0.55, clamped to 255). Base texels are opaque (alpha ignored, like skinview3d's
 *      inner layer); overlay texels with alpha < 128 are skipped and overlay faces are double-sided,
 *      so a hat with holes shows its own inside. Background stays fully transparent.
 *   5. `sharp` `resize(width, height, { kernel: 'lanczos3' })` → `png({ compressionLevel: 9 })`;
 *      if the result is still > `BUST_MAX_BYTES` (never for a 64×64 source, kept as the guard the
 *      bucket limit demands) re-encode with `palette: true`.
 *
 * Exports: `renderBustPng`, `RenderError`, `BUST_WIDTH` / `BUST_HEIGHT` / `BUST_MAX_BYTES`, and the
 * pure pieces `tests/unit/skins-render.test.ts` pins (`makeCamera`, `projectPoint`, `rasterize`,
 * `hasTransparency`, `FRAMING`).
 */
import sharp from 'sharp';
import { buildModel, type BodyModel, type Face, type Vec3 } from '@/lib/skins/model';

export const BUST_WIDTH = 600;
export const BUST_HEIGHT = 800;
/** docs/data-model.md §3: the `skins` bucket caps objects at 512 KB (the texture is ≤ 64 KB). */
export const BUST_MAX_BYTES = 524_288;

/** The texture side the model expects (64×64 modern layout; 64×32 legacy is refused upstream too). */
export const TEXTURE_SIZE = 64;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Alpha below this is "not there" on the overlay layer (skinview3d's alphaTest ≈ 0.5). */
const OVERLAY_ALPHA_CUTOFF = 128;

/**
 * Depth-test tolerance on 1/w. Two faces in the SAME plane interpolate 1/w within ~1e-12 of each
 * other, while the closest genuinely distinct planes (an overlay 0.25 above its base at ~40 units)
 * differ by ~1.5e-4 — so within this band the first-drawn face keeps the pixel. That makes the
 * coplanar overlaps in the vanilla model deterministic instead of speckled: the jacket front and
 * the sleeve fronts share z = 2.25 across the 0.5-wide shoulder strips, and the two pants overlays
 * share their fronts across x ∈ [−0.25, 0.25]. `buildModel` emits body before arms and the right
 * leg before the left, so the jacket and the right pants win.
 */
const DEPTH_EPSILON = 1e-7;

export type RenderErrorCode = 'validation' | 'internal';

/** `validation` — the bytes are not a 64×64 PNG (or the options are out of range); `internal` — sharp failed. */
export class RenderError extends Error {
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RenderError';
    this.code = code;
  }
}

export type RenderOptions = {
  /** Output width in px (default `BUST_WIDTH`). */
  width?: number;
  /** Output height in px (default `BUST_HEIGHT`). */
  height?: number;
  /** Raster scale before the downscale, 1..4 (default 2). */
  supersample?: number;
};

/**
 * Where the model sits in the frame. `distance` is the camera-to-target length in model units
 * (the model is ~32 tall); `targetY` the height the camera looks at. The numbers were tuned on the
 * brand skins so a 3:4 image shows the hat top ~8 % down, both arms with a margin and the belt
 * line just under the bottom edge.
 */
export const FRAMING = {
  fovDeg: 40,
  yawDeg: -25,
  pitchDeg: 10,
  distance: 38,
  targetY: 22,
} as const;

export type Camera = {
  readonly width: number;
  readonly height: number;
  /** cos / sin of the model yaw. */
  readonly cy: number;
  readonly sy: number;
  /** cos / sin of the camera pitch. */
  readonly cp: number;
  readonly sp: number;
  readonly distance: number;
  readonly targetY: number;
  /** tan(fov / 2). */
  readonly tanHalf: number;
  readonly aspect: number;
};

export type Projected = {
  /** Screen x/y in px (0,0 = top-left). */
  readonly x: number;
  readonly y: number;
  /** View depth — distance along the camera axis, positive in front of the camera. */
  readonly w: number;
};

/** A camera for a `width`×`height` raster with the `FRAMING` constants. */
export function makeCamera(width: number, height: number, framing = FRAMING): Camera {
  const yaw = (framing.yawDeg * Math.PI) / 180;
  const pitch = (framing.pitchDeg * Math.PI) / 180;
  return {
    width,
    height,
    cy: Math.cos(yaw),
    sy: Math.sin(yaw),
    cp: Math.cos(pitch),
    sp: Math.sin(pitch),
    distance: framing.distance,
    targetY: framing.targetY,
    tanHalf: Math.tan(((framing.fovDeg / 2) * Math.PI) / 180),
    aspect: width / height,
  };
}

/**
 * Model point → screen. Yaw about y (x' = x·cos + z·sin, z' = −x·sin + z·cos), then a look-at
 * camera sitting `distance` from (0, targetY, 0) on the pitched axis; perspective divide by the view
 * depth. Points behind the camera (`w <= 0`) never occur with this framing.
 */
export function projectPoint(cam: Camera, p: Vec3): Projected {
  const [x, y, z] = p;
  const rx = x * cam.cy + z * cam.sy;
  const rz = -x * cam.sy + z * cam.cy;
  const dy = y - cam.targetY;
  const vx = rx;
  const vy = dy * cam.cp - rz * cam.sp;
  const w = cam.distance - dy * cam.sp - rz * cam.cp;
  const nx = vx / (w * cam.tanHalf * cam.aspect);
  const ny = vy / (w * cam.tanHalf);
  return { x: ((nx + 1) / 2) * cam.width, y: ((1 - ny) / 2) * cam.height, w };
}

/** True when any texel in the top half (rows 0..31) is not fully opaque — a modern skin. */
export function hasTransparency(rgba: Uint8Array, size = TEXTURE_SIZE): boolean {
  const end = size * (size / 2) * 4;
  for (let i = 3; i < end; i += 4) if ((rgba[i] ?? 255) < 255) return true;
  return false;
}

/** One projected corner with the perspective-correct attributes the raster interpolates. */
type Vertex = { x: number; y: number; iw: number; uw: number; vw: number };

/**
 * Draw `faces` over a fresh `width`×`height` RGBA buffer (transparent background) sampling the
 * 64×64 `texture` (RGBA, row-major). Pure: same inputs → same bytes.
 */
export function rasterize(
  faces: readonly Face[],
  texture: Uint8Array,
  width: number,
  height: number,
  cam: Camera = makeCamera(width, height),
): Uint8Array {
  const color = new Uint8Array(width * height * 4);
  // Stores 1/w — larger is closer; 0 = empty.
  const depth = new Float32Array(width * height);

  for (const face of faces) {
    const { u0, v0, u1, v1 } = face.uv;
    const uvs: readonly [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    const verts: Vertex[] = face.corners.map((corner, i) => {
      const p = projectPoint(cam, corner);
      const iw = 1 / p.w;
      const uv = uvs[i] ?? [u0, v0];
      return { x: p.x, y: p.y, iw, uw: uv[0] * iw, vw: uv[1] * iw };
    });
    const [a, b, c, d] = verts as [Vertex, Vertex, Vertex, Vertex];
    // Screen-space winding of the quad: corners run clockwise as seen from outside, so a
    // front-facing quad has a positive signed area in the y-down screen frame.
    const area = edge(a, b, c) + edge(a, c, d);
    if (area === 0) continue;
    if (area < 0 && face.layer === 'base') continue; // back-face cull: opaque boxes only
    const alphaTest = face.layer === 'overlay';
    drawTriangle(a, b, c, face, texture, color, depth, width, height, alphaTest);
    drawTriangle(a, c, d, face, texture, color, depth, width, height, alphaTest);
  }
  return color;
}

/** Twice the signed area of (p, q, r) in screen space. */
function edge(p: Vertex, q: Vertex, r: { x: number; y: number }): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

function drawTriangle(
  a: Vertex,
  b: Vertex,
  c: Vertex,
  face: Face,
  texture: Uint8Array,
  color: Uint8Array,
  depth: Float32Array,
  width: number,
  height: number,
  alphaTest: boolean,
): void {
  const area = edge(a, b, c);
  if (area === 0) return;
  const sign = area > 0 ? 1 : -1;
  const invArea = 1 / area;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  if (minX > maxX || minY > maxY) return;
  const { u0, v0, u1, v1 } = face.uv;
  const shade = face.shade;
  const sample = { x: 0, y: 0 };

  for (let py = minY; py <= maxY; py++) {
    sample.y = py + 0.5;
    for (let px = minX; px <= maxX; px++) {
      sample.x = px + 0.5;
      const w0 = edge(b, c, sample) * sign;
      const w1 = edge(c, a, sample) * sign;
      const w2 = edge(a, b, sample) * sign;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const b0 = w0 * invArea * sign;
      const b1 = w1 * invArea * sign;
      const b2 = w2 * invArea * sign;
      const iw = b0 * a.iw + b1 * b.iw + b2 * c.iw;
      const idx = py * width + px;
      if (iw <= (depth[idx] ?? 0) + DEPTH_EPSILON) continue;
      const u = (b0 * a.uw + b1 * b.uw + b2 * c.uw) / iw;
      const v = (b0 * a.vw + b1 * b.vw + b2 * c.vw) / iw;
      const tu = clampInt(Math.floor(u), u0, u1 - 1);
      const tv = clampInt(Math.floor(v), v0, v1 - 1);
      const t = (tv * TEXTURE_SIZE + tu) * 4;
      const alpha = texture[t + 3] ?? 0;
      if (alphaTest && alpha < OVERLAY_ALPHA_CUTOFF) continue;
      depth[idx] = iw;
      const o = idx * 4;
      color[o] = Math.min(255, Math.round((texture[t] ?? 0) * shade));
      color[o + 1] = Math.min(255, Math.round((texture[t + 1] ?? 0) * shade));
      color[o + 2] = Math.min(255, Math.round((texture[t + 2] ?? 0) * shade));
      color[o + 3] = 255;
    }
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((byte, i) => bytes[i] === byte);
}

/** Decode a 64×64 PNG to raw RGBA (`validation` on anything else). */
async function decodeTexture(texture: Uint8Array): Promise<Uint8Array> {
  if (!isPng(texture)) throw new RenderError('validation', 'Skin textures must be a PNG.');
  let data: Buffer;
  let width: number;
  let height: number;
  try {
    const decoded = await sharp(Buffer.from(texture.buffer, texture.byteOffset, texture.byteLength))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = decoded.data;
    width = decoded.info.width;
    height = decoded.info.height;
  } catch (cause) {
    throw new RenderError('validation', 'Skin textures must be a readable PNG.', { cause });
  }
  if (width !== TEXTURE_SIZE || height !== TEXTURE_SIZE) {
    throw new RenderError('validation', `Skins need to be 64×64 (got ${width}×${height}).`);
  }
  if (data.length !== TEXTURE_SIZE * TEXTURE_SIZE * 4) {
    throw new RenderError('internal', 'Decoded texture has an unexpected channel layout.');
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function positiveInt(
  value: number | undefined,
  fallback: number,
  max: number,
  name: string,
): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new RenderError('validation', `${name} must be an integer between 1 and ${max}.`);
  }
  return n;
}

/**
 * The bust PNG for a skin texture. Rejects with `RenderError('validation')` on a texture that is not
 * a 64×64 PNG and `RenderError('internal')` when sharp cannot resize/encode. Deterministic.
 */
export async function renderBustPng(
  texture: Uint8Array,
  model: BodyModel,
  options: RenderOptions = {},
): Promise<Buffer> {
  const width = positiveInt(options.width, BUST_WIDTH, 4096, 'width');
  const height = positiveInt(options.height, BUST_HEIGHT, 4096, 'height');
  const supersample = positiveInt(options.supersample, 2, 4, 'supersample');
  if (model !== 'classic' && model !== 'slim') {
    throw new RenderError('validation', `Unknown model "${String(model)}".`);
  }
  const rgba = await decodeTexture(texture);
  const faces = buildModel(model, hasTransparency(rgba));
  const rasterWidth = width * supersample;
  const rasterHeight = height * supersample;
  const pixels = rasterize(faces, rgba, rasterWidth, rasterHeight);

  try {
    const image = sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
      raw: { width: rasterWidth, height: rasterHeight, channels: 4 },
    });
    const sized =
      supersample === 1 ? image : image.resize(width, height, { kernel: 'lanczos3', fit: 'fill' });
    const png = await sized.png({ compressionLevel: 9 }).toBuffer();
    if (png.byteLength <= BUST_MAX_BYTES) return png;
    return await sharp(png).png({ compressionLevel: 9, palette: true }).toBuffer();
  } catch (cause) {
    throw new RenderError('internal', 'Could not encode the bust.', { cause });
  }
}
