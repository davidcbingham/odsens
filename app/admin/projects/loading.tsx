import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/projects` loading state (02 §1.3 Files cell `app/admin/projects/loading.tsx`; RP-10;
 * 03 G-01): the admin-table shell — heading line, header row, six ≥44px rows — inside the real
 * section rhythm so nothing jumps (DESIGN.md §11.1 Skeleton). Region carries `aria-busy` with one
 * visually-hidden "Loading…".
 */
export default function AdminProjectsLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="text" width="240px" height="22px" />
      <div className={styles['loading-table']}>
        <div className={styles['loading-table-head']}>
          <Skeleton kind="text" width="50%" height="12px" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles['loading-table-row']}>
            <Skeleton kind="text" width="70%" height="14px" />
          </div>
        ))}
      </div>
    </div>
  );
}
