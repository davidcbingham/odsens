import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/stats` loading state (02 §1.3 Files cell `app/admin/stats/loading.tsx`; RP-10; 03 G-01):
 * the page's real rhythm so nothing jumps — eyebrow + intro lines, the four tile shells in the
 * tiles grid (label · number · context), a chart heading + a 220px well shell (the full chart's
 * height) + the honest line, then the SYNC table shell (header row + five ≥44px rows — one per
 * `STATS_SYNC_SOURCES` entry) — DESIGN.md §11.1 Skeleton. Region carries `aria-busy` with one
 * visually-hidden "Loading…" (the `/admin/mentions` idiom).
 */
export default function AdminStatsLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="text" width="64px" height="12px" />
        <Skeleton kind="text" width="min(360px, 100%)" height="16px" />
      </div>
      <div className={styles['loading-tiles']}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles['loading-tile']}>
            <Skeleton kind="text" width="120px" height="12px" />
            <Skeleton kind="text" width="96px" height="34px" />
            <Skeleton kind="text" width="80%" height="14px" />
          </div>
        ))}
      </div>
      <div className={styles['loading-section']}>
        <Skeleton kind="text" width="240px" height="22px" />
        <div className={styles['loading-well']}>
          <Skeleton kind="media" width="100%" height="220px" />
        </div>
        <Skeleton kind="text" width="min(560px, 100%)" height="14px" />
      </div>
      <div className={styles['loading-section']}>
        <Skeleton kind="text" width="64px" height="22px" />
        <div className={styles['loading-table']}>
          <div className={styles['loading-table-head']}>
            <Skeleton kind="text" width="50%" height="12px" />
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={styles['loading-table-row']}>
              <Skeleton kind="text" width="70%" height="14px" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
