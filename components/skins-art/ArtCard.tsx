import Image from 'next/image';
import type { ArtItem, ArtKind } from '@/lib/art';
import styles from './ArtCard.module.css';

/**
 * ArtCard — DESIGN.md §6 #6 Art ("each piece keeps its own dimensions … never cropped, never forced
 * into a square"), §3 (2px `outline` borders, radius 0); 03 §2.7 `ArtCard` row; pass-3 Sections
 * "07 — ART GALLERY" (image over a caption strip: title 15px 700, kind · year 13px mute); 00 S1.7
 * AC6 / AC10; ADR-0048 D17. Shared (no directive — 01 INV-08 `S`): rendered by `ArtMasonry`
 * inside the `ArtGallery` island and by the admin table.
 *
 * ONE `<a href={imageUrl} aria-label="Open <title>" data-art-index={index}>` is the whole card:
 * without JS it opens the image itself (03 §2.7 "without JS each `ArtCard` link opens the image
 * URL"); with JS the `ArtMasonryLightbox` leaf's delegated listener intercepts the click by
 * `data-art-index` and opens the `Lightbox` on that index (03 C-19 — the leaf never re-renders the
 * cards). The image is `next/image` at its NATURAL `width` / `height` (server-derived at commit,
 * 04 §1.5) with `height: auto` in CSS, so a 1280×720 thumbnail and a 256×256 avatar keep their
 * own boxes (05 T-E2E-9 "bounding boxes differ"); `sizes` follows the 4 / 2 / 1 columns. `alt` =
 * the title (00 S1.7 AC10). The caption is the prototype's strip (title + "Avatar · 2025"); the
 * credit is a handle the lightbox does not show either (03 props) — never a real name.
 *
 * States (03): rest = 2px `--line-soft` outline · hover = `--indigo-lift` outline + translate −2
 * (reduced motion drops the transform — globals.css) · focus = the site-wide 3px `--gold` ring
 * (03 C-25) replacing the card's own outline.
 */
export type ArtCardProps = {
  item: ArtItem;
  /** Position in the SHOWN list — what the lightbox opens on (`data-art-index`). */
  index: number;
  className?: string;
};

/** The caption's singular kind word (the filter row says AVATARS; the card says Avatar). */
const KIND_WORD: Record<ArtKind, string> = {
  avatar: 'Avatar',
  thumbnail: 'Thumbnail',
  icon: 'Icon',
  render: 'Render',
  other: 'Other',
};

/** Masonry columns: 4 desktop / 2 ≤ 899 / 1 < 480 (ArtMasonry.module.css). */
const SIZES = '(max-width: 479px) 100vw, (max-width: 899px) 50vw, 25vw';

export function ArtCard({ item, index, className }: ArtCardProps) {
  const classes = className ? `${styles['art-card']} ${className}` : styles['art-card'];
  const meta = item.year === null ? KIND_WORD[item.kind] : `${KIND_WORD[item.kind]} · ${item.year}`;

  return (
    <a
      href={item.imageUrl}
      aria-label={`Open ${item.title}`}
      data-art-index={index}
      className={classes}
    >
      <Image
        src={item.imageUrl}
        alt={item.title}
        width={item.width}
        height={item.height}
        sizes={SIZES}
        // The first card is the page's LCP element: eager + preloaded, the rest lazy (ADR-0048 D30).
        priority={index === 0}
        className={styles['art-card-img']}
      />
      <span className={styles['art-card-caption']}>
        <span className={styles['art-card-title']}>{item.title}</span>
        <span className={styles['art-card-meta']}>{meta}</span>
      </span>
    </a>
  );
}
