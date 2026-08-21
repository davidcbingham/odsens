import type { ReactNode } from 'react';
import Link from 'next/link';
import { SkipLink } from '@/components/layout/SkipLink';
import { ToastProvider } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import styles from './layout.module.css';

/**
 * (onboarding) layout — minimal shell for `/welcome` (02 RP-09/RP-11; ADR-0002 C5):
 * SkipLink, Toast live region, wordmark link + the Sign out POST form (one of the two allowed
 * POST forms — 01 INV-17), <main id="main">. Same slab bar look as Nav.
 */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <ToastProvider>
        <header className={styles['onboarding-header']}>
          <div className={styles['onboarding-header-inner']}>
            {/* No prefetch: the proxy would answer it with "307 → /welcome" while the handle is null and
                poison the router cache for the post-DONE navigation (ADR-0017). */}
            <Link href="/" prefetch={false} className={styles['onboarding-wordmark']}>
              ODSENS
            </Link>
            <form method="post" action="/auth/sign-out">
              <Button variant="secondary" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </ToastProvider>
    </>
  );
}
