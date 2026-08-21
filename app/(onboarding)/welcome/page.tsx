import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingPanel } from '@/components/accounts/OnboardingPanel';
import { getViewer, safeNext } from '@/lib/auth';
import styles from './page.module.css';

/**
 * `/welcome` — handle onboarding (02 §1.2, §2.4; DESIGN.md §11.3 #10). Dynamic: anon → 307 `/`;
 * already onboarded → 307 `next` (`safeNext`, default `/`); otherwise the `OnboardingPanel` on the
 * faint 45° indigo hatch. `noindex` (02 RP-07). The proxy already blocks navigation elsewhere while
 * the handle is null (02 M5).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pick a handle',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/');
  if (viewer.profile?.handle) {
    const params = await searchParams;
    const raw = params.next;
    redirect(safeNext(Array.isArray(raw) ? raw[0] : raw));
  }
  return (
    <div className={styles.welcome}>
      <OnboardingPanel />
    </div>
  );
}
