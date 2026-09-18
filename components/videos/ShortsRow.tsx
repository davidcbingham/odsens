'use client';

import { SectionTitle, sectionTitleId } from '@/components/primitives/SectionTitle';
import { VideoFacade } from '@/components/videos/VideoFacade';
import type { VideoCardData } from '@/lib/videos';
import styles from './ShortsRow.module.css';

/**
 * ShortsRow — DESIGN.md §11.5 Shorts row ("Shorts get their own row below it — 9:16 facades at
 * 104px with a gold duration chip, horizontally scrolling on phone. Everything on the page is a
 * facade until clicked."); 03 §2.6 `ShortsRow` row; 00 S1.6.AC5 (Shorts appear ONLY here, never in
 * the long-form grid). Client island (03 C-16a, "facade only"): it renders the client
 * `VideoFacade variant="short"` tiles and nothing else — no state, no reads (01 INV-09).
 *
 * `<section aria-labelledby>` + `SectionTitle` SHORTS + `<ul>`; every tile is a tabbable facade
 * button, so the scroller is keyboard-reachable. A Short plays inside its own 104px tile
 * (spec-literal; growing the tile on play is a recorded design question, not built).
 * Tiles stay 104px at every width (DESIGN.md sizes are not shrunk on phones).
 *
 * The scroller clips its overflow, and a clip cuts focus rings: it is padded by 8px on every side
 * (3px ring + 2px offset + room) and pulled back by the same negative margin, so the tiles still
 * line up with the page column and the ring of the first, last or any focused tile is whole.
 * `scroll-padding` keeps a tile that is tabbed to fully inside that padded box.
 *
 * `shorts.length === 0` → renders nothing (no heading either).
 */
export type ShortsRowProps = {
  shorts: VideoCardData[];
  className?: string;
};

const TITLE = 'SHORTS';

export function ShortsRow({ shorts, className }: ShortsRowProps) {
  if (shorts.length === 0) return null;
  const classes = className ? `${styles['shorts-row']} ${className}` : styles['shorts-row'];
  return (
    <section className={classes} aria-labelledby={sectionTitleId(TITLE)}>
      <SectionTitle>{TITLE}</SectionTitle>
      <ul className={styles['shorts-row-list']}>
        {shorts.map((short) => (
          <li key={short.id} className={styles['shorts-row-item']}>
            <VideoFacade
              youtubeId={short.youtubeId}
              title={short.title}
              thumbnailUrl={short.thumbnailUrl}
              durationSeconds={short.durationSeconds}
              variant="short"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
