import { EmptyState } from '@/components/primitives/EmptyState';
import { applyArtFilter, type ArtFilter, type ArtItem } from '@/lib/art';
import { ArtCard } from './ArtCard';
import { ArtMasonryLightbox } from './ArtMasonry.Lightbox';
import styles from './ArtMasonry.module.css';

/**
 * ArtMasonry — DESIGN.md §6 #6 Art ("a column-flow masonry where each piece keeps its own
 * dimensions … pack flush with one 18px gutter. Four columns desktop, two phone, one under 480"),
 * §11.7 empty state (verbatim); 03 §2.7 `ArtMasonry` row (`S`, CSS `columns`, `ArtCard` children,
 * `ArtMasonryLightbox` client leaf); 00 S1.7 AC6 / AC8; ADR-0048 D17. Shared (no directive —
 * 01 INV-08 "everything else"): rendered inside the `ArtGallery` island on `/art` and by the dev
 * gallery. Never fetches; data as props (01 INV-09); no zod (ADR-0008).
 *
 * `filter` (03 props; `null` = all) is applied here with `applyArtFilter` so the list, the card
 * indices and the lightbox agree on ONE shown order: the `<ul>` is rendered by the
 * `ArtMasonryLightbox` leaf (C-19: it takes the `<li>`/`ArtCard` children this parent renders and
 * adds the one delegated click listener + the lazy `Lightbox`), each `<li>` `break-inside: avoid`,
 * the columns 4 / 2 (≤ 899) / 1 (< 480) with `column-gap: var(--space-18)`. Nothing shown — an
 * empty filter, or no art at all (00 AC8) — → `EmptyState` `h3` "NO ART HERE YET" / "Nothing in
 * this filter. Try \"all\"." (DESIGN.md §11.7, strings verbatim; the `h3` sits under the
 * island's visually-hidden `h2`).
 */
export type ArtMasonryProps = {
  /** Every published piece, masonry order (`listPublishedArt`). */
  items: ArtItem[];
  /** `?kind=` as parsed by the island; `null` / omitted = all (03 `filter: 'all' | <kind>`). */
  filter?: ArtFilter;
  className?: string;
};

/** DESIGN.md §11.7 Art, verbatim (00 S1.7 AC8; 05 T-E2E-9). */
export const ART_EMPTY_TITLE = 'NO ART HERE YET';
export const ART_EMPTY_LINE = 'Nothing in this filter. Try "all".';

export function ArtMasonry({ items, filter = null, className }: ArtMasonryProps) {
  const shown = applyArtFilter(items, filter);
  if (shown.length === 0) {
    return (
      <EmptyState as="h3" title={ART_EMPTY_TITLE} line={ART_EMPTY_LINE} className={className} />
    );
  }

  const classes = className ? `${styles['art-masonry']} ${className}` : styles['art-masonry'];
  return (
    <ArtMasonryLightbox items={shown} className={classes}>
      {shown.map((item, index) => (
        <li key={item.id} className={styles['art-masonry-item']}>
          <ArtCard item={item} index={index} />
        </li>
      ))}
    </ArtMasonryLightbox>
  );
}
