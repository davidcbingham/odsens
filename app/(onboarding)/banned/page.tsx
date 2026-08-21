import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import styles from './page.module.css';

/**
 * `/banned` — the one page a banned account can see (ADR-0019; 02 §1.2, §3 M4b; DESIGN.md §11.3 #19).
 * Dynamic: anon → 307 `/`; signed in and not banned → 307 `/`; banned → the admin gate's 400px slab
 * (§11.3 #18 look) with "YOU'RE BANNED" and one line — no links, no Google button. The `(onboarding)`
 * shell around it carries the wordmark and the Sign out form, which is all the functionality there
 * is. `noindex` (02 RP-07). The proxy sends every other navigation of a banned account here, so the
 * page needs no `next` and no data beyond `getViewer()` (01 INV-12).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Banned',
  robots: { index: false, follow: false },
};

export default async function BannedPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/');
  if (!viewer.profile?.is_banned) redirect('/');
  return (
    <div className={styles.banned}>
      <section className={styles['banned-slab']} aria-labelledby="banned-title">
        <h1 id="banned-title" className={styles['banned-title']}>
          YOU&apos;RE BANNED
        </h1>
        <p className={styles['banned-line']}>This account can&apos;t use odsens any more.</p>
      </section>
    </div>
  );
}
