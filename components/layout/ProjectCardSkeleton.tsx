import { Skeleton } from './Skeleton';
import styles from './ProjectCardSkeleton.module.css';

/**
 * ProjectCardSkeleton — grid of ProjectCard-shaped shells (DESIGN.md §11.1/§11.8; 03 §2.1):
 * same outline, icon well, title/description lines and footer strip as `ProjectCard`, so nothing
 * jumps on load. ≤ one screenful (count capped at 9). Region carries `aria-busy`.
 */
export type ProjectCardSkeletonProps = {
  /** Shells to draw (default 6, max 9). */
  count?: number;
};

const DEFAULT_COUNT = 6;
const MAX_COUNT = 9;

export function ProjectCardSkeleton({ count = DEFAULT_COUNT }: ProjectCardSkeletonProps) {
  const n = Math.min(MAX_COUNT, Math.max(1, Math.floor(count)));
  return (
    <div role="region" aria-busy="true" aria-label="Loading projects">
      <p className="visually-hidden">Loading…</p>
      <ul className={styles['project-card-skeleton-grid']}>
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className={styles['project-card-skeleton']}>
            <div className={styles['project-card-skeleton-body']}>
              <div className={styles['project-card-skeleton-icon']} aria-hidden="true" />
              <Skeleton kind="media" width="70%" height="20px" />
              <Skeleton kind="text" lines={2} />
            </div>
            <div className={styles['project-card-skeleton-foot']}>
              <Skeleton kind="text" width="64px" height="12px" />
              <Skeleton kind="text" width="48px" height="12px" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
