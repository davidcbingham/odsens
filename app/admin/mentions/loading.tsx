import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/mentions` loading state (02 §1.3 Files cell `app/admin/mentions/loading.tsx`; RP-10;
 * 03 G-01): the page's real rhythm so nothing jumps — eyebrow + intro lines, the two view tabs,
 * the "Add a mention" slab, then the admin-table shell (header row + six ≥44px rows) — DESIGN.md
 * §11.1 Skeleton. Region carries `aria-busy` with one visually-hidden "Loading…".
 */
export default function AdminMentionsLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="text" width="64px" height="12px" />
        <Skeleton kind="text" width="min(480px, 100%)" height="16px" />
      </div>
      <div className={styles['loading-tabs']}>
        <Skeleton kind="text" width="96px" height="44px" />
        <Skeleton kind="text" width="120px" height="44px" />
      </div>
      <div className={styles['loading-section']}>
        <Skeleton kind="text" width="180px" height="22px" />
        <div className={styles['loading-panel']}>
          <Skeleton kind="text" width="100%" height="44px" />
          <Skeleton kind="text" width="100%" height="72px" />
          <Skeleton kind="text" width="240px" height="44px" />
        </div>
      </div>
      <div className={styles['loading-section']}>
        <Skeleton kind="text" width="180px" height="22px" />
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
    </div>
  );
}
