'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import { Skeleton } from '@/components/layout/Skeleton';
import type { SkinModel } from '@/lib/skins';
import { SkinViewer3DControls } from './SkinViewer3D';
import styles from './SkinViewer3D.module.css';

/**
 * SkinViewer3DCanvas — the WebGL leaf of `SkinViewer3D` (03 C-02 sub-part; 03 §2.7 row; 03 C-18 /
 * 01 INV-10: the ONLY importer of `skinview3d`, reached through the parent's `next/dynamic`
 * `ssr:false` site, never imported statically anywhere else); S1.7 D14 / D15 / D14 (ADR-0047 /
 * ADR-0048). Client island sub-part (03 C-16a, listed by path).
 *
 * Lifecycle — `data-state` on the root (03 C-12):
 *   loading      the viewer is being built and the texture fetched; Skeleton media block over the
 *                canvas, the box `aria-busy`, controls inert.
 *   ready        first frame drawn. Stage: the draw loop runs ONLY while something moves — Spin
 *                (`autoRotate`), Walk (`WalkingAnimation`) or an orbit drag (OrbitControls
 *                `start` → `end`); a still model is `renderPaused` and gets one frame on demand
 *                (texture in, Front/Back = the wrapper turned by π, a toggle switched off, a
 *                resize, a drag step). Bust: ONE frame is rendered and the viewer stays
 *                `renderPaused` (a resize draws one more). An idle viewer costs no GPU — on the
 *                software GL of headless Chromium a page of looping canvases starved the
 *                browser's lazy image loads (T-E2E-48 on `/dev/components`).
 *   unsupported  `WebGLRenderingContext` is missing, the `SkinViewer` constructor threw (no
 *                context), or the texture image failed to load (404, CORS): the bust image if
 *                there is one, else the pixelated 64×64 texture, plus "3D needs WebGL. Here's the
 *                render." The canvas is dropped; controls are not rendered.
 *
 * The viewer is created once per mount in an effect and disposed on unmount (StrictMode's double
 * mount builds and disposes one extra — `forceContextLoss` frees each GL context at once, so a
 * page of bust fallbacks never trips the browser's context cap). Prop changes reach the live
 * instance without a rebuild: `textureUrl` / `model` → `loadSkin(url, { model })` in place (the
 * Slim toggle of the parent — 03 row), `spin` / `walk` / `back` → the matching viewer fields.
 * A `ResizeObserver` on the box keeps the canvas exactly the box's size (CSS px; skinview3d
 * applies the device pixel ratio).
 *
 * Framing (ADR-0048 D14): stage = skinview3d's full-body default (camera on +z at the model's centre,
 * zoom 0.85 for a little air, fov 50); orbit drag rotates only — zoom and pan are off, the
 * polar angle is fenced so the camera never dives under the feet, and `touch-action: pan-y` keeps
 * vertical page scroll (OrbitControls would set `none`). Bust = fov 40, camera (0, 12, 40)
 * looking at (0, 7, 0) with the model yawed 25° to show its left side — head and shoulders, the
 * belt at the bottom edge — in skinview3d's units (the player object puts the head at y 8…16,
 * the belt at y −4), the same pose as the cached renders; controls disabled.
 *
 * Reduced motion (03 row): Spin starts off whatever `autoRotate` says and Walk is disabled.
 * Network (03 C-17 exception 2): skinview3d fetches `textureUrl` (an `<img>` with
 * `crossOrigin="anonymous"`), nothing else. No `lib/data`, no Supabase (01 INV-09).
 */
export type SkinViewer3DCanvasProps = {
  textureUrl: string;
  model: SkinModel;
  name: string;
  bustFallbackUrl: string | null;
  autoRotate?: boolean;
  variant: 'stage' | 'bust';
};

type ViewerState = 'loading' | 'ready' | 'unsupported';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const UNSUPPORTED_LINE = "3D needs WebGL. Here's the render.";

/** Stage: skinview3d's default pose, slightly further out than its 0.9 so the feet clear the edge. */
const STAGE_ZOOM = 0.85;
const STAGE_FOV = 50;
/** Orbit drag may tilt the view ±0.6 rad from the horizon, no further (03: "viewer not focus-trapped"; feet stay down). */
const STAGE_POLAR_RANGE = 0.6;

/** Bust: head + shoulders, belt at the bottom edge (see the header). */
const BUST_FOV = 40;
const BUST_CAMERA = { x: 0, y: 12, z: 40 } as const;
const BUST_TARGET = { x: 0, y: 7, z: 0 } as const;
const BUST_YAW = (-25 * Math.PI) / 180;

/** Fallback canvas size until the first `ResizeObserver` callback (a 3:4 box). */
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 400;

function readReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** True when the browser has WebGL at all (the constructor still may fail — caught below). */
function webglAvailable(): boolean {
  return typeof WebGLRenderingContext !== 'undefined';
}

/** `SkinViewer` for the variant, or `null` when the constructor throws (no GL context). */
function createViewer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  variant: 'stage' | 'bust',
): SkinViewer | null {
  let viewer: SkinViewer;
  try {
    viewer = new SkinViewer({
      canvas,
      width,
      height,
      pixelRatio: 'match-device',
      renderPaused: true, // nothing to draw until the texture is in
      enableControls: variant === 'stage',
      fov: variant === 'bust' ? BUST_FOV : STAGE_FOV,
      zoom: variant === 'bust' ? 1 : STAGE_ZOOM,
    });
  } catch {
    return null;
  }

  if (variant === 'stage') {
    const { controls } = viewer;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 2 - STAGE_POLAR_RANGE;
    controls.maxPolarAngle = Math.PI / 2 + STAGE_POLAR_RANGE;
    // OrbitControls wrote `touch-action: none` inline; vertical drags must still scroll the page.
    canvas.style.touchAction = 'pan-y';
  } else {
    canvas.style.touchAction = 'auto';
    viewer.camera.position.set(BUST_CAMERA.x, BUST_CAMERA.y, BUST_CAMERA.z);
    viewer.camera.lookAt(BUST_TARGET.x, BUST_TARGET.y, BUST_TARGET.z);
    viewer.playerWrapper.rotation.y = BUST_YAW;
  }
  return viewer;
}

/**
 * Stage loop policy: run the draw loop only while Spin, Walk or a drag needs new frames; otherwise
 * pause it and draw ONE frame so the last change (a flip, a toggle switched off, a drag's final
 * step) is on screen. Never called for the bust variant (always paused, one frame per change).
 */
function applyLoop(
  viewer: SkinViewer,
  motion: { spin: boolean; walk: boolean; drag: boolean },
  ready: boolean,
): void {
  const moving = motion.spin || motion.walk || motion.drag;
  if (viewer.renderPaused !== !moving) viewer.renderPaused = !moving;
  if (!moving && ready) viewer.render();
}

/** Dispose the viewer and give its GL context back at once (not at garbage collection). */
function destroyViewer(viewer: SkinViewer): void {
  viewer.dispose();
  try {
    viewer.renderer.forceContextLoss();
  } catch {
    // A context that is already lost throws here — nothing left to free.
  }
}

export function SkinViewer3DCanvas({
  textureUrl,
  model,
  name,
  bustFallbackUrl,
  autoRotate,
  variant,
}: SkinViewer3DCanvasProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** True once the current texture is on the model — a bust resize then redraws its one frame. */
  const readyRef = useRef(false);
  /** What keeps the stage loop alive: Spin, Walk, or a pointer drag on the orbit controls. */
  const motionRef = useRef({ spin: false, walk: false, drag: false });

  /** The live instance (mutated in place — a ref, not state: React's immutability lint). */
  const viewerRef = useRef<SkinViewer | null>(null);
  /** Bumped when a viewer is built, so the effects below re-run against the new instance. */
  const [instance, setInstance] = useState(0);
  // No WebGL at all → `unsupported` from the first render (never a render-then-swap).
  const [state, setState] = useState<ViewerState>(() =>
    webglAvailable() ? 'loading' : 'unsupported',
  );
  const [reducedMotion] = useState(readReducedMotion);
  const [spin, setSpin] = useState(
    () => variant === 'stage' && !readReducedMotion() && autoRotate !== false,
  );
  const [walk, setWalk] = useState(false);
  const [back, setBack] = useState(false);

  const unsupported = state === 'unsupported';

  // Build the viewer once per mount; tear it down on unmount or when the state falls to unsupported.
  // Built on the next frame: the box has its laid-out size by then, and a constructor that throws
  // (no GL context) reports `unsupported` from a callback rather than from the effect body.
  useEffect(() => {
    if (unsupported) return;
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (box === null || canvas === null) return;

    const held: { viewer: SkinViewer | null; observer: ResizeObserver | null } = {
      viewer: null,
      observer: null,
    };
    const frame = window.requestAnimationFrame(() => {
      const rect = box.getBoundingClientRect();
      const created = createViewer(
        canvas,
        Math.round(rect.width) || DEFAULT_WIDTH,
        Math.round(rect.height) || DEFAULT_HEIGHT,
        variant,
      );
      if (created === null) {
        setState('unsupported');
        return;
      }
      const observer = new ResizeObserver((entries) => {
        const size = entries[0]?.contentRect;
        if (size === undefined || size.width === 0 || size.height === 0) return;
        created.setSize(Math.round(size.width), Math.round(size.height));
        // A paused viewer (a bust, or a still stage) keeps its one frame; redraw it at the new size.
        if (readyRef.current && created.renderPaused) created.render();
      });
      observer.observe(box);
      if (variant === 'stage') {
        // A drag needs frames while it lasts (OrbitControls updates inside the loop); the loop
        // stops again on `end` — `applyLoop` draws the resting frame.
        created.controls.addEventListener('start', () => {
          motionRef.current.drag = true;
          applyLoop(created, motionRef.current, readyRef.current);
        });
        created.controls.addEventListener('end', () => {
          motionRef.current.drag = false;
          applyLoop(created, motionRef.current, readyRef.current);
        });
      }
      held.viewer = created;
      held.observer = observer;
      viewerRef.current = created;
      setInstance((n) => n + 1);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      held.observer?.disconnect();
      readyRef.current = false;
      viewerRef.current = null;
      if (held.viewer !== null) destroyViewer(held.viewer);
    };
  }, [variant, unsupported]);

  // Texture + model: loaded in place on every change (the Slim toggle never rebuilds the viewer).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null) return;
    let cancelled = false;
    readyRef.current = false;
    viewer
      .loadSkin(textureUrl, { model: model === 'slim' ? 'slim' : 'default' })
      .then(() => {
        if (cancelled || viewer.disposed) return;
        readyRef.current = true;
        if (variant === 'bust') {
          viewer.render(); // the one frame
        } else {
          applyLoop(viewer, motionRef.current, true);
        }
        setState('ready');
      })
      .catch(() => {
        // 404 / CORS / not an image: the live view is not available — show the render instead.
        if (!cancelled) setState('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, [instance, textureUrl, model, variant]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null) return;
    viewer.autoRotate = spin;
    motionRef.current.spin = spin;
    if (variant === 'stage') applyLoop(viewer, motionRef.current, readyRef.current);
  }, [instance, spin, variant]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null) return;
    viewer.animation = walk ? new WalkingAnimation() : null;
    motionRef.current.walk = walk;
    if (variant === 'stage') applyLoop(viewer, motionRef.current, readyRef.current);
  }, [instance, walk, variant]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null) return;
    const base = variant === 'bust' ? BUST_YAW : 0;
    viewer.playerWrapper.rotation.y = base + (back ? Math.PI : 0);
    // A paused viewer shows the flip at once; a running loop picks it up on its next frame.
    if (viewer.renderPaused && readyRef.current) viewer.render();
  }, [instance, back, variant]);

  const showFallback = unsupported;

  return (
    <div className={styles['viewer-body']} data-state={state}>
      <div
        ref={boxRef}
        className={styles.box}
        {...(state === 'loading' ? { 'aria-busy': 'true' as const } : {})}
      >
        {showFallback ? null : (
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            role="img"
            aria-label={`3D view of ${name} skin`}
          />
        )}
        {state === 'loading' ? (
          <>
            <Skeleton kind="media" height="100%" className={styles.skeleton} />
            <p className="visually-hidden">Loading…</p>
          </>
        ) : null}
        {showFallback ? (
          <div className={styles.fallback}>
            {bustFallbackUrl !== null ? (
              <Image
                src={bustFallbackUrl}
                alt={`${name} skin, 3D render`}
                width={600}
                height={800}
                sizes="(max-width: 899px) 100vw, 640px"
                className={styles['fallback-bust']}
              />
            ) : (
              <Image
                src={textureUrl}
                alt={`${name} skin texture`}
                width={64}
                height={64}
                unoptimized
                className={styles['fallback-texture']}
              />
            )}
            <p className={styles['fallback-line']}>{UNSUPPORTED_LINE}</p>
          </div>
        ) : null}
      </div>
      {variant === 'stage' && !showFallback ? (
        <SkinViewer3DControls
          spin={spin}
          walk={walk}
          back={back}
          disabled={state !== 'ready'}
          walkDisabled={reducedMotion}
          onSpin={() => setSpin((value) => !value)}
          onWalk={() => setWalk((value) => !value)}
          onFlip={() => setBack((value) => !value)}
        />
      ) : null}
    </div>
  );
}
