'use client';

import { Button } from '@/components/primitives/Button';
import styles from './error.module.css';

/**
 * Route error boundary — DESIGN.md §11.3 #14; 03 G-03. Never renders error.message, digest or
 * stack (Next logs the digest server-side; Sentry hooks in at S1.10). No console.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className={styles.error}>
      <div className={styles['error-column']}>
        <div aria-hidden="true" className={styles['error-mark']}>
          !
        </div>
        <h1 className={styles['error-title']}>SOMETHING BROKE</h1>
        <p className={styles['error-line']}>
          Not your fault. Reload and it&apos;s usually fine. If it isn&apos;t, it&apos;s on the
          list.
        </p>
        <div className={styles['error-actions']}>
          <Button variant="primary" onClick={() => reset()}>
            RELOAD
          </Button>
          <Button variant="ghost" href="/">
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}
