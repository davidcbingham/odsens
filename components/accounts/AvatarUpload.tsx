'use client';

import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { UPLOAD_KINDS, sizeLimitMessage, validateUpload } from '@/lib/validation/files';
import styles from './AvatarUpload.module.css';

/**
 * AvatarUpload — DESIGN.md §11.1 Picture upload; 03 §2.5 `AvatarUpload` (+ crop).
 * A file input named `name` inside the parent `<form>` (completeOnboarding / updateProfile — no
 * action prop). `empty` (well + NO PICTURE) · `cropping` (dimmed original, 2px `--gold` square crop
 * box, drag to move, +/− zoom, arrows; USE THIS / Cancel) · `uploading` (parent form submitting:
 * `--indigo` border, UPLOADING, flat indeterminate bar) · `error` (`--danger-wash` / `--danger-field`,
 * `!`, "That didn't upload. Try again?") · `done` (picture with 3px `--white` border + Change / Remove).
 * USE THIS draws the crop to a 512×512 canvas → WebP blob → `DataTransfer` replaces the input's file,
 * so the cropped image rides along in the parent's FormData. Remove on a stored picture enables the
 * `removeAvatar` hidden input (04 §updateProfile) — toggled on the DOM node *before* `onChange`
 * fires, because `/profile` calls `requestSubmit()` inside that same handler and FormData is read
 * before React commits state. Client pre-check = `validateUpload` (same copy as the server:
 * "That's 3 MB. The limit is 1." / "That's a .svg. Allowed: .png .jpg .webp").
 */
export type AvatarUploadProps = {
  /** File input name inside the parent form. */
  name: string;
  /** Stored picture URL, or null. */
  current: string | null;
  size?: 88 | 120;
  onChange?: (hasFile: boolean) => void;
  className?: string;
};

type Phase = 'empty' | 'cropping' | 'done' | 'error';

type Source = { url: string; width: number; height: number };

const OUTPUT_PX = 512;
/** Crop geometry of the pass-3 CROP STEP frame; mirrored by `--avatar-crop-viewport/box` in the CSS. */
const VIEWPORT_PX = 200;
const CROP_PX = 150;
const STEP_PX = 8;
const ZOOM_STEP = 0.15;
const ZOOM_MAX = 4;
const LIMIT_LINE = 'PNG, JPG or WebP, up to 1 MB.';
const FAILED = "That didn't upload. Try again?";
/** Same sentence as `AVATAR_UNREADABLE` in the server-only `lib/files.ts`. */
const UNREADABLE = "That file didn't open as an image.";

function clampOffset(value: number, drawn: number): number {
  const room = Math.max(0, (drawn - CROP_PX) / 2);
  return Math.min(room, Math.max(-room, value));
}

function loadSource(file: File): Promise<Source> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => resolve({ url, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    image.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === 'image/webp') {
          resolve(webp);
          return;
        }
        canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('encode'))), 'image/png');
      },
      'image/webp',
      0.92,
    );
  });
}

export function AvatarUpload({ name, current, size = 88, onChange, className }: AvatarUploadProps) {
  const [phase, setPhase] = useState<Phase>(current ? 'done' : 'empty');
  const [preview, setPreview] = useState<string | null>(current);
  const [hasFile, setHasFile] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const removeRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const objectUrls = useRef<string[]>([]);
  const { pending } = useFormStatus();
  const errorId = useId();
  const cropHelpId = useId();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const remember = useCallback((url: string) => {
    objectUrls.current.push(url);
  }, []);

  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const uploading = pending && (hasFile || removing);
  const state = uploading ? 'uploading' : phase;

  function openPicker(): void {
    inputRef.current?.click();
  }

  function clearInput(): void {
    if (inputRef.current) inputRef.current.value = '';
  }

  async function onPick(file: File | undefined): Promise<void> {
    if (!file) return;
    // Cheap size gate before reading bytes (same copy as `validateUpload`, 03 §2.10 / 04 U4).
    if (file.size > UPLOAD_KINDS.avatar.maxBytes) {
      clearInput();
      setError(sizeLimitMessage(file.size, 'avatar'));
      setPhase('error');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verdict = validateUpload({ name: file.name, size: file.size, bytes }, 'avatar');
    if (!verdict.ok) {
      clearInput();
      setError(verdict.message);
      setPhase('error');
      return;
    }
    try {
      const next = await loadSource(file);
      remember(next.url);
      setSource(next);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setPhase('cropping');
    } catch {
      clearInput();
      setError(UNREADABLE);
      setPhase('error');
    }
  }

  // --- crop geometry -------------------------------------------------------------------------
  const baseScale = source ? CROP_PX / Math.min(source.width, source.height) : 1;
  const scale = baseScale * zoom;
  const drawnW = source ? source.width * scale : 0;
  const drawnH = source ? source.height * scale : 0;
  const ox = clampOffset(offset.x, drawnW);
  const oy = clampOffset(offset.y, drawnH);
  // top-left of the drawn image relative to the crop box
  const left = (CROP_PX - drawnW) / 2 + ox;
  const top = (CROP_PX - drawnH) / 2 + oy;
  const inset = (VIEWPORT_PX - CROP_PX) / 2;

  function nudge(dx: number, dy: number): void {
    setOffset((o) => ({ x: clampOffset(o.x + dx, drawnW), y: clampOffset(o.y + dy, drawnH) }));
  }

  function zoomBy(delta: number): void {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(1, Number((z + delta).toFixed(3)))));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox, oy };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    setOffset({
      x: clampOffset(drag.current.ox + dx, drawnW),
      y: clampOffset(drag.current.oy + dy, drawnH),
    });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onCropKey(event: KeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case 'ArrowLeft':
        nudge(STEP_PX, 0);
        break;
      case 'ArrowRight':
        nudge(-STEP_PX, 0);
        break;
      case 'ArrowUp':
        nudge(0, STEP_PX);
        break;
      case 'ArrowDown':
        nudge(0, -STEP_PX);
        break;
      case '+':
      case '=':
        zoomBy(ZOOM_STEP);
        break;
      case '-':
      case '_':
        zoomBy(-ZOOM_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  async function applyCrop(): Promise<void> {
    if (!source) return;
    try {
      const image = new window.Image();
      image.src = source.url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_PX;
      canvas.height = OUTPUT_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const sx = -left / scale;
      const sy = -top / scale;
      const sw = CROP_PX / scale;
      ctx.drawImage(image, sx, sy, sw, sw, 0, 0, OUTPUT_PX, OUTPUT_PX);
      const blob = await toBlob(canvas);
      const ext = blob.type === 'image/webp' ? 'webp' : 'png';
      const file = new File([blob], `avatar.${ext}`, { type: blob.type });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      if (inputRef.current) inputRef.current.files = transfer.files;
      if (removeRef.current) removeRef.current.disabled = true;
      const url = URL.createObjectURL(blob);
      remember(url);
      setPreview(url);
      setHasFile(true);
      setRemoving(false);
      setPhase('done');
      onChangeRef.current?.(true);
    } catch {
      clearInput();
      setError(FAILED);
      setPhase('error');
    }
  }

  function cancelCrop(): void {
    clearInput();
    setSource(null);
    setPhase(preview ? 'done' : 'empty');
  }

  function remove(): void {
    // Clears a just-cropped file and, through the `removeAvatar` hidden input, asks the action to drop
    // the stored picture (updateProfile; completeOnboarding's schema strips the unknown key). The
    // hidden input is enabled on the DOM node first: the parent may submit synchronously in `onChange`.
    clearInput();
    if (removeRef.current) removeRef.current.disabled = false;
    setHasFile(false);
    setPreview(null);
    setRemoving(true);
    setPhase('empty');
    onChangeRef.current?.(false);
  }

  const classes = className ? `${styles['avatar-upload']} ${className}` : styles['avatar-upload'];

  return (
    <div className={classes} data-state={state} data-size={size}>
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/png,image/jpeg,image/webp"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Picture file"
        onChange={(event) => void onPick(event.target.files?.[0])}
      />
      {/* Always mounted; a disabled control is left out of FormData. State and the DOM toggle agree. */}
      <input
        ref={removeRef}
        type="hidden"
        name="removeAvatar"
        value="true"
        disabled={!(removing && !hasFile)}
      />

      {state === 'cropping' && source ? (
        <div className={styles['avatar-upload-crop']}>
          <div
            className={styles['avatar-upload-viewport']}
            role="application"
            aria-roledescription="crop area"
            aria-label="Crop area"
            aria-describedby={cropHelpId}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onCropKey}
          >
            {/* geometry: the drawn image box and its position are data */}
            <div
              className={styles['avatar-upload-dim']}
              style={{ width: drawnW, height: drawnH, left: inset + left, top: inset + top }}
            >
              <Image src={source.url} alt="" fill sizes={`${VIEWPORT_PX}px`} unoptimized />
            </div>
            <div className={styles['avatar-upload-box']}>
              <div
                className={styles['avatar-upload-box-image']}
                style={{ width: drawnW, height: drawnH, left, top }}
              >
                <Image src={source.url} alt="" fill sizes={`${CROP_PX}px`} unoptimized />
              </div>
            </div>
          </div>
          <div className={styles['avatar-upload-crop-side']}>
            <p className={styles['avatar-upload-crop-title']}>CROP IT SQUARE</p>
            <p id={cropHelpId} className={styles['avatar-upload-crop-line']}>
              Drag to move. Everything outside the box gets cut.
              <span className="visually-hidden"> Arrow keys move, plus and minus zoom.</span>
            </p>
            <div className={styles['avatar-upload-zoom']}>
              <button
                type="button"
                className={styles['avatar-upload-zoom-button']}
                aria-label="Zoom out"
                onClick={() => zoomBy(-ZOOM_STEP)}
                disabled={zoom <= 1}
              >
                −
              </button>
              <button
                type="button"
                className={styles['avatar-upload-zoom-button']}
                aria-label="Zoom in"
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={zoom >= ZOOM_MAX}
              >
                +
              </button>
            </div>
            <div className={styles['avatar-upload-actions']}>
              <Button variant="primary" onClick={() => void applyCrop()}>
                USE THIS
              </Button>
              <Button variant="ghost" arrow={false} onClick={cancelCrop}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles['avatar-upload-row']}>
          <div className={styles['avatar-upload-well']}>
            {state === 'error' ? (
              <span className={styles['avatar-upload-bang']} aria-hidden="true">
                !
              </span>
            ) : preview ? (
              <Image
                className={styles['avatar-upload-picture']}
                src={preview}
                alt="Your picture"
                width={size}
                height={size}
                sizes={`${size}px`}
                unoptimized={preview.startsWith('blob:')}
              />
            ) : (
              <PixelLabel size={10} tone="mute-dim" className={styles['avatar-upload-empty-label']}>
                NO PICTURE
              </PixelLabel>
            )}
            {state === 'uploading' ? (
              <div className={styles['avatar-upload-progress']}>
                <PixelLabel size={11} tone="chalk" informational>
                  UPLOADING
                </PixelLabel>
                <div
                  className={styles['avatar-upload-bar']}
                  role="progressbar"
                  aria-label="Uploading picture"
                >
                  <span className={styles['avatar-upload-bar-fill']} />
                </div>
              </div>
            ) : null}
          </div>

          <div className={styles['avatar-upload-side']}>
            {state === 'error' ? (
              <p id={errorId} role="alert" className={styles['avatar-upload-error']}>
                {FAILED}
                {error && error !== FAILED ? (
                  <span className={styles['avatar-upload-error-detail']}> {error}</span>
                ) : null}
              </p>
            ) : null}
            <div className={styles['avatar-upload-actions']}>
              {state === 'done' ? (
                <>
                  <Button variant="ghost" arrow={false} onClick={openPicker}>
                    Change
                  </Button>
                  <Button
                    variant="ghost"
                    arrow={false}
                    onClick={remove}
                    className={styles['avatar-upload-remove']}
                  >
                    Remove
                  </Button>
                </>
              ) : state === 'error' ? (
                <Button variant="ghost" onClick={openPicker}>
                  Try again
                </Button>
              ) : state === 'uploading' ? null : (
                <Button variant="secondary" onClick={openPicker}>
                  Upload picture
                </Button>
              )}
            </div>
            <p className={styles['avatar-upload-limit']}>{LIMIT_LINE}</p>
          </div>
        </div>
      )}
    </div>
  );
}
