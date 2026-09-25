import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/art` loading state — "8 masonry shells" (02 §6, RP-10; 03 G-01; DESIGN.md §11.1 Skeleton) in
 * the page's own column: the title + subline blocks, the filter-bar strip (four button shells),
 * then eight `ArtCard`-shaped shells — an image block of a different aspect each (square, 16:9,
 * 3:4, 4:3 … the shapes a real masonry mixes) over the title + meta lines, inside the real card
 * edges and the real 4 / 2 / 1-column flow, so nothing jumps when the content lands. Server
 * Component, the shared `Skeleton`; eight shells stay under a screenful (RP-24) and the region
 * holds a full viewport so the footer cannot paint in view and then jump (CLS).
 */
const SHAPES = ['square', 'wide', 'tall', 'wide', 'square', 'four-three', 'wide', 'tall'] as const;

export default function ArtLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="media" width="120px" height="40px" />
        <Skeleton kind="text" width="240px" height="16px" />
      </div>
      <div className={styles['loading-bar']}>
        <Skeleton kind="media" width="64px" height="44px" />
        <Skeleton kind="media" width="112px" height="44px" />
        <Skeleton kind="media" width="128px" height="44px" />
        <Skeleton kind="media" width="88px" height="44px" />
      </div>
      <ul className={styles['loading-masonry']}>
        {SHAPES.map((shape, i) => (
          <li key={i} className={styles['loading-item']}>
            <div className={styles['loading-card']}>
              <div className={styles['loading-card-img']} data-shape={shape}>
                <Skeleton kind="media" height="100%" />
              </div>
              <div className={styles['loading-card-caption']}>
                <Skeleton kind="text" width="70%" height="15px" />
                <Skeleton kind="text" width="45%" height="13px" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
