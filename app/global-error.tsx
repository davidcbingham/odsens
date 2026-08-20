'use client';

import '@/styles/tokens.css';
import '@/styles/globals.css';
import { Button } from '@/components/primitives/Button';
import styles from './global-error.module.css';

/**
 * Root error boundary — DESIGN.md §11.3 #14; 03 G-03. Replaces the root layout, so it renders
 * its own <html>/<body>, imports the tokens + globals itself and sets font fallbacks (the
 * next/font variables from app/layout.tsx are absent here). Never shows codes or stack text.
 */
// Props `{ error, reset }` are intentionally unused: nothing about the error is shown, and RELOAD is a hard reload.
export default function GlobalError() {
  return (
    <html lang="en">
      <body>
        <main id="main" className={styles['global-error']}>
          <div className={styles['global-error-column']}>
            <div aria-hidden="true" className={styles['global-error-mark']}>
              !
            </div>
            <h1 className={styles['global-error-title']}>SOMETHING BROKE</h1>
            <p className={styles['global-error-line']}>
              Not your fault. Reload and it&apos;s usually fine. If it isn&apos;t, it&apos;s on the
              list.
            </p>
            <div className={styles['global-error-actions']}>
              <Button variant="primary" onClick={() => window.location.reload()}>
                RELOAD
              </Button>
              <Button variant="ghost" href="/">
                Go home
              </Button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
