'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { LightboxImage, LightboxMeta } from '@/components/projects/Lightbox';
import type { ArtItem } from '@/lib/art';

/**
 * ArtMasonryLightbox — the `ArtMasonry` client leaf (03 §2.7 `ArtMasonry` row: "`ArtMasonryLightbox`
 * `C` = 01 INV-08 '`ArtMasonry` lightbox trigger': one delegated click listener on the `<ul>`
 * intercepts `ArtCard` links and opens the shared `Lightbox` with meta"; 03 C-02 sub-part naming,
 * C-16a client-island list, C-18 lazy `Lightbox`, C-19 server-rendered children; DESIGN.md §5
 * Gallery lightbox, §6 #6 "Lightbox with title, year and optional download"; 00 S1.7 AC6;
 * ADR-0048 D17).
 *
 * Renders the masonry `<ul>` around the `<li>`/`ArtCard` children it is handed (C-19: the cards
 * are rendered by the parent, this file never touches them) and ONE `onClick` on the list. A click
 * that lands inside an `a[data-art-index]` — a plain left click, no modifier key, so a middle click
 * or Cmd/Ctrl-click still opens the image itself in a new tab — is `preventDefault`ed and opens the
 * `Lightbox` on that index; `items` (the SHOWN list, in card order) become its `images` (`url`,
 * `alt` = title, natural `width` / `height`) and its `meta(i)` (`title`, `year` when set,
 * `downloadHref` only when the row is downloadable — `lib/data/art.ts` leaves it `null` otherwise,
 * so the thumbnail's lightbox has no Download button). ←/→ move through the shown list.
 *
 * The `Lightbox` is `next/dynamic`-loaded on first open (03 C-18, 01 INV-10 — the `Gallery`
 * precedent). On close, focus goes back to the card link that opened it: the `Lightbox` restores
 * its own opener natively (`dialog.close()` returns focus to the element focused at `showModal()`),
 * which is that link in Chromium (a clicked link takes focus) but not in every browser (WebKit does
 * not focus a clicked link), so the leaf keeps the link in a ref and focuses it itself as well —
 * 03 §2.7 "Esc restores focus to the card" holds everywhere (05 T-E2E-9). Never fetches
 * (01 INV-09); no zod (ADR-0008).
 */
const Lightbox = dynamic(() => import('@/components/projects/Lightbox').then((m) => m.Lightbox), {
  ssr: false,
});

export type ArtMasonryLightboxProps = {
  /** The shown pieces, in the order the cards are rendered (`data-art-index` = position here). */
  items: ArtItem[];
  /** The `<li>` children (server-rendered `ArtCard`s — 03 C-19). */
  children: ReactNode;
  /** Applied to the `<ul>`. */
  className?: string;
};

function toImages(items: ArtItem[]): LightboxImage[] {
  return items.map((item) => ({
    url: item.imageUrl,
    alt: item.title,
    width: item.width,
    height: item.height,
  }));
}

function toMeta(items: ArtItem[], index: number): LightboxMeta {
  const item = items[index];
  if (item === undefined) return {};
  return {
    title: item.title,
    ...(item.year === null ? {} : { year: item.year }),
    ...(item.downloadHref === null ? {} : { downloadHref: item.downloadHref }),
  };
}

export function ArtMasonryLightbox({ items, children, className }: ArtMasonryLightboxProps) {
  const [open, setOpen] = useState<number | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const handleClick = (event: MouseEvent<HTMLUListElement>): void => {
    if (event.defaultPrevented) return;
    // A modified or non-primary click keeps the link's own behaviour (new tab, context menu…).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLElement>('a[data-art-index]');
    if (link === null || !event.currentTarget.contains(link)) return;
    const index = Number(link.dataset['artIndex']);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) return;
    event.preventDefault();
    openerRef.current = link;
    setOpen(index);
  };

  const handleClose = (): void => {
    setOpen(null);
    openerRef.current?.focus();
    openerRef.current = null;
  };

  return (
    <>
      <ul className={className} onClick={handleClick}>
        {children}
      </ul>
      {open !== null ? (
        <Lightbox
          images={toImages(items)}
          index={open}
          onIndex={(i) => setOpen(i)}
          onClose={handleClose}
          meta={(i) => toMeta(items, i)}
        />
      ) : null}
    </>
  );
}
