import { CommentThreadSkeleton } from './CommentThreadSkeleton';
import { Skeleton } from './Skeleton';
import styles from './ProjectDetailSkeleton.module.css';

/**
 * ProjectDetailSkeleton — project-detail-shaped shells (DESIGN.md §11.1/§11.8; 03 §2.1
 * `ProjectDetailSkeleton`: "Header (icon well + title lines) + gallery well + about lines +
 * rail panel shells"; G-01 `/projects/[slug]/loading.tsx` "incl. the thread block as
 * `CommentThreadSkeleton`"). Mirrors `ProjectCardSkeleton`: real detail-page shells (104px icon
 * well, 1fr/380px rail grid — pass-3 detail mockup) with two-depth `Skeleton` blocks inside,
 * ≤ one screenful, region `aria-busy` + one visually-hidden "Loading…". The thread block
 * (`CommentThreadSkeleton`, S1.4) closes the main column; it is `aria-hidden` here because this
 * region already announces one "Loading…" (03 §2.1 `Skeleton` a11y rule).
 */
export type ProjectDetailSkeletonProps = {
  className?: string;
};

export function ProjectDetailSkeleton({ className }: ProjectDetailSkeletonProps) {
  const classes = className
    ? `${styles['project-detail-skeleton']} ${className}`
    : styles['project-detail-skeleton'];
  return (
    <div role="region" aria-busy="true" aria-label="Loading project" className={classes}>
      <p className="visually-hidden">Loading…</p>
      <div className={styles['project-detail-skeleton-grid']}>
        <div className={styles['project-detail-skeleton-main']}>
          <div className={styles['project-detail-skeleton-header']}>
            <div className={styles['project-detail-skeleton-icon']} aria-hidden="true" />
            <div className={styles['project-detail-skeleton-titles']}>
              <Skeleton kind="media" width="60%" height="40px" />
              <Skeleton kind="text" lines={2} />
            </div>
          </div>
          <Skeleton kind="media" />
          <div className={styles['project-detail-skeleton-thumbs']} aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className={styles['project-detail-skeleton-thumb']} />
            ))}
          </div>
          <Skeleton kind="text" lines={4} />
          <div aria-hidden="true">
            <CommentThreadSkeleton count={2} />
          </div>
        </div>
        <div className={styles['project-detail-skeleton-rail']}>
          <div className={styles['project-detail-skeleton-panel']}>
            <Skeleton kind="media" height="48px" />
            <Skeleton kind="text" lines={2} />
          </div>
          <div className={styles['project-detail-skeleton-panel']}>
            <Skeleton kind="text" lines={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
