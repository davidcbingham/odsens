import { ProjectCardSkeleton } from '@/components/layout/ProjectCardSkeleton';
import { Skeleton } from '@/components/layout/Skeleton';
import styles from './loading.module.css';

/**
 * `/projects` loading state — `ProjectCardSkeleton` × 6 inside the real page shell (02 §2.2
 * States; 03 G-01; 00 S1.2.AC12; DESIGN.md §11.1 "inside the real card shells so nothing jumps
 * on load"). Title + count-line blocks per the pass-3 "Skeleton projects desktop" artboard.
 * Nav/footer render from the layout outside this boundary.
 */
export default function ProjectsLoading() {
  return (
    <div className={styles.loading} role="region" aria-busy="true" aria-label="Loading">
      <p className="visually-hidden">Loading…</p>
      <div className={styles['loading-head']}>
        <Skeleton kind="media" width="280px" height="38px" />
        <Skeleton kind="text" width="180px" height="16px" />
      </div>
      <ProjectCardSkeleton count={6} />
    </div>
  );
}
