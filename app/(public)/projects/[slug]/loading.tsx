import { ProjectDetailSkeleton } from '@/components/layout/ProjectDetailSkeleton';
import styles from './page.module.css';

/**
 * `/projects/[slug]` loading — 02 RP-10 / 03 G-01: `ProjectDetailSkeleton` inside the real page
 * container so nothing jumps on load (00 S1.2.AC12; DESIGN.md §11.1). The comments block
 * (`CommentThreadSkeleton`) joins with the S1.4 thread.
 */
export default function ProjectDetailLoading() {
  return (
    <div className={styles.detail}>
      <ProjectDetailSkeleton />
    </div>
  );
}
