import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/profile` loading state — 720px column shells (02 §6; 03 G-01; DESIGN.md §11.1 Skeleton):
 * title line, then the slab with a picture block, a field line and a footer line. ≤ one screenful.
 */
export default function ProfileLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="media" width="280px" height="40px" />
      <Skeleton kind="text" width="320px" height="16px" />
      <div className={styles['loading-slab']}>
        <div className={styles['loading-row']}>
          <Skeleton kind="media" width="88px" height="88px" />
          <Skeleton kind="text" lines={2} width="220px" />
        </div>
        <div className={styles['loading-row']}>
          <Skeleton kind="media" height="48px" />
        </div>
        <div className={styles['loading-foot']}>
          <Skeleton kind="text" lines={2} />
        </div>
      </div>
    </div>
  );
}
