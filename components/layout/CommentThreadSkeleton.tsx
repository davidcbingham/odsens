import { Skeleton } from './Skeleton';
import styles from './CommentThreadSkeleton.module.css';

/**
 * CommentThreadSkeleton — comment-shaped shells (DESIGN.md §11.1/§11.8; 03 §2.1
 * `CommentThreadSkeleton`: "40px avatar squares + bubble blocks"; 02 §6 row `/projects/[slug]`).
 * Shared (no directive): the thread block of `ProjectDetailSkeleton` (`loading.tsx`) and the
 * client `CommentThread`'s placeholder while it merges the viewer's own rows after hydration
 * (03 C-17a — the public rows are already in the HTML, this only sits under them). Mirrors
 * `ProjectCardSkeleton`: real shells (40px square, handle line, bubble block) with two-depth
 * `Skeleton` blocks, ≤ one screenful (count ≤ 5), region `aria-busy` + one visually-hidden
 * "Loading…".
 */
export type CommentThreadSkeletonProps = {
  /** Shells to draw (default 3, max 5). */
  count?: number;
  className?: string;
};

const DEFAULT_COUNT = 3;
const MAX_COUNT = 5;

export function CommentThreadSkeleton({
  count = DEFAULT_COUNT,
  className,
}: CommentThreadSkeletonProps) {
  const n = Math.min(MAX_COUNT, Math.max(1, Math.floor(count)));
  const classes = className
    ? `${styles['comment-thread-skeleton']} ${className}`
    : styles['comment-thread-skeleton'];
  return (
    <div role="region" aria-busy="true" aria-label="Loading comments" className={classes}>
      <p className="visually-hidden">Loading…</p>
      <ul className={styles['comment-thread-skeleton-list']}>
        {Array.from({ length: n }, (_, i) => (
          <li key={i} className={styles['comment-thread-skeleton-row']}>
            <div className={styles['comment-thread-skeleton-avatar']} aria-hidden="true" />
            <div className={styles['comment-thread-skeleton-body']}>
              <Skeleton kind="text" width="30%" height="12px" />
              <Skeleton kind="media" height="56px" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
