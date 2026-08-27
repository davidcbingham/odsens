'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useState } from 'react';
import styles from './Gallery.module.css';

/**
 * Gallery — DESIGN.md §5 Gallery ("Big 16:9 well plus a thumbnail row (16:10, 5 across desktop /
 * 4 phone, last one `+N`). Selected thumb takes the `--indigo-lift` outline."); 03 §2.3 `Gallery`
 * row; on the 03 §1.4 C-16a client-island list ("thumb selection, opens Lightbox"). Data arrives
 * as props (01 INV-09) — S1.2 gallery = Modrinth URLs only (ADR-0002 C10); no zod (ADR-0008).
 *
 * Selected thumb carries `aria-current="true"` (03 C-13); thumbs are
 * `<button aria-label="Show image N: <alt>">`; clicking the big well opens `Lightbox`, which is
 * `next/dynamic`-loaded on first open (03 C-18, 01 INV-10). `images.length === 0` → renders
 * nothing (the page decides layout). The `+N` thumb differs per breakpoint (desktop shows 5
 * slots, phone 4 — DESIGN.md §5), so both `+N` buttons render and CSS shows one.
 */
const Lightbox = dynamic(() => import('./Lightbox').then((m) => m.Lightbox), { ssr: false });

export type GalleryImage = {
  url: string;
  /** Required — 03: alt non-optional at type level. */
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
};

export type GalleryProps = {
  images: GalleryImage[];
  className?: string;
};

/** Thumb slots per breakpoint (DESIGN.md §5: 5 desktop / 4 phone, last one `+N`). */
const DESKTOP_SLOTS = 5;
const PHONE_SLOTS = 4;

export function Gallery({ images, className }: GalleryProps) {
  const [selected, setSelected] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);

  const count = images.length;
  if (count === 0) return null; // 03: empty → renders nothing

  const index = Math.min(selected, count - 1);
  const image = images[index];
  // noUncheckedIndexedAccess: `index` is clamped into [0, count) above, so this never fires.
  if (image === undefined) return null;

  // Desktop: 5 slots → +N when more than 5 (N = count − 4). Phone: 4 slots → +N when more than 4.
  const desktopMore = count > DESKTOP_SLOTS ? count - (DESKTOP_SLOTS - 1) : 0;
  const phoneMore = count > PHONE_SLOTS ? count - (PHONE_SLOTS - 1) : 0;
  const thumbs = images.slice(0, desktopMore > 0 ? DESKTOP_SLOTS - 1 : count);

  const thumbClass = (i: number): string => {
    // Thumbs beyond the phone's 3 visible ones give way to the phone +N slot.
    const desktopOnly = phoneMore > 0 && i >= PHONE_SLOTS - 1;
    const base = styles['gallery-thumb'] ?? '';
    return desktopOnly ? `${base} ${styles['gallery-desktop-only']}` : base;
  };

  const classes = className ? `${styles.gallery} ${className}` : styles.gallery;

  return (
    <div className={classes}>
      <button
        type="button"
        className={styles['gallery-well']}
        aria-haspopup="dialog"
        aria-label={`Open image viewer: ${image.alt}`}
        onClick={() => setViewer(index)}
      >
        <Image
          src={image.url}
          alt={image.alt}
          fill
          sizes="(max-width: 899px) 100vw, 60vw"
          className={styles['gallery-img']}
        />
      </button>
      {count > 1 ? (
        <div className={styles['gallery-thumbs']}>
          {thumbs.map((thumb, i) => (
            <button
              key={thumb.url}
              type="button"
              className={thumbClass(i)}
              aria-label={`Show image ${i + 1}: ${thumb.alt}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => setSelected(i)}
            >
              <Image
                src={thumb.url}
                alt=""
                fill
                sizes="(max-width: 599px) 25vw, 15vw"
                className={styles['gallery-img']}
              />
            </button>
          ))}
          {desktopMore > 0 ? (
            <button
              type="button"
              className={`${styles['gallery-thumb']} ${styles['gallery-more']} ${styles['gallery-desktop-only']}`}
              aria-label={`Show ${desktopMore} more images`}
              onClick={() => setViewer(DESKTOP_SLOTS - 1)}
            >
              +{desktopMore}
            </button>
          ) : null}
          {phoneMore > 0 ? (
            <button
              type="button"
              className={`${styles['gallery-thumb']} ${styles['gallery-more']} ${styles['gallery-phone-only']}`}
              aria-label={`Show ${phoneMore} more images`}
              onClick={() => setViewer(PHONE_SLOTS - 1)}
            >
              +{phoneMore}
            </button>
          ) : null}
        </div>
      ) : null}
      {viewer !== null ? (
        <Lightbox
          images={images}
          index={viewer}
          onIndex={(i) => setViewer(i)}
          onClose={() => {
            setSelected(viewer);
            setViewer(null);
          }}
        />
      ) : null}
    </div>
  );
}
