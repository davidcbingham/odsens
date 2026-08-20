import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/*` loading state — table shell (02 §6, RP-11; 03 G-01): a header line, then a slab with a
 * header row and four ≥44px rows. Renders inside `AdminShell` (the layout is outside this boundary).
 */
export default function AdminLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="text" width="220px" height="20px" />
      <div className={styles['loading-table']}>
        <div className={styles['loading-table-head']}>
          <Skeleton kind="text" width="40%" height="12px" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles['loading-table-row']}>
            <Skeleton kind="text" width="70%" height="14px" />
          </div>
        ))}
      </div>
    </div>
  );
}
