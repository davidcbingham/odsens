import type { Metadata } from 'next';
import { AmountPicker } from '@/components/support/AmountPicker';
import { Leaderboard } from '@/components/support/Leaderboard';
import { getPublicSettings } from '@/lib/data/settings';
import { normalizeKofiPage } from '@/lib/support';
import styles from './page.module.css';

/**
 * `/support` — DESIGN.md §6 #7 Support, §11.4 wrapper, §12.4 leaderboard (empty), §12.7 C19;
 * 02 §2.7; 04 §5.7; 00 S1.5b (ADR-0036). Replaces the S0 placeholder.
 *
 * ISR 600 under tag `settings`: the one read is `site_settings_public.kofi_page` through
 * `getPublicSettings()` (ADR-0002 C19 — the DB is the source of truth; saving Admin → Settings
 * revalidates the tag). Empty page name → the picker renders disabled with "Tips open soon." and no
 * Ko-fi slot. DOM order: title + lead → `AmountPicker` (which mounts `KofiPanelSlot` under its
 * slab on CONTINUE — ADR-0041 D2) → "What it pays for" → `Leaderboard` (empty state in v1).
 * `FloatingSupportButton` opts out of this route (02 RP-15).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Support',
  description: 'Everything on odsens is free. Tips go through Ko-fi, if you feel like it.',
  alternates: { canonical: '/support' },
};

export default async function SupportPage() {
  const { kofiPage } = await getPublicSettings();

  return (
    <div className={styles.support}>
      <header className={styles['support-head']}>
        <h1 className={styles['support-title']}>SUPPORT</h1>
        <p className={styles['support-lead']}>
          Everything here is free. This is just if you feel like it.
        </p>
      </header>
      <AmountPicker kofiPage={normalizeKofiPage(kofiPage)} />
      <section aria-labelledby="what-it-pays-for" className={styles['support-pays']}>
        <h2 id="what-it-pays-for" className={styles['support-pays-title']}>
          What it pays for
        </h2>
        <p className={styles['support-pays-line']}>
          The domain, the hosting, and the occasional texture pack I buy to take one block out of
          it.
        </p>
      </section>
      <Leaderboard rows={[]} />
    </div>
  );
}
