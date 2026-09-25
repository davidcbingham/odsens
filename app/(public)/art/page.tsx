import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ArtGallery, ArtGalleryView } from '@/components/skins-art/ArtGallery';
import { listPublishedArt } from '@/lib/data/art';
import styles from './page.module.css';

/**
 * `/art` — S1.7 replaces the S0 placeholder (02 route row `/art`, RP-16; 00 S1.7.AC6 / AC8 /
 * AC10; DESIGN.md §6 #6 "filter row (all / avatars / thumbnails / icons), then a column-flow
 * masonry where each piece keeps its own dimensions … Lightbox with title, year and optional
 * download", §11.7 empty state; ADR-0048 D17). ISR(600; `art`): one read through
 * `lib/data/art.ts` on the cookie-less anon client (01 INV-09 / INV-15; the tag comes from the
 * data cache — `createArt` / `updateArt` revalidate `art`, 02 RP-22 / RP-23). The page tree never
 * reads `searchParams`, `cookies()` or `headers()` (02 RP-02 / RP-03, 01 INV-38): `?kind=` belongs
 * to the `ArtGallery` client island inside the `<Suspense>` boundary below, whose FALLBACK is the
 * same view with no filter — the bar and every card are in the ISR HTML and the resolved island
 * changes nothing on an unfiltered visit.
 *
 * Sections: `h1` ART + the subline "Pictures people asked for." (§5 copy) → the island: the
 * `FilterBar` kind row (ALL · AVATARS · THUMBNAILS · ICONS always, RENDERS / OTHER when present)
 * over the 4 / 2 / 1-column `ArtMasonry` of `ArtCard`s at natural aspect; a click opens the lazy
 * `Lightbox` (title, year, Download only when downloadable). Nothing shown — an empty filter or
 * no art at all — → "NO ART HERE YET" / "Nothing in this filter. Try \"all\"." (inside the
 * island; 00 AC8).
 *
 * Metadata per 02 RP-05 / RP-06: title `Art` (renders `Art — odsens`), canonical `/art`;
 * description + OG default inherit from `app/layout.tsx`. Loading: `loading.tsx` (8 masonry
 * shells — 02 §6, RP-10).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Art',
  alternates: { canonical: '/art' },
};

export default async function ArtPage() {
  const items = await listPublishedArt();

  return (
    <section className={styles.art}>
      <div className={styles['art-head']}>
        <h1 className={styles['art-title']}>ART</h1>
        <p className={styles['art-line']}>Pictures people asked for.</p>
      </div>
      {/* RP-02: the island reads the URL via useSearchParams — Suspense boundary required on an
          ISR page. The fallback is the SAME markup with no filter applied. */}
      <Suspense fallback={<ArtGalleryView items={items} query="" />}>
        <ArtGallery items={items} />
      </Suspense>
    </section>
  );
}
