import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/comments` loading state (02 §1.3 Files cell `app/admin/comments/loading.tsx`; RP-10;
 * 03 G-01): the admin-table shell — heading line, header row, four two-line rows (author line
 * over a body line, the queue row's shape) — inside the real section rhythm so nothing jumps
 * (DESIGN.md §11.1 Skeleton; the `/admin/projects` recipe). Region carries `aria-busy` with one
 * visually-hidden "Loading…".
 */
export default function AdminCommentsLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="text" width="240px" height="22px" />
      <div className={styles['loading-table']}>
        <div className={styles['loading-table-head']}>
          <Skeleton kind="text" width="50%" height="12px" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles['loading-table-row']}>
            <Skeleton kind="text" width="30%" height="14px" />
            <Skeleton kind="text" width="80%" height="14px" />
          </div>
        ))}
      </div>
    </div>
  );
}
