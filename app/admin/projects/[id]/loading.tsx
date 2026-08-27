import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/admin/projects/[id]` loading state (02 §1.3 Files cell `app/admin/projects/[id]/loading.tsx`;
 * RP-10; 03 G-01): the curate-form shell — title line, then three admin-field blocks (label line
 * over an input slab) and a button slab — inside the real column width so nothing jumps
 * (DESIGN.md §11.1 Skeleton). Region carries `aria-busy` with one visually-hidden "Loading…".
 */
export default function AdminProjectLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="text" width="280px" height="26px" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={styles['loading-field']}>
          <Skeleton kind="text" width="120px" height="12px" />
          <div className={styles['loading-input']} />
        </div>
      ))}
      <Skeleton kind="text" width="120px" height="44px" />
    </div>
  );
}
