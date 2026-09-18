import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/support` loading state — panel + slot shells in the page's 720px column (02 §6, RP-10;
 * 03 G-01; DESIGN.md §11.1 Skeleton): title + lead lines, the `KofiCard` slab (title, one line,
 * the button), then the "What it pays for" slab. ≤ one screenful (RP-24).
 */
export default function SupportLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="media" width="240px" height="40px" />
      <Skeleton kind="text" width="360px" height="16px" />
      <div className={styles['loading-slab']}>
        <Skeleton kind="media" width="260px" height="26px" />
        <Skeleton kind="text" width="380px" height="16px" />
        <Skeleton kind="media" width="160px" height="44px" />
      </div>
      <div className={styles['loading-slab']}>
        <Skeleton kind="media" width="180px" height="18px" />
        <Skeleton kind="text" lines={2} />
      </div>
    </div>
  );
}
