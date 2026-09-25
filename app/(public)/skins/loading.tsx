import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/skins` loading state — "viewer slab + 4 bust shells" (02 §6, RP-10; 03 G-01; DESIGN.md §11.1
 * Skeleton) in the page's own column and stage grid: title + subline blocks, the viewer well
 * (4:3 from 900px, 3:4 below — SkinViewer3D.module.css) with its controls-row shell, the details
 * slab with a name line, three text lines and a 44px download block, then four 3:4 bust shells
 * with a name line inside the real card edges (4 / 2 / 1-up), so nothing jumps when the content
 * lands. Server Component, the shared `Skeleton`; the region holds a full viewport so the footer
 * cannot paint in view and then jump (CLS).
 */
const CARDS = [0, 1, 2, 3] as const;

export default function SkinsLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="media" width="180px" height="40px" />
        <Skeleton kind="text" width="200px" height="16px" />
      </div>
      <div className={styles['loading-stage']}>
        <div className={styles['loading-viewer']}>
          <div className={styles['loading-viewer-box']}>
            <Skeleton kind="media" height="100%" className={styles['loading-viewer-media']} />
          </div>
          <div className={styles['loading-viewer-controls']}>
            <Skeleton kind="media" width="64px" height="36px" />
            <Skeleton kind="media" width="64px" height="36px" />
            <Skeleton kind="media" width="64px" height="36px" />
          </div>
        </div>
        <div className={styles['loading-panel']}>
          <Skeleton kind="media" width="70%" height="26px" />
          <Skeleton kind="text" lines={3} />
          <Skeleton kind="media" height="44px" />
          <Skeleton kind="text" width="120px" height="22px" />
        </div>
      </div>
      <div className={styles['loading-grid']}>
        {CARDS.map((card) => (
          <div key={card} className={styles['loading-card']}>
            <div className={styles['loading-card-slot']}>
              <Skeleton kind="media" height="100%" className={styles['loading-viewer-media']} />
            </div>
            <div className={styles['loading-card-body']}>
              <Skeleton kind="text" width="70%" height="17px" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
