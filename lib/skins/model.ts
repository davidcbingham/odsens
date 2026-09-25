/**
 * lib/skins/model.ts — the Minecraft player model as a list of textured quads (S1.7; 04 §3.8
 * `renderSkinBust`; ADR-0047 "pure TypeScript software rasterizer"; docs/data-model.md §5
 * "Skin renders").
 *
 * Plain module — no directive, no `server-only`, no `next/*`, no env: `lib/skins/render.ts` is its
 * only importer and `scripts/render-skins.mjs` loads that under plain Node through the
 * `scripts/lib/ts-loader.mjs` resolve hook (ADR-0048 D11), so nothing here may need a bundler.
 *
 * Units are texture pixels, y up, origin at the centre of the feet — the same frame skinview3d and
 * the game use, so the numbers below are the standard 64×64 layout (the S1.7 brief §4.5 pins them):
 *
 *   part        box [x0,x1]×[y0,y1]×[z0,z1]     base UV origin   overlay UV origin   overlay inflate
 *   head        [-4,4]×[24,32]×[-4,4]           (0,0)            (32,0)  hat         0.5
 *   body        [-4,4]×[12,24]×[-2,2]           (16,16)          (16,32) jacket      0.25
 *   right arm   [-8|-7,-4]×[12,24]×[-2,2]       (40,16)          (40,32) sleeve      0.25
 *   left arm    [4,8|7]×[12,24]×[-2,2]          (32,48)          (48,48) sleeve      0.25
 *   right leg   [-4,0]×[0,12]×[-2,2]            (0,16)           (0,32)  pants       0.25
 *   left leg    [0,4]×[0,12]×[-2,2]             (16,48)          (0,48)  pants       0.25
 *
 * "Right" is the PLAYER's right (−x, the arm whose sleeve sits at (40,32)); the viewer facing the
 * model sees it on the left. `slim` narrows both arms to 3 wide (the UV rectangles narrow with
 * them). Legs are part of the model even though the bust crops at the belt — the crop line then
 * falls on real geometry instead of an open box bottom.
 *
 * Each box unwraps to six UV rectangles the classic way (w, h, d = box width, height, depth;
 * (u, v) = the UV origin): top `(u+d, v)…(u+d+w, v+d)`, bottom `(u+d+w, v)…(u+2d+w, v+d)`,
 * right `(u, v+d)…(u+d, v+d+h)`, front `(u+d, v+d)…(u+d+w, v+d+h)`, left `(u+d+w, v+d)…
 * (u+2d+w, v+d+h)`, back `(u+2d+w, v+d)…(u+2d+2w, v+d+h)`. The texture reads naturally on every
 * face when looked at from outside with +y up (top and bottom: "up" = the back edge; the bottom
 * face is mirrored the way the game mirrors it) — the orientation skinview3d's `setUVs` produces.
 *
 * Every function is pure; the face list is rebuilt per call and never mutated.
 */

/** Which arm width to build (mirrors `SkinModel` in `lib/skins.ts` without importing it). */
export type BodyModel = 'classic' | 'slim';

/** Base layer (opaque) or the alpha-tested, double-sided overlay layer. */
export type Layer = 'base' | 'overlay';

export type Side = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export type PartName = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';

export type Vec3 = readonly [number, number, number];

/** An axis-aligned box in model units. */
export type Box = {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
};

/** A texel rectangle, `u1`/`v1` exclusive, in 64×64 texture pixels. */
export type UvRect = {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
};

/**
 * One textured quad. `corners` are top-left, top-right, bottom-right, bottom-left AS SEEN FROM
 * OUTSIDE the box, and map to the UV rectangle's (u0,v0), (u1,v0), (u1,v1), (u0,v1).
 */
export type Face = {
  readonly part: PartName;
  readonly side: Side;
  readonly layer: Layer;
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
  readonly uv: UvRect;
  /** Flat shading multiplier applied to the texel RGB (front 1 · top 1.12 · sides 0.82 · back 0.68 · bottom 0.55). */
  readonly shade: number;
};

/** Flat per-face light — one multiplier per side (brief §4.5). */
export const FACE_SHADE: Readonly<Record<Side, number>> = {
  front: 1,
  top: 1.12,
  left: 0.82,
  right: 0.82,
  back: 0.68,
  bottom: 0.55,
};

/** Six sides in the order they are emitted. */
export const SIDES: readonly Side[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

type PartSpec = {
  readonly part: PartName;
  readonly box: Box;
  readonly uv: readonly [number, number];
  readonly overlayUv: readonly [number, number];
  readonly inflate: number;
};

/** The six parts for a model; only the arm boxes depend on it. */
export function partSpecs(model: BodyModel): readonly PartSpec[] {
  const armWidth = model === 'slim' ? 3 : 4;
  return [
    { part: 'head', box: box(-4, 4, 24, 32, -4, 4), uv: [0, 0], overlayUv: [32, 0], inflate: 0.5 },
    {
      part: 'body',
      box: box(-4, 4, 12, 24, -2, 2),
      uv: [16, 16],
      overlayUv: [16, 32],
      inflate: 0.25,
    },
    {
      part: 'rightArm',
      box: box(-4 - armWidth, -4, 12, 24, -2, 2),
      uv: [40, 16],
      overlayUv: [40, 32],
      inflate: 0.25,
    },
    {
      part: 'leftArm',
      box: box(4, 4 + armWidth, 12, 24, -2, 2),
      uv: [32, 48],
      overlayUv: [48, 48],
      inflate: 0.25,
    },
    {
      part: 'rightLeg',
      box: box(-4, 0, 0, 12, -2, 2),
      uv: [0, 16],
      overlayUv: [0, 32],
      inflate: 0.25,
    },
    {
      part: 'leftLeg',
      box: box(0, 4, 0, 12, -2, 2),
      uv: [16, 48],
      overlayUv: [0, 48],
      inflate: 0.25,
    },
  ];
}

export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box {
  return { x0, x1, y0, y1, z0, z1 };
}

/** The box grown by `amount` on every side (overlay layers). */
export function inflate(b: Box, amount: number): Box {
  return {
    x0: b.x0 - amount,
    x1: b.x1 + amount,
    y0: b.y0 - amount,
    y1: b.y1 + amount,
    z0: b.z0 - amount,
    z1: b.z1 + amount,
  };
}

/** The six UV rectangles of a `w`×`h`×`d` box whose unwrap starts at (`u`, `v`). */
export function boxUvs(
  u: number,
  v: number,
  w: number,
  h: number,
  d: number,
): Record<Side, UvRect> {
  return {
    top: rect(u + d, v, u + d + w, v + d),
    bottom: rect(u + d + w, v, u + 2 * d + w, v + d),
    right: rect(u, v + d, u + d, v + d + h),
    front: rect(u + d, v + d, u + d + w, v + d + h),
    left: rect(u + d + w, v + d, u + 2 * d + w, v + d + h),
    back: rect(u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h),
  };
}

function rect(u0: number, v0: number, u1: number, v1: number): UvRect {
  return { u0, v0, u1, v1 };
}

/**
 * The six faces of one box. `uvBox` is the UN-inflated box whose integer size picks the UV
 * rectangle widths (an overlay is bigger than its texture region — the region does not grow).
 */
export function boxFaces(
  part: PartName,
  layer: Layer,
  b: Box,
  uvOrigin: readonly [number, number],
  uvBox: Box = b,
): Face[] {
  const w = uvBox.x1 - uvBox.x0;
  const h = uvBox.y1 - uvBox.y0;
  const d = uvBox.z1 - uvBox.z0;
  const uvs = boxUvs(uvOrigin[0], uvOrigin[1], w, h, d);
  const { x0, x1, y0, y1, z0, z1 } = b;
  const corners: Record<Side, [Vec3, Vec3, Vec3, Vec3]> = {
    // +z, seen from the front: left = −x.
    front: [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    // −z, seen from behind: left = +x.
    back: [
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z0],
      [x1, y0, z0],
    ],
    // +x (the player's left), seen from +x: left = the front edge.
    left: [
      [x1, y1, z1],
      [x1, y1, z0],
      [x1, y0, z0],
      [x1, y0, z1],
    ],
    // −x (the player's right), seen from −x: left = the back edge.
    right: [
      [x0, y1, z0],
      [x0, y1, z1],
      [x0, y0, z1],
      [x0, y0, z0],
    ],
    // +y, seen from above with the back edge up: left = −x.
    top: [
      [x0, y1, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    // −y, texture top row on the back edge and texture left on −x (the game's mirrored bottom).
    bottom: [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
  };
  return SIDES.map((side) => ({
    part,
    side,
    layer,
    corners: corners[side],
    uv: uvs[side],
    shade: FACE_SHADE[side],
  }));
}

/**
 * Every face of the model: 6 parts × (base + overlay) × 6 sides = 72 quads, base faces first.
 * Pass `withOverlays: false` to drop the overlay layer (a fully opaque legacy skin — see
 * `hasTransparency` in render.ts).
 */
export function buildModel(model: BodyModel, withOverlays = true): Face[] {
  const faces: Face[] = [];
  const specs = partSpecs(model);
  for (const spec of specs) faces.push(...boxFaces(spec.part, 'base', spec.box, spec.uv));
  if (withOverlays) {
    for (const spec of specs) {
      faces.push(
        ...boxFaces(
          spec.part,
          'overlay',
          inflate(spec.box, spec.inflate),
          spec.overlayUv,
          spec.box,
        ),
      );
    }
  }
  return faces;
}
