import type { ReactNode } from 'react';
import { SkipLink } from '@/components/layout/SkipLink';
import { Nav } from '@/components/layout/Nav';
import { Footer } from '@/components/layout/Footer';
import { ToastProvider } from '@/components/layout/Toast';
import { ViewerProvider } from '@/components/accounts/ViewerProvider';

/**
 * (public) layout — the site chrome (ADR-0002 C5; 02 RP-09): SkipLink, Toast live region,
 * ViewerProvider (client session seam), Nav, <main id="main">, Footer.
 * FloatingSupportButton mounts here in S1.9; Vercel Analytics + Speed Insights in S1.10.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <ToastProvider>
        <ViewerProvider>
          <Nav />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <Footer />
        </ViewerProvider>
      </ToastProvider>
    </>
  );
}
