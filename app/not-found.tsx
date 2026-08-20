import type { Metadata } from 'next';
import { Button } from '@/components/primitives/Button';
import styles from './not-found.module.css';

/**
 * 404 — DESIGN.md §11.3 #13; 03 G-02. Renders inside the root layout only (no Nav/Footer),
 * so it is self-sufficient. The 80px "404" is decorative (aria-hidden); the h1 carries the meaning.
 */
export const metadata: Metadata = {
  title: 'Not found',
};

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className={styles['not-found']}>
      <div className={styles['not-found-column']}>
        {/* Decorative numeral: aria-hidden + inert (not in the a11y tree, not hit-testable) — the h1 carries the meaning (03 G-02). */}
        <p aria-hidden="true" inert className={styles['not-found-code']}>
          404
        </p>
        <h1 className={styles['not-found-title']}>THAT PAGE DOESN&apos;T EXIST</h1>
        <p className={styles['not-found-line']}>Probably never did.</p>
        <div className={styles['not-found-actions']}>
          <Button variant="primary" href="/">
            GO HOME
          </Button>
          <Button variant="ghost" href="/projects">
            See the projects
          </Button>
        </div>
      </div>
    </main>
  );
}
