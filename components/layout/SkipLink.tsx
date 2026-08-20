import styles from './SkipLink.module.css';

/**
 * SkipLink — first focusable element in <body>; visually hidden until keyboard focus, then a
 * gold slab top-left that jumps to `<main id="main" tabindex="-1">` (03 §2.1 `SkipLink`, N-07).
 */
export type SkipLinkProps = Record<string, never>;

export function SkipLink() {
  return (
    <a href="#main" className={styles['skip-link']}>
      Skip to content
    </a>
  );
}
