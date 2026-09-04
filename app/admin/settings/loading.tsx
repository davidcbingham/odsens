import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/settings` loading state (02 §1.3 Files cell `app/admin/settings/loading.tsx`; §6
 * `/admin/*` "table shell"; RP-10, RP-24; 03 G-01): the admin-table shell recipe of
 * `app/admin/loading.tsx` — a heading line, two toggle-row lines (the Moderation shape), then a
 * slab with a header row and four ≥44px rows (the grid / Moderators shape) — inside the real
 * section rhythm so nothing jumps (DESIGN.md §11.1 Skeleton: two flat depths, opacity pulse, no
 * shimmer, ≤ one screenful). Region carries `aria-busy` with one visually-hidden "Loading…".
 */
export default function AdminSettingsLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="text" width="220px" height="20px" />
      <div className={styles['loading-rows']}>
        <Skeleton kind="text" width="45%" height="14px" />
        <Skeleton kind="text" width="35%" height="14px" />
      </div>
      <div className={styles['loading-table']}>
        <div className={styles['loading-table-head']}>
          <Skeleton kind="text" width="40%" height="12px" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles['loading-table-row']}>
            <Skeleton kind="text" width="60%" height="14px" />
          </div>
        ))}
      </div>
    </div>
  );
}
