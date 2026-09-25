import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/seen-on` loading state — "3 tile shells + 6 card shells" (02 §6, RP-10; 03 G-01; DESIGN.md
 * §11.1 Skeleton) in the page's own column: the title block, three `StatTile`-shaped shells
 * (label line + the 34px number), the filter-bar strip, then six `MentionCard`-shaped shells (16:9
 * well over the 2px rule, mark + two text lines, the title line, the footer strip) inside the real
 * card edges and the real 3 / 2 / 1-up grid, so nothing jumps when the content lands. Server
 * Component, the shared `Skeleton`; the shells stop at six cards (RP-24) and the region holds a
 * full viewport so the footer cannot paint in view and then jump (CLS).
 */
const TILES = [0, 1, 2] as const;
const CARDS = [0, 1, 2, 3, 4, 5] as const;

export default function SeenOnLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="media" width="240px" height="40px" />
      </div>
      <div className={styles['loading-tiles']}>
        {TILES.map((tile) => (
          <div key={tile} className={styles['loading-tile']}>
            <Skeleton kind="text" width="72px" height="11px" />
            <Skeleton kind="media" width="96px" height="34px" />
          </div>
        ))}
      </div>
      <div className={styles['loading-bar']}>
        <Skeleton kind="media" width="72px" height="44px" />
        <Skeleton kind="media" width="112px" height="44px" />
        <Skeleton kind="media" width="96px" height="44px" />
      </div>
      <ul className={styles['loading-grid']}>
        {CARDS.map((card) => (
          <li key={card} className={styles['loading-card']}>
            <div className={styles['loading-card-thumb']}>
              <Skeleton kind="media" />
            </div>
            <div className={styles['loading-card-body']}>
              <div className={styles['loading-card-creator']}>
                <Skeleton kind="media" width="26px" height="26px" />
                <Skeleton kind="text" lines={2} height="12px" />
              </div>
              <Skeleton kind="text" width="80%" height="14px" />
            </div>
            <div className={styles['loading-card-foot']}>
              <Skeleton kind="text" width="64px" height="12px" />
              <Skeleton kind="text" width="120px" height="12px" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
