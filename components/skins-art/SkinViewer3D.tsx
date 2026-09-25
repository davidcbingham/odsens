'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/layout/Skeleton';
import buttonStyles from '@/components/primitives/Button.module.css';
import type { SkinModel } from '@/lib/skins';
import styles from './SkinViewer3D.module.css';

/**
 * SkinViewer3D — DESIGN.md §6 #5 Skins ("the big panel is a live spinnable viewer (controls: spin /
 * walk / front-back on a solid slab inside the viewer)"); 03 §2.7 `SkinViewer3D` row; 03 C-18 /
 * 01 INV-10 (skinview3d is lazy, `ssr:false`, in this component only); 00 S1.7.AC3/AC4; S1.7
 * D13 / D14 / D15 / D14 (ADR-0047 / ADR-0048). Client island (03 C-16a).
 *
 * This file is the ONE `next/dynamic` site for the WebGL leaf (`SkinViewer3D.Canvas.tsx`, the
 * only importer of `skinview3d`): the chunk (~150 KB gz, pre-approved — docs/framework-decision.md,
 * 01 INV-80) is fetched when the viewer first mounts, never in first-load JS. While it loads the
 * `loading` shell renders the same well with `data-state="loading"` — the Skeleton media block in
 * the box plus a disabled controls row — so the chunk arriving shifts nothing (03 C-12 / C-28).
 *
 * DOM: the outer `.viewer` (rendered here, always) carries `data-variant` and the `className`;
 * the inner `.viewer-body` (the leaf, or its shell) carries `data-state` loading | ready |
 * unsupported. The leaf's canvas is `role="img" aria-label="3D view of <name> skin"`.
 *
 * Variants (additive prop, ADR-0048 D14 / D15): `stage` (default) = the /skins well — `--slab-sunk`, 2px
 * `--line-soft`, 3:4 on phone / 4:3 from 900px, the model centred, the controls row on a solid slab
 * inside the well: Spin (toggle, `aria-pressed`), Walk (toggle; disabled under
 * `prefers-reduced-motion`), Front ⇄ Back (one button whose label flips). `bust` = a static 3:4
 * head-and-shoulders render for a `SkinCard` whose cached bust is missing: no controls, one frame
 * then `renderPaused`, transparent background. The Slim toggle lives outside (03 row): the parent
 * switches `model` and the leaf reloads the texture in place.
 *
 * Network (03 C-17 exception 2): skinview3d loads `textureUrl` itself — the Supabase public object
 * URL, already in the CSP `img-src`. Nothing else.
 */
export type SkinViewer3DProps = {
  /** Public object URL of the 64×64 texture (`skins/<id>/texture.png`). */
  textureUrl: string;
  model: SkinModel;
  /** For the canvas label ("3D view of <name> skin") and the fallback image alt. */
  name: string;
  /** The cached bust render shown in `unsupported`; `null` → the pixelated texture instead. */
  bustFallbackUrl: string | null;
  /** Initial Spin state for `stage` (default true; always false under reduced motion). */
  autoRotate?: boolean;
  /** `stage` (default): the /skins well with controls · `bust`: a static 3:4 render (ADR-0048 D14 / D15). */
  variant?: 'stage' | 'bust';
  className?: string;
};

export type SkinViewer3DControlsProps = {
  spin: boolean;
  walk: boolean;
  /** True while the model shows its back — the button then offers "Front". */
  back: boolean;
  /** Every control inert: the loading shell, or `unsupported`. */
  disabled?: boolean;
  /** `prefers-reduced-motion`: Walk stays disabled (03 row). */
  walkDisabled?: boolean;
  onSpin?: () => void;
  onWalk?: () => void;
  onFlip?: () => void;
};

/**
 * SkinViewer3DControls — the row of three `Button secondary size="sm"`-styled controls. Native
 * `<button>`s wearing the Button module classes because the `Button` primitive has no
 * `aria-pressed` pass-through and a toggle must carry it on the element itself (03 §3 row:
 * "`aria-pressed` on Spin/Walk"). Shared by the loading shell (disabled) and the leaf (live).
 */
export function SkinViewer3DControls({
  spin,
  walk,
  back,
  disabled = false,
  walkDisabled = false,
  onSpin,
  onWalk,
  onFlip,
}: SkinViewer3DControlsProps) {
  const controlClass = `${buttonStyles.button ?? ''} ${styles.control ?? ''}`;
  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={controlClass}
        data-variant="secondary"
        data-size="sm"
        aria-pressed={spin}
        disabled={disabled}
        onClick={onSpin}
      >
        Spin
      </button>
      <button
        type="button"
        className={controlClass}
        data-variant="secondary"
        data-size="sm"
        aria-pressed={walk}
        disabled={disabled || walkDisabled}
        onClick={onWalk}
      >
        Walk
      </button>
      <button
        type="button"
        className={controlClass}
        data-variant="secondary"
        data-size="sm"
        disabled={disabled}
        onClick={onFlip}
      >
        {back ? 'Front' : 'Back'}
      </button>
    </div>
  );
}

/** The `loading` shell: same well, `data-state="loading"`, Skeleton in the box, inert controls. */
function SkinViewer3DLoading() {
  return (
    <div className={styles['viewer-body']} data-state="loading">
      <div className={styles.box} aria-busy="true">
        <Skeleton kind="media" height="100%" className={styles.skeleton} />
        <p className="visually-hidden">Loading…</p>
      </div>
      <SkinViewer3DControls spin={false} walk={false} back={false} disabled />
    </div>
  );
}

const SkinViewer3DCanvas = dynamic(
  () => import('./SkinViewer3D.Canvas').then((m) => m.SkinViewer3DCanvas),
  { ssr: false, loading: SkinViewer3DLoading },
);

export function SkinViewer3D({
  textureUrl,
  model,
  name,
  bustFallbackUrl,
  autoRotate,
  variant = 'stage',
  className,
}: SkinViewer3DProps) {
  const classes = className ? `${styles.viewer} ${className}` : styles.viewer;
  return (
    <div className={classes} data-variant={variant}>
      <SkinViewer3DCanvas
        textureUrl={textureUrl}
        model={model}
        name={name}
        bustFallbackUrl={bustFallbackUrl}
        autoRotate={autoRotate}
        variant={variant}
      />
    </div>
  );
}
