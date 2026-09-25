'use client';

import { useSearchParams } from 'next/navigation';
import { useId } from 'react';
import { FilterBarView, type FilterGroup } from '@/components/projects/FilterBar';
import { ArtMasonry } from '@/components/skins-art/ArtMasonry';
import { kindCounts, parseArtFilter, type ArtFilter, type ArtItem } from '@/lib/art';
import styles from './ArtGallery.module.css';

/**
 * ArtGallery — DESIGN.md §6 #6 Art ("filter row (all / avatars / thumbnails / icons), then a
 * column-flow masonry"), §11.7 empty state; 02 route row `/art` "Query (client-side)", RP-02 /
 * RP-03 (an ISR page never reads `searchParams` — the island under `<Suspense>` does); 00 S1.7
 * AC6 / AC8; ADR-0048 D13 / D17. Client island (03 C-16a — the `SeenOnGrid` precedent,
 * ADR-0045 D15): ONE island owns the `/art` `?kind=` filter over the full published list it is
 * handed. It never fetches (01 INV-09); the URL is the state, written by the `FilterBar` the way
 * `/projects` writes it (`next/link scroll={false}`).
 *
 * Two exports, one view:
 *   `ArtGallery`      reads the URL with `useSearchParams` — the page wraps it in `<Suspense>`.
 *   `ArtGalleryView`  the same markup for a query string it is given, with no URL read — the page
 *                     uses it as the `<Suspense>` FALLBACK with `query=""`, so the bar and every
 *                     card are in the ISR HTML and the resolved island renders identical markup
 *                     for an unfiltered visit: zero shift.
 *
 * The bar (`FilterBarView`, group `kind`, no selects): ALL, then the FIXED buttons AVATARS /
 * THUMBNAILS / ICONS whatever their count (ICONS may read 0 — the empty state stays reachable,
 * 05 T-E2E-9), then RENDERS / OTHER only when such pieces exist (`kindCounts`, counts over the
 * full list). `?kind=` is parsed with `parseArtFilter`: an unknown value falls away silently, and
 * so does a kind the bar offers no button for (a RENDERS filter with no render would otherwise
 * empty the masonry under a bar that highlights nothing — the `SeenOnGrid` platform rule); the
 * bar is handed the same cleaned query, so what it highlights is always what the masonry shows.
 * The result count is announced politely ("Showing n of N", the `/projects` wording).
 *
 * `ArtMasonry` applies the filter and renders the cards, the lazy lightbox and the §11.7 empty
 * state (`h3` under this section's visually-hidden `h2`). No art at all → the empty state alone:
 * a bar of zero counts filters nothing, so it is not rendered (the `/videos` zero-state shape).
 */
export type ArtGalleryProps = {
  /** Every published piece in masonry order (`listPublishedArt`). */
  items: ArtItem[];
  className?: string;
};

export type ArtGalleryViewProps = ArtGalleryProps & {
  /** The current query string, no leading `?` — what `useSearchParams().toString()` gives. */
  query: string;
};

/** The query the bar gets: every param kept, but a `kind` the bar does not offer removed. */
function cleanedQuery(params: URLSearchParams, filter: ArtFilter): string {
  const next = new URLSearchParams(params);
  if (filter === null) next.delete('kind');
  return next.toString();
}

export function ArtGallery({ items, className }: ArtGalleryProps) {
  const query = useSearchParams().toString();
  return <ArtGalleryView items={items} query={query} className={className} />;
}

export function ArtGalleryView({ items, query, className }: ArtGalleryViewProps) {
  const headingId = useId();
  const classes = className ? `${styles['art-gallery']} ${className}` : styles['art-gallery'];

  if (items.length === 0) {
    return (
      <section aria-labelledby={headingId} className={classes}>
        <h2 id={headingId} className="visually-hidden">
          All art
        </h2>
        <ArtMasonry items={items} />
      </section>
    );
  }

  const options = kindCounts(items);
  const groups: FilterGroup[] = [{ key: 'kind', options }];

  const params = new URLSearchParams(query);
  const parsed = parseArtFilter(params);
  // A kind with no button (RENDERS / OTHER at 0) falls away like an unknown value.
  const filter: ArtFilter = options.some((option) => option.value === parsed) ? parsed : null;
  const shownCount =
    filter === null ? items.length : (options.find((o) => o.value === filter)?.count ?? 0);

  return (
    <section aria-labelledby={headingId} className={classes}>
      <h2 id={headingId} className="visually-hidden">
        All art
      </h2>
      <FilterBarView groups={groups} selects={[]} query={cleanedQuery(params, filter)} />
      <p className="visually-hidden" aria-live="polite">
        Showing {shownCount} of {items.length}
      </p>
      <ArtMasonry items={items} filter={filter} />
    </section>
  );
}
