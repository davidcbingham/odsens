import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/videos` loading state — "player well + 4 facade shells" (02 §6, RP-10; 03 G-01; DESIGN.md
 * §11.1 Skeleton) in the page's own column and stage grid: title + subline blocks, the 16:9 player
 * well with its title and meta lines, then four Up next row shells (132px 16:9 thumb + two text
 * lines) inside the real row edges, so nothing jumps when the content lands. Server Component, the
 * shared `Skeleton`, ≤ one screenful of shells (RP-24); the region holds a full viewport so the
 * footer cannot paint in view and then jump (CLS).
 */
const ROWS = [0, 1, 2, 3] as const;

export default function VideosLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="media" width="220px" height="40px" />
        <Skeleton kind="text" width="300px" height="16px" />
      </div>
      <div className={styles['loading-stage']}>
        <div className={styles['loading-player']}>
          <Skeleton kind="media" />
          <Skeleton kind="media" width="70%" height="26px" />
          <Skeleton kind="text" width="240px" height="14px" />
        </div>
        <div className={styles['loading-rows']}>
          {ROWS.map((row) => (
            <div key={row} className={styles['loading-row']}>
              <Skeleton kind="media" width="132px" />
              <Skeleton kind="text" lines={2} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
