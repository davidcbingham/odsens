'use client';

import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/primitives/Icon';
import styles from './Lightbox.module.css';

/**
 * Lightbox — DESIGN.md §5 Gallery ("Lightbox: ink at 92% opacity, 44px square arrows, Esc closes,
 * arrow keys move, caption 14px mute. Alt text required on every image"); §6.6 Art meta (title,
 * year, optional Download — S1.7, props ready now); 03 §2.3 `Lightbox` row; on the 03 §1.4 C-16a
 * client-island list; loaded by `Gallery` via `next/dynamic` on first open (03 C-18, 01 INV-10).
 * Data arrives as props (01 INV-09); no zod (ADR-0008).
 *
 * `<dialog>` via `showModal()` → native focus trap + `aria-modal`; `aria-label="Image viewer"`.
 * `data-state="open" | "closing"` (03 §3 — the only two values): closing = 150ms fade
 * (`--dur-fast`), instant under `prefers-reduced-motion`. Esc (cancel) closes; ←/→ move
 * (`onIndex`, wrapping); click on the scrim closes; body scroll locked while open; focus is
 * restored to the opener on close (native `dialog.close()` + an unmount fallback). Arrows are
 * hidden for a single image (a flag, not a state).
 */
export type LightboxImage = {
  url: string;
  /** Required — 03: alt non-optional at type level. */
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
};

export type LightboxMeta = {
  title?: string;
  year?: number;
  downloadHref?: string;
};

export type LightboxProps = {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  /** Art meta (S1.7): title / year / optional Download button. */
  meta?: (i: number) => LightboxMeta;
  className?: string;
};

/** 03 §2.3 binding value: closing fade = 150ms (`--dur-fast`). */
const CLOSING_MS = 150;

export function Lightbox({ images, index, onClose, onIndex, meta, className }: LightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const doneRef = useRef(false);
  const [state, setState] = useState<'open' | 'closing'>('open');

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    dialogRef.current?.close();
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (doneRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish(); // reduced motion: instant (03)
      return;
    }
    setState('closing');
    window.setTimeout(finish, CLOSING_MS);
  }, [finish]);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // body scroll locked (03)
    return () => {
      document.body.style.overflow = previousOverflow;
      // dialog.close() restores focus natively; this covers unmount-without-close.
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.activeElement === document.body) {
        opener.focus();
      }
    };
  }, []);

  const count = images.length;
  if (count === 0) return null;
  const current = Math.min(Math.max(index, 0), count - 1);
  const image = images[current];
  // noUncheckedIndexedAccess: `current` is clamped into [0, count) above, so this never fires.
  if (image === undefined) return null;
  const multiple = count > 1;
  const details = meta?.(current) ?? {};
  const hasDims = typeof image.width === 'number' && typeof image.height === 'number';
  const hasCaptionRow =
    image.caption !== undefined ||
    details.title !== undefined ||
    details.year !== undefined ||
    details.downloadHref !== undefined;

  const step = (delta: number): void => {
    if (multiple) onIndex((current + delta + count) % count);
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault(); // Esc: run the closing fade instead of an instant native close
    requestClose();
  };

  const handleNativeClose = (): void => {
    // Covers a user-agent-initiated close (e.g. form method="dialog"): still notify the opener once.
    if (!doneRef.current) {
      doneRef.current = true;
      onClose();
    }
  };

  const handleScrimClick = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target === event.currentTarget) requestClose(); // click scrim closes (03)
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  };

  const classes = className ? `${styles.lightbox} ${className}` : styles.lightbox;

  return (
    <dialog
      ref={dialogRef}
      className={classes}
      data-state={state}
      aria-modal="true"
      aria-label="Image viewer"
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onClick={handleScrimClick}
      onKeyDown={handleKeyDown}
    >
      {multiple ? (
        <button
          type="button"
          className={`${styles['lightbox-arrow']} ${styles['lightbox-arrow-prev']}`}
          aria-label="Previous image"
          onClick={() => step(-1)}
        >
          <Icon name="arrow-left" />
        </button>
      ) : null}
      <figure className={styles['lightbox-figure']}>
        <div
          className={
            hasDims
              ? styles['lightbox-media']
              : `${styles['lightbox-media']} ${styles['lightbox-media-fill']}`
          }
        >
          {hasDims ? (
            <Image
              src={image.url}
              alt={image.alt}
              width={image.width}
              height={image.height}
              sizes="100vw"
              className={styles['lightbox-img']}
            />
          ) : (
            <Image
              src={image.url}
              alt={image.alt}
              fill
              sizes="100vw"
              className={styles['lightbox-img-fill']}
            />
          )}
        </div>
        {hasCaptionRow ? (
          <figcaption className={styles['lightbox-caption']}>
            {details.title !== undefined ? (
              <span className={styles['lightbox-title']}>{details.title}</span>
            ) : null}
            {details.year !== undefined ? (
              <span className={styles['lightbox-year']}>{details.year}</span>
            ) : null}
            {image.caption !== undefined ? <span>{image.caption}</span> : null}
            {details.downloadHref !== undefined ? (
              <Button variant="primary" href={details.downloadHref}>
                Download
              </Button>
            ) : null}
          </figcaption>
        ) : null}
      </figure>
      {multiple ? (
        <button
          type="button"
          className={`${styles['lightbox-arrow']} ${styles['lightbox-arrow-next']}`}
          aria-label="Next image"
          onClick={() => step(1)}
        >
          <Icon name="arrow-right" />
        </button>
      ) : null}
    </dialog>
  );
}
