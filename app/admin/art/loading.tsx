import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/art` loading state (02 §1.3 Files cell `app/admin/art/loading.tsx`; RP-10; 03 G-01): the
 * page's real rhythm so nothing jumps — eyebrow + intro lines, the "Add art" slab (field rows, the
 * well, the button), the ORDER rows, then the admin-table shell (header row + four ≥44px rows) —
 * DESIGN.md §11.1 Skeleton. Region carries `aria-busy` with one visually-hidden "Loading…".
 */
export default function AdminArtLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="text" width="64px" height="12px" />
        <Skeleton kind="text" width="min(480px, 100%)" height="16px" />
      </div>
      <div className={styles['loading-section']}>
        <Skeleton kind="text" width="120px" height="22px" />
        <div className={styles['loading-panel']}>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className={styles['loading-panel-row']}>
              <Skeleton kind="text" width="100%" height="44px" />
              <Skeleton kind="text" width="100%" height="44px" />
            </div>
          ))}
          <Skeleton kind="media" width="100%" height="96px" />
          <Skeleton kind="text" width="120px" height="44px" />
        </div>
      </div>
      <div className={styles['loading-section']}>
        <Skeleton kind="text" width="80px" height="22px" />
        <div className={styles['loading-order']}>
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className={styles['loading-order-row']}>
              <Skeleton kind="media" width="48px" height="48px" />
              <Skeleton kind="text" width="40%" height="14px" />
            </div>
          ))}
        </div>
      </div>
      <div className={styles['loading-section']}>
        <Skeleton kind="text" width="100px" height="22px" />
        <div className={styles['loading-table']}>
          <div className={styles['loading-table-head']}>
            <Skeleton kind="text" width="50%" height="12px" />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles['loading-table-row']}>
              <Skeleton kind="media" width="48px" height="48px" />
              <Skeleton kind="text" width="60%" height="14px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
