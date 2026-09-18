import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/support` loading state — panel + slot shells in the page's 720px column (02 §6, RP-10;
 * 03 G-01; DESIGN.md §11.1 Skeleton): title + lead lines, the picker slab (title, four chips,
 * the button), then the dashed Ko-fi slot. ≤ one screenful (RP-24).
 */
export default function SupportLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="media" width="240px" height="40px" />
      <Skeleton kind="text" width="360px" height="16px" />
      <div className={styles['loading-slab']}>
        <Skeleton kind="media" width="260px" height="26px" />
        <Skeleton kind="text" lines={2} width="420px" />
        <div className={styles['loading-chips']}>
          <Skeleton kind="media" width="64px" height="48px" />
          <Skeleton kind="media" width="64px" height="48px" />
          <Skeleton kind="media" width="64px" height="48px" />
          <Skeleton kind="media" width="81px" height="48px" />
        </div>
        <Skeleton kind="media" width="192px" height="44px" />
      </div>
      <div className={styles['loading-slot']} />
    </div>
  );
}
