import { ProjectDetailSkeleton } from '@/components/layout/ProjectDetailSkeleton';
import styles from './page.module.css';

/**
 * `/projects/[slug]` loading — 02 RP-10 / 03 G-01 / 02 §6: `ProjectDetailSkeleton` inside the
 * real page container so nothing jumps on load (00 S1.2.AC12; DESIGN.md §11.1), including the
 * thread block (`CommentThreadSkeleton`, S1.4). The thread's own placeholder for the viewer-only
 * rows after hydration lives inside `CommentThread`, not here (03 C-17a).
 */
export default function ProjectDetailLoading() {
  return (
    <div className={styles.detail}>
      <ProjectDetailSkeleton />
    </div>
  );
}
