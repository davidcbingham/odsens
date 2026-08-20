import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

/**
 * Skeleton — flat slabs at two depths (DESIGN.md §11.1 Skeleton; 03 §2.1 `Skeleton`, G-06):
 * `media` blocks in `--skeleton-media` (16:9 when no height), `text` lines in `--skeleton-text`.
 * Slow opacity pulse 1 → .55 over `--dur-skeleton`; reduced motion holds .8. `aria-hidden` —
 * the enclosing region carries `aria-busy="true"` and one visually-hidden "Loading…".
 */
export type SkeletonProps = {
  kind: 'media' | 'text';
  /** CSS length (geometry, passed as a custom property). */
  width?: string;
  /** CSS length (geometry, passed as a custom property). */
  height?: string;
  /** Text lines to draw (kind="text"; default 1). */
  lines?: number;
  className?: string;
};

export function Skeleton({ kind, width, height, lines = 1, className }: SkeletonProps) {
  const classes = className ? `${styles.skeleton} ${className}` : styles.skeleton;
  /* geometry */
  const geometry: CSSProperties = {
    ...(width ? { ['--w' as string]: width } : {}),
    ...(height ? { ['--h' as string]: height } : {}),
  };

  if (kind === 'text') {
    const count = Math.max(1, Math.floor(lines));
    return (
      <span className={classes} data-variant="text" aria-hidden="true" style={geometry}>
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={styles['skeleton-line']} />
        ))}
      </span>
    );
  }

  return <span className={classes} data-variant="media" aria-hidden="true" style={geometry} />;
}
