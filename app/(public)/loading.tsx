import { Skeleton } from '@/components/layout/Skeleton';
import { ProjectCardSkeleton } from '@/components/layout/ProjectCardSkeleton';
import styles from './loading.module.css';

/**
 * Home loading state — hero slab + 4 ProjectCardSkeleton inside the page shell (03 G-01; 02 §6).
 * Nav/footer render from the layout outside this boundary.
 */
export default function HomeLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <Skeleton kind="media" />
      <ProjectCardSkeleton count={4} />
    </div>
  );
}
